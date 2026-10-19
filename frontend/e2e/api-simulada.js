/**
 * API simulada para las pruebas móviles: responde con datos reales grabados de producción
 * (e2e/fixtures) para que las pruebas no dependan de la red ni del estado de la base.
 * Las fotos se sustituyen por una imagen mínima: aquí se prueba el diseño, no el contenido.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (n) => JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'));
const ATRACCIONES = fixture('atracciones');
export const ATRACCION = fixture('atraccion');

// WebP de 4×3 px
const PIXEL = Buffer.from('UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoEAAMAAsBMJQBOgCgAAP7skbXbLIxFagAAAA==', 'base64');

const SCOPES_ADMIN = ['attractions:read', 'attractions:book', 'attractions:cancel', 'attractions:manage', 'attractions:write', 'admin:full'];
export const CLIENTE = {
  id: '4', nombre: 'María Guamán', nombres: 'María', apellidos: 'Guamán', email: 'cliente@descubre-ec.com', telefono: '0991234567',
  documento: null, rol: 'CLIENTE', roles: ['CLIENTE'], operadorCodigo: null, activo: true, scope: ['attractions:read', 'attractions:book', 'attractions:cancel'],
};
export const ADMIN = { ...CLIENTE, id: '1', nombre: 'Admin Descubre', nombres: 'Admin', apellidos: 'Descubre', email: 'admin@descubre-ec.com', rol: 'ADMIN', roles: ['ADMIN'], scope: SCOPES_ADMIN };

/** JWT sin firma válida: la interfaz solo lee el payload (la API real verifica la firma). */
const tokenFalso = (u) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, nombre: u.nombre, rol: u.rol, scope: u.scope, operador: null, exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
};

/** Fecha (YYYY-MM-DD) dentro de `n` días, en hora de Ecuador. */
export const enDias = (n) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });

/** Reserva confirmada con su factura (encabezado + detalle), como la devuelve la API. */
export const RESERVA = {
  reservation_id: 'b6c0f1a2-3d4e-4f56-8a7b-9c0d1e2f3a4b', code: 'DEC-7F3K9Q', status: 'CONFIRMED', ticket_count: 3, adults: 2, children: 1,
  total_price: { currency: 'USD', total: 105 }, date: enDias(10), time: '09:00', payment_method: 'TARJETA',
  attraction: { id: ATRACCION.id, name: ATRACCION.name, city: 'Quito', photo: '/img/x.webp', meeting_point: 'Plaza Grande', free_cancellation: true, cancellation_hours: 24 },
  customer: { name: 'María Guamán', email: 'cliente@descubre-ec.com', phone: '0991234567' },
  created_at: new Date().toISOString(), can_cancel: true, cancellation_policy: 'FULL_REFUND', refundable: true,
  free_cancellation_until: new Date(Date.now() + 9 * 86_400_000).toISOString(),
  invoice: {
    number: '001-001-000000123', status: 'ISSUED', issued_at: new Date().toISOString(), customer_name: 'María Guamán', currency: 'USD',
    subtotal: 105, tax: 0, total: 105,
    lines: [
      { line: 1, code: 'ATR-12-AD', description: `${ATRACCION.name} · ${enDias(10)} 09:00 · Adulto`, quantity: 2, unit_price: 40, discount: 0, taxable_base: 80, tax_rate: 0, tax: 0, total: 80 },
      { line: 2, code: 'ATR-12-NI', description: `${ATRACCION.name} · ${enDias(10)} 09:00 · Niño`, quantity: 1, unit_price: 25, discount: 0, taxable_base: 25, tax_rate: 0, tax: 0, total: 25 },
    ],
  },
  _links: {},
};

function respuesta(metodo, ruta, query, usuario) {
  if (metodo !== 'GET') {
    if (ruta === '/atracciones/search' || ruta === '/atracciones/details') return { data: ATRACCIONES.data, metadata: { total_results: ATRACCIONES.data.length } };
    return {};
  }
  if (ruta === '/auth/me') return usuario ? [200, usuario] : [401, { status: 401, title: 'No autenticado' }];
  if (ruta === '/auth/google/estado') return { habilitado: false };
  if (ruta === '/categorias') return fixture('categorias');
  if (ruta === '/destinos') return fixture('destinos');
  if (ruta === '/atracciones') return ATRACCIONES;
  if (ruta === `/atracciones/reservations/${RESERVA.reservation_id}`) return RESERVA;
  if (ruta.startsWith('/atracciones/reservations')) return [];
  if (/^\/atracciones\/[^/]+\/reviews\/eligibility$/.test(ruta)) return { eligible: false };
  if (/^\/atracciones\/[^/]+\/reviews$/.test(ruta)) return fixture('resenas');
  if (/^\/atracciones\/[^/]+\/availability\/calendar$/.test(ruta)) return fixture('calendario');
  if (/^\/atracciones\/[^/]+\/availability$/.test(ruta)) return { ...fixture('disponibilidad'), date: query.get('date') ?? enDias(10) };
  if (/^\/atracciones\/[^/]+$/.test(ruta)) return ATRACCION;
  if (ruta === '/mensajes/stats') return { unread: 0, total: 0 };
  return [];
}

/** Intercepta la API y las fotos del backend. `usuario` simula una sesión iniciada. */
export async function simularApi(page, { usuario } = {}) {
  if (usuario) await page.addInitScript((t) => sessionStorage.setItem('dec_token', t), tokenFalso(usuario));
  await page.route(
    (url) => url.host !== '127.0.0.1:4173' && (url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/img/')),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/api/v1/media/')) {
        return route.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL });
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
      const r = respuesta(route.request().method(), url.pathname.replace(/^\/api\/v1/, ''), url.searchParams, usuario);
      const [status, body] = Array.isArray(r) && typeof r[0] === 'number' ? r : [200, r];
      return route.fulfill({ status, contentType: 'application/json', headers: cors(), body: JSON.stringify(body) });
    },
  );
}

const cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'X-Total-Count' });
