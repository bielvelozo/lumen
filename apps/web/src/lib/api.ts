import type {
  SignupRequest,
  SignupResponse,
  LoginRequest,
  SessionResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
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

// --- Password reset --------------------------------------------------------------
// `forgot-password` answers the same generic body for any address (anti-enumeration);
// `reset-password` throws on an unusable link (400), which is how the page tells "done"
// from "ask for a new one".
export const forgotPassword = (body: ForgotPasswordRequest): Promise<ForgotPasswordResponse> =>
  apiFetch('/auth/forgot-password', { method: 'POST', body });

export const resetPassword = (body: ResetPasswordRequest): Promise<ResetPasswordResponse> =>
  apiFetch('/auth/reset-password', { method: 'POST', body });
