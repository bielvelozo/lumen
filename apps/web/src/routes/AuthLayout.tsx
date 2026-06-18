import { Outlet } from 'react-router-dom';
import { ThemeToggle } from '../design-system/ui';

/**
 * Centered, focused layout for the public auth pages. The form itself sits on a solid
 * `Card` (rendered by each page) — glass appears only as incidental chrome (the top-right
 * theme toggle), never under the form's reading text (glass-only-on-chrome).
 */
export function AuthLayout(): JSX.Element {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h1 className="ds-display" style={{ fontSize: 'var(--text-2xl)', textAlign: 'center', margin: 0 }}>
          Lumen
        </h1>
        <Outlet />
      </div>
    </main>
  );
}
