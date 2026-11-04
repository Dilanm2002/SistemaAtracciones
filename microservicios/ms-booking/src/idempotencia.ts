import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DbService } from './comun/db.service';

/**
 * Idempotency-Key del contrato con Booking (la misma lógica que tenía la tienda): la operación corre UNA
 * sola vez por (clave, sujeto), también bajo concurrencia. Sin PII: se guarda solo la referencia (UUID de
 * la reserva) y al repetir la respuesta se reconstruye desde la reserva.
 */
export interface Referencia<T> {
  referencia: (resultado: T) => string;
  reconstruir: (referencia: string) => Promise<T>;
}

@Injectable()
export class Idempotencia {
  private readonly logger = new Logger('Idempotencia');
  constructor(private readonly db: DbService) {}

  async ejecutar<T>(clave: string, operacion: string, sujeto: string, payload: unknown, fn: () => Promise<T>, ref: Referencia<T>): Promise<T> {
    if (Math.random() < 0.02) this.db.query('DELETE FROM idempotencia WHERE idem_expira_en < now()').catch((e: Error) => this.logger.warn(e.message));
    const hash = createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
    const op = operacion.slice(0, 150);
    const reservada = await this.db.query(
      `INSERT INTO idempotencia (idem_clave, idem_sujeto, idem_operacion, idem_request_hash, idem_estado, idem_expira_en)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + interval '24 hours') ON CONFLICT (idem_clave, idem_sujeto) DO NOTHING RETURNING idem_clave`,
      [clave, sujeto, op, hash],
    );
    if (!reservada.length) {
      const e = await this.db.one<{ op: string; hash: string; estado: string; resp: { ref?: string } | null }>(
        'SELECT idem_operacion AS op, idem_request_hash AS hash, idem_estado AS estado, idem_response AS resp FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto = $2',
        [clave, sujeto],
      );
      if (!e || e.estado !== 'DONE') {
        if (e && (e.op !== op || e.hash !== hash)) throw this.conflicto('IDEMPOTENCY_CONFLICT', 'La Idempotency-Key ya fue usada con una solicitud diferente.');
        throw this.conflicto('IDEMPOTENCY_IN_PROGRESS', 'La operación se está procesando. Intenta de nuevo en unos segundos.');
      }
      if (e.op !== op || e.hash !== hash) throw this.conflicto('IDEMPOTENCY_CONFLICT', 'La Idempotency-Key ya fue usada con una solicitud diferente.');
      return ref.reconstruir(e.resp!.ref!);
    }
    try {
      const r = await fn();
      await this.db.query(`UPDATE idempotencia SET idem_estado = 'DONE', idem_response = $3 WHERE idem_clave = $1 AND idem_sujeto = $2`, [
        clave, sujeto, JSON.stringify({ ref: ref.referencia(r) }),
      ]);
      return r;
    } catch (err) {
      await this.db.query('DELETE FROM idempotencia WHERE idem_clave = $1 AND idem_sujeto = $2', [clave, sujeto]);
      throw err;
    }
  }

  private conflicto(code: string, detail: string) {
    return new ConflictException({ message: detail, code, title: 'Conflicto de idempotencia' });
  }
}
