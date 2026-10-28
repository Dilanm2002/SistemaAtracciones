import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { DespachadorEventos } from '../src/resenas';
import { join } from 'path';
import { baseVacia, Contrato, contratoPropio, describeDb } from './helpers';

const CATALOGO = join(__dirname, '..', '..', 'ms-catalog', 'contract');
const SECRETO = 'secreto-de-pruebas-de-ms-review-0123456789';
const TOKEN_SERVICIOS = 'token-servicios-pruebas-123';

function jwt(claims: Record<string, unknown>) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ exp: Math.floor(Date.now() / 1000) + 600, ...claims })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

/** ms_catalog falso: la atracción 1 existe; recibe los eventos (y puede fallar a propósito). */
async function catalogoFalso() {
  const recibidos: { cuerpo: Record<string, unknown>; headers: IncomingHttpHeaders }[] = [];
  let caido = false;
  const s: Server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(req.url === '/api/v1/atracciones/1' ? 200 : 404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      if (caido) return void res.writeHead(503).end();
      recibidos.push({ cuerpo: JSON.parse(datos), headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"procesado":true}');
    });
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { url, recibidos, caer: (v: boolean) => (caido = v), cerrar: () => new Promise<void>((ok) => s.close(() => ok())) };
}

describeDb('ms_review', () => {
  let app: NestExpressApplication;
  let catalogo: Awaited<ReturnType<typeof catalogoFalso>>;
  const contrato = contratoPropio();
  // Contrato del consumidor del evento (ms_catalog), con el de Booking al que hace referencia
  const contratoCatalogo = new Contrato(join(CATALOGO, 'openapi.yaml'), 'catalogo', [join(CATALOGO, 'booking-atracciones-v3.yaml')]);
  const http = () => request(app.getHttpServer());
  const despachar = () => app.get(DespachadorEventos).despachar();

  beforeAll(async () => {
    catalogo = await catalogoFalso();
    Object.assign(process.env, { CATALOG_URL: catalogo.url, EVENTOS_DESTINOS: `${catalogo.url}/api/v1/internal/eventos`, JWT_SECRET: SECRETO, SERVICIOS_TOKEN: TOKEN_SERVICIOS });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-review');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await catalogo?.cerrar();
  });

  it('reseña de un usuario (token) y anónima; cumplen el contrato; una por usuario (409)', async () => {
    const ana = jwt({ sub: '15', rol: 'CLIENTE' });
    const r = await http().post('/api/v1/resenas').set('Authorization', `Bearer ${ana}`).set('X-Correlation-Id', 'cid-resena-1')
      .send({ atr_id: 1, ren_puntuacion: 5, ren_comentario: 'Excelente guía y muy puntual.', ren_limpieza: 5, ren_servicio: 4 });
    expect(r.status).toBe(201);
    expect(contrato.respuesta('POST', '/resenas', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ usu_id: 15, ren_autor_nombre: null, ren_puntuacion: 5 });

    const anonima = await http().post('/api/v1/resenas').send({ atr_id: 1, ren_puntuacion: 3, ren_comentario: 'Bien, pero algo caro.', ren_autor_nombre: 'Viajero' });
    expect(anonima.status).toBe(201);
    expect(anonima.body).toMatchObject({ usu_id: null, ren_autor_nombre: 'Viajero' });

    const otra = await http().post('/api/v1/resenas').set('Authorization', `Bearer ${ana}`).send({ atr_id: 1, ren_puntuacion: 1, ren_comentario: 'Otra opinión distinta.' });
    expect(otra.status).toBe(409);
    expect(contrato.respuesta('POST', '/resenas', 409, otra.body)).toEqual([]);
  });

  it('validaciones: sin nombre ni token 422, atracción inexistente 422, token falso 401, nota fuera de rango 400', async () => {
    expect((await http().post('/api/v1/resenas').send({ atr_id: 1, ren_puntuacion: 4, ren_comentario: 'Sin nombre ni token.' })).status).toBe(422);
    const noExiste = await http().post('/api/v1/resenas').send({ atr_id: 99, ren_puntuacion: 4, ren_comentario: 'Atracción que no existe.', ren_autor_nombre: 'X Y' });
    expect(noExiste.status).toBe(422);
    expect(noExiste.body.code).toBe('INVALID_REFERENCE');
    expect((await http().post('/api/v1/resenas').set('Authorization', 'Bearer abc.def.ghi').send({ atr_id: 1, ren_puntuacion: 4, ren_comentario: 'Token inválido aquí.' })).status).toBe(401);
    const mal = await http().post('/api/v1/resenas').send({ atr_id: 1, ren_puntuacion: 9, ren_comentario: 'corto' });
    expect(mal.status).toBe(400);
    expect(mal.body.invalid_params.map((p: { name: string }) => p.name).sort()).toEqual(['ren_comentario', 'ren_puntuacion']);
  });

  it('listado y resumen (un pilar sin nota cuenta con la nota general)', async () => {
    const l = await http().get('/api/v1/resenas?atr_id=1');
    expect(contrato.respuesta('GET', '/resenas', 200, l.body)).toEqual([]);
    expect(l.body.total).toBe(2);
    const r = await http().get('/api/v1/resenas/resumen?atr_id=1');
    expect(contrato.respuesta('GET', '/resenas/resumen', 200, r.body)).toEqual([]);
    expect(r.body).toEqual({ atr_id: 1, atr_calificacion_promedio: 4, atr_numero_resenas: 2, pilares: { limpieza: 4, servicio: 3.5, relacion_valor: 4, puntualidad: 4 } });
    expect((await http().get('/api/v1/resenas/9999')).status).toBe(404);
  });

  it('RESENA_PUBLICADA sale por el outbox hacia ms_catalog, en orden, con token de servicio y correlation id; reintenta si falla', async () => {
    expect(await despachar()).toBe(2);
    expect(catalogo.recibidos).toHaveLength(2);
    const [primero, segundo] = catalogo.recibidos;
    expect(contrato.esquema('EventoResenaPublicada', primero.cuerpo)).toEqual([]);
    // Contrato dirigido por el consumidor: lo que envía ms_review lo acepta el contrato de ms_catalog
    expect(contratoCatalogo.esquema('EventoEntrante', primero.cuerpo)).toEqual([]);
    expect(primero.cuerpo).toMatchObject({ event_type: 'RESENA_PUBLICADA', correlation_id: 'cid-resena-1', data: { atr_id: 1, atr_numero_resenas: 1 } });
    expect(segundo.cuerpo).toMatchObject({ data: { atr_numero_resenas: 2, atr_calificacion_promedio: 4 } });
    expect(primero.headers['x-servicio-token']).toBe(TOKEN_SERVICIOS);
    expect(await despachar()).toBe(0); // ya enviados

    // Moderación: ocultar recalcula; si ms_catalog está caído el evento espera y se reintenta
    const admin = jwt({ sub: '1', rol: 'ADMIN' });
    const cliente = jwt({ sub: '2', rol: 'CLIENTE' });
    const id = (await http().get('/api/v1/resenas?atr_id=1')).body.data.find((x: { usu_id: number | null }) => x.usu_id === null).ren_id;
    expect((await http().patch(`/api/v1/resenas/${id}/visibilidad`).set('Authorization', `Bearer ${cliente}`).send({ ren_visible: false })).status).toBe(403);
    const o = await http().patch(`/api/v1/resenas/${id}/visibilidad`).set('Authorization', `Bearer ${admin}`).send({ ren_visible: false });
    expect(o.status).toBe(200);
    expect(contrato.respuesta('PATCH', '/resenas/{ren_id}/visibilidad', 200, o.body)).toEqual([]);
    catalogo.caer(true);
    expect(await despachar()).toBe(0);
    catalogo.caer(false);
    expect(await despachar()).toBe(1);
    expect(catalogo.recibidos.at(-1)!.cuerpo).toMatchObject({ data: { atr_numero_resenas: 1, atr_calificacion_promedio: 5 } });

    // Tras 20 fallos el evento se aparta; el ADMIN lo vuelve a encolar
    await http().patch(`/api/v1/resenas/${id}/visibilidad`).set('Authorization', `Bearer ${admin}`).send({ ren_visible: true });
    catalogo.caer(true);
    for (let i = 0; i < 20; i++) await despachar();
    catalogo.caer(false);
    expect(await despachar()).toBe(0);
    expect((await http().post('/api/v1/resenas/eventos/reintentar').set('Authorization', `Bearer ${cliente}`)).status).toBe(403);
    const re = await http().post('/api/v1/resenas/eventos/reintentar').set('Authorization', `Bearer ${admin}`);
    expect(contrato.respuesta('POST', '/resenas/eventos/reintentar', 200, re.body)).toEqual([]);
    expect(re.body).toEqual({ reencolados: 1 });
    expect(await despachar()).toBe(1);
  });

  it('salud', async () => {
    const r = await http().get('/api/v1/health');
    expect(contrato.respuesta('GET', '/health', 200, r.body)).toEqual([]);
  });
});
