import { pruebaDpop } from './dpop';
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const TOKEN_KEY = 'dec_token';

/**
 * Sesión POR PESTAÑA: el token vive en sessionStorage, que cada pestaña o ventana tiene propio.
 * Si en una pestaña estás como administrador y abres el mismo enlace en otra, esa pestaña
 * empieza sin sesión y puedes entrar con otro usuario; cerrar la pestaña cierra su sesión local.
 */
try { localStorage.removeItem(TOKEN_KEY); } catch { /* versiones anteriores compartían el token entre pestañas */ }

export const tokenStore = {
  get: () => {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ }
  },
};

/** Error de API con los campos de Problem Details (RFC 7807). */
export class ApiError extends Error {
  constructor({ status, title, detail, errors, code }) {
    super(detail || title || 'Error inesperado');
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.code = code;
    /** { campo: mensaje } para mostrar errores junto al input */
    this.fieldErrors = Object.fromEntries((errors ?? []).map((e) => [e.field, e.message]));
  }
}

export const newIdempotencyKey = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const RETRIABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

/** Espera `ms` salvo que la petición se cancele. */
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Abortado', 'AbortError')); }, { once: true });
  });

/**
 * fetch con JSON, token Bearer y errores normalizados.
 * Los GET (idempotentes) se reintentan con backoff exponencial ante fallos de red
 * o 502/503/504 transitorios, p. ej. un arranque en frío de la función serverless (WEB-011).
 * @param {string} path  ruta relativa a /api/v1
 * @param {{method?:string, body?:any, idempotencyKey?:string, signal?:AbortSignal, form?:FormData}} opts
 */
export async function api(path, { method = 'GET', body, idempotencyKey, signal, form } = {}) {
  const token = tokenStore.get();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // WEB-008: si el token está ligado a la llave del navegador (cnf), va con esquema DPoP + prueba firmada
  const ligado = !!token && !!datosToken(token)?.cnf;
  if (token) headers.Authorization = `${ligado ? 'DPoP' : 'Bearer'} ${token}`;
  const conPrueba = ligado || (!token && (path === '/auth/login' || path === '/auth/register'));
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const retries = method === 'GET' ? MAX_RETRIES : 0;
  // Si la petición ni siquiera llegó (fallo de red / arranque en frío), también se reintentan
  // el login y las operaciones con Idempotency-Key: repetirlas no duplica nada.
  const retriesRed = method === 'GET' || idempotencyKey || path === '/auth/login' ? MAX_RETRIES : 0;

  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      // Una prueba nueva en cada intento (id único, anti-repetición)
      if (conPrueba) {
        const prueba = await pruebaDpop(method, `${API_URL}${path}`, ligado ? token : undefined).catch(() => null);
        if (prueba) headers.DPoP = prueba;
      }
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
        signal,
        // Con sesión (admin/cliente) evitamos respuestas cacheadas para ver cambios al instante
        cache: token ? 'no-store' : 'default',
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt < retriesRed) { await wait(400 * 2 ** attempt, signal); continue; }
      throw new ApiError({ status: 0, title: 'Sin conexión', detail: 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.' });
    }
    if (!RETRIABLE.has(res.status) || attempt >= retries) break;
    const retryAfter = Number(res.headers.get('Retry-After'));
    await wait(retryAfter > 0 && retryAfter <= 5 ? retryAfter * 1000 : 400 * 2 ** attempt, signal);
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new CustomEvent('auth:expired'));
    const espera = Number(res.headers.get('Retry-After'));
    throw new ApiError({
      status: res.status,
      title: data?.title,
      detail:
        res.status === 429
          ? `Hiciste demasiados intentos seguidos. Espera ${espera > 0 ? `${Math.ceil(espera / 60) > 1 ? `${Math.ceil(espera / 60)} minutos` : `${espera} segundos`}` : 'un momento'} y vuelve a intentarlo.`
          : data?.detail ?? data?.message ?? 'Ocurrió un error inesperado.',
      errors: data?.errors,
      code: data?.code,
    });
  }
  return data;
}

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
};

// ── Endpoints ────────────────────────────────────────────────────────────
export const Auth = {
  login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password } }),
  google: (accessToken) => api('/auth/google', { method: 'POST', body: { access_token: accessToken } }),
  register: (data) => api('/auth/register', { method: 'POST', body: data }),
  me: () => api('/auth/me'),
  updateMe: (data) => api('/auth/me', { method: 'PATCH', body: data }),
  changePassword: (actual, nueva) => api('/auth/me/password', { method: 'POST', body: { actual, nueva } }),
  logout: () => api('/auth/logout', { method: 'POST' }),
};

/** Catálogos del modelo relacional (tablas provincia e idioma). */
export const Geo = {
  provincias: () => api('/provincias'),
  idiomas: () => api('/idiomas'),
};

/** Feed de eventos de dominio (tabla evento, admin:full). */
export const Eventos = {
  resumen: () => api('/eventos/resumen'),
  ultimos: (type) => api(`/eventos${qs({ order: 'desc', limit: 50, type })}`).then((r) => r.data),
};

/** Favoritos del usuario autenticado (tabla favorito). */
export const Favoritos = {
  list: () => api('/favoritos'),
  add: (id) => api(`/favoritos/${id}`, { method: 'PUT' }),
  remove: (id) => api(`/favoritos/${id}`, { method: 'DELETE' }),
};

export const Atracciones = {
  search: (body, signal) => api('/atracciones/search', { method: 'POST', body, signal }),
  list: (params = {}) => api(`/atracciones${qs(params)}`),
  get: (id) => api(`/atracciones/${id}`),
  details: (ids) => api('/atracciones/details', { method: 'POST', body: { attractions: ids, languages: ['es'] } }),
  create: (data) => api('/atracciones', { method: 'POST', body: data }),
  update: (id, data) => api(`/atracciones/${id}`, { method: 'PATCH', body: data }),
  remove: (id) => api(`/atracciones/${id}`, { method: 'DELETE' }),
  /** Admin: aprobar (APPROVE) o rechazar con motivo (REJECT) lo que subió una empresa */
  review: (id, decision, reason) => api(`/atracciones/${id}/review`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } }),
  availability: (id, date) => api(`/atracciones/${id}/availability${qs({ date })}`),
  calendar: (id, month) => api(`/atracciones/${id}/availability/calendar${qs({ month })}`),
  blocked: (id) => api(`/atracciones/${id}/blocked-dates`),
  block: (id, date, reason) => api(`/atracciones/${id}/blocked-dates`, { method: 'POST', body: { date, reason } }),
  unblock: (id, blockId) => api(`/atracciones/${id}/blocked-dates/${blockId}`, { method: 'DELETE' }),
  reviews: (id, params = {}) => api(`/atracciones/${id}/reviews${qs(params)}`),
  reviewEligibility: (id) => api(`/atracciones/${id}/reviews/eligibility`),
  createReview: (id, rating, comment) => api(`/atracciones/${id}/reviews`, { method: 'POST', body: { rating, comment } }),
};

export const Reservas = {
  create: (atraccionId, body, idempotencyKey) =>
    api(`/atracciones/${atraccionId}/reservations`, { method: 'POST', body, idempotencyKey }),
  list: (params = {}) => api(`/atracciones/reservations${qs(params)}`),
  get: (id) => api(`/atracciones/reservations/${id}`),
  /** acceptNoRefund: el cliente confirma que cancela fuera de plazo, sin reembolso */
  cancel: (id, reason, idempotencyKey, acceptNoRefund = false) =>
    api(`/atracciones/reservations/${id}/cancel`, { method: 'POST', body: { reason, ...(acceptNoRefund ? { accept_no_refund: true } : {}) }, idempotencyKey }),
  confirm: (id, idempotencyKey) => api(`/atracciones/reservations/${id}/confirm`, { method: 'POST', idempotencyKey }),
};

const crud = (base) => ({
  list: (all = false) => api(`/${base}${all ? '?all=true' : ''}`),
  create: (data) => api(`/${base}`, { method: 'POST', body: data }),
  update: (id, data) => api(`/${base}/${id}`, { method: 'PATCH', body: data }),
  remove: (id) => api(`/${base}/${id}`, { method: 'DELETE' }),
});
export const Categorias = crud('categorias');
export const Destinos = crud('destinos');
export const Operadores = crud('operadores');

export const Resenas = {
  list: (params = {}) => api(`/resenas${qs(params)}`),
  moderate: (id, visible) => api(`/resenas/${id}`, { method: 'PATCH', body: { visible } }),
  remove: (id) => api(`/resenas/${id}`, { method: 'DELETE' }),
};

export const Reportes = {
  dashboard: () => api('/reportes/dashboard'),
  ventas: (from, to) => api(`/reportes/ventas${qs({ from, to })}`),
  clientes: () => api('/reportes/clientes'),
};

export const Mensajes = {
  send: (data) => api('/mensajes', { method: 'POST', body: data }),
  list: (status) => api(`/mensajes${qs({ status })}`),
  stats: () => api('/mensajes/stats'),
  mark: (id, leido) => api(`/mensajes/${id}`, { method: 'PATCH', body: { leido } }),
  remove: (id) => api(`/mensajes/${id}`, { method: 'DELETE' }),
};

export const Usuarios = {
  list: (params = {}) => api(`/usuarios${qs(params)}`),
  create: (data) => api('/usuarios', { method: 'POST', body: data }),
  update: (id, data) => api(`/usuarios/${id}`, { method: 'PATCH', body: data }),
};

/** Empresas que piden vender sus tours y paquetes (marketplace). */
export const Proveedores = {
  solicitar: (data) => api('/proveedores/solicitudes', { method: 'POST', body: data }),
  mia: () => api('/proveedores/solicitudes/mia'),
  list: (estado) => api(`/proveedores/solicitudes${qs({ estado })}`),
  aprobar: (id) => api(`/proveedores/solicitudes/${id}/aprobar`, { method: 'POST' }),
  rechazar: (id, motivo) => api(`/proveedores/solicitudes/${id}/rechazar`, { method: 'POST', body: { motivo } }),
};

export const Uploads = {
  image: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api('/uploads', { method: 'POST', form });
  },
};

/** Payload del JWT (sin verificar la firma: solo para decisiones de la interfaz). */
function datosToken(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/**
 * Datos de la sesión que ya trae el token (nombre, rol, permisos). Se usan SOLO para pintar la
 * interfaz al instante mientras llega /auth/me; la firma la verifica el servidor en cada petición,
 * así que no dan acceso a nada. Si el token venció, no se usan.
 */
export function usuarioDelToken(token) {
  try {
    const p = datosToken(token);
    if (!p?.sub || (p.exp && p.exp * 1000 < Date.now())) return null;
    return { id: p.sub, email: p.email, nombre: p.nombre, rol: p.rol, scope: p.scope ?? [], operadorCodigo: p.operador ?? null, _provisional: true };
  } catch {
    return null;
  }
}

/** Rendimiento: la sesión se valida en paralelo con la descarga del resto de la página. */
export const sesionInicial = tokenStore.get() ? api('/auth/me') : null;
sesionInicial?.catch(() => {}); // el error lo maneja AuthContext
