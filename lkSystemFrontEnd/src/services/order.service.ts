/**
 * Order Service – read orders + POS creation + status updates + WooCommerce sync.
 */

import { apiClient } from './axios';
import type {
  OrderDetail,
  OrderEditRequest,
  OrderLogEntry,
  POSOrderCreateRequest,
  OrderSummary,
  OrderStatus,
  SalesChannel,
} from '@/types';

export interface OrderListParams {
  company?: number;
  sales_channel?: number;
  brand?: number;
  /** Canonical lifecycle filter (?status=new|confirmed|...; comma union ok). */
  status?: string;
  source?: string;
  payment_status?: string;
  priority_level?: 'high' | 'medium' | 'low';
  pos_sales_channel?: number;
  search?: string;
  created_from?: string;
  created_to?: string;
  created_date?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  include_deleted?: boolean;
  // Assignment filters
  assigned_to?: number;
  assigned_to_me?: boolean;
  unassigned?: boolean;
  assignment_type?: 'auto' | 'manual';
}

export interface AssignmentSettingsResponse {
  employees: import('@/types').AssignableEmployee[];
}

export interface InvoiceListParams {
  search?: string;
  date_from?: string;
  date_to?: string;
  ordering?: 'invoice_number' | '-invoice_number' | 'date' | '-date' | 'total' | '-total' | 'client' | '-client';
  page?: number;
  page_size?: number;
}

export interface InvoiceListItem {
  id: number;
  invoice_number: string;
  invoice_date: string;
  order_number: string;
  company: number;
  company_name: string;
  brand: number | null;
  brand_name: string | null;
  client_id: number | null;
  client_name: string;
  phone: string;
  source: string;
  payment_status: string;
  currency: string;
  total: string;
  invoice_issued_at: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceMutationPayload {
  invoice_number?: string;
  invoice_date?: string;
  invoice_client_name?: string;
  invoice_client_type?: 'PERSON' | 'COMPANY';
  invoice_client_matricule_fiscale?: string;
  invoice_client_phone?: string;
  invoice_client_email?: string;
  invoice_client_address?: string;
  invoice_client_city?: string;
}

export interface PaginatedInvoiceResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: InvoiceListItem[];
}

export interface InvoiceSettings {
  company: number | null;
  year: number;
  next_invoice_number: string | null;
  detail?: string;
}


export interface OrderEditLockResponse {
  lock: {
    locked: boolean;
    user_id: number | null;
    user_name: string | null;
    locked_at: string | null;
    expires_at: string | null;
    token: string;
  };
  order?: OrderDetail;
}

export interface OrderSyncResponse {
  detail: string;
  event_id?: number;
  created?: number;
  updated?: number;
  errors?: number;
  total?: number;
  async?: boolean;
  incremental?: boolean;
  fallback_bounded?: boolean;
  sales_channel?: number;
}

export interface OrderSyncEvent {
  id: number;
  sales_channel: number;
  sales_channel_name: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  trigger_source: string;
  sync_from: string | null;
  sync_to: string | null;
  wc_statuses_synced: string[];
  fetched_count: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  error_detail: Array<{ wc_id?: number | string | null; error: string }>;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
}

export interface WooCommerceOrderPreview {
  wc_id: number;
  order_number: string;
  status: string;
  total: string;
  currency: string;
  customer_name: string;
  customer_email: string;
  line_items_count: number;
  date_created: string;
  payment_method_title: string;
  exists_locally: boolean;
}

export interface WooCommerceOrderPreviewParams {
  page?: number;
  page_size?: number;
  search?: string;
  new_only?: boolean;
}

export interface WooCommerceOrderPreviewResponse {
  sales_channel: number;
  sales_channel_name: string;
  status_filter?: string;
  page: number;
  page_size: number;
  total_remote_count: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
  search?: string;
  new_only?: boolean;
  total_count: number;
  existing_count: number;
  new_count: number;
  orders: WooCommerceOrderPreview[];
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Per-line disposition for a structured return (drives the stock-movement matrix). */
export interface ReturnComponentCondition {
  product_id: number;
  quantity: number;
  condition: 'GOOD' | 'DAMAGED' | 'MISSING';
}

export interface ReturnLineCondition {
  line_id: number;
  /** GOOD → back to stock · DAMAGED → write-off · MISSING → no movement · EXCHANGED → restock + sell replacement. */
  condition: 'GOOD' | 'DAMAGED' | 'MISSING' | 'EXCHANGED';
  replacement_product_id?: number;
  /** Pack-only split, allowing identical component units to have different outcomes. */
  component_conditions?: ReturnComponentCondition[];
}

export interface ProcessReturnOptions {
  returnReason?: string;
  returnType?: 'RETURNED' | 'EXCHANGED' | 'DAMAGED' | 'MISSING' | 'CANCELLED_REFUSED' | 'OTHER';
  /** When provided, each customer line's fate is decided individually on the server. */
  lineConditions?: ReturnLineCondition[];
}

/** Bulk lifecycle actions runnable over a selection of orders. */
export type BulkOrderAction =
  | 'send_to_pos' | 'submit_delivery' | 'cancel' | 'delete'
  | 'assign' | 'auto_assign' | 'unassign';

export interface BulkOrderResultItem {
  id: number;
  order_number?: string;
  ok: boolean;
  error?: string;
}

export interface BulkOrderResponse {
  results: BulkOrderResultItem[];
  summary: { total: number; succeeded: number; failed: number };
}

export const orderService = {
  /** List orders with filters. */
  async getAll(params?: OrderListParams) {
    const { data } = await apiClient.get('/api/v1/orders/', { params });
    return data;
  },

  /** Single order detail with line items. */
  async getById(id: number) {
    const { data } = await apiClient.get<OrderDetail>(`/api/v1/orders/${id}/`);
    return data;
  },

  /** Invoice registry backed directly by orders. */
  async getInvoices(params?: InvoiceListParams) {
    const { data } = await apiClient.get<PaginatedInvoiceResponse>(
      '/api/v1/orders/invoices/',
      { params },
    );
    return data;
  },

  async getInvoiceSettings() {
    const { data } = await apiClient.get<InvoiceSettings>(
      '/api/v1/orders/invoice-settings/',
    );
    return data;
  },

  async createInvoice(id: number, payload: InvoiceMutationPayload = {}) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/invoice/`,
      payload,
    );
    return data;
  },

  async updateInvoice(id: number, payload: InvoiceMutationPayload) {
    const { data } = await apiClient.patch<OrderDetail>(
      `/api/v1/orders/${id}/invoice/`,
      payload,
    );
    return data;
  },

  /** Delete the invoice from an order — clears the invoice (removing it from
   * the registry) but leaves the order itself untouched. ``id`` is the order id. */
  async deleteInvoice(id: number) {
    await apiClient.delete(`/api/v1/orders/${id}/invoice/`);
  },

  /** POS / Manual order creation (Method B). */
  async createPOS(payload: POSOrderCreateRequest) {
    const { data } = await apiClient.post<OrderDetail>(
      '/api/v1/orders/pos/',
      payload
    );
    return data;
  },

  /**
   * Back-office (Order Manager) manual order creation. Same request shape as
   * the POS endpoint, but the server tags the order ``source=MANUAL``, defaults
   * to the ``processing`` workflow status, and does NOT force the
   * confirmed/paid/POS-validated flags a till sale would.
   */
  async createManual(payload: POSOrderCreateRequest) {
    const { data } = await apiClient.post<OrderDetail>(
      '/api/v1/orders/manual/',
      payload
    );
    return data;
  },

  /**
   * THE lifecycle move — POST /orders/{id}/transition/.
   * The backend validates the move against the one transition matrix and
   * runs the matching business side effects (confirm reserves stock, cancel
   * releases it, return restores it, …). `delayed` needs `delay_date`.
   */
  async transitionStatus(
    id: number,
    status: OrderStatus,
    options?: { note?: string; reason?: string; delay_date?: string },
  ) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/transition/`,
      { status, ...options }
    );
    return data;
  },

  /**
   * Manually (re)assign an order to an employee. Pass `null` to clear the
   * assignment. Requires the `assign_orders` permission (enforced server-side).
   */
  async assign(id: number, employeeId: number | null) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/assign/`,
      { employee_id: employeeId }
    );
    return data;
  },

  /** Auto-assignment pool: every company employee + eligibility + open load. */
  async getAssignmentSettings() {
    const { data } = await apiClient.get<AssignmentSettingsResponse>(
      '/api/v1/orders/assignment-settings/'
    );
    return data;
  },

  /** Replace the complete set of employees eligible for auto-assignment. */
  async updateAssignmentSettings(employeeIds: number[]) {
    const { data } = await apiClient.put<AssignmentSettingsResponse>(
      '/api/v1/orders/assignment-settings/',
      { employee_ids: employeeIds }
    );
    return data;
  },

  async acquireEditLock(id: number, force = false) {
    const { data } = await apiClient.post<OrderEditLockResponse>(
      `/api/v1/orders/${id}/edit-lock/`,
      { force }
    );
    return data;
  },

  async heartbeatEditLock(id: number, token: string) {
    const { data } = await apiClient.post<OrderEditLockResponse>(
      `/api/v1/orders/${id}/edit-lock-heartbeat/`,
      { token }
    );
    return data;
  },

  async releaseEditLock(id: number, token: string) {
    const { data } = await apiClient.post<OrderEditLockResponse>(
      `/api/v1/orders/${id}/release-edit-lock/`,
      { token }
    );
    return data;
  },

  /** Edit line items, discount, and notes. */
  async editOrder(id: number, payload: OrderEditRequest) {
    const { data } = await apiClient.patch<OrderDetail>(
      `/api/v1/orders/${id}/edit/`,
      payload
    );
    return data;
  },

  /** Soft-delete order. */
  async softDelete(id: number, reason?: string) {
    const { data } = await apiClient.post<{ detail: string }>(
      `/api/v1/orders/${id}/soft-delete/`,
      { reason: reason ?? '' }
    );
    return data;
  },

  /** Restore soft-deleted order. */
  async restore(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/restore/`
    );
    return data;
  },

  /** Fetch audit logs for one order. */
  async getLogs(id: number) {
    const { data } = await apiClient.get<OrderLogEntry[]>(
      `/api/v1/orders/${id}/logs/`
    );
    return data;
  },

  /** Dashboard KPIs. */
  async getSummary(params?: Partial<OrderListParams>) {
    const { data } = await apiClient.get<OrderSummary>(
      '/api/v1/orders/summary/',
      { params }
    );
    return data;
  },

  /** Sync all orders from a WooCommerce channel. */
  async syncFromWooCommerce(
    salesChannelId: number,
    options?: { incremental?: boolean; max_orders?: number }
  ): Promise<OrderSyncResponse> {
    const maxOrders = toPositiveInt(options?.max_orders, 0);
    const { data } = await apiClient.post<OrderSyncResponse>(
      '/api/v1/orders/sync/',
      {
        sales_channel: salesChannelId,
        incremental: options?.incremental ?? true,
        ...(maxOrders ? { max_orders: maxOrders } : {}),
      },
      { timeout: 20_000 }
    );
    return data;
  },

  /** Preview orders from WooCommerce without saving. */
  async previewFromWooCommerce(
    salesChannelId: number,
    params?: WooCommerceOrderPreviewParams
  ): Promise<WooCommerceOrderPreviewResponse> {
    const page = toPositiveInt(params?.page, 1);
    const pageSize = toPositiveInt(params?.page_size, 25);
    const search = typeof params?.search === 'string' ? params.search.trim() : '';
    const { data } = await apiClient.post<WooCommerceOrderPreviewResponse>(
      '/api/v1/orders/preview/',
      {
        sales_channel: salesChannelId,
        page,
        page_size: pageSize,
        new_only: params?.new_only ?? true,
        ...(search ? { search } : {}),
      },
      { timeout: 20_000 }
    );
    return data;
  },

  async getSyncEvent(id: number): Promise<OrderSyncEvent> {
    const { data } = await apiClient.get<OrderSyncEvent>(
      `/api/v1/orders/sync-events/${id}/`
    );
    return data;
  },

  /** Confirm order — sets outcome=CONFIRMED. */
  async confirmOrder(id: number, note?: string) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/confirm/`,
      { note: note ?? '' }
    );
    return data;
  },

  async markNotAnswered(id: number, note?: string) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/not-answered/`,
      { note: note ?? '' }
    );
    return data;
  },

  async restoreDelayed(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/restore-delayed/`
    );
    return data;
  },

  /** Delay order — sets outcome=DELAYED with date and reason. */
  async delayOrder(id: number, payload: {
    delay_date: string;
    delay_reason: string;
    note?: string;
  }) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/delay/`,
      payload
    );
    return data;
  },

  /** Cancel order outcome — sets outcome=CANCELLED and status=CANCELLED. */
  async cancelOrder(id: number, payload: {
    cancellation_reason: string;
    note?: string;
  }) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/cancel-outcome/`,
      payload
    );
    return data;
  },

  /**
   * Phase D — admin/manager backward status override (audited, reason required).
   * The backend re-validates the move against the live derived status and applies
   * the documented side-effects; this only sends the requested target + reason.
   */
  async manualTransition(id: number, target: OrderStatus, reason: string) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/manual-transition/`,
      { target, reason }
    );
    return data;
  },

  /** Phase D — retry a failed/parked WooCommerce status push (runs immediately). */
  async retrySync(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/retry-sync/`
    );
    return data;
  },

  async markPickup(id: number, note?: string) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/mark-pickup/`,
      { note: note ?? '' }
    );
    return data;
  },

  async sendToPOS(id: number, posSalesChannelId: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/send-to-pos/`,
      { pos_sales_channel: posSalesChannelId }
    );
    return data;
  },

  /**
   * Active sales channels this order may be routed to as a POS destination:
   * every ACTIVE, same-brand channel — not just the caller's pinned sales
   * point. The backend re-enforces active + same-brand + stock on submit.
   */
  async getPosDestinations(id: number) {
    const { data } = await apiClient.get<SalesChannel[]>(
      `/api/v1/orders/${id}/pos-destinations/`
    );
    return data;
  },

  async validatePOS(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/validate-pos/`
    );
    return data;
  },

  async checkoutPOS(id: number, payload: {
    payment_method?: string;
    payment_method_title?: string;
    customer_note?: string;
  }) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/validate-pos/`,
      payload
    );
    return data;
  },

  async submitDelivery(id: number, opts?: { force?: boolean }) {
    const { data } = await apiClient.post(
      `/api/v1/orders/${id}/submit-delivery/`,
      { force: opts?.force ?? false }
    );
    return data;
  },

  /**
   * Run one lifecycle action over many orders at once. Each order is processed
   * independently on the server; the response reports per-order success/failure
   * so a partial batch is unambiguous.
   */
  async bulkAction(
    action: BulkOrderAction,
    ids: number[],
    options?: { pos_sales_channel?: number; reason?: string; employee_id?: number }
  ): Promise<BulkOrderResponse> {
    const { data } = await apiClient.post<BulkOrderResponse>(
      '/api/v1/orders/bulk/',
      { action, ids, ...(options ?? {}) },
      { timeout: 60_000 }
    );
    return data;
  },

  /**
   * Process a return / exchange.
   *
   * Pass ``lineConditions`` to decide each customer line individually — the
   * backend restocks GOOD items, records DAMAGED items as a write-off (no
   * restock), and leaves MISSING items with no stock movement. Omit it for the
   * legacy whole-order restoration driven by ``returnType``.
   */
  async processReturn(id: number, options?: ProcessReturnOptions) {
    const body: Record<string, unknown> = {
      return_reason: options?.returnReason ?? '',
    };
    if (options?.returnType) body.return_type = options.returnType;
    if (options?.lineConditions && options.lineConditions.length > 0) {
      body.line_conditions = options.lineConditions;
    }
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/process-return/`,
      body,
    );
    return data;
  },

  async packageOrder(id: number, payload: {
    packaging_items: Array<{ product_id: number; quantity: number }>;
    allow_update?: boolean;
  }) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/package/`,
      payload
    );
    return data;
  },

  async unpackageOrder(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/unpackage/`
    );
    return data;
  },

  async restoreReturnStock(id: number) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/restore-return-stock/`
    );
    return data;
  },

  async returnLookup(query: string) {
    const { data } = await apiClient.post<{
      query: string;
      matches: number;
      order: OrderDetail;
    }>(
      '/api/v1/orders/return-lookup/',
      { query }
    );
    return data;
  },

  async packagingLookup(query: string) {
    const { data } = await apiClient.post<{
      query: string;
      matches: number;
      warnings: string[];
      order: OrderDetail;
    }>(
      '/api/v1/orders/packaging-lookup/',
      { query }
    );
    return data;
  },

  /** Sync only selected WC orders by their IDs. */
  async syncSelectedFromWooCommerce(
    salesChannelId: number,
    wcOrderIds: number[]
  ): Promise<OrderSyncResponse> {
    const { data } = await apiClient.post<OrderSyncResponse>(
      '/api/v1/orders/sync-selected/',
      { sales_channel: salesChannelId, wc_order_ids: wcOrderIds },
      { timeout: 120_000 }
    );
    return data;
  },
};
