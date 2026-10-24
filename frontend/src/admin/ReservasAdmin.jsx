import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, Eye, RefreshCw, Search, UserCheck, XCircle } from 'lucide-react';
import { Atracciones, newIdempotencyKey, Reservas } from '../api/client';
import { Alert, EmptyState, ErrorState, Field, Modal, Spinner, StatusBadge, useConfirm, useDebounce } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { CancelModal, ReservationDetailModal } from '../pages/MyReservations';
import { addDays, estadoVisible, fmtDate, fmtMoney, PAYMENT, STATUS, todayEc } from '../utils/format';
import { useAdmin } from './AdminLayout';
import { exportXlsx } from './excel';

const TABS = [
  ['upcoming', 'Próximas'],
  ['pending', 'Pendientes de pago'],
  ['past', 'Historial'],
  ['cancelled', 'Canceladas'],
  ['all', 'Todas'],
];

export default function ReservasAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshCounts } = useAdmin();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [tab, setTab] = useState(params.get('estado') === 'PENDING' ? 'pending' : location.state?.q ? 'all' : 'upcoming');
  const [day, setDay] = useState(params.get('fecha') ?? '');
  const [q, setQ] = useState(location.state?.q ?? '');
  const [attr, setAttr] = useState('');
  const [atracciones, setAtracciones] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [detail, setDetail] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const dq = useDebounce(q, 350);

  const query = useMemo(() => ({
    all: 'true',
    ...(tab === 'upcoming' ? { when: 'upcoming' } : {}),
    ...(tab === 'past' ? { when: 'past' } : {}),
    ...(tab === 'pending' ? { status: 'PENDING' } : {}),
    ...(tab === 'cancelled' ? { status: 'CANCELLED' } : {}),
    ...(day ? { date: day } : {}),
    ...(dq ? { q: dq } : {}),
    ...(attr ? { attraction_id: attr } : {}),
  }), [tab, day, dq, attr]);

  const load = () => {
    setError(null);
    setRows(null);
    Reservas.list(query)
      .then((r) => setRows(tab === 'upcoming' ? r.filter((x) => x.status !== 'CANCELLED') : r))
      .catch(setError);
  };
  useEffect(load, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { Atracciones.list({ status: 'all', limit: 200 }).then((r) => setAtracciones(r.data)).catch(() => {}); }, []);
  useEffect(() => { if (params.toString()) setParams({}, { replace: true }); }, []); // eslint-disable-line

  const replace = (u) => setRows((list) => list.map((x) => (x.reservation_id === u.reservation_id ? u : x)));

  const confirmPay = async (r) => {
    const ok = await confirm({
      title: 'Confirmar pago',
      message: <>¿Verificaste el pago de <strong>{fmtMoney(r.total_price.total)}</strong> ({PAYMENT[r.payment_method]}) de {r.customer?.name}? La reserva {r.code} pasará a <strong>Confirmada</strong>.</>,
      confirmText: 'Sí, confirmar',
    });
    if (!ok) return;
    setBusy(r.reservation_id);
    try {
      const u = await Reservas.confirm(r.reservation_id, newIdempotencyKey());
      if (tab === 'pending') setRows((list) => list.filter((x) => x.reservation_id !== u.reservation_id));
      else replace(u);
      refreshCounts();
      toast(`Reserva ${r.code} confirmada`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };

  const doExport = () => {
    exportXlsx(`reservas-${tab}${day ? `-${day}` : ''}.xlsx`, [{
      name: 'Reservas',
      rows: rows.map((r) => ({
        Código: r.code, Estado: STATUS[r.status]?.label, Atracción: r.attraction.name, Ciudad: r.attraction.city,
        Fecha: r.date, Hora: r.time, Adultos: r.adults, Niños: r.children, Total: r.total_price.total,
        'Método de pago': PAYMENT[r.payment_method], Cliente: r.customer?.name, Email: r.customer?.email, Teléfono: r.customer?.phone,
        Documento: r.customer?.document ?? '', Notas: r.notes ?? '', 'Creada': r.created_at, 'Motivo cancelación': r.cancellation_reason ?? '',
      })),
    }]);
  };

  const totals = useMemo(() => (rows ?? []).reduce((s, r) => ({ pax: s.pax + r.ticket_count, total: s.total + (r.status === 'CANCELLED' ? 0 : r.total_price.total) }), { pax: 0, total: 0 }), [rows]);

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Reservas</h2>
          <p>{rows ? `${rows.length} reserva(s) · ${totals.pax} viajeros · ${fmtMoney(totals.total)}` : 'Cargando…'}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={load}><RefreshCw size={16} /> Refrescar</button>
          <button className="btn" onClick={doExport} disabled={!rows?.length}><Download size={16} /> Exportar Excel</button>
        </div>
      </div>

      <div className="tabs" role="group" aria-label="Filtrar reservas por estado" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" className="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div className="adm-toolbar">
        <div className="input-icon">
          <Search size={18} aria-hidden="true" />
          <input className="input" type="search" maxLength={120} placeholder="Código, cliente o correo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar reservas" data-shortcut-search />
        </div>
        <select className="select" value={attr} onChange={(e) => setAttr(e.target.value)} aria-label="Filtrar por atracción" style={{ maxWidth: 280 }}>
          <option value="">Todas las atracciones</option>
          {atracciones.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="date-nav" role="group" aria-label="Filtrar por día">
          <button className="icon-btn sm" onClick={() => setDay(addDays(day || todayEc(), -1))} aria-label="Día anterior"><ChevronLeft size={18} /></button>
          <span>{day ? fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Todas las fechas'}</span>
          <button className="icon-btn sm" onClick={() => setDay(addDays(day || todayEc(), day ? 1 : 0))} aria-label="Día siguiente"><ChevronRight size={18} /></button>
        </div>
        {day ? <button className="btn btn-ghost btn-sm" onClick={() => setDay('')}>Quitar fecha</button> : <button className="btn btn-ghost btn-sm" onClick={() => setDay(todayEc())}>Hoy</button>}
      </div>

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? <div className="skeleton" style={{ height: 320 }} /> : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay reservas con estos filtros">Prueba con otra pestaña, fecha o término de búsqueda.</EmptyState>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Reservas</caption>
            <thead>
              <tr><th scope="col">Código</th><th scope="col">Salida</th><th scope="col">Atracción</th><th scope="col">Cliente</th><th scope="col" className="num">Pax</th><th scope="col" className="num">Total</th><th scope="col">Pago</th><th scope="col">Estado</th><th scope="col" className="num">Acciones</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reservation_id}>
                  <td><code>{r.code}</code></td>
                  <td className="nowrap"><strong>{fmtDate(r.date, { day: 'numeric', month: 'short' })}</strong><div className="muted tiny">{r.time}</div></td>
                  <td style={{ maxWidth: 240 }}><span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.attraction.name}</span></td>
                  <td><span style={{ fontSize: '0.88rem' }}>{r.customer?.name}</span><div className="muted tiny">{r.customer?.phone}</div></td>
                  <td className="num">{r.ticket_count}</td>
                  <td className="num">{fmtMoney(r.total_price.total)}</td>
                  <td className="small">{PAYMENT[r.payment_method]}</td>
                  <td><StatusBadge status={estadoVisible(r)} /></td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn sm" onClick={() => setDetail(r)} aria-label={`Ver ${r.code}`} data-tip="Ver detalle"><Eye size={17} /></button>
                      {r.status === 'PENDING' && (
                        <button className="icon-btn sm" style={{ color: 'var(--success)' }} onClick={() => confirmPay(r)} disabled={busy === r.reservation_id} aria-label={`Confirmar pago de ${r.code}`} data-tip="Confirmar pago">
                          {busy === r.reservation_id ? <Spinner /> : <CheckCircle2 size={17} />}
                        </button>
                      )}
                      {r.status === 'CONFIRMED' && !r.checked_in_at && r.date >= todayEc() && (
                        <button className="icon-btn sm" style={{ color: 'var(--brand, #0f766e)' }} onClick={() => setCheckin(r)} aria-label={`Check-in de ${r.code}`} data-tip="Check-in">
                          <UserCheck size={17} />
                        </button>
                      )}
                      {r.status !== 'CANCELLED' && !r.checked_in_at && r.date >= todayEc() && (
                        <button className="icon-btn sm" style={{ color: 'var(--danger)' }} onClick={() => setCancel(r)} aria-label={`Cancelar ${r.code}`} data-tip="Cancelar"><XCircle size={17} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <ReservationDetailModal r={detail} onClose={() => setDetail(null)} />}
      {checkin && (
        <CheckinModal
          r={checkin}
          onClose={() => setCheckin(null)}
          onDone={(u) => {
            replace({ ...checkin, checked_in_at: u.hora_checkin });
            setCheckin(null);
            toast(`Check-in de ${u.titular_nombre} registrado`, 'success');
          }}
        />
      )}
      {cancel && (
        <CancelModal
          staff
          reservation={cancel}
          onClose={() => setCancel(null)}
          onDone={(u) => { tab === 'upcoming' || tab === 'pending' ? setRows((l) => l.filter((x) => x.reservation_id !== u.reservation_id)) : replace(u); setCancel(null); refreshCounts(); }}
        />
      )}
    </>
  );
}

/**
 * Check-in presencial: el guía u operador verifica el documento que presenta el titular en el punto de
 * encuentro. Debe coincidir con el registrado en la reserva (misma regla que el contrato v2 con Booking).
 */
function CheckinModal({ r, onClose, onDone }) {
  const [doc, setDoc] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    const d = doc.trim().toUpperCase();
    if (d.length < 5) { setErr('Escribe el número de documento que presenta el titular'); return; }
    setSaving(true);
    setErr(null);
    try {
      onDone(await Reservas.checkin(r.reservation_id, d));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Check-in · ${r.code}`}
      description={`${r.attraction.name} · ${fmtDate(r.date, { day: 'numeric', month: 'long' })} ${r.time}`}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="checkin-form" disabled={saving}>{saving && <Spinner />} Registrar llegada</button></>}
    >
      <form id="checkin-form" onSubmit={enviar} className="stack" noValidate>
        <p>Titular: <strong>{r.customer?.name}</strong> · {r.ticket_count} {r.ticket_count === 1 ? 'persona' : 'personas'}</p>
        <Field label="Documento que presenta el titular" required error={err} hint={r.customer?.document ? 'Cédula, pasaporte o RUC: debe coincidir con el registrado en la reserva' : `Esta reserva no tiene documento registrado: verifica que el voucher del cliente diga ${r.code}`}>
          {(p) => <input {...p} className="input" autoComplete="off" maxLength={20} value={doc} onChange={(e) => setDoc(e.target.value.replace(/[^0-9A-Za-z]/g, ''))} autoFocus />}
        </Field>
        <Alert tone="info">Al registrar el check-in la reserva ya no se puede cancelar.</Alert>
      </form>
    </Modal>
  );
}

