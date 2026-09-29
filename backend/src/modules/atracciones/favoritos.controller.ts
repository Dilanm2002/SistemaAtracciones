import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AuthUser } from '../../common/auth/scopes';
import { DbService } from '../../common/db/db.service';

/** Lista de deseos del usuario (tabla favorito, UNIQUE usu_id + atr_id). */
@ApiTags('Atracciones - Favoritos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('favoritos')
export class FavoritosController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'IDs (UUID) de las atracciones favoritas del usuario, de la más reciente a la más antigua' })
  async list(@CurrentUser() user: AuthUser): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT a.atr_uuid::text AS id FROM favorito f JOIN atraccion a ON a.atr_id = f.atr_id
        WHERE f.usu_id = $1 AND a.atr_eliminado_en IS NULL ORDER BY f.fav_creado_en DESC`,
      [user.sub],
    );
    return rows.map((r) => r.id);
  }

  @Put(':attractionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Guardar una atracción en favoritos (idempotente)' })
  async add(@Param('attractionId', ParseUUIDPipe) uuid: string, @CurrentUser() user: AuthUser) {
    const r = await this.db.query(
      `INSERT INTO favorito (usu_id, atr_id)
       SELECT $1, atr_id FROM atraccion WHERE atr_uuid = $2 AND atr_eliminado_en IS NULL
       ON CONFLICT (usu_id, atr_id) DO NOTHING RETURNING fav_id`,
      [user.sub, uuid],
    );
    if (!r.length && !(await this.db.one('SELECT 1 FROM atraccion WHERE atr_uuid = $1 AND atr_eliminado_en IS NULL', [uuid]))) {
      throw new NotFoundException('La atracción no existe.');
    }
  }

  @Delete(':attractionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quitar una atracción de favoritos (idempotente)' })
  async remove(@Param('attractionId', ParseUUIDPipe) uuid: string, @CurrentUser() user: AuthUser) {
    await this.db.query('DELETE FROM favorito f USING atraccion a WHERE f.atr_id = a.atr_id AND f.usu_id = $1 AND a.atr_uuid = $2', [user.sub, uuid]);
  }
}
