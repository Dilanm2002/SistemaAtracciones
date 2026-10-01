import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PriceDto, LocationDto, PhotoDto, OperatorDto, PRECIO_MAX } from './nested-types.dto';
import { Transform } from 'class-transformer';
import { ContieneLetras, SinNumerosLargos } from '../../../common/utils/validators';
import { trim } from '../../../common/utils/transform';

const trimLista = ({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((x) => (typeof x === 'string' ? x.trim() : x)) : value);

/** Duración ISO 8601 mayor a 0 y de máximo 30 días (720 h). */
@ValidatorConstraint({ name: 'duracionRazonable' })
export class DuracionRazonable implements ValidatorConstraintInterface {
  validate(v: string) {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(v ?? '');
    if (!m) return false;
    const horas = Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
    return horas > 0 && horas <= 720 && Number(m[2] ?? 0) < 60;
  }
  defaultMessage() {
    return 'duration debe ser mayor a 0 y de máximo 30 días (PT720H); los minutos deben ser menores a 60';
  }
}

export enum ProductType {
  SINGLE_TICKET = 'SINGLE_TICKET',
  GUIDED_TOUR = 'GUIDED_TOUR',
  PACKAGE = 'PACKAGE',
}

export class CreateAtraccionDto {
  // ── Campos del contrato (CreateAtraccionRequest) ──────────────────────
  @ApiProperty({ description: 'Nombre de la atracción turística', example: 'Tour al Parque Nacional Cotopaxi' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'name debe tener al menos 3 caracteres' })
  @MaxLength(200)
  @ContieneLetras()
  @SinNumerosLargos(4)
  name: string;

  @ApiProperty({ description: 'Descripción detallada de la atracción', example: 'Excursión guiada al volcán Cotopaxi, incluye caminata hasta el refugio.' })
  @Transform(trim)
  @IsString()
  @MinLength(20, { message: 'long_description debe tener al menos 20 caracteres' })
  @MaxLength(5000, { message: 'long_description puede tener hasta 5000 caracteres' })
  @ContieneLetras()
  long_description: string;

  @ApiProperty({ description: 'Duración en formato ISO 8601', example: 'PT8H' })
  @IsString()
  @Matches(/^PT(\d{1,3}H)?(\d{1,2}M)?$/, { message: 'duration debe estar en formato ISO 8601, ej. PT8H o PT1H30M' })
  @Validate(DuracionRazonable)
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
  @Transform(trimLista)
  @IsArray()
  @ArrayMinSize(1, { message: 'includes debe tener al menos un elemento' })
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(2, { each: true, message: 'cada elemento de includes debe tener al menos 2 caracteres' })
  @MaxLength(150, { each: true, message: 'cada elemento de includes puede tener hasta 150 caracteres' })
  @ContieneLetras({ message: 'cada elemento de includes debe ser texto legible (principalmente letras)' })
  @SinNumerosLargos(4, { message: 'cada elemento de includes puede tener como máximo 4 dígitos seguidos' })
  includes: string[];

  @ApiProperty({ description: 'Slugs de categorías', example: ['naturaleza', 'aventura'] })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayMinSize(1, { message: 'categories debe tener al menos una categoría' })
  @IsString({ each: true })
  @Matches(/^[a-z0-9-]{1,80}$/, { each: true, message: 'categories debe contener slugs de categoría' })
  categories: string[];

  @ApiProperty({ description: 'Se acepta por compatibilidad con el contrato pero se ignora: las insignias se calculan (ventas, ocupación, antigüedad)', example: ['best_seller'], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  badges?: string[];

  @ApiProperty({ description: 'Ubicación del tour (exactamente una)', type: [LocationDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'locations debe tener al menos una ubicación' })
  @ArrayMaxSize(1, { message: 'Por ahora cada atracción admite una sola ubicación' })
  @ValidateNested({ each: true })
  @Type(() => LocationDto)
  locations: LocationDto[];

  @ApiProperty({ description: 'Fotos de la atracción', type: [PhotoDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'photos debe tener al menos una foto (la portada)' })
  @ArrayMaxSize(12, { message: 'photos admite como máximo 12 fotos' })
  @ValidateNested({ each: true })
  @Type(() => PhotoDto)
  photos: PhotoDto[];

  @ApiProperty({ description: 'Idiomas soportados', example: ['es', 'en'] })
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayMinSize(1, { message: 'supported_languages debe tener al menos un idioma' })
  @Matches(/^[a-z]{2}$/, { each: true, message: 'supported_languages debe contener códigos ISO 639-1 (ej. es, en)' })
  supported_languages: string[];

  @ApiProperty({ description: 'Permite cancelación gratuita', example: true })
  @IsBoolean()
  free_cancellation: boolean;

  // ── Extensiones opcionales (no rompen el contrato) ────────────────────
  @ApiPropertyOptional({ description: 'Resumen corto para tarjetas', example: 'Camina entre páramos hasta el refugio del volcán activo más alto.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(280)
  @ValidateIf((o: { short_description?: string }) => !!o.short_description)
  @MinLength(10, { message: 'short_description debe tener al menos 10 caracteres' })
  @ContieneLetras()
  @SinNumerosLargos(4)
  short_description?: string;

  @ApiPropertyOptional({ description: 'Precio por niño (3-11 años)', example: 35 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'child_price debe ser un número con máximo 2 decimales' })
  @Min(0)
  @Max(PRECIO_MAX, { message: `child_price no puede superar ${PRECIO_MAX}` })
  child_price?: number;

  @ApiPropertyOptional({ example: ['Propinas', 'Alquiler de equipo'] })
  @IsOptional()
  @IsArray()
  @Transform(trimLista)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(2, { each: true, message: 'cada elemento de not_includes debe tener al menos 2 caracteres' })
  @MaxLength(150, { each: true, message: 'cada elemento de not_includes puede tener hasta 150 caracteres' })
  @ContieneLetras({ message: 'cada elemento de not_includes debe ser texto legible (principalmente letras)' })
  @SinNumerosLargos(4, { message: 'cada elemento de not_includes puede tener como máximo 4 dígitos seguidos' })
  not_includes?: string[];

  @ApiPropertyOptional({ example: ['Lleva ropa abrigada', 'Protector solar'] })
  @IsOptional()
  @IsArray()
  @Transform(trimLista)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(3, { each: true, message: 'cada recomendación debe tener al menos 3 caracteres' })
  @MaxLength(150, { each: true, message: 'cada recomendación puede tener hasta 150 caracteres' })
  @ContieneLetras({ message: 'cada recomendación debe ser texto legible (principalmente letras)' })
  @SinNumerosLargos(4, { message: 'cada recomendación puede tener como máximo 4 dígitos seguidos' })
  recommendations?: string[];

  @ApiPropertyOptional({ description: 'Horarios de salida', example: ['07:00', '13:00'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'times debe tener al menos un horario' })
  @ArrayMaxSize(24)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true, message: 'times debe contener horas en formato HH:mm' })
  times?: string[];

  @ApiPropertyOptional({ description: 'Cupo máximo por horario', example: 16 })
  @IsOptional()
  @IsInt({ message: 'capacity_per_slot debe ser un número entero' })
  @IsPositive()
  @Max(500, { message: 'capacity_per_slot no puede superar 500 personas por salida' })
  capacity_per_slot?: number;

  @ApiPropertyOptional({ description: 'Horas mínimas para cancelar sin costo', example: 24 })
  @IsOptional()
  @IsInt({ message: 'cancellation_hours debe ser un número entero' })
  @Min(0)
  @Max(720, { message: 'cancellation_hours no puede superar 720 (30 días)' })
  cancellation_hours?: number;

  @ApiPropertyOptional({ example: 'Parque La Carolina, frente al Quicentro' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  @ValidateIf((o: { meeting_point?: string }) => !!o.meeting_point)
  @MinLength(5, { message: 'meeting_point debe tener al menos 5 caracteres' })
  @ContieneLetras()
  @SinNumerosLargos(5)
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

/** Decisión del administrador sobre una experiencia que subió una empresa (EN_REVISION). */
export class RevisionAtraccionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], description: 'APPROVE la publica; REJECT la devuelve a la empresa con el motivo' })
  @IsIn(['APPROVE', 'REJECT'], { message: 'decision debe ser APPROVE o REJECT' })
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ description: 'Obligatorio al rechazar: qué debe corregir la empresa', example: 'Las fotos no corresponden al lugar; sube fotos propias del tour.' })
  @ValidateIf((o: { decision?: string }) => o.decision === 'REJECT')
  @Transform(trim)
  @IsString({ message: 'reason es obligatorio al rechazar' })
  @MinLength(10, { message: 'reason debe explicar el motivo (mínimo 10 caracteres)' })
  @MaxLength(500)
  @ContieneLetras()
  reason?: string;
}
