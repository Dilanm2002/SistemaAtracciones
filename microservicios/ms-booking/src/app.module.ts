import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AliasV2Middleware } from './alias.middleware';
import { AvisoCheckin } from './aviso-checkin';
import { CatalogoClient, IdentidadClient, FacturacionClient, InventarioClient, OrdenClient, PagoClient, PricingClient, ReembolsoClient } from './clientes';
import { DbService } from './comun/db.service';
import { NOMBRE_SERVICIO, SaludController } from './comun/salud.controller';
import { ReservasBaseController, ReservasBookingController, ReservasPropiasController } from './controladores';
import { EventosService } from './eventos';
import { Idempotencia } from './idempotencia';
import { ReservaGrpc, ReservasService } from './reservas';
import { ReservasWebController } from './web.controller';

@Module({
  controllers: [ReservasBookingController, ReservasBaseController, ReservasPropiasController, ReservasWebController, SaludController],
  providers: [
    DbService, Idempotencia, EventosService, ReservasService, ReservaGrpc, AvisoCheckin,
    CatalogoClient, IdentidadClient, PricingClient, InventarioClient, OrdenClient, PagoClient, ReembolsoClient, FacturacionClient,
    { provide: NOMBRE_SERVICIO, useValue: 'ms-booking' },
  ],
})
export class AppModule implements NestModule {
  /** Alias del contrato (v2 en español, v3 en inglés, guía de socios) antes de validar, como en la tienda. */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AliasV2Middleware).forRoutes(ReservasBookingController, ReservasBaseController);
  }
}
