/**
 * Validación de formularios: mismas reglas que la API (backend/src/common/utils/validators.ts
 * y los DTO) y que los dominios de la base (dom_correo, dom_telefono, dom_documento, dom_ruc).
 * Cada función devuelve el mensaje de error o null.
 */

const LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
export const RE_NOMBRE_PERSONA = /^(?=(?:.*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]){2})[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/;
export const RE_CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const RE_TELEFONO = /^\+?\d{7,15}$/;
export const PRECIO_MAX = 10000;
export const ECUADOR = { latMin: -5.1, latMax: 1.7, lngMin: -92.1, lngMax: -75.1 };

export const LIMITES = {
  nombrePersona: 120,
  correo: 160,
  telefono: 16,
  documento: 11,
  password: 72,
  nombreAtraccion: 200,
  resumen: 280,
  descripcion: 5000,
  direccion: 255,
  item: 150,
  motivo: 255,
  comentario: 1000,
  mensaje: 2000,
  notas: 500,
  categoria: 80,
  descCategoria: 255,
  ciudad: 80,
  descCiudad: 500,
  operador: 150,
  busqueda: 120,
};

/** Cédula ecuatoriana: provincia 01-24 (o 30), tercer dígito 0-5 y dígito verificador módulo 10. */
export function esCedulaEc(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const provincia = Number(c.slice(0, 2));
  if (!((provincia >= 1 && provincia <= 24) || provincia === 30) || Number(c[2]) > 5) return false;
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(c[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    suma += d;
  }
  return (10 - (suma % 10)) % 10 === Number(c[9]);
}

export function esRucEc(r) {
  if (!/^\d{13}$/.test(r)) return false;
  const provincia = Number(r.slice(0, 2));
  const tercero = Number(r[2]);
  return ((provincia >= 1 && provincia <= 24) || provincia === 30) && (tercero <= 6 || tercero === 9) && Number(r.slice(10)) >= 1;
}

const vacio = (v) => v === undefined || v === null || String(v).trim() === '';

/** Texto libre con contenido real (no solo números o símbolos). */
export function texto(v, { min = 1, max, requerido = true, que = 'Este campo', letras = true } = {}) {
  const t = String(v ?? '').trim();
  if (!t) return requerido ? `${que} es obligatorio` : null;
  if (t.length < min) return `${que} debe tener al menos ${min} caracteres`;
  if (max && t.length > max) return `${que} puede tener hasta ${max} caracteres`;
  if (letras && !LETRA.test(t)) return `${que} debe contener texto, no solo números o símbolos`;
  return null;
}

export function nombrePersona(v, { que = 'El nombre', requerido = true } = {}) {
  const t = String(v ?? '').trim();
  if (!t) return requerido ? `${que} es obligatorio` : null;
  if (t.length < 2) return `${que} debe tener al menos 2 letras`;
  if (t.length > LIMITES.nombrePersona) return `${que} puede tener hasta ${LIMITES.nombrePersona} caracteres`;
  if (!RE_NOMBRE_PERSONA.test(t)) return `${que} solo puede tener letras, espacios, apóstrofes o guiones`;
  return null;
}

export function correo(v, { requerido = true } = {}) {
  const t = String(v ?? '').trim();
  if (!t) return requerido ? 'El correo es obligatorio' : null;
  if (t.length > LIMITES.correo || !RE_CORREO.test(t)) return 'Ingresa un correo válido, ej. nombre@correo.com';
  return null;
}

export function telefono(v, { requerido = false } = {}) {
  const t = String(v ?? '').replace(/[\s-]/g, '');
  if (!t) return requerido ? 'El teléfono es obligatorio' : null;
  if (!RE_TELEFONO.test(t)) return 'Usa solo números (7 a 15 dígitos), ej. 0991234567';
  return null;
}

export function documento(v, { requerido = false } = {}) {
  const t = String(v ?? '').trim().toUpperCase();
  if (!t) return requerido ? 'El documento es obligatorio' : null;
  if (/^\d+$/.test(t)) return esCedulaEc(t) ? null : 'La cédula no es válida: revisa los 10 dígitos';
  if (/^[A-Z]{1,2}\d{6,9}$/.test(t)) return null;
  return 'Usa una cédula de 10 dígitos o un pasaporte (1-2 letras y 6-9 dígitos, ej. AB1234567)';
}

export function ruc(v, { requerido = false } = {}) {
  const t = String(v ?? '').trim();
  if (!t) return requerido ? 'El RUC es obligatorio' : null;
  return esRucEc(t) ? null : 'RUC no válido: 13 dígitos, provincia válida y termina en 001';
}

export function password(v) {
  const t = String(v ?? '');
  if (t.length < 8) return 'Mínimo 8 caracteres';
  if (t.length > LIMITES.password) return `Máximo ${LIMITES.password} caracteres`;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return 'Debe incluir letras y números';
  return null;
}

/** Número dentro de un rango, con decimales máximos (0 = entero). */
export function numero(v, { min, max, decimales = 2, requerido = true, que = 'El valor' } = {}) {
  if (vacio(v)) return requerido ? `${que} es obligatorio` : null;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${que} debe ser un número`;
  if (decimales === 0 && !Number.isInteger(n)) return `${que} debe ser un número entero`;
  if (decimales > 0 && !new RegExp(`^-?\\d+(\\.\\d{1,${decimales}})?$`).test(String(v).trim())) return `${que} admite hasta ${decimales} decimales`;
  if (min !== undefined && n < min) return `${que} debe ser como mínimo ${min}`;
  if (max !== undefined && n > max) return `${que} no puede superar ${max.toLocaleString('es-EC')}`;
  return null;
}

/** Fecha AAAA-MM-DD dentro de [min, max] (ambas en el mismo formato). */
export function fecha(v, { min, max, requerido = true, que = 'La fecha' } = {}) {
  if (vacio(v)) return requerido ? `${que} es obligatoria` : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return `${que} no es válida`;
  if (min && v < min) return `${que} no puede ser anterior al ${min.split('-').reverse().join('/')}`;
  if (max && v > max) return `${que} no puede ser posterior al ${max.split('-').reverse().join('/')}`;
  return null;
}

export const hora = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '') ? null : 'Usa el formato HH:MM (24 h), ej. 08:30');

/** Hoy y dentro de N días en hora de Ecuador (AAAA-MM-DD). */
export const hoyEc = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
export const enDias = (n) => new Date(Date.parse(hoyEc()) + n * 86400000).toISOString().slice(0, 10);

/** Quita las claves sin error: { a: null, b: 'x' } → { b: 'x' }. */
export const limpiar = (errs) => Object.fromEntries(Object.entries(errs).filter(([, v]) => v));
