import { NestExpressApplication } from '@nestjs/platform-express';
import { bearer, createTestApp, describeDb, http, login, nombreUnico, nuevaAtraccion, USERS } from './helpers';

/** Administración de catálogos: categorías (jerarquía), destinos (ciudades) y empresas operadoras. */
describeDb('Administración de catálogos (E2E)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let operador: string;

  const aleatorio = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  const ruc = () => `179${aleatorio(7)}001`; // provincia 17, tercer dígito 9, establecimiento 001
  const slug = () => nombreUnico('qa').replace(/\s+/g, '-');

  beforeAll(async () => {
    app = await createTestApp();
    [admin, operador] = await Promise.all([login(app, USERS.admin), login(app, USERS.operador)]);
  });
  afterAll(() => app?.close());

  describe('categorías', () => {
    it('CRUD con slug único, jerarquía sin ciclos y borrado protegido', async () => {
      const post = (body: Record<string, unknown>) => http(app).post('/categorias').set(bearer(admin)).send(body);
      const padre = await post({ nombre: 'Categoría QA padre', slug: slug() });
      expect(padre.status).toBe(201);
      expect((await post({ nombre: 'Otra', slug: padre.body.slug })).status).toBe(409);

      const hija = await post({ nombre: 'Categoría QA hija', slug: slug(), padre_id: padre.body.id });
      expect(hija.status).toBe(201);
      expect(hija.body.padre_id).toBe(padre.body.id);

      // Ciclos: propia madre, o madre que desciende de ella
      expect((await http(app).patch(`/categorias/${padre.body.id}`).set(bearer(admin)).send({ padre_id: padre.body.id })).status).toBe(400);
      expect((await http(app).patch(`/categorias/${padre.body.id}`).set(bearer(admin)).send({ padre_id: hija.body.id })).status).toBe(400);
      expect((await post({ nombre: 'Huérfana', slug: slug(), padre_id: 99999 })).status).toBe(400);

      // No se borra con subcategorías; sí después
      expect((await http(app).delete(`/categorias/${padre.body.id}`).set(bearer(admin))).status).toBe(409);
      expect((await http(app).delete(`/categorias/${hija.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/categorias/${padre.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/categorias/${padre.body.id}`).set(bearer(admin))).status).toBe(404);
    });

    it('una categoría en uso no se puede borrar; inactiva no se lista al público', async () => {
      const cat = await http(app).post('/categorias').set(bearer(admin)).send({ nombre: 'Categoría QA en uso', slug: slug() });
      const ciudad = (await http(app).get('/destinos')).body[0].id;
      expect((await http(app).post('/atracciones').set(bearer(admin)).send(nuevaAtraccion(ciudad, { categories: [cat.body.slug] }))).status).toBe(201);
      expect((await http(app).delete(`/categorias/${cat.body.id}`).set(bearer(admin))).status).toBe(409);
      expect((await http(app).patch(`/categorias/${cat.body.id}`).set(bearer(admin)).send({ activa: false })).body.activa).toBe(false);
      expect((await http(app).get('/categorias')).body.map((c: { id: number }) => c.id)).not.toContain(cat.body.id);
      expect((await http(app).get('/categorias?all=true').set(bearer(admin))).body.map((c: { id: number }) => c.id)).toContain(cat.body.id);
    });

    it('un OPERADOR no administra catálogos (403)', async () => {
      expect((await http(app).post('/categorias').set(bearer(operador)).send({ nombre: 'No permitido' })).status).toBe(403);
    });
  });

  describe('destinos', () => {
    it('crea, evita duplicados, actualiza y borra si no está en uso', async () => {
      const provincia = (await http(app).get('/provincias')).body[0].id;
      const codigo = aleatorio(6);
      const nombre = nombreUnico('Destino QA');
      const d = await http(app).post('/destinos').set(bearer(admin)).send({ nombre, provincia_id: provincia, codigo_inec: codigo, descripcion: 'Destino creado por la suite E2E' });
      expect(d.status).toBe(201);
      expect((await http(app).post('/destinos').set(bearer(admin)).send({ nombre: 'Otro nombre', provincia_id: provincia, codigo_inec: codigo })).status).toBe(409);
      expect((await http(app).post('/destinos').set(bearer(admin)).send({ nombre, provincia_id: provincia, codigo_inec: aleatorio(6) })).status).toBe(409);
      // Sin atracciones publicadas no aparece en el listado público
      expect((await http(app).get('/destinos')).body.map((x: { id: number }) => x.id)).not.toContain(d.body.id);
      const u = await http(app).patch(`/destinos/${d.body.id}`).set(bearer(admin)).send({ imagen: '/img/cuenca.jpg' });
      expect(u.status).toBe(200);
      expect(u.body.imagen).toMatch(/^https?:\/\/.+\/img\/cuenca\.jpg$/);
      expect((await http(app).delete(`/destinos/${d.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/destinos/${d.body.id}`).set(bearer(admin))).status).toBe(404);
    });

    it('un destino con atracciones no se borra (409)', async () => {
      const ciudad = (await http(app).get('/destinos')).body[0].id;
      expect((await http(app).delete(`/destinos/${ciudad}`).set(bearer(admin))).status).toBe(409);
    });
  });

  describe('operadores', () => {
    const nuevo = (extra: Record<string, unknown> = {}) => ({ nombre: nombreUnico('Operadora QA'), provincia_id: 17, ruc: ruc(), email: 'qa@operadora.ec', telefono: '022345678', ...extra });

    it('altas simultáneas sin código obtienen códigos distintos (bloqueo consultivo)', async () => {
      const provincia = (await http(app).get('/provincias')).body[0].id;
      const res = await Promise.all([0, 1, 2, 3].map(() => http(app).post('/operadores').set(bearer(admin)).send(nuevo({ provincia_id: provincia }))));
      expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      const codigos = res.map((r) => r.body.codigo);
      expect(new Set(codigos).size).toBe(4);
    });

    it('RUC y código únicos, RUC inválido → 400, borrado protegido', async () => {
      const provincia = (await http(app).get('/provincias')).body[0].id;
      const a = await http(app).post('/operadores').set(bearer(admin)).send(nuevo({ provincia_id: provincia }));
      expect(a.status).toBe(201);
      expect((await http(app).post('/operadores').set(bearer(admin)).send(nuevo({ provincia_id: provincia, ruc: a.body.ruc }))).status).toBe(409);
      expect((await http(app).post('/operadores').set(bearer(admin)).send(nuevo({ provincia_id: provincia, codigo: a.body.codigo }))).status).toBe(409);
      expect((await http(app).post('/operadores').set(bearer(admin)).send(nuevo({ provincia_id: provincia, ruc: '9992345678001' }))).status).toBe(400);
      expect((await http(app).patch(`/operadores/${a.body.id}`).set(bearer(admin)).send({ codigo: 101 })).status).toBe(409);
      expect((await http(app).patch(`/operadores/${a.body.id}`).set(bearer(admin)).send({ activo: false })).body.activo).toBe(false);
      expect((await http(app).delete(`/operadores/${a.body.id}`).set(bearer(admin))).status).toBe(204);
      expect((await http(app).delete(`/operadores/${a.body.id}`).set(bearer(admin))).status).toBe(404);
      const conAtracciones = (await http(app).get('/operadores')).body.find((o: { codigo: number }) => o.codigo === 101);
      expect((await http(app).delete(`/operadores/${conAtracciones.id}`).set(bearer(admin))).status).toBe(409);
    });
  });

  describe('moderación de reseñas (listado)', () => {
    it('filtra por estado y puntuación con paginación', async () => {
      const r = await http(app).get('/resenas?status=visible&limit=3').set(bearer(admin));
      expect(r.status).toBe(200);
      expect(r.body.data.every((x: { visible: boolean }) => x.visible)).toBe(true);
      expect(r.body.meta.itemsPerPage).toBe(3);
      const cinco = await http(app).get('/resenas?rating=5').set(bearer(admin));
      expect(cinco.body.data.every((x: { rating: number }) => x.rating === 5)).toBe(true);
      expect((await http(app).get('/resenas?status=otro').set(bearer(admin))).status).toBe(400);
    });
  });
});
