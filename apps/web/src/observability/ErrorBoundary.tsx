import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Sentry } from './sentry';
import { Card, Button } from '../design-system/ui';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * App-level error boundary (spec 15). Renders a calm fallback on a SOLID surface (never glass)
 * and reports to Sentry (a no-op when the SDK is disabled). No raw error text is shown to the
 * user — only a friendly message and a recovery action.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <Card role="alert">
          <h2 style={{ marginTop: 0 }}>Algo deu errado</h2>
          <p style={{ color: 'var(--c-text-2)' }}>
            Tivemos um problema ao exibir esta tela. Tente recarregar.
          </p>
          <Button type="button" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </Card>
      </div>
    );
  }
}
