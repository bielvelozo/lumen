import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntrospectedSchema, ExposureResponse } from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';
import { introspect, getExposure, saveExposure } from '../../lib/connect-db';
import { CONNECT_DB_KEYS } from '../../lib/connect-db-queries';

/**
 * Step 5 — Introspection + exposure picker. Loads the discovered schema (09, on demand) and
 * the current allow-list, then renders the picker. All schema data on SOLID surfaces.
 */
export function ExposureStep({ onSaved }: { onSaved?: () => void } = {}): JSX.Element {
  const schema = useQuery({ queryKey: ['db-connection', 'introspect'], queryFn: introspect, retry: false });
  const exposure = useQuery({ queryKey: CONNECT_DB_KEYS.exposure, queryFn: getExposure, retry: false });

  if (schema.isPending || exposure.isPending) {
    return (
      <Card>
        <p aria-busy="true">Lendo o esquema do banco…</p>
      </Card>
    );
  }
  if (schema.isError) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Não foi possível ler o esquema</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Verifique a conexão e tente novamente.</p>
      </Card>
    );
  }
  if (schema.data.tables.length === 0) {
    return (
      <Card>
        <h2 style={{ marginTop: 0 }}>Nenhuma tabela encontrada</h2>
        <p style={{ color: 'var(--c-text-2)' }}>
          O usuário somente leitura pode não ter acesso a nenhuma tabela. Revise as permissões
          (GRANT SELECT) e teste a conexão novamente.
        </p>
      </Card>
    );
  }

  return (
    <ExposurePicker schema={schema.data} current={exposure.data} onSaved={onSaved} />
  );
}

function ExposurePicker({
  schema,
  current,
  onSaved,
}: {
  schema: IntrospectedSchema;
  current: ExposureResponse | undefined;
  onSaved?: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [tables, setTables] = useState<Set<string>>(
    () => new Set(current?.tables.map((t) => t.name) ?? []),
  );
  const [relationships, setRelationships] = useState<Set<string>>(
    () => new Set(current?.relationships.map((r) => r.name) ?? []),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      saveExposure({ tableNames: [...tables], relationshipNames: [...relationships] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECT_DB_KEYS.exposure });
      onSaved?.();
    },
  });

  const toggleTable = (name: string): void => {
    setTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        // Same-connection guard (UX): drop any relationship touching a now-unexposed table.
        setRelationships((rels) => {
          const r = new Set(rels);
          for (const rel of schema.relationships) {
            if ((rel.fromTable === name || rel.toTable === name) && r.has(rel.name)) r.delete(rel.name);
          }
          return r;
        });
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleRel = (name: string): void => {
    setRelationships((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card>
        <h2 style={{ marginTop: 0 }}>Tabelas que o assistente pode ver</h2>
        <p style={{ color: 'var(--c-text-2)' }}>Selecione apenas o necessário (mínimo privilégio).</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {schema.tables.map((table) => (
            <li key={table.name}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* The label wraps only the checkbox + name, so the checkbox's accessible
                    name is exactly the table name. */}
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={tables.has(table.name)} onChange={() => toggleTable(table.name)} />
                  <strong>{table.name}</strong>
                </label>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === table.name ? null : table.name))}
                  style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--c-accent)', cursor: 'pointer', fontSize: 13 }}
                >
                  {expanded === table.name ? 'ocultar colunas' : 'ver colunas'}
                </button>
              </div>
              {expanded === table.name && (
                <ul style={{ color: 'var(--c-text-2)', fontSize: 13, margin: '4px 0 8px 28px' }}>
                  {table.columns.map((col) => (
                    <li key={col.name}>
                      {col.name} <span style={{ color: 'var(--c-text-3)' }}>{col.type}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {schema.relationships.length > 0 && (
        <Card>
          <h2 style={{ marginTop: 0 }}>Relações (JOINs permitidos)</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {schema.relationships.map((rel) => {
              const bothExposed = tables.has(rel.fromTable) && tables.has(rel.toTable);
              return (
                <li key={rel.name}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: bothExposed ? 1 : 0.6 }}>
                    <input
                      type="checkbox"
                      checked={relationships.has(rel.name)}
                      disabled={!bothExposed}
                      onChange={() => toggleRel(rel.name)}
                    />
                    <span>
                      {rel.fromTable}.{rel.fromColumn} → {rel.toTable}.{rel.toColumn}
                    </span>
                  </label>
                  {!bothExposed && (
                    <span style={{ color: 'var(--c-text-3)', fontSize: 12, marginLeft: 28 }}>
                      selecione as duas tabelas primeiro
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div>
        {save.isError && (
          <p role="alert" style={{ color: 'var(--c-neg)', fontSize: 13 }}>
            Não foi possível salvar. Tente novamente.
          </p>
        )}
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Salvando…' : 'Salvar seleção'}
        </Button>
      </div>
    </div>
  );
}
