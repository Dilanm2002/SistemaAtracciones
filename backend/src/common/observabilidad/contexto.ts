import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes, randomUUID } from 'crypto';

/**
 * Contexto de cada petición, disponible en cualquier punto del código sin pasarlo como parámetro
 * (AsyncLocalStorage): el logger, el acceso a la base y el registro de incidentes lo leen para
 * que todo lo que ocurre en una petición quede unido por el mismo `request_id` y `trace_id`.
 */
export interface ContextoPeticion {
  requestId: string;
  /** trace-id de W3C Trace Context (32 hex): el mismo de la cabecera `traceparent` */
  traceId: string;
  inicio: bigint;
  /** Tiempo y cantidad de consultas a la base dentro de la petición */
  dbMs: number;
  dbConsultas: number;
}

const almacen = new AsyncLocalStorage<ContextoPeticion>();

export const contextoActual = (): ContextoPeticion | undefined => almacen.getStore();

export const ejecutarEnContexto = <T>(ctx: ContextoPeticion, fn: () => T): T => almacen.run(ctx, fn);

const RE_REQUEST_ID = /^[\w-]{8,64}$/;
// version-traceid-parentid-flags (W3C Trace Context); trace-id y parent-id no pueden ser todo ceros
const RE_TRACEPARENT = /^00-(?!0{32})([0-9a-f]{32})-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * Crea el contexto a partir de las cabeceras entrantes: respeta un `X-Request-Id` válido (la web
 * envía uno propio en cada llamada) y continúa la traza de un `traceparent` válido (API Gateway,
 * Booking); si no vienen, genera ids nuevos.
 */
export function nuevoContexto(requestId?: string | null, traceparent?: string | null): ContextoPeticion {
  // Booking envía X-Correlation-Id (contrato v2): se usa como request_id si es válido
  const traza = traceparent ? RE_TRACEPARENT.exec(traceparent.trim().toLowerCase()) : null;
  return {
    requestId: requestId && RE_REQUEST_ID.test(requestId) ? requestId : randomUUID(),
    traceId: traza ? traza[1] : randomBytes(16).toString('hex'),
    inicio: process.hrtime.bigint(),
    dbMs: 0,
    dbConsultas: 0,
  };
}

/** `traceparent` de respuesta: misma traza, nuevo span de este servicio. */
export const traceparentDe = (ctx: ContextoPeticion) => `00-${ctx.traceId}-${randomBytes(8).toString('hex')}-01`;

/** Suma el tiempo de una consulta SQL a la petición en curso (si la hay). */
export function registrarConsulta(ms: number) {
  const ctx = almacen.getStore();
  if (!ctx) return;
  ctx.dbMs += ms;
  ctx.dbConsultas++;
}

export const msDesde = (inicio: bigint) => Number(process.hrtime.bigint() - inicio) / 1e6;
