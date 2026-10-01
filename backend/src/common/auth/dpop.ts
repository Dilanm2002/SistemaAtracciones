import { UnauthorizedException } from '@nestjs/common';
import { createHash, createPublicKey, verify } from 'crypto';

/**
 * DPoP — Demonstrating Proof of Possession (RFC 9449), WEB-008.
 *
 * El navegador crea un par de llaves ECDSA P-256 NO EXPORTABLE (WebCrypto, guardado en IndexedDB).
 * Al iniciar sesión envía una prueba firmada con esa llave y el JWT queda ligado a ella
 * (`cnf.jkt` = huella RFC 7638 de la llave pública). Después, cada petición lleva una prueba nueva
 * firmada (método, URL, hora, id único y hash del token). Si alguien roba el token —por ejemplo
 * con un XSS— no le sirve fuera de ese navegador: la llave privada no se puede extraer.
 * Los clientes de integración que no usan DPoP siguen con `Bearer` (tokens sin `cnf`).
 */
interface JwkEc {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

const VENTANA_S = 300; // tolerancia de reloj entre navegador y servidor
const vistos = new Map<string, number>(); // jti → expiración (anti-repetición por instancia)

const b64json = <T>(parte: string): T => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as T;
const invalida = (motivo: string) => new UnauthorizedException(`Prueba DPoP inválida: ${motivo}.`);

/** Huella RFC 7638 de una llave EC (miembros requeridos en orden lexicográfico). */
export const huellaJwk = (jwk: JwkEc) => createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');

/** Hash del access token que la prueba debe incluir en `ath`. */
export const hashAth = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * Verifica una prueba DPoP para `metodo` + `ruta` (sin query). Si se pasa `token`, exige `ath`.
 * Devuelve la huella de la llave (`jkt`). Lanza 401 si algo no cuadra.
 */
export function verificarPruebaDpop(prueba: string, metodo: string, ruta: string, opciones: { token?: string; ahora?: number } = {}): { jkt: string } {
  const partes = prueba.split('.');
  if (partes.length !== 3) throw invalida('formato');
  let header: { typ?: string; alg?: string; jwk?: JwkEc };
  let payload: { htm?: string; htu?: string; iat?: number; jti?: string; ath?: string };
  try {
    header = b64json(partes[0]);
    payload = b64json(partes[1]);
  } catch {
    throw invalida('no se pudo leer');
  }
  const jwk = header.jwk;
  if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d) {
    throw invalida('cabecera');
  }
  let ok = false;
  try {
    const llave = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    ok = verify('sha256', Buffer.from(`${partes[0]}.${partes[1]}`), { key: llave, dsaEncoding: 'ieee-p1363' }, Buffer.from(partes[2], 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw invalida('firma');
  if (payload.htm !== metodo.toUpperCase()) throw invalida('método');
  let rutaPrueba: string;
  try {
    rutaPrueba = new URL(payload.htu ?? '').pathname;
  } catch {
    throw invalida('URL');
  }
  if (rutaPrueba !== ruta) throw invalida('URL');
  const ahora = opciones.ahora ?? Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || Math.abs(ahora - payload.iat) > VENTANA_S) throw invalida('hora');
  if (typeof payload.jti !== 'string' || payload.jti.length < 8 || payload.jti.length > 80) throw invalida('identificador');
  if (opciones.token !== undefined && payload.ath !== hashAth(opciones.token)) throw invalida('no corresponde al token');

  // Anti-repetición: un mismo jti no se acepta dos veces mientras está en la ventana
  for (const [k, exp] of vistos) if (exp < ahora) vistos.delete(k);
  if (vistos.has(payload.jti)) throw invalida('repetida');
  vistos.set(payload.jti, ahora + VENTANA_S);
  if (vistos.size > 20_000) vistos.clear();

  return { jkt: huellaJwk(jwk) };
}
