/**
 * Stock helpers for the order detail — shared by the Customer tab (per-product
 * stock badges) and the missing-stock confirmation guard (Confirm / Send
 * delivery). Pure functions only; the JSX badges live in OrderDialogs.tsx.
 */
import type { OrderDetail, OrderChannelStock, OrderChannelStockItem } from '@/types';

/** Clear, severity-ordered stock states surfaced to the team. */
export type StockStatus = 'in' | 'low' | 'out' | 'unknown';

/**
 * The channel the order will actually be fulfilled from: the assigned POS when
 * the order was routed to a store, otherwise the order's own sales channel.
 */
export function getFulfilmentChannelStock(order: OrderDetail): OrderChannelStock | null {
  const channels = order.stock_by_channel?.channels ?? [];
  const pos = channels.find(c => c.is_pos_channel) ?? null;
  const orderCh = channels.find(c => c.is_order_channel) ?? null;
  return order.pos_sales_channel_name ? (pos ?? orderCh) : (orderCh ?? pos);
}

export function stockItemFor(
  stock: OrderChannelStock | null,
  productId: number | null | undefined,
): OrderChannelStockItem | undefined {
  if (!stock || productId == null) return undefined;
  return stock.items.find(it => it.product_id === productId);
}

export function stockStatusOf(item: OrderChannelStockItem | undefined): StockStatus {
  if (!item || !item.has_inventory_row) return 'unknown';
  if (item.available_quantity <= 0) return 'out';
  if (item.available_quantity < item.required_quantity) return 'low';
  return 'in';
}

/** Worst-case status across a pack's components (drives the pack-level badge). */
export function worstStatus(statuses: StockStatus[]): StockStatus {
  if (statuses.includes('out')) return 'out';
  if (statuses.includes('low')) return 'low';
  if (statuses.includes('unknown')) return 'unknown';
  return statuses.length ? 'in' : 'unknown';
}

export interface MissingStockLine {
  name: string;
  required: number;
  available: number;
  tracked: boolean;
}

/**
 * Products that cannot be fully fulfilled on the order's fulfilment channel.
 * Empty when stock is sufficient OR the channel has no tracked inventory (we
 * can't prove a shortage, so we don't block). Pack orders already expand to
 * their component products in `items`.
 */
export function getMissingStock(order: OrderDetail): MissingStockLine[] {
  const stock = getFulfilmentChannelStock(order);
  if (!stock) return [];
  return stock.items
    .filter(it => it.has_inventory_row && !it.is_sufficient)
    .map(it => ({
      name: it.product_name,
      required: it.required_quantity,
      available: it.available_quantity,
      tracked: it.has_inventory_row,
    }));
}
