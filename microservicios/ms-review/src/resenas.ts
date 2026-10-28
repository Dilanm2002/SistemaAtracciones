import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { JwtGuard, Roles, Usuario, verificarJwt } from './comun/auth';
import { DbService, Params, Sql } from './comun/db.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class ResenasQuery {
  @Transform(entero) @IsInt() @Min(1) atr_id: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

export class ResumenQuery {
  @Transform(entero) @IsInt() @Min(1) atr_id: number;
}

export class CrearResena {
  @IsInt() @Min(1) atr_id: number;
  @IsInt() @Min(1) @Max(5) ren_puntuacion: number;
  @Transform(trim) @IsString() @MinLength(10) @MaxLength(1000) ren_comentario: string;
  /** Solo para reseñas anónimas (sin token): el script exige el nombre si no hay usu_id. */
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) ren_autor_nombre?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) ren_limpieza?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) ren_servicio?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) ren_relacion_valor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) ren_puntualidad?: number;
}

export class Visibilidad {
  @IsBoolean() ren_visible: boolean;
}

const SELECT_RESENA = `SELECT ren_id::int, atr_id::int, usu_id::int, ren_autor_nombre, ren_puntuacion, ren_comentario, ren_visible, ren_creado_en,
                              ren_limpieza, ren_servicio, ren_relacion_valor, ren_puntualidad FROM resena`;

/** Cliente de ms_catalog: atr_id es un ID lógico y se valida por su API. */
@Injectable()
export class CatalogClient {
  async existe(atrId: number): Promise<boolean> {
    const base = (process.env.CATALOG_URL ?? 'http://localhost:4002').replace(/\/$/, '');
    let r: Response;
    try {
      r = await fetch(`${base}/api/v1/atracciones/${atrId}`, { signal: AbortSignal.timeout(2000) });
    } catch {
      throw new ServiceUnavailableException({ message: 'No se pudo validar la atracción (ms_catalog no responde).', code: 'DEPENDENCY_UNAVAILABLE' });
    }
    if (r.status === 404) return false;
    if (!r.ok) throw new ServiceUnavailableException({ message: `ms_catalog respondió ${r.status}.`, code: 'DEPENDENCY_UNAVAILABLE' });
    return true;
  }
}

/** Review Service: reseñas y puntuaciones. Publica RESENA_PUBLICADA (reemplaza al trigger trg_resena_calificacion). */
@Injectable()
export class ResenasService {
  constructor(
    private readonly db: DbService,
    private readonly catalogo: CatalogClient,
  ) {}

  async listar(q: ResenasQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const data = await this.db.query(`${SELECT_RESENA} WHERE atr_id = $1 AND ren_visible ORDER BY ren_creado_en DESC, ren_id DESC LIMIT $2 OFFSET $3`, [q.atr_id, limit, (page - 1) * limit]);
    const t = await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM resena WHERE atr_id = $1 AND ren_visible', [q.atr_id]);
    return { data, total: t!.n, page, limit };
  }

  async una(id: number) {
    const r = await this.db.one(`${SELECT_RESENA} WHERE ren_id = $1`, [id]);
    if (!r) throw new NotFoundException(`La reseña ${id} no existe.`);
    return r;
  }

  /** Promedio y pilares de las reseñas visibles (escala 1 a 5). Un pilar sin nota cuenta con la nota general. */
  async resumen(atrId: number, sql: Sql = this.db) {
    const r = await sql.one<{ prom: number | null; n: number; l: number | null; s: number | null; v: number | null; p: number | null }>(
      `SELECT round(avg(ren_puntuacion), 2)::float8 AS prom, COUNT(*)::int AS n,
              round(avg(COALESCE(ren_limpieza, ren_puntuacion)), 2)::float8 AS l,
              round(avg(COALESCE(ren_servicio, ren_puntuacion)), 2)::float8 AS s,
              round(avg(COALESCE(ren_relacion_valor, ren_puntuacion)), 2)::float8 AS v,
              round(avg(COALESCE(ren_puntualidad, ren_puntuacion)), 2)::float8 AS p
         FROM resena WHERE atr_id = $1 AND ren_visible`,
      [atrId],
    );
    return {
      atr_id: atrId,
      atr_calificacion_promedio: r!.prom ?? 0,
      atr_numero_resenas: r!.n,
      pilares: { limpieza: r!.l, servicio: r!.s, relacion_valor: r!.v, puntualidad: r!.p },
    };
  }

  /** Guarda RESENA_PUBLICADA en el outbox, en la misma transacción que el cambio. */
  private async publicar(atrId: number, tx: Sql, correlacion?: string) {
    await tx.query('INSERT INTO evento (evt_tipo, evt_datos, evt_correlacion) VALUES ($1, $2, $3)', [
      'RESENA_PUBLICADA',
      JSON.stringify(await this.resumen(atrId, tx)),
      correlacion ?? null,
    ]);
  }

  async crear(d: CrearResena, u: Usuario | null, correlacion?: string) {
    if (!u && !d.ren_autor_nombre) {
      throw new UnprocessableEntityException({
        message: 'Una reseña sin sesión necesita ren_autor_nombre.',
        code: 'SEMANTIC_VALIDATION_FAILED',
        invalid_params: [{ name: 'ren_autor_nombre', reason: 'ren_autor_nombre es obligatorio sin token' }],
      });
    }
    if (!(await this.catalogo.existe(d.atr_id))) {
      throw new UnprocessableEntityException({ message: `La atracción ${d.atr_id} no existe en ms_catalog.`, code: 'INVALID_REFERENCE' });
    }
    return this.db.tx(async (tx) => {
      if (u) {
        const ya = await tx.one('SELECT 1 FROM resena WHERE atr_id = $1 AND usu_id = $2', [d.atr_id, u.sub]);
        if (ya) throw new ConflictException({ message: 'Ya publicaste una reseña de esta atracción.', code: 'ALREADY_REVIEWED' });
      }
      const r = await tx.one<{ ren_id: number }>(
        `INSERT INTO resena (atr_id, usu_id, ren_autor_nombre, ren_puntuacion, ren_comentario, ren_limpieza, ren_servicio, ren_relacion_valor, ren_puntualidad)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ren_id::int`,
        [d.atr_id, u?.sub ?? null, u ? null : d.ren_autor_nombre, d.ren_puntuacion, d.ren_comentario,
          d.ren_limpieza ?? null, d.ren_servicio ?? null, d.ren_relacion_valor ?? null, d.ren_puntualidad ?? null],
      );
      await this.publicar(d.atr_id, tx, correlacion);
      return tx.one(`${SELECT_RESENA} WHERE ren_id = $1`, [r!.ren_id]);
    });
  }

  /** Moderación (ADMIN): ocultar o mostrar una reseña recalcula la calificación. */
  async visibilidad(id: number, visible: boolean, correlacion?: string) {
    return this.db.tx(async (tx) => {
      const r = await tx.one<{ atr_id: number }>('UPDATE resena SET ren_visible = $2 WHERE ren_id = $1 RETURNING atr_id::int', [id, visible]);
      if (!r) throw new NotFoundException(`La reseña ${id} no existe.`);
      await this.publicar(r.atr_id, tx, correlacion);
      return tx.one(`${SELECT_RESENA} WHERE ren_id = $1`, [id]);
    });
  }
}

/**
 * Despachador del outbox: envía los eventos pendientes (en orden) a cada destino de EVENTOS_DESTINOS
 * (por defecto, ms_catalog). Si un destino falla, el evento queda pendiente y se reintenta cada 3 s.
 */
@Injectable()
export class DespachadorEventos implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Eventos');
  private timer: NodeJS.Timeout | null = null;
  private ocupado = false;

  constructor(private readonly db: DbService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.despachar(), 3000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private get destinos(): string[] {
    return (process.env.EVENTOS_DESTINOS ?? 'http://localhost:4002/api/v1/internal/eventos').split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** Vuelve a poner en cola los eventos que agotaron sus 20 intentos (tras corregir la causa). */
  async reencolar(): Promise<{ reencolados: number }> {
    const r = await this.db.query('UPDATE evento SET evt_intentos = 0 WHERE evt_enviado_en IS NULL AND evt_intentos >= 20 RETURNING evt_id');
    return { reencolados: r.length };
  }

  /** Envía hasta 50 pendientes. Devuelve cuántos quedaron enviados. */
  async despachar(): Promise<number> {
    if (this.ocupado) return 0;
    this.ocupado = true;
    let enviados = 0;
    try {
      const pendientes = await this.db.query<{ id: string; tipo: string; datos: unknown; correlacion: string | null; creado: Date }>(
        `SELECT evt_id::text AS id, evt_tipo AS tipo, evt_datos AS datos, evt_correlacion AS correlacion, evt_creado_en AS creado
           FROM evento WHERE evt_enviado_en IS NULL AND evt_intentos < 20 ORDER BY evt_secuencia LIMIT 50`,
      );
      for (const e of pendientes) {
        const cuerpo = {
          specversion: '1.0', event_id: e.id, event_type: e.tipo, source: '/api/v1/ms-review',
          correlation_id: e.correlacion ?? e.id, timestamp: new Date(e.creado).toISOString(), data: e.datos,
        };
        try {
          for (const url of this.destinos) {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-servicio-token': process.env.SERVICIOS_TOKEN ?? '', 'x-correlation-id': cuerpo.correlation_id },
              body: JSON.stringify(cuerpo),
              signal: AbortSignal.timeout(3000),
            });
            if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
          }
          await this.db.query('UPDATE evento SET evt_enviado_en = now(), evt_intentos = evt_intentos + 1, evt_ultimo_error = NULL WHERE evt_id = $1', [e.id]);
          enviados++;
        } catch (err) {
          await this.db.query('UPDATE evento SET evt_intentos = evt_intentos + 1, evt_ultimo_error = $2 WHERE evt_id = $1', [e.id, (err as Error).message.slice(0, 300)]);
          this.logger.warn(`${e.tipo} ${e.id} no se pudo enviar: ${(err as Error).message}`);
          break; // en orden: no se adelanta un evento posterior
        }
      }
    } finally {
      this.ocupado = false;
    }
    return enviados;
  }
}

type Peticion = Request & { usuario?: Usuario; correlationId?: string };

@Controller({ path: 'resenas', version: '1' })
export class ResenasController {
  constructor(
    private readonly s: ResenasService,
    private readonly eventos: DespachadorEventos,
  ) {}

  /** ADMIN: reintentar los eventos apartados después de 20 fallos (se declara antes de :ren_id). */
  @Post('eventos/reintentar')
  @HttpCode(200)
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  reintentar() {
    return this.eventos.reencolar();
  }

  @Get()
  listar(@Query() q: ResenasQuery) {
    return this.s.listar(q);
  }

  @Get('resumen')
  resumen(@Query() q: ResumenQuery) {
    return this.s.resumen(q.atr_id);
  }

  @Get(':ren_id')
  una(@Param('ren_id', ParseIntPipe) id: number) {
    return this.s.una(id);
  }

  /** Con token: reseña del usuario (una por atracción). Sin token: anónima con ren_autor_nombre. */
  @Post()
  crear(@Body() d: CrearResena, @Req() req: Peticion) {
    const [tipo, token] = (req.header('authorization') ?? '').split(' ');
    let u: Usuario | null = null;
    if (token) {
      u = /^(Bearer|DPoP)$/i.test(tipo) && process.env.JWT_SECRET ? verificarJwt(token, process.env.JWT_SECRET) : null;
      if (!u) throw new UnauthorizedException({ message: 'El token enviado no es válido o venció.', code: 'UNAUTHORIZED' });
    }
    return this.s.crear(d, u, req.correlationId);
  }

  @Patch(':ren_id/visibilidad')
  @UseGuards(JwtGuard)
  @Roles('ADMIN')
  visibilidad(@Param('ren_id', ParseIntPipe) id: number, @Body() d: Visibilidad, @Req() req: Peticion) {
    return this.s.visibilidad(id, d.ren_visible, req.correlationId);
  }
}
