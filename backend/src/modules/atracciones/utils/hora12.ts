/**
 * Horas en el formato del contrato v2 con Booking: «10:30 a.m.», «02:00 p.m.».
 * Internamente las horas son «HH:MM» (24 h).
 */

/** «14:00» → «02:00 p.m.»; «09:05» → «09:05 a.m.»; «00:30» → «12:30 a.m.» */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const sufijo = h < 12 ? 'a.m.' : 'p.m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${sufijo}`;
}

/**
 * Interpreta la hora que envía Booking y la devuelve como «HH:MM» (24 h), o null si no es válida.
 * Acepta «10:30 a.m.», «10:30 AM», «10:30am», «2:00 p.m.», «14:00» y «14:00:00».
 */
export function parseHora(texto: string | undefined | null): string | null {
  if (!texto) return null;
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(texto);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'a' && h === 12) h = 0;
    if (ampm === 'p' && h !== 12) h += 12;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
