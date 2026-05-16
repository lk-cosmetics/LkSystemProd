/**
 * Shared formatters and constants for the BI dashboard.
 */

import type { BIPeriod } from '@/services/bi.service';

export const CURRENCY = 'TND';

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const fullNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const fullCurrency = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const longDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function fmtMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `0 ${CURRENCY}`;
  return `${fullCurrency.format(n)} ${CURRENCY}`;
}

export function fmtMoneyCompact(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `0 ${CURRENCY}`;
  return `${compactNumber.format(n)} ${CURRENCY}`;
}

export function fmtNumber(value: number | null | undefined): string {
  return fullNumber.format(value ?? 0);
}

export function fmtPercent(value: number | null | undefined, digits = 1): string {
  const n = Number(value ?? 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : shortDate.format(d);
}

export function fmtLongDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : longDate.format(d);
}

export const PERIOD_OPTIONS: ReadonlyArray<{ value: BIPeriod; label: string }> = [
  { value: '7d',     label: 'Last 7 days' },
  { value: '30d',    label: 'Last 30 days' },
  { value: '3m',     label: 'Last 3 months' },
  { value: 'ytd',    label: 'Current year' },
  { value: 'custom', label: 'Custom range…' },
];

/** ``YYYY-MM-DD`` for ``<input type="date">``. */
export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Subtract `days` from today and return the result as a YYYY-MM-DD string. */
export function daysAgoInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const CHANNEL_COLORS = {
  website: 'var(--color-website)',
  pos:     'var(--color-pos)',
  revenue: 'var(--color-revenue)',
  orders:  'var(--color-orders)',
} as const;
