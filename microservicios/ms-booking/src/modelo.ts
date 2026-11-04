import { fechaHoraEc, hora12 } from './comun/tiempo';
import { firmarHasta } from './enlaces';
import { emitirVoucher } from './voucher';

/** Fila de reserva + titular (lo que necesitan las respuestas del contrato). */
export interface FilaReserva {
  res_id: string;
  id: string; // res_uuid
  codigo: string;
  estado: string; // PENDIENTE_PAGO | CONFIRMADA | CHECKED_IN | CANCELADA | COMPLETADA
  fecha: string;
  hora: string; // HH:MM
  adultos: number;
  ninos: number;
  seniors: number;
  estudiantes: number;
  infantes: number;
  tickets: number;
  total: number;
  moneda: string;
  dis_id: string;
  det_id: string;
  ord_id: string | null;
  orden_numero: string | null;
  pag_id: string | null;
  atr_id: string;
  atr_uuid: string;
  atr_nombre: string;
  punto_encuentro: string | null;
  guia: string | null;
  cancelacion_gratuita: boolean;
  horas_cancelacion: number;
  metodo: string | null;
  pago_estado: string;
  reembolso_numero: string | null;
  reembolso_monto: number | null;
  origen: string;
  saga_id: string | null;
  checkin_en: Date | null;
  cancelado_en: Date | null;
  motivo_cancelacion: string | null;
  creado_en: Date;
  pax_nombre: string | null;
  pax_documento: string | null;
  pax_tipo_documento: string | null;
  pax_correo: string | null;
  pax_telefono: string | null;
}

export const SELECT_RESERVA = `SELECT r.res_id::text, r.res_uuid::text AS id, r.res_codigo AS codigo, e.est_codigo AS estado,
       to_char(r.res_fecha, 'YYYY-MM-DD') AS fecha, to_char(r.res_hora, 'HH24:MI') AS hora,
       r.res_adultos AS adultos, r.res_ninos AS ninos, r.res_seniors AS seniors, r.res_estudiantes AS estudiantes, r.res_infantes AS infantes,
       r.res_numero_tickets AS tickets, r.res_subtotal::float8 AS total, r.res_moneda AS moneda,
       r.dis_id::text, r.det_id::text, r.ord_id::text, r.ord_numero AS orden_numero, r.pag_id::text,
       r.atr_id::text, r.atr_uuid::text, r.atr_nombre, r.res_punto_encuentro AS punto_encuentro, r.res_guia AS guia,
       r.res_cancelacion_gratuita AS cancelacion_gratuita, r.res_horas_cancelacion AS horas_cancelacion,
       r.res_metodo_pago AS metodo, r.res_pago_estado AS pago_estado, r.res_reembolso_numero AS reembolso_numero,
       r.res_reembolso_monto::float8 AS reembolso_monto, r.res_origen AS origen, r.res_saga_id AS saga_id,
       r.res_checkin_en AS checkin_en, r.res_cancelado_en AS cancelado_en, r.res_motivo_cancelacion AS motivo_cancelacion,
       r.res_creado_en AS creado_en,
       p.pax_nombre, p.pax_documento, p.pax_tipo_documento, p.pax_correo, p.pax_telefono
  FROM reserva r JOIN estado e ON e.est_id = r.est_id
  LEFT JOIN reserva_pasajero p ON p.res_id = r.res_id AND p.pax_es_titular`;

/** Plazo de arrepentimiento tras comprar y corte de las pendientes de pago (los mismos de la tienda). */
export const PERIODO_ARREPENTIMIENTO_MS = 60 * 60 * 1000;
export const CORTE_PENDIENTE_MS = 60 * 60 * 1000;

export type Politica =
  | { policy: 'FULL_REFUND' | 'NO_CHARGE'; freeUntil: Date }
  | { policy: 'NO_REFUND' | 'NOT_ALLOWED'; freeUntil: null; motivo: string };

/** Política de cancelación (idéntica a la tienda): gratis dentro del plazo o de la hora de arrepentimiento. */
export function politicaCancelacion(r: FilaReserva, ahora = Date.now()): Politica {
  if (r.estado === 'CANCELADA') return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'Esta reserva ya estaba cancelada.' };
  if (r.estado === 'COMPLETADA') return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'La experiencia ya se realizó; no puede cancelarse.' };
  if (r.estado === 'CHECKED_IN') return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'El titular ya hizo el check-in: la experiencia está en curso.' };
  const salida = fechaHoraEc(r.fecha, r.hora).getTime();
  if (ahora >= salida) return { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'La experiencia ya comenzó; ya no puede cancelarse.' };
  if (r.estado === 'PENDIENTE_PAGO') {
    const corte = salida - CORTE_PENDIENTE_MS;
    return ahora < corte
      ? { policy: 'NO_CHARGE', freeUntil: new Date(corte) }
      : { policy: 'NOT_ALLOWED', freeUntil: null, motivo: 'Las reservas pendientes de pago se cancelan hasta 1 hora antes de la salida.' };
  }
  const limite = r.cancelacion_gratuita ? salida - r.horas_cancelacion * 3_600_000 : null;
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

export type EstadoV2 = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

/** Máquina de 6 fases del contrato. EXPIRED: pendiente de pago cuya salida ya pasó. */
export function estadoV2(r: Pick<FilaReserva, 'estado' | 'fecha' | 'hora'>, ahora = Date.now()): EstadoV2 {
  switch (r.estado) {
    case 'CANCELADA': return 'CANCELLED';
    case 'CHECKED_IN': return 'CHECKED_IN';
    case 'COMPLETADA': return 'COMPLETED';
    case 'PENDIENTE_PAGO': return fechaHoraEc(r.fecha, r.hora).getTime() < ahora ? 'EXPIRED' : 'PENDING';
    default: return 'CONFIRMED';
  }
}

/** Teléfono E.164 (+593…) a partir del formato ecuatoriano 09… / 02… */
export const e164 = (t: string | null | undefined) => (!t ? undefined : t.startsWith('+') ? t : `+593${t.replace(/^0/, '')}`);

const secreto = () => process.env.VOUCHER_SECRET ?? process.env.JWT_SECRET ?? '';
const publica = () => (process.env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export const qrUrl = (codigo: string, pase = false) => `${publica()}/api/v2/atracciones/vouchers/${codigo}/qr.png${pase ? '?tipo=pase' : ''}`;

/** Enlace .ics firmado, válido hasta el día siguiente a la actividad. */
export function icsUrl(r: FilaReserva) {
  const exp = Math.floor(Date.parse(`${r.fecha}T23:59:59-05:00`) / 1000) + 86_400;
  return `${publica()}/api/v1/calendario/${r.id}.ics?t=${firmarHasta(`calendario:${r.id}`, secreto(), exp)}`;
}

export const voucher = (r: FilaReserva, tipo: 'voucher' | 'pase' = 'voucher') => emitirVoucher(r.id, r.codigo, secreto(), tipo);

/** Reserva en el formato del contrato v2/v3 (con sus alias en español), igual que la tienda. */
export function reservaContrato(r: FilaReserva) {
  const self = `/api/v2/atracciones/reservas/${r.id}`;
  const status = estadoV2(r);
  const hora = hora12(r.hora);
  const telefono = e164(r.pax_telefono) ?? '';
  const correo = r.pax_correo ?? '';
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
      full_name: r.pax_nombre ?? '', email: correo, phone: telefono, document_type: tipoDoc, document_id: documento,
      nombre_completo: r.pax_nombre ?? '', correo, telefono, tipo_documento: tipoDoc, numero_documento: documento,
    },
    guia_asignado: r.guia ?? 'Guía oficial asignado por Descubre EC',
    punto_encuentro: r.punto_encuentro ?? '',
    voucher_qr_payload: voucher(r),
    voucher_qr_url: qrUrl(r.codigo),
    ics_calendar_url: icsUrl(r),
    ...(r.reembolso_numero ? { reembolso_id: r.reembolso_numero, monto_reembolsado: r.reembolso_monto } : {}),
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
    attraction_id: r.atr_uuid,
    payment_method: r.metodo ?? undefined,
    payment_status: r.reembolso_numero ? 'REFUNDED' : r.pago_estado === 'APROBADO' ? 'PAID' : 'PENDING',
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
