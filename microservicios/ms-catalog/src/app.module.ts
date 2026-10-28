import { Module } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { LocationClient, TiendaClient } from './clientes';
import { JwtGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { BookingCatalogoController, CatalogoController } from './controladores';

@Module({
  controllers: [BookingCatalogoController, CatalogoController, SaludController],
  providers: [DbService, CatalogoService, LocationClient, TiendaClient, JwtGuard, { provide: NOMBRE_SERVICIO, useValue: 'ms-catalog' }],
})
export class AppModule {}
