import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController, UsuariosController } from './auth.controller';
import { AuthService } from './auth.service';
import { Usuario } from './entities/usuario.entity';

/**
 * Dominio de Identidad. En la migración a microservicios este módulo se
 * reemplaza por el Authorization Server OAuth2 del API Gateway; el resto de
 * módulos solo depende del JWT (sub + scope), no de esta entidad.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [AuthController, UsuariosController],
  providers: [AuthService],
  exports: [AuthService, TypeOrmModule],
})
export class AuthModule {}
