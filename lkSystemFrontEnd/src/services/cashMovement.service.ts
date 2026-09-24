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

export const EXPENSE_CATEGORY_OPTIONS: {
  value: ExpenseCategory;
  label: string;
}[] = [
  { value: 'SUPPLIES', label: 'Fournitures' },
  { value: 'UTILITY', label: 'Facture (eau, élec, internet)' },
  { value: 'TRANSPORT', label: 'Transport / Livraison' },
  { value: 'SALARY', label: 'Salaire' },
  { value: 'MAINTENANCE', label: 'Maintenance / Réparation' },
  { value: 'REFUND', label: 'Remboursement client' },
  { value: 'OTHER', label: 'Autre' },
];

export const DEPOSIT_CATEGORY_OPTIONS: {
  value: DepositCategory;
  label: string;
}[] = [
  { value: 'OPENING', label: 'Fond de caisse (ouverture)' },
  { value: 'TOP_UP', label: 'Alimentation (ajout)' },
  { value: 'OTHER', label: 'Autre' },
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
  cash_refunds: string;
  card_refunds: string;
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
  card_sales: string;
  cash_refunds: string;
  card_refunds: string;
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
  occurred_at: string; // full ISO datetime
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
const SESSION_BASE = '/api/v1/sales-channels/cash-sessions/';

export interface CashSessionSummary {
  gross_sales: string;
  revenue: string;
  revenue_count: number;
  cash_sales: string;
  card_sales: string;
  cash_refunds: string;
  card_refunds: string;
  refunds: string;
  opening: string;
  cash_added: string;
  manual_cash_in: string;
  manual_cash_out: string;
  funding_total: string;
  funding_count: number;
  expenses: string;
  expenses_count: number;
  net_balance: string;
  cash_balance: string;
  expected_cash_live: string;
  by_category: { category: ExpenseCategory; total: string }[];
}

export interface CashSession {
  id: number;
  company: number;
  sales_channel: number;
  sales_channel_name: string;
  business_date: string;
  opening_cash: string;
  opening_cash_set: boolean;
  status: 'OPEN' | 'CLOSED';
  status_display: string;
  opened_at: string;
  opened_by: number | null;
  opened_by_name: string | null;
  closing_cash_expected: string | null;
  closing_cash_actual: string | null;
  cash_difference: string | null;
  closing_note: string;
  closed_at: string | null;
  closed_by: number | null;
  closed_by_name: string | null;
  summary: CashSessionSummary;
  created_at: string;
  updated_at: string;
}

export interface CurrentCashSession {
  business_date: string;
  sales_channel: number;
  sales_channel_name: string;
  currency: 'TND';
  session: CashSession | null;
  summary: CashSessionSummary;
}

export const cashMovementService = {
  /** List movements. Pass ``type`` to get one side (expense / deposit). */
  async list(
    params: {
      type?: MovementType;
      sales_channel?: number;
      date_from?: string;
      date_to?: string;
      category?: CashMovementCategory;
    } = {}
  ): Promise<CashMovement[]> {
    const { data } = await apiClient.get<
      CashMovement[] | { results?: CashMovement[] }
    >(BASE, { params });
    // DRF paginated response shape — also handle bare list fallback.
    return (
      (data as { results?: CashMovement[] }).results ?? (data as CashMovement[])
    );
  },

  async create(payload: CashMovementCreate): Promise<CashMovement> {
    const body = {
      ...payload,
      occurred_at: payload.occurred_at ?? new Date().toISOString(),
    };
    const { data } = await apiClient.post<CashMovement>(BASE, body);
    return data;
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`${BASE}${id}/`);
  },

  async caisseStats(salesChannel: number, date?: string): Promise<CaisseStats> {
    const params: Record<string, string | number> = {
      sales_channel: salesChannel,
    };
    if (date) params.date = date;
    const { data } = await apiClient.get<CaisseStats>(`${BASE}caisse-stats/`, {
      params,
    });
    return data;
  },

  async caisseHistory(
    salesChannel: number,
    params: { date_from?: string; date_to?: string } = {}
  ): Promise<CaisseHistoryRow[]> {
    const { data } = await apiClient.get<CaisseHistoryRow[]>(
      `${BASE}caisse-history/`,
      {
        params: { sales_channel: salesChannel, ...params },
      }
    );
    return data;
  },

  /** Per-transaction caisse journal — sales, returns, expenses, alimentations
   *  (incl. their deletion reversals), each with a full timestamp, newest first. */
  async caisseJournal(
    salesChannel: number,
    params: { date_from?: string; date_to?: string } = {}
  ): Promise<CaisseJournal> {
    const { data } = await apiClient.get<CaisseJournal>(
      `${BASE}caisse-journal/`,
      {
        params: { sales_channel: salesChannel, ...params },
      }
    );
    return data;
  },
};

export const cashSessionService = {
  async current(
    salesChannel: number,
    date?: string
  ): Promise<CurrentCashSession> {
    const params: Record<string, string | number> = {
      sales_channel: salesChannel,
    };
    if (date) params.date = date;
    const { data } = await apiClient.get<CurrentCashSession>(
      `${SESSION_BASE}current/`,
      { params }
    );
    return data;
  },

  async list(
    salesChannel: number,
    params: { date_from?: string; date_to?: string } = {}
  ): Promise<CashSession[]> {
    const { data } = await apiClient.get<
      CashSession[] | { results?: CashSession[] }
    >(SESSION_BASE, {
      params: { sales_channel: salesChannel, ...params },
    });
    return (
      (data as { results?: CashSession[] }).results ?? (data as CashSession[])
    );
  },

  async open(
    salesChannel: number,
    openingCash: number | string
  ): Promise<CashSession> {
    const { data } = await apiClient.post<CashSession>(`${SESSION_BASE}open/`, {
      sales_channel: salesChannel,
      opening_cash: openingCash,
    });
    return data;
  },

  async close(
    sessionId: number,
    actualCash: number | string,
    note = ''
  ): Promise<CashSession> {
    const { data } = await apiClient.post<CashSession>(
      `${SESSION_BASE}${sessionId}/close/`,
      {
        closing_cash_actual: actualCash,
        closing_note: note,
      }
    );
    return data;
  },
};
