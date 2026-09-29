import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { DbService, Params, Sql } from '../../common/db/db.service';
import { AtraccionMapper } from './atraccion.mapper';
import { CreateCategoriaDto, CreateDestinoDto, CreateOperadorDto, UpdateCategoriaDto, UpdateDestinoDto, UpdateOperadorDto } from './dto/catalogo.dto';
import { slugify } from './modelo';

/** Atracciones visibles (publicadas y no eliminadas) */
const PUBLICADA = `a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA'`;

/** Construye SET col = $n solo con los campos presentes en el DTO. */
function sets(p: Params, mapa: Record<string, [string, unknown]>): string[] {
  return Object.values(mapa)
    .filter(([, v]) => v !== undefined)
    .map(([col, v]) => `${col} = ${p.add(v)}`);
}

@Injectable()
export class CatalogoService {
  constructor(
    private readonly db: DbService,
    private readonly mapper: AtraccionMapper,
    private readonly bitacora: BitacoraService,
  ) {}

  // ── Geografía e idiomas (solo lectura) ─────────────────────────────────
  listProvincias() {
    return this.db.query(
      `SELECT p.prov_id AS id, p.prov_nombre AS nombre, p.prov_codigo AS codigo, r.reg_nombre AS region
         FROM provincia p JOIN region r ON r.reg_id = p.reg_id WHERE p.prov_activa ORDER BY p.prov_nombre`,
    );
  }

  listIdiomas() {
    return this.db.query('SELECT idi_codigo AS codigo, idi_nombre AS nombre FROM idioma ORDER BY idi_id');
  }

  // ── Categorías ────────────────────────────────────────────────────────
  private readonly SELECT_CATEGORIA = `
    SELECT c.cat_id AS id, c.cat_padre_id AS padre_id, c.cat_slug AS slug, c.cat_nombre AS nombre, c.cat_icono AS icono,
           c.cat_descripcion AS descripcion, c.cat_orden AS orden, c.cat_activa AS activa,
           (SELECT COUNT(*)::int FROM atraccion_categoria ac JOIN atraccion a ON a.atr_id = ac.atr_id
             WHERE ac.cat_id = c.cat_id AND ${PUBLICADA}) AS total_atracciones
      FROM categoria c`;

  listCategorias(all: boolean) {
    return this.db.query(`${this.SELECT_CATEGORIA} ${all ? '' : 'WHERE c.cat_activa'} ORDER BY c.cat_orden, c.cat_nombre`);
  }

  private async categoria(id: number | string, sql: Sql = this.db) {
    const c = await sql.one(`${this.SELECT_CATEGORIA} WHERE c.cat_id = $1`, [id]);
    if (!c) throw new NotFoundException('Categoría no encontrada.');
    return c;
  }

  private async validarPadre(sql: Sql, id: number | null, padre: number | null | undefined) {
    if (padre == null) return;
    if (id !== null && Number(padre) === Number(id)) throw new BadRequestException('Una categoría no puede ser su propia categoría padre.');
    if (!(await sql.one('SELECT 1 FROM categoria WHERE cat_id = $1', [padre]))) throw new BadRequestException('La categoría padre no existe.');
    if (id !== null) {
      // Evita ciclos: el padre no puede descender de esta categoría
      const ciclo = await sql.one(
        `WITH RECURSIVE sube AS (SELECT cat_id, cat_padre_id FROM categoria WHERE cat_id = $1
                                  UNION ALL SELECT c.cat_id, c.cat_padre_id FROM categoria c JOIN sube s ON c.cat_id = s.cat_padre_id)
         SELECT 1 FROM sube WHERE cat_id = $2`,
        [padre, id],
      );
      if (ciclo) throw new BadRequestException('La categoría padre elegida crearía un ciclo.');
    }
  }

  async createCategoria(dto: CreateCategoriaDto, user: AuthUser) {
    const slug = dto.slug || slugify(dto.nombre);
    if (await this.db.one('SELECT 1 FROM categoria WHERE cat_slug = $1', [slug])) throw new ConflictException(`Ya existe una categoría con el slug "${slug}".`);
    await this.validarPadre(this.db, null, dto.padre_id);
    const r = await this.db.one<{ id: number }>(
      `INSERT INTO categoria (cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_activa)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'map-pin'), COALESCE($6, 0), COALESCE($7, TRUE)) RETURNING cat_id AS id`,
      [dto.padre_id ?? null, dto.nombre, slug, dto.descripcion ?? null, dto.icono ?? null, dto.orden ?? null, dto.activa ?? null],
    );
    await this.bitacora.registrar(user.sub, 'CREAR', 'categoria', r!.id, { slug });
    return this.categoria(r!.id);
  }

  async updateCategoria(id: string, dto: UpdateCategoriaDto, user: AuthUser) {
    await this.categoria(id);
    if (dto.slug && (await this.db.one('SELECT 1 FROM categoria WHERE cat_slug = $1 AND cat_id <> $2', [dto.slug, id]))) {
      throw new ConflictException(`Ya existe una categoría con el slug "${dto.slug}".`);
    }
    await this.validarPadre(this.db, Number(id), dto.padre_id);
    const p = new Params();
    const s = sets(p, {
      nombre: ['cat_nombre', dto.nombre],
      slug: ['cat_slug', dto.slug],
      icono: ['cat_icono', dto.icono],
      descripcion: ['cat_descripcion', dto.descripcion],
      orden: ['cat_orden', dto.orden],
      activa: ['cat_activa', dto.activa],
      padre: ['cat_padre_id', dto.padre_id],
    });
    if (s.length) await this.db.query(`UPDATE categoria SET ${s.join(', ')} WHERE cat_id = ${p.add(id)}`, p.values);
    await this.bitacora.registrar(user.sub, 'ACTUALIZAR', 'categoria', id, { campos: Object.keys(dto) });
    return this.categoria(id);
  }

  async deleteCategoria(id: string, user: AuthUser) {
    await this.categoria(id);
    const uso = await this.db.one<{ atr: number; hijas: number }>(
      `SELECT (SELECT COUNT(*)::int FROM atraccion_categoria WHERE cat_id = $1) AS atr,
              (SELECT COUNT(*)::int FROM categoria WHERE cat_padre_id = $1) AS hijas`,
      [id],
    );
    if (uso!.atr > 0) throw new ConflictException(`La categoría tiene ${uso!.atr} atracción(es) asociadas. Desactívala en lugar de eliminarla.`);
    if (uso!.hijas > 0) throw new ConflictException(`La categoría tiene ${uso!.hijas} subcategoría(s). Muévelas o elimínalas primero.`);
    await this.db.query('DELETE FROM categoria WHERE cat_id = $1', [id]);
    await this.bitacora.registrar(user.sub, 'ELIMINAR', 'categoria', id);
  }

  // ── Destinos (ciudades) ───────────────────────────────────────────────
  private readonly SELECT_DESTINO = `
    SELECT c.ciu_id AS id, c.ciu_id AS codigo, c.ciu_codigo AS codigo_inec, c.ciu_nombre AS nombre,
           p.prov_id AS provincia_id, p.prov_nombre AS provincia, r.reg_nombre AS region,
           c.ciu_descripcion AS descripcion, c.ciu_imagen AS imagen, c.ciu_activa AS activo,
           (SELECT COUNT(*)::int FROM atraccion a WHERE a.ciu_id = c.ciu_id AND ${PUBLICADA}) AS total_atracciones
      FROM ciudad c JOIN provincia p ON p.prov_id = c.prov_id JOIN region r ON r.reg_id = p.reg_id`;

  private conImagen = <T extends { imagen?: string | null }>(d: T): T => ({ ...d, imagen: d.imagen ? this.mapper.absUrl(d.imagen) : null });

  /**
   * Público: solo ciudades con atracciones publicadas (los destinos del sitio).
   * Con ?all=true (attractions:write): todas, para gestionarlas.
   */
  async listDestinos(all: boolean) {
    const rows = await this.db.query<{ imagen: string | null; total_atracciones: number }>(
      `SELECT * FROM (${this.SELECT_DESTINO} ${all ? '' : 'WHERE c.ciu_activa'}) x
        ${all ? '' : 'WHERE x.total_atracciones > 0'} ORDER BY x.nombre`,
    );
    return rows.map(this.conImagen);
  }

  private async destino(id: number | string) {
    const d = await this.db.one<{ imagen: string | null }>(`${this.SELECT_DESTINO} WHERE c.ciu_id = $1`, [id]);
    if (!d) throw new NotFoundException('Destino no encontrado.');
    return this.conImagen(d);
  }

  async createDestino(dto: CreateDestinoDto, user: AuthUser) {
    if (await this.db.one('SELECT 1 FROM ciudad WHERE ciu_codigo = $1', [dto.codigo_inec])) throw new ConflictException(`Ya existe una ciudad con el código ${dto.codigo_inec}.`);
    if (await this.db.one('SELECT 1 FROM ciudad WHERE prov_id = $1 AND ciu_nombre = $2', [dto.provincia_id, dto.nombre])) {
      throw new ConflictException(`Ya existe "${dto.nombre}" en esa provincia.`);
    }
    const r = await this.db.one<{ id: number }>(
      `INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id, ciu_descripcion, ciu_imagen, ciu_activa)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE)) RETURNING ciu_id AS id`,
      [dto.nombre, dto.codigo_inec, dto.provincia_id, dto.descripcion ?? null, dto.imagen ? this.mapper.relUrl(dto.imagen) : null, dto.activo ?? null],
    );
    await this.bitacora.registrar(user.sub, 'CREAR', 'ciudad', r!.id, { nombre: dto.nombre });
    return this.destino(r!.id);
  }

  async updateDestino(id: string, dto: UpdateDestinoDto, user: AuthUser) {
    await this.destino(id);
    if (dto.codigo_inec && (await this.db.one('SELECT 1 FROM ciudad WHERE ciu_codigo = $1 AND ciu_id <> $2', [dto.codigo_inec, id]))) {
      throw new ConflictException(`Ya existe una ciudad con el código ${dto.codigo_inec}.`);
    }
    await this.db.tx(async (tx) => {
      const p = new Params();
      const s = sets(p, {
        nombre: ['ciu_nombre', dto.nombre],
        codigo: ['ciu_codigo', dto.codigo_inec],
        prov: ['prov_id', dto.provincia_id],
        desc: ['ciu_descripcion', dto.descripcion],
        img: ['ciu_imagen', dto.imagen === undefined ? undefined : dto.imagen ? this.mapper.relUrl(dto.imagen) : null],
        activo: ['ciu_activa', dto.activo],
      });
      // Si cambia la provincia, la FK compuesta (ciu_id, prov_id) ON UPDATE CASCADE mueve también
      // sus atracciones y direcciones a la nueva provincia.
      if (s.length) await tx.query(`UPDATE ciudad SET ${s.join(', ')} WHERE ciu_id = ${p.add(id)}`, p.values);
    });
    await this.bitacora.registrar(user.sub, 'ACTUALIZAR', 'ciudad', id, { campos: Object.keys(dto) });
    return this.destino(id);
  }

  async deleteDestino(id: string, user: AuthUser) {
    await this.destino(id);
    const uso = await this.db.one<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM atraccion WHERE ciu_id = $1) + (SELECT COUNT(*) FROM direccion WHERE ciu_id = $1) AS n`,
      [id],
    );
    if (Number(uso!.n) > 0) throw new ConflictException(`El destino tiene ${uso!.n} registro(s) asociados. Desactívalo en lugar de eliminarlo.`);
    await this.db.query('DELETE FROM ciudad WHERE ciu_id = $1', [id]);
    await this.bitacora.registrar(user.sub, 'ELIMINAR', 'ciudad', id);
  }

  // ── Operadores ────────────────────────────────────────────────────────
  private readonly SELECT_OPERADOR = `
    SELECT o.ope_id::text AS id, o.ope_codigo AS codigo, o.ope_nombre AS nombre, o.ope_ruc AS ruc, o.ope_correo AS email,
           o.ope_telefono AS telefono, o.ope_direccion AS direccion, o.prov_id AS provincia_id, p.prov_nombre AS provincia,
           o.ope_activo AS activo,
           (SELECT COUNT(*)::int FROM atraccion a WHERE a.ope_id = o.ope_id AND a.atr_eliminado_en IS NULL) AS total_atracciones,
           (SELECT COUNT(*)::int FROM operador_usuario ou WHERE ou.ope_id = o.ope_id AND ou.opeu_activo) AS total_usuarios
      FROM operador o JOIN provincia p ON p.prov_id = o.prov_id`;

  listOperadores(all: boolean) {
    return this.db.query(`${this.SELECT_OPERADOR} ${all ? '' : 'WHERE o.ope_activo'} ORDER BY o.ope_nombre`);
  }

  private async operador(id: string, sql: Sql = this.db) {
    const o = await sql.one(`${this.SELECT_OPERADOR} WHERE o.ope_id = $1`, [id]);
    if (!o) throw new NotFoundException('Operador no encontrado.');
    return o;
  }

  private async rucLibre(ruc: string | null | undefined, excepto?: string) {
    if (ruc && (await this.db.one('SELECT 1 FROM operador WHERE ope_ruc = $1 AND ope_id IS DISTINCT FROM $2', [ruc, excepto ?? null]))) {
      throw new ConflictException(`Ya existe un operador con el RUC ${ruc}.`);
    }
  }

  /**
   * El código se calcula dentro de una transacción con un bloqueo consultivo
   * (auditoría API-014): dos altas simultáneas no obtienen el mismo número.
   */
  async createOperador(dto: CreateOperadorDto, user: AuthUser) {
    await this.rucLibre(dto.ruc);
    const id = await this.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['operador.ope_codigo']);
      let codigo = dto.codigo;
      if (!codigo) {
        codigo = (await tx.one<{ c: number }>('SELECT COALESCE(MAX(ope_codigo), 100) + 1 AS c FROM operador'))!.c;
      } else if (await tx.one('SELECT 1 FROM operador WHERE ope_codigo = $1', [codigo])) {
        throw new ConflictException(`Ya existe un operador con el código ${codigo}.`);
      }
      const r = await tx.one<{ id: string }>(
        `INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id, ope_activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE)) RETURNING ope_id::text AS id`,
        [codigo, dto.nombre, dto.ruc ?? null, dto.email ?? null, dto.telefono ?? null, dto.direccion ?? null, dto.provincia_id, dto.activo ?? null],
      );
      return r!.id;
    });
    await this.bitacora.registrar(user.sub, 'CREAR', 'operador', id, { nombre: dto.nombre });
    return this.operador(id);
  }

  async updateOperador(id: string, dto: UpdateOperadorDto, user: AuthUser) {
    await this.operador(id);
    await this.rucLibre(dto.ruc, id);
    if (dto.codigo !== undefined && (await this.db.one('SELECT 1 FROM operador WHERE ope_codigo = $1 AND ope_id <> $2', [dto.codigo, id]))) {
      throw new ConflictException(`Ya existe un operador con el código ${dto.codigo}.`);
    }
    const p = new Params();
    const s = sets(p, {
      codigo: ['ope_codigo', dto.codigo],
      nombre: ['ope_nombre', dto.nombre],
      ruc: ['ope_ruc', dto.ruc],
      email: ['ope_correo', dto.email],
      tel: ['ope_telefono', dto.telefono],
      dir: ['ope_direccion', dto.direccion],
      prov: ['prov_id', dto.provincia_id],
      activo: ['ope_activo', dto.activo],
    });
    if (s.length) await this.db.query(`UPDATE operador SET ${s.join(', ')} WHERE ope_id = ${p.add(id)}`, p.values);
    await this.bitacora.registrar(user.sub, 'ACTUALIZAR', 'operador', id, { campos: Object.keys(dto) });
    return this.operador(id);
  }

  async deleteOperador(id: string, user: AuthUser) {
    await this.operador(id);
    const uso = await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM atraccion WHERE ope_id = $1', [id]);
    if (uso!.n > 0) throw new ConflictException(`El operador tiene ${uso!.n} atracción(es). Desactívalo en lugar de eliminarlo.`);
    await this.db.query('DELETE FROM operador WHERE ope_id = $1', [id]);
    await this.bitacora.registrar(user.sub, 'ELIMINAR', 'operador', id);
  }
}
