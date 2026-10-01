import { ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { DbService, filas } from '../db/db.service';
import { IdempotencyKeyGuard } from '../guards/idempotency-key.guard';
import { ParseIdPipe } from '../pipes/parse-id.pipe';
import { JwtAuthGuard, OptionalJwtGuard } from './jwt-auth.guard';
import { AuthUser, Rol, SCOPES } from './scopes';
import { SessionService } from './session.service';

const ctx = (headers: Record<string, string>, req: Record<string, unknown> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => Object.assign(req, { headers }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard / OptionalJwtGuard', () => {
  const jwt = new JwtService({ secret: randomBytes(32).toString('hex') });
  const usuario: AuthUser = { sub: '5', email: 'a@b.ec', nombre: 'A', rol: Rol.CLIENTE, scope: [SCOPES.READ], jti: 'j1' };
  const sesiones = (u: AuthUser | null) => ({ resolver: jest.fn().mockResolvedValue(u) }) as unknown as SessionService;
  const reflector = (scopes?: string[]) => ({ getAllAndOverride: () => scopes }) as unknown as Reflector;

  it('401 sin cabecera, con esquema distinto de Bearer o token inválido', async () => {
    const g = new JwtAuthGuard(jwt, reflector(), sesiones(usuario));
    await expect(g.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(g.canActivate(ctx({ authorization: `Basic ${jwt.sign(usuario)}` }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(g.canActivate(ctx({ authorization: 'Bearer abc.def.ghi' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 si la sesión fue revocada o el usuario desactivado (resolver → null)', async () => {
    const g = new JwtAuthGuard(jwt, reflector(), sesiones(null));
    await expect(g.canActivate(ctx({ authorization: `Bearer ${jwt.sign(usuario)}` }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('403 si faltan scopes; los scopes salen de la base (resolver), no del token', async () => {
    const token = jwt.sign({ ...usuario, scope: [SCOPES.ADMIN] }); // token "inflado"
    const g = new JwtAuthGuard(jwt, reflector([SCOPES.ADMIN]), sesiones(usuario));
    await expect(g.canActivate(ctx({ authorization: `Bearer ${token}` }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deja pasar y adjunta el usuario cuando todo es válido', async () => {
    const req: Record<string, unknown> = {};
    const g = new JwtAuthGuard(jwt, reflector([SCOPES.READ]), sesiones(usuario));
    await expect(g.canActivate(ctx({ authorization: `Bearer ${jwt.sign(usuario)}` }, req))).resolves.toBe(true);
    expect(req.user).toEqual(usuario);
  });

  it('OptionalJwtGuard: anónimo o token inválido pasan sin usuario', async () => {
    const g = new OptionalJwtGuard(jwt, sesiones(usuario));
    const req: Record<string, unknown> = {};
    await expect(g.canActivate(ctx({}, req))).resolves.toBe(true);
    await expect(g.canActivate(ctx({ authorization: 'Bearer basura' }, req))).resolves.toBe(true);
    expect(req.user).toBeUndefined();
  });
});

describe('SessionService.resolver', () => {
  const db = (fila: unknown) => ({ one: jest.fn().mockResolvedValue(fila) }) as unknown as DbService;
  const payload = { sub: '5', email: 'a@b.ec', nombre: 'A', rol: Rol.ADMIN, scope: [SCOPES.ADMIN], jti: 's1' } as AuthUser;

  it('recalcula rol y scopes desde la base', async () => {
    const s = new SessionService(db({ activo: true, vigente: true, roles: ['CLIENTE'], operador: null }));
    const u = await s.resolver(payload);
    expect(u).toMatchObject({ rol: Rol.CLIENTE, operador: null });
    expect(u!.scope).not.toContain(SCOPES.ADMIN);
  });

  it.each([
    ['sesión revocada o vencida', { activo: true, vigente: false, roles: ['CLIENTE'], operador: null }],
    ['usuario inactivo', { activo: false, vigente: true, roles: ['CLIENTE'], operador: null }],
    ['sin roles', { activo: true, vigente: true, roles: [], operador: null }],
    ['sesión inexistente', null],
  ])('rechaza: %s', async (_c, fila) => {
    expect(await new SessionService(db(fila)).resolver(payload)).toBeNull();
  });

  it('rechaza tokens sin jti o con sub no numérico sin consultar la base', async () => {
    const base = db({ activo: true, vigente: true, roles: ['ADMIN'], operador: null });
    const s = new SessionService(base);
    expect(await s.resolver({ ...payload, jti: undefined })).toBeNull();
    expect(await s.resolver({ ...payload, sub: "1 OR 1=1" })).toBeNull();
    expect(base.one).not.toHaveBeenCalled();
  });

  it('sin caché por instancia: cada petición consulta la sesión y la revocación es inmediata (V2-CON-01)', async () => {
    const base = { one: jest.fn().mockResolvedValue({ activo: true, vigente: true, roles: ['CLIENTE'], operador: null }), query: jest.fn().mockResolvedValue([]) };
    const s = new SessionService(base as unknown as DbService);
    await s.resolver(payload);
    await s.resolver(payload);
    expect(base.one).toHaveBeenCalledTimes(2); // nunca se reutiliza un estado guardado en memoria
    await s.revocar('s1');
    base.one.mockResolvedValue({ activo: true, vigente: false, roles: ['CLIENTE'], operador: null });
    expect(await s.resolver(payload)).toBeNull();
  });
});

describe('IdempotencyKeyGuard y ParseIdPipe', () => {
  const guard = new IdempotencyKeyGuard();
  const conClave = (k?: string) => ctx(k === undefined ? {} : { 'idempotency-key': k });

  it('exige un UUID en Idempotency-Key', () => {
    expect(guard.canActivate(conClave('123e4567-e89b-42d3-a456-426614174000'))).toBe(true);
    for (const k of [undefined, '', '   ', 'abc', '123e4567e89b42d3a456426614174000', "' OR 1=1 --"]) {
      expect(() => guard.canActivate(conClave(k))).toThrow(HttpException);
    }
  });

  it('ParseIdPipe acepta enteros positivos de hasta 18 dígitos', () => {
    const p = new ParseIdPipe();
    expect(p.transform('1')).toBe('1');
    expect(p.transform('123456789012345678')).toBe('123456789012345678');
    for (const v of ['0', '-1', '01', '1.5', 'abc', '1e3', '1234567890123456789', '', ' 1']) expect(() => p.transform(v)).toThrow();
  });
});

describe('filas(): resultado de TypeORM normalizado', () => {
  it('UPDATE/DELETE devuelven [filas, afectadas] → se queda con las filas', () => {
    expect(filas([[{ id: 1 }], 1])).toEqual([{ id: 1 }]);
    expect(filas([[], 0])).toEqual([]);
  });

  it('SELECT e INSERT se devuelven tal cual (aunque tengan 2 filas)', () => {
    expect(filas([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(filas([])).toEqual([]);
  });
});
