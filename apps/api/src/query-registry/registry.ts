import type { QueryFunctionName } from '@lumen/shared';
import type { QueryFunctionDefinition } from './types';
import { aggregateOverTime } from './functions/aggregate-over-time';
import { filteredAggregate } from './functions/filtered-aggregate';

/** The registry — the complete, closed set of doors to customer data. */
const REGISTRY: Record<QueryFunctionName, QueryFunctionDefinition> = {
  aggregate_over_time: aggregateOverTime,
  filtered_aggregate: filteredAggregate,
};

/** Look a function up by name. An unknown name returns `null` (executor → `unknown_function`). */
export function getQueryFunction(name: string): QueryFunctionDefinition | null {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name)
    ? REGISTRY[name as QueryFunctionName]
    : null;
}
