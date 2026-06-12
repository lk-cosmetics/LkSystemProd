import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIFO_ORDERING,
  PENDING_FIFO_ORDERING,
  buildPaginationItems,
  defaultOrderingForFlow,
} from './orderQueue';

describe('order queue defaults', () => {
  it('uses FIFO for the New queue and LIFO for every other tab', () => {
    expect(PENDING_FIFO_ORDERING).toBe('created_at,id');
    expect(DEFAULT_LIFO_ORDERING).toBe('-updated_at,-id');
    expect(defaultOrderingForFlow('new')).toBe(PENDING_FIFO_ORDERING);
    expect(defaultOrderingForFlow('all')).toBe(DEFAULT_LIFO_ORDERING);
    expect(defaultOrderingForFlow('done')).toBe(DEFAULT_LIFO_ORDERING);
    expect(defaultOrderingForFlow('packaging')).toBe(DEFAULT_LIFO_ORDERING);
  });
});

describe('numbered pagination', () => {
  it('shows every page for short result sets', () => {
    expect(buildPaginationItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows useful page windows at the beginning, middle, and end', () => {
    expect(buildPaginationItems(2, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis-right', 20]);
    expect(buildPaginationItems(10, 20)).toEqual([
      1,
      'ellipsis-left',
      9,
      10,
      11,
      'ellipsis-right',
      20,
    ]);
    expect(buildPaginationItems(19, 20)).toEqual([
      1,
      'ellipsis-left',
      16,
      17,
      18,
      19,
      20,
    ]);
  });
});
