/**
 * Home sales metrics (spec 17). The owner states once which exposed table holds their sales;
 * the Home reads the last closed month through the query-function registry. Identifiers here
 * carry no authority: the allow-list guard re-checks them on save and on every read.
 */
import { z } from 'zod';

const identifier = z.string().min(1).max(64);

/** `PUT /sales-mapping` body. `.strict()` rejects a smuggled org_id. */
export const salesMappingSchema = z
  .object({
    table: identifier,
    amountColumn: identifier,
    dateColumn: identifier,
  })
  .strict();

export type SalesMapping = z.infer<typeof salesMappingSchema>;

export interface SalesMappingResponse {
  mapping: SalesMapping | null;
}

/** One month as the database computed it. Money is a decimal string, never re-summed by the web. */
export interface MonthSales {
  /** `YYYY-MM` */
  month: string;
  total: string;
  orders: number;
  /** null when the month had no orders. */
  averageTicket: string | null;
}

export const HOME_METRICS_UNAVAILABLE_REASONS = [
  'connection_unavailable',
  'mapping_invalid',
  'query_failed',
] as const;
export type HomeMetricsUnavailableReason = (typeof HOME_METRICS_UNAVAILABLE_REASONS)[number];

export type HomeMetricsResponse =
  | { status: 'not_configured' }
  | { status: 'unavailable'; reason: HomeMetricsUnavailableReason }
  | { status: 'ok'; current: MonthSales; previous: MonthSales };
