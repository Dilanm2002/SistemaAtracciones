import { Module } from '@nestjs/common';
import { ClientesBookingController, ClientesInternoController, ClientesPanelController, ClientesService } from './clientes';
import { JwtGuard, ServicioGuard, SocioGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';

@Module({
  controllers: [ClientesBookingController, ClientesPanelController, ClientesInternoController, SaludController],
  providers: [DbService, ClientesService, JwtGuard, SocioGuard, ServicioGuard, { provide: NOMBRE_SERVICIO, useValue: 'ms-identity' }],
})
export class AppModule {}
