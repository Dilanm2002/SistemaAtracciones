import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, MiddlewareConsumer, Module, NestModule, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { ReservasService } from '../atracciones/reservas.service';
import { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { CommonModule } from '../../common/common.module';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';
import { AtraccionesModule } from '../atracciones/atracciones.module';
import { CatalogoV2Service } from './catalogo-v2.service';
import {
  ActualizarPromocionesContratoRequest,
  CancelReservationRequestV2,
  CategoriasQueryV2,
  CheckinRequestV2,
  CreateReservaRequestV2,
  DisponibilidadQueryV2,
  EventosQueryV2,
  ListAtraccionesQueryV2,
  SearchAtraccionesRequestV2,
} from './dto';
import { IntegracionV2Service } from './integracion-v2.service';
import { MapperV2 } from './mapper-v2';
import { ReservasV2Service } from './reservas-v2.service';
import { SocioGuard } from './socio.guard';
import { AliasV2Middleware } from './alias.middleware';
import { randomUUID } from 'crypto';

const CORRELACION = { name: 'X-Correlation-Id', required: false, description: 'Trazabilidad distribuida: se devuelve igual y se guarda en logs y eventos' };
const IDEMPOTENCIA = { name: 'Idempotency-Key', required: true, description: 'UUID v4: la misma clave repite la respuesta sin duplicar nada' };
const API_KEY = { name: 'X-API-Key', required: false, description: 'Clave de Booking Prototipo (o Authorization: Bearer con un JWT de administrador)' };
/** v2 (contrato final) y v3 (atracciones-openapi-v3.yaml) comparten rutas y lógica. */
const VERSIONES = ['2', '3'];

/** Versión de la URL pedida (/api/v3/... → 3) para armar el Location. */
const versionDe = (req: Request) => /\/api\/v(\d+)\//.exec(req.originalUrl)?.[1] ?? '2';

/** Respuesta 201 de la guía de integración ({ success, reservation_id, status, message }) + la ficha del contrato. */
const confirmada = <T extends object>(r: T) => ({ success: true, message: 'Reserva confirmada exitosamente en Descubre EC.', ...r });

/**
 * Contrato con Booking Prototipo: v2 (contracts/atracciones-openapi-v2.yaml) en /api/v2 y v3
 * (contracts/atracciones-openapi-v3.yaml, mismas rutas) en /api/v3.
 * Seguridad según el contrato: catálogo, disponibilidad y salud son públicos (`security: []`); el resto
 * exige X-API-Key de Booking o el JWT de un administrador (SocioGuard). Las rutas fijas van antes de `:id`.
 */
@ApiTags('Booking v2 (contrato RDA2)')
@ApiHeader(CORRELACION)
@Controller({ path: 'atracciones', version: VERSIONES })
export class AtraccionesV2Controller {
  constructor(
    private readonly catalogo: CatalogoV2Service,
    private readonly reservas: ReservasV2Service,
    private readonly integracion: IntegracionV2Service,
  ) {}

  // ── Catálogo ────────────────────────────────────────────────────────────
  @Get('categorias/arbol')
  @ApiOperation({ summary: 'Árbol jerárquico de categorías con banderas de inclusión' })
  arbol() {
    return this.catalogo.arbol();
  }

  @Get('categorias')
  @ApiOperation({ summary: 'Categorías planas; con padre_id, sus hijas directas' })
  categorias(@Query() q: CategoriasQueryV2) {
    return this.catalogo.planas(q.padre_id);
  }

  @Post('search')
  @HttpCode(200)
  @ApiOperation({ summary: 'Búsqueda avanzada (destino, fechas, presupuesto, categoría, inclusiones, accesibilidad)' })
  search(@Body() dto: SearchAtraccionesRequestV2) {
    return this.catalogo.search(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listado paginado de atracciones' })
  listar(@Query() q: ListAtraccionesQueryV2) {
    return this.catalogo.listar(q);
  }

  // ── Integración: eventos, salud y promociones ───────────────────────────
  @Get('eventos')
  @UseGuards(SocioGuard)
  @ApiHeader(API_KEY)
  @ApiOperation({ summary: 'Feed de eventos del outbox (RESERVA_CREADA, RESERVA_CONFIRMADA, STOCK_ACTUALIZADO, RESERVA_CANCELADA)' })
  eventos(@Query() q: EventosQueryV2) {
    return this.integracion.eventos(q);
  }

  @Get('health')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Salud del nodo para el semáforo de Booking (UP < 200 ms · DEGRADED · DOWN = 503)' })
  @ApiResponse({ status: 503, description: 'Nodo caído o kill-switch activo' })
  async salud(@Res({ passthrough: true }) res: Response) {
    const s = await this.integracion.salud();
    if (s.status === 'DOWN') res.status(503);
    return s.body;
  }

  @Get('promociones/contrato')
  @UseGuards(SocioGuard)
  @ApiHeader(API_KEY)
  @ApiOperation({ summary: 'Acuerdo B2B de promociones y combos vigente' })
  promociones() {
    return this.integracion.promociones();
  }

  @Put('promociones/contrato')
  @UseGuards(SocioGuard)
  @ApiHeader(API_KEY)
  @ApiOperation({ summary: 'Responder el cuestionario B2B: permite promociones, % máximo, destinos, vigencia y condiciones' })
  actualizarPromociones(@Body() dto: ActualizarPromocionesContratoRequest) {
    return this.integracion.actualizarPromociones(dto);
  }

  // ── Reservas ────────────────────────────────────────────────────────────
  @Post('reservas')
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: 'Crear reserva (201 confirmada · 409 OUT_OF_STOCK activa la compensación de la saga)' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'OUT_OF_STOCK' })
  async reservar(@Body() dto: CreateReservaRequestV2, @Headers('idempotency-key') key: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.reservas.crear(dto, key);
    res.setHeader('Location', `/api/v${versionDe(req)}/atracciones/reservas/${r.reservation_id}`);
    return confirmada(r);
  }

  @Get('reservas/:id')
  @UseGuards(SocioGuard)
  @ApiHeader(API_KEY)
  @ApiOperation({ summary: 'Reserva por UUID o código PNR' })
  reserva(@Param('id') id: string) {
    return this.reservas.obtener(id);
  }

  @Post('reservas/:id/cancel')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: 'Cancelar / compensación de saga: devuelve los cupos (idempotente)' })
  cancelar(@Param('id') id: string, @Body() dto: CancelReservationRequestV2, @Headers('idempotency-key') key: string) {
    return this.reservas.cancelar(id, dto ?? {}, key);
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: 'Check-in presencial: documento del titular y/o QR del voucher (la misma Idempotency-Key repite el pase)' })
  checkin(@Param('id') id: string, @Body() dto: CheckinRequestV2, @Headers('idempotency-key') key: string) {
    return this.reservas.checkin(id, dto, key);
  }

  @Get('vouchers/:codigo/qr.png')
  @ApiOperation({ summary: '[Extensión] Imagen PNG del QR del voucher (o del pase de abordar con ?tipo=pase)' })
  async qr(@Param('codigo') codigo: string, @Query('tipo') tipo: string | undefined, @Res() res: Response) {
    const contenido = await this.reservas.contenidoQr(codigo, tipo === 'pase');
    const png = await QRCode.toBuffer(contenido, { type: 'png', width: 360, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(png);
  }

  // ── Atracción concreta (al final: `:id` no debe tapar las rutas fijas) ──
  @Get(':id')
  @ApiOperation({ summary: 'Ficha completa por UUID o slug (itinerario, pilares, accesibilidad, punto de encuentro, proveedor)' })
  detalle(@Param('id') id: string) {
    return this.catalogo.detalle(id);
  }

  @Get(':id/disponibilidad')
  @ApiOperation({ summary: 'Turnos del día con cupos y estado (DISPONIBLE, ULTIMOS_CUPOS, AGOTADO); acepta date o fecha' })
  disponibilidadEs(@Param('id') id: string, @Query() q: DisponibilidadQueryV2) {
    const fecha = q.date ?? q.fecha;
    if (!fecha) throw new BadRequestException('date es obligatorio (YYYY-MM-DD); también se acepta fecha.');
    return this.catalogo.disponibilidad(id, fecha);
  }
}

/**
 * Rutas en la URL base que se registra en Booking (GUIA_INTEGRACION_SOCIOS.md §5 y §8): Booking despacha
 * la compra a `{baseUrlRest}/reservas` y el semáforo hace ping a la base. `baseUrlRest` es
 * `http://<host>:<puerto>/api/v2` (o v3). Misma lógica, seguridad e idempotencia que /atracciones/reservas.
 */
@ApiTags('Booking v2 (contrato RDA2)')
@ApiHeader(CORRELACION)
@Controller({ version: VERSIONES })
export class SocioBaseController {
  constructor(
    private readonly reservas: ReservasV2Service,
    private readonly integracion: IntegracionV2Service,
  ) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '[Guía Booking] Salud del nodo en la URL base (igual que /atracciones/health)' })
  async salud(@Res({ passthrough: true }) res: Response) {
    const s = await this.integracion.salud();
    if (s.status === 'DOWN') res.status(503);
    return s.body;
  }

  @Post('reservas')
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: '[Guía Booking] Compra despachada por Booking a {baseUrlRest}/reservas (201 · 409 OUT_OF_STOCK)' })
  async reservar(@Body() dto: CreateReservaRequestV2, @Headers('idempotency-key') key: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.reservas.crear(dto, key);
    res.setHeader('Location', `/api/v${versionDe(req)}/atracciones/reservas/${r.reservation_id}`);
    return confirmada(r);
  }

  @Get('reservas/:id')
  @UseGuards(SocioGuard)
  @ApiHeader(API_KEY)
  @ApiOperation({ summary: '[Guía Booking] Reserva por UUID o código PNR' })
  reserva(@Param('id') id: string) {
    return this.reservas.obtener(id);
  }

  @Post('reservas/:id/cancel')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: '[Guía Booking] Cancelar / compensación de saga' })
  cancelar(@Param('id') id: string, @Body() dto: CancelReservationRequestV2, @Headers('idempotency-key') key: string) {
    return this.reservas.cancelar(id, dto ?? {}, key);
  }

  @Post('reservas/:id/checkin')
  @HttpCode(200)
  @UseGuards(SocioGuard, IdempotencyKeyGuard)
  @ApiHeader(API_KEY)
  @ApiHeader(IDEMPOTENCIA)
  @ApiOperation({ summary: '[Guía Booking] Check-in presencial' })
  checkin(@Param('id') id: string, @Body() dto: CheckinRequestV2, @Headers('idempotency-key') key: string) {
    return this.reservas.checkin(id, dto, key);
  }
}

/**
 * Check-in desde el panel de la web (v1, con sesión): el personal de la empresa operadora o el
 * administrador registra la llegada del titular con su documento. Misma lógica que el contrato v2.
 */
@ApiTags('Reservas')
@Controller('atracciones')
export class CheckinPanelController {
  constructor(
    private readonly reservas: ReservasService,
    private readonly v2: ReservasV2Service,
    private readonly bitacora: BitacoraService,
  ) {}

  @Post('reservations/:reservationId/checkin')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] Check-in presencial desde el panel (operador de la empresa o admin)' })
  async checkin(@Param('reservationId', ParseUUIDPipe) id: string, @Body() dto: CheckinRequestV2, @CurrentUser() user: AuthUser) {
    const reserva = await this.reservas.getById(id, user); // 404 si no es de su empresa
    // El personal ve el voucher en el panel: su código vale como QR (solo decide si la reserva no tiene documento)
    const r = await this.v2.checkin(id, {
      ...dto,
      codigo_voucher_qr: dto.codigo_voucher_qr ?? reserva.code,
      guia_codigo: dto.guia_codigo ?? `USR-${user.sub}`,
      scanner_device_id: dto.scanner_device_id ?? 'PANEL-WEB',
    }, randomUUID());
    await this.bitacora.registrar(user.sub, 'CHECKIN', 'reserva', id);
    return r;
  }
}

@Module({
  imports: [CommonModule, AtraccionesModule],
  controllers: [AtraccionesV2Controller, SocioBaseController, CheckinPanelController],
  providers: [CatalogoV2Service, ReservasV2Service, IntegracionV2Service, MapperV2, SocioGuard],
  exports: [ReservasV2Service],
})
export class BookingV2Module implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AliasV2Middleware).forRoutes(AtraccionesV2Controller, SocioBaseController);
  }
}
