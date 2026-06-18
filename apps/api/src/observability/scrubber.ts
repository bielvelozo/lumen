/**
 * The Sentry scrubber lives in `@lumen/shared` so the API and web SDKs share ONE discipline
 * (spec 15, Gate-1). Re-exported here for the API's `beforeSend`/`beforeBreadcrumb`.
 */
export {
  scrubSentryEvent as scrubEvent,
  scrubSentryBreadcrumb as scrubBreadcrumb,
  type ScrubbableEvent,
} from '@lumen/shared';
