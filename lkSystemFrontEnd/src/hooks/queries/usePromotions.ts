import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  promotionService,
  type BulkCreatePromotionsRequest,
  type BulkCreatePromotionsResponse,
  type PromotionGroupQueryParams,
} from '@/services/promotion.service';
import type {
  CreatePromotionRequest,
  PromotionGroupDetail,
  PromotionGroupListItem,
  UpdatePromotionGroupRequest,
  UpdatePromotionRequest,
} from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────
export const promotionsKeys = {
  all: ['promotions'] as const,
  lists: () => [...promotionsKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...promotionsKeys.lists(), filters] as const,
  details: () => [...promotionsKeys.all, 'detail'] as const,
  detail: (id: number) => [...promotionsKeys.details(), id] as const,
  channelRules: (id: number) => [...promotionsKeys.detail(id), 'channelRules'] as const,
  analytics: (id: number) => [...promotionsKeys.detail(id), 'analytics'] as const,
  groups: (filters?: Record<string, unknown>) =>
    [...promotionsKeys.all, 'groups', filters ?? null] as const,
  group: (groupId: string) =>
    [...promotionsKeys.all, 'group', groupId] as const,
};

/**
 * Shared invalidator used by every promotion mutation.
 *
 * Invalidating ``promotionsKeys.all`` (``['promotions']``) is a prefix match,
 * so it marks every query whose key starts with ``['promotions', …]`` as
 * stale — lists, paginated lists, details, channel rules, analytics, the
 * campaign list (``groups``) and individual campaign detail (``group(id)``).
 *
 * Before this refactor, mutations invalidated only ``lists()`` which meant
 * the new campaign-centric Promotions page (``usePromotionGroups``) and the
 * campaign details dialog (``usePromotionGroup``) silently retained stale
 * data — e.g. deactivating a campaign would not flip its status badge until
 * the page was reloaded.
 */
function invalidatePromotions(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: promotionsKeys.all });
}

/**
 * Shared mutation key. ``POSPage`` subscribes to the mutation cache and
 * triggers ``refreshPOSProductCache`` whenever any mutation tagged with this
 * prefix succeeds, so the POS product cards stay in sync without manual
 * "Sync" clicks after activate / deactivate / create / update / delete.
 */
export const PROMOTION_MUTATION_KEY = ['promotions'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export function usePromotions() {
  return useQuery({
    queryKey: promotionsKeys.lists(),
    queryFn: () => promotionService.getAllPromotions(),
    staleTime: 3 * 60 * 1000,
  });
}

export function usePromotion(id: number) {
  return useQuery({
    queryKey: promotionsKeys.detail(id),
    queryFn: () => promotionService.getPromotionById(id),
    enabled: !!id,
  });
}

export function usePromotionChannelRules(id: number) {
  return useQuery({
    queryKey: promotionsKeys.channelRules(id),
    queryFn: () => promotionService.getChannelRules(id),
    enabled: !!id,
  });
}

export function usePromotionAnalytics() {
  return useQuery({
    queryKey: promotionsKeys.all,
    queryFn: () => promotionService.getAnalytics(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations — every onSuccess goes through ``invalidatePromotions`` so the
// Promotions page, details dialog, POS product grid and analytics widgets
// all stay in lock-step after any change.
// ─────────────────────────────────────────────────────────────────────────────

export function useCreatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'create'],
    mutationFn: (data: CreatePromotionRequest) => promotionService.createPromotion(data),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useUpdatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'update'],
    mutationFn: ({ id, data }: { id: number; data: UpdatePromotionRequest }) =>
      promotionService.updatePromotion(id, data),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useDeletePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'delete'],
    mutationFn: (id: number) => promotionService.deletePromotion(id),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useActivatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'activate'],
    mutationFn: (id: number) => promotionService.activatePromotion(id),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useDeactivatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'deactivate'],
    mutationFn: (id: number) => promotionService.deactivatePromotion(id),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useDuplicatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'duplicate'],
    mutationFn: (id: number) => promotionService.duplicatePromotion(id),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useCalculateDiscount() {
  // Pure RPC — doesn't mutate server state, so no invalidation.
  return useMutation({
    mutationFn: (data: { promotion_id: number; sales_channel_id: number; product_id: number }) =>
      promotionService.calculateDiscount(data),
  });
}

export function useBulkActivatePromotions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'bulk-activate'],
    mutationFn: (ids: number[]) => promotionService.bulkActivate(ids),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useBulkDeactivatePromotions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'bulk-deactivate'],
    mutationFn: (ids: number[]) => promotionService.bulkDeactivate(ids),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useBulkDeletePromotions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'bulk-delete'],
    mutationFn: (ids: number[]) => promotionService.bulkDelete(ids),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion groups (campaigns)
// ─────────────────────────────────────────────────────────────────────────────

export function usePromotionGroups(params?: PromotionGroupQueryParams) {
  return useQuery<PromotionGroupListItem[]>({
    queryKey: promotionsKeys.groups(params as Record<string, unknown> | undefined),
    queryFn: () => promotionService.getPromotionGroups(params),
    staleTime: 60_000,
  });
}

export function usePromotionGroup(groupId: string | null | undefined) {
  return useQuery<PromotionGroupDetail>({
    queryKey: promotionsKeys.group(groupId ?? ''),
    queryFn: () => promotionService.getPromotionGroupById(groupId as string),
    enabled: !!groupId,
  });
}

export function useUpdatePromotionGroup() {
  const queryClient = useQueryClient();
  return useMutation<
    PromotionGroupDetail,
    Error,
    { groupId: string; data: UpdatePromotionGroupRequest }
  >({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'update-group'],
    mutationFn: ({ groupId, data }) =>
      promotionService.updatePromotionGroup(groupId, data),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

export function useDeletePromotionGroup() {
  const queryClient = useQueryClient();
  return useMutation<{ deleted: number }, Error, string>({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'delete-group'],
    mutationFn: (groupId: string) =>
      promotionService.deletePromotionGroup(groupId),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}

/**
 * Bulk-create promotions — one row per product, all sharing the same name,
 * dates, channels and meta. Each item carries its own discount type/value.
 */
export function useBulkCreatePromotions() {
  const queryClient = useQueryClient();
  return useMutation<BulkCreatePromotionsResponse, Error, BulkCreatePromotionsRequest>({
    mutationKey: [...PROMOTION_MUTATION_KEY, 'bulk-create'],
    mutationFn: (payload: BulkCreatePromotionsRequest) =>
      promotionService.bulkCreate(payload),
    onSuccess: () => invalidatePromotions(queryClient),
  });
}
