import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import request = require('supertest');
import { bearer, createTestApp, db, describeDb, fechaEc, freshIp, login, USERS } from './helpers';

/**
 * Contrato v2 FINAL con Booking Prototipo (contracts/atracciones-openapi-v2.yaml) de punta a punta:
 * seguridad (X-API-Key o JWT de admin), catálogo, disponibilidad, reserva con slot_id (201 / 409
 * OUT_OF_STOCK / 422), alias en español, estudiantes, check-in idempotente, cancelación como
 * compensación, promociones B2B, eventos CloudEvents, salud del nodo y stock por gRPC (CE01).
 */
interface Push {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: string;
  slot_id: string;
}

/** Servidor gRPC de Booking simulado: guarda cada PushStockUpdate que recibe. */
async function bookingGrpcSimulado() {
  const def = protoLoader.loadSync(join(__dirname, '..', '..', 'src', 'proto', 'inventory.proto'), { keepCase: true, longs: String, defaults: true });
  const pkg = grpc.loadPackageDefinition(def) as unknown as { inventory: { InventoryStockService: grpc.ServiceClientConstructor } };
  const recibidos: { msg: Push; correlacion?: string }[] = [];
  const server = new grpc.Server();
  server.addService(pkg.inventory.InventoryStockService.service, {
    PushStockUpdate: (call: grpc.ServerUnaryCall<Push, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      recibidos.push({ msg: call.request, correlacion: call.metadata.get('x-correlation-id')[0] as string | undefined });
      cb(null, { success: true, message: 'Stock recibido', processed_at: String(Date.now()) });
    },
    StreamInventoryChanges: (_call: unknown, cb: grpc.sendUnaryData<unknown>) => cb(null, { total_events_processed: 0, is_synchronized: true }),
    GetSlotAvailability: (_call: unknown, cb: grpc.sendUnaryData<unknown>) => cb(null, {}),
  });
  const puerto = await new Promise<number>((ok, mal) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? mal(e) : ok(p))),
  );
  return { recibidos, puerto, cerrar: () => new Promise<void>((ok) => server.tryShutdown(() => ok())) };
}

const esperar = async (cond: () => boolean | Promise<boolean>, ms = 5000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Tiempo de espera agotado');
};

describeDb('Contrato v2 final con Booking Prototipo (E2E)', () => {
  let app: NestExpressApplication;
  let grpcMock: Awaited<ReturnType<typeof bookingGrpcSimulado>>;
  let atr: { id: string; slug: string };
  const API_KEY = randomBytes(24).toString('hex');

  const v2 = (conClave = true) => {
    const s = app.getHttpServer();
    const w = (t: request.Test) => {
      t.set('X-Forwarded-For', freshIp());
      return conClave ? t.set('X-API-Key', API_KEY) : t;
    };
    return {
      get: (u: string) => w(request(s).get(`/api/v2${u}`)),
      post: (u: string) => w(request(s).post(`/api/v2${u}`)),
      put: (u: string) => w(request(s).put(`/api/v2${u}`)),
    };
  };
  const cliente = (extra: Record<string, unknown> = {}) => ({
    full_name: 'Paúl Rosero',
    email: 'paul.rosero@epn.edu.ec',
    phone: '+593991234567',
    document_type: 'CEDULA',
    document_id: '1710034065',
    ...extra,
  });
  /**
   * Primer turno con al menos `minimo` cupos libres en `dias` días (por la ruta canónica /disponibilidad).
   * Con una base de pruebas reutilizada, los turnos se van llenando: se elige uno con cupos suficientes.
   */
  const turno = async (dias: number, minimo = 1) => {
    const fecha = fechaEc(dias);
    const r = await v2(false).get(`/atracciones/${atr.id}/disponibilidad?date=${fecha}`);
    const slot = r.body.time_slots.find((t: { cupos_disponibles: number }) => t.cupos_disponibles >= minimo);
    if (!slot) throw new Error(`Sin turnos con ${minimo} cupos el ${fecha}: usa una base de pruebas nueva.`);
    return { fecha, slot };
  };
  const reserva = (fecha: string, slot: { slot_id: string; time_24h: string }, extra: Record<string, unknown> = {}) => ({
    atraccion_id: atr.id, fecha, slot_id: slot.slot_id, hora: slot.time_24h, adult_count: 1,
    customer: cliente(), payment_method: 'SOA_BOOKING_GATEWAY', ...extra,
  });

  beforeAll(async () => {
    grpcMock = await bookingGrpcSimulado();
    process.env.BOOKING_GRPC_ENABLED = 'true';
    process.env.BOOKING_GRPC_URL = `localhost:${grpcMock.puerto}`;
    process.env.BOOKING_GRPC_TLS = 'false';
    process.env.BOOKING_API_KEY = API_KEY;
    app = await createTestApp();
    const l = await v2(false).get('/atracciones?limit=50');
    const conCupos = l.body.data.find((a: { free_cancellation: boolean }) => a.free_cancellation);
    atr = { id: conCupos.id, slug: conCupos.slug };
  });
  afterAll(async () => {
    await app?.close();
    await grpcMock?.cerrar();
    for (const k of ['BOOKING_GRPC_ENABLED', 'BOOKING_GRPC_URL', 'BOOKING_GRPC_TLS', 'BOOKING_API_KEY']) delete process.env[k];
  });

  describe('seguridad del contrato (BearerAuth o ApiKeyAuth)', () => {
    it('catálogo, disponibilidad y salud son públicos; reservas, eventos y promociones exigen credenciales', async () => {
      expect((await v2(false).get('/atracciones/categorias/arbol')).status).toBe(200);
      expect((await v2(false).get('/atracciones/health')).status).toBe(200);
      const sinClave = await v2(false).get('/atracciones/eventos');
      expect(sinClave.status).toBe(401);
      expect(sinClave.body).toMatchObject({ code: 'UNAUTHORIZED', correlation_id: expect.any(String) });
      expect((await v2(false).get('/atracciones/eventos').set('X-API-Key', 'clave-falsa-123')).status).toBe(401);
      expect((await v2().get('/atracciones/eventos')).status).toBe(200);
      // JWT: un cliente no tiene permisos (403); el administrador sí
      const cli = await login(app, USERS.cliente);
      expect((await v2(false).get('/atracciones/promociones/contrato').set(bearer(cli))).status).toBe(403);
      const adm = await login(app, USERS.admin);
      expect((await v2(false).get('/atracciones/promociones/contrato').set(bearer(adm))).status).toBe(200);
      // Las rutas que el contrato final quitó ya no existen
      expect((await v2(false).get(`/atracciones/${atr.id}/availability?date=${fechaEc(5)}`)).status).toBe(404);
    });
  });

  describe('catálogo', () => {
    it('árbol y lista plana de categorías con banderas de inclusión', async () => {
      const r = await v2(false).get('/atracciones/categorias/arbol');
      const naturaleza = r.body.find((c: { slug: string }) => c.slug === 'naturales');
      expect(naturaleza).toMatchObject({ id: expect.stringMatching(/^cat-\d+$/), incluye_transporte: true, incluye_guia: true });
      expect(naturaleza.subcategorias.map((c: { slug: string }) => c.slug)).toContain('vida-silvestre');
      const plana = await v2(false).get(`/atracciones/categorias?padre_id=${naturaleza.id}`);
      expect(plana.body).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'vida-silvestre', padre_id: naturaleza.id })]));
    });

    it('listado y búsqueda con alias en español y las 5 tarifas', async () => {
      const l = await v2(false).get('/atracciones?city=quito&limit=3&sort=PRICE_ASC');
      expect(l.status).toBe(200);
      const card = l.body.data[0];
      expect(card).toMatchObject({ city: 'Quito', ciudad: 'Quito', price: { currency: 'USD', infant: 0 }, precio: { moneda: 'USD', infante: 0 } });
      expect(card.price.student).toBeLessThan(card.price.adult);
      expect(card.price.estudiante).toBe(card.price.student);
      const s = await v2(false).post('/atracciones/search').send({ query: 'quito', fecha_inicio: fechaEc(5), fecha_fin: fechaEc(8), cantidad_adultos: 2 });
      expect(s.status).toBe(200);
      expect(s.body.data.length).toBeGreaterThan(0);
    });

    it('ficha por slug con itinerario, pilares y alias en español', async () => {
      const r = await v2(false).get(`/atracciones/${atr.slug}`);
      expect(r.status).toBe(200);
      expect(r.body.itinerary[0]).toMatchObject({ stop_number: 1, numero_parada: 1, time: expect.stringMatching(/[ap]\.m\.$/) });
      expect(r.body.rating.breakdown).toMatchObject({ limpieza: expect.any(Number), cleanliness: expect.any(Number), value_for_money: expect.any(Number) });
      expect(r.body.punto_encuentro_geo).toMatchObject({ latitud: expect.any(Number), longitud: expect.any(Number) });
      expect(r.body.accesibilidad).toHaveProperty('accesible_silla_ruedas');
      expect(r.body.politica_cancelacion).toHaveProperty('horas_limite');
    });

    it('disponibilidad por /disponibilidad con date o fecha y alias de turnos', async () => {
      const fecha = fechaEc(6);
      const r = await v2(false).get(`/atracciones/${atr.id}/disponibilidad?fecha=${fecha}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ date: fecha, fecha });
      expect(r.body.turnos).toEqual(r.body.time_slots);
      expect(r.body.time_slots[0]).toMatchObject({ slot_id: expect.stringMatching(/^slot-\d{8}-\d{4}$/), hora_24h: expect.stringMatching(/^\d{2}:\d{2}:00$/) });
      expect((await v2(false).get(`/atracciones/${atr.id}/disponibilidad?date=2020-01-01`)).status).toBe(400);
    });
  });

  describe('reservas y saga', () => {
    it('201 con slot_id, cinco tipos de boleto, voucher y Location; la misma Idempotency-Key no duplica; el stock llega por gRPC', async () => {
      const { fecha, slot } = await turno(10, 6);
      const key = randomUUID();
      const cuerpo = reserva(fecha, slot, {
        adult_count: 2, child_count: 1, senior_count: 1, student_count: 1, infant_count: 1, saga_id: 'SAGA-E2E-1',
        passengers: [{ full_name: 'Mateo Rosero', ticket_type: 'CHILD' }, { full_name: 'Ana Rosero', ticket_type: 'STUDENT' }],
      });
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', key).set('X-Correlation-Id', 'cid-e2e-12345').send(cuerpo);
      expect(r.status).toBe(201);
      expect(r.headers.location).toBe(`/api/v2/atracciones/reservas/${r.body.reservation_id}`);
      expect(r.body).toMatchObject({
        external_order_id: expect.stringMatching(/^ORD-/), reservation_code: expect.stringMatching(/^DEC-/), status: 'CONFIRMED', estado: 'CONFIRMED',
        ticket_count: 6, adult_count: 2, child_count: 1, senior_count: 1, student_count: 1, infant_count: 1, cantidad_estudiantes: 1,
        customer: { full_name: 'Paúl Rosero', nombre_completo: 'Paúl Rosero', phone: '+593991234567' },
        voucher_qr_payload: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      });
      const precio = (await v2(false).get(`/atracciones/${atr.id}`)).body.price;
      expect(r.body.total_price).toBeCloseTo(2 * precio.adult + precio.child + precio.senior + precio.student, 2);

      const otra = await v2().post('/atracciones/reservas').set('Idempotency-Key', key).send(cuerpo);
      expect(otra.body.reservation_id).toBe(r.body.reservation_id);
      const despues = await v2(false).get(`/atracciones/${atr.id}/disponibilidad?date=${fecha}`);
      expect(despues.body.time_slots.find((t: { slot_id: string }) => t.slot_id === slot.slot_id).cupos_disponibles).toBe(slot.cupos_disponibles - 6);

      const lineas = await db(app).query(
        `SELECT fd.fde_codigo AS codigo FROM factura_detalle fd JOIN factura f ON f.fac_id = fd.fac_id
           JOIN orden o ON o.ord_id = f.ord_id WHERE o.ord_numero = $1 ORDER BY fd.fde_linea`,
        [r.body.external_order_id],
      );
      expect(lineas.map((l: { codigo: string }) => l.codigo.slice(-3))).toEqual(['-AD', '-NI', '-SE', '-ES', '-IN']);

      await esperar(() => grpcMock.recibidos.some((x) => x.msg.date === fecha && x.msg.time_slot === slot.time));
      const push = grpcMock.recibidos.filter((x) => x.msg.date === fecha && x.msg.time_slot === slot.time).at(-1)!;
      expect(push.msg).toMatchObject({ service_id: 'NODE_ATR_DILAN', item_id: atr.id, available_units: slot.cupos_disponibles - 6 });
      expect(push.correlacion).toBe('cid-e2e-12345');
      expect((await v2().get(`/atracciones/reservas/${r.body.reservation_code}`)).body.reservation_id).toBe(r.body.reservation_id);
    });

    it('acepta el cuerpo con los alias en español del contrato', async () => {
      const { fecha, slot } = await turno(9);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send({
        atraccion_id: atr.id, fecha, slot_id: slot.slot_id, time_24h: slot.time_24h, cantidad_adultos: 1, metodo_pago: 'SOA_BOOKING_GATEWAY',
        observaciones: 'Viajamos con una persona vegetariana',
        customer: { nombre_completo: 'Lucía Andrade', correo: 'lucia@correo.ec', telefono: '0991112233', tipo_documento: 'CEDULA', numero_documento: '1710034065' },
      });
      expect(r.status).toBe(201);
      expect(r.body.customer).toMatchObject({ full_name: 'Lucía Andrade', email: 'lucia@correo.ec', document_id: '1710034065' });
    });

    it('409 OUT_OF_STOCK; 400 sin slot_id o con slot_id que no coincide; 422 con cédula inválida', async () => {
      const { fecha, slot } = await turno(11);
      if (slot.cupos_disponibles + 1 <= 50) {
        const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).set('X-Correlation-Id', 'cid-sin-cupos-1')
          .send(reserva(fecha, slot, { adult_count: slot.cupos_disponibles + 1 }));
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ code: 'OUT_OF_STOCK', correlation_id: 'cid-sin-cupos-1', timestamp: expect.any(String) });
      }
      const { slot_id: _s, ...sinSlot } = reserva(fecha, slot);
      const s1 = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(sinSlot);
      expect(s1.status).toBe(400);
      expect(s1.body.invalid_params.map((p: { name: string }) => p.name)).toContain('slot_id');
      expect((await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send({ ...reserva(fecha, slot), slot_id: 'slot-20200101-0900' })).status).toBe(400);
      const ced = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(reserva(fecha, slot, { customer: cliente({ document_id: '1710034066' }) }));
      expect(ced.status).toBe(422);
      expect(ced.body.code).toBe('INVALID_DOCUMENT');
    });

    it('check-in idempotente: misma clave → mismo pase (200); otra clave → 409; luego no se cancela (409)', async () => {
      const { fecha, slot } = await turno(13);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(reserva(fecha, slot, { payment_method: 'PAGO_EN_SITIO' }));
      expect(r.status).toBe(201);
      const url = `/atracciones/reservas/${r.body.reservation_id}/checkin`;
      expect((await v2().post(url).send({ documento_identidad: '1710034065' })).status).toBe(400); // sin Idempotency-Key
      expect((await v2().post(url).set('Idempotency-Key', randomUUID()).send({ documento_identidad: '0102030405' })).status).toBe(400);
      const key = randomUUID();
      const ok = await v2().post(url).set('Idempotency-Key', key).send({ documento_identidad: '1710034065', codigo_voucher_qr: r.body.voucher_qr_payload });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ estado: 'CHECKED_IN', titular_documento: '1710034065' });
      const repetido = await v2().post(url).set('Idempotency-Key', key).send({ documento_identidad: '1710034065', codigo_voucher_qr: r.body.voucher_qr_payload });
      expect(repetido.status).toBe(200);
      expect(repetido.body.hora_checkin).toBe(ok.body.hora_checkin);
      expect((await v2().post(url).set('Idempotency-Key', randomUUID()).send({ documento_identidad: '1710034065' })).status).toBe(409);
      expect((await v2().get(`/atracciones/reservas/${r.body.reservation_id}`)).body.status).toBe('CHECKED_IN');
      expect((await v2(false).get(`/atracciones/vouchers/${r.body.reservation_code}/qr.png?tipo=pase`)).status).toBe(200);
      const c = await v2().post(`/atracciones/reservas/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID()).send({ solicitante: 'SAGA_ORCHESTRATOR' });
      expect(c.status).toBe(409);
    });

    it('compensación de la saga: devuelve cupos, informa el reembolso, es idempotente y avisa a Booking', async () => {
      const { fecha, slot } = await turno(14, 2);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(reserva(fecha, slot, { adult_count: 2 }));
      const c = await v2().post(`/atracciones/reservas/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID())
        .send({ reason: 'SAGA_COMPENSATION_PARTNER_FAILURE', solicitante: 'SAGA_ORCHESTRATOR' });
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ status: 'CANCELLED', reembolso_id: expect.stringMatching(/^REM-/), monto_reembolsado: r.body.total_price });
      const otra = await v2().post(`/atracciones/reservas/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID()).send({});
      expect(otra.status).toBe(200);
      expect(otra.body.status).toBe('CANCELLED');
      const disp = await v2(false).get(`/atracciones/${atr.id}/disponibilidad?date=${fecha}`);
      expect(disp.body.time_slots.find((t: { slot_id: string }) => t.slot_id === slot.slot_id).cupos_disponibles).toBe(slot.cupos_disponibles);
      await esperar(() => grpcMock.recibidos.some((x) => x.msg.date === fecha && x.msg.available_units === slot.cupos_disponibles));
    });
  });

  describe('integración', () => {
    it('acuerdo B2B de promociones', async () => {
      const g = await v2().get('/atracciones/promociones/contrato');
      expect(g.body).toMatchObject({ proveedor_id: 'proveedor-atracciones-dilan', permite_promociones: true, porcentaje_descuento_maximo: 15 });
      const p = await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'], vigencia_hasta: '2027-12-31' });
      expect(p.body).toMatchObject({ porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'] });
      expect((await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: false, porcentaje_descuento_maximo: 20 })).body.porcentaje_descuento_maximo).toBe(0);
      expect((await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: true, porcentaje_descuento_maximo: 80 })).status).toBe(400);
      await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Quito', 'Baños de Agua Santa', 'Cuenca', 'Puerto Ayora'] });
    });

    it('feed de eventos en formato CloudEvents con correlation id', async () => {
      const [{ max }] = await db(app).query('SELECT MAX(evt_id)::int AS max FROM evento');
      const r = await v2().get(`/atracciones/eventos?limit=200&after=${Math.max(max - 150, 0)}`);
      expect(r.status).toBe(200);
      expect(r.body[0]).toMatchObject({ specversion: '1.0', source: '/api/v2/atracciones', event_id: expect.any(String) });
      expect(r.body[0].data).toEqual(r.body[0].payload);
      expect(r.body.some((e: { correlation_id: string }) => e.correlation_id === 'cid-e2e-12345')).toBe(true);
      const stock = (await v2().get('/atracciones/eventos?type=STOCK_ACTUALIZADO&limit=5')).body;
      expect(stock.every((e: { event_type: string }) => e.event_type === 'STOCK_ACTUALIZADO')).toBe(true);
    });

    it('salud del nodo (pública)', async () => {
      const r = await v2(false).get('/atracciones/health');
      expect(r.body).toMatchObject({ status: expect.stringMatching(/^(UP|DEGRADED)$/), node_code: 'DILAN_ATRACCIONES', database_connected: true });
    });

    it('el panel ve la sincronización gRPC y el operador hace check-in desde la web (v1)', async () => {
      const admin = await login(app, USERS.admin);
      const o = await request(app.getHttpServer()).get('/api/v1/ops/resumen?rango=1h').set(bearer(admin)).set('X-Forwarded-For', freshIp());
      expect(o.body.stock_sync).toMatchObject({ enabled: true, tls: false, service_id: 'NODE_ATR_DILAN' });
      expect(o.body.stock_sync.enviados).toBeGreaterThan(0);
      const { fecha, slot } = await turno(15);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(reserva(fecha, slot));
      const c = await request(app.getHttpServer()).post(`/api/v1/atracciones/reservations/${r.body.reservation_id}/checkin`)
        .set(bearer(admin)).set('X-Forwarded-For', freshIp()).send({ documento_identidad: '1710034065' });
      expect(c.status).toBe(200);
      const cli = await login(app, USERS.cliente);
      expect((await request(app.getHttpServer()).post(`/api/v1/atracciones/reservations/${r.body.reservation_id}/checkin`)
        .set(bearer(cli)).set('X-Forwarded-For', freshIp()).send({ documento_identidad: '1710034065' })).status).toBe(403);
    });
  });

  /**
   * Contrato v3 (contracts/atracciones-openapi-v3.yaml) y guía de integración de socios de Booking
   * (docs/GUIA_INTEGRACION_SOCIOS.md): mismas rutas en /api/v3, cuerpo con nombres en inglés,
   * `payment_method` como objeto, SLOT_TIME_MISMATCH y la compra despachada a {baseUrlRest}/reservas.
   */
  describe('contrato v3 y guía de integración de Booking', () => {
    const v3 = () => {
      const s = app.getHttpServer();
      const w = (t: request.Test) => t.set('X-Forwarded-For', freshIp()).set('X-API-Key', API_KEY);
      return { get: (u: string) => w(request(s).get(`/api/v3${u}`)), post: (u: string) => w(request(s).post(`/api/v3${u}`)) };
    };
    const base = (u: string) => request(app.getHttpServer()).post(u).set('X-Forwarded-For', freshIp()).set('X-API-Key', API_KEY);
    const cuerpoV3 = (fecha: string, slot: { slot_id: string; time: string; time_24h: string }, extra: Record<string, unknown> = {}) => ({
      attraction_id: atr.id, slot_id: slot.slot_id, date: fecha, time: slot.time, time_24h: slot.time_24h, adult_count: 1,
      customer: cliente(), payment_method: { method: 'CREDIT_CARD' }, correlation_id: 'cid-v3-e2e', ...extra,
    });

    it('las rutas del contrato v3 responden en /api/v3 y la salud también en la URL base', async () => {
      expect((await v3().get('/atracciones/health')).status).toBe(200);
      expect((await v3().get('/atracciones/categorias/arbol')).status).toBe(200);
      const h = await request(app.getHttpServer()).get('/api/v3/health');
      expect(h.status).toBe(200);
      expect(h.body).toMatchObject({ node_code: 'DILAN_ATRACCIONES' });
      expect((await request(app.getHttpServer()).get('/api/v2/health')).status).toBe(200);
      const d = await v3().get(`/atracciones/${atr.id}/disponibilidad?date=${fechaEc(16)}`);
      expect(d.status).toBe(200);
      expect(d.body.time_slots[0].slot_id).toMatch(/^slot-\d{8}-\d{4}$/);
    });

    it('201 con el cuerpo canónico v3 (inglés, payment_method objeto), Location v3 y la respuesta de la guía', async () => {
      const { fecha, slot } = await turno(16);
      const r = await v3().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(cuerpoV3(fecha, slot));
      expect(r.status).toBe(201);
      expect(r.headers.location).toBe(`/api/v3/atracciones/reservas/${r.body.reservation_id}`);
      expect(r.body).toMatchObject({ success: true, message: expect.any(String), status: 'CONFIRMED', external_order_id: expect.stringMatching(/^ORD-/) });
      expect((await v3().get(`/atracciones/reservas/${r.body.reservation_code}`)).body.reservation_id).toBe(r.body.reservation_id);
      // El stock viaja por gRPC con el slot_id canónico (inventory.proto de la semana 9)
      await esperar(() => grpcMock.recibidos.some((x) => x.msg.slot_id === slot.slot_id && x.msg.date === fecha));
      const push = grpcMock.recibidos.find((x) => x.msg.slot_id === slot.slot_id)!.msg;
      expect(Number(push.timestamp)).toBeGreaterThan(0);
    });

    it('400 SLOT_TIME_MISMATCH si date o time no coinciden con el slot_id; 400 si total_tickets no cuadra', async () => {
      const { fecha, slot } = await turno(17);
      const otraHora = await v3().post('/atracciones/reservas').set('Idempotency-Key', randomUUID())
        .send(cuerpoV3(fecha, slot, { time: '11:59 p.m.', time_24h: undefined }));
      expect(otraHora.status).toBe(400);
      expect(otraHora.body.code).toBe('SLOT_TIME_MISMATCH');
      const otraFecha = await v3().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(cuerpoV3(fechaEc(30), slot));
      expect(otraFecha.status).toBe(400);
      expect(otraFecha.body.code).toBe('SLOT_TIME_MISMATCH');
      const total = await v3().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send(cuerpoV3(fecha, slot, { total_tickets: 3 }));
      expect(total.status).toBe(400);
      expect(total.body.code).toBe('TOTAL_TICKETS_MISMATCH');
    });

    it('la compra despachada a {baseUrlRest}/reservas con el payload de la guía (customer.name, sin document_type ni payment_method)', async () => {
      const { fecha, slot } = await turno(18, 3);
      const guia = {
        attraction_id: atr.id, date: fecha, time: slot.time, slot_id: slot.slot_id,
        adult_count: 2, child_count: 1, senior_count: 0, infant_count: 0, total_tickets: 3,
        customer: { name: 'María José Flores', email: 'turista@epn.edu.ec', phone: '+593991234567', document_id: '1710034065' },
        special_requirements: 'Requiere audio-guía en inglés', booking_reservation_id: 'RES-ATR-A1B2C3',
      };
      const key = randomUUID();
      const r = await base('/api/v2/reservas').set('Idempotency-Key', key).set('X-Correlation-Id', 'cid-guia-e2e').send(guia);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        success: true, reservation_id: expect.any(String), status: 'CONFIRMED', ticket_count: 3,
        customer: { full_name: 'María José Flores', document_type: 'CEDULA' },
      });
      // Reintento de Booking con la misma clave: la misma reserva
      const otra = await base('/api/v2/reservas').set('Idempotency-Key', key).send(guia);
      expect(otra.body.reservation_id).toBe(r.body.reservation_id);
      // Check-in de la guía (§7.1): documento + guia_asignado
      const c = await base(`/api/v3/reservas/${r.body.reservation_id}/checkin`).set('Idempotency-Key', randomUUID())
        .send({ documento_identidad: '1710034065', guia_asignado: 'Carlos Villacís (Licencia MINTUR-441)' });
      expect(c.status).toBe(200);
      expect(c.body.estado).toBe('CHECKED_IN');
      // Sin cupos: 409 OUT_OF_STOCK, el único detonador de la compensación en Booking
      const lleno = await base('/api/v2/reservas').set('Idempotency-Key', randomUUID()).send({ ...guia, adult_count: 49, child_count: 0, total_tickets: 49 });
      expect(lleno.status).toBe(409);
      expect(lleno.body.code).toBe('OUT_OF_STOCK');
    });

    it('sin credenciales sigue siendo 401 (el contrato v3 exige X-API-Key o JWT)', async () => {
      const r = await request(app.getHttpServer()).post('/api/v3/reservas').set('X-Forwarded-For', freshIp()).set('Idempotency-Key', randomUUID()).send({});
      expect(r.status).toBe(401);
    });
  });
});
