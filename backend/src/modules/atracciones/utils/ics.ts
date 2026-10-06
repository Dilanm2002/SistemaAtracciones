import { fechaHoraEc } from './fechas';

/**
 * Evento de calendario (RFC 5545) de una reserva (MOV-014). Lo sirve la API con
 * `Content-Type: text/calendar`: así iPhone ofrece «Añadir al calendario», cosa que no hace
 * con un archivo generado en el navegador (Safari ignora `download` en enlaces blob:).
 */
export interface EventoReserva {
  id: string;
  codigo: string;
  nombre: string;
  fecha: string; // YYYY-MM-DD (hora de Ecuador)
  hora: string; // HH:MM
  duracionHoras: number;
  lugar: string;
  personas: number;
}

/** Texto RFC 5545: se escapan \ ; , y saltos de línea. */
export const escaparIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliega una línea a 75 octetos como exige la RFC (continúa con un espacio al inicio). */
export function plegarIcs(linea: string): string {
  const partes: string[] = [];
  let resto = linea;
  while (Buffer.byteLength(resto) > 75) {
    let n = 75;
    while (Buffer.byteLength(resto.slice(0, n)) > 75) n--;
    partes.push(resto.slice(0, n));
    resto = ` ${resto.slice(n)}`;
  }
  partes.push(resto);
  return partes.join('\r\n');
}

const utc = (d: Date) => `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

export function icsReserva(e: EventoReserva, ahora = new Date()): string {
  const inicio = fechaHoraEc(e.fecha, e.hora);
  const fin = new Date(inicio.getTime() + Math.max(0.5, e.duracionHoras) * 3_600_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Descubre EC//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@descubre-ec`,
    `DTSTAMP:${utc(ahora)}`,
    `DTSTART:${utc(inicio)}`,
    `DTEND:${utc(fin)}`,
    `SUMMARY:${escaparIcs(`${e.nombre} (${e.codigo})`)}`,
    `LOCATION:${escaparIcs(e.lugar)}`,
    `DESCRIPTION:${escaparIcs(`Reserva ${e.codigo} · ${e.personas} persona(s). Presenta tu código en el punto de encuentro.`)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Tu experiencia empieza en 2 horas',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(plegarIcs).join('\r\n') + '\r\n';
}
