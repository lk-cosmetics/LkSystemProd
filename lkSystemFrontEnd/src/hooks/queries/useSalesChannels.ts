import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { salesChannelService } from '@/services/salesChannel.service';
import type { SalesChannel, CreateSalesChannelRequest } from '@/types';

// Query Keys
export const salesChannelsKeys = {
  all: ['salesChannels'] as const,
  lists: () => [...salesChannelsKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...salesChannelsKeys.lists(), filters] as const,
  details: () => [...salesChannelsKeys.all, 'detail'] as const,
  detail: (id: number) => [...salesChannelsKeys.details(), id] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch all sales channels.
 * Polling is automatically paused while any sales-channel mutation is in-flight.
 */
export function useSalesChannels(enablePolling = true, pollingInterval = 30_000) {
  const isMutating = useIsMutating({ mutationKey: ['salesChannels'] });

  return useQuery({
    queryKey: salesChannelsKeys.lists(),
    queryFn: () => salesChannelService.getAllChannels(),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchInterval: enablePolling && isMutating === 0 ? pollingInterval : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });
}

/**
 * Fetch single sales channel by ID.
 */
export function useSalesChannel(id: number | null) {
  return useQuery({
    queryKey: salesChannelsKeys.detail(id!),
    queryFn: () => salesChannelService.getChannelById(id!),
    enabled: id != null && id > 0,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create new sales channel.
 */
export function useCreateSalesChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['salesChannels'],
    mutationFn: (data: CreateSalesChannelRequest) =>
      salesChannelService.createChannel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
    },
  });
}

/**
 * Full update sales channel.
 */
export function useUpdateSalesChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['salesChannels'],
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateSalesChannelRequest> }) =>
      salesChannelService.updateChannel(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: salesChannelsKeys.lists() });
      const previous = queryClient.getQueryData<SalesChannel[]>(salesChannelsKeys.lists());

      queryClient.setQueryData<SalesChannel[]>(salesChannelsKeys.lists(), (old = []) =>
        old.map(ch => (ch.id === id ? { ...ch, ...data } : ch)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(salesChannelsKeys.lists(), context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
    },
  });
}

/**
 * Partial update sales channel — with optimistic UI.
 */
export function usePartialUpdateSalesChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['salesChannels'],
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: Partial<CreateSalesChannelRequest & { is_active?: boolean }>;
    }) => salesChannelService.partialUpdateChannel(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: salesChannelsKeys.lists() });
      const previous = queryClient.getQueryData<SalesChannel[]>(salesChannelsKeys.lists());

      queryClient.setQueryData<SalesChannel[]>(salesChannelsKeys.lists(), (old = []) =>
        old.map(ch => (ch.id === id ? { ...ch, ...data } : ch)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(salesChannelsKeys.lists(), context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
    },
  });
}

/**
 * Delete sales channel — with optimistic removal.
 */
export function useDeleteSalesChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['salesChannels'],
    mutationFn: (id: number) => salesChannelService.deleteChannel(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: salesChannelsKeys.lists() });
      const previous = queryClient.getQueryData<SalesChannel[]>(salesChannelsKeys.lists());

      queryClient.setQueryData<SalesChannel[]>(salesChannelsKeys.lists(), (old = []) =>
        old.filter(ch => ch.id !== id),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(salesChannelsKeys.lists(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
    },
  });
}

/**
 * Regenerate webhook token for a WooCommerce channel.
 */
export function useRegenerateWebhook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['salesChannels'],
    mutationFn: (id: number) => salesChannelService.regenerateWebhook(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
    },
  });
}
