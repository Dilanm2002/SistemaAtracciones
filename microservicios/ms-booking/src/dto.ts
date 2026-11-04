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
import { ContieneLetras, lower, RE_NOMBRE_PERSONA, trim } from './validadores';

const RE_CLIENT_ID = /^[\w.:-]{1,64}$/;

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

export const METODOS_V2 = ['TARJETA_CREDITO', 'TRANSFERENCIA', 'SOA_BOOKING_GATEWAY', 'PAGO_EN_SITIO'] as const;
export const TIPOS_DOCUMENTO = ['CEDULA', 'PASAPORTE', 'RUC'] as const;
export const TIPOS_BOLETO = ['ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT'] as const;
export const TIPOS_EVENTO_V2 = ['RESERVA_CREADA', 'RESERVA_CONFIRMADA', 'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'] as const;

// ── Catálogo ──────────────────────────────────────────────────────────────

export class CustomerContactV2 {

  @Transform(alias('nombre_completo', recortar))
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'full_name debe contener solo letras, espacios, apóstrofes o guiones' })
  @Matches(/\S+\s+\S+/, { message: 'full_name debe tener nombre y apellido' })
  full_name: string;

  @Transform(alias('correo', minusculas))
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
  email: string;

  @Transform(alias('telefono', sinSeparadores))
  @IsString()
  @Matches(/^(\+[1-9]\d{7,14}|09\d{8}|0[2-7]\d{7})$/, {
    message: 'phone debe tener formato internacional E.164 (+593991234567) o ser un celular válido de Ecuador (09XXXXXXXX)',
  })
  phone: string;

  @Transform(alias('tipo_documento', mayusculas))
  @IsIn(TIPOS_DOCUMENTO, { message: 'document_type debe ser CEDULA, PASAPORTE o RUC' })
  document_type: (typeof TIPOS_DOCUMENTO)[number];

  @Transform(alias('numero_documento', mayusculas))
  @IsString()
  @MinLength(6)
  @MaxLength(13)
  document_id: string;

  // Alias en español (contrato final)
  @IsOptional() @Allow() nombre_completo?: string;
  @IsOptional() @Allow() correo?: string;
  @IsOptional() @Allow() telefono?: string;
  @IsOptional() @Allow() tipo_documento?: string;
  @IsOptional() @Allow() numero_documento?: string;
  @IsOptional() @Allow() name?: string;

  // Contrato v3.1: mismo valor que client_id en la raíz de la reserva
  @IsOptional() @IsString() @Matches(RE_CLIENT_ID, { message: 'client_id no es válido' }) client_id?: string;
}

export class PassengerItemV2 {

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'full_name debe contener solo letras' })
  full_name: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(13)
  document_id?: string;

  @IsIn(TIPOS_BOLETO)
  ticket_type: (typeof TIPOS_BOLETO)[number];
}

export class CreateReservaRequestV2 {

  @IsString({ message: 'atraccion_id es obligatorio' })
  @MaxLength(220)
  atraccion_id: string;

  @IsDateString({ strict: true }, { message: 'fecha debe ser una fecha válida (YYYY-MM-DD)' })
  fecha: string;

  @IsString({ message: 'slot_id es obligatorio' })
  @Matches(/^slot-\d{8}-\d{4}$/, { message: 'slot_id debe tener el formato slot-AAAAMMDD-HHMM (el de la consulta de disponibilidad)' })
  slot_id: string;

  @Transform(alias('time_24h'))
  @IsString({ message: 'hora es obligatoria' })
  @MaxLength(12)
  hora: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, { message: 'time_24h debe tener formato HH:mm o HH:mm:ss' })
  time_24h?: string;

  @Transform(alias('cantidad_adultos'))
  @IsInt({ message: 'adult_count es obligatorio' })
  @Min(1, { message: 'adult_count debe ser al menos 1' })
  @Max(50)
  adult_count: number;

  @IsOptional() @Transform(alias('cantidad_ninos')) @IsInt() @Min(0) @Max(50) child_count?: number;
  @IsOptional() @Transform(alias('cantidad_seniors')) @IsInt() @Min(0) @Max(50) senior_count?: number;
  @IsOptional() @Transform(alias('cantidad_estudiantes')) @IsInt() @Min(0) @Max(50) student_count?: number;
  @IsOptional() @Transform(alias('cantidad_infantes')) @IsInt() @Min(0) @Max(50) infant_count?: number;

  @ValidateNested()
  @Type(() => CustomerContactV2)
  customer: CustomerContactV2;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PassengerItemV2)
  passengers?: PassengerItemV2[];

  @IsOptional() @IsString() @MaxLength(60) @Matches(/^[\w.:-]+$/) saga_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotency_key?: string;

  @Transform(alias('metodo_pago'))
  @IsIn(METODOS_V2, { message: 'payment_method debe ser TARJETA_CREDITO, TRANSFERENCIA, SOA_BOOKING_GATEWAY o PAGO_EN_SITIO' })
  payment_method: (typeof METODOS_V2)[number];

  @IsOptional()
  @Transform(alias('observaciones', recortar))
  @IsString()
  @MaxLength(500)
  @ContieneLetras()
  special_requirements?: string;

  // Alias en español (contrato final)
  @IsOptional() @Allow() cantidad_adultos?: number;
  @IsOptional() @Allow() cantidad_ninos?: number;
  @IsOptional() @Allow() cantidad_seniors?: number;
  @IsOptional() @Allow() cantidad_estudiantes?: number;
  @IsOptional() @Allow() cantidad_infantes?: number;
  @IsOptional() @Allow() metodo_pago?: string;
  @IsOptional() @Allow() observaciones?: string;

  // Nombres canónicos del contrato v3 y de la guía de integración de Booking
  @IsOptional() @Allow() attraction_id?: string;
  @IsOptional() @Allow() date?: string;
  @IsOptional() @Allow() time?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  total_tickets?: number;
  @IsOptional() @Allow() booking_reservation_id?: string;
  @IsOptional() @Allow() correlation_id?: string;

  // Contrato v3.1: el turista registrado con /clientes
  @IsOptional() @IsString() @Matches(RE_CLIENT_ID, { message: 'client_id no es válido' }) client_id?: string;
}

export class CancelReservationRequestV2 {

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsIn(['CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN'])
  solicitante?: 'CLIENTE' | 'SAGA_ORCHESTRATOR' | 'ADMIN' = 'CLIENTE';
}

export class CheckinRequestV2 {

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(20)
  documento_identidad: string;

  @IsOptional() @IsString() @MaxLength(600) codigo_voucher_qr?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) guia_codigo?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) scanner_device_id?: string;
  @IsOptional() @Allow() guia_asignado?: string;
}

export class EventosQueryV2 {

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @IsIn(TIPOS_EVENTO_V2)
  type?: (typeof TIPOS_EVENTO_V2)[number];
}
