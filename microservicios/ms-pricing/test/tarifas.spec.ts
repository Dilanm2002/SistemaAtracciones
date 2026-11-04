import 'reflect-metadata';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { llamarGrpc } from '../src/comun/grpc';
import { DespachadorEventos } from '../src/comun/outbox';
import { baseVacia, contratoPropio, describeDb, sql } from './helpers';

const SECRETO = 'secreto-de-pruebas-de-ms-pricing-0123456789';
const TOKEN = 'token-servicios-pruebas-123';
const GRPC = 50144;

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

const tarifas = (ids: number[], fecha = '') =>
  llamarGrpc<{ tarifas: Record<string, string>[] }>('pricing.proto', 'descubre.pricing.v1.PricingService', 'PRICING_GRPC_URL', `127.0.0.1:${GRPC}`, 'ObtenerTarifas', { atr_ids: ids, fecha });

describeDb('ms_pricing', () => {
  let app: NestExpressApplication;
  const contrato = contratoPropio();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    Object.assign(process.env, { JWT_SECRET: SECRETO, SERVICIOS_TOKEN: TOKEN, GRPC_PORT: String(GRPC), PRICING_GRPC_URL: `127.0.0.1:${GRPC}`, EVENTOS_DESTINOS: 'http://127.0.0.1:9/no-se-usa' });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-pricing');
    await app.init();
    await sql(`INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_vigente_desde, tar_vigente_hasta) VALUES
      (1, 'ADULTO', 30, '2020-01-01', '2020-12-31'),
      (1, 'ADULTO', 40, '2021-01-01', NULL), (1, 'NINO', 25, '2021-01-01', NULL),
      (2, 'ADULTO', 15.5, '2021-01-01', NULL)`);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('gRPC ObtenerTarifas: la vigente de cada tipo, montos con 2 decimales y vacío si no hay', async () => {
    const r = await tarifas([1, 2, 99]);
    expect(r.tarifas).toEqual([
      { atr_id: '1', moneda: 'USD', adulto: '40.00', nino: '25.00', mayor: '', estudiante: '', grupo: '' },
      { atr_id: '2', moneda: 'USD', adulto: '15.50', nino: '', mayor: '', estudiante: '', grupo: '' },
      { atr_id: '99', moneda: 'USD', adulto: '', nino: '', mayor: '', estudiante: '', grupo: '' },
    ]);
    // Versión histórica
    expect((await tarifas([1], '2020-06-01')).tarifas[0].adulto).toBe('30.00');
  });

  it('gRPC sin x-servicio-token válido → UNAUTHENTICATED (no responde datos)', async () => {
    const def = protoLoader.loadSync(join(__dirname, '..', '..', 'proto', 'pricing.proto'), { keepCase: true });
    const Ctor = (grpc.loadPackageDefinition(def) as never as { descubre: { pricing: { v1: { PricingService: grpc.ServiceClientConstructor } } } }).descubre.pricing.v1.PricingService;
    const c = new Ctor(`127.0.0.1:${GRPC}`, grpc.credentials.createInsecure()) as unknown as Record<string, Function>;
    const meta = new grpc.Metadata();
    meta.set('x-servicio-token', 'token-falso-de-otro-servicio-0000');
    const err = await new Promise<grpc.ServiceError>((ok) => c.ObtenerTarifas({ atr_ids: [1] }, meta, (e: grpc.ServiceError) => ok(e)));
    expect(err.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(JSON.parse(err.details)).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('REST: vigentes, historial y PUT (ADMIN) que versiona y publica PRECIO_ACTUALIZADO', async () => {
    const v = await http().get('/api/v1/tarifas?atr_id=1');
    expect(contrato.respuesta('GET', '/tarifas', 200, v.body)).toEqual([]);
    expect(v.body.adulto).toBe('40.00');

    expect((await http().put('/api/v1/tarifas/1').send({ tarifas: [{ tar_tipo: 'ADULTO', tar_precio: 45 }] })).status).toBe(401);
    expect((await http().put('/api/v1/tarifas/1').set('Authorization', `Bearer ${jwt('CLIENTE')}`).send({ tarifas: [{ tar_tipo: 'ADULTO', tar_precio: 45 }] })).status).toBe(403);
    const mal = await http().put('/api/v1/tarifas/1').set('Authorization', `Bearer ${jwt('ADMIN')}`).send({ tarifas: [{ tar_tipo: 'VIP', tar_precio: 45 }] });
    expect(mal.status).toBe(400);
    expect(contrato.respuesta('PUT', '/tarifas/{atr_id}', 400, mal.body)).toEqual([]);

    const ok = await http().put('/api/v1/tarifas/1').set('Authorization', `Bearer ${jwt('ADMIN')}`)
      .send({ tarifas: [{ tar_tipo: 'ADULTO', tar_precio: 45 }, { tar_tipo: 'ESTUDIANTE', tar_precio: 33.75 }] });
    expect(ok.status).toBe(200);
    expect(contrato.respuesta('PUT', '/tarifas/{atr_id}', 200, ok.body)).toEqual([]);
    const adultos = ok.body.filter((t: { tar_tipo: string }) => t.tar_tipo === 'ADULTO');
    expect(adultos).toHaveLength(3); // 30 (2020), 40 (cerrada ayer) y 45 (desde hoy)
    expect(adultos[1].tar_vigente_hasta).not.toBeNull();
    expect((await tarifas([1])).tarifas[0]).toMatchObject({ adulto: '45.00', estudiante: '33.75', nino: '25.00' });

    const [e] = await sql(`SELECT evt_tipo, evt_datos FROM evento ORDER BY evt_secuencia DESC LIMIT 1`);
    expect(e.evt_tipo).toBe('PRECIO_ACTUALIZADO');
    expect(e.evt_datos.atr_id).toBe(1);
    expect(e.evt_datos.tarifas).toEqual(expect.arrayContaining([{ tipo: 'ADULTO', precio: 45, moneda: 'USD' }, { tipo: 'ESTUDIANTE', precio: 33.75, moneda: 'USD' }]));
    expect(app.get(DespachadorEventos)).toBeDefined();
  });

  it('salud cumple el contrato', async () => {
    const r = await http().get('/api/v1/health');
    expect(contrato.respuesta('GET', '/health', 200, r.body)).toEqual([]);
  });
});
