import { Module } from '@nestjs/common';
import { VuelosService } from './vuelos.service';
import { VuelosController } from './vuelos.controller';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [VuelosController],
  providers: [VuelosService],
})
export class VuelosModule {}
