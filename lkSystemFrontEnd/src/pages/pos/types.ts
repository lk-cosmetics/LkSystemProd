import type {
  ProductListItem,
  OrderDetail,
  SalesChannel,
  Client,
} from '@/types';

/* ── Catalogue filters ─────────────────────────────────────────────────── */

/**
 * Product-type axis of the POS catalogue filter, mirroring the public vitrine.
 * Independent of the selected category, so "packs within Cheveux" is
 * expressible.
 */
export type POSCatalogTypeFilter = 'all' | 'resell_product' | 'pack' | 'promo';

/** How many products each type segment would reveal in the current category. */
export interface POSCatalogTypeCounts {
  all: number;
  resell_product: number;
  pack: number;
  promo: number;
}

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
  cashAmount?: number;
  cardAmount?: number;
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

/** Format an API decimal or local number as TND with 3 decimals. */
export function fmtTND(amount: number | string | null | undefined): string {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  // Guard against a signed zero rendering as "-0.000", which is what a
  // cleared discount field produced. `(-0).toFixed(3)` is "-0.000", and so is
  // any tiny negative that rounds to zero at 3 decimals (e.g. -0.0004), which
  // floating-point subtraction of equal totals can easily produce.
  return (Math.abs(safe) < 0.0005 ? 0 : safe).toFixed(3);
}
