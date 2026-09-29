import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsInt, Min, IsEmail, IsOptional, IsDateString, Matches, MaxLength, Max, IsEnum, MinLength, IsIn } from 'class-validator';
import { PriceDto } from './nested-types.dto';

const trim = ({ value }) => (typeof value === 'string' ? value.trim() : value);

export enum ReservationStatus {
  CONFIRMED = 'CONFIRMED',
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  TARJETA = 'TARJETA',
  TRANSFERENCIA = 'TRANSFERENCIA',
  EN_SITIO = 'EN_SITIO',
}

export class ReservationRequestDto {
  @ApiProperty({ description: 'Fecha para la reserva', example: '2026-10-10', format: 'date' })
  @IsDateString({}, { message: 'date debe ser una fecha válida (AAAA-MM-DD)' })
  date: string;

  @ApiProperty({ description: 'Hora seleccionada', example: '10:00', required: false })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time debe tener formato HH:mm' })
  time?: string;

  @ApiProperty({ description: 'Cantidad total de tickets (adultos + niños)', example: 2 })
  @IsInt()
  @Min(1, { message: 'ticket_count debe ser al menos 1' })
  @Max(30, { message: 'ticket_count no puede superar 30 por reserva' })
  ticket_count: number;

  @ApiProperty({ description: 'Nombre completo del cliente', example: 'Juan Pérez' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'customer_name debe tener al menos 3 caracteres' })
  @MaxLength(120)
  customer_name: string;

  @ApiProperty({ description: 'Email del cliente', example: 'juan@example.com', required: false })
  @IsEmail({}, { message: 'customer_email no tiene un formato válido' })
  @IsOptional()
  customer_email?: string;

  // ── Extensiones ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ description: 'Cuántos de los tickets son de niño (3-11 años)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ example: '0991234567' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?\d{7,15}$/, { message: 'customer_phone debe tener entre 7 y 15 dígitos' })
  customer_phone?: string;

  @ApiPropertyOptional({ description: 'Cédula o pasaporte', example: '1712345678' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  customer_document?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, example: PaymentMethod.TARJETA })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'payment_method debe ser TARJETA, TRANSFERENCIA o EN_SITIO' })
  payment_method?: PaymentMethod;

  @ApiPropertyOptional({ example: 'Viajamos con una persona vegetariana' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AttractionSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() city: string;
  @ApiProperty() photo: string;
  @ApiPropertyOptional() meeting_point?: string;
  @ApiPropertyOptional() free_cancellation?: boolean;
  @ApiPropertyOptional() cancellation_hours?: number;
}

export class ReservationResponseDto {
  @ApiProperty({ description: 'ID único de reserva', format: 'uuid', example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  reservation_id: string;

  @ApiProperty({ description: 'Estado de la reserva', enum: ReservationStatus, example: ReservationStatus.CONFIRMED })
  status: ReservationStatus;

  @ApiProperty({ description: 'Cantidad de tickets reservados', example: 2 })
  ticket_count: number;

  @ApiProperty({ description: 'Precio total de la reserva', type: PriceDto })
  total_price: PriceDto;

  // ── Extensiones ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'DEC-7F3K9Q' }) code?: string;
  @ApiPropertyOptional({ type: AttractionSummaryDto }) attraction?: AttractionSummaryDto;
  @ApiPropertyOptional() date?: string;
  @ApiPropertyOptional() time?: string;
  @ApiPropertyOptional() adults?: number;
  @ApiPropertyOptional() children?: number;
  @ApiPropertyOptional() customer?: { name: string; email?: string; phone?: string; document?: string };
  @ApiPropertyOptional({ enum: PaymentMethod }) payment_method?: PaymentMethod;
  @ApiPropertyOptional() notes?: string;
  @ApiPropertyOptional() cancellation_reason?: string;
  @ApiPropertyOptional() cancelled_at?: string;
  @ApiPropertyOptional() created_at?: string;
  @ApiPropertyOptional({ description: 'Si todavía puede cancelarse sin costo' }) can_cancel?: boolean;
  @ApiPropertyOptional() _links?: any;
}

export class CancelReservationRequestDto {
  @ApiProperty({ description: 'Razón de la cancelación', example: 'Cambio de planes' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'reason debe tener al menos 3 caracteres' })
  @MaxLength(255)
  reason: string;
}

export class ReservationsQueryDto {
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @ApiPropertyOptional({ description: 'upcoming = fecha >= hoy; past = fecha < hoy', enum: ['upcoming', 'past'] })
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  when?: 'upcoming' | 'past';

  @ApiPropertyOptional({ description: 'Fecha exacta (AAAA-MM-DD)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Desde (AAAA-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta (AAAA-MM-DD)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Busca por código, cliente o email' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'UUID de la atracción' })
  @IsOptional()
  @IsString()
  attraction_id?: string;

  @ApiPropertyOptional({ description: 'Solo admin/operador: true = todas las reservas, no solo las propias' })
  @IsOptional()
  @IsIn(['true', 'false'])
  all?: string;
}
