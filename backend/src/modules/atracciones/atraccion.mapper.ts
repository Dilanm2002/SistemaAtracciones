import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { link } from '../../common/utils/hateoas';
import { AtraccionResponseDto } from './dto/atraccion-response.dto';
import { ReservationResponseDto, ReservationStatus } from './dto/reservation.dto';
import { Atraccion } from './entities/atraccion.entity';
import { Reserva } from './entities/reserva.entity';
import { fechaHoraEc, horasAIso } from './utils/fechas';

/**
 * Traduce las entidades (modelo interno en español) a los esquemas
 * del contrato OpenAPI (en inglés). Si el contrato cambia, solo se toca aquí.
 */
@Injectable()
export class AtraccionMapper {
  private readonly publicUrl: string;
  private readonly frontendUrl: string;

  constructor(config: ConfigService) {
    this.publicUrl = config.get('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, '');
    this.frontendUrl = config.get('FRONTEND_URL', 'http://localhost:5173').replace(/\/$/, '');
  }

  absUrl(path: string | null | undefined): string {
    if (!path) return '';
    return /^https?:\/\//.test(path) ? path : `${this.publicUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /** Convierte una URL absoluta propia de vuelta a ruta relativa para guardarla. */
  relUrl(url: string): string {
    return url.startsWith(this.publicUrl) ? url.slice(this.publicUrl.length) : url;
  }

  toResponse(a: Atraccion): AtraccionResponseDto {
    const self = `/atracciones/${a.id}`;
    return {
      id: a.id,
      name: a.nombre,
      short_description: a.descripcionCorta ?? a.descripcion.slice(0, 160),
      long_description: a.descripcion,
      duration: horasAIso(a.duracionHoras),
      duration_hours: a.duracionHoras,
      price: { currency: a.moneda, total: a.precioTicket },
      child_price: { currency: a.moneda, total: a.precioNino ?? a.precioTicket },
      operator: a.operador ? { id: a.operador.codigo, name: a.operador.nombre } : null,
      product_type: a.tipoProducto,
      includes: a.incluye ?? [],
      not_includes: a.noIncluye ?? [],
      recommendations: a.recomendaciones ?? [],
      categories: (a.categorias ?? []).map((c) => c.slug),
      badges: a.insignias ?? [],
      locations: [
        {
          address: a.direccion ?? a.ciudad,
          city: a.destino?.codigo,
          country: 'ec',
          coordinates: { latitude: a.latitud, longitude: a.longitud },
          type: 'attraction',
        },
      ],
      destination: a.destino
        ? { code: a.destino.codigo, name: a.destino.nombre, province: a.destino.provincia, region: a.destino.region }
        : undefined,
      photos: (a.fotos ?? []).map((f) => ({ url: this.absUrl(f) })),
      supported_languages: a.idiomas ?? [],
      free_cancellation: a.cancelacionGratuita,
      cancellation_hours: a.horasCancelacion,
      times: a.horarios ?? [],
      capacity_per_slot: a.cupoPorHorario,
      meeting_point: a.puntoEncuentro ?? undefined,
      featured: a.destacado,
      is_active: a.estaActivo,
      ratings: { number_of_reviews: a.numeroResenas, score: a.ratingPromedio },
      url: { web: `${this.frontendUrl}/atraccion/${a.id}`, app: `descubreec://attractions/${a.id}` },
      _links: {
        self: link(self),
        availability: link(`${self}/availability`),
        reviews: link(`${self}/reviews`),
        reserve: link(`${self}/reservations`, 'POST'),
        update: link(self, 'PATCH'),
        delete: link(self, 'DELETE'),
      },
    };
  }

  /** Una reserva se puede cancelar sin costo si no está cancelada y falta más que el margen configurado. */
  canCancel(r: Reserva): boolean {
    if (r.estado === ReservationStatus.CANCELLED) return false;
    const inicio = fechaHoraEc(r.fecha, r.hora).getTime();
    if (!r.atraccion?.cancelacionGratuita) return false;
    return inicio - Date.now() > (r.atraccion.horasCancelacion ?? 24) * 3600_000;
  }

  toReservation(r: Reserva): ReservationResponseDto {
    const self = `/atracciones/reservations/${r.id}`;
    const canCancel = this.canCancel(r);
    return {
      reservation_id: r.id,
      code: r.codigo,
      status: r.estado,
      ticket_count: r.ticketCount,
      adults: r.adultos,
      children: r.ninos,
      total_price: { currency: r.moneda, total: r.total },
      date: r.fecha,
      time: r.hora,
      attraction: r.atraccion
        ? {
            id: r.atraccion.id,
            name: r.atraccion.nombre,
            city: r.atraccion.ciudad,
            photo: this.absUrl(r.atraccion.fotos?.[0]),
            meeting_point: r.atraccion.puntoEncuentro ?? r.atraccion.direccion ?? undefined,
            free_cancellation: r.atraccion.cancelacionGratuita,
            cancellation_hours: r.atraccion.horasCancelacion,
          }
        : undefined,
      customer: {
        name: r.clienteNombre,
        email: r.clienteEmail ?? undefined,
        phone: r.clienteTelefono ?? undefined,
        document: r.clienteDocumento ?? undefined,
      },
      payment_method: r.metodoPago as any,
      notes: r.notas ?? undefined,
      cancellation_reason: r.motivoCancelacion ?? undefined,
      cancelled_at: r.canceladaEn?.toISOString(),
      created_at: r.createdAt?.toISOString(),
      can_cancel: canCancel,
      _links: {
        self: link(self),
        attraction: link(`/atracciones/${r.atraccion?.id}`),
        ...(r.estado !== ReservationStatus.CANCELLED ? { cancel: link(`${self}/cancel`, 'POST') } : {}),
        ...(r.estado === ReservationStatus.PENDING ? { confirm: link(`${self}/confirm`, 'POST') } : {}),
      },
    };
  }
}
