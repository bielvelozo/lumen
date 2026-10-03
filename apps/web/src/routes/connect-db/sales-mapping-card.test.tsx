import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ExposureResponse, SalesMappingResponse } from '@lumen/shared';
import { makeTestClient } from '../../test-utils';
import { HOME_METRICS_KEYS } from '../../lib/home-metrics-queries';
import { SalesMappingCard } from './SalesMappingCard';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EXPOSURE: ExposureResponse = {
  tables: [
    {
      name: 'clientes',
      columns: [
        { name: 'id', type: 'int' },
        { name: 'nome', type: 'varchar(80)' },
        { name: 'criado_em', type: 'datetime' },
      ],
    },
    {
      name: 'pedidos',
      columns: [
        { name: 'id', type: 'int' },
        { name: 'cliente_id', type: 'int' },
        { name: 'total', type: 'decimal(12,2)' },
        { name: 'criado_em', type: 'datetime' },
      ],
    },
  ],
  relationships: [],
};

function renderCard(mapping: SalesMappingResponse['mapping']) {
  const client = makeTestClient();
  client.setQueryData(HOME_METRICS_KEYS.mapping, { mapping });
  render(
    <QueryClientProvider client={client}>
      <SalesMappingCard exposure={EXPOSURE} />
    </QueryClientProvider>,
  );
  return client;
}

describe('SalesMappingCard', () => {
  it('offers only tables with an amount and a date, and never a key as the amount', () => {
    renderCard(null);

    const table = screen.getByLabelText('Tabela de vendas') as HTMLSelectElement;
    expect([...table.options].map((o) => o.value)).toEqual(['pedidos']);
    const amount = screen.getByLabelText('Valor da venda') as HTMLSelectElement;
    expect([...amount.options].map((o) => o.value)).toEqual(['total']);
    expect((screen.getByLabelText('Data da venda') as HTMLSelectElement).value).toBe('criado_em');
  });

  it('saves the choice and shows it afterwards', async () => {
    const saved = { table: 'pedidos', amountColumn: 'total', dateColumn: 'criado_em' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mapping: saved }), { status: 200 }));
    renderCard(null);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByRole('button', { name: 'Alterar' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/sales-mapping$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(saved);
  });

  it('tells the owner when the API refuses the combination', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'InvalidSalesMapping', code: 'column_not_exposed' }), { status: 422 }),
    );
    renderCard(null);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/não pode ser usada/));
  });
});
