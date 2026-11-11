import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { Atracciones } from '../api/client';
import { addDays, fmtDate, todayEc } from '../utils/format';

const CADA_MS = 5000;

/**
 * Cupos de cada salida de un día, consultados cada 5 s (los mismos que descuenta una compra de Booking o de la
 * web). Resalta la fila que cambió para que se note en la demo. Se detiene si la pestaña no está visible.
 */
export default function CuposEnVivo({ atraccionId, onCambio }) {
  const [dia, setDia] = useState(todayEc());
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [hora, setHora] = useState(null);
  const [cambiadas, setCambiadas] = useState(() => new Set());
  const previo = useRef(null);

  useEffect(() => {
    if (!atraccionId) return undefined;
    let vivo = true;
    previo.current = null;
    setDatos(null);
    const consultar = () => {
      if (document.visibilityState === 'hidden') return;
      Atracciones.availability(atraccionId, dia)
        .then((d) => {
          if (!vivo) return;
          const antes = previo.current;
          if (antes) {
            const distintas = new Set(d.slots.filter((s) => antes.get(s.time) !== undefined && antes.get(s.time) !== s.available).map((s) => s.time));
            if (distintas.size) {
              setCambiadas(distintas);
              onCambio?.();
              setTimeout(() => vivo && setCambiadas(new Set()), 2500);
            }
          }
          previo.current = new Map(d.slots.map((s) => [s.time, s.available]));
          setDatos(d);
          setError(null);
          setHora(new Date());
        })
        .catch((e) => vivo && setError(e.message));
    };
    consultar();
    const t = setInterval(consultar, CADA_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [atraccionId, dia]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = datos?.slots.reduce((s, x) => s + x.capacity, 0) ?? 0;

  return (
    <section className="card card-pad cupos-vivo" aria-labelledby="cv-titulo">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 id="cv-titulo" className="panel-title" style={{ margin: 0 }}>
          <span className="cupos-vivo-punto" aria-hidden="true" /> Cupos en vivo
        </h3>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm" aria-pressed={dia === todayEc()} onClick={() => setDia(todayEc())}>Hoy</button>
          <button type="button" className="btn btn-sm" aria-pressed={dia === addDays(todayEc(), 1)} onClick={() => setDia(addDays(todayEc(), 1))}>Mañana</button>
          <input type="date" className="input" style={{ width: 'auto', minHeight: 36 }} min={todayEc()} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
        </div>
      </div>

      {error ? <p className="muted small" role="alert">No se pudieron leer los cupos: {error}</p> : !datos ? <div className="skeleton" style={{ height: 90 }} /> : datos.slots.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>{datos.unavailable_reason ?? 'No hay salidas este día.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Cupos por salida del {fmtDate(dia)}</caption>
            <thead><tr><th scope="col">Salida</th><th scope="col" className="num">Capacidad</th><th scope="col" className="num">Vendidos</th><th scope="col" className="num">Disponibles</th><th scope="col">Ocupación</th></tr></thead>
            <tbody>
              {datos.slots.map((s) => {
                const vendidos = s.capacity - s.available;
                const pct = s.capacity ? Math.round((vendidos / s.capacity) * 100) : 0;
                return (
                  <tr key={s.time} className={cambiadas.has(s.time) ? 'cupos-vivo-cambio' : undefined}>
                    <td><strong>{s.time}</strong></td>
                    <td className="num">{s.capacity}</td>
                    <td className="num">{vendidos}</td>
                    <td className="num"><strong className="cupos-vivo-num">{s.available}</strong></td>
                    <td style={{ minWidth: 120 }}><div className="occ-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div><span className="sr-only">{pct}% ocupado</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted tiny" style={{ margin: '10px 0 0' }} aria-live="polite">
        <Radio size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Se actualiza cada 5 segundos
        {datos && <> · {datos.available_spots} de {total} cupos libres el {fmtDate(dia, { weekday: 'long', day: 'numeric', month: 'long' })}</>}
        {hora && <> · última lectura {hora.toLocaleTimeString('es-EC')}</>}
      </p>
    </section>
  );
}
