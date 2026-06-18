import {
  aggregateOverTimeParamsSchema,
  filteredAggregateParamsSchema,
  QUERY_FUNCTION_NAMES,
  type QueryFunctionName,
} from '@lumen/shared';
import type { ZodType } from 'zod';
import { executeQueryFunction } from '../query-registry';
import type { AllowListAccessor } from '../query-registry/allow-list';
import type { QueryRunner } from '../query-registry/query-runner';
import type { FunctionLogStore } from './function-log.store';
import { sanitizeParams } from './sanitize';

/** What the model receives back from a tool call — rows to narrate, or a sanitized refusal. */
export type ToolResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/** A tool the model may call. Backend-executed only — the model supplies a name + params. */
export interface ExecutableTool {
  name: QueryFunctionName;
  description: string;
  inputSchema: ZodType;
  execute(rawInput: unknown): Promise<ToolResult>;
}

/** Tool-facing metadata (description + the param schema the model fills). Names MUST match the
 *  registry — execution always goes through the single guarded `executeQueryFunction`. */
const TOOL_SPECS: { name: QueryFunctionName; description: string; schema: ZodType }[] = [
  {
    name: 'aggregate_over_time',
    description:
      'Soma/contagem/média de uma coluna numérica de UMA tabela exposta, agrupada por dia/semana/mês sobre uma coluna de data, num intervalo [from, to].',
    schema: aggregateOverTimeParamsSchema,
  },
  {
    name: 'filtered_aggregate',
    description:
      'Contagem/soma com filtros de igualdade/faixa e agrupamento opcional, opcionalmente cruzando uma segunda tabela apenas por um relacionamento exposto.',
    schema: filteredAggregateParamsSchema,
  },
];

export interface QueryToolContext {
  orgId: string;
  userId: string;
  sessionId: string;
  model: string;
  accessor: AllowListAccessor;
  runner: QueryRunner;
  logStore: FunctionLogStore;
  now?: () => number;
}

/**
 * Build the executable tools for one request. Each tool's `execute` runs the spec-12 guarded
 * executor (Zod + allow-list membership + read-only SELECT) and writes EXACTLY ONE sanitized
 * `function_call_logs` row — never the model's raw params (only names/shape), never row values,
 * never a secret. The rows go ONLY to the model (to narrate); the log gets the shape + status.
 */
export function buildQueryTools(ctx: QueryToolContext): ExecutableTool[] {
  const now = ctx.now ?? ((): number => Date.now());
  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.schema,
    async execute(rawInput: unknown): Promise<ToolResult> {
      const started = now();
      const result = await executeQueryFunction(
        { functionName: spec.name, rawParams: rawInput, orgId: ctx.orgId },
        { accessor: ctx.accessor, runner: ctx.runner },
      );
      const durationMs = now() - started;

      const ok = result.outcome === 'rows';
      // Best-effort audit (Gate-2 review): a logging-store hiccup must NOT fail a successful
      // data read or escape as an error. `message_id` stays null — the assistant message is
      // created only after the loop; the row is still scoped by org/session/function/time.
      await ctx.logStore
        .insert({
          orgId: ctx.orgId,
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          messageId: null,
          functionName: spec.name,
          params: sanitizeParams(rawInput),
          status: ok ? 'success' : 'failed',
          durationMs,
          provider: 'claude',
          model: ctx.model,
          // The refusal/validation CODE is model-safe; never a raw driver/SQL string.
          errorMessage: ok ? null : result.outcome === 'invalid' ? 'invalid_params' : result.code,
        })
        .catch(() => undefined);

      if (result.outcome === 'rows') return { ok: true, rows: result.rows };
      const error = result.outcome === 'invalid' ? 'invalid_params' : result.code;
      return { ok: false, error };
    },
  }));
}

/** Sanity: the tool catalog and the registry never drift. */
export function toolNamesMatchRegistry(): boolean {
  return (
    TOOL_SPECS.length === QUERY_FUNCTION_NAMES.length &&
    TOOL_SPECS.every((t) => (QUERY_FUNCTION_NAMES as readonly string[]).includes(t.name))
  );
}
