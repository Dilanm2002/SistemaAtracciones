/**
 * DPoP (RFC 9449) en el navegador — WEB-008.
 *
 * Se crea UNA vez un par de llaves ECDSA P-256 con la privada NO EXPORTABLE (WebCrypto) y se
 * guarda en IndexedDB. El login envía una prueba firmada y el token queda ligado a esa llave;
 * después cada petición lleva una prueba nueva (método, URL, hora, id único, hash del token).
 * Un token robado (p. ej. por XSS) no sirve en otro equipo: la llave privada no se puede leer.
 * Si el navegador no soporta WebCrypto o IndexedDB, se sigue con Bearer (sin romper nada).
 */
const DB = 'descubre-ec-dpop';
const STORE = 'llaves';
const ID = 'navegador';

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (obj) => b64u(enc.encode(JSON.stringify(obj)));

function idb(modo, accion) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, modo);
      const r = accion(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

let llaves;
function obtenerLlaves() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) return Promise.resolve(null);
  llaves ??= (async () => {
    const guardada = await idb('readonly', (s) => s.get(ID));
    if (guardada?.privada && guardada?.jwk) return guardada;
    // false = la llave privada NO se puede exportar ni leer desde JavaScript
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('jwk', par.publicKey);
    const nueva = { privada: par.privateKey, jwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
    await idb('readwrite', (s) => s.put(nueva, ID));
    return nueva;
  })().catch(() => null);
  return llaves;
}

/** Prueba DPoP para `metodo` + `url` (sin query). Con `token`, incluye `ath`. null si no hay soporte. */
export async function pruebaDpop(metodo, url, token) {
  const ll = await obtenerLlaves();
  if (!ll) return null;
  const htu = new URL(url, window.location.origin);
  htu.search = '';
  htu.hash = '';
  const payload = {
    htm: metodo.toUpperCase(),
    htu: htu.href,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID ? crypto.randomUUID() : b64u(crypto.getRandomValues(new Uint8Array(18))),
    ...(token ? { ath: b64u(await crypto.subtle.digest('SHA-256', enc.encode(token))) } : {}),
  };
  const datos = `${b64uJson({ typ: 'dpop+jwt', alg: 'ES256', jwk: ll.jwk })}.${b64uJson(payload)}`;
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ll.privada, enc.encode(datos));
  return `${datos}.${b64u(firma)}`;
}
