import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { isUUID } from 'class-validator';
import { paginate } from '../../common/utils/hateoas';
import { AtraccionMapper } from './atraccion.mapper';
import { AvailabilityResponseDto, BlockDateDto, CalendarDayDto } from './dto/availability.dto';
import { CreateAtraccionDto } from './dto/create-atraccion.dto';
import { DetailsRequestDto } from './dto/details-request.dto';
import { ListAtraccionesQueryDto } from './dto/list-atracciones.dto';
import { ReservationStatus } from './dto/reservation.dto';
import { SearchAtraccionesDto } from './dto/search-atracciones.dto';
import { UpdateAtraccionDto } from './dto/update-atraccion.dto';
import { Atraccion } from './entities/atraccion.entity';
import { Categoria } from './entities/categoria.entity';
import { Destino } from './entities/destino.entity';
import { FechaBloqueada } from './entities/fecha-bloqueada.entity';
import { Operador } from './entities/operador.entity';
import { Reserva } from './entities/reserva.entity';
import { diasDelMes, horaActualEc, hoyEc, isoAHoras, sumarDias } from './utils/fechas';

@Injectable()
export class AtraccionesService {
  constructor(
    @InjectRepository(Atraccion) private readonly atracciones: Repository<Atraccion>,
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(Destino) private readonly destinos: Repository<Destino>,
    @InjectRepository(Operador) private readonly operadores: Repository<Operador>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(FechaBloqueada) private readonly bloqueos: Repository<FechaBloqueada>,
    private readonly mapper: AtraccionMapper,
  ) {}

  private baseQuery(): SelectQueryBuilder<Atraccion> {
    return this.atracciones
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.destino', 'd')
      .leftJoinAndSelect('a.operador', 'o')
      .leftJoinAndSelect('a.categorias', 'c');
  }

  private filtrarPorCategorias(qb: SelectQueryBuilder<Atraccion>, slugs: string[]) {
    qb.andWhere(
      `a.id IN (SELECT ac.atraccion_id FROM atracciones_categorias ac
                JOIN categorias cf ON cf.id = ac.categoria_id WHERE cf.slug IN (:...slugs))`,
      { slugs },
    );
  }

  // ── Búsqueda (POST /atracciones/search) ───────────────────────────────
  async search(dto: SearchAtraccionesDto) {
    const qb = this.baseQuery().where('a.estaActivo = true');
    const f = dto.filters ?? {};

    if (dto.countries?.length && !dto.countries.map((c) => c.toLowerCase()).includes('ec')) {
      return { data: [], metadata: { total_results: 0 }, request_id: randomUUID() };
    }
    if (dto.cities?.length) qb.andWhere('d.codigo IN (:...cities)', { cities: dto.cities });
    if (f.query?.trim()) {
      qb.andWhere('(a.nombre ILIKE :q OR a.descripcion ILIKE :q OR a.ciudad ILIKE :q OR d.provincia ILIKE :q)', {
        q: `%${f.query.trim()}%`,
      });
    }
    if (f.categories?.length) this.filtrarPorCategorias(qb, f.categories);
    if (f.regions?.length) qb.andWhere('d.region IN (:...regions)', { regions: f.regions });
    if (f.price?.min != null) qb.andWhere('a.precioTicket >= :pmin', { pmin: f.price.min });
    if (f.price?.max != null) qb.andWhere('a.precioTicket <= :pmax', { pmax: f.price.max });
    if (f.duration?.min_hours != null) qb.andWhere('a.duracionHoras >= :dmin', { dmin: f.duration.min_hours });
    if (f.duration?.max_hours != null) qb.andWhere('a.duracionHoras <= :dmax', { dmax: f.duration.max_hours });
    if (f.free_cancellation) qb.andWhere('a.cancelacionGratuita = true');
    if (f.product_types?.length) qb.andWhere('a.tipoProducto IN (:...pt)', { pt: f.product_types });
    if (f.rating?.minimum_review_score != null) qb.andWhere('a.ratingPromedio >= :rs', { rs: f.rating.minimum_review_score });
    if (f.rating?.minimum_review_count != null) qb.andWhere('a.numeroResenas >= :rc', { rc: f.rating.minimum_review_count });

    if (dto.dates) {
      const inicio = dto.dates.start_date.slice(0, 10);
      const fin = dto.dates.end_date.slice(0, 10);
      if (fin < inicio) throw new BadRequestException('dates.end_date no puede ser anterior a dates.start_date');
      const dias = Math.min(Math.round((Date.parse(fin) - Date.parse(inicio)) / 86400000) + 1, 62);
      // Excluye atracciones bloqueadas TODOS los días del rango
      qb.andWhere(
        `(SELECT COUNT(*) FROM fechas_bloqueadas fb WHERE fb."atraccionId" = a.id AND fb.fecha BETWEEN :ini AND :fin) < :dias`,
        { ini: inicio, fin, dias },
      );
    }

    switch (dto.sort?.by ?? 'most_popular') {
      case 'price_asc': qb.orderBy('a.precioTicket', 'ASC'); break;
      case 'price_desc': qb.orderBy('a.precioTicket', 'DESC'); break;
      case 'rating': qb.orderBy('a.ratingPromedio', 'DESC').addOrderBy('a.numeroResenas', 'DESC'); break;
      case 'newest': qb.orderBy('a.createdAt', 'DESC'); break;
      case 'duration': qb.orderBy('a.duracionHoras', 'ASC'); break;
      default: qb.orderBy('a.destacado', 'DESC').addOrderBy('a.numeroResenas', 'DESC').addOrderBy('a.ratingPromedio', 'DESC');
    }
    qb.addOrderBy('a.id', 'ASC');

    const rows = dto.rows ?? 12;
    const offset = this.decodePageToken(dto.next_page);
    const [items, total] = await qb.skip(offset).take(rows).getManyAndCount();
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
    const ids = dto.attractions.filter((id) => isUUID(id));
    const items = ids.length ? await this.atracciones.find({ where: { id: In(ids), estaActivo: true } }) : [];
    const byId = new Map(items.map((a) => [a.id, a]));
    return {
      request_id: randomUUID(),
      data: ids.filter((id) => byId.has(id)).map((id) => this.mapper.toResponse(byId.get(id))),
    };
  }

  // ── Listado paginado (GET /atracciones) ───────────────────────────────
  async findAll(query: ListAtraccionesQueryDto, canSeeInactive: boolean) {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? ((query.page ?? 1) - 1) * limit;
    const page = Math.floor(offset / limit) + 1;
    const qb = this.baseQuery();

    const status = canSeeInactive ? query.status ?? 'active' : 'active';
    if (status === 'active') qb.where('a.estaActivo = true');
    else if (status === 'inactive') qb.where('a.estaActivo = false');
    else qb.where('1=1');

    if (query.q?.trim()) qb.andWhere('(a.nombre ILIKE :q OR a.ciudad ILIKE :q)', { q: `%${query.q.trim()}%` });
    if (query.category) this.filtrarPorCategorias(qb, [query.category]);
    if (query.city) qb.andWhere('d.codigo = :city', { city: query.city });
    if (query.featured === 'true') qb.andWhere('a.destacado = true');

    qb.orderBy('a.destacado', 'DESC').addOrderBy('a.nombre', 'ASC');
    const [items, total] = await qb.skip(offset).take(limit).getManyAndCount();

    const extra = [
      query.q && `&q=${encodeURIComponent(query.q)}`,
      query.category && `&category=${query.category}`,
      query.city && `&city=${query.city}`,
      query.featured && `&featured=${query.featured}`,
      canSeeInactive && query.status && `&status=${query.status}`,
    ]
      .filter(Boolean)
      .join('');
    return paginate(items.map((a) => this.mapper.toResponse(a)), total, page, limit, '/atracciones', extra);
  }

  async getEntity(id: string, canSeeInactive = false): Promise<Atraccion> {
    const a = await this.atracciones.findOne({ where: { id } });
    if (!a || (!a.estaActivo && !canSeeInactive)) {
      throw new NotFoundException('La atracción no existe o ya no está disponible.');
    }
    return a;
  }

  async findOne(id: string, canSeeInactive: boolean) {
    return this.mapper.toResponse(await this.getEntity(id, canSeeInactive));
  }

  // ── Escritura (attractions:write) ─────────────────────────────────────
  private async aplicarDto(a: Atraccion, dto: Partial<CreateAtraccionDto>) {
    if (dto.name !== undefined) a.nombre = dto.name.trim();
    if (dto.long_description !== undefined) a.descripcion = dto.long_description.trim();
    if (dto.short_description !== undefined) a.descripcionCorta = dto.short_description?.trim() || null;
    if (dto.duration !== undefined) {
      const horas = isoAHoras(dto.duration);
      if (horas <= 0) throw new BadRequestException('duration debe ser mayor a cero.');
      a.duracionHoras = horas;
    }
    if (dto.price !== undefined) {
      a.precioTicket = dto.price.total;
      a.moneda = dto.price.currency.toUpperCase();
    }
    if (dto.child_price !== undefined) a.precioNino = dto.child_price;
    if (dto.product_type !== undefined) a.tipoProducto = dto.product_type;
    if (dto.includes !== undefined) a.incluye = dto.includes;
    if (dto.not_includes !== undefined) a.noIncluye = dto.not_includes;
    if (dto.recommendations !== undefined) a.recomendaciones = dto.recommendations;
    if (dto.badges !== undefined) a.insignias = dto.badges;
    if (dto.supported_languages !== undefined) a.idiomas = dto.supported_languages;
    if (dto.free_cancellation !== undefined) a.cancelacionGratuita = dto.free_cancellation;
    if (dto.cancellation_hours !== undefined) a.horasCancelacion = dto.cancellation_hours;
    if (dto.times !== undefined) {
      if (!dto.times.length) throw new BadRequestException('times debe tener al menos un horario.');
      a.horarios = [...new Set(dto.times)].sort();
    }
    if (dto.capacity_per_slot !== undefined) a.cupoPorHorario = dto.capacity_per_slot;
    if (dto.meeting_point !== undefined) a.puntoEncuentro = dto.meeting_point || null;
    if (dto.featured !== undefined) a.destacado = dto.featured;
    if (dto.is_active !== undefined) a.estaActivo = dto.is_active;
    if (dto.photos !== undefined) a.fotos = dto.photos.map((p) => this.mapper.relUrl(p.url));

    if (dto.operator !== undefined) {
      const op = await this.operadores.findOne({ where: { codigo: dto.operator.id } });
      if (!op) throw new BadRequestException(`El operador ${dto.operator.id} no existe.`);
      a.operador = op;
    }
    if (dto.locations !== undefined) {
      const loc = dto.locations[0];
      const destino = await this.destinos.findOne({ where: { codigo: loc.city } });
      if (!destino) throw new BadRequestException(`El destino (city) ${loc.city} no existe.`);
      a.destino = destino;
      a.ciudad = destino.nombre;
      a.direccion = loc.address;
      a.latitud = loc.coordinates.latitude;
      a.longitud = loc.coordinates.longitude;
    }
    if (dto.categories !== undefined) {
      const cats = await this.categorias.find({ where: { slug: In(dto.categories) } });
      const faltan = dto.categories.filter((s) => !cats.some((c) => c.slug === s));
      if (faltan.length) throw new BadRequestException(`Categorías inexistentes: ${faltan.join(', ')}`);
      a.categorias = cats;
    }
  }

  async create(dto: CreateAtraccionDto) {
    const a = this.atracciones.create({ fotos: [], horarios: ['09:00'] });
    await this.aplicarDto(a, dto);
    const saved = await this.atracciones.save(a);
    return this.mapper.toResponse(await this.getEntity(saved.id, true));
  }

  async replace(id: string, dto: CreateAtraccionDto) {
    const a = await this.getEntity(id, true);
    await this.aplicarDto(a, dto);
    await this.atracciones.save(a);
  }

  async update(id: string, dto: UpdateAtraccionDto) {
    const a = await this.getEntity(id, true);
    await this.aplicarDto(a, dto);
    await this.atracciones.save(a);
    return this.mapper.toResponse(await this.getEntity(id, true));
  }

  async remove(id: string) {
    const a = await this.getEntity(id, true);
    const futuras = await this.reservas
      .createQueryBuilder('r')
      .where('r.atraccion = :id', { id })
      .andWhere('r.estado != :c', { c: ReservationStatus.CANCELLED })
      .andWhere('r.fecha >= :hoy', { hoy: hoyEc() })
      .getCount();
    if (futuras > 0) {
      throw new ConflictException(
        `No se puede eliminar: tiene ${futuras} reserva(s) próximas. Desactívala para ocultarla sin afectar a los clientes.`,
      );
    }
    await this.atracciones.softRemove(a);
  }

  // ── Disponibilidad ────────────────────────────────────────────────────
  /** Tickets ocupados por horario en una fecha (reservas no canceladas). */
  async ocupadosPorHora(atraccionId: string, fecha: string, manager = this.reservas.manager): Promise<Map<string, number>> {
    const rows = await manager
      .getRepository(Reserva)
      .createQueryBuilder('r')
      .select('r.hora', 'hora')
      .addSelect('COALESCE(SUM(r.ticketCount), 0)', 'total')
      .where('r.atraccion = :id', { id: atraccionId })
      .andWhere('r.fecha = :fecha', { fecha })
      .andWhere('r.estado != :c', { c: ReservationStatus.CANCELLED })
      .groupBy('r.hora')
      .getRawMany();
    return new Map(rows.map((r) => [r.hora, Number(r.total)]));
  }

  async getAvailability(id: string, date: string): Promise<AvailabilityResponseDto> {
    const a = await this.getEntity(id);
    const fecha = date.slice(0, 10);
    const hoy = hoyEc();
    const vacio = (reason: string): AvailabilityResponseDto => ({ date: fecha, available_spots: 0, times: [], slots: [], unavailable_reason: reason });

    if (fecha < hoy) return vacio('La fecha seleccionada ya pasó.');
    if (fecha > sumarDias(hoy, 365)) return vacio('Solo se aceptan reservas con hasta un año de anticipación.');
    const bloqueo = await this.bloqueos.findOne({ where: { atraccion: { id }, fecha } });
    if (bloqueo) return vacio(`No opera este día: ${bloqueo.motivo}`);

    const ocupados = await this.ocupadosPorHora(id, fecha);
    const ahora = horaActualEc();
    const slots = a.horarios
      .filter((h) => fecha > hoy || h > ahora)
      .map((h) => ({ time: h, capacity: a.cupoPorHorario, available: Math.max(0, a.cupoPorHorario - (ocupados.get(h) ?? 0)) }));

    const available_spots = slots.reduce((s, x) => s + x.available, 0);
    return {
      date: fecha,
      available_spots,
      times: slots.filter((s) => s.available > 0).map((s) => s.time),
      slots,
      ...(slots.length === 0 ? { unavailable_reason: 'Ya no quedan salidas para hoy.' } : available_spots === 0 ? { unavailable_reason: 'Agotado para esta fecha.' } : {}),
    };
  }

  async getCalendar(id: string, month: string): Promise<CalendarDayDto[]> {
    const a = await this.getEntity(id);
    const dias = diasDelMes(month);
    const hoy = hoyEc();
    const ahora = horaActualEc();

    const [ocupados, bloqueos] = await Promise.all([
      this.reservas
        .createQueryBuilder('r')
        .select(`to_char(r.fecha, 'YYYY-MM-DD')`, 'fecha')
        .addSelect('r.hora', 'hora')
        .addSelect('SUM(r.ticketCount)', 'total')
        .where('r.atraccion = :id', { id })
        .andWhere('r.estado != :c', { c: ReservationStatus.CANCELLED })
        .andWhere('r.fecha BETWEEN :ini AND :fin', { ini: dias[0], fin: dias[dias.length - 1] })
        .groupBy('r.fecha')
        .addGroupBy('r.hora')
        .getRawMany(),
      this.bloqueos.find({ where: { atraccion: { id } } }),
    ]);
    const ocup = new Map<string, number>();
    for (const r of ocupados) ocup.set(`${r.fecha} ${r.hora}`, Number(r.total));
    const bloq = new Map(bloqueos.map((b) => [b.fecha, b.motivo]));

    return dias.map((fecha) => {
      if (fecha < hoy) return { date: fecha, available_spots: 0, status: 'past' };
      if (bloq.has(fecha)) return { date: fecha, available_spots: 0, status: 'blocked', reason: bloq.get(fecha) };
      const horas = a.horarios.filter((h) => fecha > hoy || h > ahora);
      const capacidad = horas.length * a.cupoPorHorario;
      const libres = horas.reduce((s, h) => s + Math.max(0, a.cupoPorHorario - (ocup.get(`${fecha} ${h}`) ?? 0)), 0);
      const status = libres === 0 ? 'full' : libres <= Math.max(3, capacidad * 0.2) ? 'low' : 'available';
      return { date: fecha, available_spots: libres, status };
    });
  }

  // ── Fechas bloqueadas (attractions:manage) ────────────────────────────
  async listBloqueos(id: string) {
    await this.getEntity(id, true);
    const rows = await this.bloqueos.find({ where: { atraccion: { id }, }, order: { fecha: 'ASC' } });
    return rows.map((b) => ({ id: b.id, date: b.fecha, reason: b.motivo }));
  }

  async bloquear(id: string, dto: BlockDateDto) {
    const a = await this.getEntity(id, true);
    const fecha = dto.date.slice(0, 10);
    if (fecha < hoyEc()) throw new BadRequestException('No puedes bloquear una fecha que ya pasó.');
    if (await this.bloqueos.exist({ where: { atraccion: { id }, fecha } })) {
      throw new ConflictException('Esa fecha ya está bloqueada.');
    }
    const afectadas = await this.reservas.count({
      where: { atraccion: { id }, fecha, estado: Not(ReservationStatus.CANCELLED) },
    });
    const b = await this.bloqueos.save(this.bloqueos.create({ atraccion: a, fecha, motivo: dto.reason }));
    return { id: b.id, date: b.fecha, reason: b.motivo, affected_reservations: afectadas };
  }

  async desbloquear(id: string, blockId: string) {
    const b = await this.bloqueos.findOne({ where: { id: blockId, atraccion: { id } } });
    if (!b) throw new NotFoundException('El bloqueo no existe.');
    await this.bloqueos.remove(b);
  }
}
