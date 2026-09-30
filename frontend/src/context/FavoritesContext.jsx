import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Favoritos } from '../api/client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const FavCtx = createContext(null);
const KEY = 'dec_favoritos';
const RECENT_KEY = 'dec_recientes';

/**
 * Almacenamiento POR PESTAÑA (sessionStorage), igual que la sesión: nada de favoritos ni de
 * "vistos" queda en el navegador compartido para la siguiente persona o el siguiente usuario.
 */
const read = (k) => {
  try { return JSON.parse(sessionStorage.getItem(k) ?? '[]'); } catch { return []; }
};
const write = (k, v) => {
  try { v.length ? sessionStorage.setItem(k, JSON.stringify(v)) : sessionStorage.removeItem(k); } catch { /* sin almacenamiento */ }
};
// Versiones anteriores guardaban estas listas en localStorage (compartido entre usuarios y pestañas)
try { localStorage.removeItem(KEY); localStorage.removeItem(RECENT_KEY); } catch { /* sin almacenamiento */ }

/** "Vistos recientemente" de esta pestaña: ayuda a reconocer en lugar de recordar. */
export const recentStore = {
  list: () => read(RECENT_KEY),
  push: (id) => write(RECENT_KEY, [id, ...read(RECENT_KEY).filter((x) => x !== id)].slice(0, 8)),
};

/**
 * Favoritos:
 * - Con sesión: son del usuario y viven solo en la tabla `favorito` (se ven en cualquier
 *   dispositivo donde inicie sesión, nunca en la sesión de otra persona).
 * - Invitado: viven solo en esta pestaña; al iniciar sesión pasan a la cuenta y se borran
 *   de la pestaña. Al cerrar sesión el contador vuelve a 0.
 */
export function FavoritesProvider({ children }) {
  const [ids, setIds] = useState(() => read(KEY));
  const { isAuth } = useAuth();
  const toast = useToast();

  // Con sesión: se suben los favoritos de invitado y se usa la lista del servidor.
  // Sin sesión (o al cerrarla): solo la lista de invitado de esta pestaña (vacía tras un login).
  useEffect(() => {
    if (!isAuth) { setIds(read(KEY)); return; }
    let vivo = true;
    (async () => {
      try {
        const remotos = await Favoritos.list();
        const locales = read(KEY).filter((id) => !remotos.includes(id));
        await Promise.all(locales.map((id) => Favoritos.add(id).catch(() => {})));
        write(KEY, []); // ya quedaron en la cuenta: no deben reaparecer al cerrar sesión
        if (vivo) setIds([...locales, ...remotos]);
      } catch { /* sin conexión: se conservan los locales */ }
    })();
    return () => { vivo = false; };
  }, [isAuth]);

  const persistir = useCallback((id, guardar) => {
    if (!isAuth) {
      // Invitado: la lista vive solo en esta pestaña
      const actual = read(KEY);
      write(KEY, guardar ? [id, ...actual.filter((x) => x !== id)] : actual.filter((x) => x !== id));
      return;
    }
    (guardar ? Favoritos.add(id) : Favoritos.remove(id)).catch(() => toast('No pudimos sincronizar tus favoritos. Intenta de nuevo.', 'error'));
  }, [isAuth, toast]);

  const toggle = useCallback(
    (id, name) => {
      const on = ids.includes(id);
      setIds((prev) => (on ? prev.filter((x) => x !== id) : [id, ...prev.filter((x) => x !== id)]));
      persistir(id, !on);
      toast(
        on ? `Quitaste "${name}" de tus favoritos` : `Guardaste "${name}" en favoritos`,
        on ? 'info' : 'success',
        on
          ? { action: { label: 'Deshacer', onClick: () => { setIds((p) => (p.includes(id) ? p : [id, ...p])); persistir(id, true); } } }
          : {},
      );
    },
    [ids, toast, persistir],
  );

  return <FavCtx.Provider value={{ ids, has: (id) => ids.includes(id), toggle }}>{children}</FavCtx.Provider>;
}

export const useFavorites = () => useContext(FavCtx);
