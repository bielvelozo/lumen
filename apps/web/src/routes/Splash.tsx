/**
 * Minimal full-screen splash shown while the `/auth/me` bootstrap query is pending — so a
 * visitor never sees a flash of the login page or of protected content before auth is
 * known. Solid surface, brand wordmark only (no data, no glass).
 */
export function Splash(): JSX.Element {
  return (
    <main
      aria-busy="true"
      aria-label="Carregando"
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}
    >
      <span className="ds-display" style={{ fontSize: 'var(--text-xl)', opacity: 0.7 }}>
        Lumen
      </span>
    </main>
  );
}
