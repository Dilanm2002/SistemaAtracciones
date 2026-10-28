import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { baseVacia, contratoPropio, describeDb } from './helpers';

/**
 * ms_location de punta a punta contra su base y su contrato (contract/openapi.yaml):
 * cada respuesta se valida con el esquema que declara el contrato (pruebas de esquemas).
 */
describeDb('ms_location', () => {
  let app: NestExpressApplication;
  const contrato = contratoPropio();
  const get = (u: string) => request(app.getHttpServer()).get(`/api/v1${u}`);

  beforeAll(async () => {
    await baseVacia();
    app = await crearApp(AppModule, 'ms-location');
    await app.init();
  });
  afterAll(async () => app?.close());

  it('regiones y provincias del script del equipo (4 regiones, 24 provincias)', async () => {
    const r = await get('/regiones');
    expect(r.status).toBe(200);
    expect(contrato.respuesta('GET', '/regiones', 200, r.body)).toEqual([]);
    expect(r.body.map((x: { reg_codigo: string }) => x.reg_codigo).sort()).toEqual(['AM', 'CO', 'GA', 'SI']);

    const p = await get('/provincias');
    expect(contrato.respuesta('GET', '/provincias', 200, p.body)).toEqual([]);
    expect(p.body).toHaveLength(24);
    const sierra = r.body.find((x: { reg_codigo: string }) => x.reg_codigo === 'SI').reg_id;
    const ps = await get(`/provincias?reg_id=${sierra}`);
    expect(ps.body.every((x: { reg_nombre: string }) => x.reg_nombre === 'SIERRA')).toBe(true);
    const una = await get(`/provincias/${ps.body[0].prov_id}`);
    expect(contrato.respuesta('GET', '/provincias/{prov_id}', 200, una.body)).toEqual([]);
  });

  it('ciudades: búsqueda sin tildes, por provincia y por varios ids', async () => {
    const q = await get('/ciudades?q=TULCAN');
    expect(q.status).toBe(200);
    expect(contrato.respuesta('GET', '/ciudades', 200, q.body)).toEqual([]);
    expect(q.body[0]).toMatchObject({ ciu_nombre: 'Tulcan', prov_nombre: 'Carchi', reg_nombre: 'SIERRA' });

    const sucumbios = await get('/ciudades?q=nueva loja');
    expect(sucumbios.body[0].prov_nombre).toBe('Sucumbíos');

    const todas = await get('/ciudades');
    const ids = todas.body.slice(0, 3).map((c: { ciu_id: number }) => c.ciu_id);
    const varias = await get(`/ciudades?ids=${ids.join(',')}`);
    expect(varias.body.map((c: { ciu_id: number }) => c.ciu_id).sort()).toEqual([...ids].sort());

    const una = await get(`/ciudades/${ids[0]}`);
    expect(contrato.respuesta('GET', '/ciudades/{ciu_id}', 200, una.body)).toEqual([]);
  });

  it('errores RFC 7807 con correlation id', async () => {
    const r = await get('/ciudades/9999').set('X-Correlation-Id', 'cid-ms-location-1');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(contrato.respuesta('GET', '/ciudades/{ciu_id}', 404, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ code: 'NOT_FOUND', correlation_id: 'cid-ms-location-1' });
    expect(r.headers['x-correlation-id']).toBe('cid-ms-location-1');

    const mal = await get('/provincias?reg_id=abc');
    expect(mal.status).toBe(400);
    expect(mal.body.invalid_params[0].name).toBe('reg_id');
    expect((await get('/ciudades?otro=1')).status).toBe(400);
  });

  it('salud', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(contrato.respuesta('GET', '/health', 200, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ service: 'ms-location', database_connected: true });
  });
});
