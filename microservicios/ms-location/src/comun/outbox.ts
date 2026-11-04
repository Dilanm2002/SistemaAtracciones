import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { correlacionActual } from './correlacion';
import { DbService, Sql } from './db.service';

/**
 * Outbox de eventos (CloudEvents 1.0 por REST a /api/v1/internal/eventos de otros servicios).
 * El evento se guarda en la tabla `evento` en la MISMA transacción del cambio y un despachador lo
 * envía cada 3 s, en orden, reintentando hasta 20 veces. Tabla: ver sql/002 de cada servicio.
 */
export interface ConfigOutbox {
  /** source del CloudEvent, p. ej. /api/v1/ms-pricing */
  source: string;
  /** Variable con los destinos separados por coma, y su valor por defecto */
  destinosVar: string;
  destinosPorDefecto: string;
}
export const CONFIG_OUTBOX = 'CONFIG_OUTBOX';

export async function registrarEvento(tx: Sql, tipo: string, datos: Record<string, unknown>) {
  await tx.query('INSERT INTO evento (evt_tipo, evt_datos, evt_correlacion) VALUES ($1, $2, $3)', [tipo, JSON.stringify(datos), correlacionActual() ?? null]);
}

@Injectable()
export class DespachadorEventos implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Eventos');
  private timer: NodeJS.Timeout | null = null;
  private ocupado = false;

  constructor(
    private readonly db: DbService,
    @Inject(CONFIG_OUTBOX) private readonly cfg: ConfigOutbox,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.despachar(), 3000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private get destinos(): string[] {
    return (process.env[this.cfg.destinosVar] ?? this.cfg.destinosPorDefecto).split(',').map((s) => s.trim()).filter(Boolean);
  }

  async reencolar(): Promise<{ reencolados: number }> {
    const r = await this.db.query('UPDATE evento SET evt_intentos = 0 WHERE evt_enviado_en IS NULL AND evt_intentos >= 20 RETURNING evt_id');
    return { reencolados: r.length };
  }

  /** Envía hasta 50 pendientes, en orden. Devuelve cuántos quedaron enviados. */
  async despachar(): Promise<number> {
    if (this.ocupado) return 0;
    this.ocupado = true;
    let enviados = 0;
    try {
      const pendientes = await this.db.query<{ id: string; tipo: string; datos: unknown; correlacion: string | null; creado: Date }>(
        `SELECT evt_id::text AS id, evt_tipo AS tipo, evt_datos AS datos, evt_correlacion AS correlacion, evt_creado_en AS creado
           FROM evento WHERE evt_enviado_en IS NULL AND evt_intentos < 20 ORDER BY evt_secuencia LIMIT 50`,
      );
      for (const e of pendientes) {
        const cuerpo = {
          specversion: '1.0', event_id: e.id, event_type: e.tipo, source: this.cfg.source,
          correlation_id: e.correlacion ?? e.id, timestamp: new Date(e.creado).toISOString(), data: e.datos,
        };
        try {
          for (const url of this.destinos) {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-servicio-token': process.env.SERVICIOS_TOKEN ?? '', 'x-correlation-id': cuerpo.correlation_id },
              body: JSON.stringify(cuerpo),
              signal: AbortSignal.timeout(3000),
            });
            if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
          }
          await this.db.query('UPDATE evento SET evt_enviado_en = now(), evt_intentos = evt_intentos + 1, evt_ultimo_error = NULL WHERE evt_id = $1', [e.id]);
          enviados++;
        } catch (err) {
          await this.db.query('UPDATE evento SET evt_intentos = evt_intentos + 1, evt_ultimo_error = $2 WHERE evt_id = $1', [e.id, (err as Error).message.slice(0, 300)]);
          this.logger.warn(`${e.tipo} ${e.id} no se pudo enviar: ${(err as Error).message}`);
          break; // en orden: no se adelanta un evento posterior
        }
      }
    } finally {
      this.ocupado = false;
    }
    return enviados;
  }
}

