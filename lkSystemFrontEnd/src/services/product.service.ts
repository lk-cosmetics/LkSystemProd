/**
 * Product Service
 * Handles all product-related API calls
 */

import { apiClient } from './axios';
import type {
  Product,
  ProductListItem,
  POSProductCacheResponse,
  CreateProductRequest,
  UpdateProductRequest,
  PaginatedResponse,
  PackStockEntry,
} from '@/types';

interface ProductQueryParams {
  brand?: number;
  categories?: number; // filter products by a category id (?categories=<id>)
  product_type?: string;
  status?: 'publish' | 'draft' | 'pending' | 'private';
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  offset?: number;
  limit?: number;
  show_deleted?: boolean;
  only_deleted?: boolean;
}

interface SyncResponse {
  message: string;
  synced_count?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  errors?: string[];
}

interface WooCommerceProductPreview {
  wc_id: number;
  name: string;
  sku: string;
  price: string;
  status: string;
  type: string;
  image: string;
  exists_locally: boolean;
}

interface WooCommercePreviewResponse {
  sales_channel: number;
  sales_channel_name: string;
  total_count: number;
  existing_count: number;
  new_count: number;
  products: WooCommerceProductPreview[];
}

const PRODUCT_ENDPOINT = '/api/v1/products/';

/**
 * Build a multipart payload for create/update when an image File is attached.
 * Scalars are stringified; ``pack_items`` is JSON-encoded (so the backend can
 * clear or replace it — ``null`` → the string "null"); typed nulls such as
 * ``brand: null`` are omitted because multipart can't carry a typed null and an
 * empty string would break PK/number fields. Clear those via a normal JSON save.
 */
function buildProductFormData(
  data: CreateProductRequest | UpdateProductRequest,
  imageFile: File,
): FormData {
  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === 'pack_items') {
      form.append('pack_items', JSON.stringify(value ?? null));
    } else if (value === null) {
      return;
    } else if (typeof value === 'boolean') {
      form.append(key, value ? 'true' : 'false');
    } else {
      form.append(key, String(value));
    }
  });
  form.append('image', imageFile);
  return form;
}

const normalizeProductQueryParams = (params?: ProductQueryParams): ProductQueryParams | undefined => {
  if (!params) return undefined;

  const normalized: ProductQueryParams = { ...params };

  if (normalized.limit !== undefined && normalized.page_size === undefined) {
    normalized.page_size = normalized.limit;
  }
  if (normalized.page_size !== undefined && normalized.limit === undefined) {
    normalized.limit = normalized.page_size;
  }

  return normalized;
};

const normalizePaginatedResponse = <T>(
  data: PaginatedResponse<T> | T[]
): PaginatedResponse<T> => {
  if (Array.isArray(data)) {
    return { count: data.length, next: null, previous: null, results: data };
  }
  if (data && Array.isArray(data.results)) {
    return data;
  }
  return { count: 0, next: null, previous: null, results: [] };
};

class ProductService {
  /**
   * Return **every** matching product, following DRF pagination across pages.
   *
   * Before: this returned only ``results`` from the first response, which
   * meant any caller that didn't pass an explicit large ``page_size`` was
   * silently capped at the backend default (``PAGE_SIZE=20``). The Pack
   * builder, Manufacturing page, and Inventory page all relied on a complete
   * list and were silently missing anything past row #20.
   *
   * Now: we fetch the first page, then keep requesting subsequent pages
   * (incrementing ``page``) until ``next`` is null. A safety cap prevents
   * runaway loops if the backend ever misbehaves. Internal batch size is
   * generous (200) so a typical catalogue (~150 products) finishes in one
   * round-trip while leaving headroom for growth.
   *
   * Callers that explicitly want a single capped page (e.g. typeahead
   * dropdowns that show "top N matches") should use
   * :meth:`getProductsPaginated` instead.
   */
  async getAllProducts(params?: ProductQueryParams): Promise<ProductListItem[]> {
    const BATCH_SIZE = 200;
    const MAX_PAGES = 100;   // 100 × 200 = 20,000 hard ceiling

    // If the caller asked for a specific page, honour that — single page only.
    if (params?.page !== undefined) {
      const response = await apiClient.get<PaginatedResponse<ProductListItem> | ProductListItem[]>(
        PRODUCT_ENDPOINT,
        { params: normalizeProductQueryParams(params) },
      );
      return normalizePaginatedResponse(response.data).results;
    }

    const baseParams: ProductQueryParams = {
      ...(params ?? {}),
      page_size: BATCH_SIZE,
    };

    const collected: ProductListItem[] = [];
    let page = 1;
    while (page <= MAX_PAGES) {
      const response = await apiClient.get<PaginatedResponse<ProductListItem> | ProductListItem[]>(
        PRODUCT_ENDPOINT,
        { params: normalizeProductQueryParams({ ...baseParams, page }) },
      );
      const normalized = normalizePaginatedResponse(response.data);
      collected.push(...normalized.results);
      // Stop only when the API confirms there is no next page. We used to
      // also break when the page came back smaller than ``BATCH_SIZE``, but
      // that's unsafe — DRF's default paginator silently ignores
      // ``?page_size=`` and returns its configured size, which made the
      // loop short-circuit after page 1 and lose everything past row 20.
      if (!normalized.next) break;
      page += 1;
    }
    return collected;
  }

  async getProductsPaginated(params?: ProductQueryParams): Promise<PaginatedResponse<ProductListItem>> {
    const response = await apiClient.get<PaginatedResponse<ProductListItem> | ProductListItem[]>(
      PRODUCT_ENDPOINT,
      { params: normalizeProductQueryParams(params) },
    );
    return normalizePaginatedResponse(response.data);
  }

  async getProductsByBrand(brandId: number): Promise<ProductListItem[]> {
    return this.getAllProducts({ brand: brandId });
  }

  async getProductById(id: number): Promise<Product> {
    const response = await apiClient.get<Product>(`${PRODUCT_ENDPOINT}${id}/`);
    return response.data;
  }

  async createProduct(data: CreateProductRequest, imageFile?: File | null): Promise<Product> {
    if (imageFile) {
      const response = await apiClient.post<Product>(
        PRODUCT_ENDPOINT,
        buildProductFormData(data, imageFile),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return response.data;
    }
    const response = await apiClient.post<Product>(PRODUCT_ENDPOINT, data);
    return response.data;
  }

  async updateProduct(id: number, data: UpdateProductRequest, imageFile?: File | null): Promise<Product> {
    if (imageFile) {
      const response = await apiClient.put<Product>(
        `${PRODUCT_ENDPOINT}${id}/`,
        buildProductFormData(data, imageFile),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return response.data;
    }
    const response = await apiClient.put<Product>(`${PRODUCT_ENDPOINT}${id}/`, data);
    return response.data;
  }

  async partialUpdateProduct(
    id: number,
    data: Partial<UpdateProductRequest>,
    imageFile?: File | null,
  ): Promise<Product> {
    if (imageFile) {
      const response = await apiClient.patch<Product>(
        `${PRODUCT_ENDPOINT}${id}/`,
        buildProductFormData(data, imageFile),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return response.data;
    }
    const response = await apiClient.patch<Product>(`${PRODUCT_ENDPOINT}${id}/`, data);
    return response.data;
  }

  /**
   * Soft delete a product (sets is_deleted=true on the backend).
   */
  async deleteProduct(id: number): Promise<void> {
    await apiClient.delete(`${PRODUCT_ENDPOINT}${id}/`);
  }

  /**
   * Permanently delete a product from database.
   * Only allowed for products already soft-deleted.
   */
  async hardDeleteProduct(id: number): Promise<void> {
    await apiClient.delete(`${PRODUCT_ENDPOINT}${id}/`, {
      params: { hard: true },
    });
  }

  /**
   * Restore a soft-deleted product.
   */
  async restoreProduct(id: number): Promise<Product> {
    const response = await apiClient.post<Product>(`${PRODUCT_ENDPOINT}${id}/restore/`);
    return response.data;
  }

  /**
   * Search product by exact barcode match.
   */
  async searchByBarcode(barcode: string): Promise<Product | null> {
    try {
      const response = await apiClient.get<Product>(
        `${PRODUCT_ENDPOINT}search_barcode/`,
        { params: { barcode } },
      );
      return response.data;
    } catch {
      return null;
    }
  }

  async searchProducts(query: string, params?: Omit<ProductQueryParams, 'search'>): Promise<ProductListItem[]> {
    return this.getAllProducts({ ...params, search: query });
  }

  /**
   * Get computed pack stock per sales channel (never stored, always live).
   */
  async getPackStock(productId: number, salesChannelId?: number): Promise<PackStockEntry[]> {
    const response = await apiClient.get<PackStockEntry[]>(
      `${PRODUCT_ENDPOINT}${productId}/pack-stock/`,
      { params: salesChannelId ? { sales_channel: salesChannelId } : {} },
    );
    return response.data;
  }

  // ── Bulk operations & CSV ─────────────────────────────────────────────

  /**
   * Apply a single ``status`` to many products in one round-trip.
   * Backend audits every affected row.
   */
  async bulkChangeStatus(
    ids: number[],
    nextStatus: 'publish' | 'draft' | 'pending' | 'private',
  ): Promise<{ updated: number; requested: number; status: string; updated_ids: number[] }> {
    const response = await apiClient.post<{
      updated: number;
      requested: number;
      status: string;
      updated_ids: number[];
    }>(`${PRODUCT_ENDPOINT}bulk-change-status/`, {
      ids,
      status: nextStatus,
    });
    return response.data;
  }

  /**
   * Trigger a CSV download of the current filtered catalogue.
   * Returns the Blob so the caller can save it under any filename.
   */
  async exportCSV(params?: ProductQueryParams): Promise<Blob> {
    const response = await apiClient.get<Blob>(`${PRODUCT_ENDPOINT}export-csv/`, {
      params: normalizeProductQueryParams(params),
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Upsert products from a CSV file. The backend matches by barcode.
   */
  async importCSV(file: File): Promise<{
    created: number;
    updated: number;
    skipped: number;
    errors: { row: number; message: string }[];
  }> {
    const form = new FormData();
    form.append('file', file);
    const response = await apiClient.post<{
      created: number;
      updated: number;
      skipped: number;
      errors: { row: number; message: string }[];
    }>(`${PRODUCT_ENDPOINT}import-csv/`, form, {
      // Let axios infer the multipart boundary — don't force a content type.
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getPOSCache(salesChannelId: number): Promise<POSProductCacheResponse> {
    const response = await apiClient.get<POSProductCacheResponse>(
      `${PRODUCT_ENDPOINT}pos-cache/`,
      { params: { sales_channel: salesChannelId } },
    );
    return response.data;
  }

  // ── WooCommerce sync ────────────────────────────────────────────────

  async syncFromWooCommerce(salesChannelId?: number): Promise<SyncResponse> {
    const response = await apiClient.post<SyncResponse>(
      `${PRODUCT_ENDPOINT}sync/`,
      salesChannelId
        ? { sales_channel: salesChannelId, default_product_type: 'resell_product' }
        : { default_product_type: 'resell_product' },
      // A full WooCommerce catalogue sync runs synchronously and can take a
      // couple of minutes; override the global 10s axios timeout so the client
      // waits for the result instead of aborting (the products still synced).
      { timeout: 240_000 },
    );
    return response.data;
  }

  async previewFromWooCommerce(salesChannelId: number): Promise<WooCommercePreviewResponse> {
    const response = await apiClient.post<WooCommercePreviewResponse>(
      `${PRODUCT_ENDPOINT}preview/`,
      { sales_channel: salesChannelId },
      { timeout: 240_000 },
    );
    return response.data;
  }

  async syncSelectedFromWooCommerce(salesChannelId: number, wcProductIds: number[]): Promise<SyncResponse> {
    const response = await apiClient.post<SyncResponse>(
      `${PRODUCT_ENDPOINT}sync-selected/`,
      {
        sales_channel: salesChannelId,
        wc_product_ids: wcProductIds,
        default_product_type: 'resell_product',
      },
      { timeout: 240_000 },
    );
    return response.data;
  }
}

export const productService = new ProductService();
