import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import { Client } from 'pg';
import request = require('supertest');
import { AppModule as Booking } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { hoyEc, sumarDias } from '../src/comun/tiempo';
import { AvisoCheckin } from '../src/aviso-checkin';
import { ReservasService } from '../src/reservas';
import { AppModule as Inventory } from '../../ms-inventory/src/app.module';
import { crearApp as crearInventory } from '../../ms-inventory/src/comun/arranque';
import { crearApp as crearInvoicing } from '../../ms-invoicing/src/comun/arranque';
import { crearApp as crearOrder } from '../../ms-order/src/comun/arranque';
import { crearApp as crearPayment } from '../../ms-payment/src/comun/arranque';
import { crearApp as crearPricing } from '../../ms-pricing/src/comun/arranque';
import { crearApp as crearRefund } from '../../ms-refund/src/comun/arranque';
import { DespachadorEventos as OutboxInventario } from '../../ms-inventory/src/comun/outbox';
import { AppModule as Invoicing } from '../../ms-invoicing/src/app.module';
import { AppModule as Order } from '../../ms-order/src/app.module';
import { AppModule as Payment } from '../../ms-payment/src/app.module';
import { AppModule as Pricing } from '../../ms-pricing/src/app.module';
import { AppModule as Refund } from '../../ms-refund/src/app.module';
import { Contrato, URL_PRUEBAS } from './helpers';

/**
 * Saga de punta a punta con los 7 servicios REALES en un mismo proceso (cada uno en su schema de la base de
 * pruebas, como en Supabase), hablando entre sí por gRPC (pricing, inventory, order), REST (payment, refund)
 * y SOAP (invoicing). Solo ms_catalog y ms_location son falsos. Respuestas validadas con los esquemas
 * OFICIALES del contrato v3 de Booking.
 */
const describeSaga = URL_PRUEBAS ? describe : describe.skip;
const CLAVE = 'clave-de-booking-para-pruebas-0123456789';
const TOKEN = 'token-servicios-pruebas-123';
const UUID_ATR = '188271cf-8d11-4d31-8f18-e1de2a525c8b';
const SCHEMAS = ['ms_pricing', 'ms_inventory', 'ms_order', 'ms_payment', 'ms_refund', 'ms_invoicing', 'ms_booking'];
const CONTRATO = join(__dirname, '..', 'contract');

async function sql(schema: string, texto: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL_PRUEBAS, options: `-c search_path=${schema}` });
  await c.connect();
  try {
    return (await c.query(texto, params)).rows;
  } finally {
    await c.end();
  }
}

/** ms_catalog y ms_location falsos: la atracción 3 (Cotopaxi), publicada. */
async function catalogoFalso() {
  const a = {
    atr_id: 3, atr_uuid: UUID_ATR, atr_nombre: 'Parque Nacional Cotopaxi', atr_estado: 'PUBLICADA', atr_eliminado_en: null, atr_moneda: 'USD',
    atr_direccion: null, atr_punto_encuentro: 'Parque La Carolina (Quito)', atr_guia: 'Carlos Pérez', atr_cancelacion_gratuita: true,
    atr_horas_cancelacion: 24, atr_duracion_horas: 10, ciu_id: 1,
  };
  const s: Server = createServer((req, res) => {
    const ref = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    const ok = req.url?.startsWith('/api/v1/atracciones/') && ['3', UUID_ATR, 'cotopaxi'].includes(ref);
    const ciudad = req.url === '/api/v1/ciudades/1';
    res.writeHead(ok || ciudad ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify(ok ? a : ciudad ? { ciu_id: 1, ciu_nombre: 'Latacunga' } : { code: 'NOT_FOUND', detail: 'no existe' }));
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((ok) => s.close(() => ok())) };
}

describeSaga('saga de reserva con los 7 microservicios reales', () => {
  const apps: Record<string, NestExpressApplication> = {};
  let catalogo: Awaited<ReturnType<typeof catalogoFalso>>;
  const contrato = new Contrato(join(CONTRATO, 'openapi.yaml'), 'booking', [join(CONTRATO, 'booking-atracciones-v3.yaml')]);
  const http = () => request(apps.booking.getHttpServer());
  const dia = sumarDias(hoyEc(), 12);
  const slot = `slot-${dia.replace(/-/g, '')}-0630`;
  const pedido = (extra: Record<string, unknown> = {}) => ({
    attraction_id: UUID_ATR, date: dia, time: '06:30 a.m.', slot_id: slot, adult_count: 2, child_count: 1, infant_count: 1, total_tickets: 4,
    customer: { name: 'Luis Andrade', email: 'luis@correo.com', phone: '+593991234567', document_id: '1724589633' },
    booking_reservation_id: `BK-${randomUUID().slice(0, 8)}`, ...extra,
  });
  const reservar = (cuerpo: object, clave = randomUUID()) =>
    http().post('/api/v3/atracciones/reservas').set('X-API-Key', CLAVE).set('Idempotency-Key', clave).send(cuerpo);
  const libres = async () => (await sql('ms_inventory', `SELECT dis_cupo_total - dis_cupo_reservado AS n FROM disponibilidad WHERE dis_fecha = $1`, [dia]))[0]?.n ?? 10;

  /** Levanta un servicio real en su schema y su puerto gRPC; devuelve su URL HTTP. */
  // Cada servicio con SU arranque (su propia copia de src/comun y de DbService)
  async function levantar(nombre: string, modulo: unknown, schema: string, grpc?: number, arrancar: typeof crearApp = crearApp) {
    Object.assign(process.env, { DATABASE_URL: URL_PRUEBAS, DB_SCHEMA: schema, GRPC_PORT: grpc ? String(grpc) : '' });
    if (!grpc) delete process.env.GRPC_PORT;
    const app = await arrancar(modulo, nombre);
    await app.listen(0, '127.0.0.1');
    apps[nombre.replace('ms-', '')] = app;
    return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  beforeAll(async () => {
    catalogo = await catalogoFalso();
    const c = new Client({ connectionString: URL_PRUEBAS });
    await c.connect();
    for (const s of SCHEMAS) await c.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await c.end();
    Object.assign(process.env, {
      NODE_ENV: 'test', SERVICIOS_TOKEN: TOKEN, BOOKING_API_KEY: CLAVE, JWT_SECRET: 'secreto-de-pruebas-de-la-saga-0123456789',
      CATALOG_URL: catalogo.url, LOCATION_URL: catalogo.url, BOOKING_GRPC_ENABLED: 'false', PUBLIC_URL: 'https://gateway.prueba',
      PRICING_GRPC_URL: '127.0.0.1:50244', INVENTORY_GRPC_URL: '127.0.0.1:50245', ORDER_GRPC_URL: '127.0.0.1:50247',
    });
    await levantar('ms-pricing', Pricing, 'ms_pricing', 50244, crearPricing);
    await levantar('ms-inventory', Inventory, 'ms_inventory', 50245, crearInventory);
    await levantar('ms-order', Order, 'ms_order', 50247, crearOrder);
    process.env.PAYMENT_URL = await levantar('ms-payment', Payment, 'ms_payment', undefined, crearPayment);
    process.env.REFUND_URL = await levantar('ms-refund', Refund, 'ms_refund', undefined, crearRefund);
    process.env.INVOICING_URL = await levantar('ms-invoicing', Invoicing, 'ms_invoicing', undefined, crearInvoicing);
    process.env.BOOKING_URL = await levantar('ms-booking', Booking, 'ms_booking', 50248);
    process.env.EVENTOS_DESTINOS = `${process.env.BOOKING_URL}/api/v1/internal/eventos`;
    await sql('ms_pricing', `INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_vigente_desde) VALUES (3, 'ADULTO', 65, '2021-01-01'), (3, 'NINO', 45, '2021-01-01')`);
    await sql('ms_inventory', `INSERT INTO horario (atr_id, hor_hora, hor_cupo) VALUES (3, '06:30', 10)`);
  }, 120_000);
  afterAll(async () => {
    for (const a of Object.values(apps).reverse()) await a.close();
    await catalogo?.cerrar();
  });

  it('crear: 201 con el esquema OFICIAL, y cada servicio quedó con su parte (cupos, orden por tipo, pago, factura SOAP, eventos)', async () => {
    const r = await reservar(pedido());
    expect(r.status).toBe(201);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({
      success: true, status: 'CONFIRMED', total_price: 175, ticket_count: 4, adult_count: 2, child_count: 1, infant_count: 1,
      payment_status: 'PAID', payment_method: 'SOA_BOOKING_GATEWAY', punto_encuentro: 'Parque La Carolina (Quito)', guia_asignado: 'Carlos Pérez',
      customer: { full_name: 'Luis Andrade', document_type: 'CEDULA', document_id: '1724589633', phone: '+593991234567' },
    });
    expect(r.body.reservation_code).toMatch(/^DEC-[A-Z2-9]{6}$/);
    expect(r.body.external_order_id).toBe(r.body.reservation_code.replace('DEC-', 'ORD-'));
    expect(r.headers.location).toBe(`/api/v3/atracciones/reservas/${r.body.reservation_id}`);
    expect(await libres()).toBe(6);

    const [o] = await sql('ms_order', `SELECT o.ord_id::int, e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE ord_numero = $1`, [r.body.external_order_id]);
    expect(o.est_codigo).toBe('PAGADA');
    const lineas = await sql('ms_order', 'SELECT det_descripcion, det_cantidad, det_precio_unitario::text AS p FROM orden_detalle WHERE ord_id = $1 ORDER BY det_id', [o.ord_id]);
    expect(lineas.map((l) => [l.det_descripcion.split(' · ').pop(), l.det_cantidad, l.p])).toEqual([['Adulto', 2, '65.00'], ['Niño', 1, '45.00'], ['Infante', 1, '0.00']]);
    const [pago] = await sql('ms_payment', `SELECT e.est_codigo, pag_monto::text AS m FROM pago p JOIN estado e ON e.est_id = p.est_id WHERE ord_id = $1`, [o.ord_id]);
    expect(pago).toEqual({ est_codigo: 'APROBADO', m: '175.00' });
    const fac = await sql('ms_invoicing', `SELECT f.fac_numero, f.fac_total::text AS t, e.est_codigo, f.fac_identificacion, (SELECT count(*)::int FROM factura_detalle d WHERE d.fac_id = f.fac_id) AS lineas
      FROM factura f JOIN estado e ON e.est_id = f.est_id WHERE ord_id = $1`, [o.ord_id]);
    expect(fac).toEqual([{ fac_numero: `001-001-${String(o.ord_id).padStart(9, '0')}`, t: '175.00', est_codigo: 'PAGADA', fac_identificacion: '1724589633', lineas: 3 }]);

    // El stock de ms_inventory llega al feed de eventos de ms_booking (outbox → POST /internal/eventos)
    expect(await apps.inventory.get(OutboxInventario).despachar()).toBeGreaterThan(0);
    const feed = await http().get('/api/v3/atracciones/eventos').set('X-API-Key', CLAVE);
    expect(contrato.respuesta('GET', '/api/v3/atracciones/eventos', 200, feed.body)).toEqual([]);
    expect(feed.body.map((e: { event_type: string }) => e.event_type)).toEqual(expect.arrayContaining(['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO']));
    const stock = feed.body.find((e: { event_type: string }) => e.event_type === 'STOCK_ACTUALIZADO');
    expect(stock.data).toMatchObject({ attraction_id: UUID_ATR, date: dia, available_units: 6 });
    expect(JSON.stringify(feed.body)).not.toContain('1724589633'); // sin PII en los eventos

    const una = await http().get(`/api/v3/atracciones/reservas/${r.body.reservation_code}`).set('X-API-Key', CLAVE);
    expect(contrato.respuesta('GET', '/api/v3/atracciones/reservas/{id}', 200, una.body)).toEqual([]);
    expect(una.body.reservation_id).toBe(r.body.reservation_id);
  });

  it('idempotencia: la misma clave repite la misma reserva; con otro cuerpo → 409; URL base de la guía también responde', async () => {
    const clave = randomUUID();
    const cuerpo = pedido({ adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1 });
    const a = await reservar(cuerpo, clave);
    const b = await reservar(cuerpo, clave);
    expect(b.body.reservation_id).toBe(a.body.reservation_id);
    expect(await libres()).toBe(5);
    const otro = await reservar({ ...cuerpo, adult_count: 2, total_tickets: 2 }, clave);
    expect(otro.status).toBe(409);
    expect(otro.body.code).toBe('IDEMPOTENCY_CONFLICT');
    const base = await http().post('/api/v3/reservas').set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID()).send(cuerpo);
    expect(base.status).toBe(201);
    expect(base.headers.location).toBe(`/api/v3/reservas/${base.body.reservation_id}`);
    expect(await libres()).toBe(4);
  });

  it('sin cupos: 409 OUT_OF_STOCK (código del contrato, llega desde ms_inventory por gRPC) y nada queda creado', async () => {
    const ordenes = (await sql('ms_order', 'SELECT count(*)::int AS n FROM orden'))[0].n;
    const r = await reservar(pedido({ adult_count: 9, child_count: 0, infant_count: 0, total_tickets: 9 }));
    expect(r.status).toBe(409);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas', 409, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ code: 'OUT_OF_STOCK', detail: expect.stringContaining('Solo quedan 4 cupo(s)') });
    expect((await sql('ms_order', 'SELECT count(*)::int AS n FROM orden'))[0].n).toBe(ordenes);
    expect(await libres()).toBe(4);
  });

  it('compensación: si ms_payment se cae a mitad de la saga → 503, se devuelven los cupos y la orden queda CANCELADA', async () => {
    const url = process.env.PAYMENT_URL;
    process.env.PAYMENT_URL = 'http://127.0.0.1:9';
    try {
      const r = await reservar(pedido({ adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1 }));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    } finally {
      process.env.PAYMENT_URL = url;
    }
    expect(await libres()).toBe(4);
    const [o] = await sql('ms_order', `SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id ORDER BY ord_id DESC LIMIT 1`);
    expect(o.est_codigo).toBe('CANCELADA');
  });

  it('cancelar (SAGA_ORCHESTRATOR): reembolso, orden REEMBOLSADA, factura ANULADA con su detalle, cupos de vuelta; repetir → 200 igual', async () => {
    const r = await reservar(pedido({ adult_count: 2, child_count: 0, infant_count: 0, total_tickets: 2 }));
    expect(await libres()).toBe(2);
    const c = await http().post(`/api/v3/atracciones/reservas/${r.body.reservation_id}/cancel`).set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID())
      .send({ reason: 'Compensación de saga', solicitante: 'SAGA_ORCHESTRATOR' });
    expect(c.status).toBe(200);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas/{id}/cancel', 200, c.body)).toEqual([]);
    expect(c.body).toMatchObject({ status: 'CANCELLED', payment_status: 'REFUNDED', monto_reembolsado: 130, reembolso_id: expect.stringMatching(/^REM-\d{9}$/) });
    expect(await libres()).toBe(4);
    const [o] = await sql('ms_order', `SELECT o.ord_id::int, e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE ord_numero = $1`, [r.body.external_order_id]);
    expect(o.est_codigo).toBe('REEMBOLSADA');
    const [f] = await sql('ms_invoicing', `SELECT e.est_codigo, (SELECT count(*)::int FROM factura_detalle d WHERE d.fac_id = f.fac_id) AS lineas FROM factura f JOIN estado e ON e.est_id = f.est_id WHERE ord_id = $1`, [o.ord_id]);
    expect(f).toEqual({ est_codigo: 'ANULADA', lineas: 1 });
    const otra = await http().post(`/api/v3/atracciones/reservas/${r.body.reservation_id}/cancel`).set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID()).send({ solicitante: 'SAGA_ORCHESTRATOR' });
    expect(otra.status).toBe(200);
    expect(await libres()).toBe(4);
  });

  it('transferencia: reserva CONFIRMED con pago PENDING y sin factura; al cancelar el pago se RECHAZA y la orden se CANCELA', async () => {
    const r = await reservar(pedido({ adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1, payment_method: 'TRANSFERENCIA' }));
    expect(r.body).toMatchObject({ status: 'CONFIRMED', payment_status: 'PENDING' });
    const [o] = await sql('ms_order', `SELECT o.ord_id::int FROM orden o WHERE ord_numero = $1`, [r.body.external_order_id]);
    expect(await sql('ms_invoicing', 'SELECT 1 FROM factura WHERE ord_id = $1', [o.ord_id])).toEqual([]);
    await http().post(`/api/v3/atracciones/reservas/${r.body.reservation_id}/cancel`).set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID()).send({ solicitante: 'ADMIN' });
    const [p] = await sql('ms_payment', `SELECT e.est_codigo FROM pago p JOIN estado e ON e.est_id = p.est_id WHERE ord_id = $1`, [o.ord_id]);
    expect(p.est_codigo).toBe('RECHAZADO');
    const [o2] = await sql('ms_order', `SELECT e.est_codigo FROM orden o JOIN estado e ON e.est_id = o.est_id WHERE ord_id = $1`, [o.ord_id]);
    expect(o2.est_codigo).toBe('CANCELADA');
  });

  it('factura pendiente: si ms_invoicing no responde la reserva igual se confirma; la factura se emite al reintentar', async () => {
    const url = process.env.INVOICING_URL;
    process.env.INVOICING_URL = 'http://127.0.0.1:9';
    // El cliente SOAP ya está creado con la URL buena: se fuerza a crearlo de nuevo
    (apps.booking.get(ReservasService) as unknown as { facturas: { cliente: unknown } }).facturas.cliente = null;
    let r: request.Response;
    try {
      r = await reservar(pedido({ adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1 }));
      expect(r.status).toBe(201);
    } finally {
      process.env.INVOICING_URL = url;
      (apps.booking.get(ReservasService) as unknown as { facturas: { cliente: unknown } }).facturas.cliente = null;
    }
    expect((await sql('ms_booking', 'SELECT res_factura_pendiente AS p FROM reserva WHERE res_uuid = $1', [r!.body.reservation_id]))[0].p).toBe(true);
    expect(await apps.booking.get(ReservasService).facturasPendientes()).toBe(1);
    const [o] = await sql('ms_order', `SELECT ord_id::int FROM orden WHERE ord_numero = $1`, [r!.body.external_order_id]);
    expect(await sql('ms_invoicing', 'SELECT fac_numero FROM factura WHERE ord_id = $1', [o.ord_id])).toHaveLength(1);
  });

  it('check-in con el esquema oficial: la misma clave repite el pase; otra clave → 409 ALREADY_CHECKED_IN; voucher QR y .ics', async () => {
    const r = await reservar(pedido({ adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1 }));
    const clave = randomUUID();
    const ruta = `/api/v3/atracciones/reservas/${r.body.reservation_id}/checkin`;
    const ok = await http().post(ruta).set('X-API-Key', CLAVE).set('Idempotency-Key', clave).send({ documento_identidad: '1724589633', codigo_voucher_qr: r.body.voucher_qr_payload });
    expect(ok.status).toBe(200);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas/{id}/checkin', 200, ok.body)).toEqual([]);
    expect(ok.body).toMatchObject({ estado: 'CHECKED_IN', titular_documento: '1724589633', guia_asignado: 'Carlos Pérez' });
    expect((await http().post(ruta).set('X-API-Key', CLAVE).set('Idempotency-Key', clave).send({ documento_identidad: '1724589633', codigo_voucher_qr: r.body.voucher_qr_payload })).body.hora_checkin).toBe(ok.body.hora_checkin);
    const otra = await http().post(ruta).set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID()).send({ documento_identidad: '1724589633' });
    expect(otra.status).toBe(409);
    expect(otra.body.code).toBe('ALREADY_CHECKED_IN');

    const qr = await http().get(`/api/v3/atracciones/vouchers/${r.body.reservation_code}/qr.png`);
    expect(qr.headers['content-type']).toBe('image/png');
    const ics = new URL(r.body.ics_calendar_url);
    const cal = await http().get(`${ics.pathname}${ics.search}`);
    expect(cal.status).toBe(200);
    expect(cal.text).toContain('SUMMARY:Parque Nacional Cotopaxi');
    expect((await http().get(`${ics.pathname}?t=1.firma-falsa`)).status).toBe(404);
  });

  it('client_id (v3.1): se acepta en la raíz o en customer y se guarda; si no coinciden o no es válido → 400', async () => {
    const turista = { name: 'Pepito Evaluador', email: 'pepito@booking.com', phone: '0998765432', document_id: '1710034065' };
    const uno = { adult_count: 1, child_count: 0, infant_count: 0, total_tickets: 1 };
    const guardado = async (codigo: string) => (await sql('ms_booking', 'SELECT res_client_id FROM reserva WHERE res_codigo = $1', [codigo]))[0].res_client_id;

    const ambos = await reservar(pedido({ ...uno, client_id: 'DEC-USR-1029', customer: { ...turista, client_id: 'DEC-USR-1029' } }));
    expect(ambos.status).toBe(201);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas', 201, ambos.body)).toEqual([]);
    expect(await guardado(ambos.body.reservation_code)).toBe('DEC-USR-1029');

    const soloCliente = await reservar(pedido({ ...uno, customer: { ...turista, client_id: 'DEC-USR-2000' } }));
    expect(soloCliente.status).toBe(201);
    expect(await guardado(soloCliente.body.reservation_code)).toBe('DEC-USR-2000');

    const antes = await libres();
    expect((await reservar(pedido({ ...uno, client_id: 'DEC-USR-1', customer: { ...turista, client_id: 'DEC-USR-2' } }))).status).toBe(400);
    expect((await reservar(pedido({ ...uno, client_id: 'no válido' }))).status).toBe(400);
    expect(await libres()).toBe(antes); // rechazadas sin retener cupos
  });

  it('aviso de check-in (v3.1): cuerpo oficial con la X-API-Key y reintento si Booking no respondió', async () => {
    const recibidos: { url?: string; clave?: unknown; cuerpo: Record<string, unknown> }[] = [];
    let responder = 503;
    const falso = createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        recibidos.push({ url: req.url, clave: req.headers['x-api-key'], cuerpo: JSON.parse(b) });
        res.writeHead(responder, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ acknowledged: responder === 200, status: 'CONFIRMADO_ASISTIDO' }));
      });
    });
    await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
    process.env.BOOKING_API_URL = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
    process.env.BOOKING_AVISOS_ENABLED = 'true';
    process.env.BOOKING_API_KEY = CLAVE;
    const aviso = apps.booking.get(AvisoCheckin);
    const estado = async (codigo: string) => (await sql('ms_booking', 'SELECT res_aviso_checkin AS e, res_aviso_intentos AS n FROM reserva WHERE res_codigo = $1', [codigo]))[0];
    try {
      await sql('ms_inventory', 'UPDATE disponibilidad SET dis_cupo_total = dis_cupo_total + 5 WHERE dis_fecha = $1', [dia]);
      const r = await reservar(pedido({ adult_count: 2, child_count: 0, infant_count: 0, total_tickets: 2, client_id: 'DEC-USR-7' }));
      const ruta = `/api/v3/atracciones/reservas/${r.body.reservation_id}/checkin`;
      const ok = await http().post(ruta).set('X-API-Key', CLAVE).set('Idempotency-Key', randomUUID()).send({ documento_identidad: '1724589633' });
      expect(ok.status).toBe(200); // la caída de Booking no afecta al guía

            for (let i = 0; i < 50 && (await estado(r.body.reservation_code)).n === 0; i++) await new Promise((f) => setTimeout(f, 20));
      expect(await estado(r.body.reservation_code)).toEqual({ e: 'PENDIENTE', n: 1 });
      const deEsta = () => recibidos.filter((x) => x.url?.includes(r.body.reservation_code));
      expect(deEsta()[0]).toMatchObject({ url: `/api/v3/reservas/${r.body.reservation_code}/checkin`, clave: CLAVE });
      expect(deEsta()[0].cuerpo).toEqual({
        external_order_id: r.body.reservation_code, client_id: 'DEC-USR-7', estado: 'CONFIRMADO_ASISTIDO', asistentes_reales: 2,
        admin_id: 'guia-turistico', fecha_checkin: ok.body.hora_checkin, observaciones: 'Turista validado en el punto de encuentro',
      });

      responder = 200;
      await sql('ms_booking', "UPDATE reserva SET res_aviso_intento_en = now() - interval '1 minute' WHERE res_codigo = $1", [r.body.reservation_code]);
      await aviso.reintentar();
      expect(await estado(r.body.reservation_code)).toEqual({ e: 'ENVIADO', n: 2 });
      await aviso.reintentar();
      expect(deEsta()).toHaveLength(2); // ya confirmado: no se repite
    } finally {
      delete process.env.BOOKING_AVISOS_ENABLED;
      await new Promise((f) => falso.close(f));
    }
  });

  it('validaciones del contrato: SLOT_TIME_MISMATCH, cédula inválida 422, sin Idempotency-Key 400, sin X-API-Key 401', async () => {
    const slotMal = await reservar(pedido({ time: '09:00 a.m.' }));
    expect(slotMal.status).toBe(400);
    expect(slotMal.body.code).toBe('SLOT_TIME_MISMATCH');
    const ced = await reservar(pedido({ customer: { name: 'Luis Andrade', email: 'luis@correo.com', phone: '+593991234567', document_id: '1712345678' } }));
    expect(ced.status).toBe(422);
    expect(contrato.respuesta('POST', '/api/v3/atracciones/reservas', 422, ced.body)).toEqual([]);
    expect(ced.body.code).toBe('INVALID_DOCUMENT');
    expect((await http().post('/api/v3/atracciones/reservas').set('X-API-Key', CLAVE).send(pedido())).status).toBe(400);
    expect((await http().post('/api/v3/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(pedido())).status).toBe(401);
    expect((await http().get('/api/v3/atracciones/reservas/no-existe').set('X-API-Key', CLAVE)).status).toBe(404);
  });
});
