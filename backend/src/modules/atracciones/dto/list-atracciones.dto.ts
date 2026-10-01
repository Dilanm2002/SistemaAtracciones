import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Paginación tradicional del listado. Acepta `page`/`limit` (plantilla)
 * y también `offset` (contrato OpenAPI); si llega `offset` tiene prioridad.
 */
export class ListAtraccionesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Desplazamiento (alternativa a page)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Busca por nombre o ciudad' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Slug de categoría' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Código de destino' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  city?: number;

  @ApiPropertyOptional({ description: 'Código de la empresa operadora', example: 101 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  operator?: number;

  @ApiPropertyOptional({
    description: 'Solo con attractions:write (el operador ve únicamente su empresa): active | inactive | review (en revisión) | rejected | all',
    enum: ['active', 'inactive', 'review', 'rejected', 'all'],
  })
  @IsOptional()
  @IsIn(['active', 'inactive', 'review', 'rejected', 'all'])
  status?: 'active' | 'inactive' | 'review' | 'rejected' | 'all';

  @ApiPropertyOptional({ description: 'Solo destacadas', enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  featured?: string;
}
