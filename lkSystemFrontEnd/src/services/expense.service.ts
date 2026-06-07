/**
 * Caisse expense (dépense) service — POS register cash-out.
 * Endpoints live under /api/v1/sales-channels/expenses/.
 */

import { apiClient } from './axios';

export type ExpenseCategory =
  | 'SUPPLIES'
  | 'UTILITY'
  | 'TRANSPORT'
  | 'SALARY'
  | 'MAINTENANCE'
  | 'REFUND'
  | 'OTHER';

export interface Expense {
  id: number;
  company: number;
  sales_channel: number;
  sales_channel_name: string;
  amount: string;
  category: ExpenseCategory;
  category_display: string;
  note: string;
  occurred_at: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCreate {
  sales_channel: number;
  amount: number | string;
  category: ExpenseCategory;
  note?: string;
  occurred_at?: string;
}

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

const BASE = '/api/v1/sales-channels/expenses/';

export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: 'SUPPLIES',    label: 'Fournitures' },
  { value: 'UTILITY',     label: 'Facture (eau, élec, internet)' },
  { value: 'TRANSPORT',   label: 'Transport / Livraison' },
  { value: 'SALARY',      label: 'Salaire' },
  { value: 'MAINTENANCE', label: 'Maintenance / Réparation' },
  { value: 'REFUND',      label: 'Remboursement client' },
  { value: 'OTHER',       label: 'Autre' },
];

export const expenseService = {
  async list(params: { sales_channel?: number; date_from?: string; date_to?: string; category?: ExpenseCategory } = {}): Promise<Expense[]> {
    const { data } = await apiClient.get(BASE, { params });
    // DRF paginated response shape — also handle bare list fallback.
    return (data as any).results ?? data;
  },

  async create(payload: ExpenseCreate): Promise<Expense> {
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
};

// ── Caisse funding (alimentation de caisse) — cash IN ────────────────────────

export type CashDepositKind = 'OPENING' | 'TOP_UP' | 'OTHER';

export interface CashDeposit {
  id: number;
  company: number;
  sales_channel: number;
  sales_channel_name: string;
  amount: string;
  kind: CashDepositKind;
  kind_display: string;
  note: string;
  occurred_at: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashDepositCreate {
  sales_channel: number;
  amount: number | string;
  kind: CashDepositKind;
  note?: string;
  occurred_at?: string;
}

export const CASH_DEPOSIT_KIND_OPTIONS: { value: CashDepositKind; label: string }[] = [
  { value: 'OPENING', label: 'Fond de caisse (ouverture)' },
  { value: 'TOP_UP',  label: 'Alimentation (ajout)' },
  { value: 'OTHER',   label: 'Autre' },
];

const CASH_DEPOSIT_BASE = '/api/v1/sales-channels/cash-deposits/';

export const cashDepositService = {
  async list(
    params: { sales_channel?: number; date_from?: string; date_to?: string; kind?: CashDepositKind } = {},
  ): Promise<CashDeposit[]> {
    const { data } = await apiClient.get(CASH_DEPOSIT_BASE, { params });
    return (data as any).results ?? data;
  },

  async create(payload: CashDepositCreate): Promise<CashDeposit> {
    const body = {
      ...payload,
      occurred_at: payload.occurred_at ?? new Date().toISOString(),
    };
    const { data } = await apiClient.post(CASH_DEPOSIT_BASE, body);
    return data;
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`${CASH_DEPOSIT_BASE}${id}/`);
  },
};
