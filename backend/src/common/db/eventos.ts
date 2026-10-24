import { contextoActual } from '../observabilidad/contexto';
import { Sql } from './db.service';

/**
 * Tipos de eventos de dominio publicados por Atracciones.
 * Contrato: backend/contracts/atracciones-asyncapi.yaml (mantener sincronizados).
 */
export const EVENTOS = {
  RESERVA_CREADA: 'atracciones.reserva.creada',
  RESERVA_CONFIRMADA: 'atracciones.reserva.confirmada',
  RESERVA_CANCELADA: 'atracciones.reserva.cancelada',
  PAGO_APROBADO: 'atracciones.pago.aprobado',
  PAGO_REEMBOLSADO: 'atracciones.pago.reembolsado',
  ATRACCION_PUBLICADA: 'atracciones.atraccion.publicada',
  ATRACCION_ACTUALIZADA: 'atracciones.atraccion.actualizada',
  ATRACCION_RETIRADA: 'atracciones.atraccion.retirada',
  /** Cambió el aforo de un turno (venta, cancelación o cambio de cupos): contrato v2 STOCK_ACTUALIZADO */
  STOCK_ACTUALIZADO: 'atracciones.stock.actualizado',
  /** El titular se presentó en el punto de encuentro (contrato v2: check-in presencial) */
  RESERVA_CHECKIN: 'atracciones.reserva.checkin',
} as const;

/** Correlation id de la petición en curso (X-Correlation-Id / X-Request-Id) para seguir la transacción entre sistemas. */
const correlacion = () => contextoActual()?.requestId ?? null;

export type TipoEvento = (typeof EVENTOS)[keyof typeof EVENTOS];

/**
 * Registra un evento en el outbox (tabla `evento`) usando la MISMA transacción
 * `tx` del cambio de negocio: o se guardan ambos o ninguno.
 */
export async function emitirEvento(tx: Sql, tipo: TipoEvento, agregado: string, agregadoId: string, datos: Record<string, unknown>) {
  await tx.query('INSERT INTO evento (evt_tipo, evt_agregado, evt_agregado_id, evt_datos, evt_correlacion) VALUES ($1, $2, $3, $4, $5)', [
    tipo,
    agregado,
    agregadoId,
    JSON.stringify(datos),
    correlacion(),
  ]);
}

/**
 * Evento de una reserva con sus datos públicos (sin PII: ni nombre, ni documento, ni correo).
 * Los datos se leen de la base dentro de la misma transacción.
 */
export async function emitirEventoReserva(tx: Sql, tipo: TipoEvento, resId: string, extra: Record<string, unknown> = {}) {
  await tx.query(
    `INSERT INTO evento (evt_tipo, evt_agregado, evt_agregado_id, evt_datos, evt_correlacion)
     SELECT $1, 'reserva', r.res_uuid::text,
            jsonb_build_object(
              'reservation_id', r.res_uuid, 'code', r.res_codigo, 'status', e.est_codigo,
              'attraction_id', a.atr_uuid, 'operator_id', op.ope_codigo, 'city_id', a.ciu_id,
              'date', to_char(r.res_fecha, 'YYYY-MM-DD'), 'time', to_char(r.res_hora, 'HH24:MI'),
              'adults', r.res_adultos, 'children', r.res_ninos, 'seniors', r.res_seniors, 'infants', r.res_infantes,
              'students', r.res_estudiantes,
              'ticket_count', r.res_numero_tickets, 'origin', r.res_origen, 'saga_id', r.res_saga_id,
              'total', jsonb_build_object('currency', o.ord_moneda, 'total', r.res_subtotal),
              'payment_method', mp.mpa_codigo, 'order_number', o.ord_numero
            ) || $3::jsonb, $4
       FROM reserva r
       JOIN estado e ON e.est_id = r.est_id
       JOIN orden_detalle dt ON dt.det_id = r.det_id
       JOIN orden o ON o.ord_id = dt.ord_id
       JOIN atraccion a ON a.atr_id = dt.atr_id
       JOIN operador op ON op.ope_id = a.ope_id
       LEFT JOIN metodo_pago mp ON mp.mpa_id = o.mpa_id
      WHERE r.res_id = $2`,
    [tipo, resId, JSON.stringify(extra), correlacion()],
  );
}
