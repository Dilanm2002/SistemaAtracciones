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

export type EstadoV2 = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

/**
 * Máquina de estados de 6 fases del contrato final. EXPIRED: pendiente de pago cuya salida ya pasó
 * (nunca se pagó ni se confirmó).
 */
export function estadoV2(r: Pick<FilaReserva, 'estado' | 'fecha' | 'hora'>, ahora = Date.now()): EstadoV2 {
  switch (r.estado) {
    case 'CANCELADA_RES': return 'CANCELLED';
    case 'CHECKED_IN': return 'CHECKED_IN';
    case 'COMPLETADA': return 'COMPLETED';
    case 'PENDIENTE_PAGO': return Date.parse(`${r.fecha}T${r.hora}:00-05:00`) < ahora ? 'EXPIRED' : 'PENDING';
    default: return 'CONFIRMED';
  }
}

/** Fila del modelo relacional → esquemas del contrato v2 (con sus alias en español). */
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

  /** TarifaBaseDesglosada: adulto, niño, senior, estudiante e infante (y alias en español). */
  precio(f: FilaAtraccion) {
    const adult = f.precio_adulto ?? 0;
    const child = f.precio_nino ?? adult;
    const senior = f.precio_mayor ?? adult;
    const student = f.precio_estudiante ?? adult;
    return {
      currency: f.moneda, adult, child, senior, infant: 0, student,
      moneda: f.moneda, adulto: adult, nino: child, tercera_edad: senior, infante: 0, estudiante: student,
    };
  }

  inclusiones(f: FilaAtraccion) {
    return { incluye_comida: f.incluye_comida, incluye_transporte: f.incluye_transporte, incluye_guia: f.incluye_guia };
  }

  card(f: FilaAtraccion) {
    const score = a10(f.rating);
    const precio = this.precio(f);
    const rating = { score, review_count: f.numero_resenas, badge_text: insigniaDe(score) };
    const corta = f.descripcion_corta ?? f.descripcion.slice(0, 200);
    const punto = f.punto_encuentro ?? f.direccion ?? f.ciudad;
    const duracion = duracionTexto(f.duracion_horas);
    return {
      id: f.uuid,
      slug: f.slug,
      name: f.nombre,
      short_description: corta,
      city: f.ciudad,
      duration: duracion,
      duration_hours: f.duracion_horas,
      price: precio,
      rating,
      free_cancellation: f.cancelacion_gratuita,
      free_cancellation_hours: f.horas_cancelacion,
      inclusions: this.inclusiones(f),
      meeting_point: punto,
      photos: f.fotos.map((p) => this.base.absUrl(p.url)),
      permite_paquete: f.permite_paquete,
      // Alias en español
      nombre: f.nombre,
      descripcion_corta: corta,
      ciudad: f.ciudad,
      duracion,
      precio,
      calificacion: rating,
      cancelacion_gratuita: f.cancelacion_gratuita,
      inclusiones: this.inclusiones(f),
      punto_encuentro: punto,
    };
  }

  detalle(f: FilaAtraccion, acuerdo: { permite: boolean; maximo: number }) {
    const score = a10(f.rating);
    const punto = f.punto_encuentro ?? f.direccion ?? f.ciudad;
    const precio = this.precio(f);
    const pilares = {
      limpieza: a10(f.pilares?.limpieza),
      servicio: a10(f.pilares?.servicio),
      calidad_precio: a10(f.pilares?.calidad_precio),
      puntualidad: a10(f.pilares?.puntualidad),
    };
    const rating = {
      score,
      review_count: f.numero_resenas,
      badge_text: insigniaDe(score),
      breakdown: {
        ...pilares,
        cleanliness: pilares.limpieza,
        service_score: pilares.servicio,
        value_for_money: pilares.calidad_precio,
        punctuality: pilares.puntualidad,
      },
    };
    const itinerario = f.itinerario.map((p) => {
      const hora = hora12(p.hora);
      return {
        stop_number: p.orden,
        time: hora,
        title: p.titulo,
        ...(p.descripcion ? { description: p.descripcion, descripcion: p.descripcion } : {}),
        duration_minutes: p.duracion_min,
        ...(p.lugar ? { location_name: p.lugar, nombre_ubicacion: p.lugar } : {}),
        numero_parada: p.orden,
        hora,
        titulo: p.titulo,
        duracion_minutos: p.duracion_min,
      };
    });
    const geo = {
      address: punto,
      city: f.ciudad,
      latitude: f.latitud,
      longitude: f.longitud,
      ...(f.instrucciones_llegada ? { arrival_instructions: f.instrucciones_llegada, instrucciones_llegada: f.instrucciones_llegada } : {}),
      google_maps_url: `https://maps.google.com/?q=${f.latitud},${f.longitud}`,
      direccion: punto,
      ciudad: f.ciudad,
      latitud: f.latitud,
      longitud: f.longitud,
    };
    const accesibilidad = {
      wheelchair_accessible: f.accesible_silla,
      stroller_accessible: f.accesible_coche,
      service_animals_allowed: f.animales_servicio,
      accesible_silla_ruedas: f.accesible_silla,
      accesible_carriola: f.accesible_coche,
      admite_animales_asistencia: f.animales_servicio,
    };
    const descripcionPolitica = f.cancelacion_gratuita
      ? `Cancela gratis hasta ${f.horas_cancelacion} horas antes de la actividad y recibe el 100 % de reembolso.`
      : 'Esta experiencia no tiene cancelación gratuita: solo se reembolsa en la hora siguiente a la compra.';
    const politica = {
      free_cancellation: f.cancelacion_gratuita,
      deadline_hours: f.horas_cancelacion,
      description: descripcionPolitica,
      cancelacion_gratuita: f.cancelacion_gratuita,
      horas_limite: f.horas_cancelacion,
      descripcion: descripcionPolitica,
    };
    const duracion = duracionTexto(f.duracion_horas);
    return {
      id: f.uuid,
      uuid: f.uuid,
      slug: f.slug,
      name: f.nombre,
      description: f.descripcion,
      city: f.ciudad,
      duration: duracion,
      price: precio,
      rating,
      inclusions: this.inclusiones(f),
      inclusions_list: f.inclusiones.filter((i) => i.tipo === 'INCLUYE').map((i) => i.nombre),
      exclusions_list: f.inclusiones.filter((i) => i.tipo === 'NO_INCLUYE').map((i) => i.nombre),
      itinerary: itinerario,
      meeting_point_geo: geo,
      accessibility: accesibilidad,
      guide_languages: f.idiomas.map((c) => IDIOMAS[c] ?? c),
      cancellation_policy: politica,
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
      // Alias en español
      nombre: f.nombre,
      descripcion: f.descripcion,
      ciudad: f.ciudad,
      duracion,
      precio,
      calificacion: rating,
      inclusiones: this.inclusiones(f),
      punto_encuentro_geo: geo,
      itinerario,
      accesibilidad,
      politica_cancelacion: politica,
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
    const status = estadoV2(r);
    const hora = hora12(r.hora);
    const telefono = e164(r.pax_telefono ?? r.telefono) ?? '';
    const correo = r.pax_correo ?? r.correo;
    const documento = r.pax_documento ?? '';
    const tipoDoc = r.pax_tipo_documento ?? 'CEDULA';
    return {
      external_order_id: r.orden_numero,
      reservation_id: r.id,
      reservation_code: r.codigo,
      status,
      date: r.fecha,
      time: hora,
      ticket_count: r.tickets,
      adult_count: r.adultos,
      child_count: r.ninos,
      senior_count: r.seniors,
      student_count: r.estudiantes,
      infant_count: r.infantes,
      total_price: r.total,
      currency: r.moneda,
      customer: {
        full_name: r.pax_nombre ?? '',
        email: correo,
        phone: telefono,
        document_type: tipoDoc,
        document_id: documento,
        nombre_completo: r.pax_nombre ?? '',
        correo,
        telefono,
        tipo_documento: tipoDoc,
        numero_documento: documento,
      },
      guia_asignado: r.guia ?? 'Guía oficial asignado por Descubre EC',
      punto_encuentro: r.punto_encuentro ?? r.direccion ?? r.ciudad,
      voucher_qr_payload: this.voucher(r),
      voucher_qr_url: this.qrUrl(r.codigo),
      ics_calendar_url: this.icsUrl(r),
      ...(r.reembolso ? { reembolso_id: r.reembolso.numero, monto_reembolsado: r.reembolso.monto } : {}),
      // Alias en español
      cantidad_adultos: r.adultos,
      cantidad_ninos: r.ninos,
      cantidad_seniors: r.seniors,
      cantidad_estudiantes: r.estudiantes,
      cantidad_infantes: r.infantes,
      fecha: r.fecha,
      hora,
      precio_total: r.total,
      moneda: r.moneda,
      estado: status,
      // Extensiones (no rompen el contrato)
      attraction_id: r.atr_uuid,
      payment_method: r.metodo ?? undefined,
      payment_status: r.reembolso ? 'REFUNDED' : r.pago_estado === 'APROBADO' ? 'PAID' : 'PENDING',
      ...(r.saga_id ? { saga_id: r.saga_id } : {}),
      ...(r.checkin_en ? { checked_in_at: new Date(r.checkin_en).toISOString() } : {}),
      ...(r.cancelado_en ? { cancelled_at: new Date(r.cancelado_en).toISOString(), cancellation_reason: r.motivo_cancelacion ?? undefined } : {}),
      created_at: new Date(r.creado_en).toISOString(),
      _links: {
        self,
        ...(status === 'CONFIRMED' ? { checkin: `${self}/checkin` } : {}),
        ...(status === 'CONFIRMED' || status === 'PENDING' ? { cancel: `${self}/cancel` } : {}),
      },
    };
  }
}
