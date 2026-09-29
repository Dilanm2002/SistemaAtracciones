import { BadRequestException, Controller, Get, Header, Module, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SCOPES } from '../../common/auth/scopes';
import { DbService } from '../../common/db/db.service';
import { EVENTOS } from '../../common/db/eventos';

const TIPOS = Object.values(EVENTOS) as string[];

export class EventosQueryDto {
  @ApiPropertyOptional({ description: 'Cursor: devuelve los eventos con secuencia mayor a este valor', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number = 0;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 100;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc', description: 'desc = los más recientes primero (para monitoreo)' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ enum: TIPOS })
  @IsOptional()
  @IsIn(TIPOS)
  type?: string;
}

/**
 * Feed de eventos de dominio (outbox). Los sistemas que se integren (vuelos,
 * alojamientos, notificaciones, analítica…) leen con un cursor y guardan la última
 * `sequence` procesada: entrega al-menos-una-vez, deduplicación por `id` (UUID).
 */
@ApiTags('Integración - Eventos (EDA)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Scopes(SCOPES.ADMIN)
@Controller('eventos')
export class EventosController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'Eventos de dominio en orden (feed con cursor `after`). Contrato: /api/v1/contracts/atracciones-asyncapi.yaml' })
  async feed(@Query() q: EventosQueryDto) {
    const limit = q.limit ?? 100;
    const desc = q.order === 'desc';
    const rows = await this.db.query<{ sequence: string }>(
      `SELECT evt_id::text AS sequence, evt_uuid AS id, evt_tipo AS type, evt_version AS version,
              evt_agregado AS aggregate, evt_agregado_id AS aggregate_id, evt_datos AS data, evt_creado_en AS occurred_at
         FROM evento WHERE (${desc ? '$1::bigint >= 0' : 'evt_id > $1'}) AND ($2::text IS NULL OR evt_tipo = $2)
        ORDER BY evt_id ${desc ? 'DESC' : 'ASC'} LIMIT $3`,
      [q.after ?? 0, q.type ?? null, limit],
    );
    if (desc) return { data: rows };
    const ultimo = rows.length ? Number(rows[rows.length - 1].sequence) : q.after ?? 0;
    return { data: rows, next_after: ultimo, has_more: rows.length === limit };
  }

  @Get('resumen')
  @ApiOperation({ summary: 'Cantidad de eventos por tipo (para monitoreo)' })
  resumen() {
    return this.db.query(
      `SELECT evt_tipo AS type, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE evt_publicado_en IS NULL)::int AS pending,
              MAX(evt_creado_en) AS last_at FROM evento GROUP BY evt_tipo ORDER BY evt_tipo`,
    );
  }
}

/** Contratos publicados para los equipos que se integren (API-First). */
const CONTRATOS: Record<string, { archivo: string; tipo: string }> = {
  'atracciones-openapi.yaml': { archivo: 'contracts/atracciones-openapi.yaml', tipo: 'application/yaml' },
  'atracciones-asyncapi.yaml': { archivo: 'contracts/atracciones-asyncapi.yaml', tipo: 'application/yaml' },
  'atracciones.graphql': { archivo: 'contracts/atracciones.graphql', tipo: 'text/plain' },
  'atracciones.proto': { archivo: 'contracts/atracciones.proto', tipo: 'text/plain' },
};

/** Busca el archivo tanto en desarrollo (cwd = backend) como en Vercel (función en api/). */
function leerContrato(rel: string): string | null {
  for (const base of [process.cwd(), join(__dirname, '..', '..', '..')]) {
    const p = join(base, rel);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

@ApiTags('Integración - Contratos')
@Controller('contracts')
export class ContratosController {
  @Get()
  @ApiOperation({ summary: 'Contratos disponibles para la integración (REST, eventos, GraphQL, gRPC)' })
  list() {
    return Object.keys(CONTRATOS).map((nombre) => ({ name: nombre, href: `/api/v1/contracts/${nombre}` }));
  }

  @Get(':nombre')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Descargar un contrato' })
  get(@Param('nombre') nombre: string, @Res() res: Response) {
    // Solo claves propias: "constructor", "toString"… vienen del prototipo de Object
    const c = Object.prototype.hasOwnProperty.call(CONTRATOS, nombre) ? CONTRATOS[nombre] : undefined;
    if (!c) throw new BadRequestException(`Contrato desconocido. Disponibles: ${Object.keys(CONTRATOS).join(', ')}`);
    const contenido = leerContrato(c.archivo);
    if (contenido === null) throw new NotFoundException('El contrato no está disponible en este despliegue.');
    res.type(`${c.tipo}; charset=utf-8`).send(contenido);
  }
}

/** Preparación para la integración con otros sistemas (SOA/EDA). */
@Module({ controllers: [EventosController, ContratosController] })
export class IntegracionModule {}
