import { Module } from '@nestjs/common';
import { AutosService } from './autos.service';
import { AutosController } from './autos.controller';
import { CommonModule } from '../../common/common.module';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { Auto } from './entities/auto.entity';

@Module({
  // imports: [TypeOrmModule.forFeature([Auto]), CommonModule],
  imports: [CommonModule],
  controllers: [AutosController],
  providers: [AutosService],
})
export class AutosModule {}
