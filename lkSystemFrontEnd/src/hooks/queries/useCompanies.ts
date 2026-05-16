import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { companyService } from '@/services/company.service';
import type { CompanyListItem, CreateCompanyRequest } from '@/types';

// Query Keys
export const companiesKeys = {
  all: ['companies'] as const,
  lists: () => [...companiesKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...companiesKeys.lists(), filters] as const,
  details: () => [...companiesKeys.all, 'detail'] as const,
  detail: (id: number) => [...companiesKeys.details(), id] as const,
};

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Fetch all companies (lightweight list data).
 * Polling is automatically paused while any company mutation is in-flight.
 */
export function useCompanies(enablePolling = true, pollingInterval = 30000) {
  const isMutating = useIsMutating({ mutationKey: ['companies'] });

  return useQuery({
    queryKey: companiesKeys.lists(),
    queryFn: () => companyService.getAllCompanies(),
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
 * Fetch single company by ID (full detail data including all fields).
 */
export function useCompany(id: number | null) {
  return useQuery({
    queryKey: companiesKeys.detail(id!),
    queryFn: () => companyService.getCompanyById(id!),
    enabled: id != null && id > 0,
  });
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create new company
 */
export function useCreateCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['companies'],
    mutationFn: (data: CreateCompanyRequest) => companyService.createCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKeys.lists() });
    },
  });
}

/**
 * Update existing company
 */
export function useUpdateCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['companies'],
    mutationFn: ({ id, data }: { id: number; data: CreateCompanyRequest }) =>
      companyService.updateCompany(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: companiesKeys.lists() });
      const previousCompanies = queryClient.getQueryData<CompanyListItem[]>(companiesKeys.lists());
      const { logo: _logo, ...safePatch } = data;

      queryClient.setQueryData<CompanyListItem[]>(companiesKeys.lists(), (old = []) =>
        old.map((company) => (company.id === id ? { ...company, ...safePatch } : company))
      );

      return { previousCompanies };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousCompanies) {
        queryClient.setQueryData(companiesKeys.lists(), context.previousCompanies);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: companiesKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: companiesKeys.lists() });
    },
  });
}

/**
 * Partial update existing company
 */
export function usePartialUpdateCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['companies'],
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateCompanyRequest> }) =>
      companyService.partialUpdateCompany(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: companiesKeys.lists() });
      const previousCompanies = queryClient.getQueryData<CompanyListItem[]>(companiesKeys.lists());
      const { logo: _logo, ...safePatch } = data;

      queryClient.setQueryData<CompanyListItem[]>(companiesKeys.lists(), (old = []) =>
        old.map((company) => (company.id === id ? { ...company, ...safePatch } : company))
      );

      return { previousCompanies };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousCompanies) {
        queryClient.setQueryData(companiesKeys.lists(), context.previousCompanies);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: companiesKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: companiesKeys.lists() });
    },
  });
}

/**
 * Delete company
 */
export function useDeleteCompany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['companies'],
    mutationFn: (id: number) => companyService.deleteCompany(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKeys.lists() });
    },
  });
}
