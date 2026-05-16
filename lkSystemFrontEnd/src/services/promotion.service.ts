/**
 * Promotion Service
 * Handles all promotion-related API calls for the Multi-Channel Promotion Engine
 */

import { apiClient } from './axios';
import type {
  Promotion,
  PromotionListItem,
  PromotionChannelRule,
  CreatePromotionRequest,
  UpdatePromotionRequest,
  PromotionChannelRuleInput,
  DiscountCalculationRequest,
  DiscountCalculationResult,
  PromotionAnalytics,
  PromotionGroupDetail,
  PromotionGroupListItem,
  UpdatePromotionGroupRequest,
  PaginatedResponse,
  PromotionStatus,
  DiscountType,
} from '@/types';

// =============================================================================
// TYPES
// =============================================================================

interface PromotionQueryParams {
  status?: PromotionStatus;
  is_active?: boolean;
  discount_type?: DiscountType;
  product?: number;
  brand?: number;
  company?: number;
  sales_channel?: number;
  current_only?: boolean;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

export interface PromotionGroupQueryParams {
  status?: PromotionStatus;
  is_active?: boolean;
  brand?: number;
  company?: number;
  sales_channel?: number;
  current_only?: boolean;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

interface BulkActionResponse {
  activated?: number;
  deactivated?: number;
}

export type BulkPromotionDiscountType = DiscountType;

export interface BulkPromotionItem {
  product: number;
  discount_type: BulkPromotionDiscountType;
  discount_value: number | string;
  name_override?: string;
}

export interface BulkCreatePromotionsRequest {
  name: string;
  description?: string;
  code?: string | null;
  brand?: number | null;
  start_date: string;
  /** Omit or set to null for an open-ended promotion. */
  end_date?: string | null;
  status?: PromotionStatus;
  is_active?: boolean;
  is_stackable?: boolean;
  priority?: number;
  max_usage?: number | null;
  sales_channels: number[];
  items: BulkPromotionItem[];
}

export interface BulkCreatePromotionsResponse {
  created: number;
  results: PromotionListItem[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const PROMOTION_ENDPOINT = '/api/v1/promotions/';
const PROMOTION_RULE_ENDPOINT = '/api/v1/promotion-rules/';

// =============================================================================
// SERVICE CLASS
// =============================================================================

class PromotionService {
  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Get all promotions (handles paginated response)
   */
  async getAllPromotions(
    params?: PromotionQueryParams
  ): Promise<PromotionListItem[]> {
    const response = await apiClient.get<PaginatedResponse<PromotionListItem>>(
      PROMOTION_ENDPOINT,
      { params }
    );
    if (response.data && 'results' in response.data) {
      return response.data.results;
    }
    return response.data as unknown as PromotionListItem[];
  }

  /**
   * Get promotions with pagination info
   */
  async getPromotionsPaginated(
    params?: PromotionQueryParams
  ): Promise<PaginatedResponse<PromotionListItem>> {
    const response = await apiClient.get<PaginatedResponse<PromotionListItem>>(
      PROMOTION_ENDPOINT,
      { params }
    );
    return response.data;
  }

  /**
   * Get a single promotion by ID
   */
  async getPromotionById(id: number): Promise<Promotion> {
    const response = await apiClient.get<Promotion>(
      `${PROMOTION_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Create a new promotion with channel rules
   */
  async createPromotion(data: CreatePromotionRequest): Promise<Promotion> {
    const response = await apiClient.post<Promotion>(PROMOTION_ENDPOINT, data);
    return response.data;
  }

  /**
   * Update an existing promotion
   */
  async updatePromotion(
    id: number,
    data: UpdatePromotionRequest
  ): Promise<Promotion> {
    const response = await apiClient.patch<Promotion>(
      `${PROMOTION_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Delete a promotion
   */
  async deletePromotion(id: number): Promise<void> {
    await apiClient.delete(`${PROMOTION_ENDPOINT}${id}/`);
  }

  // ===========================================================================
  // Channel Rule Management
  // ===========================================================================

  /**
   * Get all channel rules for a promotion
   */
  async getChannelRules(promotionId: number): Promise<PromotionChannelRule[]> {
    const response = await apiClient.get<PromotionChannelRule[]>(
      `${PROMOTION_ENDPOINT}${promotionId}/channel_rules/`
    );
    return response.data;
  }

  /**
   * Add a channel rule to a promotion
   */
  async addChannelRule(
    promotionId: number,
    rule: PromotionChannelRuleInput
  ): Promise<PromotionChannelRule> {
    const response = await apiClient.post<PromotionChannelRule>(
      `${PROMOTION_ENDPOINT}${promotionId}/add_channel_rule/`,
      rule
    );
    return response.data;
  }

  /**
   * Update a channel rule
   */
  async updateChannelRule(
    promotionId: number,
    salesChannelId: number,
    updates: Partial<PromotionChannelRuleInput>
  ): Promise<PromotionChannelRule> {
    const response = await apiClient.patch<PromotionChannelRule>(
      `${PROMOTION_ENDPOINT}${promotionId}/update_channel_rule/`,
      { sales_channel: salesChannelId, ...updates }
    );
    return response.data;
  }

  /**
   * Remove a channel rule from a promotion
   */
  async removeChannelRule(
    promotionId: number,
    salesChannelId: number
  ): Promise<void> {
    await apiClient.delete(
      `${PROMOTION_ENDPOINT}${promotionId}/remove_channel_rule/`,
      { params: { sales_channel: salesChannelId } }
    );
  }

  // ===========================================================================
  // Status Actions
  // ===========================================================================

  /**
   * Activate a promotion
   */
  async activatePromotion(id: number): Promise<{ status: string }> {
    const response = await apiClient.post<{ status: string }>(
      `${PROMOTION_ENDPOINT}${id}/activate/`
    );
    return response.data;
  }

  /**
   * Deactivate a promotion
   */
  async deactivatePromotion(id: number): Promise<{ status: string }> {
    const response = await apiClient.post<{ status: string }>(
      `${PROMOTION_ENDPOINT}${id}/deactivate/`
    );
    return response.data;
  }

  /**
   * Duplicate a promotion
   */
  async duplicatePromotion(id: number): Promise<Promotion> {
    const response = await apiClient.post<Promotion>(
      `${PROMOTION_ENDPOINT}${id}/duplicate/`
    );
    return response.data;
  }

  // ===========================================================================
  // Bulk Actions
  // ===========================================================================

  /**
   * Activate multiple promotions
   */
  async bulkActivate(ids: number[]): Promise<BulkActionResponse> {
    const response = await apiClient.post<BulkActionResponse>(
      `${PROMOTION_ENDPOINT}bulk_activate/`,
      { ids }
    );
    return response.data;
  }

  /**
   * Deactivate multiple promotions
   */
  async bulkDeactivate(ids: number[]): Promise<BulkActionResponse> {
    const response = await apiClient.post<BulkActionResponse>(
      `${PROMOTION_ENDPOINT}bulk_deactivate/`,
      { ids }
    );
    return response.data;
  }

  /**
   * Delete multiple promotions in a single atomic backend call.
   */
  async bulkDelete(ids: number[]): Promise<{ deleted: number }> {
    const response = await apiClient.post<{ deleted: number }>(
      `${PROMOTION_ENDPOINT}bulk_delete/`,
      { ids },
    );
    return response.data;
  }

  /**
   * Create many promotions in one atomic request — one row per product, all
   * sharing the same name/dates/channels, each carrying its own discount.
   */
  async bulkCreate(
    payload: BulkCreatePromotionsRequest,
  ): Promise<BulkCreatePromotionsResponse> {
    const response = await apiClient.post<BulkCreatePromotionsResponse>(
      `${PROMOTION_ENDPOINT}bulk_create/`,
      payload,
    );
    return response.data;
  }

  // ===========================================================================
  // Discount Calculation
  // ===========================================================================

  /**
   * Calculate discount for a product on a specific channel
   */
  async calculateDiscount(
    request: DiscountCalculationRequest
  ): Promise<DiscountCalculationResult> {
    const response = await apiClient.post<DiscountCalculationResult>(
      `${PROMOTION_ENDPOINT}calculate_discount/`,
      request
    );
    return response.data;
  }

  /**
   * Batch-calculate discounts for multiple products on a specific POS channel.
   * Returns a map of product_id (string) → DiscountCalculationResult.
   * Products with no active promotion on this channel are omitted from the map.
   *
   * Use this instead of N individual `calculateDiscount` calls to avoid race
   * conditions and excessive network round-trips on the POS page.
   */
  async batchCalculateDiscounts(request: {
    product_ids: number[];
    sales_channel_id: number;
  }): Promise<{
    sales_channel_id: number;
    results: Record<string, DiscountCalculationResult>;
  }> {
    const response = await apiClient.post<{
      sales_channel_id: number;
      results: Record<string, DiscountCalculationResult>;
    }>(`${PROMOTION_ENDPOINT}batch_calculate_discounts/`, request);
    return response.data;
  }

  // ===========================================================================
  // PROMOTION GROUPS
  // ===========================================================================

  /** List campaign rows — one per promotion group. */
  async getPromotionGroups(
    params?: PromotionGroupQueryParams,
  ): Promise<PromotionGroupListItem[]> {
    const response = await apiClient.get<
      PaginatedResponse<PromotionGroupListItem> | PromotionGroupListItem[]
    >(`${PROMOTION_ENDPOINT}groups/`, { params });
    if (Array.isArray(response.data)) {
      return response.data;
    }
    if ('results' in response.data) {
      return response.data.results;
    }
    return [];
  }

  /** Get a single campaign with members + channel set. */
  async getPromotionGroupById(groupId: string): Promise<PromotionGroupDetail> {
    const response = await apiClient.get<PromotionGroupDetail>(
      `${PROMOTION_ENDPOINT}groups/${groupId}/`,
    );
    return response.data;
  }

  /** Atomic group edit — replace meta, products, and channel set in one request. */
  async updatePromotionGroup(
    groupId: string,
    payload: UpdatePromotionGroupRequest,
  ): Promise<PromotionGroupDetail> {
    const response = await apiClient.post<PromotionGroupDetail>(
      `${PROMOTION_ENDPOINT}groups/${groupId}/update/`,
      payload,
    );
    return response.data;
  }

  /** Delete the whole campaign (all member promotions) in one atomic call. */
  async deletePromotionGroup(groupId: string): Promise<{ deleted: number }> {
    const response = await apiClient.delete<{ deleted: number }>(
      `${PROMOTION_ENDPOINT}groups/${groupId}/`,
    );
    return response.data;
  }

  // ===========================================================================
  // Analytics
  // ===========================================================================

  /**
   * Get promotion analytics/statistics
   */
  async getAnalytics(): Promise<PromotionAnalytics> {
    const response = await apiClient.get<PromotionAnalytics>(
      `${PROMOTION_ENDPOINT}analytics/`
    );
    return response.data;
  }

  // ===========================================================================
  // Direct Rule Management (via dedicated endpoint)
  // ===========================================================================

  /**
   * Get all promotion rules (for advanced filtering)
   */
  async getAllRules(params?: {
    promotion?: number;
    sales_channel?: number;
    is_enabled?: boolean;
  }): Promise<PromotionChannelRule[]> {
    const response = await apiClient.get<
      PaginatedResponse<PromotionChannelRule>
    >(PROMOTION_RULE_ENDPOINT, { params });
    if (response.data && 'results' in response.data) {
      return response.data.results;
    }
    return response.data as unknown as PromotionChannelRule[];
  }

  /**
   * Get a single rule by ID
   */
  async getRuleById(id: number): Promise<PromotionChannelRule> {
    const response = await apiClient.get<PromotionChannelRule>(
      `${PROMOTION_RULE_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Update a rule directly
   */
  async updateRuleDirect(
    id: number,
    updates: Partial<PromotionChannelRuleInput>
  ): Promise<PromotionChannelRule> {
    const response = await apiClient.patch<PromotionChannelRule>(
      `${PROMOTION_RULE_ENDPOINT}${id}/`,
      updates
    );
    return response.data;
  }
}

// Export singleton instance
export const promotionService = new PromotionService();
export default promotionService;
