import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The design system now lives inside the app (spec 06 port). Import its CSS exactly
// once, here at the entrypoint.
import './design-system/design-system.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
