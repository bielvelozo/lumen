import type {
  ConsentStatusResponse,
  OnboardingScriptRequest,
  OnboardingScriptResponse,
  DbConnectionConfig,
  DbConnectionState,
  IntrospectedSchema,
  SaveExposureRequest,
  ExposureResponse,
} from '@lumen/shared';
import { apiFetch } from './api-client';

/**
 * Typed endpoint functions for Flow 2 (specs 07/08/09). Each goes through `apiFetch`
 * (cookie auth, no `org_id` ever) and takes/returns only the shared contracts. The
 * password is sent once on create and never read back.
 */

// --- Consent + onboarding script (spec 07) -------------------------------------
export const getConsentStatus = (): Promise<ConsentStatusResponse> =>
  apiFetch('/db-connection/consent');

export const getConsentTerms = (): Promise<{ version: string; points: string[] }> =>
  apiFetch('/db-connection/consent/terms');

export const acceptConsent = (consentVersion: string): Promise<ConsentStatusResponse> =>
  apiFetch('/db-connection/consent', { method: 'POST', body: { consentVersion } });

export const getOnboardingScript = (
  body: OnboardingScriptRequest,
): Promise<OnboardingScriptResponse> =>
  apiFetch('/db-connection/onboarding-script', { method: 'POST', body });

// --- Connection create + test (spec 08) ----------------------------------------
export const getConnectionState = (): Promise<DbConnectionState> => apiFetch('/db-connection');

export const createConnection = (body: DbConnectionConfig): Promise<DbConnectionState> =>
  apiFetch('/db-connection', { method: 'PUT', body });

export const retestConnection = (): Promise<DbConnectionState> =>
  apiFetch('/db-connection/test', { method: 'POST' });

// --- Introspection + exposure (spec 09) ----------------------------------------
export const introspect = (): Promise<IntrospectedSchema> => apiFetch('/db-connection/introspect');

export const getExposure = (): Promise<ExposureResponse> => apiFetch('/db-connection/exposure');

export const saveExposure = (body: SaveExposureRequest): Promise<ExposureResponse> =>
  apiFetch('/db-connection/exposure', { method: 'PUT', body });
