import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Auth, sesionInicial, tokenStore, usuarioDelToken } from '../api/client';
import { useToast } from './ToastContext';

const AuthCtx = createContext(null);

export const ROL_LABEL = { ADMIN: 'Administrador', OPERADOR: 'Operador', CLIENTE: 'Viajero' };

export function AuthProvider({ children }) {
  // Con token, la interfaz se pinta de inmediato con los datos del token (usuario provisional)
  // y las páginas piden sus datos en paralelo con /auth/me, que luego trae el perfil completo.
  const [user, setUser] = useState(() => (tokenStore.get() ? usuarioDelToken(tokenStore.get()) : null));
  const [loading, setLoading] = useState(() => !!tokenStore.get() && !usuarioDelToken(tokenStore.get()));
  const toast = useToast();

  const logout = useCallback((silent = false) => {
    // Revoca la sesión en el servidor (tabla sesion); si falla, igual se cierra localmente
    if (tokenStore.get() && !silent) Auth.logout().catch(() => {});
    tokenStore.set(null);
    setUser(null);
    if (!silent) toast('Cerraste sesión. ¡Hasta pronto!', 'info');
  }, [toast]);

  // Restaurar sesión al cargar
  useEffect(() => {
    if (!tokenStore.get()) return;
    (sesionInicial ?? Auth.me())
      .then(setUser)
      .catch(() => {
        tokenStore.set(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Si cualquier petición devuelve 401 con token, la sesión expiró
  useEffect(() => {
    const onExpired = () => {
      if (!tokenStore.get()) return;
      logout(true);
      toast('Tu sesión expiró. Vuelve a iniciar sesión para continuar.', 'warning');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout, toast]);

  const applySession = (res) => {
    tokenStore.set(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuth: !!user,
      isStaff: user?.rol === 'ADMIN' || user?.rol === 'OPERADOR',
      isAdmin: user?.rol === 'ADMIN',
      hasScope: (s) => !!user?.scope?.includes(s),
      login: async (email, password) => applySession(await Auth.login(email, password)),
      register: async (data) => applySession(await Auth.register(data)),
      loginGoogle: async (accessToken) => applySession(await Auth.google(accessToken)),
      refresh: async () => setUser(await Auth.me()),
      logout,
    }),
    [user, loading, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
