import { useRef, useState } from 'react';
import { Building2, ImagePlus, Map, Pencil, Plus, Trash2 } from 'lucide-react';
import { Categorias, Destinos, Operadores, Uploads } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { EmptyState, ErrorState, Field, Modal, Spinner, Switch, useAsync, useConfirm } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { REGION } from '../utils/format';
import { CATEGORY_ICONS, CategoryIcon } from '../utils/icons';

/** Hook común: activar/desactivar y eliminar con confirmación y mensajes claros. */
function useCatalogActions(api, setData, noun) {
  const toast = useToast();
  const confirm = useConfirm();
  const toggle = async (item, field) => {
    try {
      const u = await api.update(item.id, { [field]: !item[field] });
      setData((d) => d.map((x) => (x.id === item.id ? { ...x, ...u } : x)));
      toast(`${noun} ${u[field] ? 'activado/a' : 'desactivado/a'}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (item) => {
    if (!(await confirm({ title: `¿Eliminar ${noun.toLowerCase()}?`, message: <>Se eliminará <strong>{item.nombre}</strong>. Esta acción no se puede deshacer.</>, confirmText: 'Eliminar', danger: true }))) return;
    try {
      await api.remove(item.id);
      setData((d) => d.filter((x) => x.id !== item.id));
      toast(`${noun} eliminado/a`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  return { toggle, remove };
}

// ── Categorías ───────────────────────────────────────────────────────────
function IconPicker({ value, onChange }) {
  return (
    <div className="chip-row" role="radiogroup" aria-label="Ícono">
      {Object.keys(CATEGORY_ICONS).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className="chip" aria-pressed={value === k} onClick={() => onChange(k)} aria-label={k} style={{ padding: '0 10px' }}>
          <CategoryIcon name={k} size={18} />
        </button>
      ))}
    </div>
  );
}

function CategoriaModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre: item.nombre, slug: item.slug, icono: item.icono, descripcion: item.descripcion ?? '', orden: item.orden });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (f.nombre.trim().length < 2) { setErr({ nombre: 'Mínimo 2 caracteres' }); return; }
    setSaving(true);
    try {
      const u = await Categorias.update(item.id, { ...f, orden: Number(f.orden) });
      toast('Categoría actualizada', 'success');
      onSaved(u);
    } catch (e2) { setErr({ ...e2.fieldErrors, api: e2.message }); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Editar categoría" footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="cat-form" disabled={saving}>{saving && <Spinner />} Guardar</button></>}>
      <form id="cat-form" onSubmit={save} className="stack" noValidate>
        {err.api && <p className="error-text">{err.api}</p>}
        <Field label="Nombre" required error={err.nombre}>{(p) => <input {...p} className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />}</Field>
        <Field label="Slug (identificador en la API)" hint="Cambiarlo afecta los enlaces y filtros existentes" error={err.slug}>{(p) => <input {...p} className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />}</Field>
        <div className="field"><span className="label">Ícono</span><IconPicker value={f.icono} onChange={(icono) => setF({ ...f, icono })} /></div>
        <Field label="Descripción">{(p) => <input {...p} className="input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />}</Field>
        <Field label="Orden de aparición" hint="Menor número = aparece primero">{(p) => <input {...p} className="input" type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

export function CategoriasAdmin() {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useAsync(() => Categorias.list(true), []);
  const [form, setForm] = useState({ nombre: '', icono: 'trees', descripcion: '' });
  const [formErr, setFormErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const { toggle, remove } = useCatalogActions(Categorias, setData, 'Categoría');

  const create = async (e) => {
    e.preventDefault();
    if (form.nombre.trim().length < 2) { setFormErr('Escribe el nombre de la categoría'); return; }
    try {
      const c = await Categorias.create({ ...form, nombre: form.nombre.trim(), orden: (data?.length ?? 0) + 1 });
      setData((d) => [...d, { ...c, total_atracciones: 0 }]);
      setForm({ nombre: '', icono: 'trees', descripcion: '' });
      setFormErr(null);
      toast(`Categoría "${c.nombre}" creada`, 'success');
    } catch (e2) { setFormErr(e2.message); }
  };

  return (
    <>
      <div className="adm-module-head"><div><h2>Categorías</h2><p>Agrupan las experiencias en el buscador y en el inicio.</p></div></div>
      <form className="inline-form" onSubmit={create} noValidate>
        <Field label="Nueva categoría" error={formErr}>{(p) => <input {...p} className="input" placeholder="Ej. Bienestar y termas" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />}</Field>
        <Field label="Descripción (opcional)">{(p) => <input {...p} className="input" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />}</Field>
        <div className="field" style={{ flexBasis: '100%' }}><span className="label">Ícono</span><IconPicker value={form.icono} onChange={(icono) => setForm({ ...form, icono })} /></div>
        <button className="btn btn-primary"><Plus size={18} /> Crear categoría</button>
      </form>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ícono</th><th>Nombre</th><th>Slug</th><th className="num">Atracciones</th><th className="num">Orden</th><th>Visible</th><th className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><span className="adm-kpi-icon brand" style={{ width: 36, height: 36 }}><CategoryIcon name={c.icono} size={18} /></span></td>
                  <td><strong>{c.nombre}</strong>{c.descripcion && <div className="muted tiny">{c.descripcion}</div>}</td>
                  <td><code>{c.slug}</code></td>
                  <td className="num">{c.total_atracciones}</td>
                  <td className="num">{c.orden}</td>
                  <td><Switch checked={c.activa} onChange={() => toggle(c, 'activa')} label={<span className="sr-only">Visible</span>} /></td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn sm" onClick={() => setEditing(c)} aria-label={`Editar ${c.nombre}`}><Pencil size={16} /></button>
                      <button className="icon-btn sm" style={{ color: 'var(--danger)' }} onClick={() => remove(c)} aria-label={`Eliminar ${c.nombre}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <CategoriaModal item={editing} onClose={() => setEditing(null)} onSaved={(u) => { setData((d) => d.map((x) => (x.id === u.id ? { ...x, ...u } : x))); setEditing(null); }} />}
    </>
  );
}

// ── Destinos ─────────────────────────────────────────────────────────────
function DestinoModal({ item, nextCode, onClose, onSaved }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [f, setF] = useState(item ? { ...item } : { codigo: nextCode, nombre: '', provincia: '', region: 'SIERRA', descripcion: '', imagen: '', latitud: '', longitud: '', activo: true });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!(Number(f.codigo) >= 1)) errs.codigo = 'Número entero mayor a 0';
    if (f.nombre.trim().length < 2) errs.nombre = 'Escribe el nombre';
    if (f.provincia.trim().length < 2) errs.provincia = 'Escribe la provincia';
    if (f.latitud === '' || Math.abs(f.latitud) > 90) errs.latitud = 'Entre -90 y 90';
    if (f.longitud === '' || Math.abs(f.longitud) > 180) errs.longitud = 'Entre -180 y 180';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = { codigo: Number(f.codigo), nombre: f.nombre.trim(), provincia: f.provincia.trim(), region: f.region, descripcion: f.descripcion || undefined, imagen: f.imagen || undefined, latitud: Number(f.latitud), longitud: Number(f.longitud), activo: f.activo };
    try {
      const saved = item ? await Destinos.update(item.id, body) : await Destinos.create(body);
      toast(item ? 'Destino actualizado' : 'Destino creado', 'success');
      onSaved(saved);
    } catch (e2) { setErr({ ...e2.fieldErrors, api: e2.message }); } finally { setSaving(false); }
  };

  const upload = async (file) => {
    setUploading(true);
    try { const r = await Uploads.image(file); setF((p) => ({ ...p, imagen: r.url })); } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
  };

  return (
    <Modal open onClose={onClose} size="modal-lg" title={item ? 'Editar destino' : 'Nuevo destino'} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="dst-form" disabled={saving || uploading}>{saving && <Spinner />} Guardar</button></>}>
      <form id="dst-form" onSubmit={save} className="form-grid" noValidate>
        {err.api && <p className="error-text span-2">{err.api}</p>}
        <Field label="Nombre" required error={err.nombre}>{(p) => <input {...p} className="input" value={f.nombre} onChange={set('nombre')} />}</Field>
        <Field label="Provincia" required error={err.provincia}>{(p) => <input {...p} className="input" value={f.provincia} onChange={set('provincia')} />}</Field>
        <Field label="Región" required>{(p) => <select {...p} className="select" value={f.region} onChange={set('region')}>{Object.entries(REGION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
        <Field label="Código de ciudad (API)" required error={err.codigo} hint="ID numérico usado en el contrato: cities / location.city">{(p) => <input {...p} className="input" type="number" min="1" value={f.codigo} onChange={set('codigo')} />}</Field>
        <Field label="Latitud" required error={err.latitud}>{(p) => <input {...p} className="input" type="number" step="0.0001" value={f.latitud} onChange={set('latitud')} />}</Field>
        <Field label="Longitud" required error={err.longitud}>{(p) => <input {...p} className="input" type="number" step="0.0001" value={f.longitud} onChange={set('longitud')} />}</Field>
        <Field label="Descripción" className="span-2">{(p) => <textarea {...p} className="textarea" style={{ minHeight: 80 }} value={f.descripcion ?? ''} onChange={set('descripcion')} />}</Field>
        <div className="field span-2">
          <span className="label">Imagen de portada</span>
          <div className="photo-list">
            {f.imagen && <div className="photo-thumb"><img src={f.imagen} alt="Portada del destino" onError={onImgError} /></div>}
            <button type="button" className="photo-add" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Spinner /> : <ImagePlus size={22} />} {f.imagen ? 'Cambiar' : 'Subir imagen'}</button>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          </div>
        </div>
        <div className="span-2"><Switch checked={f.activo} onChange={(v) => setF({ ...f, activo: v })} label="Visible en el sitio" /></div>
      </form>
    </Modal>
  );
}

export function DestinosAdmin() {
  const { data, loading, error, reload, setData } = useAsync(() => Destinos.list(true), []);
  const [editing, setEditing] = useState(null);
  const { toggle, remove } = useCatalogActions(Destinos, setData, 'Destino');
  const nextCode = Math.max(0, ...(data ?? []).map((d) => d.codigo)) + 1;

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Destinos</h2><p>Ciudades y zonas donde operan las experiencias. El código es el <em>city ID</em> del contrato.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> Nuevo destino</button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.length === 0 ? <EmptyState icon={Map} title="Sin destinos" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Destino</th><th>Región</th><th className="num">Código</th><th className="num">Atracciones</th><th>Visible</th><th className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <img src={d.imagen} alt="" width="56" height="42" style={{ objectFit: 'cover', borderRadius: 8 }} onError={onImgError} />
                      <div><strong>{d.nombre}</strong><div className="muted tiny">{d.provincia}</div></div>
                    </div>
                  </td>
                  <td><span className="badge badge-primary">{REGION[d.region]}</span></td>
                  <td className="num">{d.codigo}</td>
                  <td className="num">{d.total_atracciones}</td>
                  <td><Switch checked={d.activo} onChange={() => toggle(d, 'activo')} label={<span className="sr-only">Visible</span>} /></td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn sm" onClick={() => setEditing(d)} aria-label={`Editar ${d.nombre}`}><Pencil size={16} /></button>
                      <button className="icon-btn sm" style={{ color: 'var(--danger)' }} onClick={() => remove(d)} aria-label={`Eliminar ${d.nombre}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <DestinoModal
          item={editing === 'new' ? null : editing}
          nextCode={nextCode}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

// ── Operadores ───────────────────────────────────────────────────────────
function OperadorModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(item ? { nombre: item.nombre, ruc: item.ruc ?? '', email: item.email ?? '', telefono: item.telefono ?? '', activo: item.activo } : { nombre: '', ruc: '', email: '', telefono: '', activo: true });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (f.nombre.trim().length < 2) errs.nombre = 'Escribe el nombre comercial';
    if (f.ruc && !/^\d{13}$/.test(f.ruc)) errs.ruc = 'El RUC tiene 13 dígitos';
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) errs.email = 'Correo no válido';
    if (f.telefono && !/^\+?\d{7,15}$/.test(f.telefono)) errs.telefono = '7 a 15 dígitos';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = { nombre: f.nombre.trim(), activo: f.activo, ...(f.ruc ? { ruc: f.ruc } : {}), ...(f.email ? { email: f.email } : {}), ...(f.telefono ? { telefono: f.telefono } : {}) };
    try {
      const saved = item ? await Operadores.update(item.id, body) : await Operadores.create(body);
      toast(item ? 'Operador actualizado' : `Operador creado con código ${saved.codigo}`, 'success');
      onSaved(saved);
    } catch (e2) { setErr({ ...e2.fieldErrors, api: e2.message }); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar operador' : 'Nuevo operador'} description={item ? `Código ${item.codigo}` : 'El código se asigna automáticamente'} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="op-form" disabled={saving}>{saving && <Spinner />} Guardar</button></>}>
      <form id="op-form" onSubmit={save} className="stack" noValidate>
        {err.api && <p className="error-text">{err.api}</p>}
        <Field label="Nombre comercial" required error={err.nombre}>{(p) => <input {...p} className="input" value={f.nombre} onChange={set('nombre')} />}</Field>
        <Field label="RUC" error={err.ruc}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={13} value={f.ruc} onChange={set('ruc')} />}</Field>
        <Field label="Correo de reservas" error={err.email}>{(p) => <input {...p} className="input" type="email" value={f.email} onChange={set('email')} />}</Field>
        <Field label="Teléfono" error={err.telefono}>{(p) => <input {...p} className="input" type="tel" value={f.telefono} onChange={set('telefono')} />}</Field>
        <Switch checked={f.activo} onChange={(v) => setF({ ...f, activo: v })} label="Operador activo" />
      </form>
    </Modal>
  );
}

export function OperadoresAdmin() {
  const { data, loading, error, reload, setData } = useAsync(() => Operadores.list(true), []);
  const [editing, setEditing] = useState(null);
  const { toggle, remove } = useCatalogActions(Operadores, setData, 'Operador');
  return (
    <>
      <div className="adm-module-head">
        <div><h2>Operadores</h2><p>Empresas que ejecutan los tours (<code>operator</code> en el contrato).</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> Nuevo operador</button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.length === 0 ? <EmptyState icon={Building2} title="Sin operadores" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th className="num">Código</th><th>Operador</th><th>RUC</th><th>Contacto</th><th className="num">Atracciones</th><th>Activo</th><th className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.codigo}</td>
                  <td><strong>{o.nombre}</strong></td>
                  <td>{o.ruc ?? '—'}</td>
                  <td className="small">{o.email ?? '—'}<br /><span className="muted">{o.telefono}</span></td>
                  <td className="num">{o.total_atracciones}</td>
                  <td><Switch checked={o.activo} onChange={() => toggle(o, 'activo')} label={<span className="sr-only">Activo</span>} /></td>
                  <td>
                    <div className="actions">
                      <button className="icon-btn sm" onClick={() => setEditing(o)} aria-label={`Editar ${o.nombre}`}><Pencil size={16} /></button>
                      <button className="icon-btn sm" style={{ color: 'var(--danger)' }} onClick={() => remove(o)} aria-label={`Eliminar ${o.nombre}`}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <OperadorModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

