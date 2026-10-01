import { Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Injectable, Module, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, Rol, SCOPES } from '../../common/auth/scopes';
import { BitacoraService } from '../../common/db/bitacora.service';
import { DbService, Sql } from '../../common/db/db.service';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { lower, trim } from '../../common/utils/transform';
import { ContieneLetras, EsRucEc, MSG_TELEFONO_EC, RE_TELEFONO_EC, SinNumerosLargos } from '../../common/utils/validators';

/**
 * Empresas que quieren vender sus tours y paquetes en Descubre EC (migración 006).
 *
 *  1. Una persona con cuenta envía la solicitud de su empresa (PENDIENTE).
 *  2. El administrador la aprueba: se crea la empresa (`operador`), el solicitante queda
 *     vinculado a ella (`operador_usuario`) y recibe el rol OPERADOR. O la rechaza con motivo.
 *  3. Desde ese momento el operador sube sus experiencias en el panel; quedan EN_REVISION
 *     hasta que el administrador las publica (AtraccionesService.revisar).
 */

const RE_CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export class CrearSolicitudDto {
  @ApiProperty({ example: 'Kawsay Tours' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  @ContieneLetras()
  @SinNumerosLargos(4)
  empresa: string;

  @ApiProperty({ example: '1792345678001', description: 'RUC ecuatoriano (13 dígitos, termina en 001)' })
  @Transform(trim)
  @EsRucEc()
  ruc: string;

  @ApiProperty({ example: 15, description: 'Provincia de la sede (GET /provincias)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  provincia_id: number;

  @ApiProperty({ example: 'reservas@kawsaytours.ec' })
  @Transform(lower)
  @MaxLength(160)
  @Matches(RE_CORREO, { message: 'correo debe ser un correo válido' })
  correo: string;

  @ApiProperty({ example: '0991234567' })
  @Transform(trim)
  @Matches(RE_TELEFONO_EC, { message: `telefono ${MSG_TELEFONO_EC}` })
  telefono: string;

  @ApiPropertyOptional({ example: 'Av. 15 de Noviembre y Rocafuerte, Tena' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  @ContieneLetras()
  direccion?: string;

  @ApiProperty({ example: 'Rafting en el río Jatunyacu, visitas a comunidades kichwa y paquetes de 3 días en la selva.' })
  @Transform(trim)
  @IsString()
  @MinLength(30, { message: 'descripcion debe contar qué ofrece la empresa (mínimo 30 caracteres)' })
  @MaxLength(1000)
  @ContieneLetras()
  descripcion: string;
}

export class RechazarSolicitudDto {
  @ApiProperty({ example: 'El RUC no corresponde a una agencia de turismo registrada.' })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'motivo debe explicar qué debe corregir la empresa (mínimo 10 caracteres)' })
  @MaxLength(500)
  @ContieneLetras()
  motivo: string;
}

export class SolicitudesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDIENTE', 'APROBADA', 'RECHAZADA'] })
  @IsOptional()
  @IsIn(['PENDIENTE', 'APROBADA', 'RECHAZADA'])
  estado?: string;
}

interface FilaSolicitud {
  id: string;
  empresa: string;
  ruc: string;
  provincia_id: number;
  provincia: string;
  correo: string;
  telefono: string;
  direccion: string | null;
  descripcion: string;
  estado: string;
  motivo_rechazo: string | null;
  operador_codigo: number | null;
  creado_en: Date;
  revisado_en: Date | null;
  solicitante_id: string;
  solicitante: string;
  solicitante_correo: string;
}

const SELECT_SOLICITUD = `
  SELECT s.sop_id::text AS id, s.sop_empresa AS empresa, s.sop_ruc AS ruc, s.prov_id AS provincia_id, p.prov_nombre AS provincia,
         s.sop_correo AS correo, s.sop_telefono AS telefono, s.sop_direccion AS direccion, s.sop_descripcion AS descripcion,
         s.sop_estado AS estado, s.sop_motivo_rechazo AS motivo_rechazo, o.ope_codigo AS operador_codigo,
         s.sop_creado_en AS creado_en, s.sop_revisado_en AS revisado_en,
         u.usu_id::text AS solicitante_id, u.usu_nombre || ' ' || u.usu_apellido AS solicitante, u.usu_correo AS solicitante_correo
    FROM solicitud_operador s
    JOIN provincia p ON p.prov_id = s.prov_id
    JOIN usuario u ON u.usu_id = s.usu_id
    LEFT JOIN operador o ON o.ope_id = s.ope_id`;

@Injectable()
export class ProveedoresService {
  constructor(
    private readonly db: DbService,
    private readonly bitacora: BitacoraService,
  ) {}

  private async rucLibre(sql: Sql, ruc: string) {
    if (await sql.one('SELECT 1 FROM operador WHERE ope_ruc = $1', [ruc])) {
      throw new ConflictException('Ese RUC ya pertenece a una empresa registrada en Descubre EC.');
    }
  }

  async crear(dto: CrearSolicitudDto, user: AuthUser) {
    if (user.rol !== Rol.CLIENTE || user.operador != null) {
      throw new ConflictException('Tu cuenta ya pertenece al equipo de una empresa o de Descubre EC; usa una cuenta personal para solicitar.');
    }
    await this.rucLibre(this.db, dto.ruc);
    if (!(await this.db.one('SELECT 1 FROM provincia WHERE prov_id = $1', [dto.provincia_id]))) {
      throw new NotFoundException('La provincia no existe.');
    }
    if (await this.db.one(`SELECT 1 FROM solicitud_operador WHERE usu_id = $1 AND sop_estado = 'PENDIENTE'`, [user.sub])) {
      throw new ConflictException('Ya tienes una solicitud en revisión. Te avisaremos cuando el equipo la revise.');
    }
    if (await this.db.one(`SELECT 1 FROM solicitud_operador WHERE sop_ruc = $1 AND sop_estado = 'PENDIENTE'`, [dto.ruc])) {
      throw new ConflictException('Ya hay una solicitud en revisión con ese RUC.');
    }
    const r = await this.db.one<{ id: string }>(
      `INSERT INTO solicitud_operador (usu_id, sop_empresa, sop_ruc, prov_id, sop_correo, sop_telefono, sop_direccion, sop_descripcion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING sop_id::text AS id`,
      [user.sub, dto.empresa, dto.ruc, dto.provincia_id, dto.correo, dto.telefono, dto.direccion ?? null, dto.descripcion],
    );
    await this.bitacora.registrar(user.sub, 'SOLICITAR', 'solicitud_operador', r!.id, { empresa: dto.empresa });
    return this.una(r!.id);
  }

  private async una(id: string, sql: Sql = this.db) {
    const f = await sql.one<FilaSolicitud>(`${SELECT_SOLICITUD} WHERE s.sop_id = $1`, [id]);
    if (!f) throw new NotFoundException('La solicitud no existe.');
    return f;
  }

  /** Última solicitud de quien consulta (null si nunca envió una). */
  async mia(user: AuthUser) {
    return this.db.one<FilaSolicitud>(`${SELECT_SOLICITUD} WHERE s.usu_id = $1 ORDER BY s.sop_creado_en DESC LIMIT 1`, [user.sub]);
  }

  async listar(q: SolicitudesQueryDto) {
    const rows = await this.db.query<FilaSolicitud>(
      `${SELECT_SOLICITUD} WHERE ($1::text IS NULL OR s.sop_estado = $1)
        ORDER BY (s.sop_estado = 'PENDIENTE') DESC, s.sop_creado_en DESC LIMIT 200`,
      [q.estado ?? null],
    );
    return { rows, total: rows.length };
  }

  /** Aprobar: crea la empresa, vincula al solicitante y le da el rol OPERADOR, en una transacción. */
  async aprobar(id: string, admin: AuthUser) {
    const fila = await this.db.tx(async (tx) => {
      const s = await tx.one<{ estado: string; usu_id: string; empresa: string; ruc: string; prov_id: number; correo: string; telefono: string; direccion: string | null }>(
        `SELECT sop_estado AS estado, usu_id::text, sop_empresa AS empresa, sop_ruc AS ruc, prov_id, sop_correo AS correo,
                sop_telefono AS telefono, sop_direccion AS direccion
           FROM solicitud_operador WHERE sop_id = $1 FOR UPDATE`,
        [id],
      );
      if (!s) throw new NotFoundException('La solicitud no existe.');
      if (s.estado !== 'PENDIENTE') throw new ConflictException(`La solicitud ya fue ${s.estado.toLowerCase()}.`);
      await this.rucLibre(tx, s.ruc);
      if (await tx.one('SELECT 1 FROM operador_usuario WHERE usu_id = $1', [s.usu_id])) {
        throw new ConflictException('El solicitante ya pertenece a otra empresa.');
      }
      // Mismo criterio que el alta manual de operadores: código correlativo bajo bloqueo
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['operador.ope_codigo']);
      const codigo = (await tx.one<{ c: number }>('SELECT COALESCE(MAX(ope_codigo), 100) + 1 AS c FROM operador'))!.c;
      const ope = await tx.one<{ id: string }>(
        `INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, ope_direccion, prov_id, ope_activo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING ope_id::text AS id`,
        [codigo, s.empresa, s.ruc, s.correo, s.telefono, s.direccion, s.prov_id],
      );
      await tx.query(`INSERT INTO operador_usuario (ope_id, usu_id, opeu_cargo) VALUES ($1, $2, 'ADMIN')`, [ope!.id, s.usu_id]);
      await tx.query(
        `INSERT INTO usuario_rol (usu_id, rol_id, usr_asignado_por) SELECT $1, rol_id, $2 FROM rol WHERE rol_nombre = 'OPERADOR'
         ON CONFLICT (usu_id, rol_id) DO NOTHING`,
        [s.usu_id, admin.sub],
      );
      await tx.query(
        `UPDATE solicitud_operador SET sop_estado = 'APROBADA', ope_id = $2, sop_revisado_por = $3, sop_revisado_en = now(), sop_motivo_rechazo = NULL WHERE sop_id = $1`,
        [id, ope!.id, admin.sub],
      );
      return this.una(id, tx);
    });
    await this.bitacora.registrar(admin.sub, 'APROBAR', 'solicitud_operador', id, { empresa: fila.empresa, operador: fila.operador_codigo });
    return fila;
  }

  async rechazar(id: string, dto: RechazarSolicitudDto, admin: AuthUser) {
    const fila = await this.db.tx(async (tx) => {
      const s = await tx.one<{ estado: string }>('SELECT sop_estado AS estado FROM solicitud_operador WHERE sop_id = $1 FOR UPDATE', [id]);
      if (!s) throw new NotFoundException('La solicitud no existe.');
      if (s.estado !== 'PENDIENTE') throw new ConflictException(`La solicitud ya fue ${s.estado.toLowerCase()}.`);
      await tx.query(
        `UPDATE solicitud_operador SET sop_estado = 'RECHAZADA', sop_motivo_rechazo = $2, sop_revisado_por = $3, sop_revisado_en = now() WHERE sop_id = $1`,
        [id, dto.motivo, admin.sub],
      );
      return this.una(id, tx);
    });
    await this.bitacora.registrar(admin.sub, 'RECHAZAR', 'solicitud_operador', id, { motivo: dto.motivo });
    return fila;
  }
}

@ApiTags('Empresas proveedoras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('proveedores/solicitudes')
export class ProveedoresController {
  constructor(private readonly svc: ProveedoresService) {}

  @Post()
  @Scopes(SCOPES.READ)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Solicitar que mi empresa venda sus tours y paquetes en Descubre EC' })
  crear(@Body() dto: CrearSolicitudDto, @CurrentUser() user: AuthUser) {
    return this.svc.crear(dto, user);
  }

  @Get('mia')
  @Scopes(SCOPES.READ)
  @ApiOperation({ summary: 'Estado de mi última solicitud (null si no envié ninguna)' })
  async mia(@CurrentUser() user: AuthUser) {
    return { solicitud: await this.svc.mia(user) };
  }

  @Get()
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Solicitudes de empresas (pendientes primero)' })
  listar(@Query() q: SolicitudesQueryDto) {
    return this.svc.listar(q);
  }

  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Aprobar: crea la empresa y da el rol OPERADOR al solicitante' })
  aprobar(@Param('id', ParseIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.svc.aprobar(id, user);
  }

  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  @Scopes(SCOPES.ADMIN)
  @ApiOperation({ summary: 'Rechazar con el motivo que verá la empresa' })
  rechazar(@Param('id', ParseIdPipe) id: string, @Body() dto: RechazarSolicitudDto, @CurrentUser() user: AuthUser) {
    return this.svc.rechazar(id, dto, user);
  }
}

@Module({ controllers: [ProveedoresController], providers: [ProveedoresService] })
export class ProveedoresModule {}
