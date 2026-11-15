#!/usr/bin/env node
/**
 * Corre las pruebas unitarias, de integración y E2E de Descubre EC y mide la concordancia entre el resultado
 * ESPERADO y el OBTENIDO de cada caso con el coeficiente Kappa de Cohen. No modifica el backend ni el frontend:
 * solo ejecuta las pruebas que ya existen y agrega casos E2E contra la API.
 *
 *   node pruebas/ejecutar-pruebas.mjs                    # todo, E2E contra el gateway local (http://localhost:8080)
 *   node pruebas/ejecutar-pruebas.mjs --solo=unitarias   # unitarias | integracion | e2e (se pueden separar con coma)
 *   node pruebas/ejecutar-pruebas.mjs --e2e-url=https://descubre-gateway…/   # E2E contra la nube (solo lectura)
 *   node pruebas/ejecutar-pruebas.mjs --e2e-escritura    # en la nube, también crea y cancela reservas de prueba
 *   node pruebas/ejecutar-pruebas.mjs --sin-navegador    # omite Playwright
 *
 * Requisitos: Node 20+, dependencias instaladas (npm install en backend, frontend y microservicios).
 * Integración: Docker con las bases de prueba (cd microservicios && docker compose up -d).
 * E2E de la API en local: los microservicios encendidos (bash microservicios/scripts/arrancar-todo.sh).
 * Las claves (BOOKING_API_KEY, JWT_SECRET) se leen de backend/.env o deploy/azure/.env; nunca se imprimen.
 *
 * Kappa (Cohen, 1960): κ = (po − pe) / (1 − pe). po = proporción de casos en que esperado y obtenido coinciden;
 * pe = coincidencia esperada por azar. Interpretación de Landis y Koch (1977).
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MS = join(RAIZ, 'microservicios');
const TMP = join(tmpdir(), `pruebas-descubre-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const SOLO = args.solo ? String(args.solo).split(',') : ['unitarias', 'integracion', 'e2e'];
const E2E_URL = String(args['e2e-url'] ?? 'http://localhost:8080').replace(/\/$/, '');
const EN_NUBE = !/localhost|127\.0\.0\.1/.test(E2E_URL);
const ESCRITURA = !EN_NUBE || !!args['e2e-escritura'];

/** Un caso: su capa, de dónde viene, su nombre, qué se esperaba y qué se obtuvo. */
const casos = [];
const omitidos = [];
const agregar = (capa, origen, nombre, esperado, obtenido, detalle = '') => casos.push({ capa, origen, nombre, esperado, obtenido, detalle });

const log = (...m) => console.log(...m);
const titulo = (t) => log(`\n━━ ${t} ${'━'.repeat(Math.max(0, 60 - t.length))}`);

function correr(cmd, cwd, env = {}, timeoutMs = 600_000) {
  return spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
}

function puertoAbierto(puerto, host = '127.0.0.1') {
  return new Promise((ok) => {
    const s = createConnection({ port: puerto, host });
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); ok(true); });
    s.on('error', () => ok(false));
    s.on('timeout', () => { s.destroy(); ok(false); });
  });
}

function leerVariable(nombre) {
  for (const f of [join(RAIZ, 'backend', '.env'), join(RAIZ, 'deploy', 'azure', '.env')]) {
    if (!existsSync(f)) continue;
    const m = new RegExp(`^${nombre}=(.*)$`, 'm').exec(readFileSync(f, 'utf8'));
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  }
  return process.env[nombre];
}

// ── Lectores de resultados ────────────────────────────────────────────────

/** Jest con --json: un caso por prueba. Las omitidas no cuentan para Kappa. */
function casosJest(archivo, capa, origen) {
  if (!existsSync(archivo)) return false;
  const r = JSON.parse(readFileSync(archivo, 'utf8'));
  for (const s of r.testResults ?? []) {
    if (!s.assertionResults?.length && s.status === 'failed') {
      agregar(capa, origen, `${s.name.split(/[\\/]/).pop()} (no arrancó)`, 'aprobada', 'fallida', (s.message ?? '').split('\n')[0].slice(0, 160));
    }
    for (const t of s.assertionResults ?? []) {
      if (t.status === 'pending' || t.status === 'skipped' || t.status === 'todo') { omitidos.push(`${origen}: ${t.fullName}`); continue; }
      agregar(capa, origen, t.fullName, 'aprobada', t.status === 'passed' ? 'aprobada' : 'fallida', (t.failureMessages?.[0] ?? '').split('\n')[0].slice(0, 160));
    }
  }
  return true;
}

/** node --test con reporter JUnit. */
function casosJUnit(archivo, capa, origen) {
  if (!existsSync(archivo)) return false;
  const xml = readFileSync(archivo, 'utf8');
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const nombre = /name="([^"]*)"/.exec(m[1])?.[1] ?? '¿?';
    const cuerpo = m[3] ?? '';
    if (/<skipped/.test(cuerpo)) { omitidos.push(`${origen}: ${nombre}`); continue; }
    agregar(capa, origen, nombre, 'aprobada', /<failure/.test(cuerpo) ? 'fallida' : 'aprobada');
  }
  return true;
}

/** Playwright con --reporter=json. */
function casosPlaywright(json, capa, origen) {
  const recorrer = (suite, ruta) => {
    for (const s of suite.suites ?? []) recorrer(s, [...ruta, s.title]);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const estado = t.results?.at(-1)?.status ?? t.status;
        if (estado === 'skipped') { omitidos.push(`${origen}: ${spec.title}`); continue; }
        agregar(capa, origen, `[${t.projectName}] ${[...ruta, spec.title].filter(Boolean).join(' › ')}`, 'aprobada', estado === 'passed' || estado === 'expected' ? 'aprobada' : 'fallida');
      }
    }
  };
  for (const s of json.suites ?? []) recorrer(s, []);
}

// ── 1. Unitarias ──────────────────────────────────────────────────────────

async function unitarias() {
  titulo('1. Pruebas unitarias');
  const capa = 'Unitarias';

  log('  · frontend (node --test)');
  const junit = join(TMP, 'frontend.xml');
  const archivos = readdirSync(join(RAIZ, 'frontend', 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => `tests/${f}`).join(' ');
  correr(`node --test --test-reporter=junit --test-reporter-destination="${junit}" ${archivos}`, join(RAIZ, 'frontend'));
  if (!casosJUnit(junit, capa, 'frontend')) omitidos.push('frontend: no se pudo leer el resultado');

  log('  · backend de la tienda (jest)');
  const jb = join(TMP, 'backend.json');
  correr(`npx jest --json --outputFile="${jb}" --silent`, join(RAIZ, 'backend'), { NODE_ENV: 'test' });
  if (!casosJest(jb, capa, 'backend')) omitidos.push('backend: no se pudo leer el resultado');

  for (const [ws, filtro] of [['gateway', ''], ['bff-web', ''], ['ms-booking', 'test/politica.spec.ts']]) {
    log(`  · microservicios/${ws}`);
    const f = join(TMP, `unit-${ws}.json`);
    correr(`npx jest --json --outputFile="${f}" --runInBand ${filtro}`, join(MS, ws), { NODE_ENV: 'test' });
    if (!casosJest(f, capa, ws)) omitidos.push(`${ws}: no se pudo leer el resultado`);
  }
}

// ── 2. Integración ────────────────────────────────────────────────────────

async function integracion() {
  titulo('2. Pruebas de integración (bases de datos reales)');
  const capa = 'Integración';
  if (!(await puertoAbierto(5434))) {
    omitidos.push('Integración de microservicios: la base de pruebas (puerto 5434) no responde. Ejecuta: cd microservicios && docker compose up -d');
    log('  ✘ base de pruebas en el puerto 5434 apagada: se omite (docker compose up -d en microservicios)');
  } else {
    const servicios = readdirSync(MS).filter((d) => d.startsWith('ms-') && existsSync(join(MS, d, 'test')));
    for (const s of servicios) {
      const base = s.replace('-', '_');
      log(`  · ${s} (${base}_test)`);
      const f = join(TMP, `int-${s}.json`);
      // ms-booking: la regla de 24 h ya corrió como unitaria; aquí va la saga con los 7 servicios
      const filtro = s === 'ms-booking' ? 'test/saga.spec.ts' : '';
      correr(`npx jest --json --outputFile="${f}" --runInBand ${filtro}`, join(MS, s), { NODE_ENV: 'test', TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:5434/${base}_test` });
      if (!casosJest(f, capa, s)) omitidos.push(`${s}: no se pudo leer el resultado`);
    }
  }

  // Backend de la tienda contra su base de pruebas (si existe)
  const urlTienda = process.env.TEST_DATABASE_URL_TIENDA ?? 'postgresql://postgres:postgres@localhost:5433/descubre_ec_e2e';
  const puerto = Number(/:(\d+)\//.exec(urlTienda)?.[1] ?? 5433);
  if (await puertoAbierto(puerto)) {
    log('  · backend de la tienda (test/e2e contra su base)');
    const f = join(TMP, 'backend-int.json');
    correr(`npx jest --config test/jest-e2e.json --json --outputFile="${f}" --runInBand`, join(RAIZ, 'backend'), { NODE_ENV: 'test', TEST_DATABASE_URL: urlTienda });
    if (!casosJest(f, capa, 'backend')) omitidos.push('backend (integración): no se pudo leer el resultado');
  } else {
    omitidos.push(`Integración del backend de la tienda: su base (${urlTienda.replace(/\/\/[^@]*@/, '//…@')}) no responde`);
  }
}

// ── 3. E2E ────────────────────────────────────────────────────────────────

/** Casos de punta a punta contra la API (gateway): cada uno sabe si el sistema debe ACEPTAR o RECHAZAR. */
async function e2eApi() {
  const capa = 'E2E (API)';
  const CLAVE = leerVariable('BOOKING_API_KEY');
  const SECRETO = leerVariable('JWT_SECRET');
  if (!(await fetch(`${E2E_URL}/api/v3/health`, { signal: AbortSignal.timeout(8000) }).catch(() => null))) {
    omitidos.push(`E2E de la API: el gateway ${E2E_URL} no responde (en local: bash microservicios/scripts/arrancar-todo.sh)`);
    log(`  ✘ el gateway ${E2E_URL} no responde: se omiten los casos de la API`);
    return;
  }
  if (!CLAVE || !SECRETO) {
    omitidos.push('E2E de la API: faltan BOOKING_API_KEY o JWT_SECRET (backend/.env o deploy/azure/.env)');
    return;
  }
  const jwt = (claims) => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const c = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ exp: Math.floor(Date.now() / 1000) + 900, ...claims })}`;
    return `Bearer ${c}.${createHmac('sha256', SECRETO).update(c).digest('base64url')}`;
  };
  const ADMIN = jwt({ sub: '1', rol: 'ADMIN', email: 'pruebas@descubre-ec.com' });
  const pedir = async (metodo, ruta, { cuerpo, clave, auth, idem = false } = {}) => {
    const t = Date.now();
    try {
      const r = await fetch(`${E2E_URL}${ruta}`, {
        method: metodo,
        headers: {
          ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(clave ? { 'X-API-Key': CLAVE } : {}),
          ...(auth ? { Authorization: auth } : {}),
          ...(idem ? { 'Idempotency-Key': randomUUID() } : {}),
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      return { status: r.status, body: await r.json().catch(() => null), ms: Date.now() - t };
    } catch (e) {
      return { status: 0, body: { detail: e.message }, ms: Date.now() - t };
    }
  };
  const decision = (s) => (s >= 200 && s < 300 ? 'acepta' : s >= 400 && s < 500 ? 'rechaza' : 'error');
  /** Un caso de decisión: el sistema debe aceptar o rechazar la petición. */
  const caso = async (nombre, esperado, peticion) => {
    const r = await peticion();
    agregar(capa, 'gateway', nombre, esperado, decision(r.status), `HTTP ${r.status} en ${r.ms} ms${r.status >= 400 ? ` · ${(r.body?.detail ?? r.body?.message ?? '').toString().slice(0, 90)}` : ''}`);
    return r;
  };
  /** Un caso de verificación: una condición sobre los datos debe cumplirse. */
  const verifica = (nombre, cumple, detalle) => agregar(capa, 'gateway', nombre, 'cumple', cumple ? 'cumple' : 'no cumple', detalle);

  log(`  · API contra ${E2E_URL}${ESCRITURA ? '' : ' (solo lectura)'}`);
  const salud = await caso('Salud del nodo para el semáforo de Booking', 'acepta', () => pedir('GET', '/api/v3/health'));
  verifica('Los 13 servicios están UP', salud.body?.status === 'UP', `estado ${salud.body?.status}`);
  const lista = await caso('Catálogo v3 (limit=10)', 'acepta', () => pedir('GET', '/api/v3/atracciones?limit=10'));
  await caso('Catálogo v3 con limit=100, como lo pide Booking', 'acepta', () => pedir('GET', '/api/v3/atracciones?limit=100'));
  await caso('Ficha de una atracción que no existe', 'rechaza', () => pedir('GET', `/api/v3/atracciones/${randomUUID()}`));
  const atr = lista.body?.data?.[0];
  const idAtr = atr?.id ?? atr?.atraccion_id;
  const manana = new Date(Date.now() - 5 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
  const disp = idAtr ? await caso('Disponibilidad de un día futuro', 'acepta', () => pedir('GET', `/api/v3/atracciones/${idAtr}/disponibilidad?date=${manana}`)) : null;
  await caso('Disponibilidad de una fecha pasada', 'rechaza', () => pedir('GET', `/api/v3/atracciones/${idAtr}/disponibilidad?date=2020-01-01`));
  await caso('Clientes sin X-API-Key', 'rechaza', () => pedir('GET', '/api/v3/clientes?email=a@b.com'));
  await caso('Clientes sin email ni identificación', 'rechaza', () => pedir('GET', '/api/v3/clientes', { clave: true }));
  await caso('Cliente que no existe', 'rechaza', () => pedir('GET', '/api/v3/clientes?identificacion=0000000001', { clave: true }));
  await caso('Reservar sin X-API-Key', 'rechaza', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: {}, idem: true }));
  await caso('Reservar sin Idempotency-Key', 'rechaza', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: {}, clave: true }));
  await caso('Cancelar una reserva que no existe', 'rechaza', () => pedir('POST', '/api/v3/reservas/DEC-NOEXIS/cancel', { cuerpo: {}, clave: true }));
  await caso('Ruta en inglés /reservations (alias) de una reserva que no existe', 'rechaza', () => pedir('GET', '/api/v3/atracciones/reservations/DEC-NOEXIS', { clave: true }));
  await caso('Buscador de la web (BFF)', 'acepta', () => pedir('POST', '/bff/v1/atracciones/search', { cuerpo: { rows: 3 } }));
  await caso('Reservas del panel sin sesión', 'rechaza', () => pedir('GET', '/bff/v1/atracciones/reservations?all=true'));
  await caso('Reservas del panel con sesión de administrador', 'acepta', () => pedir('GET', '/bff/v1/atracciones/reservations?all=true', { auth: ADMIN }));
  await caso('Ruta interna entre servicios publicada por error', 'rechaza', () => pedir('GET', '/ms/payment/v1/internal/pagos'));

  if (!ESCRITURA) {
    omitidos.push('E2E de la API: casos que crean y cancelan reservas omitidos en la nube (usa --e2e-escritura)');
    return;
  }
  const slot = disp?.body?.slots?.find((s) => s.available_slots >= 3) ?? disp?.body?.time_slots?.find((s) => s.available_slots >= 3);
  if (!slot) { omitidos.push('E2E de la API: no hay un turno con 3 cupos libres para el flujo de reserva'); return; }
  const hora = (slot.time_24h ?? '').slice(0, 5);
  const libres = async () => {
    const d = await pedir('GET', `/api/v3/atracciones/${idAtr}/disponibilidad?date=${manana}`);
    return (d.body?.slots ?? d.body?.time_slots ?? []).find((s) => (s.time_24h ?? '').startsWith(hora))?.available_slots;
  };
  const sufijo = Date.now().toString(36).slice(-5);
  const cedula = '1724589633';
  const turista = { nombre: `Prueba Kappa ${sufijo}`, email: `kappa.${sufijo}@pruebas.descubre-ec.com`, identificacion: cedula, telefono: '0991234567' };
  const alta = await caso('Registrar turista nuevo (POST /clientes)', 'acepta', () => pedir('POST', '/api/v3/clientes', { cuerpo: turista, clave: true }));
  const otra = await caso('Registrar el mismo turista otra vez (sin duplicar)', 'acepta', () => pedir('POST', '/api/v3/clientes', { cuerpo: turista, clave: true }));
  verifica('Repetir el registro devuelve el mismo client_id', !!alta.body?.client_id && alta.body?.client_id === otra.body?.client_id, `${alta.body?.client_id} / ${otra.body?.client_id}`);
  await caso('Registrar turista con correo inválido', 'rechaza', () => pedir('POST', '/api/v3/clientes', { cuerpo: { ...turista, email: 'no-es-correo' }, clave: true }));

  const pedido = (extra = {}) => ({
    atraccion_id: idAtr, fecha: manana, slot_id: `slot-${manana.replace(/-/g, '')}-${hora.replace(':', '')}`, hora, adult_count: 2, client_id: alta.body?.client_id,
    customer: { full_name: 'Prueba Kappa Andrade', email: turista.email, phone: '0991234567', document_type: 'CEDULA', document_id: cedula }, payment_method: 'SOA_BOOKING_GATEWAY', ...extra,
  });
  const antes = await libres();
  await caso('Reservar con slot_id que no coincide con la hora', 'rechaza', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: pedido({ hora: '23:59' }), clave: true, idem: true }));
  await caso('Reservar con cédula inválida', 'rechaza', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: pedido({ customer: { ...pedido().customer, document_id: '1234567890' } }), clave: true, idem: true }));
  const r1 = await caso('Reservar 2 cupos como Booking', 'acepta', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: pedido(), clave: true, idem: true }));
  verifica('La reserva responde antes de los 4 s de Booking', r1.ms < 4000, `${r1.ms} ms`);
  const tras = await libres();
  verifica('Los cupos se descuentan (−2)', antes - tras === 2, `${antes} → ${tras}`);
  const id1 = r1.body?.reservation_id;
  const cod1 = r1.body?.reservation_code;
  await caso('Check-in con un documento que no coincide', 'rechaza', () => pedir('POST', `/api/v3/atracciones/reservas/${id1}/checkin`, { cuerpo: { documento_identidad: '0000000000' }, clave: true, idem: true }));
  await caso('Check-in con la cédula del titular', 'acepta', () => pedir('POST', `/api/v3/atracciones/reservas/${id1}/checkin`, { cuerpo: { documento_identidad: cedula }, clave: true, idem: true }));
  await caso('Cancelar una reserva con check-in hecho', 'rechaza', () => pedir('POST', `/api/v3/reservas/${cod1}/cancel`, { cuerpo: { reason: 'Prueba' }, clave: true }));
  const r2 = await caso('Reservar otra vez 2 cupos', 'acepta', () => pedir('POST', '/api/v3/atracciones/reservas', { cuerpo: pedido(), clave: true, idem: true }));
  const c2 = await caso('Cancelar sin Idempotency-Key y con campos de más (como Booking)', 'acepta', () => pedir('POST', `/api/v3/reservas/${r2.body?.reservation_code}/cancel`, { cuerpo: { reason: 'Prueba Kappa', client_id: 'x', cancelled_by: 'BOOKING' }, clave: true }));
  verifica('La cancelación trae el comprobante de reembolso', !!c2.body?.cancel_code && c2.body?.refund?.status === 'PROCESSED', `${c2.body?.cancel_code} · ${c2.body?.refund?.status}`);
  await caso('Cancelar la misma reserva otra vez (idempotente)', 'acepta', () => pedir('POST', `/api/v3/reservas/${r2.body?.reservation_code}/cancel`, { cuerpo: {}, clave: true }));
  const fin = await libres();
  verifica('Los cupos de la reserva cancelada vuelven (y la del check-in sigue descontada)', fin === antes - 2, `${antes} → ${fin}`);
}

async function e2e() {
  titulo('3. Pruebas E2E');
  await e2eApi();
  if (args['sin-navegador']) { omitidos.push('E2E con navegador (Playwright): omitidas con --sin-navegador'); return; }
  log('  · web en el navegador (Playwright: teléfonos y tablet)');
  const web = join(RAIZ, 'frontend');
  const b = correr('npx vite build', web, {}, 300_000);
  if (b.status !== 0) { omitidos.push('E2E con navegador: no se pudo construir la web'); return; }
  const r = correr('npx playwright test --reporter=json', web, { CI: '' }, 900_000);
  try {
    casosPlaywright(JSON.parse(r.stdout), 'E2E (navegador)', 'frontend/e2e');
  } catch {
    omitidos.push(`E2E con navegador: sin resultado legible (${(r.stderr || r.stdout || '').split('\n').find(Boolean)?.slice(0, 120) ?? 'sin salida'})`);
  }
}

// ── Kappa ─────────────────────────────────────────────────────────────────

function kappa(lista) {
  const n = lista.length;
  if (!n) return null;
  const cats = [...new Set(lista.flatMap((c) => [c.esperado, c.obtenido]))];
  const matriz = Object.fromEntries(cats.map((e) => [e, Object.fromEntries(cats.map((o) => [o, 0]))]));
  for (const c of lista) matriz[c.esperado][c.obtenido]++;
  const po = lista.filter((c) => c.esperado === c.obtenido).length / n;
  const pe = cats.reduce((s, k) => s + (lista.filter((c) => c.esperado === k).length / n) * (lista.filter((c) => c.obtenido === k).length / n), 0);
  // Con una sola categoría ESPERADA (p. ej. todo «aprobada») Kappa no aplica: el azar ya explica toda la coincidencia
  // (paradoja de prevalencia; da 0/0 o 0 aunque acierte casi todo). En ese caso se informa solo la coincidencia (po).
  const esperadas = new Set(lista.map((c) => c.esperado)).size;
  const k = esperadas < 2 ? null : (po - pe) / (1 - pe);
  return { n, po, pe, k, matriz, cats };
}

const interpretar = (k) => (k === null ? 'No aplica: una sola categoría esperada (se usa la coincidencia)' : k < 0 ? 'Pobre (peor que el azar)' : k <= 0.2 ? 'Leve' : k <= 0.4 ? 'Aceptable' : k <= 0.6 ? 'Moderada' : k <= 0.8 ? 'Considerable' : 'Casi perfecta');

// ── Ejecución y reporte ───────────────────────────────────────────────────

const inicio = Date.now();
log(`Descubre EC · pruebas automatizadas con coeficiente Kappa\nCapas: ${SOLO.join(', ')} · E2E de la API: ${E2E_URL}${ESCRITURA ? '' : ' (solo lectura)'}`);
if (SOLO.includes('unitarias')) await unitarias();
if (SOLO.includes('integracion')) await integracion();
if (SOLO.includes('e2e')) await e2e();

const capas = [...new Set(casos.map((c) => c.capa))];
const filas = capas.map((capa) => ({ capa, ...kappa(casos.filter((c) => c.capa === capa)) }));
const total = kappa(casos);
const fallas = casos.filter((c) => c.esperado !== c.obtenido);
const pct = (x) => `${(x * 100).toFixed(1)} %`;

titulo('Resultado');
const kTxt = (k) => (k === null ? 'n/a' : k.toFixed(3));
for (const f of filas) log(`  ${f.capa.padEnd(18)} casos ${String(f.n).padStart(4)} · coincidencia ${pct(f.po).padStart(7)} · κ = ${kTxt(f.k)} (${interpretar(f.k)})`);
if (total) log(`  ${'TOTAL'.padEnd(18)} casos ${String(total.n).padStart(4)} · coincidencia ${pct(total.po).padStart(7)} · κ = ${kTxt(total.k)} (${interpretar(total.k)})`);
if (fallas.length) {
  log(`\n  Casos donde lo obtenido no coincide con lo esperado (${fallas.length}):`);
  for (const f of fallas.slice(0, 40)) log(`   ✘ [${f.capa}] ${f.nombre} → esperado ${f.esperado}, obtenido ${f.obtenido}${f.detalle ? ` · ${f.detalle}` : ''}`);
}
if (omitidos.length) log(`\n  Omitidos (${omitidos.length}):\n${omitidos.slice(0, 20).map((o) => `   · ${o}`).join('\n')}`);

const fecha = new Date();
const sello = fecha.toISOString().slice(0, 16).replace(/[-:T]/g, '');
const dirReportes = join(RAIZ, 'pruebas', 'reportes');
mkdirSync(dirReportes, { recursive: true });
const tablaMatriz = (r) => [`| Esperado \\ Obtenido | ${r.cats.join(' | ')} |`, `|---|${r.cats.map(() => '---:').join('|')}|`, ...r.cats.map((e) => `| **${e}** | ${r.cats.map((o) => r.matriz[e][o]).join(' | ')} |`)].join('\n');
const md = `# Reporte de pruebas — Descubre EC

Fecha: ${fecha.toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })} · duración ${Math.round((Date.now() - inicio) / 1000)} s
E2E de la API: \`${E2E_URL}\`${ESCRITURA ? '' : ' (solo lectura)'}

## Concordancia entre lo esperado y lo obtenido (Kappa de Cohen)

κ = (po − pe) / (1 − pe). *po*: proporción de casos en que lo obtenido coincide con lo esperado. *pe*: coincidencia esperada por azar.
Interpretación según Landis y Koch (1977): ≤ 0,20 leve · 0,21–0,40 aceptable · 0,41–0,60 moderada · 0,61–0,80 considerable · > 0,80 casi perfecta.

| Capa | Casos | po | pe | κ | Interpretación |
|---|---:|---:|---:|---:|---|
${filas.map((f) => `| ${f.capa} | ${f.n} | ${f.po.toFixed(3)} | ${f.pe.toFixed(3)} | **${kTxt(f.k)}** | ${interpretar(f.k)} |`).join('\n')}
${total ? `| **Total** | **${total.n}** | ${total.po.toFixed(3)} | ${total.pe.toFixed(3)} | **${kTxt(total.k)}** | **${interpretar(total.k)}** |` : ''}

En las unitarias y de integración cada prueba se espera *aprobada*. En los E2E de la API cada caso declara si el sistema debe **aceptar**
o **rechazar** la petición (o si una verificación debe **cumplirse**). En una capa con una sola categoría esperada Kappa no aplica
(paradoja de prevalencia: el azar ya explica toda la coincidencia) y se informa la coincidencia *po*. El Kappa total sí combina las categorías.

${total ? `### Matriz de confusión (total)\n\n${tablaMatriz(total)}\n` : ''}
## Casos que no coinciden (${fallas.length})

${fallas.length ? fallas.map((f) => `- **[${f.capa}] ${f.nombre}** — esperado *${f.esperado}*, obtenido *${f.obtenido}*${f.detalle ? ` (${f.detalle})` : ''}`).join('\n') : 'Ninguno.'}

## Omitidos (${omitidos.length})

${omitidos.length ? omitidos.map((o) => `- ${o}`).join('\n') : 'Ninguno.'}

## Todos los casos

| Capa | Origen | Caso | Esperado | Obtenido | Detalle |
|---|---|---|---|---|---|
${casos.map((c) => `| ${c.capa} | ${c.origen} | ${c.nombre.replace(/\|/g, '/')} | ${c.esperado} | ${c.esperado === c.obtenido ? c.obtenido : `**${c.obtenido}**`} | ${(c.detalle ?? '').replace(/\|/g, '/')} |`).join('\n')}
`;
const base = join(dirReportes, `reporte-${sello}`);
writeFileSync(`${base}.md`, md);
writeFileSync(`${base}.json`, JSON.stringify({ fecha: fecha.toISOString(), e2eUrl: E2E_URL, capas: filas, total, fallas, omitidos, casos }, null, 2));
rmSync(TMP, { recursive: true, force: true });
log(`\nReporte: ${base}.md (y .json)`);
process.exit(fallas.length ? 1 : 0);
