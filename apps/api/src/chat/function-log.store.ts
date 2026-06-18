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
      await db.insert(functionCallLogs).values(input);
    },
  };
}
