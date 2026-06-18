import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initWebSentry } from './observability/sentry';
import { ErrorBoundary } from './observability/ErrorBoundary';
// The design system now lives inside the app (spec 06 port). Import its CSS exactly
// once, here at the entrypoint.
import './design-system/design-system.css';

// Observability (spec 15) — no-op when VITE_SENTRY_DSN is absent (local dev boots without it).
initWebSentry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
