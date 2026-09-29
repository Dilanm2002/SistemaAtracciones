import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Rol } from '../../../common/auth/scopes';
import { trim, lower } from '../../../common/utils/transform';
import { EsDocumentoEc, RE_NOMBRE_PERSONA } from '../../../common/utils/validators';

/** Mismas reglas que los dominios de la base (dom_correo, dom_telefono, dom_documento). */
export const RE_CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const RE_TELEFONO = /^\+?\d{7,15}$/;
export const RE_DOCUMENTO = /^(\d{10}|[A-Z]{1,2}\d{6,9})$/;

export class RegisterDto {
  @ApiProperty({ example: 'María' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres' })
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'nombre debe contener solo letras' })
  nombre: string;

  @ApiProperty({ example: 'Guamán' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'apellido debe tener al menos 2 caracteres' })
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'apellido debe contener solo letras' })
  apellido: string;

  @ApiProperty({ example: 'maria@correo.com' })
  @Transform(lower)
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  @Matches(RE_CORREO, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
  email: string;

  @ApiProperty({ example: 'Clave123', description: 'Mínimo 8 caracteres, con al menos una letra y un número' })
  @IsString()
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'password no puede superar 72 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password debe incluir al menos una letra y un número' })
  password: string;

  @ApiPropertyOptional({ example: '0991234567' })
  @IsOptional()
  @Transform(trim)
  @Matches(RE_TELEFONO, { message: 'telefono debe tener entre 7 y 15 dígitos' })
  telefono?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@descubre-ec.com' })
  @Transform(lower)
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  email: string;

  @ApiProperty({ example: 'Admin123' })
  @IsString()
  @MinLength(1, { message: 'password es obligatorio' })
  @MaxLength(200)
  password: string;
}

export class UpdatePerfilDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres' })
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'nombre debe contener solo letras' })
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'apellido debe tener al menos 2 caracteres' })
  @MaxLength(120)
  @Matches(RE_NOMBRE_PERSONA, { message: 'apellido debe contener solo letras' })
  apellido?: string;

  @ApiPropertyOptional({ description: 'Vacío para quitarlo' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^(|\+?\d{7,15})$/, { message: 'telefono debe tener entre 7 y 15 dígitos' })
  telefono?: string;

  @ApiPropertyOptional({ description: 'Cédula (10 dígitos) o pasaporte (1-2 letras y 6-9 dígitos). Vacío para quitarlo' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @EsDocumentoEc({ message: 'documento debe ser una cédula ecuatoriana válida o un pasaporte (1-2 letras y 6-9 dígitos)' })
  documento?: string;
}

export class CambiarPasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  actual: string;

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'nueva debe tener al menos 8 caracteres' })
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'nueva debe incluir al menos una letra y un número' })
  nueva: string;
}

export class CreateUsuarioDto extends RegisterDto {
  @ApiProperty({ enum: Rol, example: Rol.OPERADOR })
  @IsEnum(Rol, { message: 'rol debe ser ADMIN, OPERADOR o CLIENTE' })
  rol: Rol;

  @ApiPropertyOptional({ description: 'Código de la empresa operadora (obligatorio para rol OPERADOR)', example: 101 })
  @IsOptional()
  @IsInt({ message: 'operadorCodigo debe ser un número entero' })
  @Min(1)
  operadorCodigo?: number | null;
}

export class UpdateUsuarioDto extends PartialType(OmitType(CreateUsuarioDto, ['password'] as const)) {
  @ApiPropertyOptional({ description: 'Nueva contraseña (opcional)' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password debe incluir al menos una letra y un número' })
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UsuariosQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ enum: Rol })
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @ApiPropertyOptional({ description: 'Busca por nombre, apellido o email' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
