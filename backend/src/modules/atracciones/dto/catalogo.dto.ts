import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trim } from '../../../common/utils/transform';

const vacioANull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

// ── Categorías (jerárquicas: cat_padre_id) ────────────────────────────
export class CreateCategoriaDto {
  @ApiProperty({ example: 'Aventura' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres' })
  @MaxLength(80)
  nombre: string;

  @ApiPropertyOptional({ example: 'aventura', description: 'Si se omite se genera desde el nombre' })
  @IsOptional()
  @MaxLength(80)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug solo admite minúsculas, números y guiones' })
  slug?: string;

  @ApiPropertyOptional({ example: 'mountain', description: 'Nombre de ícono lucide' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32767)
  orden?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @ApiPropertyOptional({ description: 'Categoría padre (null = de primer nivel)', nullable: true })
  @IsOptional()
  @IsInt()
  padre_id?: number | null;
}
export class UpdateCategoriaDto extends PartialType(CreateCategoriaDto) {}

// ── Destinos (tabla ciudad) ─────────────────────────────────────────────
export class CreateDestinoDto {
  @ApiProperty({ example: 'Loja' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre: string;

  @ApiProperty({ example: 12, description: 'prov_id de la provincia' })
  @IsInt()
  @Min(1)
  provincia_id: number;

  @ApiProperty({ example: '110150', description: 'Código INEC de 6 dígitos' })
  @Matches(/^\d{6}$/, { message: 'codigo_inec debe tener 6 dígitos' })
  codigo_inec: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(vacioANull)
  @IsString()
  @MaxLength(500)
  descripcion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(vacioANull)
  @IsString()
  @MaxLength(500)
  imagen?: string | null;

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
  @MaxLength(150)
  nombre: string;

  @ApiProperty({ example: 9, description: 'prov_id de la provincia de la sede' })
  @IsInt()
  @Min(1)
  provincia_id: number;

  @ApiPropertyOptional({ example: '1790012345001' })
  @IsOptional()
  @Transform(vacioANull)
  @Matches(/^\d{13}$/, { message: 'ruc debe tener 13 dígitos' })
  ruc?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(vacioANull)
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(vacioANull)
  @Matches(/^\+?\d{7,15}$/, { message: 'telefono debe tener entre 7 y 15 dígitos' })
  telefono?: string | null;

  @ApiPropertyOptional({ example: 'Av. Charles Darwin y Tomás de Berlanga, Puerto Ayora' })
  @IsOptional()
  @Transform(vacioANull)
  @IsString()
  @MaxLength(255)
  direccion?: string | null;

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
