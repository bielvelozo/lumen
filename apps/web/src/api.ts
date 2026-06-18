import type { HealthResponse } from '@lumen/shared';

// Proves the typed contract crosses the boundary: this web helper is typed by the
// same DTO the API returns, with no duplicated type. The real API client (base
// URL config, auth cookie, TanStack Query wiring) lands with the web shell (06).
const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}
