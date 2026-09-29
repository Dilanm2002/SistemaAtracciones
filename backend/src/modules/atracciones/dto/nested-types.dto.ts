import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsPositive, Min, IsLatitude, IsLongitude, ValidateNested, IsOptional, IsInt, Max, Length, Matches, MaxLength, MinLength, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ContieneLetras, ECUADOR, SinNumerosLargos } from '../../../common/utils/validators';
import { trim } from '../../../common/utils/transform';

/** Precio máximo por persona aceptado en el catálogo (USD). */
export const PRECIO_MAX = 10000;

export class PriceDto {
  @ApiProperty({ description: 'Código de moneda ISO 4217', example: 'USD' })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 en mayúsculas (ej. USD)' })
  currency: string;

  @ApiProperty({ description: 'Monto total (máx. 10 000, 2 decimales)', example: 45.0 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price.total debe ser un número con máximo 2 decimales' })
  @IsPositive({ message: 'price.total debe ser mayor a 0' })
  @Max(PRECIO_MAX, { message: `price.total no puede superar ${PRECIO_MAX}` })
  total: number;
}

export class PhotoDto {
  @ApiProperty({ description: 'URL de la foto (http/https o ruta propia /img/… /uploads/…)', example: 'http://localhost:3000/img/cotopaxi.jpg' })
  @IsString()
  @MaxLength(500)
  @Matches(/^(https?:\/\/[^\s"'<>]+|\/(img|uploads)\/[\w.-]+)$/i, { message: 'photos[].url debe ser una URL http(s) o una ruta /img/… o /uploads/…' })
  url: string;

  @ApiProperty({ description: 'Texto alternativo (WCAG 1.1.1)', required: false, example: 'Volcán Cotopaxi al amanecer' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @ContieneLetras()
  alt?: string;
}

export class CoordinatesDto {
  @ApiProperty({ description: 'Latitud (dentro del Ecuador, incluidas las Galápagos)', example: -0.680556 })
  @IsLatitude()
  @IsNumber()
  @Min(ECUADOR.latMin, { message: 'latitude está fuera del Ecuador' })
  @Max(ECUADOR.latMax, { message: 'latitude está fuera del Ecuador' })
  latitude: number;

  @ApiProperty({ description: 'Longitud (dentro del Ecuador, incluidas las Galápagos)', example: -78.437778 })
  @IsLongitude()
  @IsNumber()
  @Min(ECUADOR.lngMin, { message: 'longitude está fuera del Ecuador' })
  @Max(ECUADOR.lngMax, { message: 'longitude está fuera del Ecuador' })
  longitude: number;
}

export class LocationDto {
  @ApiProperty({ description: 'Dirección física', example: 'Parque Nacional Cotopaxi, control Caspi' })
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'address debe tener al menos 5 caracteres' })
  @MaxLength(255)
  @ContieneLetras()
  @SinNumerosLargos(5)
  address: string;

  @ApiProperty({ description: 'ID numérico de la ciudad/destino', example: 8 })
  @IsInt()
  @Min(1)
  city: number;

  @ApiProperty({ description: 'Código ISO de país (solo Ecuador)', example: 'ec' })
  @IsString()
  @IsIn(['ec', 'EC'], { message: 'country debe ser ec: el catálogo es del Ecuador' })
  country: string;

  @ApiProperty({ description: 'Coordenadas', type: CoordinatesDto })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @ApiProperty({ description: 'Tipo de locación', example: 'attraction', required: false })
  @IsString()
  @IsOptional()
  type?: string;
}

export class RatingDto {
  @ApiProperty({ description: 'Número de reseñas', example: 3250 })
  @IsInt()
  @Min(0)
  number_of_reviews: number;

  @ApiProperty({ description: 'Puntuación promedio', example: 4.8 })
  @IsNumber()
  @Min(0)
  @Max(5)
  score: number;
}

export class OperatorDto {
  @ApiProperty({ description: 'ID de la empresa/proveedor', example: 101 })
  @IsInt()
  id: number;

  @ApiProperty({ description: 'Nombre de la empresa operadora', example: 'Andes Explorer' })
  @IsString()
  name: string;
}

export class UrlDto {
  @ApiProperty({ description: 'URL web', example: 'http://localhost:5173/atraccion/123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  web: string;

  @ApiProperty({ description: 'URL para App (Deep Link)', example: 'descubreec://attractions/123e4567', required: false })
  @IsString()
  @IsOptional()
  app?: string;
}
