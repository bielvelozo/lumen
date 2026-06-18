import { Card } from '../../design-system/ui';
import { useConsentStatus, useConnectionState, useExposure, deriveStep } from '../../lib/connect-db-queries';
import { ConsentStep } from './ConsentStep';
import { ConnectStep } from './ConnectStep';
import { ExposureStep } from './ExposureStep';
import { StatusDashboard } from './StatusDashboard';

const STEP_LABELS: Record<string, string> = {
  consent: '1. Termos',
  connect: '2. Conexão',
  exposure: '3. Tabelas',
  dashboard: 'Conexão',
};

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
      <div>
        <h1 className="ds-display" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
          {STEP_LABELS[step] ?? 'Conectar banco de dados'}
        </h1>
        <p style={{ color: 'var(--c-text-2)', margin: '6px 0 0' }}>
          Conecte seu banco MySQL em modo somente leitura para perguntar sobre seus dados.
        </p>
      </div>

      {step === 'consent' && <ConsentStep />}
      {step === 'connect' && <ConnectStep connection={connection.data} />}
      {step === 'exposure' && <ExposureStep />}
      {step === 'dashboard' && <StatusDashboard connection={connection.data} exposure={exposure.data} />}
    </div>
  );
}
