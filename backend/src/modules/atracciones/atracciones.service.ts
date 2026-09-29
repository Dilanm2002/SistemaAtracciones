import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthUser, esAdmin } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { DbService, HOY_EC, Params, Sql } from '../../common/db/db.service';
import { emitirEvento, EVENTOS, TipoEvento } from '../../common/db/eventos';
import { paginate } from '../../common/utils/hateoas';
import { escapeLike } from '../../common/utils/sql';
import { AtraccionMapper } from './atraccion.mapper';
import { AvailabilityResponseDto, BlockDateDto, CalendarDayDto } from './dto/availability.dto';
import { CreateAtraccionDto } from './dto/create-atraccion.dto';
import { DetailsRequestDto } from './dto/details-request.dto';
import { ListAtraccionesQueryDto } from './dto/list-atracciones.dto';
import { SearchAtraccionesDto } from './dto/search-atracciones.dto';
import { UpdateAtraccionDto } from './dto/update-atraccion.dto';
import { CONTRATO_A_TIPO, FilaAtraccion, SELECT_ATRACCION, slugify, sqlTarifa, TIPOS_DE } from './modelo';
import { diasDelMes, horaActualEc, hoyEc, isoAHoras, sumarDias } from './utils/fechas';

const VISIBLE = `a.atr_eliminado_en IS NULL`;

@Injectable()
export class AtraccionesService {
  constructor(
    private readonly db: DbService,
    private readonly mapper: AtraccionMapper,
    private readonly bitacora: BitacoraService,
  ) {}

  /** Carga filas completas por atr_id conservando el orden recibido. */
  private async cargar(ids: string[], sql: Sql = this.db): Promise<FilaAtraccion[]> {
    if (!ids.length) return [];
    const rows = await sql.query<FilaAtraccion>(`${SELECT_ATRACCION} WHERE a.atr_id = ANY($1::bigint[])`, [ids]);
    const porId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : []));
  }

  /** Healthcheck para el API Gateway: incluye el estado real de la base de datos. */
  async estado() {
    const inicio = Date.now();
    try {
      const r = await this.db.one<{ tablas: number; migraciones: string[]; atracciones: number; reservas: number; eventos: number }>(
        `SELECT (SELECT COUNT(*)::int FROM pg_tables WHERE schemaname = 'public') AS tablas,
                (SELECT array_agg(mig_nombre ORDER BY mig_id) FROM ops.migracion) AS migraciones,
                (SELECT COUNT(*)::int FROM atraccion WHERE atr_eliminado_en IS NULL) AS atracciones,
                (SELECT COUNT(*)::int FROM reserva) AS reservas,
                (SELECT COUNT(*)::int FROM evento) AS eventos`,
      );
      return {
        status: 'UP',
        service: 'atracciones',
        timestamp: new Date().toISOString(),
        database: { status: 'UP', latency_ms: Date.now() - inicio, model: 'database/01_esquema.sql', ...r },
      };
    } catch (e) {
      return { status: 'DEGRADED', service: 'atracciones', timestamp: new Date().toISOString(), database: { status: 'DOWN', error: (e as Error).message } };
    }
  }

  // ── Búsqueda (POST /atracciones/search) ───────────────────────────────
  async search(dto: SearchAtraccionesDto) {
    if (dto.countries?.length && !dto.countries.map((c) => c.toLowerCase()).includes('ec')) {
      return { data: [], metadata: { total_results: 0 }, request_id: randomUUID() };
    }
    const f = dto.filters ?? {};
    if (f.price?.min != null && f.price?.max != null && f.price.min > f.price.max) {
      throw new BadRequestException('filters.price.min no puede ser mayor que filters.price.max');
    }
    if (f.duration?.min_hours != null && f.duration?.max_hours != null && f.duration.min_hours > f.duration.max_hours) {
      throw new BadRequestException('filters.duration.min_hours no puede ser mayor que filters.duration.max_hours');
    }
    const p = new Params();
    const w = [VISIBLE, `a.atr_estado = 'PUBLICADA'`];
    const wPrecio: string[] = [];

    if (dto.cities?.length) w.push(`a.ciu_id = ANY(${p.add(dto.cities)}::int[])`);
    if (f.query?.trim()) {
      const q = p.add(`%${escapeLike(f.query.trim())}%`);
      w.push(`(a.atr_nombre ILIKE ${q} OR a.atr_descripcion ILIKE ${q} OR c.ciu_nombre ILIKE ${q} OR pv.prov_nombre ILIKE ${q})`);
    }
    if (f.categories?.length) {
      w.push(`EXISTS (SELECT 1 FROM atraccion_categoria ac JOIN categoria ca ON ca.cat_id = ac.cat_id
                       WHERE ac.atr_id = a.atr_id AND ca.cat_slug = ANY(${p.add(f.categories)}::text[]))`);
    }
    if (f.regions?.length) w.push(`rg.reg_nombre = ANY(${p.add(f.regions)}::text[])`);
    if (f.duration?.min_hours != null) w.push(`a.atr_duracion_horas >= ${p.add(f.duration.min_hours)}`);
    if (f.duration?.max_hours != null) w.push(`a.atr_duracion_horas <= ${p.add(f.duration.max_hours)}`);
    if (f.free_cancellation) w.push('a.atr_cancelacion_gratuita');
    if (f.product_types?.length) w.push(`a.atr_tipo = ANY(${p.add(f.product_types.flatMap((t) => TIPOS_DE[t]))}::text[])`);
    if (f.rating?.minimum_review_score != null) w.push(`a.atr_calificacion_promedio >= ${p.add(f.rating.minimum_review_score)}`);
    if (f.rating?.minimum_review_count != null) w.push(`a.atr_numero_resenas >= ${p.add(f.rating.minimum_review_count)}`);
    if (f.price?.min != null) wPrecio.push(`precio >= ${p.add(f.price.min)}`);
    if (f.price?.max != null) wPrecio.push(`precio <= ${p.add(f.price.max)}`);

    if (dto.dates) {
      const inicio = dto.dates.start_date.slice(0, 10);
      const fin = dto.dates.end_date.slice(0, 10);
      if (fin < inicio) throw new BadRequestException('dates.end_date no puede ser anterior a dates.start_date');
      const dias = Math.min(Math.round((Date.parse(fin) - Date.parse(inicio)) / 86400000) + 1, 62);
      // Excluye las atracciones que no operan NINGÚN día del rango
      w.push(`(SELECT COUNT(*) FROM fecha_bloqueada fb WHERE fb.atr_id = a.atr_id
                AND fb.fb_fecha BETWEEN ${p.add(inicio)}::date AND ${p.add(fin)}::date) < ${p.add(dias)}`);
    }

    const orden =
      {
        price_asc: 'precio ASC NULLS LAST',
        price_desc: 'precio DESC NULLS LAST',
        rating: 'atr_calificacion_promedio DESC, atr_numero_resenas DESC',
        newest: 'atr_creado_en DESC',
        duration: 'atr_duracion_horas ASC',
      }[dto.sort?.by ?? ''] ?? 'atr_destacada DESC, atr_numero_resenas DESC, atr_calificacion_promedio DESC';

    const rows = dto.rows ?? 12;
    const offset = this.decodePageToken(dto.next_page);
    const base = `
      WITH base AS (
        SELECT a.atr_id, a.atr_destacada, a.atr_numero_resenas, a.atr_calificacion_promedio, a.atr_creado_en,
               a.atr_duracion_horas, ${sqlTarifa('ADULTO')} AS precio
          FROM atraccion a
          JOIN ciudad c ON c.ciu_id = a.ciu_id
          JOIN provincia pv ON pv.prov_id = a.prov_id
          JOIN region rg ON rg.reg_id = pv.reg_id
         WHERE ${w.join(' AND ')})
      SELECT atr_id::text AS id, COUNT(*) OVER ()::int AS total
        FROM base ${wPrecio.length ? `WHERE ${wPrecio.join(' AND ')}` : ''}`;
    const page = await this.db.query<{ id: string; total: number }>(
      `${base} ORDER BY ${orden}, atr_id LIMIT ${p.add(rows)} OFFSET ${p.add(offset)}`,
      p.values,
    );
    let total = page[0]?.total ?? 0;
    if (!page.length && offset > 0) {
      total = (await this.db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (${base}) x`, p.values.slice(0, -2)))?.n ?? 0;
    }
    const items = await this.cargar(page.map((r) => r.id));
    const nextOffset = offset + items.length;

    return {
      data: items.map((a) => this.mapper.toResponse(a)),
      metadata: {
        total_results: total,
        ...(nextOffset < total ? { next_page: Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64') } : {}),
      },
      request_id: randomUUID(),
    };
  }

  private decodePageToken(token?: string): number {
    if (!token) return 0;
    try {
      const { offset } = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      if (Number.isInteger(offset) && offset >= 0) return offset;
    } catch {
      /* token inválido */
    }
    throw new BadRequestException('next_page no es un token de paginación válido.');
  }

  // ── Detalle en lote (POST /atracciones/details) ───────────────────────
  async getDetailsBatch(dto: DetailsRequestDto) {
    const uuids = [...new Set(dto.attractions)];
    const rows = uuids.length
      ? await this.db.query<FilaAtraccion>(`${SELECT_ATRACCION} WHERE a.atr_uuid = ANY($1::uuid[]) AND ${VISIBLE} AND a.atr_estado = 'PUBLICADA'`, [uuids])
      : [];
    const porUuid = new Map(rows.map((a) => [a.uuid, a]));
    const data = uuids.flatMap((u) => (porUuid.has(u) ? [this.mapper.toResponse(porUuid.get(u)!)] : []));
    return {
      request_id: randomUUID(),
      data,
      metadata: {
        total_results: data.length,
        // IDs solicitados que no existen o están inactivos
        not_found: uuids.filter((u) => !porUuid.has(u)),
        language: 'es',
      },
    };
  }

  // ── Listado paginado (GET /atracciones) ───────────────────────────────
  async findAll(query: ListAtraccionesQueryDto, canSeeInactive: boolean) {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? ((query.page ?? 1) - 1) * limit;
    const page = Math.floor(offset / limit) + 1;
    const p = new Params();
    const w = [VISIBLE];

    const status = canSeeInactive ? query.status ?? 'active' : 'active';
    if (status === 'active') w.push(`a.atr_estado = 'PUBLICADA'`);
    else if (status === 'inactive') w.push(`a.atr_estado <> 'PUBLICADA'`);

    if (query.q?.trim()) {
      const q = p.add(`%${escapeLike(query.q.trim())}%`);
      w.push(`(a.atr_nombre ILIKE ${q} OR c.ciu_nombre ILIKE ${q})`);
    }
    if (query.category) {
      w.push(`EXISTS (SELECT 1 FROM atraccion_categoria ac JOIN categoria ca ON ca.cat_id = ac.cat_id
                       WHERE ac.atr_id = a.atr_id AND ca.cat_slug = ${p.add(query.category)})`);
    }
    if (query.city) w.push(`a.ciu_id = ${p.add(query.city)}`);
    if (query.featured === 'true') w.push('a.atr_destacada');
    if (query.operator) w.push(`o.ope_codigo = ${p.add(query.operator)}`);

    const from = `FROM atraccion a JOIN ciudad c ON c.ciu_id = a.ciu_id JOIN operador o ON o.ope_id = a.ope_id WHERE ${w.join(' AND ')}`;
    const [{ total }] = await this.db.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${from}`, p.values);
    const ids = await this.db.query<{ id: string }>(
      `SELECT a.atr_id::text AS id ${from} ORDER BY a.atr_destacada DESC, a.atr_nombre ASC LIMIT ${p.add(limit)} OFFSET ${p.add(offset)}`,
      p.values,
    );
    const items = await this.cargar(ids.map((r) => r.id));

    const extra = [
      query.q && `&q=${encodeURIComponent(query.q)}`,
      query.category && `&category=${encodeURIComponent(query.category)}`,
      query.city && `&city=${query.city}`,
      query.featured && `&featured=${query.featured}`,
      query.operator && `&operator=${query.operator}`,
      canSeeInactive && query.status && `&status=${query.status}`,
    ]
      .filter(Boolean)
      .join('');
    return paginate(items.map((a) => this.mapper.toResponse(a)), total, page, limit, '/atracciones', extra);
  }

  async getRow(uuid: string, canSeeInactive = false, sql: Sql = this.db): Promise<FilaAtraccion> {
    const a = await sql.one<FilaAtraccion>(`${SELECT_ATRACCION} WHERE a.atr_uuid = $1 AND ${VISIBLE}`, [uuid]);
    if (!a || (a.estado !== 'PUBLICADA' && !canSeeInactive)) {
      throw new NotFoundException('La atracción no existe o ya no está disponible.');
    }
    return a;
  }

  async findOne(uuid: string, canSeeInactive: boolean) {
    return this.mapper.toResponse(await this.getRow(uuid, canSeeInactive));
  }

  // ── Escritura (attractions:write) ─────────────────────────────────────
  private async slugLibre(tx: Sql, nombre: string, excepto?: string): Promise<string> {
    const base = slugify(nombre).slice(0, 200) || 'atraccion';
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const usado = await tx.one('SELECT 1 FROM atraccion WHERE atr_slug = $1 AND atr_id IS DISTINCT FROM $2', [slug, excepto ?? null]);
      if (!usado) return slug;
    }
  }

  /**
   * Tarifa versionada: si el precio cambia, se cierra la vigente (hasta ayer) y se abre
   * otra desde hoy. Así las compras anteriores conservan el precio con el que se hicieron.
   */
  private async fijarTarifa(tx: Sql, atrId: string, tipo: 'ADULTO' | 'NINO', precio: number | null, moneda: string) {
    const vigente = await tx.one<{ tar_id: string; precio: number; hoy: boolean }>(
      `SELECT tar_id::text, tar_precio::float8 AS precio, tar_vigente_desde = ${HOY_EC} AS hoy FROM tarifa
        WHERE atr_id = $1 AND tar_tipo = $2 AND tar_vigente_desde <= ${HOY_EC}
          AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= ${HOY_EC})
        ORDER BY tar_vigente_desde DESC LIMIT 1`,
      [atrId, tipo],
    );
    if (precio == null) {
      if (vigente) {
        await tx.query(
          vigente.hoy ? 'DELETE FROM tarifa WHERE tar_id = $1' : `UPDATE tarifa SET tar_vigente_hasta = ${HOY_EC} - 1 WHERE tar_id = $1`,
          [vigente.tar_id],
        );
      }
      return;
    }
    if (vigente && vigente.precio === precio) return;
    if (vigente?.hoy) {
      await tx.query('UPDATE tarifa SET tar_precio = $1, tar_moneda = $2 WHERE tar_id = $3', [precio, moneda, vigente.tar_id]);
      return;
    }
    if (vigente) await tx.query(`UPDATE tarifa SET tar_vigente_hasta = ${HOY_EC} - 1 WHERE tar_id = $1`, [vigente.tar_id]);
    await tx.query(`INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde) VALUES ($1, $2, $3, $4, ${HOY_EC})`, [
      atrId,
      tipo,
      precio,
      moneda,
    ]);
  }

  /** Horarios: los que salen se desactivan (conservan sus reservas); el cupo se aplica a los futuros. */
  private async fijarHorarios(tx: Sql, atrId: string, horas: string[] | undefined, cupo: number | undefined) {
    if (horas !== undefined) {
      if (!horas.length) throw new BadRequestException('times debe tener al menos un horario.');
      const unicas = [...new Set(horas)].sort();
      const cupoBase =
        cupo ?? (await tx.one<{ c: number }>('SELECT COALESCE(MAX(hor_cupo), 20) AS c FROM horario WHERE atr_id = $1 AND hor_activo', [atrId]))?.c ?? 20;
      await tx.query('UPDATE horario SET hor_activo = FALSE WHERE atr_id = $1 AND NOT (to_char(hor_hora, $2) = ANY($3::text[]))', [atrId, 'HH24:MI', unicas]);
      for (const h of unicas) {
        await tx.query(
          `INSERT INTO horario (atr_id, hor_hora, hor_cupo, hor_activo) VALUES ($1, $2::time, $3, TRUE)
           ON CONFLICT (atr_id, hor_hora) DO UPDATE SET hor_activo = TRUE${cupo !== undefined ? ', hor_cupo = EXCLUDED.hor_cupo' : ''}`,
          [atrId, h, cupoBase],
        );
      }
    } else if (cupo !== undefined) {
      await tx.query('UPDATE horario SET hor_cupo = $2 WHERE atr_id = $1', [atrId, cupo]);
    }
    if (cupo !== undefined) {
      // El inventario futuro toma el nuevo cupo, sin bajar de lo ya reservado
      await tx.query(
        `UPDATE disponibilidad d SET dis_cupo_total = GREATEST(h.hor_cupo, d.dis_cupo_reservado, 1)
           FROM horario h WHERE h.hor_id = d.hor_id AND d.atr_id = $1 AND d.dis_fecha >= ${HOY_EC}`,
        [atrId],
      );
    }
  }

  private async fijarInclusiones(tx: Sql, atrId: string, tipo: string, items: string[] | undefined) {
    if (items === undefined) return;
    await tx.query(
      'DELETE FROM atraccion_inclusion ai USING inclusion i WHERE ai.inc_id = i.inc_id AND ai.atr_id = $1 AND i.inc_tipo = $2',
      [atrId, tipo],
    );
    const limpios = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
    for (const [i, nombre] of limpios.entries()) {
      const inc = await tx.one<{ inc_id: number }>(
        `INSERT INTO inclusion (inc_tipo, inc_nombre, inc_orden) VALUES ($1, $2, $3)
         ON CONFLICT (inc_tipo, inc_nombre) DO UPDATE SET inc_nombre = EXCLUDED.inc_nombre RETURNING inc_id`,
        [tipo, nombre, i],
      );
      await tx.query('INSERT INTO atraccion_inclusion (atr_id, inc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [atrId, inc!.inc_id]);
    }
  }

  /** Crea (atrId null) o actualiza una atracción dentro de la transacción `tx`. También lo usa el seed. */
  async guardar(tx: Sql, atrId: string | null, dto: Partial<CreateAtraccionDto>): Promise<string> {
    const p = new Params();
    const cols: Record<string, string> = {};
    let nombre: string | undefined;

    if (dto.name !== undefined) {
      nombre = dto.name.trim();
      cols.atr_nombre = p.add(nombre);
      cols.atr_slug = p.add(await this.slugLibre(tx, nombre, atrId ?? undefined));
    }
    if (dto.long_description !== undefined) cols.atr_descripcion = p.add(dto.long_description.trim());
    if (dto.short_description !== undefined) cols.atr_descripcion_corta = p.add(dto.short_description?.trim() || null);
    if (dto.duration !== undefined) {
      const horas = isoAHoras(dto.duration);
      if (horas <= 0) throw new BadRequestException('duration debe ser mayor a cero.');
      cols.atr_duracion_horas = p.add(horas);
    }
    if (dto.price !== undefined) cols.atr_moneda = p.add(dto.price.currency.toUpperCase());
    if (dto.product_type !== undefined) cols.atr_tipo = p.add(CONTRATO_A_TIPO[dto.product_type]);
    if (dto.free_cancellation !== undefined) cols.atr_cancelacion_gratuita = p.add(dto.free_cancellation);
    if (dto.cancellation_hours !== undefined) cols.atr_horas_cancelacion = p.add(dto.cancellation_hours);
    if (dto.meeting_point !== undefined) cols.atr_punto_encuentro = p.add(dto.meeting_point || null);
    if (dto.featured !== undefined) cols.atr_destacada = p.add(dto.featured);
    if (dto.is_active !== undefined) cols.atr_estado = p.add(dto.is_active ? 'PUBLICADA' : 'INACTIVA');
    if (dto.operator !== undefined) {
      const op = await tx.one<{ ope_id: string }>('SELECT ope_id::text FROM operador WHERE ope_codigo = $1', [dto.operator.id]);
      if (!op) throw new BadRequestException(`El operador ${dto.operator.id} no existe.`);
      cols.ope_id = p.add(op.ope_id);
    }
    if (dto.locations !== undefined) {
      const loc = dto.locations[0];
      const ciudad = await tx.one<{ prov_id: number }>('SELECT prov_id FROM ciudad WHERE ciu_id = $1', [loc.city]);
      if (!ciudad) throw new BadRequestException(`La ciudad (city) ${loc.city} no existe.`);
      cols.ciu_id = p.add(loc.city);
      cols.prov_id = p.add(ciudad.prov_id);
      cols.atr_direccion = p.add(loc.address);
      cols.atr_latitud = p.add(loc.coordinates.latitude);
      cols.atr_longitud = p.add(loc.coordinates.longitude);
    }

    let id = atrId;
    if (id === null) {
      if (cols.atr_estado === undefined) cols.atr_estado = p.add('PUBLICADA');
      const nombres = Object.keys(cols);
      const r = await tx.one<{ id: string }>(
        `INSERT INTO atraccion (${nombres.join(', ')}) VALUES (${nombres.map((k) => cols[k]).join(', ')}) RETURNING atr_id::text AS id`,
        p.values,
      );
      id = r!.id;
    } else if (Object.keys(cols).length) {
      await tx.query(
        `UPDATE atraccion SET ${Object.entries(cols).map(([k, v]) => `${k} = ${v}`).join(', ')} WHERE atr_id = ${p.add(id)}`,
        p.values,
      );
    }

    const moneda = dto.price?.currency.toUpperCase() ?? (await tx.one<{ m: string }>('SELECT atr_moneda AS m FROM atraccion WHERE atr_id = $1', [id]))!.m;
    // El precio de niño no puede superar al de adulto (se compara con el vigente si no llega en el DTO)
    if (dto.child_price != null || dto.price !== undefined) {
      const adulto = dto.price?.total ?? (await tx.one<{ p: number | null }>(`SELECT ${sqlTarifa('ADULTO')} AS p FROM atraccion a WHERE a.atr_id = $1`, [id]))?.p;
      const nino = dto.child_price ?? (await tx.one<{ p: number | null }>(`SELECT ${sqlTarifa('NINO')} AS p FROM atraccion a WHERE a.atr_id = $1`, [id]))?.p;
      if (adulto != null && nino != null && nino > adulto) throw new BadRequestException('child_price no puede ser mayor que el precio de adulto.');
    }
    if (dto.price !== undefined) await this.fijarTarifa(tx, id, 'ADULTO', dto.price.total, moneda);
    if (dto.child_price !== undefined) await this.fijarTarifa(tx, id, 'NINO', dto.child_price, moneda);
    await this.fijarHorarios(tx, id, dto.times, dto.capacity_per_slot);

    if (dto.categories !== undefined) {
      const cats = await tx.query<{ cat_id: number; cat_slug: string }>('SELECT cat_id, cat_slug FROM categoria WHERE cat_slug = ANY($1::text[])', [dto.categories]);
      const faltan = dto.categories.filter((s) => !cats.some((c) => c.cat_slug === s));
      if (faltan.length) throw new BadRequestException(`Categorías inexistentes: ${faltan.join(', ')}`);
      await tx.query('DELETE FROM atraccion_categoria WHERE atr_id = $1', [id]);
      await tx.query('INSERT INTO atraccion_categoria (atr_id, cat_id) SELECT $1, unnest($2::int[])', [id, cats.map((c) => c.cat_id)]);
    }
    if (dto.supported_languages !== undefined) {
      const idi = await tx.query<{ idi_id: number; idi_codigo: string }>('SELECT idi_id, idi_codigo FROM idioma WHERE idi_codigo = ANY($1::text[])', [
        dto.supported_languages,
      ]);
      const faltan = dto.supported_languages.filter((c) => !idi.some((i) => i.idi_codigo === c));
      if (faltan.length) throw new BadRequestException(`Idiomas no registrados: ${faltan.join(', ')}`);
      await tx.query('DELETE FROM atraccion_idioma WHERE atr_id = $1', [id]);
      await tx.query('INSERT INTO atraccion_idioma (atr_id, idi_id) SELECT $1, unnest($2::smallint[])', [id, idi.map((i) => i.idi_id)]);
    }
    await this.fijarInclusiones(tx, id, 'INCLUYE', dto.includes);
    await this.fijarInclusiones(tx, id, 'NO_INCLUYE', dto.not_includes);
    await this.fijarInclusiones(tx, id, 'RECOMENDACION', dto.recommendations);

    if (dto.photos !== undefined) {
      const nombreAtr = nombre ?? (await tx.one<{ n: string }>('SELECT atr_nombre AS n FROM atraccion WHERE atr_id = $1', [id]))!.n;
      await tx.query('DELETE FROM atraccion_foto WHERE atr_id = $1', [id]);
      for (const [i, f] of dto.photos.entries()) {
        await tx.query('INSERT INTO atraccion_foto (atr_id, fot_url, fot_alt, fot_orden) VALUES ($1, $2, $3, $4)', [
          id,
          this.mapper.relUrl(f.url),
          (f.alt?.trim() || `${nombreAtr} – foto ${i + 1}`).slice(0, 200),
          i,
        ]);
      }
    }
    return id;
  }

  /** Evento de catálogo (para índices de búsqueda de otros servicios), en la misma transacción. */
  private async eventoAtraccion(tx: Sql, tipo: TipoEvento, a: FilaAtraccion) {
    await emitirEvento(tx, tipo, 'atraccion', a.uuid, {
      attraction_id: a.uuid,
      name: a.nombre,
      status: a.estado,
      city_id: a.ciu_id,
      operator_id: a.ope_codigo,
      price: { currency: a.moneda, total: a.precio_adulto },
    });
  }

  private async idPorUuid(tx: Sql, uuid: string): Promise<string> {
    const r = await tx.one<{ id: string }>(`SELECT atr_id::text AS id FROM atraccion a WHERE atr_uuid = $1 AND ${VISIBLE} FOR UPDATE`, [uuid]);
    if (!r) throw new NotFoundException('La atracción no existe o ya no está disponible.');
    return r.id;
  }

  async create(dto: CreateAtraccionDto, user: AuthUser) {
    const fila = await this.db.tx(async (tx) => {
      const id = await this.guardar(tx, null, { times: ['09:00'], ...dto });
      const fila = (await this.cargar([id], tx))[0];
      await this.eventoAtraccion(tx, EVENTOS.ATRACCION_PUBLICADA, fila);
      return fila;
    });
    await this.bitacora.registrar(user.sub, 'CREAR', 'atraccion', fila.uuid, { nombre: fila.nombre });
    return this.mapper.toResponse(fila);
  }

  async replace(uuid: string, dto: CreateAtraccionDto, user: AuthUser) {
    await this.db.tx(async (tx) => {
      const id = await this.guardar(tx, await this.idPorUuid(tx, uuid), dto);
      await this.eventoAtraccion(tx, EVENTOS.ATRACCION_ACTUALIZADA, (await this.cargar([id], tx))[0]);
    });
    await this.bitacora.registrar(user.sub, 'REEMPLAZAR', 'atraccion', uuid);
  }

  async update(uuid: string, dto: UpdateAtraccionDto, user: AuthUser) {
    const fila = await this.db.tx(async (tx) => {
      const id = await this.guardar(tx, await this.idPorUuid(tx, uuid), dto);
      const fila = (await this.cargar([id], tx))[0];
      await this.eventoAtraccion(tx, EVENTOS.ATRACCION_ACTUALIZADA, fila);
      return fila;
    });
    await this.bitacora.registrar(user.sub, 'ACTUALIZAR', 'atraccion', uuid, { campos: Object.keys(dto) });
    return this.mapper.toResponse(fila);
  }

  /** Borrado lógico (atr_eliminado_en); no se permite con reservas próximas activas. */
  async remove(uuid: string, user: AuthUser) {
    await this.db.tx(async (tx) => {
      const id = await this.idPorUuid(tx, uuid);
      const r = await tx.one<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM reserva r JOIN disponibilidad d ON d.dis_id = r.dis_id JOIN estado e ON e.est_id = r.est_id
          WHERE d.atr_id = $1 AND r.res_fecha >= ${HOY_EC} AND e.est_codigo IN ('CONFIRMADA', 'PENDIENTE_PAGO')`,
        [id],
      );
      if (r!.n > 0) {
        throw new ConflictException(`No se puede eliminar: tiene ${r!.n} reserva(s) próximas. Desactívala para ocultarla sin afectar a los clientes.`);
      }
      await tx.query(`UPDATE atraccion SET atr_eliminado_en = now(), atr_estado = 'INACTIVA', atr_destacada = FALSE WHERE atr_id = $1`, [id]);
      await emitirEvento(tx, EVENTOS.ATRACCION_RETIRADA, 'atraccion', uuid, { attraction_id: uuid });
    });
    await this.bitacora.registrar(user.sub, 'ELIMINAR', 'atraccion', uuid);
  }

  // ── Disponibilidad ────────────────────────────────────────────────────
  async getAvailability(uuid: string, date: string): Promise<AvailabilityResponseDto> {
    const a = await this.getRow(uuid);
    const fecha = date.slice(0, 10);
    const hoy = hoyEc();
    const vacio = (reason: string): AvailabilityResponseDto => ({ date: fecha, available_spots: 0, times: [], slots: [], unavailable_reason: reason });

    if (fecha < hoy) return vacio('La fecha seleccionada ya pasó.');
    if (fecha > sumarDias(hoy, 365)) return vacio('Solo se aceptan reservas con hasta un año de anticipación.');
    const bloqueo = await this.db.one<{ motivo: string }>('SELECT fb_motivo AS motivo FROM fecha_bloqueada WHERE atr_id = $1 AND fb_fecha = $2', [a.id, fecha]);
    if (bloqueo) return vacio(`No opera este día: ${bloqueo.motivo}`);

    const inventario = await this.db.query<{ hora: string; total: number; reservado: number; cerrada: boolean }>(
      `SELECT to_char(h.hor_hora, 'HH24:MI') AS hora, d.dis_cupo_total AS total, d.dis_cupo_reservado AS reservado, d.dis_cerrada AS cerrada
         FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id WHERE d.atr_id = $1 AND d.dis_fecha = $2`,
      [a.id, fecha],
    );
    const porHora = new Map(inventario.map((i) => [i.hora, i]));
    const ahora = horaActualEc();
    const slots = a.horarios
      .filter((h) => fecha > hoy || h.hora > ahora)
      .map((h) => {
        const inv = porHora.get(h.hora);
        const capacity = inv?.total ?? h.cupo;
        return { time: h.hora, capacity, available: inv?.cerrada ? 0 : Math.max(0, capacity - (inv?.reservado ?? 0)) };
      });

    const available_spots = slots.reduce((s, x) => s + x.available, 0);
    return {
      date: fecha,
      available_spots,
      times: slots.filter((s) => s.available > 0).map((s) => s.time),
      slots,
      ...(slots.length === 0 ? { unavailable_reason: 'Ya no quedan salidas para hoy.' } : available_spots === 0 ? { unavailable_reason: 'Agotado para esta fecha.' } : {}),
    };
  }

  async getCalendar(uuid: string, month: string): Promise<CalendarDayDto[]> {
    const a = await this.getRow(uuid);
    const dias = diasDelMes(month);
    const hoy = hoyEc();
    const ahora = horaActualEc();

    const [inventario, bloqueos] = await Promise.all([
      this.db.query<{ fecha: string; hora: string; total: number; reservado: number; cerrada: boolean }>(
        `SELECT to_char(d.dis_fecha, 'YYYY-MM-DD') AS fecha, to_char(h.hor_hora, 'HH24:MI') AS hora,
                d.dis_cupo_total AS total, d.dis_cupo_reservado AS reservado, d.dis_cerrada AS cerrada
           FROM disponibilidad d JOIN horario h ON h.hor_id = d.hor_id
          WHERE d.atr_id = $1 AND d.dis_fecha BETWEEN $2::date AND $3::date`,
        [a.id, dias[0], dias[dias.length - 1]],
      ),
      this.db.query<{ fecha: string; motivo: string }>(
        `SELECT to_char(fb_fecha, 'YYYY-MM-DD') AS fecha, fb_motivo AS motivo FROM fecha_bloqueada
          WHERE atr_id = $1 AND fb_fecha BETWEEN $2::date AND $3::date`,
        [a.id, dias[0], dias[dias.length - 1]],
      ),
    ]);
    const inv = new Map(inventario.map((i) => [`${i.fecha} ${i.hora}`, i]));
    const bloq = new Map(bloqueos.map((b) => [b.fecha, b.motivo]));

    return dias.map((fecha) => {
      if (fecha < hoy) return { date: fecha, available_spots: 0, status: 'past' };
      if (bloq.has(fecha)) return { date: fecha, available_spots: 0, status: 'blocked', reason: bloq.get(fecha) };
      const horas = a.horarios.filter((h) => fecha > hoy || h.hora > ahora);
      let capacidad = 0;
      let libres = 0;
      for (const h of horas) {
        const i = inv.get(`${fecha} ${h.hora}`);
        const cap = i?.total ?? h.cupo;
        capacidad += cap;
        libres += i?.cerrada ? 0 : Math.max(0, cap - (i?.reservado ?? 0));
      }
      const status = libres === 0 ? 'full' : libres <= Math.max(3, capacidad * 0.2) ? 'low' : 'available';
      return { date: fecha, available_spots: libres, status };
    });
  }

  // ── Fechas bloqueadas (attractions:manage) ────────────────────────────
  /** Admin gestiona cualquier atracción; un operador solo las de su empresa (auditoría SEG-004). */
  private async getGestionable(uuid: string, user: AuthUser): Promise<FilaAtraccion> {
    const a = await this.getRow(uuid, true);
    if (!esAdmin(user) && (user.operador == null || a.ope_codigo !== user.operador)) {
      throw new NotFoundException('La atracción no existe o no pertenece a tu empresa operadora.');
    }
    return a;
  }

  async listBloqueos(uuid: string, user: AuthUser) {
    const a = await this.getGestionable(uuid, user);
    return this.db.query(
      `SELECT fb_id::text AS id, to_char(fb_fecha, 'YYYY-MM-DD') AS date, fb_motivo AS reason FROM fecha_bloqueada
        WHERE atr_id = $1 ORDER BY fb_fecha`,
      [a.id],
    );
  }

  async bloquear(uuid: string, dto: BlockDateDto, user: AuthUser) {
    const a = await this.getGestionable(uuid, user);
    const fecha = dto.date.slice(0, 10);
    if (fecha < hoyEc()) throw new BadRequestException('No puedes bloquear una fecha que ya pasó.');
    if (await this.db.one('SELECT 1 FROM fecha_bloqueada WHERE atr_id = $1 AND fb_fecha = $2', [a.id, fecha])) {
      throw new ConflictException('Esa fecha ya está bloqueada.');
    }
    const afectadas = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM reserva r JOIN disponibilidad d ON d.dis_id = r.dis_id JOIN estado e ON e.est_id = r.est_id
        WHERE d.atr_id = $1 AND r.res_fecha = $2 AND e.est_codigo IN ('CONFIRMADA', 'PENDIENTE_PAGO')`,
      [a.id, fecha],
    );
    const b = await this.db.one<{ id: string }>(
      'INSERT INTO fecha_bloqueada (atr_id, fb_fecha, fb_motivo) VALUES ($1, $2, $3) RETURNING fb_id::text AS id',
      [a.id, fecha, dto.reason.trim()],
    );
    await this.bitacora.registrar(user.sub, 'BLOQUEAR_FECHA', 'atraccion', a.uuid, { fecha, motivo: dto.reason });
    return { id: b!.id, date: fecha, reason: dto.reason.trim(), affected_reservations: afectadas?.n ?? 0 };
  }

  async desbloquear(uuid: string, blockId: string, user: AuthUser) {
    const a = await this.getGestionable(uuid, user);
    const r = await this.db.query('DELETE FROM fecha_bloqueada WHERE fb_id = $1 AND atr_id = $2 RETURNING fb_id', [blockId, a.id]);
    if (!r.length) throw new NotFoundException('El bloqueo no existe.');
    await this.bitacora.registrar(user.sub, 'DESBLOQUEAR_FECHA', 'atraccion', a.uuid, { bloqueo: blockId });
  }
}
