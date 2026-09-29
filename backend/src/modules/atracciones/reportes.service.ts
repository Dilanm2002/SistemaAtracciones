import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtraccionMapper } from './atraccion.mapper';
import { ReservationStatus } from './dto/reservation.dto';
import { Atraccion } from './entities/atraccion.entity';
import { Reserva } from './entities/reserva.entity';
import { hoyEc, sumarDias } from './utils/fechas';

const NO_CANCELADA = `r.estado != '${ReservationStatus.CANCELLED}'`;
const num = (v: any) => Math.round(Number(v ?? 0) * 100) / 100;

@Injectable()
export class ReportesService {
  constructor(
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(Atraccion) private readonly atracciones: Repository<Atraccion>,
    private readonly mapper: AtraccionMapper,
  ) {}

  private qb() {
    return this.reservas.createQueryBuilder('r').leftJoin('r.atraccion', 'a').withDeleted();
  }

  /** KPIs y listas cortas para la pantalla de inicio del panel. */
  async dashboard() {
    const hoy = hoyEc();
    const inicioMes = `${hoy.slice(0, 7)}-01`;

    const [hoyRow, mesRow, pendientes, activas, proximas, ultimos7] = await Promise.all([
      this.qb().select('COUNT(*)', 'reservas').addSelect('COALESCE(SUM(r.ticketCount),0)', 'viajeros')
        .where('r.fecha = :hoy', { hoy }).andWhere(NO_CANCELADA).getRawOne(),
      this.qb().select('COUNT(*)', 'reservas').addSelect('COALESCE(SUM(r.total),0)', 'ingresos')
        .where('r.createdAt >= :ini', { ini: `${inicioMes}T00:00:00-05:00` }).andWhere(NO_CANCELADA).getRawOne(),
      this.reservas.count({ where: { estado: ReservationStatus.PENDING } }),
      this.atracciones.count({ where: { estaActivo: true } }),
      this.qb().select(['r.id', 'r.codigo', 'r.fecha', 'r.hora', 'r.ticketCount', 'r.clienteNombre', 'r.estado', 'a.id', 'a.nombre', 'a.fotos'])
        .where('r.fecha >= :hoy', { hoy }).andWhere(NO_CANCELADA)
        .orderBy('r.fecha', 'ASC').addOrderBy('r.hora', 'ASC').take(8).getMany(),
      this.qb().select(`to_char(r.createdAt AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD')`, 'dia')
        .addSelect('COUNT(*)', 'reservas').addSelect('COALESCE(SUM(r.total),0)', 'ingresos')
        .where('r.createdAt >= :desde', { desde: `${sumarDias(hoy, -6)}T00:00:00-05:00` }).andWhere(NO_CANCELADA)
        .groupBy('dia').getRawMany(),
    ]);

    const serie = Array.from({ length: 7 }, (_, i) => {
      const dia = sumarDias(hoy, i - 6);
      const row = ultimos7.find((x) => x.dia === dia);
      return { date: dia, reservations: Number(row?.reservas ?? 0), revenue: num(row?.ingresos) };
    });

    return {
      kpis: {
        reservations_today: Number(hoyRow.reservas),
        travelers_today: Number(hoyRow.viajeros),
        reservations_month: Number(mesRow.reservas),
        revenue_month: num(mesRow.ingresos),
        pending_reservations: pendientes,
        active_attractions: activas,
      },
      last_7_days: serie,
      upcoming: proximas.map((r) => ({
        reservation_id: r.id,
        code: r.codigo,
        date: r.fecha,
        time: r.hora,
        ticket_count: r.ticketCount,
        customer_name: r.clienteNombre,
        status: r.estado,
        attraction: { id: r.atraccion?.id, name: r.atraccion?.nombre, photo: this.mapper.absUrl(r.atraccion?.fotos?.[0]) },
      })),
    };
  }

  /** Reporte de ventas por rango de fechas de creación de la reserva. */
  async ventas(from: string, to: string) {
    if (to < from) throw new BadRequestException('"to" no puede ser anterior a "from".');
    const desde = `${from}T00:00:00-05:00`;
    const hasta = `${sumarDias(to, 1)}T00:00:00-05:00`;
    const rango = (q: ReturnType<ReportesService['qb']>) => q.where('r.createdAt >= :desde AND r.createdAt < :hasta', { desde, hasta });

    const [totales, porDia, top, porCategoria, porRegion, porMetodo, detalle] = await Promise.all([
      rango(this.qb())
        .select('COUNT(*) FILTER (WHERE ' + NO_CANCELADA + ')', 'reservas')
        .addSelect(`COALESCE(SUM(r.ticketCount) FILTER (WHERE ${NO_CANCELADA}),0)`, 'tickets')
        .addSelect(`COALESCE(SUM(r.total) FILTER (WHERE ${NO_CANCELADA}),0)`, 'ingresos')
        .addSelect(`COUNT(*) FILTER (WHERE r.estado = '${ReservationStatus.CANCELLED}')`, 'canceladas')
        .addSelect('COUNT(*)', 'todas')
        .getRawOne(),
      rango(this.qb())
        .select(`to_char(r.createdAt AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD')`, 'dia')
        .addSelect('COUNT(*)', 'reservas').addSelect('COALESCE(SUM(r.total),0)', 'ingresos')
        .andWhere(NO_CANCELADA).groupBy('dia').orderBy('dia').getRawMany(),
      rango(this.qb())
        .select('a.nombre', 'nombre').addSelect('COUNT(*)', 'reservas')
        .addSelect('SUM(r.ticketCount)', 'tickets').addSelect('SUM(r.total)', 'ingresos')
        .andWhere(NO_CANCELADA).groupBy('a.id').addGroupBy('a.nombre').orderBy('ingresos', 'DESC').limit(10).getRawMany(),
      rango(this.qb())
        .innerJoin('atracciones_categorias', 'ac', 'ac.atraccion_id = a.id')
        .innerJoin('categorias', 'c', 'c.id = ac.categoria_id')
        .select('c.nombre', 'nombre').addSelect('COUNT(*)', 'reservas').addSelect('SUM(r.total)', 'ingresos')
        .andWhere(NO_CANCELADA).groupBy('c.nombre').orderBy('ingresos', 'DESC').getRawMany(),
      rango(this.qb())
        .leftJoin('a.destino', 'd')
        .select('d.region', 'region').addSelect('COUNT(*)', 'reservas').addSelect('SUM(r.total)', 'ingresos')
        .andWhere(NO_CANCELADA).groupBy('d.region').getRawMany(),
      rango(this.qb())
        .select('r.metodoPago', 'metodo').addSelect('COUNT(*)', 'reservas').addSelect('SUM(r.total)', 'ingresos')
        .andWhere(NO_CANCELADA).groupBy('r.metodoPago').getRawMany(),
      rango(this.qb()).addSelect(['a.id', 'a.nombre', 'a.ciudad']).orderBy('r.createdAt', 'DESC').getMany(),
    ]);

    const reservas = Number(totales.reservas);
    const ingresos = num(totales.ingresos);
    return {
      range: { from, to },
      kpis: {
        reservations: reservas,
        tickets: Number(totales.tickets),
        revenue: ingresos,
        average_ticket: reservas ? num(ingresos / reservas) : 0,
        cancellations: Number(totales.canceladas),
        cancellation_rate: Number(totales.todas) ? num((Number(totales.canceladas) / Number(totales.todas)) * 100) : 0,
      },
      by_day: porDia.map((d) => ({ date: d.dia, reservations: Number(d.reservas), revenue: num(d.ingresos) })),
      top_attractions: top.map((t) => ({ name: t.nombre, reservations: Number(t.reservas), tickets: Number(t.tickets), revenue: num(t.ingresos) })),
      by_category: porCategoria.map((c) => ({ name: c.nombre, reservations: Number(c.reservas), revenue: num(c.ingresos) })),
      by_region: porRegion.map((c) => ({ region: c.region, reservations: Number(c.reservas), revenue: num(c.ingresos) })),
      by_payment_method: porMetodo.map((m) => ({ method: m.metodo, reservations: Number(m.reservas), revenue: num(m.ingresos) })),
      rows: detalle.map((r) => ({
        code: r.codigo,
        created_at: r.createdAt.toISOString(),
        attraction: r.atraccion?.nombre,
        city: r.atraccion?.ciudad,
        date: r.fecha,
        time: r.hora,
        adults: r.adultos,
        children: r.ninos,
        total: r.total,
        status: r.estado,
        payment_method: r.metodoPago,
        customer: r.clienteNombre,
        email: r.clienteEmail,
      })),
    };
  }

  /** Clientes con actividad de reservas (agregado por usuario). */
  async clientes() {
    const rows = await this.qb()
      .select('r.usuarioId', 'usuario_id')
      .addSelect('MAX(r.clienteNombre)', 'nombre')
      .addSelect('MAX(r.clienteEmail)', 'email')
      .addSelect('MAX(r.clienteTelefono)', 'telefono')
      .addSelect(`COUNT(*) FILTER (WHERE ${NO_CANCELADA})`, 'reservas')
      .addSelect(`COALESCE(SUM(r.total) FILTER (WHERE ${NO_CANCELADA}),0)`, 'gastado')
      .addSelect('MAX(r.createdAt)', 'ultima')
      .where('r.usuarioId IS NOT NULL')
      .groupBy('r.usuarioId')
      .orderBy('gastado', 'DESC')
      .getRawMany();
    return rows.map((r) => ({
      user_id: r.usuario_id,
      name: r.nombre,
      email: r.email,
      phone: r.telefono,
      reservations: Number(r.reservas),
      total_spent: num(r.gastado),
      last_reservation_at: r.ultima,
    }));
  }
}
