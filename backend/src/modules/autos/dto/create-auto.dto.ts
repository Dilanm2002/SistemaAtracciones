import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateAutoDto {
  @ApiProperty({ description: 'Marca del auto', example: 'Toyota' })
  @IsString()
  @MinLength(2)
  marca: string;

  @ApiProperty({ description: 'Modelo del auto', example: 'Corolla' })
  @IsString()
  @MinLength(2)
  modelo: string;

  @ApiProperty({ description: 'Categoría del vehículo', example: 'Sedan', enum: ['SUV', 'Sedan', 'Compacto'] })
  @IsString()
  @IsIn(['SUV', 'Sedan', 'Compacto'])
  tipo: string;

  @ApiProperty({ description: 'Ciudad donde se recogerá el auto', example: 'Ciudad de México' })
  @IsString()
  @MinLength(3)
  ciudadRecogida: string;

  @ApiProperty({ description: 'Precio de renta por día', example: 45.99 })
  @IsNumber()
  @IsPositive()
  precioPorDia: number;

  @ApiProperty({ description: 'Tipo de transmisión', example: 'Automatica', enum: ['Manual', 'Automatica'] })
  @IsString()
  @IsIn(['Manual', 'Automatica'])
  transmision: string;
}
