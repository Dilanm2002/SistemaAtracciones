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
/** Tras reservar, el cliente puede arrepentirse y cancelar con reembolso total durante 1 hora. */
export const PERIODO_ARREPENTIMIENTO_MS = 60 * 60 * 1000;

export interface PoliticaCancelacion {
  /** FULL_REFUND: reembolso total · NO_CHARGE: nada cobrado · NO_REFUND: sin reembolso · NOT_ALLOWED */
  policy: 'FULL_REFUND' | 'NO_CHARGE' | 'NO_REFUND' | 'NOT_ALLOWED';
  /** Hasta cuándo es gratis cancelar (null si ya no lo es) */
  freeUntil: Date | null;
  motivo?: string;
}

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
      ...(a.motivo_rechazo && a.estado === 'RECHAZADA' ? { rejection_reason: a.motivo_rechazo } : {}),
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
  /**
   * Política de cancelación del CLIENTE (lógica de negocio):
   * - Ya cancelada, completada o la experiencia ya empezó → no se puede (NOT_ALLOWED).
   * - Pendiente de pago (transferencia / pago en sitio) → se cancela gratis hasta la hora de
   *   salida: no hay cobro que devolver, se anula el pago y se libera el cupo (NO_CHARGE).
   * - Pagada y antes del plazo de cancelación gratuita de la experiencia → reembolso total.
   * - Pagada y reservada a último momento (dentro del plazo) → periodo de arrepentimiento:
   *   reembolso total durante 1 h desde la reserva, sin pasar de la hora de salida.
   * - Pagada y fuera de esos plazos → puede cancelar, pero SIN reembolso (libera el cupo).
   * El personal de la empresa o el administrador puede cancelar siempre con reembolso total.
   */
  politicaCancelacion(
    r: Pick<FilaReserva, 'estado' | 'fecha' | 'hora' | 'cancelacion_gratuita' | 'horas_cancelacion' | 'creado_en'>,
    ahora = Date.now(),
  ): PoliticaCancelacion {
    if (ESTADO_A_STATUS[r.estado] === ReservationStatus.CANCELLED) return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'Esta reserva ya estaba cancelada.' };
    if (r.estado === 'COMPLETADA') return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'La experiencia ya se realizó; no puede cancelarse.' };
    const salida = fechaHoraEc(r.fecha, r.hora).getTime();
    if (ahora >= salida) return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'La experiencia ya comenzó; ya no puede cancelarse.' };
    if (r.estado === 'PENDIENTE_PAGO') return { policy: 'NO_CHARGE', freeUntil: new Date(salida) };
    const limite = r.cancelacion_gratuita ? salida - (r.horas_cancelacion ?? 24) * 3_600_000 : null;
    const arrepentimiento = Math.min(new Date(r.creado_en).getTime() + PERIODO_ARREPENTIMIENTO_MS, salida);
    const gratisHasta = Math.max(limite ?? 0, arrepentimiento);
    if (ahora < gratisHasta) return { policy: 'FULL_REFUND', freeUntil: new Date(gratisHasta) };
    return {
      policy: 'NO_REFUND',
      freeUntil: null,
      motivo: r.cancelacion_gratuita
        ? `Ya pasó el plazo de cancelación gratuita (${r.horas_cancelacion} h antes de la salida): puedes cancelar, pero sin reembolso.`
        : 'Esta experiencia no admite cancelación gratuita: puedes cancelar, pero sin reembolso.',
    };
  }

  /** Compatibilidad: true si el cliente aún puede cancelar (con o sin reembolso). */
  canCancel(r: Pick<FilaReserva, 'estado' | 'fecha' | 'hora' | 'cancelacion_gratuita' | 'horas_cancelacion' | 'creado_en'>): boolean {
    return this.politicaCancelacion(r).policy !== 'NOT_ALLOWED';
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
      ...((pol) => ({
        can_cancel: pol.policy !== 'NOT_ALLOWED',
        cancellation_policy: pol.policy,
        refundable: pol.policy === 'FULL_REFUND' || pol.policy === 'NO_CHARGE',
        ...(pol.freeUntil ? { free_cancellation_until: pol.freeUntil.toISOString() } : {}),
      }))(this.politicaCancelacion(r)),
      _links: {
        self: link(self),
        attraction: link(`/atracciones/${r.atr_uuid}`),
        ...(status !== ReservationStatus.CANCELLED ? { cancel: link(`${self}/cancel`, 'POST') } : {}),
        ...(status === ReservationStatus.PENDING ? { confirm: link(`${self}/confirm`, 'POST') } : {}),
      },
    };
  }
}
