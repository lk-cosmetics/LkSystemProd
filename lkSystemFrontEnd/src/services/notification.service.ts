/**
 * Notification service
 *
 * Thin client over the per-user notification inbox exposed at
 * ``/api/v1/notifications/``. Every endpoint is scoped to the authenticated
 * user on the backend, so there is nothing tenant- or user-specific to pass
 * from the client — we only send list filters and the page cursor.
 *
 *   GET  /api/v1/notifications/                 paginated, filterable list
 *   GET  /api/v1/notifications/unread-count/     fast unread count
 *   POST /api/v1/notifications/{id}/mark-read/    mark one item read
 *   POST /api/v1/notifications/mark-all-read/     bulk mark all read
 */

import { apiClient } from './axios';
import type { PaginatedResponse } from '@/types';

export type NotificationCategory =
  | 'order'
  | 'sync'
  | 'stock'
  | 'return'
  | 'exchange'
  | 'system';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/** One inbox row for the current user (mirrors NotificationListSerializer). */
export interface NotificationItem {
  /** Recipient (inbox) row id — the handle used by mark-read. */
  id: number;
  notification_id: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  /** Deep-link the frontend opens on click (e.g. '/dashboard/orders'). */
  link_url: string;
  /** 'order' | 'product' | 'inventory' | 'setting' | '' */
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListParams {
  page?: number;
  page_size?: number;
  is_read?: boolean;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  /** ISO-8601 lower bound on created_at (inclusive). */
  date_from?: string;
  /** ISO-8601 upper bound on created_at (inclusive). */
  date_to?: string;
  ordering?: string;
}

export interface UnreadCountResponse {
  unread: number;
}

export interface MarkReadResponse {
  id: number;
  is_read: boolean;
}

export interface MarkAllReadResponse {
  updated: number;
}

class NotificationService {
  private readonly base = '/api/v1/notifications/';

  /** Paginated inbox for the current user. */
  async list(
    params?: NotificationListParams
  ): Promise<PaginatedResponse<NotificationItem>> {
    const response = await apiClient.get<PaginatedResponse<NotificationItem>>(
      this.base,
      { params }
    );
    return response.data;
  }

  /** Cheap unread count — backed by a dedicated index, never loads rows. */
  async unreadCount(): Promise<number> {
    const response = await apiClient.get<UnreadCountResponse>(
      `${this.base}unread-count/`
    );
    return response.data.unread;
  }

  /** Mark a single inbox item read (idempotent, current user only). */
  async markRead(id: number): Promise<MarkReadResponse> {
    const response = await apiClient.post<MarkReadResponse>(
      `${this.base}${id}/mark-read/`
    );
    return response.data;
  }

  /** Bulk-mark every unread item read in a single request. */
  async markAllRead(): Promise<MarkAllReadResponse> {
    const response = await apiClient.post<MarkAllReadResponse>(
      `${this.base}mark-all-read/`
    );
    return response.data;
  }
}

export const notificationService = new NotificationService();
export default notificationService;
