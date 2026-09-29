import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../../common/auth/scopes';
import { paginate } from '../../common/utils/hateoas';
import { AtraccionMapper } from './atraccion.mapper';
import { AtraccionesService } from './atracciones.service';
import { ReservationStatus } from './dto/reservation.dto';
import { CreateResenaDto, ResenasQueryDto } from './dto/resena.dto';
import { Atraccion } from './entities/atraccion.entity';
import { Resena } from './entities/resena.entity';
import { Reserva } from './entities/reserva.entity';
import { hoyEc } from './utils/fechas';

@Injectable()
export class ResenasService {
  constructor(
    @InjectRepository(Resena) private readonly resenas: Repository<Resena>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(Atraccion) private readonly atracciones: Repository<Atraccion>,
    private readonly atraccionesService: AtraccionesService,
    private readonly mapper: AtraccionMapper,
  ) {}

  private toDto(r: Resena, admin = false) {
    return {
      id: r.id,
      author: r.autorNombre,
      rating: r.puntuacion,
      comment: r.comentario,
      created_at: r.createdAt.toISOString(),
      ...(admin
        ? {
            visible: r.visible,
            attraction: r.atraccion ? { id: r.atraccion.id, name: r.atraccion.nombre, photo: this.mapper.absUrl(r.atraccion.fotos?.[0]) } : undefined,
          }
        : {}),
    };
  }

  /** Recalcula rating promedio y número de reseñas visibles de la atracción. */
  async recalcular(atraccionId: string) {
    const raw = await this.resenas
      .createQueryBuilder('r')
      .select('COALESCE(AVG(r.puntuacion), 0)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('r.atraccion = :id', { id: atraccionId })
      .andWhere('r.visible = true')
      .getRawOne();
    await this.atracciones.update(atraccionId, {
      ratingPromedio: Math.round(Number(raw.avg) * 100) / 100,
      numeroResenas: Number(raw.count),
    });
  }

  async listPublic(atraccionId: string, query: ResenasQueryDto) {
    await this.atraccionesService.getEntity(atraccionId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 5;
    const where: any = { atraccion: { id: atraccionId }, visible: true, ...(query.rating ? { puntuacion: query.rating } : {}) };
    const [rows, total] = await this.resenas.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit });

    const dist = await this.resenas
      .createQueryBuilder('r')
      .select('r.puntuacion', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r.atraccion = :id', { id: atraccionId })
      .andWhere('r.visible = true')
      .groupBy('r.puntuacion')
      .getRawMany();
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    dist.forEach((d) => (distribution[d.rating] = Number(d.count)));

    return {
      ...paginate(rows.map((r) => this.toDto(r)), total, page, limit, `/atracciones/${atraccionId}/reviews`),
      distribution,
    };
  }

  /** ¿El usuario puede reseñar? Debe haber vivido la experiencia y no haberla reseñado antes. */
  async elegibilidad(atraccionId: string, user: AuthUser) {
    const yaReseno = await this.resenas.exist({ where: { atraccion: { id: atraccionId }, usuarioId: user.sub } });
    if (yaReseno) return { can_review: false, reason: 'Ya dejaste una reseña para esta experiencia.' };
    const vivida = await this.reservas
      .createQueryBuilder('r')
      .where('r.atraccion = :id', { id: atraccionId })
      .andWhere('r.usuarioId = :uid', { uid: user.sub })
      .andWhere('r.estado = :st', { st: ReservationStatus.CONFIRMED })
      .andWhere('r.fecha <= :hoy', { hoy: hoyEc() })
      .getExists();
    if (!vivida) return { can_review: false, reason: 'Podrás opinar después de vivir esta experiencia con una reserva confirmada.' };
    return { can_review: true };
  }

  async create(atraccionId: string, dto: CreateResenaDto, user: AuthUser) {
    const a = await this.atraccionesService.getEntity(atraccionId);
    const eleg = await this.elegibilidad(atraccionId, user);
    if (!eleg.can_review) {
      if (eleg.reason?.startsWith('Ya')) throw new ConflictException(eleg.reason);
      throw new ForbiddenException(eleg.reason);
    }
    const r = await this.resenas.save(
      this.resenas.create({ atraccion: a, usuarioId: user.sub, autorNombre: user.nombre, puntuacion: dto.rating, comentario: dto.comment }),
    );
    await this.recalcular(atraccionId);
    return this.toDto(r);
  }

  // ── Moderación (admin) ────────────────────────────────────────────────
  async listAdmin(query: ResenasQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: any = {};
    if (query.status === 'visible') where.visible = true;
    if (query.status === 'hidden') where.visible = false;
    if (query.rating) where.puntuacion = query.rating;
    const [rows, total] = await this.resenas.findAndCount({
      where,
      relations: { atraccion: true },
      withDeleted: true,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const extra = `${query.status ? `&status=${query.status}` : ''}${query.rating ? `&rating=${query.rating}` : ''}`;
    return paginate(rows.map((r) => this.toDto(r, true)), total, page, limit, '/resenas', extra);
  }

  async moderar(id: string, visible: boolean) {
    const r = await this.resenas.findOne({ where: { id }, relations: { atraccion: true }, withDeleted: true });
    if (!r) throw new NotFoundException('Reseña no encontrada.');
    r.visible = visible;
    await this.resenas.save(r);
    await this.recalcular(r.atraccion.id);
    return this.toDto(r, true);
  }

  async remove(id: string) {
    const r = await this.resenas.findOne({ where: { id }, relations: { atraccion: true }, withDeleted: true });
    if (!r) throw new NotFoundException('Reseña no encontrada.');
    await this.resenas.remove(r);
    await this.recalcular(r.atraccion.id);
  }
}
