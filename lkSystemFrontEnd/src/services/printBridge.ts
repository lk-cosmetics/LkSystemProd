/**
 * Print bridge service.
 *
 * Posts to the local FastAPI bridge (TP80BEPrintBridge.exe) running on the
 * cashier PC. The bridge bypasses the browser print dialog and writes
 * ESC/POS directly to the Windows printer.
 *
 * Failures are silent — checkout never blocks if the bridge is offline. A
 * console.warn is emitted in dev so the hardware status is visible while
 * testing.
 */

import type { OrderDetail, SalesChannel } from '@/types';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8788';
const DEFAULT_TOKEN = 'change-me';
const REQUEST_TIMEOUT_MS = 1500;

const STORAGE_KEYS = {
  enabled: 'lk_pos_print_bridge_enabled',
  url: 'lk_pos_print_bridge_url',
  token: 'lk_pos_print_bridge_token',
} as const;

const hasBrowserStorage = () =>
  typeof window !== 'undefined' && !!window.localStorage;

const getStored = (key: string, fallback: string): string => {
  if (!hasBrowserStorage()) return fallback;
  return window.localStorage.getItem(key) || fallback;
};

const isEnabled = (): boolean => {
  if (!hasBrowserStorage()) return true;
  return window.localStorage.getItem(STORAGE_KEYS.enabled) !== 'false';
};

const getBridgeUrl = (): string => {
  const raw = getStored(STORAGE_KEYS.url, DEFAULT_BRIDGE_URL).trim();
  return raw.replace(/\/+$/, '') || DEFAULT_BRIDGE_URL;
};

const getBridgeToken = (): string => getStored(STORAGE_KEYS.token, DEFAULT_TOKEN);

const isDev =
  typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

/* ── Payload types ─────────────────────────────────────────────────────── */

export interface ReceiptStore {
  name: string;
  address?: string;
  phone?: string;
}

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  total: number;
}

export interface ReceiptPayload {
  order_id: string;
  date?: string;
  time?: string;
  cashier?: string;
  store?: ReceiptStore;
  items: ReceiptItem[];
  subtotal?: number;
  discount?: number;
  tax?: number;
  total: number;
  payment_method?: string;
  paid?: number;
  change?: number;
  qr_data: string;
}

/* ── HTTP helpers ──────────────────────────────────────────────────────── */

async function callBridge(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Response | null> {
  if (!isEnabled()) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${getBridgeUrl()}${path}`, {
      method,
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'X-Print-Token': getBridgeToken(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (isDev) console.warn(`[print-bridge] ${method} ${path} failed:`, err);
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/* ── Public API ────────────────────────────────────────────────────────── */

async function printReceipt(payload: ReceiptPayload): Promise<boolean> {
  const response = await callBridge('POST', '/print/receipt', payload);
  if (!response) return false;
  if (!response.ok && isDev) {
    console.warn(`[print-bridge] /print/receipt → HTTP ${response.status}`);
  }
  return response.ok;
}

async function printTest(): Promise<boolean> {
  const response = await callBridge('POST', '/print/test', {});
  if (!response) return false;
  if (!response.ok && isDev) {
    console.warn(`[print-bridge] /print/test → HTTP ${response.status}`);
  }
  return response.ok;
}

async function getPrintBridgeHealth(): Promise<
  { ok: boolean; printer_name?: string; available?: boolean } | null
> {
  const response = await callBridge('GET', '/health');
  if (!response || !response.ok) return null;
  try {
    return (await response.json()) as {
      ok: boolean;
      printer_name?: string;
      available?: boolean;
    };
  } catch {
    return null;
  }
}

export const printBridge = {
  printReceipt,
  printTest,
  getPrintBridgeHealth,
};

/* ── Payload builder ────────────────────────────────────────────────────
 *
 * Translates an OrderDetail + POS submit context into a ReceiptPayload the
 * bridge understands. Kept here so callers only import one file.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

const mapPaymentMethod = (m: string): string => {
  switch (m) {
    case 'cash':           return 'Espèce';
    case 'card':           return 'Carte';
    case 'bank_transfer':  return 'Virement';
    default:               return m;
  }
};

export function buildReceiptPayload(opts: {
  order: OrderDetail;
  channel: SalesChannel | undefined;
  paymentMethod: string;
  amountReceived: number;
  changeAmount: number;
  cashier?: string;
  displaySubtotal?: number;
  discountTotal?: number;
}): ReceiptPayload {
  const {
    order,
    channel,
    paymentMethod,
    amountReceived,
    changeAmount,
    cashier,
    displaySubtotal,
    discountTotal,
  } = opts;
  const d = new Date(order.created_at);
  const isCash = paymentMethod === 'cash';
  const ticketNumber = order.ticket_id || order.order_number;

  return {
    order_id: ticketNumber,
    date: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    cashier,
    store: channel
      ? {
          name: channel.name,
          address: channel.address || undefined,
          phone: channel.phone || undefined,
        }
      : undefined,
    items: (order.lines ?? []).map((l) => ({
      name: l.product_name,
      qty: Number(l.quantity),
      price: Number(l.unit_price),
      total: Number(l.total),
    })),
    subtotal: displaySubtotal ?? Number(order.subtotal),
    discount: discountTotal ?? Number(order.discount_total ?? 0),
    tax: Number(order.tax_total),
    total: Number(order.total),
    payment_method: mapPaymentMethod(paymentMethod),
    paid: isCash ? amountReceived : undefined,
    change: isCash ? changeAmount : undefined,
    qr_data: ticketNumber,
  };
}
