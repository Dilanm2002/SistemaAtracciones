import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Building2, CalendarClock, ClipboardList, ExternalLink, KeyRound, LayoutGrid, LogOut, Mail, Map, Menu,
  MessageSquareText, Mountain, Shapes, UserCog, Users,
} from 'lucide-react';
import { Auth, Mensajes, Reservas } from '../api/client';
import { Field, Modal, Spinner } from '../components/ui';
import { ROL_LABEL, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { initials } from '../utils/format';

const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);

/** Navegación agrupada como en Sal y Canela. `scope` = permiso OAuth2 requerido. */
export const NAV = [
  { group: 'GENERAL', items: [{ to: '/admin', end: true, label: 'Dashboard', icon: LayoutGrid, scope: 'attractions:manage' }] },
  {
    group: 'CATÁLOGO',
    items: [
      { to: '/admin/atracciones', label: 'Atracciones', icon: Mountain, scope: 'attractions:write' },
      { to: '/admin/categorias', label: 'Categorías', icon: Shapes, scope: 'attractions:write' },
      { to: '/admin/destinos', label: 'Destinos', icon: Map, scope: 'attractions:write' },
      { to: '/admin/operadores', label: 'Operadores', icon: Building2, scope: 'attractions:write' },
    ],
  },
  {
    group: 'OPERACIÓN',
    items: [
      { to: '/admin/reservas', label: 'Reservas', icon: ClipboardList, scope: 'attractions:manage', badge: 'pending' },
      { to: '/admin/disponibilidad', label: 'Disponibilidad', icon: CalendarClock, scope: 'attractions:manage' },
    ],
  },
  {
    group: 'PERSONAS',
    items: [
      { to: '/admin/clientes', label: 'Clientes', icon: Users, scope: 'admin:full' },
      { to: '/admin/usuarios', label: 'Usuarios y roles', icon: UserCog, scope: 'admin:full' },
    ],
  },
  {
    group: 'ANÁLISIS',
    items: [
      { to: '/admin/reportes', label: 'Reportes', icon: BarChart3, scope: 'admin:full' },
      { to: '/admin/resenas', label: 'Reseñas', icon: MessageSquareText, scope: 'attractions:write' },
      { to: '/admin/mensajes', label: 'Mensajes', icon: Mail, scope: 'admin:full', badge: 'unread' },
    ],
  },
];

function ChangePasswordModal({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ actual: '', nueva: '' });
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!f.actual) errs.actual = 'Ingresa tu contraseña actual';
    if (f.nueva.length < 8 || !/[A-Za-z]/.test(f.nueva) || !/\d/.test(f.nueva)) errs.nueva = 'Mínimo 8 caracteres con letras y números';
    setErr(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await Auth.changePassword(f.actual, f.nueva);
      toast('Contraseña actualizada', 'success');
      onClose();
    } catch (e2) {
      setErr({ actual: e2.message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Cambiar contraseña" footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="pw-form" disabled={saving}>{saving && <Spinner />} Guardar</button></>}>
      <form id="pw-form" onSubmit={submit} className="stack" noValidate>
        <Field label="Contraseña actual" required error={err.actual}>{(p) => <input {...p} type="password" className="input" autoComplete="current-password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} />}</Field>
        <Field label="Nueva contraseña" required error={err.nueva} hint="Mínimo 8 caracteres con letras y números">{(p) => <input {...p} type="password" className="input" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}

export default function AdminLayout() {
  const { user, hasScope, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, unread: 0 });

  const refreshCounts = useCallback(() => {
    if (hasScope('attractions:manage')) Reservas.list({ all: 'true', status: 'PENDING', when: 'upcoming' }).then((r) => setCounts((c) => ({ ...c, pending: r.length }))).catch(() => {});
    if (hasScope('admin:full')) Mensajes.stats().then((s) => setCounts((c) => ({ ...c, unread: s.unread }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);
  useEffect(() => {
    setOpen(false);
    document.querySelector('.adm-content')?.focus();
  }, [pathname]);

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => hasScope(i.scope)) })).filter((g) => g.items.length);
  const current = NAV.flatMap((g) => g.items).find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to))) ?? NAV[0].items[0];

  useEffect(() => {
    document.title = `${current.label} · Panel Descubre EC`;
  }, [current.label]);

  return (
    <AdminCtx.Provider value={{ counts, refreshCounts }}>
      <a href="#adm-content" className="skip-link">Saltar al contenido</a>
      <div className="adm-layout">
        <aside className={`adm-sidebar ${open ? 'open' : ''}`} id="adm-sidebar" aria-label="Navegación del panel">
          <Link to="/admin" className="adm-brand">
            <span className="brand-mark" aria-hidden="true"><Mountain size={20} color="#1c1917" strokeWidth={2.4} /></span>
            <span>
              <span className="adm-brand-name">Descubre EC</span>
              <span className="adm-brand-sub">Panel {ROL_LABEL[user.rol]}</span>
            </span>
          </Link>
          <nav className="adm-nav">
            {nav.map((g) => (
              <div key={g.group} className="adm-nav-group">
                <span className="adm-nav-label">{g.group}</span>
                {g.items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `adm-nav-item ${isActive ? 'active' : ''}`}>
                    <i.icon size={18} aria-hidden="true" />
                    {i.label}
                    {i.badge && counts[i.badge] > 0 && (
                      <span className="adm-nav-badge" aria-label={`${counts[i.badge]} ${i.badge === 'pending' ? 'pendientes' : 'sin leer'}`}>{counts[i.badge]}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="adm-sidebar-foot">
            <div className="adm-user">
              <span className="avatar" aria-hidden="true">{initials(user.nombre)}</span>
              <div style={{ minWidth: 0 }}>
                <span className="adm-user-name">{user.nombre}</span>
                <span className="adm-user-rol">{ROL_LABEL[user.rol]}</span>
              </div>
              <button className="icon-btn" onClick={() => setPwOpen(true)} aria-label="Cambiar contraseña" data-tip="Cambiar contraseña"><KeyRound size={16} /></button>
            </div>
            <button className="adm-logout" onClick={() => { logout(); navigate('/'); }}><LogOut size={16} /> Cerrar sesión</button>
          </div>
        </aside>
        <div className={`adm-overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

        <div className="adm-main">
          <header className="adm-topbar">
            <button className="icon-btn adm-menu-toggle" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open} aria-controls="adm-sidebar">
              <Menu size={22} />
            </button>
            <h1>{current.label}</h1>
            <div className="adm-topbar-right">
              <span className="muted small hide-mobile">Atajo: <span className="kbd">/</span> buscar</span>
              <Link to="/" className="btn btn-sm" target="_blank" rel="noreferrer"><ExternalLink size={15} /> <span className="hide-mobile">Ver sitio</span></Link>
            </div>
          </header>
          <main className="adm-content" id="adm-content" tabIndex={-1} style={{ outline: 'none' }}>
            <Outlet />
          </main>
        </div>
      </div>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </AdminCtx.Provider>
  );
}
