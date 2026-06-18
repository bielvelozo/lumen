import { redactSensitive } from '@lumen/shared';
import type { LogStatus } from '@lumen/shared';
import { functionCallLogs } from '../db/schema';
import type { Database } from '../db/client';

/**
 * One sanitized `function_call_logs` row per tool call. `params` carries param NAMES/shape only
 * (no values — see sanitize.ts); `errorMessage` is a mapped code, never raw driver/model text.
 * `org_id` is NOT NULL (invariant 1).
 */
export interface FunctionLogInput {
  orgId: string;
  userId: string | null;
  sessionId: string | null;
  messageId: string | null;
  functionName: string;
  params: Record<string, unknown> | null;
  status: LogStatus;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  errorMessage: string | null;
}

export interface FunctionLogStore {
  insert(input: FunctionLogInput): Promise<void>;
}

export function makeDrizzleFunctionLogStore(db: Database): FunctionLogStore {
  return {
    async insert(input) {
      // Write-site guard (spec 15): the SAME shared `redactSensitive` the Sentry scrubber uses
      // runs here too, so a denylisted key can never survive into `params` — regardless of the
      // caller. The orchestrator already type-tags params (no values), so this is a no-op backstop
      // that also protects any future writer that passes raw params.
      const params =
        input.params === null ? null : (redactSensitive(input.params) as Record<string, unknown>);
      await db.insert(functionCallLogs).values({ ...input, params });
    },
  };
}
