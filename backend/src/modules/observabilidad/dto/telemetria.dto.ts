import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const VITALES = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
export const TIPOS_ERROR_WEB = ['excepcion', 'promesa', 'render', 'api'] as const;

/** Una señal de la web: un error o una medición de Web Vitals. */
export class SenalWebDto {
  @ApiProperty({ enum: ['error', 'vital'] })
  @IsIn(['error', 'vital'])
  clase: 'error' | 'vital';

  @ApiProperty({ description: 'Ruta de la página como plantilla (los ids reemplazados por :id)', example: '/atraccion/:id' })
  @IsString()
  @MaxLength(200)
  ruta: string;

  @ApiPropertyOptional({ example: '2.7.0' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  // ── Error ───────────────────────────────────────────────────────────
  @ApiPropertyOptional({ enum: TIPOS_ERROR_WEB })
  @IsOptional()
  @IsIn(TIPOS_ERROR_WEB)
  tipo?: (typeof TIPOS_ERROR_WEB)[number];

  @ApiPropertyOptional({ example: "TypeError: Cannot read properties of undefined (reading 'name')" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mensaje?: string;

  @ApiPropertyOptional({ description: 'Pila de llamadas (recortada)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  pila?: string;

  @ApiPropertyOptional({ description: 'request_id de la llamada a la API que falló' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  request_id?: string;

  @ApiPropertyOptional({ description: 'Estado HTTP de la llamada que falló (0 = sin conexión)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(599)
  estado?: number;

  @ApiPropertyOptional({ example: 'Chrome 141 · Android' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  navegador?: string;

  // ── Web Vital ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ enum: VITALES })
  @IsOptional()
  @IsIn(VITALES)
  nombre?: (typeof VITALES)[number];

  @ApiPropertyOptional({ description: 'Milisegundos (CLS: sin unidad)', example: 1840 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(600_000)
  valor?: number;

  @ApiPropertyOptional({ enum: ['good', 'needs-improvement', 'poor'] })
  @IsOptional()
  @IsIn(['good', 'needs-improvement', 'poor'])
  calificacion?: 'good' | 'needs-improvement' | 'poor';

  @ApiPropertyOptional({ enum: ['movil', 'escritorio'] })
  @IsOptional()
  @IsIn(['movil', 'escritorio'])
  dispositivo?: 'movil' | 'escritorio';
}

export class TelemetriaDto {
  @ApiProperty({ type: [SenalWebDto], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SenalWebDto)
  senales: SenalWebDto[];
}

export class ResumenQueryDto {
  @ApiPropertyOptional({ enum: ['1h', '24h', '7d'], default: '24h' })
  @IsOptional()
  @IsIn(['1h', '24h', '7d'])
  rango?: '1h' | '24h' | '7d' = '24h';
}
