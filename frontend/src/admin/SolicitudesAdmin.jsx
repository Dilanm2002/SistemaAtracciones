import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Mail, MapPin, Phone, XCircle } from 'lucide-react';
import { Proveedores } from '../api/client';
import { EmptyState, ErrorState, Field, Modal, Spinner, useConfirm } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { fmtDateTime } from '../utils/format';
import { texto } from '../utils/validation';

const ESTADOS = [
  ['PENDIENTE', 'Pendientes'],
  ['APROBADA', 'Aprobadas'],
  ['RECHAZADA', 'Rechazadas'],
  ['', 'Todas'],
];
const BADGE = { PENDIENTE: 'badge-warning', APROBADA: 'badge-success', RECHAZADA: 'badge-danger' };

/**
 * Empresas que piden vender sus tours y paquetes. Al aprobar se crea la empresa (operador)
 * y la persona que solicitó pasa a tener el rol OPERADOR; al rechazar, ve el motivo.
 */
export default function SolicitudesAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [estado, setEstado] = useState('PENDIENTE');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [rechazando, setRechazando] = useState(null);

  const load = () => {
    setError(null);
    setRows(null);
    Proveedores.list(estado || undefined).then((r) => setRows(r.rows)).catch(setError);
  };
  useEffect(load, [estado]);

  const aprobar = async (s) => {
    const ok = await confirm({
      title: '¿Aprobar a esta empresa?',
      message: <>Se creará <strong>{s.empresa}</strong> (RUC {s.ruc}) como empresa operadora y <strong>{s.solicitante}</strong> podrá subir sus tours y paquetes. Cada experiencia que suba pasará por tu revisión antes de publicarse.</>,
      confirmText: 'Aprobar empresa',
    });
    if (!ok) return;
    try {
      const u = await Proveedores.aprobar(s.id);
      toast(`${s.empresa} ya es operadora (código ${u.operador_codigo})`, 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Solicitudes de empresas</h2>
          <p>Agencias y operadores que quieren vender sus tours y paquetes en Descubre EC.</p>
        </div>
      </div>
      <div className="adm-toolbar">
        <div className="segmented" role="group" aria-label="Estado de la solicitud">
          {ESTADOS.map(([k, l]) => <button key={k || 'todas'} aria-pressed={estado === k} onClick={() => setEstado(k)}>{l}</button>)}
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={load} /> : !rows ? (
        <div className="card card-pad"><Spinner label="Cargando solicitudes…" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Building2} title={estado === 'PENDIENTE' ? 'No hay solicitudes pendientes' : 'No hay solicitudes en este estado'} />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {rows.map((s) => (
            <article key={s.id} className="card card-pad">
              <div className="row-between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{s.empresa}</h3>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>RUC {s.ruc} · solicitada {fmtDateTime(s.creado_en)} por <strong>{s.solicitante}</strong> ({s.solicitante_correo})</p>
                </div>
                <span className={`badge ${BADGE[s.estado]}`}>{s.estado === 'PENDIENTE' ? 'Pendiente' : s.estado === 'APROBADA' ? `Aprobada · código ${s.operador_codigo}` : 'Rechazada'}</span>
              </div>
              <p style={{ margin: '12px 0' }}>{s.descripcion}</p>
              <div className="row small muted" style={{ gap: 18, flexWrap: 'wrap' }}>
                <span><MapPin size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {s.provincia}{s.direccion ? ` · ${s.direccion}` : ''}</span>
                <span><Mail size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {s.correo}</span>
                <span><Phone size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {s.telefono}</span>
              </div>
              {s.estado === 'RECHAZADA' && s.motivo_rechazo && <p className="adm-card-reject"><strong>Motivo:</strong> {s.motivo_rechazo}</p>}
              {s.estado === 'PENDIENTE' && (
                <div className="row" style={{ gap: 10, marginTop: 14 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => aprobar(s)}><CheckCircle2 size={16} /> Aprobar empresa</button>
                  <button className="btn btn-sm" onClick={() => setRechazando(s)}><XCircle size={16} /> Rechazar</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {rechazando && <RechazarModal s={rechazando} onClose={() => setRechazando(null)} onDone={() => { setRechazando(null); load(); }} />}
    </>
  );
}

function RechazarModal({ s, onClose, onDone }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    const e1 = texto(motivo, { min: 10, max: 500, que: 'El motivo' });
    setErr(e1);
    if (e1) return;
    setSaving(true);
    try {
      await Proveedores.rechazar(s.id, motivo.trim());
      toast(`Solicitud de ${s.empresa} rechazada`, 'info');
      onDone();
    } catch (e2) { setErr(e2.message); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Rechazar solicitud" description={s.empresa}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-danger" form="rechazar-sol" disabled={saving}>{saving && <Spinner />} Rechazar</button></>}>
      <form id="rechazar-sol" onSubmit={enviar} noValidate>
        <Field label="Motivo (lo verá la empresa)" required error={err} hint="Explica qué falta o qué debe corregir para volver a solicitar.">
          {(p) => <textarea {...p} className="textarea" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Adjunta el registro de turismo del Ministerio." style={{ minHeight: 110 }} />}
        </Field>
      </form>
    </Modal>
  );
}
