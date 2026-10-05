import { Suspense, useMemo, useRef, useState } from 'react';
import { lazyRecarga } from '../utils/lazyRecarga';
import { ArrowLeft, ArrowRight, Clock, ImagePlus, Info, ListChecks, MapPin, Plus, Star, Tag, Trash2, UploadCloud, X } from 'lucide-react';
import { Atracciones, Uploads } from '../api/client';
import { onImgError } from '../components/AttractionCard';
import { Alert, Field, Modal, RequiredLegend, Spinner, Switch, useConfirm } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { BADGE, LANG, PRODUCT_TYPE, REGION } from '../utils/format';
import { ACEPTA, esImagen, normalizarFoto } from '../utils/imagen';
import { ECUADOR, limitarDigitos, LIMITES, limpiar, mascaraNumero, numero, PRECIO_MAX, texto } from '../utils/validation';

// El mapa (Leaflet) solo se descarga al abrir el formulario
const MapaUbicacion = lazyRecarga(() => import('./MapaUbicacion'));

const MAX_HORAS = 720; // 30 días: mismo límite que la base (atraccion_duracion_valida)
const MAX_FOTOS = 12;
// Archivo original: se acepta grande porque se convierte en el navegador antes de subirlo
const MAX_MB_ORIGINAL = 40;

/** Máscaras de los campos numéricos: no se pueden escribir más dígitos de los que admite el campo. */
const MASCARA = {
  price: { enteros: 5, decimales: 2 },
  child_price: { enteros: 5, decimales: 2 },
  duration_hours: { enteros: 3, decimales: 2 },
  capacity_per_slot: { enteros: 3, decimales: 0 },
  cancellation_hours: { enteros: 3, decimales: 0 },
  latitude: { enteros: 1, decimales: 6, negativo: true },
  longitude: { enteros: 2, decimales: 6, negativo: true },
};

const EMPTY = {
  name: '', short_description: '', long_description: '', product_type: 'GUIDED_TOUR',
  categories: [], supported_languages: ['es'],
  price: '', child_price: '', duration_hours: '', times: ['09:00'], capacity_per_slot: 20,
  free_cancellation: true, cancellation_hours: 24,
  city: '', address: '', meeting_point: '', latitude: '', longitude: '', operator: '',
  includes: [''], not_includes: [], recommendations: [], photos: [],
  featured: false, is_active: true,
};

const fromApi = (a) => ({
  name: a.name, short_description: a.short_description ?? '', long_description: a.long_description,
  product_type: a.product_type, categories: a.categories, supported_languages: a.supported_languages,
  price: a.price.total, child_price: a.child_price?.total ?? '', duration_hours: a.duration_hours, times: a.times, capacity_per_slot: a.capacity_per_slot,
  free_cancellation: a.free_cancellation, cancellation_hours: a.cancellation_hours,
  city: a.locations[0]?.city ?? '', address: a.locations[0]?.address ?? '', meeting_point: a.meeting_point ?? '',
  latitude: a.locations[0]?.coordinates.latitude ?? '', longitude: a.locations[0]?.coordinates.longitude ?? '',
  operator: a.operator?.id ?? '', includes: a.includes.length ? a.includes : [''], not_includes: a.not_includes ?? [],
  recommendations: a.recommendations ?? [], photos: a.photos.map((p) => p.url), featured: a.featured, is_active: a.is_active,
});

/** Convierte el formulario al esquema CreateAtraccionRequest del contrato. */
const toApi = (f, destinos, operadores, { esAdmin = true, aprobada = true } = {}) => {
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
    operator: { id: Number(f.operator), name: op?.nombre ?? '' },
    product_type: f.product_type,
    includes: f.includes.map((x) => x.trim()).filter(Boolean),
    not_includes: f.not_includes.map((x) => x.trim()).filter(Boolean),
    recommendations: f.recommendations.map((x) => x.trim()).filter(Boolean),
    categories: f.categories,
    locations: [{ address: f.address.trim(), city: Number(f.city), country: 'ec', coordinates: { latitude: Number(f.latitude), longitude: Number(f.longitude) }, type: 'attraction' }],
    photos: f.photos.map((url) => ({ url })),
    supported_languages: f.supported_languages,
    free_cancellation: f.free_cancellation,
    cancellation_hours: Number(f.cancellation_hours),
    times: [...f.times].sort(),
    capacity_per_slot: Number(f.capacity_per_slot),
    meeting_point: f.meeting_point.trim() || undefined,
    ...(esAdmin ? { featured: f.featured } : {}),
    ...(esAdmin || aprobada ? { is_active: f.is_active } : {}),
  };
};

/** `name` da nombres únicos a cada fila: «Incluye, elemento 2», «Quitar "Transporte" de Incluye» (ACC-029). */
function ListEditor({ items, onChange, placeholder, addLabel, name }) {
  return (
    <div className="list-editor" role="group" aria-label={name}>
      {items.map((v, i) => {
        // Cada elemento se valida al escribir; el error aparece junto a ese elemento
        const err = v.trim() ? texto(v, { min: 2, max: LIMITES.item, que: 'Este elemento', maxDigitos: 4 }) : null;
        const errId = `${name}-${i}-err`.replace(/\W+/g, '-');
        return (
          <div key={i}>
            <div className="list-editor-item">
              <input className="input" value={v} placeholder={placeholder} maxLength={LIMITES.item}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? limitarDigitos(e.target.value) : x)))}
                aria-label={`${name}, elemento ${i + 1}`} aria-invalid={!!err} aria-describedby={err ? errId : undefined} />
              <button type="button" className="icon-btn sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Quitar «${v || `elemento ${i + 1}`}» de ${name}`}><X size={18} aria-hidden="true" /></button>
            </div>
            {err && <span id={errId} className="error-text">{err}</span>}
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => onChange([...items, ''])} aria-label={`${addLabel} en ${name}`}><Plus size={16} aria-hidden="true" /> {addLabel}</button>
    </div>
  );
}

function TimesInput({ value, onChange, error, errorId }) {
  const [t, setT] = useState('');
  const [formato, setFormato] = useState('');
  const add = () => {
    // Una hora mal escrita ya no se descarta en silencio (ACC-030)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) { setFormato('Escribe la hora en formato HH:MM (24 h), por ejemplo 08:30.'); return; }
    setFormato('');
    if (!value.includes(t)) onChange([...value, t].sort());
    setT('');
  };
  const describedBy = [formato && 'times-fmt-err', error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <div className="tag-input">
        {value.map((h) => (
          <span key={h} className="chip chip-remove" style={{ minHeight: 32 }}>
            <Clock size={13} aria-hidden="true" /> {h}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== h))} aria-label={`Quitar horario ${h}`} style={{ background: 'none', border: 0, padding: 0, display: 'grid' }}><X size={14} /></button>
          </span>
        ))}
        <input type="time" value={t} onChange={(e) => { setT(e.target.value); setFormato(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} aria-label="Nuevo horario de salida" aria-invalid={formato || error ? true : undefined} aria-describedby={describedBy} style={{ maxWidth: 130 }} />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!t}>Agregar</button>
      </div>
      {formato && <span id="times-fmt-err" className="error-text" role="alert">{formato}</span>}
    </div>
  );
}

export default function AtraccionForm({ atraccion, categorias, destinos, operadores, idiomas, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin, user } = useAuth();
  // Una experiencia ya aprobada se puede pausar/reactivar; si no, el operador la envía a revisión
  const aprobada = !!atraccion && (atraccion.status === 'PUBLICADA' || atraccion.status === 'INACTIVA');
  const enviaARevision = !isAdmin && !aprobada;
  const initial = useMemo(
    () => (atraccion ? fromApi(atraccion) : { ...EMPTY, operator: isAdmin ? '' : user?.operadorCodigo ?? '' }),
    [atraccion, isAdmin, user],
  );
  const [f, setF] = useState(initial);
  const [tocados, setTocados] = useState(() => new Set());
  const [enviado, setEnviado] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendientes, setPendientes] = useState([]); // fotos subiéndose: { id, url, nombre, file }
  const [fotoErrores, setFotoErrores] = useState([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [apiError, setApiError] = useState(null);
  const fileRef = useRef(null);
  const uploading = pendientes.length > 0;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const destinoElegido = destinos.find((d) => String(d.codigo) === String(f.city));
  const ciudadElegida = destinoElegido ? `${destinoElegido.nombre}, ${destinoElegido.provincia ?? ''}`.replace(/,\s*$/, '') : '';
  const tocar = (k) => setTocados((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  const set = (k) => (v) => {
    tocar(k);
    setF((prev) => ({ ...prev, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  };
  /** Campo numérico con máscara: el valor se recorta mientras se escribe. */
  const setNum = (k) => (e) => set(k)(mascaraNumero(e.target.value, MASCARA[k]));
  const toggle = (k, v) => {
    tocar(k);
    setF((prev) => ({ ...prev, [k]: prev[k].includes(v) ? prev[k].filter((x) => x !== v) : [...prev[k], v] }));
  };

  // Idiomas registrados en la base (tabla idioma); si aún no cargan, los conocidos
  const listaIdiomas = idiomas?.length ? idiomas.map((i) => [i.codigo, LANG[i.codigo] ?? i.nombre]) : Object.entries(LANG);

  const close = async () => {
    if (dirty && !(await confirm({ title: '¿Descartar cambios?', message: 'Tienes cambios sin guardar en esta atracción. Si sales ahora se perderán.', confirmText: 'Descartar', danger: true }))) return;
    onClose();
  };

  /**
   * Acepta cualquier formato y tamaño de imagen: cada archivo se convierte en el navegador a un
   * JPEG horizontal listo para mostrar (utils/imagen.js) y luego se sube con su vista previa.
   */
  const upload = async (files) => {
    const errores = [];
    const libres = MAX_FOTOS - f.photos.length - pendientes.length;
    if (files.length > libres) errores.push(libres > 0 ? `Solo puedes agregar ${libres} foto(s) más (máximo ${MAX_FOTOS}).` : `Ya tienes ${MAX_FOTOS} fotos, el máximo permitido.`);
    const validos = [];
    for (const file of files.slice(0, Math.max(0, libres))) {
      if (!esImagen(file)) { errores.push(`«${file.name}»: no es una imagen.`); continue; }
      if (file.size > MAX_MB_ORIGINAL * 1024 * 1024) { errores.push(`«${file.name}»: pesa ${(file.size / 1048576).toFixed(0)} MB (máximo ${MAX_MB_ORIGINAL} MB).`); continue; }
      try {
        validos.push(await normalizarFoto(file));
      } catch (err) {
        errores.push(`«${file.name}»: ${err.message}.`);
      }
    }
    setFotoErrores(errores);
    if (fileRef.current) fileRef.current.value = '';
    if (!validos.length) return;
    tocar('photos');
    const lote = validos.map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, url: URL.createObjectURL(file), nombre: file.name, file }));
    setPendientes((p) => [...p, ...lote]);
    for (const item of lote) {
      try {
        // Como en Sal y Canela: se comprime en el navegador, va a Supabase Storage y la tabla atraccion_foto guarda su URL
        const r = await Uploads.image(item.file); // ya convertida a JPEG 1600×1067
        setF((p) => ({ ...p, photos: p.photos.includes(r.url) ? p.photos : [...p.photos, r.url] }));
      } catch (e) {
        setFotoErrores((prev) => [...prev, `«${item.nombre}»: ${e.message}`]);
      } finally {
        URL.revokeObjectURL(item.url);
        setPendientes((p) => p.filter((x) => x.id !== item.id));
      }
    }
  };
  const movePhoto = (i, dir) => setF((p) => {
    const ph = [...p.photos];
    [ph[i], ph[i + dir]] = [ph[i + dir], ph[i]];
    return { ...p, photos: ph };
  });
  const hacerPortada = (i) => setF((p) => ({ ...p, photos: [p.photos[i], ...p.photos.filter((_, j) => j !== i)] }));
  const onDrop = (e) => {
    e.preventDefault();
    setArrastrando(false);
    if (!uploading) upload([...e.dataTransfer.files]);
  };

  /** Valida los ítems de una lista (Incluye, No incluye, Recomendaciones). */
  const validarLista = (items, que, obligatoria) => {
    const llenos = items.map((x) => x.trim()).filter(Boolean);
    if (obligatoria && !llenos.length) return `Indica al menos un elemento en "${que}"`;
    const malo = llenos.map((x) => texto(x, { min: 2, max: LIMITES.item, que: `«${x.slice(0, 30)}» en "${que}"`, maxDigitos: 4 })).find(Boolean);
    if (malo) return malo;
    if (new Set(llenos.map((x) => x.toLowerCase())).size !== llenos.length) return `Hay elementos repetidos en "${que}"`;
    return null;
  };

  /** Todas las reglas del formulario; se recalculan en cada cambio (validación en vivo). */
  const calcularErrores = () => {
    const precioErr = numero(f.price, { min: 0.5, max: PRECIO_MAX, que: 'El precio' });
    const ninoErr =
      numero(f.child_price, { min: 0, max: PRECIO_MAX, requerido: false, que: 'El precio de niño' }) ??
      (f.child_price !== '' && !precioErr && Number(f.child_price) > Number(f.price) ? 'No puede ser mayor que el precio de adulto' : null);
    const e = limpiar({
      name: texto(f.name, { min: 3, max: LIMITES.nombreAtraccion, que: 'El nombre', maxDigitos: 4 }),
      short_description: texto(f.short_description, { min: 10, max: LIMITES.resumen, requerido: false, que: 'El resumen', maxDigitos: 4 }),
      long_description: texto(f.long_description, { min: 20, max: LIMITES.descripcion, que: 'La descripción' }),
      price: precioErr,
      child_price: ninoErr,
      duration_hours: numero(f.duration_hours, { min: 0.5, max: MAX_HORAS, decimales: 2, que: 'La duración' }),
      capacity_per_slot: numero(f.capacity_per_slot, { min: 1, max: 500, decimales: 0, que: 'El cupo' }),
      cancellation_hours: f.free_cancellation ? numero(f.cancellation_hours, { min: 0, max: 720, decimales: 0, que: 'La anticipación en horas' }) : null,
      times: f.times.length ? null : 'Agrega al menos un horario de salida',
      categories: f.categories.length ? null : 'Selecciona al menos una categoría',
      supported_languages: f.supported_languages.length ? null : 'Selecciona al menos un idioma',
      city: f.city ? null : 'Selecciona el destino',
      operator: f.operator ? null : 'Selecciona el operador',
      address: texto(f.address, { min: 5, max: LIMITES.direccion, que: 'La dirección', maxDigitos: 5 }),
      meeting_point: texto(f.meeting_point, { min: 5, max: LIMITES.direccion, requerido: false, que: 'El punto de encuentro', maxDigitos: 5 }),
      latitude: numero(f.latitude, { min: ECUADOR.latMin, max: ECUADOR.latMax, decimales: 6, que: 'La latitud (dentro del Ecuador)' }),
      longitude: numero(f.longitude, { min: ECUADOR.lngMin, max: ECUADOR.lngMax, decimales: 6, que: 'La longitud (dentro del Ecuador)' }),
      includes: validarLista(f.includes, 'Incluye', true),
      not_includes: validarLista(f.not_includes, 'No incluye', false),
      recommendations: validarLista(f.recommendations, 'Recomendaciones', false),
      photos: !f.photos.length ? 'Agrega al menos una foto: la primera será la portada' : f.photos.length > MAX_FOTOS ? `Máximo ${MAX_FOTOS} fotos` : null,
    });
    return e;
  };
  const todos = calcularErrores();
  // Se muestran los errores de los campos ya tocados; al intentar guardar, los de todos
  const errors = enviado ? todos : Object.fromEntries(Object.entries(todos).filter(([k]) => tocados.has(k)));

  const validate = () => {
    setEnviado(true);
    const e = todos;
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
      const body = toApi(f, destinos, operadores, { esAdmin: isAdmin, aprobada });
      const saved = atraccion ? await Atracciones.update(atraccion.id, body) : await Atracciones.create(body);
      toast(
        saved.status === 'EN_REVISION'
          ? `"${saved.name}" se envió a revisión. Te avisaremos en este panel cuando se apruebe.`
          : atraccion ? 'Cambios guardados' : `"${saved.name}" publicada`,
        'success',
      );
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
          <button className="btn btn-primary" form="atr-form" disabled={saving || uploading}>{saving && <Spinner />} {enviaARevision ? 'Enviar a revisión' : atraccion ? 'Guardar cambios' : 'Publicar atracción'}</button>
        </>
      }
    >
      <form id="atr-form" onSubmit={save} noValidate>
        <RequiredLegend />
        {apiError && <div style={{ marginBottom: 16 }}><Alert tone="danger" title="No se pudo guardar">{apiError}</Alert></div>}
        {atraccion?.status === 'RECHAZADA' && atraccion.rejection_reason && (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="danger" title="El equipo de Descubre EC pidió cambios">
              {atraccion.rejection_reason} {!isAdmin && 'Corrige lo indicado y vuelve a enviarla a revisión.'}
            </Alert>
          </div>
        )}
        {enviaARevision && atraccion?.status !== 'RECHAZADA' && (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="info" title="Pasará a revisión">
              Al enviarla, el equipo de Descubre EC la revisa antes de publicarla. Mientras tanto no se muestra en el sitio.
            </Alert>
          </div>
        )}

        <div className="form-section">
          <h3><Info size={18} aria-hidden="true" /> Información general</h3>
          <div className="form-grid">
            <Field label="Nombre" required error={errors.name} className="span-2">{(p) => <input {...p} className="input" value={f.name} onChange={set('name')} maxLength={LIMITES.nombreAtraccion} placeholder="Ej. Tour al Parque Nacional Cotopaxi" />}</Field>
            <Field label="Resumen corto" error={errors.short_description} hint={`Se muestra en las tarjetas · ${f.short_description.length}/${LIMITES.resumen}`} className="span-2">{(p) => <input {...p} className="input" value={f.short_description} onChange={set('short_description')} maxLength={LIMITES.resumen} />}</Field>
            <Field label="Descripción completa" required error={errors.long_description} className="span-2" hint={`Mínimo 20 caracteres · ${f.long_description.length}/${LIMITES.descripcion}. Usa un salto de línea para separar párrafos`}>{(p) => <textarea {...p} className="textarea" style={{ minHeight: 130 }} value={f.long_description} onChange={set('long_description')} maxLength={LIMITES.descripcion} />}</Field>
            <Field label="Tipo de producto" required>
              {(p) => <select {...p} className="select" value={f.product_type} onChange={set('product_type')}>{Object.entries(PRODUCT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
            </Field>
            <Field label={isAdmin ? 'Operador' : 'Empresa'} required error={errors.operator} hint={isAdmin ? undefined : 'Solo puedes publicar experiencias de tu empresa'}>
              {(p) => (
                <select {...p} className="select" value={f.operator} onChange={set('operator')} disabled={!isAdmin}>
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
                {listaIdiomas.map(([k, l]) => (
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
            <Field label="Precio adulto (USD)" required error={errors.price} hint={`Entre 0.50 y ${PRECIO_MAX.toLocaleString('es-EC')}, hasta 2 decimales`}>{(p) => <input {...p} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="Ej. 45.00" value={f.price} onChange={setNum('price')} />}</Field>
            <Field label="Precio niño 3–11 (USD)" error={errors.child_price} hint="Vacío = mismo precio que adulto; no puede superarlo">{(p) => <input {...p} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="Opcional" value={f.child_price} onChange={setNum('child_price')} />}</Field>
            <Field label="Duración (horas)" required error={errors.duration_hours} hint={`Entre 0.5 y ${MAX_HORAS} h. Ej. 2.5 = 2 h 30 min · 96 = 4 días`}>{(p) => <input {...p} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="Ej. 8" value={f.duration_hours} onChange={setNum('duration_hours')} />}</Field>
            <Field label="Cupo por horario" required error={errors.capacity_per_slot} hint="Entre 1 y 500 personas por salida">{(p) => <input {...p} className="input" type="text" inputMode="numeric" autoComplete="off" value={f.capacity_per_slot} onChange={setNum('capacity_per_slot')} />}</Field>
            <div className="field span-2">
              <span className="label">Horarios de salida <span className="req">*</span></span>
              <TimesInput value={f.times} onChange={set('times')} error={errors.times} errorId="times-err" />
              {errors.times && <span id="times-err" className="error-text" role="alert">{errors.times}</span>}
            </div>
            <div className="field">
              <Switch checked={f.free_cancellation} onChange={set('free_cancellation')} label="Permite cancelación gratuita" />
            </div>
            {f.free_cancellation && (
              <Field label="Hasta cuántas horas antes" required error={errors.cancellation_hours} hint="Entre 0 y 720 horas (30 días)">{(p) => <input {...p} className="input" type="text" inputMode="numeric" autoComplete="off" value={f.cancellation_hours} onChange={setNum('cancellation_hours')} />}</Field>
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
            <Field label="Dirección de la actividad" required error={errors.address} hint="Ej. Parque Nacional Cotopaxi, control Caspi">{(p) => <input {...p} className="input" value={f.address} onChange={set('address')} maxLength={LIMITES.direccion} />}</Field>
            <Field label="Punto de encuentro" className="span-2" error={errors.meeting_point} hint="Dónde se reúne el grupo (si es distinto de la actividad)">{(p) => <input {...p} className="input" value={f.meeting_point} onChange={set('meeting_point')} maxLength={LIMITES.direccion} />}</Field>
            <div className="field span-2">
              <span className="label">Ubicación en el mapa <span className="req">*</span></span>
              <Suspense fallback={<div className="mapa-lienzo skeleton" />}>
                <MapaUbicacion
                  lat={f.latitude}
                  lng={f.longitude}
                  ciudad={ciudadElegida}
                  error={errors.latitude || errors.longitude ? 'Marca en el mapa dónde se realiza la actividad (dentro del Ecuador).' : null}
                  onChange={(la, ln) => {
                    tocar('latitude');
                    tocar('longitude');
                    setF((p) => ({ ...p, latitude: String(la), longitude: String(ln) }));
                  }}
                  onDireccion={(d) => {
                    // Dirección y punto de encuentro se sugieren desde el lugar marcado (solo si están vacíos)
                    const sugerida = d.replace(/\d{6,}/g, '').replace(/,\s*,/g, ',').trim().slice(0, LIMITES.direccion);
                    setF((p) => ({
                      ...p,
                      address: p.address.trim() ? p.address : sugerida,
                      meeting_point: p.meeting_point.trim() ? p.meeting_point : sugerida,
                    }));
                  }}
                />
              </Suspense>
              <details className="coords-manual">
                <summary>Ingresar coordenadas manualmente</summary>
                <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Latitud" required error={errors.latitude} hint={`Dentro del Ecuador: entre ${ECUADOR.latMin} y ${ECUADOR.latMax}, hasta 6 decimales`}>{(p) => <input {...p} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="Ej. -0.683" value={f.latitude} onChange={setNum('latitude')} />}</Field>
                <Field label="Longitud" required error={errors.longitude} hint={`Dentro del Ecuador: entre ${ECUADOR.lngMin} y ${ECUADOR.lngMax}, hasta 6 decimales`}>{(p) => <input {...p} className="input" type="text" inputMode="decimal" autoComplete="off" placeholder="Ej. -78.437" value={f.longitude} onChange={setNum('longitude')} />}</Field>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3><ListChecks size={18} aria-hidden="true" /> Contenido</h3>
          <div className="form-grid">
            <div className="field">
              <span className="label">Incluye <span className="req">*</span></span>
              <ListEditor name="Incluye" items={f.includes} onChange={set('includes')} placeholder="Ej. Transporte" addLabel="Agregar" />
              {errors.includes && <span className="error-text" role="alert">{errors.includes}</span>}
            </div>
            <div className="field">
              <span className="label">No incluye</span>
              <ListEditor name="No incluye" items={f.not_includes} onChange={set('not_includes')} placeholder="Ej. Propinas" addLabel="Agregar" />
              {errors.not_includes && <span className="error-text" role="alert">{errors.not_includes}</span>}
            </div>
            <div className="field span-2">
              <span className="label">Recomendaciones "Antes de ir"</span>
              <ListEditor name="Recomendaciones" items={f.recommendations} onChange={set('recommendations')} placeholder="Ej. Lleva ropa abrigada" addLabel="Agregar recomendación" />
              {errors.recommendations && <span className="error-text" role="alert">{errors.recommendations}</span>}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3><ImagePlus size={18} aria-hidden="true" /> Fotos y visibilidad</h3>
          <div
            className={`photo-drop${arrastrando ? ' is-over' : ''}${errors.photos ? ' is-invalid' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={onDrop}
          >
            <UploadCloud size={30} aria-hidden="true" />
            <p className="photo-drop-title">Arrastra tus fotos aquí o</p>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading || f.photos.length >= MAX_FOTOS} aria-describedby="fotos-reglas">
              <ImagePlus size={16} aria-hidden="true" /> Elegir fotos
            </button>
            <p id="fotos-reglas" className="hint" style={{ margin: 0 }}>
              Cualquier formato (JPG, PNG, WebP, HEIC del iPhone, GIF…) y tamaño · las ajustamos automáticamente para que se vean bien
            </p>
            <span className="photo-count" aria-live="polite">{f.photos.length}/{MAX_FOTOS} fotos</span>
            <input ref={fileRef} type="file" accept={ACEPTA} multiple hidden onChange={(e) => upload([...e.target.files])} />
          </div>
          {fotoErrores.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Alert tone="warning" title="Algunas fotos no se agregaron">
                <ul style={{ margin: 0, paddingLeft: 18 }}>{fotoErrores.map((m) => <li key={m}>{m}</li>)}</ul>
              </Alert>
            </div>
          )}
          {errors.photos && <span className="error-text" role="alert">{errors.photos}</span>}
          {(f.photos.length > 0 || pendientes.length > 0) && (
            <>
              <p className="hint" style={{ margin: '12px 0 8px' }}>La primera foto es la <strong>portada</strong> de las tarjetas y del inicio. Ordénalas con las flechas o con la estrella.</p>
              <ul className="photo-grid">
                {f.photos.map((url, i) => (
                  <li key={url} className={`photo-card${i === 0 ? ' is-cover' : ''}`}>
                    <img src={url} alt={`Foto ${i + 1} de ${f.photos.length}`} loading="lazy" decoding="async" onError={onImgError} />
                    {i === 0 ? <span className="badge badge-cta ph-main"><Star size={12} aria-hidden="true" /> Portada</span> : <span className="ph-num">{i + 1}</span>}
                    <div className="ph-actions">
                      {i > 0 && <button type="button" onClick={() => hacerPortada(i)} title="Usar como portada" aria-label={`Usar la foto ${i + 1} como portada`}><Star size={15} /></button>}
                      {i > 0 && <button type="button" onClick={() => movePhoto(i, -1)} title="Mover antes" aria-label={`Mover la foto ${i + 1} antes`}><ArrowLeft size={15} /></button>}
                      {i < f.photos.length - 1 && <button type="button" onClick={() => movePhoto(i, 1)} title="Mover después" aria-label={`Mover la foto ${i + 1} después`}><ArrowRight size={15} /></button>}
                      <button type="button" className="danger" onClick={() => set('photos')(f.photos.filter((_, j) => j !== i))} title="Eliminar" aria-label={`Eliminar la foto ${i + 1}`}><Trash2 size={15} /></button>
                    </div>
                  </li>
                ))}
                {pendientes.map((p) => (
                  <li key={p.id} className="photo-card is-uploading" aria-label={`Subiendo ${p.nombre}`}>
                    <img src={p.url} alt="" loading="eager" decoding="async" /* vista previa local (blob:) ya visible */ />
                    <div className="ph-overlay"><Spinner /> Subiendo…</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row" style={{ marginTop: 18, gap: 24 }}>
            {(isAdmin || aprobada) && <Switch checked={f.is_active} onChange={set('is_active')} label={isAdmin && !aprobada && atraccion ? 'Aprobar y publicar en el sitio' : 'Visible en el sitio'} />}
            {isAdmin && <Switch checked={f.featured} onChange={set('featured')} label="Destacada en el inicio" />}
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="label">Insignias</span>
            <p className="hint" style={{ margin: 0 }}>
              Se calculan solas: <strong>{BADGE.best_seller}</strong> (20+ tickets en 60 días), <strong>{BADGE.likely_to_sell_out}</strong> (70 % de ocupación en las próximas 2 semanas) y <strong>{BADGE.new}</strong> (sus primeros 7 días; después desaparece sola).
              {atraccion?.badges?.length ? <> Ahora: {atraccion.badges.map((b) => BADGE[b] ?? b).join(', ')}.</> : ' Ahora no tiene ninguna.'}
            </p>
          </div>
        </div>
      </form>
    </Modal>
  );
}
