import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ContieneLetras } from '../../../common/utils/validators';

export class CreateResenaDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1, { message: 'rating debe estar entre 1 y 5' })
  @Max(5, { message: 'rating debe estar entre 1 y 5' })
  rating: number;

  @ApiProperty({ example: 'Guía excelente y paisajes increíbles.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'comment debe tener al menos 10 caracteres' })
  @MaxLength(1000)
  @ContieneLetras({ message: 'comment debe contener tu opinión con texto' })
  comment: string;
}

export class ModerarResenaDto {
  @ApiProperty()
  @IsBoolean()
  visible: boolean;
}

export class ResenasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['visible', 'hidden', 'all'] })
  @IsOptional()
  @IsIn(['visible', 'hidden', 'all'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
