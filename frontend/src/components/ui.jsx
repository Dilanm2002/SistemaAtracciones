import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
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

/** Carga asíncrona con estados loading/error/data y recarga manual. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
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

export function Modal({ open, onClose, title, description, children, footer, size = '', closeOnBackdrop = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const token = {};
    modalStack.push(token);
    const previous = document.activeElement;
    document.body.style.overflow = 'hidden';
    const first =
      ref.current?.querySelector('[data-autofocus]') ??
      ref.current?.querySelector(`.modal-body :is(${FOCUSABLE})`) ??
      ref.current?.querySelector(FOCUSABLE);
    setTimeout(() => first?.focus(), 30);

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
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
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (!modalStack.length) document.body.style.overflow = '';
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose?.()}>
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
    </div>
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

export const Spinner = ({ label = 'Cargando' }) => <span className="spinner" role="status" aria-label={label} />;

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
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
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
  const child = typeof children === 'function'
    ? children({ id, 'aria-invalid': !!error, 'aria-describedby': [hint && hintId, error && errId].filter(Boolean).join(' ') || undefined })
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
      {hint && !error && <span id={hintId} className="hint">{hint}</span>}
      {error && (
        <span id={errId} className="error-text" role="alert">
          <AlertCircle size={15} aria-hidden="true" /> {error}
        </span>
      )}
    </div>
  );
}

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

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
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
