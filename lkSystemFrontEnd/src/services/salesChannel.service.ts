/**
 * Sales Channel Service
 * Handles all API calls related to sales channels
 */

import { apiClient } from './axios';
import { AUTH_CONFIG } from '@/utils/constants';
import type {
  SalesChannel,
  CreateSalesChannelRequest,
  PaginatedResponse,
  GenerateCredentialsResponse,
  ChannelType,
} from '@/types';

class SalesChannelService {
  /**
   * Get all sales channels
   */
  async getAllChannels(): Promise<SalesChannel[]> {
    const response = await apiClient.get<PaginatedResponse<SalesChannel>>(
      AUTH_CONFIG.SALES_CHANNEL_ENDPOINT
    );
    return response.data.results;
  }

  /**
   * Get sales channels by brand
   */
  async getChannelsByBrand(brandId: number): Promise<SalesChannel[]> {
    const response = await apiClient.get<PaginatedResponse<SalesChannel>>(
      AUTH_CONFIG.SALES_CHANNEL_ENDPOINT,
      { params: { brand: brandId } }
    );
    return response.data.results;
  }

  /**
   * Get sales channels by type
   */
  async getChannelsByType(channelType: ChannelType): Promise<SalesChannel[]> {
    const response = await apiClient.get<PaginatedResponse<SalesChannel>>(
      AUTH_CONFIG.SALES_CHANNEL_ENDPOINT,
      { params: { channel_type: channelType } }
    );
    return response.data.results;
  }

  async getActivePOSChannelsByBrand(brandId: number): Promise<SalesChannel[]> {
    const response = await apiClient.get<PaginatedResponse<SalesChannel>>(
      AUTH_CONFIG.SALES_CHANNEL_ENDPOINT,
      { params: { brand: brandId, channel_type: 'POS', is_active: true } }
    );
    return response.data.results;
  }

  /**
   * Get active sales channels
   */
  async getActiveChannels(): Promise<SalesChannel[]> {
    const response = await apiClient.get<SalesChannel[]>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}active/`
    );
    return response.data;
  }

  /**
   * Get WooCommerce channels
   */
  async getWooCommerceChannels(): Promise<SalesChannel[]> {
    const response = await apiClient.get<SalesChannel[]>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}woocommerce/`
    );
    return response.data;
  }

  /**
   * Get POS channels
   */
  async getPOSChannels(): Promise<SalesChannel[]> {
    const response = await apiClient.get<SalesChannel[]>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}pos/`
    );
    return response.data;
  }

  /**
   * Get sales channel by ID
   */
  async getChannelById(id: number): Promise<SalesChannel> {
    const response = await apiClient.get<SalesChannel>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Create new sales channel
   */
  async createChannel(data: CreateSalesChannelRequest): Promise<SalesChannel> {
    const response = await apiClient.post<SalesChannel>(
      AUTH_CONFIG.SALES_CHANNEL_ENDPOINT,
      data
    );
    return response.data;
  }

  /**
   * Update sales channel (full update)
   */
  async updateChannel(
    id: number,
    data: Partial<CreateSalesChannelRequest>
  ): Promise<SalesChannel> {
    const response = await apiClient.put<SalesChannel>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Partial update sales channel
   */
  async partialUpdateChannel(
    id: number,
    data: Partial<CreateSalesChannelRequest & { is_active?: boolean }>
  ): Promise<SalesChannel> {
    const response = await apiClient.patch<SalesChannel>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Delete sales channel
   */
  async deleteChannel(id: number): Promise<void> {
    await apiClient.delete(`${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/`);
  }

  /**
   * Regenerate WooCommerce webhook token
   */
  async regenerateWebhook(id: number): Promise<GenerateCredentialsResponse> {
    const response = await apiClient.post<GenerateCredentialsResponse>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/regenerate-webhook/`
    );
    return response.data;
  }

  /**
   * Update WooCommerce store URL
   */
  async updateStoreUrl(id: number, storeUrl: string): Promise<SalesChannel> {
    const response = await apiClient.patch<SalesChannel>(
      `${AUTH_CONFIG.SALES_CHANNEL_ENDPOINT}${id}/store-url/`,
      { store_url: storeUrl }
    );
    return response.data;
  }
}

export const salesChannelService = new SalesChannelService();
