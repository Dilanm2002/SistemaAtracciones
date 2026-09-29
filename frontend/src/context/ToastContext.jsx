import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastCtx = createContext(null);
const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

/**
 * Un toast se cierra solo tras `duration`, pero el tiempo se pausa mientras el puntero
 * o el foco están encima (ACC-031). Los que llevan acción no se cierran solos:
 * así nadie pierde el botón antes de alcanzarlo.
 */
function Toast({ t, onDismiss }) {
  const Icon = ICONS[t.type] ?? Info;
  const [paused, setPaused] = useState(false);
  const restante = useRef(t.duration);

  useEffect(() => {
    if (t.action || paused) return undefined;
    const inicio = Date.now();
    const timer = setTimeout(() => onDismiss(t.id), restante.current);
    return () => {
      clearTimeout(timer);
      restante.current = Math.max(1500, restante.current - (Date.now() - inicio));
    };
  }, [paused, t, onDismiss]);

  return (
    <div
      className={`toast toast-${t.type}`}
      role={t.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
    >
      <Icon size={20} aria-hidden="true" />
      <div className="grow">{t.message}</div>
      {t.action && (
        <button className="toast-action" onClick={() => { t.action.onClick(); onDismiss(t.id); }}>
          {t.action.label}
        </button>
      )}
      <button onClick={() => onDismiss(t.id)} aria-label="Cerrar notificación">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Notificaciones no intrusivas (visibilidad del estado del sistema).
 * toast(msg, type, { action: { label, onClick }, duration })
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);

  const dismiss = useCallback((tid) => setToasts((t) => t.filter((x) => x.id !== tid)), []);

  const toast = useCallback((message, type = 'info', { action, duration } = {}) => {
    const tid = ++id.current;
    setToasts((t) => [...t.slice(-3), { id: tid, message, type, action, duration: duration ?? (type === 'error' ? 7000 : 5000) }]);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="region" aria-label="Notificaciones">
        {toasts.map((t) => <Toast key={t.id} t={t} onDismiss={dismiss} />)}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
