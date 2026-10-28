import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import request = require('supertest');
import { crearGateway } from '../src/app';
import { rutear } from '../src/rutas';

interface Recibido {
  metodo: string;
  url: string;
  headers: IncomingHttpHeaders;
  cuerpo: string;
}

/** Servicio falso que registra lo que recibe y responde 200 con su nombre (o su salud). */
async function servicio(nombre: string) {
  const recibidos: Recibido[] = [];
  let salud: 'UP' | 'DOWN' | 'apagado' = 'UP';
  const s: Server = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      if (salud === 'apagado') return void req.socket.destroy();
      if (/health/.test(req.url ?? '')) {
        res.writeHead(salud === 'UP' ? 200 : 503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: salud, node_code: 'DILAN_ATRACCIONES', node_id: 'n1', version: '2.10.0', database_connected: true }));
        return;
      }
      recibidos.push({ metodo: req.method!, url: req.url!, headers: req.headers, cuerpo });
      res.writeHead(201, { 'content-type': 'application/json', location: '/api/v3/atracciones/reservas/abc' }).end(JSON.stringify({ atendido_por: nombre }));
    });
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
    recibidos,
    estado: (e: typeof salud) => (salud = e),
    cerrar: () => new Promise<void>((ok) => s.close(() => ok())),
  };
}

describe('tabla de ruteo', () => {
  it.each([
    ['GET', '/api/v3/atracciones', 'catalogo'],
    ['GET', '/api/v3/atracciones?city=Quito&page=2', 'catalogo'],
    ['POST', '/api/v3/atracciones/search', 'catalogo'],
    ['GET', '/api/v2/atracciones/categorias', 'catalogo'],
    ['GET', '/api/v3/atracciones/categorias/arbol', 'catalogo'],
    ['GET', '/api/v3/atracciones/quito-city-tour', 'catalogo'],
    ['GET', '/api/v3/atracciones/f47ac10b-58cc-4372-a567-0e02b2c3d479', 'catalogo'],
    ['GET', '/api/v3/atracciones/f47ac10b-58cc-4372-a567-0e02b2c3d479/disponibilidad?date=2026-11-01', 'tienda'],
    ['POST', '/api/v3/atracciones/reservas', 'tienda'],
    ['GET', '/api/v3/atracciones/reservas', 'tienda'],
    ['GET', '/api/v3/atracciones/reservas/DEC-7F3K9Q', 'tienda'],
    ['POST', '/api/v3/atracciones/reservas/x/cancel', 'tienda'],
    ['GET', '/api/v3/atracciones/eventos', 'tienda'],
    ['GET', '/api/v3/atracciones/promociones/contrato', 'tienda'],
    ['POST', '/api/v3/reservas', 'tienda'],
    ['POST', '/api/v3/atracciones', 'tienda'],
    ['GET', '/api/v1/atracciones', 'tienda'],
    ['GET', '/ms/location/v1/ciudades', 'location'],
    ['GET', '/ms/review/v1/resenas?atr_id=1', 'review'],
    ['GET', '/ms/catalog/v1/atracciones', 'catalogo'],
  ])('%s %s → %s', (metodo, url, destino) => {
    expect(rutear(metodo, url).destino).toBe(destino);
  });

  it('/ms/<servicio>/… se reescribe a /api/… del servicio', () => {
    expect(rutear('GET', '/ms/location/v1/ciudades?q=quito').ruta).toBe('/api/v1/ciudades?q=quito');
  });
});

describe('API Gateway', () => {
  let app: NestExpressApplication;
  let tienda: Awaited<ReturnType<typeof servicio>>;
  let catalogo: Awaited<ReturnType<typeof servicio>>;
  let location: Awaited<ReturnType<typeof servicio>>;
  let review: Awaited<ReturnType<typeof servicio>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    [tienda, catalogo, location, review] = await Promise.all(['tienda', 'catalogo', 'location', 'review'].map(servicio));
    Object.assign(process.env, { NODE_ENV: 'test', TIENDA_URL: tienda.url, CATALOG_URL: catalogo.url, LOCATION_URL: location.url, REVIEW_URL: review.url });
    app = await crearGateway();
  });
  afterAll(async () => {
    await app?.close();
    await Promise.all([tienda, catalogo, location, review].map((s) => s?.cerrar()));
  });

  it('la compra de Booking llega a la tienda intacta: cuerpo, X-API-Key, Idempotency-Key y X-Correlation-Id; vuelve el Location', async () => {
    const cuerpo = { attraction_id: 'x', slot_id: 'slot-20261101-0900', adult_count: 2 };
    const r = await http().post('/api/v3/reservas').set('X-API-Key', 'clave-123').set('Idempotency-Key', 'k-1').set('X-Correlation-Id', 'cid-gw-1').send(cuerpo);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ atendido_por: 'tienda' });
    expect(r.headers.location).toBe('/api/v3/atracciones/reservas/abc');
    expect(r.headers['x-correlation-id']).toBe('cid-gw-1');
    const rec = tienda.recibidos.at(-1)!;
    expect(rec).toMatchObject({ metodo: 'POST', url: '/api/v3/reservas' });
    expect(JSON.parse(rec.cuerpo)).toEqual(cuerpo);
    expect(rec.headers).toMatchObject({ 'x-api-key': 'clave-123', 'idempotency-key': 'k-1', 'x-correlation-id': 'cid-gw-1' });
  });

  it('el catálogo lo atiende ms_catalog y las APIs propias se reescriben; genera X-Correlation-Id si no llega', async () => {
    const r = await http().post('/api/v3/atracciones/search').send({ query: 'quito' });
    expect(r.body).toEqual({ atendido_por: 'catalogo' });
    expect(r.headers['x-atendido-por']).toBe('catalogo');
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(catalogo.recibidos.at(-1)!.cuerpo)).toEqual({ query: 'quito' });
    await http().get('/ms/location/v1/ciudades?q=quito');
    expect(location.recibidos.at(-1)!.url).toBe('/api/v1/ciudades?q=quito');
  });

  it('salud agregada: UP con todo arriba; DEGRADED si cae ms_review; DOWN (503) si cae ms_catalog o la tienda', async () => {
    const r = await http().get('/api/v3/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'UP', node_code: 'DILAN_ATRACCIONES', dependencias: expect.arrayContaining([{ servicio: 'catalogo', status: 'UP', latency_ms: expect.any(Number) }]) });
    review.estado('apagado');
    expect((await http().get('/api/v2/atracciones/health')).body.status).toBe('DEGRADED');
    review.estado('UP');
    catalogo.estado('DOWN');
    const caido = await http().get('/api/v3/atracciones/health');
    expect(caido.status).toBe(503);
    expect(caido.body.status).toBe('DOWN');
    catalogo.estado('UP');
  });

  describe('SIN_TIENDA=true (el nodo solo publica ms_location, ms_catalog y ms_review)', () => {
    beforeAll(() => (process.env.SIN_TIENDA = 'true'));
    afterAll(() => delete process.env.SIN_TIENDA);

    it.each([
      ['GET', '/api/v3/atracciones/f47ac10b-58cc-4372-a567-0e02b2c3d479/disponibilidad?date=2026-11-01', 'ms_inventory (Alisson)'],
      ['POST', '/api/v3/reservas', 'ms_booking / ms_order (Alisson)'],
      ['POST', '/api/v3/atracciones/reservas/x/checkin', 'ms_booking / ms_order (Alisson)'],
      ['GET', '/api/v3/atracciones/promociones/contrato', 'ms_pricing / ms_coupon (Michael)'],
    ])('%s %s → 503 RFC 7807 que dice que lo atiende %s, sin tocar la tienda', async (metodo, url, dueno) => {
      const antes = tienda.recibidos.length;
      const r = await (metodo === 'GET' ? http().get(url) : http().post(url).send({})).set('X-Correlation-Id', 'cid-pend');
      expect(r.status).toBe(503);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body).toMatchObject({ code: 'SERVICIO_NO_CONECTADO', status: 503, correlation_id: 'cid-pend' });
      expect(r.body.detail).toContain(dueno);
      expect(tienda.recibidos.length).toBe(antes);
    });

    it('el catálogo sigue llegando a ms_catalog', async () => {
      const r = await http().get('/api/v3/atracciones?limit=50');
      expect(r.body).toEqual({ atendido_por: 'catalogo' });
    });

    it('la salud no consulta la tienda: UP con los 3 microservicios y cumple los campos de NodeHealthResponse', async () => {
      tienda.estado('apagado');
      try {
        const r = await http().get('/api/v3/health');
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ status: 'UP', node_id: expect.any(String), node_code: expect.any(String), version: expect.any(String), database_connected: true, latency_ms: expect.any(Number), timestamp: expect.any(String) });
        expect(r.body.dependencias.map((d: { servicio: string }) => d.servicio)).toEqual(['catalogo', 'location', 'review']);
        catalogo.estado('DOWN');
        const caido = await http().get('/api/v3/health');
        expect(caido.status).toBe(503);
        expect(caido.body).toMatchObject({ status: 'DOWN', database_connected: false });
      } finally {
        tienda.estado('UP');
        catalogo.estado('UP');
      }
    });
  });

  it('si el destino no responde: 503 RFC 7807 con correlation id', async () => {
    catalogo.estado('apagado');
    try {
      const r = await http().get('/api/v3/atracciones').set('X-Correlation-Id', 'cid-caido');
      expect([502, 503]).toContain(r.status);
      expect(r.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', correlation_id: 'cid-caido' });
    } finally {
      catalogo.estado('UP');
    }
  });
});
