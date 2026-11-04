import {
  BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { DbService, Sql } from './comun/db.service';
import { iniciarServidorGrpc } from './comun/grpc';
import { parseHora } from './comun/tiempo';
import { AvisoCheckin } from './aviso-checkin';
import { CatalogoClient, FacturacionClient, InventarioClient, OrdenClient, Pago, PagoClient, PricingClient, ReembolsoClient } from './clientes';
import { CancelReservationRequestV2, CheckinRequestV2, CreateReservaRequestV2 } from './dto';
import { icsReserva } from './enlaces';
import { EVENTOS, EventosService } from './eventos';
import { Idempotencia, Referencia } from './idempotencia';
import { FilaReserva, politicaCancelacion, qrUrl, reservaContrato, SELECT_RESERVA, voucher } from './modelo';
import { esCedulaEc } from './validadores';
import { leerVoucher } from './voucher';

/** Método del contrato → método de ms_payment. Booking ya cobró en su pasarela (SOA_BOOKING_GATEWAY). */
const METODO: Record<CreateReservaRequestV2['payment_method'], string> = {
  TARJETA_CREDITO: 'TARJETA', TRANSFERENCIA: 'TRANSFERENCIA', SOA_BOOKING_GATEWAY: 'SOA_BOOKING_GATEWAY', PAGO_EN_SITIO: 'EN_SITIO',
};
/** mpa_id de ms_payment (orden del script + sql/002): ID lógico que guarda la orden. */
const MPA_ID: Record<string, number> = { TARJETA: 1, TRANSFERENCIA: 2, EN_SITIO: 3, PAYPHAL: 4, SOA_BOOKING_GATEWAY: 5 };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para dictarlo sin errores
const sufijo = () => Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
const dinero = (c: number) => (c / 100).toFixed(2);
const cent = (m: string | number) => Math.round(Number(m) * 100);
/** +593 9XXXXXXXX → 09XXXXXXXX (formato local); otros E.164 se guardan tal cual. */
const telefonoLocal = (t: string) => (/^\+5939\d{8}$/.test(t) ? `0${t.slice(4)}` : /^\+593[2-7]\d{7}$/.test(t) ? `0${t.slice(4)}` : t);

const TIPOS = [
  { clave: 'adultos', codigo: 'AD', nombre: 'Adulto' },
  { clave: 'ninos', codigo: 'NI', nombre: 'Niño' },
  { clave: 'seniors', codigo: 'MA', nombre: 'Adulto mayor' },
  { clave: 'estudiantes', codigo: 'ES', nombre: 'Estudiante' },
  { clave: 'infantes', codigo: 'IN', nombre: 'Infante' },
] as const;

/**
 * Booking Service: reservas del contrato v2/v3 con Booking Prototipo. Es el ORQUESTADOR de la saga
 * (catalog → pricing → inventory → order → payment → booking → invoicing) con compensaciones.
 */
@Injectable()
export class ReservasService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Saga');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly idem: Idempotencia,
    private readonly eventos: EventosService,
    private readonly catalogo: CatalogoClient,
    private readonly pricing: PricingClient,
    private readonly inventario: InventarioClient,
    private readonly orden: OrdenClient,
    private readonly pagos: PagoClient,
    private readonly reembolsos: ReembolsoClient,
    private readonly facturas: FacturacionClient,
    private readonly aviso: AvisoCheckin,
  ) {}

  onApplicationBootstrap() {
    // Facturas que no se pudieron emitir porque ms_invoicing no respondía: se reintentan solas
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.facturasPendientes(), 30_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Usuario técnico dueño de las órdenes de Booking (lo copia `npm run migrar` desde la tienda). */
  private async usuarioBooking(): Promise<string> {
    const p = await this.db.one<{ v: string }>(`SELECT par_valor AS v FROM parametro WHERE par_clave = 'usuario_booking'`);
    return p?.v ?? process.env.BOOKING_USUARIO_ID ?? '1';
  }

  async fila(ref: string, sql: Sql = this.db): Promise<FilaReserva | null> {
    return sql.one<FilaReserva>(`${SELECT_RESERVA} WHERE ${RE_UUID.test(ref) ? 'r.res_uuid = $1::uuid' : 'r.res_codigo = upper($1)'}`, [ref]);
  }

  async filaOr404(ref: string, sql: Sql = this.db): Promise<FilaReserva> {
    const f = await this.fila(ref, sql);
    if (!f) throw new NotFoundException(`La reserva ${ref} no existe.`);
    return f;
  }

  private readonly porReferencia: Referencia<ReturnType<typeof reservaContrato>> = {
    referencia: (r) => r.reservation_id,
    reconstruir: async (uuid) => reservaContrato(await this.filaOr404(uuid)),
  };

  async obtener(ref: string) {
    return reservaContrato(await this.filaOr404(ref));
  }

  private validarDocumento(tipo: string, doc: string) {
    if (tipo === 'CEDULA' && !esCedulaEc(doc)) {
      throw new HttpException({ message: 'customer.document_id no es una cédula ecuatoriana válida (falla el dígito verificador, módulo 10).', code: 'INVALID_DOCUMENT' }, 422);
    }
    if (tipo === 'PASAPORTE' && !/^[A-Z0-9]{6,9}$/.test(doc)) {
      throw new HttpException({ message: 'customer.document_id: el pasaporte debe tener de 6 a 9 letras o números.', code: 'INVALID_DOCUMENT' }, 422);
    }
    if (tipo === 'RUC' && !/^\d{13}$/.test(doc)) throw new HttpException({ message: 'customer.document_id: el RUC debe tener 13 dígitos.', code: 'INVALID_DOCUMENT' }, 422);
  }

  /** POST /reservas del contrato: 201 confirmada o 409 OUT_OF_STOCK (activa la compensación de la saga de Booking). */
  async crear(dto: CreateReservaRequestV2, key: string, ctx: { origen: 'WEB' | 'BOOKING'; usuId: string | null } = { origen: 'BOOKING', usuId: null }) {
    if (dto.idempotency_key && dto.idempotency_key !== key) throw new BadRequestException('idempotency_key del cuerpo no coincide con la cabecera Idempotency-Key.');
    const hora = parseHora(dto.hora);
    if (!hora) throw new BadRequestException('hora no es válida: usa HH:mm:ss (24 h) o el formato del turno, p. ej. «10:30 a.m.».');
    const [, diaSlot, horaSlot] = /^slot-(\d{8})-(\d{4})$/.exec(dto.slot_id)!;
    const fechas = [dto.fecha, dto.date].filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 10));
    const horas = [hora, ...[dto.time, dto.time_24h].filter((h): h is string => typeof h === 'string').map((h) => parseHora(h))];
    const fechaMal = fechas.find((f) => f.replace(/-/g, '') !== diaSlot);
    const horaMal = horas.find((h) => !h || h.replace(':', '') !== horaSlot);
    if (fechaMal !== undefined || horaMal !== undefined) {
      throw new BadRequestException({
        message: `El slot_id ${dto.slot_id} no corresponde a ${fechaMal !== undefined ? `la fecha ${fechaMal}` : `la hora ${horaMal ?? dto.time}`}.`,
        code: 'SLOT_TIME_MISMATCH',
      });
    }
    this.validarDocumento(dto.customer.document_type, dto.customer.document_id);
    const n = { adultos: dto.adult_count, ninos: dto.child_count ?? 0, seniors: dto.senior_count ?? 0, estudiantes: dto.student_count ?? 0, infantes: dto.infant_count ?? 0 };
    const tickets = n.adultos + n.ninos + n.seniors + n.estudiantes + n.infantes;
    if (tickets > 50) throw new BadRequestException('Una reserva admite como máximo 50 boletos.');
    if (dto.total_tickets !== undefined && dto.total_tickets !== tickets) {
      throw new BadRequestException({ message: `total_tickets (${dto.total_tickets}) no coincide con la suma de los boletos (${tickets}).`, code: 'TOTAL_TICKETS_MISMATCH' });
    }
    if ((dto.passengers?.length ?? 0) > tickets - 1) throw new BadRequestException('passengers tiene más acompañantes que boletos (el titular ya ocupa uno).');
    const a = await this.catalogo.atraccion(dto.atraccion_id);
    if (a.atr_estado !== 'PUBLICADA' || a.atr_eliminado_en) throw new NotFoundException('La atracción no existe o ya no está disponible.');
    const sujeto = ctx.usuId ?? (await this.usuarioBooking());
    return this.idem.ejecutar(key, `v2:reserve:${a.atr_uuid}`, 'booking', { ...dto, atraccion_id: a.atr_uuid }, () => this.saga(dto, a, hora, n, tickets, sujeto, ctx), this.porReferencia);
  }

  private async saga(
    dto: CreateReservaRequestV2, a: Awaited<ReturnType<CatalogoClient['atraccion']>>, hora: string,
    n: Record<(typeof TIPOS)[number]['clave'], number>, tickets: number, sujeto: string, ctx: { origen: 'WEB' | 'BOOKING'; usuId: string | null },
  ) {
    const fecha = dto.fecha.slice(0, 10);
    // Booking lo envía en la raíz y en customer (contrato v3.1): si vienen los dos deben coincidir
    if (dto.client_id && dto.customer.client_id && dto.client_id !== dto.customer.client_id) {
      throw new BadRequestException('client_id no coincide con customer.client_id.');
    }
    const clientId = dto.client_id ?? dto.customer.client_id ?? null;
    const t = await this.pricing.tarifas(a.atr_id);
    if (!t?.adulto) throw new ConflictException('Esta atracción no tiene una tarifa vigente. Intenta más tarde.');
    const precio: Record<string, number> = {
      adultos: cent(t.adulto), ninos: cent(t.nino || t.adulto), seniors: cent(t.mayor || t.adulto), estudiantes: cent(t.estudiante || t.adulto), infantes: 0,
    };
    const total = TIPOS.reduce((s, x) => s + n[x.clave] * precio[x.clave], 0);
    const moneda = t.moneda || a.atr_moneda || 'USD';
    const resUuid = randomUUID();
    const metodo = METODO[dto.payment_method];
    const compensar: { paso: string; fn: () => Promise<unknown> }[] = [];
    try {
      // 1) Cupos (sin sobreventa). Sin cupos → 409 OUT_OF_STOCK tal cual lo responde ms_inventory.
      const turno = await this.inventario.retener({ atr_id: a.atr_id, fecha, hora, cupos: tickets, referencia: resUuid });
      compensar.push({ paso: 'liberar cupos', fn: () => this.inventario.liberar({ dis_id: turno.dis_id, cupos: tickets, referencia: resUuid }) });

      // 2) Orden con una línea por tipo de boleto (DEC-/ORD-/PAG- comparten sufijo; si choca, otro)
      const lineas = TIPOS.filter((x) => n[x.clave] > 0).map((x) => ({
        atr_id: String(a.atr_id), descripcion: `${a.atr_nombre} · ${fecha} ${hora} · ${x.nombre}`.slice(0, 255), cantidad: n[x.clave],
        precio_unitario: dinero(precio[x.clave]), subtotal: dinero(n[x.clave] * precio[x.clave]), codigo: `ATR-${a.atr_id}-${x.codigo}`,
      }));
      let suf = sufijo();
      let orden: Awaited<ReturnType<OrdenClient['crear']>> | null = null;
      for (let intento = 1; !orden; intento++) {
        try {
          orden = await this.orden.crear({
            usu_id: sujeto, mpa_id: MPA_ID[metodo], moneda, sufijo: suf, idempotency_key: resUuid, observaciones: dto.special_requirements ?? '',
            lineas: lineas.map(({ codigo: _c, ...l }) => l),
          });
        } catch (e) {
          if (intento >= 5 || (e as { response?: { code?: string } }).response?.code !== 'NUMERO_DUPLICADO') throw e;
          suf = sufijo();
        }
      }
      const ord = orden;
      compensar.push({ paso: 'cancelar orden', fn: () => this.orden.cambiarEstado(ord.ord_id, 'CANCELADA') });

      // 3) Pago (simulado): tarjeta o pasarela de Booking → APROBADO; transferencia o en sitio → PENDIENTE
      const pago = await this.pagos.crear({ ord_id: Number(ord.ord_id), mpa_codigo: metodo, monto: dinero(total), sufijo: suf });
      const pagada = pago.estado === 'APROBADO';
      compensar.length = 1; // la orden se compensa con el pago (abajo), no cancelándola sola
      compensar.push({
        paso: 'deshacer pago',
        fn: async () => {
          if (pagada) {
            await this.reembolsos.crear(pago.pag_id, 'Compensación: la reserva no se pudo completar');
            await this.orden.cambiarEstado(ord.ord_id, 'PAGADA').catch(() => undefined);
            await this.orden.cambiarEstado(ord.ord_id, 'REEMBOLSADA');
          } else {
            await this.pagos.rechazar(pago.pag_id, 'La reserva no se pudo completar');
            await this.orden.cambiarEstado(ord.ord_id, 'CANCELADA');
          }
        },
      });

      // 4) La reserva (nace CONFIRMADA para Booking, como en la tienda) y sus eventos
      const detPrincipal = ord.lineas[0].det_id;
      const resId = await this.db.tx(async (tx) => {
        const r = await tx.one<{ res_id: string }>(
          `INSERT INTO reserva (res_uuid, res_codigo, det_id, dis_id, est_id, res_adultos, res_ninos, res_seniors, res_estudiantes, res_infantes,
                                res_numero_tickets, res_precio_unitario, res_precio_nino, res_precio_senior, res_precio_estudiante, res_subtotal,
                                res_observaciones, res_confirmado_en, res_fecha, res_hora, res_origen, res_saga_id, res_booking_ref,
                                ord_id, ord_numero, pag_id, atr_id, atr_uuid, atr_nombre, res_punto_encuentro, res_guia,
                                res_cancelacion_gratuita, res_horas_cancelacion, res_moneda, res_metodo_pago, res_pago_estado, res_factura_pendiente, res_client_id, res_usu_id)
           VALUES ($1, $2, $3, $4, (SELECT est_id FROM estado WHERE est_codigo = 'CONFIRMADA'), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16, now(), $17, $18::time, $36, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $37)
           RETURNING res_id::text`,
          [
            resUuid, `DEC-${suf}`, detPrincipal, turno.dis_id, n.adultos, n.ninos, n.seniors, n.estudiantes, n.infantes, tickets,
            dinero(precio.adultos), dinero(precio.ninos), n.seniors ? dinero(precio.seniors) : null, n.estudiantes ? dinero(precio.estudiantes) : null,
            dinero(total), dto.special_requirements ?? null, fecha, hora, dto.saga_id ?? null, (dto as { booking_reservation_id?: string }).booking_reservation_id ?? null,
            ord.ord_id, ord.ord_numero, pago.pag_id, a.atr_id, a.atr_uuid, a.atr_nombre,
            a.atr_punto_encuentro ?? a.atr_direccion ?? (await this.catalogo.ciudad(a.ciu_id)), a.atr_guia,
            a.atr_cancelacion_gratuita, a.atr_horas_cancelacion, moneda, metodo, pago.estado, pagada, clientId, ctx.origen, ctx.usuId,
          ],
        );
        const c = dto.customer;
        await tx.query(
          `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_documento, pax_tipo_documento, pax_correo, pax_telefono, pax_es_titular, pax_tipo_boleto)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'ADULT')`,
          [r!.res_id, c.full_name.slice(0, 120), c.document_id, c.document_type, c.email, telefonoLocal(c.phone)],
        );
        for (const p of dto.passengers ?? []) {
          // Documento del acompañante: solo una cédula válida o un pasaporte; si no, se guarda sin documento
          const doc = p.document_id && (esCedulaEc(p.document_id) || /^[A-Z0-9]{6,9}$/.test(p.document_id)) ? p.document_id : null;
          await tx.query(
            `INSERT INTO reserva_pasajero (res_id, pax_nombre, pax_documento, pax_tipo_documento, pax_es_titular, pax_tipo_boleto) VALUES ($1, $2, $3, $4, FALSE, $5)`,
            [r!.res_id, p.full_name.slice(0, 120), doc, doc && esCedulaEc(doc) ? 'CEDULA' : 'PASAPORTE', p.ticket_type],
          );
        }
        await this.eventos.reserva(tx, EVENTOS.RESERVA_CREADA, r!.res_id);
        if (pagada) await this.eventos.reserva(tx, EVENTOS.PAGO_APROBADO, r!.res_id, { payment_number: pago.pag_numero });
        await this.eventos.reserva(tx, EVENTOS.RESERVA_CONFIRMADA, r!.res_id);
        return r!.res_id;
      });

      // 5) Orden PAGADA y factura con su detalle, DESPUÉS de responder: no son necesarias para confirmar la
      //    reserva y Booking corta a los 4 s. Quedan marcadas (res_factura_pendiente) y, si algo falla, se
      //    reintentan solas cada 30 s.
      if (pagada) setImmediate(() => void this.emitirFactura(resId).catch((e: Error) => this.logger.warn(`Factura de ${resUuid} pendiente: ${e.message}`)));
      return reservaContrato(await this.filaOr404(resUuid));
    } catch (e) {
      for (const c of compensar.reverse()) {
        await c.fn().catch((err: Error) => this.logger.error(`Compensación «${c.paso}» de ${resUuid} falló: ${err.message}`));
      }
      throw e;
    }
  }

  /** Emite (SOAP) la factura de una reserva pagada con las líneas de su orden. Idempotente en ms_invoicing. */
  private async emitirFactura(resId: string) {
    const r = await this.db.one<{ ord_id: string; atr_id: string; doc: string; tipo: string; nombre: string; correo: string; tel: string | null; estado: string }>(
      `SELECT r.ord_id::text, r.atr_id::text, p.pax_documento AS doc, p.pax_tipo_documento AS tipo, p.pax_nombre AS nombre, p.pax_correo AS correo,
              p.pax_telefono AS tel, e.est_codigo AS estado
         FROM reserva r JOIN estado e ON e.est_id = r.est_id JOIN reserva_pasajero p ON p.res_id = r.res_id AND p.pax_es_titular WHERE r.res_id = $1`,
      [resId],
    );
    if (!r?.ord_id) return;
    if (r.estado === 'CANCELADA') return void (await this.db.query('UPDATE reserva SET res_factura_pendiente = FALSE WHERE res_id = $1', [resId]));
    const orden = await this.orden.cambiarEstado(r.ord_id, 'PAGADA'); // devuelve la orden (repetir el estado no falla)
    const codigo = (desc: string) => `ATR-${r.atr_id}-${TIPOS.find((x) => desc.endsWith(`· ${x.nombre}`))?.codigo ?? 'AD'}`;
    await this.facturas.emitir(
      r.ord_id,
      {
        tipo_identificacion: r.doc ? r.tipo : 'CONSUMIDOR_FINAL', identificacion: r.doc ?? '9999999999999', razon_social: r.nombre,
        correo: r.correo ?? 'consumidor@descubre-ec.com', ...(r.tel && /^\+?\d{7,15}$/.test(r.tel) ? { telefono: r.tel } : {}),
      },
      orden.lineas.map((l) => ({ det_id: l.det_id, codigo: codigo(l.descripcion), descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario })),
    );
    await this.db.query('UPDATE reserva SET res_factura_pendiente = FALSE WHERE res_id = $1', [resId]);
  }

  async facturasPendientes(): Promise<number> {
    const p = await this.db.query<{ res_id: string }>('SELECT res_id::text FROM reserva WHERE res_factura_pendiente ORDER BY res_id LIMIT 20');
    let n = 0;
    for (const f of p) if (await this.emitirFactura(f.res_id).then(() => true, () => false)) n++;
    return n;
  }

  /**
   * Cancelación / compensación de la saga de Booking. Idempotente: cancelar una reserva ya cancelada devuelve
   * 200 con su estado. SAGA_ORCHESTRATOR y ADMIN cancelan siempre con reembolso total; el CLIENTE solo dentro
   * de su plazo. Cada paso remoto es idempotente: si uno falla (503), reintentar lo completa.
   */
  async cancelar(ref: string, dto: CancelReservationRequestV2, key: string, op: { aceptaSinReembolso?: boolean } = {}) {
    const r0 = await this.filaOr404(ref);
    return this.idem.ejecutar(key, `v2:cancel:${r0.id}`, 'booking', dto, async () => {
      const r = await this.filaOr404(r0.id);
      if (r.estado === 'CANCELADA') return reservaContrato(r);
      if (r.estado === 'CHECKED_IN') throw new ConflictException({ message: 'El titular ya hizo el check-in: la experiencia está en curso y no puede cancelarse.', code: 'INVALID_STATE' });
      if (r.estado === 'COMPLETADA') throw new ConflictException({ message: 'La experiencia ya se realizó; no puede cancelarse.', code: 'INVALID_STATE' });
      const solicitante = dto.solicitante ?? 'CLIENTE';
      if (solicitante === 'CLIENTE') {
        const pol = politicaCancelacion(r);
        if (pol.policy === 'NOT_ALLOWED') throw new BadRequestException(pol.motivo);
        if (pol.policy === 'NO_REFUND' && !op.aceptaSinReembolso) throw new BadRequestException(`${pol.motivo} Fuera del plazo de cancelación gratuita solo el orquestador (SAGA_ORCHESTRATOR) o un ADMIN pueden cancelarla.`);
      }
      const sinReembolso = solicitante === 'CLIENTE' && politicaCancelacion(r).policy === 'NO_REFUND';
      const motivo = `[${solicitante}] ${dto.reason || (solicitante === 'SAGA_ORCHESTRATOR' ? 'Compensación de saga de Booking' : 'Cancelación solicitada en Booking')}`.slice(0, 255);

      await this.inventario.liberar({ dis_id: r.dis_id, cupos: r.tickets, referencia: r.id });
      let pago: Pago | null = r.pag_id ? await this.pagos.uno(Number(r.pag_id)) : null;
      let reembolso: { rem_numero: string; rem_monto: string } | null = null;
      if (pago?.estado === 'APROBADO' && !sinReembolso) {
        reembolso = await this.reembolsos.crear(pago.pag_id, motivo);
        if (r.ord_id) {
          // La orden pasa a PAGADA después de responder la compra: si la cancelación llega antes, se completa aquí
          await this.orden.cambiarEstado(r.ord_id, 'PAGADA').catch(() => undefined);
          await this.orden.cambiarEstado(r.ord_id, 'REEMBOLSADA');
        }
        if (r.ord_id) {
          await this.facturas.anular(r.ord_id, motivo).catch((e: { status?: number }) => {
            if (e.status !== 404) throw e; // sin factura emitida (p. ej. quedó pendiente): nada que anular
          });
        }
      } else if (pago?.estado === 'PENDIENTE') {
        pago = await this.pagos.rechazar(pago.pag_id, 'Reserva cancelada antes del pago');
        if (r.ord_id) await this.orden.cambiarEstado(r.ord_id, 'CANCELADA');
      }
      await this.db.tx(async (tx) => {
        await tx.query(
          `UPDATE reserva SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'CANCELADA'), res_motivo_cancelacion = $2, res_cancelado_en = now(),
                  res_pago_estado = COALESCE($3, res_pago_estado), res_reembolso_numero = $4, res_reembolso_monto = $5, res_factura_pendiente = FALSE
            WHERE res_id = $1`,
          [r.res_id, motivo, pago?.estado ?? null, reembolso?.rem_numero ?? null, reembolso?.rem_monto ?? null],
        );
        await this.eventos.reserva(tx, EVENTOS.RESERVA_CANCELADA, r.res_id, { reason: motivo, refunded: !!reembolso });
        if (reembolso) await this.eventos.reserva(tx, EVENTOS.PAGO_REEMBOLSADO, r.res_id, { refund_amount: Number(reembolso.rem_monto) });
      });
      return reservaContrato(await this.filaOr404(r.id));
    }, this.porReferencia);
  }

  /** Confirma un pago pendiente (transferencia, en sitio) desde el panel. Idempotente. */
  async confirmarPago(ref: string): Promise<void> {
    const r = await this.filaOr404(ref);
    if (r.estado === 'CANCELADA') throw new ConflictException({ message: 'La reserva está cancelada.', code: 'RESERVATION_CANCELLED' });
    if (r.pago_estado === 'APROBADO' || !r.pag_id) return;
    const pago = await this.pagos.aprobar(Number(r.pag_id));
    await this.db.query('UPDATE reserva SET res_pago_estado = $2, res_factura_pendiente = TRUE WHERE res_id = $1', [r.res_id, pago.estado]);
    setImmediate(() => void this.emitirFactura(r.res_id).catch((e: Error) => this.logger.warn(`Factura de ${r.id} pendiente: ${e.message}`)));
  }

  /** Reservas para la web y el panel, con filtros por dueño y atracción. */
  filas(f: { usuId?: string; atrUuids?: string[]; atrUuid?: string; limite?: number }) {
    return this.db.query<FilaReserva>(
      `${SELECT_RESERVA}
        WHERE ($1::text IS NULL OR r.res_usu_id = $1) AND ($2::uuid[] IS NULL OR r.atr_uuid = ANY($2::uuid[])) AND ($3::uuid IS NULL OR r.atr_uuid = $3)
        ORDER BY r.res_id DESC LIMIT $4`,
      [f.usuId ?? null, f.atrUuids ?? null, f.atrUuid ?? null, f.limite ?? 500],
    );
  }

  private respuestaCheckin(r: FilaReserva) {
    return {
      reserva_id: r.id,
      reservation_code: r.codigo,
      estado: 'CHECKED_IN' as const,
      titular_nombre: r.pax_nombre ?? '',
      titular_documento: r.pax_documento ?? '',
      guia_asignado: r.guia ?? 'Guía oficial asignado por Descubre EC',
      punto_encuentro: r.punto_encuentro ?? '',
      hora_checkin: new Date(r.checkin_en!).toISOString(),
      pase_abordar_qr: qrUrl(r.codigo, true),
    };
  }

  /** Check-in presencial (la misma Idempotency-Key repite el pase ya emitido; otra clave sobre una reserva ya registrada → 409). */
  async checkin(ref: string, dto: CheckinRequestV2, key: string, adminId?: string) {
    const r0 = await this.filaOr404(ref);
    return this.idem.ejecutar(key, `v2:checkin:${r0.id}`, 'booking', dto, () => this.registrarCheckin(r0.id, dto, adminId), {
      referencia: (r) => r.reserva_id,
      reconstruir: async (uuid) => this.respuestaCheckin(await this.filaOr404(uuid)),
    });
  }

  private async registrarCheckin(ref: string, dto: CheckinRequestV2, adminId?: string) {
    const secreto = process.env.VOUCHER_SECRET ?? process.env.JWT_SECRET ?? '';
    const r = await this.db.tx(async (tx) => {
      await tx.query('SELECT 1 FROM reserva WHERE res_uuid = $1 FOR UPDATE', [ref]);
      const f = await this.filaOr404(ref, tx);
      if (f.estado === 'CANCELADA') throw new ConflictException({ message: 'La reserva está cancelada: no admite check-in.', code: 'RESERVATION_CANCELLED' });
      if (f.estado === 'CHECKED_IN') throw new ConflictException({ message: `El check-in ya se registró el ${new Date(f.checkin_en!).toISOString()}.`, code: 'ALREADY_CHECKED_IN' });
      if (f.estado === 'PENDIENTE_PAGO') throw new ConflictException({ message: 'La reserva tiene el pago pendiente: confírmalo antes del check-in.', code: 'PAYMENT_PENDING' });
      if (f.estado === 'COMPLETADA') throw new ConflictException({ message: 'La experiencia ya se realizó.', code: 'ALREADY_COMPLETED' });
      const qr = dto.codigo_voucher_qr?.trim();
      const qrValido = !!qr && (qr.toUpperCase() === f.codigo || leerVoucher(qr, secreto)?.r === f.id);
      if (qr && !qrValido) throw new BadRequestException('El código QR no corresponde a esta reserva o fue alterado.');
      const doc = dto.documento_identidad.replace(/[\s.-]/g, '');
      if (f.pax_documento) {
        if (doc !== f.pax_documento.toUpperCase()) throw new BadRequestException('El documento presentado no coincide con el del titular de la reserva.');
      } else if (!qrValido) {
        throw new BadRequestException('La reserva no tiene documento registrado: valida al titular escaneando el código QR del voucher.');
      }
      await tx.query(
        `UPDATE reserva SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'CHECKED_IN'), res_checkin_en = now(), res_checkin_guia = $2, res_checkin_dispositivo = $3,
                res_checkin_admin = $4, res_checkin_asistentes = $5, res_checkin_observaciones = $6,
                res_aviso_checkin = CASE WHEN res_origen = 'BOOKING' THEN 'PENDIENTE' END
          WHERE res_uuid = $1`,
        [f.id, dto.guia_codigo ?? null, dto.scanner_device_id ?? null, (adminId ?? dto.guia_codigo ?? null)?.slice(0, 120) ?? null, dto.asistentes_reales ?? null, dto.observaciones ?? null],
      );
      await this.eventos.reserva(tx, EVENTOS.RESERVA_CHECKIN, f.res_id, { guide_code: dto.guia_codigo ?? null });
      return this.filaOr404(f.id, tx);
    });
    if (r.origen === 'BOOKING') this.aviso.programar(r.res_id);
    return { ...this.respuestaCheckin(r), titular_documento: r.pax_documento ?? dto.documento_identidad };
  }

  /** Contenido del QR: voucher (siempre) o pase de abordar (solo después del check-in). */
  async contenidoQr(codigo: string, pase: boolean) {
    const r = await this.filaOr404(codigo);
    if (pase && r.estado !== 'CHECKED_IN') throw new NotFoundException('El pase de abordar se emite después del check-in.');
    return voucher(r, pase ? 'pase' : 'voucher');
  }

  async ics(uuid: string) {
    const r = await this.filaOr404(uuid);
    let duracion = 2;
    try {
      duracion = Number((await this.catalogo.atraccion(r.atr_uuid)).atr_duracion_horas) || 2;
    } catch {
      /* sin ms_catalog: 2 h */
    }
    return { codigo: r.codigo, texto: icsReserva({ id: r.id, codigo: r.codigo, nombre: r.atr_nombre, fecha: r.fecha, hora: r.hora, duracionHoras: duracion, lugar: r.punto_encuentro ?? '', personas: r.tickets }) };
  }

  listar(limite = 100) {
    return this.db.query(`${SELECT_RESERVA} ORDER BY r.res_id DESC LIMIT $1`, [limite]).then((f) => (f as FilaReserva[]).map(reservaContrato));
  }
}

/** Servidor gRPC descubre.reserva.v1.ReservaService (GRPC_PORT, 50048 por defecto). */
@Injectable()
export class ReservaGrpc implements OnApplicationBootstrap, OnApplicationShutdown {
  private cerrar: (() => Promise<void>) | null = null;
  constructor(private readonly s: ReservasService) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' && !process.env.GRPC_PORT) return;
    this.cerrar = await iniciarServidorGrpc('reserva.proto', 'descubre.reserva.v1.ReservaService', {
      ObtenerReserva: async (q: { referencia: string }) => {
        const r = await this.s.filaOr404(q.referencia);
        const c = reservaContrato(r);
        return { reservation_id: r.id, reservation_code: r.codigo, status: c.status, atr_id: r.atr_id, fecha: r.fecha, hora: r.hora, tickets: r.tickets, total: r.total.toFixed(2), moneda: r.moneda };
      },
    }, 50048, 'ms-booking');
  }

  async onApplicationShutdown() {
    await this.cerrar?.();
  }
}
