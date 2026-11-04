import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { correlacionActual } from './comun/correlacion';
import { DbService } from './comun/db.service';
import { hora12, parseHora, slotId } from './comun/tiempo';

export type MotivoStock = 'VENTA' | 'CANCELACION' | 'AFORO';

interface StockUpdateAck {
  success: boolean;
  message: string;
  processed_at: string;
  /** OK · STALE_TIMESTAMP_IGNORED · ITEM_NOT_FOUND · INVALID_SLOT (inventory.proto de Booking, semana 9) */
  error_code?: string;
  current_available?: number;
}

type ClienteBooking = grpc.Client & {
  PushStockUpdate(msg: Record<string, unknown>, meta: grpc.Metadata, opts: grpc.CallOptions, cb: (err: grpc.ServiceError | null, ack?: StockUpdateAck) => void): void;
};

const DEADLINE_MS = 3000;
const MAX_INTENTOS = 10;

/**
 * Stock a Booking Prototipo por gRPC (`inventory.InventoryStockService/PushStockUpdate`, contrato v2 §2.1,
 * criterio excluyente CE01). Mismo comportamiento que tenía la tienda:
 * - Se envía DESPUÉS de confirmar el cambio y nunca retrasa ni hace fallar la reserva.
 * - Cada envío queda en `sync_stock`; lo que falla se reintenta (hasta 10 veces) y, si llega un valor
 *   más nuevo del mismo turno, el anterior se descarta: solo importa el último.
 * - Cliente propio (no comun/grpc): a Booking NO se le manda el token interno entre servicios.
 */
@Injectable()
export class StockBooking {
  private readonly logger = new Logger('StockBooking');
  private cliente: ClienteBooking | null = null;

  constructor(private readonly db: DbService) {}

  get destino(): string {
    return (process.env.BOOKING_GRPC_URL ?? 'rda1-backend-integracion-sistemas.onrender.com:50051').replace(/^grpcs?:\/\//, '');
  }

  get habilitado(): boolean {
    const v = process.env.BOOKING_GRPC_ENABLED;
    return v ? v === 'true' : process.env.NODE_ENV !== 'test';
  }

  /** TLS en internet; h2c en redes privadas, Docker, local o Tailscale (100.64.0.0/10, *.ts.net). */
  get tls(): boolean {
    const v = process.env.BOOKING_GRPC_TLS;
    if (v) return v === 'true';
    const host = this.destino.replace(/:\d+$/, '');
    return !/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|[a-z0-9-]+$)/i.test(host)
      && !/\.ts\.net$/i.test(host);
  }

  get serviceId(): string {
    return process.env.BOOKING_SERVICE_ID ?? 'NODE_ATR_DILAN';
  }

  private obtenerCliente(): ClienteBooking {
    if (this.cliente) return this.cliente;
    const archivo = [join(__dirname, '..', '..', 'proto', 'inventory.proto'), join(process.cwd(), '..', 'proto', 'inventory.proto')].find(existsSync)!;
    const def = protoLoader.loadSync(archivo, { keepCase: true, longs: String, defaults: true });
    const paquete = grpc.loadPackageDefinition(def) as unknown as {
      inventory: { InventoryStockService: new (dir: string, cred: grpc.ChannelCredentials) => ClienteBooking };
    };
    this.cliente = new paquete.inventory.InventoryStockService(this.destino, this.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure());
    return this.cliente;
  }

  /** Registra el envío y lo manda sin esperar (la respuesta al cliente no depende de Booking). */
  publicar(t: { atrUuid: string; fecha: string; hora: string; disponibles: number }, motivo: MotivoStock): void {
    if (!this.habilitado) return;
    setImmediate(() => void this.enviarTurno(t, motivo).catch((e: Error) => this.logger.warn(`No se pudo publicar el stock: ${e.message}`)));
  }

  async enviarTurno(t: { atrUuid: string; fecha: string; hora: string; disponibles: number }, motivo: MotivoStock): Promise<void> {
    const turno = hora12(t.hora);
    const fila = await this.db.one<{ id: string }>(
      `INSERT INTO sync_stock (ss_item_id, ss_fecha, ss_turno, ss_disponibles, ss_motivo, ss_correlacion)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ss_id::text AS id`,
      [t.atrUuid, t.fecha, turno, t.disponibles, motivo, correlacionActual() ?? null],
    );
    await this.db.query(
      `UPDATE sync_stock SET ss_estado = 'DESCARTADO'
        WHERE ss_estado IN ('PENDIENTE', 'ERROR') AND ss_item_id = $1 AND ss_fecha = $2 AND ss_turno = $3 AND ss_id < $4`,
      [t.atrUuid, t.fecha, turno, fila!.id],
    );
    if (await this.intentar(fila!.id)) await this.reintentarPendientes(10);
  }

  async reintentarPendientes(limite = 50): Promise<number> {
    const pendientes = await this.db.query<{ id: string }>(
      `SELECT ss_id::text AS id FROM sync_stock
        WHERE ss_estado IN ('PENDIENTE', 'ERROR') AND ss_intentos < $1 AND ss_creado_en < now() - interval '5 seconds'
        ORDER BY ss_id LIMIT $2`,
      [MAX_INTENTOS, limite],
    );
    let enviados = 0;
    for (const p of pendientes) if (await this.intentar(p.id)) enviados++;
    return enviados;
  }

  private async intentar(id: string): Promise<boolean> {
    const f = await this.db.one<{ item: string; fecha: string; turno: string; disponibles: number; creado_ms: string }>(
      `SELECT ss_item_id::text AS item, to_char(ss_fecha, 'YYYY-MM-DD') AS fecha, ss_turno AS turno, ss_disponibles AS disponibles,
              (extract(epoch FROM ss_creado_en) * 1000)::bigint::text AS creado_ms
         FROM sync_stock WHERE ss_id = $1`,
      [id],
    );
    if (!f) return false;
    const inicio = Date.now();
    try {
      const ack = await this.push({
        service_id: this.serviceId,
        item_id: f.item,
        date: f.fecha,
        time_slot: f.turno,
        available_units: f.disponibles,
        // Momento del cambio (no del reintento): Booking descarta lo que llegue con un timestamp menor al último
        timestamp: f.creado_ms,
        slot_id: slotId(f.fecha, parseHora(f.turno) ?? f.turno),
      });
      const ok = ack.success !== false;
      const obsoleto = !ok && ack.error_code === 'STALE_TIMESTAMP_IGNORED';
      const estado = ok ? 'ENVIADO' : obsoleto ? 'DESCARTADO' : 'ERROR';
      const detalle = [ack.error_code && ack.error_code !== 'OK' ? ack.error_code : null, ack.message || (ok ? 'OK' : 'Rechazado por Booking'),
        ack.current_available != null ? `Booking: ${ack.current_available} cupos` : null].filter(Boolean).join(' · ');
      await this.db.query(
        `UPDATE sync_stock SET ss_estado = $2::varchar, ss_intentos = ss_intentos + 1, ss_latencia_ms = $3, ss_respuesta = $4,
                ss_enviado_en = CASE WHEN $2::varchar = 'ENVIADO' THEN now() ELSE ss_enviado_en END WHERE ss_id = $1`,
        [id, estado, Date.now() - inicio, detalle.slice(0, 300)],
      );
      return ok || obsoleto;
    } catch (e) {
      const err = e as grpc.ServiceError;
      const detalle = `${grpc.status[err.code] ?? 'ERROR'}: ${err.details || err.message}`;
      await this.db.query(`UPDATE sync_stock SET ss_estado = 'ERROR', ss_intentos = ss_intentos + 1, ss_latencia_ms = $2, ss_respuesta = $3 WHERE ss_id = $1`, [
        id, Date.now() - inicio, detalle.slice(0, 300),
      ]);
      this.logger.warn(`PushStockUpdate a ${this.destino} falló: ${detalle}`);
      return false;
    }
  }

  private push(msg: Record<string, unknown>): Promise<StockUpdateAck> {
    const cliente = this.obtenerCliente();
    return new Promise((ok, mal) => {
      const meta = new grpc.Metadata();
      const cid = correlacionActual();
      if (cid) meta.set('x-correlation-id', cid);
      cliente.PushStockUpdate(msg, meta, { deadline: new Date(Date.now() + DEADLINE_MS) }, (err, ack) =>
        err ? mal(err) : ok(ack ?? { success: true, message: '', processed_at: '0' }),
      );
    });
  }

  async resumen() {
    const totales = await this.db.one(
      `SELECT COUNT(*) FILTER (WHERE ss_estado = 'ENVIADO')::int AS enviados, COUNT(*) FILTER (WHERE ss_estado = 'ERROR')::int AS errores,
              COUNT(*) FILTER (WHERE ss_estado = 'PENDIENTE')::int AS pendientes, COUNT(*) FILTER (WHERE ss_estado = 'DESCARTADO')::int AS descartados,
              MAX(ss_enviado_en) AS ultimo_ok
         FROM sync_stock WHERE ss_creado_en >= now() - interval '24 hours'`,
    );
    const recientes = await this.db.query(
      `SELECT ss_id::int AS id, ss_item_id::text AS item_id, to_char(ss_fecha, 'YYYY-MM-DD') AS date, ss_turno AS time_slot,
              ss_disponibles AS available_units, ss_motivo AS reason, ss_estado AS status, ss_intentos AS attempts,
              ss_latencia_ms AS latency_ms, ss_respuesta AS response, ss_creado_en AS created_at
         FROM sync_stock ORDER BY ss_id DESC LIMIT 15`,
    );
    return { enabled: this.habilitado, target: this.destino, tls: this.tls, service_id: this.serviceId, ...totales, recent: recientes };
  }
}
