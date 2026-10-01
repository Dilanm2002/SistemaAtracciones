import { createSign, generateKeyPairSync, randomUUID } from 'crypto';
import { hashAth, huellaJwk, verificarPruebaDpop } from './dpop';

/** Genera una prueba DPoP como lo hace el navegador (ES256, firma en formato IEEE P1363). */
function nuevaLlave() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
  const probar = (htm: string, htu: string, extra: Record<string, unknown> = {}) => {
    const h = Buffer.from(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ htm, htu, iat: Math.floor(Date.now() / 1000), jti: randomUUID(), ...extra })).toString('base64url');
    const firma = createSign('sha256').update(`${h}.${p}`).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${h}.${p}.${firma}`;
  };
  return { jwk, probar };
}

describe('DPoP (RFC 9449) — token ligado al navegador (WEB-008)', () => {
  const URL_LOGIN = 'https://api.test/api/v1/auth/login';

  it('acepta una prueba válida y devuelve la huella de la llave', () => {
    const { jwk, probar } = nuevaLlave();
    expect(verificarPruebaDpop(probar('POST', URL_LOGIN), 'POST', '/api/v1/auth/login')).toEqual({ jkt: huellaJwk(jwk) });
  });

  it('rechaza otro método, otra ruta, hora fuera de ventana, repetición y firma alterada', () => {
    const { probar } = nuevaLlave();
    expect(() => verificarPruebaDpop(probar('GET', URL_LOGIN), 'POST', '/api/v1/auth/login')).toThrow(/método/);
    expect(() => verificarPruebaDpop(probar('POST', 'https://api.test/api/v1/otra'), 'POST', '/api/v1/auth/login')).toThrow(/URL/);
    expect(() => verificarPruebaDpop(probar('POST', URL_LOGIN, { iat: 1 }), 'POST', '/api/v1/auth/login')).toThrow(/hora/);
    const una = probar('POST', URL_LOGIN);
    verificarPruebaDpop(una, 'POST', '/api/v1/auth/login');
    expect(() => verificarPruebaDpop(una, 'POST', '/api/v1/auth/login')).toThrow(/repetida/);
    const alterada = probar('POST', URL_LOGIN).slice(0, -4) + 'AAAA';
    expect(() => verificarPruebaDpop(alterada, 'POST', '/api/v1/auth/login')).toThrow(/firma/);
  });

  it('con token exige ath = hash del token (no sirve una prueba de otro token)', () => {
    const { probar } = nuevaLlave();
    const url = 'https://api.test/api/v1/auth/me';
    expect(() => verificarPruebaDpop(probar('GET', url, { ath: hashAth('token-a') }), 'GET', '/api/v1/auth/me', { token: 'token-a' })).not.toThrow();
    expect(() => verificarPruebaDpop(probar('GET', url, { ath: hashAth('token-a') }), 'GET', '/api/v1/auth/me', { token: 'token-b' })).toThrow(/no corresponde/);
  });
});
