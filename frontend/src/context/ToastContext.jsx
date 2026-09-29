import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastCtx = createContext(null);
const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

/**
 * Notificaciones no intrusivas (visibilidad del estado del sistema).
 * toast(msg, type, { action: { label, onClick }, duration })
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);

  const dismiss = useCallback((tid) => setToasts((t) => t.filter((x) => x.id !== tid)), []);

  const toast = useCallback(
    (message, type = 'info', { action, duration } = {}) => {
      const tid = ++id.current;
      setToasts((t) => [...t.slice(-3), { id: tid, message, type, action }]);
      setTimeout(() => dismiss(tid), duration ?? (type === 'error' ? 7000 : 4500));
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="region" aria-label="Notificaciones">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] ?? Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
              <Icon size={20} aria-hidden="true" />
              <div className="grow">{t.message}</div>
              {t.action && (
                <button className="toast-action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} aria-label="Cerrar notificación">
                <X size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
