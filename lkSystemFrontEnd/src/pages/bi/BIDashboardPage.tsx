import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconChartLine, IconRefresh } from '@tabler/icons-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Input } from '@/components/ui/input';

import {
  biKeys,
  useBadProductsQuery,
  useDashboardSummaryQuery,
  useSalesChannelChartQuery,
  useSalesChannelRevenueQuery,
  useSalesChartQuery,
  useTopProductsQuery,
  useTrendingProductsQuery,
} from '@/hooks/queries/useBI';
import { isPlatformAdmin as isPlatformAdminUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import type { BIPeriod } from '@/services/bi.service';

import { BIBadProductsTable } from './BIBadProductsTable';
import { BICharts as RawBICharts } from './BICharts';
import { BIInsightsPanel } from './BIInsightsPanel';
import { BIKpiCards } from './BIKpiCards';
import { BIProductsTable } from './BIProductsTable';
import { BISalesChannelTable } from './BISalesChannelTable';
import { BITrendingProducts } from './BITrendingProducts';
import { PERIOD_OPTIONS, daysAgoInput, fmtLongDate, todayInput } from './utils';

// React.memo: charts have heavy series transforms; re-rendering them only
// when their *data* props change (not every keystroke / pagination tick on
// other sections) saves real CPU.
const BICharts = memo(RawBICharts);

export function BIDashboardPage() {
  const currentUser = useAuthStore(state => state.user);
  const isPlatformAdmin = isPlatformAdminUser(currentUser);

  // ── Filters ──────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<BIPeriod>('30d');
  // Custom-range state — only sent when ``period === 'custom'``. Default to
  // the last 30 days so the calendar opens on a useful window.
  const [startDate, setStartDate] = useState<string>(() => daysAgoInput(29));
  const [endDate, setEndDate] = useState<string>(() => todayInput());

  // Dashboard scope comes from the active workspace selected globally.
  // The page no longer has company/brand selectors, so all BI queries follow
  // the same company / brand focus shown in the app shell.
  const effectiveCompanyId = currentUser?.company_id ?? null;
  const effectiveBrandId = currentUser?.current_brand_id ?? null;
  const workspaceLabel = currentUser?.company_name
    ? `${currentUser.company_name}${effectiveBrandId ? ' - Active brand' : ' - All brands'}`
    : effectiveBrandId ? 'Active brand workspace' : 'Current workspace';

  // Validate the custom range strictly. The backend silently falls back to
  // 30d when ``start_date`` / ``end_date`` don't parse as ``YYYY-MM-DD``,
  // and the user typing a half-finished date in the input would otherwise
  // make the chart "snap back" to the wrong window mid-edit. We require:
  //  - both inputs filled,
  //  - both match ``YYYY-MM-DD`` exactly,
  //  - end >= start.
  // When invalid we both surface a message *and* keep React Query disabled
  // so no half-typed request reaches the API.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const customValid =
    period !== 'custom' ||
    (ISO_DATE.test(startDate) &&
      ISO_DATE.test(endDate) &&
      new Date(startDate) <= new Date(endDate));

  const filters = useMemo(
    () => ({
      companyId: effectiveCompanyId,
      brandId: effectiveBrandId,
      period,
      startDate: period === 'custom' ? startDate : null,
      endDate: period === 'custom' ? endDate : null,
    }),
    [effectiveCompanyId, effectiveBrandId, period, startDate, endDate],
  );

  // ── Pagination state — per table ────────────────────────────────────
  const [channelsPage, setChannelsPage] = useState(1);
  const [channelsSize, setChannelsSize] = useState(10);
  const [productsPage, setProductsPage] = useState(1);
  const [productsSize, setProductsSize] = useState(10);
  const [trendingPage, setTrendingPage] = useState(1);
  const [trendingSize, setTrendingSize] = useState(9);
  const [badPage, setBadPage] = useState(1);
  const [badSize, setBadSize] = useState(10);

  // Reset every table back to page 1 when filters change — otherwise we'd
  // ask for, say, page 7 of a brand that only has 2 pages of data. Includes
  // the custom date range so flipping start/end resets too.
  useEffect(() => {
    setChannelsPage(1);
    setProductsPage(1);
    setTrendingPage(1);
    setBadPage(1);
  }, [effectiveCompanyId, effectiveBrandId, period, startDate, endDate]);

  // ── Data ─────────────────────────────────────────────────────────────
  // BI follows the active workspace. Platform admins may intentionally have no
  // current company selected, which the backend treats as global scope.
  // Company-scoped users wait for their company from the auth identity.
  const enableQueries =
    (isPlatformAdmin || !!effectiveCompanyId) && customValid;
  const summaryQ      = useDashboardSummaryQuery(filters, enableQueries);
  const chartQ        = useSalesChartQuery(filters, enableQueries);
  const channelChartQ = useSalesChannelChartQuery(filters, enableQueries);
  const channelsQ     = useSalesChannelRevenueQuery(filters, channelsPage, channelsSize, enableQueries);
  const topProductsQ  = useTopProductsQuery(filters, productsPage, productsSize, enableQueries);
  const trendingQ     = useTrendingProductsQuery(filters, trendingPage, trendingSize, enableQueries);
  const badProductsQ  = useBadProductsQuery(filters, badPage, badSize, enableQueries);

  // First-paint "no data yet" state. After that the placeholderData keeps
  // the previous payload visible, so we don't flash skeletons on refetch.
  const initialLoading =
    (summaryQ.isLoading && !summaryQ.data) ||
    (chartQ.isLoading && !chartQ.data) ||
    (channelChartQ.isLoading && !channelChartQ.data);

  const isFetchingBI = useIsFetching({ queryKey: biKeys.all }) > 0;
  const queryClient = useQueryClient();
  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: biKeys.all });
  }, [queryClient]);

  const allErrored =
    summaryQ.isError &&
    chartQ.isError &&
    channelChartQ.isError &&
    channelsQ.isError &&
    topProductsQ.isError &&
    trendingQ.isError &&
    badProductsQ.isError;

  return (
    <div className="flex flex-1 flex-col gap-4 py-4 @container/main">
      {/* Header */}
      <div className="flex flex-col gap-3 px-4 pb-2 lg:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconChartLine className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Executive dashboard</h1>
            <Badge variant="secondary" className="text-[10px]">Live</Badge>
          </div>
          {summaryQ.data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {fmtLongDate(summaryQ.data.period_start)} – {fmtLongDate(summaryQ.data.period_end)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Near real-time view, refreshes every 30 s while the tab is active.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="h-6 rounded-md px-2 text-[11px] font-normal">
              {workspaceLabel}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Period</label>
            <Select value={period} onValueChange={v => setPeriod(v as BIPeriod)}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {period === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-9 w-[160px]"
                  aria-label="Custom range start date"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  max={todayInput()}
                  onChange={e => setEndDate(e.target.value)}
                  className="h-9 w-[160px]"
                  aria-label="Custom range end date"
                />
              </div>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 self-end"
            onClick={refetchAll}
            disabled={isFetchingBI}
            aria-label="Refresh dashboard"
          >
            <IconRefresh className={`size-4 ${isFetchingBI ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/*
        Empty-state logic:
        - A CEO / company-scoped user without a tenant gets a "contact admin"
          message — this is a configuration problem, not a UX one.
        - A platform admin may intentionally have no company in the active
          workspace; the backend treats that as global BI scope.
        - When the user picks ``custom`` with an invalid range we tell them
          why nothing's rendering rather than firing useless requests.
      */}
      {!isPlatformAdmin && !effectiveCompanyId ? (
        <div className="px-4 lg:px-6">
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            You don't have any company assigned yet. Please contact your administrator.
          </div>
        </div>
      ) : period === 'custom' && !customValid ? (
        <div className="px-4 lg:px-6">
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Pick a valid date range — the end date must be on or after the start date.
          </div>
        </div>
      ) : allErrored && !initialLoading ? (
        <div className="px-4 lg:px-6">
          <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-8 text-center text-destructive">
            <IconAlertTriangle className="size-6" />
            <p className="text-sm font-medium">Dashboard is unreachable.</p>
            <Button variant="outline" size="sm" onClick={refetchAll}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <>
          <BIKpiCards summary={summaryQ.data} isLoading={initialLoading} />

          <BICharts
            chart={chartQ.data}
            channelChart={channelChartQ.data}
            channelRevenue={channelsQ.data}
            isLoading={initialLoading}
          />

          <BISalesChannelTable
            data={channelsQ.data}
            isLoading={channelsQ.isLoading}
            isFetching={channelsQ.isFetching}
            isError={channelsQ.isError && !channelsQ.data}
            onRetry={() => channelsQ.refetch()}
            page={channelsPage}
            pageSize={channelsSize}
            onPageChange={setChannelsPage}
            onPageSizeChange={size => {
              setChannelsSize(size);
              setChannelsPage(1);
            }}
          />

          <BIProductsTable
            data={topProductsQ.data}
            isLoading={topProductsQ.isLoading}
            isFetching={topProductsQ.isFetching}
            isError={topProductsQ.isError && !topProductsQ.data}
            onRetry={() => topProductsQ.refetch()}
            page={productsPage}
            pageSize={productsSize}
            onPageChange={setProductsPage}
            onPageSizeChange={size => {
              setProductsSize(size);
              setProductsPage(1);
            }}
          />

          <BIBadProductsTable
            data={badProductsQ.data}
            isLoading={badProductsQ.isLoading}
            isFetching={badProductsQ.isFetching}
            isError={badProductsQ.isError && !badProductsQ.data}
            onRetry={() => badProductsQ.refetch()}
            page={badPage}
            pageSize={badSize}
            onPageChange={setBadPage}
            onPageSizeChange={size => {
              setBadSize(size);
              setBadPage(1);
            }}
          />

          <BITrendingProducts
            data={trendingQ.data}
            isLoading={trendingQ.isLoading}
            isFetching={trendingQ.isFetching}
            isError={trendingQ.isError && !trendingQ.data}
            onRetry={() => trendingQ.refetch()}
            page={trendingPage}
            pageSize={trendingSize}
            onPageChange={setTrendingPage}
            onPageSizeChange={size => {
              setTrendingSize(size);
              setTrendingPage(1);
            }}
          />

          {/* Decision support always at the bottom of the page. */}
          <BIInsightsPanel summary={summaryQ.data} isLoading={initialLoading} />
        </>
      )}
    </div>
  );
}

export default BIDashboardPage;
