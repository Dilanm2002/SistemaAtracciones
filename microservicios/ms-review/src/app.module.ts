import { Module } from '@nestjs/common';
import { JwtGuard } from './comun/auth';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { CatalogClient, DespachadorEventos, ResenasController, ResenasService } from './resenas';

@Module({
  controllers: [ResenasController, SaludController],
  providers: [DbService, ResenasService, CatalogClient, DespachadorEventos, JwtGuard, { provide: NOMBRE_SERVICIO, useValue: 'ms-review' }],
})
export class AppModule {}
