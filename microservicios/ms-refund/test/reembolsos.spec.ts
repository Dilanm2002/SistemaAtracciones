import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { baseVacia, contratoPropio, describeDb } from './helpers';

const TOKEN = 'token-servicios-pruebas-123';

/** ms_payment falso: pago 1 aprobado por 175.00, pago 2 pendiente; anota el token recibido. */
async function pagosFalso() {
  const tokens: string[] = [];
  let caido = false;
  const s: Server = createServer((req, res) => {
    tokens.push(String(req.headers['x-servicio-token']));
    if (caido) return void res.writeHead(503).end();
    const id = Number(req.url?.split('/').pop());
    const p = id === 1 ? { pag_id: 1, estado: 'APROBADO', pag_monto: '175.00' } : id === 2 ? { pag_id: 2, estado: 'PENDIENTE', pag_monto: '80.00' } : null;
    res.writeHead(p ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(p ?? { code: 'NOT_FOUND', detail: `El pago ${id} no existe.` }));
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, tokens, caer: (v: boolean) => (caido = v), cerrar: () => new Promise<void>((ok) => s.close(() => ok())) };
}

describeDb('ms_refund', () => {
  let app: NestExpressApplication;
  let pagos: Awaited<ReturnType<typeof pagosFalso>>;
  const contrato = contratoPropio();
  const http = () => request(app.getHttpServer());
  const crear = (cuerpo: object) => http().post('/api/v1/internal/reembolsos').set('X-Servicio-Token', TOKEN).send(cuerpo);

  beforeAll(async () => {
    pagos = await pagosFalso();
    Object.assign(process.env, { SERVICIOS_TOKEN: TOKEN, PAYMENT_URL: pagos.url });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-refund');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await pagos?.cerrar();
  });

  it('reembolsa el total de un pago aprobado (consultando a ms_payment con el token interno) y es idempotente', async () => {
    const r = await crear({ pag_id: 1, motivo: 'Compensación de saga de Booking' });
    expect(r.status).toBe(201);
    expect(contrato.respuesta('POST', '/internal/reembolsos', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ rem_numero: 'REM-000000001', rem_monto: '175.00', rem_referencia: 'SIM-REM-1' });
    expect(r.body.rem_procesado_en).not.toBeNull();
    expect(pagos.tokens.at(-1)).toBe(TOKEN);
    const otra = await crear({ pag_id: 1, motivo: 'Reintento' });
    expect(otra.body.rem_id).toBe(r.body.rem_id);
    const lista = await http().get('/api/v1/internal/reembolsos?pag_id=1').set('X-Servicio-Token', TOKEN);
    expect(contrato.respuesta('GET', '/internal/reembolsos', 200, lista.body)).toEqual([]);
    expect(lista.body).toHaveLength(1);
  });

  it('regla del script: nunca más de lo cobrado; solo pagos aprobados; pago inexistente → 404', async () => {
    const mucho = await crear({ pag_id: 3, monto: '1.00', motivo: 'x y z' });
    expect(mucho.status).toBe(404);
    const pendiente = await crear({ pag_id: 2, motivo: 'Cancelación' });
    expect(pendiente.status).toBe(409);
    expect(pendiente.body.code).toBe('PAGO_NO_COBRADO');
    expect(contrato.respuesta('POST', '/internal/reembolsos', 409, pendiente.body)).toEqual([]);
  });

  it('si ms_payment no responde: 503 DEPENDENCY_UNAVAILABLE (no se reembolsa a ciegas)', async () => {
    pagos.caer(true);
    try {
      const r = await crear({ pag_id: 5, motivo: 'Cancelación' });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(contrato.respuesta('POST', '/internal/reembolsos', 503, r.body)).toEqual([]);
    } finally {
      pagos.caer(false);
    }
    expect((await http().post('/api/v1/internal/reembolsos').send({ pag_id: 1, motivo: 'abc' })).status).toBe(401);
    expect(contrato.respuesta('GET', '/health', 200, (await http().get('/api/v1/health')).body)).toEqual([]);
  });
});
