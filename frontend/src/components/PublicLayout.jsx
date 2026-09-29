import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Compass, Heart, HelpCircle, LayoutDashboard, LogIn, LogOut, Mail, Map, Menu, Mountain, User, X,
} from 'lucide-react';
import { ROL_LABEL, useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { initials } from '../utils/format';

export function BrandMark({ size = 20 }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Mountain size={size} color="#fff" strokeWidth={2.4} />
    </span>
  );
}

const NAV = [
  { to: '/explorar', label: 'Explorar', icon: Compass },
  { to: '/destinos', label: 'Destinos', icon: Map },
  { to: '/ayuda', label: 'Ayuda', icon: HelpCircle },
  { to: '/contacto', label: 'Contacto', icon: Mail },
];

function UserMenu() {
  const { user, isStaff, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">{initials(user.nombre)}</span>
        <span className="hide-mobile" style={{ fontWeight: 600 }}>{user.nombre.split(' ')[0]}</span>
      </button>
      {open && (
        <div className="dropdown-menu" role="menu" onClick={() => setOpen(false)}>
          <div className="dropdown-head">
            <strong>{user.nombre}</strong>
            <span className="muted small">{user.email} · {ROL_LABEL[user.rol]}</span>
          </div>
          <hr />
          {isStaff && <Link role="menuitem" to="/admin"><LayoutDashboard size={18} /> Panel de administración</Link>}
          <Link role="menuitem" to="/mis-reservas"><CalendarCheck size={18} /> Mis reservas</Link>
          <Link role="menuitem" to="/favoritos"><Heart size={18} /> Favoritos</Link>
          <Link role="menuitem" to="/perfil"><User size={18} /> Mi perfil</Link>
          <hr />
          <button role="menuitem" onClick={() => { logout(); navigate('/'); }}><LogOut size={18} /> Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { isAuth, isStaff } = useAuth();
  const { ids } = useFavorites();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const overHero = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setMobile(false); }, [pathname]);

  return (
    <header className={`site-header ${overHero && !scrolled ? 'transparent' : ''}`}>
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label="Descubre EC, ir al inicio">
          <BrandMark />
          <span>Descubre<b>EC</b></span>
        </Link>
        <nav className="main-nav" aria-label="Principal">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
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
            <Link to="/ingresar" state={{ from: pathname }} className="btn btn-sm btn-cta">
              <LogIn size={16} /> <span className="hide-xs">Ingresar</span>
            </Link>
          )}
          <button className="icon-btn menu-toggle" onClick={() => setMobile(true)} aria-label="Abrir menú" aria-expanded={mobile}>
            <Menu size={22} />
          </button>
        </div>
      </div>
      {mobile && (
        <div className="mobile-nav" onClick={(e) => e.target === e.currentTarget && setMobile(false)}>
          <nav aria-label="Menú móvil">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="brand"><BrandMark /> Descubre<b>EC</b></span>
              <button className="icon-btn" onClick={() => setMobile(false)} aria-label="Cerrar menú"><X size={22} /></button>
            </div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="nav-link"><n.icon size={20} /> {n.label}</NavLink>
            ))}
            <NavLink to="/favoritos" className="nav-link"><Heart size={20} /> Favoritos</NavLink>
            {isAuth && <NavLink to="/mis-reservas" className="nav-link"><CalendarCheck size={20} /> Mis reservas</NavLink>}
            {isStaff && <NavLink to="/admin" className="nav-link"><LayoutDashboard size={20} /> Panel de administración</NavLink>}
          </nav>
        </div>
      )}
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
              <li><Link to="/contacto?asunto=PROVEEDOR">Publica tus tours</Link></li>
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
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <a href="#main" className="skip-link">Saltar al contenido</a>
      <Header />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
