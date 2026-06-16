import { useState, useEffect, useCallback } from "react";

/* ============================================================
   LUMEN UI — componentes React do design system.
   Importe "design-system.css" uma vez no entrypoint (main.jsx).
   Regra de ouro: <GlassPanel> só na moldura. Dado vai em
   <Card>, <MetricCard>, <ChatBubble> (superficie solida).
   ============================================================ */

/* ---- tema claro/escuro ---- */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) return saved;
    } catch (e) {}
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      return "dark";
    return "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle, setTheme };
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
  </svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 14a8 8 0 1 1-10-10 6 6 0 0 0 10 10z" />
  </svg>
);

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="btn btn--ghost btn--icon" onClick={toggle}
      aria-label="Alternar tema claro e escuro">
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/* ---- fundo refrativo (necessario pra o vidro refratar algo) ---- */
export function AppBackground() {
  return (
    <div className="ds-bg" aria-hidden="true">
      <span className="ds-blob ds-blob--a" />
      <span className="ds-blob ds-blob--b" />
    </div>
  );
}

/* ---- vidro: SÓ na moldura ---- */
export function GlassPanel({ as: Tag = "div", className = "", children, ...rest }) {
  return <Tag className={`glass ${className}`} {...rest}>{children}</Tag>;
}

/* ---- botao ---- */
export function Button({ variant = "primary", icon, children, className = "", ...rest }) {
  return (
    <button className={`btn btn--${variant} ${children ? "" : "btn--icon"} ${className}`} {...rest}>
      {icon}{children}
    </button>
  );
}

/* ---- card (superficie solida) ---- */
export function Card({ children, className = "", ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

/* ---- metric ---- */
export function MetricCard({ label, value, delta, trend = "up" }) {
  return (
    <div className="metric">
      <p className="metric__label">{label}</p>
      <div className="metric__value">{value}</div>
      {delta && <div className={`metric__delta metric__delta--${trend}`}>{delta}</div>}
    </div>
  );
}

/* ---- campo de texto ---- */
export function TextField({ icon, boxed = false, ...rest }) {
  return (
    <label className={`field ${boxed ? "field--boxed" : ""}`}>
      {icon}
      <input {...rest} />
    </label>
  );
}

/* ---- balao de chat (superficie solida) ---- */
export function ChatBubble({ from = "them", children }) {
  return <div className={`bubble bubble--${from}`}>{children}</div>;
}

/* ---- avatar ---- */
export function Avatar({ initials }) {
  return <div className="avatar">{initials}</div>;
}

/* ---- item de navegacao ---- */
export function NavItem({ active = false, icon, children, ...rest }) {
  return (
    <a className={`nav-item ${active ? "nav-item--on" : ""}`} {...rest}>
      {icon}{children}
    </a>
  );
}

/* ============================================================
   Showcase — renderize <Showcase/> numa rota pra ver tudo junto.
   ============================================================ */
export function Showcase() {
  return (
    <>
      <AppBackground />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <GlassPanel style={{ borderRadius: 16, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <strong className="ds-display" style={{ fontSize: 18 }}>Lumen</strong>
          <span style={{ marginLeft: "auto" }} /><ThemeToggle /><Avatar initials="GV" />
        </GlassPanel>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          <MetricCard label="Vendas em maio" value="R$ 128.000" delta="+12% vs abril" trend="up" />
          <MetricCard label="Pedidos" value="342" delta="+8% vs abril" trend="up" />
          <MetricCard label="Ticket médio" value="R$ 374" delta="-3% vs abril" trend="down" />
        </div>

        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ChatBubble from="me">Quanto vendi em maio?</ChatBubble>
            <ChatBubble from="them">Em maio você vendeu R$ 128.000, 12% a mais que em abril.</ChatBubble>
          </div>
        </Card>

        <GlassPanel style={{ borderRadius: 16, padding: 9, display: "flex", gap: 10, alignItems: "center" }}>
          <TextField placeholder="Pergunte sobre seus dados…" style={{ flex: 1 }} />
          <Button aria-label="Enviar" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V6M6 12l6-6 6 6" /></svg>
          } />
        </GlassPanel>

        <div style={{ display: "flex", gap: 10 }}>
          <Button>Perguntar</Button>
          <Button variant="ghost">Limpar</Button>
        </div>
      </div>
    </>
  );
}
