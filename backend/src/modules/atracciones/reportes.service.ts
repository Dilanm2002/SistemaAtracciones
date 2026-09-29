import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthUser, esAdmin } from '../../common/auth/scopes';
import { DbService, HOY_EC, num } from '../../common/db/db.service';
import { AtraccionMapper } from './atraccion.mapper';
import { ESTADO_A_STATUS } from './modelo';
import { hoyEc, sumarDias } from './utils/fechas';

/** Máximo de filas del detalle de ventas (auditoría DAT-006); para más, acotar el rango de fechas. */
const DETALLE_MAX = 2000;
const TZ = `'America/Guayaquil'`;

/** Reserva con su compra y atracción: base de todos los reportes. */
const FROM = `
  FROM reserva r
  JOIN estado e         ON e.est_id = r.est_id
  JOIN orden_detalle dt ON dt.det_id = r.det_id
  JOIN orden o          ON o.ord_id = dt.ord_id
  JOIN atraccion a      ON a.atr_id = dt.atr_id
  JOIN operador op      ON op.ope_id = a.ope_id`;
const VIGENTE = `e.est_codigo <> 'CANCELADA_RES'`;

@Injectable()
export class ReportesService {
  constructor(
    private readonly db: DbService,
    private readonly mapper: AtraccionMapper,
  ) {}

  /**
   * KPIs y listas cortas para la pantalla de inicio del panel.
   * Un OPERADOR solo ve los datos de las atracciones de su empresa (auditoría SEG-004).
   */
  async dashboard(user: AuthUser) {
    // -1: operador sin empresa → no ve datos
    const opc = esAdmin(user) ? null : user.operador ?? -1;
    const scope = opc === null ? 'TRUE' : 'op.ope_codigo = $1';
    const params = opc === null ? [] : [opc];
    const inicioMes = `date_trunc('month', ${HOY_EC})::date`;

    const [hoyRow, mesRow, pendRow, activas, proximas, ultimos7] = await Promise.all([
      this.db.one<{ reservas: number; viajeros: number }>(
        `SELECT COUNT(*)::int AS reservas, COALESCE(SUM(r.res_numero_tickets), 0)::int AS viajeros ${FROM}
          WHERE ${scope} AND r.res_fecha = ${HOY_EC} AND ${VIGENTE}`,
        params,
      ),
      this.db.one<{ reservas: number; ingresos: number }>(
        `SELECT COUNT(*)::int AS reservas, COALESCE(SUM(r.res_subtotal), 0)::float8 AS ingresos ${FROM}
          WHERE ${scope} AND (r.res_creado_en AT TIME ZONE ${TZ})::date >= ${inicioMes} AND ${VIGENTE}`,
        params,
      ),
      this.db.one<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM} WHERE ${scope} AND e.est_codigo = 'PENDIENTE_PAGO'`, params),
      this.db.one<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM atraccion a JOIN operador op ON op.ope_id = a.ope_id
          WHERE ${scope} AND a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA'`,
        params,
      ),
      this.db.query<{ id: string; codigo: string; fecha: string; hora: string; tickets: number; estado: string; cliente: string; atr_uuid: string; atr_nombre: string; foto: string | null }>(
        `SELECT r.res_uuid::text AS id, r.res_codigo AS codigo, to_char(r.res_fecha, 'YYYY-MM-DD') AS fecha, to_char(r.res_hora, 'HH24:MI') AS hora,
                r.res_numero_tickets AS tickets, e.est_codigo AS estado,
                (SELECT x.pax_nombre FROM reserva_pasajero x WHERE x.res_id = r.res_id ORDER BY x.pax_es_titular DESC, x.pax_id LIMIT 1) AS cliente,
                a.atr_uuid::text AS atr_uuid, a.atr_nombre,
                (SELECT f.fot_url FROM atraccion_foto f WHERE f.atr_id = a.atr_id ORDER BY f.fot_orden, f.fot_id LIMIT 1) AS foto
           ${FROM} WHERE ${scope} AND r.res_fecha >= ${HOY_EC} AND ${VIGENTE}
          ORDER BY r.res_fecha, r.res_hora LIMIT 8`,
        params,
      ),
      this.db.query<{ dia: string; reservas: number; ingresos: number }>(
        `SELECT to_char((r.res_creado_en AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS reservas,
                COALESCE(SUM(r.res_subtotal), 0)::float8 AS ingresos ${FROM}
          WHERE ${scope} AND (r.res_creado_en AT TIME ZONE ${TZ})::date >= ${HOY_EC} - 6 AND ${VIGENTE}
          GROUP BY 1`,
        params,
      ),
    ]);

    const hoy = hoyEc();
    const serie = Array.from({ length: 7 }, (_, i) => {
      const dia = sumarDias(hoy, i - 6);
      const row = ultimos7.find((x) => x.dia === dia);
      return { date: dia, reservations: row?.reservas ?? 0, revenue: num(row?.ingresos) };
    });

    return {
      kpis: {
        reservations_today: hoyRow?.reservas ?? 0,
        travelers_today: hoyRow?.viajeros ?? 0,
        reservations_month: mesRow?.reservas ?? 0,
        revenue_month: num(mesRow?.ingresos),
        pending_reservations: pendRow?.total ?? 0,
        active_attractions: activas?.total ?? 0,
      },
      last_7_days: serie,
      upcoming: proximas.map((r) => ({
        reservation_id: r.id,
        code: r.codigo,
        date: r.fecha,
        time: r.hora,
        ticket_count: r.tickets,
        customer_name: r.cliente,
        status: ESTADO_A_STATUS[r.estado],
        attraction: { id: r.atr_uuid, name: r.atr_nombre, photo: this.mapper.absUrl(r.foto) },
      })),
    };
  }

  /** Reporte de ventas por rango de fechas de creación de la reserva (hora de Ecuador). */
  async ventas(from: string, to: string) {
    if (to < from) throw new BadRequestException('"to" no puede ser anterior a "from".');
    const rango = `(r.res_creado_en AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date`;
    const p = [from, to];

    const [totales, porDia, top, porCategoria, porRegion, porMetodo, detalle] = await Promise.all([
      this.db.one<{ reservas: number; tickets: number; ingresos: number; canceladas: number; todas: number }>(
        `SELECT COUNT(*) FILTER (WHERE ${VIGENTE})::int AS reservas,
                COALESCE(SUM(r.res_numero_tickets) FILTER (WHERE ${VIGENTE}), 0)::int AS tickets,
                COALESCE(SUM(r.res_subtotal) FILTER (WHERE ${VIGENTE}), 0)::float8 AS ingresos,
                COUNT(*) FILTER (WHERE e.est_codigo = 'CANCELADA_RES')::int AS canceladas,
                COUNT(*)::int AS todas ${FROM} WHERE ${rango}`,
        p,
      ),
      this.db.query<{ dia: string; reservas: number; ingresos: number }>(
        `SELECT to_char((r.res_creado_en AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS reservas,
                SUM(r.res_subtotal)::float8 AS ingresos ${FROM} WHERE ${rango} AND ${VIGENTE} GROUP BY 1 ORDER BY 1`,
        p,
      ),
      this.db.query<{ nombre: string; reservas: number; tickets: number; ingresos: number }>(
        `SELECT a.atr_nombre AS nombre, COUNT(*)::int AS reservas, SUM(r.res_numero_tickets)::int AS tickets, SUM(r.res_subtotal)::float8 AS ingresos
           ${FROM} WHERE ${rango} AND ${VIGENTE} GROUP BY a.atr_id, a.atr_nombre ORDER BY ingresos DESC LIMIT 10`,
        p,
      ),
      this.db.query<{ nombre: string; reservas: number; ingresos: number }>(
        `SELECT ca.cat_nombre AS nombre, COUNT(*)::int AS reservas, SUM(r.res_subtotal)::float8 AS ingresos
           ${FROM} JOIN atraccion_categoria ac ON ac.atr_id = a.atr_id JOIN categoria ca ON ca.cat_id = ac.cat_id
          WHERE ${rango} AND ${VIGENTE} GROUP BY ca.cat_nombre ORDER BY ingresos DESC`,
        p,
      ),
      this.db.query<{ region: string; reservas: number; ingresos: number }>(
        `SELECT rg.reg_nombre AS region, COUNT(*)::int AS reservas, SUM(r.res_subtotal)::float8 AS ingresos
           ${FROM} JOIN provincia pv ON pv.prov_id = a.prov_id JOIN region rg ON rg.reg_id = pv.reg_id
          WHERE ${rango} AND ${VIGENTE} GROUP BY rg.reg_nombre`,
        p,
      ),
      this.db.query<{ metodo: string; reservas: number; ingresos: number }>(
        `SELECT mp.mpa_codigo AS metodo, COUNT(*)::int AS reservas, SUM(r.res_subtotal)::float8 AS ingresos
           ${FROM} JOIN metodo_pago mp ON mp.mpa_id = o.mpa_id WHERE ${rango} AND ${VIGENTE} GROUP BY mp.mpa_codigo`,
        p,
      ),
      this.db.query<Record<string, string | number>>(
        `SELECT r.res_codigo AS code, r.res_creado_en AS created_at, a.atr_nombre AS attraction,
                (SELECT c.ciu_nombre FROM ciudad c WHERE c.ciu_id = a.ciu_id) AS city,
                to_char(r.res_fecha, 'YYYY-MM-DD') AS date, to_char(r.res_hora, 'HH24:MI') AS time,
                r.res_adultos AS adults, r.res_ninos AS children, r.res_subtotal::float8 AS total, e.est_codigo AS estado,
                (SELECT mp.mpa_codigo FROM metodo_pago mp WHERE mp.mpa_id = o.mpa_id) AS payment_method,
                (SELECT x.pax_nombre FROM reserva_pasajero x WHERE x.res_id = r.res_id ORDER BY x.pax_es_titular DESC, x.pax_id LIMIT 1) AS customer,
                (SELECT u.usu_correo FROM usuario u WHERE u.usu_id = o.usu_id) AS email
           ${FROM} WHERE ${rango} ORDER BY r.res_creado_en DESC LIMIT ${DETALLE_MAX + 1}`,
        p,
      ),
    ]);

    const reservas = totales?.reservas ?? 0;
    const ingresos = num(totales?.ingresos);
    return {
      range: { from, to },
      kpis: {
        reservations: reservas,
        tickets: totales?.tickets ?? 0,
        revenue: ingresos,
        average_ticket: reservas ? num(ingresos / reservas) : 0,
        cancellations: totales?.canceladas ?? 0,
        cancellation_rate: totales?.todas ? num((totales.canceladas / totales.todas) * 100) : 0,
      },
      by_day: porDia.map((d) => ({ date: d.dia, reservations: d.reservas, revenue: num(d.ingresos) })),
      top_attractions: top.map((t) => ({ name: t.nombre, reservations: t.reservas, tickets: t.tickets, revenue: num(t.ingresos) })),
      by_category: porCategoria.map((c) => ({ name: c.nombre, reservations: c.reservas, revenue: num(c.ingresos) })),
      by_region: porRegion.map((c) => ({ region: c.region, reservations: c.reservas, revenue: num(c.ingresos) })),
      by_payment_method: porMetodo.map((m) => ({ method: m.metodo, reservations: m.reservas, revenue: num(m.ingresos) })),
      rows_truncated: detalle.length > DETALLE_MAX,
      rows: detalle.slice(0, DETALLE_MAX).map(({ estado, created_at, ...r }) => ({
        ...r,
        created_at: new Date(created_at as string).toISOString(),
        status: ESTADO_A_STATUS[estado as string],
      })),
    };
  }

  /** Clientes con actividad de compra (agregado por usuario de la orden). */
  async clientes() {
    const rows = await this.db.query<{ usuario_id: string; nombre: string; email: string; telefono: string | null; reservas: number; gastado: number; ultima: Date }>(
      `SELECT u.usu_id::text AS usuario_id, u.usu_nombre || ' ' || u.usu_apellido AS nombre, u.usu_correo AS email, u.usu_telefono AS telefono,
              COUNT(*) FILTER (WHERE ${VIGENTE})::int AS reservas,
              COALESCE(SUM(r.res_subtotal) FILTER (WHERE ${VIGENTE}), 0)::float8 AS gastado,
              MAX(r.res_creado_en) AS ultima
         ${FROM} JOIN usuario u ON u.usu_id = o.usu_id
        GROUP BY u.usu_id ORDER BY gastado DESC`,
    );
    return rows.map((r) => ({
      user_id: r.usuario_id,
      name: r.nombre,
      email: r.email,
      phone: r.telefono,
      reservations: r.reservas,
      total_spent: num(r.gastado),
      last_reservation_at: r.ultima,
    }));
  }
}
