import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { categoryService } from '@/services/category.service';
import type { CreateCategoryRequest, UpdateCategoryRequest } from '@/types';

// Query Keys
export const categoriesKeys = {
  all: ['categories'] as const,
  lists: () => [...categoriesKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...categoriesKeys.lists(), filters] as const,
  details: () => [...categoriesKeys.all, 'detail'] as const,
  detail: (id: number) => [...categoriesKeys.details(), id] as const,
  tree: () => [...categoriesKeys.all, 'tree'] as const,
  bySalesChannel: (salesChannelId: number) => [...categoriesKeys.all, 'salesChannel', salesChannelId] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch all categories
 */
export function useCategories() {
  return useQuery({
    queryKey: categoriesKeys.lists(),
    queryFn: () => categoryService.getAllCategories(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Fetch single category by ID
 */
export function useCategory(id: number) {
  return useQuery({
    queryKey: categoriesKeys.detail(id),
    queryFn: () => categoryService.getCategoryById(id),
    enabled: !!id,
  });
}

/**
 * Products in this category. Enabled-gated so it only fires while the category
 * detail panel is open.
 */
export function useCategoryProducts(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: [...categoriesKeys.detail(id ?? 0), 'products'],
    queryFn: () => categoryService.getCategoryProducts(id as number, { page_size: 50 }),
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * Fetch category tree
 */
export function useCategoryTree() {
  return useQuery({
    queryKey: categoriesKeys.tree(),
    queryFn: () => categoryService.getCategoryTree(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch categories by sales channel
 */
export function useCategoriesBySalesChannel(salesChannelId: number) {
  return useQuery({
    queryKey: categoriesKeys.bySalesChannel(salesChannelId),
    queryFn: () => categoryService.getCategoriesBySalesChannel(salesChannelId),
    enabled: !!salesChannelId,
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create new category
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCategoryRequest | FormData) => categoryService.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Update existing category
 */
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCategoryRequest | FormData }) =>
      categoryService.updateCategory(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Partial update existing category
 */
export function usePartialUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<UpdateCategoryRequest> }) =>
      categoryService.partialUpdateCategory(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Delete category
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => categoryService.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Bulk delete categories
 */
export function useBulkDeleteCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(
        ids.map(id => categoryService.deleteCategory(id))
      );
      
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const errorCount = results.filter(r => r.status === 'rejected').length;
      
      return { successCount, errorCount, total: ids.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Sync categories from WooCommerce
 */
export function useSyncCategoriesFromWooCommerce() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (salesChannelId?: number) => 
      categoryService.syncFromWooCommerce(salesChannelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}

/**
 * Preview categories from WooCommerce
 */
export function usePreviewCategoriesFromWooCommerce() {
  return useMutation({
    mutationFn: (salesChannelId: number) => 
      categoryService.previewFromWooCommerce(salesChannelId),
  });
}

/**
 * Sync selected categories from WooCommerce
 */
export function useSyncSelectedCategoriesFromWooCommerce() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ salesChannelId, wcCategoryIds }: { salesChannelId: number; wcCategoryIds: number[] }) => 
      categoryService.syncSelectedFromWooCommerce(salesChannelId, wcCategoryIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKeys.lists() });
      queryClient.invalidateQueries({ queryKey: categoriesKeys.tree() });
    },
  });
}
