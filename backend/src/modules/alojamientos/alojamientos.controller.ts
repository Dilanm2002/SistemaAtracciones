import {
  Controller, Get, Post, Delete, Body, Param, Headers,
  ParseUUIDPipe, UseGuards, HttpCode, HttpStatus, Header,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam,
  ApiHeader, ApiSecurity,
} from '@nestjs/swagger';
import { AlojamientosService } from './alojamientos.service';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';

// ─────────────────────────────────────────────────────────────────────────────
// Controlador BFF de Alojamientos — Alineado 1:1 con alojamientos-openapi.yaml
// ─────────────────────────────────────────────────────────────────────────────

@Controller()
export class AlojamientosController {
  constructor(private readonly alojamientosService: AlojamientosService) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ══════════════════════════════════════════════════════════════════════════

  @Post('search')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Búsqueda de alojamientos' })
  @ApiHeader({ name: 'X-Device-Fingerprint', required: true })
  @ApiResponse({ status: 200, description: 'Alojamientos encontrados' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones' })
  @Header('Cache-Control', 'public, max-age=300')
  search(
    @Headers('X-Device-Fingerprint') deviceFingerprint: string,
    @Body() searchRequest: any,
  ) {
    return this.alojamientosService.search(searchRequest);
  }

  @Post('availability')
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({ summary: 'Consultar disponibilidad y precio de un alojamiento' })
  @ApiResponse({ status: 200, description: 'Disponibilidad y detalles del precio' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  availability(@Body() availabilityRequest: any) {
    return this.alojamientosService.checkAvailability(availabilityRequest);
  }

  @Post('bulk-availability')
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({ summary: 'Consultar disponibilidad múltiple de alojamientos' })
  @ApiResponse({ status: 200, description: 'Disponibilidad para múltiples alojamientos' })
  bulkAvailability(@Body() bulkRequest: any) {
    return this.alojamientosService.checkBulkAvailability(bulkRequest);
  }

  @Post('details')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Obtener detalles extendidos de los alojamientos' })
  @ApiResponse({ status: 200, description: 'Detalles de los alojamientos solicitados' })
  @Header('Cache-Control', 'public, max-age=300')
  getDetails(@Body() detailsRequest: any) {
    return this.alojamientosService.getDetails(detailsRequest);
  }

  @Post('details/changes')
  @ApiTags('Búsqueda y Catálogo')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({ summary: 'Obtener alojamientos que han cambiado desde una fecha' })
  @ApiResponse({ status: 200, description: 'Lista de alojamientos modificados' })
  getDetailsChanges(@Body() changesRequest: any) {
    return this.alojamientosService.getDetailsChanges(changesRequest);
  }

  @Post('chains')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Listar cadenas hoteleras y sus marcas' })
  @ApiResponse({ status: 200, description: 'Lista de cadenas hoteleras' })
  @Header('Cache-Control', 'public, max-age=3600')
  getChains() {
    return this.alojamientosService.getChains();
  }

  @Post('constants')
  @ApiTags('Componentes Comunes')
  @ApiOperation({ summary: 'Consultar constantes del sistema (facilidades, tipos de cuartos, etc.)' })
  @ApiResponse({ status: 200, description: 'Constantes del sistema' })
  @Header('Cache-Control', 'public, max-age=86400')
  getConstants(@Body() constantsRequest: any) {
    return this.alojamientosService.getConstants(constantsRequest);
  }

  @Post('reviews')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Obtener reseñas de alojamientos' })
  @ApiResponse({ status: 200, description: 'Reseñas de los alojamientos' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviews(@Body() reviewsRequest: any) {
    return this.alojamientosService.getReviews(reviewsRequest);
  }

  @Post('reviews/scores')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Obtener puntuaciones de reseñas' })
  @ApiResponse({ status: 200, description: 'Puntuaciones desglosadas' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviewsScores(@Body() scoresRequest: any) {
    return this.alojamientosService.getReviewsScores(scoresRequest);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas)
  // ══════════════════════════════════════════════════════════════════════════

  @Post('orders/preview')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({ summary: 'Previsualizar orden antes de confirmar' })
  @ApiResponse({ status: 200, description: 'Detalles de la orden previsualizada y precios finales' })
  previewOrder(@Body() previewRequest: any) {
    return this.alojamientosService.previewOrder(previewRequest);
  }

  @Post('orders/create')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:book'])
  @ApiOperation({ summary: 'Crear reserva de alojamiento' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cobros duplicados' })
  @ApiResponse({ status: 201, description: 'Orden creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 409, description: 'Conflicto (habitación no disponible, cambio de precio)' })
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdempotencyKeyGuard)
  createOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Body() createRequest: any,
  ) {
    return this.alojamientosService.createOrder(createRequest);
  }

  @Get('orders/:orderId')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({ summary: 'Obtener detalles de la orden' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalles completos de la orden' })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  getOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.alojamientosService.getOrder(orderId);
  }

  @Post('orders/:orderId/modify')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:book'])
  @ApiOperation({ summary: 'Modificar una orden existente' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar modificaciones duplicadas' })
  @ApiResponse({ status: 200, description: 'Orden modificada' })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  @UseGuards(IdempotencyKeyGuard)
  modifyOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() modifyRequest: any,
  ) {
    return this.alojamientosService.modifyOrder(orderId, modifyRequest);
  }

  @Post('orders/:orderId/cancel')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['alojamientos:cancel'])
  @ApiOperation({ summary: 'Cancelar una orden' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cancelaciones duplicadas' })
  @ApiResponse({ status: 200, description: 'Cancelación procesada' })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  @UseGuards(IdempotencyKeyGuard)
  cancelOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.alojamientosService.cancelOrder(orderId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ══════════════════════════════════════════════════════════════════════════

  @Get('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({ summary: 'Listar suscripciones' })
  @ApiResponse({ status: 200, description: 'Suscripciones activas' })
  listWebhooks() {
    return this.alojamientosService.listWebhooks();
  }

  @Post('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({ summary: 'Registrar webhook' })
  @ApiResponse({ status: 201, description: 'Webhook registrado' })
  @HttpCode(HttpStatus.CREATED)
  createWebhook(@Body() webhookSubscription: any) {
    return this.alojamientosService.createWebhook(webhookSubscription);
  }

  @Delete('webhooks/:id')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['alojamientos:webhooks'])
  @ApiOperation({ summary: 'Eliminar suscripción' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Eliminado' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.alojamientosService.deleteWebhook(id);
  }
}
