import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientService, type ClientListParams } from '@/services/client.service';
import type { Client, CreateClientRequest, PaginatedResponse } from '@/types';

// Query Keys
export const clientsKeys = {
  all: ['clients'] as const,
  lists: () => [...clientsKeys.all, 'list'] as const,
  list: (filters?: ClientListParams) => [...clientsKeys.lists(), filters] as const,
  details: () => [...clientsKeys.all, 'detail'] as const,
  detail: (id: number) => [...clientsKeys.details(), id] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch all clients with optional pagination and filtering.
 *
 * Pass ``{ enabled: false }`` to hold the query (e.g. a type-ahead search that
 * should only fire once the user has typed enough characters). Defaults to
 * enabled so existing callers are unaffected.
 */
export function useClients(
  params?: ClientListParams,
  options?: { enabled?: boolean }
) {
  return useQuery<PaginatedResponse<Client> | Client[]>({
    queryKey: clientsKeys.list(params),
    queryFn: () => clientService.getAll(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch single client by ID
 */
export function useClient(id: number) {
  return useQuery({
    queryKey: clientsKeys.detail(id),
    queryFn: () => clientService.getById(id),
    enabled: !!id,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create new client
 */
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateClientRequest) =>
      clientService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: clientsKeys.lists(),
      });
    },
  });
}

/**
 * Update client
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CreateClientRequest> }) =>
      clientService.update(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(clientsKeys.detail(data.id), data);
      queryClient.invalidateQueries({
        queryKey: clientsKeys.lists(),
      });
    },
  });
}

/**
 * Delete client
 */
export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => clientService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: clientsKeys.lists(),
      });
    },
  });
}

/**
 * Block/Unblock client
 */
export function useBlockClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, is_blocked, reason }: { id: number; is_blocked: boolean; reason?: string }) =>
      clientService.setBlocked(id, is_blocked, reason),
    onSuccess: (data: Client) => {
      queryClient.setQueryData(clientsKeys.detail(data.id), data);
      queryClient.invalidateQueries({
        queryKey: clientsKeys.lists(),
      });
    },
  });
}
