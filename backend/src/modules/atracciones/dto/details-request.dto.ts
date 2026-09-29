import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class DetailsRequestDto {
  @ApiProperty({ description: 'Array de IDs de atracciones', example: ['PRahAzWtTraa'] })
  @IsArray()
  @IsString({ each: true })
  attractions: string[];

  @ApiProperty({ description: 'Idiomas solicitados', example: ['en-gb'], required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  languages?: string[];
}
