import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from '../../../common/dto/base-response.dto';

export class AutoResponseDto extends BaseResponseDto {
  @ApiProperty({ description: 'UUID único del auto', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ description: 'Marca del auto', example: 'Toyota' })
  marca: string;

  @ApiProperty({ description: 'Modelo del auto', example: 'Corolla' })
  modelo: string;

  @ApiProperty({ description: 'Categoría del vehículo', example: 'Sedan' })
  tipo: string;

  @ApiProperty({ description: 'Ciudad donde se recogerá el auto', example: 'Ciudad de México' })
  ciudadRecogida: string;

  @ApiProperty({ description: 'Precio de renta por día', example: 45.99 })
  precioPorDia: number;

  @ApiProperty({ description: 'Tipo de transmisión', example: 'Automatica' })
  transmision: string;
}
