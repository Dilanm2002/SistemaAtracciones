import { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'crypto';
import { createTestApp, describeDb, http, USERS } from './helpers';

/** Prueba DPoP como la genera el navegador (WebCrypto ES256). */
function llave() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return (htm: string, ruta: string, token?: string) => {
    const h = Buffer.from(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk })).toString('base64url');
    const ath = token ? { ath: createHash('sha256').update(token).digest('base64url') } : {};
    const p = Buffer.from(JSON.stringify({ htm, htu: `https://api.test${ruta}`, iat: Math.floor(Date.now() / 1000), jti: randomUUID(), ...ath })).toString('base64url');
    return `${h}.${p}.${createSign('sha256').update(`${h}.${p}`).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
}

/** WEB-008: un token emitido con DPoP solo sirve con una prueba firmada por la llave del navegador. */
describeDb('Sesión ligada al navegador con DPoP (E2E)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(() => app?.close());

  it('login con DPoP → token ligado; sin prueba, con Bearer o con otra llave no sirve', async () => {
    const probar = llave();
    const r = await http(app).post('/auth/login').set('DPoP', probar('POST', '/api/v1/auth/login')).send(USERS.cliente);
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe('DPoP');
    const token = r.body.access_token as string;

    // Con la llave correcta funciona
    const ok = await http(app).get('/auth/me').set('Authorization', `DPoP ${token}`).set('DPoP', probar('GET', '/api/v1/auth/me', token));
    expect(ok.status).toBe(200);
    // Token robado usado como Bearer o sin prueba → 401
    expect((await http(app).get('/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await http(app).get('/auth/me').set('Authorization', `DPoP ${token}`)).status).toBe(401);
    // Con una prueba de OTRA llave (el atacante no tiene la privada) → 401
    const otra = llave();
    expect((await http(app).get('/auth/me').set('Authorization', `DPoP ${token}`).set('DPoP', otra('GET', '/api/v1/auth/me', token))).status).toBe(401);
  });

  it('una prueba DPoP inválida en el login se rechaza (401)', async () => {
    expect((await http(app).post('/auth/login').set('DPoP', 'a.b.c').send(USERS.cliente)).status).toBe(401);
  });

  it('los clientes sin DPoP (integraciones) siguen usando Bearer', async () => {
    const r = await http(app).post('/auth/login').send(USERS.cliente);
    expect(r.body.token_type).toBe('Bearer');
    expect((await http(app).get('/auth/me').set('Authorization', `Bearer ${r.body.access_token}`)).status).toBe(200);
  });
});
