/**
 * Tabla de ruteo del API Gateway (migración gradual, patrón Strangler Fig).
 *
 * Booking registra UNA URL base (`http://<host>:8080/api/v3` o `/api/v2`). El gateway decide quién
 * atiende cada ruta del contrato:
 *  - Catálogo (árbol, categorías, listado, búsqueda, ficha) → ms_catalog.
 *  - Todo lo demás (disponibilidad, reservas, check-in, promociones, eventos, salud, vouchers, /reservas
 *    de la URL base) → la tienda actual, hasta que existan ms_inventory, ms_order, ms_booking…
 *    Cuando un compañero entregue su microservicio, se agrega aquí su regla y nada más cambia.
 *  - APIs propias de cada microservicio, para el equipo y el panel: /ms/<servicio>/… → /api/… del servicio.
 */
export type Destino = 'catalogo' | 'location' | 'review' | 'tienda';

/** Segmentos bajo /atracciones que NO son un id o slug de atracción. */
const RESERVADAS = new Set(['reservas', 'eventos', 'health', 'promociones', 'vouchers', 'categorias', 'search', 'reservations']);

export interface Ruta {
  destino: Destino;
  /** Ruta que se envía al destino (puede cambiar en /ms/…). */
  ruta: string;
}

export function rutear(metodo: string, url: string): Ruta {
  const [camino, consulta = ''] = url.split('?');
  const q = consulta ? `?${consulta}` : '';

  // APIs propias de los microservicios: /ms/catalog/v1/atracciones → /api/v1/atracciones
  const ms = /^\/ms\/(location|catalog|review)(\/.*)?$/.exec(camino);
  if (ms) {
    const destino = ({ location: 'location', catalog: 'catalogo', review: 'review' } as const)[ms[1] as 'location' | 'catalog' | 'review'];
    return { destino, ruta: `/api${ms[2] ?? ''}${q}` };
  }

  const m = /^\/api\/v([23])\/atracciones(\/.*)?$/.exec(camino);
  if (m) {
    const resto = (m[2] ?? '').replace(/\/$/, '');
    const segs = resto.split('/').filter(Boolean);
    const esCatalogo =
      (metodo === 'GET' && segs.length === 0) || // listado
      (metodo === 'POST' && resto === '/search') ||
      (metodo === 'GET' && segs[0] === 'categorias' && (segs.length === 1 || (segs.length === 2 && segs[1] === 'arbol'))) ||
      (metodo === 'GET' && segs.length === 1 && !RESERVADAS.has(segs[0])); // ficha por UUID o slug
    if (esCatalogo) return { destino: 'catalogo', ruta: url };
  }
  return { destino: 'tienda', ruta: url };
}

/**
 * SIN_TIENDA=true: el nodo solo publica los microservicios de Dilan (ms_location, ms_catalog,
 * ms_review). Lo que antes atendía la tienda queda a la espera del microservicio del compañero
 * dueño, y el gateway responde 503 diciendo de quién es.
 */
export const sinTienda = () => process.env.SIN_TIENDA === 'true';

/** Rutas que responde el propio gateway (salud agregada y /gateway/…), nunca se reenvían. */
export const esSalud = (url: string) => /^\/api\/v\d+\/(atracciones\/)?health(\?|$)|^\/gateway\//.test(url);

/** Microservicio del equipo (02_microservicios_v2) que debe atender una ruta que hoy no es de Dilan. */
export function duenoDe(url: string): string {
  const camino = url.split('?')[0];
  if (/\/disponibilidad$/.test(camino)) return 'ms_inventory (Alisson)';
  if (/\/promociones(\/|$)/.test(camino)) return 'ms_pricing / ms_coupon (Michael)';
  if (/\/(reservas|reservations|vouchers|eventos)(\/|$)|\/checkin$/.test(camino)) return 'ms_booking / ms_order (Alisson)';
  return 'otro microservicio del equipo';
}

export function urlDe(destino: Destino): string {
  const base = {
    catalogo: process.env.CATALOG_URL ?? 'http://localhost:4002',
    location: process.env.LOCATION_URL ?? 'http://localhost:4001',
    review: process.env.REVIEW_URL ?? 'http://localhost:4003',
    tienda: process.env.TIENDA_URL ?? 'http://localhost:3000',
  }[destino];
  return base.replace(/\/$/, '');
}
