import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock, ImagePlus, Info, ListChecks, MapPin, Plus, Tag, Trash2, X } from 'lucide-react';
import { Atracciones, Uploads } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { Alert, Field, Modal, Spinner, Switch, useConfirm } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { BADGE, LANG, PRODUCT_TYPE, REGION } from '../utils/format';

const EMPTY = {
  name: '', short_description: '', long_description: '', product_type: 'GUIDED_TOUR',
  categories: [], badges: [], supported_languages: ['es'],
  price: '', child_price: '', duration_hours: '', times: ['09:00'], capacity_per_slot: 20,
  free_cancellation: true, cancellation_hours: 24,
  city: '', address: '', meeting_point: '', latitude: '', longitude: '', operator: '',
  includes: [''], not_includes: [], recommendations: [], photos: [],
  featured: false, is_active: true,
};

const fromApi = (a) => ({
  name: a.name, short_description: a.short_description ?? '', long_description: a.long_description,
  product_type: a.product_type, categories: a.categories, badges: a.badges ?? [], supported_languages: a.supported_languages,
  price: a.price.total, child_price: a.child_price?.total ?? '', duration_hours: a.duration_hours, times: a.times, capacity_per_slot: a.capacity_per_slot,
  free_cancellation: a.free_cancellation, cancellation_hours: a.cancellation_hours,
  city: a.locations[0]?.city ?? '', address: a.locations[0]?.address ?? '', meeting_point: a.meeting_point ?? '',
  latitude: a.locations[0]?.coordinates.latitude ?? '', longitude: a.locations[0]?.coordinates.longitude ?? '',
  operator: a.operator?.id ?? '', includes: a.includes.length ? a.includes : [''], not_includes: a.not_includes ?? [],
  recommendations: a.recommendations ?? [], photos: a.photos.map((p) => p.url), featured: a.featured, is_active: a.is_active,
});

/** Convierte el formulario al esquema CreateAtraccionRequest del contrato. */
const toApi = (f, destinos, operadores) => {
  const h = Number(f.duration_hours);
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const op = operadores.find((o) => String(o.codigo) === String(f.operator));
  return {
    name: f.name.trim(),
    short_description: f.short_description.trim() || undefined,
    long_description: f.long_description.trim(),
    duration: `PT${hh ? `${hh}H` : ''}${mm ? `${mm}M` : ''}`,
    price: { currency: 'USD', total: Number(f.price) },
    ...(f.child_price !== '' ? { child_price: Number(f.child_price) } : {}),
    operator: { id: op.codigo, name: op.nombre },
    product_type: f.product_type,
    includes: f.includes.map((x) => x.trim()).filter(Boolean),
    not_includes: f.not_includes.map((x) => x.trim()).filter(Boolean),
    recommendations: f.recommendations.map((x) => x.trim()).filter(Boolean),
    categories: f.categories,
    badges: f.badges,
    locations: [{ address: f.address.trim(), city: Number(f.city), country: 'ec', coordinates: { latitude: Number(f.latitude), longitude: Number(f.longitude) }, type: 'attraction' }],
    photos: f.photos.map((url) => ({ url })),
    supported_languages: f.supported_languages,
    free_cancellation: f.free_cancellation,
    cancellation_hours: Number(f.cancellation_hours),
    times: [...f.times].sort(),
    capacity_per_slot: Number(f.capacity_per_slot),
    meeting_point: f.meeting_point.trim() || undefined,
    featured: f.featured,
    is_active: f.is_active,
  };
};

function ListEditor({ items, onChange, placeholder, addLabel }) {
  return (
    <div className="list-editor">
      {items.map((v, i) => (
        <div key={i} className="list-editor-item">
          <input className="input" value={v} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${placeholder} ${i + 1}`} />
          <button type="button" className="icon-btn sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Quitar"><X size={18} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ''])}><Plus size={16} /> {addLabel}</button>
    </div>
  );
}

function TimesInput({ value, onChange, error }) {
  const [t, setT] = useState('');
  const add = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return;
    if (!value.includes(t)) onChange([...value, t].sort());
    setT('');
  };
  return (
    <div>
      <div className="tag-input" aria-invalid={!!error}>
        {value.map((h) => (
          <span key={h} className="chip chip-remove" style={{ minHeight: 32 }}>
            <Clock size={13} aria-hidden="true" /> {h}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== h))} aria-label={`Quitar horario ${h}`} style={{ background: 'none', border: 0, padding: 0, display: 'grid' }}><X size={14} /></button>
          </span>
        ))}
        <input type="time" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} aria-label="Nuevo horario" style={{ maxWidth: 130 }} />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!t}>Agregar</button>
      </div>
    </div>
  );
}

export default function AtraccionForm({ atraccion, categorias, destinos, operadores, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const initial = useMemo(() => (atraccion ? fromApi(atraccion) : EMPTY), [atraccion]);
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const fileRef = useRef(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const toggle = (k, v) => setF((prev) => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v] }));

  // Al elegir destino sugerimos coordenadas (el admin puede ajustarlas)
  useEffect(() => {
    const d = destinos.find((x) => String(x.codigo) === String(f.city));
    if (d && (f.latitude === '' || f.longitude === '')) setF((p) => ({ ...p, latitude: d.latitud, longitude: d.longitud }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.city]);

  const close = async () => {
    if (dirty && !(await confirm({ title: '¿Descartar cambios?', message: 'Tienes cambios sin guardar en esta atracción. Si sales ahora se perderán.', confirmText: 'Descartar', danger: true }))) return;
    onClose();
  };

  const upload = async (files) => {
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) { toast(`"${file.name}" supera los 4 MB`, 'error'); continue; }
        const r = await Uploads.image(file);
        setF((p) => ({ ...p, photos: [...p.photos, r.url] }));
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const movePhoto = (i, dir) => setF((p) => {
    const ph = [...p.photos];
    [ph[i], ph[i + dir]] = [ph[i + dir], ph[i]];
    return { ...p, photos: ph };
  });

  const validate = () => {
    const e = {};
    if (f.name.trim().length < 3) e.name = 'Escribe un nombre (mínimo 3 caracteres)';
    if (f.long_description.trim().length < 10) e.long_description = 'Describe la experiencia (mínimo 10 caracteres)';
    if (!(Number(f.price) > 0)) e.price = 'Ingresa un precio mayor a 0';
    if (f.child_price !== '' && Number(f.child_price) < 0) e.child_price = 'No puede ser negativo';
    if (!(Number(f.duration_hours) > 0)) e.duration_hours = 'Ingresa la duración en horas (ej. 4 o 2.5)';
    if (!f.times.length) e.times = 'Agrega al menos un horario de salida';
    if (!(Number(f.capacity_per_slot) >= 1)) e.capacity_per_slot = 'Mínimo 1 cupo';
    if (!f.categories.length) e.categories = 'Selecciona al menos una categoría';
    if (!f.city) e.city = 'Selecciona el destino';
    if (!f.operator) e.operator = 'Selecciona el operador';
    if (!f.address.trim()) e.address = 'Indica dónde se realiza la actividad';
    if (f.latitude === '' || Math.abs(f.latitude) > 90) e.latitude = 'Latitud entre -90 y 90';
    if (f.longitude === '' || Math.abs(f.longitude) > 180) e.longitude = 'Longitud entre -180 y 180';
    if (!f.includes.some((x) => x.trim())) e.includes = 'Indica al menos un elemento incluido';
    if (!f.supported_languages.length) e.supported_languages = 'Selecciona al menos un idioma';
    setErrors(e);
    if (Object.keys(e).length) {
      setTimeout(() => document.querySelector('.modal [aria-invalid="true"]')?.focus(), 30);
      toast(`Revisa ${Object.keys(e).length} campo(s) marcados en rojo`, 'warning');
    }
    return !Object.keys(e).length;
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setApiError(null);
    try {
      const body = toApi(f, destinos, operadores);
      const saved = atraccion ? await Atracciones.update(atraccion.id, body) : await Atracciones.create(body);
      toast(atraccion ? 'Cambios guardados' : `"${saved.name}" publicada`, 'success');
      onSaved(saved, !atraccion);
    } catch (e) {
      setApiError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      closeOnBackdrop={false}
      size="modal-lg"
      title={atraccion ? 'Editar atracción' : 'Nueva atracción'}
      description={atraccion ? atraccion.name : 'Completa la información que verán los viajeros'}
      footer={
        <>
          {dirty && <span className="muted small" style={{ marginRight: 'auto' }}>Cambios sin guardar</span>}
          <button className="btn" onClick={close}>Cancelar</button>
          <button className="btn btn-primary" form="atr-form" disabled={saving || uploading}>{saving && <Spinner />} {atraccion ? 'Guardar cambios' : 'Publicar atracción'}</button>
        </>
      }
    >
      <form id="atr-form" onSubmit={save} noValidate>
        {apiError && <div style={{ marginBottom: 16 }}><Alert tone="danger" title="No se pudo guardar">{apiError}</Alert></div>}

        <div className="form-section">
          <h3><Info size={18} aria-hidden="true" /> Información general</h3>
          <div className="form-grid">
            <Field label="Nombre" required error={errors.name} className="span-2">{(p) => <input {...p} className="input" value={f.name} onChange={set('name')} maxLength={255} placeholder="Ej. Tour al Parque Nacional Cotopaxi" />}</Field>
            <Field label="Resumen corto" hint={`Se muestra en las tarjetas · ${f.short_description.length}/280`} className="span-2">{(p) => <input {...p} className="input" value={f.short_description} onChange={set('short_description')} maxLength={280} />}</Field>
            <Field label="Descripción completa" required error={errors.long_description} className="span-2" hint="Usa un salto de línea para separar párrafos">{(p) => <textarea {...p} className="textarea" style={{ minHeight: 130 }} value={f.long_description} onChange={set('long_description')} />}</Field>
            <Field label="Tipo de producto" required>
              {(p) => <select {...p} className="select" value={f.product_type} onChange={set('product_type')}>{Object.entries(PRODUCT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
            </Field>
            <Field label="Operador" required error={errors.operator}>
              {(p) => (
                <select {...p} className="select" value={f.operator} onChange={set('operator')}>
                  <option value="">Selecciona…</option>
                  {operadores.map((o) => <option key={o.id} value={o.codigo} disabled={!o.activo}>{o.nombre}{!o.activo ? ' (inactivo)' : ''}</option>)}
                </select>
              )}
            </Field>
            <div className="field span-2">
              <span className="label">Categorías <span className="req">*</span></span>
              <div className="chip-row" role="group" aria-label="Categorías">
                {categorias.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={f.categories.includes(c.slug)} onClick={() => toggle('categories', c.slug)}>{c.nombre}</button>
                ))}
              </div>
              {errors.categories && <span className="error-text" role="alert">{errors.categories}</span>}
            </div>
            <div className="field span-2">
              <span className="label">Idiomas del guía <span className="req">*</span></span>
              <div className="chip-row" role="group" aria-label="Idiomas">
                {Object.entries(LANG).map(([k, l]) => (
                  <button key={k} type="button" className="chip" aria-pressed={f.supported_languages.includes(k)} onClick={() => toggle('supported_languages', k)}>{l}</button>
                ))}
              </div>
              {errors.supported_languages && <span className="error-text" role="alert">{errors.supported_languages}</span>}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3><Tag size={18} aria-hidden="true" /> Precios, horarios y cupos</h3>
          <div className="form-grid">
            <Field label="Precio adulto (USD)" required error={errors.price}>{(p) => <input {...p} className="input" type="number" min="0" step="0.5" inputMode="decimal" value={f.price} onChange={set('price')} />}</Field>
            <Field label="Precio niño 3–11 (USD)" error={errors.child_price} hint="Vacío = mismo precio que adulto">{(p) => <input {...p} className="input" type="number" min="0" step="0.5" inputMode="decimal" value={f.child_price} onChange={set('child_price')} />}</Field>
            <Field label="Duración (horas)" required error={errors.duration_hours} hint="Ej. 2.5 = 2 h 30 min · 96 = 4 días">{(p) => <input {...p} className="input" type="number" min="0.5" step="0.5" value={f.duration_hours} onChange={set('duration_hours')} />}</Field>
            <Field label="Cupo por horario" required error={errors.capacity_per_slot}>{(p) => <input {...p} className="input" type="number" min="1" value={f.capacity_per_slot} onChange={set('capacity_per_slot')} />}</Field>
            <div className="field span-2">
              <span className="label">Horarios de salida <span className="req">*</span></span>
              <TimesInput value={f.times} onChange={set('times')} error={errors.times} />
              {errors.times && <span className="error-text" role="alert">{errors.times}</span>}
            </div>
            <div className="field">
              <Switch checked={f.free_cancellation} onChange={set('free_cancellation')} label="Permite cancelación gratuita" />
            </div>
            {f.free_cancellation && (
              <Field label="Hasta cuántas horas antes">{(p) => <input {...p} className="input" type="number" min="0" value={f.cancellation_hours} onChange={set('cancellation_hours')} />}</Field>
            )}
          </div>
        </div>

        <div className="form-section">
          <h3><MapPin size={18} aria-hidden="true" /> Ubicación</h3>
          <div className="form-grid">
            <Field label="Destino" required error={errors.city}>
              {(p) => (
                <select {...p} className="select" value={f.city} onChange={set('city')}>
                  <option value="">Selecciona…</option>
                  {Object.entries(REGION).map(([k, n]) => (
                    <optgroup key={k} label={n}>{destinos.filter((d) => d.region === k).map((d) => <option key={d.id} value={d.codigo}>{d.nombre}</option>)}</optgroup>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Dirección de la actividad" required error={errors.address}>{(p) => <input {...p} className="input" value={f.address} onChange={set('address')} />}</Field>
            <Field label="Punto de encuentro" className="span-2" hint="Dónde se reúne el grupo (si es distinto de la actividad)">{(p) => <input {...p} className="input" value={f.meeting_point} onChange={set('meeting_point')} />}</Field>
            <Field label="Latitud" required error={errors.latitude} hint="Se sugiere al elegir destino">{(p) => <input {...p} className="input" type="number" step="0.000001" value={f.latitude} onChange={set('latitude')} />}</Field>
            <Field label="Longitud" required error={errors.longitude}>{(p) => <input {...p} className="input" type="number" step="0.000001" value={f.longitude} onChange={set('longitude')} />}</Field>
          </div>
        </div>

        <div className="form-section">
          <h3><ListChecks size={18} aria-hidden="true" /> Contenido</h3>
          <div className="form-grid">
            <div className="field">
              <span className="label">Incluye <span className="req">*</span></span>
              <ListEditor items={f.includes} onChange={set('includes')} placeholder="Ej. Transporte" addLabel="Agregar" />
              {errors.includes && <span className="error-text" role="alert">{errors.includes}</span>}
            </div>
            <div className="field">
              <span className="label">No incluye</span>
              <ListEditor items={f.not_includes} onChange={set('not_includes')} placeholder="Ej. Propinas" addLabel="Agregar" />
            </div>
            <div className="field span-2">
              <span className="label">Recomendaciones "Antes de ir"</span>
              <ListEditor items={f.recommendations} onChange={set('recommendations')} placeholder="Ej. Lleva ropa abrigada" addLabel="Agregar recomendación" />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3><ImagePlus size={18} aria-hidden="true" /> Fotos y visibilidad</h3>
          <p className="hint" style={{ marginTop: -6 }}>La primera foto es la portada. JPG, PNG o WebP de máximo 4 MB.</p>
          <div className="photo-list">
            {f.photos.map((url, i) => (
              <div key={url} className="photo-thumb">
                <img src={url} alt={`Foto ${i + 1}`} onError={onImgError} />
                {i === 0 && <span className="badge badge-cta ph-main">Portada</span>}
                <div className="ph-actions">
                  {i > 0 && <button type="button" onClick={() => movePhoto(i, -1)} aria-label="Mover a la izquierda"><ArrowLeft size={14} /></button>}
                  {i < f.photos.length - 1 && <button type="button" onClick={() => movePhoto(i, 1)} aria-label="Mover a la derecha"><ArrowRight size={14} /></button>}
                  <button type="button" onClick={() => set('photos')(f.photos.filter((_, j) => j !== i))} aria-label={`Eliminar foto ${i + 1}`}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            <button type="button" className="photo-add" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <ImagePlus size={22} />}
              {uploading ? 'Subiendo…' : 'Agregar fotos'}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload([...e.target.files])} />
          </div>
          <div className="row" style={{ marginTop: 18, gap: 24 }}>
            <Switch checked={f.is_active} onChange={set('is_active')} label="Visible en el sitio" />
            <Switch checked={f.featured} onChange={set('featured')} label="Destacada en el inicio" />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="label">Insignias</span>
            <div className="chip-row">
              {Object.entries(BADGE).map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={f.badges.includes(k)} onClick={() => toggle('badges', k)}>{l}</button>)}
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
