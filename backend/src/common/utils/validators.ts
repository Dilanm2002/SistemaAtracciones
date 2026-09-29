import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Reglas de validación del dominio, compartidas por todos los DTO.
 * El frontend replica exactamente las mismas en frontend/src/utils/validation.js.
 */

/** Letras del español (incluye tildes, ñ y ü). */
const LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;

/** Cédula ecuatoriana: provincia 01-24 (o 30), tercer dígito 0-5 y dígito verificador módulo 10. */
export function esCedulaEc(c: string): boolean {
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

/** Documento de identidad: cédula válida o pasaporte (1-2 letras y 6-9 dígitos), como dom_documento. */
export function esDocumento(v: string): boolean {
  return esCedulaEc(v) || /^[A-Z]{1,2}\d{6,9}$/.test(v);
}

/** RUC ecuatoriano: 13 dígitos, provincia 01-24 (o 30), tercer dígito 0-6 o 9, establecimiento 001+. */
export function esRucEc(r: string): boolean {
  if (!/^\d{13}$/.test(r)) return false;
  const provincia = Number(r.slice(0, 2));
  const tercero = Number(r[2]);
  return ((provincia >= 1 && provincia <= 24) || provincia === 30) && (tercero <= 6 || tercero === 9) && Number(r.slice(10)) >= 1;
}

/** Nombre de persona: solo letras, espacios, apóstrofes, puntos y guiones; con al menos 2 letras. */
export const RE_NOMBRE_PERSONA = /^(?=(?:.*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]){2})[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/;

/** Límites geográficos del Ecuador continental e insular (Galápagos). */
export const ECUADOR = { latMin: -5.1, latMax: 1.7, lngMin: -92.1, lngMax: -75.1 };

function decorador(nombre: string, validar: (v: unknown) => boolean, mensaje: string, opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: nombre,
      target: objeto.constructor,
      propertyName: propiedad,
      options: { message: mensaje.replace('$property', propiedad), ...opciones },
      validator: { validate: validar },
    });
}

/** El texto debe contener letras (rechaza "12312312" o "----" en nombres, direcciones o motivos). */
export const ContieneLetras = (opciones?: ValidationOptions) =>
  decorador(
    'contieneLetras',
    (v) => (Array.isArray(v) ? v.every((x) => typeof x === 'string' && LETRA.test(x)) : typeof v === 'string' && LETRA.test(v)),
    '$property debe contener texto (no solo números o símbolos)',
    opciones,
  );

export const EsDocumentoEc = (opciones?: ValidationOptions) =>
  decorador('esDocumentoEc', (v) => typeof v === 'string' && (v === '' || esDocumento(v)), '$property debe ser una cédula ecuatoriana válida o un pasaporte (1-2 letras y 6-9 dígitos)', opciones);

export const EsRucEc = (opciones?: ValidationOptions) =>
  decorador('esRucEc', (v) => typeof v === 'string' && esRucEc(v), '$property debe ser un RUC ecuatoriano válido (13 dígitos, termina en 001)', opciones);

/** Fecha AAAA-MM-DD que no está en el pasado (hora de Ecuador) y como máximo `diasMax` días adelante. */
export const FechaFutura = (diasMax = 365, opciones?: ValidationOptions) =>
  decorador(
    'fechaFutura',
    (v) => {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
      const limite = new Date(Date.parse(hoy) + diasMax * 86400000).toISOString().slice(0, 10);
      return v.slice(0, 10) >= hoy && v.slice(0, 10) <= limite;
    },
    `$property debe ser una fecha desde hoy y hasta ${diasMax} días adelante`,
    opciones,
  );
