import {
  Body, CanActivate, Controller, ExecutionContext, Get, Headers, HttpCode, HttpException, Injectable, NotFoundException, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { JwtGuard, Roles, ServicioGuard, SocioGuard } from './comun/auth';
import { CancelReservationRequestV2, CheckinRequestV2, CreateReservaRequestV2, EventosQueryV2 } from './dto';
import { firmaValida } from './enlaces';
import { EventoEntrante, EventosService } from './eventos';
import { ReservasService } from './reservas';
import { randomUUID } from 'crypto';

const SOLICITANTES = ['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'] as const;

/**
 * Cancelación tolerante, como la pide Booking: la Idempotency-Key es opcional (cancelar ya es idempotente por el
 * estado de la reserva) y el cuerpo puede traer campos de más. Del cuerpo solo se toma el motivo y el solicitante.
 */
function pedidoCancelacion(cuerpo: unknown, clave: string | undefined): { dto: CancelReservationRequestV2; key: string } {
  const b = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
  const motivo = [b.reason, b.motivo, b.cancellation_reason, b.razon].find((v): v is string => typeof v === 'string' && !!v.trim());
  const solicitante = SOLICITANTES.find((s) => s === b.solicitante) ?? 'CLIENTE';
  const k = typeof clave === 'string' && clave.trim() && clave.trim().length <= 80 ? clave.trim() : randomUUID();
  return { dto: { reason: motivo?.trim().slice(0, 255), solicitante }, key: k };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las operaciones que cambian estado exigen Idempotency-Key UUID (igual que la tienda). */
@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const k = ctx.switchToHttp().getRequest<Request>().header('idempotency-key');
    if (!k?.trim()) {
      throw new HttpException({ title: 'Falta la cabecera Idempotency-Key', message: 'Las operaciones transaccionales requieren la cabecera Idempotency-Key (UUID v4) para evitar operaciones duplicadas, como cobros dobles.', code: 'VALIDATION_FAILED' }, 400);
    }
    if (!RE_UUID.test(k)) {
      throw new HttpException({ title: 'Idempotency-Key con formato inválido', message: 'La cabecera Idempotency-Key debe ser un UUID v4 válido (p. ej. 3f0c2c1e-8a4b-4c1d-9e2f-5b6a7c8d9e0f).', code: 'VALIDATION_FAILED' }, 400);
    }
    return true;
  }
}

const versionDe = (req: Request) => (/\/api\/v3\//.test(req.originalUrl) ? '3' : '2');
/** 201 del contrato (formato de la guía de socios): success y message además de la reserva. */
const confirmada = <T extends object>(r: T) => ({ success: true, message: 'Reserva confirmada exitosamente en Descubre EC.', ...r });

/** Rutas del contrato v2/v3 bajo /atracciones (las mismas que tenía la tienda; las fijas antes de `:id`). */
@Controller({ path: 'atracciones', version: ['2', '3'] })
export class ReservasBookingController {
  constructor(
    private readonly s: ReservasService,
    private readonly eventos: EventosService,
  ) {}

  @Get('eventos')
  @UseGuards(SocioGuard)
  feed(@Query() q: EventosQueryV2) {
    return this.eventos.feed(q);
  }

  @Post('reservas')
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  async reservar(@Body() dto: CreateReservaRequestV2, @Headers('idempotency-key') key: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.s.crear(dto, key);
    res.setHeader('Location', `/api/v${versionDe(req)}/atracciones/reservas/${r.reservation_id}`);
    return confirmada(r);
  }

  @Get('reservas/:id')
  @UseGuards(SocioGuard)
  reserva(@Param('id') id: string) {
    return this.s.obtener(id);
  }

  @Post('reservas/:id/cancel')
  @HttpCode(200)
  @UseGuards(SocioGuard)
  cancelar(@Param('id') id: string, @Body() cuerpo: Record<string, unknown>, @Headers('idempotency-key') clave?: string) {
    const { dto, key } = pedidoCancelacion(cuerpo, clave);
    return this.s.cancelar(id, dto, key);
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  checkin(@Param('id') id: string, @Body() dto: CheckinRequestV2, @Headers('idempotency-key') key: string, @Req() req: Request & { usuario?: { email?: string; sub: string } }) {
    return this.s.checkin(id, dto, key, req.usuario?.email ?? req.usuario?.sub);
  }

  /** PNG del QR del voucher (o del pase de abordar con ?tipo=pase). */
  @Get('vouchers/:codigo/qr.png')
  async qr(@Param('codigo') codigo: string, @Query('tipo') tipo: string | undefined, @Res() res: Response) {
    const contenido = await this.s.contenidoQr(codigo, tipo === 'pase');
    const png = await QRCode.toBuffer(contenido, { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(png);
  }
}

/** Las mismas operaciones en la URL base que registra Booking (guía de integración de socios §5). */
@Controller({ version: ['2', '3'] })
export class ReservasBaseController {
  constructor(private readonly s: ReservasService) {}

  @Post('reservas')
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  async reservar(@Body() dto: CreateReservaRequestV2, @Headers('idempotency-key') key: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.s.crear(dto, key);
    res.setHeader('Location', `/api/v${versionDe(req)}/reservas/${r.reservation_id}`);
    return confirmada(r);
  }

  @Get('reservas/:id')
  @UseGuards(SocioGuard)
  reserva(@Param('id') id: string) {
    return this.s.obtener(id);
  }

  @Post('reservas/:id/cancel')
  @HttpCode(200)
  @UseGuards(SocioGuard)
  cancelar(@Param('id') id: string, @Body() cuerpo: Record<string, unknown>, @Headers('idempotency-key') clave?: string) {
    const { dto, key } = pedidoCancelacion(cuerpo, clave);
    return this.s.cancelar(id, dto, key);
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  checkin(@Param('id') id: string, @Body() dto: CheckinRequestV2, @Headers('idempotency-key') key: string) {
    return this.s.checkin(id, dto, key);
  }
}

export class ListaQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number = 100;
}

@Controller({ version: '1' })
export class ReservasPropiasController {
  constructor(
    private readonly s: ReservasService,
    private readonly eventos: EventosService,
  ) {}

  /** «Añadir a mi calendario»: el enlace firmado que va en ics_calendar_url. */
  @Get('calendario/:archivo')
  async ics(@Param('archivo') archivo: string, @Query('t') t: string | undefined, @Res() res: Response) {
    const uuid = /^([0-9a-f-]{36})\.ics$/i.exec(archivo)?.[1];
    const secreto = process.env.VOUCHER_SECRET ?? process.env.JWT_SECRET ?? '';
    if (!uuid || !secreto || !firmaValida(`calendario:${uuid}`, t, secreto)) throw new NotFoundException('El enlace del calendario no es válido o venció.');
    const r = await this.s.ics(uuid).catch(() => {
      throw new NotFoundException('El enlace del calendario no es válido o venció.');
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="reserva-${r.codigo}.ics"`);
    res.send(r.texto);
  }

  /** STOCK_ACTUALIZADO de ms_inventory para el feed de eventos. */
  @Post('internal/eventos')
  @HttpCode(200)
  @UseGuards(ServicioGuard)
  recibir(@Body() e: EventoEntrante) {
    return this.eventos.recibir(e);
  }

  @Get('reservas')
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  listar(@Query() q: ListaQuery) {
    return this.s.listar(q.limit);
  }
}
