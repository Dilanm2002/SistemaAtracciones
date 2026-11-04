import { Body, Controller, Get, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { JwtGuard, Roles } from './comun/auth';
import { DbService, Sql } from './comun/db.service';
import { iniciarServidorGrpc } from './comun/grpc';
import { registrarEvento } from './comun/outbox';

/** Hoy en Ecuador (la vigencia de una tarifa es por día local, no UTC). */
export const HOY_EC = `(now() AT TIME ZONE 'America/Guayaquil')::date`;
export const TIPOS = ['ADULTO', 'NINO', 'MAYOR', 'ESTUDIANTE', 'GRUPO'] as const;
type Tipo = (typeof TIPOS)[number];

const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const dinero = (n: number | null | undefined) => (n == null ? '' : Number(n).toFixed(2));

export class TarifasQuery {
  @Transform(entero) @IsInt() @Min(1) atr_id: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fecha?: string;
}

export class NuevaTarifa {
  @IsIn(TIPOS) tar_tipo: Tipo;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) tar_precio: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) tar_moneda?: string;
}

export class CambiarTarifas {
  @ValidateNested({ each: true }) @Type(() => NuevaTarifa) @ArrayMinSize(1) @ArrayMaxSize(5) tarifas: NuevaTarifa[];
  /** Desde cuándo rige (AAAA-MM-DD); por defecto hoy. La anterior de cada tipo vence el día previo. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) vigente_desde?: string;
}

interface Fila {
  atr_id: string;
  tar_tipo: Tipo;
  tar_precio: number;
  tar_moneda: string;
}

/** Pricing Service: tarifas versionadas (tar_vigente_desde/hasta). La consulta principal es por gRPC. */
@Injectable()
export class TarifasService {
  constructor(private readonly db: DbService) {}

  /** Tarifa vigente de cada tipo, por atracción, en la fecha indicada (hoy si no se indica). */
  async vigentes(atrIds: number[], fecha?: string, sql: Sql = this.db): Promise<Fila[]> {
    if (!atrIds.length) return [];
    return sql.query<Fila>(
      `SELECT DISTINCT ON (atr_id, tar_tipo) atr_id::text, tar_tipo, tar_precio::float8 AS tar_precio, tar_moneda
         FROM tarifa
        WHERE atr_id = ANY($1::bigint[]) AND tar_vigente_desde <= COALESCE($2::date, ${HOY_EC})
          AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= COALESCE($2::date, ${HOY_EC}))
        ORDER BY atr_id, tar_tipo, tar_vigente_desde DESC`,
      [atrIds, fecha ?? null],
    );
  }

  /** Respuesta del rpc ObtenerTarifas: una entrada por atracción pedida (vacía si no tiene tarifas). */
  async porAtraccion(atrIds: number[], fecha?: string) {
    const filas = await this.vigentes(atrIds, fecha);
    return atrIds.map((id) => {
      const de = (t: Tipo) => filas.find((f) => Number(f.atr_id) === id && f.tar_tipo === t);
      return {
        atr_id: String(id),
        moneda: de('ADULTO')?.tar_moneda ?? filas.find((f) => Number(f.atr_id) === id)?.tar_moneda ?? 'USD',
        adulto: dinero(de('ADULTO')?.tar_precio), nino: dinero(de('NINO')?.tar_precio), mayor: dinero(de('MAYOR')?.tar_precio),
        estudiante: dinero(de('ESTUDIANTE')?.tar_precio), grupo: dinero(de('GRUPO')?.tar_precio),
      };
    });
  }

  historial(atrId: number) {
    return this.db.query(
      `SELECT tar_id::int, atr_id::int, tar_tipo, tar_precio::float8 AS tar_precio, tar_moneda,
              to_char(tar_vigente_desde, 'YYYY-MM-DD') AS tar_vigente_desde, to_char(tar_vigente_hasta, 'YYYY-MM-DD') AS tar_vigente_hasta
         FROM tarifa WHERE atr_id = $1 ORDER BY tar_tipo, tar_vigente_desde DESC`,
      [atrId],
    );
  }

  /**
   * Nuevas tarifas desde una fecha: cierra la vigente de cada tipo el día anterior (el historial se
   * conserva, como pide el script) y publica PRECIO_ACTUALIZADO para la proyección de ms_catalog.
   */
  async cambiar(atrId: number, dto: CambiarTarifas) {
    await this.db.tx(async (tx) => {
      const desde = dto.vigente_desde ?? (await tx.one<{ d: string }>(`SELECT to_char(${HOY_EC}, 'YYYY-MM-DD') AS d`))!.d;
      for (const t of dto.tarifas) {
        await tx.query(
          `UPDATE tarifa SET tar_vigente_hasta = $3::date - 1
            WHERE atr_id = $1 AND tar_tipo = $2 AND tar_vigente_desde < $3::date AND (tar_vigente_hasta IS NULL OR tar_vigente_hasta >= $3::date)`,
          [atrId, t.tar_tipo, desde],
        );
        await tx.query(
          `INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_moneda, tar_vigente_desde) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (atr_id, tar_tipo, tar_vigente_desde) DO UPDATE SET tar_precio = EXCLUDED.tar_precio, tar_moneda = EXCLUDED.tar_moneda`,
          [atrId, t.tar_tipo, t.tar_precio, t.tar_moneda ?? 'USD', desde],
        );
      }
      const hoy = await this.vigentes([atrId], undefined, tx);
      await registrarEvento(tx, 'PRECIO_ACTUALIZADO', {
        atr_id: atrId,
        tarifas: hoy.map((f) => ({ tipo: f.tar_tipo, precio: f.tar_precio, moneda: f.tar_moneda })),
      });
    });
    return this.historial(atrId);
  }
}

/** Servidor gRPC (descubre.pricing.v1.PricingService) en GRPC_PORT, 50044 por defecto. */
@Injectable()
export class PricingGrpc implements OnApplicationBootstrap, OnApplicationShutdown {
  private cerrar: (() => Promise<void>) | null = null;
  constructor(private readonly s: TarifasService) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' && !process.env.GRPC_PORT) return;
    this.cerrar = await iniciarServidorGrpc('pricing.proto', 'descubre.pricing.v1.PricingService', {
      ObtenerTarifas: async (req: { atr_ids: string[]; fecha: string }) => ({
        tarifas: await this.s.porAtraccion(req.atr_ids.map(Number).filter((n) => n > 0), req.fecha || undefined),
      }),
    }, 50044, 'ms-pricing');
  }

  async onApplicationShutdown() {
    await this.cerrar?.();
  }
}

@Controller({ path: 'tarifas', version: '1' })
export class TarifasController {
  constructor(private readonly s: TarifasService) {}

  /** Vigentes (con `fecha`, las de ese día) — para el panel y para depurar; los servicios usan gRPC. */
  @Get()
  async vigentes(@Query() q: TarifasQuery) {
    return (await this.s.porAtraccion([q.atr_id], q.fecha))[0];
  }

  @Get(':atr_id/historial')
  historial(@Param('atr_id', ParseIntPipe) atrId: number) {
    return this.s.historial(atrId);
  }

  @Put(':atr_id')
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  cambiar(@Param('atr_id', ParseIntPipe) atrId: number, @Body() dto: CambiarTarifas) {
    return this.s.cambiar(atrId, dto);
  }
}
