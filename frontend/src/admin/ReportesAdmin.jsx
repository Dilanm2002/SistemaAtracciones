import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, DollarSign, Percent, Receipt, Ticket, Download } from 'lucide-react';
import { Reportes } from '../api/client';
import { Alert, EmptyState, ErrorState, StatusBadge } from '../components/ui';
import { addDays, fmtDate, fmtMoney, PAYMENT, REGION, STATUS, todayEc } from '../utils/format';
import { CategoryBars, ChartCard, ColumnChart, RankChart, SERIES } from './charts';
import { exportXlsx } from './excel';

const PERIODOS = {
  hoy: { label: 'Hoy', range: (t) => [t, t] },
  '7d': { label: '7 días', range: (t) => [addDays(t, -6), t] },
  '30d': { label: '30 días', range: (t) => [addDays(t, -29), t] },
  mes: { label: 'Este mes', range: (t) => [`${t.slice(0, 7)}-01`, t] },
  custom: { label: 'Personalizado', range: null },
};
// Color fijo por entidad (no por ranking): la región siempre tiene el mismo color
const REGION_COLOR = { SIERRA: SERIES[0], COSTA: SERIES[1], GALAPAGOS: SERIES[2], AMAZONIA: SERIES[3] }; // validado --pairs all: las 4 regiones pasan (CVD 7.7 con etiqueta directa en eje X)
const PAY_COLOR = { TARJETA: SERIES[0], TRANSFERENCIA: SERIES[2], EN_SITIO: SERIES[1] };
const money = (v, short) => (short && v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : fmtMoney(v, { compact: true }));

export default function ReportesAdmin() {
  const today = todayEc();
  const [periodo, setPeriodo] = useState('30d');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [from, to] = periodo === 'custom' ? [custom.from, custom.to] : PERIODOS[periodo].range(today);
  // Rango válido: ambas fechas, "hasta" no futura, "desde" ≤ "hasta" y máximo un año (igual que la API)
  const invalid =
    periodo === 'custom' && (!from || !to || to < from || to > today || Date.parse(to) - Date.parse(from) > 366 * 86400000);

  const load = () => {
    if (invalid) return;
    setData(null);
    setError(null);
    Reportes.ventas(from, to).then(setData).catch(setError);
  };
  useEffect(load, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.by_day.map((d) => [d.date, d]));
    const out = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) {
      const r = map.get(d);
      out.push({ date: d, label: fmtDate(d, { day: 'numeric', month: 'short' }), revenue: r?.revenue ?? 0, reservations: r?.reservations ?? 0 });
    }
    return out;
  }, [data, from, to]);

  const doExport = () => exportXlsx(`reporte-ventas-${from}_a_${to}.xlsx`, [
    { name: 'Resumen', rows: [
      { Indicador: 'Período', Valor: `${from} a ${to}` },
      { Indicador: 'Reservas', Valor: data.kpis.reservations },
      { Indicador: 'Tickets vendidos', Valor: data.kpis.tickets },
      { Indicador: 'Ingresos cobrados (USD)', Valor: data.kpis.revenue },
      { Indicador: 'Pendiente de cobro (USD)', Valor: data.kpis.pending_revenue ?? 0 },
      { Indicador: 'Ticket promedio por reserva pagada (USD)', Valor: data.kpis.average_ticket },
      { Indicador: 'Cancelaciones', Valor: data.kpis.cancellations },
      { Indicador: 'Tasa de cancelación (%)', Valor: data.kpis.cancellation_rate },
    ] },
    { name: 'Por día', rows: byDay.map((d) => ({ Fecha: d.date, Reservas: d.reservations, 'Ingresos USD': d.revenue })) },
    { name: 'Top atracciones', rows: data.top_attractions.map((t) => ({ Atracción: t.name, Reservas: t.reservations, Tickets: t.tickets, 'Ingresos USD': t.revenue })) },
    { name: 'Por categoría', rows: data.by_category.map((c) => ({ Categoría: c.name, Reservas: c.reservations, 'Ingresos USD': c.revenue })) },
    { name: 'Por región', rows: data.by_region.map((c) => ({ Región: REGION[c.region], Reservas: c.reservations, 'Ingresos USD': c.revenue })) },
    { name: 'Detalle', rows: data.rows.map((r) => ({
      Código: r.code, Creada: new Date(r.created_at).toLocaleString('es-EC'), Atracción: r.attraction, Ciudad: r.city, 'Fecha tour': r.date, Hora: r.time,
      Adultos: r.adults, Niños: r.children, 'Total USD': r.total, Estado: STATUS[r.status]?.label, Pago: PAYMENT[r.payment_method], Cliente: r.customer, Email: r.email,
    })) },
  ]);

  return (
    <>
      <div className="adm-module-head">
        <div><h2>Reportes de ventas</h2><p>Según la fecha en que se hizo la reserva. Los ingresos excluyen canceladas.</p></div>
        <button className="btn btn-primary" onClick={doExport} disabled={!data}><Download size={18} /> Exportar a Excel</button>
      </div>

      <div className="adm-toolbar">
        <div className="segmented" role="group" aria-label="Período">
          {Object.entries(PERIODOS).map(([k, p]) => <button key={k} type="button" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{p.label}</button>)}
        </div>
        {periodo === 'custom' ? (
          <div className="row" style={{ gap: 8 }}>
            <label className="sr-only" htmlFor="rep-from">Desde</label>
            <input id="rep-from" type="date" className="input" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'rango-err' : undefined} />
            <span className="muted">a</span>
            <label className="sr-only" htmlFor="rep-to">Hasta</label>
            <input id="rep-to" type="date" className="input" value={custom.to} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'rango-err' : undefined} />
          </div>
        ) : (
          <span className="muted small"><CalendarRange size={15} style={{ verticalAlign: '-3px' }} aria-hidden="true" /> {fmtDate(from)} – {fmtDate(to)}</span>
        )}
      </div>
      {invalid && <div id="rango-err"><Alert tone="warning">Revisa el rango: ambas fechas son obligatorias, «Hasta» no puede ser futura ni anterior a «Desde», y el rango máximo es de un año.</Alert></div>}

      {error ? <ErrorState error={error} onRetry={load} /> : !data ? <div className="skeleton" style={{ height: 420 }} /> : (
        <>
          <div className="adm-kpi-grid">
            <div className="adm-kpi tone-ok"><span className="adm-kpi-icon ok"><DollarSign size={22} /></span><span><span className="adm-kpi-val" style={{ display: 'block' }}>{fmtMoney(data.kpis.revenue, { compact: true })}</span><span className="adm-kpi-lbl">Ingresos cobrados{data.kpis.pending_revenue ? ` · ${fmtMoney(data.kpis.pending_revenue, { compact: true })} por cobrar` : ''}</span></span></div>
            <div className="adm-kpi tone-brand"><span className="adm-kpi-icon brand"><Receipt size={22} /></span><span><span className="adm-kpi-val" style={{ display: 'block' }}>{data.kpis.reservations}</span><span className="adm-kpi-lbl">Reservas</span></span></div>
            <div className="adm-kpi tone-info"><span className="adm-kpi-icon info"><Ticket size={22} /></span><span><span className="adm-kpi-val" style={{ display: 'block' }}>{data.kpis.tickets}</span><span className="adm-kpi-lbl">Tickets vendidos</span></span></div>
            <div className="adm-kpi tone-cta"><span className="adm-kpi-icon cta"><BarChart3 size={22} /></span><span><span className="adm-kpi-val" style={{ display: 'block' }}>{fmtMoney(data.kpis.average_ticket, { compact: true })}</span><span className="adm-kpi-lbl">Valor promedio por reserva pagada</span></span></div>
            <div className="adm-kpi tone-warn"><span className="adm-kpi-icon warn"><Percent size={22} /></span><span><span className="adm-kpi-val" style={{ display: 'block' }}>{Number(data.kpis.cancellation_rate).toLocaleString('es-EC', { maximumFractionDigits: 1 })} %</span><span className="adm-kpi-lbl">Cancelaciones ({data.kpis.cancellations})</span></span></div>
          </div>

          {data.kpis.reservations === 0 ? (
            <EmptyState icon={BarChart3} title="Sin ventas en este período">Elige un rango más amplio para ver tendencias.</EmptyState>
          ) : (
            <div className="charts-grid">
              <ChartCard className="wide" title="Ingresos por día" subtitle={`${fmtDate(from)} – ${fmtDate(to)}`}
                table={{ columns: [{ key: 'label', label: 'Día' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }], rows: byDay }}>
                <ColumnChart data={byDay} dataKey="revenue" name="Ingresos" fmt={money} extra={(r) => <div className="muted" style={{ marginTop: 2 }}>{r.reservations} reserva(s)</div>} />
              </ChartCard>

              <ChartCard className="wide" title="Atracciones con más ingresos" subtitle="Top 10"
                table={{ columns: [{ key: 'label', label: 'Atracción' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'tickets', label: 'Tickets', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }], rows: data.top_attractions.map((t) => ({ ...t, label: t.name })) }}>
                <RankChart data={data.top_attractions.map((t) => ({ ...t, label: t.name }))} dataKey="revenue" name="Ingresos" fmt={money} />
              </ChartCard>

              <ChartCard title="Ingresos por región"
                table={{ columns: [{ key: 'label', label: 'Región' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }], rows: data.by_region.map((r) => ({ ...r, label: REGION[r.region] })) }}>
                <CategoryBars data={data.by_region.map((r) => ({ ...r, label: REGION[r.region] })).sort((a, b) => b.revenue - a.revenue)} dataKey="revenue" name="Ingresos" fmt={money} colorOf={(d) => REGION_COLOR[d.region]} />
              </ChartCard>

              <ChartCard title="Reservas por método de pago"
                table={{ columns: [{ key: 'label', label: 'Método' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }], rows: data.by_payment_method.map((m) => ({ ...m, label: PAYMENT[m.method] })) }}>
                <CategoryBars data={data.by_payment_method.map((m) => ({ ...m, label: PAYMENT[m.method] }))} dataKey="reservations" name="Reservas" colorOf={(d) => PAY_COLOR[d.method]} />
              </ChartCard>

              <ChartCard className="wide" title="Ingresos por categoría" subtitle="Una atracción puede pertenecer a varias categorías"
                table={{ columns: [{ key: 'label', label: 'Categoría' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }], rows: data.by_category.map((c) => ({ ...c, label: c.name })) }}>
                <RankChart data={data.by_category.map((c) => ({ ...c, label: c.name }))} dataKey="revenue" name="Ingresos" fmt={money} color={SERIES[2]} />
              </ChartCard>
            </div>
          )}

          <section aria-labelledby="det-title">
            <h3 id="det-title" className="adm-section-title">Detalle de reservas ({data.rows.length})</h3>
            <div className="table-wrap table-wrap-alta" tabIndex={0} role="region" aria-label="Tabla desplazable">
              <table className="table">
<caption className="sr-only">Detalle de ventas del período</caption>
                <thead><tr><th scope="col">Código</th><th scope="col">Creada</th><th scope="col">Atracción</th><th scope="col">Tour</th><th scope="col">Cliente</th><th scope="col" className="num">Total</th><th scope="col">Estado</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.code}>
                      <td><code>{r.code}</code></td>
                      <td className="small nowrap">{new Date(r.created_at).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })}</td>
                      <td className="small">{r.attraction}</td>
                      <td className="small nowrap">{fmtDate(r.date, { day: 'numeric', month: 'short' })} {r.time}</td>
                      <td className="small">{r.customer}</td>
                      <td className="num">{fmtMoney(r.total)}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
