import { Injectable, Logger } from '@nestjs/common';
import { DbService, Sql } from './db.service';

/**
 * Registro de auditoría (tabla `bitacora`): quién hizo qué sobre qué entidad.
 * Nunca interrumpe la operación principal si falla la escritura (auditoría SEG-017).
 */
@Injectable()
export class BitacoraService {
  private readonly logger = new Logger('Bitacora');

  constructor(private readonly db: DbService) {}

  async registrar(
    usuId: string | null | undefined,
    accion: string,
    entidad: string,
    entidadId: string | number | null,
    detalle?: Record<string, unknown>,
    sql: Sql = this.db,
  ) {
    try {
      await sql.query(
        'INSERT INTO bitacora (usu_id, bit_accion, bit_entidad, bit_entidad_id, bit_detalle) VALUES ($1, $2, $3, $4, $5)',
        [usuId ?? null, accion.slice(0, 60), entidad.slice(0, 60), entidadId == null ? null : String(entidadId), detalle ? JSON.stringify(detalle) : null],
      );
    } catch (e) {
      this.logger.warn(`No se pudo registrar ${accion} ${entidad}: ${(e as Error).message}`);
    }
  }
}
