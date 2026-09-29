import { useRef, useState } from 'react';
import { Building2, ImagePlus, Map, Pencil, Plus, Trash2 } from 'lucide-react';
import { Categorias, Destinos, Geo, Operadores, Uploads } from '../api/client';
import { FALLBACK_IMG, onImgError } from '../components/AttractionCard';
import { Alert, EmptyState, ErrorState, Field, Modal, RequiredLegend, Spinner, Switch, useAsync, useConfirm } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { REGION } from '../utils/format';
import { correo, LIMITES, limpiar, numero, ruc, telefono, texto } from '../utils/validation';
import { CATEGORY_ICONS, CategoryIcon } from '../utils/icons';

/** Provincias del Ecuador (tabla provincia), agrupadas por región para los selects. */
function useProvincias() {
  const { data } = useAsync(() => Geo.provincias(), []);
  return data ?? [];
}

function ProvinciaSelect({ value, onChange, ...p }) {
  const provincias = useProvincias();
  return (
    <select {...p} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">Selecciona…</option>
      {Object.entries(REGION).map(([k, l]) => (
        <optgroup key={k} label={l}>
          {provincias.filter((x) => x.region === k).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

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
const ICON_NAMES = {
  trees: 'Árboles', mountain: 'Montaña', landmark: 'Monumento', bird: 'Ave', waves: 'Olas', 'building-2': 'Edificio',
  'train-front': 'Tren', utensils: 'Gastronomía', palmtree: 'Palmera', tent: 'Campamento', camera: 'Cámara',
  bike: 'Bicicleta', sailboat: 'Velero', 'map-pin': 'Ubicación',
};

/** radiogroup con tabindex rotatorio y flechas; nombres en español (ACC-021). */
function IconPicker({ value, onChange }) {
  const keys = Object.keys(CATEGORY_ICONS);
  const onKeyDown = (e) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const cur = Math.max(0, keys.indexOf(value));
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (cur + delta + keys.length) % keys.length;
    onChange(keys[next]);
    e.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="chip-row" role="radiogroup" aria-label="Ícono" onKeyDown={onKeyDown}>
      {keys.map((k, i) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={value === k || (!keys.includes(value) && i === 0) ? 0 : -1}
          className="chip"
          onClick={() => onChange(k)}
          aria-label={ICON_NAMES[k] ?? k}
          title={ICON_NAMES[k] ?? k}
          style={{ padding: '0 10px' }}
        >
          <CategoryIcon name={k} size={18} />
        </button>
      ))}
    </div>
  );
}

function PadreSelect({ categorias, excluir, value, onChange, ...p }) {
  return (
    <select {...p} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Ninguna (categoría principal)</option>
      {categorias.filter((c) => !c.padre_id && c.id !== excluir).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  );
}

function CategoriaModal({ item, categorias, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre: item.nombre, slug: item.slug, icono: item.icono, descripcion: item.descripcion ?? '', orden: item.orden, padre_id: item.padre_id ?? null });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const errs = limpiar({
      nombre: texto(f.nombre, { min: 2, max: LIMITES.categoria, que: 'El nombre' }),
      slug: /^[a-z0-9-]{1,80}$/.test(f.slug) ? null : 'Solo minúsculas, números y guiones (máx. 80)',
      descripcion: texto(f.descripcion, { min: 5, max: LIMITES.descCategoria, requerido: false, que: 'La descripción' }),
      orden: numero(f.orden, { min: 0, max: 999, decimales: 0, que: 'El orden' }),
    });
    setErr(errs);
    if (Object.keys(errs).length) return;
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
        <RequiredLegend />
        {err.api && <Alert tone="danger">{err.api}</Alert>}
        <Field label="Nombre" required error={err.nombre}>{(p) => <input {...p} className="input" maxLength={LIMITES.categoria} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />}</Field>
        <Field label="Slug (identificador en la API)" required hint="Minúsculas, números y guiones. Cambiarlo afecta los enlaces y filtros existentes" error={err.slug}>{(p) => <input {...p} className="input" maxLength={80} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />}</Field>
        <div className="field"><span className="label">Ícono</span><IconPicker value={f.icono} onChange={(icono) => setF({ ...f, icono })} /></div>
        <Field label="Descripción" error={err.descripcion}>{(p) => <input {...p} className="input" maxLength={LIMITES.descCategoria} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />}</Field>
        <Field label="Categoría padre" hint="Las subcategorías se agrupan bajo su categoría principal" error={err.padre_id}>
          {(p) => <PadreSelect {...p} categorias={categorias} excluir={item.id} value={f.padre_id} onChange={(padre_id) => setF({ ...f, padre_id })} />}
        </Field>
        <Field label="Orden de aparición" required error={err.orden} hint="Entre 0 y 999; menor número = aparece primero">{(p) => <input {...p} className="input" type="number" min="0" max="999" step="1" inputMode="numeric" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

export function CategoriasAdmin() {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useAsync(() => Categorias.list(true), []);
  const [form, setForm] = useState({ nombre: '', icono: 'trees', descripcion: '', padre_id: null });
  const [formErr, setFormErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const { toggle, remove } = useCatalogActions(Categorias, setData, 'Categoría');

  const create = async (e) => {
    e.preventDefault();
    const e1 = texto(form.nombre, { min: 2, max: LIMITES.categoria, que: 'El nombre de la categoría' }) ??
      texto(form.descripcion, { min: 5, max: LIMITES.descCategoria, requerido: false, que: 'La descripción' });
    if (e1) { setFormErr(e1); return; }
    try {
      const c = await Categorias.create({ ...form, nombre: form.nombre.trim(), orden: (data?.length ?? 0) + 1 });
      setData((d) => [...d, { ...c, total_atracciones: 0 }]);
      setForm({ nombre: '', icono: 'trees', descripcion: '', padre_id: null });
      setFormErr(null);
      toast(`Categoría "${c.nombre}" creada`, 'success');
    } catch (e2) { setFormErr(e2.message); }
  };

  return (
    <>
      <div className="adm-module-head"><div><h2>Categorías</h2><p>Agrupan las experiencias en el buscador y en el inicio.</p></div></div>
      <form className="inline-form" onSubmit={create} noValidate>
        <Field label="Nueva categoría" error={formErr}>{(p) => <input {...p} className="input" maxLength={LIMITES.categoria} placeholder="Ej. Bienestar y termas" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />}</Field>
        <Field label="Descripción (opcional)">{(p) => <input {...p} className="input" maxLength={LIMITES.descCategoria} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />}</Field>
        <Field label="Dentro de (opcional)">{(p) => <PadreSelect {...p} categorias={data ?? []} value={form.padre_id} onChange={(padre_id) => setForm({ ...form, padre_id })} />}</Field>
        <div className="field" style={{ flexBasis: '100%' }}><span className="label">Ícono</span><IconPicker value={form.icono} onChange={(icono) => setForm({ ...form, icono })} /></div>
        <button className="btn btn-primary"><Plus size={18} /> Crear categoría</button>
      </form>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Categorías del catálogo</caption>
            <thead><tr><th scope="col">Ícono</th><th scope="col">Nombre</th><th scope="col">Slug</th><th scope="col" className="num">Atracciones</th><th scope="col" className="num">Orden</th><th scope="col">Visible</th><th scope="col" className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><span className="adm-kpi-icon brand" style={{ width: 36, height: 36 }}><CategoryIcon name={c.icono} size={18} /></span></td>
                  <td>
                    <strong>{c.nombre}</strong>
                    {c.padre_id && <span className="badge" style={{ marginLeft: 6 }}>en {data.find((x) => x.id === c.padre_id)?.nombre}</span>}
                    {c.descripcion && <div className="muted tiny">{c.descripcion}</div>}
                  </td>
                  <td><code>{c.slug}</code></td>
                  <td className="num">{c.total_atracciones}</td>
                  <td className="num">{c.orden}</td>
                  <td><Switch checked={c.activa} onChange={() => toggle(c, 'activa')} ariaLabel={`Categoría ${c.nombre} visible`} /></td>
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
      {editing && <CategoriaModal item={editing} categorias={data ?? []} onClose={() => setEditing(null)} onSaved={(u) => { setData((d) => d.map((x) => (x.id === u.id ? { ...x, ...u } : x))); setEditing(null); }} />}
    </>
  );
}

// ── Destinos ─────────────────────────────────────────────────────────────
function DestinoModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [f, setF] = useState(
    item
      ? { nombre: item.nombre, provincia_id: item.provincia_id, codigo_inec: item.codigo_inec, descripcion: item.descripcion ?? '', imagen: item.imagen ?? '', activo: item.activo }
      : { nombre: '', provincia_id: '', codigo_inec: '', descripcion: '', imagen: '', activo: true },
  );
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    Object.assign(errs, limpiar({
      nombre: texto(f.nombre, { min: 2, max: LIMITES.ciudad, que: 'El nombre de la ciudad' }),
      provincia_id: f.provincia_id ? null : 'Elige la provincia',
      codigo_inec: /^\d{6}$/.test(f.codigo_inec) ? null : 'El código INEC tiene exactamente 6 dígitos',
      descripcion: texto(f.descripcion, { min: 10, max: LIMITES.descCiudad, requerido: false, que: 'La descripción' }),
    }));
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = { nombre: f.nombre.trim(), provincia_id: Number(f.provincia_id), codigo_inec: f.codigo_inec, descripcion: f.descripcion, imagen: f.imagen, activo: f.activo };
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
    <Modal open onClose={onClose} size="modal-lg" title={item ? 'Editar destino' : 'Nuevo destino'} description="Cada destino es una ciudad del catálogo; la región se toma de su provincia." footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="dst-form" disabled={saving || uploading}>{saving && <Spinner />} Guardar</button></>}>
      <form id="dst-form" onSubmit={save} className="form-grid" noValidate>
        <div className="span-2"><RequiredLegend /></div>
        {err.api && <div className="span-2"><Alert tone="danger">{err.api}</Alert></div>}
        <Field label="Ciudad" required error={err.nombre}>{(p) => <input {...p} className="input" maxLength={LIMITES.ciudad} value={f.nombre} onChange={set('nombre')} />}</Field>
        <Field label="Provincia" required error={err.provincia_id} hint={item && f.provincia_id !== item.provincia_id ? 'Sus atracciones pasarán a la nueva provincia' : undefined}>
          {(p) => <ProvinciaSelect {...p} value={f.provincia_id} onChange={(provincia_id) => setF({ ...f, provincia_id })} />}
        </Field>
        <Field label="Código INEC" required error={err.codigo_inec} hint="6 dígitos, ej. 170150 (Quito)">{(p) => <input {...p} className="input" inputMode="numeric" maxLength={6} value={f.codigo_inec} onChange={(e) => setF({ ...f, codigo_inec: e.target.value.replace(/\D/g, '') })} />}</Field>
        <Field label="Descripción" className="span-2" error={err.descripcion} hint="Aparece en la página de destinos (10 a 500 caracteres)">{(p) => <textarea {...p} className="textarea" maxLength={500} style={{ minHeight: 80 }} value={f.descripcion} onChange={set('descripcion')} />}</Field>
        <div className="field span-2">
          <span className="label">Imagen de portada</span>
          <div className="photo-list">
            {f.imagen && <div className="photo-thumb"><img src={f.imagen} alt="Portada del destino" loading="lazy" decoding="async" onError={onImgError} /></div>}
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

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Destinos</h2><p>Ciudades donde operan las experiencias (tabla <code>ciudad</code>). El <strong>ID</strong> es el <em>city</em> del contrato; el sitio muestra solo las que tienen atracciones.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={18} /> Nuevo destino</button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading ? <div className="skeleton" style={{ height: 300 }} /> : data.length === 0 ? <EmptyState icon={Map} title="Sin destinos" /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Destinos turísticos</caption>
            <thead><tr><th scope="col">Destino</th><th scope="col">Región</th><th scope="col" className="num">ID</th><th scope="col" className="num">INEC</th><th scope="col" className="num">Atracciones</th><th scope="col">Visible</th><th scope="col" className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <img src={d.imagen || FALLBACK_IMG} alt="" width="56" height="42" loading="lazy" decoding="async" style={{ objectFit: 'cover', borderRadius: 8 }} onError={onImgError} />
                      <div><strong>{d.nombre}</strong><div className="muted tiny">{d.provincia}</div></div>
                    </div>
                  </td>
                  <td><span className="badge badge-primary">{REGION[d.region]}</span></td>
                  <td className="num">{d.codigo}</td>
                  <td className="num"><code>{d.codigo_inec}</code></td>
                  <td className="num">{d.total_atracciones}</td>
                  <td><Switch checked={d.activo} onChange={() => toggle(d, 'activo')} ariaLabel={`Destino ${d.nombre} visible`} /></td>
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
  const [f, setF] = useState(
    item
      ? { nombre: item.nombre, provincia_id: item.provincia_id, direccion: item.direccion ?? '', ruc: item.ruc ?? '', email: item.email ?? '', telefono: item.telefono ?? '', activo: item.activo }
      : { nombre: '', provincia_id: '', direccion: '', ruc: '', email: '', telefono: '', activo: true },
  );
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!f.provincia_id) errs.provincia_id = 'Elige la provincia de la sede';
    Object.assign(errs, limpiar({
      nombre: texto(f.nombre, { min: 2, max: LIMITES.operador, que: 'El nombre comercial' }),
      direccion: texto(f.direccion, { min: 5, max: LIMITES.direccion, requerido: false, que: 'La dirección' }),
      ruc: ruc(f.ruc),
      email: correo(f.email, { requerido: false }),
      telefono: telefono(f.telefono),
    }));
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    // Vacío = sin dato (la API lo guarda como NULL)
    const body = { nombre: f.nombre.trim(), provincia_id: Number(f.provincia_id), direccion: f.direccion, ruc: f.ruc, email: f.email, telefono: f.telefono, activo: f.activo };
    try {
      const saved = item ? await Operadores.update(item.id, body) : await Operadores.create(body);
      toast(item ? 'Operador actualizado' : `Operador creado con código ${saved.codigo}`, 'success');
      onSaved(saved);
    } catch (e2) { setErr({ ...e2.fieldErrors, api: e2.message }); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Editar operador' : 'Nuevo operador'} description={item ? `Código ${item.codigo}` : 'El código se asigna automáticamente'} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="op-form" disabled={saving}>{saving && <Spinner />} Guardar</button></>}>
      <form id="op-form" onSubmit={save} className="stack" noValidate>
        <RequiredLegend />
        {err.api && <Alert tone="danger">{err.api}</Alert>}
        <Field label="Nombre comercial" required error={err.nombre}>{(p) => <input {...p} className="input" maxLength={LIMITES.operador} value={f.nombre} onChange={set('nombre')} />}</Field>
        <Field label="Provincia de la sede" required error={err.provincia_id}>{(p) => <ProvinciaSelect {...p} value={f.provincia_id} onChange={(provincia_id) => setF({ ...f, provincia_id })} />}</Field>
        <Field label="Dirección" error={err.direccion}>{(p) => <input {...p} className="input" maxLength={255} value={f.direccion} onChange={set('direccion')} />}</Field>
        <Field label="RUC" error={err.ruc} hint="13 dígitos, termina en 001">{(p) => <input {...p} className="input" inputMode="numeric" maxLength={13} value={f.ruc} onChange={(e) => setF({ ...f, ruc: e.target.value.replace(/\D/g, '') })} />}</Field>
        <Field label="Correo de reservas" error={err.email}>{(p) => <input {...p} className="input" type="email" maxLength={LIMITES.correo} value={f.email} onChange={set('email')} />}</Field>
        <Field label="Teléfono" error={err.telefono} hint="7 a 15 dígitos, ej. 022456789">{(p) => <input {...p} className="input" type="tel" inputMode="tel" maxLength={LIMITES.telefono} value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value.replace(/[^\d+]/g, '') })} />}</Field>
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
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
<caption className="sr-only">Empresas operadoras</caption>
            <thead><tr><th scope="col" className="num">Código</th><th scope="col">Operador</th><th scope="col">RUC</th><th scope="col">Contacto</th><th scope="col" className="num">Atracciones</th><th scope="col">Activo</th><th scope="col" className="num">Acciones</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.codigo}</td>
                  <td><strong>{o.nombre}</strong><div className="muted tiny">{o.provincia}{o.total_usuarios ? ` · ${o.total_usuarios} usuario(s) en el panel` : ""}</div></td>
                  <td>{o.ruc ?? '—'}</td>
                  <td className="small">{o.email ?? '—'}<br /><span className="muted">{o.telefono}</span></td>
                  <td className="num">{o.total_atracciones}</td>
                  <td><Switch checked={o.activo} onChange={() => toggle(o, 'activo')} ariaLabel={`Operador ${o.nombre} activo`} /></td>
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

