import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsPositive, Min, IsLatitude, IsLongitude, ValidateNested, IsOptional, IsInt, Max, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class PriceDto {
  @ApiProperty({ description: 'Código de moneda ISO 4217', example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ description: 'Monto total', example: 45.0 })
  @IsNumber()
  @IsPositive({ message: 'price.total debe ser mayor a 0' })
  total: number;
}

export class PhotoDto {
  @ApiProperty({ description: 'URL de la foto', example: 'http://localhost:3000/img/cotopaxi.jpg' })
  @IsString()
  url: string;
}

export class CoordinatesDto {
  @ApiProperty({ description: 'Latitud', example: -0.680556 })
  @IsLatitude()
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Longitud', example: -78.437778 })
  @IsLongitude()
  @IsNumber()
  longitude: number;
}

export class LocationDto {
  @ApiProperty({ description: 'Dirección física', example: 'Parque Nacional Cotopaxi, control Caspi' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'ID numérico de la ciudad/destino', example: 8 })
  @IsInt()
  city: number;

  @ApiProperty({ description: 'Código ISO de país', example: 'ec' })
  @IsString()
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
