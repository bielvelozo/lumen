/**
 * Query-function registry (spec 12) — the only door to customer data. Spec 13 (chat
 * orchestrator) consumes `executeQueryFunction` + the accessor/runner factories. No AI, no HTTP
 * here. `(functionName, rawParams, orgId)` -> rows or a sanitized typed refusal.
 */
export { executeQueryFunction } from './executor';
export type { QueryFunctionResult, ExecuteQueryInput, QueryExecutorDeps } from './executor';
export { getQueryFunction } from './registry';
export { makeDrizzleAllowListAccessor } from './allow-list';
export type { AllowListAccessor, OrgDataAccess, ExposedAllowList, ResolvedConnection } from './allow-list';
export { createMysql2QueryRunner } from './query-runner';
export type { QueryRunner } from './query-runner';
