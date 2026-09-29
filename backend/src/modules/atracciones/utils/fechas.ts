/** Zona horaria del negocio: todas las fechas de reserva son hora de Ecuador continental. */
export const TZ = 'America/Guayaquil';

/** Fecha de hoy en Ecuador, formato AAAA-MM-DD. */
export function hoyEc(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Hora actual en Ecuador, formato HH:mm. */
export function horaActualEc(): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Convierte "2026-10-10" + "08:00" (hora Ecuador, UTC-5 sin horario de verano) a Date UTC. */
export function fechaHoraEc(fecha: string, hora = '00:00'): Date {
  return new Date(`${fecha}T${hora}:00-05:00`);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasDelMes(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function horasAIso(horas: number): string {
  // Se redondea a minutos totales antes de separar: 1.999 h → PT2H (no "PT1H60M")
  const minutos = Math.round(horas * 60);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (!h && !m) return 'PT0H';
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
}

export function isoAHoras(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(iso);
  if (!match) return 0;
  return Number(match[1] ?? 0) + Number(match[2] ?? 0) / 60;
}
