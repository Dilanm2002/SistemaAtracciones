/**
 * Valor de `trust proxy` de Express: TRUST_PROXY manda ("false"/"0" = ninguno, un número = saltos,
 * o una lista de IPs/subredes); sin él, 1 salto solo en Vercel.
 */
export function confianzaProxy(valor: string | undefined, enVercel: boolean): number | string | false {
  const v = valor?.trim();
  if (!v) return enVercel ? 1 : false;
  if (/^(false|0)$/i.test(v)) return false;
  return /^\d+$/.test(v) ? Number(v) : v;
}
