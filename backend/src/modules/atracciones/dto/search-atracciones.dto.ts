import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType } from './create-atraccion.dto';

export class DatesFilterDto {
  @ApiProperty({ description: 'Fecha de inicio', example: '2026-10-10' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ description: 'Fecha de fin', example: '2026-10-12' })
  @IsDateString()
  end_date: string;
}

export class RatingFilterDto {
  @ApiProperty({ description: 'Puntuación mínima (0 a 5)', example: 4.2, required: false })
  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  minimum_review_score?: number;

  @ApiProperty({ description: 'Cantidad mínima de reseñas', example: 10, required: false })
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  minimum_review_count?: number;
}

export class PriceRangeDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  min?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  max?: number;
}

export class DurationRangeDto {
  @ApiPropertyOptional({ description: 'Horas mínimas', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(720)
  min_hours?: number;

  @ApiPropertyOptional({ description: 'Horas máximas', example: 4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(720)
  max_hours?: number;
}

export class FiltersDto {
  @ApiProperty({ description: 'Filtros de calificación', type: RatingFilterDto, required: false })
  @ValidateNested()
  @Type(() => RatingFilterDto)
  @IsOptional()
  rating?: RatingFilterDto;

  // ── Extensiones ───────────────────────────────────────────────────────
  @ApiPropertyOptional({ description: 'Texto libre (nombre, descripción, ciudad)', example: 'volcán' })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'filters.query no puede superar 120 caracteres' })
  query?: string;

  @ApiPropertyOptional({ description: 'Slugs de categorías', example: ['aventura'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({ description: 'Regiones', example: ['SIERRA'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(['SIERRA', 'COSTA', 'AMAZONIA', 'GALAPAGOS'], { each: true })
  regions?: string[];

  @ApiPropertyOptional({ type: PriceRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PriceRangeDto)
  price?: PriceRangeDto;

  @ApiPropertyOptional({ type: DurationRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DurationRangeDto)
  duration?: DurationRangeDto;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  free_cancellation?: boolean;

  @ApiPropertyOptional({ enum: ProductType, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsEnum(ProductType, { each: true })
  product_types?: ProductType[];
}

export const SORT_OPTIONS = ['most_popular', 'price_asc', 'price_desc', 'rating', 'newest', 'duration'] as const;

export class SortDto {
  @ApiProperty({ description: 'Criterio de ordenamiento', example: 'most_popular', enum: SORT_OPTIONS })
  @IsIn(SORT_OPTIONS as unknown as string[], { message: `sort.by debe ser uno de: ${SORT_OPTIONS.join(', ')}` })
  by: string;
}

export class SearchAtraccionesDto {
  @ApiProperty({ description: 'Moneda solicitada', example: 'USD', required: false })
  @IsString()
  @IsOptional()
  currency?: string = 'USD';

  @ApiProperty({ description: 'IDs de ciudades/destinos', example: [1], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  cities?: number[];

  @ApiProperty({ description: 'Códigos de países ISO', example: ['ec'], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  countries?: string[];

  @ApiProperty({ description: 'Rango de fechas (solo devuelve atracciones con cupo en ese rango)', type: DatesFilterDto, required: false })
  @ValidateNested()
  @Type(() => DatesFilterDto)
  @IsOptional()
  dates?: DatesFilterDto;

  @ApiProperty({ description: 'Filtros adicionales', type: FiltersDto, required: false })
  @ValidateNested()
  @Type(() => FiltersDto)
  @IsOptional()
  filters?: FiltersDto;

  @ApiProperty({ description: 'Token opaco de paginación', example: 'eyJvZmZzZXQiOjEyfQ==', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  next_page?: string;

  @ApiProperty({ description: 'Cantidad de filas a retornar', example: 12, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  rows?: number = 12;

  @ApiProperty({ description: 'Ordenamiento', type: SortDto, required: false })
  @ValidateNested()
  @Type(() => SortDto)
  @IsOptional()
  sort?: SortDto;
}
