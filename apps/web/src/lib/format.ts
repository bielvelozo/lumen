const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
const CURRENCY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INTEGER = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

/** A decimal string from the database, as BRL. */
export function formatCurrency(decimal: string): string {
  return CURRENCY.format(Number(decimal));
}

export function formatInteger(value: number): string {
  return INTEGER.format(value);
}

function monthDate(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
}

/** `2026-08` → `agosto` */
export function formatMonth(yearMonth: string): string {
  return MONTH.format(monthDate(yearMonth));
}

/** `2026-08` → `agosto de 2026` */
export function formatMonthYear(yearMonth: string): string {
  return MONTH_YEAR.format(monthDate(yearMonth));
}

/** Percent change from `previous` to `current`, or null when there is nothing to compare with. */
export function formatChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  return `${PERCENT.format(((current - previous) / previous) * 100)}%`;
}
