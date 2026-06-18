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
    await screen.findByText('Bem-vindo ao Lumen');

    // The chrome IS glass (sidebar + topbar) — at least two glass panels exist.
    const glassPanels = container.querySelectorAll('.glass');
    expect(glassPanels.length).toBeGreaterThanOrEqual(2);

    // No data/reading surface is a descendant of any glass panel.
    expect(container.querySelectorAll('.glass .card, .glass .metric, .glass .bubble')).toHaveLength(0);

    // A concrete number (data) is NOT inside glass.
    const metricValue = screen.getByText('R$ 128.000');
    expect(metricValue.closest('.glass')).toBeNull();

    // The welcome reading text is NOT inside glass either.
    expect(screen.getByText('Bem-vindo ao Lumen').closest('.glass')).toBeNull();
  });
});
