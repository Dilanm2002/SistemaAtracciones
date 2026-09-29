import { Injectable } from '@nestjs/common';
// import { Repository } from 'typeorm';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Alojamiento } from './entities/alojamiento.entity';

@Injectable()
export class AlojamientosService {
  /*
  constructor(
    @InjectRepository(Alojamiento)
    private readonly alojamientoRepository: Repository<Alojamiento>,
  ) {}
  */

  // ═══════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ═══════════════════════════════════════════════════════════════════════

  search(searchRequest: any): any {
    // TODO: Implementar búsqueda de alojamientos (conectar con proveedor/GDS)
    return { request_id: '', data: [], next_page: null };
  }

  checkAvailability(availabilityRequest: any): any {
    // TODO: Implementar consulta de disponibilidad y precios
    return { request_id: '', data: {} };
  }

  checkBulkAvailability(bulkRequest: any): any {
    // TODO: Implementar consulta de disponibilidad múltiple
    return { request_id: '', data: [] };
  }

  getDetails(detailsRequest: any): any {
    // TODO: Implementar obtención de detalles extendidos (fotos, descripción, etc.)
    return { request_id: '', data: [], next_page: null };
  }

  getDetailsChanges(changesRequest: any): any {
    // TODO: Implementar consulta de cambios de alojamientos desde una fecha
    return { request_id: '', data: {} };
  }

  getChains(): any {
    // TODO: Implementar listado de cadenas hoteleras y marcas
    return { request_id: '', data: [] };
  }

  getConstants(constantsRequest: any): any {
    // TODO: Implementar consulta de constantes del sistema (facilidades, tipos de cuartos)
    return { request_id: '', data: {} };
  }

  getReviews(reviewsRequest: any): any {
    // TODO: Implementar obtención de reseñas de alojamientos
    return { request_id: '', data: [], next_page: null };
  }

  getReviewsScores(scoresRequest: any): any {
    // TODO: Implementar obtención de puntuaciones de reseñas
    return { request_id: '', data: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas)
  // ═══════════════════════════════════════════════════════════════════════

  previewOrder(previewRequest: any): any {
    // TODO: Implementar previsualización de orden (precio final antes de pagar)
    return { request_id: '', data: {} };
  }

  createOrder(createRequest: any): any {
    // TODO: Implementar creación formal de reserva/orden
    return {};
  }

  getOrder(orderId: string): any {
    // TODO: Implementar obtención de detalle de orden por ID
    return {};
  }

  modifyOrder(orderId: string, modifyRequest: any): any {
    // TODO: Implementar modificación de orden existente
    return {};
  }

  cancelOrder(orderId: string): any {
    // TODO: Implementar cancelación de orden
    return {};
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ═══════════════════════════════════════════════════════════════════════

  listWebhooks(): any[] {
    // TODO: Implementar listado de suscripciones a webhooks
    return [];
  }

  createWebhook(webhookSubscription: any): any {
    // TODO: Implementar registro de webhook
    return {};
  }

  deleteWebhook(id: string): void {
    // TODO: Implementar eliminación de suscripción de webhook
  }
}
