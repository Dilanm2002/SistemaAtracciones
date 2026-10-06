import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Eye, EyeOff, Mountain, Pencil, Plus, Search, Star, Trash2, Users, XCircle } from 'lucide-react';
import { Atracciones, Categorias, Destinos, Geo, Operadores } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { Alert, EmptyState, ErrorState, Field, Modal, Spinner, useConfirm, useDebounce } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { BADGE, badgeCls, insigniasTarjeta, fmtDuration, fmtMoney } from '../utils/format';
import { texto } from '../utils/validation';
import AtraccionForm from './AtraccionForm';
import { fotoProps, SIZES } from '../utils/fotos';

/** Estados de revisión (migración 006): lo que sube una empresa pasa por el administrador. */
export const ESTADO = {
  PUBLICADA: { label: 'Publicada', cls: 'badge-success' },
  EN_REVISION: { label: 'En revisión', cls: 'badge-warning' },
  RECHAZADA: { label: 'Rechazada', cls: 'badge-danger' },
  INACTIVA: { label: 'Pausada', cls: 'badge-dark' },
  BORRADOR: { label: 'Borrador', cls: 'badge-dark' },
};
const aprobada = (a) => a.status === 'PUBLICADA' || a.status === 'INACTIVA';

/** Tarjeta del catálogo: acciones superpuestas a la foto (hover, foco o toque), como en Sal y Canela. */
function AdminCard({ a, isAdmin, onEdit, onToggle, onDelete, onApprove, onReject }) {
  const [tapped, setTapped] = useState(false);
  const est = ESTADO[a.status] ?? ESTADO.BORRADOR;
  return (
    <article
      className={`adm-card ${a.is_active ? '' : 'inactive'} ${tapped ? 'tapped' : ''}`}
      onClick={() => setTapped((t) => !t)}
      onMouseLeave={() => setTapped(false)}
    >
      <div className="adm-card-img">
        <img {...fotoProps(a.photos[0]?.url, SIZES.tarjeta)} alt="" loading="lazy" decoding="async" onError={onImgError} />
        <div className="adm-card-badges">
          {a.status !== 'PUBLICADA' && <span className={`badge ${est.cls}`}>{a.status === 'EN_REVISION' ? <Clock size={12} /> : a.status === 'RECHAZADA' ? <XCircle size={12} /> : <EyeOff size={12} />} {est.label}</span>}
          {a.featured && <span className="badge badge-cta"><Star size={12} fill="currentColor" /> Destacada</span>}
          {insigniasTarjeta(a.badges).map((b) => <span key={b} className={`badge ${badgeCls(b, 'badge-dark')}`}>{BADGE[b]}</span>)}
        </div>
      </div>
      <div className="adm-card-body">
        <h3>{a.name}</h3>
        {isAdmin && <p className="muted small" style={{ margin: '-2px 0 6px' }}>{a.operator?.name}</p>}
        <div className="adm-card-meta">
          <span className="adm-card-price">{fmtMoney(a.price.total)}</span>
          <span>{fmtDuration(a.duration_hours)}</span>
        </div>
        <div className="adm-card-meta">
          <span><Star size={13} fill="var(--cta)" color="var(--cta)" style={{ verticalAlign: '-2px' }} /> {a.ratings.number_of_reviews ? `${Number(a.ratings.score).toFixed(1)} (${a.ratings.number_of_reviews})` : 'Sin reseñas'}</span>
          <span><Users size={13} style={{ verticalAlign: '-2px' }} /> {a.capacity_per_slot} × {a.times.length}</span>
        </div>
        {a.status === 'RECHAZADA' && a.rejection_reason && (
          <p className="adm-card-reject"><strong>Motivo del rechazo:</strong> {a.rejection_reason}</p>
        )}
      </div>
      <div className="adm-card-overlay" onClick={(e) => e.stopPropagation()}>
        {isAdmin && a.status === 'EN_REVISION' && (
          <>
            <button className="adm-ov-btn edit" onClick={onApprove}><CheckCircle2 size={16} /> Aprobar y publicar</button>
            <button className="adm-ov-btn del" onClick={onReject}><XCircle size={16} /> Rechazar</button>
          </>
        )}
        <button className={`adm-ov-btn ${isAdmin && a.status === 'EN_REVISION' ? 'ghost' : 'edit'}`} onClick={onEdit}>
          <Pencil size={16} /> {a.status === 'RECHAZADA' && !isAdmin ? 'Corregir y reenviar' : isAdmin && a.status === 'EN_REVISION' ? 'Revisar detalle' : 'Editar'}
        </button>
        {aprobada(a) && (
          <button className="adm-ov-btn ghost" onClick={onToggle}>
            {a.is_active ? <><EyeOff size={16} /> Pausar (ocultar)</> : <><Eye size={16} /> Reactivar</>}
          </button>
        )}
        {a.status === 'PUBLICADA' && <Link className="adm-ov-btn ghost" to={`/atraccion/${a.id}`}><Mountain size={16} /> Ver en el sitio</Link>}
        <button className="adm-ov-btn del" onClick={onDelete}><Trash2 size={16} /> Eliminar</button>
      </div>
    </article>
  );
}

/** El administrador explica qué debe corregir la empresa (lo verá en su panel). */
function RechazoModal({ a, onClose, onDone }) {
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
      const u = await Atracciones.review(a.id, 'REJECT', motivo.trim());
      toast(`"${a.name}" se devolvió a la empresa con el motivo`, 'info');
      onDone(u);
    } catch (e2) { setErr(e2.message); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Rechazar experiencia" description={a.name}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-danger" form="rechazo-form" disabled={saving}>{saving && <Spinner />} Rechazar</button></>}>
      <form id="rechazo-form" onSubmit={enviar} noValidate>
        <Field label="¿Qué debe corregir la empresa?" required error={err} hint="Lo verá el operador en su panel. Entre 10 y 500 caracteres.">
          {(p) => <textarea {...p} className="textarea" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Las fotos no corresponden al lugar; sube fotos propias del tour." style={{ minHeight: 110 }} />}
        </Field>
      </form>
    </Modal>
  );
}

const FILTROS = [
  ['all', 'Todas'],
  ['PUBLICADA', 'Publicadas'],
  ['EN_REVISION', 'En revisión'],
  ['RECHAZADA', 'Rechazadas'],
  ['INACTIVA', 'Pausadas'],
];

export default function AtraccionesAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [aux, setAux] = useState({ categorias: [], destinos: [], operadores: [], idiomas: [] });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('estado') ?? 'all');
  const [cat, setCat] = useState('');
  const [groupBy, setGroupBy] = useState('destino');
  const [editing, setEditing] = useState(params.get('nueva') ? 'new' : null);
  const [rechazando, setRechazando] = useState(null);
  const dq = useDebounce(q, 250);

  const load = () => {
    setError(null);
    // Con status, el operador recibe solo las experiencias de su empresa
    Atracciones.list({ status: 'all', limit: 200 }).then((r) => setItems(r.data)).catch(setError);
  };
  useEffect(() => {
    load();
    Promise.all([Categorias.list(isAdmin), Destinos.list(isAdmin), Operadores.list(isAdmin), Geo.idiomas()])
      .then(([categorias, destinos, operadores, idiomas]) => setAux({ categorias, destinos, operadores, idiomas }))
      .catch(() => {});
  }, [isAdmin]);

  const cuenta = (s) => (items ?? []).filter((a) => a.status === s).length;

  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    return (items ?? []).filter((a) =>
      (status === 'all' || a.status === status) &&
      (!cat || a.categories.includes(cat)) &&
      (!term || a.name.toLowerCase().includes(term) || a.destination?.name.toLowerCase().includes(term) || a.operator?.name.toLowerCase().includes(term)),
    );
  }, [items, dq, status, cat]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of filtered) {
      const keys = groupBy === 'destino' ? [a.destination?.name ?? 'Sin destino'] : groupBy === 'empresa' ? [a.operator?.name ?? 'Sin empresa'] : a.categories.map((s) => aux.categorias.find((c) => c.slug === s)?.nombre ?? s).slice(0, 1);
      for (const k of keys) map.set(k, [...(map.get(k) ?? []), a]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [filtered, groupBy, aux.categorias]);

  const reemplazar = (u) => setItems((list) => list.map((x) => (x.id === u.id ? u : x)));

  const toggleActive = async (a) => {
    try {
      const u = await Atracciones.update(a.id, { is_active: !a.is_active });
      reemplazar(u);
      toast(u.is_active ? `"${a.name}" está visible otra vez` : `"${a.name}" se pausó (no se muestra en el sitio)`, 'success', {
        action: { label: 'Deshacer', onClick: () => toggleActive(u) },
      });
    } catch (e) { toast(e.message, 'error'); }
  };

  const aprobar = async (a) => {
    const ok = await confirm({ title: '¿Aprobar y publicar?', message: <>Se publicará <strong>{a.name}</strong> de {a.operator?.name} y los viajeros podrán reservarla.</>, confirmText: 'Aprobar y publicar' });
    if (!ok) return;
    try {
      reemplazar(await Atracciones.review(a.id, 'APPROVE'));
      toast(`"${a.name}" publicada`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (a) => {
    const ok = await confirm({
      title: '¿Eliminar atracción?',
      message: <>Se eliminará <strong>{a.name}</strong> del catálogo. Si tiene reservas próximas no podrá eliminarse; en ese caso, páusala.</>,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await Atracciones.remove(a.id);
      setItems((list) => list.filter((x) => x.id !== a.id));
      toast(`"${a.name}" eliminada`, 'success');
    } catch (e) {
      toast(e.message, 'error', { action: e.status === 409 && aprobada(a) ? { label: 'Pausar', onClick: () => toggleActive(a) } : undefined });
    }
  };

  const closeForm = () => { setEditing(null); if (params.get('nueva')) setParams({}); };
  const empresa = aux.operadores.find((o) => o.codigo === user?.operadorCodigo)?.nombre;

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>{isAdmin ? 'Catálogo de atracciones' : 'Mis experiencias'}</h2>
          <p>
            {items ? `${cuenta('PUBLICADA')} publicadas · ${cuenta('EN_REVISION')} en revisión · ${cuenta('RECHAZADA')} rechazadas · ${cuenta('INACTIVA')} pausadas` : 'Cargando…'}
            {!isAdmin && empresa ? ` · ${empresa}` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> {isAdmin ? 'Agregar atracción' : 'Nueva experiencia'}</button>
      </div>

      {!isAdmin && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" title="¿Cómo se publica?">
            Cada tour o paquete que agregues (o corrijas tras un rechazo) pasa a <strong>revisión</strong> del equipo de Descubre EC. Cuando se aprueba aparece en el sitio; si se rechaza, verás el motivo en la tarjeta.
            Una vez aprobada, puedes pausarla y reactivarla cuando quieras.
          </Alert>
        </div>
      )}
      {isAdmin && cuenta('EN_REVISION') > 0 && status !== 'EN_REVISION' && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning" title={`${cuenta('EN_REVISION')} experiencia(s) de empresas esperan revisión`}>
            <button className="btn btn-sm" onClick={() => setStatus('EN_REVISION')}>Ver pendientes</button>
          </Alert>
        </div>
      )}

      <div className="adm-toolbar">
        <div className="input-icon">
          <Search size={18} aria-hidden="true" />
          <input className="input" type="search" maxLength={120} placeholder={isAdmin ? 'Buscar por nombre, destino o empresa' : 'Buscar por nombre o destino'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar atracciones" data-shortcut-search />
        </div>
        <div className="segmented" role="group" aria-label="Estado">
          {FILTROS.map(([k, l]) => (
            <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>
              {l}{k !== 'all' && items ? ` (${cuenta(k)})` : ''}
            </button>
          ))}
        </div>
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {aux.categorias.map((c) => <option key={c.id} value={c.slug}>{c.nombre}</option>)}
        </select>
        <select className="select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Agrupar por">
          <option value="destino">Agrupar por destino</option>
          <option value="categoria">Agrupar por categoría principal</option>
          {isAdmin && <option value="empresa">Agrupar por empresa</option>}
        </select>
      </div>

      <p className="adm-card-hint">Pasa el mouse sobre una tarjeta (o tócala en el celular) para ver sus acciones.</p>

      {error ? <ErrorState error={error} onRetry={load} /> : !items ? (
        <div className="adm-card-grid">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 280, borderRadius: 12 }} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Mountain}
          title={items.length ? 'Ninguna atracción coincide con los filtros' : isAdmin ? 'Aún no hay atracciones' : 'Tu empresa aún no tiene experiencias'}
          action={items.length ? <button className="btn" onClick={() => { setQ(''); setStatus('all'); setCat(''); }}>Limpiar filtros</button> : <button className="btn btn-primary" onClick={() => setEditing('new')}>Crear la primera</button>}
        />
      ) : (
        groups.map(([name, list]) => (
          <section key={name} className="adm-group" aria-label={name}>
            <div className="adm-group-title">{name}<span className="adm-group-count">{list.length}</span></div>
            <div className="adm-card-grid">
              {list.map((a) => (
                <AdminCard key={a.id} a={a} isAdmin={isAdmin} onEdit={() => setEditing(a)} onToggle={() => toggleActive(a)} onDelete={() => remove(a)} onApprove={() => aprobar(a)} onReject={() => setRechazando(a)} />
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <AtraccionForm
          atraccion={editing === 'new' ? null : editing}
          {...aux}
          onClose={closeForm}
          onSaved={(saved, isNew) => {
            setItems((list) => (isNew ? [saved, ...list] : list.map((x) => (x.id === saved.id ? saved : x))));
            closeForm();
          }}
        />
      )}
      {rechazando && <RechazoModal a={rechazando} onClose={() => setRechazando(null)} onDone={(u) => { reemplazar(u); setRechazando(null); }} />}
    </>
  );
}
