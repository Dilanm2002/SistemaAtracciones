import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { DbService } from '../../common/db/db.service';
import { contextoActual, msDesde } from '../../common/observabilidad/contexto';
import { despuesDeResponder, limpiar } from '../../common/observabilidad/metricas-http';
import { stockDeTurno } from './compras';
import { hora12, parseHora } from './utils/hora12';

/** Motivo del envío (se guarda en ops.sync_stock para el panel de Observabilidad). */
export type MotivoStock = 'VENTA' | 'CANCELACION' | 'CHECKIN' | 'AFORO';

interface Turno {
  itemId: string;
  fecha: string;
  hora: string;
  disponibles: number;
}

interface StockUpdateAck {
  success: boolean;
  message: string;
  processed_at: string;
  /** OK · STALE_TIMESTAMP_IGNORED · ITEM_NOT_FOUND · INVALID_SLOT (inventory.proto de la semana 9) */
  error_code?: string;
  current_available?: number;
}

/** Clave canónica del turno: slot-AAAAMMDD-HHMM (la misma que devuelve la disponibilidad REST). */
export const slotId = (fecha: string, hora24: string) => `slot-${fecha.replace(/-/g, '')}-${hora24.replace(':', '')}`;

type ClienteInventario = grpc.Client & {
  PushStockUpdate(
    msg: Record<string, unknown>,
    meta: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, ack?: StockUpdateAck) => void,
  ): void;
};

const DEADLINE_MS = 3000;
const MAX_INTENTOS = 10;

/**
 * Sincronización de stock con Booking Prototipo por gRPC (contrato v2 §2.1, criterio excluyente CE01).
 *
 * Ante cada venta, cancelación o cambio de aforo se envía `PushStockUpdate` al servicio
 * `inventory.InventoryStockService` de Booking con los cupos que quedan en ese turno.
 * - El envío ocurre DESPUÉS de confirmar la transacción y nunca retrasa ni hace fallar la reserva.
 * - Cada envío queda en `ops.sync_stock` (estado, intentos, latencia y respuesta).
 * - Lo que falla se reintenta en el siguiente envío (hasta 10 veces); si llega un valor más nuevo del
 *   mismo turno, el anterior se descarta porque solo importa el último.
 */
@Injectable()
export class StockSyncService {
  private readonly logger = new Logger('StockSync');
  private cliente: ClienteInventario | null = null;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Destino gRPC de Booking. Guía de socios §3: rda1-backend-integracion-sistemas.onrender.com:50051 en la nube;
   * en la prueba local, la IP de Tailscale de Booking (p. ej. 100.x.y.z:50051) en BOOKING_GRPC_URL.
   */
  get destino(): string {
    return (this.config.get<string>('BOOKING_GRPC_URL') ?? 'rda1-backend-integracion-sistemas.onrender.com:50051').replace(/^grpcs?:\/\//, '');
  }

  get habilitado(): boolean {
    const v = this.config.get<string>('BOOKING_GRPC_ENABLED');
    return v ? v === 'true' : this.config.get<string>('NODE_ENV') !== 'test';
  }

  /**
   * TLS en producción pública; h2c (sin TLS) en red interna, Docker, local o Tailscale
   * (IP 100.64.0.0/10 o nombre *.ts.net), redes privadas 10/8, 172.16/12 y 192.168/16.
   */
  private get tls(): boolean {
    const v = this.config.get<string>('BOOKING_GRPC_TLS');
    if (v) return v === 'true';
    const host = this.destino.replace(/:\d+$/, '');
    return !/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|[a-z0-9-]+$)/i.test(host)
      && !/\.ts\.net$/i.test(host);
  }

  get serviceId(): string {
    return this.config.get<string>('BOOKING_SERVICE_ID') ?? 'NODE_ATR_DILAN';
  }

  private obtenerCliente(): ClienteInventario {
    if (this.cliente) return this.cliente;
    const def = protoLoader.loadSync(join(__dirname, '..', '..', 'proto', 'inventory.proto'), {
      keepCase: true,
      longs: String,
      defaults: true,
    });
    const paquete = grpc.loadPackageDefinition(def) as unknown as {
      inventory: { InventoryStockService: new (dir: string, cred: grpc.ChannelCredentials) => ClienteInventario };
    };
    this.cliente = new paquete.inventory.InventoryStockService(
      this.destino,
      this.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    );
    return this.cliente;
  }

  /** Publica el stock de un turno (día + horario) sin esperar: lo registra y lo envía tras responder. */
  publicar(disId: string | null | undefined, motivo: MotivoStock): void {
    if (!disId || !this.habilitado) return;
    despuesDeResponder(
      (async () => {
        const s = await stockDeTurno(this.db, disId);
        if (s) await this.enviarTurno({ itemId: s.atr_uuid, fecha: s.fecha, hora: s.hora, disponibles: s.disponibles }, motivo);
      })().catch((e: Error) => this.logger.warn(`No se pudo publicar el stock: ${e.message}`)),
    );
  }

  /** Publica todos los horarios de una atracción en una fecha (fechas bloqueadas o reabiertas). */
  publicarFecha(atrUuid: string, fecha: string, motivo: MotivoStock): void {
    if (!this.habilitado) return;
    despuesDeResponder(
      (async () => {
        const turnos = await this.db.query<{ hora: string; disponibles: number }>(
          `SELECT to_char(h.hor_hora, 'HH24:MI') AS hora,
                  CASE WHEN fb.fb_id IS NOT NULL OR COALESCE(d.dis_cerrada, FALSE) THEN 0
                       ELSE GREATEST(COALESCE(d.dis_cupo_total, h.hor_cupo) - COALESCE(d.dis_cupo_reservado, 0), 0) END AS disponibles
             FROM atraccion a JOIN horario h ON h.atr_id = a.atr_id AND h.hor_activo
             LEFT JOIN disponibilidad d ON d.atr_id = a.atr_id AND d.hor_id = h.hor_id AND d.dis_fecha = $2
             LEFT JOIN fecha_bloqueada fb ON fb.atr_id = a.atr_id AND fb.fb_fecha = $2
            WHERE a.atr_uuid = $1 ORDER BY h.hor_hora`,
          [atrUuid, fecha],
        );
        for (const t of turnos) await this.enviarTurno({ itemId: atrUuid, fecha, hora: t.hora, disponibles: t.disponibles }, motivo);
      })().catch((e: Error) => this.logger.warn(`No se pudo publicar el stock de la fecha: ${e.message}`)),
    );
  }

  /** Registra el envío en ops.sync_stock, lo manda y después reintenta los pendientes. */
  async enviarTurno(t: Turno, motivo: MotivoStock): Promise<void> {
    const fila = await this.db.one<{ id: string }>(
      `INSERT INTO ops.sync_stock (ss_item_id, ss_fecha, ss_turno, ss_disponibles, ss_motivo, ss_correlacion)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ss_id::text AS id`,
      [t.itemId, t.fecha, hora12(t.hora), t.disponibles, motivo, contextoActual()?.requestId ?? null],
    );
    // Solo importa el último valor de cada turno: los anteriores sin enviar se descartan
    await this.db.query(
      `UPDATE ops.sync_stock SET ss_estado = 'DESCARTADO'
        WHERE ss_estado IN ('PENDIENTE', 'ERROR') AND ss_item_id = $1 AND ss_fecha = $2 AND ss_turno = $3 AND ss_id < $4`,
      [t.itemId, t.fecha, hora12(t.hora), fila!.id],
    );
    const ok = await this.intentar(fila!.id);
    if (ok) await this.reintentarPendientes(10);
  }

  /** Reintenta los envíos pendientes o fallidos (más antiguos primero). Devuelve cuántos se enviaron. */
  async reintentarPendientes(limite = 50): Promise<number> {
    const pendientes = await this.db.query<{ id: string }>(
      `SELECT ss_id::text AS id FROM ops.sync_stock
        WHERE ss_estado IN ('PENDIENTE', 'ERROR') AND ss_intentos < $1 AND ss_creado_en < now() - interval '5 seconds'
        ORDER BY ss_id LIMIT $2`,
      [MAX_INTENTOS, limite],
    );
    let enviados = 0;
    for (const p of pendientes) if (await this.intentar(p.id)) enviados++;
    return enviados;
  }

  /** Un intento de PushStockUpdate para la fila `id`; actualiza su estado. */
  private async intentar(id: string): Promise<boolean> {
    const f = await this.db.one<{ item: string; fecha: string; turno: string; disponibles: number; creado_ms: string }>(
      `SELECT ss_item_id AS item, to_char(ss_fecha, 'YYYY-MM-DD') AS fecha, ss_turno AS turno, ss_disponibles AS disponibles,
              (extract(epoch FROM ss_creado_en) * 1000)::bigint::text AS creado_ms
         FROM ops.sync_stock WHERE ss_id = $1`,
      [id],
    );
    if (!f) return false;
    const inicio = process.hrtime.bigint();
    try {
      const hora24 = parseHora(f.turno) ?? f.turno;
      const ack = await this.push({
        service_id: this.serviceId,
        item_id: f.item,
        date: f.fecha,
        time_slot: f.turno,
        available_units: f.disponibles,
        // Momento del cambio (no del reintento): Booking descarta lo que llegue con un timestamp menor al último
        timestamp: f.creado_ms,
        slot_id: slotId(f.fecha, hora24),
      });
      const ok = ack.success !== false;
      // Un valor más nuevo del mismo turno ya llegó: no es un error ni se reintenta
      const obsoleto = !ok && ack.error_code === 'STALE_TIMESTAMP_IGNORED';
      const estado = ok ? 'ENVIADO' : obsoleto ? 'DESCARTADO' : 'ERROR';
      const detalle = [ack.error_code && ack.error_code !== 'OK' ? ack.error_code : null, ack.message || (ok ? 'OK' : 'Rechazado por Booking'),
        ack.current_available !== undefined && ack.current_available !== null ? `Booking: ${ack.current_available} cupos` : null]
        .filter(Boolean).join(' · ');
      await this.db.query(
        `UPDATE ops.sync_stock SET ss_estado = $2::varchar, ss_intentos = ss_intentos + 1, ss_latencia_ms = $3, ss_respuesta = $4,
                                   ss_enviado_en = CASE WHEN $2::varchar = 'ENVIADO' THEN now() ELSE ss_enviado_en END
          WHERE ss_id = $1`,
        [id, estado, Math.round(msDesde(inicio)), limpiar(detalle, 300)],
      );
      return ok || obsoleto;
    } catch (e) {
      const err = e as grpc.ServiceError;
      const detalle = `${grpc.status[err.code] ?? 'ERROR'}: ${err.details || err.message}`;
      await this.db.query(
        `UPDATE ops.sync_stock SET ss_estado = 'ERROR', ss_intentos = ss_intentos + 1, ss_latencia_ms = $2, ss_respuesta = $3 WHERE ss_id = $1`,
        [id, Math.round(msDesde(inicio)), limpiar(detalle, 300)],
      );
      this.logger.warn(`PushStockUpdate a ${this.destino} falló: ${detalle}`);
      return false;
    }
  }

  private push(msg: Record<string, unknown>): Promise<StockUpdateAck> {
    const cliente = this.obtenerCliente();
    return new Promise((resolve, reject) => {
      const meta = new grpc.Metadata();
      const cid = contextoActual()?.requestId;
      if (cid) meta.set('x-correlation-id', cid);
      cliente.PushStockUpdate(msg, meta, { deadline: new Date(Date.now() + DEADLINE_MS) }, (err, ack) =>
        err ? reject(err) : resolve(ack ?? { success: true, message: '', processed_at: '0' }),
      );
    });
  }

  /** Resumen para el panel de Observabilidad. */
  async resumen(ventana: string) {
    const [totales, ultimos] = await Promise.all([
      this.db.one<{ enviados: number; errores: number; pendientes: number; descartados: number; latencia_p95: number | null; ultimo_ok: Date | null }>(
        `SELECT COUNT(*) FILTER (WHERE ss_estado = 'ENVIADO')::int AS enviados,
                COUNT(*) FILTER (WHERE ss_estado = 'ERROR')::int AS errores,
                COUNT(*) FILTER (WHERE ss_estado = 'PENDIENTE')::int AS pendientes,
                COUNT(*) FILTER (WHERE ss_estado = 'DESCARTADO')::int AS descartados,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY ss_latencia_ms) FILTER (WHERE ss_estado = 'ENVIADO')::float8 AS latencia_p95,
                MAX(ss_enviado_en) AS ultimo_ok
           FROM ops.sync_stock WHERE ss_creado_en >= now() - $1::interval`,
        [ventana],
      ),
      this.db.query(
        `SELECT ss_id::text AS id, ss_creado_en AS created_at, ss_item_id AS item_id, to_char(ss_fecha, 'YYYY-MM-DD') AS date,
                ss_turno AS time_slot, ss_disponibles AS available_units, ss_motivo AS reason, ss_estado AS status,
                ss_intentos AS attempts, ss_latencia_ms AS latency_ms, ss_respuesta AS response, ss_correlacion AS correlation_id
           FROM ops.sync_stock ORDER BY ss_id DESC LIMIT 15`,
      ),
    ]);
    return { enabled: this.habilitado, target: this.destino, tls: this.tls, service_id: this.serviceId, ...totales, recent: ultimos };
  }
}
