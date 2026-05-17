/**
 * Inventory Service
 * Handles all inventory-related API calls (sales channel inventory, movements)
 */

import { apiClient } from './axios';
import type {
  SalesChannelInventory,
  CreateSalesChannelInventoryRequest,
  UpdateSalesChannelInventoryRequest,
  AdjustSalesChannelInventoryRequest,
  InventoryMovement,
  CreateInventoryMovementRequest,
  CreateTransferRequest,
  ProductInventorySummary,
  MovementSummary,
  BillOfMaterials,
  CreateBillOfMaterialsRequest,
  UpdateBillOfMaterialsRequest,
  ProductionBatch,
  SendToFactoryRequest,
  ReceiveFromFactoryRequest,
  InFactorySummary,
  PaginatedResponse,
} from '@/types';

// =============================================================================
// SALES CHANNEL INVENTORY SERVICE
// =============================================================================

const STORE_INVENTORY_ENDPOINT = '/api/v1/inventory/store-inventory/';

const unwrapList = <T>(data: PaginatedResponse<T> | T[]): T[] => {
  if (Array.isArray(data)) return data;
  return data.results;
};

/**
 * Fetch every page of a paginated list endpoint and return the union.
 *
 * The Django REST defaults to ``PAGE_SIZE=20`` for these resources, so a
 * caller that just wants "all inventory rows" used to silently lose
 * everything past row 20 — which is why the InventoryPage summary cards
 * and stock table only ever showed the first batch.
 *
 * Strategy:
 *   - Ask for ``BATCH_SIZE`` rows at a time (200 — much larger than the
 *     backend default so a typical catalogue lands in a single round-trip).
 *   - Walk ``next`` until exhausted, capped at ``MAX_PAGES`` so a runaway
 *     loop can never hammer the server (20 000 rows is plenty for an
 *     ERP inventory; pagination becomes the right answer past that).
 */
const fetchAllPaginated = async <T>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T[]> => {
  const BATCH_SIZE = 200;
  const MAX_PAGES = 100;
  const collected: T[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const response = await apiClient.get<PaginatedResponse<T> | T[]>(endpoint, {
      params: { ...(params ?? {}), page, page_size: BATCH_SIZE },
    });
    const rows = unwrapList(response.data);
    collected.push(...rows);
    // Stop when the API tells us we're done OR the current page wasn't full.
    // Arrays-only endpoints surface via the ``unwrapList`` array branch — they
    // never have a ``next`` cursor, so the length check is what ends the loop.
    if (Array.isArray(response.data)) break;
    if (!response.data.next || rows.length < BATCH_SIZE) break;
    page += 1;
  }
  return collected;
};

class StoreInventoryService {
  /**
   * Get all sales channel inventories
   */
  async getAllStoreInventories(params?: {
    sales_channel?: number;
    sales_channel__brand__company?: number;
    product?: number;
    search?: string;
  }): Promise<SalesChannelInventory[]> {
    return fetchAllPaginated<SalesChannelInventory>(
      STORE_INVENTORY_ENDPOINT,
      params,
    );
  }

  /**
   * Get sales channel inventory by ID
   */
  async getStoreInventoryById(id: number): Promise<SalesChannelInventory> {
    const response = await apiClient.get<SalesChannelInventory>(
      `${STORE_INVENTORY_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Create sales channel inventory record
   */
  async createStoreInventory(
    data: CreateSalesChannelInventoryRequest
  ): Promise<SalesChannelInventory> {
    const response = await apiClient.post<SalesChannelInventory>(
      STORE_INVENTORY_ENDPOINT,
      data
    );
    return response.data;
  }

  /**
   * Update sales channel inventory
   */
  async updateStoreInventory(
    id: number,
    data: UpdateSalesChannelInventoryRequest
  ): Promise<SalesChannelInventory> {
    const response = await apiClient.patch<SalesChannelInventory>(
      `${STORE_INVENTORY_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  /**
   * Delete sales channel inventory record
   */
  async deleteStoreInventory(id: number): Promise<void> {
    await apiClient.delete(`${STORE_INVENTORY_ENDPOINT}${id}/`);
  }

  /**
   * Adjust stock quantity
   */
  async adjustStock(
    id: number,
    data: AdjustSalesChannelInventoryRequest
  ): Promise<{
    message: string;
    movement_reference: string;
    new_quantity: number;
  }> {
    const response = await apiClient.post(
      `${STORE_INVENTORY_ENDPOINT}${id}/adjust/`,
      data
    );
    return response.data;
  }

  /**
   * Get all low stock items
   */
  async getLowStockItems(companyId?: number): Promise<SalesChannelInventory[]> {
    const response = await apiClient.get<
      PaginatedResponse<SalesChannelInventory> | SalesChannelInventory[]
    >(
      `${STORE_INVENTORY_ENDPOINT}low_stock/`,
      { params: { company: companyId } }
    );
    return unwrapList(response.data);
  }

  /**
   * Get all out of stock items
   */
  async getOutOfStockItems(
    companyId?: number
  ): Promise<SalesChannelInventory[]> {
    const response = await apiClient.get<
      PaginatedResponse<SalesChannelInventory> | SalesChannelInventory[]
    >(
      `${STORE_INVENTORY_ENDPOINT}out_of_stock/`,
      { params: { company: companyId } }
    );
    return unwrapList(response.data);
  }

  /**
   * Get inventory summary for a product across all channels
   */
  async getProductInventorySummary(
    productId: number
  ): Promise<ProductInventorySummary> {
    const response = await apiClient.get<ProductInventorySummary>(
      `${STORE_INVENTORY_ENDPOINT}by_product/`,
      { params: { product: productId } }
    );
    return response.data;
  }
}

// =============================================================================
// INVENTORY MOVEMENT SERVICE
// =============================================================================

const MOVEMENT_ENDPOINT = '/api/v1/inventory/movements/';
const BOM_ENDPOINT = '/api/v1/inventory/boms/';
const PRODUCTION_BATCH_ENDPOINT = '/api/v1/inventory/production-batches/';

class InventoryMovementService {
  /**
   * Get all inventory movements
   */
  async getAllMovements(params?: {
    sales_channel?: number;
    product?: number;
    movement_type?: string;
    status?: string;
    company?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
  }): Promise<InventoryMovement[]> {
    return fetchAllPaginated<InventoryMovement>(MOVEMENT_ENDPOINT, params);
  }

  /**
   * Get movement by ID
   */
  async getMovementById(id: number): Promise<InventoryMovement> {
    const response = await apiClient.get<InventoryMovement>(
      `${MOVEMENT_ENDPOINT}${id}/`
    );
    return response.data;
  }

  /**
   * Create inventory movement
   */
  async createMovement(
    data: CreateInventoryMovementRequest
  ): Promise<InventoryMovement> {
    const response = await apiClient.post<InventoryMovement>(
      MOVEMENT_ENDPOINT,
      data
    );
    return response.data;
  }

  /**
   * Complete a pending movement
   */
  async completeMovement(
    id: number,
    notes?: string
  ): Promise<{ message: string; reference_number: string }> {
    const response = await apiClient.post(
      `${MOVEMENT_ENDPOINT}${id}/complete/`,
      { notes }
    );
    return response.data;
  }

  /**
   * Create inter-channel transfer
   */
  async createTransfer(data: CreateTransferRequest): Promise<{
    message: string;
    transfer_out_reference: string;
    transfer_in_reference: string | null;
  }> {
    const response = await apiClient.post(
      `${MOVEMENT_ENDPOINT}transfer/`,
      data
    );
    return response.data;
  }

  /**
   * Get movement summary statistics
   */
  async getMovementSummary(params?: {
    company?: number;
    start_date?: string;
    end_date?: string;
  }): Promise<MovementSummary> {
    const response = await apiClient.get<MovementSummary>(
      `${MOVEMENT_ENDPOINT}summary/`,
      { params }
    );
    return response.data;
  }
}

// =============================================================================
// BOM / PRODUCTION SERVICE
// =============================================================================

class BillOfMaterialsService {
  async getAll(params?: {
    finished_product?: number;
    finished_product__brand__company?: number;
    is_active?: boolean;
    search?: string;
  }): Promise<BillOfMaterials[]> {
    const response = await apiClient.get<
      PaginatedResponse<BillOfMaterials> | BillOfMaterials[]
    >(BOM_ENDPOINT, { params });
    return unwrapList(response.data);
  }

  async getById(id: number): Promise<BillOfMaterials> {
    const response = await apiClient.get<BillOfMaterials>(`${BOM_ENDPOINT}${id}/`);
    return response.data;
  }

  async create(data: CreateBillOfMaterialsRequest): Promise<BillOfMaterials> {
    const response = await apiClient.post<BillOfMaterials>(BOM_ENDPOINT, data);
    return response.data;
  }

  async update(
    id: number,
    data: UpdateBillOfMaterialsRequest
  ): Promise<BillOfMaterials> {
    const response = await apiClient.patch<BillOfMaterials>(
      `${BOM_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  async delete(id: number): Promise<void> {
    await apiClient.delete(`${BOM_ENDPOINT}${id}/`);
  }
}

class ProductionBatchService {
  async getAll(params?: {
    sales_channel?: number;
    sales_channel__brand__company?: number;
    finished_product?: number;
    status?: string;
    search?: string;
  }): Promise<ProductionBatch[]> {
    const response = await apiClient.get<
      PaginatedResponse<ProductionBatch> | ProductionBatch[]
    >(PRODUCTION_BATCH_ENDPOINT, { params });
    return unwrapList(response.data);
  }

  async getById(id: number): Promise<ProductionBatch> {
    const response = await apiClient.get<ProductionBatch>(
      `${PRODUCTION_BATCH_ENDPOINT}${id}/`
    );
    return response.data;
  }

  async sendToFactory(data: SendToFactoryRequest): Promise<ProductionBatch> {
    const response = await apiClient.post<ProductionBatch>(
      PRODUCTION_BATCH_ENDPOINT,
      data
    );
    return response.data;
  }

  async receiveFromFactory(
    id: number,
    data: ReceiveFromFactoryRequest
  ): Promise<ProductionBatch> {
    const response = await apiClient.post<ProductionBatch>(
      `${PRODUCTION_BATCH_ENDPOINT}${id}/receive/`,
      data
    );
    return response.data;
  }

  async update(id: number, data: { notes?: string }): Promise<ProductionBatch> {
    const response = await apiClient.patch<ProductionBatch>(
      `${PRODUCTION_BATCH_ENDPOINT}${id}/`,
      data
    );
    return response.data;
  }

  async cancel(id: number, data?: { notes?: string }): Promise<ProductionBatch> {
    const response = await apiClient.post<ProductionBatch>(
      `${PRODUCTION_BATCH_ENDPOINT}${id}/cancel/`,
      data ?? {}
    );
    return response.data;
  }

  async delete(id: number, data?: { notes?: string }): Promise<ProductionBatch> {
    const response = await apiClient.delete<ProductionBatch>(
      `${PRODUCTION_BATCH_ENDPOINT}${id}/`,
      { data: data ?? {} }
    );
    return response.data;
  }

  async getInFactorySummary(params?: {
    company?: number;
    sales_channel?: number;
    component?: number;
  }): Promise<InFactorySummary[]> {
    const response = await apiClient.get<InFactorySummary[]>(
      `${PRODUCTION_BATCH_ENDPOINT}in_factory/`,
      { params }
    );
    return response.data;
  }
}

// Export service instances
export const storeInventoryService = new StoreInventoryService();
export const inventoryMovementService = new InventoryMovementService();
export const billOfMaterialsService = new BillOfMaterialsService();
export const productionBatchService = new ProductionBatchService();
