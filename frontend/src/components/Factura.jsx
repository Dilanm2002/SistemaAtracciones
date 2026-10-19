import { FileText } from 'lucide-react';
import { fmtDateTime, fmtMoney } from '../utils/format';

/**
 * Factura de la reserva (campo `invoice` de la API): encabezado y su detalle (factura_detalle),
 * una línea por tipo de pasajero. Solo existe cuando el pago está aprobado.
 * En lista y no en tabla para que en móvil no haga falta desplazar a los lados.
 */
export default function Factura({ invoice }) {
  if (!invoice) return null;
  const anulada = invoice.status === 'VOIDED';
  return (
    <section className="factura" aria-labelledby={`fac-${invoice.number}`}>
      <div className="factura-cab">
        <h3 id={`fac-${invoice.number}`}><FileText size={16} aria-hidden="true" /> Factura {invoice.number}</h3>
        {anulada && <span className="factura-anulada">Anulada</span>}
      </div>
      <p className="muted small">
        Emitida el {fmtDateTime(invoice.issued_at)}{invoice.customer_name ? ` a nombre de ${invoice.customer_name}` : ''}
      </p>
      <ul className="factura-lineas">
        {invoice.lines.map((l) => (
          <li key={l.line}>
            <span className="factura-desc">
              {l.description}
              <span className="muted small"> {l.quantity} × {fmtMoney(l.unit_price)}{l.tax_rate ? ` · IVA ${l.tax_rate} %` : ''}</span>
            </span>
            <span className="factura-monto">{fmtMoney(l.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="factura-totales">
        <dt>Subtotal</dt><dd>{fmtMoney(invoice.subtotal)}</dd>
        <dt>IVA</dt><dd>{fmtMoney(invoice.tax)}</dd>
        <dt>Total</dt><dd><strong>{fmtMoney(invoice.total)}</strong></dd>
      </dl>
      {anulada && <p className="muted small">La factura se anuló por el reembolso de la reserva.</p>}
    </section>
  );
}
