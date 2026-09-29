import { ApiProperty } from '@nestjs/swagger';
import { AtraccionResponseDto } from './atraccion-response.dto';

export class SearchMetadataDto {
  @ApiProperty({ description: 'Total de resultados encontrados', example: 128 })
  total_results: number;

  @ApiProperty({ description: 'Token opaco para obtener la siguiente página', example: 'eyJwYWdlIjoyfQ==', required: false })
  next_page?: string;
}

export class SearchAtraccionesResponseDto {
  @ApiProperty({ description: 'Arreglo de atracciones', type: [AtraccionResponseDto] })
  data: AtraccionResponseDto[];

  @ApiProperty({ description: 'Metadatos de la búsqueda', type: SearchMetadataDto })
  metadata: SearchMetadataDto;

  @ApiProperty({ description: 'ID de la petición para trazabilidad', example: '01fr9ez700exycb98w90w5r9sh' })
  request_id: string;
}
