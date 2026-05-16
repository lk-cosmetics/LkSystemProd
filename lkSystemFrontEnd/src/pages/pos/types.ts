import type { ProductListItem, OrderDetail, SalesChannel, Client } from '@/types';

/* ── Cart ──────────────────────────────────────────────────────────────── */

export interface CartLine {
  product: ProductListItem;
  quantity: number;
}

/* ── Print ─────────────────────────────────────────────────────────────── */

export interface PrintableOrderData {
  order: OrderDetail;
  channel: SalesChannel | undefined;
  client: Client | undefined;
  paymentMethod: string;
  amountReceived: number;
  changeAmount: number;
  /** Display name of the cashier who closed the sale. Optional — line is hidden if absent. */
  cashierName?: string;
  /** Total discount applied (subtotal − discounted total). Optional — line is hidden when 0. */
  discountTotal?: number;
  /** Human-friendly ticket number. Falls back to `order.order_number`. */
  ticketNumber?: string;
  /** URL of the store logo. Defaults to `/logo.svg`; pass `''` to skip and use the brand text instead. */
  logoSrc?: string;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Resolve the effective selling price. */
export function getEffectivePrice(product: ProductListItem): number {
  return Number(product.sales_price);
}

/** Format a number as TND with 3 decimals. */
export function fmtTND(n: number): string {
  return n.toFixed(3);
}
