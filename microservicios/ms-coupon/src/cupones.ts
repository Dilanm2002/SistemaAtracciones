import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { JwtGuard, Roles, ServicioGuard, SocioGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { hoyEc } from './comun/tiempo';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class ContactoComercial {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(160) email?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value))
  @Matches(/^(\+[1-9]\d{7,14}|09\d{8}|0[2-7]\d{7})$/, { message: 'telefono debe ser E.164 o un teléfono de Ecuador' })
  telefono?: string;
}

/** Cuestionario B2B del contrato (ActualizarPromocionesContratoRequest). */
export class ActualizarAcuerdo {
  @IsBoolean() permite_promociones: boolean;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50, { message: 'porcentaje_descuento_maximo no puede superar 50' }) porcentaje_descuento_maximo: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) destinos_habilitados?: string[];
  @IsOptional() @IsDateString({ strict: true }) vigencia_hasta?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) condiciones_combo?: string;
  @IsOptional() @ValidateNested() @Type(() => ContactoComercial) contacto_comercial?: ContactoComercial;
}

export class NuevoCupon {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9_-]{3,30}$/) cup_codigo: string;
  @IsIn(['PORCENTAJE', 'FIJO']) cup_tipo: 'PORCENTAJE' | 'FIJO';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) cup_valor: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) cup_fecha_inicio: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) cup_fecha_fin?: string;
  @IsOptional() @IsInt() @Min(1) cup_usos_max?: number;
}

export class ValidarQuery {
  /** Monto de la compra, para calcular el descuento (texto con 2 decimales). */
  @Matches(/^\d{1,10}\.\d{2}$/) monto: string;
}

const SELECT_CUPON = `SELECT cup_id::int, cup_codigo, cup_tipo, cup_valor::float8 AS cup_valor, to_char(cup_fecha_inicio, 'YYYY-MM-DD') AS cup_fecha_inicio,
                             to_char(cup_fecha_fin, 'YYYY-MM-DD') AS cup_fecha_fin, cup_usos_max, cup_activo FROM cupon`;

/** Coupon Service (REST): cupones del script y acuerdo B2B de promociones con Booking. */
@Injectable()
export class CuponesService {
  constructor(private readonly db: DbService) {}

  /** PromocionesContratoResponse del contrato v2/v3 (mismos campos que respondía la tienda). */
  async acuerdo() {
    const a = await this.db.one<{ permite: boolean; maximo: number; fecha: string; vigencia: string; condiciones: string | null; destinos: string[] }>(
      `SELECT apr_permite AS permite, apr_descuento_maximo::float8 AS maximo, to_char(apr_fecha_acuerdo, 'YYYY-MM-DD') AS fecha,
              to_char(apr_vigencia_hasta, 'YYYY-MM-DD') AS vigencia, apr_condiciones AS condiciones,
              COALESCE((SELECT array_agg(apd_destino ORDER BY apd_id) FROM acuerdo_promocion_destino d WHERE d.apr_id = p.apr_id), '{}') AS destinos
         FROM acuerdo_promocion p WHERE apr_id = 1`,
    );
    return {
      proveedor_id: process.env.BOOKING_PROVEEDOR_ID ?? 'proveedor-atracciones-dilan',
      nombre_comercial: 'Descubre EC',
      permite_promociones: a?.permite ?? false,
      porcentaje_descuento_maximo: a?.maximo ?? 0,
      destinos_habilitados: a?.destinos ?? [],
      fecha_acuerdo: a?.fecha ?? hoyEc(),
      vigencia_hasta: a?.vigencia ?? hoyEc(),
      ...(a?.condiciones ? { condiciones_combo: a.condiciones } : {}),
    };
  }

  /** Si no se permiten promociones, el descuento máximo queda en 0 (CHECK del acuerdo). */
  async actualizarAcuerdo(dto: ActualizarAcuerdo) {
    const maximo = dto.permite_promociones ? dto.porcentaje_descuento_maximo : 0;
    const destinos = [...new Set((dto.destinos_habilitados ?? []).map((d) => d.trim().slice(0, 80)).filter(Boolean))];
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO acuerdo_promocion (apr_id, apr_permite, apr_descuento_maximo, apr_fecha_acuerdo, apr_vigencia_hasta, apr_condiciones,
                                        apr_contacto_nombre, apr_contacto_correo, apr_contacto_telefono, apr_actualizado_en)
         VALUES (1, $1, $2, CURRENT_DATE, COALESCE($3::date, CURRENT_DATE + 365), $4, $5, $6, $7, now())
         ON CONFLICT (apr_id) DO UPDATE SET
           apr_permite = EXCLUDED.apr_permite, apr_descuento_maximo = EXCLUDED.apr_descuento_maximo, apr_fecha_acuerdo = CURRENT_DATE,
           apr_vigencia_hasta = COALESCE($3::date, acuerdo_promocion.apr_vigencia_hasta),
           apr_condiciones = COALESCE($4, acuerdo_promocion.apr_condiciones),
           apr_contacto_nombre = COALESCE($5, acuerdo_promocion.apr_contacto_nombre),
           apr_contacto_correo = COALESCE($6, acuerdo_promocion.apr_contacto_correo),
           apr_contacto_telefono = COALESCE($7, acuerdo_promocion.apr_contacto_telefono), apr_actualizado_en = now()`,
        [dto.permite_promociones, maximo, dto.vigencia_hasta?.slice(0, 10) ?? null, dto.condiciones_combo ?? null,
          dto.contacto_comercial?.nombre ?? null, dto.contacto_comercial?.email ?? null, dto.contacto_comercial?.telefono ?? null],
      );
      if (dto.destinos_habilitados) {
        await tx.query('DELETE FROM acuerdo_promocion_destino WHERE apr_id = 1');
        for (const d of destinos) await tx.query('INSERT INTO acuerdo_promocion_destino (apr_id, apd_destino) VALUES (1, $1)', [d]);
      }
    });
    return this.acuerdo();
  }

  cupones() {
    return this.db.query(`${SELECT_CUPON} ORDER BY cup_id DESC`);
  }

  async crear(c: NuevoCupon) {
    if (c.cup_tipo === 'PORCENTAJE' && c.cup_valor > 100) throw new BadRequestException('Un cupón de porcentaje no puede superar el 100 %.');
    if (c.cup_fecha_fin && c.cup_fecha_fin < c.cup_fecha_inicio) throw new BadRequestException('cup_fecha_fin no puede ser anterior a cup_fecha_inicio.');
    try {
      return await this.db.one(
        `INSERT INTO cupon (cup_codigo, cup_tipo, cup_valor, cup_fecha_inicio, cup_fecha_fin, cup_usos_max) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING cup_id::int, cup_codigo, cup_tipo, cup_valor::float8 AS cup_valor, to_char(cup_fecha_inicio, 'YYYY-MM-DD') AS cup_fecha_inicio,
                   to_char(cup_fecha_fin, 'YYYY-MM-DD') AS cup_fecha_fin, cup_usos_max, cup_activo`,
        [c.cup_codigo, c.cup_tipo, c.cup_valor, c.cup_fecha_inicio, c.cup_fecha_fin ?? null, c.cup_usos_max ?? null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException({ message: `El cupón ${c.cup_codigo} ya existe.`, code: 'CUPON_DUPLICADO' });
      throw e;
    }
  }

  /**
   * ¿El cupón aplica hoy? Devuelve el descuento sobre `monto` (nunca mayor que el monto). Los usos se cuentan
   * en orden_cupon (ms_order) al cerrar la compra; aquí se valida vigencia y estado.
   */
  async validar(codigo: string, monto: string) {
    const c = await this.db.one<{ cup_id: number; cup_tipo: string; cup_valor: number; cup_activo: boolean; inicio: string; fin: string | null }>(
      `SELECT cup_id::int, cup_tipo, cup_valor::float8 AS cup_valor, cup_activo, to_char(cup_fecha_inicio, 'YYYY-MM-DD') AS inicio,
              to_char(cup_fecha_fin, 'YYYY-MM-DD') AS fin FROM cupon WHERE cup_codigo = upper($1)`,
      [codigo],
    );
    if (!c) throw new NotFoundException({ message: `El cupón ${codigo} no existe.`, code: 'CUPON_INEXISTENTE' });
    const hoy = hoyEc();
    const motivo = !c.cup_activo ? 'El cupón está desactivado.' : hoy < c.inicio ? `El cupón rige desde el ${c.inicio}.` : c.fin && hoy > c.fin ? `El cupón venció el ${c.fin}.` : null;
    const centavos = Math.round(Number(monto) * 100);
    const desc = motivo ? 0 : Math.min(centavos, c.cup_tipo === 'PORCENTAJE' ? Math.round((centavos * c.cup_valor) / 100) : Math.round(c.cup_valor * 100));
    return { cup_id: c.cup_id, cup_codigo: codigo.toUpperCase(), valido: !motivo, ...(motivo ? { motivo } : {}), descuento: (desc / 100).toFixed(2) };
  }
}

/** Rutas del contrato v2/v3 que Booking llama por el gateway (X-API-Key o JWT de ADMIN). */
@Controller({ path: 'atracciones/promociones', version: ['2', '3'] })
@UseGuards(SocioGuard)
export class PromocionesBookingController {
  constructor(private readonly s: CuponesService) {}

  @Get('contrato')
  acuerdo() {
    return this.s.acuerdo();
  }

  @Put('contrato')
  actualizar(@Body() dto: ActualizarAcuerdo) {
    return this.s.actualizarAcuerdo(dto);
  }
}

@Controller({ path: 'cupones', version: '1' })
export class CuponesController {
  constructor(private readonly s: CuponesService) {}

  @Get()
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  listar() {
    return this.s.cupones();
  }

  @Post()
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  crear(@Body() dto: NuevoCupon) {
    return this.s.crear(dto);
  }

  @Get(':codigo/validar')
  validar(@Param('codigo') codigo: string, @Query() q: ValidarQuery) {
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(codigo)) throw new BadRequestException('Código de cupón inválido.');
    return this.s.validar(codigo, q.monto);
  }
}

/** El acuerdo vigente para ms_catalog (porcentaje_descuento_paquete de la ficha), sin la X-API-Key de Booking. */
@Controller({ path: 'internal/acuerdo', version: '1' })
export class AcuerdoInternoController {
  constructor(private readonly s: CuponesService) {}

  @Get()
  @UseGuards(ServicioGuard)
  acuerdo() {
    return this.s.acuerdo();
  }
}

