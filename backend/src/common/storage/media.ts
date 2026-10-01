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
