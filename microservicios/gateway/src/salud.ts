import { Destino, sinTienda, urlDe } from './rutas';

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

/**
 * Salud del nodo para el semáforo de Booking (NodeHealthResponse del contrato), agregando las
 * dependencias: la tienda manda la forma de la respuesta; si cae la tienda o ms_catalog, el nodo
 * está DOWN (503); si cae otro microservicio, DEGRADED. Con SIN_TIENDA=true solo cuentan los
 * microservicios de Dilan y la respuesta la arma el gateway.
 */
export async function saludAgregada(version: string) {
  const conTienda = !sinTienda();
  const [tienda, catalogo, location, review] = await Promise.all([
    conTienda ? ping('tienda', `/api/v${version}/atracciones/health`) : null,
    ping('catalogo', '/api/v1/health'),
    ping('location', '/api/v1/health'),
    ping('review', '/api/v1/health'),
  ]);
  const deps = [tienda, catalogo, location, review].filter((d) => d !== null).map((d) => d.estado);
  const critica = tienda?.estado.status === 'DOWN' || catalogo.estado.status === 'DOWN';
  const degradada = deps.some((d) => d.status !== 'UP');
  const status = critica ? 'DOWN' : degradada ? 'DEGRADED' : 'UP';
  const base = tienda?.cuerpo ?? {
    node_id: process.env.NODE_ID ?? 'node-dilan-atracciones-01',
    node_code: process.env.NODE_CODE ?? 'DILAN_ATRACCIONES',
    version: process.env.npm_package_version ?? '1.0.0',
    // Sin la tienda, la base que importa es la del catálogo (cada microservicio reporta la suya)
    database_connected: catalogo.estado.status !== 'DOWN',
  };
  return {
    status: status === 'DOWN' ? 503 : 200,
    body: {
      ...base,
      status,
      latency_ms: Math.max(...deps.map((d) => d.latency_ms)),
      timestamp: new Date().toISOString(),
      // Extensión (no rompe el contrato): estado de cada pieza detrás del gateway
      dependencias: deps,
    },
  };
}
