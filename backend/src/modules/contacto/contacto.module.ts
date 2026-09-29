import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DbService } from '../../common/db/db.service';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { Scopes } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SCOPES } from '../../common/auth/scopes';
import { trim } from '../../common/utils/transform';

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
  @Matches(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, { message: 'email no tiene un formato válido' })
  @MaxLength(160)
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

const SELECT_MENSAJE = `SELECT men_id::text AS id, men_nombre AS nombre, men_correo AS email, men_asunto AS asunto,
                               men_cuerpo AS mensaje, men_leido AS leido, men_creado_en AS "createdAt" FROM mensaje_contacto`;

/** Tabla mensaje_contacto. */
@Injectable()
export class ContactoService {
  constructor(private readonly db: DbService) {}

  async create(dto: CreateMensajeDto) {
    if (dto.website) return { ok: true }; // bot detectado: fingimos éxito sin guardar
    await this.db.query('INSERT INTO mensaje_contacto (men_nombre, men_correo, men_asunto, men_cuerpo) VALUES ($1, $2, $3, $4)', [
      dto.nombre,
      dto.email,
      dto.asunto,
      dto.mensaje,
    ]);
    return { ok: true };
  }

  list(q: MensajesQueryDto) {
    const where = q.status === 'unread' ? 'WHERE NOT men_leido' : q.status === 'read' ? 'WHERE men_leido' : '';
    return this.db.query(`${SELECT_MENSAJE} ${where} ORDER BY men_creado_en DESC LIMIT 300`);
  }

  async stats() {
    const r = await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM mensaje_contacto WHERE NOT men_leido');
    return { unread: r?.n ?? 0 };
  }

  async marcar(id: string, leido: boolean) {
    const r = await this.db.query('UPDATE mensaje_contacto SET men_leido = $2 WHERE men_id = $1 RETURNING men_id', [id, leido]);
    if (!r.length) throw new NotFoundException('Mensaje no encontrado.');
    return this.db.one(`${SELECT_MENSAJE} WHERE men_id = $1`, [id]);
  }

  async remove(id: string) {
    const r = await this.db.query('DELETE FROM mensaje_contacto WHERE men_id = $1 RETURNING men_id', [id]);
    if (!r.length) throw new NotFoundException('Mensaje no encontrado.');
  }
}

@ApiTags('Contacto')
@Controller('mensajes')
export class ContactoController {
  constructor(private readonly service: ContactoService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 600_000 } }) // 5 mensajes cada 10 minutos por IP
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
  marcar(@Param('id', ParseIdPipe) id: string, @Body() dto: MarcarLeidoDto) {
    return this.service.marcar(id, dto.leido);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Scopes(SCOPES.ADMIN)
  @ApiBearerAuth()
  remove(@Param('id', ParseIdPipe) id: string) {
    return this.service.remove(id);
  }
}

/** Dominio de Contacto / Atención al cliente (candidato a microservicio propio). */
@Module({
  controllers: [ContactoController],
  providers: [ContactoService],
})
export class ContactoModule {}
