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

/** Documento de identidad: solo cédula ecuatoriana válida, como dom_documento (migración 004). */
export function esDocumento(v: string): boolean {
  return esCedulaEc(v);
}

/** Teléfono ecuatoriano (dom_telefono): celular 09XXXXXXXX o fijo 0[2-7]XXXXXXX (0 + código de provincia + 7 dígitos). */
export const RE_TELEFONO_EC = /^(09\d{8}|0[2-7]\d{7})$/;
export const MSG_TELEFONO_EC = 'debe ser un teléfono ecuatoriano: celular 09XXXXXXXX (10 dígitos) o fijo 0[2-7]XXXXXXX (9 dígitos)';

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
/**
 * Texto legible: tiene letras, las letras son al menos la mitad de los caracteres alfanuméricos,
 * ningún carácter se repite 6+ veces seguidas ("aaaaaa") y no hay más de 10 dígitos seguidos.
 */
export function esTextoLegible(t: string): boolean {
  const letras = (t.match(new RegExp(LETRA.source, 'g')) ?? []).length;
  const digitos = (t.match(/\d/g) ?? []).length;
  return letras > 0 && letras >= digitos && !/(.)\1{5,}/u.test(t) && !/\d{11,}/.test(t) && !pareceAlAzar(t);
}

/** Secuencias de 5 teclas seguidas del teclado («asdfg», «qwert», también al revés). */
const FILAS_TECLADO = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SECUENCIAS_TECLADO = FILAS_TECLADO.flatMap((f) => [f, [...f].reverse().join('')]).flatMap((f) =>
  Array.from({ length: f.length - 4 }, (_, i) => f.slice(i, i + 5)),
);

/**
 * Texto tecleado al azar: un trozo repetido 3+ veces («asdasdasd»), una palabra de 6+ letras sin
 * vocales («qwrtpsd») o 5 teclas seguidas del teclado («asdfg»). Las tildes no cuentan («Ñuñoa» es válido).
 */
export function pareceAlAzar(t: string): boolean {
  const s = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/([a-z]{2,4})\1{2,}/.test(s)) return true;
  if (s.split(/[^a-z]+/).some((w) => w.length >= 6 && !/[aeiouy]/.test(w))) return true;
  return SECUENCIAS_TECLADO.some((q) => s.includes(q));
}

/** Longitud de la secuencia de dígitos seguidos más larga ("Ruta 66" → 2). */
export const maxDigitosSeguidos = (t: string) => Math.max(0, ...(t.match(/\d+/g) ?? []).map((x) => x.length));

const cadaTexto = (v: unknown, ok: (t: string) => boolean) => (Array.isArray(v) ? v.every((x) => typeof x === 'string' && ok(x)) : typeof v === 'string' && ok(v));

/** El texto debe ser legible (rechaza "12312312", "----", "asdasd123123123123" o "aaaaaaaa"). */
export const ContieneLetras = (opciones?: ValidationOptions) =>
  decorador('contieneLetras', (v) => cadaTexto(v, esTextoLegible), '$property debe ser texto legible (principalmente letras, sin secuencias largas de números ni caracteres repetidos)', opciones);

/** Para nombres, resúmenes, ítems y direcciones: como máximo `max` dígitos seguidos (años, números de casa). */
export const SinNumerosLargos = (max = 4, opciones?: ValidationOptions) =>
  decorador('sinNumerosLargos', (v) => cadaTexto(v, (t) => maxDigitosSeguidos(t) <= max), `$property no puede tener más de ${max} dígitos seguidos`, opciones);

export const EsDocumentoEc = (opciones?: ValidationOptions) =>
  decorador('esDocumentoEc', (v) => typeof v === 'string' && (v === '' || esDocumento(v)), '$property debe ser una cédula ecuatoriana válida (10 dígitos con dígito verificador)', opciones);

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
