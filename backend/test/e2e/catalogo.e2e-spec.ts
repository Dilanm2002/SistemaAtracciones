import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { bearer, createTestApp, db, describeDb, fechaEc, http, idem, login, nuevaAtraccion, reserva, USERS } from './helpers';

/** Catálogo público, administración de atracciones, reseñas, favoritos, contacto, reportes e integración. */
describeDb('Catálogo, reseñas, favoritos, contacto e integración (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let operador: string;
  let cliente: string;
  let ana: string;
  let cityId: number;

  const crearAtraccion = async (extra: Record<string, unknown> = {}) => {
    const res = await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(cityId, extra));
    expect(res.status).toBe(201);
    return res.body;
  };

  beforeAll(async () => {
    app = await createTestApp();
    [admin, operador, cliente, ana] = await Promise.all([login(app, USERS.admin), login(app, USERS.operador), login(app, USERS.cliente), login(app, USERS.ana)]);
    cityId = (await http(app).get('/destinos')).body[0].id;
  });
  afterAll(() => app?.close());

  describe('catálogo público', () => {
    it('GET /atracciones: paginado con enlaces HATEOAS y solo publicadas', async () => {
      const r = await http(app).get('/atracciones?limit=3&page=2');
      expect(r.status).toBe(200);
      expect(r.body.meta).toMatchObject({ itemsPerPage: 3, currentPage: 2, itemCount: r.body.data.length });
      expect(r.body._links.previous).toContain('page=1');
      expect(r.body.data.every((a: { is_active: boolean }) => a.is_active)).toBe(true);
      expect(r.headers['x-api-deprecation-date']).toBe('2027-12-31');
    });

    it('limit fuera de rango o page 0 → 400', async () => {
      expect((await http(app).get('/atracciones?limit=0')).status).toBe(400);
      expect((await http(app).get('/atracciones?page=0')).status).toBe(400);
    });

    it('una atracción inactiva no es visible al público, sí al admin', async () => {
      const a = await crearAtraccion({ is_active: false });
      expect((await http(app).get(`/atracciones/${a.id}`)).status).toBe(404);
      expect((await http(app).get(`/atracciones/${a.id}`).set(bearer(cliente))).status).toBe(404);
      const ad = await http(app).get(`/atracciones/${a.id}`).set(bearer(admin));
      expect(ad.status).toBe(200);
      expect(ad.body.status).toBe('INACTIVA');
      // Un cliente no puede forzar status=inactive en el listado
      const lista = await http(app).get('/atracciones?status=inactive&limit=100').set(bearer(cliente));
      expect(lista.body.data.map((x: { id: string }) => x.id)).not.toContain(a.id);
    });

    it('POST /atracciones/search: filtros, orden y paginación por token', async () => {
      const p1 = await http(app).post('/atracciones/search').send({ rows: 2, sort: { by: 'price_asc' } });
      expect(p1.status).toBe(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.data[0].price.total).toBeLessThanOrEqual(p1.body.data[1].price.total);
      expect(p1.body.metadata.next_page).toBeTruthy();
      const p2 = await http(app).post('/atracciones/search').send({ rows: 2, sort: { by: 'price_asc' }, next_page: p1.body.metadata.next_page });
      expect(p2.body.data.map((a: { id: string }) => a.id)).not.toContain(p1.body.data[0].id);

      const galapagos = await http(app).post('/atracciones/search').send({ filters: { regions: ['GALAPAGOS'] } });
      expect(galapagos.body.data.length).toBeGreaterThan(0);
      expect(galapagos.body.data.every((a: { destination: { region: string } }) => a.destination.region === 'GALAPAGOS')).toBe(true);

      const precio = await http(app).post('/atracciones/search').send({ filters: { price: { min: 10, max: 50 } }, rows: 50 });
      expect(precio.body.data.every((a: { price: { total: number } }) => a.price.total >= 10 && a.price.total <= 50)).toBe(true);
    });

    it('search: errores de entrada → 400; país distinto de ec → vacío', async () => {
      expect((await http(app).post('/atracciones/search').send({ filters: { price: { min: 50, max: 10 } } })).status).toBe(400);
      expect((await http(app).post('/atracciones/search').send({ next_page: 'no-es-token' })).status).toBe(400);
      expect((await http(app).post('/atracciones/search').send({ dates: { start_date: '2030-01-10', end_date: '2030-01-01' } })).status).toBe(400);
      const pe = await http(app).post('/atracciones/search').send({ countries: ['pe'] });
      expect(pe.body).toMatchObject({ data: [], metadata: { total_results: 0 } });
    });

    it('search: "%" y "_" se buscan literales (no como comodines de LIKE)', async () => {
      const r = await http(app).post('/atracciones/search').send({ filters: { query: '%' } });
      expect(r.status).toBe(200);
      expect(r.body.metadata.total_results).toBe(0);
    });

    it('search con dates: excluye solo las que no operan NINGÚN día del rango (también en rangos largos)', async () => {
      const a = await crearAtraccion();
      const buscar = (inicio: number, fin: number) =>
        http(app).post('/atracciones/search').send({ filters: { query: a.name }, dates: { start_date: fechaEc(inicio), end_date: fechaEc(fin) } });
      // 70 días bloqueados seguidos (del 10 al 79) dentro de un rango de 90 días: opera los otros 20
      await db(app).query(
        `INSERT INTO fecha_bloqueada (atr_id, fb_fecha, fb_motivo)
         SELECT a.atr_id, (now() AT TIME ZONE 'America/Guayaquil')::date + g, 'Temporada cerrada' FROM atraccion a, generate_series(10, 79) g WHERE a.atr_uuid = $1`,
        [a.id],
      );
      expect((await buscar(1, 90)).body.data.map((x: { id: string }) => x.id)).toEqual([a.id]);
      expect((await buscar(10, 79)).body.data).toHaveLength(0); // todo el rango bloqueado
      expect((await buscar(9, 12)).body.data).toHaveLength(1);
    });

    it('POST /atracciones/details: devuelve las encontradas y lista las que no', async () => {
      const a = await crearAtraccion();
      const falta = randomUUID();
      const r = await http(app).post('/atracciones/details').send({ attractions: [a.id, falta, a.id] });
      expect(r.status).toBe(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.metadata.not_found).toEqual([falta]);
    });

    it('destinos, provincias, idiomas y categorías públicos', async () => {
      for (const url of ['/destinos', '/provincias', '/idiomas', '/categorias', '/operadores']) {
        const r = await http(app).get(url);
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body)).toBe(true);
      }
    });
  });

  describe('administración de atracciones', () => {
    it('crea (201 + Location), actualiza precio con tarifa versionada y elimina (borrado lógico)', async () => {
      const r = await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(cityId));
      expect(r.status).toBe(201);
      expect(r.headers.location).toBe(`/api/v1/atracciones/${r.body.id}`);
      expect(r.body).toMatchObject({ price: { total: 40 }, child_price: { total: 25 }, times: ['10:00'], capacity_per_slot: 5, duration: 'PT2H' });

      const p = await http(app).patch(`/atracciones/${r.body.id}`).set(bearer(admin)).send({ price: { currency: 'USD', total: 55 } });
      expect(p.status).toBe(200);
      expect(p.body.price.total).toBe(55);

      expect((await http(app).delete(`/atracciones/${r.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).get(`/atracciones/${r.body.id}`).set(bearer(admin))).status).toBe(404);
      const [{ eliminado }] = await db(app).query('SELECT atr_eliminado_en IS NOT NULL AS eliminado FROM atraccion WHERE atr_uuid = $1', [r.body.id]);
      expect(eliminado).toBe(true);
    });

    it('el nombre repetido genera un slug único', async () => {
      const a = await crearAtraccion();
      const b = await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(cityId, { name: a.name }));
      expect(b.status).toBe(201);
      expect(b.body.slug).not.toBe(a.slug);
      expect(b.body.slug.startsWith(a.slug)).toBe(true);
    });

    it.each([
      ['precio de niño mayor que el de adulto', { child_price: 100 }],
      ['categoría inexistente', { categories: ['no-existe'] }],
      ['idioma no registrado', { supported_languages: ['zz'] }],
      ['operador inexistente', { operator: { id: 99999, name: 'X' } }],
      ['ciudad inexistente', { locations: [{ address: 'Plaza Grande, Quito', city: 999999, country: 'ec', coordinates: { latitude: -0.2, longitude: -78.5 } }] }],
      ['coordenadas fuera del Ecuador', { locations: [{ address: 'Plaza Mayor, Lima', city: 1, country: 'ec', coordinates: { latitude: -12, longitude: -77 } }] }],
      ['duración inválida', { duration: 'dos horas' }],
      ['precio negativo', { price: { currency: 'USD', total: -5 } }],
      ['moneda en minúsculas', { price: { currency: 'usd', total: 5 } }],
      ['foto con javascript:', { photos: [{ url: 'javascript:alert(1)' }] }],
      ['nombre ilegible', { name: '12345678' }],
      ['horario mal formado', { times: ['25:00'] }],
    ])('rechaza %s (400)', async (_c, extra) => {
      const r = await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(cityId, extra));
      expect(r.status).toBe(400);
    });

    it('el OPERADOR sube experiencias de SU empresa: quedan EN_REVISION y no se ven hasta aprobarlas', async () => {
      // Aunque diga otra empresa, no puede: solo la suya; tampoco puede destacar
      expect((await http(app).post('/atracciones').set(bearer(operador)).send(nuevaAtraccion(cityId, { operator: { id: 102, name: 'x' } }))).status).toBe(403);
      expect((await http(app).post('/atracciones').set(bearer(operador)).send(nuevaAtraccion(cityId, { featured: true }))).status).toBe(403);
      const r = await http(app).post('/atracciones').set(bearer(operador)).send(nuevaAtraccion(cityId));
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'EN_REVISION', is_active: false, operator: { id: 101 } });
      // El público no la ve; el operador sí (es suya); el admin la lista en "review"
      expect((await http(app).get(`/atracciones/${r.body.id}`)).status).toBe(404);
      expect((await http(app).get(`/atracciones/${r.body.id}`).set(bearer(operador))).status).toBe(200);
      const enRevision = await http(app).get('/atracciones?status=review&limit=100').set(bearer(admin));
      expect(enRevision.body.data.some((a: { id: string }) => a.id === r.body.id)).toBe(true);
      // El operador no puede aprobarse a sí mismo
      expect((await http(app).post(`/atracciones/${r.body.id}/review`).set(bearer(operador)).send({ decision: 'APPROVE' })).status).toBe(403);
      const ok = await http(app).post(`/atracciones/${r.body.id}/review`).set(bearer(admin)).send({ decision: 'APPROVE' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: 'PUBLICADA', is_active: true });
      expect((await http(app).get(`/atracciones/${r.body.id}`)).status).toBe(200);
      expect((await http(app).post(`/atracciones/${r.body.id}/review`).set(bearer(admin)).send({ decision: 'APPROVE' })).status).toBe(409);
      // Ya aprobada: el operador la pausa y la reactiva sin nueva revisión
      expect((await http(app).patch(`/atracciones/${r.body.id}`).set(bearer(operador)).send({ is_active: false })).body.status).toBe('INACTIVA');
      expect((await http(app).patch(`/atracciones/${r.body.id}`).set(bearer(operador)).send({ is_active: true })).body.status).toBe('PUBLICADA');
    });

    it('rechazo con motivo: la empresa lo ve, corrige y la experiencia vuelve a revisión', async () => {
      const r = await http(app).post('/atracciones').set(bearer(operador)).send(nuevaAtraccion(cityId));
      expect((await http(app).post(`/atracciones/${r.body.id}/review`).set(bearer(admin)).send({ decision: 'REJECT' })).status).toBe(400);
      const no = await http(app).post(`/atracciones/${r.body.id}/review`).set(bearer(admin)).send({ decision: 'REJECT', reason: 'Las fotos no corresponden al tour; sube fotos propias.' });
      expect(no.body).toMatchObject({ status: 'RECHAZADA', rejection_reason: 'Las fotos no corresponden al tour; sube fotos propias.' });
      // Mientras no esté aprobada, el operador no puede publicarla por su cuenta
      const corregida = await http(app).patch(`/atracciones/${r.body.id}`).set(bearer(operador)).send({ is_active: true, short_description: 'Recorrido corregido con fotos propias' });
      expect(corregida.body.status).toBe('EN_REVISION');
      expect(corregida.body.rejection_reason).toBeUndefined();
    });

    it('el OPERADOR no ve ni toca experiencias de otras empresas, ni administra catálogos', async () => {
      const ajena = await crearAtraccion({ operator: { id: 102, name: 'Galápagos Blue Tours' } });
      expect((await http(app).patch(`/atracciones/${ajena.id}`).set(bearer(operador)).send({ short_description: 'Intento de cambio ajeno' })).status).toBe(404);
      expect((await http(app).delete(`/atracciones/${ajena.id}`).set(bearer(operador))).status).toBe(404);
      const mias = await http(app).get('/atracciones?status=all&limit=100').set(bearer(operador));
      expect(mias.body.data.every((a: { operator: { id: number } }) => a.operator.id === 101)).toBe(true);
      expect((await http(app).post('/operadores').set(bearer(operador)).send({ nombre: 'Empresa Pirata', provincia_id: 1 })).status).toBe(403);
      expect((await http(app).post('/destinos').set(bearer(operador)).send({ nombre: 'Lugar', provincia_id: 1, codigo_inec: '170199' })).status).toBe(403);
    });

    it('lo que crea el administrador se publica directamente', async () => {
      const a = await crearAtraccion();
      expect(a.status).toBe('PUBLICADA');
    });

    it('fechas bloqueadas: el operador gestiona solo las de su empresa', async () => {
      const propia = await crearAtraccion();
      const ajena = await crearAtraccion({ operator: { id: 102, name: 'Galápagos Blue Tours' } });
      const fecha = fechaEc(90);
      const b = await http(app).post(`/atracciones/${propia.id}/blocked-dates`).set(bearer(operador)).send({ date: fecha, reason: 'Paro de transporte' });
      expect(b.status).toBe(201);
      expect((await http(app).post(`/atracciones/${propia.id}/blocked-dates`).set(bearer(operador)).send({ date: fecha, reason: 'Paro de transporte' })).status).toBe(409);
      expect((await http(app).post(`/atracciones/${ajena.id}/blocked-dates`).set(bearer(operador)).send({ date: fecha, reason: 'Paro de transporte' })).status).toBe(404);
      expect((await http(app).get(`/atracciones/${propia.id}/blocked-dates`).set(bearer(operador))).body).toEqual([{ id: b.body.id, date: fecha, reason: 'Paro de transporte' }]);
      expect((await http(app).delete(`/atracciones/${propia.id}/blocked-dates/${b.body.id}`).set(bearer(operador))).status).toBe(204);
      expect((await http(app).delete(`/atracciones/${propia.id}/blocked-dates/${b.body.id}`).set(bearer(operador))).status).toBe(404);
      expect((await http(app).post(`/atracciones/${propia.id}/blocked-dates`).set(bearer(cliente)).send({ date: fecha, reason: 'Paro de transporte' })).status).toBe(403);
    });

    it('subida de imágenes: rechaza archivos que no son imagen aunque digan image/png', async () => {
      const r = await http(app)
        .post('/uploads')
        .set(bearer(admin))
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'x.png', contentType: 'image/png' });
      expect(r.status).toBe(400);
      const sinArchivo = await http(app).post('/uploads').set(bearer(admin));
      expect(sinArchivo.status).toBe(400);
    });
  });

  describe('reseñas', () => {
    it('sin haber vivido la experiencia → 403; tras vivirla → 201, promedio recalculado; segunda → 409', async () => {
      const a = await crearAtraccion();
      const elig = await http(app).get(`/atracciones/${a.id}/reviews/eligibility`).set(bearer(ana));
      expect(elig.body.can_review).toBe(false);
      expect((await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 5, comment: 'Experiencia increíble y muy bien organizada' })).status).toBe(403);

      // Ana reserva y la experiencia "ya ocurrió" (se mueve la fecha al pasado directamente en la base)
      const r = await http(app).post(`/atracciones/${a.id}/reservations`).set(bearer(ana)).set(idem()).send(reserva(fechaEc(10), { customer_name: 'Ana Torres' }));
      expect(r.status).toBe(201);
      await db(app).query(`UPDATE reserva SET res_fecha = CURRENT_DATE - 2 WHERE res_uuid = $1`, [r.body.reservation_id]);

      expect((await http(app).get(`/atracciones/${a.id}/reviews/eligibility`).set(bearer(ana))).body.can_review).toBe(true);
      const ok = await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 4, comment: 'Muy buen guía, volvería a ir' });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ rating: 4, author: expect.stringMatching(/Ana/) });
      expect((await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 5, comment: 'Otra opinión distinta aquí' })).status).toBe(409);

      const det = await http(app).get(`/atracciones/${a.id}`);
      expect(det.body.ratings).toEqual({ number_of_reviews: 1, score: 4 });
      const lista = await http(app).get(`/atracciones/${a.id}/reviews`);
      expect(lista.body.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 });

      // Moderación: ocultar recalcula el promedio
      const mod = await http(app).patch(`/resenas/${ok.body.id}`).set(bearer(admin)).send({ visible: false });
      expect(mod.status).toBe(200);
      expect((await http(app).get(`/atracciones/${a.id}`)).body.ratings).toEqual({ number_of_reviews: 0, score: 0 });
      expect((await http(app).delete(`/resenas/${ok.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/resenas/${ok.body.id}`).set(bearer(admin))).status).toBe(404);
    });

    it('una reserva cancelada no habilita a reseñar', async () => {
      const a = await crearAtraccion();
      const r = await http(app).post(`/atracciones/${a.id}/reservations`).set(bearer(ana)).set(idem()).send(reserva(fechaEc(10), { customer_name: 'Ana Torres' }));
      await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/cancel`).set(bearer(ana)).set(idem()).send({ reason: 'Cambio de planes' });
      await db(app).query(`UPDATE reserva SET res_fecha = CURRENT_DATE - 2 WHERE res_uuid = $1`, [r.body.reservation_id]);
      expect((await http(app).get(`/atracciones/${a.id}/reviews/eligibility`).set(bearer(ana))).body.can_review).toBe(false);
    });

    it('una reserva de hoy solo habilita a reseñar cuando ya pasó su hora (hora de Ecuador)', async () => {
      const a = await crearAtraccion();
      const r = await http(app).post(`/atracciones/${a.id}/reservations`).set(bearer(ana)).set(idem()).send(reserva(fechaEc(10), { customer_name: 'Ana Torres' }));
      const mover = (intervalo: string) =>
        db(app).query(
          `UPDATE reserva SET res_fecha = ((now() AT TIME ZONE 'America/Guayaquil') + $2::interval)::date,
                              res_hora  = ((now() AT TIME ZONE 'America/Guayaquil') + $2::interval)::time
            WHERE res_uuid = $1`,
          [r.body.reservation_id, intervalo],
        );
      const puede = async () => (await http(app).get(`/atracciones/${a.id}/reviews/eligibility`).set(bearer(ana))).body.can_review;
      await mover('1 hour'); // sale dentro de una hora
      expect(await puede()).toBe(false);
      expect((await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 5, comment: 'Todavía no la he vivido' })).status).toBe(403);
      await mover('-1 hour'); // salió hace una hora
      expect(await puede()).toBe(true);
    });

    it('validación: rating fuera de 1-5 y comentario ilegible → 400', async () => {
      const a = await crearAtraccion();
      expect((await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 6, comment: 'Excelente experiencia' })).status).toBe(400);
      expect((await http(app).post(`/atracciones/${a.id}/reviews`).set(bearer(ana)).send({ rating: 5, comment: '1234567890123' })).status).toBe(400);
    });
  });

  describe('favoritos', () => {
    it('agregar es idempotente, se listan y se quitan; atracción inexistente → 404', async () => {
      const a = await crearAtraccion();
      expect((await http(app).put(`/favoritos/${a.id}`).set(bearer(cliente))).status).toBe(204);
      expect((await http(app).put(`/favoritos/${a.id}`).set(bearer(cliente))).status).toBe(204);
      const lista = await http(app).get('/favoritos').set(bearer(cliente));
      expect(lista.body.filter((id: string) => id === a.id)).toHaveLength(1);
      expect((await http(app).get('/favoritos').set(bearer(ana))).body).not.toContain(a.id); // aislamiento por usuario
      expect((await http(app).delete(`/favoritos/${a.id}`).set(bearer(cliente))).status).toBe(204);
      expect((await http(app).get('/favoritos').set(bearer(cliente))).body).not.toContain(a.id);
      expect((await http(app).put(`/favoritos/${randomUUID()}`).set(bearer(cliente))).status).toBe(404);
      expect((await http(app).get('/favoritos')).status).toBe(401);
    });
  });

  describe('favoritos de atracciones inactivas', () => {
    it('no se puede agregar una inactiva (404) y las que se desactivan dejan de listarse', async () => {
      const inactiva = await crearAtraccion({ is_active: false });
      expect((await http(app).put(`/favoritos/${inactiva.id}`).set(bearer(cliente))).status).toBe(404);

      const a = await crearAtraccion();
      expect((await http(app).put(`/favoritos/${a.id}`).set(bearer(cliente))).status).toBe(204);
      await http(app).patch(`/atracciones/${a.id}`).set(bearer(admin)).send({ is_active: false });
      expect((await http(app).get('/favoritos').set(bearer(cliente))).body).not.toContain(a.id);
      // Al reactivarla vuelve a aparecer (el favorito se conserva)
      await http(app).patch(`/atracciones/${a.id}`).set(bearer(admin)).send({ is_active: true });
      expect((await http(app).get('/favoritos').set(bearer(cliente))).body).toContain(a.id);
      expect((await http(app).delete(`/favoritos/${inactiva.id}`).set(bearer(cliente))).status).toBe(204); // quitar siempre es idempotente
    });
  });

  describe('contacto', () => {
    const mensaje = { nombre: 'Ana Torres', email: 'ana@correo.ec', asunto: 'RESERVA', mensaje: '¿Puedo cambiar la fecha de mi reserva?' };

    it('público envía; el admin lista, marca como leído y elimina', async () => {
      const cuerpo = `Mensaje de prueba ${randomUUID().slice(0, 4).replace(/\d/g, 'q')} sobre mi reserva`;
      expect((await http(app).post('/mensajes').send({ ...mensaje, mensaje: cuerpo })).status).toBe(201);
      const lista = await http(app).get('/mensajes?status=unread').set(bearer(admin));
      const m = lista.body.find((x: { mensaje: string }) => x.mensaje === cuerpo);
      expect(m).toBeDefined();
      expect((await http(app).get('/mensajes/stats').set(bearer(operador))).body.unread).toBeGreaterThan(0);
      expect((await http(app).patch(`/mensajes/${m.id}`).set(bearer(admin)).send({ leido: true })).body.leido).toBe(true);
      expect((await http(app).delete(`/mensajes/${m.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/mensajes/${m.id}`).set(bearer(admin))).status).toBe(404);
    });

    it('honeypot: si "website" viene lleno se responde OK sin guardar', async () => {
      const cuerpo = 'Mensaje de un bot con enlaces raros';
      expect((await http(app).post('/mensajes').send({ ...mensaje, mensaje: cuerpo, website: 'http://spam' })).status).toBe(201);
      const [{ n }] = await db(app).query('SELECT COUNT(*)::int AS n FROM mensaje_contacto WHERE men_cuerpo = $1', [cuerpo]);
      expect(n).toBe(0);
    });

    it('validación: asunto desconocido, mensaje corto o sin texto → 400', async () => {
      expect((await http(app).post('/mensajes').send({ ...mensaje, asunto: 'HACK' })).status).toBe(400);
      expect((await http(app).post('/mensajes').send({ ...mensaje, mensaje: 'Hola' })).status).toBe(400);
      expect((await http(app).post('/mensajes').send({ ...mensaje, mensaje: '1234567890123' })).status).toBe(400);
    });
  });

  describe('reportes', () => {
    it('dashboard: el operador solo ve datos de su empresa', async () => {
      const r = await http(app).get('/reportes/dashboard').set(bearer(operador));
      expect(r.status).toBe(200);
      expect(r.body.kpis).toHaveProperty('active_attractions');
      expect(r.body.last_7_days).toHaveLength(7);
      const [{ n }] = await db(app).query(
        `SELECT COUNT(*)::int AS n FROM atraccion a JOIN operador o ON o.ope_id = a.ope_id WHERE o.ope_codigo = 101 AND a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA'`,
      );
      expect(r.body.kpis.active_attractions).toBe(n);
    });

    it('ingresos = dinero cobrado: una reserva pendiente de pago no suma hasta que se confirma', async () => {
      const hoy = fechaEc(0);
      const kpis = async () => (await http(app).get(`/reportes/ventas?from=${hoy}&to=${hoy}`).set(bearer(admin))).body.kpis;
      const antes = await kpis();
      const a = await crearAtraccion(); // 40 USD por adulto
      const r = await http(app).post(`/atracciones/${a.id}/reservations`).set(bearer(ana)).set(idem())
        .send(reserva(fechaEc(15), { customer_name: 'Ana Torres', payment_method: 'TRANSFERENCIA' }));
      expect(r.status).toBe(201);

      const pendiente = await kpis();
      expect(pendiente.reservations).toBe(antes.reservations + 1);
      expect(pendiente.revenue).toBeCloseTo(antes.revenue, 2);
      expect(pendiente.pending_revenue).toBeCloseTo(antes.pending_revenue + 40, 2);

      expect((await http(app).post(`/atracciones/reservations/${r.body.reservation_id}/confirm`).set(bearer(operador)).set(idem()).send()).status).toBe(200);
      const cobrada = await kpis();
      expect(cobrada.revenue).toBeCloseTo(antes.revenue + 40, 2);
      expect(cobrada.pending_revenue).toBeCloseTo(antes.pending_revenue, 2);
      expect(cobrada.average_ticket).toBeGreaterThan(0);
    });

    it('ventas: rango válido, "to" futuro → 400, rango invertido → 400, fecha inválida → 400', async () => {
      const ok = await http(app).get(`/reportes/ventas?from=${fechaEc(-30)}&to=${fechaEc(0)}`).set(bearer(admin));
      expect(ok.status).toBe(200);
      expect(ok.body.kpis.reservations).toBeGreaterThan(0);
      expect((await http(app).get(`/reportes/ventas?to=${fechaEc(5)}`).set(bearer(admin))).status).toBe(400);
      expect((await http(app).get(`/reportes/ventas?from=${fechaEc(0)}&to=${fechaEc(-5)}`).set(bearer(admin))).status).toBe(400);
      expect((await http(app).get('/reportes/ventas?from=2026-02-31&to=2026-03-01').set(bearer(admin))).status).toBe(400);
      expect((await http(app).get('/reportes/clientes').set(bearer(admin))).status).toBe(200);
    });
  });

  describe('integración (EDA y contratos)', () => {
    it('feed de eventos con cursor', async () => {
      const r = await http(app).get('/eventos?limit=5').set(bearer(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.length).toBeLessThanOrEqual(5);
      const sig = await http(app).get(`/eventos?after=${r.body.next_after}&limit=5`).set(bearer(admin));
      expect(sig.body.data.every((e: { sequence: string }) => Number(e.sequence) > r.body.next_after)).toBe(true);
      expect((await http(app).get('/eventos?type=no.existe').set(bearer(admin))).status).toBe(400);
      expect((await http(app).get('/eventos/resumen').set(bearer(admin))).status).toBe(200);
    });

    it('contratos publicados: se descargan los conocidos; nombres desconocidos → 400', async () => {
      const lista = await http(app).get('/contracts');
      expect(lista.body.map((c: { name: string }) => c.name)).toContain('atracciones-openapi.yaml');
      const yaml = await http(app).get('/contracts/atracciones-openapi.yaml');
      expect(yaml.status).toBe(200);
      expect(yaml.text).toMatch(/openapi:/);
      for (const nombre of ['otro.yaml', '..%2Fpackage.json', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        const r = await http(app).get(`/contracts/${nombre}`);
        expect({ nombre, status: r.status }).toEqual({ nombre, status: 400 });
      }
    });
  });
});
