import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge, RefreshCw, ServerCrash, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { Ops } from '../api/client';
import { EmptyState, ErrorState, Segmented, useAsync } from '../components/ui';
import { fmtDateTime, fmtNumber } from '../utils/format';
import { CategoryBars, ChartCard, ColumnChart, RankChart, SERIES } from './charts';

const RANGOS = [
  { value: '1h', label: 'Última hora' },
  { value: '24h', label: 'Últimas 24 h' },
  { value: '7d', label: 'Últimos 7 días' },
];

/** Colores de ESTADO (reservados: nunca se usan como "serie 2"); siempre van con ícono y texto. */
const ESTADO = {
  good: { color: 'var(--success)', bg: 'var(--success-bg)', label: 'Bueno', Icon: CheckCircle2 },
  'needs-improvement': { color: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Mejorable', Icon: AlertTriangle },
  poor: { color: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Malo', Icon: XCircle },
};
const COLOR_CODIGO = (c) => (c >= 500 ? '#b91c1c' : c >= 400 ? '#b45309' : c >= 300 ? '#0369a1' : '#15803d');

const VITALES = {
  LCP: { nombre: 'Carga del contenido principal', desc: 'Cuánto tarda en verse lo más grande de la página' },
  INP: { nombre: 'Respuesta a la interacción', desc: 'Cuánto tarda la página en reaccionar a un toque o clic' },
  CLS: { nombre: 'Estabilidad visual', desc: 'Cuánto se mueve el contenido mientras carga (sin unidad)' },
  FCP: { nombre: 'Primer contenido', desc: 'Cuándo aparece el primer texto o imagen' },
  TTFB: { nombre: 'Primer byte', desc: 'Cuánto tarda en responder el servidor de la web' },
};

const EVENTOS = {
  'atracciones.reserva.creada': 'Reservas creadas',
  'atracciones.reserva.confirmada': 'Reservas confirmadas',
  'atracciones.reserva.cancelada': 'Reservas canceladas',
  'atracciones.pago.aprobado': 'Pagos aprobados',
  'atracciones.pago.reembolsado': 'Reembolsos',
  'atracciones.atraccion.publicada': 'Atracciones publicadas',
  'atracciones.atraccion.actualizada': 'Atracciones actualizadas',
  'atracciones.atraccion.retirada': 'Atracciones retiradas',
};

const fmtMs = (v, corto) => (v == null ? '—' : v < 1000 ? `${Math.round(v)}${corto ? '' : ' ms'}` : `${(v / 1000).toLocaleString('es-EC', { maximumFractionDigits: 1 })} s`);
const fmtPct = (v, dec = 2) => (v == null ? '—' : `${(v * 100).toLocaleString('es-EC', { maximumFractionDigits: dec })} %`);
const fmtVital = (nombre, v) => (v == null ? '—' : nombre === 'CLS' ? v.toLocaleString('es-EC', { maximumFractionDigits: 3 }) : fmtMs(v));

function etiqueta(iso, rango) {
  const d = new Date(iso);
  if (rango === '7d') return `${d.toLocaleDateString('es-EC', { weekday: 'short', timeZone: 'America/Guayaquil' })} ${d.toLocaleTimeString('es-EC', { hour: '2-digit', hour12: false, timeZone: 'America/Guayaquil' })}h`;
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Guayaquil' });
}

function Kpi({ icon: Icon, tone, value, label, hint }) {
  return (
    <div className={`adm-kpi tone-${tone}`}>
      <span className={`adm-kpi-icon ${tone}`}><Icon size={22} aria-hidden="true" /></span>
      <span>
        <span className="adm-kpi-val" style={{ display: 'block' }}>{value}</span>
        <span className="adm-kpi-lbl">{label}</span>
        {hint && <span className="muted tiny" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </div>
  );
}

function Estado({ rating }) {
  if (!rating) return <span className="muted small">Sin datos</span>;
  const { Icon, label, color, bg } = ESTADO[rating];
  return (
    <span className="obs-estado" style={{ color, background: bg }}>
      <Icon size={14} aria-hidden="true" /> {label}
    </span>
  );
}

/** Reparto bueno / mejorable / malo en una barra 100 % con texto (el color no es la única señal). */
function Distribucion({ d }) {
  const total = d.good + d.needs_improvement + d.poor;
  const partes = [['good', d.good], ['needs-improvement', d.needs_improvement], ['poor', d.poor]].filter(([, n]) => n > 0);
  const pct = (n) => Math.round((n / total) * 100);
  return (
    <>
      <div className="obs-dist" role="img" aria-label={`Bueno ${pct(d.good)} %, mejorable ${pct(d.needs_improvement)} %, malo ${pct(d.poor)} %`}>
        {partes.map(([k, n]) => <span key={k} style={{ flexGrow: n, background: ESTADO[k].color }} />)}
      </div>
      <div className="obs-dist-leyenda tiny muted">
        <span>Bueno {pct(d.good)} %</span><span>Mejorable {pct(d.needs_improvement)} %</span><span>Malo {pct(d.poor)} %</span>
      </div>
    </>
  );
}

function VitalCard({ v }) {
  const info = VITALES[v.name];
  const [bueno, malo] = v.thresholds;
  return (
    <section className="card obs-vital" aria-label={`${v.name}: ${info.nombre}`}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>
          <h4>{v.name}</h4>
          <p className="muted tiny">{info.nombre}</p>
        </div>
        <Estado rating={v.rating} />
      </div>
      <p className="obs-vital-val">{fmtVital(v.name, v.p75)} <span className="muted tiny">p75</span></p>
      <p className="muted tiny">{info.desc}. Bueno ≤ {fmtVital(v.name, bueno)} · malo &gt; {fmtVital(v.name, malo)}.</p>
      {v.distribution && <Distribucion d={v.distribution} />}
      <p className="muted tiny" style={{ marginTop: 6 }}>
        {fmtNumber(v.samples)} mediciones
        {v.by_device.map((d) => ` · ${d.device === 'movil' ? 'Móvil' : 'Escritorio'} ${fmtVital(v.name, d.p75)}`).join('')}
      </p>
    </section>
  );
}

/**
 * Observabilidad (docs/OBSERVABILIDAD.md): salud de la API, tráfico, latencias, errores contra
 * los objetivos de servicio (SLO), incidentes de la API y de la web, y la experiencia real de los
 * usuarios (Core Web Vitals). Se actualiza sola cada minuto mientras la pestaña está visible.
 */
export default function ObservabilidadAdmin() {
  const [rango, setRango] = useState('24h');
  const { data, loading, error, reload } = useAsync(() => Ops.resumen(rango), [rango]);
  const listo = useAsync(() => Ops.listo().catch((e) => ({ status: 'DOWN', error: e.message })), []);

  // reload cambia en cada render: se guarda en una ref para no reiniciar el intervalo
  const recargarRef = useRef(reload);
  recargarRef.current = reload;
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && recargarRef.current(), 60_000);
    return () => clearInterval(id);
  }, []);

  const recargar = () => { reload(); listo.reload(); };

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Observabilidad</h2>
          <p>
            Cómo está funcionando el sistema: tráfico, tiempos de respuesta, errores contra los objetivos de servicio, incidentes y la
            experiencia real de los usuarios. Cada error trae su código de soporte (<code>request_id</code>) para encontrarlo en los logs.
          </p>
        </div>
        <button className="btn" onClick={recargar}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
      </div>

      <div className="adm-toolbar obs-toolbar">
        <Segmented label="Periodo" value={rango} onChange={setRango} options={RANGOS} />
        <span className="small">
          {listo.data && (listo.data.status === 'UP'
            ? <span className="obs-estado" style={{ color: 'var(--success)', background: 'var(--success-bg)' }}><CheckCircle2 size={14} aria-hidden="true" /> API lista · base y migraciones al día</span>
            : <span className="obs-estado" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}><XCircle size={14} aria-hidden="true" /> API no lista</span>)}
          {data && <span className="muted"> · actualizado {fmtDateTime(data.generated_at)}</span>}
        </span>
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <div className="skeleton" style={{ height: 420 }} /> : data && <Contenido d={data} rango={rango} />}
    </>
  );
}

function Contenido({ d, rango }) {
  const t = d.totals;
  const slo = d.slo;
  const serie = d.series.map((s) => ({ ...s, label: etiqueta(s.from, rango) }));
  const ocurrencias = d.incidents.reduce((a, i) => a + i.count, 0);
  const presupuesto = slo.error_budget_remaining;
  const lentas = d.slowest_routes.map((r) => ({ label: `${r.method} ${r.route}`, p95: r.p95_ms, requests: r.requests }));
  const tablaRutas = {
    columns: [
      { key: 'label', label: 'Ruta' },
      { key: 'requests', label: 'Peticiones', num: true, fmt: fmtNumber },
      { key: 'p95', label: 'p95', num: true, fmt: (v) => fmtMs(v) },
    ],
    rows: lentas,
  };

  return (
    <>
      <h3 className="adm-section-title">Objetivos de servicio (SLO)</h3>
      <div className="adm-kpi-grid">
        <Kpi icon={Activity} tone="brand" value={fmtNumber(t.requests)} label="Peticiones a la API" hint={`${fmtNumber(t.errors_4xx)} con error del cliente (4xx)`} />
        <Kpi
          icon={ShieldCheck}
          tone={slo.availability == null || slo.availability >= slo.availability_target ? 'ok' : 'warn'}
          value={fmtPct(slo.availability)}
          label="Disponibilidad (sin errores 5xx)"
          hint={`Objetivo ≥ ${fmtPct(slo.availability_target, 1)} · ${fmtNumber(t.errors_5xx)} errores 5xx`}
        />
        <Kpi
          icon={Timer}
          tone={slo.p95_ok === false ? 'warn' : 'ok'}
          value={fmtMs(t.p95_ms)}
          label="Tiempo de respuesta p95"
          hint={`Objetivo ≤ ${fmtMs(slo.p95_target_ms)} · p50 ${fmtMs(t.p50_ms)} · p99 ${fmtMs(t.p99_ms)}`}
        />
        <Kpi
          icon={Gauge}
          tone={presupuesto == null || presupuesto > 0.25 ? 'ok' : 'warn'}
          value={presupuesto == null ? '—' : fmtPct(Math.max(presupuesto, 0), 0)}
          label="Presupuesto de errores restante"
          hint={presupuesto != null && presupuesto < 0 ? 'Agotado: se incumplió el SLO en el periodo' : 'Errores 5xx que aún caben en el objetivo'}
        />
        <Kpi icon={ServerCrash} tone={d.incidents.length ? 'warn' : 'ok'} value={fmtNumber(d.incidents.length)} label="Incidentes distintos" hint={`${fmtNumber(ocurrencias)} ocurrencias en la API y la web`} />
      </div>

      {!t.requests ? (
        <EmptyState icon={Activity} title="Sin tráfico en este periodo">Elige un periodo más largo o vuelve en unos minutos.</EmptyState>
      ) : (
        <div className="charts-grid">
          <ChartCard
            title="Tráfico"
            subtitle="Peticiones a la API por intervalo"
            table={{ columns: [{ key: 'label', label: 'Desde' }, { key: 'requests', label: 'Peticiones', num: true, fmt: fmtNumber }, { key: 'errors_5xx', label: 'Errores 5xx', num: true }], rows: serie }}
          >
            <ColumnChart data={serie} dataKey="requests" name="Peticiones" fmt={(v) => fmtNumber(v)}
              extra={(r) => <div className="ct-row tiny">Errores 5xx: <b>{r.errors_5xx}</b> · p95 {fmtMs(r.p95_ms)}</div>} />
          </ChartCard>
          <ChartCard
            title="Tiempo de respuesta p95"
            subtitle="El 95 % tardó esto o menos; la línea es el objetivo"
            table={{ columns: [{ key: 'label', label: 'Desde' }, { key: 'p95_ms', label: 'p95', num: true, fmt: (v) => fmtMs(v) }, { key: 'p50_ms', label: 'p50', num: true, fmt: (v) => fmtMs(v) }], rows: serie }}
          >
            <ColumnChart data={serie} dataKey="p95_ms" name="p95" fmt={(v, corto) => fmtMs(v, corto)} color={SERIES[2]} reference={{ value: slo.p95_target_ms, label: `Objetivo ${fmtMs(slo.p95_target_ms)}` }} />
          </ChartCard>
          <ChartCard
            title="Errores del servidor (5xx)"
            subtitle="Cada uno consume presupuesto de errores"
            table={{ columns: [{ key: 'label', label: 'Desde' }, { key: 'errors_5xx', label: 'Errores 5xx', num: true }], rows: serie }}
          >
            <ColumnChart data={serie} dataKey="errors_5xx" name="Errores 5xx" color="#b91c1c" />
          </ChartCard>
          <ChartCard title="Códigos de respuesta" subtitle="4xx: error del cliente · 5xx: del servidor"
            table={{ columns: [{ key: 'label', label: 'Código' }, { key: 'total', label: 'Peticiones', num: true, fmt: fmtNumber }], rows: d.status_codes.map((s) => ({ label: String(s.estado), total: s.total })) }}
          >
            <CategoryBars data={d.status_codes.map((s) => ({ label: String(s.estado), total: s.total, estado: s.estado }))} dataKey="total" name="Peticiones" fmt={(v) => fmtNumber(v)} colorOf={(x) => COLOR_CODIGO(x.estado)} />
          </ChartCard>
          {lentas.length > 0 && (
            <ChartCard title="Rutas más lentas" subtitle="p95 por ruta (con al menos 3 peticiones)" table={tablaRutas} className="wide">
              <RankChart data={lentas} dataKey="p95" name="p95" fmt={(v, corto) => fmtMs(v, corto)} />
            </ChartCard>
          )}
        </div>
      )}

      <h3 className="adm-section-title">Experiencia real de los usuarios (Core Web Vitals, p75)</h3>
      <div className="obs-vitals">{d.web_vitals.map((v) => <VitalCard key={v.name} v={v} />)}</div>

      <h3 className="adm-section-title">Incidentes</h3>
      {!d.incidents.length ? (
        <EmptyState icon={CheckCircle2} title="Sin incidentes en este periodo">Ni la API ni la web registraron errores.</EmptyState>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla de incidentes desplazable">
          <table className="table">
            <caption className="sr-only">Incidentes agrupados por error</caption>
            <thead>
              <tr>
                <th scope="col">Último</th><th scope="col" className="num">Veces</th><th scope="col">Origen</th><th scope="col">Error</th>
                <th scope="col">Ruta</th><th scope="col">Código de soporte</th>
              </tr>
            </thead>
            <tbody>
              {d.incidents.map((i) => (
                <tr key={i.fingerprint}>
                  <td className="small">{fmtDateTime(i.last_at)}</td>
                  <td className="num">{i.count}</td>
                  <td className="small">{i.source === 'api' ? 'API' : 'Web'}<div className="muted tiny">{i.type}{i.status ? ` · ${i.status}` : ''}</div></td>
                  <td className="small obs-msg">
                    {i.stack ? <details><summary>{i.message}</summary><pre className="obs-pila">{i.stack}</pre></details> : i.message}
                    <div className="muted tiny">{[i.version && `v${i.version}`, i.browser].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="small"><code>{i.method ? `${i.method} ` : ''}{i.route ?? '—'}</code></td>
                  <td className="small">{i.last_request_id ? <code title={i.last_request_id}>{i.last_request_id.slice(0, 8)}</code> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="adm-section-title" style={{ marginTop: 28 }}>Actividad del negocio en el periodo</h3>
      {!d.business.length ? <p className="muted small">Sin eventos de dominio en el periodo.</p> : (
        <div className="obs-chips">
          {d.business.map((b) => <span key={b.tipo} className="obs-chip"><b>{fmtNumber(b.total)}</b> {EVENTOS[b.tipo] ?? b.tipo}</span>)}
        </div>
      )}

      <p className="muted tiny" style={{ marginTop: 24 }}>
        Instancia que respondió: v{d.instance.version} · región {d.instance.region} · Node {d.instance.node} · {d.instance.memory_mb} MB ·
        iniciada {fmtDateTime(d.instance.started_at)}. Las métricas se suman entre todas las instancias (tabla <code>ops.metrica_http</code>).
      </p>
    </>
  );
}
