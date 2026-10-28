import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' || value === true ? true : value === 'false' || value === '0' || value === false ? false : value);
const entero = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export const SORTS = ['PRICE_ASC', 'PRICE_DESC', 'RATING_DESC', 'POPULARITY'] as const;
export const TIPOS_ATRACCION = ['GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE'] as const;
export const ESTADOS_ATRACCION = ['BORRADOR', 'PUBLICADA', 'INACTIVA'] as const;
export const TIPOS_TARIFA = ['ADULTO', 'NINO', 'MAYOR', 'ESTUDIANTE', 'GRUPO'] as const;

// ── Contrato con Booking (v2/v3): mismos nombres y límites que atracciones-openapi-v3.yaml ──

export class CategoriasQuery {
  @IsOptional() @IsString() @MaxLength(80) padre_id?: string;
}

export class ListAtraccionesQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) categoria_id?: string;
  @IsOptional() @Transform(bool) @IsBoolean() incluye_comida?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() incluye_transporte?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() incluye_guia?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number = 10;
  @IsOptional() @IsIn(SORTS) sort?: (typeof SORTS)[number] = 'POPULARITY';
}

export class SearchAtraccionesRequest {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) query?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) ciudad?: string;
  @IsOptional() @IsDateString({ strict: true }) fecha_inicio?: string;
  @IsOptional() @IsDateString({ strict: true }) fecha_fin?: string;
  @IsOptional() @IsString() @MaxLength(80) categoria_id?: string;
  @IsOptional() @IsBoolean() incluye_comida?: boolean;
  @IsOptional() @IsBoolean() incluye_transporte?: boolean;
  @IsOptional() @IsBoolean() incluye_guia?: boolean;
  @IsOptional() @IsNumber() @Min(0) precio_min?: number;
  @IsOptional() @IsNumber() @Min(0) precio_max?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) duracion_max_horas?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) idioma_guia?: string;
  @IsOptional() @IsBoolean() accesible_silla_ruedas?: boolean;
  @IsOptional() @IsBoolean() animales_asistencia?: boolean;
  @IsOptional() @IsBoolean() cancelacion_gratuita?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(50) adult_count?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) cantidad_adultos?: number;
  @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number = 10;
}

// ── API propia (nombres de columna de la base) ──

export class AtraccionesQuery {
  @IsOptional() @IsIn(ESTADOS_ATRACCION) atr_estado?: (typeof ESTADOS_ATRACCION)[number];
  @IsOptional() @Transform(entero) @IsInt() @Min(1) ciu_id?: number;
  @IsOptional() @Transform(entero) @IsInt() @Min(1) ope_id?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

export class FotoEntrada {
  @IsString() @MaxLength(500) @Matches(/^(https?:\/\/|\/)/, { message: 'fot_url debe ser una URL http(s) o una ruta que empiece con /' }) fot_url: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) fot_alt: string;
}

export class ParadaEntrada {
  @IsInt() @Min(1) iti_orden: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'iti_hora debe ser HH:mm' }) iti_hora: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(150) iti_titulo: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) iti_descripcion?: string;
  @IsInt() @Min(1) @Max(1440) iti_duracion_min: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) iti_lugar?: string;
}

/** Campos editables de la atracción (crear: los obligatorios del script; actualizar: todos opcionales). */
export class AtraccionCampos {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) atr_nombre?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(20) atr_descripcion?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(280) atr_descripcion_corta?: string;
  @IsOptional() @IsIn(TIPOS_ATRACCION) atr_tipo?: (typeof TIPOS_ATRACCION)[number];
  @IsOptional() @IsIn(ESTADOS_ATRACCION) atr_estado?: (typeof ESTADOS_ATRACCION)[number];
  @IsOptional() @IsNumber() @Min(-90) @Max(90) atr_latitud?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) atr_longitud?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) atr_direccion?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) atr_punto_encuentro?: string;
  @IsOptional() @IsNumber() @Min(0.25) @Max(720) atr_duracion_horas?: number;
  @IsOptional() @IsInt() @Min(1) ciu_id?: number;
  @IsOptional() @IsBoolean() atr_cancelacion_gratuita?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(720) atr_horas_cancelacion?: number;
  @IsOptional() @IsBoolean() atr_destacada?: boolean;
  @IsOptional() @IsBoolean() atr_incluye_comida?: boolean;
  @IsOptional() @IsBoolean() atr_incluye_transporte?: boolean;
  @IsOptional() @IsBoolean() atr_incluye_guia?: boolean;
  @IsOptional() @IsBoolean() atr_accesible_silla?: boolean;
  @IsOptional() @IsBoolean() atr_accesible_coche?: boolean;
  @IsOptional() @IsBoolean() atr_animales_servicio?: boolean;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) atr_guia?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) atr_instrucciones_llegada?: string;
  @IsOptional() @IsBoolean() atr_permite_paquete?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(50) atr_descuento_paquete?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) cat_ids?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) idi_ids?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsInt({ each: true }) inc_ids?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FotoEntrada) fotos?: FotoEntrada[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ParadaEntrada) itinerario?: ParadaEntrada[];
}

/** Al crear, además de los campos editables, se elige el operador (solo ADMIN; el OPERADOR crea para su empresa). */
export class CrearAtraccion extends AtraccionCampos {
  @IsOptional() @IsInt() @Min(1) ope_id?: number;
}

/** Columnas NOT NULL del script del equipo que no tienen valor por defecto: obligatorias al crear. */
export const OBLIGATORIOS_CREAR = ['atr_nombre', 'atr_descripcion', 'atr_tipo', 'atr_latitud', 'atr_longitud', 'atr_duracion_horas', 'ciu_id'] as const;

// ── Eventos entrantes (POST /internal/eventos) ──

export const TIPOS_EVENTO = ['RESENA_PUBLICADA', 'PRECIO_ACTUALIZADO'] as const;

/** Sobre CloudEvents 1.0 (el mismo formato del feed de eventos del contrato con Booking). */
export class EventoEntrante {
  @IsOptional() @IsIn(['1.0']) specversion?: string;
  @IsUUID() event_id: string;
  @IsIn(TIPOS_EVENTO) event_type: (typeof TIPOS_EVENTO)[number];
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(100) correlation_id?: string;
  @IsOptional() @IsString() timestamp?: string;
  @IsObject() @Allow() data: Record<string, unknown>;
}
