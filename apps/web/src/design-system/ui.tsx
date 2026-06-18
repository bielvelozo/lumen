import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

/* ============================================================
   LUMEN UI — typed port of the design system (spec 06).
   Import "design-system.css" once at the entrypoint. Golden rule:
   <GlassPanel> only on the chrome. Data lives on solid surfaces
   (<Card>, <MetricCard>, <ChatBubble>). Class names are preserved
   1:1 with the original so the visual contract is unchanged.
   ============================================================ */

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage unavailable — fall through to system preference */
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * Owns the single source of theme truth: persists to `localStorage` and reflects it on
 * `<html data-theme>`. Rendered once at the tree root so every `useTheme()`/`ThemeToggle`
 * shares one state (no desync across the public/protected zones).
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore persistence failures */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo<ThemeContextValue>(() => ({ theme, toggle, setTheme }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the shared theme. Must be used under a {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}

const SunIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
  </svg>
);
const MoonIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 14a8 8 0 1 1-10-10 6 6 0 0 0 10 10z" />
  </svg>
);

export function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      onClick={toggle}
      aria-label="Alternar tema claro e escuro"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Refractive background — rendered once at the root so glass has something to refract. */
export function AppBackground(): JSX.Element {
  return (
    <div className="ds-bg" aria-hidden="true">
      <span className="ds-blob ds-blob--a" />
      <span className="ds-blob ds-blob--b" />
    </div>
  );
}

type GlassPanelProps<T extends ElementType> = {
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/** Frosted-glass surface — ONLY for chrome (sidebar, topbar, menus, chat field). */
export function GlassPanel<T extends ElementType = 'div'>({
  as,
  className = '',
  children,
  ...rest
}: GlassPanelProps<T>): JSX.Element {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={`glass ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  icon?: ReactNode;
}

export function Button({ variant = 'primary', icon, children, className = '', type, ...rest }: ButtonProps): JSX.Element {
  return (
    <button
      type={type ?? 'button'}
      className={`btn btn--${variant} ${children ? '' : 'btn--icon'} ${className}`.trim()}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Card({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  trend?: 'up' | 'down';
}

export function MetricCard({ label, value, delta, trend = 'up' }: MetricCardProps): JSX.Element {
  return (
    <div className="metric">
      <p className="metric__label">{label}</p>
      <div className="metric__value">{value}</div>
      {delta && <div className={`metric__delta metric__delta--${trend}`}>{delta}</div>}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  boxed?: boolean;
}

export function TextField({ icon, boxed = false, ...rest }: TextFieldProps): JSX.Element {
  return (
    <label className={`field ${boxed ? 'field--boxed' : ''}`.trim()}>
      {icon}
      <input {...rest} />
    </label>
  );
}

export function ChatBubble({ from = 'them', children }: { from?: 'me' | 'them'; children: ReactNode }): JSX.Element {
  return <div className={`bubble bubble--${from}`}>{children}</div>;
}

export function Avatar({ initials }: { initials: string }): JSX.Element {
  return <div className="avatar">{initials}</div>;
}

interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  icon?: ReactNode;
}

export function NavItem({ active = false, icon, children, className = '', ...rest }: NavItemProps): JSX.Element {
  return (
    <a className={`nav-item ${active ? 'nav-item--on' : ''} ${className}`.trim()} {...rest}>
      {icon}
      {children}
    </a>
  );
}
