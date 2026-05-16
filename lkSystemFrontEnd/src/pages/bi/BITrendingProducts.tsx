import { memo } from 'react';
import {
  IconFlame,
  IconSparkles,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { BITrendingProducts as BITrending } from '@/services/bi.service';

import { BIPagination } from './BIPagination';
import { fmtMoney, fmtNumber, fmtPercent } from './utils';

interface Props {
  data: BITrending | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function growthBadge(growthPct: number | null) {
  if (growthPct === null) {
    return (
      <Badge className="gap-1 bg-blue-500/15 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300">
        <IconSparkles className="size-3.5" />
        New
      </Badge>
    );
  }
  if (growthPct >= 0) {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
        <IconTrendingUp className="size-3.5" />
        {fmtPercent(growthPct)}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <IconTrendingDown className="size-3.5" />
      {fmtPercent(growthPct)}
    </Badge>
  );
}

function BITrendingProductsImpl({
  data,
  isLoading,
  isFetching,
  isError,
  onRetry,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const rows = data?.results ?? [];
  const isEmpty = !isLoading && !isError && rows.length === 0;
  const skeletonCount = Math.max(3, Math.min(pageSize, 9));

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="flex flex-row items-start gap-2 space-y-0">
          <span className="mt-0.5 flex size-8 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <IconFlame className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">Trending products</CardTitle>
            <CardDescription>
              Biggest revenue growth versus the previous period.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pb-0">
          {isError ? (
            <div className="flex flex-col items-center gap-2 py-6 text-sm text-destructive">
              <span>Couldn't load trending products.</span>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-xs underline underline-offset-2"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : isLoading && rows.length === 0 ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-md" />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No trending products for the selected period.
            </div>
          ) : (
            <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r, idx) => (
                <li
                  key={r.product_id}
                  className="flex items-start gap-3 rounded-md border bg-card p-3"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {(page - 1) * pageSize + idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      {growthBadge(r.growth_pct)}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{fmtMoney(r.revenue)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {fmtNumber(r.quantity_sold)} sold
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>

        {data && !isError ? (
          <BIPagination
            count={data.count}
            page={data.page}
            pageSize={data.page_size}
            totalPages={data.total_pages}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            pageSizeOptions={[9, 18, 27, 36]}
            itemLabel="products"
            isFetching={isFetching}
          />
        ) : null}
      </Card>
    </div>
  );
}

export const BITrendingProducts = memo(BITrendingProductsImpl);
