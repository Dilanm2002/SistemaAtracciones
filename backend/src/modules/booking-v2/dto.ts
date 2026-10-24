import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { lower, trim } from '../../common/utils/transform';
import { ContieneLetras, RE_NOMBRE_PERSONA } from '../../common/utils/validators';

/**
 * DTO del contrato v2 con Booking Prototipo (contracts/atracciones-openapi-v2.yaml).
 * Los nombres de campos, enums y límites son los del contrato: no se cambian sin acordarlo.
 */

/**
 * Alias en español del contrato final (`cantidad_adultos`, `nombre_completo`, `metodo_pago`…): si el
 * campo principal no llega, toma el valor del alias ANTES de validar. Así se acepta cualquiera de los dos.
 */
const alias = (nombre: string, despues?: (v: unknown) => unknown) => ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
  const v = value ?? obj[nombre];
  return despues ? despues(v) : v;
};
const recortar = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
const mayusculas = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const minusculas = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const sinSeparadores = (v: unknown) => (typeof v === 'string' ? v.replace(/[\s()-]/g, '') : v);

/** Booleanos en query string: «true»/«false» (y 1/0). */
const bool = ({ value }: { value: unknown }) => (value === 'true' || value === '1' || value === true ? true : value === 'false' || value === '0' || value === false ? false : value);

export const SORTS_V2 = ['PRICE_ASC', 'PRICE_DESC', 'RATING_DESC', 'POPULARITY'] as const;
export const METODOS_V2 = ['TARJETA_CREDITO', 'TRANSFERENCIA', 'SOA_BOOKING_GATEWAY', 'PAGO_EN_SITIO'] as const;
export const TIPOS_DOCUMENTO = ['CEDULA', 'PASAPORTE', 'RUC'] as const;
export const TIPOS_BOLETO = ['ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT'] as const;
export const TIPOS_EVENTO_V2 = ['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'] as const;

// ── Catálogo ──────────────────────────────────────────────────────────────

export class CategoriasQueryV2 {
  @ApiPropertyOptional({ description: 'ID de la categoría padre; sin él se devuelven las raíz', example: 'cat-1' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  padre_id?: string;
}

export class ListAtraccionesQueryV2 {
  @ApiPropertyOptional({ example: 'Quito' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ example: 'cat-1' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoria_id?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() incluye_comida?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() incluye_transporte?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() incluye_guia?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @ApiPropertyOptional({ enum: SORTS_V2, default: 'POPULARITY' })
  @IsOptional()
  @IsIn(SORTS_V2)
  sort?: (typeof SORTS_V2)[number] = 'POPULARITY';
}

export class SearchAtraccionesRequestV2 {
  @ApiPropertyOptional({ example: 'Quito' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) query?: string;
  @ApiPropertyOptional({ example: 'Quito' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(80) ciudad?: string;
  @ApiPropertyOptional({ example: '2026-10-25' }) @IsOptional() @IsDateString({ strict: true }) fecha_inicio?: string;
  @ApiPropertyOptional({ example: '2026-10-28' }) @IsOptional() @IsDateString({ strict: true }) fecha_fin?: string;
  @ApiPropertyOptional({ example: 'cat-1' }) @IsOptional() @IsString() @MaxLength(80) categoria_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() incluye_comida?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() incluye_transporte?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() incluye_guia?: boolean;
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsNumber() @Min(0) precio_min?: number;
  @ApiPropertyOptional({ example: 150 }) @IsOptional() @IsNumber() @Min(0) precio_max?: number;
  @ApiPropertyOptional({ example: 8 }) @IsOptional() @IsInt() @Min(1) @Max(720) duracion_max_horas?: number;
  @ApiPropertyOptional({ example: 'Español' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) idioma_guia?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() accesible_silla_ruedas?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() animales_asistencia?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cancelacion_gratuita?: boolean;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Transform(alias('cantidad_adultos')) @IsInt() @Min(1) @Max(50) adult_count?: number = 1;
  @ApiPropertyOptional({ description: 'Alias de adult_count' }) @IsOptional() @Allow() cantidad_adultos?: number;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional({ default: 10, maximum: 50 }) @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number = 10;
}

export class DisponibilidadQueryV2 {
  @ApiProperty({ example: '2026-10-25', format: 'date', description: 'También se acepta `fecha`' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'date debe ser una fecha válida (YYYY-MM-DD)' })
  date?: string;

  @ApiPropertyOptional({ description: 'Alias de date', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'fecha debe ser una fecha válida (YYYY-MM-DD)' })
  fecha?: string;
}

// ── Reservas ──────────────────────────────────────────────────────────────

export class CustomerContactV2 {
  @ApiProperty({ example: 'Paúl Rosero', description: 'También se acepta `nombre_completo`' })
  @Transform(alias('nombre_completo', recortar))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'full_name debe contener solo letras, espacios, apóstrofes o guiones' })
  @Matches(/\S+\s+\S+/, { message: 'full_name debe tener nombre y apellido' })
  full_name: string;

  @ApiProperty({ example: 'paul.rosero@epn.edu.ec', description: 'También se acepta `correo`' })
  @Transform(alias('correo', minusculas))
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
  email: string;

  @ApiProperty({ example: '+593991234567', description: 'E.164 o celular ecuatoriano 09XXXXXXXX. También se acepta `telefono`' })
  @Transform(alias('telefono', sinSeparadores))
  @IsString()
  @Matches(/^(\+[1-9]\d{7,14}|09\d{8}|0[2-7]\d{7})$/, {
    message: 'phone debe tener formato internacional E.164 (+593991234567) o ser un celular válido de Ecuador (09XXXXXXXX)',
  })
  phone: string;

  @ApiProperty({ enum: TIPOS_DOCUMENTO, example: 'CEDULA', description: 'También se acepta `tipo_documento`' })
  @Transform(alias('tipo_documento', mayusculas))
  @IsIn(TIPOS_DOCUMENTO, { message: 'document_type debe ser CEDULA, PASAPORTE o RUC' })
  document_type: (typeof TIPOS_DOCUMENTO)[number];

  @ApiProperty({ example: '1723456789', description: 'También se acepta `numero_documento`' })
  @Transform(alias('numero_documento', mayusculas))
  @IsString()
  @MinLength(6)
  @MaxLength(13)
  document_id: string;

  // Alias en español (contrato final)
  @ApiPropertyOptional() @IsOptional() @Allow() nombre_completo?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() correo?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() telefono?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() tipo_documento?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() numero_documento?: string;
}

export class PassengerItemV2 {
  @ApiProperty({ example: 'Mateo Rosero' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'full_name debe contener solo letras' })
  full_name: string;

  @ApiPropertyOptional({ example: '1754321098' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(13)
  document_id?: string;

  @ApiProperty({ enum: TIPOS_BOLETO, example: 'CHILD' })
  @IsIn(TIPOS_BOLETO)
  ticket_type: (typeof TIPOS_BOLETO)[number];
}

export class CreateReservaRequestV2 {
  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', description: 'UUID o slug de la atracción' })
  @IsString({ message: 'atraccion_id es obligatorio' })
  @MaxLength(220)
  atraccion_id: string;

  @ApiProperty({ example: '2026-10-25', format: 'date' })
  @IsDateString({ strict: true }, { message: 'fecha debe ser una fecha válida (YYYY-MM-DD)' })
  fecha: string;

  @ApiProperty({ example: 'slot-20261025-1030', description: 'Turno obtenido en GET /atracciones/{id}/disponibilidad' })
  @IsString({ message: 'slot_id es obligatorio' })
  @Matches(/^slot-\d{8}-\d{4}$/, { message: 'slot_id debe tener el formato slot-AAAAMMDD-HHMM (el de la consulta de disponibilidad)' })
  slot_id: string;

  @ApiProperty({ example: '10:30:00', description: 'HH:mm:ss (24 h) o «10:30 a.m.»; también se acepta `time_24h`' })
  @Transform(alias('time_24h'))
  @IsString({ message: 'hora es obligatoria' })
  @MaxLength(12)
  hora: string;

  @ApiPropertyOptional({ example: '10:30:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, { message: 'time_24h debe tener formato HH:mm o HH:mm:ss' })
  time_24h?: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Transform(alias('cantidad_adultos'))
  @IsInt({ message: 'adult_count es obligatorio' })
  @Min(1, { message: 'adult_count debe ser al menos 1' })
  @Max(50)
  adult_count: number;

  @ApiPropertyOptional({ example: 1, default: 0 }) @IsOptional() @Transform(alias('cantidad_ninos')) @IsInt() @Min(0) @Max(50) child_count?: number;
  @ApiPropertyOptional({ example: 0, default: 0 }) @IsOptional() @Transform(alias('cantidad_seniors')) @IsInt() @Min(0) @Max(50) senior_count?: number;
  @ApiPropertyOptional({ example: 0, default: 0 }) @IsOptional() @Transform(alias('cantidad_estudiantes')) @IsInt() @Min(0) @Max(50) student_count?: number;
  @ApiPropertyOptional({ example: 0, default: 0 }) @IsOptional() @Transform(alias('cantidad_infantes')) @IsInt() @Min(0) @Max(50) infant_count?: number;

  @ApiProperty({ type: CustomerContactV2 })
  @ValidateNested()
  @Type(() => CustomerContactV2)
  customer: CustomerContactV2;

  @ApiPropertyOptional({ type: [PassengerItemV2] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PassengerItemV2)
  passengers?: PassengerItemV2[];

  @ApiPropertyOptional({ example: 'SAGA-7K2X9M' }) @IsOptional() @IsString() @MaxLength(60) @Matches(/^[\w.:-]+$/) saga_id?: string;
  @ApiPropertyOptional({ deprecated: true, description: 'Obsoleto: debe coincidir con la cabecera Idempotency-Key' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotency_key?: string;

  @ApiProperty({ enum: METODOS_V2, example: 'SOA_BOOKING_GATEWAY', description: 'También se acepta `metodo_pago`' })
  @Transform(alias('metodo_pago'))
  @IsIn(METODOS_V2, { message: 'payment_method debe ser TARJETA_CREDITO, TRANSFERENCIA, SOA_BOOKING_GATEWAY o PAGO_EN_SITIO' })
  payment_method: (typeof METODOS_V2)[number];

  @ApiPropertyOptional({ example: 'Un pasajero requiere asistencia para subir al bus.', description: 'También se acepta `observaciones`' })
  @IsOptional()
  @Transform(alias('observaciones', recortar))
  @IsString()
  @MaxLength(500)
  @ContieneLetras()
  special_requirements?: string;

  // Alias en español (contrato final)
  @ApiPropertyOptional() @IsOptional() @Allow() cantidad_adultos?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() cantidad_ninos?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() cantidad_seniors?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() cantidad_estudiantes?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() cantidad_infantes?: number;
  @ApiPropertyOptional() @IsOptional() @Allow() metodo_pago?: string;
  @ApiPropertyOptional() @IsOptional() @Allow() observaciones?: string;
}

export class CancelReservationRequestV2 {
  @ApiPropertyOptional({ example: 'SAGA_COMPENSATION_PARTNER_FAILURE' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({ enum: ['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'], default: 'CLIENTE' })
  @IsOptional()
  @IsIn(['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'])
  solicitante?: 'CLIENTE' | 'SAGA_ORCHESTRATOR' | 'ADMIN' = 'CLIENTE';
}

export class CheckinRequestV2 {
  @ApiProperty({ example: '1723456789' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(20)
  documento_identidad: string;

  @ApiPropertyOptional({ example: 'DEC-7F3K9Q' }) @IsOptional() @IsString() @MaxLength(600) codigo_voucher_qr?: string;
  @ApiPropertyOptional({ example: 'GUIA-CARLOS-01' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) guia_codigo?: string;
  @ApiPropertyOptional({ example: 'SCANNER-TERMINAL-04' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) scanner_device_id?: string;
}

// ── Promociones B2B ───────────────────────────────────────────────────────

export class ContactoComercialV2 {
  @ApiPropertyOptional({ example: 'Dilan Mena' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(120) nombre?: string;
  @ApiPropertyOptional({ example: 'reservas@descubre-ec.com' }) @IsOptional() @Transform(lower) @IsEmail() @MaxLength(160) email?: string;
  @ApiPropertyOptional({ example: '+593998765432' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value))
  @Matches(/^(\+[1-9]\d{7,14}|09\d{8}|0[2-7]\d{7})$/, { message: 'telefono debe ser E.164 o un teléfono de Ecuador' })
  telefono?: string;
}

export class ActualizarPromocionesContratoRequest {
  @ApiProperty({ example: true }) @IsBoolean() permite_promociones: boolean;

  @ApiProperty({ example: 15, minimum: 0, maximum: 50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50, { message: 'porcentaje_descuento_maximo no puede superar 50' })
  porcentaje_descuento_maximo: number;

  @ApiPropertyOptional({ example: ['Quito', 'Baños', 'Cuenca', 'Galápagos'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  destinos_habilitados?: string[];

  @ApiPropertyOptional({ example: '2027-12-31' }) @IsOptional() @IsDateString({ strict: true }) vigencia_hasta?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) condiciones_combo?: string;

  @ApiPropertyOptional({ type: ContactoComercialV2 })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactoComercialV2)
  contacto_comercial?: ContactoComercialV2;
}

// ── Eventos ───────────────────────────────────────────────────────────────

export class EventosQueryV2 {
  @ApiPropertyOptional({ default: 0, example: 1042 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number = 0;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: TIPOS_EVENTO_V2 })
  @IsOptional()
  @IsIn(TIPOS_EVENTO_V2)
  type?: (typeof TIPOS_EVENTO_V2)[number];
}
