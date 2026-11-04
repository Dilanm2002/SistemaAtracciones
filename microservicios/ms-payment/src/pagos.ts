import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ServicioGuard } from './comun/auth';
import { DbService, Sql } from './comun/db.service';
import { hoyEc } from './comun/tiempo';

/** Métodos del script + la pasarela de Booking (sql/002). PAYPHAL se conserva tal como lo escribió el equipo. */
export const METODOS = ['TARJETA', 'TRANSFERENCIA', 'EN_SITIO', 'PAYPHAL', 'SOA_BOOKING_GATEWAY'] as const;
/** Cobrados al instante (simulación del prototipo); el resto queda PENDIENTE hasta que se verifique. */
const INMEDIATOS = new Set(['TARJETA', 'SOA_BOOKING_GATEWAY', 'PAYPHAL']);

const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class TarjetaDto {
  @IsIn(['VISA', 'MASTERCARD', 'AMEX', 'DINERS', 'OTRA']) marca: string;
  @Matches(/^\d{4}$/) ultimos4: string;
  @IsString() @MinLength(2) @MaxLength(120) titular: string;
  @IsInt() @Min(1) @Max(12) mes: number;
  @IsInt() @Min(2020) @Max(2100) anio: number;
}

export class CrearPagoDto {
  @IsInt() @Min(1) ord_id: number;
  @IsIn(METODOS) mpa_codigo: (typeof METODOS)[number];
  @Matches(/^\d{1,10}\.\d{2}$/) monto: string;
  /** Comparte sufijo con DEC-/ORD- (PAG-XXXXXX): repetir el mismo pago no lo duplica. */
  @Matches(/^[A-Z0-9]{6}$/) sufijo: string;
  @IsOptional() @ValidateNested() @Type(() => TarjetaDto) tarjeta?: TarjetaDto;
}

export class MotivoDto {
  @IsString() @MinLength(3) @MaxLength(300) motivo: string;
}

export class PagosQuery {
  @Transform(entero) @IsInt() @Min(1) ord_id: number;
}

const SELECT_PAGO = `SELECT p.pag_id::int, p.pag_numero, p.ord_id::int, m.mpa_codigo, e.est_codigo AS estado, p.pag_monto::text AS pag_monto,
        p.pag_referencia, p.pag_autorizacion, p.pag_fecha, p.pag_aprobado_en, p.pag_rechazado_en, p.pag_motivo_rechazo,
        CASE WHEN t.pat_id IS NULL THEN NULL ELSE json_build_object('marca', t.pat_marca, 'ultimos4', t.pat_ultimos4) END AS tarjeta
   FROM pago p JOIN metodo_pago m ON m.mpa_id = p.mpa_id JOIN estado e ON e.est_id = p.est_id
   LEFT JOIN pago_tarjeta t ON t.pag_id = p.pag_id`;

/**
 * Payment Service (REST). Pagos simulados del prototipo: tarjeta y pasarela de Booking se aprueban al
 * instante; transferencia y pago en sitio quedan PENDIENTE hasta que el operador los verifique.
 * Nunca se guarda el número de tarjeta ni el CVV (PCI-DSS): solo marca, últimos 4 y titular.
 */
@Injectable()
export class PagosService {
  constructor(private readonly db: DbService) {}

  async uno(pagId: number, sql: Sql = this.db) {
    const p = await sql.one(`${SELECT_PAGO} WHERE p.pag_id = $1`, [pagId]);
    if (!p) throw new NotFoundException(`El pago ${pagId} no existe.`);
    return p;
  }

  porOrden(ordId: number) {
    return this.db.query(`${SELECT_PAGO} WHERE p.ord_id = $1 ORDER BY p.pag_id`, [ordId]);
  }

  metodos() {
    return this.db.query('SELECT mpa_id, mpa_codigo, mpa_nombre, mpa_requiere_datos, mpa_activo FROM metodo_pago ORDER BY mpa_id');
  }

  async crear(d: CrearPagoDto) {
    if (Number(d.monto) <= 0) throw new BadRequestException('El monto debe ser mayor que 0.');
    if (d.tarjeta && d.mpa_codigo !== 'TARJETA') throw new BadRequestException('tarjeta solo aplica al pago con TARJETA.');
    if (d.tarjeta) {
      const [anio, mes] = hoyEc().split('-').map(Number);
      if (d.tarjeta.anio < anio || (d.tarjeta.anio === anio && d.tarjeta.mes < mes)) throw new BadRequestException('La tarjeta está vencida.');
      if (d.tarjeta.anio > anio + 20) throw new BadRequestException('La fecha de vencimiento de la tarjeta no es válida.');
    }
    const numero = `PAG-${d.sufijo}`;
    const aprobado = INMEDIATOS.has(d.mpa_codigo);
    const pagId = await this.db.tx(async (tx) => {
      const previo = await tx.one<{ pag_id: number; ord_id: number }>('SELECT pag_id::int, ord_id::int FROM pago WHERE pag_numero = $1', [numero]);
      if (previo) {
        if (previo.ord_id !== d.ord_id) throw new ConflictException({ message: `El número ${numero} ya existe.`, code: 'NUMERO_DUPLICADO' });
        return previo.pag_id; // mismo pago repetido (reintento de la saga)
      }
      const p = await tx.one<{ pag_id: number }>(
        `INSERT INTO pago (pag_numero, ord_id, mpa_id, est_id, pag_monto, pag_aprobado_en, pag_referencia)
         VALUES ($1, $2, (SELECT mpa_id FROM metodo_pago WHERE mpa_codigo = $3), (SELECT est_id FROM estado WHERE est_codigo = $4), $5,
                 CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN 'SIM-' || $7 END)
         RETURNING pag_id::int`,
        [numero, d.ord_id, d.mpa_codigo, aprobado ? 'APROBADO' : 'PENDIENTE', d.monto, aprobado, d.sufijo],
      );
      if (d.tarjeta) {
        await tx.query(
          `INSERT INTO pago_tarjeta (pag_id, pat_marca, pat_ultimos4, pat_titular, pat_mes, pat_anio, pat_pais) VALUES ($1, $2, $3, $4, $5, $6, 'EC')`,
          [p!.pag_id, d.tarjeta.marca, d.tarjeta.ultimos4, d.tarjeta.titular.toUpperCase(), d.tarjeta.mes, d.tarjeta.anio],
        );
      }
      return p!.pag_id;
    });
    return this.uno(pagId);
  }

  /** Verificación manual (transferencia o pago en sitio). Repetir sobre un pago ya aprobado no falla. */
  async aprobar(pagId: number) {
    await this.db.tx(async (tx) => {
      const p = await this.uno(pagId, tx);
      if (p.estado === 'APROBADO') return;
      if (p.estado !== 'PENDIENTE') throw new ConflictException({ message: `El pago está ${p.estado}: no se puede aprobar.`, code: 'INVALID_STATE' });
      await tx.query(
        `UPDATE pago SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'APROBADO'), pag_aprobado_en = now(),
                pag_referencia = COALESCE(pag_referencia, 'MANUAL-' || pag_id) WHERE pag_id = $1`,
        [pagId],
      );
    });
    return this.uno(pagId);
  }

  /** Anula un pago aún no cobrado (p. ej. la reserva se canceló antes de pagar). Idempotente. */
  async rechazar(pagId: number, motivo: string) {
    await this.db.tx(async (tx) => {
      const p = await this.uno(pagId, tx);
      if (p.estado === 'RECHAZADO') return;
      if (p.estado !== 'PENDIENTE') throw new ConflictException({ message: `El pago está ${p.estado}: no se puede rechazar.`, code: 'INVALID_STATE' });
      await tx.query(
        `UPDATE pago SET est_id = (SELECT est_id FROM estado WHERE est_codigo = 'RECHAZADO'), pag_rechazado_en = now(), pag_motivo_rechazo = $2 WHERE pag_id = $1`,
        [pagId, motivo.slice(0, 300)],
      );
    });
    return this.uno(pagId);
  }
}

/** Catálogo público de métodos de pago. */
@Controller({ path: 'metodos-pago', version: '1' })
export class MetodosController {
  constructor(private readonly s: PagosService) {}

  @Get()
  metodos() {
    return this.s.metodos();
  }
}

/** Rutas internas (X-Servicio-Token): las usan ms_booking (saga) y ms_refund. No se publican en el gateway. */
@Controller({ path: 'internal/pagos', version: '1' })
@UseGuards(ServicioGuard)
export class PagosInternosController {
  constructor(private readonly s: PagosService) {}

  @Post()
  crear(@Body() dto: CrearPagoDto) {
    return this.s.crear(dto);
  }

  @Get()
  porOrden(@Query() q: PagosQuery) {
    return this.s.porOrden(q.ord_id);
  }

  @Get(':pag_id')
  uno(@Param('pag_id', ParseIntPipe) id: number) {
    return this.s.uno(id);
  }

  @Post(':pag_id/aprobar')
  @HttpCode(200)
  aprobar(@Param('pag_id', ParseIntPipe) id: number) {
    return this.s.aprobar(id);
  }

  @Post(':pag_id/rechazar')
  @HttpCode(200)
  rechazar(@Param('pag_id', ParseIntPipe) id: number, @Body() dto: MotivoDto) {
    return this.s.rechazar(id, dto.motivo);
  }
}
