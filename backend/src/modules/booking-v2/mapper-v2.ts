import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firmarHasta } from '../../common/storage/media';
import { AtraccionMapper } from '../atracciones/atraccion.mapper';
import { FilaAtraccion, FilaReserva } from '../atracciones/modelo';
import { hora12 } from '../atracciones/utils/hora12';
import { emitirVoucher } from './voucher';

/** Idiomas del catálogo (código ISO) → nombre, como los muestra el contrato v2 («Español», «Inglés»). */
const IDIOMAS: Record<string, string> = {
  es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', pt: 'Portugués', it: 'Italiano', qu: 'Kichwa', zh: 'Chino', ja: 'Japonés',
};

/** 1–5 (estrellas) → 0–10 con un decimal, la escala del contrato v2. */
const a10 = (v: number | null | undefined) => (v ? Math.round(v * 20) / 10 : 0);

export const insigniaDe = (score: number) =>
  score >= 9 ? 'Excepcional' : score >= 8 ? 'Muy bueno' : score >= 7 ? 'Bueno' : score > 0 ? 'Aceptable' : 'Sin reseñas';

export const duracionTexto = (h: number) => {
  const n = Number.isInteger(h) ? String(h) : h.toLocaleString('es-EC', { maximumFractionDigits: 1 });
  return `${n} ${h === 1 ? 'hora' : 'horas'}`;
};

/** Teléfono para el contrato: E.164 (+593…) a partir del formato ecuatoriano 09… / 02… */
export const e164 = (t: string | null | undefined) => (!t ? undefined : t.startsWith('+') ? t : `+593${t.replace(/^0/, '')}`);

export const STATUS_V2: Record<string, 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED'> = {
  CANCELADA_RES: 'CANCELLED',
  CHECKED_IN: 'CHECKED_IN',
};

/** Fila del modelo relacional → esquemas del contrato v2. */
@Injectable()
export class MapperV2 {
  constructor(
    private readonly base: AtraccionMapper,
    private readonly config: ConfigService,
  ) {}

  private get secreto() {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  private get publica() {
    return (this.config.get<string>('PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  precio(f: FilaAtraccion) {
    const adulto = f.precio_adulto ?? 0;
    return {
      currency: f.moneda,
      adult: adulto,
      child: f.precio_nino ?? adulto,
      senior: f.precio_mayor ?? adulto,
      infant: 0,
    };
  }

  inclusiones(f: FilaAtraccion) {
    return { incluye_comida: f.incluye_comida, incluye_transporte: f.incluye_transporte, incluye_guia: f.incluye_guia };
  }

  card(f: FilaAtraccion) {
    const score = a10(f.rating);
    return {
      id: f.uuid,
      slug: f.slug,
      name: f.nombre,
      short_description: f.descripcion_corta ?? f.descripcion.slice(0, 200),
      city: f.ciudad,
      duration: duracionTexto(f.duracion_horas),
      duration_hours: f.duracion_horas,
      price: this.precio(f),
      rating: { score, review_count: f.numero_resenas, badge_text: insigniaDe(score) },
      free_cancellation: f.cancelacion_gratuita,
      free_cancellation_hours: f.horas_cancelacion,
      inclusions: this.inclusiones(f),
      meeting_point: f.punto_encuentro ?? f.direccion ?? f.ciudad,
      photos: f.fotos.map((p) => this.base.absUrl(p.url)),
      permite_paquete: f.permite_paquete,
    };
  }

  detalle(f: FilaAtraccion, acuerdo: { permite: boolean; maximo: number }) {
    const score = a10(f.rating);
    const punto = f.punto_encuentro ?? f.direccion ?? f.ciudad;
    return {
      id: f.uuid,
      uuid: f.uuid,
      slug: f.slug,
      name: f.nombre,
      description: f.descripcion,
      city: f.ciudad,
      duration: duracionTexto(f.duracion_horas),
      price: this.precio(f),
      rating: {
        score,
        review_count: f.numero_resenas,
        badge_text: insigniaDe(score),
        breakdown: {
          limpieza: a10(f.pilares?.limpieza),
          servicio: a10(f.pilares?.servicio),
          calidad_precio: a10(f.pilares?.calidad_precio),
          puntualidad: a10(f.pilares?.puntualidad),
        },
      },
      inclusions: this.inclusiones(f),
      inclusions_list: f.inclusiones.filter((i) => i.tipo === 'INCLUYE').map((i) => i.nombre),
      exclusions_list: f.inclusiones.filter((i) => i.tipo === 'NO_INCLUYE').map((i) => i.nombre),
      itinerary: f.itinerario.map((p) => ({
        stop_number: p.orden,
        time: hora12(p.hora),
        title: p.titulo,
        ...(p.descripcion ? { description: p.descripcion } : {}),
        duration_minutes: p.duracion_min,
        ...(p.lugar ? { location_name: p.lugar } : {}),
      })),
      meeting_point_geo: {
        address: punto,
        city: f.ciudad,
        latitude: f.latitud,
        longitude: f.longitud,
        ...(f.instrucciones_llegada ? { arrival_instructions: f.instrucciones_llegada } : {}),
        google_maps_url: `https://maps.google.com/?q=${f.latitud},${f.longitud}`,
      },
      accessibility: {
        wheelchair_accessible: f.accesible_silla,
        stroller_accessible: f.accesible_coche,
        service_animals_allowed: f.animales_servicio,
      },
      guide_languages: f.idiomas.map((c) => IDIOMAS[c] ?? c),
      cancellation_policy: {
        free_cancellation: f.cancelacion_gratuita,
        deadline_hours: f.horas_cancelacion,
        description: f.cancelacion_gratuita
          ? `Cancela gratis hasta ${f.horas_cancelacion} horas antes de la actividad y recibe el 100 % de reembolso.`
          : 'Esta experiencia no tiene cancelación gratuita: solo se reembolsa en la hora siguiente a la compra.',
      },
      permite_paquete: f.permite_paquete && acuerdo.permite,
      // Nunca más de lo pactado en el acuerdo B2B de promociones
      porcentaje_descuento_paquete: f.permite_paquete && acuerdo.permite ? Math.min(f.descuento_paquete, acuerdo.maximo) : 0,
      photos: f.fotos.map((p) => this.base.absUrl(p.url)),
      proveedor: {
        id: `proveedor-${f.ope_codigo}`,
        nombre_comercial: f.operador,
        ...(f.ope_ruc ? { ruc: f.ope_ruc } : {}),
        ...(f.ope_telefono ? { telefono_emergencia: e164(f.ope_telefono) } : {}),
        ...(f.ope_correo ? { email_soporte: f.ope_correo } : {}),
      },
    };
  }

  /** Enlace .ics firmado, válido hasta el día siguiente a la actividad. */
  icsUrl(r: FilaReserva) {
    const exp = Math.floor(Date.parse(`${r.fecha}T23:59:59-05:00`) / 1000) + 86_400;
    return `${this.publica}/api/v1/calendario/${r.id}.ics?t=${firmarHasta(`calendario:${r.id}`, this.secreto, exp)}`;
  }

  qrUrl(codigo: string, pase = false) {
    return `${this.publica}/api/v2/atracciones/vouchers/${codigo}/qr.png${pase ? '?tipo=pase' : ''}`;
  }

  voucher(r: FilaReserva, tipo: 'voucher' | 'pase' = 'voucher') {
    return emitirVoucher(r.id, r.codigo, this.secreto, tipo);
  }

  reserva(r: FilaReserva) {
    const self = `/api/v2/atracciones/reservas/${r.id}`;
    const status = STATUS_V2[r.estado] ?? 'CONFIRMED';
    const adultos = r.adultos;
    return {
      external_order_id: r.orden_numero,
      reservation_id: r.id,
      reservation_code: r.codigo,
      status,
      date: r.fecha,
      time: hora12(r.hora),
      ticket_count: r.tickets,
      adult_count: adultos,
      child_count: r.ninos,
      senior_count: r.seniors,
      infant_count: r.infantes,
      total_price: r.total,
      currency: r.moneda,
      customer: {
        full_name: r.pax_nombre ?? '',
        email: r.pax_correo ?? r.correo,
        phone: e164(r.pax_telefono ?? r.telefono) ?? '',
        document_type: r.pax_tipo_documento ?? 'CEDULA',
        document_id: r.pax_documento ?? '',
      },
      guia_asignado: r.guia ?? 'Guía oficial asignado por Descubre EC',
      punto_encuentro: r.punto_encuentro ?? r.direccion ?? r.ciudad,
      voucher_qr_payload: this.voucher(r),
      voucher_qr_url: this.qrUrl(r.codigo),
      ics_calendar_url: this.icsUrl(r),
      // ── Extensiones (no rompen el contrato) ──
      attraction_id: r.atr_uuid,
      payment_method: r.metodo ?? undefined,
      payment_status: r.pago_estado === 'APROBADO' ? 'PAID' : r.pago_estado === 'REEMBOLSADO' ? 'REFUNDED' : 'PENDING',
      ...(r.saga_id ? { saga_id: r.saga_id } : {}),
      ...(r.checkin_en ? { checked_in_at: new Date(r.checkin_en).toISOString() } : {}),
      ...(r.cancelado_en ? { cancelled_at: new Date(r.cancelado_en).toISOString(), cancellation_reason: r.motivo_cancelacion ?? undefined } : {}),
      created_at: new Date(r.creado_en).toISOString(),
      _links: {
        self,
        ...(status === 'CONFIRMED' ? { checkin: `${self}/checkin`, cancel: `${self}/cancel` } : {}),
      },
    };
  }
}
