import { memo } from 'react';
import { IconBuildingStore, IconWorld } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type {
  BISalesChannelRevenue,
  BISalesChannelRow,
} from '@/services/bi.service';

import { BIPagination } from './BIPagination';
import { fmtMoney, fmtNumber, fmtPercent } from './utils';

interface Props {
  data: BISalesChannelRevenue | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function channelTypeBadge(row: BISalesChannelRow) {
  if (row.channel_bucket === 'Website') {
    return (
      <Badge variant="outline" className="gap-1 border-[var(--chart-1)]/50 text-[var(--chart-1)]">
        <IconWorld className="size-3.5" />
        Website
      </Badge>
    );
  }
  if (row.channel_bucket === 'POS') {
    return (
      <Badge variant="outline" className="gap-1 border-[var(--chart-3)]/50 text-[var(--chart-3)]">
        <IconBuildingStore className="size-3.5" />
        POS
      </Badge>
    );
  }
  return <Badge variant="outline">{row.channel_type}</Badge>;
}

function progressColor(bucket: BISalesChannelRow['channel_bucket']) {
  if (bucket === 'Website') return 'var(--chart-1)';
  if (bucket === 'POS') return 'var(--chart-3)';
  return 'var(--chart-5)';
}

function BISalesChannelTableImpl({
  data,
  isLoading,
  isFetching,
  isError,
  onRetry,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const rows = data?.results ?? [];
  const isEmpty = !isLoading && !isError && rows.length === 0;

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by sales point</CardTitle>
          <CardDescription>
            Per-channel breakdown — each individual point of sale and its share of total revenue.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Sales point</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Brand</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="pr-4 text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm">
                      <div className="flex flex-col items-center gap-2 text-destructive">
                        <span>Couldn't load sales-point revenue.</span>
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
                    </TableCell>
                  </TableRow>
                ) : isLoading && rows.length === 0 ? (
                  Array.from({ length: pageSize > 10 ? 10 : pageSize }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                      <TableCell className="pr-4 text-right"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : isEmpty ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No sales channel activity for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map(r => (
                    <TableRow key={r.sales_channel_id}>
                      <TableCell className="pl-4 font-medium">
                        <div className="flex flex-col">
                          <span className="truncate">{r.name}</span>
                          <span className="text-[11px] text-muted-foreground">{r.code}</span>
                        </div>
                      </TableCell>
                      <TableCell>{channelTypeBadge(r)}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {r.brand_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(r.orders_count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtMoney(r.revenue)}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-2">
                          <Progress
                            value={Math.min(r.share_pct, 100)}
                            className="hidden h-1.5 w-20 md:block"
                            style={{
                              ['--primary' as any]: progressColor(r.channel_bucket),
                            }}
                          />
                          <span className="tabular-nums text-sm">
                            {fmtPercent(r.share_pct, 1).replace('+', '')}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {data && !isError ? (
            <BIPagination
              count={data.count}
              page={data.page}
              pageSize={data.page_size}
              totalPages={data.total_pages}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              itemLabel="sales points"
              isFetching={isFetching}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export const BISalesChannelTable = memo(BISalesChannelTableImpl);
