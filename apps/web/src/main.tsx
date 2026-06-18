import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Import the project design system once to prove the asset pipeline. The full
// design-system port (tokens as a package, theme toggle, components) is spec 06.
import '../../../design-system/design-system.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
