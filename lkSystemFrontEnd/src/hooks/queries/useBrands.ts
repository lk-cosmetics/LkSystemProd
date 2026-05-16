import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brandService } from '@/services/brand.service';
import type { CreateBrandRequest } from '@/types';

// Query Keys
export const brandsKeys = {
  all: ['brands'] as const,
  lists: () => [...brandsKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...brandsKeys.lists(), filters] as const,
  details: () => [...brandsKeys.all, 'detail'] as const,
  detail: (id: number) => [...brandsKeys.details(), id] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch all brands
 */
export function useBrands() {
  return useQuery({
    queryKey: brandsKeys.lists(),
    queryFn: () => brandService.getAllBrands(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Fetch single brand by ID
 */
export function useBrand(id: number) {
  return useQuery({
    queryKey: brandsKeys.detail(id),
    queryFn: () => brandService.getBrandById(id),
    enabled: !!id,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create new brand
 */
export function useCreateBrand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBrandRequest) => brandService.createBrand(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandsKeys.lists() });
    },
  });
}

/**
 * Update existing brand
 */
export function useUpdateBrand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CreateBrandRequest }) =>
      brandService.updateBrand(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: brandsKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: brandsKeys.lists() });
    },
  });
}

/**
 * Partial update existing brand
 */
export function usePartialUpdateBrand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateBrandRequest> }) =>
      brandService.partialUpdateBrand(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: brandsKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: brandsKeys.lists() });
    },
  });
}

/**
 * Delete brand
 */
export function useDeleteBrand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => brandService.deleteBrand(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandsKeys.lists() });
    },
  });
}
