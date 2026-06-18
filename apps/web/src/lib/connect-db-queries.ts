import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ConsentStatusResponse, DbConnectionState, ExposureResponse } from '@lumen/shared';
import { getConsentStatus, getConnectionState, getExposure } from './connect-db';

/** Query keys for the Flow-2 server state. Mutations invalidate these on success. */
export const CONNECT_DB_KEYS = {
  consent: ['db-connection', 'consent'] as const,
  connection: ['db-connection', 'state'] as const,
  exposure: ['db-connection', 'exposure'] as const,
};

export function useConsentStatus(): UseQueryResult<ConsentStatusResponse> {
  return useQuery({ queryKey: CONNECT_DB_KEYS.consent, queryFn: getConsentStatus });
}

export function useConnectionState(): UseQueryResult<DbConnectionState> {
  return useQuery({ queryKey: CONNECT_DB_KEYS.connection, queryFn: getConnectionState });
}

/** Exposure is only meaningful once the connection is active — gate the query on that. */
export function useExposure(enabled: boolean): UseQueryResult<ExposureResponse> {
  return useQuery({ queryKey: CONNECT_DB_KEYS.exposure, queryFn: getExposure, enabled });
}

export type WizardStep = 'consent' | 'connect' | 'exposure' | 'dashboard';

/**
 * The wizard's current step, DERIVED purely from server state (never a client-stored flag):
 *   no/stale consent → consent; consent but no active connection → connect; active but no
 *   exposure → exposure; active + exposure → dashboard. A deep link to a "later" step is
 *   impossible — there is one route and the step follows the data.
 */
export function deriveStep(
  consent: ConsentStatusResponse,
  connection: DbConnectionState,
  exposure: ExposureResponse | undefined,
): WizardStep {
  if (!consent.accepted) return 'consent';
  if (!connection.hasConnection || connection.status !== 'active') return 'connect';
  if (!exposure || exposure.tables.length === 0) return 'exposure';
  return 'dashboard';
}
