import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { crearApp } from '../src/comun/arranque';
import { baseVacia, Contrato, describeDb, sql } from './helpers';

const CONTRATO = join(__dirname, '..', 'contract');
const SECRETO = 'secreto-de-pruebas-de-ms-catalog-0123456789';
const TOKEN_SERVICIOS = 'token-servicios-pruebas-123';

/** JWT HS256 como los que emite Identity (la tienda hoy). */
function jwt(claims: Record<string, unknown>) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ exp: Math.floor(Date.now() / 1000) + 600, ...claims })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

/** Servidor HTTP falso (ms_location o la tienda) que responde según la ruta. */
async function falso(responder: (url: URL) => [number, unknown]) {
  const s: Server = createServer((req, res) => {
    const [status, cuerpo] = responder(new URL(req.url ?? '/', 'http://x'));
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((ok) => s.close(() => ok())) };
}

const CIUDADES = [
  { ciu_id: 3, ciu_nombre: 'Quito', prov_nombre: 'Pichincha' },
  { ciu_id: 9, ciu_nombre: 'Baños', prov_nombre: 'Tungurahua' },
];

describeDb('ms_catalog', () => {
  let app: NestExpressApplication;
  let location: Awaited<ReturnType<typeof falso>>;
  let tienda: Awaited<ReturnType<typeof falso>>;
  let locationCaida = false;
  const propio = new Contrato(join(CONTRATO, 'openapi.yaml'), 'contrato', [join(CONTRATO, 'booking-atracciones-v3.yaml')]);
  const booking = new Contrato(join(CONTRATO, 'booking-atracciones-v3.yaml'), 'booking');
  const http = () => request(app.getHttpServer());
  let quito: { atr_id: number; atr_uuid: string; atr_slug: string };

  beforeAll(async () => {
    location = await falso((u) => {
      if (locationCaida) return [500, {}];
      const m = /^\/api\/v1\/ciudades\/(\d+)$/.exec(u.pathname);
      if (m) {
        const c = CIUDADES.find((x) => x.ciu_id === Number(m[1]));
        return c ? [200, c] : [404, {}];
      }
      const q = (u.searchParams.get('q') ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const ids = u.searchParams.get('ids')?.split(',').map(Number);
      return [200, CIUDADES.filter((c) => (!ids || ids.includes(c.ciu_id)) && c.ciu_nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q))];
    });
    tienda = await falso((u) => {
      if (u.pathname.endsWith('/promociones/contrato')) return [200, { permite_promociones: true, porcentaje_descuento_maximo: 10 }];
      // Solo el 2030-01-15 tiene cupos (para la búsqueda por fechas)
      const fecha = u.searchParams.get('date');
      return [200, { time_slots: [{ cupos_disponibles: fecha === '2030-01-15' ? 8 : 0 }] }];
    });
    Object.assign(process.env, {
      LOCATION_URL: location.url, TIENDA_URL: tienda.url, JWT_SECRET: SECRETO, SERVICIOS_TOKEN: TOKEN_SERVICIOS,
      BOOKING_API_KEY: 'clave-de-booking-para-pruebas-1234', FOTOS_BASE_URL: 'http://fotos.local',
    });
    await baseVacia();
    app = await crearApp(AppModule, 'ms-catalog');
    await app.init();

    // Datos: un operador, banderas en las categorías del script, dos atracciones (una publicada en Quito, otra en borrador)
    await sql(`INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, prov_id) VALUES (101, 'Andes Tours', '1792348123001', 'ops@andes.ec', '0991234567', 19)`);
    await sql(`UPDATE categoria SET cat_incluye_guia = TRUE, cat_incluye_transporte = TRUE WHERE cat_slug = 'aventura'`);
    await sql(`INSERT INTO categoria (cat_padre_id, cat_nombre, cat_slug, cat_orden, cat_incluye_comida) SELECT cat_id, 'Volcanes', 'volcanes', 1, TRUE FROM categoria WHERE cat_slug = 'aventura'`);
    await sql(`INSERT INTO inclusion (inc_tipo, inc_nombre) VALUES ('INCLUYE', 'Guía bilingüe'), ('NO_INCLUYE', 'Propinas')`);
    const [a] = await sql(
      `INSERT INTO atraccion (atr_nombre, atr_slug, atr_descripcion, atr_tipo, atr_estado, atr_latitud, atr_longitud, atr_punto_encuentro,
                              atr_duracion_horas, ciu_id, ope_id, atr_cancelacion_gratuita, atr_incluye_guia, atr_incluye_transporte,
                              atr_accesible_silla, atr_descuento_paquete, atr_calificacion_promedio, atr_numero_resenas)
       VALUES ('Quito City Tour', 'quito-city-tour', 'Recorrido por el Centro Histórico de Quito con guía.', 'GUIDED_TOUR', 'PUBLICADA',
               -0.2201, -78.5123, 'Plaza Grande', 4, 3, (SELECT ope_id FROM operador), TRUE, TRUE, TRUE, TRUE, 20, 4.5, 12)
       RETURNING atr_id::int, atr_uuid::text, atr_slug`,
    );
    quito = a as typeof quito;
    await sql(`INSERT INTO atraccion (atr_nombre, atr_slug, atr_descripcion, atr_tipo, atr_latitud, atr_longitud, atr_duracion_horas, ciu_id, ope_id)
               VALUES ('Baños Borrador', 'banos-borrador', 'Todavía en borrador, no se ofrece a Booking.', 'DAY_TRIP', -1.39, -78.42, 8, 9, (SELECT ope_id FROM operador))`);
    await sql(`INSERT INTO atraccion_categoria (atr_id, cat_id) SELECT $1, cat_id FROM categoria WHERE cat_slug = 'volcanes'`, [quito.atr_id]);
    await sql(`INSERT INTO atraccion_idioma (atr_id, idi_id) SELECT $1, idi_id FROM idioma WHERE idi_codigo IN ('es', 'en')`, [quito.atr_id]);
    await sql(`INSERT INTO atraccion_inclusion (atr_id, inc_id) SELECT $1, inc_id FROM inclusion`, [quito.atr_id]);
    await sql(`INSERT INTO atraccion_foto (atr_id, fot_url, fot_alt) VALUES ($1, '/uploads/quito.jpg', 'Plaza Grande de Quito')`, [quito.atr_id]);
    await sql(`INSERT INTO atraccion_itinerario (atr_id, iti_orden, iti_hora, iti_titulo, iti_duracion_min) VALUES ($1, 1, '09:00', 'Salida', 30)`, [quito.atr_id]);
    await sql(`INSERT INTO tarifa_vigente (atr_id, tav_tipo, tav_precio) VALUES ($1, 'ADULTO', 30), ($1, 'NINO', 15), ($1, 'MAYOR', 18)`, [quito.atr_id]);
  });

  afterAll(async () => {
    await app?.close();
    await location?.cerrar();
    await tienda?.cerrar();
  });

  describe('contrato con Booking (v2 y v3)', () => {
    it('la validación de esquemas detecta respuestas que no cumplen el contrato', () => {
      expect(booking.esquema('AtraccionCardResponseV2', { id: 'x' })).not.toEqual([]);
      expect(booking.esquema('TarifaBaseDesglosada', { currency: 'USD', adult: '30' })).not.toEqual([]);
      expect(propio.esquema('Atraccion', { atr_id: 1 })).not.toEqual([]);
    });

    it('árbol y categorías planas cumplen los esquemas oficiales del contrato v3', async () => {
      const arbol = await http().get('/api/v3/atracciones/categorias/arbol');
      expect(arbol.status).toBe(200);
      expect(propio.respuesta('GET', '/v3/atracciones/categorias/arbol', 200, arbol.body)).toEqual([]);
      const aventura = arbol.body.find((c: { slug: string }) => c.slug === 'aventura');
      expect(aventura).toMatchObject({ incluye_guia: true, incluye_transporte: true, subcategorias: [{ slug: 'volcanes', incluye_comida: true }] });
      const hijas = await http().get(`/api/v2/atracciones/categorias?padre_id=${aventura.id}`);
      expect(propio.respuesta('GET', '/v3/atracciones/categorias', 200, hijas.body)).toEqual([]);
      expect(hijas.body.map((c: { slug: string }) => c.slug)).toEqual(['volcanes']);
    });

    it('listado: city por nombre (sin tildes) resuelto en ms_location; solo publicadas; cumple SearchAtraccionesResponseV2', async () => {
      const r = await http().get('/api/v3/atracciones?city=QUITO');
      expect(r.status).toBe(200);
      expect(booking.esquema('SearchAtraccionesResponseV2', r.body)).toEqual([]);
      expect(r.body.metadata.total_results).toBe(1);
      expect(r.body.data[0]).toMatchObject({
        id: quito.atr_uuid, city: 'Quito', price: { currency: 'USD', adult: 30, child: 15, senior: 18, infant: 0, student: 30 },
        rating: { score: 9, review_count: 12 }, inclusions: { includes_guide: true, incluye_guia: true, includes_food: false },
        photos: ['http://fotos.local/uploads/quito.jpg'],
      });
      expect((await http().get('/api/v3/atracciones?city=Ba%C3%B1os')).body.metadata.total_results).toBe(0); // la de Baños está en borrador
      const todas = await http().get('/api/v2/atracciones?sort=PRICE_DESC&limit=5');
      expect(todas.body.data).toHaveLength(1);
    });

    it('ficha por UUID o slug cumple AtraccionDetailResponseV2 (itinerario, pilares, accesibilidad, proveedor)', async () => {
      const r = await http().get(`/api/v3/atracciones/${quito.atr_uuid}`);
      expect(r.status).toBe(200);
      expect(propio.respuesta('GET', '/v3/atracciones/{id}', 200, r.body)).toEqual([]);
      expect(r.body).toMatchObject({
        city: 'Quito', guide_languages: ['Inglés', 'Español'], inclusions_list: ['Guía bilingüe'], exclusions_list: ['Propinas'],
        itinerary: [{ stop_number: 1, time: '9:00 a.m.', title: 'Salida', duration_minutes: 30 }],
        accessibility: { wheelchair_accessible: true }, proveedor: { id: 'proveedor-101', nombre_comercial: 'Andes Tours', telefono_emergencia: '+593991234567' },
        // El descuento del paquete (20 %) nunca supera el máximo del acuerdo B2B (10 %)
        permite_paquete: true, porcentaje_descuento_paquete: 10,
        meeting_point_geo: { address: 'Plaza Grande', latitude: -0.2201 },
      });
      expect((await http().get(`/api/v2/atracciones/${quito.atr_slug}`)).body.id).toBe(quito.atr_uuid);
      const borrador = await http().get('/api/v3/atracciones/banos-borrador');
      expect(borrador.status).toBe(404);
      expect(propio.respuesta('GET', '/v3/atracciones/{id}', 404, borrador.body)).toEqual([]);
    });

    it('búsqueda: texto, precio, idioma, inclusiones y fechas (cupos consultados a la tienda)', async () => {
      const buscar = (b: object) => http().post('/api/v3/atracciones/search').send(b);
      const t = await buscar({ query: 'centro historico', idioma_guia: 'Inglés', precio_max: 40, incluye_guia: true });
      expect(t.status).toBe(200);
      expect(propio.respuesta('POST', '/v3/atracciones/search', 200, t.body)).toEqual([]);
      expect(t.body.data).toHaveLength(1);
      expect((await buscar({ precio_min: 31 })).body.data).toHaveLength(0);
      expect((await buscar({ categoria_id: 'aventura' })).body.data).toHaveLength(1); // por su subcategoría «volcanes»
      expect((await buscar({ fecha_inicio: '2030-01-14', fecha_fin: '2030-01-16', adult_count: 2 })).body.data).toHaveLength(1);
      expect((await buscar({ fecha_inicio: '2030-02-01', fecha_fin: '2030-02-03' })).body.data).toHaveLength(0);
      const mal = await buscar({ precio_min: 50, precio_max: 10 });
      expect(mal.status).toBe(400);
      expect((await buscar({ desconocido: 1 })).status).toBe(400);
    });

    it('si ms_location no responde, filtrar por ciudad da 503 (RFC 7807) y el resto sigue funcionando', async () => {
      locationCaida = true;
      try {
        const r = await http().get('/api/v3/atracciones?city=Cuenca');
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('DEPENDENCY_UNAVAILABLE');
        expect((await http().get(`/api/v3/atracciones/${quito.atr_uuid}`)).status).toBe(200); // ciudad en caché
      } finally {
        locationCaida = false;
      }
    });
  });

  describe('API propia', () => {
    it('catálogos y atracciones con los nombres de columna (cumplen contract/openapi.yaml)', async () => {
      for (const [ruta, contrato] of [['/categorias', '/v1/categorias'], ['/idiomas', '/v1/idiomas'], ['/inclusiones', '/v1/inclusiones'], ['/operadores', '/v1/operadores'], ['/categorias/arbol', '/v1/categorias/arbol']]) {
        const r = await http().get(`/api/v1${ruta}`);
        expect(r.status).toBe(200);
        expect(propio.respuesta('GET', contrato, 200, r.body)).toEqual([]);
      }
      const l = await http().get('/api/v1/atracciones?atr_estado=BORRADOR');
      expect(propio.respuesta('GET', '/v1/atracciones', 200, l.body)).toEqual([]);
      expect(l.body.data.map((a: { atr_slug: string }) => a.atr_slug)).toEqual(['banos-borrador']);
      const una = await http().get(`/api/v1/atracciones/${quito.atr_id}`);
      expect(propio.respuesta('GET', '/v1/atracciones/{ref}', 200, una.body)).toEqual([]);
      expect(una.body).toMatchObject({ atr_slug: 'quito-city-tour', operador: { ope_codigo: 101 }, tarifas: [{ tav_tipo: 'ADULTO', tav_precio: 30 }, expect.anything(), expect.anything()] });
    });

    it('crear, publicar y eliminar: 401 sin token, 403 sin rol, 422 con ciudad inexistente; el OPERADOR solo en su empresa', async () => {
      const nueva = {
        atr_nombre: 'Tour del Chocolate', atr_descripcion: 'Degustación de cacao fino de aroma en Quito con guía.', atr_tipo: 'GUIDED_TOUR',
        atr_latitud: -0.18, atr_longitud: -78.48, atr_duracion_horas: 2.5, ciu_id: 3, atr_incluye_comida: true,
        cat_ids: [1], idi_ids: [1], fotos: [{ fot_url: 'https://img.ec/cacao.jpg', fot_alt: 'Cacao ecuatoriano' }],
        itinerario: [{ iti_orden: 1, iti_hora: '10:00', iti_titulo: 'Cata', iti_duracion_min: 60 }],
      };
      expect((await http().post('/api/v1/atracciones').send(nueva)).status).toBe(401);
      const cliente = jwt({ sub: '9', rol: 'CLIENTE' });
      expect((await http().post('/api/v1/atracciones').set('Authorization', `Bearer ${cliente}`).send(nueva)).status).toBe(403);
      const operador = jwt({ sub: '7', rol: 'OPERADOR', operador: 101 });
      const otraCiudad = await http().post('/api/v1/atracciones').set('Authorization', `Bearer ${operador}`).send({ ...nueva, ciu_id: 77 });
      expect(otraCiudad.status).toBe(422);
      const faltan = await http().post('/api/v1/atracciones').set('Authorization', `Bearer ${operador}`).send({ atr_nombre: 'Solo nombre' });
      expect(faltan.status).toBe(400);
      expect(faltan.body.invalid_params.map((p: { name: string }) => p.name)).toContain('ciu_id');

      const c = await http().post('/api/v1/atracciones').set('Authorization', `Bearer ${operador}`).send(nueva);
      expect(c.status).toBe(201);
      expect(propio.respuesta('POST', '/v1/atracciones', 201, c.body)).toEqual([]);
      expect(c.body).toMatchObject({ atr_slug: 'tour-del-chocolate', atr_estado: 'BORRADOR', operador: { ope_codigo: 101 }, itinerario: [{ iti_hora: '10:00' }] });

      const otro = jwt({ sub: '8', rol: 'OPERADOR', operador: 999 });
      expect((await http().patch(`/api/v1/atracciones/${c.body.atr_id}`).set('Authorization', `Bearer ${otro}`).send({ atr_estado: 'PUBLICADA' })).status).toBe(403);
      const pub = await http().patch(`/api/v1/atracciones/${c.body.atr_id}`).set('Authorization', `Bearer ${operador}`).send({ atr_estado: 'PUBLICADA' });
      expect(pub.status).toBe(200);
      expect((await http().get('/api/v3/atracciones/tour-del-chocolate')).status).toBe(200);

      const admin = jwt({ sub: '1', rol: 'ADMIN' });
      expect((await http().delete(`/api/v1/atracciones/${c.body.atr_id}`).set('Authorization', `Bearer ${admin}`)).status).toBe(204);
      expect((await http().get('/api/v3/atracciones/tour-del-chocolate')).status).toBe(404);
    });
  });

  describe('eventos de otros servicios', () => {
    // Mismo sobre CloudEvents que envía ms_review (specversion incluido)
    const evento = (event_type: string, data: object, id = randomUUID()) =>
      http().post('/api/v1/internal/eventos').set('X-Servicio-Token', TOKEN_SERVICIOS)
        .send({ specversion: '1.0', event_id: id, event_type, source: '/api/v1/ms-review', correlation_id: 'cid-evt', timestamp: new Date().toISOString(), data });

    it('RESENA_PUBLICADA actualiza calificación y pilares; repetido no se aplica dos veces; sin token 401', async () => {
      expect((await http().post('/api/v1/internal/eventos').send({ event_id: randomUUID(), event_type: 'RESENA_PUBLICADA', data: {} })).status).toBe(401);
      const id = randomUUID();
      const r = await evento('RESENA_PUBLICADA', { atr_id: quito.atr_id, atr_calificacion_promedio: 4.8, atr_numero_resenas: 13, pilares: { limpieza: 5, servicio: 4.5, relacion_valor: 4, puntualidad: 5 } }, id);
      expect(r.status).toBe(200);
      expect(propio.respuesta('POST', '/v1/internal/eventos', 200, r.body)).toEqual([]);
      expect(r.body.procesado).toBe(true);
      expect((await evento('RESENA_PUBLICADA', { atr_id: quito.atr_id, atr_calificacion_promedio: 1, atr_numero_resenas: 99 }, id)).body.procesado).toBe(false);
      const d = await http().get(`/api/v3/atracciones/${quito.atr_uuid}`);
      expect(d.body.rating).toMatchObject({ score: 9.6, review_count: 13, breakdown: { limpieza: 10, servicio: 9, calidad_precio: 8, puntualidad: 10 } });
      expect((await evento('RESENA_PUBLICADA', { atr_id: 99999 })).status).toBe(422);
    });

    it('PRECIO_ACTUALIZADO actualiza el precio que ve Booking', async () => {
      await evento('PRECIO_ACTUALIZADO', { atr_id: quito.atr_id, tarifas: [{ tipo: 'ADULTO', precio: 35 }, { tipo: 'ESTUDIANTE', precio: 26.25 }] });
      const d = await http().get(`/api/v3/atracciones/${quito.atr_uuid}`);
      expect(d.body.price).toMatchObject({ adult: 35, child: 15, student: 26.25 });
    });
  });

  it('salud', async () => {
    const r = await http().get('/api/v1/health');
    expect(propio.respuesta('GET', '/v1/health', 200, r.body)).toEqual([]);
  });
});
