import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, ChevronLeft, ChevronRight, Info, ShieldCheck } from 'lucide-react';
import { Atracciones } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { fmtDateLong, fmtMoney, fmtMonth, todayEc } from '../utils/format';

/** Máximo de tickets por reserva (igual que la API: ticket_count ≤ 30). */
const MAX_TICKETS = 30;
import { Alert, Qty, Spinner } from './ui';

const DOW = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const monthOf = (d) => d.slice(0, 7);
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Calendario mensual con estado por día (disponible / pocos cupos / agotado / no opera). */
export function AvailabilityCalendar({ attractionId, value, onChange }) {
  const today = todayEc();
  const [month, setMonth] = useState(monthOf(value || today));
  const [days, setDays] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDays(null);
    setError(null);
    Atracciones.calendar(attractionId, month).then(setDays).catch(setError);
  }, [attractionId, month]);

  const [y, m] = month.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes primero
  const label = fmtMonth(y, m);
  const canPrev = month > monthOf(today);
  const STATUS_LABEL = { available: 'disponible', low: 'pocos cupos', full: 'agotado', blocked: 'no opera', past: 'fecha pasada' };

  return (
    <div>
      <div className="cal-head">
        <button type="button" className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, -1))} disabled={!canPrev} aria-label="Mes anterior">
          <ChevronLeft size={20} />
        </button>
        <strong aria-live="polite">{label}</strong>
        <button type="button" className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mes siguiente">
          <ChevronRight size={20} />
        </button>
      </div>
      {error ? (
        <Alert tone="danger">No se pudo cargar la disponibilidad. {error.message}</Alert>
      ) : (
        // Grupo de botones con aria-pressed (ACC-007): cada día ya lleva su fecha completa en el nombre
        <div className="cal-grid" role="group" aria-label={`Disponibilidad de ${label}`} aria-busy={!days}>
          {DOW.map((d) => <div key={d} className="cal-dow" aria-hidden="true">{d}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} aria-hidden="true" />)}
          {(days ?? Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, status: 'loading' }))).map((d) => {
            const disabled = d.status !== 'available' && d.status !== 'low';
            const day = Number(d.date.slice(8));
            return (
              <button
                key={d.date}
                type="button"
                className={`cal-day ${d.status} ${value === d.date ? 'selected' : ''} ${d.date === today ? 'today' : ''} ${d.status === 'loading' ? 'skeleton' : ''}`}
                disabled={disabled}
                onClick={() => onChange(d.date)}
                aria-pressed={value === d.date}
                aria-label={`${fmtDateLong(d.date)}: ${STATUS_LABEL[d.status] ?? 'cargando'}${d.reason ? ` (${d.reason})` : ''}`}
                title={d.reason ?? (d.status === 'low' ? `Quedan ${d.available_spots} cupos` : undefined)}
              >
                {day}
              </button>
            );
          })}
        </div>
      )}
      <div className="cal-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--primary-50)' }} /> Disponible</span>
        <span><i style={{ background: 'var(--warning-bg)', border: '1px solid #f3cf7a' }} /> Pocos cupos</span>
        <span><i style={{ background: 'transparent', border: '1px solid var(--border-strong)' }} /> Agotado / no opera</span>
      </div>
    </div>
  );
}

export default function BookingWidget({ a, initialDate, initialPeople }) {
  const navigate = useNavigate();
  const { isAuth } = useAuth();
  const [date, setDate] = useState(initialDate && initialDate >= todayEc() ? initialDate : '');
  const [avail, setAvail] = useState(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [time, setTime] = useState('');
  const [adults, setAdults] = useState(Math.max(1, Number(initialPeople) || 2));
  const [children, setChildren] = useState(0);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!date) return;
    setLoadingAvail(true);
    setTime('');
    Atracciones.availability(a.id, date)
      .then((r) => {
        setAvail(r);
        const open = r.slots?.filter((s) => s.available > 0) ?? [];
        if (open.length === 1) setTime(open[0].time); // si solo hay una salida, la elegimos por el usuario
      })
      .catch(() => setAvail(null))
      .finally(() => setLoadingAvail(false));
  }, [a.id, date]);

  const slot = avail?.slots?.find((s) => s.time === time);
  // Al elegir un horario con menos cupos que los participantes ya elegidos, se ajustan solos al cupo
  // (antes se podía quedar en 30 con solo 10 cupos) y se avisa del cambio
  const [ajuste, setAjuste] = useState(null);
  useEffect(() => {
    if (!slot || adults + children <= slot.available) { setAjuste(null); return; }
    const ninos = Math.min(children, Math.max(0, slot.available - 1));
    const adultos = Math.max(1, slot.available - ninos);
    setChildren(ninos);
    setAdults(adultos);
    setAjuste(`Ajustamos a ${adultos + ninos} participante${adultos + ninos > 1 ? 's' : ''}: es el cupo disponible a las ${slot.time}.`);
  }, [slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const pax = adults + children;
  const childPrice = a.child_price?.total ?? a.price.total;
  const total = adults * a.price.total + children * childPrice;
  const overCapacity = slot && pax > slot.available;
  const ready = date && time && !overCapacity;

  const go = () => {
    setTouched(true);
    if (!ready) return;
    navigate(`/reservar/${a.id}?${new URLSearchParams({ fecha: date, hora: time, adultos: adults, ninos: children })}`);
  };

  const missing = useMemo(() => (!date ? 'Elige una fecha en el calendario' : !time ? 'Elige un horario de salida' : null), [date, time]);

  return (
    <div className="booking" id="reservar">
      <div className="card">
        <div className="booking-price">
          <span className="price-from">Desde</span>
          <span className="price">{fmtMoney(a.price.total)}</span>
          <span className="muted small">por adulto</span>
        </div>
        {a.free_cancellation && (
          <p className="small" style={{ color: 'var(--success)', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
            <ShieldCheck size={16} aria-hidden="true" /> Cancelación gratis hasta {a.cancellation_hours} h antes
          </p>
        )}

        <h3>1. Elige la fecha</h3>
        <AvailabilityCalendar attractionId={a.id} value={date} onChange={setDate} />

        {date && (
          <>
            <h3>2. Elige el horario <span className="muted" style={{ fontWeight: 500 }}>· {fmtDateLong(date)}</span></h3>
            {loadingAvail ? (
              <div className="row muted small"><Spinner label="Consultando cupos…" /></div>
            ) : avail?.slots?.length ? (
              <div className="slots" role="group" aria-label="Horarios disponibles">
                {avail.slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    className={`slot ${s.available > 0 && s.available <= 5 ? 'low' : ''}`}
                    aria-pressed={time === s.time}
                    disabled={s.available === 0}
                    onClick={() => setTime(s.time)}
                  >
                    {s.time}
                    <small>{s.available === 0 ? 'Agotado' : s.available <= 5 ? `¡Quedan ${s.available}!` : `${s.available} cupos`}</small>
                  </button>
                ))}
              </div>
            ) : (
              <Alert tone="warning">{avail?.unavailable_reason ?? 'No hay salidas para esta fecha.'} Prueba con otro día.</Alert>
            )}
          </>
        )}

        <h3>{date ? '3.' : '2.'} Participantes</h3>
        <div className="pax-row">
          <div><strong>Adultos</strong><span>12 años o más · {fmtMoney(a.price.total)}</span></div>
          <Qty value={adults} onChange={setAdults} min={1} max={Math.max(1, Math.min(MAX_TICKETS - children, slot ? slot.available - children : MAX_TICKETS))} label="adultos" />
        </div>
        <div className="pax-row">
          <div><strong>Niños</strong><span>3 a 11 años · {fmtMoney(childPrice)}</span></div>
          <Qty value={children} onChange={setChildren} min={0} max={Math.max(0, Math.min(MAX_TICKETS - adults, slot ? slot.available - adults : MAX_TICKETS))} label="niños" />
        </div>
        {overCapacity && <Alert tone="warning">Solo quedan {slot.available} cupos a las {time}. Reduce participantes o elige otro horario.</Alert>}
        {ajuste && !overCapacity && <Alert tone="info">{ajuste}</Alert>}

        <div className="summary-lines">
          <div><span>{adults} adulto{adults > 1 ? 's' : ''} × {fmtMoney(a.price.total)}</span><span>{fmtMoney(adults * a.price.total)}</span></div>
          {children > 0 && <div><span>{children} niño{children > 1 ? 's' : ''} × {fmtMoney(childPrice)}</span><span>{fmtMoney(children * childPrice)}</span></div>}
        </div>
        <div className="summary-total">
          <span>Total</span>
          <span className="price">{fmtMoney(total)}</span>
        </div>
        <button className="btn btn-cta btn-lg btn-block" onClick={go} disabled={!!overCapacity} aria-describedby="book-hint">
          <CalendarCheck size={20} aria-hidden="true" /> Reservar ahora
        </button>
        <p id="book-hint" className={`small center ${touched && missing ? 'error-text' : 'muted'}`} style={{ margin: '10px 0 0', justifyContent: 'center' }}>
          {touched && missing ? missing : missing ? <><Info size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {missing}</> : isAuth ? 'No se te cobrará nada todavía' : 'Para reservar necesitas una cuenta: inicias sesión o te registras en el siguiente paso, sin perder tu selección'}
        </p>
      </div>
    </div>
  );
}
