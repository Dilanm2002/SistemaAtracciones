import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { limpiar, percentil, registrarIncidente, volcarMetricas } from '../../common/observabilidad/metricas-http';
import { API_VERSION } from '../../config/version';
import { leerMigraciones } from '../../database/migrator';
import { SenalWebDto, VITALES } from './dto/telemetria.dto';

/** Rango del panel → ventana y tamaño de cada barra de la serie. */
const RANGOS = {
  '1h': { ventana: '1 hour', paso: '5 minutes' },
  '24h': { ventana: '24 hours', paso: '1 hour' },
  '7d': { ventana: '7 days', paso: '6 hours' },
} as const;

/** Objetivos de servicio (SLO) que muestra el panel y vigila el monitor (docs/OBSERVABILIDAD.md). */
export const SLO = { disponibilidad: 0.995, p95Ms: 1000 } as const;

/** Umbrales de Google para Core Web Vitals (bueno ≤ primero; malo > segundo), medidos en el p75. */
export const UMBRALES_VITALES: Record<(typeof VITALES)[number], [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export const calificar = (nombre: (typeof VITALES)[number], v: number) => {
  const [bueno, malo] = UMBRALES_VITALES[nombre];
  return v <= bueno ? 'good' : v > malo ? 'poor' : 'needs-improvement';
};

interface FilaHistograma {
  total: number;
  e5: number;
  e4: number;
  suma: number;
  max: number;
  db: number;
  c100: number;
  c250: number;
  c500: number;
  c1000: number;
  c2500: number;
}

const COLUMNAS_HISTOGRAMA = `
  COALESCE(SUM(m.mh_total), 0)::int AS total,
  COALESCE(SUM(m.mh_total) FILTER (WHERE m.mh_estado >= 500), 0)::int AS e5,
  COALESCE(SUM(m.mh_total) FILTER (WHERE m.mh_estado BETWEEN 400 AND 499), 0)::int AS e4,
  COALESCE(SUM(m.mh_suma_ms), 0)::float8 AS suma, COALESCE(MAX(m.mh_max_ms), 0)::int AS max,
  COALESCE(SUM(m.mh_db_ms), 0)::float8 AS db,
  COALESCE(SUM(m.mh_c100), 0)::int AS c100, COALESCE(SUM(m.mh_c250), 0)::int AS c250, COALESCE(SUM(m.mh_c500), 0)::int AS c500,
  COALESCE(SUM(m.mh_c1000), 0)::int AS c1000, COALESCE(SUM(m.mh_c2500), 0)::int AS c2500`;

/** Latencias y tasas de una fila agregada del histograma. */
function latencias(f: FilaHistograma) {
  const cubetas = [f.c100, f.c250, f.c500, f.c1000, f.c2500];
  return {
    requests: f.total,
    errors_5xx: f.e5,
    errors_4xx: f.e4,
    error_rate: f.total ? f.e5 / f.total : 0,
    avg_ms: f.total ? Math.round(f.suma / f.total) : null,
    db_avg_ms: f.total ? Math.round(f.db / f.total) : null,
    p50_ms: percentil(0.5, f.total, cubetas, f.max),
    p95_ms: percentil(0.95, f.total, cubetas, f.max),
    p99_ms: percentil(0.99, f.total, cubetas, f.max),
    max_ms: f.total ? f.max : null,
  };
}

const inicioInstancia = new Date();

@Injectable()
export class ObservabilidadService {
  constructor(private readonly db: DbService) {}

  /** Liveness: el proceso responde (no toca la base). */
  vivo() {
    return { status: 'UP', version: API_VERSION, uptime_s: Math.round(process.uptime()) };
  }

  /** Readiness: la base responde y no hay migraciones pendientes. */
  async listo() {
    const t0 = Date.now();
    const checks: Record<string, { status: 'UP' | 'DOWN'; [k: string]: unknown }> = {};
    try {
      const aplicadas = await this.db.query<{ nombre: string }>('SELECT mig_nombre AS nombre FROM ops.migracion');
      checks.database = { status: 'UP', latency_ms: Date.now() - t0 };
      let pendientes: string[] | null = null;
      try {
        const hechas = new Set(aplicadas.map((m) => m.nombre));
        pendientes = leerMigraciones().map((m) => m.nombre).filter((n) => !hechas.has(n));
      } catch {
        pendientes = null; // el bundle no incluye los .sql: no se puede comparar
      }
      checks.migrations = pendientes === null
        ? { status: 'UP', applied: aplicadas.length, pending: 'desconocido' }
        : { status: pendientes.length ? 'DOWN' : 'UP', applied: aplicadas.length, pending: pendientes };
    } catch (e) {
      checks.database = { status: 'DOWN', error: limpiar((e as Error).message, 200) };
    }
    const ok = Object.values(checks).every((c) => c.status === 'UP');
    return { ok, cuerpo: { status: ok ? 'UP' : 'DOWN', version: API_VERSION, checks } };
  }

  /** Guarda lo que envía la web: errores como incidentes y Web Vitals como mediciones. */
  async telemetria(senales: SenalWebDto[]) {
    const vitales = senales.filter((s) => s.clase === 'vital' && s.nombre && s.valor != null && s.dispositivo);
    for (const s of senales.filter((x) => x.clase === 'error' && x.mensaje)) {
      await registrarIncidente({
        origen: 'web',
        tipo: s.tipo ?? 'excepcion',
        mensaje: s.mensaje!,
        ruta: s.ruta,
        estado: s.estado ?? null,
        requestId: s.request_id ?? null,
        traceId: null,
        version: s.version ?? null,
        navegador: s.navegador ?? null,
        detalle: s.pila ?? null,
      });
    }
    if (vitales.length) {
      const valores: unknown[] = [];
      const tuplas = vitales.map((s, i) => {
        // La calificación se recalcula aquí: no se confía en la que manda el navegador
        valores.push(s.nombre, s.valor, calificar(s.nombre!, s.valor!), limpiar(s.ruta, 120), s.dispositivo, s.version ?? null);
        const b = i * 6;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
      });
      await this.db.query(
        `INSERT INTO ops.web_vital (wv_nombre, wv_valor, wv_calificacion, wv_ruta, wv_dispositivo, wv_version) VALUES ${tuplas.join(', ')}`,
        valores,
      );
    }
  }

  /** Todo lo que muestra el panel de Observabilidad para el rango elegido. */
  async resumen(rango: keyof typeof RANGOS = '24h') {
    await volcarMetricas(); // lo de esta instancia que aún no se guardó
    const { ventana, paso } = RANGOS[rango];
    const filtro = `m.mh_minuto >= now() - $1::interval AND m.mh_ruta NOT LIKE '/ops/%'`;

    const [totales, serie, rutas, estados, incidentes, vitales, porDispositivo, negocio] = await Promise.all([
      this.db.one<FilaHistograma>(`SELECT ${COLUMNAS_HISTOGRAMA} FROM ops.metrica_http m WHERE ${filtro}`, [ventana]),
      this.db.query<FilaHistograma & { desde: Date }>(
        `WITH b AS (
           SELECT generate_series(date_bin($2::interval, now() - $1::interval, TIMESTAMPTZ '2000-01-01'), now(), $2::interval) AS desde)
         SELECT b.desde, ${COLUMNAS_HISTOGRAMA}
           FROM b LEFT JOIN ops.metrica_http m
             ON date_bin($2::interval, m.mh_minuto, TIMESTAMPTZ '2000-01-01') = b.desde AND ${filtro}
          GROUP BY b.desde ORDER BY b.desde`,
        [ventana, paso],
      ),
      this.db.query<FilaHistograma & { metodo: string; ruta: string }>(
        `SELECT m.mh_metodo AS metodo, m.mh_ruta AS ruta, ${COLUMNAS_HISTOGRAMA}
           FROM ops.metrica_http m WHERE ${filtro} GROUP BY 1, 2`,
        [ventana],
      ),
      this.db.query<{ estado: number; total: number }>(
        `SELECT m.mh_estado AS estado, SUM(m.mh_total)::int AS total FROM ops.metrica_http m WHERE ${filtro} GROUP BY 1 ORDER BY 1`,
        [ventana],
      ),
      this.db.query(
        `SELECT inc_huella AS fingerprint, COUNT(*)::int AS count, MIN(inc_ocurrido_en) AS first_at, MAX(inc_ocurrido_en) AS last_at,
                (array_agg(inc_origen ORDER BY inc_id DESC))[1] AS source, (array_agg(inc_tipo ORDER BY inc_id DESC))[1] AS type,
                (array_agg(inc_mensaje ORDER BY inc_id DESC))[1] AS message, (array_agg(inc_ruta ORDER BY inc_id DESC))[1] AS route,
                (array_agg(inc_metodo ORDER BY inc_id DESC))[1] AS method, (array_agg(inc_estado ORDER BY inc_id DESC))[1] AS status,
                (array_agg(inc_request_id ORDER BY inc_id DESC))[1] AS last_request_id,
                (array_agg(inc_version ORDER BY inc_id DESC))[1] AS version, (array_agg(inc_navegador ORDER BY inc_id DESC))[1] AS browser,
                (array_agg(inc_detalle ORDER BY inc_id DESC))[1] AS stack
           FROM ops.incidente WHERE inc_ocurrido_en >= now() - $1::interval
          GROUP BY inc_huella ORDER BY MAX(inc_ocurrido_en) DESC LIMIT 25`,
        [ventana],
      ),
      this.db.query<{ nombre: (typeof VITALES)[number]; muestras: number; p75: number; buenas: number; mejorables: number; malas: number }>(
        `SELECT wv_nombre AS nombre, COUNT(*)::int AS muestras,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY wv_valor)::float8 AS p75,
                COUNT(*) FILTER (WHERE wv_calificacion = 'good')::int AS buenas,
                COUNT(*) FILTER (WHERE wv_calificacion = 'needs-improvement')::int AS mejorables,
                COUNT(*) FILTER (WHERE wv_calificacion = 'poor')::int AS malas
           FROM ops.web_vital WHERE wv_medido_en >= now() - $1::interval GROUP BY 1`,
        [ventana],
      ),
      this.db.query<{ nombre: (typeof VITALES)[number]; dispositivo: string; muestras: number; p75: number }>(
        `SELECT wv_nombre AS nombre, wv_dispositivo AS dispositivo, COUNT(*)::int AS muestras,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY wv_valor)::float8 AS p75
           FROM ops.web_vital WHERE wv_medido_en >= now() - $1::interval GROUP BY 1, 2`,
        [ventana],
      ),
      this.db.query<{ tipo: string; total: number }>(
        `SELECT evt_tipo AS tipo, COUNT(*)::int AS total FROM evento WHERE evt_creado_en >= now() - $1::interval GROUP BY 1 ORDER BY 1`,
        [ventana],
      ),
    ]);

    const t = latencias(totales!);
    const porRuta = rutas.map((r) => ({ method: r.metodo, route: r.ruta, ...latencias(r) }));
    const disponibilidad = t.requests ? 1 - t.error_rate : null;
    const presupuesto = 1 - SLO.disponibilidad; // fracción de errores permitida
    return {
      range: rango,
      generated_at: new Date().toISOString(),
      instance: {
        version: API_VERSION,
        region: process.env.VERCEL_REGION ?? 'local',
        node: process.version,
        started_at: inicioInstancia.toISOString(),
        memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      },
      totals: t,
      slo: {
        availability_target: SLO.disponibilidad,
        availability: disponibilidad,
        // Cuánto del presupuesto de errores queda (1 = intacto, 0 = agotado, < 0 = SLO incumplido)
        error_budget_remaining: disponibilidad === null ? null : 1 - t.error_rate / presupuesto,
        p95_target_ms: SLO.p95Ms,
        p95_ok: t.p95_ms === null ? null : t.p95_ms <= SLO.p95Ms,
      },
      series: serie.map((s) => ({ from: new Date(s.desde).toISOString(), ...latencias(s) })),
      top_routes: [...porRuta].sort((a, b) => b.requests - a.requests).slice(0, 10),
      slowest_routes: porRuta.filter((r) => r.requests >= 3).sort((a, b) => (b.p95_ms ?? 0) - (a.p95_ms ?? 0)).slice(0, 8),
      status_codes: estados,
      incidents: incidentes,
      web_vitals: VITALES.map((nombre) => {
        const v = vitales.find((x) => x.nombre === nombre);
        const p75 = v ? Math.round(v.p75 * (nombre === 'CLS' ? 1000 : 1)) / (nombre === 'CLS' ? 1000 : 1) : null;
        return {
          name: nombre,
          samples: v?.muestras ?? 0,
          p75,
          rating: p75 === null ? null : calificar(nombre, p75),
          thresholds: UMBRALES_VITALES[nombre],
          distribution: v ? { good: v.buenas, needs_improvement: v.mejorables, poor: v.malas } : null,
          by_device: porDispositivo.filter((d) => d.nombre === nombre).map((d) => ({ device: d.dispositivo, samples: d.muestras, p75: d.p75 })),
        };
      }),
      business: negocio,
    };
  }
}
