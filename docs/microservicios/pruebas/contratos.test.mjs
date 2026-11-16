// Pruebas de los contratos de los microservicios (docs/microservicios).
// Ejecutar: cd docs/microservicios/pruebas && npm install && npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import protobuf from 'protobufjs';
import { parse } from 'graphql';
import { composeServices } from '@apollo/composition';
import { Parser } from '@asyncapi/parser';
import { lint, loadConfig, bundle } from '@redocly/openapi-core';
import Ajv from 'ajv-validador/dist/2020.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(RAIZ, '../..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const leerYaml = (p) => yaml.load(leer(p));

const SERVICIOS_REST = ['usuarios', 'clientes', 'productos', 'stock', 'reservas', 'pagos', 'facturacion', 'mapas'];
const SERVICIOS_GRPC = ['productos', 'stock', 'reservas', 'facturacion'];
const SERVICIOS_GQL = ['usuarios', 'clientes', 'productos', 'stock', 'reservas', 'facturacion'];

const catalogo = leerYaml('catalogo.yaml');
const servicios = catalogo.servicios;
const asyncDoc = leerYaml('eventos/atracciones-eventos.asyncapi.yaml');
const canales = Object.keys(asyncDoc.channels);

// Junta las propiedades de un esquema resolviendo $ref locales y allOf.
function propiedades(esquema, doc) {
  if (!esquema) return {};
  if (esquema.$ref) {
    const destino = esquema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], doc);
    return propiedades(destino, doc);
  }
  let props = { ...(esquema.properties ?? {}) };
  for (const parte of esquema.allOf ?? []) {
    const p = propiedades(parte, doc);
    for (const [k, v] of Object.entries(p)) props[k] = props[k] ? { allOf: [props[k], v] } : v;
  }
  return props;
}
const camposData = (mensaje, doc) => Object.keys(propiedades(propiedades(mensaje.payload, doc).data, doc));
const mensajeDe = (doc, canal) => {
  const m = doc.channels[canal].subscribe.message;
  return m.$ref ? doc.components.messages[m.$ref.split('/').pop()] : m;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('1. OpenAPI de cada servicio', async () => {
  const config = await loadConfig();
  for (const s of SERVICIOS_REST) {
    test(`${s}: sin errores de Redocly y todas las $ref resuelven`, async () => {
      const ruta = path.join(RAIZ, 'servicios', s, 'openapi.yaml');
      const problemas = (await lint({ ref: ruta, config })).filter((p) => p.severity === 'error');
      assert.deepEqual(problemas.map((p) => `${p.ruleId}: ${p.message}`), []);
      const { problems } = await bundle({ ref: ruta, config });
      assert.equal(problems.filter((p) => p.severity === 'error').length, 0);
    });
  }
  test('las rutas /internal/* exigen ServicioJWT', () => {
    for (const s of SERVICIOS_REST) {
      const doc = leerYaml(`servicios/${s}/openapi.yaml`);
      for (const [ruta, ops] of Object.entries(doc.paths)) {
        if (!ruta.startsWith('/internal')) continue;
        for (const [metodo, op] of Object.entries(ops)) {
          const esquemas = (op.security ?? []).flatMap((x) => Object.keys(x));
          assert.ok(esquemas.includes('ServicioJWT'), `${s} ${metodo.toUpperCase()} ${ruta} sin ServicioJWT`);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. Rutas públicas del gateway (doc §4) → servicio dueño', () => {
  const esperadas = {
    usuarios: ['post /auth/login', 'post /auth/register', 'post /auth/google', 'get /auth/me', 'get /usuarios'],
    clientes: ['get /operadores', 'post /proveedores/solicitudes', 'get /favoritos', 'post /mensajes'],
    productos: ['get /atracciones', 'post /atracciones', 'get /atracciones/{}', 'put /atracciones/{}', 'patch /atracciones/{}',
      'delete /atracciones/{}', 'post /atracciones/search', 'post /atracciones/details', 'get /categorias', 'get /destinos',
      'get /provincias', 'get /idiomas', 'get /atracciones/{}/reviews'],
    stock: ['get /atracciones/{}/availability', 'get /atracciones/{}/availability/calendar', 'get /atracciones/{}/blocked-dates'],
    reservas: ['post /atracciones/{}/reservations', 'get /atracciones/reservations', 'get /atracciones/reservations/{}',
      'post /atracciones/reservations/{}/cancel', 'post /atracciones/reservations/{}/confirm', 'get /atracciones/reservations/{}/calendar-link'],
    pagos: ['get /pagos/{}'],
    facturacion: ['get /facturas/{}', 'get /facturas/{}/pdf'],
    mapas: ['get /mapas/buscar', 'get /mapas/inversa'],
  };
  for (const [s, rutas] of Object.entries(esperadas)) {
    test(`${s} expone sus ${rutas.length} rutas`, () => {
      const doc = leerYaml(`servicios/${s}/openapi.yaml`);
      const tiene = new Set(Object.entries(doc.paths).flatMap(([r, ops]) =>
        Object.keys(ops).map((m) => `${m} ${r.replace(/\{[^}]+\}/g, '{}')}`)));
      assert.deepEqual(rutas.filter((r) => !tiene.has(r)), []);
    });
  }
  test('ninguna ruta pública la reclaman dos servicios', () => {
    const duenos = new Map();
    for (const s of SERVICIOS_REST) {
      const doc = leerYaml(`servicios/${s}/openapi.yaml`);
      for (const [r, ops] of Object.entries(doc.paths)) {
        if (r.startsWith('/internal') || r.startsWith('/health')) continue;
        for (const m of Object.keys(ops)) {
          const k = `${m} ${r.replace(/\{[^}]+\}/g, '{}')}`;
          assert.ok(!duenos.has(k), `${k} en ${duenos.get(k)} y ${s}`);
          duenos.set(k, s);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. gRPC (.proto)', () => {
  for (const s of SERVICIOS_GRPC) {
    test(`${s}.proto compila, paquete versionado y enums con 0 = *_UNSPECIFIED`, async () => {
      const raiz = await protobuf.load(path.join(RAIZ, 'servicios', s, `${s}.proto`), new protobuf.Root(), { keepCase: true });
      raiz.resolveAll();
      const paquete = raiz.lookup(`descubre.${s}.v1`);
      assert.ok(paquete, `falta el paquete descubre.${s}.v1`);
      const enums = [];
      paquete.nestedArray.forEach((n) => n instanceof protobuf.Enum && enums.push(n));
      for (const e of enums) {
        const cero = Object.entries(e.values).find(([, v]) => v === 0)?.[0];
        assert.ok(cero?.endsWith('_UNSPECIFIED'), `${e.name}: el valor 0 es ${cero}`);
      }
      assert.ok(paquete.nestedArray.some((n) => n instanceof protobuf.Service), 'sin servicio');
    });
  }
  test('facturación: los x-grpc del REST existen en el .proto', async () => {
    const raiz = await protobuf.load(path.join(RAIZ, 'servicios/facturacion/facturacion.proto'), new protobuf.Root(), { keepCase: true });
    const doc = leerYaml('servicios/facturacion/openapi.yaml');
    for (const ops of Object.values(doc.paths)) for (const op of Object.values(ops)) {
      const [svc, metodo] = op['x-grpc'].split('/');
      assert.ok(raiz.lookupService(svc).methods[metodo], `${op['x-grpc']} no existe`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. GraphQL Federation 2', () => {
  test('los 6 subgrafos componen un supergrafo sin errores', () => {
    const r = composeServices(SERVICIOS_GQL.map((s) => ({
      name: s, url: `http://ms-${s}/graphql`, typeDefs: parse(leer(`servicios/${s}/subgraph.graphql`)),
    })));
    assert.deepEqual((r.errors ?? []).map((e) => e.message), []);
    const sdl = r.supergraphSdl;
    for (const t of ['type Factura', 'type LineaFactura', 'type Reserva', 'type Atraccion', 'type Usuario']) assert.ok(sdl.includes(t), t);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. Eventos (AsyncAPI)', () => {
  test('el documento es válido (sin errores del parser)', async () => {
    const { document, diagnostics } = await new Parser().parse(leer('eventos/atracciones-eventos.asyncapi.yaml'));
    assert.deepEqual(diagnostics.filter((d) => d.severity === 0).map((d) => d.message), []);
    assert.ok(document);
  });
  test('compatibilidad con Booking: los eventos públicos siguen y no pierden campos', () => {
    const publico = yaml.load(fs.readFileSync(path.join(REPO, 'backend/contracts/atracciones-asyncapi.yaml'), 'utf8'));
    for (const canal of Object.keys(publico.channels)) {
      assert.ok(asyncDoc.channels[canal], `falta el canal público ${canal}`);
      const antes = camposData(mensajeDe(publico, canal), publico);
      const ahora = camposData(mensajeDe(asyncDoc, canal), asyncDoc);
      assert.deepEqual(antes.filter((c) => !ahora.includes(c)), [], `${canal} perdió campos`);
      const sobreAntes = Object.keys(propiedades(mensajeDe(publico, canal).payload, publico));
      const sobreAhora = Object.keys(propiedades(mensajeDe(asyncDoc, canal).payload, asyncDoc));
      assert.deepEqual(sobreAntes.filter((c) => !sobreAhora.includes(c)), [], `${canal}: sobre incompleto`);
    }
  });
  test('ningún evento lleva datos personales', () => {
    const prohibidos = /^(email|correo|name|nombre|phone|telefono|document|documento|cedula|card_number)$/;
    for (const canal of canales) {
      const campos = camposData(mensajeDe(asyncDoc, canal), asyncDoc).filter((c) => prohibidos.test(c));
      // `name` de la atracción es dato del catálogo, no personal
      assert.deepEqual(campos.filter((c) => !(canal.includes('.atraccion.') && c === 'name')), [], canal);
    }
  });
  test('los eventos de pago llevan los tiempos medidos', () => {
    const tiempos = Object.keys(asyncDoc.components.schemas.TiemposPago.properties);
    for (const t of ['requested_at', 'sent_at', 'responded_at', 'duration_ms', 'total_duration_ms', 'attempts']) assert.ok(tiempos.includes(t), t);
    for (const canal of canales.filter((c) => c.includes('.pago.'))) assert.ok(camposData(mensajeDe(asyncDoc, canal), asyncDoc).includes('timing'), canal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. Factura con detalle en los 4 formatos', () => {
  // nombre canónico (proto) → nombre en cada formato
  const CAMPOS = {
    linea: ['linea', 'linea', 'line'], codigo: ['codigo', 'codigo', 'code'], descripcion: ['descripcion', 'descripcion', 'description'],
    cantidad: ['cantidad', 'cantidad', 'quantity'], precio_unitario: ['precio_unitario', 'precioUnitario', 'unit_price'],
    descuento: ['descuento', 'descuento', 'discount'], base_imponible: ['base_imponible', 'baseImponible', 'taxable_base'],
    tarifa_iva: ['tarifa_iva', 'tarifaIva', 'tax_rate'], valor_iva: ['valor_iva', 'valorIva', 'tax_amount'],
    total: ['total', 'total', 'total'], tipo_boleto: ['tipo_boleto', 'tipoBoleto', 'ticket_type'],
    referencia_orden: ['referencia_orden', 'referenciaOrden', 'order_reference'],
  };

  test('gRPC: Factura.lineas es repeated LineaFactura con los 12 campos', async () => {
    const raiz = await protobuf.load(path.join(RAIZ, 'servicios/facturacion/facturacion.proto'), new protobuf.Root(), { keepCase: true });
    const f = raiz.lookupType('descubre.facturacion.v1.Factura').fields.lineas;
    assert.ok(f.repeated);
    assert.equal(f.type, 'LineaFactura');
    assert.deepEqual(Object.keys(raiz.lookupType('descubre.facturacion.v1.LineaFactura').fields).sort(), Object.keys(CAMPOS).sort());
  });
  test('REST: Factura.lineas con minItems 1 y los mismos campos', () => {
    const s = leerYaml('servicios/facturacion/openapi.yaml').components.schemas;
    assert.equal(s.Factura.properties.lineas.minItems, 1);
    assert.deepEqual(Object.keys(s.LineaFactura.properties).sort(), Object.values(CAMPOS).map((c) => c[0]).sort());
  });
  test('GraphQL: Factura.lineas: [LineaFactura!]! con los mismos campos', () => {
    const sdl = leer('servicios/facturacion/subgraph.graphql');
    assert.match(sdl, /lineas: \[LineaFactura!\]!/);
    const bloque = sdl.match(/type LineaFactura \{([^}]+)\}/)[1];
    const campos = [...bloque.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    assert.deepEqual(campos.sort(), Object.values(CAMPOS).map((c) => c[1]).sort());
  });
  test('Evento factura.emitida y .anulada: lines (minItems 1) con los mismos campos', () => {
    const s = asyncDoc.components.schemas;
    for (const canal of ['atracciones.factura.emitida', 'atracciones.factura.anulada']) assert.ok(camposData(mensajeDe(asyncDoc, canal), asyncDoc).includes('lines'), canal);
    const lines = propiedades(propiedades(s.EventoFactura, asyncDoc).data, asyncDoc).lines;
    assert.equal(lines.minItems, 1);
    assert.deepEqual(Object.keys(s.LineaFactura.properties).sort(), Object.values(CAMPOS).map((c) => c[2]).sort());
  });
  test('el ejemplo de factura.emitida valida contra su esquema y las sumas cuadran', () => {
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    ajv.addSchema({ $id: 'asyncapi', components: asyncDoc.components });
    const fix = (o) => JSON.parse(JSON.stringify(o).replaceAll('"#/components', '"asyncapi#/components'));
    const msg = asyncDoc.components.messages.FacturaEmitida;
    const validar = ajv.compile(fix(msg.payload));
    const ej = msg.examples[0].payload;
    assert.ok(validar(ej), JSON.stringify(validar.errors));
    const suma = (k) => ej.data.lines.reduce((a, l) => a + Math.round(Number(l[k]) * 100), 0);
    const c = (v) => Math.round(Number(v) * 100);
    assert.equal(suma('taxable_base'), c(ej.data.subtotal), 'subtotal ≠ Σ base imponible');
    assert.equal(suma('tax_amount'), c(ej.data.tax), 'IVA ≠ Σ valor IVA');
    assert.equal(suma('total'), c(ej.data.total), 'total ≠ Σ total de líneas');
    for (const l of ej.data.lines) {
      assert.equal(c(l.taxable_base), Number(l.quantity) * c(l.unit_price) - c(l.discount), `línea ${l.line}: base`);
      assert.equal(c(l.total), c(l.taxable_base) + c(l.tax_amount), `línea ${l.line}: total`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('7. Catálogo de servicios (gobernanza)', () => {
  test('los 8 servicios están y cada contrato declarado existe', () => {
    assert.equal(servicios.length, 8);
    for (const s of servicios) for (const [tipo, ruta] of Object.entries(s.contratos)) {
      if (typeof ruta !== 'string') continue;
      assert.ok(fs.existsSync(path.join(RAIZ, ruta)), `${s.servicio}.${tipo}: no existe ${ruta}`);
    }
  });
  test('cada evento del catálogo existe en el AsyncAPI y viceversa', () => {
    const delCatalogo = new Set(servicios.flatMap((s) => [...s.contratos.eventos_publica, ...s.contratos.eventos_consume]));
    assert.deepEqual([...delCatalogo].filter((e) => !canales.includes(e)), [], 'eventos sin canal');
    const publicados = servicios.flatMap((s) => s.contratos.eventos_publica);
    assert.deepEqual(canales.filter((c) => !publicados.includes(c)), [], 'canales sin productor');
  });
  test('cada evento tiene un solo productor', () => {
    const vistos = {};
    for (const s of servicios) for (const e of s.contratos.eventos_publica) {
      assert.ok(!vistos[e], `${e}: ${vistos[e]} y ${s.servicio}`);
      vistos[e] = s.servicio;
    }
  });
  test('todo evento consumido tiene productor', () => {
    const publicados = new Set(servicios.flatMap((s) => s.contratos.eventos_publica));
    for (const s of servicios) for (const e of s.contratos.eventos_consume) assert.ok(publicados.has(e), `${s.servicio} consume ${e} y nadie lo publica`);
  });
  test('el campo `producer` del sobre coincide con los servicios del catálogo', () => {
    const productores = asyncDoc.components.schemas.Sobre.properties.producer.enum;
    const conEventos = servicios.filter((s) => s.contratos.eventos_publica.length).map((s) => s.servicio);
    assert.deepEqual(conEventos.filter((s) => !productores.includes(s)), []);
  });
  test('depende_de solo nombra servicios del catálogo o sistemas externos declarados', () => {
    const nombres = new Set(servicios.map((s) => s.servicio));
    const externos = new Set(['sistema-pagos-externo', 'google-maps', 'openstreetmap']);
    for (const s of servicios) for (const d of s.depende_de) assert.ok(nombres.has(d) || externos.has(d), `${s.servicio} → ${d}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('8. Modelo canónico del turno (CONTRATO-SCHEMA-FIRST)', () => {
  const CANONICOS = ['slot_id', 'date', 'time_24h', 'timezone', 'total_units', 'available_units', 'revision'];
  test('Stock REST, Stock gRPC y el evento stock.actualizado usan los mismos campos', async () => {
    const rest = Object.keys(leerYaml('servicios/stock/openapi.yaml').components.schemas.Turno.properties);
    const raiz = await protobuf.load(path.join(RAIZ, 'servicios/stock/stock.proto'), new protobuf.Root(), { keepCase: true });
    const grpc = Object.keys(raiz.lookupType('descubre.stock.v1.Turno').fields);
    const evento = Object.keys(asyncDoc.components.schemas.DatosTurno.properties);
    for (const [nombre, campos] of [['REST', rest], ['gRPC', grpc], ['evento', evento]]) {
      assert.deepEqual(CANONICOS.filter((c) => !campos.includes(c)), [], nombre);
    }
  });
});
