import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';

/**
 * Paleta categórica validada con dataviz/validate_palette.js (modo claro, superficie blanca):
 * croma ≥ 0.1, separación CVD adyacente ΔE ≥ 12.5, visión normal ≥ 24, contraste ≥ 3:1.
 * Orden fijo: nunca se cicla ni se reordena según el ranking.
 */
export const SERIES = ['#0D9488', '#D97706', '#2563EB', '#BE185D', '#65A30D', '#7C3AED'];
const INK = { primary: '#1c2b2a', secondary: '#52615f', grid: '#ebe4d8' };

function ChartTooltip({ active, payload, label, fmt, extra }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{label ?? row.label}</strong>
      {payload.map((p) => (
        <div key={p.dataKey} className="ct-row">
          <i style={{ background: p.color ?? p.fill }} aria-hidden="true" />
          <span>{p.name}: <b>{fmt ? fmt(p.value) : p.value}</b></span>
        </div>
      ))}
      {extra?.(row)}
    </div>
  );
}

const resumen = (title, table) => {
  if (!table?.rows?.length) return title;
  const filas = table.rows.slice(0, 8).map((r) => table.columns.map((c) => (c.fmt ? c.fmt(r[c.key]) : r[c.key])).join(' '));
  return `${title}. ${filas.join('; ')}${table.rows.length > 8 ? '; …' : ''}. Usa «Ver tabla» para el detalle.`;
};

/** Tarjeta con título, subtítulo y alternancia gráfica/tabla (alternativa accesible). */
export function ChartCard({ title, subtitle, table, children, className = '' }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${className}`} aria-label={title}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        {table && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
            {asTable ? <><BarChart3 size={15} aria-hidden="true" /> Ver gráfica</> : <><Table2 size={15} aria-hidden="true" /> Ver tabla</>}
          </button>
        )}
      </div>
      {asTable ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ margin: '4px 0 12px' }}>
          <table className="table">
            <caption className="sr-only">{title}</caption>
            <thead><tr>{table.columns.map((c) => <th scope="col" key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{table.columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.fmt ? c.fmt(r[c.key]) : r[c.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // El SVG de Recharts no tiene nombre: se resume el contenido de la tabla (ACC-033)
        <div role="img" aria-label={resumen(title, table)}>{children}</div>
      )}
    </section>
  );
}

/** Barras verticales de una sola serie (el título nombra la serie: no se necesita leyenda). */
export function ColumnChart({ data, dataKey, name, fmt, height = 260, color = SERIES[0], extra, highlightLast = false }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.secondary, fontSize: 12 }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: INK.secondary, fontSize: 12 }} tickFormatter={(v) => (fmt ? fmt(v, true) : v)} width={56} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'rgba(15,118,110,0.06)' }} content={<ChartTooltip fmt={fmt} extra={extra} />} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44}>
          {highlightLast && data.map((_, i) => <Cell key={i} fill={color} fillOpacity={i === data.length - 1 ? 1 : 0.55} />)}
          {data.length <= 8 && <LabelList dataKey={dataKey} position="top" formatter={(v) => (v ? (fmt ? fmt(v, true) : v) : '')} style={{ fill: INK.primary, fontSize: 11, fontWeight: 600 }} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ancho actual de un contenedor (se actualiza al girar el teléfono o redimensionar). */
function useAncho() {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

const recortar = (v, n) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/**
 * Barras horizontales para rankings (nombres largos legibles). Etiqueta directa del valor.
 * MOV-003: en contenedores angostos (teléfono) el nombre va ENCIMA de su barra y la barra usa todo
 * el ancho; antes la columna fija de nombres (230 px) dejaba ~5 px para las barras.
 */
export function RankChart({ data, dataKey, name, fmt, color = SERIES[0] }) {
  const [ref, ancho] = useAncho();
  const angosto = ancho > 0 && ancho < 560;
  const height = Math.max(160, data.length * (angosto ? 52 : 38) + 20);
  const valor = (v) => (fmt ? fmt(v, true) : v);
  const maxChars = Math.max(16, Math.floor((ancho - 16) / 7));
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: angosto ? 18 : 4, right: angosto ? 44 : 64, left: 4, bottom: 4 }} barCategoryGap={angosto ? '42%' : '24%'} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" hide={angosto} width={angosto ? 0 : 230} tickLine={false} axisLine={false} tick={{ fill: INK.primary, fontSize: 12 }} tickFormatter={(v) => recortar(v, 34)} />
          <Tooltip cursor={{ fill: 'rgba(15,118,110,0.06)' }} content={<ChartTooltip fmt={fmt} />} />
          <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
            {angosto && (
              <LabelList
                dataKey="label"
                content={({ x, y, value }) => (
                  <text x={x} y={y - 6} fill={INK.primary} fontSize={12} fontWeight={600}>{recortar(String(value), maxChars)}</text>
                )}
              />
            )}
            <LabelList dataKey={dataKey} position="right" formatter={valor} style={{ fill: INK.primary, fontSize: 12, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras por categoría con color de identidad fijo por entidad (no por ranking). */
export function CategoryBars({ data, dataKey, name, fmt, colorOf }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={INK.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.primary, fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: INK.secondary, fontSize: 12 }} tickFormatter={(v) => (fmt ? fmt(v, true) : v)} width={56} />
        <Tooltip cursor={{ fill: 'rgba(15,118,110,0.06)' }} content={<ChartTooltip fmt={fmt} />} />
        <Bar dataKey={dataKey} name={name} radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d) => <Cell key={d.label} fill={colorOf(d)} stroke="#fff" strokeWidth={2} />)}
          <LabelList dataKey={dataKey} position="top" formatter={(v) => (fmt ? fmt(v, true) : v)} style={{ fill: INK.primary, fontSize: 12, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
