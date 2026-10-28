import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Info, ShieldCheck, Users } from 'lucide-react';
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

/**
 * Meses ya consultados (60 s). Al tocar «Cambiar fecha» el calendario se vuelve a montar: sin esto
 * pedía otra vez la disponibilidad y, mientras llegaba, todos los días se veían un momento como
 * disponibles. Con la caché el mes aparece al instante y se actualiza en segundo plano.
 */
const CACHE_CALENDARIO = new Map();
const VIGENCIA_CALENDARIO = 60_000;

/** Calendario mensual con estado por día (disponible / pocos cupos / agotado / no opera). */
export function AvailabilityCalendar({ attractionId, value, onChange }) {
  const today = todayEc();
  const [month, setMonth] = useState(monthOf(value || today));
  const clave = `${attractionId}|${month}`;
  const [days, setDays] = useState(() => CACHE_CALENDARIO.get(clave)?.days ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const guardado = CACHE_CALENDARIO.get(clave);
    setDays(guardado?.days ?? null);
    setError(null);
    if (guardado && Date.now() - guardado.t < VIGENCIA_CALENDARIO) return undefined;
    let vigente = true;
    Atracciones.calendar(attractionId, month)
      .then((d) => { CACHE_CALENDARIO.set(clave, { days: d, t: Date.now() }); if (vigente) setDays(d); })
      .catch((e) => vigente && !guardado && setError(e));
    return () => { vigente = false; };
  }, [attractionId, month, clave]);

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
          {(days ?? Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, status: 'loading' }))).map((dia) => {
            // Un día anterior a hoy nunca se ofrece, aunque la respuesta (o la carga) diga otra cosa
            const d = dia.date < today ? { ...dia, status: 'past' } : dia;
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
  // La tarjeta queda fija en pantalla (sticky) y debe caber completa: el calendario se resume en una
  // línea al elegir la fecha y los participantes se despliegan solo al tocarlos.
  const [verCalendario, setVerCalendario] = useState(!date);
  const [verPax, setVerPax] = useState(false);
  const elegirFecha = (d) => { setDate(d); setVerCalendario(false); };
  // Si aun así no cabe (participantes desplegados en una pantalla baja), la tarjeta sube lo justo
  // para que "Reservar ahora" siga a la vista; cuando cabe, queda bajo la cabecera como siempre.
  const cajaRef = useRef(null);
  useEffect(() => {
    const caja = cajaRef.current;
    if (!caja || typeof ResizeObserver === 'undefined') return undefined;
    const ajustar = () => {
      const cabecera = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68;
      const arriba = Math.min(cabecera + 16, window.innerHeight - caja.offsetHeight - 16);
      caja.style.setProperty('--booking-top', `${Math.round(arriba)}px`);
    };
    const ro = new ResizeObserver(ajustar);
    ro.observe(caja);
    window.addEventListener('resize', ajustar);
    ajustar();
    return () => { ro.disconnect(); window.removeEventListener('resize', ajustar); };
  }, []);

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
  // Adultos mayores (65+) e infantes (0–4 años, gratis pero ocupan cupo): contrato v2 con Booking
  const [seniors, setSeniors] = useState(0);
  const [students, setStudents] = useState(0);
  const [infants, setInfants] = useState(0);
  useEffect(() => {
    if (!slot || adults + children + seniors + students + infants <= slot.available) { setAjuste(null); return; }
    let libres = slot.available;
    const inf = Math.min(infants, Math.max(0, libres - 1));
    libres -= inf;
    const sen = Math.min(seniors, Math.max(0, libres - 1));
    libres -= sen;
    const est = Math.min(students, Math.max(0, libres - 1));
    libres -= est;
    const ninos = Math.min(children, Math.max(0, libres - 1));
    const adultos = Math.max(1, libres - ninos);
    setInfants(inf);
    setSeniors(sen);
    setStudents(est);
    setChildren(ninos);
    setAdults(adultos);
    const n = adultos + ninos + sen + est + inf;
    setAjuste(`Ajustamos a ${n} participante${n > 1 ? 's' : ''}: es el cupo disponible a las ${slot.time}.`);
  }, [slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const pax = adults + children + seniors + students + infants;
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const resumenPax = [
    plural(adults, 'adulto', 'adultos'),
    children && plural(children, 'niño', 'niños'),
    seniors && plural(seniors, 'adulto mayor', 'adultos mayores'),
    students && plural(students, 'estudiante', 'estudiantes'),
    infants && plural(infants, 'infante', 'infantes'),
  ].filter(Boolean).join(', ');
  const childPrice = a.child_price?.total ?? a.price.total;
  const seniorPrice = a.senior_price?.total ?? a.price.total;
  const studentPrice = a.student_price?.total ?? a.price.total;
  const total = adults * a.price.total + children * childPrice + seniors * seniorPrice + students * studentPrice;
  /** Máximo para un tipo de boleto: lo que queda del límite por reserva y del cupo del horario. */
  const maxDe = (propio, minimo = 0) => Math.max(minimo, Math.min(MAX_TICKETS - (pax - propio), slot ? slot.available - (pax - propio) : MAX_TICKETS));
  const overCapacity = slot && pax > slot.available;
  const ready = date && time && !overCapacity;

  const go = () => {
    setTouched(true);
    if (!ready) return;
    navigate(`/reservar/${a.id}?${new URLSearchParams({
      fecha: date, hora: time, adultos: adults, ninos: children, ...(seniors ? { mayores: seniors } : {}), ...(students ? { estudiantes: students } : {}), ...(infants ? { infantes: infants } : {}),
    })}`);
  };

  const missing = useMemo(() => (!date ? 'Elige una fecha en el calendario' : !time ? 'Elige un horario de salida' : null), [date, time]);

  return (
    <div className="booking" id="reservar" ref={cajaRef}>
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
        {verCalendario || !date ? (
          <AvailabilityCalendar attractionId={a.id} value={date} onChange={elegirFecha} />
        ) : (
          <div className="booking-resumen">
            <span><CalendarDays size={18} aria-hidden="true" /> {fmtDateLong(date)}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerCalendario(true)}>Cambiar fecha</button>
          </div>
        )}

        {date && (
          <>
            <h3>2. Elige el horario</h3>
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
        <button type="button" className="booking-resumen booking-pax-toggle" aria-expanded={verPax} aria-controls="booking-pax" onClick={() => setVerPax(!verPax)}>
          <span><Users size={18} aria-hidden="true" /> {resumenPax}</span>
          <ChevronDown size={18} aria-hidden="true" className={verPax ? 'girado' : ''} />
        </button>
        <div id="booking-pax" hidden={!verPax}>
        <div className="pax-row">
          <div><strong>Adultos</strong><span>13 a 64 años · {fmtMoney(a.price.total)}</span></div>
          <Qty value={adults} onChange={setAdults} min={1} max={maxDe(adults, 1)} label="adultos" />
        </div>
        <div className="pax-row">
          <div><strong>Niños</strong><span>5 a 12 años · {fmtMoney(childPrice)}</span></div>
          <Qty value={children} onChange={setChildren} min={0} max={maxDe(children)} label="niños" />
        </div>
        <div className="pax-row">
          <div><strong>Adultos mayores</strong><span>65 años o más · {fmtMoney(seniorPrice)}</span></div>
          <Qty value={seniors} onChange={setSeniors} min={0} max={maxDe(seniors)} label="adultos mayores" />
        </div>
        <div className="pax-row">
          <div><strong>Estudiantes</strong><span>con carnet vigente · {fmtMoney(studentPrice)}</span></div>
          <Qty value={students} onChange={setStudents} min={0} max={maxDe(students)} label="estudiantes" />
        </div>
        <div className="pax-row">
          <div><strong>Infantes</strong><span>0 a 4 años · gratis (ocupan cupo)</span></div>
          <Qty value={infants} onChange={setInfants} min={0} max={maxDe(infants)} label="infantes" />
        </div>
        </div>
        {overCapacity && <Alert tone="warning">Solo quedan {slot.available} cupos a las {time}. Reduce participantes o elige otro horario.</Alert>}
        {ajuste && !overCapacity && <Alert tone="info">{ajuste}</Alert>}

        {/* El desglose solo cuando hay más de un tipo de boleto (con solo adultos, el total ya lo dice) */}
        {(children || seniors || students || infants) > 0 && <div className="summary-lines">
          <div><span>{adults} adulto{adults > 1 ? 's' : ''} × {fmtMoney(a.price.total)}</span><span>{fmtMoney(adults * a.price.total)}</span></div>
          {children > 0 && <div><span>{children} niño{children > 1 ? 's' : ''} × {fmtMoney(childPrice)}</span><span>{fmtMoney(children * childPrice)}</span></div>}
          {seniors > 0 && <div><span>{seniors} adulto{seniors > 1 ? 's' : ''} mayor{seniors > 1 ? 'es' : ''} × {fmtMoney(seniorPrice)}</span><span>{fmtMoney(seniors * seniorPrice)}</span></div>}
          {students > 0 && <div><span>{students} estudiante{students > 1 ? 's' : ''} × {fmtMoney(studentPrice)}</span><span>{fmtMoney(students * studentPrice)}</span></div>}
          {infants > 0 && <div><span>{infants} infante{infants > 1 ? 's' : ''}</span><span>Gratis</span></div>}
        </div>}
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
