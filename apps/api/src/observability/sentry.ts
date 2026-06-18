import * as Sentry from '@sentry/node';
import type { Env } from '@lumen/shared';
import { scrubEvent, scrubBreadcrumb, type ScrubbableEvent } from './scrubber';

export type SentryEnv = Pick<
  Env,
  'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_TRACES_SAMPLE_RATE'
>;

/**
 * Initialize Sentry for the API (spec 15). An ABSENT `SENTRY_DSN` disables the SDK and returns
 * `false` — local dev and CI boot without it, no crash, no noise. When enabled, `sendDefaultPii`
 * is OFF and the mandatory scrubber runs on every event + breadcrumb (the only data that leaves
 * the process is shape, never bodies/headers/cookies/secrets/customer rows).
 */
export function initSentry(env: SentryEnv): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}

export { Sentry };
