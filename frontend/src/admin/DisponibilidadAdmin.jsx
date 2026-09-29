import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, CalendarClock, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Atracciones } from '../api/client';
import { Alert, EmptyState, Field, useConfirm } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDate, fmtMonth, todayEc } from '../utils/format';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const shift = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function DisponibilidadAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState('');
  const [month, setMonth] = useState(todayEc().slice(0, 7));
  const [days, setDays] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [form, setForm] = useState({ date: '', reason: '' });
  const [err, setErr] = useState({});

  useEffect(() => {
    Atracciones.list({ limit: 200 }).then((r) => { setList(r.data); if (r.data[0]) setSel(r.data[0].id); }).catch(() => {});
  }, []);

  const a = list.find((x) => x.id === sel);
  const loadCal = () => { if (sel) { setDays(null); Atracciones.calendar(sel, month).then(setDays).catch(() => setDays([])); } };
  const loadBlocked = () => sel && Atracciones.blocked(sel).then(setBlocked).catch(() => setBlocked([]));
  useEffect(loadCal, [sel, month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBlocked(); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const block = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.date) errs.date = 'Elige la fecha';
    else if (form.date < todayEc()) errs.date = 'No puedes bloquear fechas pasadas';
    if (form.reason.trim().length < 3) errs.reason = 'Indica el motivo (lo verán los viajeros)';
    setErr(errs);
    if (Object.keys(errs).length) return;
    try {
      const b = await Atracciones.block(sel, form.date, form.reason.trim());
      setForm({ date: '', reason: '' });
      loadBlocked();
      loadCal();
      toast(
        b.affected_reservations ? `Fecha bloqueada. Atención: hay ${b.affected_reservations} reserva(s) ese día, contacta a los clientes.` : 'Fecha bloqueada',
        b.affected_reservations ? 'warning' : 'success',
        { duration: b.affected_reservations ? 9000 : undefined },
      );
    } catch (e2) { setErr({ date: e2.message }); }
  };

  const unblock = async (b) => {
    if (!(await confirm({ title: 'Desbloquear fecha', message: `¿Volver a abrir las reservas para el ${fmtDate(b.date)}?`, confirmText: 'Desbloquear' }))) return;
    try { await Atracciones.unblock(sel, b.id); loadBlocked(); loadCal(); toast('Fecha desbloqueada', 'success'); } catch (e) { toast(e.message, 'error'); }
  };

  const [y, m] = month.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const capacity = a ? a.capacity_per_slot * a.times.length : 0;

  if (!list.length) return <EmptyState icon={CalendarClock} title="No hay atracciones activas" />;

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Disponibilidad y ocupación</h2><p>Revisa cupos ocupados por día y bloquea fechas en que no se opera.</p></div>
        <select className="select" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Atracción" style={{ maxWidth: 360 }}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      {a && (
        <p className="muted small" style={{ marginTop: -8 }}>
          Salidas: <strong>{a.times.join(', ')}</strong> · {a.capacity_per_slot} cupos por salida ({capacity} por día).
          {isAdmin && <> <Link to="/admin/atracciones">Editar horarios y cupos</Link></>}
        </p>
      )}

      <div className="adm-split" style={{ gridTemplateColumns: '1fr 320px' }}>
        <section className="card card-pad" aria-label="Ocupación del mes">
          <div className="cal-head" style={{ marginBottom: 14 }}>
            <button className="icon-btn sm" onClick={() => setMonth(shift(month, -1))} aria-label="Mes anterior"><ChevronLeft size={20} /></button>
            <strong>{fmtMonth(y, m)}</strong>
            <button className="icon-btn sm" onClick={() => setMonth(shift(month, 1))} aria-label="Mes siguiente"><ChevronRight size={20} /></button>
          </div>
          <div className="occupancy" aria-busy={!days}>
            {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
            {(days ?? []).map((d) => {
              const used = Math.max(0, capacity - d.available_spots);
              const pct = capacity ? Math.round((used / capacity) * 100) : 0;
              const label = d.status === 'blocked' ? 'No opera' : d.status === 'past' ? '' : `${used}/${capacity}`;
              return (
                <div key={d.date} className={`occ-day ${d.status}`} title={d.reason ?? `${pct}% ocupado`}>
                  <strong>{Number(d.date.slice(8))}</strong>
                  <span className="muted">{d.status === 'blocked' ? <><Ban size={12} aria-hidden="true" /> {label}</> : label}</span>
                  {d.status !== 'past' && d.status !== 'blocked' && <div className="occ-bar" aria-label={`${pct}% ocupado`}><span style={{ width: `${pct}%` }} /></div>}
                </div>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><i style={{ background: 'var(--primary)' }} /> Ocupación normal</span>
            <span><i style={{ background: 'var(--cta-hover)' }} /> Pocos cupos (≥80 %)</span>
            <span><i style={{ background: 'var(--danger)' }} /> Agotado</span>
            <span><i style={{ background: 'repeating-linear-gradient(135deg,#ebe4d8,#ebe4d8 3px,#fff 3px,#fff 6px)', border: '1px solid var(--border)' }} /> No opera</span>
          </div>
        </section>

        <aside className="stack">
          <form className="card card-pad" onSubmit={block} noValidate>
            <h3 className="panel-title"><Ban size={18} aria-hidden="true" /> Bloquear una fecha</h3>
            <div className="stack">
              <Field label="Fecha" required error={err.date}>{(p) => <input {...p} type="date" className="input" min={todayEc()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
              <Field label="Motivo" required error={err.reason} hint="Ej. Feriado, mantenimiento, clima">{(p) => <input {...p} className="input" value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}</Field>
              <button className="btn btn-primary btn-block">Bloquear fecha</button>
            </div>
          </form>
          <section className="card card-pad" aria-labelledby="bl-title">
            <h3 id="bl-title" className="panel-title">Fechas bloqueadas</h3>
            {blocked.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No hay fechas bloqueadas.</p> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {blocked.map((b) => (
                  <li key={b.id} className="row-between" style={{ flexWrap: 'nowrap' }}>
                    <div><strong className="small">{fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong><div className="muted tiny">{b.reason}</div></div>
                    <button className="icon-btn sm" onClick={() => unblock(b)} aria-label={`Desbloquear ${b.date}`}><Trash2 size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Alert tone="info">Bloquear un día no cancela las reservas existentes: contacta a los clientes afectados desde <Link to="/admin/reservas">Reservas</Link>.</Alert>
        </aside>
      </div>
    </>
  );
}
