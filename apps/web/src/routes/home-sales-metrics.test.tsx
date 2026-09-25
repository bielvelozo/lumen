import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { HomeMetricsResponse } from '@lumen/shared';
import { makeTestClient } from '../test-utils';
import { HOME_METRICS_KEYS } from '../lib/home-metrics-queries';
import { HomeSalesMetrics } from './HomeSalesMetrics';

afterEach(cleanup);

function renderWith(response: HomeMetricsResponse) {
  const client = makeTestClient();
  client.setQueryData(HOME_METRICS_KEYS.metrics, response);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomeSalesMetrics />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomeSalesMetrics', () => {
  it('shows the last closed month as the database computed it, against the month before', () => {
    renderWith({
      status: 'ok',
      current: { month: '2026-08', total: '74323.10', orders: 53, averageTicket: '1402.322642' },
      previous: { month: '2026-07', total: '60098.00', orders: 46, averageTicket: '1306.478261' },
    });

    expect(screen.getByText('agosto de 2026 · último mês fechado')).toBeTruthy();
    expect(screen.getByText('Vendas em agosto')).toBeTruthy();
    expect(screen.getByText('R$ 74.323,10')).toBeTruthy();
    expect(screen.getByText('+23,7% vs julho')).toBeTruthy();
    expect(screen.getByText('53')).toBeTruthy();
    expect(screen.getByText('+15,2% vs julho')).toBeTruthy();
    expect(screen.getByText('R$ 1.402,32')).toBeTruthy();
    expect(screen.getByText('+7,3% vs julho')).toBeTruthy();
  });

  it('marks a drop as down and a month without sales as having nothing to compare', () => {
    const { container } = renderWith({
      status: 'ok',
      current: { month: '2026-01', total: '0', orders: 0, averageTicket: null },
      previous: { month: '2025-12', total: '500.00', orders: 5, averageTicket: '100.00' },
    });

    expect(screen.getByText('R$ 0,00')).toBeTruthy();
    expect(screen.getAllByText('-100% vs dezembro')).toHaveLength(2);
    expect(screen.getByText('sem pedidos em janeiro')).toBeTruthy();
    expect(container.querySelectorAll('.metric__delta--down')).toHaveLength(2);
  });

  it('invites the owner to pick the sales table instead of showing any number', () => {
    const { container } = renderWith({ status: 'not_configured' });

    expect(screen.getByRole('link', { name: 'Escolher tabela de vendas' }).getAttribute('href')).toBe(
      '/connect/database',
    );
    expect(container.querySelector('.metric')).toBeNull();
  });

  it('explains a stale mapping and where to fix it', () => {
    renderWith({ status: 'unavailable', reason: 'mapping_invalid' });

    expect(screen.getByText(/não está mais liberada/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Revisar tabela de vendas' })).toBeTruthy();
  });
});
