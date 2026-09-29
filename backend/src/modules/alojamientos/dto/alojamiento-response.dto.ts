import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from '../../../common/dto/base-response.dto';

export class AlojamientoResponseDto extends BaseResponseDto {
  @ApiProperty({ description: 'UUID único del alojamiento', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ description: 'Nombre del alojamiento', example: 'Resort Las Palmas' })
  nombre: string;

  @ApiProperty({ description: 'Destino o ciudad', example: 'Cancún' })
  destino: string;

  @ApiProperty({ description: 'Precio por noche', example: 120.50 })
  precioPorNoche: number;

  @ApiProperty({ description: 'Capacidad de adultos', example: 2 })
  capacidadAdultos: number;

  @ApiProperty({ description: 'Capacidad de niños', example: 1 })
  capacidadNinos: number;

  @ApiProperty({ description: 'Número de habitaciones', example: 1 })
  habitaciones: number;

  @ApiProperty({ description: 'Disponibilidad de piscina', example: true })
  tienePiscina: boolean;
}
