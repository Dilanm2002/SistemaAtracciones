/**
 * Ensayo de los dos flujos de la defensa contra un gateway real, actuando como panel, Booking y web.
 *   GATEWAY_URL=http://localhost:8080 BOOKING_API_KEY=… JWT_SECRET=… node scripts/ensayo-defensa.js
 * Con BOOKING_FALSO=9099 levanta un Booking falso en ese puerto para recibir el aviso y el stock (arrancar los
 * servicios con BOOKING_API_URL=http://localhost:9099 BOOKING_AVISOS_ENABLED=true BOOKING_STOCK_ENABLED=true).
 * Crea datos de prueba y los deja cancelados; la atracción queda eliminada al final.
 */
const { createHmac, randomUUID } = require('crypto');
const { createServer } = require('http');

const GW = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const CLAVE = process.env.BOOKING_API_KEY;
const SECRETO = process.env.JWT_SECRET;
if (!CLAVE || !SECRETO) throw new Error('Faltan BOOKING_API_KEY y JWT_SECRET');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 900, ...claims })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}
const ADMIN = jwt({ sub: '1', rol: 'ADMIN', email: 'admin@descubre-ec.com' });
const TURISTA_WEB = jwt({ sub: '777001', rol: 'CLIENTE', email: 'ensayo.web@descubre-ec.com' });

let fallos = 0;
function ok(condicion, texto, detalle) {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${texto}${!condicion && detalle !== undefined ? ` → ${JSON.stringify(detalle).slice(0, 400)}` : ''}`);
  if (!condicion) fallos++;
}
async function http(metodo, ruta, { cuerpo, token, clave, idem } = {}) {
  const t = Date.now();
  const r = await fetch(`${GW}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(clave ? { 'X-API-Key': clave } : {}),
      ...(idem ? { 'Idempotency-Key': randomUUID() } : {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null), ms: Date.now() - t };
}
const esperar = (ms) => new Promise((f) => setTimeout(f, ms));
async function hasta(fn, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > fin) return v;
    await esperar(500);
  }
}

function bookingFalso(puerto) {
  const recibidos = [];
  const s = createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      recibidos.push({ ruta: req.url, clave: req.headers['x-api-key'], cuerpo: b ? JSON.parse(b) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ acknowledged: true, status: 'CONFIRMADO_ASISTIDO' }));
    });
  });
  return new Promise((f) => s.listen(puerto, () => f({ recibidos, cerrar: () => s.close() })));
}

async function main() {
  const falso = process.env.BOOKING_FALSO ? await bookingFalso(Number(process.env.BOOKING_FALSO)) : null;
  const dia = new Date(Date.now() + 10 * 86400000 - 5 * 3600000).toISOString().slice(0, 10);
  const sufijo = Date.now().toString(36);

  console.log('\n── Flujo 1: crear en el panel → reservar desde Booking → ver cupos descontados en la web');
  const categorias = await http('GET', '/ms/catalog/v1/categorias');
  const ciudades = await http('GET', '/ms/location/v1/ciudades');
  const operadores = await http('GET', '/ms/catalog/v1/operadores');
  const creada = await http('POST', '/bff/v1/atracciones', {
    token: ADMIN,
    cuerpo: {
      name: `Ensayo defensa ${sufijo}`, long_description: 'Atracción creada por el ensayo de la defensa, se elimina al terminar.', duration: 'PT2H30M',
      price: { currency: 'USD', total: 40 }, child_price: 25, operator: { id: operadores.body[0].ope_codigo }, product_type: 'GUIDED_TOUR',
      includes: ['Guía del ensayo'], not_includes: [], recommendations: [], categories: [categorias.body[0].cat_slug],
      locations: [{ address: 'Av. del Ensayo', city: ciudades.body[0].ciu_id, country: 'ec', coordinates: { latitude: -0.2, longitude: -78.5 }, type: 'attraction' }],
      photos: [{ url: 'https://example.com/ensayo.jpg' }], supported_languages: ['es'], free_cancellation: true, cancellation_hours: 24, times: ['10:30'], capacity_per_slot: 10,
      meeting_point: 'Punto del ensayo', guide_name: 'Guía de ensayo', itinerary: [], is_active: true, featured: false,
    },
  });
  ok(creada.status === 201, `el panel crea la atracción con 10 cupos (${creada.ms} ms)`, creada.body);
  const id = creada.body?.id;
  if (!id) throw new Error('No se pudo crear la atracción: el ensayo no puede seguir');

  const enBooking = await hasta(async () => {
    const r = await http('GET', `/api/v3/atracciones/${id}`);
    return r.status === 200 && r.body.price?.adult === 40 ? r : null;
  });
  ok(!!enBooking, 'Booking ve la atracción en el catálogo v3 con su precio');
  const dispV3 = await http('GET', `/api/v3/atracciones/${id}/disponibilidad?date=${dia}`);
  const slot = dispV3.body?.slots?.[0] ?? dispV3.body?.time_slots?.[0] ?? dispV3.body?.horarios?.[0];
  ok(slot?.available_slots === 10, 'Booking ve 10 cupos', dispV3.body);
  const web = await http('POST', '/bff/v1/atracciones/search', { cuerpo: { rows: 5, filters: { query: `Ensayo defensa ${sufijo}` } } });
  ok(web.body?.data?.[0]?.id === id, 'la web la encuentra en el buscador', web.body);
  const dispWeb = async () => (await http('GET', `/bff/v1/atracciones/${id}/availability?date=${dia}`)).body;
  ok((await dispWeb())?.available_spots === 10, 'la web muestra 10 cupos');

  console.log('\n── Flujo 2 (parte 1): turista de Booking sin duplicados');
  const turista = { nombre: 'Pepito Evaluador', email: `pepito.${sufijo}@booking.com`, identificacion: '1710034065', telefono: '0998765432' };
  const correo = encodeURIComponent(turista.email);
  ok((await http('GET', `/api/v3/clientes?email=${correo}&identificacion=${sufijo}X`, { clave: CLAVE })).status === 404, 'GET /clientes de alguien nuevo → 404');
  const alta = await http('POST', '/api/v3/clientes', { clave: CLAVE, cuerpo: turista });
  ok([200, 201].includes(alta.status) && /^DEC-USR-\d+$/.test(alta.body?.client_id ?? ''), `POST /clientes → ${alta.status} ${alta.body?.client_id}`, alta.body);
  const repetido = await http('POST', '/api/v3/clientes', { clave: CLAVE, cuerpo: turista });
  ok(repetido.status === 200 && repetido.body.client_id === alta.body.client_id, 'repetir el POST devuelve el mismo client_id', repetido.body);
  const panelT = await http('GET', `/bff/v1/turistas?q=${correo}`, { token: ADMIN });
  ok(panelT.status === 200 && panelT.body.total <= 1, 'el panel lo ve una sola vez', panelT.body);

  console.log('\n── Booking reserva 2 cupos');
  const hora = slot?.time_24h?.slice(0, 5) ?? '10:30';
  const pedido = {
    atraccion_id: id, fecha: dia, slot_id: `slot-${dia.replace(/-/g, '')}-${hora.replace(':', '')}`, hora, adult_count: 2, child_count: 0, client_id: alta.body.client_id,
    customer: { client_id: alta.body.client_id, full_name: turista.nombre, email: turista.email, phone: turista.telefono, document_type: 'CEDULA', document_id: turista.identificacion },
    payment_method: 'SOA_BOOKING_GATEWAY',
  };
  const reserva = await http('POST', '/api/v3/atracciones/reservas', { clave: CLAVE, idem: true, cuerpo: pedido });
  ok(reserva.status === 201, `Booking reserva (${reserva.ms} ms; corta a los 4000)`, reserva.body);
  ok(reserva.ms < 4000, 'responde antes de que Booking corte');
  const codigo = reserva.body?.reservation_code;
  ok(await hasta(async () => ((await dispWeb())?.available_spots === 8 ? true : null)), 'la web muestra 8 cupos: se descontaron');
  if (falso) {
    const stock = await hasta(() => falso.recibidos.find((x) => x.ruta === '/api/v3/inventory/stock' && x.cuerpo.item_id === id && x.cuerpo.available_units === 8));
    ok(stock?.clave === CLAVE && stock?.cuerpo?.service_id === 'NODE_ATR_DILAN', 'Booking recibe el stock por REST', stock);
  }

  console.log('\n── Flujo 2 (parte 2): check-in en el panel → aviso a Booking');
  const lista = await http('GET', '/bff/v1/atracciones/reservations?all=true', { token: ADMIN });
  const enPanel = lista.body?.find?.((r) => r.code === codigo);
  ok(enPanel?.origin === 'BOOKING' && enPanel?.client_id === alta.body.client_id, 'el panel muestra la reserva de Booking con su turista', enPanel ?? lista.body);
  const malDoc = await http('POST', `/bff/v1/atracciones/reservations/${enPanel?.reservation_id}/checkin`, { token: ADMIN, idem: true, cuerpo: { documento_identidad: '0000000000' } });
  ok(malDoc.status === 400, 'un documento que no coincide se rechaza', malDoc.body);
  const checkin = await http('POST', `/bff/v1/atracciones/reservations/${enPanel?.reservation_id}/checkin`, { token: ADMIN, idem: true, cuerpo: { documento_identidad: turista.identificacion } });
  ok(checkin.status === 200 && checkin.body?.estado === 'CHECKED_IN', 'el check-in se registra', checkin.body);
  if (falso) {
    const aviso = await hasta(() => falso.recibidos.find((x) => x.ruta === `/api/v3/reservas/${codigo}/checkin`));
    ok(aviso?.clave === CLAVE && aviso?.cuerpo?.external_order_id === codigo && aviso?.cuerpo?.client_id === alta.body.client_id && aviso?.cuerpo?.estado === 'CONFIRMADO_ASISTIDO', 'Booking recibe el aviso con el cuerpo v3.1', aviso);
    const notado = await hasta(async () => {
      const r = await http('GET', `/bff/v1/atracciones/reservations/${enPanel?.reservation_id}`, { token: ADMIN });
      return r.body?.booking_notice === 'ENVIADO' ? r : null;
    });
    ok(!!notado, 'el panel muestra «Booking avisado»');
  }

  console.log('\n── Compra desde la web: usa los mismos cupos');
  const compra = await http('POST', `/bff/v1/atracciones/${id}/reservations`, {
    token: TURISTA_WEB, idem: true,
    cuerpo: { date: dia, time: hora, ticket_count: 3, children: 1, customer_name: 'Lucia Web Andrade', customer_email: 'ensayo.web@descubre-ec.com', customer_phone: '0991234567', customer_document: '1724589633', payment_method: 'TARJETA' },
  });
  ok(compra.status === 201 && compra.body?.status === 'CONFIRMED' && compra.body?.origin === 'WEB', `la web compra 3 cupos (${compra.ms} ms)`, compra.body);
  ok((await hasta(async () => ((await dispWeb())?.available_spots === 5 ? true : null))), 'quedan 5 cupos');
  const mias = await http('GET', '/bff/v1/atracciones/reservations', { token: TURISTA_WEB });
  ok(mias.body?.length >= 1 && mias.body.every((r) => r.origin === 'WEB'), '«Mis reservas» solo muestra las propias', mias.body);
  const ajena = await http('GET', `/bff/v1/atracciones/reservations/${enPanel?.reservation_id}`, { token: TURISTA_WEB });
  ok(ajena.status === 403, 'otro usuario no puede ver una reserva ajena', ajena.body);
  const cancelada = await http('POST', `/bff/v1/atracciones/reservations/${compra.body?.reservation_id}/cancel`, { token: TURISTA_WEB, idem: true, cuerpo: { reason: 'Ensayo' } });
  ok(cancelada.status === 200 && cancelada.body?.status === 'CANCELLED', 'el turista cancela su compra', cancelada.body);
  ok((await hasta(async () => ((await dispWeb())?.available_spots === 8 ? true : null))), 'los cupos vuelven a 8');

  console.log('\n── Limpieza');
  const borrada = await http('DELETE', `/bff/v1/atracciones/${id}`, { token: ADMIN });
  ok(borrada.status === 204, 'se elimina la atracción de prueba', borrada.body);
  falso?.cerrar();

  console.log(fallos ? `\n✘ ${fallos} problema(s)` : '\n✔ Los dos flujos funcionan');
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
