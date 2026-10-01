import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard, OptionalJwtGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { AtraccionesService } from './atracciones.service';
import { AtraccionResponseDto } from './dto/atraccion-response.dto';
import { AvailabilityQueryDto, AvailabilityResponseDto, BlockDateDto, CalendarDayDto, CalendarQueryDto } from './dto/availability.dto';
import { CreateAtraccionDto, RevisionAtraccionDto } from './dto/create-atraccion.dto';
import { DetailsRequestDto } from './dto/details-request.dto';
import { ListAtraccionesQueryDto } from './dto/list-atracciones.dto';
import { CancelReservationRequestDto, ReservationRequestDto, ReservationResponseDto, ReservationsQueryDto } from './dto/reservation.dto';
import { CreateResenaDto, ResenasQueryDto } from './dto/resena.dto';
import { SearchAtraccionesDto } from './dto/search-atracciones.dto';
import { SearchAtraccionesResponseDto } from './dto/search-response.dto';
import { UpdateAtraccionDto } from './dto/update-atraccion.dto';
import { ResenasService } from './resenas.service';
import { ReservasService } from './reservas.service';

const IDEMPOTENCY_HEADER = { name: 'Idempotency-Key', required: true, description: 'UUID v4 único por operación' };

/**
 * Endpoints definidos en contracts/atracciones-openapi.yaml.
 * IMPORTANTE: las rutas estáticas (search, details, health, reservations)
 * se declaran ANTES de `:id` para que Express no las confunda con un UUID.
 */
@ApiTags('Atracciones')
@Controller('atracciones')
export class AtraccionesController {
  constructor(
    private readonly atraccionesService: AtraccionesService,
    private readonly reservasService: ReservasService,
    private readonly resenasService: ResenasService,
  ) {}

  // ── Catálogo: rutas estáticas ─────────────────────────────────────────
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Búsqueda de atracciones (soporta paginación por tokens)' })
  @ApiResponse({ status: 200, description: 'Resultados de la búsqueda.', type: SearchAtraccionesResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request. Datos de entrada inválidos.' })
  search(@Body() searchDto: SearchAtraccionesDto) {
    return this.atraccionesService.search(searchDto);
  }

  @Post('details')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener detalles de múltiples atracciones (Batch)' })
  @ApiResponse({ status: 200, description: 'Detalles de atracciones', type: SearchAtraccionesResponseDto })
  getDetailsBatch(@Body() dto: DetailsRequestDto) {
    return this.atraccionesService.getDetailsBatch(dto);
  }

  @Get('health')
  @ApiOperation({ summary: 'Healthcheck del microservicio para el API Gateway' })
  @ApiResponse({ status: 200, description: 'Servicio de atracciones operativo.' })
  checkHealth() {
    return this.atraccionesService.estado();
  }

  // ── Reservas: rutas estáticas ─────────────────────────────────────────
  @Get('reservations')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Historial de reservas del usuario (admin/operador: ?all=true para todas)' })
  @ApiResponse({ status: 200, description: 'Listado de reservas (máx. 500; total en la cabecera X-Total-Count).', type: [ReservationResponseDto] })
  async getReservations(@Query() query: ReservationsQueryDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { rows, total } = await this.reservasService.list(query, user);
    res.setHeader('X-Total-Count', String(total));
    return rows;
  }

  @Get('reservations/:reservationId')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener detalle de una reserva específica' })
  @ApiParam({ name: 'reservationId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReservationResponseDto })
  @ApiResponse({ status: 404, description: 'Reserva no encontrada.' })
  getReservationById(@Param('reservationId', ParseUUIDPipe) reservationId: string, @CurrentUser() user: AuthUser) {
    return this.reservasService.getById(reservationId, user);
  }

  @Post('reservations/:reservationId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, IdempotencyKeyGuard)
  @Scopes(SCOPES.CANCEL)
  @ApiBearerAuth()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Cancelar una reserva existente (Requiere Idempotency-Key)' })
  @ApiParam({ name: 'reservationId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reserva cancelada.', type: ReservationResponseDto })
  @ApiResponse({ status: 409, description: 'Ya cancelada, fuera de plazo o conflicto de idempotencia.' })
  cancelReservation(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: CancelReservationRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reservasService.cancel(reservationId, dto, idempotencyKey, user);
  }

  @Post('reservations/:reservationId/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, IdempotencyKeyGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: '[Extensión] Confirmar una reserva PENDING tras verificar el pago' })
  @ApiParam({ name: 'reservationId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ReservationResponseDto })
  confirmReservation(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reservasService.confirm(reservationId, idempotencyKey, user);
  }

  // ── Colección ─────────────────────────────────────────────────────────
  @Get()
  @UseGuards(OptionalJwtGuard)
  @Header('X-API-Deprecation-Date', '2027-12-31')
  @Header('Cache-Control', 'max-age=300')
  @ApiOperation({ summary: 'Obtener el listado paginado de atracciones' })
  @ApiResponse({ status: 200, description: 'Listado recuperado exitosamente.', type: PaginatedResponseDto })
  findAll(@Query() query: ListAtraccionesQueryDto, @CurrentUser() user?: AuthUser) {
    return this.atraccionesService.findAll(query, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar una nueva atracción' })
  @ApiResponse({ status: 201, description: 'Creada. Devuelve cabecera Location.', type: AtraccionResponseDto })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  async create(@Body() dto: CreateAtraccionDto, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const atraccion = await this.atraccionesService.create(dto, user);
    res.setHeader('Location', `/api/v1/atracciones/${atraccion.id}`);
    return atraccion;
  }

  // ── Recurso individual ────────────────────────────────────────────────
  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  @Header('X-API-Deprecation-Date', '2027-12-31')
  @Header('Cache-Control', 'max-age=300')
  @ApiOperation({ summary: 'Obtener el detalle de una atracción por su ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AtraccionResponseDto })
  @ApiResponse({ status: 404, description: 'La atracción no existe.' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.atraccionesService.findOne(id, user);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reemplazar completamente los datos de una atracción' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Reemplazada correctamente.' })
  @ApiResponse({ status: 404, description: 'La atracción no existe.' })
  replace(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAtraccionDto, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.replace(id, dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar parcialmente una atracción' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AtraccionResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAtraccionDto, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.WRITE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar una atracción (borrado lógico)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Eliminada.' })
  @ApiResponse({ status: 409, description: 'Tiene reservas próximas; debe desactivarse en su lugar.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.remove(id, user);
  }

  // ── Revisión de lo que suben las empresas (marketplace) ───────────────
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aprobar (publicar) o rechazar con motivo una experiencia en revisión' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AtraccionResponseDto })
  @ApiResponse({ status: 409, description: 'La experiencia no está en revisión.' })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionAtraccionDto, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.revisar(id, dto, user);
  }

  // ── Disponibilidad ────────────────────────────────────────────────────
  @Get(':id/availability')
  @ApiOperation({ summary: 'Consultar disponibilidad de cupos para una fecha' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AvailabilityResponseDto })
  @ApiResponse({ status: 404, description: 'La atracción no existe.' })
  getAvailability(@Param('id', ParseUUIDPipe) id: string, @Query() query: AvailabilityQueryDto) {
    return this.atraccionesService.getAvailability(id, query.date);
  }

  @Get(':id/availability/calendar')
  @ApiOperation({ summary: '[Extensión] Disponibilidad diaria de un mes (para el calendario)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: [CalendarDayDto] })
  getCalendar(@Param('id', ParseUUIDPipe) id: string, @Query() query: CalendarQueryDto) {
    return this.atraccionesService.getCalendar(id, query.month);
  }

  @Get(':id/blocked-dates')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] Fechas en que la atracción no opera' })
  listBlocked(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.listBloqueos(id, user);
  }

  @Post(':id/blocked-dates')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] Bloquear una fecha (feriado, clima, mantenimiento)' })
  block(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockDateDto, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.bloquear(id, dto, user);
  }

  @Delete(':id/blocked-dates/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] Desbloquear una fecha' })
  unblock(@Param('id', ParseUUIDPipe) id: string, @Param('blockId', ParseIdPipe) blockId: string, @CurrentUser() user: AuthUser) {
    return this.atraccionesService.desbloquear(id, blockId, user);
  }

  // ── Reservar ──────────────────────────────────────────────────────────
  @Post(':id/reservations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, IdempotencyKeyGuard)
  @Scopes(SCOPES.BOOK)
  @ApiBearerAuth()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Crear una reserva de la atracción' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Reserva creada', type: ReservationResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos (fecha pasada, horario inexistente...).' })
  @ApiResponse({ status: 404, description: 'La atracción no existe.' })
  @ApiResponse({ status: 409, description: 'Sin cupos o conflicto de idempotencia.' })
  reserve(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: ReservationRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reservasService.reserve(id, dto, idempotencyKey, user);
  }

  // ── Reseñas ───────────────────────────────────────────────────────────
  @Get(':id/reviews')
  @ApiOperation({ summary: '[Extensión] Reseñas visibles de la atracción + distribución de estrellas' })
  @ApiParam({ name: 'id', format: 'uuid' })
  listReviews(@Param('id', ParseUUIDPipe) id: string, @Query() query: ResenasQueryDto) {
    return this.resenasService.listPublic(id, query);
  }

  @Get(':id/reviews/eligibility')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] ¿El usuario autenticado puede reseñar esta atracción?' })
  reviewEligibility(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.resenasService.elegibilidad(id, user);
  }

  @Post(':id/reviews')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.BOOK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Extensión] Publicar una reseña (requiere haber vivido la experiencia)' })
  createReview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateResenaDto, @CurrentUser() user: AuthUser) {
    return this.resenasService.create(id, dto, user);
  }
}
