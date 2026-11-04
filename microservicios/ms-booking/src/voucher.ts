import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Voucher del código QR (contrato v2: `voucher_qr_payload`). Es un token firmado con HMAC-SHA256,
 * con el formato de un JWT (cabecera.datos.firma en base64url), que el guía escanea en el check-in.
 * No lleva datos personales: solo el id de la reserva, su código y para qué sirve (voucher o pase).
 * La llave se deriva del secreto del servidor, así que no se puede falsificar sin conocerlo.
 */
export interface DatosVoucher {
  r: string; // reservation_id
  c: string; // reservation_code
  t: 'voucher' | 'pase';
  iat: number;
}

const b64 = (x: unknown) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const llave = (secreto: string) => createHmac('sha256', secreto).update('descubre-ec:voucher-qr:v1').digest();
const firmar = (contenido: string, secreto: string) => createHmac('sha256', llave(secreto)).update(contenido).digest('base64url');

export function emitirVoucher(reservaId: string, codigo: string, secreto: string, tipo: DatosVoucher['t'] = 'voucher', ahora = Date.now()): string {
  const contenido = `${b64({ alg: 'HS256', typ: 'VQR' })}.${b64({ r: reservaId, c: codigo, t: tipo, iat: Math.floor(ahora / 1000) })}`;
  return `${contenido}.${firmar(contenido, secreto)}`;
}

/** Devuelve los datos si la firma es válida; null si el token fue alterado o no es un voucher. */
export function leerVoucher(token: string, secreto: string): DatosVoucher | null {
  const partes = token.trim().split('.');
  if (partes.length !== 3) return null;
  const esperado = Buffer.from(firmar(`${partes[0]}.${partes[1]}`, secreto));
  const recibido = Buffer.from(partes[2]);
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null;
  try {
    const d = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as DatosVoucher;
    return typeof d.r === 'string' && typeof d.c === 'string' ? d : null;
  } catch {
    return null;
  }
}
