/**
 * React Query hooks for the BI dashboard.
 *
 * - 30s polling for near-real-time updates (no WebSockets).
 * - Polling is paused while the document is hidden (`refetchIntervalInBackground: false`
 *   plus a function-based interval that returns `false` when the page is not visible),
 *   and re-fires the moment the tab regains focus (`refetchOnWindowFocus: true`).
 * - `enabled` keeps queries idle until the user has picked a brand/period.
 * - Query keys include filters + pagination so changing any of them refetches
 *   the right slice; `placeholderData: prev => prev` keeps the previous payload
 *   visible during the refetch so there's no flicker on filter / page change.
 */

import { useQuery, type QueryKey } from '@tanstack/react-query';

import {
  biService,
  type BIBrand,
  type BICompany,
  type BIFilters,
  type BIPeriod,
  type BISalesChannelChart,
  type BISalesChannelRevenue,
  type BISalesChart,
  type BISummary,
  type BITopProducts,
  type BITrendingProducts,
} from '@/services/bi.service';

/**
 * Cache key prefix shared by every dashboard query — pulling start/end into
 * the key means flipping to ``custom`` mode or shifting either date triggers
 * a refetch, while predefined periods (``startDate``/``endDate`` left null)
 * still produce the same key shape as before this feature.
 */
const filterKey = (f: BIFilters) =>
  [
    f.companyId ?? null,
    f.brandId ?? null,
    f.period ?? '30d',
    f.period === 'custom' ? f.startDate ?? null : null,
    f.period === 'custom' ? f.endDate ?? null : null,
  ] as const;

export const biKeys = {
  all: ['bi'] as const,
  companies: () => [...biKeys.all, 'companies'] as const,
  brands: (companyId?: number | null) => [...biKeys.all, 'brands', companyId ?? null] as const,
  summary: (f: BIFilters) => [...biKeys.all, 'summary', ...filterKey(f)] as const,
  salesChart: (f: BIFilters) => [...biKeys.all, 'sales-chart', ...filterKey(f)] as const,
  salesChannels: (f: BIFilters, page: number, pageSize: number) =>
    [...biKeys.all, 'sales-channels', ...filterKey(f), page, pageSize] as const,
  salesChannelChart: (f: BIFilters) =>
    [...biKeys.all, 'sales-channel-chart', ...filterKey(f)] as const,
  topProducts: (f: BIFilters, page: number, pageSize: number) =>
    [...biKeys.all, 'top-products', ...filterKey(f), page, pageSize] as const,
  badProducts: (f: BIFilters, page: number, pageSize: number) =>
    [...biKeys.all, 'bad-products', ...filterKey(f), page, pageSize] as const,
  trendingProducts: (f: BIFilters, page: number, pageSize: number) =>
    [...biKeys.all, 'trending-products', ...filterKey(f), page, pageSize] as const,
};

// Poll every 30 s as a near-real-time update channel. Cache invalidation on
// the backend keeps things fresh between polls when orders change.
const POLL_INTERVAL_MS = 30_000;

/** Returns the poll interval only while the document is visible — otherwise pauses. */
function visibilityAwareInterval() {
  if (typeof document !== 'undefined' && document.hidden) return false as const;
  return POLL_INTERVAL_MS;
}

/** Shared options for every polling query on the BI dashboard. */
const POLLING_DEFAULTS = {
  refetchInterval: visibilityAwareInterval,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 15_000,
  // Smoothes filter / pagination switches: keep the previous payload while
  // the new key is loading so the table doesn't collapse to a skeleton.
  placeholderData: <T,>(prev: T | undefined) => prev,
};

export function useCompaniesQuery(enabled = true) {
  return useQuery<BICompany[]>({
    queryKey: biKeys.companies(),
    queryFn: () => biService.getCompanies(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useBrandsQuery(companyId?: number | null, enabled = true) {
  return useQuery<BIBrand[]>({
    queryKey: biKeys.brands(companyId ?? null),
    queryFn: () => biService.getBrands(companyId ?? undefined),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDashboardSummaryQuery(filters: BIFilters, enabled = true) {
  return useQuery<BISummary>({
    queryKey: biKeys.summary(filters) as QueryKey,
    queryFn: () => biService.getSummary(filters),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useSalesChartQuery(filters: BIFilters, enabled = true) {
  return useQuery<BISalesChart>({
    queryKey: biKeys.salesChart(filters) as QueryKey,
    queryFn: () => biService.getSalesChart(filters),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useSalesChannelChartQuery(filters: BIFilters, enabled = true) {
  return useQuery<BISalesChannelChart>({
    queryKey: biKeys.salesChannelChart(filters) as QueryKey,
    queryFn: () => biService.getSalesChannelChart(filters),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useSalesChannelRevenueQuery(
  filters: BIFilters,
  page = 1,
  pageSize = 10,
  enabled = true,
) {
  return useQuery<BISalesChannelRevenue>({
    queryKey: biKeys.salesChannels(filters, page, pageSize) as QueryKey,
    queryFn: () => biService.getSalesChannelRevenue(filters, page, pageSize),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useTopProductsQuery(
  filters: BIFilters,
  page = 1,
  pageSize = 10,
  enabled = true,
) {
  return useQuery<BITopProducts>({
    queryKey: biKeys.topProducts(filters, page, pageSize) as QueryKey,
    queryFn: () => biService.getTopProducts(filters, page, pageSize),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useBadProductsQuery(
  filters: BIFilters,
  page = 1,
  pageSize = 10,
  enabled = true,
) {
  return useQuery<BITopProducts>({
    queryKey: biKeys.badProducts(filters, page, pageSize) as QueryKey,
    queryFn: () => biService.getBadProducts(filters, page, pageSize),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export function useTrendingProductsQuery(
  filters: BIFilters,
  page = 1,
  pageSize = 9,
  enabled = true,
) {
  return useQuery<BITrendingProducts>({
    queryKey: biKeys.trendingProducts(filters, page, pageSize) as QueryKey,
    queryFn: () => biService.getTrendingProducts(filters, page, pageSize),
    enabled,
    ...POLLING_DEFAULTS,
  });
}

export type { BIPeriod };
