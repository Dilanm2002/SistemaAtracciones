import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { baseVacia, describeDb } from './helpers';

const SECRETO = 'secreto-de-pruebas-de-ms-identity-0123456789';
const CLAVE = 'clave-de-booking-para-pruebas-123456';

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

const PEPITO = { nombre: 'Pepito Evaluador Paz', email: 'Pepito@Booking.com', identificacion: '1710034065', telefono: '099 876 5432' };

describeDb('ms-identity · /clientes (contrato v3.1)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  const conClave = (r: request.Test) => r.set('X-API-Key', CLAVE);

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    process.env.BOOKING_API_KEY = CLAVE;
    await baseVacia();
    app = await crearApp(AppModule, 'ms-identity');
    await app.init();
  });
  afterAll(() => app.close());

  it('exige X-API-Key', async () => {
    await http().get('/api/v3/clientes?email=a@b.com').expect(401);
    await http().post('/api/v3/clientes').send(PEPITO).expect(401);
    await http().get('/api/v3/clientes?email=a@b.com').set('X-API-Key', 'otra-clave-que-no-es-la-de-booking').expect(401);
  });

  it('GET sin datos responde 400 y si no existe, 404', async () => {
    await conClave(http().get('/api/v3/clientes')).expect(400);
    await conClave(http().get('/api/v3/clientes?email=nadie@booking.com&identificacion=0000000000')).expect(404);
  });

  it('POST crea (201) y repetir no duplica (200 con el mismo client_id)', async () => {
    const a = await conClave(http().post('/api/v3/clientes')).send(PEPITO).expect(201);
    expect(a.body).toEqual({ client_id: expect.stringMatching(/^DEC-USR-\d+$/) });

    const mismoCorreo = await conClave(http().post('/api/v3/clientes')).send({ ...PEPITO, identificacion: '0912345678' }).expect(200);
    const mismoDoc = await conClave(http().post('/api/v3/clientes')).send({ ...PEPITO, email: 'otro@booking.com' }).expect(200);
    expect(mismoCorreo.body).toEqual({ client_id: a.body.client_id, mensaje: 'Turista ya existente reutilizado' });
    expect(mismoDoc.body.client_id).toBe(a.body.client_id);

    const panel = await http().get('/api/v1/clientes').set('Authorization', `Bearer ${jwt('ADMIN')}`).expect(200);
    expect(panel.body.total).toBe(1);
    expect(panel.body.data[0]).toMatchObject({ client_id: a.body.client_id, nombre: 'Pepito Evaluador Paz', email: 'pepito@booking.com', telefono: '0998765432', origen: 'BOOKING' });
  });

  it('dos POST simultáneos del mismo turista dejan una sola persona', async () => {
    const t = { nombre: 'Ana', email: 'ana@booking.com', identificacion: 'AB123456' };
    const [a, b] = await Promise.all([conClave(http().post('/api/v3/clientes')).send(t), conClave(http().post('/api/v3/clientes')).send(t)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.client_id).toBe(b.body.client_id);
    const r = await conClave(http().get('/api/v3/clientes?identification=ab123456')).expect(200);
    expect(r.body).toEqual({ client_id: a.body.client_id, nombre: 'Ana', email: 'ana@booking.com', identificacion: 'AB123456' });
  });

  it('GET encuentra con cualquiera de los dos datos y un parámetro de más no estorba', async () => {
    const r = await conClave(http().get('/api/v3/clientes?email=PEPITO@booking.com&origen=booking')).expect(200);
    const s = await conClave(http().get('/api/v3/clientes?identificacion=171.003.4065')).expect(200);
    expect(r.body.client_id).toBe(s.body.client_id);
  });

  it('si correo y documento son de personas distintas, gana el documento', async () => {
    const pepito = await conClave(http().get('/api/v3/clientes?identificacion=1710034065')).expect(200);
    const r = await conClave(http().get('/api/v3/clientes?email=ana@booking.com&identificacion=1710034065')).expect(200);
    expect(r.body.client_id).toBe(pepito.body.client_id);
  });

  it('rechaza datos inválidos', async () => {
    await conClave(http().post('/api/v3/clientes')).send({ ...PEPITO, email: 'no-es-correo' }).expect(400);
    await conClave(http().post('/api/v3/clientes')).send({ nombre: 'Sin Doc', email: 'sin@doc.com' }).expect(400);
    await conClave(http().post('/api/v3/clientes')).send({ ...PEPITO, telefono: 'abc' }).expect(400);
  });

  it('el listado del panel es solo para ADMIN', async () => {
    await http().get('/api/v1/clientes').expect(401);
    await http().get('/api/v1/clientes').set('Authorization', `Bearer ${jwt('CLIENTE')}`).expect(403);
    const r = await http().get('/api/v1/clientes?q=ana').set('Authorization', `Bearer ${jwt('ADMIN')}`).expect(200);
    expect(r.body.data.map((c: { nombre: string }) => c.nombre)).toEqual(['Ana']);
  });
});
