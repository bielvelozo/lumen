import { parseEnv, type Env } from '@lumen/shared';

/**
 * Load and validate the API's environment against the shared schema. Throws
 * {@link import('@lumen/shared').EnvValidationError} on a missing/invalid var; the
 * server entrypoint converts that throw into a fail-fast process exit. Keeping the
 * throw here (rather than exiting) makes the validation testable.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(source);
}
