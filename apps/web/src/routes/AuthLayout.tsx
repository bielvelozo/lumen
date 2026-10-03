import { Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle, Logo } from '../design-system/ui';
import { LockIcon, AuditIcon } from '../design-system/icons';

const TITLES: Record<string, { title: string; lead: string }> = {
  '/login': { title: 'Entrar', lead: 'Entre para conversar com os números do seu negócio.' },
  '/signup': { title: 'Criar conta', lead: 'Comece conectando seu banco e sua IA. Leva poucos minutos.' },
  '/verify-email': { title: 'Verificar e-mail', lead: 'Confirmando o link que enviamos para você.' },
  '/forgot-password': { title: 'Recuperar senha', lead: 'Enviamos um link para você criar uma senha nova.' },
  '/reset-password': { title: 'Nova senha', lead: 'Escolha uma senha forte para sua conta.' },
};

/**
 * Split layout for the public auth pages: an ink brand panel (mark, promise, the rising sun)
 * beside the form column. Each page renders its form in a `Card`, flattened here onto the
 * paper — still a solid surface, never glass (glass-only-on-chrome).
 */
export function AuthLayout(): JSX.Element {
  const { pathname } = useLocation();
  const heading = TITLES[pathname];

  return (
    <div className="auth">
      <section className="auth__brand" aria-hidden="true">
        <Logo size={34} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 22, marginBottom: 200 }}>
          <p className="ds-display" style={{ margin: 0, fontSize: 72, lineHeight: 0.98, maxWidth: 500 }}>
            Pergunte ao seu negócio.
          </p>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: '#b4b1a9', maxWidth: 440 }}>
            Conecte seu banco MySQL em modo somente leitura e converse com seus números em português. Cada
            resposta traz o valor exato e de onde ele veio.
          </p>
        </div>
        <svg className="auth__sun" viewBox="0 0 600 230">
          <path d="M150 214a210 210 0 0 1 420 0z" fill="#f2a43a" />
          <path d="M0 226h600" stroke="#3a3e48" strokeWidth="2" />
        </svg>
        <div
          className="ds-mono"
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            gap: 28,
            fontSize: 12,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: '#9a978f',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LockIcon size={14} />
            Somente leitura
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AuditIcon size={14} />
            Cada consulta auditada
          </span>
        </div>
      </section>

      <main className="auth__main">
        <div style={{ position: 'absolute', top: 28, right: 32 }}>
          <ThemeToggle />
        </div>
        <div className="auth__form">
          <span className="auth__mobile-logo">
            <Logo size={30} />
          </span>
          {heading && (
            <div className="page-head">
              <h1 className="page-title" style={{ fontSize: 52 }}>
                {heading.title}
              </h1>
              <p className="page-lead">{heading.lead}</p>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
