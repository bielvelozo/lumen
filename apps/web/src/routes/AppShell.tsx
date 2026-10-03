import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassPanel, ThemeToggle, Avatar, Button, Logo } from '../design-system/ui';
import { HomeIcon, ChatIcon, DatabaseIcon, KeyIcon, AuditIcon, LogoutIcon } from '../design-system/icons';
import { useSession } from '../lib/session';
import { ME_QUERY_KEY } from '../lib/query-client';
import { logout as logoutRequest } from '../lib/api';

function initialsFromEmail(email: string | undefined): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Início', icon: <HomeIcon />, end: true },
  { to: '/chat', label: 'Chat', icon: <ChatIcon /> },
  { to: '/connect/database', label: 'Banco de dados', icon: <DatabaseIcon /> },
  { to: '/connect/ai', label: 'IA (Claude)', icon: <KeyIcon /> },
  { to: '/audit', label: 'Auditoria', icon: <AuditIcon /> },
];

/**
 * The protected app shell: an ink GLASS sidebar (brand, nav, theme toggle, account menu)
 * beside a SOLID paper content area. Glass is confined to the chrome; every page rendered
 * through `<Outlet/>` keeps its data/reading text on solid surfaces (glass-only-on-chrome,
 * constitution invariant 6).
 */
export function AppShell(): JSX.Element {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const logout = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      // Whatever the server says, the local session is over.
      queryClient.setQueryData(ME_QUERY_KEY, null);
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  return (
    <div style={{ height: '100dvh', display: 'grid', gridTemplateColumns: '248px minmax(0, 1fr)' }}>
      <GlassPanel
        as="aside"
        className="glass--ink"
        style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '26px 16px 20px', minHeight: 0 }}
      >
        <NavLink to="/" aria-label="Lumen — início" style={{ color: 'inherit', textDecoration: 'none', padding: '0 10px' }}>
          <Logo size={32} />
        </NavLink>

        <nav aria-label="Principal" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-item--on' : ''}`.trim()}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
          <div ref={menuRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu da conta"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: 0,
                background: 'transparent',
                padding: '4px 0',
                cursor: 'pointer',
                color: 'var(--c-chrome-text-2)',
                font: 'inherit',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <Avatar initials={initialsFromEmail(session?.email)} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session?.email}
              </span>
            </button>
            {menuOpen && (
              <GlassPanel
                role="menu"
                style={{
                  position: 'absolute',
                  left: 0,
                  bottom: 'calc(100% + 10px)',
                  borderRadius: 14,
                  padding: 8,
                  minWidth: 220,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  zIndex: 10,
                  color: 'var(--c-text)',
                }}
              >
                <span style={{ padding: '4px 8px', color: 'var(--c-text-2)', fontSize: 13 }}>{session?.email}</span>
                <Button
                  variant="ghost"
                  role="menuitem"
                  icon={<LogoutIcon />}
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                >
                  Sair
                </Button>
              </GlassPanel>
            )}
          </div>
          <ThemeToggle />
        </div>
      </GlassPanel>

      <main style={{ minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '40px 56px' }}>
        <Outlet />
      </main>
    </div>
  );
}
