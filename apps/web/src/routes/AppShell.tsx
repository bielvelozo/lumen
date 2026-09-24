import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassPanel, ThemeToggle, Avatar, NavItem, Button } from '../design-system/ui';
import { useSession } from '../lib/session';
import { ME_QUERY_KEY } from '../lib/query-client';
import { logout as logoutRequest } from '../lib/api';

function initialsFromEmail(email: string | undefined): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

/**
 * The protected app shell: a GLASS sidebar (nav) + GLASS topbar (theme toggle, account
 * menu) wrapping the routed page in a SOLID content area. Glass is confined to the chrome;
 * every page rendered through `<Outlet/>` keeps its data/reading text on solid surfaces
 * (glass-only-on-chrome, constitution invariant 6). Later app routes (10/11/14) mount here.
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
    <div style={{ height: '100dvh', display: 'grid', gridTemplateColumns: '240px 1fr' }}>
      <GlassPanel
        as="aside"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 16, margin: 12, borderRadius: 16 }}
      >
        <strong className="ds-display" style={{ fontSize: 18, padding: '4px 12px 12px' }}>
          Lumen
        </strong>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <NavItem href="/">Início</NavItem>
          <NavItem href="/chat">Chat</NavItem>
          <NavItem href="/connect/database">Banco de dados</NavItem>
          <NavItem href="/connect/ai">IA (Claude)</NavItem>
          <NavItem href="/audit">Auditoria</NavItem>
        </nav>
      </GlassPanel>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <GlassPanel
          as="header"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            margin: 12,
            borderRadius: 16,
          }}
        >
          <span style={{ marginLeft: 'auto' }} />
          <ThemeToggle />
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu da conta"
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
            >
              <Avatar initials={initialsFromEmail(session?.email)} />
            </button>
            {menuOpen && (
              <GlassPanel
                role="menu"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  borderRadius: 12,
                  padding: 8,
                  minWidth: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  zIndex: 10,
                }}
              >
                <span style={{ padding: '4px 8px', color: 'var(--c-text-2)', fontSize: 13 }}>
                  {session?.email}
                </span>
                <Button
                  variant="ghost"
                  role="menuitem"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                >
                  Sair
                </Button>
              </GlassPanel>
            )}
          </div>
        </GlassPanel>

        <main style={{ flex: 1, padding: '12px 24px 24px', minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
