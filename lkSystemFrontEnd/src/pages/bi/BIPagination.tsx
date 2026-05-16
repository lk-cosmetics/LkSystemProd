import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { fmtNumber } from './utils';

interface Props {
  /** Total number of rows the server reports. */
  count: number;
  /** Current 1-indexed page. */
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Optional label override, e.g. "products" → "1–10 of 42 products". */
  itemLabel?: string;
  /** Show a dim indicator while a background refetch is in flight. */
  isFetching?: boolean;
}

/**
 * Small, dependency-free pagination footer. Matches the shadcn visual
 * language (Button outlines, muted-foreground text, ghost actions) without
 * pulling in the heavier shadcn `Pagination` component.
 */
export function BIPagination({
  count,
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  itemLabel = 'rows',
  isFetching = false,
}: Props) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.max(1, Math.min(page, safeTotalPages));
  const start = count === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, count);

  const canPrev = safePage > 1;
  const canNext = safePage < safeTotalPages;

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="tabular-nums">
        {count === 0 ? (
          <span>No {itemLabel}</span>
        ) : (
          <>
            <span>{fmtNumber(start)}–{fmtNumber(end)}</span>
            <span className="mx-1">of</span>
            <span className="font-medium text-foreground">{fmtNumber(count)}</span>
            <span className="ml-1">{itemLabel}</span>
            {isFetching ? <span className="ml-2 opacity-60">· updating…</span> : null}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <div className="flex items-center gap-1.5">
            <span>Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={v => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-7 w-[68px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(n => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={!canPrev}
            onClick={() => canPrev && onPageChange(safePage - 1)}
            aria-label="Previous page"
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <span className="px-1 tabular-nums">
            {safePage} / {safeTotalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={!canNext}
            onClick={() => canNext && onPageChange(safePage + 1)}
            aria-label="Next page"
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
