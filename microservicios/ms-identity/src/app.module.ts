import { Module } from '@nestjs/common';
import { ClientesBookingController, ClientesPanelController, ClientesService } from './clientes';
import { JwtGuard, SocioGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';

@Module({
  controllers: [ClientesBookingController, ClientesPanelController, SaludController],
  providers: [DbService, ClientesService, JwtGuard, SocioGuard, { provide: NOMBRE_SERVICIO, useValue: 'ms-identity' }],
})
export class AppModule {}
