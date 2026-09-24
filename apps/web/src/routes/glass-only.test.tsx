import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderRoutes, TEST_SESSION } from '../test-utils';

afterEach(cleanup);

/**
 * Constitution invariant 6 (glass-only-on-chrome) guard test. Glass (`.glass`) is allowed
 * ONLY on the chrome (sidebar, topbar, menus). No data/reading surface (`.card`, `.metric`,
 * `.bubble`) and no reading-length text may sit on glass.
 */
describe('glass-only-on-chrome', () => {
  it('renders glass chrome but never data surfaces under .glass', async () => {
    const { container } = renderRoutes({ initialEntries: ['/'], session: TEST_SESSION });
    await screen.findByText('Pergunte ao seu negócio');

    // The chrome IS glass (the ink sidebar).
    const glassPanels = container.querySelectorAll('.glass');
    expect(glassPanels.length).toBeGreaterThanOrEqual(1);

    // No data/reading surface is a descendant of any glass panel.
    expect(container.querySelectorAll('.glass .card, .glass .metric, .glass .bubble')).toHaveLength(0);

    // A concrete number (data) is NOT inside glass.
    const metricValue = screen.getByText('R$ 128.000');
    expect(metricValue.closest('.glass')).toBeNull();

    // The question box is NOT inside glass either.
    expect(screen.getByText('Pergunte ao seu negócio').closest('.glass')).toBeNull();
  });
});
