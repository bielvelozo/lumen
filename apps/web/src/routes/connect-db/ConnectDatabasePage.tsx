import { Card, PageHeader } from '../../design-system/ui';
import { CheckIcon } from '../../design-system/icons';
import { useConsentStatus, useConnectionState, useExposure, deriveStep } from '../../lib/connect-db-queries';
import { ConsentStep } from './ConsentStep';
import { ConnectStep } from './ConnectStep';
import { ExposureStep } from './ExposureStep';
import { StatusDashboard } from './StatusDashboard';

const STEPS = [
  { key: 'consent', label: 'Termos' },
  { key: 'connect', label: 'Conexão' },
  { key: 'exposure', label: 'Tabelas' },
] as const;

function Steps({ current }: { current: string }): JSX.Element {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="steps" aria-label="Etapas">
      {STEPS.map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'todo';
        return (
          <li key={s.key} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span className="steps__line" data-done={i <= index} aria-hidden="true" />}
            <span className="steps__dot" aria-hidden="true">
              {state === 'done' ? <CheckIcon size={14} /> : i + 1}
            </span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Flow-2 wizard container. It owns NO step state — the current step is DERIVED from the
 * server's connection state (consent, connection status, exposure set) on every load. There
 * is one route, so a "deep link to a later step" is impossible: the view always follows the
 * data. Everything renders on solid surfaces (glass is only the shell chrome from spec 06).
 */
export function ConnectDatabasePage(): JSX.Element {
  const consent = useConsentStatus();
  const connection = useConnectionState();
  // Exposure only matters once the connection is active.
  const exposure = useExposure(connection.data?.status === 'active');

  // Wait for the exposure query too when the connection is active, so the exposure-vs-
  // dashboard split is decided from loaded data (not a transient empty state).
  const exposurePending = connection.data?.status === 'active' && exposure.isPending;

  if (consent.isPending || connection.isPending || exposurePending) {
    return (
      <Card>
        <p aria-busy="true">Carregando…</p>
      </Card>
    );
  }

  if (consent.isError || connection.isError) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Não foi possível carregar</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Tente recarregar a página.</p>
      </Card>
    );
  }

  const step = deriveStep(consent.data, connection.data, exposure.data);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1080 }}>
      <PageHeader
        title={step === 'dashboard' ? 'Banco de dados' : 'Conectar banco de dados'}
        lead="Conecte seu banco MySQL em modo somente leitura. Você escolhe as tabelas; o assistente só lê o que você liberar."
      />
      {step !== 'dashboard' && <Steps current={step} />}

      {step === 'consent' && <ConsentStep />}
      {step === 'connect' && <ConnectStep connection={connection.data} />}
      {step === 'exposure' && <ExposureStep />}
      {step === 'dashboard' && <StatusDashboard connection={connection.data} exposure={exposure.data} />}
    </div>
  );
}
