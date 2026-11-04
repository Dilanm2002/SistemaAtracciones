/**
 * Fechas y horas del negocio: todo es hora de Ecuador continental (UTC-5, sin horario de verano).
 * Internamente las horas son «HH:MM» (24 h); el contrato con Booking usa «10:30 a.m.».
 */
export const TZ = 'America/Guayaquil';

export const hoyEc = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

export const horaActualEc = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** «2026-10-10» + «08:00» (hora de Ecuador) → instante UTC. */
export const fechaHoraEc = (fecha: string, hora = '00:00') => new Date(`${fecha}T${hora}:00-05:00`);

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** «14:00» → «02:00 p.m.»; «00:30» → «12:30 a.m.» */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/** Acepta «10:30 a.m.», «10:30 AM», «2:00 p.m.», «14:00» y «14:00:00»; devuelve «HH:MM» o null. */
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

/** Clave canónica del turno del contrato v3: slot-AAAAMMDD-HHMM. */
export const slotId = (fecha: string, hora24: string) => `slot-${fecha.replace(/-/g, '')}-${hora24.replace(':', '')}`;
