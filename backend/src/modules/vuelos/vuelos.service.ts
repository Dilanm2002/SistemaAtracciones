import { Injectable } from '@nestjs/common';
import { CreateVueloDto } from './dto/create-vuelo.dto';

@Injectable()
export class VuelosService {
  create(createVueloDto: CreateVueloDto): any {
    return {};
  }

  findAll(): any[] {
    return [];
  }

  findOne(id: string): any {
    return null;
  }
}
