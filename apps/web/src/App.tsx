/**
 * The empty-but-runnable web shell (spec 00). Renders the design system's
 * refractive background and the Lumen wordmark on a solid, high-contrast surface
 * — no glass on reading text (constitution invariant 6). Router, TanStack Query,
 * theme toggle and real screens arrive with the web shell in spec 06.
 */
export function App() {
  return (
    <>
      <div className="ds-bg" aria-hidden="true">
        <div className="ds-blob ds-blob--a" />
        <div className="ds-blob ds-blob--b" />
      </div>
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <h1 className="ds-display" style={{ fontSize: 'var(--text-2xl)', margin: 0 }}>
          Lumen
        </h1>
      </main>
    </>
  );
}
