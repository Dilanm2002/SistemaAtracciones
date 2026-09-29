import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

export function FavoritesProvider({ children }) {
  const [ids, setIds] = useState(() => read(KEY));
  const toast = useToast();

  useEffect(() => { write(KEY, ids); }, [ids]);

  const toggle = useCallback(
    (id, name) => {
      const on = ids.includes(id);
      setIds((prev) => (on ? prev.filter((x) => x !== id) : [id, ...prev.filter((x) => x !== id)]));
      toast(
        on ? `Quitaste "${name}" de tus favoritos` : `Guardaste "${name}" en favoritos`,
        on ? 'info' : 'success',
        on ? { action: { label: 'Deshacer', onClick: () => setIds((p) => (p.includes(id) ? p : [id, ...p])) } } : {},
      );
    },
    [ids, toast],
  );

  return <FavCtx.Provider value={{ ids, has: (id) => ids.includes(id), toggle }}>{children}</FavCtx.Provider>;
}

export const useFavorites = () => useContext(FavCtx);
