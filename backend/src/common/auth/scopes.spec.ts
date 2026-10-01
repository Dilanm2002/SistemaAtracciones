import { Rol, rolPrincipal, SCOPES, scopesDe } from './scopes';

describe('scopesDe', () => {
  it('una cuenta sin rol es un cliente común: puede reservar y cancelar', () => {
    expect(rolPrincipal([])).toBe(Rol.CLIENTE);
    expect(scopesDe([])).toEqual(expect.arrayContaining([SCOPES.BOOK, SCOPES.CANCEL]));
    expect(scopesDe(['ROL_INEXISTENTE'])).toEqual(scopesDe([Rol.CLIENTE]));
  });

  it('un cliente no recibe permisos de gestión', () => {
    expect(scopesDe([Rol.CLIENTE])).not.toContain(SCOPES.MANAGE);
    expect(scopesDe([Rol.CLIENTE])).not.toContain(SCOPES.ADMIN);
  });
});
