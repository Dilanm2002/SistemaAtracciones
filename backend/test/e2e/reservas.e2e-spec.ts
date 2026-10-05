import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { bearer, createTestApp, db, describeDb, fechaEc, http, idem, login, nuevaAtraccion, reserva, USERS } from './helpers';

/**
 * Flujo crítico de negocio: reservar → pagar → cancelar/confirmar, con control de
 * inventario (cupos), concurrencia, idempotencia y efectos en el modelo relacional
 * (orden, pago, factura, reembolso, eventos de dominio).
 */
describeDb('Reservas (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let operador: string;
  let cliente: string;
  let ana: string;
  let cityId: number;

  /** Crea una atracción nueva (cupo propio) para aislar cada caso. */
  const crearAtraccion = async (extra: Record<string, unknown> = {}) => {
    const res = await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(cityId, extra));
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const reservar = (atr: string, token: string, body: Record<string, unknown>, headers = idem()) =>
    http(app).post(`/atracciones/${atr}/reservations`).set(bearer(token)).set(headers).send(body);
  const cupo = async (atr: string, fecha: string) =>
    (await http(app).get(`/atracciones/${atr}/availability?date=${fecha}`)).body.slots.find((s: { time: string }) => s.time === '10:00').available;

  beforeAll(async () => {
    app = await createTestApp();
    [admin, operador, cliente, ana] = await Promise.all([login(app, USERS.admin), login(app, USERS.operador), login(app, USERS.cliente), login(app, USERS.ana)]);
    const destinos = await http(app).get('/destinos');
    cityId = destinos.body[0].id;
  });
  afterAll(() => app?.close());

  describe('creación', () => {
    it('reserva con tarjeta: 201, CONFIRMED, total = adultos × precio + niños × precio niño, descuenta cupos', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(20);
      expect(await cupo(atr, fecha)).toBe(5);

      const res = await reservar(atr, cliente, reserva(fecha, {
        ticket_count: 3,
        children: 1,
        payment_method: 'TARJETA',
        card: { brand: 'VISA', last4: '4242', holder: 'Maria Guaman', exp_month: 12, exp_year: new Date().getFullYear() + 2 },
      }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        ticket_count: 3,
        adults: 2,
        children: 1,
        total_price: { currency: 'USD', total: 105 }, // 2 × 40 + 1 × 25
        date: fecha,
        time: '10:00',
        payment_method: 'TARJETA',
        can_cancel: true,
      });
      expect(res.body.code).toMatch(/^DEC-[A-Z2-9]{6}$/);
      expect(res.body._links.cancel.method).toBe('POST');
      expect(res.body._links.confirm).toBeUndefined();
      expect(await cupo(atr, fecha)).toBe(2);

      // Modelo relacional: orden PAGADA, pago APROBADO, factura, tarjeta sin datos sensibles y eventos
      const [fila] = await db(app).query(
        `SELECT eo.est_codigo AS orden, ep.est_codigo AS pago, (SELECT COUNT(*)::int FROM factura f WHERE f.ord_id = o.ord_id) AS facturas,
                (SELECT pat_ultimos4 FROM pago_tarjeta pt WHERE pt.pag_id = pg.pag_id) AS ultimos4,
                (SELECT array_agg(evt_tipo ORDER BY evt_id) FROM evento WHERE evt_agregado_id = r.res_uuid::text) AS eventos
           FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN orden o ON o.ord_id = dt.ord_id
           JOIN estado eo ON eo.est_id = o.est_id JOIN pago pg ON pg.ord_id = o.ord_id JOIN estado ep ON ep.est_id = pg.est_id
          WHERE r.res_uuid = $1`,
        [res.body.reservation_id],
      );
      expect(fila).toMatchObject({ orden: 'PAGADA', pago: 'APROBADO', facturas: 1, ultimos4: '4242' });
      expect(fila.eventos).toEqual(expect.arrayContaining(['atracciones.reserva.creada', 'atracciones.pago.aprobado']));
    });

    it('transferencia: PENDING, sin factura hasta que se confirma', async () => {
      const atr = await crearAtraccion();
      const res = await reservar(atr, cliente, reserva(fechaEc(21), { payment_method: 'TRANSFERENCIA' }));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body._links.confirm).toBeDefined();
      const [{ n }] = await db(app).query(
        `SELECT COUNT(*)::int AS n FROM factura f JOIN orden_detalle dt ON dt.ord_id = f.ord_id JOIN reserva r ON r.det_id = dt.det_id WHERE r.res_uuid = $1`,
        [res.body.reservation_id],
      );
      expect(n).toBe(0);
    });

    it('guarda el correo de contacto; el teléfono de un cliente es SIEMPRE el de su cuenta', async () => {
      const atr = await crearAtraccion();
      const con = await reservar(atr, cliente, reserva(fechaEc(22), { customer_email: '  Familiar@Correo.EC ', customer_phone: '0987654321' }));
      expect(con.status).toBe(201);
      // El teléfono enviado se ignora: el cliente ya tiene uno en su cuenta (seed)
      expect(con.body.customer).toMatchObject({ email: 'familiar@correo.ec', phone: '0991234567' });
      const [pax] = await db(app).query(
        'SELECT x.pax_correo, x.pax_telefono FROM reserva_pasajero x JOIN reserva r ON r.res_id = x.res_id WHERE r.res_uuid = $1',
        [con.body.reservation_id],
      );
      expect(pax).toEqual({ pax_correo: 'familiar@correo.ec', pax_telefono: '0991234567' });
      // Se puede buscar por ese correo
      const q = await http(app).get('/atracciones/reservations?q=familiar%40correo').set(bearer(cliente));
      expect(q.body.map((r: { reservation_id: string }) => r.reservation_id)).toContain(con.body.reservation_id);

      const sin = await reservar(atr, cliente, reserva(fechaEc(22)));
      expect(sin.body.customer.email).toBe(USERS.cliente.email);
      expect(sin.body.customer.phone).toBe('0991234567'); // teléfono de la cuenta (seed)

      expect((await reservar(atr, cliente, reserva(fechaEc(22), { customer_email: 'no-es-correo' }))).status).toBe(400);
      expect((await reservar(atr, cliente, reserva(fechaEc(22), { customer_phone: '+15551234567' }))).status).toBe(400);
    });

    it('sin horario (time) y con un solo horario activo, lo toma automáticamente', async () => {
      const atr = await crearAtraccion();
      const res = await reservar(atr, cliente, { date: fechaEc(22), ticket_count: 1, customer_name: 'María Guamán' });
      expect(res.status).toBe(201);
      expect(res.body.time).toBe('10:00');
    });

    it.each([
      ['más niños que tickets', { ticket_count: 2, children: 3 }, 400],
      ['solo niños (sin adulto)', { ticket_count: 2, children: 2 }, 400],
      ['horario inexistente', { time: '23:59' }, 400],
      ['más de 30 tickets', { ticket_count: 31 }, 400],
      ['0 tickets', { ticket_count: 0 }, 400],
      ['nombre con números', { customer_name: 'Maria 12345' }, 400],
      ['cédula inválida', { customer_document: '1710034060' }, 400],
      ['tarjeta con transferencia', { payment_method: 'TRANSFERENCIA', card: { brand: 'VISA', last4: '4242', holder: 'Maria Guaman', exp_month: 1, exp_year: 2099 } }, 400],
      ['tarjeta vencida', { card: { brand: 'VISA', last4: '4242', holder: 'Maria Guaman', exp_month: 1, exp_year: 2021 } }, 400],
      ['campo no permitido', { precio: 0.01 }, 400],
    ])('rechaza %s', async (_caso, extra, status) => {
      const atr = await crearAtraccion();
      const res = await reservar(atr, cliente, reserva(fechaEc(23), extra));
      expect(res.status).toBe(status);
      expect(res.headers['content-type']).toMatch(/problem\+json|json/);
      expect(res.body).toHaveProperty('title');
      expect(await cupo(atr, fechaEc(23))).toBe(5); // no se tocó el inventario
    });

    it('rechaza fechas pasadas y a más de un año', async () => {
      const atr = await crearAtraccion();
      expect((await reservar(atr, cliente, reserva(fechaEc(-1)))).status).toBe(400);
      expect((await reservar(atr, cliente, reserva(fechaEc(400)))).status).toBe(400);
    });

    it('409 cuando no hay cupo suficiente y 409 "agotado" cuando se llena', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(24);
      const r1 = await reservar(atr, cliente, reserva(fecha, { ticket_count: 6 }));
      expect(r1.status).toBe(409);
      expect(r1.body.detail).toMatch(/Solo quedan 5/);
      expect((await reservar(atr, cliente, reserva(fecha, { ticket_count: 5 }))).status).toBe(201);
      const r3 = await reservar(atr, cliente, reserva(fecha));
      expect(r3.status).toBe(409);
      expect(r3.body.detail).toMatch(/agotado/);
    });

    it('404 para atracción inexistente, 400 para UUID mal formado', async () => {
      expect((await reservar(randomUUID(), cliente, reserva(fechaEc(10)))).status).toBe(404);
      expect((await reservar('no-es-uuid', cliente, reserva(fechaEc(10)))).status).toBe(400);
    });

    it('no se puede reservar una atracción desactivada', async () => {
      const atr = await crearAtraccion();
      expect((await http(app).patch(`/atracciones/${atr}`).set(bearer(admin)).send({ is_active: false })).status).toBe(200);
      expect((await reservar(atr, cliente, reserva(fechaEc(10)))).status).toBe(404);
    });

    it('fecha bloqueada: 409 al reservar y la disponibilidad lo informa', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(26);
      const b = await http(app).post(`/atracciones/${atr}/blocked-dates`).set(bearer(admin)).send({ date: fecha, reason: 'Mantenimiento del sendero' });
      expect(b.status).toBe(201);
      expect((await reservar(atr, cliente, reserva(fecha))).status).toBe(409);
      const disp = await http(app).get(`/atracciones/${atr}/availability?date=${fecha}`);
      expect(disp.body).toMatchObject({ available_spots: 0, unavailable_reason: expect.stringMatching(/Mantenimiento/) });
    });
  });

  describe('concurrencia (sin sobreventa)', () => {
    it('10 reservas simultáneas de 1 ticket sobre un cupo de 5 → exactamente 5 aceptadas', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(30);
      const res = await Promise.all(Array.from({ length: 10 }, () => reservar(atr, cliente, reserva(fecha))));
      const estados = res.map((r) => r.status).sort();
      expect(estados.filter((s) => s === 201)).toHaveLength(5);
      expect(estados.filter((s) => s === 409)).toHaveLength(5);
      expect(await cupo(atr, fecha)).toBe(0);
      const [{ reservado }] = await db(app).query(
        `SELECT d.dis_cupo_reservado AS reservado FROM disponibilidad d JOIN atraccion a ON a.atr_id = d.atr_id WHERE a.atr_uuid = $1 AND d.dis_fecha = $2`,
        [atr, fecha],
      );
      expect(reservado).toBe(5);
    });
  });

  describe('idempotencia', () => {
    it('misma clave y mismo cuerpo: devuelve la misma reserva sin crear otra', async () => {
      const atr = await crearAtraccion();
      const key = idem();
      const body = reserva(fechaEc(31));
      const a = await reservar(atr, cliente, body, key);
      const b = await reservar(atr, cliente, body, key);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body.reservation_id).toBe(a.body.reservation_id);
      expect(await cupo(atr, fechaEc(31))).toBe(4);
    });

    it('misma clave con otro cuerpo → 409 IDEMPOTENCY_CONFLICT', async () => {
      const atr = await crearAtraccion();
      const key = idem();
      expect((await reservar(atr, cliente, reserva(fechaEc(32)), key)).status).toBe(201);
      const b = await reservar(atr, cliente, reserva(fechaEc(32), { ticket_count: 2 }), key);
      expect(b.status).toBe(409);
      expect(b.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('la misma clave en usuarios distintos no se mezcla', async () => {
      const atr = await crearAtraccion();
      const key = idem();
      const a = await reservar(atr, cliente, reserva(fechaEc(33)), key);
      const b = await reservar(atr, ana, reserva(fechaEc(33), { customer_name: 'Ana Torres' }), key);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.reservation_id).not.toBe(b.body.reservation_id);
    });

    it('si la operación falla, la clave se libera y el reintento funciona', async () => {
      const atr = await crearAtraccion();
      const key = idem();
      expect((await reservar(atr, cliente, reserva(fechaEc(34), { ticket_count: 9 }), key)).status).toBe(409);
      // mismo cuerpo, cupo liberado por otro motivo: el reintento se ejecuta de nuevo (no queda "pegado" el 409)
      await http(app).patch(`/atracciones/${atr}`).set(bearer(admin)).send({ capacity_per_slot: 10 });
      expect((await reservar(atr, cliente, reserva(fechaEc(34), { ticket_count: 9 }), key)).status).toBe(201);
    });

    it('sin Idempotency-Key o con una clave que no es UUID → 400', async () => {
      const atr = await crearAtraccion();
      expect((await reservar(atr, cliente, reserva(fechaEc(35)), {})).status).toBe(400);
      const r = await reservar(atr, cliente, reserva(fechaEc(35)), { 'Idempotency-Key': 'abc' });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('cancelación', () => {
    it('cliente cancela con tarjeta: CANCELLED, devuelve cupos, reembolso, orden REEMBOLSADA y factura ANULADA', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(40);
      const r = await reservar(atr, cliente, reserva(fecha, { ticket_count: 2 }));
      expect(await cupo(atr, fecha)).toBe(3);

      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(cliente)).set(idem()).send({ reason: 'Cambio de planes de viaje' });
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ status: 'CANCELLED', can_cancel: false, cancellation_reason: 'Cambio de planes de viaje' });
      expect(c.body._links.cancel).toBeUndefined();
      expect(await cupo(atr, fecha)).toBe(5);

      const [fila] = await db(app).query(
        `SELECT eo.est_codigo AS orden, ef.est_codigo AS factura, rem.rem_monto::float8 AS reembolso
           FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN orden o ON o.ord_id = dt.ord_id JOIN estado eo ON eo.est_id = o.est_id
           JOIN factura f ON f.ord_id = o.ord_id JOIN estado ef ON ef.est_id = f.est_id
           JOIN pago pg ON pg.ord_id = o.ord_id LEFT JOIN reembolso rem ON rem.pag_id = pg.pag_id
          WHERE r.res_uuid = $1`,
        [r.body.reservation_id],
      );
      expect(fila).toEqual({ orden: 'REEMBOLSADA', factura: 'ANULADA_FAC', reembolso: 80 });
    });

    it('cancelar dos veces → 409; cancelar pendiente → pago RECHAZADO y orden CANCELADA', async () => {
      const atr = await crearAtraccion();
      const r = await reservar(atr, cliente, reserva(fechaEc(41), { payment_method: 'EN_SITIO' }));
      const url = `/atracciones/reservations/${r.body.reservation_id}/cancel`;
      expect((await http(app).post(url).set(bearer(cliente)).set(idem()).send({ reason: 'Ya no puedo viajar' })).status).toBe(200);
      expect((await http(app).post(url).set(bearer(cliente)).set(idem()).send({ reason: 'Ya no puedo viajar' })).status).toBe(409);
      const [fila] = await db(app).query(
        `SELECT eo.est_codigo AS orden, ep.est_codigo AS pago FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id
           JOIN orden o ON o.ord_id = dt.ord_id JOIN estado eo ON eo.est_id = o.est_id JOIN pago pg ON pg.ord_id = o.ord_id JOIN estado ep ON ep.est_id = pg.est_id
          WHERE r.res_uuid = $1`,
        [r.body.reservation_id],
      );
      expect(fila).toEqual({ orden: 'CANCELADA', pago: 'RECHAZADO' });
    });

    /** Simula que la reserva se hizo hace `horas` horas (el periodo de arrepentimiento ya pasó). */
    const envejecer = (id: string, horas = 2) =>
      db(app).query(`UPDATE reserva SET res_creado_en = now() - make_interval(hours => $2) WHERE res_uuid = $1`, [id, horas]);
    const pagos = async (id: string) =>
      (await db(app).query(
        `SELECT ep.est_codigo AS pago, eo.est_codigo AS orden, (SELECT COUNT(*)::int FROM reembolso rm WHERE rm.pag_id = pg.pag_id) AS reembolsos
           FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN orden o ON o.ord_id = dt.ord_id
           JOIN estado eo ON eo.est_id = o.est_id JOIN pago pg ON pg.ord_id = o.ord_id JOIN estado ep ON ep.est_id = pg.est_id
          WHERE r.res_uuid = $1`,
        [id],
      ))[0];

    it('reserva de último momento (ya dentro del plazo): 1 h de arrepentimiento con reembolso total', async () => {
      const atr = await crearAtraccion({ cancellation_hours: 720 });
      const r = await reservar(atr, cliente, reserva(fechaEc(5)));
      expect(r.body).toMatchObject({ can_cancel: true, refundable: true, cancellation_policy: 'FULL_REFUND' });
      expect(new Date(r.body.free_cancellation_until).getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(cliente)).set(idem()).send({ reason: 'Me equivoqué de fecha' });
      expect(c.status).toBe(200);
      expect(await pagos(r.body.reservation_id)).toMatchObject({ pago: 'APROBADO', orden: 'REEMBOLSADA', reembolsos: 1 });
    });

    it('fuera de plazo: el cliente puede cancelar SIN reembolso (debe confirmarlo) y se libera el cupo', async () => {
      const atr = await crearAtraccion({ cancellation_hours: 720, capacity_per_slot: 1 });
      const r = await reservar(atr, cliente, reserva(fechaEc(5)));
      await envejecer(r.body.reservation_id);
      const url = `/atracciones/reservations/${r.body.reservation_id}/cancel`;
      const ver = await http(app).get(`/atracciones/reservations/${r.body.reservation_id}`).set(bearer(cliente));
      expect(ver.body).toMatchObject({ can_cancel: true, refundable: false, cancellation_policy: 'NO_REFUND' });
      // Sin confirmar que acepta perder el pago → 409 con código propio
      const c1 = await http(app).post(url).set(bearer(cliente)).set(idem()).send({ reason: 'Ya no puedo asistir' });
      expect(c1.status).toBe(409);
      expect(c1.body.code).toBe('NO_REFUND_CONFIRMATION_REQUIRED');
      const c2 = await http(app).post(url).set(bearer(cliente)).set(idem()).send({ reason: 'Ya no puedo asistir', accept_no_refund: true });
      expect(c2.status).toBe(200);
      expect(c2.body).toMatchObject({ status: 'CANCELLED', cancellation_reason: 'Ya no puedo asistir (sin reembolso)' });
      // El cobro se conserva (sin reembolso) y el cupo vuelve a estar disponible para otro viajero
      expect(await pagos(r.body.reservation_id)).toMatchObject({ pago: 'APROBADO', reembolsos: 0 });
      const otra = await reservar(atr, ana, reserva(fechaEc(5)));
      expect(otra.status).toBe(201);
    });

    it('fuera de plazo, la empresa cancela con reembolso total (p. ej. clima)', async () => {
      const atr = await crearAtraccion({ cancellation_hours: 720 });
      const r = await reservar(atr, cliente, reserva(fechaEc(5)));
      await envejecer(r.body.reservation_id);
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(operador)).set(idem()).send({ reason: 'Clima adverso en la zona' });
      expect(c.status).toBe(200);
      expect(c.body.cancellation_reason).toBe('[Operador] Clima adverso en la zona');
      expect(await pagos(r.body.reservation_id)).toMatchObject({ orden: 'REEMBOLSADA', reembolsos: 1 });
    });

    it('sin cancelación gratuita: pasada la hora de arrepentimiento, solo sin reembolso', async () => {
      const atr = await crearAtraccion({ free_cancellation: false });
      const r = await reservar(atr, cliente, reserva(fechaEc(60)));
      await envejecer(r.body.reservation_id);
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(cliente)).set(idem()).send({ reason: 'Cambio de planes de viaje' });
      expect(c.status).toBe(409);
      expect(c.body.detail).toMatch(/no admite cancelación gratuita.*sin reembolso/);
    });

    it('pendiente de pago (transferencia): se cancela sin costo aunque sea fuera del plazo', async () => {
      const atr = await crearAtraccion({ cancellation_hours: 720 });
      const r = await reservar(atr, cliente, reserva(fechaEc(5), { payment_method: 'TRANSFERENCIA' }));
      await envejecer(r.body.reservation_id);
      expect((await http(app).get(`/atracciones/reservations/${r.body.reservation_id}`).set(bearer(cliente))).body).toMatchObject({ cancellation_policy: 'NO_CHARGE', refundable: true });
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(cliente)).set(idem()).send({ reason: 'Ya no puedo asistir' });
      expect(c.status).toBe(200);
      expect(await pagos(r.body.reservation_id)).toMatchObject({ pago: 'RECHAZADO', orden: 'CANCELADA' });
    });

    it('otro cliente no puede cancelar (404, no revela que existe)', async () => {
      const atr = await crearAtraccion();
      const r = await reservar(atr, cliente, reserva(fechaEc(42)));
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(ana)).set(idem()).send({ reason: 'Intento no autorizado' });
      expect(c.status).toBe(404);
    });

    it('motivo inválido ("12345") → 400', async () => {
      const atr = await crearAtraccion();
      const r = await reservar(atr, cliente, reserva(fechaEc(43)));
      const c = await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(cliente)).set(idem()).send({ reason: '1234567' });
      expect(c.status).toBe(400);
    });
  });

  describe('confirmación de pago (operador)', () => {
    it('operador de la empresa confirma una reserva pendiente: CONFIRMED + factura', async () => {
      const atr = await crearAtraccion();
      const r = await reservar(atr, cliente, reserva(fechaEc(44), { payment_method: 'TRANSFERENCIA' }));
      const url = `/atracciones/reservations/${r.body.reservation_id}/confirm`;
      const c = await http(app).post(url).set(bearer(operador)).set(idem()).send();
      expect(c.status).toBe(200);
      expect(c.body.status).toBe('CONFIRMED');
      // Segunda confirmación (otra clave) → 409
      expect((await http(app).post(url).set(bearer(operador)).set(idem()).send()).status).toBe(409);
      const [{ n }] = await db(app).query(
        `SELECT COUNT(*)::int AS n FROM factura f JOIN orden_detalle dt ON dt.ord_id = f.ord_id JOIN reserva r ON r.det_id = dt.det_id WHERE r.res_uuid = $1`,
        [r.body.reservation_id],
      );
      expect(n).toBe(1);
    });

    it('un cliente no puede confirmar (403 por scope)', async () => {
      const atr = await crearAtraccion();
      const r = await reservar(atr, cliente, reserva(fechaEc(45), { payment_method: 'TRANSFERENCIA' }));
      expect((await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/confirm`).set(bearer(cliente)).set(idem()).send()).status).toBe(403);
    });

    it('un operador de OTRA empresa no ve ni confirma la reserva (404)', async () => {
      const atr = await crearAtraccion({ operator: { id: 102, name: 'Galápagos Blue Tours' } });
      const r = await reservar(atr, cliente, reserva(fechaEc(46), { payment_method: 'TRANSFERENCIA' }));
      expect((await http(app).get(`/atracciones/reservations/${r.body.reservation_id}`).set(bearer(operador))).status).toBe(404);
      expect((await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/confirm`).set(bearer(operador)).set(idem()).send()).status).toBe(404);
    });
  });

  describe('consultas', () => {
    it('el cliente solo ve sus reservas, aun pidiendo all=true', async () => {
      const atr = await crearAtraccion();
      const mia = await reservar(atr, ana, reserva(fechaEc(47), { customer_name: 'Ana Torres' }));
      const lista = await http(app).get('/atracciones/reservations?all=true').set(bearer(cliente));
      expect(lista.status).toBe(200);
      expect(lista.body.map((r: { reservation_id: string }) => r.reservation_id)).not.toContain(mia.body.reservation_id);
      expect(Number(lista.headers['x-total-count'])).toBeGreaterThan(0);
      // El dueño se comprueba en la orden (customer.email es el contacto de la reserva y puede ser otro)
      const duenos = await db(app).query(
        `SELECT DISTINCT u.usu_correo AS correo FROM reserva r JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN orden o ON o.ord_id = dt.ord_id
           JOIN usuario u ON u.usu_id = o.usu_id WHERE r.res_uuid = ANY($1::uuid[])`,
        [lista.body.map((r: { reservation_id: string }) => r.reservation_id)],
      );
      expect(duenos).toEqual([{ correo: USERS.cliente.email }]);
    });

    it('el operador con all=true ve solo las de su empresa; el admin, todas', async () => {
      const propia = await reservar(await crearAtraccion(), ana, reserva(fechaEc(48), { customer_name: 'Ana Torres' }));
      const ajena = await reservar(await crearAtraccion({ operator: { id: 102, name: 'x' } }), ana, reserva(fechaEc(48), { customer_name: 'Ana Torres' }));
      const ids = async (token: string) =>
        ((await http(app).get(`/atracciones/reservations?all=true&date=${fechaEc(48)}`).set(bearer(token))).body as { reservation_id: string }[]).map((r) => r.reservation_id);
      const op = await ids(operador);
      expect(op).toContain(propia.body.reservation_id);
      expect(op).not.toContain(ajena.body.reservation_id);
      const ad = await ids(admin);
      expect(ad).toEqual(expect.arrayContaining([propia.body.reservation_id, ajena.body.reservation_id]));
    });

    it('filtros por estado y búsqueda con comodines literales', async () => {
      const r = await http(app).get('/atracciones/reservations?status=CANCELLED').set(bearer(cliente));
      expect(r.status).toBe(200);
      expect(r.body.every((x: { status: string }) => x.status === 'CANCELLED')).toBe(true);
      const q = await http(app).get('/atracciones/reservations?all=true&q=%25').set(bearer(admin));
      expect(q.status).toBe(200);
      expect(q.body).toHaveLength(0); // "%" se busca literal, no como comodín
      expect((await http(app).get('/atracciones/reservations?status=FOO').set(bearer(cliente))).status).toBe(400);
    });

    it('sin token → 401 con formato RFC 7807', async () => {
      const r = await http(app).get('/atracciones/reservations');
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ status: 401, title: 'No autenticado' });
    });
  });

  describe('disponibilidad y calendario', () => {
    it('calendario de un mes: días pasados "past", bloqueados "blocked"', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(3);
      await http(app).post(`/atracciones/${atr}/blocked-dates`).set(bearer(operador)).send({ date: fecha, reason: 'Feriado nacional' });
      const cal = await http(app).get(`/atracciones/${atr}/availability/calendar?month=${fecha.slice(0, 7)}`);
      expect(cal.status).toBe(200);
      const dia = cal.body.find((d: { date: string }) => d.date === fecha);
      expect(dia).toMatchObject({ status: 'blocked', reason: 'Feriado nacional' });
      expect(cal.body.every((d: { date: string }) => d.date.startsWith(fecha.slice(0, 7)))).toBe(true);
      expect((await http(app).get(`/atracciones/${atr}/availability/calendar?month=2026-13`)).status).toBe(400);
    });

    it('fechas pasadas no tienen cupos', async () => {
      const atr = await crearAtraccion();
      const r = await http(app).get(`/atracciones/${atr}/availability?date=${fechaEc(-3)}`);
      expect(r.body).toMatchObject({ available_spots: 0, times: [] });
    });

    it('bajar el cupo no deja el inventario por debajo de lo ya reservado', async () => {
      const atr = await crearAtraccion();
      const fecha = fechaEc(50);
      await reservar(atr, cliente, reserva(fecha, { ticket_count: 4 }));
      expect((await http(app).patch(`/atracciones/${atr}`).set(bearer(admin)).send({ capacity_per_slot: 2 })).status).toBe(200);
      const [{ total, reservado }] = await db(app).query(
        `SELECT d.dis_cupo_total AS total, d.dis_cupo_reservado AS reservado FROM disponibilidad d JOIN atraccion a ON a.atr_id = d.atr_id WHERE a.atr_uuid = $1 AND d.dis_fecha = $2`,
        [atr, fecha],
      );
      expect(total).toBeGreaterThanOrEqual(reservado);
      expect(await cupo(atr, fecha)).toBe(0);
    });

    it('no se puede eliminar una atracción con reservas próximas (409)', async () => {
      const atr = await crearAtraccion();
      await reservar(atr, cliente, reserva(fechaEc(51)));
      expect((await http(app).delete(`/atracciones/${atr}`).set(bearer(admin))).status).toBe(409);
    });
  });
});
