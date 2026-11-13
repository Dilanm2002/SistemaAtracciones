/**
 * Tabla de ruteo del API Gateway. Booking registra UNA URL base (`https://<gateway>/api/v3`, o `/api/v2`) y
 * el gateway reparte cada ruta del contrato al microservicio dueño (script del equipo):
 *  - Catálogo (árbol, categorías, listado, búsqueda, ficha) → ms_catalog.
 *  - Disponibilidad de un día → ms_inventory.
 *  - Reservas, cancelación, check-in, vouchers QR y feed de eventos (y `/reservas` de la URL base, guía de
 *    socios §5) → ms_booking, que orquesta la saga con los demás.
 *  - Acuerdo de promociones → ms_coupon.
 *  - Turistas de Booking (/api/v3/clientes, contrato v3.1) → ms_identity.
 *  - `/api/v1/calendario/*.ics` (enlace de ics_calendar_url) → ms_booking.
 *  - APIs propias de cada microservicio, para el equipo y el panel: /ms/<servicio>/v1/… → /api/v1/…
 *    (nunca las rutas /internal/, que son solo entre servicios).
 * Lo que no es del contrato responde 404 (la tienda monolítica ya no participa).
 */
export type Destino = 'catalogo' | 'location' | 'review' | 'pricing' | 'inventory' | 'coupon' | 'order' | 'booking' | 'payment' | 'refund' | 'invoicing' | 'identity' | 'bff';

/** Los que cuentan para la salud del nodo. El BFF no: solo lo usa la web, no Booking. */
export const DESTINOS: Destino[] = ['catalogo', 'location', 'review', 'pricing', 'inventory', 'coupon', 'order', 'booking', 'payment', 'refund', 'invoicing', 'identity'];

/** Nombre en /ms/<servicio> → destino. */
const PROPIAS: Record<string, Destino> = {
  location: 'location', catalog: 'catalogo', review: 'review', pricing: 'pricing', inventory: 'inventory', coupon: 'coupon',
  order: 'order', booking: 'booking', payment: 'payment', refund: 'refund', invoicing: 'invoicing', identity: 'identity',
};

/** Segmentos bajo /atracciones que NO son un id o slug de atracción. */
const RESERVADAS = new Set(['reservas', 'eventos', 'health', 'promociones', 'vouchers', 'categorias', 'search', 'reservations']);

/** Rutas que responde el propio gateway (salud agregada y /gateway/…), nunca se reenvían. */
export const esSalud = (url: string) => /^\/api\/v\d+\/(atracciones\/)?health(\?|$)|^\/gateway\//.test(url);

export interface Ruta {
  destino: Destino | null;
  /** Ruta que se envía al destino (puede cambiar en /ms/…). */
  ruta: string;
}

/** Booking y sus herramientas a veces usan «reservations» en inglés: se atiende igual que «reservas». */
const ALIAS_RESERVAS = /^(\/api\/v[23](?:\/atracciones)?)\/reservations(?=\/|$)/;

export function rutear(metodo: string, url: string): Ruta {
  if (ALIAS_RESERVAS.test(url)) url = url.replace(ALIAS_RESERVAS, '$1/reservas');
  const [camino, consulta = ''] = url.split('?');
  const q = consulta ? `?${consulta}` : '';

  // BFF de la web y el panel: /bff/v1/atracciones → /api/v1/atracciones
  const bff = /^\/bff(\/v1\/.*)$/.exec(camino);
  if (bff) return { destino: 'bff', ruta: `/api${bff[1]}${q}` };

  // APIs propias: /ms/catalog/v1/atracciones → /api/v1/atracciones (las /internal/ no se publican)
  const ms = /^\/ms\/([a-z]+)(\/.*)?$/.exec(camino);
  if (ms) {
    const destino = PROPIAS[ms[1]];
    if (!destino || /\/internal(\/|$)/.test(ms[2] ?? '')) return { destino: null, ruta: url };
    return { destino, ruta: `/api${ms[2] ?? ''}${q}` };
  }

  if (/^\/api\/v3\/clientes\/?$/.test(camino)) return { destino: 'identity', ruta: url };
  if (/^\/api\/v1\/calendario\/[^/]+\.ics$/.test(camino)) return { destino: 'booking', ruta: url };
  if (/^\/api\/v[23]\/reservas(\/|$)/.test(camino)) return { destino: 'booking', ruta: url };

  const m = /^\/api\/v([23])\/atracciones(\/.*)?$/.exec(camino);
  if (!m) return { destino: null, ruta: url };
  const resto = (m[2] ?? '').replace(/\/$/, '');
  const segs = resto.split('/').filter(Boolean);
  if (segs[0] === 'reservas' || segs[0] === 'vouchers' || (segs[0] === 'eventos' && segs.length === 1)) return { destino: 'booking', ruta: url };
  if (segs[0] === 'promociones') return { destino: 'coupon', ruta: url };
  if (metodo === 'GET' && segs.length === 2 && segs[1] === 'disponibilidad' && !RESERVADAS.has(segs[0])) return { destino: 'inventory', ruta: url };
  const esCatalogo =
    (metodo === 'GET' && segs.length === 0) || // listado
    (metodo === 'POST' && resto === '/search') ||
    (metodo === 'GET' && segs[0] === 'categorias' && (segs.length === 1 || (segs.length === 2 && segs[1] === 'arbol'))) ||
    (metodo === 'GET' && segs.length === 1 && !RESERVADAS.has(segs[0])); // ficha por UUID o slug
  return { destino: esCatalogo ? 'catalogo' : null, ruta: url };
}

const PUERTOS: Record<Destino, number> = {
  location: 4001, catalogo: 4002, review: 4003, pricing: 4004, inventory: 4005, coupon: 4006, order: 4007, booking: 4008, payment: 4009, refund: 4010, invoicing: 4011, identity: 4012, bff: 4013,
};

/** URL de cada servicio: <SERVICIO>_URL (CATALOG_URL para el catálogo) o localhost con su puerto. */
export function urlDe(destino: Destino): string {
  const variable = destino === 'catalogo' ? 'CATALOG_URL' : `${destino.toUpperCase()}_URL`;
  return (process.env[variable] ?? `http://localhost:${PUERTOS[destino]}`).replace(/\/$/, '');
}
