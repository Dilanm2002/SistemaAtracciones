import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Clock3, Compass, Copy, ListChecks, Printer } from 'lucide-react';
import { Reservas } from '../api/client';
import { Alert, ErrorState, Spinner, StatusBadge, usePageTitle } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { fmtDateLong, fmtMoney, PAYMENT } from '../utils/format';

/** Genera un archivo .ics para agregar la actividad al calendario del viajero. */
export function downloadIcs(r) {
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

export default function Confirmation() {
  const { id } = useParams();
  const { state } = useLocation();
  const toast = useToast();
  const [r, setR] = useState(state?.reservation ?? null);
  const [error, setError] = useState(null);
  usePageTitle(r ? `Reserva ${r.code}` : 'Tu reserva');

  useEffect(() => {
    if (!r) Reservas.get(id).then(setR).catch(setError);
  }, [id, r]);

  if (error) return <div className="container"><ErrorState error={error} /></div>;
  if (!r) return <div className="container" style={{ paddingTop: 40 }}><Spinner label="Cargando tu reserva…" /></div>;

  const ok = r.status === 'CONFIRMED';
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.code); toast('Código copiado', 'success'); } catch { /* sin permiso */ }
  };

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="confirm-hero">
        <div className={`confirm-icon ${ok ? 'ok' : 'pending'}`}>
          {ok ? <CheckCircle2 size={40} aria-hidden="true" /> : <Clock3 size={40} aria-hidden="true" />}
        </div>
        <h1 style={{ fontSize: '2rem' }}>{ok ? '¡Tu reserva está confirmada!' : 'Recibimos tu reserva'}</h1>
        <p className="muted">
          {ok
            ? `Enviamos los detalles a ${r.customer?.email}. Presenta este código en el punto de encuentro.`
            : 'Está pendiente de pago. La confirmaremos en cuanto verifiquemos tu transferencia o el operador reciba tu pago.'}
        </p>
        <div className="code-box">
          <span className="sr-only">Código de reserva: </span>{r.code}
          <button className="icon-btn sm" onClick={copy} aria-label="Copiar código"><Copy size={18} /></button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{r.attraction.name}</h2>
          <StatusBadge status={r.status} />
        </div>
        <dl className="detail-list">
          <dt>Fecha</dt><dd>{fmtDateLong(r.date)}</dd>
          <dt>Hora de salida</dt><dd>{r.time}</dd>
          <dt>Punto de encuentro</dt><dd>{r.attraction.meeting_point}</dd>
          <dt>Participantes</dt><dd>{r.adults} adulto(s){r.children ? `, ${r.children} niño(s)` : ''}</dd>
          <dt>Titular</dt><dd>{r.customer?.name}</dd>
          <dt>Método de pago</dt><dd>{PAYMENT[r.payment_method]}</dd>
          <dt>Total</dt><dd><strong>{fmtMoney(r.total_price.total)}</strong></dd>
        </dl>
        {r.can_cancel && (
          <div style={{ marginTop: 16 }}>
            <Alert tone="success">Puedes cancelar gratis hasta {r.attraction.cancellation_hours} h antes desde "Mis reservas".</Alert>
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <button className="btn" onClick={() => downloadIcs(r)}><CalendarPlus size={18} /> Añadir a mi calendario</button>
        <button className="btn" onClick={() => window.print()}><Printer size={18} /> Imprimir</button>
        <Link to="/mis-reservas" className="btn btn-primary"><ListChecks size={18} /> Ver mis reservas</Link>
        <Link to="/explorar" className="btn btn-ghost"><Compass size={18} /> Seguir explorando</Link>
      </div>
    </div>
  );
}
