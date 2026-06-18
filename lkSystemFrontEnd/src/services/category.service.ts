/**
 * Category Service
 * Handles all category-related API calls
 */

import { apiClient } from './axios';
import type {
  Category,
  CategoryListItem,
  CategoryTree,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  PaginatedResponse,
  ProductListItem,
} from '@/types';

interface CategoryQueryParams {
  sales_channel?: number;
  parent?: number | null;
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
}

interface SyncResponse {
  message: string;
  synced_count?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  errors?: string[];
}

interface WooCommerceCategoryPreview {
  wc_id: number;
  name: string;
  slug: string;
  description: string;
  parent_id: number;
  count: number;
  image: string;
  exists_locally: boolean;
}

export interface WooCommerceCategoryPreviewResponse {
  sales_channel: number;
  sales_channel_name: string;
  total_count: number;
  existing_count: number;
  new_count: number;
  categories: WooCommerceCategoryPreview[];
}

const CATEGORY_ENDPOINT = '/api/v1/categories/';

class CategoryService {
  /**
   * Get all categories (handles paginated response)
   */
  async getAllCategories(
    params?: CategoryQueryParams
  ): Promise<CategoryListItem[]> {
    const response = await apiClient.get<PaginatedResponse<CategoryListItem>>(
      CATEGORY_ENDPOINT,
      { params }
    );
    // Handle paginated response - extract results array
    if (response.data && 'results' in response.data) {
      return response.data.results;
    }
    // Fallback for non-paginated response
    return response.data as unknown as CategoryListItem[];
  }

  /**
   * Get categories with pagination info
   */
  async getCategoriesPaginated(
    params?: CategoryQueryParams
  ): Promise<PaginatedResponse<CategoryListItem>> {
    const response = await apiClient.get<PaginatedResponse<CategoryListItem>>(
      CATEGORY_ENDPOINT,
      { params }
    );
    return response.data;
  }

  /**
   * Get categories by sales channel
   */
  async getCategoriesBySalesChannel(
    salesChannelId: number
  ): Promise<CategoryListItem[]> {
    return this.getAllCategories({ sales_channel: salesChannelId });
  }

  /**
   * Get root categories (no parent)
   */
  async getRootCategories(): Promise<CategoryListItem[]> {
    return this.getAllCategories({ parent: null });
  }

  /**
   * Get category by ID
   */
  async getCategoryById(id: number): Promise<Category> {
    const response = await apiClient.get<Category>(
      `${CATEGORY_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Products that belong to this category. Reuses the products list endpoint
   * (already brand/RBAC-scoped and category-filterable via ?categories=).
   */
  async getCategoryProducts(
    id: number,
    params: { page?: number; page_size?: number } = {},
  ): Promise<PaginatedResponse<ProductListItem>> {
    const response = await apiClient.get<PaginatedResponse<ProductListItem>>(
      '/api/v1/products/',
      { params: { categories: id, page_size: 50, ...params } },
    );
    return response.data;
  }

  /**
   * Get category tree (hierarchical structure)
   */
  async getCategoryTree(): Promise<CategoryTree[]> {
    const response = await apiClient.get<CategoryTree[]>(
      `${CATEGORY_ENDPOINT}tree/`
    );
    return response.data;
  }

  /**
   * Create new category
   */
  async createCategory(data: CreateCategoryRequest | FormData): Promise<Category> {
    // FormData (image upload) → axios sets the multipart boundary itself.
    const response = await apiClient.post<Category>(CATEGORY_ENDPOINT, data);
    return response.data;
  }

  /**
   * Update category (full update). Accepts FormData for image uploads.
   */
  async updateCategory(
    id: number,
    data: UpdateCategoryRequest | FormData
  ): Promise<Category> {
    const response = await apiClient.put<Category>(
      `${CATEGORY_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Partial update category
   */
  async partialUpdateCategory(
    id: number,
    data: Partial<UpdateCategoryRequest>
  ): Promise<Category> {
    const response = await apiClient.patch<Category>(
      `${CATEGORY_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Delete category
   */
  async deleteCategory(id: number): Promise<void> {
    await apiClient.delete(`${CATEGORY_ENDPOINT}${id}/`);
  }

  /**
   * Get categories by sales channel (grouped)
   */
  async getCategoriesBySalesChannelGrouped(
    salesChannelId: number
  ): Promise<CategoryListItem[]> {
    const response = await apiClient.get<CategoryListItem[]>(
      `${CATEGORY_ENDPOINT}by_sales_channel/`,
      { params: { sales_channel_id: salesChannelId } }
    );
    return response.data;
  }

  /**
   * Sync categories from WooCommerce
   */
  async syncFromWooCommerce(salesChannelId?: number): Promise<SyncResponse> {
    const response = await apiClient.post<SyncResponse>(
      `${CATEGORY_ENDPOINT}sync/`,
      salesChannelId ? { sales_channel: salesChannelId } : {}
    );
    return response.data;
  }

  /**
   * Preview categories from WooCommerce (without saving)
   */
  async previewFromWooCommerce(
    salesChannelId: number
  ): Promise<WooCommerceCategoryPreviewResponse> {
    const response = await apiClient.post<WooCommerceCategoryPreviewResponse>(
      `${CATEGORY_ENDPOINT}preview/`,
      { sales_channel: salesChannelId }
    );
    return response.data;
  }

  /**
   * Sync selected categories from WooCommerce
   */
  async syncSelectedFromWooCommerce(
    salesChannelId: number,
    wcCategoryIds: number[]
  ): Promise<SyncResponse> {
    const response = await apiClient.post<SyncResponse>(
      `${CATEGORY_ENDPOINT}sync-selected/`,
      { sales_channel: salesChannelId, wc_category_ids: wcCategoryIds }
    );
    return response.data;
  }

  /**
   * Search categories
   */
  async searchCategories(
    query: string,
    params?: Omit<CategoryQueryParams, 'search'>
  ): Promise<CategoryListItem[]> {
    return this.getAllCategories({ ...params, search: query });
  }

  /**
   * Get child categories
   */
  async getChildCategories(parentId: number): Promise<CategoryListItem[]> {
    return this.getAllCategories({ parent: parentId });
  }
}

export const categoryService = new CategoryService();
