import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { Region } from '../entities/destino.entity';

const trim = ({ value }) => (typeof value === 'string' ? value.trim() : value);

// ── Categorías ─────────────────────────────────────────────────────────
export class CreateCategoriaDto {
  @ApiProperty({ example: 'Aventura' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres' })
  @MaxLength(80)
  nombre: string;

  @ApiPropertyOptional({ example: 'aventura', description: 'Si se omite se genera desde el nombre' })
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug solo admite minúsculas, números y guiones' })
  slug?: string;

  @ApiPropertyOptional({ example: 'mountain', description: 'Nombre de ícono lucide' })
  @IsOptional()
  @IsString()
  icono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  orden?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
export class UpdateCategoriaDto extends PartialType(CreateCategoriaDto) {}

// ── Destinos ───────────────────────────────────────────────────────────
export class CreateDestinoDto {
  @ApiProperty({ example: 12, description: 'ID numérico de ciudad del contrato' })
  @IsInt()
  @Min(1)
  codigo: number;

  @ApiProperty({ example: 'Loja' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  nombre: string;

  @ApiProperty({ example: 'Loja' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  provincia: string;

  @ApiProperty({ enum: Region })
  @IsEnum(Region, { message: 'region debe ser SIERRA, COSTA, AMAZONIA o GALAPAGOS' })
  region: Region;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagen?: string;

  @ApiProperty({ example: -3.99313 })
  @IsNumber()
  @IsLatitude()
  latitud: number;

  @ApiProperty({ example: -79.20422 })
  @IsNumber()
  @IsLongitude()
  longitud: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
export class UpdateDestinoDto extends PartialType(CreateDestinoDto) {}

// ── Operadores ─────────────────────────────────────────────────────────
export class CreateOperadorDto {
  @ApiPropertyOptional({ example: 110, description: 'Si se omite se asigna el siguiente disponible' })
  @IsOptional()
  @IsInt()
  @Min(1)
  codigo?: number;

  @ApiProperty({ example: 'Galápagos Blue Tours' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  nombre: string;

  @ApiPropertyOptional({ example: '1790012345001' })
  @IsOptional()
  @Matches(/^\d{13}$/, { message: 'ruc debe tener 13 dígitos' })
  ruc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?\d{7,15}$/, { message: 'telefono debe tener entre 7 y 15 dígitos' })
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
export class UpdateOperadorDto extends PartialType(CreateOperadorDto) {}

export class CatalogoQueryDto {
  @ApiPropertyOptional({ description: 'true = incluir inactivos (requiere attractions:write)', enum: ['true', 'false'] })
  @IsOptional()
  @IsString()
  all?: string;
}
