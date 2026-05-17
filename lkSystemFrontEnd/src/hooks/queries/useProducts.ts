  import {
    useQuery,
    useMutation,
    useQueryClient,
    keepPreviousData,
    useInfiniteQuery,
    type InfiniteData,
  } from '@tanstack/react-query';
  import { productService } from '@/services/product.service';
  import type {
    CreateProductRequest,
    UpdateProductRequest,
    PaginatedResponse,
    ProductListItem,
  } from '@/types';

  // Query Keys
  export const productsKeys = {
    all: ['products'] as const,
    lists: () => [...productsKeys.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) => [...productsKeys.lists(), filters] as const,
    infinite: (filters?: Record<string, unknown>) => [...productsKeys.all, 'infinite', filters] as const,
    details: () => [...productsKeys.all, 'detail'] as const,
    detail: (id: number) => [...productsKeys.details(), id] as const,
    packStock: (id: number) => [...productsKeys.all, 'pack-stock', id] as const,
  };

  type ProductsInfinitePageParam = {
    page?: number;
    offset?: number;
  };

  // ============================================================================
  // QUERIES
  // ============================================================================

  export function useProducts(enabled = true) {
    return useQuery({
      queryKey: productsKeys.lists(),
      queryFn: () => productService.getAllProducts(),
      staleTime: 5 * 60 * 1000,
      enabled,
    });
  }

  export function useProductsPaginated(params: {
    page?: number;
    page_size?: number;
    limit?: number;
    offset?: number;
    search?: string;
    brand?: number;
    status?: 'publish' | 'draft' | 'pending' | 'private';
    product_type?: string;
    ordering?: string;
    show_deleted?: boolean;
    only_deleted?: boolean;
  }) {
    return useQuery({
      queryKey: productsKeys.list(params as Record<string, unknown>),
      queryFn: () => productService.getProductsPaginated(params),
      staleTime: 30 * 1000,
      placeholderData: keepPreviousData,
    });
  }

  export function useInfiniteProducts(params: {
    page_size?: number;
    limit?: number;
    offset?: number;
    search?: string;
    brand?: number;
    status?: 'publish' | 'draft' | 'pending' | 'private';
    product_type?: 'resell' | 'packaging';
    ordering?: string;
    enabled?: boolean;
  }) {
    const resolveNextPageParam = (
      nextUrl: string | null
    ): ProductsInfinitePageParam | undefined => {
      if (!nextUrl) return undefined;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(nextUrl, window.location.origin);
      } catch {
        return undefined;
      }
      const page = parsedUrl.searchParams.get('page');
      if (page) return { page: Number(page) };
      const offset = parsedUrl.searchParams.get('offset');
      if (offset) return { offset: Number(offset) };
      return undefined;
    };

    const { enabled = true, ...queryParams } = params;

    return useInfiniteQuery<
      PaginatedResponse<ProductListItem>,
      Error,
      InfiniteData<PaginatedResponse<ProductListItem>, ProductsInfinitePageParam>,
      ReturnType<typeof productsKeys.infinite>,
      ProductsInfinitePageParam
    >({
      queryKey: productsKeys.infinite(queryParams),
      queryFn: async ({ pageParam = { page: 1 } }) => {
        return productService.getProductsPaginated({
          ...queryParams,
          ...(pageParam.page !== undefined ? { page: pageParam.page } : {}),
          ...(pageParam.offset !== undefined ? { offset: pageParam.offset } : {}),
        });
      },
      initialPageParam: { page: 1 },
      getNextPageParam: (lastPage) => resolveNextPageParam(lastPage.next),
      staleTime: 30 * 1000,
      enabled,
    });
  }

  export function useProduct(id: number) {
    return useQuery({
      queryKey: productsKeys.detail(id),
      queryFn: () => productService.getProductById(id),
      enabled: !!id,
    });
  }

  export function usePackStock(productId: number, enabled = true) {
    return useQuery({
      queryKey: productsKeys.packStock(productId),
      queryFn: () => productService.getPackStock(productId),
      enabled: enabled && !!productId,
      staleTime: 30 * 1000,
    });
  }

  // ============================================================================
  // MUTATIONS
  // ============================================================================

  export function useCreateProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (data: CreateProductRequest) => productService.createProduct(data),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useUpdateProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }: { id: number; data: UpdateProductRequest }) =>
        productService.updateProduct(id, data),
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: productsKeys.detail(variables.id) });
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function usePartialUpdateProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }: { id: number; data: Partial<UpdateProductRequest> }) =>
        productService.partialUpdateProduct(id, data),
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: productsKeys.detail(variables.id) });
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useDeleteProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: number) => productService.deleteProduct(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useHardDeleteProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: number) => productService.hardDeleteProduct(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useBulkDeleteProducts() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (ids: number[]) => {
        const results = await Promise.allSettled(
          ids.map(id => productService.deleteProduct(id)),
        );
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.filter(r => r.status === 'rejected').length;
        return { successCount, errorCount, total: ids.length };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useBulkHardDeleteProducts() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (ids: number[]) => {
        const results = await Promise.allSettled(
          ids.map(id => productService.hardDeleteProduct(id)),
        );
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.filter(r => r.status === 'rejected').length;
        return { successCount, errorCount, total: ids.length };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  /**
   * Change ``status`` (publish / draft / pending / private) on many
   * products at once. Invalidates every list+detail query so any open
   * grid, picker, or BI panel sees the new values without a manual
   * refetch.
   */
  export function useBulkChangeProductStatus() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (vars: {
        ids: number[];
        status: 'publish' | 'draft' | 'pending' | 'private';
      }) => productService.bulkChangeStatus(vars.ids, vars.status),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  /**
   * Upload a CSV and upsert products by barcode. Invalidates the
   * products cache so every list re-fetches after the upload finishes.
   */
  export function useImportProductsCSV() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (file: File) => productService.importCSV(file),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useBulkRestoreProducts() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (ids: number[]) => {
        const results = await Promise.allSettled(
          ids.map(id => productService.restoreProduct(id)),
        );
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.filter(r => r.status === 'rejected').length;
        return { successCount, errorCount, total: ids.length };
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useRestoreProduct() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: number) => productService.restoreProduct(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function useSyncProductsFromWooCommerce() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (salesChannelId: number) =>
        productService.syncFromWooCommerce(salesChannelId),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }

  export function usePreviewProductsFromWooCommerce() {
    return useMutation({
      mutationFn: (salesChannelId: number) =>
        productService.previewFromWooCommerce(salesChannelId),
    });
  }

  export function useSyncSelectedProductsFromWooCommerce() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ salesChannelId, wcProductIds }: { salesChannelId: number; wcProductIds: number[] }) =>
        productService.syncSelectedFromWooCommerce(salesChannelId, wcProductIds),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: productsKeys.all });
      },
    });
  }
