import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DbService } from '../db/db.service';

const TTL_HORAS = 24;

interface Registro {
  idem_operacion: string;
  idem_request_hash: string;
  idem_estado: 'IN_PROGRESS' | 'DONE' | 'FAILED';
  idem_response: unknown;
}

/**
 * Operaciones idempotentes sobre la tabla `idempotencia`
 * (PK compuesta idem_clave + idem_sujeto = usuario que ejecuta).
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger('Idempotency');

  constructor(private readonly db: DbService) {}

  private hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  }

  /**
   * Ejecuta `fn` UNA sola vez por (Idempotency-Key, usuario), también bajo concurrencia:
   *
   * 1. Reserva la clave con INSERT … ON CONFLICT DO NOTHING (atómico en Postgres).
   * 2. Si la reservó esta petición → ejecuta `fn`, guarda la respuesta y la devuelve.
   *    Si `fn` falla, libera la clave para que el cliente pueda reintentar.
   * 3. Si ya existía:
   *    - otra operación o payload distinto → 409 IDEMPOTENCY_CONFLICT
   *    - todavía en curso (petición paralela) → 409 IDEMPOTENCY_IN_PROGRESS
   *    - terminada → devuelve la respuesta original sin volver a ejecutar.
   */
  async execute<T>(key: string, operacion: string, sujeto: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
    this.purgarCaducados();
    const requestHash = this.hash(payload);

    const reservada = await this.db.query(
      `INSERT INTO idempotencia (idem_clave, idem_sujeto, idem_operacion, idem_request_hash, idem_estado, idem_expira_en)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + make_interval(hours => $5))
       ON CONFLICT (idem_clave, idem_sujeto) DO NOTHING
       RETURNING idem_clave`,
      [key, sujeto, operacion.slice(0, 150), requestHash, TTL_HORAS],
    );

    if (reservada.length === 0) {
      const existing = await this.db.one<Registro>(
        'SELECT idem_operacion, idem_request_hash, idem_estado, idem_response FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto = $2',
        [key, sujeto],
      );
      if (!existing) throw this.conflicto('IDEMPOTENCY_IN_PROGRESS', 'La operación se está procesando. Intenta de nuevo en unos segundos.');
      if (existing.idem_operacion !== operacion.slice(0, 150) || existing.idem_request_hash !== requestHash) {
        throw this.conflicto('IDEMPOTENCY_CONFLICT', 'La Idempotency-Key ya fue usada con una solicitud diferente.');
      }
      if (existing.idem_estado !== 'DONE') {
        throw this.conflicto('IDEMPOTENCY_IN_PROGRESS', 'La operación se está procesando. Intenta de nuevo en unos segundos.');
      }
      return existing.idem_response as T;
    }

    try {
      const result = await fn();
      await this.db.query(
        `UPDATE idempotencia SET idem_estado = 'DONE', idem_response = $3 WHERE idem_clave = $1 AND idem_sujeto = $2`,
        [key, sujeto, JSON.stringify(result ?? null)],
      );
      return result;
    } catch (err) {
      // Libera la clave: el reintento podrá ejecutarse
      await this.db.query('DELETE FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto = $2', [key, sujeto]);
      throw err;
    }
  }

  private conflicto(code: string, detail: string) {
    return new ConflictException({
      type: `https://api.descubre-ec.com/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: 'Conflicto de idempotencia',
      detail,
      code,
    });
  }

  /** Borra registros caducados (en ~2 % de las llamadas, para no cargar cada petición). */
  private purgarCaducados() {
    if (Math.random() > 0.02) return;
    this.db
      .query('DELETE FROM idempotencia WHERE idem_expira_en < now()')
      .catch((e: Error) => this.logger.warn(`No se pudieron purgar registros caducados: ${e.message}`));
  }
}
