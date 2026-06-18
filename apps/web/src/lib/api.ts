import type {
  SignupRequest,
  SignupResponse,
  LoginRequest,
  SessionResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
} from '@lumen/shared';
import { apiFetch } from './api-client';

/**
 * Typed endpoint functions for Flow 1. Each takes exactly the shared request contract
 * (no `org_id` anywhere) and returns the shared response type. These are the only place
 * the app names backend routes.
 */

export const signup = (body: SignupRequest): Promise<SignupResponse> =>
  apiFetch('/auth/signup', { method: 'POST', body });

export const login = (body: LoginRequest): Promise<SessionResponse> =>
  apiFetch('/auth/login', { method: 'POST', body });

export const logout = (): Promise<{ ok: boolean }> =>
  apiFetch('/auth/logout', { method: 'POST' });

export const fetchMe = (): Promise<SessionResponse> => apiFetch('/auth/me');

export const verifyEmail = (body: VerifyEmailRequest): Promise<VerifyEmailResponse> =>
  apiFetch('/auth/verify-email', { method: 'POST', body });

export const resendVerification = (
  body: ResendVerificationRequest,
): Promise<ResendVerificationResponse> =>
  apiFetch('/auth/resend-verification', { method: 'POST', body });

// --- Password reset (spec 06 UI) -------------------------------------------------
// NOTE: the backend endpoints below are NOT in the 00-16 backlog (spec 05 excludes
// password reset). The UI is built + tested against mocks; the live endpoints are a
// deferred future backend slice (recorded in DECISIONS.md).
export const forgotPassword = (body: { email: string }): Promise<{ message: string }> =>
  apiFetch('/auth/forgot-password', { method: 'POST', body });

export const resetPassword = (body: { token: string; password: string }): Promise<{ ok: boolean }> =>
  apiFetch('/auth/reset-password', { method: 'POST', body });
