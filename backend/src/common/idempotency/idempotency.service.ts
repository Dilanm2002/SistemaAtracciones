import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';

@Injectable()
export class IdempotencyService {
  constructor(@InjectRepository(IdempotencyRecord) private readonly repo: Repository<IdempotencyRecord>) {}

  private hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  }

  /**
   * Ejecuta `fn` una sola vez por Idempotency-Key.
   * - Misma clave + misma operación + mismo payload → devuelve la respuesta guardada.
   * - Misma clave con otra operación o payload distinto → 409 Conflict.
   */
  async execute<T>(key: string, operacion: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
    const requestHash = this.hash(payload);
    const existing = await this.repo.findOne({ where: { key } });

    if (existing) {
      if (existing.operacion !== operacion || existing.requestHash !== requestHash) {
        throw new ConflictException({
          type: 'https://api.descubre-ec.com/errors/idempotency-conflict',
          title: 'Conflicto de idempotencia',
          detail: 'La Idempotency-Key ya fue usada con una solicitud diferente.',
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      return existing.responseBody as T;
    }

    const result = await fn();
    await this.repo.save(this.repo.create({ key, operacion, requestHash, statusCode: 200, responseBody: result }));
    return result;
  }
}
