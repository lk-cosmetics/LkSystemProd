/**
 * BIBadProductsTable
 *
 * Mirror of ``BIProductsTable`` but ordered ascending — the worst-selling
 * products in the selected period (among those that did sell). Uses the
 * same paginated response shape so we reuse ``BITopProducts`` + the shared
 * ``BIPagination`` control.
 *
 * Visual differentiation:
 *   - amber accent on the title + icon so users can't confuse it with
 *     "Top products" at a glance
 *   - "Underperforming" framing, never "bad" in the UI copy (more
 *     actionable for the buyer reading it)
 */

import { memo } from 'react';
import { IconArrowDown, IconBox } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { BITopProducts } from '@/services/bi.service';

import { BIPagination } from './BIPagination';
import { fmtMoney, fmtNumber } from './utils';

const RESALE_LABEL: Record<string, string> = {
  resell: 'Resell',
  packaging: 'Packaging',
  finished: 'Finished',
  component: 'Component',
  raw_material: 'Raw material',
};

interface Props {
  data: BITopProducts | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function BIBadProductsTableImpl({
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

  return (
    <div className="px-4 lg:px-6">
      <Card className="border-amber-300/40 dark:border-amber-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconArrowDown className="size-4 text-amber-600 dark:text-amber-400" />
            Underperforming products
          </CardTitle>
          <CardDescription>
            Lowest-revenue products that still sold in the selected period —
            useful for spotting slow-movers worth promoting or discontinuing.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">#</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Resale type</TableHead>
                  <TableHead className="text-right">Sales count</TableHead>
                  <TableHead className="text-right">Quantity sold</TableHead>
                  <TableHead className="pr-4 text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm">
                      <div className="flex flex-col items-center gap-2 text-destructive">
                        <span>Couldn't load underperforming products.</span>
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
                      <TableCell className="pl-4"><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                      <TableCell className="pr-4 text-right"><Skeleton className="ml-auto h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : isEmpty ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No underperforming products to show — nothing sold in this period yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, idx) => (
                    <TableRow key={r.product_id}>
                      <TableCell className="pl-4 text-xs text-muted-foreground tabular-nums">
                        {(page - 1) * pageSize + idx + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-100/60 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <IconBox className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{r.name}</p>
                            {r.barcode ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {r.barcode}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {RESALE_LABEL[r.product_type] ?? r.product_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(r.sales_count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(r.quantity_sold)}
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums font-medium">
                        {fmtMoney(r.revenue)}
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
              itemLabel="products"
              isFetching={isFetching}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export const BIBadProductsTable = memo(BIBadProductsTableImpl);
