import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

/**
 * Progreso del pago (lo que pasa mientras el cliente espera): cada paso muestra un círculo de
 * carga mientras está en curso, un check al terminar o una X con el motivo si falla.
 * Es un diálogo modal: el foco queda en él y los lectores de pantalla anuncian cada cambio.
 *
 * pasos: [{ id, label, estado: 'pendiente' | 'activo' | 'ok' | 'error', detalle? }]
 */
export default function ProgresoPago({ titulo, pasos, error, codigoSoporte, onCerrar, onReintentar }) {
  const ref = useRef(null);
  const [lento, setLento] = useState(false);
  const activo = pasos.find((p) => p.estado === 'activo');
  const terminado = pasos.every((p) => p.estado === 'ok');

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Si un paso tarda más de lo normal se avisa (sin pedir que repita: la Idempotency-Key evita cobros dobles)
  useEffect(() => {
    setLento(false);
    if (!activo) return undefined;
    const t = setTimeout(() => setLento(true), 8000);
    return () => clearTimeout(t);
  }, [activo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pp-fondo">
      <div className="pp-caja card" role="dialog" aria-modal="true" aria-labelledby="pp-titulo" tabIndex={-1} ref={ref}>
        <h2 id="pp-titulo">{error ? 'No pudimos completar tu reserva' : terminado ? '¡Listo!' : titulo}</h2>
        <ol className="pp-pasos" aria-live="polite">
          {pasos.map((p) => (
            <li key={p.id} className={`pp-paso is-${p.estado}`} aria-current={p.estado === 'activo' ? 'step' : undefined}>
              <span className="pp-icono" aria-hidden="true">
                {p.estado === 'activo' ? <span className="spinner" /> : p.estado === 'ok' ? <Check size={16} /> : p.estado === 'error' ? <X size={16} /> : null}
              </span>
              <span>
                <span className="pp-label">{p.label}</span>
                <span className="sr-only">
                  {p.estado === 'activo' ? ' (en curso)' : p.estado === 'ok' ? ' (completado)' : p.estado === 'error' ? ' (falló)' : ' (pendiente)'}
                </span>
                {p.detalle && <span className="pp-detalle">{p.detalle}</span>}
              </span>
            </li>
          ))}
        </ol>

        {lento && !error && (
          <p className="pp-aviso" role="status">
            <AlertTriangle size={16} aria-hidden="true" /> Está tardando más de lo normal. No cierres ni recargues la página: no se te cobrará dos veces.
          </p>
        )}

        {error && (
          <div className="pp-error" role="alert">
            <p>{error}</p>
            {codigoSoporte && <p className="muted small">Código de soporte: <code>{codigoSoporte.slice(0, 8)}</code></p>}
            <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              {onReintentar && <button type="button" className="btn btn-primary" onClick={onReintentar}>Intentar de nuevo</button>}
              <button type="button" className="btn" onClick={onCerrar}>Revisar mis datos</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
