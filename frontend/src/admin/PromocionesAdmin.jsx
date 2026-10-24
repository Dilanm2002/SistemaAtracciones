import { useEffect, useState } from 'react';
import { BadgePercent, Save } from 'lucide-react';
import { Promociones } from '../api/client';
import { Alert, ErrorState, Field, RequiredLegend, Spinner, Switch, useAsync } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { fmtDate } from '../utils/format';
import { correo, hoyEc, limpiar, numero, texto } from '../utils/validation';

/**
 * Acuerdo B2B de promociones y combos con Booking Prototipo (contrato v2, Consideraciones RDA2 pág. 149):
 * «se solicita una sola vez: si acepta hacer promociones y cuál es el porcentaje máximo de descuento».
 * Booking lo consulta en GET /api/v2/atracciones/promociones/contrato para armar paquetes.
 */
export default function PromocionesAdmin() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => Promociones.get(), []);
  const [f, setF] = useState(null);
  const [errores, setErrores] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setF({
      permite: data.permite_promociones,
      porcentaje: String(data.porcentaje_descuento_maximo),
      destinos: data.destinos_habilitados.join(', '),
      vigencia: data.vigencia_hasta,
      condiciones: data.condiciones_combo ?? '',
      contactoNombre: '',
      contactoEmail: '',
    });
  }, [data]);

  const guardar = async (e) => {
    e.preventDefault();
    const destinos = f.destinos.split(',').map((d) => d.trim()).filter(Boolean);
    const errs = limpiar({
      porcentaje: f.permite ? numero(f.porcentaje, { min: 0, max: 50, decimales: 2, que: 'El porcentaje máximo' }) : null,
      destinos: destinos.length > 50 ? 'Máximo 50 destinos' : destinos.some((d) => d.length > 80) ? 'Cada destino puede tener hasta 80 caracteres' : null,
      vigencia: !f.vigencia ? 'Indica hasta cuándo es válido el acuerdo' : f.vigencia < hoyEc() ? 'La vigencia no puede estar en el pasado' : null,
      condiciones: texto(f.condiciones, { max: 500, requerido: false, que: 'Las condiciones' }),
      contactoEmail: f.contactoEmail ? correo(f.contactoEmail) : null,
    });
    setErrores(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await Promociones.update({
        permite_promociones: f.permite,
        porcentaje_descuento_maximo: f.permite ? Number(f.porcentaje) : 0,
        destinos_habilitados: destinos,
        vigencia_hasta: f.vigencia,
        ...(f.condiciones.trim() ? { condiciones_combo: f.condiciones.trim() } : {}),
        ...(f.contactoNombre.trim() || f.contactoEmail.trim()
          ? { contacto_comercial: { ...(f.contactoNombre.trim() ? { nombre: f.contactoNombre.trim() } : {}), ...(f.contactoEmail.trim() ? { email: f.contactoEmail.trim() } : {}) } }
          : {}),
      });
      toast('Acuerdo de promociones actualizado', 'success');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  return (
    <>
      <div className="adm-module-head">
        <div>
          <h2>Promociones con Booking</h2>
          <p>
            Acuerdo comercial B2B del contrato de integración v2: si aceptas que Booking Prototipo arme paquetes y combos (tour + hotel + vuelo)
            con tus experiencias y cuál es el descuento máximo que autorizas. Booking lo consulta antes de armar cada paquete.
          </p>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading || !f ? <div className="skeleton" style={{ height: 320 }} /> : (
        <form className="card card-pad stack" onSubmit={guardar} noValidate style={{ maxWidth: 760 }}>
          <RequiredLegend />
          <p className="muted small">
            Acordado el {fmtDate(data.fecha_acuerdo, { day: 'numeric', month: 'long', year: 'numeric' })} · proveedor <code>{data.proveedor_id}</code>
          </p>
          <Switch checked={f.permite} onChange={set('permite')} label="Acepto participar en promociones y paquetes con Booking Prototipo" />
          {f.permite ? (
            <Field label="Descuento máximo autorizado (%)" required error={errores.porcentaje} hint="Entre 0 y 50 %. Cada experiencia puede tener uno menor, nunca mayor">
              {(p) => <input {...p} className="input" inputMode="decimal" autoComplete="off" maxLength={5} value={f.porcentaje} onChange={(e) => set('porcentaje')(e.target.value.replace(/[^\d.]/g, ''))} />}
            </Field>
          ) : (
            <Alert tone="info">Sin promociones: Booking venderá tus experiencias solo a la tarifa pública (descuento 0 %).</Alert>
          )}
          <Field label="Destinos habilitados" error={errores.destinos} hint="Separados por comas, p. ej. Quito, Baños de Agua Santa, Cuenca">
            {(p) => <input {...p} className="input" value={f.destinos} onChange={set('destinos')} />}
          </Field>
          <Field label="Vigente hasta" required error={errores.vigencia}>
            {(p) => <input {...p} className="input" type="date" min={hoyEc()} value={f.vigencia} onChange={set('vigencia')} />}
          </Field>
          <Field label="Condiciones del combo" error={errores.condiciones} hint="Anticipación mínima, temporadas excluidas, etc.">
            {(p) => <textarea {...p} className="input" rows={3} maxLength={500} value={f.condiciones} onChange={set('condiciones')} />}
          </Field>
          <div className="form-grid">
            <Field label="Contacto comercial">{(p) => <input {...p} className="input" maxLength={120} placeholder="Nombre (opcional)" value={f.contactoNombre} onChange={set('contactoNombre')} />}</Field>
            <Field label="Correo del contacto" error={errores.contactoEmail}>{(p) => <input {...p} className="input" type="email" maxLength={160} placeholder="Opcional" value={f.contactoEmail} onChange={set('contactoEmail')} />}</Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={saving}>{saving ? <Spinner /> : <Save size={16} aria-hidden="true" />} Guardar acuerdo</button>
          </div>
          <p className="muted tiny"><BadgePercent size={12} aria-hidden="true" /> Booking lo lee en <code>GET /api/v2/atracciones/promociones/contrato</code>.</p>
        </form>
      )}
    </>
  );
}
