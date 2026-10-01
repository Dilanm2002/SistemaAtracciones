import { LoggerService } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Observabilidad (OPS-005): en producción cada línea de log es un JSON con fecha, nivel,
 * contexto y, en las peticiones, su `request_id` (el mismo de la cabecera X-Request-Id y del
 * `problem+json`). Así un error que ve el usuario se encuentra directo en los logs de Vercel.
 * Nunca se registran cuerpos, query strings ni cabeceras: no hay datos personales en los logs.
 */
type Nivel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export function escribir(nivel: Nivel, msg: string, extra: Record<string, unknown> = {}) {
  const linea = JSON.stringify({ time: new Date().toISOString(), level: nivel, msg, ...extra });
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

/** Métricas básicas de la instancia, expuestas en /health. */
export const metricas = { inicio: Date.now(), peticiones: 0, errores4xx: 0, errores5xx: 0, lentas: 0 };

/** Registra cada petición al terminar: método, ruta sin query, estado, duración y request_id. */
export function registroPeticiones(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    metricas.peticiones++;
    if (res.statusCode >= 500) metricas.errores5xx++;
    else if (res.statusCode >= 400) metricas.errores4xx++;
    if (ms > 2000) metricas.lentas++;
    escribir(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'request', {
      request_id: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Math.round(ms),
    });
  });
  next();
}
