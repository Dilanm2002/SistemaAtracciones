import { Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Request } from 'express';
import { CatalogoClient, IdentidadClient } from './clientes';
import { JwtGuard, Roles, Usuario } from './comun/auth';
import { IdempotencyKeyGuard } from './controladores';
import { CheckinRequestV2, CreateReservaRequestV2 } from './dto';
import { FilaReserva, Politica, politicaCancelacion, reservaContrato } from './modelo';
import { ReservasService } from './reservas';
import { trim } from './validadores';

export class ListaWebQuery {
  @IsOptional() @IsIn(['true']) todas?: string;
  @IsOptional() @IsUUID() atr_uuid?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number = 500;
}

export class CancelarWeb {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) reason?: string;
  @IsOptional() @IsBoolean() accept_no_refund?: boolean;
}

type Peticion = Request & { usuario: Usuario };
const esPersonal = (u: Usuario) => [u.rol, ...(u.roles ?? [])].some((r) => r === 'ADMIN' || r === 'OPERADOR');
const esAdmin = (u: Usuario) => [u.rol, ...(u.roles ?? [])].includes('ADMIN');
const EN_BOOKING = 'Esta reserva se hizo en Booking: si necesitas cancelarla, hazlo desde Booking.';
/**
 * Fila de la reserva con su política de cancelación ya calculada, para el BFF de la web. Un cliente no cancela
 * desde la web lo que compró en Booking (Booking no se enteraría); el personal sí puede.
 */
const conPolitica = (r: FilaReserva, u: Usuario) => ({
  ...r,
  politica: (!esPersonal(u) && r.origen === 'BOOKING' && r.estado !== 'CANCELADA' && !r.checkin_en
    ? { policy: 'NOT_ALLOWED', freeUntil: null, motivo: EN_BOOKING }
    : politicaCancelacion(r)) as Politica,
});

/** Reservas de la web y del panel: las usa el BFF con el JWT del usuario. */
@Controller({ path: 'web/reservas', version: '1' })
@UseGuards(JwtGuard)
export class ReservasWebController {
  constructor(
    private readonly s: ReservasService,
    private readonly catalogo: CatalogoClient,
    private readonly identidad: IdentidadClient,
  ) {}

  /** Cómo se reconoce a la persona en las reservas de Booking: su correo (del JWT) y su cédula y client_id. */
  private async persona(u: Usuario) {
    const p = await this.identidad.persona(u.email);
    return { correo: u.email ?? null, documento: p.documento, clientId: p.client_id };
  }

  /** Comprueba que la persona pueda ver o tocar esta reserva: la suya, o del personal autorizado. */
  private async autorizar(r: FilaReserva, u: Usuario) {
    if (esAdmin(u)) return;
    if (esPersonal(u)) {
      if ((await this.catalogo.atraccionesDeOperador(u.operador)).includes(r.atr_uuid)) return;
    } else {
      if (r.usu_id === u.sub) return;
      const p = await this.persona(u);
      const mismo = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
      if (mismo(r.pax_correo, p.correo) || mismo(r.pax_documento, p.documento) || mismo(r.client_id, p.clientId)) return;
    }
    throw new ForbiddenException({ message: 'Esta reserva no es tuya.', code: 'FORBIDDEN' });
  }

  @Get()
  async listar(@Query() q: ListaWebQuery, @Req() req: Peticion) {
    const u = req.usuario;
    const filtro = !q.todas || !esPersonal(u) ? { usuId: u.sub, ...(await this.persona(u)) } : esAdmin(u) ? {} : { atrUuids: await this.catalogo.atraccionesDeOperador(u.operador) };
    return (await this.s.filas({ ...filtro, atrUuid: q.atr_uuid, limite: q.limit })).map((r) => conPolitica(r, u));
  }

  @Get(':id')
  async una(@Param('id') id: string, @Req() req: Peticion) {
    const r = await this.s.filaOr404(id);
    await this.autorizar(r, req.usuario);
    return conPolitica(r, req.usuario);
  }

  @Get(':id/calendario')
  async calendario(@Param('id') id: string, @Req() req: Peticion) {
    const r = await this.s.filaOr404(id);
    await this.autorizar(r, req.usuario);
    return { url: reservaContrato(r).ics_calendar_url };
  }

  @Post()
  @UseGuards(IdempotencyKeyGuard)
  crear(@Body() dto: CreateReservaRequestV2, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    return this.s.crear(dto, key, { origen: 'WEB', usuId: req.usuario.sub });
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @UseGuards(IdempotencyKeyGuard)
  async cancelar(@Param('id') id: string, @Body() d: CancelarWeb, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    const r = await this.s.filaOr404(id);
    await this.autorizar(r, req.usuario);
    const solicitante = esPersonal(req.usuario) ? 'ADMIN' : 'CLIENTE';
    if (solicitante === 'CLIENTE' && r.origen === 'BOOKING' && r.estado !== 'CANCELADA') throw new ConflictException({ title: 'Cancelación No Permitida', message: EN_BOOKING, code: 'CANCEL_IN_BOOKING' });
    await this.s.cancelar(r.id, { reason: d.reason, solicitante }, key, { aceptaSinReembolso: d.accept_no_refund === true });
    return conPolitica(await this.s.filaOr404(r.id), req.usuario);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERADOR')
  @UseGuards(IdempotencyKeyGuard)
  async confirmar(@Param('id') id: string, @Req() req: Peticion) {
    const r = await this.s.filaOr404(id);
    await this.autorizar(r, req.usuario);
    await this.s.confirmarPago(r.id);
    return conPolitica(await this.s.filaOr404(r.id), req.usuario);
  }

  /** Check-in presencial desde el panel: el guía u operador valida al titular; se avisa a Booking. */
  @Post(':id/checkin')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERADOR')
  @UseGuards(IdempotencyKeyGuard)
  async checkin(@Param('id') id: string, @Body() dto: CheckinRequestV2, @Headers('idempotency-key') key: string, @Req() req: Peticion) {
    const r = await this.s.filaOr404(id);
    await this.autorizar(r, req.usuario);
    return this.s.checkin(r.id, dto, key, req.usuario.email ?? req.usuario.sub);
  }
}
