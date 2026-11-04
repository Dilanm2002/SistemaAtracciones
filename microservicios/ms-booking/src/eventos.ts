import { BadRequestException, Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { Equals, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { correlacionActual } from './comun/correlacion';
import { DbService, Sql } from './comun/db.service';
import { EventosQueryV2, TIPOS_EVENTO_V2 } from './dto';

/** Tipos internos (AsyncAPI v1, los mismos de la tienda) → event_type del contrato v2/v3. */
export const EVENTOS = {
  RESERVA_CREADA: 'atracciones.reserva.creada',
  RESERVA_CONFIRMADA: 'atracciones.reserva.confirmada',
  RESERVA_CANCELADA: 'atracciones.reserva.cancelada',
  RESERVA_CHECKIN: 'atracciones.reserva.checkin',
  PAGO_APROBADO: 'atracciones.pago.aprobado',
  PAGO_REEMBOLSADO: 'atracciones.pago.reembolsado',
  STOCK_ACTUALIZADO: 'atracciones.stock.actualizado',
} as const;

const A_V2: Record<string, (typeof TIPOS_EVENTO_V2)[number]> = {
  [EVENTOS.RESERVA_CREADA]: 'RESERVA_CREADA',
  [EVENTOS.RESERVA_CONFIRMADA]: 'RESERVA_CONFIRMADA',
  [EVENTOS.STOCK_ACTUALIZADO]: 'STOCK_ACTUALIZADO',
  [EVENTOS.RESERVA_CANCELADA]: 'RESERVA_CANCELADA',
};
const DE_V2 = Object.fromEntries(Object.entries(A_V2).map(([k, v]) => [v, k])) as Record<(typeof TIPOS_EVENTO_V2)[number], string>;

/** CloudEvent que publica ms_inventory (STOCK_ACTUALIZADO) a POST /api/v1/internal/eventos. */
export class EventoEntrante {
  @Equals('1.0') specversion: string;
  @IsUUID() event_id: string;
  @IsIn(['STOCK_ACTUALIZADO']) event_type: 'STOCK_ACTUALIZADO';
  @IsString() @MaxLength(100) source: string;
  @IsOptional() @IsString() @MaxLength(100) correlation_id?: string;
  @IsISO8601() timestamp: string;
  @IsObject() @Type(() => Object) data: Record<string, unknown>;
}

@Injectable()
export class EventosService {
  constructor(private readonly db: DbService) {}

  /** Evento de una reserva con sus datos públicos (sin nombre, documento ni correo), en la transacción `tx`. */
  async reserva(tx: Sql, tipo: string, resId: string, extra: Record<string, unknown> = {}) {
    await tx.query(
      `INSERT INTO evento (evt_tipo, evt_agregado, evt_agregado_id, evt_datos, evt_correlacion)
       SELECT $1, 'reserva', r.res_uuid::text,
              jsonb_build_object(
                'reservation_id', r.res_uuid, 'code', r.res_codigo, 'status', e.est_codigo, 'attraction_id', r.atr_uuid,
                'date', to_char(r.res_fecha, 'YYYY-MM-DD'), 'time', to_char(r.res_hora, 'HH24:MI'),
                'adults', r.res_adultos, 'children', r.res_ninos, 'seniors', r.res_seniors, 'infants', r.res_infantes,
                'students', r.res_estudiantes, 'ticket_count', r.res_numero_tickets, 'origin', r.res_origen, 'saga_id', r.res_saga_id,
                'total', jsonb_build_object('currency', r.res_moneda, 'total', r.res_subtotal),
                'payment_method', r.res_metodo_pago, 'order_number', r.ord_numero) || $3::jsonb,
              $4
         FROM reserva r JOIN estado e ON e.est_id = r.est_id WHERE r.res_id = $2`,
      [tipo, resId, JSON.stringify(extra), correlacionActual() ?? null],
    );
  }

  /** STOCK_ACTUALIZADO de ms_inventory. Idempotente por event_id (un reintento del outbox no se duplica). */
  async recibir(e: EventoEntrante) {
    const d = e.data;
    if (typeof d.attraction_id !== 'string' || typeof d.date !== 'string' || typeof d.available_units !== 'number') {
      throw new BadRequestException('data debe traer attraction_id, date, time y available_units.');
    }
    const r = await this.db.one(
      `INSERT INTO evento (evt_uuid, evt_tipo, evt_agregado, evt_agregado_id, evt_datos, evt_correlacion, evt_creado_en)
       VALUES ($1, $2, 'atraccion', $3, $4, $5, $6) ON CONFLICT (evt_uuid) DO NOTHING RETURNING evt_id`,
      [e.event_id, EVENTOS.STOCK_ACTUALIZADO, d.attraction_id, JSON.stringify(d), e.correlation_id ?? null, e.timestamp],
    );
    return { procesado: !!r };
  }

  /** Feed CloudEvents 1.0 del contrato (mismo formato que la tienda; sequence_number = evt_id). */
  async feed(q: EventosQueryV2) {
    const tipos = q.type ? [DE_V2[q.type]] : Object.keys(A_V2);
    const filas = await this.db.query<{ id: string; uuid: string; tipo: string; agregado: string; agregado_id: string; datos: Record<string, unknown>; creado: Date; correlacion: string | null }>(
      `SELECT evt_id::text AS id, evt_uuid::text AS uuid, evt_tipo AS tipo, evt_agregado AS agregado, evt_agregado_id AS agregado_id,
              evt_datos AS datos, evt_creado_en AS creado, evt_correlacion AS correlacion
         FROM evento WHERE evt_id > $1 AND evt_tipo = ANY($2::text[]) ORDER BY evt_id LIMIT $3`,
      [q.after ?? 0, tipos, q.limit ?? 50],
    );
    return filas.map((e) => ({
      specversion: '1.0',
      source: '/api/v2/atracciones',
      event_id: e.uuid,
      sequence_number: Number(e.id),
      event_type: A_V2[e.tipo],
      aggregate_id: e.agregado === 'reserva' ? String(e.datos.code ?? e.agregado_id) : e.agregado_id,
      correlation_id: e.correlacion ?? `evt-${e.id}`,
      timestamp: new Date(e.creado).toISOString(),
      payload: e.datos,
      data: e.datos,
    }));
  }
}
