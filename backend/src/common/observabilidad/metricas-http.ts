import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { API_VERSION } from '../../config/version';
import { contextoActual } from './contexto';

/**
 * Métricas HTTP y registro de incidentes que sobreviven a las instancias serverless.
 *
 * Cada petición suma en un búfer en memoria (por minuto, método, ruta y estado). El búfer se
 * vuelca a `ops.metrica_http` con un UPSERT cada FLUSH_MS o cuando crece demasiado; varias
 * instancias suman sobre la misma fila. Los incidentes se guardan al momento. Nada de esto
 * bloquea la respuesta: si la base falla, la métrica se pierde y la petición sigue igual.
 */

/** Límites superiores (ms) de las cubetas del histograma; la última cubeta es "más que eso". */
export const CUBETAS = [100, 250, 500, 1000, 2500] as const;

interface Acumulado {
  minuto: string;
  metodo: string;
  ruta: string;
  estado: number;
  total: number;
  sumaMs: number;
  maxMs: number;
  dbMs: number;
  cubetas: number[];
}

const FLUSH_MS = 15_000;
const MAX_CLAVES = 200;
const RETENCION_CADA_MS = 6 * 3_600_000;

let ds: DataSource | null = null;
const bufer = new Map<string, Acumulado>();
let ultimoFlush = Date.now();
let ultimaLimpieza = 0;
let enCurso: Promise<void> | null = null;

/** Conecta el registro con la base (lo llama createApp una vez que Nest inició). */
export function iniciarObservabilidad(dataSource: DataSource) {
  ds = dataSource;
}

/** Vercel (fluid compute): mantiene viva la función hasta terminar `p`, después de responder. */
export function despuesDeResponder(p: Promise<unknown>) {
  const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[
    Symbol.for('@vercel/request-context')
  ];
  ctx?.get?.()?.waitUntil?.(p.catch(() => undefined));
}

/**
 * Ruta para agrupar: la plantilla de Express (`/atracciones/:id`) sin el prefijo `/api/v1`.
 * Sin plantilla (404, archivos estáticos) se reemplazan los ids por `:id` para no crear una
 * fila por cada URL distinta.
 */
export function rutaAgrupada(plantilla: string | undefined, path: string): string {
  if (plantilla) return plantilla.replace(/^\/api\/v1(?=\/|$)/, '').replace(/^\/api\/(v\d+)(?=\/|$)/, '/$1') || '/';
  if (/^\/(img|uploads|vendor)\//.test(path)) return `/${path.split('/')[1]}/*`;
  return '(sin ruta)';
}

export function registrarPeticion(metodo: string, ruta: string, estado: number, ms: number, dbMs = 0, ahora = new Date()) {
  const minuto = new Date(Math.floor(ahora.getTime() / 60_000) * 60_000).toISOString();
  const clave = `${minuto}|${metodo}|${ruta}|${estado}`;
  let a = bufer.get(clave);
  if (!a) {
    a = { minuto, metodo, ruta: ruta.slice(0, 120), estado, total: 0, sumaMs: 0, maxMs: 0, dbMs: 0, cubetas: CUBETAS.map(() => 0) };
    bufer.set(clave, a);
  }
  a.total++;
  a.sumaMs += ms;
  a.maxMs = Math.max(a.maxMs, ms);
  a.dbMs += dbMs;
  const i = CUBETAS.findIndex((limite) => ms <= limite);
  if (i >= 0) a.cubetas[i]++;
  if (bufer.size >= MAX_CLAVES || Date.now() - ultimoFlush >= FLUSH_MS) despuesDeResponder(volcarMetricas());
}

/** Escribe el búfer en ops.metrica_http (y cada 6 h borra lo que superó la retención). */
export function volcarMetricas(): Promise<void> {
  if (enCurso) return enCurso;
  if (!ds || !bufer.size) return Promise.resolve();
  const filas = [...bufer.values()];
  bufer.clear();
  ultimoFlush = Date.now();
  const valores: unknown[] = [];
  const tuplas = filas.map((f, i) => {
    valores.push(f.minuto, f.metodo, f.ruta, f.estado, f.total, Math.round(f.sumaMs), Math.round(f.maxMs), Math.round(f.dbMs), ...f.cubetas);
    const b = i * 13;
    return `(${Array.from({ length: 13 }, (_, k) => `$${b + k + 1}`).join(', ')})`;
  });
  enCurso = (async () => {
    try {
      await ds!.query(
        `INSERT INTO ops.metrica_http (mh_minuto, mh_metodo, mh_ruta, mh_estado, mh_total, mh_suma_ms, mh_max_ms, mh_db_ms,
                                       mh_c100, mh_c250, mh_c500, mh_c1000, mh_c2500)
         VALUES ${tuplas.join(', ')}
         ON CONFLICT (mh_minuto, mh_metodo, mh_ruta, mh_estado) DO UPDATE SET
           mh_total = ops.metrica_http.mh_total + EXCLUDED.mh_total,
           mh_suma_ms = ops.metrica_http.mh_suma_ms + EXCLUDED.mh_suma_ms,
           mh_max_ms = GREATEST(ops.metrica_http.mh_max_ms, EXCLUDED.mh_max_ms),
           mh_db_ms = ops.metrica_http.mh_db_ms + EXCLUDED.mh_db_ms,
           mh_c100 = ops.metrica_http.mh_c100 + EXCLUDED.mh_c100,
           mh_c250 = ops.metrica_http.mh_c250 + EXCLUDED.mh_c250,
           mh_c500 = ops.metrica_http.mh_c500 + EXCLUDED.mh_c500,
           mh_c1000 = ops.metrica_http.mh_c1000 + EXCLUDED.mh_c1000,
           mh_c2500 = ops.metrica_http.mh_c2500 + EXCLUDED.mh_c2500`,
        valores,
      );
      if (Date.now() - ultimaLimpieza > RETENCION_CADA_MS) {
        ultimaLimpieza = Date.now();
        await ds!.query(
          `DELETE FROM ops.metrica_http WHERE mh_minuto < now() - interval '30 days';
           DELETE FROM ops.web_vital WHERE wv_medido_en < now() - interval '30 days';
           DELETE FROM ops.incidente WHERE inc_ocurrido_en < now() - interval '90 days';`,
        );
      }
    } catch (e) {
      console.warn(JSON.stringify({ time: new Date().toISOString(), level: 'warn', msg: 'metricas: no se pudieron guardar', error: (e as Error).message }));
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

/**
 * Quita datos personales de un texto antes de guardarlo: correos, tokens (JWT), números largos
 * (cédulas, teléfonos, tarjetas) y query strings de las URL.
 */
export function limpiar(texto: string | null | undefined, max = 500): string {
  return String(texto ?? '')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/\d[\d\s-]{6,}\d/g, '[número]')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1')
    .slice(0, max);
}

/** Huella para agrupar el mismo error: los números e ids variables no la cambian. */
export function huella(tipo: string, mensaje: string, ruta?: string | null): string {
  const normal = `${tipo}|${mensaje.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':uuid').replace(/\d+/g, '0')}|${ruta ?? ''}`;
  return createHash('sha256').update(normal).digest('hex').slice(0, 16);
}

export interface Incidente {
  origen: 'api' | 'web';
  tipo: 'http_5xx' | 'excepcion' | 'promesa' | 'render' | 'api';
  mensaje: string;
  ruta?: string | null;
  metodo?: string | null;
  estado?: number | null;
  requestId?: string | null;
  traceId?: string | null;
  version?: string | null;
  navegador?: string | null;
  detalle?: string | null;
}

/** Guarda un incidente (sin esperar). Toma request_id y trace_id del contexto si no vienen. */
export function registrarIncidente(inc: Incidente): Promise<void> {
  if (!ds) return Promise.resolve();
  const ctx = contextoActual();
  const mensaje = limpiar(inc.mensaje) || '(sin mensaje)';
  const ruta = inc.ruta ? limpiar(inc.ruta, 200) : null;
  const p = ds
    .query(
      `INSERT INTO ops.incidente (inc_origen, inc_tipo, inc_huella, inc_mensaje, inc_ruta, inc_metodo, inc_estado, inc_request_id,
                                  inc_trace_id, inc_version, inc_navegador, inc_detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        inc.origen, inc.tipo, huella(inc.tipo, mensaje, ruta), mensaje, ruta, inc.metodo?.slice(0, 7) ?? null, inc.estado ?? null,
        (inc.requestId ?? ctx?.requestId ?? null)?.slice(0, 64) ?? null, (inc.traceId ?? ctx?.traceId ?? null)?.slice(0, 32) ?? null,
        (inc.version ?? (inc.origen === 'api' ? API_VERSION : null))?.slice(0, 20) ?? null, inc.navegador?.slice(0, 60) ?? null,
        inc.detalle ? limpiar(inc.detalle, 4000) : null,
      ],
    )
    .then(() => undefined)
    .catch((e: Error) => console.warn(JSON.stringify({ time: new Date().toISOString(), level: 'warn', msg: 'incidente: no se pudo guardar', error: e.message })));
  despuesDeResponder(p);
  return p;
}

/**
 * Percentil aproximado a partir del histograma (interpolación lineal dentro de la cubeta).
 * `cubetas` son los conteos NO acumulados de CUBETAS; lo que sobra hasta `total` está entre
 * 2500 ms y `maxMs`.
 */
export function percentil(p: number, total: number, cubetas: number[], maxMs: number): number | null {
  if (!total) return null;
  const objetivo = p * total;
  const limites = [...CUBETAS, Math.max(maxMs, CUBETAS[CUBETAS.length - 1])];
  const conteos = [...cubetas, Math.max(total - cubetas.reduce((a, b) => a + b, 0), 0)];
  let acumulado = 0;
  for (let i = 0; i < conteos.length; i++) {
    if (conteos[i] && acumulado + conteos[i] >= objetivo) {
      const desde = i === 0 ? 0 : limites[i - 1];
      const hasta = Math.min(limites[i], i === conteos.length - 1 ? maxMs : limites[i]);
      const v = desde + ((objetivo - acumulado) / conteos[i]) * (Math.max(hasta, desde) - desde);
      return Math.round(Math.min(v, maxMs || v));
    }
    acumulado += conteos[i];
  }
  return Math.round(maxMs);
}

/** Solo para pruebas: vacía el búfer. */
export const _reiniciarParaPruebas = () => {
  bufer.clear();
  ds = null;
};
export const _bufer = () => bufer;
