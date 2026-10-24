import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser, esAdmin, Rol, SCOPES } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { CatalogosService } from '../../common/db/catalogos.service';
import { DbService, HOY_EC, Params, Sql } from '../../common/db/db.service';
import { IdempotencyService, Referencia } from '../../common/idempotency/idempotency.service';
import { escapeLike } from '../../common/utils/sql';
import { AtraccionMapper } from './atraccion.mapper';
import { Acompanante, cancelarCompra, confirmarCompra, MetodoCompra, registrarCompra } from './compras';
import { StockSyncService } from './stock-sync.service';
import {
  CardInfoDto,
  CancelReservationRequestDto,
  PaymentMethod,
  ReservationRequestDto,
  ReservationResponseDto,
  ReservationsQueryDto,
  ReservationStatus,
} from './dto/reservation.dto';
import { ESTADO_A_STATUS, FilaReserva, SELECT_RESERVA, sqlTarifa, STATUS_A_ESTADOS } from './modelo';
import { horaActualEc, hoyEc, sumarDias } from './utils/fechas';

const LIMITE_LISTADO = 500;

/** 409 por falta de cupos: Booking lo usa para compensar su saga (contrato v2, code OUT_OF_STOCK). */
export const sinCupos = (detalle: string) => new ConflictException({ message: detalle, code: 'OUT_OF_STOCK' });

/** Datos de una reserva nueva, en el formato interno (v1 y v2 se traducen a esto). */
export interface NuevaReserva {
  usuId: string;
  atrUuid: string;
  fecha: string;
  hora?: string;
  adultos: number;
  ninos: number;
  seniors?: number;
  infantes?: number;
  estudiantes?: number;
  metodo: MetodoCompra;
  tarjeta?: CardInfoDto;
  /** Teléfono de contacto (la web aplica las reglas de la cuenta del cliente) */
  telefono?: (tx: Sql) => Promise<string | null>;
  paxNombre: string;
  paxDocumento?: string | null;
  paxTipoDocumento?: 'CEDULA' | 'PASAPORTE' | 'RUC';
  paxCorreo?: string | null;
  acompanantes?: Acompanante[];
  notas?: string | null;
  origen?: 'WEB' | 'BOOKING';
  sagaId?: string | null;
  confirmarSiempre?: boolean;
}

type Alcance = { tipo: 'todas' } | { tipo: 'operador'; codigo: number } | { tipo: 'propias' };

@Injectable()
export class ReservasService {
  constructor(
    private readonly db: DbService,
    private readonly catalogos: CatalogosService,
    private readonly idempotency: IdempotencyService,
    private readonly bitacora: BitacoraService,
    private readonly mapper: AtraccionMapper,
    private readonly stock: StockSyncService,
  ) {}

  /**
   * Alcance de gestión sobre reservas ajenas (auditoría SEG-004):
   * ADMIN todas; OPERADOR solo las de atracciones de SU empresa (operador_usuario); resto, las propias.
   */
  private alcance(user: AuthUser): Alcance {
    if (esAdmin(user)) return { tipo: 'todas' };
    if (user.scope.includes(SCOPES.MANAGE) && user.operador != null) return { tipo: 'operador', codigo: user.operador };
    return { tipo: 'propias' };
  }

  private puedeGestionar(user: AuthUser, r: FilaReserva): boolean {
    const a = this.alcance(user);
    return a.tipo === 'todas' || (a.tipo === 'operador' && r.ope_codigo === a.codigo);
  }

  private async fila(uuid: string, sql: Sql = this.db): Promise<FilaReserva | null> {
    return sql.one<FilaReserva>(`${SELECT_RESERVA} WHERE r.res_uuid = $1`, [uuid]);
  }

  /** Idempotencia sin PII: se guarda solo el UUID de la reserva y la respuesta se rehace al repetir (SEG-013). */
  private readonly porReferencia: Referencia<ReservationResponseDto> = {
    referencia: (r) => r.reservation_id,
    reconstruir: async (uuid) => {
      const f = await this.fila(uuid);
      if (!f) throw new NotFoundException('La reserva ya no existe.');
      return this.mapper.toReservation(f);
    },
  };

  /**
   * Teléfono de contacto de la reserva. Un CLIENTE reserva siempre con el teléfono de SU cuenta
   * (no con uno escrito a mano o autocompletado por el navegador, que puede ser de otra persona).
   * Si su cuenta aún no tiene teléfono, el que indique se guarda en la cuenta, siempre que no
   * pertenezca a otro usuario. El personal (operador/admin) puede indicar el de su cliente.
   */
  private async telefonoDeContacto(tx: Sql, user: AuthUser, enviado?: string): Promise<string | null> {
    if (user.rol !== Rol.CLIENTE) return enviado ?? null;
    const cuenta = await tx.one<{ telefono: string | null }>('SELECT usu_telefono AS telefono FROM usuario WHERE usu_id = $1', [user.sub]);
    if (cuenta?.telefono) return cuenta.telefono;
    if (!enviado) return null;
    if (await tx.one('SELECT 1 FROM usuario WHERE usu_telefono = $1 AND usu_id <> $2', [enviado, user.sub])) {
      throw new ConflictException('Ese número de teléfono está registrado en otra cuenta. Usa tu propio número.');
    }
    await tx.query('UPDATE usuario SET usu_telefono = $2 WHERE usu_id = $1', [user.sub, enviado]);
    return enviado;
  }

  // ── Crear reserva ─────────────────────────────────────────────────────
  reserve(atrUuid: string, dto: ReservationRequestDto, key: string, user: AuthUser): Promise<ReservationResponseDto> {
    return this.idempotency.execute(key, `reserve:${atrUuid}`, user.sub, dto, async () => {
      await this.catalogos.precargar();
      const ninos = dto.children ?? 0;
      const seniors = dto.seniors ?? 0;
      const infantes = dto.infants ?? 0;
      const estudiantes = dto.students ?? 0;
      if (ninos > dto.ticket_count) throw new BadRequestException('children no puede ser mayor que ticket_count.');
      if (dto.ticket_count - ninos - seniors - infantes - estudiantes < 1) throw new BadRequestException('Cada reserva debe incluir al menos un adulto.');
      const metodo = dto.payment_method ?? PaymentMethod.TARJETA;
      if (dto.card && metodo !== PaymentMethod.TARJETA) throw new BadRequestException('card solo aplica al pago con TARJETA.');
      const { uuid, disId } = await this.db.tx((tx) =>
        this.crearEnTransaccion(tx, {
          usuId: user.sub,
          atrUuid,
          fecha: dto.date.slice(0, 10),
          hora: dto.time,
          adultos: dto.ticket_count - ninos - seniors - infantes - estudiantes,
          ninos,
          seniors,
          infantes,
          estudiantes,
          metodo,
          tarjeta: dto.card,
          telefono: (t) => this.telefonoDeContacto(t, user, dto.customer_phone),
          paxNombre: dto.customer_name,
          paxDocumento: dto.customer_document ?? null,
          paxCorreo: dto.customer_email ?? null,
          notas: dto.notes ?? null,
        }),
      );
      this.stock.publicar(disId, 'VENTA');
      await this.bitacora.registrar(user.sub, 'CREAR', 'reserva', uuid, { atraccion: atrUuid });
      return this.mapper.toReservation((await this.fila(uuid))!);
    }, this.porReferencia);
  }

  /**
   * Núcleo de una reserva, igual para la web (v1) y para Booking (v2): valida la fecha y el horario,
   * BLOQUEA la fila de inventario del turno (sin sobreventa), descuenta los cupos y registra la compra.
   * Sin cupos, turno cerrado o fecha bloqueada → 409 con code OUT_OF_STOCK (activa la saga de Booking).
   */
  async crearEnTransaccion(tx: Sql, n: NuevaReserva): Promise<{ uuid: string; disId: string; resId: string }> {
    await this.catalogos.precargar();
    // 1) La atracción no puede cambiar de precio ni desactivarse mientras se reserva (FOR SHARE)
    const a = await tx.one<{
      atr_id: string; nombre: string; moneda: string; adulto: number | null; nino: number | null; mayor: number | null; estudiante: number | null;
    }>(
      `SELECT a.atr_id::text, a.atr_nombre AS nombre, a.atr_moneda AS moneda,
              ${sqlTarifa('ADULTO')} AS adulto, ${sqlTarifa('NINO')} AS nino, ${sqlTarifa('MAYOR')} AS mayor,
              ${sqlTarifa('ESTUDIANTE')} AS estudiante
         FROM atraccion a WHERE a.atr_uuid = $1 AND a.atr_eliminado_en IS NULL AND a.atr_estado = 'PUBLICADA' FOR SHARE`,
      [n.atrUuid],
    );
    if (!a) throw new NotFoundException('La atracción no existe o ya no está disponible.');
    if (a.adulto == null) throw new ConflictException('Esta atracción no tiene una tarifa vigente. Intenta más tarde.');

    const fecha = n.fecha;
    const hoy = hoyEc();
    if (fecha < hoy) throw new BadRequestException('No puedes reservar una fecha que ya pasó.');
    if (fecha > sumarDias(hoy, 365)) throw new BadRequestException('Solo se aceptan reservas con hasta un año de anticipación.');
    const bloqueo = await tx.one<{ motivo: string }>('SELECT fb_motivo AS motivo FROM fecha_bloqueada WHERE atr_id = $1 AND fb_fecha = $2', [a.atr_id, fecha]);
    if (bloqueo) throw sinCupos(`La atracción no opera el ${fecha}: ${bloqueo.motivo}`);

    const horarios = await tx.query<{ hor_id: string; hora: string; cupo: number }>(
      `SELECT hor_id::text, to_char(hor_hora, 'HH24:MI') AS hora, hor_cupo AS cupo FROM horario
        WHERE atr_id = $1 AND hor_activo ORDER BY hor_hora`,
      [a.atr_id],
    );
    const lista = horarios.map((h) => h.hora).join(', ');
    let hora = n.hora;
    if (!hora) {
      if (horarios.length !== 1) throw new BadRequestException(`Selecciona un horario: ${lista}`);
      hora = horarios[0].hora;
    }
    const horario = horarios.find((h) => h.hora === hora);
    if (!horario) throw new BadRequestException(`El horario ${hora} no existe. Horarios disponibles: ${lista}`);
    if (fecha === hoy && hora <= horaActualEc()) throw new BadRequestException('Esa salida ya partió hoy. Elige otro horario.');
    if (n.adultos < 1) throw new BadRequestException('Cada reserva debe incluir al menos un adulto.');
    const tickets = n.adultos + n.ninos + (n.seniors ?? 0) + (n.infantes ?? 0) + (n.estudiantes ?? 0);

    // 2) Inventario del día y horario: se crea si no existe y se BLOQUEA la fila.
    //    Dos reservas simultáneas del mismo horario se ejecutan una detrás de otra.
    await tx.query(
      `INSERT INTO disponibilidad (atr_id, hor_id, dis_fecha, dis_cupo_total) VALUES ($1, $2, $3, $4)
       ON CONFLICT (atr_id, dis_fecha, hor_id) DO NOTHING`,
      [a.atr_id, horario.hor_id, fecha, horario.cupo],
    );
    const inv = await tx.one<{ dis_id: string; total: number; reservado: number; cerrada: boolean }>(
      `SELECT dis_id::text, dis_cupo_total AS total, dis_cupo_reservado AS reservado, dis_cerrada AS cerrada
         FROM disponibilidad WHERE atr_id = $1 AND dis_fecha = $2 AND hor_id = $3 FOR UPDATE`,
      [a.atr_id, fecha, horario.hor_id],
    );
    if (inv!.cerrada) throw sinCupos(`La salida de las ${hora} está cerrada para esa fecha.`);
    const libres = inv!.total - inv!.reservado;
    if (tickets > libres) {
      throw sinCupos(
        libres > 0
          ? `Solo quedan ${libres} cupo(s) para las ${hora}; se pidieron ${tickets}. Reduce la cantidad o elige otro horario.`
          : `El horario de las ${hora} está agotado. Elige otro horario o fecha.`,
      );
    }
    await tx.query('UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado + $2 WHERE dis_id = $1', [inv!.dis_id, tickets]);

    if (n.tarjeta) {
      const [anio, mes] = hoy.split('-').map(Number);
      if (n.tarjeta.exp_year < anio || (n.tarjeta.exp_year === anio && n.tarjeta.exp_month < mes)) {
        throw new BadRequestException('La tarjeta está vencida.');
      }
      if (n.tarjeta.exp_year > anio + 20) throw new BadRequestException('La fecha de vencimiento de la tarjeta no es válida.');
    }
    const paxTelefono = n.telefono ? await n.telefono(tx) : null;
    const compra = await registrarCompra(tx, this.catalogos, {
      usuId: n.usuId,
      atrId: a.atr_id,
      atrNombre: a.nombre,
      disId: inv!.dis_id,
      fecha,
      hora,
      adultos: n.adultos,
      ninos: n.ninos,
      seniors: n.seniors ?? 0,
      infantes: n.infantes ?? 0,
      estudiantes: n.estudiantes ?? 0,
      precioAdulto: a.adulto,
      precioNino: a.nino ?? a.adulto,
      precioSenior: a.mayor ?? a.adulto,
      precioEstudiante: a.estudiante ?? a.adulto,
      moneda: a.moneda,
      metodo: n.metodo,
      origen: n.origen ?? 'WEB',
      sagaId: n.sagaId ?? null,
      confirmarSiempre: n.confirmarSiempre,
      paxNombre: n.paxNombre,
      paxDocumento: n.paxDocumento ?? null,
      paxTipoDocumento: n.paxTipoDocumento,
      paxCorreo: n.paxCorreo ?? null,
      paxTelefono,
      acompanantes: n.acompanantes,
      notas: n.notas ?? null,
      tarjeta: n.tarjeta,
    });
    return { uuid: compra.uuid, resId: compra.resId, disId: inv!.dis_id };
  }

  // ── Consultas ─────────────────────────────────────────────────────────
  async list(query: ReservationsQueryDto, user: AuthUser) {
    const p = new Params();
    const w: string[] = [];
    const alcance = this.alcance(user);
    if (query.all !== 'true' || alcance.tipo === 'propias') w.push(`o.usu_id = ${p.add(user.sub)}`);
    else if (alcance.tipo === 'operador') w.push(`op.ope_codigo = ${p.add(alcance.codigo)}`);

    if (query.status) w.push(`e.est_codigo = ANY(${p.add(STATUS_A_ESTADOS[query.status])}::text[])`);
    if (query.when === 'upcoming') w.push(`r.res_fecha >= ${HOY_EC}`);
    if (query.when === 'past') w.push(`r.res_fecha < ${HOY_EC}`);
    if (query.date) w.push(`r.res_fecha = ${p.add(query.date.slice(0, 10))}::date`);
    if (query.from) w.push(`r.res_fecha >= ${p.add(query.from.slice(0, 10))}::date`);
    if (query.to) w.push(`r.res_fecha <= ${p.add(query.to.slice(0, 10))}::date`);
    if (query.attraction_id) w.push(`a.atr_uuid = ${p.add(query.attraction_id)}`);
    if (query.q?.trim()) {
      const q = p.add(`%${escapeLike(query.q.trim())}%`);
      w.push(`(r.res_codigo ILIKE ${q} ESCAPE '\\' OR pax.pax_nombre ILIKE ${q} ESCAPE '\\' OR u.usu_correo ILIKE ${q} ESCAPE '\\' OR pax.pax_correo ILIKE ${q} ESCAPE '\\')`);
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const dir = query.when === 'past' ? 'DESC' : 'ASC';
    const rows = await this.db.query<FilaReserva & { total_filas: number }>(
      `SELECT x.*, COUNT(*) OVER ()::int AS total_filas FROM (${SELECT_RESERVA} ${where}) x
        ORDER BY x.fecha ${dir}, x.hora ASC LIMIT ${LIMITE_LISTADO}`,
      p.values,
    );
    return { rows: rows.map((r) => this.mapper.toReservation(r)), total: rows[0]?.total_filas ?? 0, limit: LIMITE_LISTADO };
  }

  /** Reserva propia o gestionable; con `lock` bloquea la fila antes de leer su estado (CON-003). */
  private async getOwned(uuid: string, user: AuthUser, sql: Sql = this.db, lock = false): Promise<FilaReserva> {
    if (lock) await sql.query('SELECT 1 FROM reserva WHERE res_uuid = $1 FOR UPDATE', [uuid]);
    const r = await this.fila(uuid, sql);
    // 404 en vez de 403 para no revelar que la reserva existe
    if (!r || (r.usu_id !== user.sub && !this.puedeGestionar(user, r))) throw new NotFoundException('Reserva no encontrada.');
    return r;
  }

  async getById(uuid: string, user: AuthUser) {
    return this.mapper.toReservation(await this.getOwned(uuid, user));
  }

  // ── Cancelar ──────────────────────────────────────────────────────────
  cancel(uuid: string, dto: CancelReservationRequestDto, key: string, user: AuthUser) {
    return this.idempotency.execute(key, `cancel:${uuid}`, user.sub, dto, async () => {
      await this.catalogos.precargar();
      const disId = await this.db.tx(async (tx) => {
        const r = await this.getOwned(uuid, user, tx, true);
        if (ESTADO_A_STATUS[r.estado] === ReservationStatus.CANCELLED) throw new ConflictException('Esta reserva ya estaba cancelada.');
        if (r.estado === 'CHECKED_IN') throw new ConflictException('El titular ya hizo el check-in: la experiencia está en curso y no puede cancelarse.');
        if (r.estado === 'COMPLETADA') throw new ConflictException('La experiencia ya se realizó; no puede cancelarse.');
        const gestor = this.puedeGestionar(user, r);
        const pol = this.mapper.politicaCancelacion(r);
        // La empresa o el administrador cancelan siempre con reembolso total (p. ej. clima adverso)
        let reembolsar = true;
        if (!gestor) {
          if (pol.policy === 'NOT_ALLOWED') throw new ConflictException(pol.motivo);
          if (pol.policy === 'NO_REFUND') {
            if (dto.accept_no_refund !== true) {
              throw new ConflictException({
                message: `${pol.motivo} Confirma que aceptas cancelar sin reembolso (accept_no_refund).`,
                code: 'NO_REFUND_CONFIRMATION_REQUIRED',
              });
            }
            reembolsar = false;
          }
        }
        const base = gestor && r.usu_id !== user.sub ? `[Operador] ${dto.reason}` : dto.reason;
        const motivo = reembolsar ? base : `${base} (sin reembolso)`;
        // Estado, cupos devueltos al inventario y reembolso, retención o anulación del pago
        await cancelarCompra(tx, this.catalogos, r.res_id, motivo, new Date(), reembolsar);
        return r.dis_id;
      });
      this.stock.publicar(disId, 'CANCELACION');
      await this.bitacora.registrar(user.sub, 'CANCELAR', 'reserva', uuid, { motivo: dto.reason });
      return this.mapper.toReservation((await this.fila(uuid))!);
    }, this.porReferencia);
  }

  // ── Confirmar (pago verificado por el operador) ───────────────────────
  confirm(uuid: string, key: string, user: AuthUser) {
    return this.idempotency.execute(key, `confirm:${uuid}`, user.sub, {}, async () => {
      await this.catalogos.precargar();
      await this.db.tx(async (tx) => {
        const r = await this.getOwned(uuid, user, tx, true);
        if (!this.puedeGestionar(user, r)) throw new ForbiddenException('Solo el personal de la empresa operadora puede confirmar esta reserva.');
        if (r.estado !== 'PENDIENTE_PAGO') {
          throw new ConflictException(`Solo se pueden confirmar reservas pendientes de pago (estado actual: ${ESTADO_A_STATUS[r.estado] ?? r.estado}).`);
        }
        await confirmarCompra(tx, this.catalogos, r.res_id);
      });
      await this.bitacora.registrar(user.sub, 'CONFIRMAR_PAGO', 'reserva', uuid);
      return this.mapper.toReservation((await this.fila(uuid))!);
    }, this.porReferencia);
  }
}
