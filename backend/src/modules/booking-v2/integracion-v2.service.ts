import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../../common/db/db.service';
import { EVENTOS } from '../../common/db/eventos';
import { limpiar } from '../../common/observabilidad/metricas-http';
import { API_VERSION } from '../../config/version';
import { hoyEc } from '../atracciones/utils/fechas';
import { ActualizarPromocionesContratoRequest, EventosQueryV2, TIPOS_EVENTO_V2 } from './dto';

/** Evento interno (AsyncAPI v1) → event_type del contrato v2. */
const A_V2: Record<string, (typeof TIPOS_EVENTO_V2)[number]> = {
  [EVENTOS.RESERVA_CREADA]: 'RESERVA_CREADA',
  [EVENTOS.RESERVA_CONFIRMADA]: 'RESERVA_CONFIRMADA',
  [EVENTOS.STOCK_ACTUALIZADO]: 'STOCK_ACTUALIZADO',
  [EVENTOS.RESERVA_CANCELADA]: 'RESERVA_CANCELADA',
};
const DE_V2 = Object.fromEntries(Object.entries(A_V2).map(([k, v]) => [v, k])) as Record<(typeof TIPOS_EVENTO_V2)[number], string>;

/** Latencia (ms) del chequeo interno para el semáforo del panel de Booking. */
const UMBRAL_VERDE = 200;
const UMBRAL_AMARILLO = 800;

@Injectable()
export class IntegracionV2Service {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  // ── Acuerdo B2B de promociones ──────────────────────────────────────────
  async promociones() {
    const a = await this.db.one<{
      permite: boolean;
      maximo: number;
      fecha: string;
      vigencia: string;
      condiciones: string | null;
      destinos: string[];
    }>(
      `SELECT apr_permite AS permite, apr_descuento_maximo::float8 AS maximo, to_char(apr_fecha_acuerdo, 'YYYY-MM-DD') AS fecha,
              to_char(apr_vigencia_hasta, 'YYYY-MM-DD') AS vigencia, apr_condiciones AS condiciones,
              COALESCE((SELECT array_agg(apd_destino ORDER BY apd_id) FROM acuerdo_promocion_destino d WHERE d.apr_id = p.apr_id), '{}') AS destinos
         FROM acuerdo_promocion p WHERE apr_id = 1`,
    );
    return {
      proveedor_id: this.config.get<string>('BOOKING_PROVEEDOR_ID') ?? 'proveedor-atracciones-dilan',
      nombre_comercial: 'Descubre EC',
      permite_promociones: a?.permite ?? false,
      porcentaje_descuento_maximo: a?.maximo ?? 0,
      destinos_habilitados: a?.destinos ?? [],
      fecha_acuerdo: a?.fecha ?? hoyEc(),
      vigencia_hasta: a?.vigencia ?? hoyEc(),
      ...(a?.condiciones ? { condiciones_combo: a.condiciones } : {}),
    };
  }

  /** Responde el cuestionario B2B (Consideraciones RDA2, pág. 149). Si no permite promociones, el descuento queda en 0. */
  async actualizarPromociones(dto: ActualizarPromocionesContratoRequest) {
    const maximo = dto.permite_promociones ? dto.porcentaje_descuento_maximo : 0;
    const destinos = [...new Set((dto.destinos_habilitados ?? []).map((d) => limpiar(d.trim(), 80)).filter(Boolean))];
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO acuerdo_promocion (apr_id, apr_permite, apr_descuento_maximo, apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones,
                                        apr_contacto_nombre, apr_contacto_correo, apr_contacto_telefono, apr_actualizado_en)
         VALUES (1, $1, $2, CURRENT_DATE, COALESCE($3::date, CURRENT_DATE + 365), $4, $5, $6, $7, now())
         ON CONFLICT (apr_id) DO UPDATE SET
           apr_permite = EXCLUDED.apr_permite, apr_descuento_maximo = EXCLUDED.apr_descuento_maximo,
           apr_fecha_acuerdo = CURRENT_DATE,
           apr_vigencia_hasta = COALESCE($3::date, acuerdo_promocion.apr_vigencia_hasta),
           apr_condiciones = COALESCE($4, acuerdo_promocion.apr_condiciones),
           apr_contacto_nombre = COALESCE($5, acuerdo_promocion.apr_contacto_nombre),
           apr_contacto_correo = COALESCE($6, acuerdo_promocion.apr_contacto_correo),
           apr_contacto_telefono = COALESCE($7, acuerdo_promocion.apr_contacto_telefono),
           apr_actualizado_en = now()`,
        [
          dto.permite_promociones, maximo, dto.vigencia_hasta?.slice(0, 10) ?? null, dto.condiciones_combo ?? null,
          dto.contacto_comercial?.nombre ?? null, dto.contacto_comercial?.email ?? null, dto.contacto_comercial?.telefono ?? null,
        ],
      );
      if (dto.destinos_habilitados) {
        await tx.query('DELETE FROM acuerdo_promocion_destino WHERE apr_id = 1');
        for (const d of destinos) await tx.query('INSERT INTO acuerdo_promocion_destino (apr_id, apd_destino) VALUES (1, $1)', [d]);
      }
    });
    return this.promociones();
  }

  // ── Feed de eventos (outbox) en el formato v2 ───────────────────────────
  async eventos(q: EventosQueryV2) {
    const tipos = q.type ? [DE_V2[q.type]] : Object.keys(A_V2);
    const filas = await this.db.query<{
      id: string;
      uuid: string;
      tipo: string;
      agregado: string;
      agregado_id: string;
      datos: Record<string, unknown>;
      creado: Date;
      correlacion: string | null;
    }>(
      `SELECT evt_id::text AS id, evt_uuid::text AS uuid, evt_tipo AS tipo, evt_agregado AS agregado, evt_agregado_id AS agregado_id,
              evt_datos AS datos, evt_creado_en AS creado, evt_correlacion AS correlacion
         FROM evento WHERE evt_id > $1 AND evt_tipo = ANY($2::text[]) ORDER BY evt_id LIMIT $3`,
      [q.after ?? 0, tipos, q.limit ?? 50],
    );
    // CloudEvents v1.0 (contrato final): specversion, source, y `data` como alias de `payload`
    return filas.map((e) => ({
      specversion: '1.0',
      source: '/api/v2/atracciones',
      event_id: e.uuid,
      sequence_number: Number(e.id),
      event_type: A_V2[e.tipo],
      // Reserva → su código PNR (DEC-XXXXXX); stock → la atracción
      aggregate_id: e.agregado === 'reserva' ? String(e.datos.code ?? e.agregado_id) : e.agregado_id,
      correlation_id: e.correlacion ?? `evt-${e.id}`,
      timestamp: new Date(e.creado).toISOString(),
      payload: e.datos,
      data: e.datos,
    }));
  }

  // ── Salud del nodo (semáforo 🟢🟡🔴 del panel de Booking) ────────────────
  async salud() {
    const t0 = Date.now();
    let conectada = true;
    if (this.config.get<string>('NODE_KILL_SWITCH') !== 'true') {
      try {
        await this.db.query('SELECT 1');
      } catch {
        conectada = false;
      }
    }
    const latencia = Date.now() - t0;
    const apagado = this.config.get<string>('NODE_KILL_SWITCH') === 'true';
    const status = apagado || !conectada ? 'DOWN' : latencia < UMBRAL_VERDE ? 'UP' : 'DEGRADED';
    const publica = (this.config.get<string>('PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return {
      status: status as 'UP' | 'DEGRADED' | 'DOWN',
      body: {
        status,
        node_id: this.config.get<string>('NODE_ID') ?? 'node-dilan-atracciones-01',
        node_code: this.config.get<string>('NODE_CODE') ?? 'DILAN_ATRACCIONES',
        url_base: `${publica}/api/v2`,
        version: API_VERSION,
        database_connected: conectada && !apagado,
        latency_ms: latencia,
        memory_usage_mb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        // Extensión: umbrales del semáforo
        thresholds_ms: { up_below: UMBRAL_VERDE, degraded_up_to: UMBRAL_AMARILLO },
      },
    };
  }
}
