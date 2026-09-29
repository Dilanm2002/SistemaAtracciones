import { Module } from '@nestjs/common';
import { AlojamientosService } from './alojamientos.service';
import { AlojamientosController } from './alojamientos.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { CommonModule } from '../../common/common.module';

@Module({
  // Descomentar cuando se configure TypeORM globalmente y se instale pg:
  // imports: [TypeOrmModule.forFeature([Alojamiento]), CommonModule],
  imports: [CommonModule],
  controllers: [AlojamientosController],
  providers: [AlojamientosService],
})
export class AlojamientosModule {}
