import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PriceDto, LocationDto, PhotoDto, OperatorDto } from './nested-types.dto';

export enum ProductType {
  SINGLE_TICKET = 'SINGLE_TICKET',
  GUIDED_TOUR = 'GUIDED_TOUR',
  PACKAGE = 'PACKAGE',
}

export class CreateAtraccionDto {
  // ── Campos del contrato (CreateAtraccionRequest) ──────────────────────
  @ApiProperty({ description: 'Nombre de la atracción turística', example: 'Tour al Parque Nacional Cotopaxi' })
  @IsString()
  @MinLength(3, { message: 'name debe tener al menos 3 caracteres' })
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'Descripción detallada de la atracción', example: 'Excursión guiada al volcán Cotopaxi, incluye caminata hasta el refugio.' })
  @IsString()
  @MinLength(10, { message: 'long_description debe tener al menos 10 caracteres' })
  long_description: string;

  @ApiProperty({ description: 'Duración en formato ISO 8601', example: 'PT8H' })
  @IsString()
  @Matches(/^PT(\d+H)?(\d+M)?$/, { message: 'duration debe estar en formato ISO 8601, ej. PT8H o PT1H30M' })
  duration: string;

  @ApiProperty({ description: 'Precio por adulto', type: PriceDto })
  @ValidateNested()
  @Type(() => PriceDto)
  price: PriceDto;

  @ApiProperty({ description: 'Empresa operadora del tour', type: OperatorDto })
  @ValidateNested()
  @Type(() => OperatorDto)
  operator: OperatorDto;

  @ApiProperty({ description: 'Tipo de producto', enum: ProductType, example: ProductType.GUIDED_TOUR })
  @IsEnum(ProductType, { message: 'product_type debe ser SINGLE_TICKET, GUIDED_TOUR o PACKAGE' })
  product_type: ProductType;

  @ApiProperty({ description: 'Qué incluye el tour/paquete', example: ['Transporte', 'Guía bilingüe', 'Almuerzo'] })
  @IsArray()
  @IsString({ each: true })
  includes: string[];

  @ApiProperty({ description: 'Slugs de categorías', example: ['naturaleza', 'aventura'] })
  @IsArray()
  @ArrayMinSize(1, { message: 'categories debe tener al menos una categoría' })
  @IsString({ each: true })
  categories: string[];

  @ApiProperty({ description: 'Insignias comerciales', example: ['best_seller'], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  badges?: string[];

  @ApiProperty({ description: 'Ubicaciones del tour (la primera es la principal)', type: [LocationDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'locations debe tener al menos una ubicación' })
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations: LocationDto[];

  @ApiProperty({ description: 'Fotos de la atracción', type: [PhotoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhotoDto)
  photos: PhotoDto[];

  @ApiProperty({ description: 'Idiomas soportados', example: ['es', 'en'] })
  @IsArray()
  @IsString({ each: true })
  supported_languages: string[];

  @ApiProperty({ description: 'Permite cancelación gratuita', example: true })
  @IsBoolean()
  free_cancellation: boolean;

  // ── Extensiones opcionales (no rompen el contrato) ────────────────────
  @ApiPropertyOptional({ description: 'Resumen corto para tarjetas', example: 'Camina entre páramos hasta el refugio del volcán activo más alto.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  short_description?: string;

  @ApiPropertyOptional({ description: 'Precio por niño (3-11 años)', example: 35 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  child_price?: number;

  @ApiPropertyOptional({ example: ['Propinas', 'Alquiler de equipo'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  not_includes?: string[];

  @ApiPropertyOptional({ example: ['Lleva ropa abrigada', 'Protector solar'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendations?: string[];

  @ApiPropertyOptional({ description: 'Horarios de salida', example: ['07:00', '13:00'] })
  @IsOptional()
  @IsArray()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true, message: 'times debe contener horas en formato HH:mm' })
  times?: string[];

  @ApiPropertyOptional({ description: 'Cupo máximo por horario', example: 16 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(1000)
  capacity_per_slot?: number;

  @ApiPropertyOptional({ description: 'Horas mínimas para cancelar sin costo', example: 24 })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellation_hours?: number;

  @ApiPropertyOptional({ example: 'Parque La Carolina, frente al Quicentro' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  meeting_point?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
