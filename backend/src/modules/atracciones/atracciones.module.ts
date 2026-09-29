import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { AtraccionMapper } from './atraccion.mapper';
import { AtraccionesController } from './atracciones.controller';
import { AtraccionesService } from './atracciones.service';
import { AdminAtraccionesController, CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { Atraccion } from './entities/atraccion.entity';
import { Categoria } from './entities/categoria.entity';
import { Destino } from './entities/destino.entity';
import { FechaBloqueada } from './entities/fecha-bloqueada.entity';
import { Operador } from './entities/operador.entity';
import { Resena } from './entities/resena.entity';
import { Reserva } from './entities/reserva.entity';
import { ReportesService } from './reportes.service';
import { ResenasService } from './resenas.service';
import { ReservasService } from './reservas.service';

@Module({
  imports: [CommonModule, TypeOrmModule.forFeature([Atraccion, Categoria, Destino, Operador, Reserva, Resena, FechaBloqueada])],
  controllers: [AtraccionesController, CatalogoController, AdminAtraccionesController],
  providers: [AtraccionesService, ReservasService, ResenasService, CatalogoService, ReportesService, AtraccionMapper],
  exports: [TypeOrmModule],
})
export class AtraccionesModule {}
