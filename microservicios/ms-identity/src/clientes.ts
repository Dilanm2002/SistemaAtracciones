import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { Allow, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Response } from 'express';
import { JwtGuard, Roles, SocioGuard } from './comun/auth';
import { DbService, Sql } from './comun/db.service';

const normalizarCorreo = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const normalizarDocumento = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s.-]/g, '').toUpperCase() : v);
const normalizarTelefono = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s()-]/g, '') : v);
const recortar = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
/** Si el campo principal no llega, toma el valor de su alias antes de validar. */
const alias = (nombre: string, f: (v: unknown) => unknown) => ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => f(value ?? obj[nombre]);

/** POST /api/v3/clientes (contrato v3.1). Booking ha usado `identificacion` e `identification`: valen ambos. */
export class CrearCliente {
  @Transform(alias('name', recortar))
  @IsString({ message: 'nombre es obligatorio' })
  @MinLength(2)
  @MaxLength(240)
  nombre: string;

  @Transform(({ value }) => normalizarCorreo(value))
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
  email: string;

  @Transform(alias('identification', normalizarDocumento))
  @IsString({ message: 'identificacion es obligatoria' })
  @Matches(/^[A-Z0-9]{5,20}$/, { message: 'identificacion debe tener de 5 a 20 letras o números' })
  identificacion: string;

  @IsOptional()
  @Transform(alias('phone', normalizarTelefono))
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'telefono debe tener de 7 a 15 dígitos' })
  telefono?: string;

  @IsOptional() @Allow() name?: string;
  @IsOptional() @Allow() identification?: string;
  @IsOptional() @Allow() phone?: string;
}

export class ListaClientes {
  @IsOptional() @Transform(({ value }) => recortar(value)) @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 50;
}

interface FilaCliente {
  [k: string]: unknown;
  usu_id: string;
  usu_nombre: string;
  usu_apellido: string;
  usu_correo: string;
  usu_documento: string | null;
  usu_telefono: string | null;
  usu_origen: string;
  usu_creado_en: Date;
}

const COLUMNAS = 'usu_id::text, usu_nombre, usu_apellido, usu_correo, usu_documento, usu_telefono, usu_origen, usu_creado_en';
const SIN_APELLIDO = '-';

/** El id público del turista: se deriva de usu_id, así que nunca cambia ni se repite. */
const clientId = (usuId: string) => `DEC-USR-${usuId}`;
const nombreCompleto = (f: FilaCliente) => (f.usu_apellido === SIN_APELLIDO ? f.usu_nombre : `${f.usu_nombre} ${f.usu_apellido}`);
const aContrato = (f: FilaCliente) => ({ client_id: clientId(f.usu_id), nombre: nombreCompleto(f), email: f.usu_correo, identificacion: f.usu_documento });

@Injectable()
export class ClientesService {
  constructor(private readonly db: DbService) {}

  /** Basta con que coincida uno de los dos; si cada dato apunta a una persona distinta, gana el documento. */
  private buscarFila(email: string | null, documento: string | null, sql: Sql = this.db) {
    return sql.one<FilaCliente>(
      `SELECT ${COLUMNAS} FROM usuario
        WHERE usu_correo = $1 OR usu_documento = $2
        ORDER BY (usu_documento = $2) DESC NULLS LAST LIMIT 1`,
      [email, documento],
    );
  }

  async buscar(email: unknown, documento: unknown) {
    const correo = typeof email === 'string' ? (normalizarCorreo(email) as string) : '';
    const doc = typeof documento === 'string' ? (normalizarDocumento(documento) as string) : '';
    if (!correo && !doc) throw new BadRequestException('Indica email o identificacion.');
    const f = await this.buscarFila(correo || null, doc || null);
    if (!f) throw new NotFoundException('El turista no existe en Descubre EC.');
    return aContrato(f);
  }

  /** Idempotente: si la persona ya existe devuelve su client_id y `creado: false`. */
  async crear(d: CrearCliente) {
    const existente = await this.existente(d);
    if (existente) return { creado: false, client_id: clientId(existente.usu_id) };
    const [nombre, ...resto] = d.nombre.split(/\s+/);
    const nueva = await this.db.one<{ usu_id: string }>(
      `INSERT INTO usuario (usu_correo, usu_password, usu_nombre, usu_apellido, usu_documento, usu_telefono, usu_origen)
       VALUES ($1, '!', $2, $3, $4, $5, 'BOOKING')
       ON CONFLICT DO NOTHING RETURNING usu_id::text`,
      [d.email, nombre, resto.join(' ') || SIN_APELLIDO, d.identificacion, d.telefono ?? null],
    );
    if (nueva) return { creado: true, client_id: clientId(nueva.usu_id) };
    // Otra petición igual lo registró entre la búsqueda y el INSERT
    const ganadora = await this.existente(d);
    return { creado: false, client_id: clientId(ganadora!.usu_id) };
  }

  /** Busca a la persona y le completa el documento o teléfono que le falten (p. ej. una cuenta web). */
  private async existente(d: CrearCliente) {
    const f = await this.buscarFila(d.email, d.identificacion);
    if (!f) return null;
    if (!f.usu_documento || !f.usu_telefono) {
      await this.db.query(
        `UPDATE usuario u SET usu_telefono = COALESCE(u.usu_telefono, $3),
                usu_documento = COALESCE(u.usu_documento, CASE WHEN EXISTS (SELECT 1 FROM usuario o WHERE o.usu_documento = $2) THEN NULL ELSE $2 END)
          WHERE u.usu_id = $1`,
        [f.usu_id, d.identificacion, d.telefono ?? null],
      );
    }
    return f;
  }

  /** Para el panel: las personas registradas, las más nuevas primero. */
  async listar(q: ListaClientes) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const texto = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
    const donde = `WHERE ($1::text IS NULL OR usu_correo ILIKE $1 OR usu_documento ILIKE $1 OR (usu_nombre || ' ' || usu_apellido) ILIKE $1)`;
    const total = await this.db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM usuario ${donde}`, [texto]);
    const filas = await this.db.query<FilaCliente>(`SELECT ${COLUMNAS} FROM usuario ${donde} ORDER BY usu_creado_en DESC, usu_id DESC LIMIT $2 OFFSET $3`, [texto, limit, (page - 1) * limit]);
    return {
      data: filas.map((f) => ({ ...aContrato(f), telefono: f.usu_telefono, origen: f.usu_origen, creado_en: f.usu_creado_en })),
      total: total!.n,
      page,
      limit,
    };
  }
}

/** Contrato v3.1: Booking consulta y registra turistas con su X-API-Key. */
@Controller({ path: 'clientes', version: '3' })
@UseGuards(SocioGuard)
export class ClientesBookingController {
  constructor(private readonly s: ClientesService) {}

  /** Sin DTO a propósito: un parámetro de más en la consulta no debe romper la búsqueda de Booking. */
  @Get()
  buscar(@Query() q: Record<string, unknown>) {
    return this.s.buscar(q.email, q.identificacion ?? q.identification);
  }

  @Post()
  async crear(@Body() d: CrearCliente, @Res({ passthrough: true }) res: Response) {
    const { creado, client_id } = await this.s.crear(d);
    res.status(creado ? 201 : 200);
    return creado ? { client_id } : { client_id, mensaje: 'Turista ya existente reutilizado' };
  }
}

/** Panel de administración: ver a los turistas registrados. */
@Controller({ path: 'clientes', version: '1' })
@UseGuards(JwtGuard)
@Roles('ADMIN')
export class ClientesPanelController {
  constructor(private readonly s: ClientesService) {}

  @Get()
  listar(@Query() q: ListaClientes) {
    return this.s.listar(q);
  }
}
