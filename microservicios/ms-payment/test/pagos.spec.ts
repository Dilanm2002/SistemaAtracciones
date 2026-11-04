import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { baseVacia, contratoPropio, describeDb, sql } from './helpers';

const TOKEN = 'token-servicios-pruebas-123';
const anioProximo = new Date().getFullYear() + 2;

describeDb('ms_payment', () => {
  let app: NestExpressApplication;
  const contrato = contratoPropio();
  const http = () => request(app.getHttpServer());
  const interno = (r: request.Test) => r.set('X-Servicio-Token', TOKEN);

  beforeAll(async () => {
    Object.assign(process.env, { SERVICIOS_TOKEN: TOKEN });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-payment');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('tarjeta: APROBADO al instante con referencia SIM-; guarda solo marca y últimos 4 (nunca el número)', async () => {
    const r = await interno(http().post('/api/v1/internal/pagos')).send({
      ord_id: 1, mpa_codigo: 'TARJETA', monto: '175.00', sufijo: 'AB12CD',
      tarjeta: { marca: 'VISA', ultimos4: '1111', titular: 'Luis Andrade', mes: 12, anio: anioProximo },
    });
    expect(r.status).toBe(201);
    expect(contrato.respuesta('POST', '/internal/pagos', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ pag_numero: 'PAG-AB12CD', estado: 'APROBADO', pag_monto: '175.00', pag_referencia: 'SIM-AB12CD', tarjeta: { marca: 'VISA', ultimos4: '1111' } });
    const [t] = await sql('SELECT * FROM pago_tarjeta');
    expect(t).toMatchObject({ pat_titular: 'LUIS ANDRADE', pat_ultimos4: '1111' });
    expect(Object.keys(t).some((k) => /numero|cvv/i.test(k))).toBe(false);
    // Reintento de la saga: mismo pago
    const otra = await interno(http().post('/api/v1/internal/pagos')).send({ ord_id: 1, mpa_codigo: 'TARJETA', monto: '175.00', sufijo: 'AB12CD' });
    expect(otra.body.pag_id).toBe(r.body.pag_id);
    // Mismo número en otra orden
    const choque = await interno(http().post('/api/v1/internal/pagos')).send({ ord_id: 2, mpa_codigo: 'TARJETA', monto: '10.00', sufijo: 'AB12CD' });
    expect(choque.status).toBe(409);
    expect(contrato.respuesta('POST', '/internal/pagos', 409, choque.body)).toEqual([]);
  });

  it('pasarela de Booking: aprobado; transferencia: PENDIENTE → aprobar o rechazar (idempotentes)', async () => {
    const soa = await interno(http().post('/api/v1/internal/pagos')).send({ ord_id: 3, mpa_codigo: 'SOA_BOOKING_GATEWAY', monto: '50.00', sufijo: 'SOA111' });
    expect(soa.body.estado).toBe('APROBADO');
    const tr = await interno(http().post('/api/v1/internal/pagos')).send({ ord_id: 4, mpa_codigo: 'TRANSFERENCIA', monto: '80.00', sufijo: 'TRA222' });
    expect(tr.body).toMatchObject({ estado: 'PENDIENTE', pag_aprobado_en: null, pag_referencia: null });
    const ok = await interno(http().post(`/api/v1/internal/pagos/${tr.body.pag_id}/aprobar`));
    expect(contrato.respuesta('POST', '/internal/pagos/{pag_id}/aprobar', 200, ok.body)).toEqual([]);
    expect(ok.body).toMatchObject({ estado: 'APROBADO', pag_referencia: `MANUAL-${tr.body.pag_id}` });
    expect((await interno(http().post(`/api/v1/internal/pagos/${tr.body.pag_id}/aprobar`))).status).toBe(200);
    expect((await interno(http().post(`/api/v1/internal/pagos/${tr.body.pag_id}/rechazar`)).send({ motivo: 'Cancelada' })).status).toBe(409);

    const sitio = await interno(http().post('/api/v1/internal/pagos')).send({ ord_id: 5, mpa_codigo: 'EN_SITIO', monto: '20.00', sufijo: 'SIT333' });
    const no = await interno(http().post(`/api/v1/internal/pagos/${sitio.body.pag_id}/rechazar`)).send({ motivo: 'Reserva cancelada antes del pago' });
    expect(no.body).toMatchObject({ estado: 'RECHAZADO', pag_motivo_rechazo: 'Reserva cancelada antes del pago' });
    expect((await interno(http().post(`/api/v1/internal/pagos/${sitio.body.pag_id}/rechazar`)).send({ motivo: 'otra vez' })).status).toBe(200);
  });

  it('validaciones: tarjeta vencida, tarjeta con otro método, sin token interno', async () => {
    const vencida = await interno(http().post('/api/v1/internal/pagos')).send({
      ord_id: 6, mpa_codigo: 'TARJETA', monto: '10.00', sufijo: 'VEN444', tarjeta: { marca: 'VISA', ultimos4: '1111', titular: 'X Y', mes: 1, anio: 2021 },
    });
    expect(vencida.status).toBe(400);
    expect(contrato.respuesta('POST', '/internal/pagos', 400, vencida.body)).toEqual([]);
    expect((await interno(http().post('/api/v1/internal/pagos')).send({
      ord_id: 6, mpa_codigo: 'TRANSFERENCIA', monto: '10.00', sufijo: 'VEN555', tarjeta: { marca: 'VISA', ultimos4: '1111', titular: 'X Y', mes: 1, anio: anioProximo },
    })).status).toBe(400);
    expect((await http().post('/api/v1/internal/pagos').send({ ord_id: 7, mpa_codigo: 'TARJETA', monto: '1.00', sufijo: 'NOT666' })).status).toBe(401);
  });

  it('consultas y catálogo de métodos cumplen el contrato', async () => {
    const lista = await interno(http().get('/api/v1/internal/pagos?ord_id=1'));
    expect(contrato.respuesta('GET', '/internal/pagos', 200, lista.body)).toEqual([]);
    const m = await http().get('/api/v1/metodos-pago');
    expect(contrato.respuesta('GET', '/metodos-pago', 200, m.body)).toEqual([]);
    expect(m.body.map((x: { mpa_codigo: string }) => x.mpa_codigo)).toEqual(['TARJETA', 'TRANSFERENCIA', 'EN_SITIO', 'PAYPHAL', 'SOA_BOOKING_GATEWAY']);
    expect((await interno(http().get('/api/v1/internal/pagos/9999'))).status).toBe(404);
    expect(contrato.respuesta('GET', '/health', 200, (await http().get('/api/v1/health')).body)).toEqual([]);
  });
});
