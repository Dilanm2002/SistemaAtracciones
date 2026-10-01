import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ConfirmProvider } from './components/ui';
import { AuthProvider } from './context/AuthContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { ToastProvider } from './context/ToastContext';
import './styles/base.css';
import './styles/components.css';
import './styles/public.css';
// admin.css se importa desde AdminLayout (chunk diferido del panel) — WEB-004

// Rendimiento: el código de la página que se abre se descarga en paralelo con el principal,
// en lugar de en cadena (principal → panel → página). Mismos módulos que los lazy() de App.
const PRECARGA = [
  [/^\/admin/, () => import('./admin/AdminLayout')],
  [/^\/admin\/?$/, () => import('./admin/Dashboard')],
  [/^\/admin\/atracciones/, () => import('./admin/AtraccionesAdmin')],
  [/^\/admin\/reservas/, () => import('./admin/ReservasAdmin')],
  [/^\/admin\/disponibilidad/, () => import('./admin/DisponibilidadAdmin')],
  [/^\/admin\/(categorias|destinos|operadores)/, () => import('./admin/CatalogAdmin')],
  [/^\/admin\/(clientes|usuarios|resenas|mensajes)/, () => import('./admin/PeopleAdmin')],
  [/^\/admin\/solicitudes/, () => import('./admin/SolicitudesAdmin')],
  [/^\/explorar/, () => import('./pages/Explore')],
  [/^\/atraccion\//, () => import('./pages/AttractionDetail')],
  [/^\/reservar\//, () => import('./pages/Checkout')],
  [/^\/reserva\//, () => import('./pages/Confirmation')],
  [/^\/mis-reservas/, () => import('./pages/MyReservations')],
  [/^\/empresas/, () => import('./pages/Empresas')],
];
PRECARGA.forEach(([re, cargar]) => re.test(window.location.pathname) && cargar().catch(() => {}));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <FavoritesProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </FavoritesProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
