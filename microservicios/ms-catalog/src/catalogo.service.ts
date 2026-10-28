import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Usuario } from './comun/auth';
import { DbService, Params, Sql } from './comun/db.service';
import { LocationClient, TiendaClient } from './clientes';
import { AtraccionCampos, AtraccionesQuery, CrearAtraccion, EventoEntrante, ListAtraccionesQuery, OBLIGATORIOS_CREAR, SearchAtraccionesRequest } from './dto';
import { MapperBooking } from './mapper-booking';
import { AtraccionBD, SELECT_ATRACCION, sqlPrecio, VISIBLE } from './modelo';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIN_TILDES = (x: string) => `translate(lower(${x}), 'áéíóúüñ', 'aeiouun')`;
const escaparLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const hoyEc = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

interface FilaCategoria {
  cat_id: number;
  cat_padre_id: number | null;
  cat_nombre: string;
  cat_slug: string;
  cat_descripcion: string | null;
  cat_icono: string;
  cat_orden: number;
  cat_activa: boolean;
  cat_incluye_comida: boolean;
  cat_incluye_transporte: boolean;
  cat_incluye_guia: boolean;
}

export interface NodoCategoria {
  id: string;
  nombre: string;
  slug: string;
  descripcion?: string;
  icono?: string;
  incluye_comida: boolean;
  incluye_transporte: boolean;
  incluye_guia: boolean;
  includes_food: boolean;
  includes_transport: boolean;
  includes_guide: boolean;
  orden: number;
  subcategorias: NodoCategoria[];
}

/** «cat-12», «12» o el slug → condición sobre categoria (alias c). */
function refCategoria(ref: string, p: Params): string {
  const m = /^(?:cat-)?(\d{1,9})$/.exec(ref.trim());
  return m ? `c.cat_id = ${p.add(Number(m[1]))}` : `c.cat_slug = ${p.add(ref.trim().toLowerCase())}`;
}

const slugDe = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'atraccion';

/** Columnas escalares que se pueden escribir (las demás son relaciones o proyecciones). */
const ESCALARES = [
  'atr_nombre', 'atr_descripcion', 'atr_descripcion_corta', 'atr_tipo', 'atr_estado', 'atr_latitud', 'atr_longitud', 'atr_direccion',
  'atr_punto_encuentro', 'atr_duracion_horas', 'ciu_id', 'atr_cancelacion_gratuita', 'atr_horas_cancelacion', 'atr_destacada',
  'atr_incluye_comida', 'atr_incluye_transporte', 'atr_incluye_guia', 'atr_accesible_silla', 'atr_accesible_coche',
  'atr_animales_servicio', 'atr_guia', 'atr_instrucciones_llegada', 'atr_permite_paquete', 'atr_descuento_paquete',
] as const;

/**
 * Catalog & Attractions Service: dueño de atraccion, categoria, idioma, inclusion, fotos, itinerario y
 * operadores. Ciudad (ms_location), precio (ms_pricing) y calificación (ms_review) son IDs lógicos o
 * proyecciones que llegan por eventos.
 */
@Injectable()
export class CatalogoService {
  readonly mapper = new MapperBooking();

  constructor(
    private readonly db: DbService,
    private readonly location: LocationClient,
    private readonly tienda: TiendaClient,
  ) {}

  // ── Categorías ──────────────────────────────────────────────────────────
  private categoriasActivas() {
    return this.db.query<FilaCategoria>(
      `SELECT cat_id, cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_activa,
              cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia
         FROM categoria WHERE cat_activa ORDER BY cat_orden, cat_nombre`,
    );
  }

  private nodo(c: FilaCategoria, hijos: NodoCategoria[] = []): NodoCategoria {
    return {
      id: `cat-${c.cat_id}`,
      nombre: c.cat_nombre,
      slug: c.cat_slug,
      ...(c.cat_descripcion ? { descripcion: c.cat_descripcion } : {}),
      ...(c.cat_icono ? { icono: c.cat_icono } : {}),
      incluye_comida: c.cat_incluye_comida,
      incluye_transporte: c.cat_incluye_transporte,
      incluye_guia: c.cat_incluye_guia,
      // Guía de integración §7.3: también en inglés
      includes_food: c.cat_incluye_comida,
      includes_transport: c.cat_incluye_transporte,
      includes_guide: c.cat_incluye_guia,
      orden: c.cat_orden,
      subcategorias: hijos,
    };
  }

  /** Árbol recursivo por cat_padre_id (contrato v3: GET /atracciones/categorias/arbol). */
  async arbol(): Promise<NodoCategoria[]> {
    const todas = await this.categoriasActivas();
    const ids = new Set(todas.map((c) => c.cat_id));
    const construir = (padre: number | null, visitados: Set<number>): NodoCategoria[] =>
      todas
        .filter((c) => (padre === null ? c.cat_padre_id === null || !ids.has(c.cat_padre_id) : c.cat_padre_id === padre) && !visitados.has(c.cat_id))
        .map((c) => this.nodo(c, construir(c.cat_id, new Set([...visitados, c.cat_id]))));
    return construir(null, new Set());
  }

  /** Lista plana: hijas directas de padre_id, o las raíz (contrato v3: GET /atracciones/categorias). */
  async planas(padreId?: string) {
    const todas = await this.categoriasActivas();
    let padre: number | null = null;
    if (padreId) {
      const m = /^(?:cat-)?(\d{1,9})$/.exec(padreId.trim());
      const p = todas.find((c) => (m ? c.cat_id === Number(m[1]) : c.cat_slug === padreId.trim().toLowerCase()));
      if (!p) return [];
      padre = p.cat_id;
    }
    return todas
      .filter((c) => c.cat_padre_id === padre)
      .map((c) => ({
        id: `cat-${c.cat_id}`,
        padre_id: c.cat_padre_id === null ? null : `cat-${c.cat_padre_id}`,
        nombre: c.cat_nombre,
        slug: c.cat_slug,
        incluye_comida: c.cat_incluye_comida,
        incluye_transporte: c.cat_incluye_transporte,
        incluye_guia: c.cat_incluye_guia,
        includes_food: c.cat_incluye_comida,
        includes_transport: c.cat_incluye_transporte,
        includes_guide: c.cat_incluye_guia,
      }));
  }

  /** API propia: todas las categorías con sus columnas. */
  categorias() {
    return this.db.query(
      `SELECT cat_id, cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_activa,
              cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia FROM categoria ORDER BY cat_orden, cat_id`,
    );
  }

  async categoria(id: number) {
    const c = await this.db.one(
      `SELECT cat_id, cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_activa,
              cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia FROM categoria WHERE cat_id = $1`,
      [id],
    );
    if (!c) throw new NotFoundException(`La categoría ${id} no existe.`);
    return c;
  }

  idiomas() {
    return this.db.query(`SELECT idi_id, trim(idi_codigo) AS idi_codigo, idi_nombre FROM idioma ORDER BY idi_codigo`);
  }

  inclusiones() {
    return this.db.query('SELECT inc_id, inc_tipo, inc_nombre, inc_orden FROM inclusion ORDER BY inc_tipo, inc_orden, inc_id');
  }

  operadores() {
    return this.db.query(
      `SELECT ope_id::int, ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id, ope_activo
         FROM operador ORDER BY ope_nombre`,
    );
  }

  async operador(id: number) {
    const o = await this.db.one(
      `SELECT ope_id::int, ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id, ope_activo
         FROM operador WHERE ope_id = $1`,
      [id],
    );
    if (!o) throw new NotFoundException(`El operador ${id} no existe.`);
    return o;
  }

  // ── Atracciones ─────────────────────────────────────────────────────────
  private async cargar(ids: number[], sql: Sql = this.db): Promise<AtraccionBD[]> {
    if (!ids.length) return [];
    const filas = await sql.query<AtraccionBD>(`${SELECT_ATRACCION} WHERE a.atr_id = ANY($1::bigint[])`, [ids]);
    const porId = new Map(filas.map((f) => [f.atr_id, f]));
    return ids.map((id) => porId.get(id)).filter((f): f is AtraccionBD => !!f);
  }

  /** Por atr_id, UUID o slug. Para Booking, solo las publicadas. */
  async porRef(ref: string, soloVisibles: boolean, sql: Sql = this.db): Promise<AtraccionBD> {
    const p = new Params();
    const cond = /^\d{1,12}$/.test(ref) ? `a.atr_id = ${p.add(Number(ref))}` : RE_UUID.test(ref) ? `a.atr_uuid = ${p.add(ref.toLowerCase())}::uuid` : `a.atr_slug = ${p.add(ref.toLowerCase())}`;
    const r = await sql.one<{ atr_id: number }>(
      `SELECT a.atr_id::int FROM atraccion a WHERE ${cond} AND ${soloVisibles ? VISIBLE : 'a.atr_eliminado_en IS NULL'}`,
      p.values,
    );
    if (!r) throw new NotFoundException(`La atracción ${ref} no existe o no está disponible.`);
    return (await this.cargar([r.atr_id], sql))[0];
  }

  private async nombresCiudad(lista: AtraccionBD[]) {
    const m = await this.location.ciudades(lista.map((a) => a.ciu_id));
    return (a: AtraccionBD) => m.get(a.ciu_id)?.ciu_nombre ?? `Ciudad ${a.ciu_id}`;
  }

  private async paginaBooking(ids: number[], total: number, page: number, limit: number) {
    const filas = await this.cargar(ids);
    const ciudad = await this.nombresCiudad(filas);
    return {
      request_id: `req-atr-${randomUUID().slice(0, 8)}`,
      metadata: { total_results: total, page, limit, total_pages: Math.ceil(total / limit), next_cursor: null },
      data: filas.map((a) => this.mapper.card(a, ciudad(a))),
    };
  }

  private filtrosComunes(q: { categoria_id?: string; incluye_comida?: boolean; incluye_transporte?: boolean; incluye_guia?: boolean }, w: string[], p: Params) {
    if (q.categoria_id) {
      const cond = refCategoria(q.categoria_id, p);
      w.push(`EXISTS (SELECT 1 FROM atraccion_categoria ac JOIN categoria c2 ON c2.cat_id = ac.cat_id
                       WHERE ac.atr_id = a.atr_id AND (c2.cat_id IN (SELECT c.cat_id FROM categoria c WHERE ${cond})
                         OR c2.cat_padre_id IN (SELECT c.cat_id FROM categoria c WHERE ${cond})))`);
    }
    if (q.incluye_comida !== undefined) w.push(`a.atr_incluye_comida = ${p.add(q.incluye_comida)}`);
    if (q.incluye_transporte !== undefined) w.push(`a.atr_incluye_transporte = ${p.add(q.incluye_transporte)}`);
    if (q.incluye_guia !== undefined) w.push(`a.atr_incluye_guia = ${p.add(q.incluye_guia)}`);
  }

  /** Contrato v3: GET /atracciones (city es el NOMBRE de la ciudad; se resuelve en ms_location). */
  async listarBooking(q: ListAtraccionesQuery) {
    const p = new Params();
    const w = [VISIBLE];
    if (q.city) {
      const ids = await this.location.buscar(q.city);
      if (!ids.length) return this.paginaBooking([], 0, q.page ?? 1, q.limit ?? 10);
      w.push(`a.ciu_id = ANY(${p.add(ids)}::smallint[])`);
    }
    this.filtrosComunes(q, w, p);
    const orden = {
      PRICE_ASC: `${sqlPrecio('ADULTO')} ASC NULLS LAST`,
      PRICE_DESC: `${sqlPrecio('ADULTO')} DESC NULLS LAST`,
      RATING_DESC: 'a.atr_calificacion_promedio DESC, a.atr_numero_resenas DESC',
      // Popularidad sin datos de ventas (son de ms_booking): destacadas y más reseñadas primero
      POPULARITY: 'a.atr_destacada DESC, a.atr_numero_resenas DESC, a.atr_calificacion_promedio DESC',
    }[q.sort ?? 'POPULARITY'];
    const page = q.page ?? 1;
    const limit = q.limit ?? 10;
    const filas = await this.db.query<{ atr_id: number; total: number }>(
      `SELECT a.atr_id::int, COUNT(*) OVER ()::int AS total FROM atraccion a WHERE ${w.join(' AND ')}
        ORDER BY ${orden}, a.atr_id LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    return this.paginaBooking(filas.map((f) => f.atr_id), filas[0]?.total ?? 0, page, limit);
  }

  /** Contrato v3: POST /atracciones/search. Con fechas, la disponibilidad se consulta a la tienda (futuro ms_inventory). */
  async searchBooking(b: SearchAtraccionesRequest) {
    const p = new Params();
    const w = [VISIBLE];
    if (b.query) {
      const ciudades = await this.location.buscar(b.query).catch(() => [] as number[]);
      const t = SIN_TILDES(p.add(`%${escaparLike(b.query)}%`));
      w.push(`(${SIN_TILDES('a.atr_nombre')} LIKE ${t} OR ${SIN_TILDES('a.atr_descripcion')} LIKE ${t}${ciudades.length ? ` OR a.ciu_id = ANY(${p.add(ciudades)}::smallint[])` : ''})`);
    }
    if (b.ciudad) {
      const ids = await this.location.buscar(b.ciudad);
      if (!ids.length) return this.paginaBooking([], 0, b.page ?? 1, b.limit ?? 10);
      w.push(`a.ciu_id = ANY(${p.add(ids)}::smallint[])`);
    }
    this.filtrosComunes(b, w, p);
    if (b.precio_min != null && b.precio_max != null && b.precio_min > b.precio_max) {
      throw new BadRequestException('precio_min no puede ser mayor que precio_max.');
    }
    if (b.precio_min != null) w.push(`${sqlPrecio('ADULTO')} >= ${p.add(b.precio_min)}`);
    if (b.precio_max != null) w.push(`${sqlPrecio('ADULTO')} <= ${p.add(b.precio_max)}`);
    if (b.duracion_max_horas != null) w.push(`a.atr_duracion_horas <= ${p.add(b.duracion_max_horas)}`);
    if (b.idioma_guia) {
      w.push(`EXISTS (SELECT 1 FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id
                       WHERE ai.atr_id = a.atr_id AND (${SIN_TILDES('i.idi_nombre')} = ${SIN_TILDES(p.add(b.idioma_guia))}
                                                       OR lower(trim(i.idi_codigo)) = lower(${p.add(b.idioma_guia)})))`);
    }
    if (b.accesible_silla_ruedas) w.push('a.atr_accesible_silla');
    if (b.animales_asistencia) w.push('a.atr_animales_servicio');
    if (b.cancelacion_gratuita) w.push('a.atr_cancelacion_gratuita');
    const page = b.page ?? 1;
    const limit = b.limit ?? 10;
    const orden = 'a.atr_destacada DESC, a.atr_calificacion_promedio DESC, a.atr_id';

    if (!b.fecha_inicio && !b.fecha_fin) {
      const filas = await this.db.query<{ atr_id: number; total: number }>(
        `SELECT a.atr_id::int, COUNT(*) OVER ()::int AS total FROM atraccion a WHERE ${w.join(' AND ')}
          ORDER BY ${orden} LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
        p.values,
      );
      return this.paginaBooking(filas.map((f) => f.atr_id), filas[0]?.total ?? 0, page, limit);
    }

    // Con fechas: candidatas por catálogo y luego las que tienen cupos algún día del rango (máx. 31 días)
    const desde = (b.fecha_inicio ?? b.fecha_fin)!.slice(0, 10);
    const hasta = (b.fecha_fin ?? b.fecha_inicio)!.slice(0, 10);
    if (hasta < desde) throw new BadRequestException('fecha_fin no puede ser anterior a fecha_inicio.');
    const dias: string[] = [];
    for (let d = new Date(`${desde > hoyEc() ? desde : hoyEc()}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta && dias.length < 31; d.setUTCDate(d.getUTCDate() + 1)) {
      dias.push(d.toISOString().slice(0, 10));
    }
    const candidatas = await this.db.query<{ atr_id: number; uuid: string }>(
      `SELECT a.atr_id::int, a.atr_uuid::text AS uuid FROM atraccion a WHERE ${w.join(' AND ')} ORDER BY ${orden} LIMIT 200`,
      p.values,
    );
    const cupos = b.adult_count ?? b.cantidad_adultos ?? 1;
    const conCupos: number[] = [];
    await Promise.all(
      candidatas.map(async (c) => {
        for (const dia of dias) if (await this.tienda.hayCupos(c.uuid, dia, cupos)) return void conCupos.push(c.atr_id);
      }),
    );
    const orden2 = candidatas.map((c) => c.atr_id).filter((id) => conCupos.includes(id));
    return this.paginaBooking(orden2.slice((page - 1) * limit, page * limit), orden2.length, page, limit);
  }

  /** Contrato v3: GET /atracciones/{id} (UUID o slug). */
  async detalleBooking(ref: string) {
    const [a, acuerdo] = await Promise.all([this.porRef(ref, true), this.tienda.acuerdo()]);
    const ciudad = await this.nombresCiudad([a]);
    return this.mapper.detalle(a, ciudad(a), acuerdo);
  }

  // ── API propia ──────────────────────────────────────────────────────────
  async listar(q: AtraccionesQuery) {
    const p = new Params();
    const w = ['a.atr_eliminado_en IS NULL'];
    if (q.atr_estado) w.push(`a.atr_estado = ${p.add(q.atr_estado)}`);
    if (q.ciu_id) w.push(`a.ciu_id = ${p.add(q.ciu_id)}`);
    if (q.ope_id) w.push(`a.ope_id = ${p.add(q.ope_id)}`);
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const filas = await this.db.query<{ atr_id: number; total: number }>(
      `SELECT a.atr_id::int, COUNT(*) OVER ()::int AS total FROM atraccion a WHERE ${w.join(' AND ')}
        ORDER BY a.atr_id LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    return { data: await this.cargar(filas.map((f) => f.atr_id)), total: filas[0]?.total ?? 0, page, limit };
  }

  /** ADMIN: cualquier operador. OPERADOR: solo el de su empresa (claim `operador` = ope_codigo). */
  private async operadorPermitido(u: Usuario, opeId: number | undefined, sql: Sql): Promise<number> {
    if (u.rol === 'ADMIN' || u.roles?.includes('ADMIN')) {
      if (!opeId) throw new BadRequestException({ message: 'ope_id es obligatorio para un administrador.', code: 'VALIDATION_FAILED', invalid_params: [{ name: 'ope_id', reason: 'ope_id es obligatorio' }] });
      const o = await sql.one<{ ope_id: number }>('SELECT ope_id::int FROM operador WHERE ope_id = $1', [opeId]);
      if (!o) throw new UnprocessableEntityException({ message: `El operador ${opeId} no existe.`, code: 'INVALID_REFERENCE' });
      return o.ope_id;
    }
    const propio = u.operador ? await sql.one<{ ope_id: number }>('SELECT ope_id::int FROM operador WHERE ope_codigo = $1 AND ope_activo', [u.operador]) : null;
    if (!propio) throw new ForbiddenException({ message: 'Tu usuario no pertenece a una empresa operadora activa.', code: 'FORBIDDEN' });
    if (opeId && opeId !== propio.ope_id) throw new ForbiddenException({ message: 'Solo puedes publicar atracciones de tu empresa.', code: 'FORBIDDEN' });
    return propio.ope_id;
  }

  private async validarReferencias(d: AtraccionCampos, sql: Sql) {
    if (d.ciu_id !== undefined && !(await this.location.existe(d.ciu_id))) {
      throw new UnprocessableEntityException({ message: `La ciudad ${d.ciu_id} no existe en ms_location.`, code: 'INVALID_REFERENCE' });
    }
    const revisar = async (ids: number[] | undefined, tabla: string, col: string) => {
      if (!ids?.length) return;
      const r = await sql.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${tabla} WHERE ${col} = ANY($1::bigint[])`, [[...new Set(ids)]]);
      if (r!.n !== new Set(ids).size) throw new UnprocessableEntityException({ message: `Alguno de los ${col} no existe.`, code: 'INVALID_REFERENCE' });
    };
    await revisar(d.cat_ids, 'categoria', 'cat_id');
    await revisar(d.idi_ids, 'idioma', 'idi_id');
    await revisar(d.inc_ids, 'inclusion', 'inc_id');
  }

  private async guardarRelaciones(atrId: number, d: AtraccionCampos, sql: Sql) {
    const reemplazar = async (ids: number[] | undefined, tabla: string, col: string) => {
      if (!ids) return;
      await sql.query(`DELETE FROM ${tabla} WHERE atr_id = $1`, [atrId]);
      for (const id of new Set(ids)) await sql.query(`INSERT INTO ${tabla} (atr_id, ${col}) VALUES ($1, $2)`, [atrId, id]);
    };
    await reemplazar(d.cat_ids, 'atraccion_categoria', 'cat_id');
    await reemplazar(d.idi_ids, 'atraccion_idioma', 'idi_id');
    await reemplazar(d.inc_ids, 'atraccion_inclusion', 'inc_id');
    if (d.fotos) {
      await sql.query('DELETE FROM atraccion_foto WHERE atr_id = $1', [atrId]);
      for (const [i, f] of d.fotos.entries()) {
        await sql.query('INSERT INTO atraccion_foto (atr_id, fot_url, fot_alt, fot_orden) VALUES ($1, $2, $3, $4)', [atrId, f.fot_url, f.fot_alt, i]);
      }
    }
    if (d.itinerario) {
      const ordenes = d.itinerario.map((p) => p.iti_orden);
      if (new Set(ordenes).size !== ordenes.length) throw new BadRequestException('iti_orden no puede repetirse en el itinerario.');
      await sql.query('DELETE FROM atraccion_itinerario WHERE atr_id = $1', [atrId]);
      for (const p of d.itinerario) {
        await sql.query(
          `INSERT INTO atraccion_itinerario (atr_id, iti_orden, iti_hora, iti_titulo, iti_descripcion, iti_duracion_min, iti_lugar)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [atrId, p.iti_orden, p.iti_hora, p.iti_titulo, p.iti_descripcion ?? null, p.iti_duracion_min, p.iti_lugar ?? null],
        );
      }
    }
  }

  async crear(d: CrearAtraccion, u: Usuario) {
    const faltan = OBLIGATORIOS_CREAR.filter((c) => d[c] === undefined);
    if (faltan.length) {
      throw new BadRequestException({ message: `Faltan campos obligatorios: ${faltan.join(', ')}.`, code: 'VALIDATION_FAILED', invalid_params: faltan.map((name) => ({ name, reason: `${name} es obligatorio` })) });
    }
    return this.db.tx(async (tx) => {
      const opeId = await this.operadorPermitido(u, d.ope_id, tx);
      await this.validarReferencias(d, tx);
      const base = slugDe(d.atr_nombre!);
      const usados = await tx.query<{ atr_slug: string }>(`SELECT atr_slug FROM atraccion WHERE atr_slug = $1 OR atr_slug LIKE $2`, [base, `${base}-%`]);
      let slug = base;
      for (let n = 2; usados.some((x) => x.atr_slug === slug); n++) slug = `${base}-${n}`;
      const cols = ESCALARES.filter((c) => d[c] !== undefined);
      const p = new Params();
      const valores = cols.map((c) => p.add(d[c]));
      const r = await tx.one<{ atr_id: number }>(
        `INSERT INTO atraccion (${[...cols, 'atr_slug', 'ope_id'].join(', ')}) VALUES (${[...valores, p.add(slug), p.add(opeId)].join(', ')}) RETURNING atr_id::int`,
        p.values,
      );
      await this.guardarRelaciones(r!.atr_id, d, tx);
      return (await this.cargar([r!.atr_id], tx))[0];
    });
  }

  private async editable(id: number, u: Usuario, tx: Sql) {
    const a = await this.porRef(String(id), false, tx);
    const admin = u.rol === 'ADMIN' || u.roles?.includes('ADMIN');
    if (!admin && (!u.operador || a.operador.ope_codigo !== u.operador)) {
      throw new ForbiddenException({ message: 'Solo puedes modificar atracciones de tu empresa.', code: 'FORBIDDEN' });
    }
    return a;
  }

  async actualizar(id: number, d: AtraccionCampos, u: Usuario) {
    return this.db.tx(async (tx) => {
      await this.editable(id, u, tx);
      await this.validarReferencias(d, tx);
      const cols = ESCALARES.filter((c) => d[c] !== undefined);
      if (cols.length) {
        const p = new Params();
        const sets = cols.map((c) => `${c} = ${p.add(d[c])}`);
        await tx.query(`UPDATE atraccion SET ${sets.join(', ')} WHERE atr_id = ${p.add(id)}`, p.values);
      }
      await this.guardarRelaciones(id, d, tx);
      return (await this.cargar([id], tx))[0];
    });
  }

  /** Borrado lógico (como el script: atr_eliminado_en) y queda INACTIVA. */
  async eliminar(id: number, u: Usuario) {
    await this.db.tx(async (tx) => {
      await this.editable(id, u, tx);
      await tx.query(`UPDATE atraccion SET atr_eliminado_en = now(), atr_estado = 'INACTIVA' WHERE atr_id = $1`, [id]);
    });
  }

  // ── Eventos entrantes ───────────────────────────────────────────────────
  /**
   * RESENA_PUBLICADA (ms_review): reemplaza al trigger trg_resena_calificacion del script original.
   * PRECIO_ACTUALIZADO (ms_pricing): actualiza la proyección tarifa_vigente.
   * Idempotente: un event_id ya procesado se ignora (inbox).
   */
  async evento(e: EventoEntrante): Promise<{ procesado: boolean }> {
    return this.db.tx(async (tx) => {
      const nuevo = await tx.one('INSERT INTO evento_recibido (evr_id, evr_tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING evr_id', [e.event_id, e.event_type]);
      if (!nuevo) return { procesado: false };
      const d = e.data;
      const atrId = Number(d.atr_id);
      if (!Number.isInteger(atrId) || atrId < 1) throw new BadRequestException('data.atr_id es obligatorio.');
      const existe = await tx.one('SELECT 1 FROM atraccion WHERE atr_id = $1', [atrId]);
      if (!existe) throw new UnprocessableEntityException({ message: `La atracción ${atrId} no existe en ms_catalog.`, code: 'INVALID_REFERENCE' });
      if (e.event_type === 'RESENA_PUBLICADA') {
        const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        const pil = (d.pilares ?? {}) as Record<string, unknown>;
        await tx.query(
          `UPDATE atraccion SET atr_calificacion_promedio = $2, atr_numero_resenas = $3, atr_pilar_limpieza = $4,
                  atr_pilar_servicio = $5, atr_pilar_relacion_valor = $6, atr_pilar_puntualidad = $7 WHERE atr_id = $1`,
          [atrId, n(d.atr_calificacion_promedio) ?? 0, n(d.atr_numero_resenas) ?? 0, n(pil.limpieza), n(pil.servicio), n(pil.relacion_valor), n(pil.puntualidad)],
        );
      } else {
        const tarifas = (Array.isArray(d.tarifas) ? d.tarifas : []) as { tipo: string; precio: number; moneda?: string }[];
        for (const t of tarifas) {
          await tx.query(
            `INSERT INTO tarifa_vigente (atr_id, tav_tipo, tav_precio, tav_moneda) VALUES ($1, $2, $3, $4)
             ON CONFLICT (atr_id, tav_tipo) DO UPDATE SET tav_precio = EXCLUDED.tav_precio, tav_moneda = EXCLUDED.tav_moneda, tav_actualizado_en = now()`,
            [atrId, t.tipo, t.precio, t.moneda ?? 'USD'],
          );
        }
      }
      return { procesado: true };
    });
  }
}
