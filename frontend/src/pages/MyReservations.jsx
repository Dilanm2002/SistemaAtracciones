import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarPlus, CalendarX2, Clock, Eye, MapPin, MessageSquarePlus, Ticket, Users, XCircle } from 'lucide-react';
import { newIdempotencyKey, Reservas } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { ReviewModal } from '../components/Reviews';
import { Alert, EmptyState, ErrorState, Field, Modal, Spinner, StatusBadge, useAsync, usePageTitle } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { fmtDate, fmtDateLong, fmtDateTime, fmtMoney, PAYMENT, todayEc } from '../utils/format';
import { downloadIcs } from './Confirmation';

const MOTIVOS = ['Cambio de planes', 'Problemas con mi vuelo o transporte', 'Motivos de salud', 'Clima o seguridad', 'Encontré otra opción', 'Otro'];

export function CancelModal({ reservation, onClose, onDone, staff = false }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const r = reservation;

  const submit = async () => {
    if (!motivo) { setError('Selecciona un motivo'); return; }
    if (motivo === 'Otro' && detalle.trim().length < 3) { setError('Cuéntanos brevemente el motivo'); return; }
    setSending(true);
    try {
      const reason = motivo === 'Otro' ? detalle.trim() : `${motivo}${detalle.trim() ? `: ${detalle.trim()}` : ''}`;
      const updated = await Reservas.cancel(r.reservation_id, reason, key);
      toast(`Reserva ${r.code} cancelada`, 'success');
      onDone(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cancelar reserva"
      description={`${r.attraction.name} · ${fmtDate(r.date)} ${r.time}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Mantener reserva</button>
          <button className="btn btn-danger" onClick={submit} disabled={sending}>{sending && <Spinner />} Sí, cancelar</button>
        </>
      }
    >
      <div className="stack">
        {r.can_cancel ? (
          <Alert tone="success" title="Cancelación gratuita">Se reembolsará el total de {fmtMoney(r.total_price.total)} a tu método de pago en 5 a 10 días hábiles.</Alert>
        ) : staff ? (
          <Alert tone="warning" title="Fuera del plazo de cancelación gratuita">Como operador puedes cancelarla igualmente. Coordina el reembolso con el cliente.</Alert>
        ) : null}
        <Field label="Motivo" required error={error && !motivo ? error : null}>
          {(p) => (
            <select {...p} className="select" value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(null); }}>
              <option value="">Selecciona un motivo…</option>
              {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
            </select>
          )}
        </Field>
        <Field label={motivo === 'Otro' ? 'Describe el motivo' : 'Comentario (opcional)'} required={motivo === 'Otro'} error={error && motivo ? error : null}>
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: 80 }} value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={200} />}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>Esta acción no se puede deshacer. Si cambias de opinión, deberás hacer una nueva reserva (sujeta a disponibilidad).</p>
      </div>
    </Modal>
  );
}

export function ReservationDetailModal({ r, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Reserva ${r.code}`} description={r.attraction.name} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="row" style={{ marginBottom: 14 }}><StatusBadge status={r.status} /></div>
      <dl className="detail-list">
        <dt>Fecha</dt><dd>{fmtDateLong(r.date)}</dd>
        <dt>Hora</dt><dd>{r.time}</dd>
        <dt>Punto de encuentro</dt><dd>{r.attraction.meeting_point}</dd>
        <dt>Participantes</dt><dd>{r.adults} adulto(s){r.children ? `, ${r.children} niño(s)` : ''}</dd>
        <dt>Titular</dt><dd>{r.customer?.name}<br /><span className="muted small">{r.customer?.email} · {r.customer?.phone}</span></dd>
        <dt>Pago</dt><dd>{PAYMENT[r.payment_method]} · <strong>{fmtMoney(r.total_price.total)}</strong></dd>
        {r.notes && (<><dt>Notas</dt><dd>{r.notes}</dd></>)}
        <dt>Reservada</dt><dd>{fmtDateTime(r.created_at)}</dd>
        {r.status === 'CANCELLED' && (<><dt>Cancelada</dt><dd>{fmtDateTime(r.cancelled_at)} · {r.cancellation_reason}</dd></>)}
      </dl>
    </Modal>
  );
}

export default function MyReservations() {
  usePageTitle('Mis reservas');
  const today = todayEc();
  const [tab, setTab] = useState('upcoming');
  const { data, loading, error, reload, setData } = useAsync(() => Reservas.list(), []);
  const [cancel, setCancel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [review, setReview] = useState(null);

  const groups = useMemo(() => {
    const all = data ?? [];
    return {
      upcoming: all.filter((r) => r.status !== 'CANCELLED' && r.date >= today),
      past: all.filter((r) => r.status !== 'CANCELLED' && r.date < today).reverse(),
      cancelled: all.filter((r) => r.status === 'CANCELLED'),
    };
  }, [data, today]);

  const TABS = [['upcoming', 'Próximas'], ['past', 'Pasadas'], ['cancelled', 'Canceladas']];
  const list = groups[tab];

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Mis reservas</h1>
        <p>Consulta, añade a tu calendario o cancela tus experiencias.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Filtrar reservas" style={{ marginBottom: 20 }}>
        {TABS.map(([k, l]) => (
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l} <span className="count">{groups[k].length}</span>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading ? (
        <div className="res-list">{[1, 2].map((i) => <div key={i} className="card skeleton" style={{ height: 150 }} />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === 'cancelled' ? CalendarX2 : Ticket}
          title={tab === 'upcoming' ? 'No tienes reservas próximas' : tab === 'past' ? 'Aún no tienes experiencias pasadas' : 'No tienes reservas canceladas'}
          action={tab === 'upcoming' && <Link to="/explorar" className="btn btn-primary">Explorar experiencias</Link>}
        >
          {tab === 'upcoming' && 'Cuando reserves una experiencia la verás aquí con todos sus detalles.'}
        </EmptyState>
      ) : (
        <div className="res-list">
          {list.map((r) => (
            <article key={r.reservation_id} className="card res-card">
              <img src={r.attraction.photo} alt="" onError={onImgError} />
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <StatusBadge status={r.status} />
                  <span className="badge">{r.code}</span>
                </div>
                <h3><Link to={`/atraccion/${r.attraction.id}`}>{r.attraction.name}</Link></h3>
                <div className="res-meta">
                  <span><CalendarDays size={15} aria-hidden="true" /> {fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span><Clock size={15} aria-hidden="true" /> {r.time}</span>
                  <span><Users size={15} aria-hidden="true" /> {r.ticket_count}</span>
                  <span><MapPin size={15} aria-hidden="true" /> {r.attraction.city}</span>
                  <strong>{fmtMoney(r.total_price.total)}</strong>
                </div>
                {tab === 'upcoming' && r.status !== 'CANCELLED' && !r.can_cancel && (
                  <p className="tiny muted" style={{ margin: '6px 0 0' }}>Fuera del plazo de cancelación gratuita. Escríbenos si necesitas ayuda.</p>
                )}
              </div>
              <div className="res-actions">
                <button className="btn btn-sm" onClick={() => setDetail(r)}><Eye size={16} /> Ver detalle</button>
                {tab === 'upcoming' && (
                  <>
                    <button className="btn btn-sm" onClick={() => downloadIcs(r)}><CalendarPlus size={16} /> Calendario</button>
                    {r.can_cancel ? (
                      <button className="btn btn-sm btn-outline-danger" onClick={() => setCancel(r)}><XCircle size={16} /> Cancelar</button>
                    ) : (
                      <Link to={`/contacto?asunto=CANCELACION&codigo=${r.code}`} className="btn btn-sm btn-ghost">Solicitar ayuda</Link>
                    )}
                  </>
                )}
                {tab === 'past' && r.status === 'CONFIRMED' && (
                  <button className="btn btn-sm btn-primary" onClick={() => setReview(r)}><MessageSquarePlus size={16} /> Dejar reseña</button>
                )}
                {tab !== 'upcoming' && <Link to={`/atraccion/${r.attraction.id}`} className="btn btn-sm btn-ghost">Reservar de nuevo</Link>}
              </div>
            </article>
          ))}
        </div>
      )}

      {cancel && (
        <CancelModal
          reservation={cancel}
          onClose={() => setCancel(null)}
          onDone={(u) => { setData((d) => d.map((x) => (x.reservation_id === u.reservation_id ? u : x))); setCancel(null); }}
        />
      )}
      {detail && <ReservationDetailModal r={detail} onClose={() => setDetail(null)} />}
      {review && (
        <ReviewModal open onClose={() => setReview(null)} attraction={{ id: review.attraction.id, name: review.attraction.name }} />
      )}
    </div>
  );
}
