import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Post, Query, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ServicioGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { llamar } from './comun/http';

const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class CrearReembolsoDto {
  @IsInt() @Min(1) pag_id: number;
  /** Vacío = el total cobrado. */
  @IsOptional() @Matches(/^\d{1,10}\.\d{2}$/) monto?: string;
  @IsString() @MinLength(3) @MaxLength(300) motivo: string;
}

export class ReembolsosQuery {
  @Transform(entero) @IsInt() @Min(1) pag_id: number;
}

const SELECT = `SELECT rem_id::int, pag_id::int, rem_numero, rem_monto::text AS rem_monto, rem_motivo, rem_referencia,
                       rem_solicitado_en, rem_procesado_en FROM reembolso`;

/**
 * Refund Service (REST). Regla del script (antes trg_reembolso_no_excede): nunca se reembolsa más de lo
 * cobrado; se consulta a ms_payment el monto y el estado del pago antes de procesar.
 * Un pago tiene a lo sumo un reembolso total (REM-<pag_id>): repetir la solicitud devuelve el mismo.
 */
@Injectable()
export class ReembolsosService {
  constructor(private readonly db: DbService) {}

  porPago(pagId: number) {
    return this.db.query(`${SELECT} WHERE pag_id = $1 ORDER BY rem_id`, [pagId]);
  }

  async crear(d: CrearReembolsoDto) {
    const numero = `REM-${String(d.pag_id).padStart(9, '0')}`;
    const previo = await this.db.one(`${SELECT} WHERE rem_numero = $1`, [numero]);
    if (previo) return previo; // reintento: mismo reembolso
    const pago = await llamar<{ pag_id: number; estado: string; pag_monto: string }>('payment', 'GET', `/api/v1/internal/pagos/${d.pag_id}`);
    if (pago.estado !== 'APROBADO') {
      throw new ConflictException({ message: `El pago ${d.pag_id} está ${pago.estado}: solo se reembolsa un pago aprobado.`, code: 'PAGO_NO_COBRADO' });
    }
    const monto = d.monto ?? pago.pag_monto;
    if (Math.round(Number(monto) * 100) > Math.round(Number(pago.pag_monto) * 100)) {
      throw new BadRequestException({ message: `No se puede reembolsar ${monto}: el pago cobró ${pago.pag_monto}.`, code: 'REEMBOLSO_EXCEDE_PAGO' });
    }
    if (Number(monto) <= 0) throw new BadRequestException('El monto a reembolsar debe ser mayor que 0.');
    // Simulación del prototipo: la pasarela confirma el reembolso al instante
    const r = await this.db.one(
      `INSERT INTO reembolso (pag_id, rem_numero, rem_monto, rem_motivo, rem_referencia, rem_procesado_en)
       VALUES ($1::bigint, $2, $3, $4, 'SIM-REM-' || $1::bigint::text, now())
       ON CONFLICT (rem_numero) DO NOTHING RETURNING rem_id::int`,
      [d.pag_id, numero, monto, d.motivo.slice(0, 300)],
    );
    return this.db.one(`${SELECT} WHERE ${r ? 'rem_id = $1' : 'rem_numero = $1'}`, [r ? r.rem_id : numero]);
  }
}

/** Rutas internas (X-Servicio-Token): las usa ms_booking al cancelar. No se publican en el gateway. */
@Controller({ path: 'internal/reembolsos', version: '1' })
@UseGuards(ServicioGuard)
export class ReembolsosController {
  constructor(private readonly s: ReembolsosService) {}

  @Post()
  crear(@Body() dto: CrearReembolsoDto) {
    return this.s.crear(dto);
  }

  @Get()
  porPago(@Query() q: ReembolsosQuery) {
    return this.s.porPago(q.pag_id);
  }
}
