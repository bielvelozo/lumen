import type { Env } from '@lumen/shared';

/** A transactional email to deliver. `html`/`text` may contain the verification link. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Port for sending transactional email. Implemented by {@link resendEmailSender} in
 * production and {@link consoleEmailSender} when no key is configured (CI/dev). Callers
 * treat send as best-effort: a thrown error must never hard-fail signup.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * No-op sender used when `RESEND_API_KEY` is absent. It logs ONLY the recipient and a
 * "skipped" note — never the subject, body, or the verification link (which carries the
 * raw token). This keeps invariant 4 intact: the raw token never reaches logs.
 */
export const consoleEmailSender: EmailSender = {
  async send(message: EmailMessage): Promise<void> {
    console.info(`[email] verification email skipped for ${message.to} (no RESEND_API_KEY)`);
  },
};

/** Resend's transactional email endpoint. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Real sender backed by Resend's REST API (via global `fetch`). Bound only when a key is
 * present. On a non-2xx it throws a SANITIZED error (status only — never the response body
 * or the message content), so a failure is observable without leaking the link/token.
 */
export function resendEmailSender(apiKey: string, from: string): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend send failed (status ${response.status})`);
      }
    },
  };
}

/**
 * Pick the sender from validated env: the real Resend sender when `RESEND_API_KEY` is set,
 * otherwise the no-op console sender. Wired once at startup.
 */
export function makeEmailSender(env: Pick<Env, 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL'>): EmailSender {
  if (env.RESEND_API_KEY) {
    return resendEmailSender(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  }
  return consoleEmailSender;
}
