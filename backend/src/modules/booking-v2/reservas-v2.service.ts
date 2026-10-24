import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogosService } from '../../common/db/catalogos.service';
import { DbService, Sql } from '../../common/db/db.service';
import { emitirEventoReserva, EVENTOS } from '../../common/db/eventos';
import { IdempotencyService, Referencia } from '../../common/idempotency/idempotency.service';
import { esCedulaEc } from '../../common/utils/validators';
import { AtraccionMapper } from '../atracciones/atraccion.mapper';
import { cancelarCompra, MetodoCompra } from '../atracciones/compras';
import { PaymentMethod } from '../atracciones/dto/reservation.dto';
import { FilaReserva, SELECT_RESERVA } from '../atracciones/modelo';
import { ReservasService } from '../atracciones/reservas.service';
import { StockSyncService } from '../atracciones/stock-sync.service';
import { parseHora } from '../atracciones/utils/hora12';
import { CatalogoV2Service } from './catalogo-v2.service';
import { CancelReservationRequestV2, CheckinRequestV2, CreateReservaRequestV2 } from './dto';
import { MapperV2 } from './mapper-v2';
import { leerVoucher } from './voucher';

/** Usuario técnico dueño de las órdenes de Booking (migración 009). */
export const CORREO_BOOKING = 'integracion.booking@descubre-ec.com';

const METODO: Record<CreateReservaRequestV2['payment_method'], MetodoCompra> = {
  TARJETA_CREDITO: PaymentMethod.TARJETA,
  TRANSFERENCIA: PaymentMethod.TRANSFERENCIA,
  SOA_BOOKING_GATEWAY: 'SOA_BOOKING_GATEWAY',
  PAGO_EN_SITIO: PaymentMethod.EN_SITIO,
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** +593 9XXXXXXXX → 09XXXXXXXX (formato local); otros E.164 se guardan tal cual. */
const telefonoLocal = (t: string) => (/^\+5939\d{8}$/.test(t) ? `0${t.slice(4)}` : /^\+593[2-7]\d{7}$/.test(t) ? `0${t.slice(4)}` : t);

/**
 * Reservas del contrato v2 (Booking Prototipo). Usan el MISMO núcleo que la web
 * (ReservasService.crearEnTransaccion: bloqueo del turno, sin sobreventa) y nacen CONFIRMADAS.
 */
@Injectable()
export class ReservasV2Service {
  private sujeto: string | null = null;

  constructor(
    private readonly db: DbService,
    private readonly catalogos: CatalogosService,
    private readonly idempotency: IdempotencyService,
    private readonly reservas: ReservasService,
    private readonly stock: StockSyncService,
    private readonly catalogo: CatalogoV2Service,
    private readonly mapper: MapperV2,
    private readonly base: AtraccionMapper,
    private readonly config: ConfigService,
  ) {}

  /** id del usuario técnico de Booking (dueño de la orden y sujeto de la idempotencia). */
  private async usuarioBooking(): Promise<string> {
    if (this.sujeto) return this.sujeto;
    const u = await this.db.one<{ id: string }>('SELECT usu_id::text AS id FROM usuario WHERE usu_correo = $1', [CORREO_BOOKING]);
    if (!u) throw new Error('Falta el usuario técnico de Booking (migración 009).');
    this.sujeto = u.id;
    return u.id;
  }

  /** Reserva por UUID o por código PNR (DEC-XXXXXX). */
  private fila(ref: string, sql: Sql = this.db): Promise<FilaReserva | null> {
    const porUuid = RE_UUID.test(ref);
    return sql.one<FilaReserva>(`${SELECT_RESERVA} WHERE ${porUuid ? 'r.res_uuid = $1::uuid' : 'r.res_codigo = upper($1)'}`, [ref]);
  }

  private async filaOr404(ref: string, sql: Sql = this.db): Promise<FilaReserva> {
    const f = await this.fila(ref, sql);
    if (!f) throw new NotFoundException(`La reserva ${ref} no existe.`);
    return f;
  }

  private readonly porReferencia: Referencia<ReturnType<MapperV2['reserva']>> = {
    referencia: (r) => r.reservation_id,
    reconstruir: async (uuid) => this.mapper.reserva(await this.filaOr404(uuid)),
  };

  async obtener(ref: string) {
    return this.mapper.reserva(await this.filaOr404(ref));
  }

  /** Documento del titular según su tipo; una cédula con dígito verificador inválido es 422. */
  private validarDocumento(tipo: string, doc: string) {
    if (tipo === 'CEDULA' && !esCedulaEc(doc)) {
      throw new UnprocessableEntityException({
        message: 'customer.document_id no es una cédula ecuatoriana válida (falla el dígito verificador, módulo 10).',
        code: 'INVALID_DOCUMENT',
      });
    }
    if (tipo === 'PASAPORTE' && !/^[A-Z0-9]{6,9}$/.test(doc)) {
      throw new UnprocessableEntityException({ message: 'customer.document_id: el pasaporte debe tener de 6 a 9 letras o números.', code: 'INVALID_DOCUMENT' });
    }
    if (tipo === 'RUC' && !/^\d{13}$/.test(doc)) {
      throw new UnprocessableEntityException({ message: 'customer.document_id: el RUC debe tener 13 dígitos.', code: 'INVALID_DOCUMENT' });
    }
  }

  /** POST /atracciones/reservas y /atracciones/{id}/reservations: 201 o 409 OUT_OF_STOCK. */
  async crear(atrRef: string | undefined, dto: CreateReservaRequestV2, key: string) {
    const ref = atrRef ?? dto.atraccion_id;
    if (!ref) throw new BadRequestException('atraccion_id es obligatorio en POST /atracciones/reservas.');
    if (atrRef && dto.atraccion_id && dto.atraccion_id !== atrRef) {
      throw new BadRequestException('atraccion_id del cuerpo no coincide con el de la URL.');
    }
    if (dto.idempotency_key && dto.idempotency_key !== key) {
      throw new BadRequestException('idempotency_key del cuerpo no coincide con la cabecera Idempotency-Key.');
    }
    const hora = parseHora(dto.hora);
    if (!hora) throw new BadRequestException('hora no es válida: usa el formato del turno, por ejemplo «10:30 a.m.» o «10:30».');
    this.validarDocumento(dto.customer.document_type, dto.customer.document_id);
    const ninos = dto.child_count ?? 0;
    const seniors = dto.senior_count ?? 0;
    const infantes = dto.infant_count ?? 0;
    const tickets = dto.adult_count + ninos + seniors + infantes;
    if (tickets > 50) throw new BadRequestException('Una reserva admite como máximo 50 boletos.');
    if ((dto.passengers?.length ?? 0) > tickets - 1) {
      throw new BadRequestException('passengers tiene más acompañantes que boletos (el titular ya ocupa uno).');
    }
    const atraccion = await this.catalogo.fila(ref);
    const sujeto = await this.usuarioBooking();

    return this.idempotency.execute(
      key,
      `v2:reserve:${atraccion.uuid}`,
      sujeto,
      { ...dto, atraccion_id: atraccion.uuid },
      async () => {
        const r = await this.db.tx((tx) =>
          this.reservas.crearEnTransaccion(tx, {
            usuId: sujeto,
            atrUuid: atraccion.uuid,
            fecha: dto.fecha.slice(0, 10),
            hora,
            adultos: dto.adult_count,
            ninos,
            seniors,
            infantes,
            metodo: METODO[dto.payment_method],
            confirmarSiempre: true,
            origen: 'BOOKING',
            sagaId: dto.saga_id ?? null,
            paxNombre: dto.customer.full_name,
            paxDocumento: dto.customer.document_id,
            paxTipoDocumento: dto.customer.document_type,
            paxCorreo: dto.customer.email,
            telefono: async () => telefonoLocal(dto.customer.phone),
            acompanantes: (dto.passengers ?? []).map((p) => ({ nombre: p.full_name, documento: p.document_id ?? null, tipoBoleto: p.ticket_type })),
            notas: dto.special_requirements ?? null,
          }),
        );
        this.stock.publicar(r.disId, 'VENTA');
        return this.mapper.reserva(await this.filaOr404(r.uuid));
      },
      this.porReferencia,
    );
  }

  /**
   * Cancelación / compensación de saga. Es idempotente: cancelar una reserva ya cancelada devuelve
   * 200 con su estado. El orquestador de Booking (SAGA_ORCHESTRATOR) y ADMIN cancelan siempre con
   * reembolso total; el CLIENTE solo dentro de su plazo de cancelación.
   */
  async cancelar(ref: string, dto: CancelReservationRequestV2, key: string) {
    const r0 = await this.filaOr404(ref);
    const sujeto = await this.usuarioBooking();
    return this.idempotency.execute(
      key,
      `v2:cancel:${r0.id}`,
      sujeto,
      dto,
      async () => {
        await this.catalogos.precargar();
        const disId = await this.db.tx(async (tx) => {
          await tx.query('SELECT 1 FROM reserva WHERE res_uuid = $1 FOR UPDATE', [r0.id]);
          const r = await this.filaOr404(r0.id, tx);
          if (r.estado === 'CANCELADA_RES') return null; // ya compensada: mismo resultado
          if (r.estado === 'CHECKED_IN') throw new BadRequestException('El titular ya hizo el check-in: la experiencia está en curso y no puede cancelarse.');
          if (r.estado === 'COMPLETADA') throw new BadRequestException('La experiencia ya se realizó; no puede cancelarse.');
          const solicitante = dto.solicitante ?? 'CLIENTE';
          if (solicitante === 'CLIENTE') {
            const pol = this.base.politicaCancelacion(r);
            if (pol.policy === 'NOT_ALLOWED') throw new BadRequestException(pol.motivo);
            if (pol.policy === 'NO_REFUND') {
              throw new BadRequestException(`${pol.motivo} Fuera del plazo de cancelación gratuita solo el orquestador (SAGA_ORCHESTRATOR) o un ADMIN pueden cancelarla.`);
            }
          }
          const motivo = `[${solicitante}] ${dto.reason || (solicitante === 'SAGA_ORCHESTRATOR' ? 'Compensación de saga de Booking' : 'Cancelación solicitada en Booking')}`;
          await cancelarCompra(tx, this.catalogos, r.res_id, motivo, new Date(), true);
          return r.dis_id;
        });
        if (disId) this.stock.publicar(disId, 'CANCELACION');
        return this.mapper.reserva(await this.filaOr404(r0.id));
      },
      this.porReferencia,
    );
  }

  /**
   * Check-in presencial: el guía valida el documento del titular (y/o el QR del voucher) en el
   * punto de encuentro. La reserva pasa a CHECKED_IN con la hora exacta, el guía y el dispositivo.
   */
  async checkin(ref: string, dto: CheckinRequestV2) {
    await this.catalogos.precargar();
    const secreto = this.config.getOrThrow<string>('JWT_SECRET');
    const r = await this.db.tx(async (tx) => {
      const r0 = await this.filaOr404(ref, tx);
      await tx.query('SELECT 1 FROM reserva WHERE res_uuid = $1 FOR UPDATE', [r0.id]);
      const f = await this.filaOr404(r0.id, tx);
      if (f.estado === 'CANCELADA_RES') throw new ConflictException({ message: 'La reserva está cancelada: no admite check-in.', code: 'RESERVATION_CANCELLED' });
      if (f.estado === 'CHECKED_IN') {
        throw new ConflictException({ message: `El check-in ya se registró el ${new Date(f.checkin_en!).toISOString()}.`, code: 'ALREADY_CHECKED_IN' });
      }
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
        `UPDATE reserva SET est_id = $2, res_checkin_en = now(), res_checkin_guia = $3, res_checkin_dispositivo = $4 WHERE res_uuid = $1`,
        [f.id, await this.catalogos.estado('CHECKED_IN'), dto.guia_codigo ?? null, dto.scanner_device_id ?? null],
      );
      await emitirEventoReserva(tx, EVENTOS.RESERVA_CHECKIN, f.res_id, { guide_code: dto.guia_codigo ?? null });
      return this.filaOr404(f.id, tx);
    });
    return {
      reserva_id: r.id,
      reservation_code: r.codigo,
      estado: 'CHECKED_IN' as const,
      titular_nombre: r.pax_nombre ?? '',
      titular_documento: r.pax_documento ?? dto.documento_identidad,
      guia_asignado: r.guia ?? 'Guía oficial asignado por Descubre EC',
      punto_encuentro: r.punto_encuentro ?? r.direccion ?? r.ciudad,
      hora_checkin: new Date(r.checkin_en!).toISOString(),
      pase_abordar_qr: this.mapper.qrUrl(r.codigo, true),
    };
  }

  /** Contenido del QR: voucher (siempre) o pase de abordar (solo después del check-in). */
  async contenidoQr(codigo: string, pase: boolean): Promise<string> {
    const r = await this.filaOr404(codigo);
    if (pase && r.estado !== 'CHECKED_IN') throw new NotFoundException('El pase de abordar se emite después del check-in.');
    return this.mapper.voucher(r, pase ? 'pase' : 'voucher');
  }
}
