import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Rol } from '../../../common/auth/scopes';

const trim = ({ value }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
  @ApiProperty({ example: 'María Guamán' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'nombre debe tener al menos 3 caracteres' })
  @MaxLength(120)
  nombre: string;

  @ApiProperty({ example: 'maria@correo.com' })
  @Transform(lower)
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  email: string;

  @ApiProperty({ example: 'Clave123', description: 'Mínimo 8 caracteres, con al menos una letra y un número' })
  @IsString()
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password debe incluir al menos una letra y un número' })
  password: string;

  @ApiPropertyOptional({ example: '0991234567' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?\d{7,15}$/, { message: 'telefono debe tener entre 7 y 15 dígitos' })
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
  password: string;
}

export class UpdatePerfilDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'nombre debe tener al menos 3 caracteres' })
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?\d{7,15}$/, { message: 'telefono debe tener entre 7 y 15 dígitos' })
  telefono?: string;

  @ApiPropertyOptional({ description: 'Cédula o pasaporte' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  documento?: string;
}

export class CambiarPasswordDto {
  @ApiProperty()
  @IsString()
  actual: string;

  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'nueva debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'nueva debe incluir al menos una letra y un número' })
  nueva: string;
}

export class CreateUsuarioDto extends RegisterDto {
  @ApiProperty({ enum: Rol, example: Rol.OPERADOR })
  @IsEnum(Rol, { message: 'rol debe ser ADMIN, OPERADOR o CLIENTE' })
  rol: Rol;
}

export class UpdateUsuarioDto extends PartialType(CreateUsuarioDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UsuariosQueryDto {
  @ApiPropertyOptional({ enum: Rol })
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @ApiPropertyOptional({ description: 'Busca por nombre o email' })
  @IsOptional()
  @IsString()
  q?: string;
}
