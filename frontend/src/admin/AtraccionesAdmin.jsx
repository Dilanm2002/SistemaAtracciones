import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Mountain, Pencil, Plus, Search, Star, Trash2, Users } from 'lucide-react';
import { Atracciones, Categorias, Destinos, Geo, Operadores } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { EmptyState, ErrorState, useConfirm, useDebounce } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { BADGE, fmtDuration, fmtMoney } from '../utils/format';
import AtraccionForm from './AtraccionForm';

/** Tarjeta del catálogo: acciones superpuestas a la foto (hover, foco o toque), como en Sal y Canela. */
function AdminCard({ a, onEdit, onToggle, onDelete }) {
  const [tapped, setTapped] = useState(false);
  return (
    <article
      className={`adm-card ${a.is_active ? '' : 'inactive'} ${tapped ? 'tapped' : ''}`}
      onClick={() => setTapped((t) => !t)}
      onMouseLeave={() => setTapped(false)}
    >
      <div className="adm-card-img">
        <img src={a.photos[0]?.url} alt="" loading="lazy" onError={onImgError} />
        <div className="adm-card-badges">
          {!a.is_active && <span className="badge badge-dark"><EyeOff size={12} /> Oculta</span>}
          {a.featured && <span className="badge badge-cta"><Star size={12} fill="currentColor" /> Destacada</span>}
          {a.badges.slice(0, 1).map((b) => <span key={b} className="badge badge-dark">{BADGE[b]}</span>)}
        </div>
      </div>
      <div className="adm-card-body">
        <h3>{a.name}</h3>
        <div className="adm-card-meta">
          <span className="adm-card-price">{fmtMoney(a.price.total)}</span>
          <span>{fmtDuration(a.duration_hours)}</span>
        </div>
        <div className="adm-card-meta">
          <span><Star size={13} fill="var(--cta)" color="var(--cta)" style={{ verticalAlign: '-2px' }} /> {a.ratings.number_of_reviews ? `${Number(a.ratings.score).toFixed(1)} (${a.ratings.number_of_reviews})` : 'Sin reseñas'}</span>
          <span><Users size={13} style={{ verticalAlign: '-2px' }} /> {a.capacity_per_slot} × {a.times.length}</span>
        </div>
      </div>
      <div className="adm-card-overlay" onClick={(e) => e.stopPropagation()}>
        <button className="adm-ov-btn edit" onClick={onEdit}><Pencil size={16} /> Editar</button>
        <button className="adm-ov-btn ghost" onClick={onToggle}>
          {a.is_active ? <><EyeOff size={16} /> Ocultar del sitio</> : <><Eye size={16} /> Mostrar en el sitio</>}
        </button>
        <Link className="adm-ov-btn ghost" to={`/atraccion/${a.id}`}><Mountain size={16} /> Ver en el sitio</Link>
        <button className="adm-ov-btn del" onClick={onDelete}><Trash2 size={16} /> Eliminar</button>
      </div>
    </article>
  );
}

export default function AtraccionesAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [aux, setAux] = useState({ categorias: [], destinos: [], operadores: [], idiomas: [] });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [cat, setCat] = useState('');
  const [groupBy, setGroupBy] = useState('destino');
  const [editing, setEditing] = useState(params.get('nueva') ? 'new' : null);
  const dq = useDebounce(q, 250);

  const load = () => {
    setError(null);
    Atracciones.list({ status: 'all', limit: 200 }).then((r) => setItems(r.data)).catch(setError);
  };
  useEffect(() => {
    load();
    Promise.all([Categorias.list(true), Destinos.list(true), Operadores.list(true), Geo.idiomas()])
      .then(([categorias, destinos, operadores, idiomas]) => setAux({ categorias, destinos, operadores, idiomas }))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    return (items ?? []).filter((a) =>
      (status === 'all' || (status === 'active' ? a.is_active : !a.is_active)) &&
      (!cat || a.categories.includes(cat)) &&
      (!term || a.name.toLowerCase().includes(term) || a.destination?.name.toLowerCase().includes(term)),
    );
  }, [items, dq, status, cat]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of filtered) {
      const keys = groupBy === 'destino' ? [a.destination?.name ?? 'Sin destino'] : a.categories.map((s) => aux.categorias.find((c) => c.slug === s)?.nombre ?? s).slice(0, 1);
      for (const k of keys) map.set(k, [...(map.get(k) ?? []), a]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [filtered, groupBy, aux.categorias]);

  const toggleActive = async (a) => {
    try {
      const u = await Atracciones.update(a.id, { is_active: !a.is_active });
      setItems((list) => list.map((x) => (x.id === a.id ? u : x)));
      toast(u.is_active ? `"${a.name}" ahora es visible` : `"${a.name}" se ocultó del sitio`, 'success', {
        action: { label: 'Deshacer', onClick: () => toggleActive(u) },
      });
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (a) => {
    const ok = await confirm({
      title: '¿Eliminar atracción?',
      message: <>Se eliminará <strong>{a.name}</strong> del catálogo. Si tiene reservas próximas no podrá eliminarse; en ese caso, desactívala.</>,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await Atracciones.remove(a.id);
      setItems((list) => list.filter((x) => x.id !== a.id));
      toast(`"${a.name}" eliminada`, 'success');
    } catch (e) {
      toast(e.message, 'error', { action: e.status === 409 ? { label: 'Desactivar', onClick: () => toggleActive(a) } : undefined });
    }
  };

  const closeForm = () => { setEditing(null); if (params.get('nueva')) setParams({}); };

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Catálogo de atracciones</h2>
          <p>{items ? `${items.filter((a) => a.is_active).length} activas · ${items.filter((a) => !a.is_active).length} inactivas` : 'Cargando…'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> Agregar atracción</button>
      </div>

      <div className="adm-toolbar">
        <div className="input-icon">
          <Search size={18} aria-hidden="true" />
          <input className="input" type="search" placeholder="Buscar por nombre o destino" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar atracciones" data-shortcut-search />
        </div>
        <div className="segmented" role="group" aria-label="Estado">
          {[['all', 'Todas'], ['active', 'Activas'], ['inactive', 'Inactivas']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {aux.categorias.map((c) => <option key={c.id} value={c.slug}>{c.nombre}</option>)}
        </select>
        <select className="select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Agrupar por">
          <option value="destino">Agrupar por destino</option>
          <option value="categoria">Agrupar por categoría principal</option>
        </select>
      </div>

      <p className="adm-card-hint">Pasa el mouse sobre una tarjeta (o tócala en el celular) para editar, ocultar o eliminar.</p>

      {error ? <ErrorState error={error} onRetry={load} /> : !items ? (
        <div className="adm-card-grid">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 280, borderRadius: 12 }} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Mountain} title={items.length ? 'Ninguna atracción coincide con los filtros' : 'Aún no hay atracciones'} action={items.length ? <button className="btn" onClick={() => { setQ(''); setStatus('all'); setCat(''); }}>Limpiar filtros</button> : <button className="btn btn-primary" onClick={() => setEditing('new')}>Crear la primera</button>} />
      ) : (
        groups.map(([name, list]) => (
          <section key={name} className="adm-group" aria-label={name}>
            <div className="adm-group-title">{name}<span className="adm-group-count">{list.length}</span></div>
            <div className="adm-card-grid">
              {list.map((a) => (
                <AdminCard key={a.id} a={a} onEdit={() => setEditing(a)} onToggle={() => toggleActive(a)} onDelete={() => remove(a)} />
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
    </>
  );
}
