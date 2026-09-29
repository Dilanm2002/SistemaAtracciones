import {
  Controller, Get, Post, Delete, Body, Param, Headers,
  ParseUUIDPipe, UseGuards, HttpCode, HttpStatus, Header,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam,
  ApiHeader, ApiSecurity,
} from '@nestjs/swagger';
import { AutosService } from './autos.service';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';

// ─────────────────────────────────────────────────────────────────────────────
// Controlador BFF de Autos — Alineado 1:1 con autos-openapi.yaml
// ─────────────────────────────────────────────────────────────────────────────

@Controller()
export class AutosController {
  constructor(private readonly autosService: AutosService) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ══════════════════════════════════════════════════════════════════════════

  @Post('search')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Búsqueda de renta de vehículos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Vehículos encontrados' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones' })
  @Header('Cache-Control', 'public, max-age=300')
  search(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() searchRequest: any,
  ) {
    return this.autosService.search(searchRequest);
  }

  @Post('details')
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({ summary: 'Obtener especificaciones y características de los vehículos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Detalles de los vehículos solicitados' })
  @Header('Cache-Control', 'public, max-age=300')
  getDetails(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() detailsRequest: any,
  ) {
    return this.autosService.getDetails(detailsRequest);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Información de Agencias y Proveedores
  // ══════════════════════════════════════════════════════════════════════════

  @Post('depots')
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Consultar lista de agencias de renta (puntos de recogida y entrega)' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Lista de agencias (depots)' })
  @Header('Cache-Control', 'public, max-age=3600')
  getDepots(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() depotsRequest: any,
  ) {
    return this.autosService.getDepots(depotsRequest);
  }

  @Post('depots/reviews/scores')
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Obtener puntuaciones y reseñas de las agencias' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Puntuaciones desglosadas por agencia' })
  @Header('Cache-Control', 'public, max-age=600')
  getDepotScores(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() scoresRequest: any,
  ) {
    return this.autosService.getDepotScores(scoresRequest);
  }

  @Post('suppliers')
  @ApiTags('Información de Agencias y Proveedores')
  @ApiOperation({ summary: 'Listar proveedores de renta de autos' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Lista de proveedores de renta de autos' })
  @Header('Cache-Control', 'public, max-age=3600')
  getSuppliers(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() suppliersRequest: any,
  ) {
    return this.autosService.getSuppliers(suppliersRequest);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Componentes Comunes
  // ══════════════════════════════════════════════════════════════════════════

  @Post('constants')
  @ApiTags('Componentes Comunes')
  @ApiOperation({ summary: 'Consultar constantes del sistema (políticas, seguros, servicios extra)' })
  @ApiHeader({ name: 'X-Affiliate-Id', required: true })
  @ApiResponse({ status: 200, description: 'Constantes del sistema' })
  @Header('Cache-Control', 'public, max-age=86400')
  getConstants(
    @Headers('X-Affiliate-Id') affiliateId: string,
    @Body() constantsRequest: any,
  ) {
    return this.autosService.getConstants(constantsRequest);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas)
  // ══════════════════════════════════════════════════════════════════════════

  @Post('orders/hold')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:book'])
  @ApiOperation({ summary: 'Bloquear temporalmente el vehículo y precio (Hold)' })
  @ApiResponse({ status: 200, description: 'Vehículo bloqueado exitosamente' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 409, description: 'Conflicto (auto no disponible)' })
  holdOrder(@Body() holdRequest: any) {
    return this.autosService.holdOrder(holdRequest);
  }

  @Post('orders/preview')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:read'])
  @ApiOperation({ summary: 'Previsualizar la orden de renta antes de confirmar' })
  @ApiResponse({ status: 200, description: 'Detalles de la orden previsualizada y precios finales' })
  previewOrder(@Body() previewRequest: any) {
    return this.autosService.previewOrder(previewRequest);
  }

  @Post('orders/create')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:book'])
  @ApiOperation({ summary: 'Crear orden/reserva de renta de vehículo' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cobros duplicados' })
  @ApiResponse({ status: 201, description: 'Orden creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Petición inválida' })
  @ApiResponse({ status: 409, description: 'Conflicto (auto no disponible)' })
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdempotencyKeyGuard)
  createOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Body() createRequest: any,
  ) {
    return this.autosService.createOrder(createRequest);
  }

  @Get('orders/:orderId')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:read'])
  @ApiOperation({ summary: 'Obtener detalles de la orden' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalles completos de la orden' })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  getOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.autosService.getOrder(orderId);
  }

  @Post('orders/:orderId/modify')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:book'])
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
    return this.autosService.modifyOrder(orderId, modifyRequest);
  }

  @Post('orders/:orderId/cancel')
  @ApiTags('Gestión de Órdenes (Reservas)')
  @ApiSecurity('OAuth2Security', ['autos:cancel'])
  @ApiOperation({ summary: 'Cancelar una orden de renta' })
  @ApiParam({ name: 'orderId', type: 'string', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID v4 para evitar cancelaciones duplicadas' })
  @ApiResponse({ status: 200, description: 'Cancelación procesada' })
  @ApiResponse({ status: 409, description: 'Conflicto' })
  @UseGuards(IdempotencyKeyGuard)
  cancelOrder(
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.autosService.cancelOrder(orderId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ══════════════════════════════════════════════════════════════════════════

  @Get('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Listar suscripciones a eventos' })
  @ApiResponse({ status: 200, description: 'Suscripciones activas' })
  listWebhooks() {
    return this.autosService.listWebhooks();
  }

  @Post('webhooks')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Registrar un nuevo webhook' })
  @ApiResponse({ status: 201, description: 'Webhook registrado' })
  @HttpCode(HttpStatus.CREATED)
  createWebhook(@Body() webhookSubscription: any) {
    return this.autosService.createWebhook(webhookSubscription);
  }

  @Delete('webhooks/:id')
  @ApiTags('Webhooks')
  @ApiSecurity('OAuth2Security', ['autos:webhooks'])
  @ApiOperation({ summary: 'Eliminar suscripción de webhook' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Suscripción eliminada' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.autosService.deleteWebhook(id);
  }
}
