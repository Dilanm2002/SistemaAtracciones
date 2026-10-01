import { Component, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import PublicLayout from './components/PublicLayout';
import { Spinner } from './components/ui';
import { lazyRecarga } from './utils/lazyRecarga';
import Home from './pages/Home';
import { Contact, Destinations, Favorites, Help, Login, NotFound, Profile, Register, RequireAuth } from './pages/MiscPages';

// Las páginas más pesadas del sitio se descargan al visitarlas (WEB-007)
const Explore = lazyRecarga(() => import('./pages/Explore'));
const AttractionDetail = lazyRecarga(() => import('./pages/AttractionDetail'));
const Checkout = lazyRecarga(() => import('./pages/Checkout'));
const Confirmation = lazyRecarga(() => import('./pages/Confirmation'));
const MyReservations = lazyRecarga(() => import('./pages/MyReservations'));

// El panel admin se carga bajo demanda: los viajeros no descargan su código
const AdminLayout = lazyRecarga(() => import('./admin/AdminLayout'));
const Dashboard = lazyRecarga(() => import('./admin/Dashboard'));
const AtraccionesAdmin = lazyRecarga(() => import('./admin/AtraccionesAdmin'));
const ReservasAdmin = lazyRecarga(() => import('./admin/ReservasAdmin'));
const DisponibilidadAdmin = lazyRecarga(() => import('./admin/DisponibilidadAdmin'));
const ReportesAdmin = lazyRecarga(() => import('./admin/ReportesAdmin'));
const CategoriasAdmin = lazyRecarga(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.CategoriasAdmin })));
const DestinosAdmin = lazyRecarga(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.DestinosAdmin })));
const OperadoresAdmin = lazyRecarga(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.OperadoresAdmin })));
const ClientesAdmin = lazyRecarga(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.ClientesAdmin })));
const UsuariosAdmin = lazyRecarga(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.UsuariosAdmin })));
const ResenasAdmin = lazyRecarga(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.ResenasAdmin })));
const IntegracionAdmin = lazyRecarga(() => import('./admin/IntegracionAdmin'));
const Empresas = lazyRecarga(() => import('./pages/Empresas'));
const SolicitudesAdmin = lazyRecarga(() => import('./admin/SolicitudesAdmin'));
const MensajesAdmin = lazyRecarga(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.MensajesAdmin })));

/** Atajo "/" para enfocar el buscador de la página (flexibilidad y eficiencia de uso). */
function useSearchShortcut() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      const target = document.querySelector('[data-shortcut-search]') ?? document.querySelector('#sb-q');
      if (target) { e.preventDefault(); target.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/** Si una página falla al cargar o al dibujarse, se muestra un aviso con «Recargar» en vez de una pantalla en blanco. */
class ErrorPagina extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem' }}>No pudimos mostrar esta página</h1>
        <p className="muted">Puede que haya una versión nueva del sitio o que se haya perdido la conexión.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Recargar</button>
      </div>
    );
  }
}

const Loading = () => <div style={{ padding: 60, display: 'flex', gap: 10, justifyContent: 'center' }}><Spinner label="Cargando…" /></div>;

export default function App() {
  useSearchShortcut();
  return (
    <ErrorPagina>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="explorar" element={<Explore />} />
          <Route path="destinos" element={<Destinations />} />
          <Route path="atraccion/:id" element={<AttractionDetail />} />
          <Route path="reservar/:id" element={<Checkout />} />
          <Route path="reserva/:id/confirmada" element={<RequireAuth><Confirmation /></RequireAuth>} />
          <Route path="mis-reservas" element={<RequireAuth><MyReservations /></RequireAuth>} />
          <Route path="perfil" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="favoritos" element={<Favorites />} />
          <Route path="ayuda" element={<Help />} />
          <Route path="contacto" element={<Contact />} />
          <Route path="empresas" element={<Empresas />} />
          <Route path="ingresar" element={<Login />} />
          <Route path="registro" element={<Register />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="admin" element={<RequireAuth staff><AdminLayout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="atracciones" element={<AtraccionesAdmin />} />
          <Route path="categorias" element={<CategoriasAdmin />} />
          <Route path="destinos" element={<DestinosAdmin />} />
          <Route path="operadores" element={<OperadoresAdmin />} />
          <Route path="reservas" element={<ReservasAdmin />} />
          <Route path="disponibilidad" element={<DisponibilidadAdmin />} />
          <Route path="clientes" element={<ClientesAdmin />} />
          <Route path="usuarios" element={<UsuariosAdmin />} />
          <Route path="reportes" element={<ReportesAdmin />} />
          <Route path="resenas" element={<ResenasAdmin />} />
          <Route path="mensajes" element={<MensajesAdmin />} />
          <Route path="integracion" element={<IntegracionAdmin />} />
          <Route path="solicitudes" element={<SolicitudesAdmin />} />
        </Route>
      </Routes>
    </Suspense>
    </ErrorPagina>
  );
}
