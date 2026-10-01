import { randomInt } from 'crypto';
import { QueryFailedError } from 'typeorm';
import { CatalogosService } from '../../common/db/catalogos.service';
import { Sql } from '../../common/db/db.service';
import { emitirEventoReserva, EVENTOS } from '../../common/db/eventos';
import { CardInfoDto, PaymentMethod } from './dto/reservation.dto';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones al dictarlo
const MAX_INTENTOS = 5;

export const codigoAleatorio = (rnd: () => number = () => randomInt(ALFABETO.length) / ALFABETO.length) =>
  Array.from({ length: 6 }, () => ALFABETO[Math.floor(rnd() * ALFABETO.length)]).join('');

const esUnica = (e: unknown) => e instanceof QueryFailedError && (e as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505';

export interface DatosCompra {
  usuId: string;
  atrId: string;
  atrNombre: string;
  disId: string;
  fecha: string;
  hora: string;
  adultos: number;
  ninos: number;
  precioAdulto: number;
  precioNino: number;
  moneda: string;
  metodo: PaymentMethod;
  paxNombre: string;
  paxDocumento?: string | null;
  /** Contacto de la reserva (NULL = el de la cuenta) */
  paxCorreo?: string | null;
  paxTelefono?: string | null;
  notas?: string | null;
  tarjeta?: CardInfoDto;
  /** Para los datos de demostración: fecha de creación en el pasado */
  creadoEn?: Date;
  /** Para los datos de demostración: la reserva ya se vivió */
  completada?: boolean;
  rnd?: () => number;
}

/**
 * Registra una compra completa según el modelo relacional:
 * orden → orden_detalle (precio congelado) → reserva → reserva_pasajero (PII)
 * → pago (+ pago_tarjeta) → factura (solo si el pago queda aprobado).
 *
 * Tarjeta: pago APROBADO y reserva CONFIRMADA al instante.
 * Transferencia o pago en sitio: pago PENDIENTE y reserva PENDIENTE_PAGO.
 * Los números (DEC-/ORD-/PAG-) comparten sufijo; si chocan con uno existente se
 * reintenta con otro dentro de un SAVEPOINT (el índice único es el árbitro).
 */
export async function registrarCompra(tx: Sql, cat: CatalogosService, d: DatosCompra): Promise<{ resId: string; uuid: string }> {
  const total = Math.round((d.adultos * d.precioAdulto + d.ninos * d.precioNino) * 100) / 100;
  const tickets = d.adultos + d.ninos;
  const pagada = d.metodo === PaymentMethod.TARJETA;
  const creado = d.creadoEn ?? new Date();
  const [estOrden, estPago, estReserva, mpa] = await Promise.all([
    cat.estado(pagada ? 'PAGADA' : 'CREADA'),
    cat.estado(pagada ? 'APROBADO' : 'PENDIENTE'),
    cat.estado(pagada ? (d.completada ? 'COMPLETADA' : 'CONFIRMADA') : 'PENDIENTE_PAGO'),
    cat.metodoPago(d.metodo),
  ]);

  for (let intento = 1; ; intento++) {
    const sufijo = codigoAleatorio(d.rnd);
    await tx.query('SAVEPOINT compra');
    try {
      const orden = await tx.one<{ ord_id: string }>(
        `INSERT INTO orden (ord_numero, usu_id, est_id, mpa_id, ord_fecha, ord_subtotal, ord_descuento, ord_iva, ord_total, ord_moneda,
                            ord_observaciones, ord_creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, $7, $8, $5) RETURNING ord_id::text`,
        [`ORD-${sufijo}`, d.usuId, estOrden, mpa, creado, total, d.moneda, d.notas ?? null],
      );
      const det = await tx.one<{ det_id: string }>(
        `INSERT INTO orden_detalle (ord_id, atr_id, det_descripcion, det_cantidad, det_precio_unitario, det_subtotal)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING det_id::text`,
        [orden!.ord_id, d.atrId, `${d.atrNombre} · ${d.fecha} ${d.hora}`.slice(0, 255), tickets, d.precioAdulto, total],
      );
      const res = await tx.one<{ res_id: string; res_uuid: string }>(
        `INSERT INTO reserva (res_codigo, det_id, dis_id, est_id, res_fecha, res_hora, res_adultos, res_ninos, res_numero_tickets,
                              res_precio_unitario, res_subtotal, res_observaciones, res_creado_en, res_confirmado_en)
         VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING res_id::text, res_uuid::text`,
        [
          `DEC-${sufijo}`, det!.det_id, d.disId, estReserva, d.fecha, d.hora, d.adultos, d.ninos, tickets,
          d.precioAdulto, total, d.notas ?? null, creado, pagada ? creado : null,
        ],
      );
      await tx.query(
        `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_documento, pax_correo, pax_telefono, pax_es_titular)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [res!.res_id, d.paxNombre.slice(0, 120), d.paxDocumento || null, d.paxCorreo || null, d.paxTelefono || null],
      );
      const pago = await tx.one<{ pag_id: string }>(
        `INSERT INTO pago (pag_numero, ord_id, mpa_id, est_id, pag_monto, pag_moneda, pag_fecha, pag_aprobado_en, pag_referencia, pag_creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7) RETURNING pag_id::text`,
        [`PAG-${sufijo}`, orden!.ord_id, mpa, estPago, total, d.moneda, creado, pagada ? creado : null, pagada ? `SIM-${sufijo}` : null],
      );
      if (pagada && d.tarjeta) {
        await tx.query(
          `INSERT INTO pago_tarjeta (pag_id, pat_marca, pat_ultimos4, pat_titular, pat_mes, pat_anio, pat_pais) VALUES ($1, $2, $3, $4, $5, $6, 'EC')`,
          [pago!.pag_id, d.tarjeta.brand, d.tarjeta.last4, d.tarjeta.holder.toUpperCase(), d.tarjeta.exp_month, d.tarjeta.exp_year],
        );
      }
      if (pagada) await emitirFactura(tx, cat, orden!.ord_id, creado);
      // Eventos de dominio en la misma transacción (outbox)
      await emitirEventoReserva(tx, EVENTOS.RESERVA_CREADA, res!.res_id);
      if (pagada) await emitirEventoReserva(tx, EVENTOS.PAGO_APROBADO, res!.res_id, { payment_number: `PAG-${sufijo}` });
      await tx.query('RELEASE SAVEPOINT compra');
      return { resId: res!.res_id, uuid: res!.res_uuid };
    } catch (e) {
      await tx.query('ROLLBACK TO SAVEPOINT compra');
      if (!esUnica(e) || intento >= MAX_INTENTOS) throw e;
    }
  }
}

/** Factura (SRI) de una orden pagada: número 001-001-<ord_id> y totales de la orden. */
export async function emitirFactura(tx: Sql, cat: CatalogosService, ordId: string, fecha: Date = new Date()) {
  await tx.query(
    `INSERT INTO factura (ord_id, fac_numero, est_id, fac_emitida_en, fac_subtotal, fac_iva, fac_total, fac_razon_social)
     SELECT o.ord_id, '001-001-' || lpad(o.ord_id::text, 9, '0'), $2, $3, o.ord_subtotal, o.ord_iva, o.ord_total,
            left(u.usu_nombre || ' ' || u.usu_apellido, 150)
       FROM orden o JOIN usuario u ON u.usu_id = o.usu_id WHERE o.ord_id = $1
     ON CONFLICT (ord_id) DO NOTHING`,
    [ordId, await cat.estado('PAGADA_FAC'), fecha],
  );
}

/**
 * Cancela una reserva: estado CANCELADA_RES, devuelve los cupos al inventario y
 * liquida el pago. Si estaba aprobado se registra un reembolso por el total
 * (orden REEMBOLSADA, factura ANULADA); si estaba pendiente, el pago se rechaza
 * (orden CANCELADA).
 */
/**
 * Cancela la reserva y libera sus cupos. Si el pago estaba aprobado se reembolsa (por defecto);
 * con `reembolsar = false` (cancelación del cliente fuera de plazo) el cobro se conserva y la
 * factura sigue vigente. Si el pago aún no se había aprobado, se anula.
 */
export async function cancelarCompra(tx: Sql, cat: CatalogosService, resId: string, motivo: string, fecha: Date = new Date(), reembolsar = true) {
  await tx.query('UPDATE reserva SET est_id = $2, res_motivo_cancelacion = $3, res_cancelado_en = $4 WHERE res_id = $1', [
    resId,
    await cat.estado('CANCELADA_RES'),
    motivo.slice(0, 255),
    fecha,
  ]);
  await tx.query(
    `UPDATE disponibilidad d SET dis_cupo_reservado = GREATEST(d.dis_cupo_reservado - r.res_numero_tickets, 0)
       FROM reserva r WHERE r.res_id = $1 AND d.dis_id = r.dis_id`,
    [resId],
  );
  const pago = await tx.one<{ pag_id: string; ord_id: string; monto: number; moneda: string; estado: string }>(
    `SELECT pg.pag_id::text, pg.ord_id::text, pg.pag_monto::float8 AS monto, pg.pag_moneda AS moneda, e.est_codigo AS estado
       FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN pago pg ON pg.ord_id = dt.ord_id
       JOIN estado e ON e.est_id = pg.est_id WHERE r.res_id = $1 ORDER BY pg.pag_id DESC LIMIT 1`,
    [resId],
  );
  await emitirEventoReserva(tx, EVENTOS.RESERVA_CANCELADA, resId, { reason: motivo.slice(0, 255), refunded: pago?.estado === 'APROBADO' && reembolsar });
  if (!pago) return;
  if (pago.estado === 'APROBADO' && !reembolsar) return; // fuera de plazo: el cobro se conserva
  if (pago.estado === 'APROBADO') {
    await emitirEventoReserva(tx, EVENTOS.PAGO_REEMBOLSADO, resId, { refund_amount: pago.monto });
    await tx.query(
      `INSERT INTO reembolso (pag_id, rem_numero, rem_monto, rem_moneda, rem_motivo, rem_solicitado_en, rem_procesado_en, rem_referencia)
       VALUES ($1::bigint, 'REM-' || lpad($1::bigint::text, 9, '0'), $2, $3, $4, $5, $5, 'SIM-REM-' || $1::bigint::text)
       ON CONFLICT (rem_numero) DO NOTHING`,
      [pago.pag_id, pago.monto, pago.moneda, motivo.slice(0, 300), fecha],
    );
    await tx.query('UPDATE orden SET est_id = $2 WHERE ord_id = $1', [pago.ord_id, await cat.estado('REEMBOLSADA')]);
    await tx.query('UPDATE factura SET est_id = $2 WHERE ord_id = $1', [pago.ord_id, await cat.estado('ANULADA_FAC')]);
  } else {
    await tx.query(
      `UPDATE pago SET est_id = $2, pag_rechazado_en = $3, pag_motivo_rechazo = 'Reserva cancelada antes del pago' WHERE pag_id = $1`,
      [pago.pag_id, await cat.estado('RECHAZADO'), fecha],
    );
    await tx.query('UPDATE orden SET est_id = $2 WHERE ord_id = $1', [pago.ord_id, await cat.estado('CANCELADA')]);
  }
}

/**
 * Pago verificado (transferencia o pago en sitio): reserva CONFIRMADA (o COMPLETADA si
 * ya se vivió), pago APROBADO, orden PAGADA y factura emitida.
 */
export async function confirmarCompra(tx: Sql, cat: CatalogosService, resId: string, fecha: Date = new Date(), completada = false) {
  await tx.query('UPDATE reserva SET est_id = $2, res_confirmado_en = $3 WHERE res_id = $1', [
    resId,
    await cat.estado(completada ? 'COMPLETADA' : 'CONFIRMADA'),
    fecha,
  ]);
  const orden = await tx.one<{ ord_id: string }>('SELECT dt.ord_id::text FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id WHERE r.res_id = $1', [resId]);
  await tx.query(
    `UPDATE pago SET est_id = $2, pag_aprobado_en = $3, pag_referencia = COALESCE(pag_referencia, 'MANUAL-' || pag_id)
      WHERE ord_id = $1 AND pag_aprobado_en IS NULL`,
    [orden!.ord_id, await cat.estado('APROBADO'), fecha],
  );
  await tx.query('UPDATE orden SET est_id = $2 WHERE ord_id = $1', [orden!.ord_id, await cat.estado('PAGADA')]);
  await emitirFactura(tx, cat, orden!.ord_id, fecha);
  await emitirEventoReserva(tx, EVENTOS.PAGO_APROBADO, resId, { verified_manually: true });
  await emitirEventoReserva(tx, EVENTOS.RESERVA_CONFIRMADA, resId);
}
