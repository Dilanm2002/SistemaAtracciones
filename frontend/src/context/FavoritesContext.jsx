import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Favoritos } from '../api/client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const FavCtx = createContext(null);
const KEY = 'dec_favoritos';
const RECENT_KEY = 'dec_recientes';

const read = (k) => {
  try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
};

/** "Vistos recientemente": ayuda a reconocer en lugar de recordar. */
export const recentStore = {
  list: () => read(RECENT_KEY),
  push: (id) => write(RECENT_KEY, [id, ...read(RECENT_KEY).filter((x) => x !== id)].slice(0, 8)),
};

/**
 * Favoritos: sin sesión viven en el navegador; con sesión se guardan en la tabla
 * `favorito` (se ven en cualquier dispositivo). Al iniciar sesión se fusionan ambos.
 */
export function FavoritesProvider({ children }) {
  const [ids, setIds] = useState(() => read(KEY));
  const { isAuth } = useAuth();
  const toast = useToast();

  // Al iniciar sesión: subir los favoritos locales y usar la lista del servidor.
  // La lista del usuario NO se guarda en el navegador (lo comparten todas las pestañas y
  // otra pestaña puede tener sesión con otro usuario); al cerrar sesión vuelve la de invitado.
  useEffect(() => {
    if (!isAuth) { setIds(read(KEY)); return; }
    let vivo = true;
    (async () => {
      try {
        const remotos = await Favoritos.list();
        const locales = read(KEY).filter((id) => !remotos.includes(id));
        await Promise.all(locales.map((id) => Favoritos.add(id).catch(() => {})));
        if (locales.length) write(KEY, []); // ya quedaron en la cuenta
        if (vivo) setIds([...locales, ...remotos]);
      } catch { /* sin conexión: se conservan los locales */ }
    })();
    return () => { vivo = false; };
  }, [isAuth]);

  const persistir = useCallback((id, guardar) => {
    if (!isAuth) {
      // Invitado: la lista vive en el navegador
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
