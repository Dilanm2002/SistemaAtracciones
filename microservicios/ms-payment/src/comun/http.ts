import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { correlacionActual } from './correlacion';

/**
 * Llamadas REST entre microservicios (rutas /api/v1/internal/… con X-Servicio-Token).
 * - Propaga X-Correlation-Id para seguir una saga de punta a punta en los logs.
 * - Un 4xx del otro servicio es parte de su contrato (p. ej. 409 OUT_OF_STOCK): se devuelve igual.
 * - Sin respuesta, timeout o 5xx → 503 DEPENDENCY_UNAVAILABLE (el llamador decide si compensa).
 */
export type Servicio = 'catalog' | 'location' | 'review' | 'pricing' | 'inventory' | 'coupon' | 'order' | 'booking' | 'payment' | 'refund' | 'invoicing';

const PUERTOS: Record<Servicio, number> = {
  location: 4001, catalog: 4002, review: 4003, pricing: 4004, inventory: 4005, coupon: 4006,
  order: 4007, booking: 4008, payment: 4009, refund: 4010, invoicing: 4011,
};

/** URL base de un servicio: <SERVICIO>_URL (p. ej. INVENTORY_URL) o localhost con su puerto. */
export const urlServicio = (s: Servicio) => (process.env[`${s.toUpperCase()}_URL`] ?? `http://localhost:${PUERTOS[s]}`).replace(/\/$/, '');

export interface OpcionesLlamada {
  cuerpo?: unknown;
  /** ms; por defecto 3000 (Booking corta a los 4 s toda la saga) */
  timeout?: number;
  idempotencia?: string;
}

export async function llamar<T = unknown>(servicio: Servicio, metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', ruta: string, op: OpcionesLlamada = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-servicio-token': process.env.SERVICIOS_TOKEN ?? '' };
  const cid = correlacionActual();
  if (cid) headers['x-correlation-id'] = cid;
  if (op.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (op.idempotencia) headers['idempotency-key'] = op.idempotencia;
  let r: Response;
  try {
    r = await fetch(`${urlServicio(servicio)}${ruta}`, {
      method: metodo,
      headers,
      body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo),
      signal: AbortSignal.timeout(op.timeout ?? 3000),
    });
  } catch (e) {
    throw new ServiceUnavailableException({ message: `ms_${servicio} no responde (${(e as Error).name}).`, code: 'DEPENDENCY_UNAVAILABLE' });
  }
  const texto = await r.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (r.ok) return json as T;
  if (r.status >= 400 && r.status < 500) {
    const p = (json ?? {}) as { detail?: string; title?: string; code?: string };
    throw new HttpException({ message: p.detail ?? p.title ?? `ms_${servicio} respondió ${r.status}.`, code: p.code ?? 'UPSTREAM_ERROR', upstream: `ms_${servicio}` }, r.status);
  }
  throw new ServiceUnavailableException({ message: `ms_${servicio} respondió ${r.status}.`, code: 'DEPENDENCY_UNAVAILABLE' });
}
