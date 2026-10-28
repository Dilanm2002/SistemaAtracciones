import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Clock3, Compass, Copy, ListChecks, Printer } from 'lucide-react';
import { Reservas } from '../api/client';
import AnadirCalendario from '../components/AnadirCalendario';
import Factura from '../components/Factura';
import VoucherQr from '../components/VoucherQr';
import { Alert, ErrorState, Spinner, StatusBadge, usePageTitle } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { estadoVisible, fmtDateLong, fmtDateTime, fmtMoney, participantes, PAYMENT } from '../utils/format';

export default function Confirmation() {
  const { id } = useParams();
  const { state } = useLocation();
  const toast = useToast();
  const [r, setR] = useState(state?.reservation ?? null);
  const [error, setError] = useState(null);
  const [verCalendario, setVerCalendario] = useState(false);
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
      {/* Solo en papel: la cabecera del sitio no se imprime, así el comprobante lleva su propia marca */}
      <div className="solo-impresion impresion-cab">
        <strong>Descubre<span>EC</span></strong>
        <span>Comprobante de reserva · {r.code}</span>
      </div>
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
          <button className="icon-btn sm no-print" onClick={copy} aria-label="Copiar código"><Copy size={18} /></button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{r.attraction.name}</h2>
          <StatusBadge status={estadoVisible(r)} />
        </div>
        <dl className="detail-list">
          <dt>Fecha</dt><dd>{fmtDateLong(r.date)}</dd>
          <dt>Hora de salida</dt><dd>{r.time}</dd>
          <dt>Punto de encuentro</dt><dd>{r.attraction.meeting_point}</dd>
          <dt>Participantes</dt><dd>{participantes(r)}</dd>
          <dt>Titular</dt><dd>{r.customer?.name}</dd>
          <dt>Método de pago</dt><dd>{PAYMENT[r.payment_method]}</dd>
          <dt>Total</dt><dd><strong>{fmtMoney(r.total_price.total)}</strong></dd>
        </dl>
        <VoucherQr r={r} />
        <Factura invoice={r.invoice} />
        {r.status !== 'CANCELLED' && (
          <div style={{ marginTop: 16 }}>
            {r.cancellation_policy === 'NO_CHARGE' ? (
              <Alert tone="info">Aún no has pagado: puedes cancelar sin costo desde "Mis reservas" hasta 1 hora antes de la salida.</Alert>
            ) : r.cancellation_policy === 'FULL_REFUND' ? (
              <Alert tone="success">Puedes cancelar gratis desde "Mis reservas" hasta el {fmtDateTime(r.free_cancellation_until)}.</Alert>
            ) : (
              <Alert tone="warning">Esta reserva ya no tiene cancelación gratuita: si cancelas, se libera tu cupo pero sin reembolso.</Alert>
            )}
          </div>
        )}
      </div>

      <div className="row no-print" style={{ justifyContent: 'center', marginTop: 24 }}>
        <button className="btn" onClick={() => setVerCalendario(true)}><CalendarPlus size={18} /> Añadir a mi calendario</button>
        <button className="btn" onClick={() => window.print()}><Printer size={18} /> Imprimir</button>
        <Link to="/mis-reservas" className="btn btn-primary"><ListChecks size={18} /> Ver mis reservas</Link>
        <Link to="/explorar" className="btn btn-ghost"><Compass size={18} /> Seguir explorando</Link>
      </div>
      <AnadirCalendario r={r} open={verCalendario} onClose={() => setVerCalendario(false)} />
    </div>
  );
}
