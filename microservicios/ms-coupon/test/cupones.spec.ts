import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import { join } from 'path';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { hoyEc, sumarDias } from '../src/comun/tiempo';
import { baseVacia, Contrato, describeDb } from './helpers';

const SECRETO = 'secreto-de-pruebas-de-ms-coupon-0123456789';
const CLAVE = 'clave-de-booking-para-pruebas-0123456789';
const TOKEN = 'token-servicios-pruebas-123';
const CONTRATO = join(__dirname, '..', 'contract');

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

describeDb('ms_coupon', () => {
  let app: NestExpressApplication;
  const contrato = new Contrato(join(CONTRATO, 'openapi.yaml'), 'cupones', [join(CONTRATO, 'booking-atracciones-v3.yaml')]);
  const http = () => request(app.getHttpServer());
  const RUTA = '/api/v3/atracciones/promociones/contrato';

  beforeAll(async () => {
    Object.assign(process.env, { JWT_SECRET: SECRETO, BOOKING_API_KEY: CLAVE, SERVICIOS_TOKEN: TOKEN });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-coupon');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('acuerdo de promociones: X-API-Key o JWT de ADMIN; cumple el esquema OFICIAL de Booking (v2 y v3)', async () => {
    expect((await http().get(RUTA)).status).toBe(401);
    expect((await http().get(RUTA).set('X-API-Key', 'clave-incorrecta-de-booking-000000')).status).toBe(401);
    expect((await http().get(RUTA).set('Authorization', `Bearer ${jwt('CLIENTE')}`)).status).toBe(403);
    const r = await http().get(RUTA).set('X-API-Key', CLAVE);
    expect(r.status).toBe(200);
    expect(contrato.respuesta('GET', RUTA, 200, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Quito', 'Baños de Agua Santa', 'Cuenca', 'Puerto Ayora'] });
    expect((await http().get('/api/v2/atracciones/promociones/contrato').set('Authorization', `Bearer ${jwt('ADMIN')}`)).status).toBe(200);
  });

  it('PUT del cuestionario B2B: sin promociones el máximo queda en 0; más de 50 % → 400', async () => {
    const no = await http().put(RUTA).set('X-API-Key', CLAVE).send({ permite_promociones: false, porcentaje_descuento_maximo: 20 });
    expect(no.status).toBe(200);
    expect(contrato.respuesta('PUT', RUTA, 200, no.body)).toEqual([]);
    expect(no.body).toMatchObject({ permite_promociones: false, porcentaje_descuento_maximo: 0 });
    const si = await http().put(RUTA).set('X-API-Key', CLAVE).send({
      permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', ' Cuenca ', 'Quito'],
      vigencia_hasta: '2027-06-30', contacto_comercial: { nombre: 'Dilan Mena', email: 'Reservas@Descubre-EC.com', telefono: '0991234567' },
    });
    expect(si.body).toMatchObject({ porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'], vigencia_hasta: '2027-06-30' });
    const mal = await http().put(RUTA).set('X-API-Key', CLAVE).send({ permite_promociones: true, porcentaje_descuento_maximo: 60 });
    expect(mal.status).toBe(400);
    expect(contrato.respuesta('PUT', RUTA, 400, mal.body)).toEqual([]);
    const interno = await http().get('/api/v1/internal/acuerdo').set('X-Servicio-Token', TOKEN);
    expect(interno.body.porcentaje_descuento_maximo).toBe(12.5);
    expect((await http().get('/api/v1/internal/acuerdo')).status).toBe(401);
  });

  it('cupones: ADMIN crea; validar calcula el descuento sin pasarse del monto y explica por qué no aplica', async () => {
    const admin = `Bearer ${jwt('ADMIN')}`;
    const ok = await http().post('/api/v1/cupones').set('Authorization', admin).send({ cup_codigo: 'verano10', cup_tipo: 'PORCENTAJE', cup_valor: 10, cup_fecha_inicio: hoyEc() });
    expect(ok.status).toBe(201);
    expect(contrato.respuesta('POST', '/api/v1/cupones', 201, ok.body)).toEqual([]);
    expect(ok.body.cup_codigo).toBe('VERANO10');
    expect((await http().post('/api/v1/cupones').set('Authorization', admin).send({ cup_codigo: 'VERANO10', cup_tipo: 'FIJO', cup_valor: 5, cup_fecha_inicio: hoyEc() })).status).toBe(409);
    await http().post('/api/v1/cupones').set('Authorization', admin).send({ cup_codigo: 'FIJO50', cup_tipo: 'FIJO', cup_valor: 50, cup_fecha_inicio: hoyEc() });
    await http().post('/api/v1/cupones').set('Authorization', admin).send({ cup_codigo: 'FUTURO', cup_tipo: 'FIJO', cup_valor: 5, cup_fecha_inicio: sumarDias(hoyEc(), 5) });

    const v = await http().get('/api/v1/cupones/verano10/validar?monto=175.00');
    expect(contrato.respuesta('GET', '/api/v1/cupones/{codigo}/validar', 200, v.body)).toEqual([]);
    expect(v.body).toMatchObject({ valido: true, descuento: '17.50' });
    expect((await http().get('/api/v1/cupones/FIJO50/validar?monto=30.00')).body.descuento).toBe('30.00');
    const futuro = await http().get('/api/v1/cupones/FUTURO/validar?monto=30.00');
    expect(futuro.body).toMatchObject({ valido: false, descuento: '0.00', motivo: expect.stringContaining('rige desde') });
    expect((await http().get('/api/v1/cupones/NADA/validar?monto=30.00')).status).toBe(404);
    const lista = await http().get('/api/v1/cupones').set('Authorization', admin);
    expect(contrato.respuesta('GET', '/api/v1/cupones', 200, lista.body)).toEqual([]);
    expect(contrato.respuesta('GET', '/api/v1/health', 200, (await http().get('/api/v1/health')).body)).toEqual([]);
  });
});
