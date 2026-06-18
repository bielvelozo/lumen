import type { ZodIssue } from 'zod';
import type { QueryFunctionName } from '@lumen/shared';
import type { NeedManifest } from './guard';
import type { ExposedAllowList } from './allow-list';

/** A built read-only statement: a single `SELECT` plus the bound values in `?` order. */
export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * A function whose params have already validated. It exposes the structured `manifest` (for the
 * guard) and a `build` that emits the SQL — `build` runs ONLY after the guard passes, and takes
 * the allow-list so a JOIN's columns can be drawn from the matched `exposed_relationships` row.
 */
export interface PreparedQuery {
  manifest: NeedManifest;
  build(allowList: ExposedAllowList): BuiltQuery;
}

export type PrepareResult =
  | { ok: true; prepared: PreparedQuery }
  | { ok: false; issues: ZodIssue[] };

/**
 * A registered query function — the only door to customer data. `prepare` validates raw params
 * (Zod) and returns the manifest + builder; the typed params stay internal so the executor never
 * touches model strings as identifiers.
 */
export interface QueryFunctionDefinition {
  name: QueryFunctionName;
  prepare(raw: unknown): PrepareResult;
}
