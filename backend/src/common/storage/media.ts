import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Fotos servidas por la propia API desde un bucket PRIVADO de Supabase (SEG-008).
 * La base guarda rutas `/api/v1/media/<objeto>`; la API solo entrega las que están en uso
 * (fotos de atracciones y portadas de destinos) o las recién subidas con un enlace firmado
 * de corta duración (vista previa del formulario antes de guardar).
 */
export const MEDIA_PREFIJO = '/api/v1/media/';
const HORAS_FIRMA = 2;

const firma = (objeto: string, exp: number, secreto: string) =>
  createHmac('sha256', secreto).update(`${objeto}:${exp}`).digest('base64url');

/** Token `?t=` para ver una foto recién subida durante HORAS_FIRMA horas. */
export function firmarMedia(objeto: string, secreto: string, ahora = Date.now()): string {
  const exp = Math.floor(ahora / 1000) + HORAS_FIRMA * 3600;
  return `${exp}.${firma(objeto, exp, secreto)}`;
}

export function firmaValida(objeto: string, token: string | undefined, secreto: string, ahora = Date.now()): boolean {
  const m = /^(\d{9,12})\.([\w-]{43})$/.exec(token ?? '');
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < ahora) return false;
  const esperado = Buffer.from(firma(objeto, exp, secreto));
  const recibido = Buffer.from(m[2]);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

/** Nombre de objeto seguro: `archivo.ext` o `catalogo/archivo.ext` (sin `..` ni rutas arbitrarias). */
export const objetoValido = (objeto: string) => /^(catalogo\/)?[\w-]{1,80}\.(jpe?g|png|webp)$/i.test(objeto);

/**
 * Anchos de las variantes livianas (MOV-002): `?w=480` y `?w=960` devuelven la foto en WebP a ese ancho.
 * En un teléfono la tarjeta mide ~345 px, así que no hace falta bajar la foto completa de 1600 px.
 */
export const ANCHOS_VARIANTE: Record<number, number> = { 480: 60, 960: 56 }; // ancho → calidad WebP

type SharpFn = (typeof import('sharp'))['default'];

/**
 * Carga diferida de sharp: si no estuviera disponible, la API sigue funcionando y sirve el original.
 * Los tipos son los del build ESM (`default`), pero en CommonJS el módulo es la propia función.
 */
export async function cargarSharp(): Promise<SharpFn> {
  const mod = (await import('sharp')) as unknown as { default?: SharpFn };
  return mod.default ?? (mod as unknown as SharpFn);
}

/** Variante WebP de `cuerpo` a `ancho` px. null si el ancho no está permitido o sharp no está disponible. */
export async function variante(cuerpo: Buffer, ancho: number): Promise<Buffer | null> {
  const calidad = ANCHOS_VARIANTE[ancho];
  if (!calidad) return null;
  try {
    const sharp = await cargarSharp();
    return await sharp(cuerpo).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: calidad }).toBuffer();
  } catch {
    return null; // sin sharp o imagen ilegible: se sirve el original
  }
}
