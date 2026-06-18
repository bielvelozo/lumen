import {
  filteredAggregateParamsSchema,
  type FilteredAggregateParams,
  RESULT_ROW_LIMIT,
} from '@lumen/shared';
import { quoteIdent, qualified } from '../identifiers';
import { aggExpr, filterFragment } from '../sql-fragments';
import type { ColumnNeed, NeedManifest, RelationshipNeed } from '../guard';
import type { ExposedAllowList } from '../allow-list';
import type { BuiltQuery, QueryFunctionDefinition } from '../types';

// A join is only possible when BOTH a relationship name and a join table are supplied.
function joinRequested(p: FilteredAggregateParams): p is FilteredAggregateParams & {
  relationship: string;
  joinTable: string;
} {
  return p.relationship !== undefined && p.joinTable !== undefined;
}

// v1 convention: group-by targets the joined table when a join is present, else the primary.
function groupByTable(p: FilteredAggregateParams): string {
  return joinRequested(p) ? p.joinTable : p.table;
}

function needs(p: FilteredAggregateParams): NeedManifest {
  const tables = [p.table];
  const columns: ColumnNeed[] = [
    { table: p.table, column: p.metric.column, family: p.metric.agg === 'count' ? undefined : 'numeric' },
    // Filters target the primary table in v1.
    ...p.filters.map((f) => ({ table: p.table, column: f.column })),
  ];
  const relationships: RelationshipNeed[] = [];
  if (joinRequested(p)) {
    tables.push(p.joinTable);
    relationships.push({ name: p.relationship, tableA: p.table, tableB: p.joinTable });
  }
  if (p.groupBy) columns.push({ table: groupByTable(p), column: p.groupBy });
  return { tables, columns, relationships };
}

function build(p: FilteredAggregateParams, allowList: ExposedAllowList): BuiltQuery {
  const params: unknown[] = [];
  let fromClause = quoteIdent(p.table);

  if (joinRequested(p)) {
    // The JOIN columns come ONLY from the matched exposed relationship row — never model text.
    // Re-fetch with the IDENTICAL predicate the guard used (name + orientation-independent table
    // pair), so "what the guard approved" can never diverge from "what the builder emits" — even
    // if a future allow-list ever carried two same-named relationships (Gate-2 review F2/F3).
    const pair = new Set([p.table, p.joinTable]);
    const rel = allowList.relationships.find(
      (r) => r.name === p.relationship && pair.has(r.fromTable) && pair.has(r.toTable),
    );
    if (!rel) throw new Error('relationship missing post-guard');
    fromClause +=
      ` JOIN ${quoteIdent(p.joinTable)}` +
      ` ON ${qualified(rel.fromTable, rel.fromColumn)} = ${qualified(rel.toTable, rel.toColumn)}`;
  }

  const selectParts = [`${aggExpr(p.metric.agg, qualified(p.table, p.metric.column))} AS value`];
  const groupParts: string[] = [];
  if (p.groupBy) {
    const gb = qualified(groupByTable(p), p.groupBy);
    selectParts.unshift(`${gb} AS group_key`);
    groupParts.push(gb);
  }

  const whereParts: string[] = [];
  for (const f of p.filters) {
    whereParts.push(filterFragment(qualified(p.table, f.column), f.op));
    params.push(f.value); // every filter VALUE is bound
  }

  let sql = `SELECT ${selectParts.join(', ')} FROM ${fromClause}`;
  if (whereParts.length) sql += ` WHERE ${whereParts.join(' AND ')}`;
  if (groupParts.length) sql += ` GROUP BY ${groupParts.join(', ')} ORDER BY ${groupParts.join(', ')}`;
  sql += ` LIMIT ${RESULT_ROW_LIMIT}`;
  return { sql, params };
}

/**
 * `filtered_aggregate` — count/sum with equality/range filters + optional group-by, optionally
 * reaching a second table ONLY via an exposed relationship (named in params; its JOIN columns
 * drawn solely from the matched row). All filter values are bound; identifiers are allow-listed.
 */
export const filteredAggregate: QueryFunctionDefinition = {
  name: 'filtered_aggregate',
  prepare(raw) {
    const parsed = filteredAggregateParamsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: parsed.error.issues };
    const p = parsed.data;
    return { ok: true, prepared: { manifest: needs(p), build: (allowList) => build(p, allowList) } };
  },
};
