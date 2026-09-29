import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { link } from '../../common/utils/hateoas';
import { AtraccionResponseDto } from './dto/atraccion-response.dto';
import { ProductType } from './dto/create-atraccion.dto';
import { ReservationResponseDto, ReservationStatus } from './dto/reservation.dto';
import { ESTADO_A_STATUS, FilaAtraccion, FilaReserva, TIPO_A_CONTRATO } from './modelo';
import { fechaHoraEc, horasAIso } from './utils/fechas';

/**
 * Traduce las filas del modelo relacional (en español) a los esquemas
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

  /**
   * Insignias calculadas a partir de los datos (no se guardan: dependerían de
   * otros datos y romperían la 3FN).
   */
  insignias(a: FilaAtraccion): string[] {
    const out: string[] = [];
    if (a.vendidos_60d >= 20) out.push('best_seller');
    if ((a.ocupacion_14d ?? 0) >= 0.7) out.push('likely_to_sell_out');
    if (Date.now() - new Date(a.creado_en).getTime() < 30 * 86400_000 && a.numero_resenas === 0) out.push('new');
    return out;
  }

  toResponse(a: FilaAtraccion): AtraccionResponseDto {
    const self = `/atracciones/${a.uuid}`;
    const lista = (tipo: string) => a.inclusiones.filter((i) => i.tipo === tipo).map((i) => i.nombre);
    const precio = a.precio_adulto ?? 0;
    return {
      id: a.uuid,
      name: a.nombre,
      slug: a.slug,
      short_description: a.descripcion_corta ?? a.descripcion.slice(0, 160),
      long_description: a.descripcion,
      duration: horasAIso(a.duracion_horas),
      duration_hours: a.duracion_horas,
      price: { currency: a.moneda, total: precio },
      child_price: { currency: a.moneda, total: a.precio_nino ?? precio },
      operator: { id: a.ope_codigo, name: a.operador },
      product_type: TIPO_A_CONTRATO[a.tipo] ?? ProductType.GUIDED_TOUR,
      includes: lista('INCLUYE'),
      not_includes: lista('NO_INCLUYE'),
      recommendations: lista('RECOMENDACION'),
      categories: a.categorias,
      badges: this.insignias(a),
      locations: [
        {
          address: a.direccion ?? a.ciudad,
          city: a.ciu_id,
          country: 'ec',
          coordinates: { latitude: a.latitud, longitude: a.longitud },
          type: 'attraction',
        },
      ],
      destination: { code: a.ciu_id, name: a.ciudad, province: a.provincia, region: a.region },
      photos: a.fotos.map((f) => ({ url: this.absUrl(f.url), alt: f.alt })),
      supported_languages: a.idiomas,
      free_cancellation: a.cancelacion_gratuita,
      cancellation_hours: a.horas_cancelacion,
      times: a.horarios.map((h) => h.hora),
      capacity_per_slot: a.horarios.reduce((m, h) => Math.max(m, h.cupo), 0),
      meeting_point: a.punto_encuentro ?? undefined,
      featured: a.destacada,
      is_active: a.estado === 'PUBLICADA',
      status: a.estado,
      ratings: { number_of_reviews: a.numero_resenas, score: a.rating },
      url: { web: `${this.frontendUrl}/atraccion/${a.uuid}`, app: `descubreec://attractions/${a.uuid}` },
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
  canCancel(r: Pick<FilaReserva, 'estado' | 'fecha' | 'hora' | 'cancelacion_gratuita' | 'horas_cancelacion'>): boolean {
    if (ESTADO_A_STATUS[r.estado] === ReservationStatus.CANCELLED || r.estado === 'COMPLETADA') return false;
    if (!r.cancelacion_gratuita) return false;
    return fechaHoraEc(r.fecha, r.hora).getTime() - Date.now() > (r.horas_cancelacion ?? 24) * 3600_000;
  }

  toReservation(r: FilaReserva): ReservationResponseDto {
    const self = `/atracciones/reservations/${r.id}`;
    const status = ESTADO_A_STATUS[r.estado] ?? ReservationStatus.PENDING;
    return {
      reservation_id: r.id,
      code: r.codigo,
      status,
      ticket_count: r.tickets,
      adults: r.adultos,
      children: r.ninos,
      total_price: { currency: r.moneda, total: r.total },
      date: r.fecha,
      time: r.hora,
      attraction: {
        id: r.atr_uuid,
        name: r.atr_nombre,
        city: r.ciudad,
        photo: this.absUrl(r.foto),
        meeting_point: r.punto_encuentro ?? r.direccion ?? undefined,
        free_cancellation: r.cancelacion_gratuita,
        cancellation_hours: r.horas_cancelacion,
      },
      customer: {
        name: r.pax_nombre ?? '',
        // Contacto indicado al reservar; si no se indicó, el de la cuenta
        email: r.pax_correo ?? r.correo,
        phone: r.pax_telefono ?? r.telefono ?? undefined,
        document: r.pax_documento ?? undefined,
      },
      payment_method: r.metodo ?? undefined,
      notes: r.observaciones ?? undefined,
      cancellation_reason: r.motivo_cancelacion ?? undefined,
      cancelled_at: r.cancelado_en ? new Date(r.cancelado_en).toISOString() : undefined,
      created_at: new Date(r.creado_en).toISOString(),
      can_cancel: this.canCancel(r),
      _links: {
        self: link(self),
        attraction: link(`/atracciones/${r.atr_uuid}`),
        ...(status !== ReservationStatus.CANCELLED ? { cancel: link(`${self}/cancel`, 'POST') } : {}),
        ...(status === ReservationStatus.PENDING ? { confirm: link(`${self}/confirm`, 'POST') } : {}),
      },
    };
  }
}
