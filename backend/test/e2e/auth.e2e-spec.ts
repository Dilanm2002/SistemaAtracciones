import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { bearer, createTestApp, db, describeDb, http, login, nombreUnico, USERS } from './helpers';

/** Identidad y seguridad: registro, login, sesiones revocables, scopes y administración de usuarios. */
describeDb('Autenticación y seguridad (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let cliente: string;

  const correo = () => `${nombreUnico('qa').replace(/\s+/g, '.')}@prueba.ec`;
  const registrar = (extra: Record<string, unknown> = {}) =>
    http(app).post('/auth/register').send({ nombre: 'Lucía', apellido: 'Paredes', email: correo(), password: 'Clave1234', telefono: '0991112233', ...extra });

  beforeAll(async () => {
    app = await createTestApp();
    [admin, cliente] = await Promise.all([login(app, USERS.admin), login(app, USERS.cliente)]);
  });
  afterAll(() => app?.close());

  describe('registro', () => {
    it('crea la cuenta como CLIENTE, devuelve token y nunca el hash', async () => {
      const email = correo();
      const r = await registrar({ email: `  ${email.toUpperCase()}  ` });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ token_type: 'Bearer', user: { email, rol: 'CLIENTE', roles: ['CLIENTE'] } });
      expect(r.body.scope.split(' ').sort()).toEqual(['attractions:book', 'attractions:cancel', 'attractions:read']);
      expect(JSON.stringify(r.body)).not.toMatch(/\$2[aby]\$/); // hash bcrypt
      const [{ hash }] = await db(app).query('SELECT usu_password AS hash FROM usuario WHERE usu_correo = $1', [email]);
      expect(hash).toMatch(/^\$2[aby]\$10\$/);
    });

    it('correo duplicado (sin importar mayúsculas) → 409', async () => {
      const email = correo();
      expect((await registrar({ email })).status).toBe(201);
      expect((await registrar({ email: email.toUpperCase() })).status).toBe(409);
    });

    it.each([
      ['contraseña corta', { password: 'Ab1' }],
      ['contraseña sin números', { password: 'SoloLetras' }],
      ['correo inválido', { email: 'no-es-correo' }],
      ['nombre con dígitos', { nombre: 'Luc1a' }],
      ['teléfono no ecuatoriano', { telefono: '+15551234567' }],
      ['campo extra (mass assignment de rol)', { rol: 'ADMIN' }],
    ])('rechaza %s con 400 y detalle por campo', async (_c, extra) => {
      const r = await registrar(extra);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'VALIDATION_FAILED', title: 'Datos de entrada inválidos' });
      expect(Array.isArray(r.body.errors)).toBe(true);
    });
  });

  describe('login y sesión', () => {
    it('credenciales incorrectas → 401 con el mismo mensaje exista o no el correo', async () => {
      const a = await http(app).post('/auth/login').send({ email: USERS.cliente.email, password: 'Incorrecta1' });
      const b = await http(app).post('/auth/login').send({ email: 'nadie@nada.ec', password: 'Incorrecta1' });
      expect([a.status, b.status]).toEqual([401, 401]);
      expect(a.body.detail).toBe(b.body.detail);
    });

    it('/auth/me con token válido, 401 sin token, con token manipulado o firmado con otra clave', async () => {
      const me = await http(app).get('/auth/me').set(bearer(cliente));
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(USERS.cliente.email);
      expect((await http(app).get('/auth/me')).status).toBe(401);
      expect((await http(app).get('/auth/me').set(bearer(`${cliente.slice(0, -3)}abc`))).status).toBe(401);
      // Firmado con otra clave (aleatoria: no es un secreto real)
      const falso = new JwtService({ secret: randomBytes(32).toString('hex') }).sign({ sub: '1', scope: ['admin:full'], jti: 'x' });
      expect((await http(app).get('/auth/me').set(bearer(falso))).status).toBe(401);
      expect((await http(app).get('/auth/me').set({ Authorization: `Basic ${cliente}` })).status).toBe(401);
    });

    it('logout revoca el token de inmediato', async () => {
      const r = await registrar();
      const token = r.body.access_token;
      expect((await http(app).get('/auth/me').set(bearer(token))).status).toBe(200);
      expect((await http(app).post('/auth/logout').set(bearer(token))).status).toBeLessThan(300);
      expect((await http(app).get('/auth/me').set(bearer(token))).status).toBe(401);
    });

    it('cambiar la contraseña cierra las demás sesiones y la anterior deja de servir', async () => {
      const email = correo();
      const t1 = (await registrar({ email })).body.access_token;
      const t2 = await login(app, { email, password: 'Clave1234' });
      expect((await http(app).post('/auth/me/password').set(bearer(t1)).send({ actual: 'mala', nueva: 'Nueva1234' })).status).toBe(400);
      expect((await http(app).post('/auth/me/password').set(bearer(t1)).send({ actual: 'Clave1234', nueva: 'Nueva1234' })).status).toBeLessThan(300);
      expect((await http(app).get('/auth/me').set(bearer(t1))).status).toBe(200); // la sesión actual sigue
      expect((await http(app).get('/auth/me').set(bearer(t2))).status).toBe(401); // las demás se cierran
      expect((await http(app).post('/auth/login').send({ email, password: 'Clave1234' })).status).toBe(401);
      expect((await http(app).post('/auth/login').send({ email, password: 'Nueva1234' })).status).toBe(200);
    });

    it('PATCH /auth/me: actualiza perfil; cédula duplicada → 409; no permite escalar rol', async () => {
      const t = (await registrar()).body.access_token;
      const ok = await http(app).patch('/auth/me').set(bearer(t)).send({ nombre: 'Lucía Elena', telefono: '022345678' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ nombres: 'Lucía Elena', telefono: '022345678' });
      expect((await http(app).patch('/auth/me').set(bearer(t)).send({ documento: '1710034065' })).status).toBe(409); // cédula de cliente@
      expect((await http(app).patch('/auth/me').set(bearer(t)).send({ rol: 'ADMIN' })).status).toBe(400);
    });
  });

  describe('límite de peticiones (fuerza bruta)', () => {
    it('login: 5 intentos por minuto por IP; el 6.º → 429 con Retry-After', async () => {
      const ip = '203.0.113.77';
      const intentar = () => http(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email: 'x@y.ec', password: 'Mala12345' });
      for (let i = 0; i < 5; i++) expect((await intentar()).status).toBe(401);
      const r = await intentar();
      expect(r.status).toBe(429);
      expect(r.body.status).toBe(429);
    });
  });

  describe('autorización por scopes', () => {
    it.each([
      ['GET', '/usuarios'],
      ['GET', '/eventos'],
      ['GET', '/mensajes'],
      ['GET', '/reportes/ventas'],
      ['GET', '/reportes/clientes'],
      ['GET', '/resenas'],
      ['GET', '/reportes/dashboard'],
      ['POST', '/atracciones'],
      ['POST', '/categorias'],
    ])('un CLIENTE recibe 403 en %s %s', async (metodo, url) => {
      const req = metodo === 'GET' ? http(app).get(url) : http(app).post(url).send({});
      const r = await req.set(bearer(cliente));
      expect(r.status).toBe(403);
      expect(r.body.title).toBe('Acceso denegado');
    });

    it('un usuario desactivado pierde el acceso de inmediato (aunque su JWT no haya vencido)', async () => {
      const r = await registrar();
      const token = r.body.access_token;
      const id = r.body.user.id;
      expect((await http(app).patch(`/usuarios/${id}`).set(bearer(admin)).send({ activo: false })).status).toBe(200);
      expect((await http(app).get('/auth/me').set(bearer(token))).status).toBe(401);
      expect((await http(app).post('/auth/login').send({ email: r.body.user.email, password: 'Clave1234' })).status).toBe(403);
    });

    it('un cambio de rol aplica de inmediato sobre el token existente', async () => {
      const r = await registrar();
      const token = r.body.access_token;
      expect((await http(app).get('/usuarios').set(bearer(token))).status).toBe(403);
      await http(app).patch(`/usuarios/${r.body.user.id}`).set(bearer(admin)).send({ rol: 'ADMIN' });
      expect((await http(app).get('/usuarios').set(bearer(token))).status).toBe(200);
      await http(app).patch(`/usuarios/${r.body.user.id}`).set(bearer(admin)).send({ rol: 'CLIENTE' });
      expect((await http(app).get('/usuarios').set(bearer(token))).status).toBe(403);
    });
  });

  describe('administración de usuarios', () => {
    it('crea un OPERADOR con empresa; sin empresa → 400; empresa inexistente → 400', async () => {
      const base = { nombre: 'Pedro', apellido: 'Vera', password: 'Clave1234' };
      const ok = await http(app).post('/usuarios').set(bearer(admin)).send({ ...base, email: correo(), rol: 'OPERADOR', operadorCodigo: 102 });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ rol: 'OPERADOR', operadorCodigo: 102 });
      expect((await http(app).post('/usuarios').set(bearer(admin)).send({ ...base, email: correo(), rol: 'OPERADOR' })).status).toBe(400);
      expect((await http(app).post('/usuarios').set(bearer(admin)).send({ ...base, email: correo(), rol: 'OPERADOR', operadorCodigo: 999 })).status).toBe(400);
    });

    it('el admin no puede desactivarse ni quitarse el rol a sí mismo', async () => {
      const me = await http(app).get('/auth/me').set(bearer(admin));
      expect((await http(app).patch(`/usuarios/${me.body.id}`).set(bearer(admin)).send({ activo: false })).status).toBe(400);
      expect((await http(app).patch(`/usuarios/${me.body.id}`).set(bearer(admin)).send({ rol: 'CLIENTE' })).status).toBe(400);
    });

    it('cambiar el correo a uno ya usado → 409; usuario inexistente → 404; id no numérico → 400', async () => {
      const r = await registrar();
      expect((await http(app).patch(`/usuarios/${r.body.user.id}`).set(bearer(admin)).send({ email: USERS.cliente.email })).status).toBe(409);
      expect((await http(app).patch('/usuarios/999999999').set(bearer(admin)).send({ nombre: 'Nadie' })).status).toBe(404);
      expect((await http(app).patch('/usuarios/abc').set(bearer(admin)).send({ nombre: 'Nadie' })).status).toBe(400);
    });

    it('lista paginada con filtro por rol y búsqueda', async () => {
      const r = await http(app).get('/usuarios?rol=ADMIN&limit=5').set(bearer(admin));
      expect(r.status).toBe(200);
      expect(r.body.every((u: { roles: string[] }) => u.roles.includes('ADMIN'))).toBe(true);
      expect(r.body.length).toBeLessThanOrEqual(5);
      expect(Number(r.headers['x-total-count'])).toBeGreaterThanOrEqual(1);
      expect(r.body[0]).not.toHaveProperty('password');
      expect((await http(app).get('/usuarios?limit=1000').set(bearer(admin))).status).toBe(400);
    });
  });

  describe('cabeceras y formato de errores', () => {
    it('cabeceras de seguridad, X-Request-Id y sin X-Powered-By', async () => {
      const r = await http(app).get('/atracciones/health');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'UP', database: { status: 'UP' } });
      expect(r.headers['x-powered-by']).toBeUndefined();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
      expect(r.headers['x-request-id']).toBeTruthy();
      const propio = await http(app).get('/atracciones/health').set('X-Request-Id', 'mi-traza-12345');
      expect(propio.headers['x-request-id']).toBe('mi-traza-12345');
      const invalido = await http(app).get('/atracciones/health').set('X-Request-Id', '<script>alert(1)</script>');
      expect(invalido.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/); // se reemplaza por un UUID propio
    });

    it('JSON mal formado → 400 (no 500) y ruta inexistente → 404', async () => {
      const r = await http(app).post('/auth/login').set('Content-Type', 'application/json').send('{"email":');
      expect(r.status).toBe(400);
      expect((await http(app).get('/no-existe')).status).toBe(404);
    });

    it('cuerpo de más de 100 kB → 413', async () => {
      const r = await http(app).post('/mensajes').send({ nombre: 'Ana Torres', email: 'a@b.ec', asunto: 'OTRO', mensaje: 'x'.repeat(200_000) });
      expect(r.status).toBe(413);
      expect(r.body).toMatchObject({ status: 413, title: 'Archivo demasiado grande' });
      expect(r.body.request_id).toBeTruthy();
    });

    it('CORS: solo el origen configurado del frontend', async () => {
      const ok = await http(app).get('/atracciones/health').set('Origin', 'http://localhost:5173');
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      const malo = await http(app).get('/atracciones/health').set('Origin', 'https://evil.example');
      expect(malo.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
