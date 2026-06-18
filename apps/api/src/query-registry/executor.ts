import type { ZodIssue } from 'zod';
import type { RefusalCode } from '@lumen/shared';
import { getQueryFunction } from './registry';
import { guard } from './guard';
import type { AllowListAccessor } from './allow-list';
import type { QueryRunner } from './query-runner';

/**
 * The result the orchestrator (spec 13) logs + relays. `rows` carries DB-computed numbers; every
 * other outcome is a sanitized, typed refusal/validation with a stable code — never raw SQL,
 * schema internals, secrets, or customer values.
 */
export type QueryFunctionResult =
  | { outcome: 'rows'; rows: Record<string, unknown>[] }
  | { outcome: 'refused'; code: RefusalCode; message: string }
  | { outcome: 'invalid'; code: 'invalid_params'; issues: ZodIssue[] };

export interface ExecuteQueryInput {
  functionName: string;
  rawParams: unknown;
  /** From the verified JWT claims (spec 13) — NEVER from a tool param / body / path / header. */
  orgId: string;
}

export interface QueryExecutorDeps {
  accessor: AllowListAccessor;
  runner: QueryRunner;
}

function refuse(code: RefusalCode, message: string): QueryFunctionResult {
  return { outcome: 'refused', code, message };
}

/** Backstop: independently confirm the builder produced a single read-only SELECT. */
function assertReadOnlySelect(sql: string): void {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) throw new Error('not a select');
  if (trimmed.includes(';')) throw new Error('multiple statements'); // values are bound, so a ';' can't appear
}

/**
 * The constitutional choke point. Given `(functionName, rawParams, orgId)` + injected accessors:
 * look up the function (unknown → refusal), validate params (Zod → invalid), resolve the org's
 * ACTIVE connection + allow-list BY org_id, run the allow-list guard BEFORE building SQL, build a
 * single bound read-only SELECT, and execute it with the decrypted read-only credential. No AI, no
 * HTTP. A model-supplied identifier that isn't an allow-list member is refused at the guard and
 * never reaches the builder.
 */
export async function executeQueryFunction(
  input: ExecuteQueryInput,
  deps: QueryExecutorDeps,
): Promise<QueryFunctionResult> {
  const def = getQueryFunction(input.functionName);
  if (!def) return refuse('unknown_function', 'That function is not available.');

  const prep = def.prepare(input.rawParams);
  if (!prep.ok) return { outcome: 'invalid', code: 'invalid_params', issues: prep.issues };

  // Org/connection/allow-list resolved ONLY by the JWT org_id (anti-IDOR). A non-active or
  // missing connection is a sanitized refusal — never a partial answer.
  const access = await deps.accessor.getByOrg(input.orgId);
  if (!access || access.connection.status !== 'active') {
    return refuse('connection_unavailable', 'The data source is not available.');
  }

  const verdict = guard(prep.prepared.manifest, access.allowList);
  if (!verdict.ok) return refuse(verdict.code, verdict.message);

  let built;
  try {
    built = prep.prepared.build(access.allowList);
    assertReadOnlySelect(built.sql);
  } catch {
    return refuse('query_failed', 'The query could not be built.');
  }

  try {
    const rows = await deps.runner.run({
      connection: access.connection,
      sql: built.sql,
      params: built.params,
    });
    return { outcome: 'rows', rows };
  } catch {
    // Sanitized — the raw driver/timeout error is discarded.
    return refuse('query_failed', 'The query could not be completed.');
  }
}
