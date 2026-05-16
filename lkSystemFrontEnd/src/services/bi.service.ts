/**
 * BI Dashboard service.
 *
 * Wraps the /api/v1/dashboard/ endpoints. Only Super Admin and CEO users
 * can call these — the backend enforces it via the `view_bi_dashboard`
 * permission and tenant scoping.
 */

import { apiClient } from './axios';

const BI_ENDPOINT = '/api/v1/dashboard/';

export type BIPeriod = '7d' | '30d' | '3m' | 'ytd' | 'custom';

export interface BICompany {
  id: number;
  name: string;
  abbreviation: string | null;
}

export interface BIBrand {
  id: number;
  name: string;
  company_id: number;
  company_name: string | null;
}

export interface BIPreviousTotals {
  total_revenue: string;
  orders_count: number;
  customers_count: number;
  average_order_value: string;
}

export interface BIGrowth {
  revenue: number;
  orders: number;
  customers: number;
  average_order_value: number;
}

export interface BIInsightWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface BIInsights {
  best_channel: 'Website' | 'POS' | null;
  channel_concentration_pct: number;
  brand_health: 'healthy' | 'warning' | 'critical';
  warnings: BIInsightWarning[];
}

export interface BISummary {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  previous_period_start: string;
  previous_period_end: string;
  total_revenue: string;
  orders_count: number;
  customers_count: number;
  average_order_value: string;
  website_revenue: string;
  pos_revenue: string;
  previous: BIPreviousTotals;
  growth: BIGrowth;
  insights: BIInsights;
}

export interface BIChartPoint {
  date: string;
  revenue: string;
  orders_count: number;
  website_revenue: string;
  pos_revenue: string;
}

export interface BISalesChart {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  series: BIChartPoint[];
}

export interface BIPagedMeta {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface BISalesChannelChartMeta {
  id: number;
  key: string;            // e.g. "ch_42"
  name: string;
  code: string;
  channel_type: string;
  channel_bucket: 'Website' | 'POS' | 'Other';
  brand_name: string | null;
}

export interface BISalesChannelChart {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  channels: BISalesChannelChartMeta[];
  /** Wide-format rows: { date: '2026-05-15', ch_1: 123.45, ch_2: 0, ... } */
  series: Array<Record<string, string | number>>;
}

export interface BIProductRow {
  product_id: number;
  name: string;
  barcode: string | null;
  product_type: string;
  sales_count: number;
  quantity_sold: number;
  revenue: string;
}

export interface BITopProducts extends BIPagedMeta {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  results: BIProductRow[];
}

export interface BITrendingProductRow extends BIProductRow {
  previous_revenue: string;
  /** null means "new" — no prior baseline. */
  growth_pct: number | null;
}

export interface BITrendingProducts extends BIPagedMeta {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  previous_period_start: string;
  previous_period_end: string;
  results: BITrendingProductRow[];
}

export interface BISalesChannelRow {
  sales_channel_id: number;
  name: string;
  code: string;
  channel_type: 'WOOCOMMERCE' | 'POS' | 'WEB' | string;
  channel_bucket: 'Website' | 'POS' | 'Other';
  brand_id: number | null;
  brand_name: string | null;
  revenue: string;
  orders_count: number;
  share_pct: number;
}

export interface BISalesChannelRevenue extends BIPagedMeta {
  period: BIPeriod;
  period_start: string;
  period_end: string;
  total_revenue: string;
  results: BISalesChannelRow[];
}

export interface BIFilters {
  companyId?: number | null;
  brandId?: number | null;
  period?: BIPeriod;
  /** ``YYYY-MM-DD``. Only sent when ``period === 'custom'``. */
  startDate?: string | null;
  endDate?: string | null;
}

function buildParams(filters: BIFilters | undefined) {
  const params: Record<string, string | number> = {};
  if (filters?.companyId) params.company_id = filters.companyId;
  if (filters?.brandId) params.brand_id = filters.brandId;
  if (filters?.period) params.period = filters.period;
  if (filters?.period === 'custom') {
    if (filters.startDate) params.start_date = filters.startDate;
    if (filters.endDate) params.end_date = filters.endDate;
  }
  return params;
}

class BIService {
  async getCompanies(): Promise<BICompany[]> {
    const { data } = await apiClient.get<BICompany[]>(`${BI_ENDPOINT}companies/`);
    return data;
  }

  async getBrands(companyId?: number | null): Promise<BIBrand[]> {
    const params = companyId ? { company_id: companyId } : {};
    const { data } = await apiClient.get<BIBrand[]>(`${BI_ENDPOINT}brands/`, { params });
    return data;
  }

  async getSummary(filters: BIFilters): Promise<BISummary> {
    const { data } = await apiClient.get<BISummary>(`${BI_ENDPOINT}summary/`, {
      params: buildParams(filters),
    });
    return data;
  }

  async getSalesChart(filters: BIFilters): Promise<BISalesChart> {
    const { data } = await apiClient.get<BISalesChart>(`${BI_ENDPOINT}sales-chart/`, {
      params: buildParams(filters),
    });
    return data;
  }

  async getSalesChannelChart(filters: BIFilters): Promise<BISalesChannelChart> {
    const { data } = await apiClient.get<BISalesChannelChart>(
      `${BI_ENDPOINT}sales-channel-chart/`,
      { params: buildParams(filters) },
    );
    return data;
  }

  async getTopProducts(
    filters: BIFilters,
    page = 1,
    pageSize = 10,
  ): Promise<BITopProducts> {
    const params = { ...buildParams(filters), page, page_size: pageSize };
    const { data } = await apiClient.get<BITopProducts>(
      `${BI_ENDPOINT}top-products/`,
      { params },
    );
    return data;
  }

  /**
   * Worst-selling products in the period — only ones that *did* sell, ordered
   * by revenue ascending. Same shape as ``getTopProducts``.
   */
  async getBadProducts(
    filters: BIFilters,
    page = 1,
    pageSize = 10,
  ): Promise<BITopProducts> {
    const params = { ...buildParams(filters), page, page_size: pageSize };
    const { data } = await apiClient.get<BITopProducts>(
      `${BI_ENDPOINT}bad-products/`,
      { params },
    );
    return data;
  }

  async getTrendingProducts(
    filters: BIFilters,
    page = 1,
    pageSize = 9,
  ): Promise<BITrendingProducts> {
    const params = { ...buildParams(filters), page, page_size: pageSize };
    const { data } = await apiClient.get<BITrendingProducts>(
      `${BI_ENDPOINT}trending-products/`,
      { params },
    );
    return data;
  }

  async getSalesChannelRevenue(
    filters: BIFilters,
    page = 1,
    pageSize = 10,
  ): Promise<BISalesChannelRevenue> {
    const params = { ...buildParams(filters), page, page_size: pageSize };
    const { data } = await apiClient.get<BISalesChannelRevenue>(
      `${BI_ENDPOINT}sales-channel-revenue/`,
      { params },
    );
    return data;
  }
}

export const biService = new BIService();
