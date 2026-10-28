import { useEffect, useState } from 'react';
import { CalendarDays, Clock, Download, ExternalLink, MapPin } from 'lucide-react';
import { Atracciones, Reservas } from '../api/client';
import { fmtDateLong } from '../utils/format';
import { Modal } from './ui';

/**
 * «Añadir a mi calendario» dentro de la interfaz. Antes se descargaba directamente un .ics, que en
 * Windows sin app de calendario no se puede abrir. Ahora se muestra el evento y se añade con un clic a
 * Google Calendar u Outlook (en la web, sin instalar nada); el .ics queda para iPhone y otras apps.
 */
const ZONA = 'America/Guayaquil';
const OFFSET = '-05:00'; // Ecuador continental no cambia de hora

const dos = (n) => String(n).padStart(2, '0');

/** Inicio y fin en hora de Ecuador (la salida + la duración de la experiencia). */
function horario(r, horas) {
  const [h, m] = r.time.split(':').map(Number);
  const inicio = new Date(`${r.date}T${dos(h)}:${dos(m)}:00${OFFSET}`);
  const fin = new Date(inicio.getTime() + horas * 3_600_000);
  // Partes de la fecha en Ecuador (no en la zona del navegador)
  const partes = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { inicio: partes(inicio), fin: partes(fin) };
}

function enlaces(r, horas) {
  const { inicio, fin } = horario(r, horas);
  const titulo = `${r.attraction.name} (${r.code})`;
  const lugar = r.attraction.meeting_point ?? r.attraction.city ?? '';
  const detalle = `Reserva ${r.code} · ${r.ticket_count ?? ''} persona(s). Presenta tu código y tu documento en el punto de encuentro.`;
  const google = (p) => `${p.year}${p.month}${p.day}T${p.hour}${p.minute}00`;
  const iso = (p) => `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00${OFFSET}`;
  return {
    google: `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: `${google(inicio)}/${google(fin)}`, ctz: ZONA, location: lugar, details: detalle })}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: titulo, startdt: iso(inicio), enddt: iso(fin), location: lugar, body: detalle })}`,
    horaFin: `${fin.hour}:${fin.minute}`,
  };
}

/** Archivo .ics: enlace firmado de la API (iPhone ofrece «Añadir al calendario»); sin API, se genera aquí. */
export async function downloadIcs(r) {
  try {
    const { url } = await Reservas.calendario(r.reservation_id);
    window.location.assign(url);
  } catch {
    descargarIcsLocal(r);
  }
}

function descargarIcsLocal(r) {
  const start = `${r.date.replace(/-/g, '')}T${r.time.replace(':', '')}00`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Descubre EC//Reservas//ES',
    'BEGIN:VEVENT',
    `UID:${r.reservation_id}@descubre-ec`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=America/Guayaquil:${start}`,
    `SUMMARY:${r.attraction.name} (${r.code})`,
    `LOCATION:${(r.attraction.meeting_point ?? r.attraction.city).replace(/,/g, '\\,')}`,
    `DESCRIPTION:Reserva ${r.code} · ${r.ticket_count} persona(s). Presenta tu código en el punto de encuentro.`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `reserva-${r.code}.ics` });
  link.click();
  URL.revokeObjectURL(url);
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export default function AnadirCalendario({ r, open, onClose }) {
  const [horas, setHoras] = useState(2);
  useEffect(() => {
    if (!open || !r?.attraction?.id) return;
    // La reserva no trae la duración: se toma de la ficha (si falla, 2 h)
    Atracciones.get(r.attraction.id).then((a) => a?.duration_hours > 0 && setHoras(Number(a.duration_hours))).catch(() => {});
  }, [open, r?.attraction?.id]);

  if (!r) return null;
  const e = enlaces(r, horas);
  const [, mes, dia] = r.date.split('-');

  return (
    <Modal open={open} onClose={onClose} title="Añadir a tu calendario" description="Elige dónde guardar esta experiencia. Recibirás el recordatorio de tu calendario.">
      <div className="cal-evento">
        <div className="cal-evento-fecha" aria-hidden="true">
          <small>{MESES[Number(mes) - 1]}</small>
          <strong>{Number(dia)}</strong>
        </div>
        <div className="cal-evento-info">
          <strong>{r.attraction.name}</strong>
          <span><CalendarDays size={15} aria-hidden="true" /> {fmtDateLong(r.date)}</span>
          <span><Clock size={15} aria-hidden="true" /> {r.time} – {e.horaFin} (hora de Ecuador)</span>
          {(r.attraction.meeting_point || r.attraction.city) && <span><MapPin size={15} aria-hidden="true" /> {r.attraction.meeting_point ?? r.attraction.city}</span>}
        </div>
      </div>
      <div className="cal-opciones">
        <a className="cal-opcion" href={e.google} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          <span className="cal-opcion-logo g" aria-hidden="true">G</span>
          <span><strong>Google Calendar</strong><small>Se abre en una pestaña nueva</small></span>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <a className="cal-opcion" href={e.outlook} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          <span className="cal-opcion-logo o" aria-hidden="true">O</span>
          <span><strong>Outlook</strong><small>Outlook.com o Hotmail, en una pestaña nueva</small></span>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <button type="button" className="cal-opcion" onClick={() => { downloadIcs(r); onClose(); }}>
          <span className="cal-opcion-logo i" aria-hidden="true"><Download size={16} /></span>
          <span><strong>Apple Calendar u otra app</strong><small>Descarga el archivo .ics (iPhone, Mac, Thunderbird)</small></span>
        </button>
      </div>
    </Modal>
  );
}
