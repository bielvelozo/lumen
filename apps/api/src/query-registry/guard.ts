import { sqlTypeFamily, type RefusalCode, type TypeFamily } from '@lumen/shared';
import type { ExposedAllowList } from './allow-list';

export type { TypeFamily };

/** A column a function references, with an optional required type family. */
export interface ColumnNeed {
  table: string;
  column: string;
  family?: TypeFamily;
}

/**
 * A join a function needs — must match an exposed relationship BY NAME that connects exactly
 * the named table pair (orientation-independent). The build step then takes the join COLUMNS
 * only from that matched row, never from model text — so no ad-hoc JOIN is possible.
 */
export interface RelationshipNeed {
  name: string;
  tableA: string;
  tableB: string;
}

/**
 * The machine-readable manifest a function declares from its VALIDATED params. The guard reads
 * it field-by-field — it never parses SQL to know what a function touches.
 */
export interface NeedManifest {
  tables: string[];
  columns: ColumnNeed[];
  relationships: RelationshipNeed[];
}

export type GuardResult = { ok: true } | { ok: false; code: RefusalCode; message: string };

function familyMatches(sqlType: string, family: TypeFamily): boolean {
  return sqlTypeFamily(sqlType) === family;
}

/**
 * The allow-list guard (invariant 3). Runs BEFORE any SQL is built and confirms, against the
 * org's exposed surface: every table is exposed, every referenced column is in that table's
 * snapshot (and of the right type family), and every join matches an exposed relationship row
 * EXACTLY. A miss is a typed, sanitized refusal — the model-supplied name that isn't a member
 * (e.g. `total; DROP TABLE orders`) is rejected here and never reaches the builder.
 */
export function guard(manifest: NeedManifest, allowList: ExposedAllowList): GuardResult {
  for (const table of manifest.tables) {
    if (!allowList.tables.has(table)) {
      return { ok: false, code: 'table_not_exposed', message: 'That table is not available.' };
    }
  }

  for (const need of manifest.columns) {
    const cols = allowList.tables.get(need.table);
    if (!cols || !cols.has(need.column)) {
      return { ok: false, code: 'column_not_exposed', message: 'That field is not available.' };
    }
    if (need.family) {
      const sqlType = cols.get(need.column) ?? '';
      if (!familyMatches(sqlType, need.family)) {
        return { ok: false, code: 'type_mismatch', message: 'That field cannot be used this way.' };
      }
    }
  }

  for (const rel of manifest.relationships) {
    const pair = new Set([rel.tableA, rel.tableB]);
    const match = allowList.relationships.find(
      (er) =>
        er.name === rel.name &&
        pair.size === 2 &&
        pair.has(er.fromTable) &&
        pair.has(er.toTable),
    );
    if (!match) {
      return {
        ok: false,
        code: 'relationship_not_exposed',
        message: 'That relationship is not available.',
      };
    }
  }

  return { ok: true };
}
