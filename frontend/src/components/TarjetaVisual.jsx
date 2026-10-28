/**
 * Vista previa de la tarjeta (pago simulado del prototipo): se llena mientras el usuario escribe y gira
 * al lado del CVV. Es solo decorativa (aria-hidden): los campos del formulario siguen siendo la fuente
 * de verdad y los lectores de pantalla los leen tal cual. No guarda ni envía nada.
 */
const MARCAS = { VISA: 'VISA', MASTERCARD: 'Mastercard', AMEX: 'American Express', DINERS: 'Diners Club' };

/** Número con los dígitos escritos y el resto como puntos, en grupos de 4 (igual que el campo). */
function numeroVisible(numero) {
  const d = numero.replace(/\D/g, '').slice(0, 16);
  return Array.from({ length: 16 }, (_, i) => d[i] ?? '•')
    .join('')
    .replace(/(.{4})(?=.)/g, '$1 ');
}

export default function TarjetaVisual({ numero, titular, exp, cvv, marca, foco }) {
  const girada = foco === 'cvv';
  const nombreMarca = MARCAS[marca];
  return (
    <div className={`tarjeta-visual ${girada ? 'girada' : ''} marca-${(marca || 'OTRA').toLowerCase()}`} aria-hidden="true">
      <div className="tarjeta-giro">
        <div className="tarjeta-cara tarjeta-frente">
          <div className="tarjeta-fila">
            <span className="tarjeta-chip" />
            <span className={`tarjeta-marca ${nombreMarca ? 'visible' : ''}`}>
              {marca === 'MASTERCARD' && <span className="tarjeta-circulos"><i /><i /></span>}
              {nombreMarca ?? ''}
            </span>
          </div>
          <div className={`tarjeta-numero ${foco === 'numero' ? 'activo' : ''}`}>{numeroVisible(numero)}</div>
          <div className="tarjeta-fila tarjeta-pie">
            <div className={`tarjeta-dato tarjeta-titular ${foco === 'titular' ? 'activo' : ''}`}>
              <small>Titular</small>
              <span>{titular.trim() ? titular.toUpperCase() : 'NOMBRE APELLIDO'}</span>
            </div>
            <div className={`tarjeta-dato ${foco === 'exp' ? 'activo' : ''}`}>
              <small>Vence</small>
              <span>{exp || 'MM/AA'}</span>
            </div>
          </div>
        </div>
        <div className="tarjeta-cara tarjeta-dorso">
          <span className="tarjeta-banda" />
          <div className="tarjeta-firma">
            <span className="tarjeta-cvv">{cvv ? '•'.repeat(cvv.length) : 'CVV'}</span>
          </div>
          <p className="tarjeta-aviso">Tarjeta simulada · prototipo sin cargos reales</p>
        </div>
      </div>
    </div>
  );
}
