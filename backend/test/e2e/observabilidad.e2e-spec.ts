import { NestExpressApplication } from '@nestjs/platform-express';
import { volcarMetricas } from '../../src/common/observabilidad/metricas-http';
import { bearer, createTestApp, db, describeDb, http, login, USERS } from './helpers';

/** Observabilidad: correlación por petición, métricas persistentes, telemetría de la web y panel. */
describeDb('Observabilidad (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let cliente: string;
  beforeAll(async () => {
    app = await createTestApp();
    admin = await login(app, USERS.admin);
    cliente = await login(app, USERS.cliente);
  });
  afterAll(() => app?.close());

  it('cada respuesta trae request_id, traceparent (misma traza) y Server-Timing', async () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const r = await http(app).get('/atracciones?limit=2').set('X-Request-Id', 'prueba-e2e-1234').set('traceparent', tp);
    expect(r.status).toBe(200);
    expect(r.headers['x-request-id']).toBe('prueba-e2e-1234');
    expect(r.headers.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    expect(r.headers['server-timing']).toMatch(/db;dur=[\d.]+;desc="\d+ consultas", total;dur=[\d.]+/);
    // Los errores RFC 7807 llevan el mismo request_id
    const e = await http(app).get('/atracciones/no-es-un-uuid').set('X-Request-Id', 'prueba-e2e-5678');
    expect(e.body.request_id).toBe('prueba-e2e-5678');
  });

  it('liveness siempre UP; readiness revisa la base y las migraciones', async () => {
    expect((await http(app).get('/ops/health/live')).body).toMatchObject({ status: 'UP' });
    const r = await http(app).get('/ops/health/ready');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'UP', checks: { database: { status: 'UP' }, migrations: { status: 'UP', pending: [] } } });
  });

  it('las peticiones quedan agregadas en ops.metrica_http por plantilla de ruta', async () => {
    await http(app).get('/atracciones?limit=1');
    await volcarMetricas();
    const filas = await db(app).query(
      `SELECT mh_ruta AS ruta, SUM(mh_total)::int AS total FROM ops.metrica_http WHERE mh_metodo = 'GET' AND mh_ruta LIKE '/atracciones%' GROUP BY 1`,
    );
    expect(filas).toEqual(expect.arrayContaining([expect.objectContaining({ ruta: '/atracciones' })]));
    // nunca una fila por id concreto
    expect(filas.every((f: { ruta: string }) => !/[0-9a-f]{8}-/.test(f.ruta))).toBe(true);
  });

  it('la web envía errores y Web Vitals; se guardan sin datos personales y con calificación del servidor', async () => {
    const r = await http(app).post('/ops/telemetria').send({
      senales: [
        { clase: 'error', tipo: 'excepcion', ruta: '/atraccion/:id', mensaje: 'TypeError: falló para ana@correo.ec', pila: 'at x (app.js:1:1)', version: '2.7.0', navegador: 'Chrome 141 · Android' },
        { clase: 'vital', ruta: '/explorar', nombre: 'LCP', valor: 5200, calificacion: 'good', dispositivo: 'movil', version: '2.7.0' },
        { clase: 'vital', ruta: '/explorar', nombre: 'CLS', valor: 0.02, calificacion: 'good', dispositivo: 'escritorio' },
      ],
    });
    expect(r.status).toBe(204);
    const [inc] = await db(app).query(`SELECT inc_mensaje AS m, inc_origen AS o FROM ops.incidente WHERE inc_ruta = '/atraccion/:id' ORDER BY inc_id DESC LIMIT 1`);
    expect(inc).toEqual({ m: 'TypeError: falló para [correo]', o: 'web' });
    const [lcp] = await db(app).query(`SELECT wv_calificacion AS c FROM ops.web_vital WHERE wv_nombre = 'LCP' ORDER BY wv_id DESC LIMIT 1`);
    expect(lcp.c).toBe('poor'); // 5200 ms es malo aunque el navegador diga lo contrario
  });

  it('rechaza telemetría inválida o demasiado grande', async () => {
    expect((await http(app).post('/ops/telemetria').send({ senales: [] })).status).toBe(400);
    expect((await http(app).post('/ops/telemetria').send({ senales: [{ clase: 'vital', ruta: '/', nombre: 'XYZ', valor: 1 }] })).status).toBe(400);
    const muchas = Array.from({ length: 21 }, () => ({ clase: 'vital', ruta: '/', nombre: 'FCP', valor: 100, dispositivo: 'movil' }));
    expect((await http(app).post('/ops/telemetria').send({ senales: muchas })).status).toBe(400);
  });

  it('el panel es solo para el administrador y trae totales, serie completa, SLO, incidentes y Web Vitals', async () => {
    expect((await http(app).get('/ops/resumen')).status).toBe(401);
    expect((await http(app).get('/ops/resumen').set(bearer(cliente))).status).toBe(403);
    const r = await http(app).get('/ops/resumen?rango=1h').set(bearer(admin));
    expect(r.status).toBe(200);
    expect(r.body.range).toBe('1h');
    expect(r.body.totals.requests).toBeGreaterThan(0);
    expect(r.body.series.length).toBeGreaterThanOrEqual(12); // barras de 5 minutos, también las vacías
    expect(r.body.slo).toMatchObject({ availability_target: 0.995, p95_target_ms: 1000 });
    expect(r.body.incidents.some((i: { route: string }) => i.route === '/atraccion/:id')).toBe(true);
    expect(r.body.web_vitals.map((v: { name: string }) => v.name)).toEqual(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
    expect(r.body.web_vitals.find((v: { name: string }) => v.name === 'LCP').samples).toBeGreaterThan(0);
    expect((await http(app).get('/ops/resumen?rango=1año').set(bearer(admin))).status).toBe(400);
  });
});
