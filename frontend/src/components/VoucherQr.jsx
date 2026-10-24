import { QrCode } from 'lucide-react';
import { Reservas } from '../api/client';

/**
 * Código QR del voucher (contrato v2): el guía lo escanea en el punto de encuentro junto con el
 * documento del titular para registrar el check-in. Se muestra mientras la reserva esté vigente.
 */
export default function VoucherQr({ r }) {
  if (!r?.code || r.status === 'CANCELLED') return null;
  if (r.checked_in_at) {
    return <p className="voucher-qr-ok small"><QrCode size={16} aria-hidden="true" /> Check-in registrado: ¡disfruta la experiencia!</p>;
  }
  return (
    <section className="voucher-qr" aria-labelledby={`qr-${r.code}`}>
      <img src={Reservas.qrUrl(r.code)} alt={`Código QR del voucher ${r.code}`} width={150} height={150} loading="lazy" />
      <div>
        <h3 id={`qr-${r.code}`}><QrCode size={16} aria-hidden="true" /> Tu voucher</h3>
        <p className="small">Muestra este código y tu documento de identidad al guía en el punto de encuentro. Código de reserva: <strong>{r.code}</strong>.</p>
      </div>
    </section>
  );
}
