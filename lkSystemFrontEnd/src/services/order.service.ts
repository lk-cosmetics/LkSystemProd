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
  DeliveryStatus,
  OrderOutcome,
  OrderContactStatus,
  OrderReturnExchangeStatus,
} from '@/types';

export interface OrderListParams {
  company?: number;
  sales_channel?: number;
  brand?: number;
  status?: OrderStatus;
  source?: string;
  payment_status?: string;
  flow?: string;
  pos_sales_channel?: number;
  search?: string;
  created_from?: string;
  created_to?: string;
  created_date?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  include_deleted?: boolean;
}

export interface OrderStatusFieldsPayload {
  status?: OrderStatus;
  wc_status?: 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded' | 'failed' | 'on-hold';
  delivery_status?: DeliveryStatus;
  contact_status?: OrderContactStatus;
  outcome?: OrderOutcome;
  return_exchange_status?: OrderReturnExchangeStatus;
  delay_date?: string | null;
  delay_reason?: string;
  internal_note?: string;
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

  /** POS / Manual order creation (Method B). */
  async createPOS(payload: POSOrderCreateRequest) {
    const { data } = await apiClient.post<OrderDetail>(
      '/api/v1/orders/pos/',
      payload
    );
    return data;
  },

  /** Patch order status. */
  async updateStatus(id: number, status: OrderStatus, internalNote?: string) {
    const { data } = await apiClient.patch<OrderDetail>(
      `/api/v1/orders/${id}/status/`,
      { status, internal_note: internalNote ?? '' }
    );
    return data;
  },

  async updateStatusFields(id: number, payload: OrderStatusFieldsPayload) {
    const { data } = await apiClient.patch<OrderDetail>(
      `/api/v1/orders/${id}/status/`,
      payload
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

  async submitDelivery(id: number) {
    const { data } = await apiClient.post(
      `/api/v1/orders/${id}/submit-delivery/`
    );
    return data;
  },

  async processReturn(id: number, returnReason?: string) {
    const { data } = await apiClient.post<OrderDetail>(
      `/api/v1/orders/${id}/process-return/`,
      { return_reason: returnReason ?? '' }
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
