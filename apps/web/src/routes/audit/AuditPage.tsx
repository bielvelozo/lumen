import { Fragment, useState } from 'react';
import type { LogStatus } from '@lumen/shared';
import { Card, Button, Badge, PageHeader } from '../../design-system/ui';
import { useAuditLogs } from '../../lib/audit-queries';
import { formatDateTime } from '../../lib/format';

const FILTERS: { value: LogStatus | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'success', label: 'Sucesso' },
  { value: 'failed', label: 'Falha' },
];

/**
 * The audit view (spec 15) — what the assistant queried for THIS org. Rows render in a table
 * on a SOLID `Card` surface (data never on glass). Org-scoped server-side (the client sends no
 * `org_id`); only sanitized fields are shown (param shapes, a status, a duration — never raw values).
 */
export function AuditPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LogStatus | ''>('');
  const logs = useAuditLogs({ page, status: status || undefined });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1080 }}>
      <PageHeader
        title="Auditoria do assistente"
        lead="O que o assistente consultou nos seus dados. Nenhum valor das suas linhas é registrado — apenas a função, o modelo, o status e o tempo."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div role="group" aria-label="Filtrar status" className="segmented">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => {
                setStatus(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {logs.data && (
          <span className="ds-mono" style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
            Página {page}
          </span>
        )}
      </div>

      {logs.isPending && (
        <Card>
          <p aria-busy="true" style={{ margin: 0 }}>
            Carregando…
          </p>
        </Card>
      )}
      {logs.isError && (
        <Card role="alert">
          <p style={{ margin: 0, color: 'var(--c-text-2)' }}>Não foi possível carregar a auditoria.</p>
        </Card>
      )}

      {logs.data && logs.data.items.length === 0 && (
        <Card>
          <p style={{ margin: 0, color: 'var(--c-text-2)' }}>Nenhuma consulta registrada ainda.</p>
        </Card>
      )}

      {logs.data && logs.data.items.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Função</th>
                  <th scope="col">Modelo</th>
                  <th scope="col" className="num">
                    Duração
                  </th>
                  <th scope="col" className="num">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.data.items.map((row) => {
                  const failed = row.status !== 'success';
                  const tint = failed ? { background: 'var(--c-neg-soft)' } : undefined;
                  return (
                    <Fragment key={row.id}>
                      <tr style={tint}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                        <td>
                          <code
                            className="ds-mono"
                            style={{ fontSize: 13, padding: '3px 8px', borderRadius: 6, background: 'var(--c-bg)' }}
                          >
                            {row.functionName}
                          </code>
                        </td>
                        <td style={{ color: 'var(--c-text-2)' }}>{row.model ?? '—'}</td>
                        <td className="num ds-mono" style={{ fontSize: 13 }}>
                          {row.durationMs != null ? `${row.durationMs} ms` : '—'}
                        </td>
                        <td className="num">
                          {failed ? <Badge tone="neg">Falha</Badge> : <Badge tone="pos">Sucesso</Badge>}
                        </td>
                      </tr>
                      {row.errorMessage && (
                        <tr style={tint}>
                          <td colSpan={5} style={{ borderTop: 0, paddingTop: 0 }}>
                            <div style={{ display: 'flex', gap: 12, fontSize: 13.5 }}>
                              <span className="eyebrow" style={{ fontSize: 11, paddingTop: 2 }}>
                                Motivo
                              </span>
                              <span style={{ color: 'var(--c-neg)' }}>{row.errorMessage}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {logs.data && (logs.data.hasMore || page > 1) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button type="button" variant="ghost" disabled={!logs.data.hasMore} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
