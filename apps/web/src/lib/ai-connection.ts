import type { AiConnectState, AiConnectResult, ConnectAiRequest } from '@lumen/shared';
import { apiFetch } from './api-client';

/**
 * Flow-3 endpoints (spec 11). Via `apiFetch` (cookie auth, no `org_id` ever). The API key is
 * sent once on connect and never read back — no endpoint returns it.
 */
export const getAiConnection = (): Promise<AiConnectState> => apiFetch('/ai-connection');

export const connectAi = (body: ConnectAiRequest): Promise<AiConnectResult> =>
  apiFetch('/ai-connection', { method: 'PUT', body });
