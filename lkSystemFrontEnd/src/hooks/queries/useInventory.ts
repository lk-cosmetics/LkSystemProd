import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  storeInventoryService, 
  inventoryMovementService 
} from '@/services/inventory.service';
import type { 
  CreateSalesChannelInventoryRequest,
  UpdateSalesChannelInventoryRequest,
  AdjustSalesChannelInventoryRequest,
  CreateInventoryMovementRequest,
  CreateTransferRequest,
} from '@/types';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const storeInventoryKeys = {
  all: ['store-inventory'] as const,
  lists: () => [...storeInventoryKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...storeInventoryKeys.lists(), filters] as const,
  details: () => [...storeInventoryKeys.all, 'detail'] as const,
  detail: (id: number) => [...storeInventoryKeys.details(), id] as const,
  lowStock: () => [...storeInventoryKeys.all, 'low-stock'] as const,
  outOfStock: () => [...storeInventoryKeys.all, 'out-of-stock'] as const,
  byProduct: (productId: number) => [...storeInventoryKeys.all, 'by-product', productId] as const,
};

export const movementKeys = {
  all: ['movements'] as const,
  lists: () => [...movementKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...movementKeys.lists(), filters] as const,
  details: () => [...movementKeys.all, 'detail'] as const,
  detail: (id: number) => [...movementKeys.details(), id] as const,
  summary: (filters?: Record<string, unknown>) => [...movementKeys.all, 'summary', filters] as const,
};

// =============================================================================
// SALES CHANNEL INVENTORY QUERIES
// =============================================================================

export function useStoreInventories(params?: {
  sales_channel?: number;
  sales_channel__brand__company?: number;
  product?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: storeInventoryKeys.list(params),
    queryFn: () => storeInventoryService.getAllStoreInventories(params),
    staleTime: 2 * 60 * 1000, // 2 minutes (inventory changes frequently)
  });
}

export function useStoreInventoryDetail(id: number) {
  return useQuery({
    queryKey: storeInventoryKeys.detail(id),
    queryFn: () => storeInventoryService.getStoreInventoryById(id),
    enabled: !!id,
  });
}

export function useLowStockItems(companyId?: number) {
  return useQuery({
    queryKey: storeInventoryKeys.lowStock(),
    queryFn: () => storeInventoryService.getLowStockItems(companyId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useOutOfStockItems(companyId?: number) {
  return useQuery({
    queryKey: storeInventoryKeys.outOfStock(),
    queryFn: () => storeInventoryService.getOutOfStockItems(companyId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useProductInventorySummary(productId: number) {
  return useQuery({
    queryKey: storeInventoryKeys.byProduct(productId),
    queryFn: () => storeInventoryService.getProductInventorySummary(productId),
    enabled: !!productId,
  });
}

// =============================================================================
// STORE INVENTORY MUTATIONS
// =============================================================================

export function useCreateStoreInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSalesChannelInventoryRequest) => 
      storeInventoryService.createStoreInventory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.lists() });
    },
  });
}

export function useUpdateStoreInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateSalesChannelInventoryRequest }) =>
      storeInventoryService.updateStoreInventory(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.lists() });
    },
  });
}

export function useDeleteStoreInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => storeInventoryService.deleteStoreInventory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.lists() });
    },
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AdjustSalesChannelInventoryRequest }) =>
      storeInventoryService.adjustStock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: movementKeys.lists() });
      // Also refresh product data since stock_quantity updates
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// =============================================================================
// INVENTORY MOVEMENT QUERIES
// =============================================================================

export function useInventoryMovements(params?: {
  sales_channel?: number;
  product?: number;
  movement_type?: string;
  status?: string;
  company?: number;
  start_date?: string;
  end_date?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: movementKeys.list(params),
    queryFn: () => inventoryMovementService.getAllMovements(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useInventoryMovement(id: number) {
  return useQuery({
    queryKey: movementKeys.detail(id),
    queryFn: () => inventoryMovementService.getMovementById(id),
    enabled: !!id,
  });
}

export function useMovementSummary(params?: {
  company?: number;
  start_date?: string;
  end_date?: string;
}) {
  return useQuery({
    queryKey: movementKeys.summary(params),
    queryFn: () => inventoryMovementService.getMovementSummary(params),
    staleTime: 5 * 60 * 1000,
  });
}

// =============================================================================
// INVENTORY MOVEMENT MUTATIONS
// =============================================================================

export function useCreateInventoryMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInventoryMovementRequest) =>
      inventoryMovementService.createMovement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: movementKeys.lists() });
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCompleteMovement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) =>
      inventoryMovementService.completeMovement(id, notes),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: movementKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: movementKeys.lists() });
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransferRequest) =>
      inventoryMovementService.createTransfer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: movementKeys.lists() });
      queryClient.invalidateQueries({ queryKey: storeInventoryKeys.all });
    },
  });
}
