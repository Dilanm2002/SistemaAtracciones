import 'reflect-metadata';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { iniciarServidorGrpc, llamarGrpc } from '../src/comun/grpc';
import { hoyEc, sumarDias } from '../src/comun/tiempo';
import { baseVacia, Contrato, describeDb, sql } from './helpers';

const SECRETO = 'secreto-de-pruebas-de-ms-inventory-0123456789';
const TOKEN = 'token-servicios-pruebas-123';
const GRPC = 50145;
const GRPC_PRICING = 50146;
const GRPC_BOOKING = 50147;
const UUID = '5b47251a-803a-4107-aa42-3211e4acb4b7';
const CONTRATO = join(__dirname, '..', 'contract');

function jwt(rol: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: '1', rol, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

/** ms_catalog falso: atracción 1 publicada (por id, UUID o slug) y 2 en borrador. */
async function catalogoFalso() {
  const s: Server = createServer((req, res) => {
    const ref = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    const a = ['1', UUID, 'mitad-del-mundo'].includes(ref)
      ? { atr_id: 1, atr_uuid: UUID, atr_estado: 'PUBLICADA', atr_eliminado_en: null }
      : ref === '2' ? { atr_id: 2, atr_uuid: '00000000-0000-4000-8000-000000000002', atr_estado: 'BORRADOR', atr_eliminado_en: null } : null;
    res.writeHead(a ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(a ?? { code: 'NOT_FOUND', detail: 'no existe' }));
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((ok) => s.close(() => ok())) };
}

/** Booking falso: el servidor gRPC de su inventory.proto, que anota cada PushStockUpdate. */
async function bookingFalso() {
  const recibidos: Record<string, unknown>[] = [];
  const def = protoLoader.loadSync(join(__dirname, '..', '..', 'proto', 'inventory.proto'), { keepCase: true, longs: String, defaults: true });
  const pkg = grpc.loadPackageDefinition(def) as never as { inventory: { InventoryStockService: grpc.ServiceClientConstructor } };
  const server = new grpc.Server();
  server.addService(pkg.inventory.InventoryStockService.service, {
    PushStockUpdate: (call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      recibidos.push({ ...call.request, token: call.metadata.get('x-servicio-token')[0] });
      cb(null, { success: true, message: 'OK', processed_at: String(Date.now()), error_code: 'OK', current_available: call.request.available_units });
    },
  });
  await new Promise<void>((ok, mal) => server.bindAsync(`127.0.0.1:${GRPC_BOOKING}`, grpc.ServerCredentials.createInsecure(), (e) => (e ? mal(e) : ok())));
  return { recibidos, cerrar: () => new Promise<void>((ok) => server.tryShutdown(() => ok())) };
}

const inv = <T>(metodo: string, req: unknown) => llamarGrpc<T>('inventario.proto', 'descubre.inventario.v1.InventarioService', 'INVENTORY_GRPC_URL', `127.0.0.1:${GRPC}`, metodo, req);
interface Turno { dis_id: string; disponibles: number; cupo_total: number; fecha: string; hora: string }
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describeDb('ms_inventory', () => {
  let app: NestExpressApplication;
  let catalogo: Awaited<ReturnType<typeof catalogoFalso>>;
  let booking: Awaited<ReturnType<typeof bookingFalso>>;
  let cerrarPricing: () => Promise<void>;
  const contrato = new Contrato(join(CONTRATO, 'openapi.yaml'), 'inventario', [join(CONTRATO, 'booking-atracciones-v3.yaml')]);
  const http = () => request(app.getHttpServer());
  const dia = sumarDias(hoyEc(), 10);

  beforeAll(async () => {
    catalogo = await catalogoFalso();
    booking = await bookingFalso();
    // ms_pricing falso con el mismo proto (antes de fijar GRPC_PORT, que es el puerto de ms_inventory)
    cerrarPricing = await iniciarServidorGrpc('pricing.proto', 'descubre.pricing.v1.PricingService', {
      ObtenerTarifas: async () => ({ tarifas: [{ atr_id: '1', moneda: 'USD', adulto: '25.00', nino: '15.00', mayor: '', estudiante: '', grupo: '' }] }),
    }, GRPC_PRICING, 'pricing-falso');
    Object.assign(process.env, {
      JWT_SECRET: SECRETO, SERVICIOS_TOKEN: TOKEN, GRPC_PORT: String(GRPC), INVENTORY_GRPC_URL: `127.0.0.1:${GRPC}`,
      CATALOG_URL: catalogo.url, PRICING_GRPC_URL: `127.0.0.1:${GRPC_PRICING}`, EVENTOS_DESTINOS: 'http://127.0.0.1:9/no-se-usa',
      BOOKING_GRPC_URL: `127.0.0.1:${GRPC_BOOKING}`, BOOKING_GRPC_ENABLED: 'true', BOOKING_SERVICE_ID: 'NODE_ATR_DILAN',
    });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-inventory');
    await app.init();
    await sql(`INSERT INTO horario (atr_id, hor_hora, hor_cupo) VALUES (1, '09:00', 20), (1, '14:00', 6)`);
  });
  afterAll(async () => {
    await app?.close();
    await cerrarPricing?.();
    await Promise.all([catalogo?.cerrar(), booking?.cerrar()]);
  });

  it('disponibilidad v3 cumple el esquema OFICIAL de Booking, con los precios de ms_pricing', async () => {
    for (const ref of [UUID, 'mitad-del-mundo']) {
      const r = await http().get(`/api/v3/atracciones/${ref}/disponibilidad?date=${dia}`);
      expect(r.status).toBe(200);
      expect(contrato.respuesta('GET', '/api/v3/atracciones/{id}/disponibilidad', 200, r.body)).toEqual([]);
      expect(r.body.atraccion_id).toBe(UUID);
      expect(r.body.time_slots.map((s: { slot_id: string }) => s.slot_id)).toEqual([`slot-${dia.replace(/-/g, '')}-0900`, `slot-${dia.replace(/-/g, '')}-1400`]);
      expect(r.body.time_slots[0]).toMatchObject({ time: '09:00 a.m.', time_24h: '09:00:00', total_slots: 20, available_slots: 20, status: 'DISPONIBLE', price_adult: 25, price_child: 15 });
      expect(r.body.time_slots[1]).toMatchObject({ time: '02:00 p.m.', status: 'DISPONIBLE', available_slots: 6 });
    }
    expect((await http().get(`/api/v2/atracciones/1/disponibilidad?fecha=${dia}`)).status).toBe(200);
    expect((await http().get(`/api/v3/atracciones/2/disponibilidad?date=${dia}`)).status).toBe(404); // borrador
    expect((await http().get(`/api/v3/atracciones/no-existe/disponibilidad?date=${dia}`)).status).toBe(404);
    const pasada = await http().get(`/api/v3/atracciones/1/disponibilidad?date=2020-01-01`);
    expect(pasada.status).toBe(400);
    expect(contrato.respuesta('GET', '/api/v3/atracciones/{id}/disponibilidad', 400, pasada.body)).toEqual([]);
  });

  it('RetenerCupos (gRPC): descuenta, es idempotente por referencia y avisa a Booking y al feed', async () => {
    const t = await inv<Turno>('RetenerCupos', { atr_id: 1, fecha: dia, hora: '14:00', cupos: 2, referencia: 'res-a' });
    expect(t).toMatchObject({ fecha: dia, hora: '14:00', cupo_total: 6, disponibles: 4 });
    const otraVez = await inv<Turno>('RetenerCupos', { atr_id: 1, fecha: dia, hora: '14:00', cupos: 2, referencia: 'res-a' });
    expect(otraVez.disponibles).toBe(4);
    const r = await http().get(`/api/v3/atracciones/1/disponibilidad?date=${dia}`);
    expect(r.body.time_slots[1]).toMatchObject({ available_slots: 4, status: 'ULTIMOS_CUPOS' });

    await esperar(300);
    const push = booking.recibidos.at(-1)!;
    expect(push).toMatchObject({ service_id: 'NODE_ATR_DILAN', item_id: UUID, date: dia, time_slot: '02:00 p.m.', available_units: 4, slot_id: `slot-${dia.replace(/-/g, '')}-1400` });
    expect(push.token).toBeUndefined(); // el token interno nunca sale hacia Booking
    expect(booking.recibidos).toHaveLength(1); // la repetición no se volvió a enviar
    const [e] = await sql(`SELECT evt_tipo, evt_datos FROM evento ORDER BY evt_secuencia DESC LIMIT 1`);
    expect(e).toMatchObject({ evt_tipo: 'STOCK_ACTUALIZADO', evt_datos: { attraction_id: UUID, date: dia, time: '14:00', available_units: 4, total_units: 6, reason: 'VENTA' } });
  });

  it('sin cupos, fecha bloqueada u horario inexistente: el error HTTP del contrato llega intacto por gRPC', async () => {
    await expect(inv('RetenerCupos', { atr_id: 1, fecha: dia, hora: '14:00', cupos: 5, referencia: 'res-b' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'OUT_OF_STOCK', message: expect.stringContaining('Solo quedan 4 cupo(s)') } });
    await expect(inv('RetenerCupos', { atr_id: 1, fecha: dia, hora: '11:00', cupos: 1, referencia: 'res-c' })).rejects.toMatchObject({ status: 400 });
    await expect(inv('RetenerCupos', { atr_id: 1, fecha: '2020-01-01', hora: '09:00', cupos: 1, referencia: 'res-d' })).rejects.toMatchObject({ status: 400 });
    await sql(`INSERT INTO fecha_bloqueada (atr_id, fb_fecha, fb_motivo) VALUES (1, $1, 'Erupción volcánica')`, [sumarDias(dia, 1)]);
    await expect(inv('RetenerCupos', { atr_id: 1, fecha: sumarDias(dia, 1), hora: '09:00', cupos: 1, referencia: 'res-e' }))
      .rejects.toMatchObject({ status: 409, response: { code: 'OUT_OF_STOCK', message: expect.stringContaining('Erupción volcánica') } });
  });

  it('concurrencia: 10 retenciones simultáneas de 3 cupos sobre un turno de 20 → solo 6 pasan (sin sobreventa)', async () => {
    const fecha = sumarDias(dia, 2);
    const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => inv<Turno>('RetenerCupos', { atr_id: 1, fecha, hora: '09:00', cupos: 3, referencia: `par-${i}` })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(6);
    expect(r.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason.status === 409)).toBe(true);
    const [d] = await sql(`SELECT dis_cupo_reservado FROM disponibilidad WHERE dis_fecha = $1`, [fecha]);
    expect(d.dis_cupo_reservado).toBe(18);
  });

  it('LiberarCupos: devuelve una sola vez; una reserva de la tienda (sin retención) se libera con dis_id y cupos', async () => {
    const t = await inv<Turno>('RetenerCupos', { atr_id: 1, fecha: dia, hora: '09:00', cupos: 3, referencia: 'res-f' });
    expect(t.disponibles).toBe(17);
    expect((await inv<Turno>('LiberarCupos', { dis_id: t.dis_id, cupos: 0, referencia: 'res-f' })).disponibles).toBe(20);
    expect((await inv<Turno>('LiberarCupos', { dis_id: t.dis_id, cupos: 0, referencia: 'res-f' })).disponibles).toBe(20);
    await sql(`UPDATE disponibilidad SET dis_cupo_reservado = 5 WHERE dis_id = $1`, [t.dis_id]); // vendido antes de los microservicios
    expect((await inv<Turno>('LiberarCupos', { dis_id: t.dis_id, cupos: 2, referencia: 'tienda-123' })).disponibles).toBe(17);
    expect((await inv<Turno>('LiberarCupos', { dis_id: t.dis_id, cupos: 2, referencia: 'tienda-123' })).disponibles).toBe(17);
    await expect(inv('LiberarCupos', { dis_id: t.dis_id, cupos: 0, referencia: 'no-existe' })).rejects.toMatchObject({ status: 404 });
    expect((await inv<Turno>('ObtenerTurno', { dis_id: t.dis_id })).disponibles).toBe(17);
  });

  it('API propia: horarios, fechas bloqueadas (con JWT) y el stock de ese día en 0 para Booking', async () => {
    const h = await http().get('/api/v1/horarios?atr_id=1');
    expect(contrato.respuesta('GET', '/api/v1/horarios', 200, h.body)).toEqual([]);
    const fecha = sumarDias(dia, 3);
    expect((await http().post('/api/v1/fechas-bloqueadas').send({ atr_id: 1, fb_fecha: fecha, fb_motivo: 'Mantenimiento' })).status).toBe(401);
    const antes = booking.recibidos.length;
    const b = await http().post('/api/v1/fechas-bloqueadas').set('Authorization', `Bearer ${jwt('ADMIN')}`).send({ atr_id: 1, fb_fecha: fecha, fb_motivo: 'Mantenimiento' });
    expect(b.status).toBe(201);
    expect(contrato.respuesta('POST', '/api/v1/fechas-bloqueadas', 201, b.body)).toEqual([]);
    await esperar(400);
    const nuevos = booking.recibidos.slice(antes);
    expect(nuevos.map((x) => [x.time_slot, x.available_units])).toEqual([['09:00 a.m.', 0], ['02:00 p.m.', 0]]);
    const d = await http().get(`/api/v3/atracciones/1/disponibilidad?date=${fecha}`);
    expect(d.body.total_available_slots).toBe(0);

    const cambio = await http().put('/api/v1/horarios/1').set('Authorization', `Bearer ${jwt('ADMIN')}`).send({ horarios: [{ hor_hora: '09:00', hor_cupo: 25 }] });
    expect(cambio.status).toBe(200);
    expect(contrato.respuesta('PUT', '/api/v1/horarios/{atr_id}', 200, cambio.body)).toEqual([]);
    expect(cambio.body.find((x: { hor_hora: string }) => x.hor_hora === '14:00').hor_activo).toBe(false);
    const t = await http().get(`/api/v1/disponibilidad?atr_id=1&desde=${dia}&hasta=${dia}`);
    expect(contrato.respuesta('GET', '/api/v1/disponibilidad', 200, t.body)).toEqual([]);
    expect(t.body.find((x: { hor_hora: string }) => x.hor_hora === '09:00').dis_cupo_total).toBe(25);
  });

  it('salud cumple el contrato', async () => {
    const r = await http().get('/api/v1/health');
    expect(contrato.respuesta('GET', '/api/v1/health', 200, r.body)).toEqual([]);
  });
});
