export const PENDING_FIFO_ORDERING = 'created_at,id';
export const DEFAULT_LIFO_ORDERING = '-updated_at,-id';

export function defaultOrderingForFlow(flow: string) {
  // The "new" queue is worked oldest-first (FIFO); everything else reads
  // most-recently-touched first.
  return flow === 'new' ? PENDING_FIFO_ORDERING : DEFAULT_LIFO_ORDERING;
}

export type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right';

export function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const total = Math.max(1, totalPages);
  const current = Math.min(total, Math.max(1, currentPage));

  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis-right', total];
  }
  if (current >= total - 3) {
    return [1, 'ellipsis-left', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [
    1,
    'ellipsis-left',
    current - 1,
    current,
    current + 1,
    'ellipsis-right',
    total,
  ];
}
