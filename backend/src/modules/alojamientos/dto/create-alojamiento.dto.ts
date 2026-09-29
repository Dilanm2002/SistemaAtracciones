import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class CreateAlojamientoDto {
  @ApiProperty({ description: 'Nombre del alojamiento', example: 'Resort Las Palmas' })
  @IsString()
  @MinLength(3)
  nombre: string;

  @ApiProperty({ description: 'Destino o ciudad', example: 'Cancún' })
  @IsString()
  @MinLength(3)
  destino: string;

  @ApiProperty({ description: 'Precio por noche', example: 120.50 })
  @IsNumber()
  @IsPositive()
  precioPorNoche: number;

  @ApiProperty({ description: 'Capacidad de adultos permitida', example: 2 })
  @IsInt()
  @Min(1)
  capacidadAdultos: number;

  @ApiProperty({ description: 'Capacidad de niños permitida', example: 1 })
  @IsInt()
  @Min(0)
  capacidadNinos: number;

  @ApiProperty({ description: 'Número de habitaciones del alojamiento', example: 1 })
  @IsInt()
  @Min(1)
  habitaciones: number;

  @ApiProperty({ description: 'Indica si el alojamiento tiene piscina', example: true })
  @IsBoolean()
  tienePiscina: boolean;
}
