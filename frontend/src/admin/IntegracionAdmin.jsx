import { useState } from 'react';
import { ExternalLink, FileCode2, RefreshCw, Webhook } from 'lucide-react';
import { API_URL, Eventos } from '../api/client';
import { EmptyState, ErrorState, Segmented, useAsync } from '../components/ui';
import { fmtDateTime } from '../utils/format';

const API_HOST = API_URL.replace(/\/api\/v1$/, '');

const TIPOS = {
  'atracciones.reserva.creada': 'Reserva creada',
  'atracciones.reserva.confirmada': 'Reserva confirmada',
  'atracciones.reserva.cancelada': 'Reserva cancelada',
  'atracciones.pago.aprobado': 'Pago aprobado',
  'atracciones.pago.reembolsado': 'Pago reembolsado',
  'atracciones.atraccion.publicada': 'Atracción publicada',
  'atracciones.atraccion.actualizada': 'Atracción actualizada',
  'atracciones.atraccion.retirada': 'Atracción retirada',
};

const RECURSOS = [
  { label: 'Swagger (implementación)', href: `${API_HOST}/api/docs`, desc: 'Prueba los endpoints en vivo' },
  { label: 'Redoc (contrato OpenAPI)', href: `${API_HOST}/api/redoc`, desc: 'El contrato API-First acordado' },
  { label: 'AsyncAPI (eventos)', href: `${API_URL}/contracts/atracciones-asyncapi.yaml`, desc: 'Canales y mensajes del dominio' },
  { label: 'GraphQL (Federation)', href: `${API_URL}/contracts/atracciones.graphql`, desc: 'Subgrafo y entidades @key' },
  { label: 'gRPC (proto)', href: `${API_URL}/contracts/atracciones.proto`, desc: 'Servicio para integraciones internas' },
  { label: 'Estado del servicio', href: `${API_URL}/atracciones/health`, desc: 'API y base de datos' },
];

/** Preparación para la integración: eventos de dominio (outbox) y contratos publicados. */
export default function IntegracionAdmin() {
  const [tipo, setTipo] = useState('');
  const resumen = useAsync(() => Eventos.resumen(), []);
  const feed = useAsync(() => Eventos.ultimos(tipo), [tipo]);

  const recargar = () => { resumen.reload(); feed.reload(); };

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Integración</h2>
          <p>
            Eventos de dominio que otros sistemas del marketplace (vuelos, alojamientos, notificaciones) pueden consumir con el feed
            <code> GET /api/v1/eventos?after=</code>. Se guardan en la tabla <code>evento</code> dentro de la misma transacción que la operación.
          </p>
        </div>
        <button className="btn" onClick={recargar}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
      </div>

      <h3 className="adm-section-title">Contratos y documentación</h3>
      <div className="adm-quick-grid">
        {RECURSOS.map((r) => (
          <a key={r.label} className="adm-quick-card" href={r.href} target="_blank" rel="noopener noreferrer">
            <span className="adm-quick-icon"><FileCode2 size={20} aria-hidden="true" /></span>
            <span>
              <strong>{r.label}</strong>
              <span className="muted small" style={{ display: 'block' }}>{r.desc}</span>
            </span>
            <ExternalLink size={14} aria-hidden="true" style={{ marginLeft: 'auto' }} />
            <span className="sr-only">(se abre en una pestaña nueva)</span>
          </a>
        ))}
      </div>

      <h3 className="adm-section-title">Eventos publicados</h3>
      {resumen.error ? <ErrorState error={resumen.error} onRetry={resumen.reload} /> : (
        <div className="adm-kpi-grid" style={{ marginBottom: 20 }}>
          {(resumen.data ?? []).map((r) => (
            <div key={r.type} className="adm-kpi tone-info">
              <span className="adm-kpi-icon info"><Webhook size={22} aria-hidden="true" /></span>
              <span>
                <span className="adm-kpi-val" style={{ display: 'block' }}>{r.total}</span>
                <span className="adm-kpi-lbl">{TIPOS[r.type] ?? r.type}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="adm-toolbar">
        <Segmented
          label="Filtrar por tipo de evento"
          value={tipo}
          onChange={setTipo}
          options={[{ value: '', label: 'Todos' }, ...Object.entries(TIPOS).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {feed.error ? <ErrorState error={feed.error} onRetry={feed.reload} /> : feed.loading ? <div className="skeleton" style={{ height: 240 }} /> : !feed.data.length ? (
        <EmptyState icon={Webhook} title="Todavía no hay eventos">Se generan al reservar, confirmar pagos, cancelar o editar atracciones.</EmptyState>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
            <caption className="sr-only">Últimos eventos de dominio</caption>
            <thead><tr><th scope="col" className="num">#</th><th scope="col">Evento</th><th scope="col">Agregado</th><th scope="col">Datos</th><th scope="col">Fecha</th></tr></thead>
            <tbody>
              {feed.data.map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.sequence}</td>
                  <td><strong>{TIPOS[e.type] ?? e.type}</strong><div className="muted tiny"><code>{e.type}</code></div></td>
                  <td className="small">{e.aggregate}<div className="muted tiny">{e.aggregate_id.slice(0, 8)}…</div></td>
                  <td className="small">
                    {e.data.code ?? e.data.name}
                    {e.data.total && <> · {e.data.total.currency} {Number(e.data.total.total).toFixed(2)}</>}
                    {e.data.reason && <div className="muted tiny">{e.data.reason}</div>}
                  </td>
                  <td className="small">{fmtDateTime(e.occurred_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
