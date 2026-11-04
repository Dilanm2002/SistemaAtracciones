import { Module } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { CuponClient, InventarioClient, LocationClient } from './clientes';
import { JwtGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { BookingCatalogoController, CatalogoController } from './controladores';

@Module({
  controllers: [BookingCatalogoController, CatalogoController, SaludController],
  providers: [DbService, CatalogoService, LocationClient, InventarioClient, CuponClient, JwtGuard, { provide: NOMBRE_SERVICIO, useValue: 'ms-catalog' }],
})
export class AppModule {}
