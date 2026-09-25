import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sqlTypeFamily, type ExposureResponse, type SalesMapping } from '@lumen/shared';
import { Card, Button } from '../../design-system/ui';
import { ApiError } from '../../lib/api-client';
import { saveSalesMapping } from '../../lib/home-metrics';
import { HOME_METRICS_KEYS, useSalesMapping } from '../../lib/home-metrics-queries';

type ExposedTable = ExposureResponse['tables'][number];

const isKey = (name: string): boolean => /^id$|_id$/i.test(name);

function columnsOf(table: ExposedTable | undefined, family: 'numeric' | 'temporal'): string[] {
  const columns = (table?.columns ?? []).filter((c) => sqlTypeFamily(c.type) === family).map((c) => c.name);
  // A key is numeric but never an amount; left in, `clientes(id, criado_em)` passed for a sales table.
  return family === 'numeric' ? columns.filter((c) => !isKey(c)) : columns;
}

function defaultsFor(table: ExposedTable | undefined): Omit<SalesMapping, 'table'> {
  return { amountColumn: columnsOf(table, 'numeric')[0] ?? '', dateColumn: columnsOf(table, 'temporal')[0] ?? '' };
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 180, flex: 1 }}>
      <span className="field-label">{label}</span>
      <select
        className="input ds-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', minHeight: 44, fontSize: 14, background: 'var(--c-surface)', borderColor: 'var(--c-border-strong)' }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Where the owner says which exposed table holds their sales (spec 17), so the Home can show real
 * figures. Only tables with a numeric and a date column are offered; the API re-checks the choice
 * against the exposure with the registry guard.
 */
export function SalesMappingCard({ exposure }: { exposure: ExposureResponse | undefined }): JSX.Element {
  const queryClient = useQueryClient();
  const saved = useSalesMapping();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SalesMapping | null>(null);

  const tables = (exposure?.tables ?? []).filter(
    (t) => columnsOf(t, 'numeric').length > 0 && columnsOf(t, 'temporal').length > 0,
  );
  const current = saved.data?.mapping ?? null;
  const first = tables[0];
  const form: SalesMapping = draft ?? current ?? { table: first?.name ?? '', ...defaultsFor(first) };
  const selected = tables.find((t) => t.name === form.table);

  const save = useMutation({
    mutationFn: saveSalesMapping,
    onSuccess: (response) => {
      queryClient.setQueryData(HOME_METRICS_KEYS.mapping, response);
      void queryClient.invalidateQueries({ queryKey: HOME_METRICS_KEYS.metrics });
      setEditing(false);
      setDraft(null);
    },
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    save.mutate(form);
  };

  const heading = (
    <>
      <h2>Vendas no painel inicial</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--c-text-2)' }}>
        Qual tabela guarda suas vendas? O Lumen soma o valor e conta os pedidos do último mês fechado direto no seu banco
        para mostrar na tela inicial.
      </p>
    </>
  );

  if (saved.isPending) {
    return (
      <Card>
        {heading}
        <p aria-busy="true">Carregando…</p>
      </Card>
    );
  }

  if (current && !editing) {
    return (
      <Card>
        {heading}
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 24px', margin: 0 }}>
          <dt style={{ color: 'var(--c-text-2)' }}>Tabela</dt>
          <dd className="ds-mono" style={{ margin: 0 }}>{current.table}</dd>
          <dt style={{ color: 'var(--c-text-2)' }}>Valor da venda</dt>
          <dd className="ds-mono" style={{ margin: 0 }}>{current.amountColumn}</dd>
          <dt style={{ color: 'var(--c-text-2)' }}>Data da venda</dt>
          <dd className="ds-mono" style={{ margin: 0 }}>{current.dateColumn}</dd>
        </dl>
        <Button type="button" variant="ghost" style={{ marginTop: 20 }} onClick={() => setEditing(true)}>
          Alterar
        </Button>
      </Card>
    );
  }

  if (tables.length === 0) {
    return (
      <Card>
        {heading}
        <p style={{ margin: 0, color: 'var(--c-text-2)' }}>
          Nenhuma tabela exposta tem ao mesmo tempo uma coluna de valor e uma de data. Libere a tabela de pedidos em
          “Editar tabelas expostas”.
        </p>
      </Card>
    );
  }

  const error =
    save.error instanceof ApiError && save.error.status === 422
      ? 'Essa combinação não pode ser usada: confira se a tabela continua liberada e as colunas estão certas.'
      : save.isError
        ? 'Não foi possível salvar agora. Tente de novo.'
        : null;

  return (
    <Card>
      {heading}
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <SelectField
            label="Tabela de vendas"
            value={form.table}
            options={tables.map((t) => t.name)}
            onChange={(table) => setDraft({ table, ...defaultsFor(tables.find((t) => t.name === table)) })}
          />
          <SelectField
            label="Valor da venda"
            value={form.amountColumn}
            options={columnsOf(selected, 'numeric')}
            onChange={(amountColumn) => setDraft({ ...form, amountColumn })}
          />
          <SelectField
            label="Data da venda"
            value={form.dateColumn}
            options={columnsOf(selected, 'temporal')}
            onChange={(dateColumn) => setDraft({ ...form, dateColumn })}
          />
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--c-neg)' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
          {current && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(null);
                save.reset();
              }}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
