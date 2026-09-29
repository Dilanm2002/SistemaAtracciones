import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Solo con attractions:write → active | inactive | all', enum: ['active', 'inactive', 'all'] })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';

  @ApiPropertyOptional({ description: 'Solo destacadas', enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  featured?: string;
}
