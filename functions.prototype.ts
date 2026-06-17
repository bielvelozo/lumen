// =============================================================================
// Prototipo: funcoes genericas de consulta (o "cardapio" do assistente) COM JOIN
// -----------------------------------------------------------------------------
// Poucas primitivas genericas e parametrizadas que operam sobre as tabelas,
// colunas e RELACIONAMENTOS que o dono expos (fluxo 2). O modelo escolhe uma
// primitiva, escolhe joins por NOME de relacionamento, e preenche os campos; o
// backend valida tudo contra a allow-list, monta o SQL parametrizado e roda no
// MySQL do cliente (read-only, ao vivo).
//
// >>> NUCLEO DE SEGURANCA <<<
//   1. Toda TABELA, COLUNA e RELACIONAMENTO que o modelo mandar e validado
//      contra a allow-list do schema exposto. Nada fora da lista roda.
//   2. JOIN nao e condicao escrita pelo modelo: e a referencia a um
//      relacionamento pre-aprovado (descoberto das foreign keys na
//      introspeccao). O modelo so diz "use o relacionamento X".
//   3. Todo campo e qualificado por tabela (tabela.coluna) e a tabela precisa
//      estar ativa na consulta (a base ou uma tabela trazida por um join).
//   4. Todo VALOR e parametrizado (placeholders ?), nunca concatenado.
//   5. Operacoes, operadores e tipo de join saem de enums fixos. LIMIT com teto.
//   6. ctx.run deve usar a conexao READ-ONLY da org, com timeout de statement.
// =============================================================================

import { tool } from "ai";
import { z } from "zod";

// ----------------------------------------------------------------------------
// Tipos do schema exposto (vem da introspeccao + escolha do dono no fluxo 2)
// ----------------------------------------------------------------------------
export type ColumnType = "number" | "string" | "date" | "boolean" | "other";
export interface ExposedColumn {
  name: string;
  type: ColumnType;
}
export interface ExposedTable {
  name: string;
  columns: ExposedColumn[];
}

/** Relacionamento pre-aprovado (uma foreign key entre duas tabelas expostas).
 *  E a UNICA forma de join permitida. */
export interface Relationship {
  name: string; // identificador que o modelo usa, ex: "orders_products"
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface ExposedSchema {
  tables: ExposedTable[];
  relationships: Relationship[];
}

export type SqlRunner = (
  sql: string,
  params: unknown[]
) => Promise<Record<string, unknown>[]>;

export type FnLogger = (e: {
  function: string;
  params: unknown; // ja sanitizado
  status: "success" | "failed";
  durationMs: number;
  error?: string;
}) => void;

export interface QueryToolContext {
  schema: ExposedSchema;
  run: SqlRunner;
  log?: FnLogger;
}

// ----------------------------------------------------------------------------
// Constantes e helpers de seguranca
// ----------------------------------------------------------------------------
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

const FILTER_OPS = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "like",
  "in",
  "is_null",
  "is_not_null",
] as const;
type FilterOp = (typeof FILTER_OPS)[number];

class QueryError extends Error {}

/** Quote de identificador (MySQL). So chamado DEPOIS de validar na allow-list. */
function q(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}
function qcol(table: string, column: string): string {
  return `${q(table)}.${q(column)}`;
}

function tableOf(schema: ExposedSchema, name: string): ExposedTable {
  const t = schema.tables.find((x) => x.name === name);
  if (!t) throw new QueryError(`Tabela nao disponivel: ${name}`);
  return t;
}
function assertColumn(t: ExposedTable, column: string): void {
  if (!t.columns.some((c) => c.name === column)) {
    throw new QueryError(`Coluna nao disponivel: ${t.name}.${column}`);
  }
}
function sqlOp(op: FilterOp): string {
  if (op === "!=") return "<>";
  if (op === "like") return "LIKE";
  return op;
}

// ----------------------------------------------------------------------------
// Joins: so via relacionamentos pre-aprovados. Constroi as clausulas JOIN e
// devolve o conjunto de tabelas "ativas" na consulta (base + juntadas).
// ----------------------------------------------------------------------------
interface JoinRef {
  relationship: string;
  type?: "inner" | "left";
}

function buildJoins(
  schema: ExposedSchema,
  baseTable: string,
  joins?: JoinRef[]
): {
  sql: string;
  active: Set<string>;
} {
  tableOf(schema, baseTable); // base precisa estar exposta
  const active = new Set<string>([baseTable]);
  let sql = "";

  for (const j of joins ?? []) {
    const rel = schema.relationships.find((r) => r.name === j.relationship);
    if (!rel)
      throw new QueryError(`Relacionamento nao disponivel: ${j.relationship}`);
    tableOf(schema, rel.fromTable);
    tableOf(schema, rel.toTable);

    const fromActive = active.has(rel.fromTable);
    const toActive = active.has(rel.toTable);
    // exatamente um lado ja deve estar na consulta; o outro e a tabela nova.
    if (fromActive === toActive) {
      throw new QueryError(
        `Join '${j.relationship}' nao conecta com a consulta atual`
      );
    }
    const newTable = fromActive ? rel.toTable : rel.fromTable;
    active.add(newTable);

    const type = j.type === "left" ? "LEFT JOIN" : "INNER JOIN";
    sql += ` ${type} ${q(newTable)} ON ${qcol(rel.fromTable, rel.fromColumn)} = ${qcol(rel.toTable, rel.toColumn)}`;
  }
  return { sql, active };
}

// ----------------------------------------------------------------------------
// Campo qualificado: { table?, column }. Sem table = tabela base. A tabela
// precisa estar ativa e a coluna precisa existir nela.
// ----------------------------------------------------------------------------
interface Field {
  table?: string;
  column: string;
}

function resolveField(
  schema: ExposedSchema,
  active: Set<string>,
  base: string,
  f: Field
): string {
  const table = f.table ?? base;
  if (!active.has(table)) {
    throw new QueryError(
      `A tabela '${table}' nao esta na consulta (falta um join?)`
    );
  }
  assertColumn(tableOf(schema, table), f.column);
  return qcol(table, f.column);
}

function buildCondition(
  schema: ExposedSchema,
  active: Set<string>,
  base: string,
  f: { field: Field; op: FilterOp; value?: unknown }
): { clause: string; params: unknown[] } {
  const col = resolveField(schema, active, base, f.field);
  switch (f.op) {
    case "is_null":
      return { clause: `${col} IS NULL`, params: [] };
    case "is_not_null":
      return { clause: `${col} IS NOT NULL`, params: [] };
    case "in": {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      if (arr.length === 0) throw new QueryError("Filtro 'in' sem valores");
      return {
        clause: `${col} IN (${arr.map(() => "?").join(", ")})`,
        params: arr,
      };
    }
    default: {
      if (f.value === undefined || f.value === null)
        throw new QueryError(`Filtro '${f.op}' exige um valor`);
      return { clause: `${col} ${sqlOp(f.op)} ?`, params: [f.value] };
    }
  }
}

// ----------------------------------------------------------------------------
// Builders de SQL (puros: schema + args -> { sql, params })
// ----------------------------------------------------------------------------
function buildAggregate(
  schema: ExposedSchema,
  a: AggregateArgs
): { sql: string; params: unknown[] } {
  const base = a.table;
  const { sql: joinSql, active } = buildJoins(schema, base, a.joins);
  const params: unknown[] = [];

  let metric: string;
  if (a.operation === "count" && !a.field) {
    metric = "COUNT(*)";
  } else {
    if (!a.field)
      throw new QueryError(`A operacao '${a.operation}' exige um campo`);
    const c = resolveField(schema, active, base, a.field);
    metric =
      a.operation === "count"
        ? `COUNT(${c})`
        : a.operation === "count_distinct"
          ? `COUNT(DISTINCT ${c})`
          : `${a.operation.toUpperCase()}(${c})`;
  }

  const groupFields = (a.groupBy ?? []).map((g) =>
    resolveField(schema, active, base, g)
  );

  const where: string[] = [];
  for (const f of a.filters ?? []) {
    const c = buildCondition(schema, active, base, f);
    where.push(c.clause);
    params.push(...c.params);
  }
  if (a.dateField) {
    const d = resolveField(schema, active, base, a.dateField);
    if (a.dateFrom) {
      where.push(`${d} >= ?`);
      params.push(a.dateFrom);
    }
    if (a.dateTo) {
      where.push(`${d} <= ?`);
      params.push(a.dateTo);
    }
  }

  const select = [...groupFields, `${metric} AS value`].join(", ");
  let sql = `SELECT ${select} FROM ${q(base)}${joinSql}`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  if (groupFields.length) sql += ` GROUP BY ${groupFields.join(", ")}`;
  if (a.orderDir)
    sql += ` ORDER BY value ${a.orderDir === "asc" ? "ASC" : "DESC"}`;
  sql += ` LIMIT ${Math.min(a.limit ?? DEFAULT_LIMIT, MAX_LIMIT)}`;
  return { sql, params };
}

function buildList(
  schema: ExposedSchema,
  a: ListArgs
): { sql: string; params: unknown[] } {
  const base = a.table;
  const { sql: joinSql, active } = buildJoins(schema, base, a.joins);

  const fields: Field[] =
    a.columns && a.columns.length
      ? a.columns
      : tableOf(schema, base).columns.map((c) => ({
          table: base,
          column: c.name,
        }));
  const cols = fields.map((f) => resolveField(schema, active, base, f));

  const params: unknown[] = [];
  const where: string[] = [];
  for (const f of a.filters ?? []) {
    const c = buildCondition(schema, active, base, f);
    where.push(c.clause);
    params.push(...c.params);
  }

  let sql = `SELECT ${cols.join(", ")} FROM ${q(base)}${joinSql}`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  if (a.orderBy) {
    const o = resolveField(schema, active, base, a.orderBy.field);
    sql += ` ORDER BY ${o} ${a.orderBy.direction === "asc" ? "ASC" : "DESC"}`;
  }
  sql += ` LIMIT ${Math.min(a.limit ?? DEFAULT_LIMIT, MAX_LIMIT)}`;
  return { sql, params };
}

// ----------------------------------------------------------------------------
// Schemas (zod) que o modelo ve. Nomes sao strings; a allow-list e aplicada no
// execute. As tabelas, colunas e relacionamentos validos vao no system prompt
// via describeSchemaForPrompt().
// ----------------------------------------------------------------------------
const fieldSchema = z.object({
  table: z
    .string()
    .optional()
    .describe("Tabela do campo. Omita para a tabela base"),
  column: z.string(),
});
const joinSchema = z.object({
  relationship: z.string().describe("Nome de um relacionamento disponivel"),
  type: z.enum(["inner", "left"]).optional(),
});
const filterSchema = z.object({
  field: fieldSchema,
  op: z.enum(FILTER_OPS),
  value: z.any().optional(),
});

const aggregateParams = z.object({
  table: z.string().describe("Tabela base da consulta"),
  joins: z
    .array(joinSchema)
    .optional()
    .describe("Relacionamentos a juntar, por nome"),
  operation: z.enum(["count", "count_distinct", "sum", "avg", "min", "max"]),
  field: fieldSchema
    .optional()
    .describe("Campo a agregar. Obrigatorio, exceto em count simples"),
  groupBy: z.array(fieldSchema).optional(),
  filters: z.array(filterSchema).optional(),
  dateField: fieldSchema
    .optional()
    .describe("Campo de data para a janela de periodo"),
  dateFrom: z.string().optional().describe("Inicio, YYYY-MM-DD"),
  dateTo: z.string().optional().describe("Fim, YYYY-MM-DD"),
  orderDir: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Ordena pelo valor agregado"),
  limit: z.number().int().positive().optional(),
});

const listParams = z.object({
  table: z.string().describe("Tabela base da consulta"),
  joins: z.array(joinSchema).optional(),
  columns: z
    .array(fieldSchema)
    .optional()
    .describe("Campos a retornar. Vazio = colunas da tabela base"),
  filters: z.array(filterSchema).optional(),
  orderBy: z
    .object({ field: fieldSchema, direction: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().positive().optional(),
});

type AggregateArgs = z.infer<typeof aggregateParams>;
type ListArgs = z.infer<typeof listParams>;

// ----------------------------------------------------------------------------
// Sanitizacao pra log: mantem a forma, esconde valores.
// ----------------------------------------------------------------------------
function sanitize(args: any): unknown {
  const c = JSON.parse(JSON.stringify(args ?? {}));
  if (Array.isArray(c.filters)) {
    c.filters = c.filters.map((f: any) => ({
      field: f.field,
      op: f.op,
      value: f.value === undefined ? undefined : "<omitido>",
    }));
  }
  for (const k of ["dateFrom", "dateTo"]) if (k in c) c[k] = "<omitido>";
  return c;
}

// ----------------------------------------------------------------------------
// Fabrica: injeta o contexto da org e devolve as tools pro AI SDK.
// ----------------------------------------------------------------------------
export function buildQueryTools(ctx: QueryToolContext) {
  const run =
    (
      name: string,
      build: (s: ExposedSchema, a: any) => { sql: string; params: unknown[] }
    ) =>
    async (args: any) => {
      const started = Date.now();
      try {
        const { sql, params } = build(ctx.schema, args);
        const rows = await ctx.run(sql, params);
        ctx.log?.({
          function: name,
          params: sanitize(args),
          status: "success",
          durationMs: Date.now() - started,
        });
        return { rows };
      } catch (err) {
        const message =
          err instanceof QueryError
            ? err.message
            : "Nao consegui consultar os dados.";
        ctx.log?.({
          function: name,
          params: sanitize(args),
          status: "failed",
          durationMs: Date.now() - started,
          error: message,
        });
        return { error: message };
      }
    };

  return {
    aggregate: tool({
      description:
        "Calcula um agregado (count, sum, avg, min, max) sobre uma tabela exposta, " +
        "com joins (por relacionamento), agrupamento, filtros e janela de data. Use " +
        "para 'quanto', 'quantos', 'media', 'total por X', 'top N'. Campos de tabelas " +
        "juntadas devem informar 'table'. Use so tabelas, colunas e relacionamentos do schema.",
      parameters: aggregateParams,
      execute: run("aggregate", buildAggregate),
    }),
    list_records: tool({
      description:
        "Lista linhas de uma tabela exposta, com joins (por relacionamento), filtros, " +
        "ordenacao e colunas selecionadas. Use para 'quais', 'liste', 'mostre'. Campos " +
        "de tabelas juntadas devem informar 'table'. Use so o que esta no schema.",
      parameters: listParams,
      execute: run("list_records", buildList),
    }),
  };
}

// ----------------------------------------------------------------------------
// Texto do schema pro system prompt: tabelas, colunas e relacionamentos.
// ----------------------------------------------------------------------------
export function describeSchemaForPrompt(schema: ExposedSchema): string {
  const tables = schema.tables
    .map(
      (t) =>
        `- ${t.name}(${t.columns.map((c) => `${c.name}:${c.type}`).join(", ")})`
    )
    .join("\n");
  const rels = schema.relationships.length
    ? schema.relationships
        .map(
          (r) =>
            `- ${r.name}: ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}`
        )
        .join("\n")
    : "(nenhum)";
  return `Tabelas:\n${tables}\n\nRelacionamentos (joins disponiveis, use o nome em 'joins'):\n${rels}`;
}

// ----------------------------------------------------------------------------
// Exemplo: "total vendido por nome de produto em maio" (orders + products)
//
//   aggregate({
//     table: "orders",
//     joins: [{ relationship: "orders_products" }],
//     operation: "sum",
//     field: { table: "orders", column: "total" },
//     groupBy: [{ table: "products", column: "name" }],
//     dateField: { table: "orders", column: "created_at" },
//     dateFrom: "2026-05-01", dateTo: "2026-05-31",
//     orderDir: "desc", limit: 10,
//   })
//
// vira (parametrizado):
//   SELECT `products`.`name`, SUM(`orders`.`total`) AS value
//   FROM `orders` INNER JOIN `products`
//     ON `orders`.`product_id` = `products`.`id`
//   WHERE `orders`.`created_at` >= ? AND `orders`.`created_at` <= ?
//   GROUP BY `products`.`name` ORDER BY value DESC LIMIT 10
//
// Como pluga no fluxo 4:
//   const tools = buildQueryTools({ schema, run: orgReadOnlyRunner, log });
//   await streamText({ model, system: SYSTEM + describeSchemaForPrompt(schema),
//                      tools, maxSteps: 5, messages });
//
// Limites desta v1 (anotados de proposito):
//   - Sem self-join nem juntar a mesma tabela duas vezes (precisaria de alias).
//   - Join so por relacionamento pre-aprovado (FK real); o dono confirma quais
//     relacionamentos expor, igual faz com as tabelas.
//   - Resultado de query e DADO, nunca instrucao (prompt injection indireto).
// ----------------------------------------------------------------------------
