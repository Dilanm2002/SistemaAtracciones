import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import request = require('supertest');
import { crearGateway } from '../src/app';
import { Destino, DESTINOS, rutear } from '../src/rutas';

interface Recibido {
  metodo: string;
  url: string;
  headers: IncomingHttpHeaders;
  cuerpo: string;
}

/** Servicio falso que registra lo que recibe y responde 201 con su nombre (o su salud). */
async function servicio(nombre: string) {
  const recibidos: Recibido[] = [];
  let salud: 'UP' | 'DOWN' | 'apagado' = 'UP';
  const s: Server = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      if (salud === 'apagado') return void req.socket.destroy();
      if (req.url === '/api/v1/health') {
        res.writeHead(salud === 'UP' ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: salud, service: nombre, database_connected: salud === 'UP' }));
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

describe('tabla de ruteo (cada ruta del contrato v3 a su microservicio)', () => {
  const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  it.each([
    ['GET', '/api/v3/atracciones', 'catalogo'],
    ['GET', '/api/v3/atracciones?city=Quito&page=2', 'catalogo'],
    ['POST', '/api/v3/atracciones/search', 'catalogo'],
    ['GET', '/api/v2/atracciones/categorias', 'catalogo'],
    ['GET', '/api/v3/atracciones/categorias/arbol', 'catalogo'],
    ['GET', '/api/v3/atracciones/quito-city-tour', 'catalogo'],
    ['GET', `/api/v3/atracciones/${uuid}`, 'catalogo'],
    ['GET', `/api/v3/atracciones/${uuid}/disponibilidad?date=2026-11-01`, 'inventory'],
    ['GET', '/api/v3/clientes?email=a@b.com', 'identity'],
    ['POST', '/api/v3/clientes', 'identity'],
    ['POST', '/bff/v1/atracciones/search', 'bff'],
    ['POST', '/api/v3/atracciones/reservas', 'booking'],
    ['GET', '/api/v3/atracciones/reservas/DEC-7F3K9Q', 'booking'],
    ['POST', '/api/v3/atracciones/reservations/DEC-7F3K9Q/checkin', 'booking'],
    ['POST', '/api/v3/reservations/DEC-7F3K9Q/cancel', 'booking'],
    ['POST', '/api/v3/atracciones/reservas/x/cancel', 'booking'],
    ['POST', '/api/v3/atracciones/reservas/x/checkin', 'booking'],
    ['GET', '/api/v3/atracciones/vouchers/DEC-7F3K9Q/qr.png', 'booking'],
    ['GET', '/api/v3/atracciones/eventos?after=10', 'booking'],
    ['POST', '/api/v3/reservas', 'booking'],
    ['GET', '/api/v3/reservas/abc', 'booking'],
    ['GET', `/api/v1/calendario/${uuid}.ics?t=1.x`, 'booking'],
    ['GET', '/api/v3/atracciones/promociones/contrato', 'coupon'],
    ['PUT', '/api/v2/atracciones/promociones/contrato', 'coupon'],
    ['GET', '/ms/location/v1/ciudades', 'location'],
    ['GET', '/ms/review/v1/resenas?atr_id=1', 'review'],
    ['GET', '/ms/inventory/v1/horarios?atr_id=1', 'inventory'],
    ['GET', '/ms/payment/v1/metodos-pago', 'payment'],
  ])('%s %s → %s', (metodo, url, destino) => {
    expect(rutear(metodo, url).destino).toBe(destino);
  });

  it.each([
    ['POST', '/api/v3/atracciones'],
    ['GET', '/api/v1/atracciones'],
    ['GET', '/ms/payment/v1/internal/pagos/1'], // las rutas internas nunca se publican
    ['GET', '/ms/desconocido/v1/x'],
    ['GET', '/cualquier/cosa'],
  ])('%s %s → no es del contrato (404)', (metodo, url) => {
    expect(rutear(metodo, url).destino).toBeNull();
  });

  it('/ms/<servicio>/… se reescribe a /api/… del servicio', () => {
    expect(rutear('GET', '/ms/location/v1/ciudades?q=quito').ruta).toBe('/api/v1/ciudades?q=quito');
    // «reservations» (inglés) llega a ms-booking como «reservas», la ruta que atiende
    expect(rutear('POST', '/api/v3/atracciones/reservations/DEC-VTRLBL/checkin').ruta).toBe('/api/v3/atracciones/reservas/DEC-VTRLBL/checkin');
    expect(rutear('GET', '/api/v3/reservations/DEC-VTRLBL?x=1').ruta).toBe('/api/v3/reservas/DEC-VTRLBL?x=1');
    expect(rutear('POST', '/bff/v1/atracciones/reservations/x/checkin').ruta).toBe('/api/v1/atracciones/reservations/x/checkin');
  });
});

describe('API Gateway', () => {
  let app: NestExpressApplication;
  const s = {} as Record<Destino, Awaited<ReturnType<typeof servicio>>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    for (const d of DESTINOS) {
      s[d] = await servicio(d);
      process.env[d === 'catalogo' ? 'CATALOG_URL' : `${d.toUpperCase()}_URL`] = s[d].url;
    }
    process.env.NODE_ENV = 'test';
    app = await crearGateway();
  });
  afterAll(async () => {
    await app?.close();
    await Promise.all(Object.values(s).map((x) => x.cerrar()));
  });

  it('la compra de Booking llega a ms_booking intacta: cuerpo, X-API-Key, Idempotency-Key y X-Correlation-Id; vuelve el Location', async () => {
    const cuerpo = { attraction_id: 'x', slot_id: 'slot-20261101-0900', adult_count: 2 };
    const r = await http().post('/api/v3/reservas').set('X-API-Key', 'clave-123').set('Idempotency-Key', 'k-1').set('X-Correlation-Id', 'cid-gw-1').send(cuerpo);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ atendido_por: 'booking' });
    expect(r.headers.location).toBe('/api/v3/atracciones/reservas/abc');
    expect(r.headers['x-correlation-id']).toBe('cid-gw-1');
    expect(r.headers['x-atendido-por']).toBe('booking');
    const rec = s.booking.recibidos.at(-1)!;
    expect(rec).toMatchObject({ metodo: 'POST', url: '/api/v3/reservas' });
    expect(JSON.parse(rec.cuerpo)).toEqual(cuerpo);
    expect(rec.headers).toMatchObject({ 'x-api-key': 'clave-123', 'idempotency-key': 'k-1', 'x-correlation-id': 'cid-gw-1' });
  });

  it('catálogo, disponibilidad y promociones van a su servicio; genera X-Correlation-Id si no llega', async () => {
    const r = await http().post('/api/v3/atracciones/search').send({ query: 'quito' });
    expect(r.body).toEqual({ atendido_por: 'catalogo' });
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await http().get('/api/v3/atracciones/quito/disponibilidad?date=2026-11-01')).body).toEqual({ atendido_por: 'inventory' });
    expect((await http().get('/api/v3/atracciones/promociones/contrato')).body).toEqual({ atendido_por: 'coupon' });
    await http().get('/ms/location/v1/ciudades?q=quito');
    expect(s.location.recibidos.at(-1)!.url).toBe('/api/v1/ciudades?q=quito');
  });

  it('lo que no es del contrato → 404 RFC 7807 del propio gateway (no se reenvía a nadie)', async () => {
    const antes = DESTINOS.reduce((n, d) => n + s[d].recibidos.length, 0);
    const r = await http().get('/ms/payment/v1/internal/pagos/1').set('X-Correlation-Id', 'cid-404');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body).toMatchObject({ code: 'NOT_FOUND', correlation_id: 'cid-404' });
    expect((await http().post('/api/v3/atracciones').send({})).status).toBe(404);
    expect(DESTINOS.reduce((n, d) => n + s[d].recibidos.length, 0)).toBe(antes);
  });

  it('salud agregada de los 12: UP; DEGRADED si cae uno no crítico; DOWN (503) si cae catálogo, inventario o reservas', async () => {
    const r = await http().get('/api/v3/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'UP', node_id: expect.any(String), node_code: expect.any(String), version: expect.any(String), database_connected: true, latency_ms: expect.any(Number) });
    expect(r.body.dependencias.map((d: { servicio: string }) => d.servicio)).toEqual(DESTINOS);
    s.review.estado('apagado');
    expect((await http().get('/api/v2/atracciones/health')).body.status).toBe('DEGRADED');
    s.review.estado('UP');
    for (const critico of ['catalogo', 'inventory', 'booking'] as const) {
      s[critico].estado('DOWN');
      const caido = await http().get('/api/v3/atracciones/health');
      expect(caido.status).toBe(503);
      expect(caido.body).toMatchObject({ status: 'DOWN', database_connected: false });
      s[critico].estado('UP');
    }
  });

  it('si el destino no responde: 503 RFC 7807 con correlation id', async () => {
    s.catalogo.estado('apagado');
    try {
      const r = await http().get('/api/v3/atracciones').set('X-Correlation-Id', 'cid-caido');
      expect([502, 503]).toContain(r.status);
      expect(r.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', correlation_id: 'cid-caido' });
    } finally {
      s.catalogo.estado('UP');
    }
  });

  it('/gateway/rutas muestra el reparto para la demo', async () => {
    const r = await http().get('/gateway/rutas');
    expect(r.body).toEqual(expect.arrayContaining([{ metodo: 'GET', ruta: '/api/v3/atracciones/{id}/disponibilidad', destino: 'inventory' }, { metodo: 'POST', ruta: '/api/v3/reservas', destino: 'booking' }]));
  });
});
