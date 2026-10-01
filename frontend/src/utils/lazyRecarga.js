import { lazy } from 'react';

/**
 * Tras publicar una versión nueva, los archivos de la anterior dejan de existir. Si la pestaña
 * quedó abierta mucho tiempo y pide una página que aún no había cargado, esa descarga falla y la
 * pantalla quedaba en blanco. En ese caso se recarga sola UNA vez (como mucho cada 30 s, para no
 * entrar en bucle si el problema es otro, p. ej. sin internet).
 */
const CLAVE = 'recarga-por-version';

export function recargarPorVersion() {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(CLAVE)) || 0) < 30_000) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Como React.lazy, pero si el archivo de la página ya no existe, recarga con la versión nueva. */
export const lazyRecarga = (cargar) =>
  lazy(() => cargar().catch((e) => (recargarPorVersion() ? new Promise(() => {}) : Promise.reject(e))));
