/**
 * Caisse cash-movement service — one module for both sides of the POS till:
 *   • ``expense`` (dépense)      — cash OUT
 *   • ``deposit`` (alimentation) — cash IN
 * Discriminated by ``movement_type``. Endpoints live under
 * /api/v1/sales-channels/cash-movements/ (filter one side with ?type=).
 */

import { apiClient } from './axios';

export type MovementType = 'expense' | 'deposit';

export type ExpenseCategory =
  | 'SUPPLIES'
  | 'UTILITY'
  | 'TRANSPORT'
  | 'SALARY'
  | 'MAINTENANCE'
  | 'REFUND'
  | 'OTHER';

export type DepositCategory = 'OPENING' | 'TOP_UP' | 'OTHER';

export type CashMovementCategory = ExpenseCategory | DepositCategory;

export interface CashMovement {
  id: number;
  company: number;
  sales_channel: number;
  sales_channel_name: string;
  movement_type: MovementType;
  movement_type_display: string;
  category: CashMovementCategory;
  category_display: string;
  amount: string;
  note: string;
  occurred_at: string;
  created_by: number | null;
  created_by_name: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashMovementCreate {
  sales_channel: number;
  movement_type: MovementType;
  category: CashMovementCategory;
  amount: number | string;
  note?: string;
  occurred_at?: string;
}

export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: 'SUPPLIES',    label: 'Fournitures' },
  { value: 'UTILITY',     label: 'Facture (eau, élec, internet)' },
  { value: 'TRANSPORT',   label: 'Transport / Livraison' },
  { value: 'SALARY',      label: 'Salaire' },
  { value: 'MAINTENANCE', label: 'Maintenance / Réparation' },
  { value: 'REFUND',      label: 'Remboursement client' },
  { value: 'OTHER',       label: 'Autre' },
];

export const DEPOSIT_CATEGORY_OPTIONS: { value: DepositCategory; label: string }[] = [
  { value: 'OPENING', label: 'Fond de caisse (ouverture)' },
  { value: 'TOP_UP',  label: 'Alimentation (ajout)' },
  { value: 'OTHER',   label: 'Autre' },
];

/* ── Caisse aggregate read shapes (unchanged) ──────────────────────────── */

export interface CaisseStats {
  date: string;
  sales_channel: number;
  sales_channel_name: string;
  currency: string;
  revenue: string;
  revenue_count: number;
  cash_sales: string;
  card_sales: string;
  opening: string;
  cash_added: string;
  funding_total: string;
  funding_count: number;
  expenses: string;
  expenses_count: number;
  refunds: string;
  net_balance: string;
  cash_balance: string;
  by_category: { category: ExpenseCategory; total: string }[];
}

export interface CaisseHistoryRow {
  date: string;
  sales_channel: number;
  sales_channel_name: string;
  currency: string;
  revenue: string;
  revenue_count: number;
  cash_sales: string;
  expenses: string;
  expenses_count: number;
  funding_total: string;
  net_balance: string;
  cash_balance: string;
}

/** One row in the per-transaction caisse journal (Historique de caisse). */
export type CaisseMovementType =
  | 'sale'
  | 'return'
  | 'expense'
  | 'expense_deleted'
  | 'deposit'
  | 'deposit_deleted';

export interface CaisseMovement {
  id: string;
  type: CaisseMovementType;
  type_display: string;
  occurred_at: string;        // full ISO datetime
  amount: string;
  direction: 'in' | 'out';
  detail: string;
  payment_method?: string;
  is_cash?: boolean;
  created_by_name?: string | null;
}

export interface CaisseJournal {
  sales_channel: number;
  sales_channel_name: string;
  currency: string;
  date_from: string;
  date_to: string;
  movements: CaisseMovement[];
}

const BASE = '/api/v1/sales-channels/cash-movements/';

export const cashMovementService = {
  /** List movements. Pass ``type`` to get one side (expense / deposit). */
  async list(
    params: {
      type?: MovementType;
      sales_channel?: number;
      date_from?: string;
      date_to?: string;
      category?: CashMovementCategory;
    } = {},
  ): Promise<CashMovement[]> {
    const { data } = await apiClient.get(BASE, { params });
    // DRF paginated response shape — also handle bare list fallback.
    return (data as { results?: CashMovement[] }).results ?? (data as CashMovement[]);
  },

  async create(payload: CashMovementCreate): Promise<CashMovement> {
    const body = {
      ...payload,
      occurred_at: payload.occurred_at ?? new Date().toISOString(),
    };
    const { data } = await apiClient.post(BASE, body);
    return data;
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`${BASE}${id}/`);
  },

  async caisseStats(salesChannel: number, date?: string): Promise<CaisseStats> {
    const params: Record<string, string | number> = { sales_channel: salesChannel };
    if (date) params.date = date;
    const { data } = await apiClient.get(`${BASE}caisse-stats/`, { params });
    return data;
  },

  async caisseHistory(
    salesChannel: number,
    params: { date_from?: string; date_to?: string } = {},
  ): Promise<CaisseHistoryRow[]> {
    const { data } = await apiClient.get(`${BASE}caisse-history/`, {
      params: { sales_channel: salesChannel, ...params },
    });
    return data;
  },

  /** Per-transaction caisse journal — sales, returns, expenses, alimentations
   *  (incl. their deletion reversals), each with a full timestamp, newest first. */
  async caisseJournal(
    salesChannel: number,
    params: { date_from?: string; date_to?: string } = {},
  ): Promise<CaisseJournal> {
    const { data } = await apiClient.get(`${BASE}caisse-journal/`, {
      params: { sales_channel: salesChannel, ...params },
    });
    return data;
  },
};
