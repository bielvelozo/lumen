import { useState } from 'react';
import type { LogStatus } from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';
import { useAuditLogs } from '../../lib/audit-queries';

/**
 * The audit view (spec 15) — what the assistant queried for THIS org. All rows render on SOLID
 * `Card` surfaces (data never on glass). Org-scoped server-side (the client sends no `org_id`);
 * only sanitized fields are shown (param shapes, a status, a duration — never raw values).
 */
export function AuditPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LogStatus | ''>('');
  const logs = useAuditLogs({ page, status: status || undefined });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880 }}>
      <div>
        <h1 className="ds-display" style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
          Auditoria do assistente
        </h1>
        <p style={{ color: 'var(--c-text-2)', margin: '6px 0 0' }}>
          O que o assistente consultou nos seus dados. Nenhum valor das suas linhas é registrado —
          apenas a função, o status e o tempo.
        </p>
      </div>

      <label style={{ fontSize: 14, color: 'var(--c-text-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
        Status
        <select
          aria-label="Filtrar status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LogStatus | '');
            setPage(1);
          }}
          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--c-border)' }}
        >
          <option value="">Todos</option>
          <option value="success">Sucesso</option>
          <option value="failed">Falha</option>
        </select>
      </label>

      {logs.isPending && (
        <Card>
          <p aria-busy="true">Carregando…</p>
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

      {logs.data?.items.map((row) => (
        <Card key={row.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>{row.functionName}</strong>
            <span
              style={{ color: row.status === 'success' ? 'var(--c-pos, var(--c-text))' : 'var(--c-neg)' }}
            >
              {row.status === 'success' ? 'sucesso' : 'falha'}
            </span>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: '8px 0 0', fontSize: 13 }}>
            <dt style={{ color: 'var(--c-text-2)' }}>Modelo</dt>
            <dd style={{ margin: 0 }} className="ds-num">{row.model ?? '—'}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>Duração</dt>
            <dd style={{ margin: 0 }} className="ds-num">{row.durationMs != null ? `${row.durationMs} ms` : '—'}</dd>
            <dt style={{ color: 'var(--c-text-2)' }}>Quando</dt>
            <dd style={{ margin: 0 }}>{row.createdAt}</dd>
            {row.errorMessage && (
              <>
                <dt style={{ color: 'var(--c-text-2)' }}>Motivo</dt>
                <dd style={{ margin: 0, color: 'var(--c-neg)' }}>{row.errorMessage}</dd>
              </>
            )}
          </dl>
        </Card>
      ))}

      {logs.data && (logs.data.hasMore || page > 1) && (
        <div style={{ display: 'flex', gap: 8 }}>
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
