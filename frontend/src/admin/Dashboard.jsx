import { Link } from 'react-router-dom';
import { BarChart3, CalendarClock, CalendarDays, ClipboardList, DollarSign, Hourglass, Mail, Mountain, Plus, Users } from 'lucide-react';
import { Reportes } from '../api/client';
import { EmptyState, ErrorState, StatusBadge, useAsync } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { fmtDate, fmtMoney, todayEc } from '../utils/format';
import { useAdmin } from './AdminLayout';
import { ChartCard, ColumnChart } from './charts';

function Kpi({ icon: Icon, tone, value, label, to }) {
  const content = (
    <>
      <span className={`adm-kpi-icon ${tone}`}><Icon size={22} aria-hidden="true" /></span>
      <span>
        <span className="adm-kpi-val" style={{ display: 'block' }}>{value}</span>
        <span className="adm-kpi-lbl">{label}</span>
      </span>
    </>
  );
  return to ? <Link to={to} className={`adm-kpi tone-${tone}`}>{content}</Link> : <div className={`adm-kpi tone-${tone}`}>{content}</div>;
}

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const { counts } = useAdmin();
  const { data, loading, error, reload } = useAsync(() => Reportes.dashboard(), []);
  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      <div className="adm-welcome">
        <div>
          <h2>{saludo}, {user.nombre.split(' ')[0]}</h2>
          <p>Este es el resumen de la operación de hoy.</p>
        </div>
        <span className="adm-welcome-badge">{(() => { const t = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); })()}</span>
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          <div className="adm-kpi-grid" aria-busy={loading}>
            <Kpi icon={CalendarDays} tone="brand" value={loading ? '—' : data.kpis.reservations_today} label="Reservas para hoy" to={`/admin/reservas?fecha=${todayEc()}`} />
            <Kpi icon={Users} tone="info" value={loading ? '—' : data.kpis.travelers_today} label="Viajeros hoy" />
            {isAdmin && <Kpi icon={DollarSign} tone="ok" value={loading ? '—' : fmtMoney(data.kpis.revenue_month, { compact: true })} label={`Ingresos cobrados de ${new Date().toLocaleDateString('es-EC', { month: 'long' })}`} to="/admin/reportes" />}
            <Kpi icon={Hourglass} tone="warn" value={loading ? '—' : data.kpis.pending_reservations} label="Pendientes de pago" to="/admin/reservas?estado=PENDING" />
            <Kpi icon={Mountain} tone="cta" value={loading ? '—' : data.kpis.active_attractions} label="Atracciones activas" to={isAdmin ? '/admin/atracciones' : undefined} />
            {isAdmin && <Kpi icon={Mail} tone="info" value={counts.unread} label="Mensajes sin leer" to="/admin/mensajes" />}
          </div>

          <h2 className="adm-section-title">Accesos rápidos</h2>
          <div className="adm-quick-grid">
            {isAdmin && <Link to="/admin/atracciones?nueva=1" className="adm-quick-card"><span className="adm-quick-icon"><Plus size={20} /></span><strong>Nueva atracción</strong><span className="aq-sub">Publicar un tour o entrada</span></Link>}
            <Link to="/admin/reservas" className="adm-quick-card"><span className="adm-quick-icon"><ClipboardList size={20} /></span><strong>Reservas</strong><span className="aq-sub">Confirmar pagos y cancelar</span></Link>
            <Link to="/admin/disponibilidad" className="adm-quick-card"><span className="adm-quick-icon"><CalendarClock size={20} /></span><strong>Disponibilidad</strong><span className="aq-sub">Ocupación y días bloqueados</span></Link>
            {isAdmin && <Link to="/admin/reportes" className="adm-quick-card"><span className="adm-quick-icon"><BarChart3 size={20} /></span><strong>Reportes</strong><span className="aq-sub">Ventas y exportar a Excel</span></Link>}
          </div>

          <div className="adm-two">
            <ChartCard
              title="Ingresos cobrados de los últimos 7 días"
              subtitle="Por fecha en que se hizo la reserva (sin canceladas)"
              table={data && {
                columns: [{ key: 'label', label: 'Día' }, { key: 'reservations', label: 'Reservas', num: true }, { key: 'revenue', label: 'Ingresos', num: true, fmt: (v) => fmtMoney(v) }],
                rows: data.last_7_days.map((d) => ({ ...d, label: fmtDate(d.date, { weekday: 'short', day: 'numeric' }) })),
              }}
            >
              {loading ? <div className="skeleton" style={{ height: 260 }} /> : (
                <ColumnChart
                  data={data.last_7_days.map((d) => ({ ...d, label: fmtDate(d.date, { weekday: 'short', day: 'numeric' }) }))}
                  dataKey="revenue"
                  name="Ingresos"
                  fmt={(v) => fmtMoney(v, { compact: true })}
                  highlightLast
                  extra={(row) => <div className="muted" style={{ marginTop: 2 }}>{row.reservations} reserva(s)</div>}
                />
              )}
            </ChartCard>

            <section className="card" aria-labelledby="up-title">
              <div className="row-between" style={{ padding: '18px 18px 10px' }}>
                <h3 id="up-title" style={{ margin: 0, fontSize: '0.98rem' }}>Próximas salidas</h3>
                <Link to="/admin/reservas" className="small">Ver todas</Link>
              </div>
              {loading ? <div className="skeleton" style={{ height: 240, margin: 18 }} /> : data.upcoming.length === 0 ? (
                <EmptyState icon={CalendarDays} title="Sin salidas próximas" />
              ) : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ border: 0, borderTop: '1px solid var(--border)', borderRadius: 0 }}>
                  <table className="table">
<caption className="sr-only">Próximas salidas</caption>
                    <thead><tr><th scope="col">Fecha</th><th scope="col">Atracción</th><th scope="col" className="num">Pax</th><th scope="col">Estado</th></tr></thead>
                    <tbody>
                      {data.upcoming.map((r) => (
                        <tr key={r.reservation_id}>
                          <td className="nowrap"><strong>{fmtDate(r.date, { day: 'numeric', month: 'short' })}</strong> <span className="muted small">{r.time}</span></td>
                          <td><span style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem' }}>{r.attraction.name}</span><span className="muted tiny">{r.customer_name} · {r.code}</span></td>
                          <td className="num">{r.ticket_count}</td>
                          <td><StatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
