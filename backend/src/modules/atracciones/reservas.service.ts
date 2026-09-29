import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Brackets, DataSource, Repository } from 'typeorm';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AtraccionMapper } from './atraccion.mapper';
import { AtraccionesService } from './atracciones.service';
import {
  CancelReservationRequestDto,
  PaymentMethod,
  ReservationRequestDto,
  ReservationResponseDto,
  ReservationsQueryDto,
  ReservationStatus,
} from './dto/reservation.dto';
import { Atraccion } from './entities/atraccion.entity';
import { FechaBloqueada } from './entities/fecha-bloqueada.entity';
import { MetodoPago, Reserva } from './entities/reserva.entity';
import { horaActualEc, hoyEc, sumarDias } from './utils/fechas';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones al dictarlo

@Injectable()
export class ReservasService {
  constructor(
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    private readonly dataSource: DataSource,
    private readonly atraccionesService: AtraccionesService,
    private readonly idempotency: IdempotencyService,
    private readonly mapper: AtraccionMapper,
  ) {}

  private generarCodigo(): string {
    return 'DEC-' + Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  }

  private puedeGestionar(user: AuthUser) {
    return user.scope?.includes(SCOPES.MANAGE);
  }

  // ── Crear reserva ─────────────────────────────────────────────────────
  reserve(atraccionId: string, dto: ReservationRequestDto, key: string, user: AuthUser): Promise<ReservationResponseDto> {
    return this.idempotency.execute(key, `reserve:${atraccionId}`, { dto, user: user.sub }, () =>
      this.dataSource.transaction(async (manager) => {
        // Bloqueo pesimista sobre la atracción: serializa reservas concurrentes del mismo tour
        const a = await manager
          .getRepository(Atraccion)
          .createQueryBuilder('a')
          .setLock('pessimistic_write')
          .where('a.id = :id', { id: atraccionId })
          .andWhere('a.estaActivo = true')
          .getOne();
        if (!a) throw new NotFoundException('La atracción no existe o ya no está disponible.');
        const full = await this.atraccionesService.getEntity(atraccionId);

        const fecha = dto.date.slice(0, 10);
        const hoy = hoyEc();
        if (fecha < hoy) throw new BadRequestException('No puedes reservar una fecha que ya pasó.');
        if (fecha > sumarDias(hoy, 365)) throw new BadRequestException('Solo se aceptan reservas con hasta un año de anticipación.');

        const bloqueo = await manager.getRepository(FechaBloqueada).findOne({ where: { atraccion: { id: a.id }, fecha } });
        if (bloqueo) throw new ConflictException(`La atracción no opera el ${fecha}: ${bloqueo.motivo}`);

        let hora = dto.time;
        if (!hora) {
          if (a.horarios.length !== 1) throw new BadRequestException(`Selecciona un horario: ${a.horarios.join(', ')}`);
          hora = a.horarios[0];
        }
        if (!a.horarios.includes(hora)) {
          throw new BadRequestException(`El horario ${hora} no existe. Horarios disponibles: ${a.horarios.join(', ')}`);
        }
        if (fecha === hoy && hora <= horaActualEc()) throw new BadRequestException('Esa salida ya partió hoy. Elige otro horario.');

        const ninos = dto.children ?? 0;
        if (ninos > dto.ticket_count) throw new BadRequestException('children no puede ser mayor que ticket_count.');
        const adultos = dto.ticket_count - ninos;
        if (adultos < 1) throw new BadRequestException('Cada reserva debe incluir al menos un adulto.');

        const ocupados = (await this.atraccionesService.ocupadosPorHora(a.id, fecha, manager)).get(hora) ?? 0;
        const libres = a.cupoPorHorario - ocupados;
        if (dto.ticket_count > libres) {
          throw new ConflictException(
            libres > 0
              ? `Solo quedan ${libres} cupo(s) para las ${hora}. Reduce la cantidad o elige otro horario.`
              : `El horario de las ${hora} está agotado. Elige otro horario o fecha.`,
          );
        }

        const precioNino = a.precioNino ?? a.precioTicket;
        const total = Math.round((adultos * a.precioTicket + ninos * precioNino) * 100) / 100;
        const metodo = (dto.payment_method ?? PaymentMethod.TARJETA) as unknown as MetodoPago;

        const repo = manager.getRepository(Reserva);
        let codigo = this.generarCodigo();
        while (await repo.exist({ where: { codigo } })) codigo = this.generarCodigo();

        const r = await repo.save(
          repo.create({
            codigo,
            atraccion: full,
            usuarioId: user.sub,
            fecha,
            hora,
            adultos,
            ninos,
            ticketCount: dto.ticket_count,
            precioAdulto: a.precioTicket,
            precioNino,
            total,
            moneda: a.moneda,
            // Pago con tarjeta se confirma al instante; transferencia o pago en sitio quedan pendientes
            estado: metodo === MetodoPago.TARJETA ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING,
            metodoPago: metodo,
            clienteNombre: dto.customer_name,
            clienteEmail: dto.customer_email ?? user.email,
            clienteTelefono: dto.customer_phone ?? null,
            clienteDocumento: dto.customer_document ?? null,
            notas: dto.notes ?? null,
            idempotencyKey: key,
          }),
        );
        return this.mapper.toReservation(r);
      }),
    );
  }

  // ── Consultas ─────────────────────────────────────────────────────────
  async list(query: ReservationsQueryDto, user: AuthUser) {
    const qb = this.reservas
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.atraccion', 'a')
      .withDeleted()
      .orderBy('r.fecha', query.when === 'past' ? 'DESC' : 'ASC')
      .addOrderBy('r.hora', 'ASC')
      .take(500);

    if (!(query.all === 'true' && this.puedeGestionar(user))) qb.where('r.usuarioId = :uid', { uid: user.sub });
    else qb.where('1=1');

    const hoy = hoyEc();
    if (query.status) qb.andWhere('r.estado = :st', { st: query.status });
    if (query.when === 'upcoming') qb.andWhere('r.fecha >= :hoy', { hoy });
    if (query.when === 'past') qb.andWhere('r.fecha < :hoy', { hoy });
    if (query.date) qb.andWhere('r.fecha = :date', { date: query.date.slice(0, 10) });
    if (query.from) qb.andWhere('r.fecha >= :from', { from: query.from.slice(0, 10) });
    if (query.to) qb.andWhere('r.fecha <= :to', { to: query.to.slice(0, 10) });
    if (query.attraction_id) qb.andWhere('a.id = :aid', { aid: query.attraction_id });
    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      qb.andWhere(new Brackets((w) => w.where('r.codigo ILIKE :q', { q }).orWhere('r.clienteNombre ILIKE :q', { q }).orWhere('r.clienteEmail ILIKE :q', { q })));
    }
    return (await qb.getMany()).map((r) => this.mapper.toReservation(r));
  }

  private async getOwned(id: string, user: AuthUser): Promise<Reserva> {
    const r = await this.reservas.findOne({ where: { id }, withDeleted: true });
    if (!r) throw new NotFoundException('Reserva no encontrada.');
    if (r.usuarioId !== user.sub && !this.puedeGestionar(user)) {
      // 404 en vez de 403 para no revelar que la reserva existe
      throw new NotFoundException('Reserva no encontrada.');
    }
    return r;
  }

  async getById(id: string, user: AuthUser) {
    return this.mapper.toReservation(await this.getOwned(id, user));
  }

  // ── Cancelar ──────────────────────────────────────────────────────────
  cancel(id: string, dto: CancelReservationRequestDto, key: string, user: AuthUser) {
    return this.idempotency.execute(key, `cancel:${id}`, { dto, user: user.sub }, async () => {
      const r = await this.getOwned(id, user);
      if (r.estado === ReservationStatus.CANCELLED) throw new ConflictException('Esta reserva ya estaba cancelada.');
      const gestor = this.puedeGestionar(user);
      if (!gestor && !this.mapper.canCancel(r)) {
        throw new ConflictException(
          r.atraccion.cancelacionGratuita
            ? `La cancelación gratuita solo está disponible hasta ${r.atraccion.horasCancelacion} horas antes. Escríbenos para revisar tu caso.`
            : 'Esta actividad no admite cancelación gratuita. Escríbenos para revisar tu caso.',
        );
      }
      r.estado = ReservationStatus.CANCELLED;
      r.motivoCancelacion = gestor && r.usuarioId !== user.sub ? `[Operador] ${dto.reason}` : dto.reason;
      r.canceladaEn = new Date();
      return this.mapper.toReservation(await this.reservas.save(r));
    });
  }

  // ── Confirmar (pago verificado por el operador) ───────────────────────
  confirm(id: string, key: string, user: AuthUser) {
    return this.idempotency.execute(key, `confirm:${id}`, { user: user.sub }, async () => {
      if (!this.puedeGestionar(user)) throw new ForbiddenException('Solo el personal puede confirmar reservas.');
      const r = await this.getOwned(id, user);
      if (r.estado !== ReservationStatus.PENDING) {
        throw new ConflictException(`Solo se pueden confirmar reservas pendientes (estado actual: ${r.estado}).`);
      }
      r.estado = ReservationStatus.CONFIRMED;
      return this.mapper.toReservation(await this.reservas.save(r));
    });
  }
}
