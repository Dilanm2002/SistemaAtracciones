import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import PublicLayout from './components/PublicLayout';
import { Spinner } from './components/ui';
import AttractionDetail from './pages/AttractionDetail';
import Checkout from './pages/Checkout';
import Confirmation from './pages/Confirmation';
import Explore from './pages/Explore';
import Home from './pages/Home';
import { Contact, Destinations, Favorites, Help, Login, NotFound, Profile, Register, RequireAuth } from './pages/MiscPages';
import MyReservations from './pages/MyReservations';

// El panel admin se carga bajo demanda: los viajeros no descargan su código
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const Dashboard = lazy(() => import('./admin/Dashboard'));
const AtraccionesAdmin = lazy(() => import('./admin/AtraccionesAdmin'));
const ReservasAdmin = lazy(() => import('./admin/ReservasAdmin'));
const DisponibilidadAdmin = lazy(() => import('./admin/DisponibilidadAdmin'));
const ReportesAdmin = lazy(() => import('./admin/ReportesAdmin'));
const CategoriasAdmin = lazy(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.CategoriasAdmin })));
const DestinosAdmin = lazy(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.DestinosAdmin })));
const OperadoresAdmin = lazy(() => import('./admin/CatalogAdmin').then((m) => ({ default: m.OperadoresAdmin })));
const ClientesAdmin = lazy(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.ClientesAdmin })));
const UsuariosAdmin = lazy(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.UsuariosAdmin })));
const ResenasAdmin = lazy(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.ResenasAdmin })));
const MensajesAdmin = lazy(() => import('./admin/PeopleAdmin').then((m) => ({ default: m.MensajesAdmin })));

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

const Loading = () => <div style={{ padding: 60, display: 'flex', gap: 10, justifyContent: 'center' }}><Spinner /> Cargando…</div>;

export default function App() {
  useSearchShortcut();
  return (
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
        </Route>
      </Routes>
    </Suspense>
  );
}
