import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/** Inicio de sesión con Google: el token se valida contra Supabase y se busca o crea el cliente. */
describe('AuthService.loginGoogle', () => {
  const cuentaGoogle = {
    email: 'Ana.Perez@gmail.com',
    email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Ana Pérez 😀', given_name: 'Ana', family_name: 'Pérez' },
  };
  let fetchMock: jest.Mock;
  let db: { one: jest.Mock; query: jest.Mock; tx: jest.Mock };
  let tx: { one: jest.Mock; query: jest.Mock };
  let service: AuthService;
  let emitir: jest.SpyInstance;

  const responder = (cuenta: unknown, ok = true) =>
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/user') ? { ok, json: () => Promise.resolve(cuenta) } : { ok: true }),
    );

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    tx = { one: jest.fn().mockResolvedValue({ id: '9' }), query: jest.fn() };
    db = { one: jest.fn(), query: jest.fn(), tx: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const config = { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'srv' })[k] };
    service = new AuthService(db as never, {} as never, {} as never, { precargar: jest.fn() } as never, { registrar: jest.fn() } as never, config as never);
    jest.spyOn(service as never, 'asignarRol').mockResolvedValue(undefined as never);
    jest.spyOn(service as never, 'fila').mockResolvedValue({ id: '9' } as never);
    emitir = jest.spyOn(service as never, 'emitirToken').mockResolvedValue({ access_token: 't' } as never);
  });

  it('informa si Google está activado en Supabase Auth', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ external: { google: false } }) });
    await expect(service.googleHabilitado()).resolves.toEqual({ habilitado: false });
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ external: { google: true } }) });
    await expect(service.googleHabilitado()).resolves.toEqual({ habilitado: true });
  });

  it('valida el token con Supabase usando la clave de servidor', async () => {
    responder(cuentaGoogle);
    db.one.mockResolvedValue(null);
    await service.loginGoogle('token-de-supabase-123456', {});
    expect(fetchMock).toHaveBeenCalledWith('https://x.supabase.co/auth/v1/user', expect.objectContaining({
      headers: { apikey: 'srv', Authorization: 'Bearer token-de-supabase-123456' },
    }));
  });

  it('crea una cuenta CLIENTE verificada con el nombre limpio si el correo no existe', async () => {
    responder(cuentaGoogle);
    db.one.mockResolvedValue(null);
    await service.loginGoogle('token-de-supabase-123456', { jkt: 'llave' });
    const [sql, params] = tx.one.mock.calls[0];
    expect(sql).toContain('usu_verificado');
    expect(params.slice(0, 1)).toEqual(['ana.perez@gmail.com']);
    expect(params.slice(2)).toEqual(['Ana', 'Pérez']);
    expect(emitir).toHaveBeenCalledWith({ id: '9' }, { jkt: 'llave' });
  });

  it('si el correo ya existe, inicia sesión en esa cuenta sin crear otra', async () => {
    responder(cuentaGoogle);
    db.one.mockResolvedValue({ id: '4', activo: true });
    await service.loginGoogle('token-de-supabase-123456', {});
    expect(db.tx).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('usu_verificado = TRUE'), ['4']);
  });

  it('rechaza un token que Supabase no reconoce', async () => {
    responder({}, false);
    await expect(service.loginGoogle('token-falso-1234567890', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza cuentas que no vienen de Google o sin correo verificado', async () => {
    responder({ ...cuentaGoogle, app_metadata: { provider: 'email', providers: ['email'] } });
    await expect(service.loginGoogle('token-de-supabase-123456', {})).rejects.toBeInstanceOf(UnauthorizedException);
    responder({ ...cuentaGoogle, email_confirmed_at: null });
    await expect(service.loginGoogle('token-de-supabase-123456', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no deja entrar a una cuenta desactivada', async () => {
    responder(cuentaGoogle);
    db.one.mockResolvedValue({ id: '4', activo: false });
    await expect(service.loginGoogle('token-de-supabase-123456', {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});
