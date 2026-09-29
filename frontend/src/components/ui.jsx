import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info, Minus, Plus, Star, X, XCircle } from 'lucide-react';
import { STATUS } from '../utils/format';

// ── Hooks utilitarios ───────────────────────────────────────────────────
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Descubre EC` : 'Descubre EC · Tours y experiencias en Ecuador';
  }, [title]);
}

export function useDebounce(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Carga asíncrona con estados loading/error/data y recarga manual.
 * `deps` decide cuándo recargar; la función se lee siempre en su versión más reciente
 * (ref), así que no hay closures obsoletas aunque use valores que no estén en `deps` (WEB-010).
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then((data) => alive && setState({ loading: false, error: null, data }))
      .catch((error) => alive && setState({ loading: false, error, data: null }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// ── Modal accesible ─────────────────────────────────────────────────────
/** Pila de modales abiertos: solo el de arriba responde a Esc/Tab. */
const modalStack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el foco dentro de `ref` mientras `active`: enfoca el primer control al abrir,
 * cicla con Tab, cierra con Escape y devuelve el foco al elemento que lo tenía (ACC-004).
 */
export function useFocusTrap(ref, active, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    modalStack.push(token);
    const previous = document.activeElement;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = ref.current;
      (el?.querySelector('[data-autofocus]') ?? el?.querySelector(`.modal-body :is(${FOCUSABLE})`) ?? el?.querySelector(FOCUSABLE))?.focus();
    }, 30);
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); }
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll(FOCUSABLE)];
        if (!els.length) return;
        const [f, l] = [els[0], els[els.length - 1]];
        if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
        else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      // El scroll se restaura siempre al cerrar el último, aunque devolver el foco falle (WEB-012)
      try {
        if (previous?.isConnected) previous.focus?.();
      } finally {
        if (!modalStack.length) document.body.style.overflow = '';
      }
    };
  }, [active, ref]);
}

/** Panel lateral modal (menú móvil, filtros): mismo contrato de foco que Modal. */
export function Drawer({ open, onClose, label, id, className = '', side = 'right', children }) {
  const ref = useRef(null);
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  // Portal en <body>: ningún contenedor (max-width, overflow, transform) puede recortar el fondo
  return createPortal(
    <div className={`drawer-backdrop ${className}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} id={id} className={`drawer drawer-${side}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = '', closeOnBackdrop = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(ref, open, onClose);

  if (!open) return null;
  // Portal en <body>: el fondo oscuro cubre toda la ventana aunque el modal se abra
  // dentro del panel (antes `.adm-content > * { max-width }` lo recortaba en pantallas anchas)
  return createPortal(
    // .adm-modal conserva el estilo del panel aunque el modal ya no viva dentro de .adm-content
    <div
      className={`modal-backdrop ${document.querySelector('.adm-layout') ? 'adm-modal' : ''}`}
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose?.()}
    >
      <div ref={ref} className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId} className="muted small">{description}</p>}
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Confirmación (prevención de errores) ────────────────────────────────
const ConfirmCtx = createContext(null);

/** const ok = await confirm({ title, message, confirmText, danger }) */
export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((o) => new Promise((res) => { resolver.current = res; setOpts(o); }), []);
  const close = (v) => { resolver.current?.(v); setOpts(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title}
        footer={
          <>
            <button className="btn" onClick={() => close(false)}>{opts?.cancelText ?? 'Cancelar'}</button>
            <button className={`btn ${opts?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} data-autofocus>
              {opts?.confirmText ?? 'Confirmar'}
            </button>
          </>
        }
      >
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          {opts?.danger && <AlertTriangle size={24} color="var(--danger)" style={{ flexShrink: 0 }} aria-hidden="true" />}
          <div>{opts?.message}</div>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ── Piezas pequeñas ─────────────────────────────────────────────────────
export function Stars({ value = 0, size = 16, label = true }) {
  const full = Math.round(value);
  return (
    <span className="stars" role={label ? 'img' : undefined} aria-label={label ? `${Number(value).toFixed(1)} de 5 estrellas` : undefined}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= full ? '' : 'off'} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      ))}
    </span>
  );
}

export function RatingInline({ ratings, showCount = true }) {
  if (!ratings?.number_of_reviews) return <span className="badge badge-primary">Nuevo</span>;
  return (
    <span className="rating-inline">
      <Star size={16} fill="var(--cta)" color="var(--cta)" aria-hidden="true" />
      <strong>{Number(ratings.score).toFixed(1)}</strong>
      {showCount && <span className="muted">({ratings.number_of_reviews})</span>}
      <span className="sr-only">de 5, {ratings.number_of_reviews} reseñas</span>
    </span>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? { label: status, tone: '' };
  const Icon = s.tone === 'success' ? CheckCircle2 : s.tone === 'warning' ? AlertCircle : XCircle;
  return (
    <span className={`badge badge-${s.tone}`}>
      <Icon size={13} aria-hidden="true" /> {s.label}
    </span>
  );
}

/**
 * Sin `label` es decorativo (va junto a un texto visible, p. ej. dentro de un botón).
 * Con `label` muestra el texto visible y lo anuncia como estado (WEB-014).
 */
export function Spinner({ label }) {
  if (!label) return <span className="spinner" aria-hidden="true" />;
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={28} aria-hidden="true" /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState icon={AlertTriangle} title="No pudimos cargar esta información" action={onRetry && <button className="btn btn-primary" onClick={onRetry}>Reintentar</button>}>
      {error?.message ?? 'Intenta nuevamente en unos segundos.'}
    </EmptyState>
  );
}

export function Alert({ tone = 'info', title, children, icon }) {
  const Icon = icon ?? (tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : tone === 'danger' ? XCircle : Info);
  return (
    // danger/warning interrumpen (alert); info/success se anuncian con cortesía (status) — ACC-011
    <div className={`alert alert-${tone}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div>
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Campo de formulario: etiqueta, ayuda y error junto al input (reconocer y recuperarse de errores). */
export function Field({ label, required, hint, error, children, className = '', id: idProp }) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const showHint = hint && !error;
  // required llega al control para que el lector de pantalla lo anuncie (ACC-010);
  // describedby solo apunta a elementos que realmente se renderizan (ACC-027)
  const child = typeof children === 'function'
    ? children({
        id,
        required: required || undefined,
        'aria-required': required || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [showHint && hintId, error && errId].filter(Boolean).join(' ') || undefined,
      })
    : children;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {child}
      {showHint && <span id={hintId} className="hint">{hint}</span>}
      {error && (
        <span id={errId} className="error-text" role="alert">
          <AlertCircle size={15} aria-hidden="true" /> {error}
        </span>
      )}
    </div>
  );
}

/** Leyenda de campos obligatorios, una vez por formulario (ACC-010). */
export const RequiredLegend = () => (
  <p className="hint req-legend">
    Los campos marcados con <span className="req" aria-hidden="true">*</span><span className="sr-only">asterisco</span> son obligatorios.
  </p>
);

export function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Ruta de navegación">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
            {it.to && i < items.length - 1 ? <Link to={it.to}>{it.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Qty({ value, onChange, min = 0, max = 99, label }) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Quitar ${label}`}>
        <Minus size={18} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`Agregar ${label}`}>
        <Plus size={18} />
      </button>
    </div>
  );
}

/** `ariaLabel` da un nombre único por fila cuando la etiqueta visible se repite (ACC-022). */
export function Switch({ checked, onChange, label, disabled, ariaLabel }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} aria-label={ariaLabel} />
      <span className="track" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function CardSkeleton() {
  return (
    <div className="a-card a-card-skel" aria-hidden="true">
      <div className="a-card-img skeleton" style={{ borderRadius: 0 }} />
      <div className="a-card-body">
        <div className="skeleton line" style={{ width: '40%' }} />
        <div className="skeleton line" style={{ width: '90%' }} />
        <div className="skeleton line" style={{ width: '70%' }} />
        <div className="skeleton line" style={{ width: '35%', height: 22, marginTop: 14 }} />
      </div>
    </div>
  );
}
