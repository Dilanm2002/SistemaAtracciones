/**
 * Inicio de sesión con Google, como en Sal y Canela: Supabase Auth hace el OAuth con Google
 * y vuelve a /ingresar con el access_token en el fragmento (#). Ese token se envía a la API,
 * que lo valida contra Supabase y entrega la sesión propia del sistema (con DPoP).
 */
import { Auth } from '../api/client';

const SUPABASE = (import.meta.env.VITE_SUPABASE_URL ?? 'https://czpjbpbhwoorbszgrrkq.supabase.co').replace(/\/$/, '');
const VOLVER = 'google:volver';

/**
 * Sale hacia Google; al volver, se regresa a `volverA` (p. ej. el checkout).
 * Antes se consulta si Google está activado: si no, lanza un Error con un mensaje claro
 * (en lugar de dejar al usuario en la página de error de Supabase).
 */
export async function iniciarConGoogle(volverA) {
  const { habilitado } = await Auth.googleEstado().catch(() => ({ habilitado: true }));
  if (!habilitado) throw new Error('El inicio de sesión con Google todavía no está habilitado. Usa tu correo y contraseña.');
  try { if (volverA) sessionStorage.setItem(VOLVER, volverA); } catch { /* sin almacenamiento: vuelve al inicio */ }
  const destino = `${window.location.origin}/ingresar`;
  window.location.assign(`${SUPABASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(destino)}`);
}

let leido = false;
/**
 * Lee (una sola vez) la respuesta de Google en la URL y la borra de la barra de direcciones.
 * Devuelve { token } | { error } | null si no se viene de Google.
 */
export function respuestaGoogle() {
  if (leido) return null;
  const datos = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const token = datos.get('access_token');
  const error = datos.get('error_description') || datos.get('error');
  if (!token && !error) return null;
  leido = true;
  window.history.replaceState(null, '', window.location.pathname);
  if (token) return { token };
  return { error: /not enabled|provider/i.test(error) ? 'El inicio de sesión con Google todavía no está habilitado.' : 'No se pudo iniciar sesión con Google. Intenta de nuevo.' };
}

/** Ruta a la que volver después de Google (y la olvida). */
export function rutaDespuesDeGoogle() {
  try {
    const r = sessionStorage.getItem(VOLVER);
    sessionStorage.removeItem(VOLVER);
    return r && r.startsWith('/') && !r.startsWith('//') ? r : null;
  } catch {
    return null;
  }
}
