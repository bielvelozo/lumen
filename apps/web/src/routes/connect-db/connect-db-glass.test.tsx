import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderRoutes, TEST_SESSION } from '../../test-utils';

/**
 * Constitution invariant 6 (glass-only-on-chrome) guard for the Connect-DB UI (RALPH §2f,
 * specs 06/10/14). Rendered inside the real protected shell (glass sidebar), the
 * connect-DB data — config, schema, status, error text — must sit on SOLID surfaces, never
 * under `.glass`.
 */
const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockConnected(): void {
  fetchMock.mockImplementation(async (url: unknown) => {
    const pathname = new URL(String(url), 'http://localhost').pathname;
    const body = {
      '/auth/me': TEST_SESSION,
      '/db-connection/consent': { currentVersion: '1', acceptedVersion: '1', accepted: true },
      '/db-connection': {
        hasConnection: true,
        status: 'active',
        lastTestedAt: '2026-06-18T12:00:00.000Z',
        lastError: null,
        config: { host: 'db.example.com', port: 3306, databaseName: 'shop', username: 'lumen_ro', sslEnabled: true },
      },
      '/db-connection/exposure': { tables: [{ name: 'orders', columns: [] }], relationships: [] },
    }[pathname] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('connect-db glass-only-on-chrome', () => {
  it('renders the dashboard data on solid surfaces, never under .glass', async () => {
    mockConnected();
    const { container } = renderRoutes({ initialEntries: ['/connect/database'], session: TEST_SESSION });

    // The dashboard rendered with the connection config visible.
    await screen.findByText('db.example.com');

    // Chrome IS glass (the ink sidebar).
    expect(container.querySelectorAll('.glass').length).toBeGreaterThanOrEqual(1);

    // No data/reading surface is a descendant of any glass panel.
    expect(container.querySelectorAll('.glass .card, .glass .metric, .glass .bubble')).toHaveLength(0);

    // Concrete data nodes (a schema/host value, a status, the exposed table) are NOT on glass.
    expect(screen.getByText('db.example.com').closest('.glass')).toBeNull();
    expect(screen.getByText('lumen_ro').closest('.glass')).toBeNull();
    expect(screen.getByText('orders').closest('.glass')).toBeNull();
  });
});
