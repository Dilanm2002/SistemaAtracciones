import { randomInt } from 'crypto';
import { QueryFailedError } from 'typeorm';
import { CatalogosService } from '../../common/db/catalogos.service';
import { Sql } from '../../common/db/db.service';
import { emitirEvento, emitirEventoReserva, EVENTOS } from '../../common/db/eventos';
import { CardInfoDto, PaymentMethod } from './dto/reservation.dto';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones al dictarlo
const MAX_INTENTOS = 5;

export const codigoAleatorio = (rnd: () => number = () => randomInt(ALFABETO.length) / ALFABETO.length) =>
  Array.from({ length: 6 }, () => ALFABETO[Math.floor(rnd() * ALFABETO.length)]).join('');

const esUnica = (e: unknown) => e instanceof QueryFailedError && (e as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505';

/** Método de pago: los de la web (v1) más la pasarela de Booking (contrato v2). */
export type MetodoCompra = PaymentMethod | 'SOA_BOOKING_GATEWAY';

export interface Acompanante {
  nombre: string;
  documento?: string | null;
  tipoBoleto: 'ADULT' | 'CHILD' | 'SENIOR' | 'STUDENT' | 'INFANT';
}

export interface DatosCompra {
  usuId: string;
  atrId: string;
  atrNombre: string;
  disId: string;
  fecha: string;
  hora: string;
  adultos: number;
  ninos: number;
  /** Adultos mayores (tarifa MAYOR) e infantes (tarifa $0, pero ocupan cupo) — contrato v2 */
  seniors?: number;
  infantes?: number;
  /** Estudiantes con carnet (tarifa ESTUDIANTE) — contrato v2 final */
  estudiantes?: number;
  precioAdulto: number;
  precioNino: number;
  precioSenior?: number;
  precioEstudiante?: number;
  moneda: string;
  metodo: MetodoCompra;
  /** WEB (este sitio) o BOOKING (contrato v2) */
  origen?: 'WEB' | 'BOOKING';
  sagaId?: string | null;
  /** Contrato v2: la reserva nace CONFIRMADA aunque el pago se haga en sitio o por transferencia */
  confirmarSiempre?: boolean;
  paxNombre: string;
  paxDocumento?: string | null;
  paxTipoDocumento?: 'CEDULA' | 'PASAPORTE' | 'RUC';
  acompanantes?: Acompanante[];
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
  const seniors = d.seniors ?? 0;
  const infantes = d.infantes ?? 0;
  const precioSenior = d.precioSenior ?? d.precioAdulto;
  const estudiantes = d.estudiantes ?? 0;
  const precioEstudiante = d.precioEstudiante ?? d.precioAdulto;
  // Cada producto ya tiene 2 decimales: la suma redondeada coincide con las líneas de la factura
  const cents = (n: number, p: number) => Math.round(n * p * 100);
  const total = (cents(d.adultos, d.precioAdulto) + cents(d.ninos, d.precioNino) + cents(seniors, precioSenior) + cents(estudiantes, precioEstudiante)) / 100;
  const tickets = d.adultos + d.ninos + seniors + infantes + estudiantes;
  const pagada = d.metodo === PaymentMethod.TARJETA || d.metodo === 'SOA_BOOKING_GATEWAY';
  const confirmada = pagada || !!d.confirmarSiempre;
  const creado = d.creadoEn ?? new Date();
  const [estOrden, estPago, estReserva, mpa] = await Promise.all([
    cat.estado(pagada ? 'PAGADA' : 'CREADA'),
    cat.estado(pagada ? 'APROBADO' : 'PENDIENTE'),
    cat.estado(confirmada ? (d.completada ? 'COMPLETADA' : 'CONFIRMADA') : 'PENDIENTE_PAGO'),
    cat.metodoPago(d.metodo as PaymentMethod),
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
                              res_precio_unitario, res_subtotal, res_observaciones, res_creado_en, res_confirmado_en,
                              res_seniors, res_infantes, res_precio_nino, res_precio_senior, res_origen, res_saga_id,
                              res_estudiantes, res_precio_estudiante)
         VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING res_id::text, res_uuid::text`,
        [
          `DEC-${sufijo}`, det!.det_id, d.disId, estReserva, d.fecha, d.hora, d.adultos, d.ninos, tickets,
          d.precioAdulto, total, d.notas ?? null, creado, confirmada ? creado : null,
          seniors, infantes, d.precioNino, seniors ? precioSenior : null, d.origen ?? 'WEB', d.sagaId ?? null,
          estudiantes, estudiantes ? precioEstudiante : null,
        ],
      );
      await tx.query(
        `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_documento, pax_tipo_documento, pax_correo, pax_telefono, pax_es_titular, pax_tipo_boleto)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'ADULT')`,
        [res!.res_id, d.paxNombre.slice(0, 120), d.paxDocumento || null, d.paxTipoDocumento ?? 'CEDULA', d.paxCorreo || null, d.paxTelefono || null],
      );
      for (const p of d.acompanantes ?? []) {
        // Documento del acompañante: solo una cédula válida o un pasaporte; si no, se guarda sin documento
        await tx.query(
          `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_documento, pax_tipo_documento, pax_es_titular, pax_tipo_boleto)
           VALUES ($1, $2,
                   CASE WHEN $3::text IS NULL THEN NULL WHEN fn_cedula_ec_valida($3) OR $3 ~ '^[A-Z0-9]{6,9}$' THEN $3 END,
                   CASE WHEN $3::text IS NOT NULL AND fn_cedula_ec_valida($3) THEN 'CEDULA' ELSE 'PASAPORTE' END, FALSE, $4)`,
          [res!.res_id, p.nombre.slice(0, 120), p.documento ? p.documento.toUpperCase() : null, p.tipoBoleto],
        );
      }
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
      if (confirmada) await emitirEventoReserva(tx, EVENTOS.RESERVA_CONFIRMADA, res!.res_id);
      await emitirEventoStock(tx, d.disId, 'VENTA');
      await tx.query('RELEASE SAVEPOINT compra');
      return { resId: res!.res_id, uuid: res!.res_uuid };
    } catch (e) {
      await tx.query('ROLLBACK TO SAVEPOINT compra');
      if (!esUnica(e) || intento >= MAX_INTENTOS) throw e;
    }
  }
}

/**
 * Factura (SRI) de una orden pagada: encabezado (número 001-001-<ord_id> y totales de la orden)
 * y su detalle, una línea por tipo de pasajero, congelado en factura_detalle (migración 007).
 * Idempotente: si la orden ya tiene factura no se crea otra ni se duplican sus líneas.
 */
export async function emitirFactura(tx: Sql, cat: CatalogosService, ordId: string, fecha: Date = new Date()) {
  const fac = await tx.one<{ fac_id: string }>(
    `INSERT INTO factura (ord_id, fac_numero, est_id, fac_emitida_en, fac_subtotal, fac_iva, fac_total, fac_razon_social)
     SELECT o.ord_id, '001-001-' || lpad(o.ord_id::text, 9, '0'), $2, $3, o.ord_subtotal, o.ord_iva, o.ord_total,
            left(u.usu_nombre || ' ' || u.usu_apellido, 150)
       FROM orden o JOIN usuario u ON u.usu_id = o.usu_id WHERE o.ord_id = $1
     ON CONFLICT (ord_id) DO NOTHING
     RETURNING fac_id::text`,
    [ordId, await cat.estado('PAGADA_FAC'), fecha],
  );
  if (fac) await tx.query('SELECT factura_generar_detalle($1::bigint)', [fac.fac_id]);
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
  const dis = await tx.one<{ dis_id: string }>('SELECT dis_id::text FROM reserva WHERE res_id = $1', [resId]);
  if (dis) await emitirEventoStock(tx, dis.dis_id, 'CANCELACION');
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

/** Cupos libres de un turno (día + horario) en este momento; 0 si está cerrado o la fecha está bloqueada. */
export async function stockDeTurno(tx: Sql, disId: string) {
  return tx.one<{ dis_id: string; atr_uuid: string; fecha: string; hora: string; disponibles: number; total: number }>(
    `SELECT d.dis_id::text, a.atr_uuid::text, to_char(d.dis_fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hor_hora, 'HH24:MI') AS hora,
            CASE WHEN d.dis_cerrada OR EXISTS (SELECT 1 FROM fecha_bloqueada fb WHERE fb.atr_id = d.atr_id AND fb.fb_fecha = d.dis_fecha)
                 THEN 0 ELSE GREATEST(d.dis_cupo_total - d.dis_cupo_reservado, 0) END AS disponibles,
            d.dis_cupo_total AS total
       FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id JOIN atraccion a ON a.atr_id = d.atr_id
      WHERE d.dis_id = $1`,
    [disId],
  );
}

/** Evento STOCK_ACTUALIZADO (contrato v2) con los cupos que quedan en el turno. */
export async function emitirEventoStock(tx: Sql, disId: string, motivo: 'VENTA' | 'CANCELACION' | 'AFORO') {
  const s = await stockDeTurno(tx, disId);
  if (!s) return;
  await emitirEvento(tx, EVENTOS.STOCK_ACTUALIZADO, 'atraccion', s.atr_uuid, {
    attraction_id: s.atr_uuid,
    date: s.fecha,
    time: s.hora,
    available_units: s.disponibles,
    total_units: s.total,
    reason: motivo,
  });
}
