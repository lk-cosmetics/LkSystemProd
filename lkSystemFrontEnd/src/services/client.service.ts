/**
 * Client Service – CRUD for the /api/v1/clients/ endpoint.
 */

import { apiClient } from './axios';
import type { Client, CreateClientRequest, PaginatedResponse } from '@/types';
import type { OrderDetail, OrderListItem } from '@/types';

export interface ClientListParams {
  company?: number;
  source?: string;
  scope?: string;
  sales_channel?: number;
  is_active?: boolean;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export interface CreateClientFromPOSRequest {
  sales_channel: number;  // Required - brand is auto-extracted from this
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  client_type?: 'PERSON' | 'COMPANY';
  matricule_fiscale?: string;
  date_of_birth?: string | null;
  address?: string;
  state?: string;
  postcode?: string;
  country?: string;
  notes?: string;
}

export const clientService = {
  async getAll(params?: ClientListParams) {
    const { data } = await apiClient.get<PaginatedResponse<Client> | Client[]>(
      '/api/v1/clients/',
      { params }
    );
    return data;
  },

  async getById(id: number) {
    const { data } = await apiClient.get<Client>(`/api/v1/clients/${id}/`);
    return data;
  },

  async create(payload: CreateClientRequest) {
    const { data } = await apiClient.post<Client>('/api/v1/clients/', payload);
    return data;
  },

  /**
   * Create client directly from POS page.
   * 
   * Best Practice:
   *   - Brand is automatically extracted from sales_channel (no need to send brand_id)
   *   - Source is automatically set to "POS"
   *   - Company is automatically set from authenticated user context
   *   - Created_by is automatically tracked
   * 
   * @param payload - Client data with required sales_channel
   * @returns Created client object with auto-assigned brand and metadata
   */
  async createFromPOS(payload: CreateClientFromPOSRequest) {
    // `existing: true` means the customer was already on file and the backend
    // returned the matched client instead of creating a duplicate.
    const { data } = await apiClient.post<Client & { existing?: boolean }>(
      '/api/v1/clients/create-from-pos/',
      payload
    );
    return data;
  },

  async update(id: number, payload: Partial<CreateClientRequest>) {
    const { data } = await apiClient.patch<Client>(
      `/api/v1/clients/${id}/`,
      payload
    );
    return data;
  },

  async delete(id: number) {
    await apiClient.delete(`/api/v1/clients/${id}/`);
  },

  async setBlocked(id: number, is_blocked: boolean) {
    const { data } = await apiClient.patch<Client>(
      `/api/v1/clients/${id}/block/`,
      { is_blocked }
    );
    return data;
  },

  async getOrders(id: number) {
    const { data } = await apiClient.get<OrderListItem[]>(`/api/v1/clients/${id}/orders/`);
    return data;
  },

  async getOrderDetail(id: number, orderId: number) {
    const { data } = await apiClient.get<OrderDetail>(`/api/v1/clients/${id}/orders/${orderId}/`);
    return data;
  },
};
