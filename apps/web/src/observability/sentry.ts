import * as Sentry from '@sentry/react';
import { scrubSentryEvent, scrubSentryBreadcrumb, type ScrubbableEvent } from '@lumen/shared';

/**
 * Web Sentry init (spec 15). An absent `VITE_SENTRY_DSN` disables the SDK — local dev + tests
 * run without it. When enabled: `sendDefaultPii` OFF, no session-replay/feedback integrations
 * (so no form values / input contents are captured), and a `beforeSend` that runs the SAME
 * shared `redactSensitive` as the API so no secret/PII leaks. No email/tenant id in user context.
 */
export function initWebSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? 'development',
    sendDefaultPii: false,
    integrations: [], // no Replay/Feedback — never capture input contents
    // The SAME shared scrubber as the API: drop body/query/cookies/headers + redact secrets/PII.
    beforeSend: (event) => scrubSentryEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  });
  return true;
}

export { Sentry };
