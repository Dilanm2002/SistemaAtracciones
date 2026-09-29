import { Module } from '@nestjs/common';
import { AuthController, UsuariosController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Dominio de Identidad (tablas usuario, rol, usuario_rol, sesion). En la migración a
 * microservicios este módulo se reemplaza por el Authorization Server OAuth2 del
 * API Gateway; el resto de módulos solo depende del JWT (sub + scope).
 */
@Module({
  controllers: [AuthController, UsuariosController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
