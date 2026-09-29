import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { IdempotencyService } from './idempotency.service';

type Fila = { operacion: string; hash: string; estado: string; respuesta: unknown };

/** Base en memoria que imita las sentencias sobre `idempotencia` (INSERT … ON CONFLICT DO NOTHING es atómico). */
function fakeDb() {
  const filas = new Map<string, Fila>();
  const k = (p: unknown[]) => `${p[0]}|${p[1]}`;
  const query = async (sql: string, p: unknown[] = []) => {
    if (sql.includes('INSERT INTO idempotencia')) {
      if (filas.has(k(p))) return [];
      filas.set(k(p), { operacion: p[2] as string, hash: p[3] as string, estado: 'IN_PROGRESS', respuesta: null });
      return [{ idem_clave: p[0] }];
    }
    if (sql.startsWith('UPDATE idempotencia')) {
      const f = filas.get(k(p));
      if (f) Object.assign(f, { estado: 'DONE', respuesta: JSON.parse(p[2] as string) });
      return [];
    }
    if (sql.startsWith('DELETE FROM idempotencia WHERE idem_clave')) filas.delete(k(p));
    return [];
  };
  const one = async (sql: string, p: unknown[] = []) => {
    const f = filas.get(k(p));
    return f ? { idem_operacion: f.operacion, idem_request_hash: f.hash, idem_estado: f.estado, idem_response: f.respuesta } : null;
  };
  return { query, one } as unknown as DbService;
}

describe('IdempotencyService (tabla idempotencia; CON-001, DAT-003)', () => {
  const KEY = randomUUID(); // clave de prueba generada: sin valores fijos que parezcan secretos
  let svc: IdempotencyService;

  beforeEach(() => {
    svc = new IdempotencyService(fakeDb());
  });

  it('ejecuta una sola vez y repite la respuesta guardada', async () => {
    const fn = jest.fn().mockResolvedValue({ id: 1 });
    await expect(svc.execute(KEY, 'op', '1', { a: 1 }, fn)).resolves.toEqual({ id: 1 });
    await expect(svc.execute(KEY, 'op', '1', { a: 1 }, fn)).resolves.toEqual({ id: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('bajo concurrencia solo una llamada ejecuta; las demás reciben 409 "en curso"', async () => {
    let liberar: (v: unknown) => void = () => undefined;
    const fn = jest.fn(() => new Promise((resolve) => (liberar = resolve)));
    const primera = svc.execute(KEY, 'op', '1', {}, fn);
    await new Promise((r) => setImmediate(r));
    await expect(svc.execute(KEY, 'op', '1', {}, fn)).rejects.toBeInstanceOf(ConflictException);
    liberar({ ok: true });
    await expect(primera).resolves.toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('misma clave con otro payload → 409 conflicto', async () => {
    await svc.execute(KEY, 'op', '1', { a: 1 }, async () => 'x');
    await expect(svc.execute(KEY, 'op', '1', { a: 2 }, async () => 'y')).rejects.toBeInstanceOf(ConflictException);
  });

  it('la misma clave de otro usuario es independiente (no filtra respuestas ajenas)', async () => {
    await svc.execute(KEY, 'op', '1', {}, async () => 'de-1');
    await expect(svc.execute(KEY, 'op', '2', {}, async () => 'de-2')).resolves.toBe('de-2');
  });

  it('si la operación falla libera la clave para poder reintentar', async () => {
    const falla = async () => {
      throw new Error('boom');
    };
    await expect(svc.execute(KEY, 'op', '1', {}, falla)).rejects.toThrow('boom');
    await expect(svc.execute(KEY, 'op', '1', {}, async () => 'ok')).resolves.toBe('ok');
  });
});
