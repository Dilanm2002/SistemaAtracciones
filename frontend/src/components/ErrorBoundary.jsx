import { Component } from 'react';
import { reportarError } from '../api/telemetria';

/**
 * Último recurso ante un error al dibujar la interfaz: en lugar de una pantalla en blanco, un
 * mensaje con la opción de recargar, y el error queda registrado en el panel de Observabilidad.
 * Está fuera del router, así que usa enlaces normales (<a>) y no <Link>.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportarError({
      tipo: 'render',
      mensaje: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
      pila: `${error?.stack ?? ''}\n--- componentes ---${info?.componentStack ?? ''}`,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="container" style={{ padding: '64px 16px', maxWidth: 560, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Algo salió mal al mostrar esta página</h1>
        <p className="muted">Ya registramos el problema para revisarlo. Recarga la página para continuar; tus reservas no se ven afectadas.</p>
        <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Recargar la página</button>
          <a className="btn" href="/">Ir al inicio</a>
        </div>
      </main>
    );
  }
}
