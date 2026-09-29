import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Repository } from 'typeorm';
import { Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SCOPES } from '../../common/auth/scopes';

const trim = ({ value }) => (typeof value === 'string' ? value.trim() : value);

@Entity('mensajes')
export class Mensaje {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) nombre: string;
  @Column({ type: 'varchar', length: 160 }) email: string;
  @Column({ type: 'varchar', length: 30 }) asunto: string;
  @Column({ type: 'varchar', length: 2000 }) mensaje: string;
  @Column({ type: 'boolean', default: false }) leido: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ASUNTOS = ['RESERVA', 'CANCELACION', 'PROVEEDOR', 'SUGERENCIA', 'OTRO'] as const;

export class CreateMensajeDto {
  @ApiProperty({ example: 'Ana Torres' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'nombre debe tener al menos 3 caracteres' })
  @MaxLength(120)
  nombre: string;

  @ApiProperty({ example: 'ana@correo.com' })
  @Transform(trim)
  @IsEmail({}, { message: 'email no tiene un formato válido' })
  email: string;

  @ApiProperty({ enum: ASUNTOS })
  @IsIn(ASUNTOS as unknown as string[], { message: 'asunto no es válido' })
  asunto: string;

  @ApiProperty({ example: '¿Puedo cambiar la fecha de mi reserva?' })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'mensaje debe tener al menos 10 caracteres' })
  @MaxLength(2000)
  mensaje: string;

  @ApiPropertyOptional({ description: 'Campo trampa anti-spam: debe venir vacío' })
  @IsOptional()
  @IsString()
  website?: string;
}

export class MensajesQueryDto {
  @ApiPropertyOptional({ enum: ['unread', 'read', 'all'] })
  @IsOptional()
  @IsIn(['unread', 'read', 'all'])
  status?: string;
}

export class MarcarLeidoDto {
  @ApiProperty() @IsBoolean() leido: boolean;
}

@Injectable()
export class ContactoService {
  constructor(@InjectRepository(Mensaje) private readonly repo: Repository<Mensaje>) {}

  async create(dto: CreateMensajeDto) {
    if (dto.website) return { ok: true }; // bot detectado: fingimos éxito sin guardar
    const { website, ...data } = dto;
    await this.repo.save(this.repo.create(data));
    return { ok: true };
  }

  list(q: MensajesQueryDto) {
    const where = q.status === 'unread' ? { leido: false } : q.status === 'read' ? { leido: true } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 300 });
  }

  async stats() {
    return { unread: await this.repo.count({ where: { leido: false } }) };
  }

  async marcar(id: string, leido: boolean) {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Mensaje no encontrado.');
    m.leido = leido;
    return this.repo.save(m);
  }

  async remove(id: string) {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Mensaje no encontrado.');
    await this.repo.remove(m);
  }
}

@ApiTags('Contacto')
@Controller('mensajes')
export class ContactoController {
  constructor(private readonly service: ContactoService) {}

  @Post()
  @ApiOperation({ summary: 'Enviar un mensaje desde el formulario de contacto' })
  create(@Body() dto: CreateMensajeDto) {
    return this.service.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  list(@Query() q: MensajesQueryDto) {
    return this.service.list(q);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.MANAGE)
  @ApiBearerAuth()
  stats() {
    return this.service.stats();
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  marcar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarcarLeidoDto) {
    return this.service.marcar(id, dto.leido);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

/** Dominio de Contacto / Atención al cliente (candidato a microservicio propio). */
@Module({
  imports: [TypeOrmModule.forFeature([Mensaje])],
  controllers: [ContactoController],
  providers: [ContactoService],
  exports: [TypeOrmModule],
})
export class ContactoModule {}
