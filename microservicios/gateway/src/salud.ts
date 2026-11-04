import { Destino, DESTINOS, urlDe } from './rutas';

interface EstadoDependencia {
  servicio: string;
  status: 'UP' | 'DEGRADED' | 'DOWN';
  latency_ms: number;
}

async function ping(destino: Destino, ruta: string): Promise<{ estado: EstadoDependencia; cuerpo: Record<string, unknown> | null }> {
  const t = Date.now();
  try {
    const r = await fetch(`${urlDe(destino)}${ruta}`, { signal: AbortSignal.timeout(1500) });
    const cuerpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    const status = (cuerpo?.status as EstadoDependencia['status']) ?? (r.ok ? 'UP' : 'DOWN');
    return { estado: { servicio: destino, status: r.ok ? status : 'DOWN', latency_ms: Date.now() - t }, cuerpo };
  } catch {
    return { estado: { servicio: destino, status: 'DOWN', latency_ms: Date.now() - t }, cuerpo: null };
  }
}

/** Sin estos, Booking no puede ni ver el catálogo ni reservar: el nodo está DOWN. El resto lo degrada. */
const CRITICOS: Destino[] = ['catalogo', 'inventory', 'booking'];

/**
 * Salud del nodo para el semáforo de Booking (NodeHealthResponse del contrato), agregando la de los 12
 * microservicios: si cae uno crítico (catálogo, inventario o reservas) el nodo está DOWN (503); si cae
 * otro, DEGRADED. `dependencias` es una extensión que no rompe el contrato.
 */
export async function saludAgregada() {
  const res = await Promise.all(DESTINOS.map((d) => ping(d, '/api/v1/health')));
  const deps = res.map((r) => r.estado);
  const critica = deps.some((d) => CRITICOS.includes(d.servicio as Destino) && d.status === 'DOWN');
  const status = critica ? 'DOWN' : deps.some((d) => d.status !== 'UP') ? 'DEGRADED' : 'UP';
  return {
    status: status === 'DOWN' ? 503 : 200,
    body: {
      status,
      node_id: process.env.NODE_ID ?? 'node-dilan-atracciones-01',
      node_code: process.env.NODE_CODE ?? 'DILAN_ATRACCIONES',
      version: process.env.npm_package_version ?? '1.0.0',
      database_connected: res.every((r) => r.cuerpo?.database_connected !== false && r.estado.status !== 'DOWN'),
      latency_ms: Math.max(...deps.map((d) => d.latency_ms)),
      timestamp: new Date().toISOString(),
      dependencias: deps,
    },
  };
}
