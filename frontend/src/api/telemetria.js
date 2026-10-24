/**
 * Telemetría de la web (docs/OBSERVABILIDAD.md): errores del navegador y Core Web Vitals de los
 * usuarios reales, enviados en lotes a POST /ops/telemetria. Así se ve en el panel de
 * Observabilidad lo que antes solo veía el usuario (una pantalla en blanco, un botón que no
 * respondía, una página lenta en su teléfono).
 *
 * Privacidad: nunca se envían datos personales. La ruta va como plantilla (los ids se reemplazan
 * por :id y no hay query string), los mensajes se recortan y la API vuelve a depurarlos al guardar.
 */
const API_URL = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const MAX_ERRORES_POR_SESION = 15;
const LOTE = 20;

const cola = [];
const vistos = new Set();
let errores = 0;
let temporizador = null;

/** /atraccion/0b1c…-uuid?x=1 → /atraccion/:id (sin ids, números largos ni query string). */
export function rutaPlantilla(pathname = '/') {
  return (
    String(pathname)
      .split(/[?#]/)[0]
      .split('/')
      .map((s) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || /^\d+$/.test(s) || /^[A-Z]{3}-[A-Z0-9]{6}$/.test(s) ? ':id' : s))
      .join('/')
      .slice(0, 200) || '/'
  );
}

/** «Chrome 141 · Android»: navegador y sistema, sin la cadena completa del user agent. */
export function navegador(ua = '') {
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  // Por prioridad: Edge, Opera y Samsung también dicen «Chrome», y Chrome también dice «Safari»
  const m = ['Edg', 'OPR', 'SamsungBrowser', 'Firefox', 'CriOS', 'Chrome', 'Version'].map((n) => new RegExp(`(${n})/(\\d+)`).exec(ua)).find(Boolean);
  const nombre = !m ? 'Otro' : { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung', CriOS: 'Chrome', Version: 'Safari' }[m[1]] ?? m[1];
  return `${nombre}${m ? ` ${m[2]}` : ''} · ${so}`.slice(0, 60);
}

const dispositivo = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches ? 'movil' : 'escritorio');

function enviar() {
  clearTimeout(temporizador);
  temporizador = null;
  while (cola.length) {
    const senales = cola.splice(0, LOTE);
    try {
      // keepalive: el envío sobrevive aunque la página se cierre o se cambie de pestaña
      fetch(`${API_URL}/ops/telemetria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senales }),
        keepalive: true,
        credentials: 'omit',
      }).catch(() => {});
    } catch {
      /* la telemetría nunca debe romper la página */
    }
  }
}

function encolar(senal) {
  cola.push({ ...senal, ruta: rutaPlantilla(window.location.pathname), version: VERSION });
  if (cola.length >= LOTE) enviar();
  else temporizador ??= setTimeout(enviar, 5000);
}

/**
 * Registra un error de la web. El mismo error (tipo + mensaje + ruta) se envía una sola vez por
 * sesión, y como máximo 15 errores por sesión: un bucle de errores no inunda la API.
 * @param {{tipo:'excepcion'|'promesa'|'render'|'api', mensaje:string, pila?:string, request_id?:string, estado?:number}} e
 */
export function reportarError({ tipo, mensaje, pila, request_id, estado }) {
  if (typeof window === 'undefined' || !mensaje) return;
  const clave = `${tipo}|${mensaje}|${rutaPlantilla(window.location.pathname)}`;
  if (vistos.has(clave) || errores >= MAX_ERRORES_POR_SESION) return;
  vistos.add(clave);
  errores++;
  encolar({
    clase: 'error',
    tipo,
    mensaje: String(mensaje).slice(0, 500),
    ...(pila ? { pila: String(pila).slice(0, 4000) } : {}),
    ...(request_id ? { request_id: String(request_id).slice(0, 64) } : {}),
    ...(estado !== undefined ? { estado } : {}),
    navegador: navegador(navigator.userAgent),
  });
}

let iniciada = false;

/** Escucha errores globales y mide los Web Vitals. Se llama una vez al arrancar la web. */
export function iniciarTelemetria() {
  if (iniciada || typeof window === 'undefined' || navigator.webdriver) return; // las pruebas automáticas no cuentan
  iniciada = true;

  window.addEventListener('error', (ev) => {
    // Errores de carga de recursos (img, script) no traen ev.error: los maneja cada componente
    if (!ev.error && !ev.message) return;
    reportarError({ tipo: 'excepcion', mensaje: ev.error ? `${ev.error.name}: ${ev.error.message}` : ev.message, pila: ev.error?.stack });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    if (r?.name === 'AbortError' || r?.status !== undefined) return; // cancelaciones y errores de API ya manejados
    reportarError({ tipo: 'promesa', mensaje: r instanceof Error ? `${r.name}: ${r.message}` : String(r), pila: r?.stack });
  });
  // Al ocultar la página (cambio de pestaña, cierre) se envía lo pendiente
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && enviar());

  // Web Vitals: la librería se descarga aparte, después de cargar la página (no pesa en el inicio)
  const medir = () =>
    import('web-vitals')
      .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
        const registrar = ({ name, value, rating }) =>
          encolar({ clase: 'vital', nombre: name, valor: Math.round(value * (name === 'CLS' ? 1000 : 1)) / (name === 'CLS' ? 1000 : 1), calificacion: rating, dispositivo: dispositivo() });
        onLCP(registrar);
        onINP(registrar);
        onCLS(registrar);
        onFCP(registrar);
        onTTFB(registrar);
      })
      .catch(() => {});
  if (document.readyState === 'complete') medir();
  else window.addEventListener('load', medir, { once: true });
}
