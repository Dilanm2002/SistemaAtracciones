import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../../common/utils/transform';
import { ContieneLetras, FechaFutura } from '../../../common/utils/validators';

export class SlotDto {
  @ApiProperty({ example: '10:00' }) time: string;
  @ApiProperty({ example: 12 }) available: number;
  @ApiProperty({ example: 20 }) capacity: number;
}

export class AvailabilityResponseDto {
  @ApiProperty({ description: 'Fecha de disponibilidad', example: '2026-10-10', format: 'date' })
  date: string;

  @ApiProperty({ description: 'Cupos disponibles (suma de todos los horarios)', example: 45 })
  available_spots: number;

  @ApiProperty({ description: 'Horarios de inicio con cupo disponible', example: ['10:00', '14:00'] })
  times: string[];

  // ── Extensiones ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ type: [SlotDto], description: 'Detalle de cupos por horario' })
  slots?: SlotDto[];

  @ApiPropertyOptional({ description: 'Motivo si la fecha está bloqueada o no disponible' })
  unavailable_reason?: string;
}

export class AvailabilityQueryDto {
  @ApiProperty({ example: '2026-10-10' })
  @IsDateString({}, { message: 'date es obligatorio y debe tener formato AAAA-MM-DD' })
  date: string;
}

export class CalendarQueryDto {
  @ApiProperty({ description: 'Mes (AAAA-MM)', example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month debe tener formato AAAA-MM' })
  month: string;
}

export class CalendarDayDto {
  @ApiProperty() date: string;
  @ApiProperty() available_spots: number;
  @ApiProperty({ enum: ['available', 'low', 'full', 'blocked', 'past'] }) status: string;
  @ApiPropertyOptional() reason?: string;
}

export class BlockDateDto {
  @ApiProperty({ example: '2026-12-25' })
  @IsDateString({}, { message: 'date debe tener formato AAAA-MM-DD' })
  @FechaFutura(365, { message: 'date debe ser desde hoy y hasta un año adelante' })
  date: string;

  @ApiProperty({ example: 'Feriado de Navidad' })
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'reason debe tener al menos 5 caracteres' })
  @MaxLength(200)
  @ContieneLetras({ message: 'reason debe explicar el motivo con texto' })
  reason: string;
}

export class BlockedDatesQueryDto {
  @ApiPropertyOptional({ description: 'Mes (AAAA-MM)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}
