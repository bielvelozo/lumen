import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderRoutes, makeTestClient, TEST_SESSION } from '../test-utils';
import { HOME_METRICS_KEYS } from '../lib/home-metrics-queries';

afterEach(cleanup);

/**
 * Constitution invariant 6 (glass-only-on-chrome) guard test. Glass (`.glass`) is allowed
 * ONLY on the chrome (sidebar, topbar, menus). No data/reading surface (`.card`, `.metric`,
 * `.bubble`) and no reading-length text may sit on glass.
 */
describe('glass-only-on-chrome', () => {
  it('renders glass chrome but never data surfaces under .glass', async () => {
    const client = makeTestClient();
    client.setQueryData(HOME_METRICS_KEYS.metrics, {
      status: 'ok',
      current: { month: '2026-08', total: '74323.10', orders: 53, averageTicket: '1402.32' },
      previous: { month: '2026-07', total: '60098.00', orders: 46, averageTicket: '1306.48' },
    });
    const { container } = renderRoutes({ initialEntries: ['/'], session: TEST_SESSION, client });
    await screen.findByText('Pergunte ao seu negócio');

    // The chrome IS glass (the ink sidebar).
    const glassPanels = container.querySelectorAll('.glass');
    expect(glassPanels.length).toBeGreaterThanOrEqual(1);

    // No data/reading surface is a descendant of any glass panel.
    expect(container.querySelectorAll('.glass .card, .glass .metric, .glass .bubble')).toHaveLength(0);

    // A concrete number (data) is NOT inside glass.
    const metricValue = screen.getByText('R$ 74.323,10');
    expect(metricValue.closest('.glass')).toBeNull();

    // The question box is NOT inside glass either.
    expect(screen.getByText('Pergunte ao seu negócio').closest('.glass')).toBeNull();
  });
});
