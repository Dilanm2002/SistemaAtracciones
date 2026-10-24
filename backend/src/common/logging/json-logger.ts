import { LoggerService } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ContextoPeticion, contextoActual, ejecutarEnContexto, msDesde, nuevoContexto, traceparentDe } from '../observabilidad/contexto';
import { registrarPeticion, rutaAgrupada } from '../observabilidad/metricas-http';

/**
 * Observabilidad (OPS-005): en producción cada línea de log es un JSON con fecha, nivel,
 * contexto y, dentro de una petición, su `request_id` y `trace_id` (los mismos de las cabeceras
 * X-Request-Id y traceparent y del `problem+json`). Así un error que ve el usuario se encuentra
 * directo en los logs de Vercel y en el panel de Observabilidad.
 * Nunca se registran cuerpos, query strings ni cabeceras: no hay datos personales en los logs.
 */
type Nivel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export function escribir(nivel: Nivel, msg: string, extra: Record<string, unknown> = {}) {
  const ctx = contextoActual();
  const linea = JSON.stringify({
    time: new Date().toISOString(),
    level: nivel,
    msg,
    ...(ctx ? { request_id: ctx.requestId, trace_id: ctx.traceId } : {}),
    ...extra,
  });
  if (nivel === 'error') console.error(linea);
  else if (nivel === 'warn') console.warn(linea);
  else console.log(linea); // eslint-disable-line no-console -- salida estructurada hacia stdout
}

/** Logger de Nest en formato JSON (una línea por evento). */
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) { escribir('info', String(message), { context }); }
  error(message: unknown, trace?: string, context?: string) { escribir('error', String(message), { context, trace }); }
  warn(message: unknown, context?: string) { escribir('warn', String(message), { context }); }
  debug(message: unknown, context?: string) { escribir('debug', String(message), { context }); }
  verbose(message: unknown, context?: string) { escribir('verbose', String(message), { context }); }
}

/** Métricas de la instancia (memoria), expuestas en /health. Las históricas viven en ops.metrica_http. */
export const metricas = { inicio: Date.now(), peticiones: 0, errores4xx: 0, errores5xx: 0, lentas: 0 };

/** Una petición más lenta que esto se registra como advertencia. */
export const PETICION_LENTA_MS = 2000;

type Req = Request & { id?: string; ctx?: ContextoPeticion };

/**
 * Primer middleware: crea el contexto de la petición (request_id + traza W3C) y lo deja activo
 * para todo lo que ocurra después (logs, consultas, incidentes). Devuelve X-Request-Id,
 * traceparent y, al escribir las cabeceras, Server-Timing (tiempo total y de la base).
 */
export function contextoPeticion(req: Req, res: Response, next: NextFunction) {
  const ctx = nuevoContexto(req.header('x-request-id'), req.header('traceparent'));
  req.id = ctx.requestId;
  req.ctx = ctx;
  res.setHeader('X-Request-Id', ctx.requestId);
  res.setHeader('traceparent', traceparentDe(ctx));
  // Server-Timing: visible en DevTools › Network › Timing (y en PerformanceResourceTiming)
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: Parameters<Response['writeHead']>) {
    if (!res.headersSent) {
      res.setHeader('Server-Timing', `db;dur=${ctx.dbMs.toFixed(1)};desc="${ctx.dbConsultas} consultas", total;dur=${msDesde(ctx.inicio).toFixed(1)}`);
    }
    return writeHead.apply(this, args);
  } as Response['writeHead'];
  ejecutarEnContexto(ctx, next);
}

/**
 * Registra cada petición al terminar: log (método, ruta sin query, estado, duración, tiempo en
 * la base) y métrica agregada en ops.metrica_http. La telemetría de la web no se mide a sí misma.
 */
export function registroPeticiones(req: Req, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const ctx = req.ctx;
    const ms = ctx ? msDesde(ctx.inicio) : 0;
    const ruta = rutaAgrupada((req.route as { path?: string } | undefined)?.path && `${req.baseUrl}${req.route.path}`, req.path);
    metricas.peticiones++;
    if (res.statusCode >= 500) metricas.errores5xx++;
    else if (res.statusCode >= 400) metricas.errores4xx++;
    if (ms > PETICION_LENTA_MS) metricas.lentas++;
    // Ni la telemetría de la web ni las consultas previas de CORS (OPTIONS) son tráfico de la API
    if (ruta !== '/ops/telemetria' && req.method !== 'OPTIONS') registrarPeticion(req.method, ruta, res.statusCode, ms, ctx?.dbMs ?? 0);
    if (process.env.NODE_ENV !== 'production' && process.env.LOG_REQUESTS !== 'true') return;
    escribir(res.statusCode >= 500 || ms > PETICION_LENTA_MS ? (res.statusCode >= 500 ? 'error' : 'warn') : res.statusCode >= 400 ? 'warn' : 'info', 'request', {
      request_id: req.id,
      trace_id: ctx?.traceId,
      method: req.method,
      path: req.path,
      route: ruta,
      status: res.statusCode,
      duration_ms: Math.round(ms),
      db_ms: ctx ? Math.round(ctx.dbMs) : undefined,
      db_queries: ctx?.dbConsultas,
      ...(ms > PETICION_LENTA_MS ? { slow: true } : {}),
    });
  });
  next();
}
