import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Compass, Heart, HelpCircle, Home, LayoutDashboard, LogIn, LogOut, Mail, Map, Menu, Mountain, Store, User, X,
} from 'lucide-react';
import { ROL_LABEL, useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { initials } from '../utils/format';
import { Drawer, Spinner } from './ui';

export function BrandMark({ size = 20 }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Mountain size={size} color="#fff" strokeWidth={2.4} />
    </span>
  );
}

const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/destinos', label: 'Destinos', icon: Map },
  { to: '/empresas', label: 'Para empresas', icon: Store },
  { to: '/ayuda', label: 'Ayuda', icon: HelpCircle },
  { to: '/contacto', label: 'Contacto', icon: Mail },
];

/**
 * Menú de cuenta con patrón disclosure (ACC-003): botón con aria-expanded/aria-controls
 * y una lista de enlaces normal, navegable con Tab. Esc cierra y devuelve el foco al botón.
 */
function UserMenu() {
  const { user, isStaff, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const panelId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    // Si el foco sale del menú con Tab, se cierra
    const focusOut = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    document.addEventListener('focusin', focusOut);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      document.removeEventListener('focusin', focusOut);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        ref={btnRef}
        className="user-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Cuenta de ${user.nombre}`}
      >
        <span className="avatar" aria-hidden="true">{initials(user.nombre)}</span>
        <span className="hide-mobile" style={{ fontWeight: 600 }} aria-hidden="true">{user.nombre.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="dropdown-menu" id={panelId} onClick={(e) => e.target.closest('a,button') && setOpen(false)}>
          <div className="dropdown-head">
            <strong>{user.nombre}</strong>
            <span className="muted small">{user.email} · {ROL_LABEL[user.rol]}</span>
          </div>
          <hr aria-hidden="true" />
          <ul className="dropdown-list">
            {isStaff && <li><Link to="/admin"><LayoutDashboard size={18} aria-hidden="true" /> Panel de administración</Link></li>}
            <li><Link to="/mis-reservas"><CalendarCheck size={18} aria-hidden="true" /> Mis reservas</Link></li>
            <li><Link to="/favoritos"><Heart size={18} aria-hidden="true" /> Favoritos</Link></li>
            <li><Link to="/perfil"><User size={18} aria-hidden="true" /> Mi perfil</Link></li>
          </ul>
          <hr aria-hidden="true" />
          <button type="button" onClick={() => { logout(); navigate('/'); }}><LogOut size={18} aria-hidden="true" /> Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { isAuth, isStaff } = useAuth();
  const { ids } = useFavorites();
  const { pathname } = useLocation();
  const [mobile, setMobile] = useState(false);
  // Misma barra de navegación fija (sticky) en todas las páginas, también en el inicio

  useEffect(() => { setMobile(false); }, [pathname]);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="Descubre EC, ir al inicio">
          <BrandMark />
          <span>Descubre<b>EC</b></span>
        </Link>
        <nav className="main-nav" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <Link to="/favoritos" className="icon-btn hide-xs" style={{ position: 'relative' }} aria-label={`Favoritos (${ids.length})`} data-tip="Favoritos">
            <Heart size={20} />
            {ids.length > 0 && <span className="fav-count" aria-hidden="true">{ids.length}</span>}
          </Link>
          {isAuth ? (
            <>
              {isStaff && (
                <Link to="/admin" className="btn btn-sm btn-primary hide-mobile">
                  <LayoutDashboard size={16} /> Panel
                </Link>
              )}
              <UserMenu />
            </>
          ) : (
            <Link to="/ingresar" state={{ from: pathname }} className="btn btn-sm btn-cta" aria-label="Ingresar">
              <LogIn size={16} aria-hidden="true" /> <span className="hide-xs">Ingresar</span>
            </Link>
          )}
          <button className="icon-btn menu-toggle" onClick={() => setMobile(true)} aria-label="Abrir menú" aria-expanded={mobile} aria-controls="menu-movil" aria-haspopup="dialog">
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      <Drawer open={mobile} onClose={() => setMobile(false)} label="Menú" id="menu-movil" className="mobile-nav">
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="brand"><BrandMark /> Descubre<b>EC</b></span>
          <button className="icon-btn" onClick={() => setMobile(false)} aria-label="Cerrar menú"><X size={22} aria-hidden="true" /></button>
        </div>
        <nav aria-label="Menú móvil" className="mobile-nav-links">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link"><n.icon size={20} aria-hidden="true" /> {n.label}</NavLink>
          ))}
          <NavLink to="/favoritos" className="nav-link"><Heart size={20} aria-hidden="true" /> Favoritos</NavLink>
          {isAuth && <NavLink to="/mis-reservas" className="nav-link"><CalendarCheck size={20} aria-hidden="true" /> Mis reservas</NavLink>}
          {isStaff && <NavLink to="/admin" className="nav-link"><LayoutDashboard size={20} aria-hidden="true" /> Panel de administración</NavLink>}
        </nav>
      </Drawer>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link to="/" className="brand"><BrandMark /> <span>Descubre<b>EC</b></span></Link>
            <p style={{ marginTop: 14, maxWidth: 320, fontSize: '0.93rem' }}>
              Reserva tours, entradas y experiencias en los cuatro mundos del Ecuador: Andes, Costa, Amazonía y Galápagos.
            </p>
          </div>
          <div>
            <h4>Explora</h4>
            <ul>
              <li><Link to="/explorar?region=GALAPAGOS">Galápagos</Link></li>
              <li><Link to="/explorar?region=SIERRA">Andes</Link></li>
              <li><Link to="/explorar?region=AMAZONIA">Amazonía</Link></li>
              <li><Link to="/explorar?region=COSTA">Costa</Link></li>
            </ul>
          </div>
          <div>
            <h4>Ayuda</h4>
            <ul>
              <li><Link to="/ayuda#reservar">Cómo reservar</Link></li>
              <li><Link to="/ayuda#cancelacion">Cancelaciones</Link></li>
              <li><Link to="/ayuda#pagos">Métodos de pago</Link></li>
              <li><Link to="/contacto">Contáctanos</Link></li>
            </ul>
          </div>
          <div>
            <h4>Tu cuenta</h4>
            <ul>
              <li><Link to="/mis-reservas">Mis reservas</Link></li>
              <li><Link to="/favoritos">Favoritos</Link></li>
              <li><Link to="/empresas">Publica tus tours (empresas)</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Descubre EC · Proyecto académico de Integración de Sistemas</span>
          <span>Fotos: Wikimedia Commons (CC BY / CC BY-SA / CC0)</span>
        </div>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const first = useRef(true);
  // Al navegar: arriba del todo y foco en <main> para que el lector anuncie la vista nueva (ACC-006).
  // En la carga inicial no se mueve el foco (el navegador ya empieza en el documento).
  useEffect(() => {
    window.scrollTo(0, 0);
    if (first.current) { first.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">Saltar al contenido</a>
      <Header />
      <main ref={mainRef} id="main" tabIndex={-1} className="site-main">
        {/* Suspense aquí: al cargar una página diferida, cabecera y pie siguen visibles */}
        <Suspense fallback={<div className="container" style={{ padding: '60px 0', textAlign: 'center' }}><Spinner label="Cargando…" /></div>}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
