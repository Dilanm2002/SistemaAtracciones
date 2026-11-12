import { useEffect, useRef } from 'react';

/**
 * Consulta silenciosa en segundo plano: llama a `fn` cada `ms` sin mostrar «cargando». Se pausa si la
 * pestaña no está visible (y consulta al volver) y nunca lanza una consulta mientras la anterior sigue en curso.
 * Quien la usa decide qué cambia en pantalla: así una actualización no reinicia lo que el usuario está llenando.
 */
export function useSondeo(fn, ms, activo = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!activo) return undefined;
    let enCurso = false;
    const consultar = () => {
      if (document.visibilityState === 'hidden' || enCurso) return;
      enCurso = true;
      Promise.resolve()
        .then(() => ref.current())
        .catch(() => { /* silenciosa: un fallo de red se reintenta en la próxima vuelta */ })
        .finally(() => { enCurso = false; });
    };
    const t = setInterval(consultar, ms);
    const alVolver = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [ms, activo]);
}

/** Igualdad por contenido (respuestas JSON de la API). */
export const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
