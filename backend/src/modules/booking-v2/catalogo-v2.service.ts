import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DbService, HOY_EC, Params } from '../../common/db/db.service';
import { escapeLike } from '../../common/utils/sql';
import { FilaAtraccion, SELECT_ATRACCION, sqlTarifa } from '../atracciones/modelo';
import { hoyEc, horaActualEc } from '../atracciones/utils/fechas';
import { hora12 } from '../atracciones/utils/hora12';
import { ListAtraccionesQueryV2, SearchAtraccionesRequestV2 } from './dto';
import { MapperV2 } from './mapper-v2';

/** Solo se ofrece a Booking lo publicado y no eliminado. */
const VISIBLE = `a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA'`;
/** Comparación sin tildes ni mayúsculas (sin depender de la extensión unaccent). */
const SIN_TILDES = (x: string) => `translate(lower(${x}), 'áéíóúüñ', 'aeiouun')`;

interface FilaCategoria {
  id: number;
  padre: number | null;
  nombre: string;
  slug: string;
  descripcion: string | null;
  icono: string | null;
  orden: number;
  comida: boolean;
  transporte: boolean;
  guia: boolean;
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

@Injectable()
export class CatalogoV2Service {
  constructor(
    private readonly db: DbService,
    private readonly mapper: MapperV2,
  ) {}

  // ── Categorías ──────────────────────────────────────────────────────────
  private categorias() {
    return this.db.query<FilaCategoria>(
      `SELECT cat_id AS id, cat_padre_id AS padre, cat_nombre AS nombre, cat_slug AS slug, cat_descripcion AS descripcion, cat_icono AS icono,
              cat_orden AS orden, cat_incluye_comida AS comida, cat_incluye_transporte AS transporte, cat_incluye_guia AS guia
         FROM categoria WHERE cat_activa ORDER BY cat_orden, cat_nombre`,
    );
  }

  private nodo(c: FilaCategoria, hijos: NodoCategoria[] = []): NodoCategoria {
    return {
      id: `cat-${c.id}`,
      nombre: c.nombre,
      slug: c.slug,
      ...(c.descripcion ? { descripcion: c.descripcion } : {}),
      ...(c.icono ? { icono: c.icono } : {}),
      incluye_comida: c.comida,
      incluye_transporte: c.transporte,
      incluye_guia: c.guia,
      // Guía de integración §7.3: también en inglés
      includes_food: c.comida,
      includes_transport: c.transporte,
      includes_guide: c.guia,
      orden: c.orden,
      subcategorias: hijos,
    };
  }

  /** Árbol recursivo (padre → hijas) con las banderas de inclusión. */
  async arbol(): Promise<NodoCategoria[]> {
    const todas = await this.categorias();
    const ids = new Set(todas.map((c) => c.id));
    const construir = (padre: number | null, visitados: Set<number>): NodoCategoria[] =>
      todas
        .filter((c) => (padre === null ? c.padre === null || !ids.has(c.padre) : c.padre === padre) && !visitados.has(c.id))
        .map((c) => this.nodo(c, construir(c.id, new Set([...visitados, c.id]))));
    return construir(null, new Set());
  }

  /** Lista plana: hijas directas de `padre_id`, o las raíz si no se indica. */
  async planas(padreId?: string) {
    const todas = await this.categorias();
    let padre: number | null = null;
    if (padreId) {
      const m = /^(?:cat-)?(\d{1,9})$/.exec(padreId.trim());
      const p = todas.find((c) => (m ? c.id === Number(m[1]) : c.slug === padreId.trim().toLowerCase()));
      if (!p) return [];
      padre = p.id;
    }
    return todas
      .filter((c) => c.padre === padre)
      .map((c) => ({
        id: `cat-${c.id}`,
        padre_id: c.padre === null ? null : `cat-${c.padre}`,
        nombre: c.nombre,
        slug: c.slug,
        incluye_comida: c.comida,
        incluye_transporte: c.transporte,
        incluye_guia: c.guia,
        includes_food: c.comida,
        includes_transport: c.transporte,
        includes_guide: c.guia,
      }));
  }

  // ── Atracciones ─────────────────────────────────────────────────────────
  private async cargar(ids: string[]): Promise<FilaAtraccion[]> {
    if (!ids.length) return [];
    const filas = await this.db.query<FilaAtraccion>(`${SELECT_ATRACCION} WHERE a.atr_id = ANY($1::bigint[])`, [ids]);
    const porId = new Map(filas.map((f) => [f.id, f]));
    return ids.map((id) => porId.get(id)).filter((f): f is FilaAtraccion => !!f);
  }

  /** Búsqueda común a GET /atracciones y POST /atracciones/search. */
  private async buscar(w: string[], p: Params, orden: string, page: number, limit: number) {
    const filas = await this.db.query<{ id: string; total: number }>(
      `SELECT a.atr_id::text AS id, COUNT(*) OVER ()::int AS total
         FROM atraccion a JOIN ciudad c0 ON c0.ciu_id = a.ciu_id
        WHERE ${[VISIBLE, ...w].join(' AND ')}
        ORDER BY ${orden}, a.atr_id
        LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`,
      p.values,
    );
    const total = filas[0]?.total ?? 0;
    const data = (await this.cargar(filas.map((f) => f.id))).map((f) => this.mapper.card(f));
    return {
      request_id: `req-atr-${randomUUID().slice(0, 8)}`,
      metadata: { total_results: total, page, limit, total_pages: Math.ceil(total / limit), next_cursor: null },
      data,
    };
  }

  private filtrosComunes(
    q: { categoria_id?: string; incluye_comida?: boolean; incluye_transporte?: boolean; incluye_guia?: boolean },
    w: string[],
    p: Params,
  ) {
    if (q.categoria_id) {
      // La categoría y sus subcategorías
      const cond = refCategoria(q.categoria_id, p);
      w.push(`EXISTS (SELECT 1 FROM atraccion_categoria ac JOIN categoria c2 ON c2.cat_id = ac.cat_id
                       WHERE ac.atr_id = a.atr_id AND (c2.cat_id IN (SELECT c.cat_id FROM categoria c WHERE ${cond})
                         OR c2.cat_padre_id IN (SELECT c.cat_id FROM categoria c WHERE ${cond})))`);
    }
    if (q.incluye_comida !== undefined) w.push(`a.atr_incluye_comida = ${p.add(q.incluye_comida)}`);
    if (q.incluye_transporte !== undefined) w.push(`a.atr_incluye_transporte = ${p.add(q.incluye_transporte)}`);
    if (q.incluye_guia !== undefined) w.push(`a.atr_incluye_guia = ${p.add(q.incluye_guia)}`);
  }

  async listar(q: ListAtraccionesQueryV2) {
    const p = new Params();
    const w: string[] = [];
    if (q.city) w.push(`${SIN_TILDES('c0.ciu_nombre')} LIKE ${SIN_TILDES(p.add(`%${escapeLike(q.city)}%`))}`);
    this.filtrosComunes(q, w, p);
    const orden = {
      PRICE_ASC: `${sqlTarifa('ADULTO')} ASC NULLS LAST`,
      PRICE_DESC: `${sqlTarifa('ADULTO')} DESC NULLS LAST`,
      RATING_DESC: 'a.atr_calificacion_promedio DESC, a.atr_numero_resenas DESC',
      POPULARITY: `(SELECT COUNT(*) FROM reserva r JOIN disponibilidad d ON d.dis_id = r.dis_id WHERE d.atr_id = a.atr_id) DESC, a.atr_destacada DESC`,
    }[q.sort ?? 'POPULARITY'];
    return this.buscar(w, p, orden, q.page ?? 1, q.limit ?? 10);
  }

  async search(b: SearchAtraccionesRequestV2) {
    const p = new Params();
    const w: string[] = [];
    if (b.query) {
      const t = SIN_TILDES(p.add(`%${escapeLike(b.query)}%`));
      w.push(`(${SIN_TILDES('a.atr_nombre')} LIKE ${t} OR ${SIN_TILDES('c0.ciu_nombre')} LIKE ${t} OR ${SIN_TILDES('a.atr_descripcion')} LIKE ${t})`);
    }
    if (b.ciudad) w.push(`${SIN_TILDES('c0.ciu_nombre')} LIKE ${SIN_TILDES(p.add(`%${escapeLike(b.ciudad)}%`))}`);
    this.filtrosComunes(b, w, p);
    if (b.precio_min != null && b.precio_max != null && b.precio_min > b.precio_max) {
      throw new BadRequestException('precio_min no puede ser mayor que precio_max.');
    }
    if (b.precio_min != null) w.push(`${sqlTarifa('ADULTO')} >= ${p.add(b.precio_min)}`);
    if (b.precio_max != null) w.push(`${sqlTarifa('ADULTO')} <= ${p.add(b.precio_max)}`);
    if (b.duracion_max_horas != null) w.push(`a.atr_duracion_horas <= ${p.add(b.duracion_max_horas)}`);
    if (b.idioma_guia) {
      w.push(`EXISTS (SELECT 1 FROM atraccion_idioma ai JOIN idioma i ON i.idi_id = ai.idi_id
                       WHERE ai.atr_id = a.atr_id AND (${SIN_TILDES('i.idi_nombre')} = ${SIN_TILDES(p.add(b.idioma_guia))}
                                                       OR lower(i.idi_codigo) = lower(${p.add(b.idioma_guia)})))`);
    }
    if (b.accesible_silla_ruedas) w.push('a.atr_accesible_silla');
    if (b.animales_asistencia) w.push('a.atr_animales_servicio');
    if (b.cancelacion_gratuita) w.push('a.atr_cancelacion_gratuita');
    if (b.fecha_inicio || b.fecha_fin) {
      const desde = (b.fecha_inicio ?? b.fecha_fin)!.slice(0, 10);
      const hasta = (b.fecha_fin ?? b.fecha_inicio)!.slice(0, 10);
      if (hasta < desde) throw new BadRequestException('fecha_fin no puede ser anterior a fecha_inicio.');
      // Opera algún día del rango (máx. 31 días) con cupos para los adultos pedidos
      w.push(`EXISTS (
        SELECT 1 FROM generate_series(GREATEST(${p.add(desde)}::date, ${HOY_EC}), LEAST(${p.add(hasta)}::date, ${p.add(desde)}::date + 31), interval '1 day') g(dia)
          JOIN horario h ON h.atr_id = a.atr_id AND h.hor_activo
          LEFT JOIN disponibilidad d ON d.atr_id = a.atr_id AND d.hor_id = h.hor_id AND d.dis_fecha = g.dia::date
         WHERE NOT EXISTS (SELECT 1 FROM fecha_bloqueada fb WHERE fb.atr_id = a.atr_id AND fb.fb_fecha = g.dia::date)
           AND NOT COALESCE(d.dis_cerrada, FALSE)
           AND COALESCE(d.dis_cupo_total, h.hor_cupo) - COALESCE(d.dis_cupo_reservado, 0) >= ${p.add(b.adult_count ?? 1)})`);
    }
    return this.buscar(w, p, 'a.atr_destacada DESC, a.atr_calificacion_promedio DESC', b.page ?? 1, b.limit ?? 10);
  }

  /** Atracción visible por UUID o slug (404 si no existe o no está publicada). */
  async fila(ref: string): Promise<FilaAtraccion> {
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const r = await this.db.one<{ id: string }>(
      `SELECT a.atr_id::text AS id FROM atraccion a WHERE ${VISIBLE} AND ${esUuid ? 'a.atr_uuid = $1::uuid' : 'a.atr_slug = $1'}`,
      [esUuid ? ref.toLowerCase() : ref.toLowerCase()],
    );
    if (!r) throw new NotFoundException(`La atracción ${ref} no existe o no está disponible.`);
    return (await this.cargar([r.id]))[0];
  }

  async acuerdo() {
    const a = await this.db.one<{ permite: boolean; maximo: number }>(
      `SELECT apr_permite AS permite, apr_descuento_maximo::float8 AS maximo FROM acuerdo_promocion
        WHERE apr_id = 1 AND apr_vigencia_hasta >= ${HOY_EC}`,
    );
    return a ?? { permite: false, maximo: 0 };
  }

  async detalle(ref: string) {
    const [f, acuerdo] = await Promise.all([this.fila(ref), this.acuerdo()]);
    return this.mapper.detalle(f, acuerdo);
  }

  /** Turnos del día con cupos y estado (DISPONIBLE, ULTIMOS_CUPOS de 1 a 5 —regla confirmada por Booking—, AGOTADO). */
  async disponibilidad(ref: string, fecha: string) {
    const f = await this.fila(ref);
    const dia = fecha.slice(0, 10);
    const hoy = hoyEc();
    if (dia < hoy) throw new BadRequestException('La fecha ya pasó: consulta desde hoy en adelante.');
    const turnos = await this.db.query<{ hora: string; total: number; disponibles: number }>(
      `SELECT to_char(h.hor_hora, 'HH24:MI') AS hora, COALESCE(d.dis_cupo_total, h.hor_cupo) AS total,
              CASE WHEN fb.fb_id IS NOT NULL OR COALESCE(d.dis_cerrada, FALSE) THEN 0
                   ELSE GREATEST(COALESCE(d.dis_cupo_total, h.hor_cupo) - COALESCE(d.dis_cupo_reservado, 0), 0) END AS disponibles
         FROM horario h
         LEFT JOIN disponibilidad d ON d.atr_id = h.atr_id AND d.hor_id = h.hor_id AND d.dis_fecha = $2
         LEFT JOIN fecha_bloqueada fb ON fb.atr_id = h.atr_id AND fb.fb_fecha = $2
        WHERE h.atr_id = $1 AND h.hor_activo ORDER BY h.hor_hora`,
      [f.id, dia],
    );
    const ahora = horaActualEc();
    const slots = turnos.map((t) => {
      // Una salida de hoy que ya partió no se puede reservar
      const libres = dia === hoy && t.hora <= ahora ? 0 : t.disponibles;
      const estado = libres === 0 ? 'AGOTADO' : libres <= 5 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE';
      const adulto = f.precio_adulto ?? 0;
      const nino = f.precio_nino ?? f.precio_adulto ?? 0;
      return {
        slot_id: `slot-${dia.replace(/-/g, '')}-${t.hora.replace(':', '')}`,
        time: hora12(t.hora),
        hora: hora12(t.hora),
        time_24h: `${t.hora}:00`,
        hora_24h: `${t.hora}:00`,
        // v3 (TimeSlotItem): nombres en inglés obligatorios; los de v2 en español se mantienen
        total_slots: t.total,
        available_slots: libres,
        status: estado,
        price_adult: adulto,
        price_child: nino,
        cupos_totales: t.total,
        cupos_disponibles: libres,
        estado,
        precio_adulto_slot: adulto,
        precio_nino_slot: nino,
      };
    });
    const total = slots.reduce((s, x) => s + x.cupos_disponibles, 0);
    return {
      atraccion_id: f.uuid,
      date: dia,
      fecha: dia,
      total_available_slots: total,
      total_cupos_disponibles: total,
      time_slots: slots,
      turnos: slots,
    };
  }
}
