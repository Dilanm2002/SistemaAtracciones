import { createHmac, timingSafeEqual } from 'crypto';
import { fechaHoraEc } from './comun/tiempo';

/**
 * Enlaces firmados (los mismos de la tienda): el .ics de una reserva se sirve con `?t=<exp>.<firma>`; sin
 * la firma, o vencida, responde 404 sin revelar que la reserva existe.
 */
const firma = (objeto: string, exp: number, secreto: string) => createHmac('sha256', secreto).update(`${objeto}:${exp}`).digest('base64url');

export const firmarHasta = (objeto: string, secreto: string, exp: number) => `${exp}.${firma(objeto, exp, secreto)}`;

export function firmaValida(objeto: string, token: string | undefined, secreto: string, ahora = Date.now()): boolean {
  const m = /^(\d{9,12})\.([\w-]{43})$/.exec(token ?? '');
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < ahora) return false;
  const esperado = Buffer.from(firma(objeto, exp, secreto));
  const recibido = Buffer.from(m[2]);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

/** Texto RFC 5545: se escapan \ ; , y saltos de línea. */
const escaparIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliega una línea a 75 octetos como exige la RFC (continúa con un espacio al inicio). */
function plegarIcs(linea: string): string {
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

/** Evento de calendario de una reserva (con aviso 2 h antes). */
export function icsReserva(e: { id: string; codigo: string; nombre: string; fecha: string; hora: string; duracionHoras: number; lugar: string; personas: number }, ahora = new Date()): string {
  const inicio = fechaHoraEc(e.fecha, e.hora);
  const fin = new Date(inicio.getTime() + Math.max(0.5, e.duracionHoras) * 3_600_000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Descubre EC//Reservas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@descubre-ec`,
    `DTSTAMP:${utc(ahora)}`,
    `DTSTART:${utc(inicio)}`,
    `DTEND:${utc(fin)}`,
    `SUMMARY:${escaparIcs(`${e.nombre} (${e.codigo})`)}`,
    `LOCATION:${escaparIcs(e.lugar)}`,
    `DESCRIPTION:${escaparIcs(`Reserva ${e.codigo} · ${e.personas} persona(s). Presenta tu código en el punto de encuentro.`)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Tu experiencia empieza en 2 horas', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(plegarIcs).join('\r\n') + '\r\n';
}
