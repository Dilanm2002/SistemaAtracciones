import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export const IDIOMAS_SOPORTADOS = ['es', 'es-ec'];

export class DetailsRequestDto {
  @ApiProperty({ description: 'UUIDs de las atracciones (máx. 50)', example: ['123e4567-e89b-42d3-a456-426614174000'] })
  @IsArray()
  @ArrayMaxSize(50, { message: 'attractions admite como máximo 50 IDs por lote' })
  @IsUUID('4', { each: true, message: 'Cada elemento de attractions debe ser un UUID' })
  attractions: string[];

  @ApiProperty({
    description: 'Idiomas solicitados. El catálogo está disponible solo en español (es); otros valores se rechazan con 400.',
    example: ['es'],
    required: false,
  })
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(5)
  @IsIn(IDIOMAS_SOPORTADOS, { each: true, message: `languages solo admite: ${IDIOMAS_SOPORTADOS.join(', ')}` })
  languages?: string[];
}
