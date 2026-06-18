import { redactSensitive } from '@lumen/shared';

/**
 * The Sentry scrubber (spec 15) — pure + tested independently of the SDK. Runs on EVERY event and
 * breadcrumb before it leaves the process. It (1) deep-redacts every denylisted key via the shared
 * `redactSensitive` (the single source of truth — same list as the `function_call_logs` guard),
 * and (2) drops the request body, query string, and cookies wholesale (they can carry raw customer
 * data or secrets under non-denylisted keys). `server_name` (host/IP) is stripped too.
 */
export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
  server_name?: string;
  [key: string]: unknown;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const scrubbed = redactSensitive(event) as T;
  if (scrubbed.request) {
    delete scrubbed.request.data;
    delete scrubbed.request.query_string;
    delete scrubbed.request.cookies;
  }
  delete scrubbed.server_name;
  return scrubbed;
}

/** Same redaction discipline on breadcrumbs (a breadcrumb can capture a body/headers too). */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return redactSensitive(breadcrumb) as T;
}
