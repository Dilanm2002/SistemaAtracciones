import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { join } from 'path';
import request = require('supertest');
import { bearer, createTestApp, db, describeDb, fechaEc, freshIp, login, USERS } from './helpers';

/**
 * Contrato v2 con Booking Prototipo (contracts/atracciones-openapi-v2.yaml) de punta a punta:
 * catálogo, turnos, reserva (201 / 409 OUT_OF_STOCK / 422), idempotencia, check-in, cancelación
 * como compensación de saga, promociones B2B, feed de eventos, salud del nodo y la sincronización
 * de stock por gRPC contra un servidor de Booking simulado (CE01).
 */
interface Push {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: string;
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

describeDb('Contrato v2 con Booking Prototipo (E2E)', () => {
  let app: NestExpressApplication;
  let grpcMock: Awaited<ReturnType<typeof bookingGrpcSimulado>>;
  let atr: { id: string; slug: string; name: string };

  const v2 = () => {
    const s = app.getHttpServer();
    const w = (t: request.Test) => t.set('X-Forwarded-For', freshIp());
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
  /** Primer turno libre de la atracción en `dias` días. */
  const turno = async (dias: number) => {
    const fecha = fechaEc(dias);
    const r = await v2().get(`/atracciones/${atr.id}/availability?date=${fecha}`);
    const slot = r.body.time_slots.find((t: { estado: string }) => t.estado !== 'AGOTADO');
    return { fecha, slot };
  };

  beforeAll(async () => {
    grpcMock = await bookingGrpcSimulado();
    process.env.BOOKING_GRPC_ENABLED = 'true';
    process.env.BOOKING_GRPC_URL = `localhost:${grpcMock.puerto}`;
    process.env.BOOKING_GRPC_TLS = 'false';
    app = await createTestApp();
    const l = await v2().get('/atracciones?limit=50');
    // Una atracción con cupos amplios y cancelación gratuita (para la prueba de cancelación del cliente)
    const conCupos = l.body.data.find((a: { free_cancellation: boolean; name: string }) => a.free_cancellation);
    atr = { id: conCupos.id, slug: conCupos.slug, name: conCupos.name };
  });
  afterAll(async () => {
    await app?.close();
    await grpcMock?.cerrar();
    delete process.env.BOOKING_GRPC_ENABLED;
    delete process.env.BOOKING_GRPC_URL;
    delete process.env.BOOKING_GRPC_TLS;
  });

  describe('catálogo', () => {
    it('árbol de categorías con banderas de inclusión y subcategorías', async () => {
      const r = await v2().get('/atracciones/categorias/arbol');
      expect(r.status).toBe(200);
      const naturaleza = r.body.find((c: { slug: string }) => c.slug === 'naturales');
      expect(naturaleza).toMatchObject({ id: expect.stringMatching(/^cat-\d+$/), incluye_transporte: true, incluye_guia: true });
      expect(naturaleza.subcategorias.map((c: { slug: string }) => c.slug)).toContain('vida-silvestre');
      const plana = await v2().get(`/atracciones/categorias?padre_id=${naturaleza.id}`);
      expect(plana.body).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'vida-silvestre', padre_id: naturaleza.id })]));
    });

    it('listado paginado y búsqueda avanzada con el formato del contrato', async () => {
      const l = await v2().get('/atracciones?city=quito&limit=3&sort=PRICE_ASC');
      expect(l.status).toBe(200);
      expect(l.body.metadata).toMatchObject({ page: 1, limit: 3 });
      const card = l.body.data[0];
      expect(card).toMatchObject({ city: 'Quito', price: { currency: 'USD', infant: 0 }, inclusions: expect.any(Object) });
      expect(card.price.senior).toBeLessThanOrEqual(card.price.adult);
      expect(card.rating.score).toBeLessThanOrEqual(10);
      expect(l.body.data.map((a: { price: { adult: number } }) => a.price.adult)).toEqual(
        [...l.body.data.map((a: { price: { adult: number } }) => a.price.adult)].sort((a, b) => a - b),
      );

      const s = await v2().post('/atracciones/search').send({ query: 'quito', precio_max: 1000, fecha_inicio: fechaEc(5), fecha_fin: fechaEc(8), adult_count: 2 });
      expect(s.status).toBe(200);
      expect(s.body.data.length).toBeGreaterThan(0);
      expect((await v2().post('/atracciones/search').send({ precio_min: 50, precio_max: 10 })).status).toBe(400);
    });

    it('ficha por UUID o slug: itinerario, pilares, accesibilidad, punto de encuentro y proveedor', async () => {
      const r = await v2().get(`/atracciones/${atr.slug}`);
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(atr.id);
      expect(r.body.itinerary[0]).toMatchObject({ stop_number: 1, time: expect.stringMatching(/^\d{2}:\d{2} [ap]\.m\.$/), duration_minutes: 15 });
      expect(Object.keys(r.body.rating.breakdown).sort()).toEqual(['calidad_precio', 'limpieza', 'puntualidad', 'servicio']);
      expect(r.body.meeting_point_geo).toMatchObject({ latitude: expect.any(Number), longitude: expect.any(Number) });
      expect(r.body.accessibility).toHaveProperty('wheelchair_accessible');
      expect(r.body.porcentaje_descuento_paquete).toBeLessThanOrEqual(15);
      expect((await v2().get('/atracciones/no-existe-esta')).status).toBe(404);
    });

    it('turnos del día con estado y alias en español; fecha pasada → 400', async () => {
      const fecha = fechaEc(6);
      const r = await v2().get(`/atracciones/${atr.id}/availability?date=${fecha}`);
      expect(r.status).toBe(200);
      expect(r.body.time_slots[0]).toMatchObject({
        slot_id: expect.stringMatching(/^slot-\d{8}-\d{4}$/),
        time: expect.stringMatching(/[ap]\.m\.$/),
        estado: expect.stringMatching(/^(DISPONIBLE|ULTIMOS_CUPOS|AGOTADO)$/),
      });
      expect((await v2().get(`/atracciones/${atr.id}/disponibilidad?date=${fecha}`)).body).toEqual(r.body);
      expect((await v2().get(`/atracciones/${atr.id}/availability?date=2020-01-01`)).status).toBe(400);
    });
  });

  describe('reservas y saga', () => {
    it('201 con external_order_id, voucher y Location; repetir la Idempotency-Key no duplica; el stock llega a Booking por gRPC', async () => {
      const { fecha, slot } = await turno(10);
      const key = randomUUID();
      const cuerpo = {
        atraccion_id: atr.id, fecha, hora: slot.time, adult_count: 2, child_count: 1, senior_count: 1, infant_count: 1,
        customer: cliente(), payment_method: 'SOA_BOOKING_GATEWAY', saga_id: 'SAGA-E2E-1',
        passengers: [{ full_name: 'Mateo Rosero', ticket_type: 'CHILD' }],
      };
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', key).set('X-Correlation-Id', 'cid-e2e-12345').send(cuerpo);
      expect(r.status).toBe(201);
      expect(r.headers.location).toBe(`/api/v2/atracciones/reservas/${r.body.reservation_id}`);
      expect(r.headers['x-correlation-id']).toBe('cid-e2e-12345');
      expect(r.body).toMatchObject({
        external_order_id: expect.stringMatching(/^ORD-/),
        reservation_code: expect.stringMatching(/^DEC-/),
        status: 'CONFIRMED',
        time: slot.time,
        ticket_count: 5,
        adult_count: 2,
        child_count: 1,
        senior_count: 1,
        infant_count: 1,
        currency: 'USD',
        customer: { full_name: 'Paúl Rosero', document_type: 'CEDULA', phone: '+593991234567' },
        voucher_qr_payload: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      });
      // total = 2 adultos + 1 niño + 1 senior (el infante no paga)
      const precio = (await v2().get(`/atracciones/${atr.id}`)).body.price;
      expect(r.body.total_price).toBeCloseTo(2 * precio.adult + precio.child + precio.senior, 2);

      // Misma clave → misma reserva, sin descontar más cupos
      const otra = await v2().post('/atracciones/reservas').set('Idempotency-Key', key).send(cuerpo);
      expect(otra.body.reservation_id).toBe(r.body.reservation_id);
      const despues = await v2().get(`/atracciones/${atr.id}/availability?date=${fecha}`);
      expect(despues.body.time_slots.find((t: { time: string }) => t.time === slot.time).cupos_disponibles).toBe(slot.cupos_disponibles - 5);

      // Factura con una línea por tipo de boleto (adulto, niño, senior, infante)
      const lineas = await db(app).query(
        `SELECT fd.fde_codigo AS codigo FROM factura_detalle fd JOIN factura f ON f.fac_id = fd.fac_id
           JOIN orden o ON o.ord_id = f.ord_id WHERE o.ord_numero = $1 ORDER BY fd.fde_linea`,
        [r.body.external_order_id],
      );
      expect(lineas.map((l: { codigo: string }) => l.codigo.slice(-3))).toEqual(['-AD', '-NI', '-SE', '-IN']);

      // gRPC: Booking recibió los cupos restantes de ese turno, con el correlation id
      await esperar(() => grpcMock.recibidos.some((x) => x.msg.date === fecha && x.msg.time_slot === slot.time));
      const push = grpcMock.recibidos.filter((x) => x.msg.date === fecha && x.msg.time_slot === slot.time).at(-1)!;
      expect(push.msg).toMatchObject({ service_id: 'atracciones-dilan', item_id: atr.id, available_units: slot.cupos_disponibles - 5 });
      expect(push.correlacion).toBe('cid-e2e-12345');
      await esperar(async () => {
        const [f] = await db(app).query(`SELECT ss_estado AS e FROM ops.sync_stock WHERE ss_fecha = $1 ORDER BY ss_id DESC LIMIT 1`, [fecha]);
        return f?.e === 'ENVIADO';
      });

      // Consulta por UUID, por código PNR y por el alias en inglés
      expect((await v2().get(`/atracciones/reservas/${r.body.reservation_code}`)).body.reservation_id).toBe(r.body.reservation_id);
      expect((await v2().get(`/atracciones/reservations/${r.body.reservation_id}`)).status).toBe(200);
    });

    it('409 OUT_OF_STOCK (activa la compensación) con correlation_id y timestamp', async () => {
      const { fecha, slot } = await turno(11);
      const r = await v2()
        .post(`/atracciones/${atr.id}/reservations`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Correlation-Id', 'cid-sin-cupos-1')
        .send({ fecha, hora: slot.time, adult_count: Math.min(slot.cupos_disponibles + 1, 50), customer: cliente(), payment_method: 'SOA_BOOKING_GATEWAY' });
      if (slot.cupos_disponibles + 1 > 50) return; // turno demasiado grande para la prueba
      expect(r.status).toBe(409);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(r.body).toMatchObject({ status: 409, code: 'OUT_OF_STOCK', correlation_id: 'cid-sin-cupos-1', timestamp: expect.any(String) });
    });

    it('400 sin Idempotency-Key o con datos inválidos (invalid_params) y 422 con una cédula inválida', async () => {
      const { fecha, slot } = await turno(12);
      const base = { atraccion_id: atr.id, fecha, hora: slot.time, adult_count: 1, customer: cliente(), payment_method: 'TARJETA_CREDITO' };
      expect((await v2().post('/atracciones/reservas').send(base)).status).toBe(400);
      const inv = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send({ ...base, customer: cliente({ phone: '123' }) });
      expect(inv.status).toBe(400);
      expect(inv.body.invalid_params[0]).toMatchObject({ name: 'customer.phone' });
      const ced = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID()).send({ ...base, customer: cliente({ document_id: '1710034066' }) });
      expect(ced.status).toBe(422);
      expect(ced.body.code).toBe('INVALID_DOCUMENT');
      const pasaporte = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID())
        .send({ ...base, customer: cliente({ document_type: 'PASAPORTE', document_id: 'ab123456', phone: '+12025550123' }) });
      expect(pasaporte.status).toBe(201);
      expect(pasaporte.body.customer).toMatchObject({ document_type: 'PASAPORTE', document_id: 'AB123456', phone: '+12025550123' });
    });

    it('check-in presencial: documento equivocado 400, correcto CHECKED_IN, repetido 409; QR y pase en PNG', async () => {
      const { fecha, slot } = await turno(13);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID())
        .send({ atraccion_id: atr.id, fecha, hora: slot.time, adult_count: 1, customer: cliente(), payment_method: 'PAGO_EN_SITIO' });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('CONFIRMED'); // en v2 toda reserva nace confirmada
      const qr = await v2().get(`/atracciones/vouchers/${r.body.reservation_code}/qr.png`);
      expect(qr.status).toBe(200);
      expect(qr.headers['content-type']).toBe('image/png');
      expect((await v2().get(`/atracciones/vouchers/${r.body.reservation_code}/qr.png?tipo=pase`)).status).toBe(404);

      const url = `/atracciones/reservas/${r.body.reservation_id}/checkin`;
      expect((await v2().post(url).send({ documento_identidad: '0102030405' })).status).toBe(400);
      expect((await v2().post(url).send({ documento_identidad: '1710034065', codigo_voucher_qr: 'alterado.x.y' })).status).toBe(400);
      const ok = await v2().post(url).send({
        documento_identidad: '1710034065', codigo_voucher_qr: r.body.voucher_qr_payload, guia_codigo: 'GUIA-E2E-01', scanner_device_id: 'SCANNER-01',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ reserva_id: r.body.reservation_id, estado: 'CHECKED_IN', titular_documento: '1710034065', hora_checkin: expect.any(String) });
      expect((await v2().post(`/atracciones/reservations/${r.body.reservation_id}/checkin`).send({ documento_identidad: '1710034065' })).status).toBe(409);
      expect((await v2().get(`/atracciones/reservas/${r.body.reservation_id}`)).body.status).toBe('CHECKED_IN');
      expect((await v2().get(`/atracciones/vouchers/${r.body.reservation_code}/qr.png?tipo=pase`)).status).toBe(200);
      // Después del check-in ya no se cancela
      expect((await v2().post(`/atracciones/reservas/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID()).send({ solicitante: 'SAGA_ORCHESTRATOR' })).status).toBe(400);
    });

    it('cancelación del cliente en plazo y compensación de la saga: devuelve cupos, es idempotente y avisa a Booking', async () => {
      const { fecha, slot } = await turno(14);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID())
        .send({ atraccion_id: atr.id, fecha, hora: slot.time, adult_count: 2, customer: cliente(), payment_method: 'SOA_BOOKING_GATEWAY' });
      const c = await v2().post(`/atracciones/reservas/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID())
        .send({ reason: 'SAGA_COMPENSATION_PARTNER_FAILURE', solicitante: 'SAGA_ORCHESTRATOR' });
      expect(c.status).toBe(200);
      expect(c.body.status).toBe('CANCELLED');
      // Otra compensación de la misma reserva (otra clave): 200 y sigue cancelada
      const otra = await v2().post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set('Idempotency-Key', randomUUID()).send({});
      expect(otra.status).toBe(200);
      expect(otra.body.status).toBe('CANCELLED');
      const disp = await v2().get(`/atracciones/${atr.id}/availability?date=${fecha}`);
      expect(disp.body.time_slots.find((t: { time: string }) => t.time === slot.time).cupos_disponibles).toBe(slot.cupos_disponibles);
      await esperar(() => grpcMock.recibidos.some((x) => x.msg.date === fecha && x.msg.available_units === slot.cupos_disponibles));
      const [pago] = await db(app).query(
        `SELECT eo.est_codigo AS orden FROM orden o JOIN estado eo ON eo.est_id = o.est_id WHERE o.ord_numero = $1`,
        [r.body.external_order_id],
      );
      expect(pago.orden).toBe('REEMBOLSADA');
    });
  });

  describe('integración', () => {
    it('acuerdo B2B de promociones: consulta y actualización (sin promociones el descuento queda en 0)', async () => {
      const g = await v2().get('/atracciones/promociones/contrato');
      expect(g.body).toMatchObject({ proveedor_id: 'proveedor-atracciones-dilan', permite_promociones: true, porcentaje_descuento_maximo: 15 });
      const p = await v2().put('/atracciones/promociones/contrato').send({
        permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'], vigencia_hasta: '2027-12-31',
        condiciones_combo: 'Mínimo 48 horas de anticipación.', contacto_comercial: { nombre: 'Dilan Mena', email: 'reservas@descubre-ec.com' },
      });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito', 'Cuenca'], vigencia_hasta: '2027-12-31' });
      expect((await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: false, porcentaje_descuento_maximo: 20 })).body.porcentaje_descuento_maximo).toBe(0);
      expect((await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: true, porcentaje_descuento_maximo: 80 })).status).toBe(400);
      await v2().put('/atracciones/promociones/contrato').send({ permite_promociones: true, porcentaje_descuento_maximo: 15, destinos_habilitados: ['Quito', 'Baños de Agua Santa', 'Cuenca', 'Puerto Ayora'] });
    });

    it('feed de eventos v2 con cursor, tipos del contrato y correlation id', async () => {
      // Los eventos de esta suite (los de la semilla van antes): desde 150 antes del último
      const [{ max }] = await db(app).query('SELECT MAX(evt_id)::int AS max FROM evento');
      const r = await v2().get(`/atracciones/eventos?limit=200&after=${Math.max(max - 150, 0)}`);
      expect(r.status).toBe(200);
      expect(new Set(r.body.map((e: { event_type: string }) => e.event_type))).toEqual(
        new Set(['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA']),
      );
      const conCid = r.body.find((e: { correlation_id: string }) => e.correlation_id === 'cid-e2e-12345');
      expect(conCid).toBeDefined();
      const stock = (await v2().get('/atracciones/eventos?type=STOCK_ACTUALIZADO&limit=5')).body;
      expect(stock.every((e: { event_type: string; payload: { available_units: number } }) => e.event_type === 'STOCK_ACTUALIZADO' && e.payload.available_units >= 0)).toBe(true);
      const ultimo = r.body.at(-1).sequence_number;
      expect((await v2().get(`/atracciones/eventos?after=${ultimo}`)).body.every((e: { sequence_number: number }) => e.sequence_number > ultimo)).toBe(true);
    });

    it('salud del nodo para el semáforo de Booking', async () => {
      const r = await v2().get('/atracciones/health');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: expect.stringMatching(/^(UP|DEGRADED)$/), node_id: 'node-dilan-atracciones-01', node_code: 'DILAN_ATRACCIONES',
        database_connected: true, latency_ms: expect.any(Number), uptime_seconds: expect.any(Number),
      });
    });

    it('el panel ve la sincronización gRPC y el operador hace check-in desde la web (v1)', async () => {
      const admin = await login(app, USERS.admin);
      const o = await request(app.getHttpServer()).get('/api/v1/ops/resumen?rango=1h').set(bearer(admin)).set('X-Forwarded-For', freshIp());
      expect(o.body.stock_sync).toMatchObject({ enabled: true, tls: false, service_id: 'atracciones-dilan' });
      expect(o.body.stock_sync.enviados).toBeGreaterThan(0);

      const { fecha, slot } = await turno(15);
      const r = await v2().post('/atracciones/reservas').set('Idempotency-Key', randomUUID())
        .send({ atraccion_id: atr.id, fecha, hora: slot.time, adult_count: 1, customer: cliente(), payment_method: 'SOA_BOOKING_GATEWAY' });
      const c = await request(app.getHttpServer()).post(`/api/v1/atracciones/reservations/${r.body.reservation_id}/checkin`)
        .set(bearer(admin)).set('X-Forwarded-For', freshIp()).send({ documento_identidad: '1710034065' });
      expect(c.status).toBe(200);
      const cli = await login(app, USERS.cliente);
      expect((await request(app.getHttpServer()).post(`/api/v1/atracciones/reservations/${r.body.reservation_id}/checkin`)
        .set(bearer(cli)).set('X-Forwarded-For', freshIp()).send({ documento_identidad: '1710034065' })).status).toBe(403);
    });
  });
});
