import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { AuthService } from './auth.service';
import { CambiarPasswordDto, CreateUsuarioDto, LoginDto, RegisterDto, UpdatePerfilDto, UpdateUsuarioDto, UsuariosQueryDto } from './dto/auth.dto';

@ApiTags('Identidad - Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Registrar una cuenta de cliente' })
  @ApiResponse({ status: 201, description: 'Cuenta creada. Devuelve el token de acceso.' })
  @ApiResponse({ status: 409, description: 'El correo ya está registrado.' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión (emite un JWT con los scopes OAuth2 del rol)' })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas.' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar datos del perfil' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdatePerfilDto) {
    return this.auth.updatePerfil(user.sub, dto);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar contraseña' })
  cambiarPassword(@CurrentUser() user: AuthUser, @Body() dto: CambiarPasswordDto) {
    return this.auth.cambiarPassword(user.sub, dto);
  }
}

@ApiTags('Identidad - Usuarios (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Scopes(SCOPES.ADMIN)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios (filtrar por rol o texto)' })
  list(@Query() query: UsuariosQueryDto) {
    return this.auth.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Crear usuario de personal (admin/operador) o cliente' })
  create(@Body() dto: CreateUsuarioDto) {
    return this.auth.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar usuario (rol, estado, datos)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUsuarioDto, @CurrentUser() user: AuthUser) {
    return this.auth.update(id, dto, user.sub);
  }
}
