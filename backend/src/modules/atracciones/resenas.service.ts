import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { DbService, HOY_EC, Params, Sql } from '../../common/db/db.service';
import { paginate } from '../../common/utils/hateoas';
import { AtraccionMapper } from './atraccion.mapper';
import { AtraccionesService } from './atracciones.service';
import { CreateResenaDto, ResenasQueryDto } from './dto/resena.dto';

interface FilaResena {
  id: string;
  autor: string;
  puntuacion: number;
  comentario: string;
  visible: boolean;
  creado_en: Date;
  atr_id: string;
  atr_uuid: string;
  atr_nombre: string;
  foto: string | null;
}

const SELECT_RESENA = `
  SELECT r.ren_id::text AS id, r.ren_autor_nombre AS autor, r.ren_puntuacion AS puntuacion, r.ren_comentario AS comentario,
         r.ren_visible AS visible, r.ren_creado_en AS creado_en, a.atr_id::text AS atr_id, a.atr_uuid::text AS atr_uuid,
         a.atr_nombre, (SELECT f.fot_url FROM atraccion_foto f WHERE f.atr_id = a.atr_id ORDER BY f.fot_orden, f.fot_id LIMIT 1) AS foto
    FROM resena r JOIN atraccion a ON a.atr_id = r.atr_id`;

@Injectable()
export class ResenasService {
  constructor(
    private readonly db: DbService,
    private readonly atracciones: AtraccionesService,
    private readonly mapper: AtraccionMapper,
    private readonly bitacora: BitacoraService,
  ) {}

  private toDto(r: FilaResena, admin = false) {
    return {
      id: r.id,
      author: r.autor,
      rating: r.puntuacion,
      comment: r.comentario,
      created_at: new Date(r.creado_en).toISOString(),
      ...(admin ? { visible: r.visible, attraction: { id: r.atr_uuid, name: r.atr_nombre, photo: this.mapper.absUrl(r.foto) } } : {}),
    };
  }

  /** Recalcula el promedio y el número de reseñas visibles de la atracción. */
  async recalcular(atrId: string, sql: Sql = this.db) {
    await sql.query(
      `UPDATE atraccion a SET atr_calificacion_promedio = COALESCE(x.promedio, 0), atr_numero_resenas = x.n
         FROM (SELECT ROUND(AVG(ren_puntuacion)::numeric, 2) AS promedio, COUNT(*)::int AS n
                 FROM resena WHERE atr_id = $1 AND ren_visible) x
        WHERE a.atr_id = $1`,
      [atrId],
    );
  }

  async listPublic(atrUuid: string, query: ResenasQueryDto) {
    const a = await this.atracciones.getRow(atrUuid);
    const page = query.page ?? 1;
    const limit = query.limit ?? 5;
    const p = new Params();
    const w = [`r.atr_id = ${p.add(a.id)}`, 'r.ren_visible'];
    if (query.rating) w.push(`r.ren_puntuacion = ${p.add(query.rating)}`);
    const where = `WHERE ${w.join(' AND ')}`;
    const [{ total }] = await this.db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM resena r ${where}`, p.values);
    const rows = await this.db.query<FilaResena>(
      `${SELECT_RESENA} ${where} ORDER BY r.ren_creado_en DESC LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    const dist = await this.db.query<{ rating: number; n: number }>(
      'SELECT ren_puntuacion AS rating, COUNT(*)::int AS n FROM resena WHERE atr_id = $1 AND ren_visible GROUP BY ren_puntuacion',
      [a.id],
    );
    const distribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    dist.forEach((d) => (distribution[d.rating] = d.n));
    return { ...paginate(rows.map((r) => this.toDto(r)), total, page, limit, `/atracciones/${atrUuid}/reviews`), distribution };
  }

  /** ¿Puede reseñar? Debe haber vivido la experiencia (reserva confirmada ya pasada) y no haberla reseñado. */
  async elegibilidad(atrUuid: string, user: AuthUser) {
    const a = await this.atracciones.getRow(atrUuid);
    if (await this.db.one('SELECT 1 FROM resena WHERE atr_id = $1 AND usu_id = $2', [a.id, user.sub])) {
      return { can_review: false, reason: 'Ya dejaste una reseña para esta experiencia.' };
    }
    const vivida = await this.db.one(
      `SELECT 1 FROM reserva r JOIN estado e ON e.est_id = r.est_id JOIN orden_detalle dt ON dt.det_id = r.det_id JOIN orden o ON o.ord_id = dt.ord_id
        WHERE dt.atr_id = $1 AND o.usu_id = $2 AND e.est_codigo IN ('CONFIRMADA', 'COMPLETADA') AND r.res_fecha <= ${HOY_EC} LIMIT 1`,
      [a.id, user.sub],
    );
    if (!vivida) return { can_review: false, reason: 'Podrás opinar después de vivir esta experiencia con una reserva confirmada.' };
    return { can_review: true };
  }

  async create(atrUuid: string, dto: CreateResenaDto, user: AuthUser) {
    const a = await this.atracciones.getRow(atrUuid);
    const eleg = await this.elegibilidad(atrUuid, user);
    if (!eleg.can_review) {
      if (eleg.reason?.startsWith('Ya')) throw new ConflictException(eleg.reason);
      throw new ForbiddenException(eleg.reason);
    }
    const id = await this.db.tx(async (tx) => {
      const r = await tx.one<{ id: string }>(
        `INSERT INTO resena (atr_id, usu_id, ren_autor_nombre, ren_puntuacion, ren_comentario) VALUES ($1, $2, $3, $4, $5) RETURNING ren_id::text AS id`,
        [a.id, user.sub, user.nombre.slice(0, 120), dto.rating, dto.comment],
      );
      await this.recalcular(a.id, tx);
      return r!.id;
    });
    return this.toDto((await this.db.one<FilaResena>(`${SELECT_RESENA} WHERE r.ren_id = $1`, [id]))!);
  }

  // ── Moderación (admin) ────────────────────────────────────────────────
  async listAdmin(query: ResenasQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const p = new Params();
    const w: string[] = [];
    if (query.status === 'visible') w.push('r.ren_visible');
    if (query.status === 'hidden') w.push('NOT r.ren_visible');
    if (query.rating) w.push(`r.ren_puntuacion = ${p.add(query.rating)}`);
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const [{ total }] = await this.db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM resena r ${where}`, p.values);
    const rows = await this.db.query<FilaResena>(
      `${SELECT_RESENA} ${where} ORDER BY r.ren_creado_en DESC LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    const extra = `${query.status ? `&status=${query.status}` : ''}${query.rating ? `&rating=${query.rating}` : ''}`;
    return paginate(rows.map((r) => this.toDto(r, true)), total, page, limit, '/resenas', extra);
  }

  async moderar(id: string, visible: boolean, user: AuthUser) {
    const r = await this.db.tx(async (tx) => {
      const fila = await tx.one<{ atr_id: string }>('UPDATE resena SET ren_visible = $2 WHERE ren_id = $1 RETURNING atr_id::text', [id, visible]);
      if (!fila) throw new NotFoundException('Reseña no encontrada.');
      await this.recalcular(fila.atr_id, tx);
      return fila;
    });
    await this.bitacora.registrar(user.sub, visible ? 'MOSTRAR' : 'OCULTAR', 'resena', id, { atraccion: r.atr_id });
    return this.toDto((await this.db.one<FilaResena>(`${SELECT_RESENA} WHERE r.ren_id = $1`, [id]))!, true);
  }

  async remove(id: string, user: AuthUser) {
    await this.db.tx(async (tx) => {
      const fila = await tx.one<{ atr_id: string }>('DELETE FROM resena WHERE ren_id = $1 RETURNING atr_id::text', [id]);
      if (!fila) throw new NotFoundException('Reseña no encontrada.');
      await this.recalcular(fila.atr_id, tx);
    });
    await this.bitacora.registrar(user.sub, 'ELIMINAR', 'resena', id);
  }
}
