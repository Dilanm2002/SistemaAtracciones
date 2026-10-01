import { verificarPruebaDpop } from '../../common/auth/dpop';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser, SCOPES } from '../../common/auth/scopes';
import { AuthService } from './auth.service';
import { CambiarPasswordDto, CreateUsuarioDto, LoginDto, RegisterDto, UpdatePerfilDto, UpdateUsuarioDto, UsuariosQueryDto } from './dto/auth.dto';

/** Datos de la petición para la sesión; con cabecera DPoP, el token se liga a esa llave (WEB-008). */
const contexto = (req: Request) => {
  const prueba = req.header('dpop');
  const jkt = prueba ? verificarPruebaDpop(prueba, req.method, req.originalUrl.split('?')[0]).jkt : undefined;
  return { ip: req.ip, userAgent: req.header('user-agent'), jkt };
};

@ApiTags('Identidad - Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } }) // 5 cuentas por hora e IP
  @ApiOperation({ summary: 'Registrar una cuenta de cliente' })
  @ApiResponse({ status: 201, description: 'Cuenta creada. Devuelve el token de acceso.' })
  @ApiResponse({ status: 409, description: 'El correo ya está registrado.' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, contexto(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 intentos por minuto e IP (anti fuerza bruta)
  @ApiResponse({ status: 429, description: 'Demasiados intentos. Espera un minuto.' })
  @ApiOperation({ summary: 'Iniciar sesión (emite un JWT con los scopes OAuth2 del rol)' })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas.' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, contexto(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión (revoca el token en la tabla sesion)' })
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar contraseña' })
  cambiarPassword(@CurrentUser() user: AuthUser, @Body() dto: CambiarPasswordDto) {
    return this.auth.cambiarPassword(user, dto);
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
  @ApiOperation({ summary: 'Listar usuarios (paginado: page/limit; total en la cabecera X-Total-Count)' })
  async list(@Query() query: UsuariosQueryDto, @Res({ passthrough: true }) res: Response) {
    const { rows, total } = await this.auth.list(query);
    res.setHeader('X-Total-Count', String(total));
    return rows;
  }

  @Post()
  @ApiOperation({ summary: 'Crear usuario de personal (admin/operador) o cliente' })
  create(@Body() dto: CreateUsuarioDto, @CurrentUser() user: AuthUser) {
    return this.auth.create(dto, user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar usuario (rol, estado, datos)' })
  update(@Param('id', ParseIdPipe) id: string, @Body() dto: UpdateUsuarioDto, @CurrentUser() user: AuthUser) {
    return this.auth.update(id, dto, user.sub);
  }
}
