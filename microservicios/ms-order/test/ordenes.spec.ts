import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { llamarGrpc } from '../src/comun/grpc';
import { baseVacia, contratoPropio, describeDb } from './helpers';

const SECRETO = 'secreto-de-pruebas-de-ms-order-0123456789';
const GRPC = 50148;

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

const orden = <T = Record<string, unknown>>(metodo: string, req: unknown) =>
  llamarGrpc<T>('orden.proto', 'descubre.orden.v1.OrdenService', 'ORDER_GRPC_URL', `127.0.0.1:${GRPC}`, metodo, req);
const nueva = (sufijo: string, clave = randomUUID()) => ({
  usu_id: 7, mpa_id: 1, moneda: 'USD', sufijo, idempotency_key: clave, observaciones: '',
  lineas: [
    { atr_id: 3, descripcion: 'Cotopaxi · 2026-11-06 06:30 · Adulto', cantidad: 2, precio_unitario: '65.00', subtotal: '130.00' },
    { atr_id: 3, descripcion: 'Cotopaxi · 2026-11-06 06:30 · Niño', cantidad: 1, precio_unitario: '45.00', subtotal: '45.00' },
  ],
});

describeDb('ms_order', () => {
  let app: NestExpressApplication;
  const contrato = contratoPropio();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    Object.assign(process.env, { JWT_SECRET: SECRETO, SERVICIOS_TOKEN: 'token-servicios-pruebas-123', GRPC_PORT: String(GRPC) });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-order');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('CrearOrden: número ORD-, total = suma de líneas, cumple el mensaje del contrato', async () => {
    const o = await orden<{ ord_id: string; ord_numero: string; estado: string; total: string }>('CrearOrden', nueva('AB12CD'));
    expect(o).toMatchObject({ ord_numero: 'ORD-AB12CD', estado: 'CREADA', subtotal: '175.00', iva: '0.00', total: '175.00', moneda: 'USD' });
    const r = await http().get(`/api/v1/ordenes/${o.ord_id}`).set('Authorization', `Bearer ${jwt('ADMIN')}`);
    expect(contrato.respuesta('GET', '/ordenes/{ord_id}', 200, r.body)).toEqual([]);
    expect(r.body).toEqual(o);
  });

  it('idempotente: misma clave → misma orden (también en paralelo); misma clave con otra orden → 409', async () => {
    const clave = randomUUID();
    const [a, b] = await Promise.all([orden<{ ord_id: string }>('CrearOrden', nueva('EF34GH', clave)), orden<{ ord_id: string }>('CrearOrden', nueva('EF34GH', clave))]);
    expect(a.ord_id).toBe(b.ord_id);
    await expect(orden('CrearOrden', { ...nueva('EF34GH', clave), mpa_id: 2 })).rejects.toMatchObject({ status: 409, response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('número repetido → 409 NUMERO_DUPLICADO (y no queda la clave tomada); línea que no cuadra → 400', async () => {
    const clave = randomUUID();
    await expect(orden('CrearOrden', nueva('AB12CD', clave))).rejects.toMatchObject({ status: 409, response: { code: 'NUMERO_DUPLICADO' } });
    expect(await orden<{ ord_numero: string }>('CrearOrden', nueva('ZZ99YY', clave))).toMatchObject({ ord_numero: 'ORD-ZZ99YY' });
    const mal = nueva('QQ11WW');
    mal.lineas[0].cantidad = 3; // 3 × 65 ≠ 130
    await expect(orden('CrearOrden', mal)).rejects.toMatchObject({ status: 400 });
  });

  it('estados del script: CREADA → PAGADA → REEMBOLSADA; repetir no falla; saltos inválidos → 409 INVALID_STATE', async () => {
    const o = await orden<{ ord_id: string }>('CrearOrden', nueva('ST4T3S'));
    expect(await orden('CambiarEstado', { ord_id: o.ord_id, estado: 'PAGADA' })).toMatchObject({ estado: 'PAGADA' });
    expect(await orden('CambiarEstado', { ord_id: o.ord_id, estado: 'PAGADA' })).toMatchObject({ estado: 'PAGADA' });
    await expect(orden('CambiarEstado', { ord_id: o.ord_id, estado: 'CANCELADA' })).rejects.toMatchObject({ status: 409, response: { code: 'INVALID_STATE' } });
    expect(await orden('CambiarEstado', { ord_id: o.ord_id, estado: 'REEMBOLSADA' })).toMatchObject({ estado: 'REEMBOLSADA' });
    await expect(orden('ObtenerOrden', { ord_id: 999999 })).rejects.toMatchObject({ status: 404 });
  });

  it('REST solo para ADMIN; lista cumple el contrato', async () => {
    expect((await http().get('/api/v1/ordenes?usu_id=7')).status).toBe(401);
    expect((await http().get('/api/v1/ordenes?usu_id=7').set('Authorization', `Bearer ${jwt('CLIENTE')}`)).status).toBe(403);
    const r = await http().get('/api/v1/ordenes?usu_id=7').set('Authorization', `Bearer ${jwt('ADMIN')}`);
    expect(contrato.respuesta('GET', '/ordenes', 200, r.body)).toEqual([]);
    expect(r.body.length).toBeGreaterThanOrEqual(4);
    expect(contrato.respuesta('GET', '/health', 200, (await http().get('/api/v1/health')).body)).toEqual([]);
  });
});
