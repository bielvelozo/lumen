import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DbConnectionState, ExposureResponse, ConnectionErrorCategory } from '@lumen/shared';
import { Card, Button, Badge } from '../../design-system/ui';
import { retestConnection } from '../../lib/connect-db';
import { CONNECT_DB_KEYS } from '../../lib/connect-db-queries';
import { formatDateTime } from '../../lib/format';
import { ExposureStep } from './ExposureStep';
import { CredentialForm } from './ConnectStep';
import { SalesMappingCard } from './SalesMappingCard';

const ERROR_MESSAGES: Record<ConnectionErrorCategory, string> = {
  auth_failed: 'Falha de autenticação.',
  host_unreachable: 'Servidor inacessível.',
  connection_refused: 'Conexão recusada.',
  timeout: 'Tempo esgotado.',
  ssl_error: 'Erro de SSL/TLS.',
  database_not_found: 'Banco não encontrado.',
  access_denied: 'Acesso negado.',
  unknown: 'Erro desconhecido.',
};

const STATUS_LABELS: Record<string, string> = { active: 'Ativa', pending: 'Pendente', failed: 'Falhou' };

/**
 * Step 6 — Status dashboard. Shows the non-secret config (NEVER the password), the live
 * status + last test time + sanitized error, the exposure set, and actions to re-test,
 * edit the exposure, or edit the credentials. Everything on solid surfaces.
 */
export function StatusDashboard({
  connection,
  exposure,
}: {
  connection: DbConnectionState;
  exposure: ExposureResponse | undefined;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'exposure' | 'config'>('view');

  const retest = useMutation({
    mutationFn: retestConnection,
    onSuccess: (state) => queryClient.setQueryData(CONNECT_DB_KEYS.connection, state),
  });

  if (mode === 'exposure') return <ExposureStep onSaved={() => setMode('view')} />;
  if (mode === 'config') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <CredentialForm onSaved={() => setMode('view')} />
        <Button type="button" variant="ghost" onClick={() => setMode('view')}>
          Cancelar
        </Button>
      </div>
    );
  }

  const config = connection.config;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card>
        <h2 style={{ marginTop: 0 }}>Status da conexão</h2>
        <p style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge tone={connection.status === 'active' ? 'pos' : connection.status === 'failed' ? 'neg' : 'wait'}>
            {STATUS_LABELS[connection.status ?? ''] ?? connection.status}
          </Badge>
          {connection.lastTestedAt && (
            <span className="ds-mono" style={{ color: 'var(--c-text-3)', fontSize: 12 }}>
              testado em {formatDateTime(connection.lastTestedAt)}
            </span>
          )}
        </p>
        {connection.lastError && (
          <p role="alert" style={{ color: 'var(--c-neg)' }}>
            {ERROR_MESSAGES[connection.lastError]}
          </p>
        )}
        {config && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 24px', margin: 0 }}>
            <dt style={{ color: 'var(--c-text-2)' }}>Host</dt>
            <dd style={{ margin: 0 }}>{config.host}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>Porta</dt>
            <dd style={{ margin: 0 }}>{config.port}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>Banco</dt>
            <dd style={{ margin: 0 }}>{config.databaseName}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>Usuário</dt>
            <dd style={{ margin: 0 }}>{config.username}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>SSL</dt>
            <dd style={{ margin: 0 }}>{config.sslEnabled ? 'Sim' : 'Não'}</dd>
          </dl>
        )}
        {/* The password is intentionally never shown. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <Button type="button" variant="ghost" disabled={retest.isPending} onClick={() => retest.mutate()}>
            {retest.isPending ? 'Testando…' : 'Testar novamente'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode('exposure')}>
            Editar tabelas expostas
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode('config')}>
            Editar credenciais
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Tabelas expostas</h2>
        {exposure && exposure.tables.length > 0 ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {exposure.tables.map((t) => (
              <li
                key={t.name}
                className="ds-mono"
                style={{ fontSize: 13, padding: '4px 10px', borderRadius: 8, background: 'var(--c-bg)', border: '1px solid var(--c-border)' }}
              >
                {t.name}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--c-text-2)' }}>Nenhuma tabela exposta.</p>
        )}
        {exposure && exposure.relationships.length > 0 && (
          <>
            <h3 style={{ marginBottom: 4 }}>Relações</h3>
            <ul className="ds-mono" style={{ margin: 0, paddingLeft: 20, color: 'var(--c-text-2)', fontSize: 13, lineHeight: 1.8 }}>
              {exposure.relationships.map((r) => (
                <li key={r.name}>
                  {r.fromTable}.{r.fromColumn} → {r.toTable}.{r.toColumn}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <SalesMappingCard exposure={exposure} />
    </div>
  );
}
