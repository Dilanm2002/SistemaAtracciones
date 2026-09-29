import { ArgumentsHost, BadRequestException, ConflictException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ProblemDetailsFilter } from './problem-details.filter';

/** Ejecuta el filtro y devuelve el estado, el tipo de contenido y el cuerpo que enviaría. */
function aplicar(exception: unknown) {
  const out: { status?: number; type?: string; body?: Record<string, unknown> } = {};
  const res = {
    status(s: number) {
      out.status = s;
      return this;
    },
    type(t: string) {
      out.type = t;
      return this;
    },
    json(b: Record<string, unknown>) {
      out.body = b;
      return this;
    },
  };
  const req = { originalUrl: '/api/v1/x', id: 'req-1' };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
  const filter = new ProblemDetailsFilter();
  (filter as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
  filter.catch(exception, host);
  return out;
}

const pg = (code: string, constraint?: string) => new QueryFailedError('SQL', [], Object.assign(new Error('pg'), { code, constraint }));

describe('ProblemDetailsFilter (RFC 7807)', () => {
  it('HttpException simple → mismo estado, título en español, instance y request_id', () => {
    const r = aplicar(new NotFoundException('Reserva no encontrada.'));
    expect(r.status).toBe(404);
    expect(r.type).toBe('application/problem+json');
    expect(r.body).toMatchObject({ title: 'Recurso no encontrado', detail: 'Reserva no encontrada.', status: 404, instance: '/api/v1/x', request_id: 'req-1' });
  });

  it('errores de class-validator → VALIDATION_FAILED con la lista por campo', () => {
    const r = aplicar(new BadRequestException(['email no tiene un formato válido', 'password debe tener al menos 8 caracteres']));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'VALIDATION_FAILED', detail: 'email no tiene un formato válido' });
    expect(r.body!.errors).toEqual([
      { field: 'email', message: 'email no tiene un formato válido' },
      { field: 'password', message: 'password debe tener al menos 8 caracteres' },
    ]);
  });

  it('un payload que ya es Problem Details se respeta (con su code)', () => {
    const r = aplicar(new ConflictException({ type: 'https://x/idem', title: 'Conflicto de idempotencia', detail: 'd', code: 'IDEMPOTENCY_CONFLICT' }));
    expect(r.body).toMatchObject({ type: 'https://x/idem', code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it.each([
    ['22P02', 400, 'VALIDATION_FAILED'],
    ['23514', 400, 'CONSTRAINT_VIOLATION'],
    ['23502', 400, 'CONSTRAINT_VIOLATION'],
    ['23503', 409, 'FOREIGN_KEY'],
    ['23505', 409, 'DUPLICATE'],
  ])('error de Postgres %s → %i %s', (code, status, codigo) => {
    const r = aplicar(pg(code));
    expect(r.status).toBe(status);
    expect(r.body!.code).toBe(codigo);
  });

  it('errores 4xx de body-parser (http-errors) conservan su estado: 413 en vez de 500', () => {
    const e = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' });
    const r = aplicar(e);
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ title: 'Archivo demasiado grande', status: 413 });
  });

  it('un error 5xx o sin "expose" nunca filtra el mensaje interno', () => {
    for (const e of [new Error('password=secreta en la cadena de conexión'), Object.assign(new Error('detalle-privado'), { status: 503, expose: false }), pg('XX000'), 'texto']) {
      const r = aplicar(e);
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/secreta|detalle-privado|XX000/);
    }
  });

  it('429 → mensaje amigable y code RATE_LIMITED', () => {
    const r = aplicar(new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS));
    expect(r.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(r.body!.detail).not.toMatch(/Throttler/);
  });
});
