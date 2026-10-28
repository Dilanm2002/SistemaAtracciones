/* eslint-disable */
/**
 * Prueba de humo ANTES de la demo con Booking: recorre el contrato v3 a través del API Gateway, como lo
 * haría Booking, y valida cada respuesta con los esquemas oficiales (booking-atracciones-v3.yaml).
 *
 *   GATEWAY_URL=http://localhost:8080 BOOKING_API_KEY=<clave> node scripts/prueba-humo.js
 *
 * Sin BOOKING_API_KEY se salta la reserva (todo lo demás es público). La reserva es REAL: crea una
 * reserva de 1 adulto en la base de la tienda y luego la cancela (compensación), dejando el cupo como estaba.
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { load } = require('js-yaml');
const { readFileSync } = require('fs');
const { join } = require('path');
const { randomUUID } = require('crypto');

const GW = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const CLAVE = process.env.BOOKING_API_KEY;
const contrato = load(readFileSync(join(__dirname, '..', 'ms-catalog', 'contract', 'booking-atracciones-v3.yaml'), 'utf8'), { json: true });
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contrato, 'v3');

let fallas = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const mal = (m) => {
  fallas++;
  console.log(`  ✖ ${m}`);
};
function esquema(nombre, datos, que) {
  const v = ajv.getSchema(`v3#/components/schemas/${nombre}`) ?? ajv.compile({ $ref: `v3#/components/schemas/${nombre}` });
  if (v(datos)) ok(`${que} cumple ${nombre}`);
  else mal(`${que} NO cumple ${nombre}: ${v.errors.slice(0, 3).map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
}
async function llamar(metodo, ruta, cuerpo, headers = {}) {
  const t = Date.now();
  const r = await fetch(`${GW}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-correlation-id': `humo-${randomUUID().slice(0, 8)}`, ...headers },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const ms = Date.now() - t;
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no JSON */ }
  if (ms > 4000) mal(`${metodo} ${ruta} tardó ${ms} ms (Booking corta a los 4 s)`);
  return { status: r.status, json, ms, por: r.headers.get('x-atendido-por') };
}

(async () => {
  console.log(`Prueba de humo contra ${GW}\n`);

  console.log('1. Salud del nodo (semáforo de Booking)');
  const h = await llamar('GET', '/api/v3/health');
  h.status === 200 ? ok(`/health → ${h.json.status} en ${h.ms} ms`) : mal(`/health → ${h.status} ${JSON.stringify(h.json)}`);
  esquema('NodeHealthResponse', h.json, '/health');
  for (const d of h.json?.dependencias ?? []) (d.status === 'UP' ? ok : mal)(`  ${d.servicio}: ${d.status} (${d.latency_ms} ms)`);

  console.log('\n2. Catálogo (lo atiende ms_catalog)');
  const arbol = await llamar('GET', '/api/v3/atracciones/categorias/arbol');
  (arbol.por === 'catalogo' ? ok : mal)(`árbol atendido por ${arbol.por}`);
  for (const n of arbol.json ?? []) esquema('CategoryTreeNode', n, `categoría ${n.slug}`);
  const lista = await llamar('GET', '/api/v3/atracciones?limit=50');
  esquema('SearchAtraccionesResponseV2', lista.json, 'listado');
  ok(`${lista.json?.metadata?.total_results} atracciones publicadas`);
  const busca = await llamar('POST', '/api/v3/atracciones/search', { query: 'quito', limit: 5 });
  esquema('SearchAtraccionesResponseV2', busca.json, 'búsqueda «quito»');
  const primera = lista.json?.data?.[0];
  if (!primera) return void mal('No hay atracciones publicadas');
  const ficha = await llamar('GET', `/api/v3/atracciones/${primera.id}`);
  esquema('AtraccionDetailResponseV2', ficha.json, `ficha de «${primera.name}»`);

  const fotos = (ficha.json?.data?.photos ?? ficha.json?.photos ?? []).filter((u) => typeof u === 'string');
  if (fotos[0]) {
    const f = await fetch(fotos[0], { signal: AbortSignal.timeout(8000) }).catch(() => null);
    (f?.ok && /^image\//.test(f.headers.get('content-type') ?? '') ? ok : mal)(`foto principal → ${f?.status ?? 'sin respuesta'}`);
  }

  if (process.env.SIN_TIENDA === 'true') {
    // El nodo solo publica los microservicios de Dilan: lo demás debe responder 503 diciendo de quién es
    console.log('\n3. Rutas de los compañeros (todavía no conectadas)');
    for (const [m, ruta] of [['GET', `/api/v3/atracciones/${primera.id}/disponibilidad`], ['POST', '/api/v3/reservas']]) {
      const r = await llamar(m, ruta, m === 'POST' ? {} : undefined, { 'idempotency-key': randomUUID() });
      (r.status === 503 && r.json?.code === 'SERVICIO_NO_CONECTADO' ? ok : mal)(`${m} ${ruta.replace(primera.id, '{id}')} → ${r.status} · ${r.json?.detail ?? ''}`);
    }
    console.log(fallas ? `\n✖ ${fallas} problema(s)` : '\n✔ Mis microservicios listos para Booking');
    process.exit(fallas ? 1 : 0);
  }

  console.log('\n3. Disponibilidad (la atiende la tienda; mismo UUID que el catálogo)');
  const fecha = new Date(Date.now() + 9 * 86400_000).toISOString().slice(0, 10);
  const disp = await llamar('GET', `/api/v3/atracciones/${primera.id}/disponibilidad?date=${fecha}`);
  (disp.status === 200 && disp.por === 'tienda' ? ok : mal)(`disponibilidad ${fecha} → ${disp.status} (${disp.por})`);
  if (disp.status === 200) esquema('DisponibilidadResponse', disp.json, 'disponibilidad');

  console.log('\n4. Compra despachada por Booking a {baseUrlRest}/reservas (guía de integración)');
  const slot = disp.json?.time_slots?.find((s) => s.available_slots > 0 || s.cupos_disponibles > 0);
  if (!CLAVE) console.log('  – sin BOOKING_API_KEY: se salta la reserva');
  else if (!slot) mal('No hay turnos con cupos para probar la reserva');
  else {
    const r = await llamar('POST', '/api/v3/reservas', {
      attraction_id: primera.id, date: fecha, time: slot.time, slot_id: slot.slot_id, adult_count: 1, total_tickets: 1,
      customer: { name: 'Prueba Humo', email: 'humo@descubre-ec.com', phone: '+593991234567', document_id: '1710034065' },
      booking_reservation_id: `HUMO-${Date.now()}`,
    }, { 'x-api-key': CLAVE, 'idempotency-key': randomUUID() });
    (r.status === 201 && r.json?.success ? ok : mal)(`reserva → ${r.status} ${r.json?.reservation_code ?? r.json?.detail ?? ''} en ${r.ms} ms`);
    if (r.status === 201) {
      esquema('ReservaConfirmadaResponseV2', r.json, 'reserva');
      const c = await llamar('POST', `/api/v3/reservas/${r.json.reservation_id}/cancel`, { reason: 'Prueba de humo', solicitante: 'SAGA_ORCHESTRATOR' },
        { 'x-api-key': CLAVE, 'idempotency-key': randomUUID() });
      (c.status === 200 && c.json?.status === 'CANCELLED' ? ok : mal)(`compensación (cancelación) → ${c.status} ${c.json?.status ?? ''}`);
    }
    const sin = await llamar('POST', '/api/v3/reservas', {}, { 'idempotency-key': randomUUID() });
    (sin.status === 401 ? ok : mal)(`sin X-API-Key → ${sin.status}`);
  }

  console.log(fallas ? `\n✖ ${fallas} problema(s)` : '\n✔ Todo listo para Booking');
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('✖ No se pudo completar la prueba:', e.message);
  process.exit(1);
});
