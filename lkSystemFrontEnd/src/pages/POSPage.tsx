/**
 * POSPage – Modern POS cashier UI.
 *
 * Product adding: 3 methods
 *   1. Hardware barcode scanner (keyboard interception)
 *   2. Camera barcode scanning (BarcodeDetector API)
 *   3. Manual product grid click
 *
 * Customer handling:
 *   - No default customer (starts null)
 *   - User can: select existing, add new, or skip
 *   - Order validation: if neither selected nor skipped → prompt dialog
 *
 * Layout: desktop side-by-side, mobile bottom drawer.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ShoppingCart, AlertTriangle, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDebounce } from '@/hooks/useDebounce';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useInfiniteProducts } from '@/hooks/queries/useProducts';
import { usePermission } from '@/hooks/useAuth';

import { salesChannelService } from '@/services/salesChannel.service';
import { clientService } from '@/services/client.service';
import { orderService } from '@/services/order.service';
import { productService } from '@/services/product.service';
import { promotionService } from '@/services/promotion.service';
import { customerDisplayService } from '@/services/customerDisplay.service';
import {
  offlinePOSService,
  isPromotionLive,
  createOfflineTicketIdentity,
  type CachedPOSPromotion,
  type CachedPOSProduct,
  type OfflineTicket,
} from '@/services/offlinePOS.service';
import { printBridge, buildReceiptPayload } from '@/services/printBridge';
import { useAuthStore } from '@/store/authStore';
import type {
  ProductListItem,
  SalesChannel,
  Client,
  OrderDetail,
  OrderLine,
  OrderListItem,
  POSOrderCreateRequest,
} from '@/types';

import { POSProductGrid } from './pos/POSProductGrid';
import { POSCart } from './pos/POSCart';
import { POSPostOrderDialog } from './pos/POSPostOrderDialog';
import { POSReceiptPrint } from './pos/POSReceiptPrint';
import { InvoiceDocument, invoiceFromPOS, printInvoice } from '@/components/invoice';
import { useCurrentCompany } from '@/hooks/queries/useCompanies';
import { POSCameraScanner } from './pos/POSCameraScanner';
import { POSAddClientDialog } from './pos/POSAddClientDialog';
import { POSClientPromptDialog } from './pos/POSClientPromptDialog';
import POSCaisseTab from './pos/POSCaisseTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet } from 'lucide-react';
import {
  fmtTND,
  type CartLine,
  type PrintableOrderData,
} from './pos/types';

import './pos/pos-print.css';

/* ═══════════════════════════════════════════════════════════════════════ */

function orderLineToCartLine(order: OrderDetail, line: OrderLine): CartLine | null {
  const productId = line.product ?? line.product_id;
  if (!productId) return null;

  return {
    quantity: line.quantity,
    product: {
      id: productId,
      wc_product_id: line.wc_product_id ?? null,
      brand: order.brand,
      brand_name: order.brand_name,
      name: line.product_name,
      image_url: line.product_image ?? '',
      product_link: '',
      barcode: line.barcode ?? '',
      product_type: 'resell_product',
      status: 'publish',
      purchase_price: '0.00',
      sales_price: line.unit_price,
      is_pack: false,
      pack_items: null,
      created_at: order.created_at,
      updated_at: order.updated_at,
      is_deleted: false,
      deleted_at: null,
    },
  };
}

const SCANNER_RESET_GAP_MS = 160;
const SCANNER_IDLE_FLUSH_MS = 120;
const SCANNER_ENTER_MIN_LENGTH = 3;
const SCANNER_AUTO_MIN_LENGTH = 3;
const SCANNER_ENTER_MAX_AVG_MS = 120;
const SCANNER_AUTO_MAX_AVG_MS = 85;
const BARCODE_CHAR_PATTERN = /^[\w./+-]+$/;

const normalizeSearch = (value: string) => value.trim().toLowerCase();
const POS_CHANNEL_CACHE_KEY = 'lk-pos-channels-v1';
const POS_SELECTED_CHANNEL_KEY = 'lk-pos-selected-channel';

const getBrowserOnlineState = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine;

const readCachedChannels = (): SalesChannel[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(POS_CHANNEL_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readSelectedChannelId = (): string => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(POS_SELECTED_CHANNEL_KEY) || '';
};

const GENERIC_AXIOS_RE = /^request failed with status code/i;

/**
 * Turn any thrown request error into a human-readable message. Handles DRF
 * shapes ({detail}, {message}, {non_field_errors}, field-error dicts, plain
 * strings / lists) plus our custom {pack_errors}. Falls back to ``fallback``
 * rather than leaking the generic "Request failed with status code 400" that
 * axios puts on the Error — so the cashier sees the real reason (e.g. the
 * insufficient-stock detail) instead of a status code.
 */
const describeRequestError = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;

  // Plain string body (ignore HTML error pages).
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed && !trimmed.startsWith('<')) return trimmed;
  }

  // Top-level list body: ["message", …]
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return data.join(' ');
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Custom pack-component shortfalls.
    const packErrors = obj.pack_errors as
      | Array<{ message?: string; component_name?: string }>
      | undefined;
    if (Array.isArray(packErrors) && packErrors.length) {
      const lines = packErrors
        .map(p =>
          p.message ||
          (p.component_name ? `Le produit ${p.component_name} est insuffisant dans ce pack.` : null)
        )
        .filter(Boolean);
      const head =
        typeof obj.message === 'string' ? obj.message
        : typeof obj.detail === 'string' ? obj.detail
        : null;
      return [head, ...lines].filter(Boolean).join('\n');
    }

    // Common single-message keys (string or string[]).
    for (const key of ['detail', 'message', 'error', 'non_field_errors'] as const) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
      if (Array.isArray(val) && typeof val[0] === 'string') return val.join(' ');
    }

    // Generic DRF field-error dict: { field: ["msg", …] }.
    const fieldLines = Object.entries(obj)
      .map(([field, val]) => {
        if (Array.isArray(val) && typeof val[0] === 'string') return `${field}: ${val.join(' ')}`;
        if (typeof val === 'string' && val.trim()) return `${field}: ${val.trim()}`;
        return null;
      })
      .filter(Boolean);
    if (fieldLines.length) return fieldLines.join('\n');
  }

  // Last resort — the JS error text, unless it's the generic axios noise.
  if (err instanceof Error && err.message && !GENERIC_AXIOS_RE.test(err.message)) {
    return err.message;
  }
  return fallback;
};

const isConnectivityError = (err: unknown): boolean => {
  const maybeAxios = err as {
    code?: string;
    message?: string;
    request?: unknown;
    response?: { status?: number };
  };
  const status = maybeAxios?.response?.status;
  if (status && [0, 502, 503, 504].includes(status)) return true;
  if (maybeAxios?.response) return false;

  if (!getBrowserOnlineState()) return true;

  const code = String(maybeAxios?.code ?? '').toUpperCase();
  if (['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(code)) return true;

  const message = String(maybeAxios?.message ?? '').toLowerCase();
  return (
    Boolean(maybeAxios?.request) ||
    message.includes('network error') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('net::err')
  );
};

export default function POSPage() {
  const isMobile = useIsMobile();
  const authUser = useAuthStore(s => s.user);
  const canViewPromotions = usePermission('view_promotions');
  const cashierName = useMemo(() => {
    if (!authUser) return undefined;
    const full =
      (authUser.full_name ?? '').trim() ||
      `${authUser.firstName ?? ''} ${authUser.lastName ?? ''}`.trim();
    return full || authUser.email || undefined;
  }, [authUser]);

  /* ── Data sources ──────────────────────────────────────────────────── */
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [waitingPOSOrders, setWaitingPOSOrders] = useState<OrderListItem[]>([]);
  const [waitingPOSCount, setWaitingPOSCount] = useState(0);
  const [waitingPOSLoading, setWaitingPOSLoading] = useState(false);
  const [posHistoryOrders, setPosHistoryOrders] = useState<OrderListItem[]>([]);
  const [posHistoryCount, setPosHistoryCount] = useState(0);
  const [posHistoryLoading, setPosHistoryLoading] = useState(false);
  const [posHistorySearch, setPosHistorySearch] = useState('');
  const debouncedPOSHistorySearch = useDebounce(posHistorySearch, 350);
  const [posHistoryDateFrom, setPosHistoryDateFrom] = useState('');
  const [posHistoryDateTo, setPosHistoryDateTo] = useState('');
  const [isOnlineMode, setIsOnlineMode] = useState(getBrowserOnlineState);
  const [offlineProducts, setOfflineProducts] = useState<CachedPOSProduct[]>([]);
  const [offlinePromotions, setOfflinePromotions] = useState<CachedPOSPromotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [offlineLastSync, setOfflineLastSync] = useState<string | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [posTab, setPosTab] = useState<'caisse' | 'depenses'>('caisse');
  const [caisseRefreshSignal, setCaisseRefreshSignal] = useState(0);

  const notifyCaisseStatsChanged = useCallback(() => {
    setCaisseRefreshSignal(value => value + 1);
  }, []);

  const queryClient = useQueryClient();

  /* ── Selections ────────────────────────────────────────────────────── */
  const [channelId, setChannelId] = useState(() => readSelectedChannelId());
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounce(productSearch, 500);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [manualDiscountType, setManualDiscountType] =
    useState<'fixed' | 'percentage'>('fixed');
  const [manualDiscountValue, setManualDiscountValue] = useState('');
  const [customerNote, setCustomerNote] = useState('');

  /* ── Customer state (no default — starts null) ─────────────────────── */
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSkipped, setClientSkipped] = useState(false);

  /* ── Cart ───────────────────────────────────────────────────────────── */
  const [cart, setCart] = useState<CartLine[]>([]);
  const [amountReceived, setAmountReceived] = useState(0);
  const [discountedPrices, setDiscountedPrices] = useState<Record<number, number>>({});
  const [activePickupOrder, setActivePickupOrder] = useState<OrderDetail | null>(null);
  const [activeHistoryOrder, setActiveHistoryOrder] = useState<OrderDetail | null>(null);
  const [pickupLinePrices, setPickupLinePrices] = useState<Record<number, number>>({});

  const applyDiscountedPrices = useCallback((next: Record<number, number>) => {
    setDiscountedPrices(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length) {
        const same = nextKeys.every(key => prev[Number(key)] === next[Number(key)]);
        if (same) return prev;
      }
      return next;
    });
  }, []);

  /* ── Order submission ──────────────────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [returningOrderId, setReturningOrderId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ── Post-order flow ───────────────────────────────────────────────── */
  const [completedOrder, setCompletedOrder] = useState<OrderDetail | null>(null);
  const [printData, setPrintData] = useState<PrintableOrderData | null>(null);
  // Current company's billing profile drives the invoice header (name,
  // Matricule Fiscale, logo, footer…); falls back to the default logo.
  const { data: invoiceCompany } = useCurrentCompany();
  const [printMode, setPrintMode] = useState<'receipt' | 'invoice' | null>(null);

  /* ── Mobile drawer ─────────────────────────────────────────────────── */
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  /* ── Dialog states ─────────────────────────────────────────────────── */
  const [cameraOpen, setCameraOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [clientPromptOpen, setClientPromptOpen] = useState(false);

  /* ── Camera scanner feedback ───────────────────────────────────────── */
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scanFeedbackType, setScanFeedbackType] = useState<'success' | 'error' | null>(null);

  /* ── Barcode scanner buffer (hardware scanner) ─────────────────────── */
  const barcodeBuffer = useRef('');
  const barcodeStartedAt = useRef(0);
  const barcodeLastKeyAt = useRef(0);
  const barcodeTarget = useRef<EventTarget | null>(null);
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const displayCartSnapshot = useRef<Map<number, number>>(new Map());

  /* ── Load reference data ───────────────────────────────────────────── */
  const fetchRef = useCallback(async () => {
    setDataLoading(true);
    try {
      const [chRes, clRes] = await Promise.all([
        salesChannelService.getAllChannels(),
        clientService.getAll({ page_size: 1000 }),
      ]);
      setChannels(chRes);
      setClients(Array.isArray(clRes) ? clRes : clRes.results);
      try {
        window.localStorage.setItem(POS_CHANNEL_CACHE_KEY, JSON.stringify(chRes));
      } catch (cacheErr) {
        console.warn('[POS] Could not cache sales channels:', cacheErr);
      }
      setChannelId(prev => {
        if (prev && chRes.some(channel => String(channel.id) === prev)) return prev;
        const saved = readSelectedChannelId();
        if (saved && chRes.some(channel => String(channel.id) === saved)) return saved;
        return chRes[0] ? String(chRes[0].id) : '';
      });
    } catch (err) {
      console.error('Failed to load POS data:', err);
      if (isConnectivityError(err)) {
        setIsOnlineMode(false);
      }
      const cachedChannels = readCachedChannels();
      if (cachedChannels.length > 0) {
        setChannels(cachedChannels);
        setChannelId(prev => prev || readSelectedChannelId() || String(cachedChannels[0].id));
      }
    } finally {
      setDataLoading(false);
    }
  }, []);

  const fetchWaitingPOSOrders = useCallback(async () => {
    if (!channelId) {
      setWaitingPOSOrders([]);
      setWaitingPOSCount(0);
      return;
    }

    setWaitingPOSLoading(true);
    try {
      const response = await orderService.getAll({
        // Waiting POS = routed to this till and not yet validated — exactly
        // the canonical 'packaging' stage scoped to the POS channel.
        status: 'packaging',
        pos_sales_channel: Number(channelId),
        page_size: 50,
        ordering: '-sent_to_pos_at,-created_at',
      });
      const results = Array.isArray(response) ? response : response.results ?? [];
      setWaitingPOSOrders(results);
      setWaitingPOSCount(Array.isArray(response) ? results.length : response.count ?? results.length);
    } catch (err) {
      console.error('Failed to load waiting POS orders:', err);
      setWaitingPOSOrders([]);
      setWaitingPOSCount(0);
    } finally {
      setWaitingPOSLoading(false);
    }
  }, [channelId, channels]);

  const fetchPOSHistoryOrders = useCallback(async () => {
    if (!channelId) {
      setPosHistoryOrders([]);
      setPosHistoryCount(0);
      return;
    }

    setPosHistoryLoading(true);
    try {
      // Completed sales for the selected channel — works for every channel type
      // (POS sales rung here plus any other completed orders on the channel),
      // filtered by the canonical done status rather than POS source only.
      const response = await orderService.getAll({
        sales_channel: Number(channelId),
        status: 'done',
        search: debouncedPOSHistorySearch || undefined,
        created_from: posHistoryDateFrom || undefined,
        created_to: posHistoryDateTo || undefined,
        page_size: 60,
        ordering: '-created_at',
      });
      const results = Array.isArray(response) ? response : response.results ?? [];
      setPosHistoryOrders(results);
      setPosHistoryCount(Array.isArray(response) ? results.length : response.count ?? results.length);
    } catch (err) {
      console.error('Failed to load POS order history:', err);
      setPosHistoryOrders([]);
      setPosHistoryCount(0);
    } finally {
      setPosHistoryLoading(false);
    }
  }, [channelId, channels, debouncedPOSHistorySearch, posHistoryDateFrom, posHistoryDateTo]);

  useEffect(() => {
    fetchRef();
  }, [fetchRef]);

  useEffect(() => {
    fetchWaitingPOSOrders();
  }, [fetchWaitingPOSOrders]);

  // Real-time waiting POS: refresh the waiting list (+ POS history) the moment
  // any order changes server-side — e.g. an order routed to this till — so a
  // cashier sees it appear instantly without reloading. Debounced to coalesce
  // bursts. Backed by the orders WebSocket (broadcast on every order commit).
  const waitingRefetchRef = useRef<() => void>(() => {});
  waitingRefetchRef.current = () => {
    void fetchWaitingPOSOrders();
    void fetchPOSHistoryOrders();
  };
  const wsRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleOrderEvent = useCallback(() => {
    if (wsRefetchTimer.current) clearTimeout(wsRefetchTimer.current);
    wsRefetchTimer.current = setTimeout(() => waitingRefetchRef.current(), 400);
  }, []);
  useWebSocket({
    path: '/ws/orders/',
    enabled: !!channelId,
    onMessage: handleOrderEvent,
  });

  useEffect(() => {
    fetchPOSHistoryOrders();
  }, [fetchPOSHistoryOrders]);

  /* ── Channel-filtered products ─────────────────────────────────────── */
  const selectedChannel = channels.find(c => c.id === Number(channelId));

  const refreshPendingOfflineCount = useCallback(async () => {
    setPendingOfflineCount(await offlinePOSService.getPendingCount());
  }, []);

  const loadCachedPOSProducts = useCallback(async (salesChannelId: number) => {
    const [cachedProducts, cachedPromotions, meta] = await Promise.all([
      offlinePOSService.getCachedProducts(salesChannelId),
      offlinePOSService.getCachedPromotions(salesChannelId),
      offlinePOSService.getCacheMeta(salesChannelId),
    ]);
    setOfflineProducts(cachedProducts);
    setOfflinePromotions(cachedPromotions);
    setOfflineLastSync(meta?.last_sync ?? null);
  }, []);

  const refreshPOSProductCache = useCallback(async () => {
    if (!channelId || !selectedChannel) return false;
    const salesChannelId = Number(channelId);

    try {
      const snapshot = await productService.getPOSCache(salesChannelId);
      await offlinePOSService.saveProductSnapshot(snapshot);

      if (canViewPromotions) {
        setPromotionsLoading(true);
        try {
          // Promotions are scoped to the selected POS channel and gated by
          // ``current_only`` so expired / future campaigns never reach the
          // offline cache. ``is_active`` keeps deactivated rows out.
          const promotions = await promotionService.getAllPromotions({
            sales_channel: salesChannelId,
            current_only: true,
            is_active: true,
            page_size: 500,
          });
          await offlinePOSService.savePromotions(salesChannelId, promotions);
        } catch (promoErr) {
          console.warn('[POS] Promotion cache refresh failed:', promoErr);
          toast.error('Could not refresh promotions. Showing last cached values.');
        } finally {
          setPromotionsLoading(false);
        }
      }

      await loadCachedPOSProducts(salesChannelId);
      setIsOnlineMode(true);
      return true;
    } catch (err) {
      console.warn('[POS] Product cache refresh failed, using IndexedDB snapshot:', err);
      await loadCachedPOSProducts(salesChannelId);
      setIsOnlineMode(!isConnectivityError(err));
      return false;
    }
  }, [channelId, selectedChannel, canViewPromotions, loadCachedPOSProducts]);

  useEffect(() => {
    const update = () => setIsOnlineMode(getBrowserOnlineState());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!channelId) {
      setOfflineProducts([]);
      setOfflinePromotions([]);
      setOfflineLastSync(null);
      return;
    }
    // Clear promotions immediately on channel switch — the previous
    // channel's offers must not flash through while the new channel's
    // cache is loading.
    setOfflinePromotions([]);
    void loadCachedPOSProducts(Number(channelId));
    void refreshPOSProductCache();
  }, [channelId, loadCachedPOSProducts, refreshPOSProductCache]);

  /*
   * Auto-refresh the POS promotion cache whenever a promotion mutation
   * succeeds anywhere in the app. The Promotions page tags every mutation
   * (create / update / delete / activate / deactivate / bulk-*) with a
   * mutationKey starting with ``'promotions'`` (see ``usePromotions.ts``);
   * here we subscribe to the mutation cache and pull a fresh snapshot for
   * the active POS channel the moment any of those mutations resolve.
   *
   * Subscribing to the mutation cache (rather than the query cache) avoids
   * loops with our own ``refreshPOSProductCache`` — that call writes to
   * IndexedDB and local state, never to React-Query.
   */
  useEffect(() => {
    if (!channelId) return;
    const mc = queryClient.getMutationCache();
    return mc.subscribe(event => {
      if (event.type !== 'updated') return;
      if (event.mutation.state.status !== 'success') return;
      const key = event.mutation.options.mutationKey;
      if (Array.isArray(key) && key[0] === 'promotions') {
        void refreshPOSProductCache();
      }
    });
  }, [channelId, queryClient, refreshPOSProductCache]);

  useEffect(() => {
    void refreshPendingOfflineCount();
  }, [refreshPendingOfflineCount]);

  const syncOfflineTickets = useCallback(async () => {
    if (!isOnlineMode || syncingOffline) return;

    const tickets = await offlinePOSService.getPendingTickets();
    if (tickets.length === 0) {
      setPendingOfflineCount(0);
      return;
    }

    setSyncingOffline(true);
    let syncedAny = false;

    try {
      for (const ticket of tickets) {
        await offlinePOSService.markTicketSyncing(ticket);
        try {
          const result = await orderService.createPOS(ticket.payload);
          await offlinePOSService.markTicketSynced(ticket, result.id);
          syncedAny = true;
        } catch (err) {
          const message = describeRequestError(err, 'Offline ticket sync failed.');
          await offlinePOSService.markTicketFailed(ticket, message);
          setErrorMsg(`Ticket ${ticket.ticket_id} could not sync: ${message}`);
          console.warn('[POS] Offline ticket sync failed:', ticket.ticket_id, err);
          if (isConnectivityError(err)) {
            setIsOnlineMode(false);
            break;
          }
          continue; // keep syncing the rest — one bad ticket must not strand the queue
        }
      }
    } finally {
      setSyncingOffline(false);
      await refreshPendingOfflineCount();
      if (syncedAny) {
        await Promise.all([
          refreshPOSProductCache(),
          fetchPOSHistoryOrders(),
        ]);
        notifyCaisseStatsChanged();
      }
    }
  }, [
    isOnlineMode,
    syncingOffline,
    refreshPendingOfflineCount,
    refreshPOSProductCache,
    fetchPOSHistoryOrders,
    notifyCaisseStatsChanged,
  ]);

  useEffect(() => {
    if (!isOnlineMode) return;
    void syncOfflineTickets();
  }, [isOnlineMode, syncOfflineTickets]);

  const productQueryParams = useMemo(() => {
    if (!channelId || !selectedChannel || !isOnlineMode) return { enabled: false as const };
    // No ``product_type`` filter here: the POS catalogue must surface every
    // sellable item (``resell_product`` AND ``pack``). The backend list
    // endpoint filters product_type by exact match, so we fetch the brand's
    // published catalogue and narrow to sellable types client-side (see
    // ``isSellable`` below). The primary offline path (``pos_cache``) is
    // already scoped to SELLABLE_TYPES server-side.
    return {
      brand: selectedChannel.brand,
      status: 'publish' as const,
      enabled: true as const,
    };
  }, [channelId, selectedChannel, isOnlineMode]);

  const {
    data: productsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isProductsLoading,
  } = useInfiniteProducts({
    ...productQueryParams,
    search: debouncedProductSearch || undefined,
    page_size: 20,
  });

  const getCachedPromotionPrice = useCallback(
    (product: ProductListItem): number | null => {
      const originalPrice = Number(product.sales_price);
      if (!Number.isFinite(originalPrice)) return null;

      // Don't trust the cached ``is_currently_active`` boolean — it was a
      // snapshot at fetch time. Recompute against the current clock so that
      // promotions which have since started, expired, or been deactivated
      // are handled correctly even when the cache hasn't been refreshed.
      const now = new Date();
      const productPromotions = offlinePromotions.filter(
        promo => promo.product === product.id && isPromotionLive(promo, now),
      );
      if (productPromotions.length === 0) return null;

      const prices = productPromotions
        .map(promo => {
          const value = Number(promo.default_discount_value || 0);
          if (!Number.isFinite(value) || value <= 0) return originalPrice;
          if (promo.discount_type === 'percentage') {
            return Math.max(0, originalPrice - (originalPrice * Math.min(value, 100)) / 100);
          }
          return Math.max(0, originalPrice - value);
        })
        .filter(price => Number.isFinite(price));

      const bestPrice = Math.min(...prices);
      return bestPrice < originalPrice ? bestPrice : null;
    },
    [offlinePromotions]
  );

  const channelProducts = useMemo(() => {
    if (!channelId) return [];

    const sortPromotionsFirst = (rows: ProductListItem[]) =>
      [...rows].sort((a, b) => {
        const aDiscount = discountedPrices[a.id] ?? getCachedPromotionPrice(a);
        const bDiscount = discountedPrices[b.id] ?? getCachedPromotionPrice(b);
        const aHasPromo = typeof aDiscount === 'number' && aDiscount < Number(a.sales_price);
        const bHasPromo = typeof bDiscount === 'number' && bDiscount < Number(b.sales_price);
        if (aHasPromo !== bHasPromo) return aHasPromo ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    // Sellable = the two customer-facing types. Packs were historically stored
    // as ``resell`` + ``is_pack``; after the taxonomy refactor they carry the
    // canonical ``pack`` type, so both must be admitted here.
    const isSellable = (p: ProductListItem) =>
      p.product_type === 'resell_product' || p.product_type === 'pack';

    if (offlineProducts.length > 0) {
      const query = normalizeSearch(productSearch);
      const base = offlineProducts.filter(isSellable);
      const rows = query
        ? base.filter(product => (
            product.name.toLowerCase().includes(query) ||
            (product.barcode || '').toLowerCase().includes(query)
          ))
        : base;
      return sortPromotionsFirst(rows);
    }

    if (!productsData?.pages) return [];
    return sortPromotionsFirst(
      productsData.pages.flatMap(page => page?.results ?? []).filter(isSellable),
    );
  }, [
    channelId,
    discountedPrices,
    getCachedPromotionPrice,
    offlineProducts,
    productSearch,
    productsData?.pages,
  ]);

  const offlineLastSyncLabel = useMemo(() => {
    if (!offlineLastSync) return 'No local cache yet';
    const date = new Date(offlineLastSync);
    if (Number.isNaN(date.getTime())) return 'Local cache ready';
    return `Last sync ${date.toLocaleString()}`;
  }, [offlineLastSync]);

  const cartProductIds = useMemo(
    () => Array.from(new Set(cart.map(l => l.product.id))),
    [cart],
  );

  // Fetch discounts for visible products + cart items so product cards show promo prices
  const allTrackedProductIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...channelProducts.map(p => p.id),
          ...cartProductIds,
        ]),
      ),
    [channelProducts, cartProductIds],
  );

  const getUnitPrice = useCallback(
    (product: ProductListItem) => {
      if (activePickupOrder) {
        const lockedPrice = pickupLinePrices[product.id];
        if (typeof lockedPrice === 'number' && Number.isFinite(lockedPrice)) {
          return lockedPrice;
        }
      }
      const override = discountedPrices[product.id];
      if (typeof override === 'number' && Number.isFinite(override)) {
        return override;
      }
      return Number(product.sales_price);
    },
    [activePickupOrder, discountedPrices, pickupLinePrices],
  );

  /* ── Promotions (POS + WooCommerce channels) ─────────────────────────── */
  useEffect(() => {
    if (activePickupOrder) {
      applyDiscountedPrices({});
      return;
    }
    if (
      !channelId || !selectedChannel ||
      (selectedChannel.channel_type !== 'POS' && selectedChannel.channel_type !== 'WOOCOMMERCE')
    ) {
      applyDiscountedPrices({});
      return;
    }
    if (allTrackedProductIds.length === 0) {
      applyDiscountedPrices({});
      return;
    }

    if (!isOnlineMode) {
      const next: Record<number, number> = {};
      channelProducts.forEach(product => {
        const cachedPrice = getCachedPromotionPrice(product);
        if (typeof cachedPrice === 'number') {
          next[product.id] = cachedPrice;
        }
      });
      applyDiscountedPrices(next);
      return;
    }

    let cancelled = false;

    const fetchDiscounts = async () => {
      try {
        // Single batch call instead of N individual calls → no race conditions,
        // no silent 404-rejections per product, one network round-trip.
        const response = await promotionService.batchCalculateDiscounts({
          product_ids: allTrackedProductIds,
          sales_channel_id: Number(channelId),
        });

        if (!cancelled) {
          const next: Record<number, number> = {};
          Object.entries(response.results).forEach(([productId, result]) => {
            const price = Number(result.discounted_price);
            if (Number.isFinite(price)) {
              next[Number(productId)] = price;
            }
          });
          // Replace entirely so products that lost their promotion are cleared
          applyDiscountedPrices(next);
        }
      } catch (err) {
        // Channel not POS or network error: fall back to cached promotions.
        if (!cancelled) {
          const next: Record<number, number> = {};
          channelProducts.forEach(product => {
            const cachedPrice = getCachedPromotionPrice(product);
            if (typeof cachedPrice === 'number') {
              next[product.id] = cachedPrice;
            }
          });
          applyDiscountedPrices(next);
        }
        console.warn('[POS] Could not fetch promotions:', err);
      }
    };

    fetchDiscounts();

    return () => {
      cancelled = true;
    };
  }, [
    activePickupOrder,
    allTrackedProductIds,
    applyDiscountedPrices,
    channelId,
    channelProducts,
    getCachedPromotionPrice,
    isOnlineMode,
    selectedChannel,
  ]);

  /* ── Cart quantity map (for product card badges) ───────────────────── */
  const cartQuantities = useMemo(
    () => new Map(cart.map(l => [l.product.id, l.quantity])),
    [cart],
  );
  const offlineProductById = useMemo(
    () => new Map(offlineProducts.map(product => [product.id, product])),
    [offlineProducts],
  );

  /* ── Cart helpers ──────────────────────────────────────────────────── */
  const getOfflineAvailableQuantity = useCallback((product: ProductListItem) => {
    if (product.is_pack && product.pack_items?.length) {
      const availableSets = product.pack_items.map(item => {
        const component = offlineProductById.get(item.product_id);
        const required = Math.max(1, Number(item.quantity || 1));
        return Math.floor((component?.offline_stock?.available_quantity ?? 0) / required);
      });
      return availableSets.length > 0 ? Math.max(0, Math.min(...availableSets)) : 0;
    }
    const cached = offlineProductById.get(product.id) || (product as CachedPOSProduct);
    return cached.offline_stock?.available_quantity ?? Number.POSITIVE_INFINITY;
  }, [offlineProductById]);

  const releasePickupOrder = useCallback(() => {
    setActivePickupOrder(null);
    setPickupLinePrices({});
    setCart([]);
    setAmountReceived(0);
    setCustomerNote('');
    setSelectedClient(null);
    setClientSkipped(false);
  }, []);

  const releaseHistoryOrder = useCallback(() => {
    setActiveHistoryOrder(null);
    setCart([]);
    setAmountReceived(0);
    setCustomerNote('');
    setManualDiscountValue('');
    setManualDiscountType('fixed');
    setSelectedClient(null);
    setClientSkipped(false);
  }, []);

  const addToCart = useCallback((product: ProductListItem) => {
    if (activePickupOrder) {
      setErrorMsg('Release the waiting pickup order before adding products manually.');
      return;
    }
    if (!isOnlineMode) {
      const available = getOfflineAvailableQuantity(product);
      const currentQuantity = cart.find(l => l.product.id === product.id)?.quantity ?? 0;
      if (currentQuantity + 1 > available) {
        setErrorMsg(
          product.is_pack
            ? `Stock insuffisant pour le pack ${product.name} (${available} disponible selon les composants).`
            : `${product.name}: stock insuffisant en mode offline (${available} disponible).`
        );
        return;
      }
    }
    setCart(prev => {
      const existing = prev.find(l => l.product.id === product.id);
      if (existing) {
        return prev.map(l =>
          l.product.id === product.id
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }, [activePickupOrder, cart, getOfflineAvailableQuantity, isOnlineMode]);

  const changeQty = useCallback((productId: number, delta: number) => {
    if (!isOnlineMode && delta > 0) {
      const line = cart.find(l => l.product.id === productId);
      if (line) {
        const available = getOfflineAvailableQuantity(line.product);
        if (line.quantity + delta > available) {
          setErrorMsg(
            line.product.is_pack
              ? `Stock insuffisant pour le pack ${line.product.name} (${available} disponible selon les composants).`
              : `${line.product.name}: stock insuffisant en mode offline (${available} disponible).`
          );
          return;
        }
      }
    }
    setCart(prev =>
      prev
        .map(l =>
          l.product.id === productId
            ? { ...l, quantity: Math.max(0, l.quantity + delta) }
            : l,
        )
        .filter(l => l.quantity > 0),
    );
  }, [cart, getOfflineAvailableQuantity, isOnlineMode]);

  const removeFromCart = useCallback(
    (productId: number) =>
      setCart(prev => prev.filter(l => l.product.id !== productId)),
    [],
  );

  const clearCart = useCallback(() => {
    if (activePickupOrder) {
      releasePickupOrder();
      return;
    }
    if (activeHistoryOrder) {
      releaseHistoryOrder();
      return;
    }
    setCart([]);
    setManualDiscountValue('');
  }, [activeHistoryOrder, activePickupOrder, releaseHistoryOrder, releasePickupOrder]);

  // Full price total (no promotions) — used to compute savings display
  const cartOriginalTotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.quantity * Number(l.product.sales_price), 0),
    [cart],
  );

  const promotionCartTotal = useMemo(
    () => cart.reduce((sum, l) => sum + l.quantity * getUnitPrice(l.product), 0),
    [cart, getUnitPrice],
  );

  const manualDiscountAmount = useMemo(() => {
    const raw = Number(manualDiscountValue || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    const discount =
      manualDiscountType === 'percentage'
        ? (promotionCartTotal * Math.min(raw, 100)) / 100
        : raw;
    return Math.min(promotionCartTotal, Math.max(0, discount));
  }, [manualDiscountType, manualDiscountValue, promotionCartTotal]);

  // Final total — promotions first, then manual cart-level discount.
  const cartTotal = useMemo(
    () => Math.max(0, promotionCartTotal - manualDiscountAmount),
    [manualDiscountAmount, promotionCartTotal],
  );

  const cartItemCount = useMemo(
    () => cart.reduce((sum, l) => sum + l.quantity, 0),
    [cart],
  );

  const changeAmount = useMemo(
    () => Math.max(0, amountReceived - cartTotal),
    [amountReceived, cartTotal],
  );

  /* ── Local LED8 customer-display bridge ────────────────────────────── */

  // Price label on item add / quantity bump
  useEffect(() => {
    const previous = displayCartSnapshot.current;
    const next = new Map<number, number>();
    let changedLine: CartLine | undefined;

    for (const line of cart) {
      const previousQuantity = previous.get(line.product.id) ?? 0;
      next.set(line.product.id, line.quantity);
      if (line.quantity > previousQuantity) {
        changedLine = line;
      }
    }

    displayCartSnapshot.current = next;

    if (!changedLine) return;
    void customerDisplayService.showPrice(getUnitPrice(changedLine.product));
  }, [cart, getUnitPrice]);

  // Total label, debounced 200 ms; show 0.000 when cart empties
  useEffect(() => {
    if (cart.length === 0) {
      displayCartSnapshot.current = new Map();
      void customerDisplayService.showTotal(0);
      return;
    }
    const timer = window.setTimeout(() => {
      void customerDisplayService.showTotal(cartTotal);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [cart.length, cartTotal]);

  // Collect label on cash amount entered
  useEffect(() => {
    if (paymentMethod !== 'cash') return;
    if (amountReceived <= 0) return;
    const timer = window.setTimeout(() => {
      void customerDisplayService.showCollect(amountReceived);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [amountReceived, paymentMethod]);

  // Change label once payment >= total
  useEffect(() => {
    if (paymentMethod !== 'cash') return;
    if (amountReceived < cartTotal) return;
    if (changeAmount <= 0) return;
    const timer = window.setTimeout(() => {
      void customerDisplayService.showChange(changeAmount);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [changeAmount, amountReceived, cartTotal, paymentMethod]);

  /* ── Customer handlers ─────────────────────────────────────────────── */
  const handleSelectClient = useCallback((client: Client) => {
    setSelectedClient(client);
    setClientSkipped(false);
  }, []);

  const handleSkipClient = useCallback(() => {
    setSelectedClient(null);
    setClientSkipped(true);
  }, []);

  const handleClearClient = useCallback(() => {
    setSelectedClient(null);
    setClientSkipped(false);
  }, []);

  const handleClientCreated = useCallback((client: Client) => {
    setClients(prev => {
      const exists = prev.some(item => item.id === client.id);
      return exists
        ? prev.map(item => (item.id === client.id ? client : item))
        : [client, ...prev];
    });
    setSelectedClient(client);
    setClientSkipped(false);
  }, []);

  const handleSelectWaitingOrder = useCallback(async (order: OrderListItem) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const detail = await orderService.getById(order.id);
      const nextCart = detail.lines
        .map(line => orderLineToCartLine(detail, line))
        .filter((line): line is CartLine => line !== null);

      if (nextCart.length !== detail.lines.length || nextCart.length === 0) {
        setErrorMsg(
          'This pickup order has unlinked products. Link the order lines to local products before POS checkout.'
        );
        return;
      }

      const prices = nextCart.reduce<Record<number, number>>((acc, line) => {
        acc[line.product.id] = Number(line.product.sales_price);
        return acc;
      }, {});
      const matchedClient = detail.client
        ? clients.find(client => client.id === detail.client) ?? null
        : null;

      setActivePickupOrder(detail);
      setPickupLinePrices(prices);
      setChannelId(String(detail.pos_sales_channel ?? detail.sales_channel));
      setCart(nextCart);
      setAmountReceived(Number(detail.total || 0));
      setPaymentMethod(detail.payment_method || 'cash');
      setCustomerNote(detail.customer_note || '');
      setSelectedClient(matchedClient);
      setClientSkipped(!matchedClient);
      if (isMobile) setCartDrawerOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load waiting order.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }, [clients, isMobile]);

  const handleSelectHistoryOrder = useCallback(async (order: OrderListItem) => {
    if (order.returned_at || order.status === 'returned') {
      setErrorMsg('This POS ticket is already returned and cannot be edited.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const detail = await orderService.getById(order.id);
      const nextCart = (detail.lines ?? [])
        .map(line => orderLineToCartLine(detail, line))
        .filter((line): line is CartLine => Boolean(line));

      if (nextCart.length === 0) {
        setErrorMsg('This POS order has no editable product lines.');
        return;
      }

      const matchedClient = detail.client
        ? clients.find(client => client.id === detail.client) ?? null
        : null;
      const discountValue = Number(detail.discount_value || 0);

      setActivePickupOrder(null);
      setPickupLinePrices({});
      setActiveHistoryOrder(detail);
      setChannelId(String(detail.sales_channel));
      setCart(nextCart);
      setAmountReceived(Number(detail.total || 0));
      setPaymentMethod(
        detail.payment_method?.toLowerCase().includes('card')
          ? 'card'
          : detail.payment_method?.toLowerCase().includes('transfer')
            ? 'bank_transfer'
            : 'cash'
      );
      setManualDiscountType(detail.discount_type === 'PERCENTAGE' ? 'percentage' : 'fixed');
      setManualDiscountValue(discountValue > 0 ? String(discountValue) : '');
      setCustomerNote(detail.customer_note || '');
      setSelectedClient(matchedClient);
      setClientSkipped(!matchedClient);
      if (isMobile) setCartDrawerOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load POS order history.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  }, [clients, isMobile]);

  const handleReturnHistoryOrder = useCallback(async (order: OrderListItem | OrderDetail) => {
    if (!order?.id || returningOrderId) return;
    if (order.returned_at || order.status === 'returned') {
      setErrorMsg('This POS ticket has already been returned.');
      return;
    }

    const ticket = order.ticket_id || order.order_number;
    const confirmed = window.confirm(
      `Return POS ticket #${ticket}?\n\nStock will be restored for this POS location. This will not increase the client WooCommerce return count.`
    );
    if (!confirmed) return;

    setReturningOrderId(order.id);
    setErrorMsg(null);
    try {
      await orderService.processReturn(order.id, { returnReason: 'Returned from POS history' });
      if (activeHistoryOrder?.id === order.id) {
        releaseHistoryOrder();
      }
      await Promise.all([
        fetchPOSHistoryOrders(),
        channelId ? refreshPOSProductCache() : Promise.resolve(false),
      ]);
      notifyCaisseStatsChanged();
      setScanFeedback(`✓ Ticket #${ticket} returned and stock restored`);
      setScanFeedbackType('success');
    } catch (err: unknown) {
      setErrorMsg(describeRequestError(err, 'Failed to return this POS ticket.'));
    } finally {
      setReturningOrderId(null);
    }
  }, [
    activeHistoryOrder?.id,
    channelId,
    fetchPOSHistoryOrders,
    notifyCaisseStatsChanged,
    refreshPOSProductCache,
    releaseHistoryOrder,
    returningOrderId,
  ]);

  /* ── Barcode handler (shared by hardware scanner + camera) ─────────── */
  const handleBarcodeDetected = useCallback(
    async (barcode: string) => {
      const cleanBarcode = barcode.trim();
      if (cleanBarcode.length < SCANNER_ENTER_MIN_LENGTH) return;

      setProductSearch('');

      // 1. Try local match first (faster, no network)
      const localMatch = channelProducts.find(
        p => p.barcode?.toLowerCase() === cleanBarcode.toLowerCase(),
      );
      if (localMatch) {
        addToCart(localMatch);
        setScanFeedback(`✓ ${localMatch.name} added`);
        setScanFeedbackType('success');
        return;
      }

      if (!isOnlineMode) {
        setScanFeedback(`✗ Barcode "${cleanBarcode}" not found in local cache`);
        setScanFeedbackType('error');
        return;
      }

      // 2. Try API barcode search
      try {
        const apiResult = await productService.searchByBarcode(cleanBarcode);
        if (apiResult) {
          addToCart(apiResult);
          setScanFeedback(`✓ ${apiResult.name} added`);
          setScanFeedbackType('success');
          return;
        }
      } catch (err) {
        console.warn('[POS] Barcode lookup failed:', err);
      }

      // 3. If it is a receipt QR/ticket number, open the POS order for editing.
      if (isOnlineMode) {
        try {
          const lookup = await orderService.returnLookup(cleanBarcode);
          const order = lookup.order;
          if (
            order?.source === 'POS' &&
            (!channelId || Number(channelId) === order.sales_channel)
          ) {
            await handleSelectHistoryOrder(order as unknown as OrderListItem);
            setScanFeedback(`✓ Ticket ${order.ticket_id || order.order_number} opened`);
            setScanFeedbackType('success');
            return;
          }
        } catch {
          try {
            const response = await orderService.getAll({
              source: 'POS',
              search: cleanBarcode,
              page_size: 1,
            });
            const [order] = Array.isArray(response) ? response : response.results ?? [];
            if (
              order &&
              (!channelId || Number(channelId) === order.sales_channel)
            ) {
              await handleSelectHistoryOrder(order);
              setScanFeedback(`✓ Ticket ${order.ticket_id || order.order_number} opened`);
              setScanFeedbackType('success');
              return;
            }
          } catch {
            // Not an order QR/ticket; show the normal barcode not-found message.
          }
        }
      }

      // 4. Not found
      setScanFeedback(`✗ Barcode "${cleanBarcode}" not found`);
      setScanFeedbackType('error');
    },
    [addToCart, channelId, channelProducts, handleSelectHistoryOrder, isOnlineMode],
  );

  /* ── Hardware barcode scanner (keyboard input detection) ────────────── */
  useEffect(() => {
    const resetBarcodeBuffer = () => {
      barcodeBuffer.current = '';
      barcodeStartedAt.current = 0;
      barcodeLastKeyAt.current = 0;
      barcodeTarget.current = null;
      clearTimeout(barcodeTimer.current);
    };

    const clearFocusedScannerText = (barcode: string) => {
      const target = barcodeTarget.current;

      if (target instanceof HTMLInputElement) {
        const placeholder = (target.getAttribute('placeholder') || '').toLowerCase();
        if (target.type === 'number') {
          setAmountReceived(0);
        }
        if (placeholder.includes('barcode') || placeholder.includes('search')) {
          setProductSearch('');
        }
        if (target.value.includes(barcode)) {
          target.value = target.value.replace(barcode, '');
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      if (target instanceof HTMLTextAreaElement) {
        setCustomerNote(prev => {
          const index = prev.lastIndexOf(barcode);
          if (index < 0) return prev;
          return `${prev.slice(0, index)}${prev.slice(index + barcode.length)}`;
        });
      }
    };

    const flushBarcodeBuffer = (submittedByEnter: boolean, event?: KeyboardEvent) => {
      const barcode = barcodeBuffer.current.trim();
      if (!barcode) {
        resetBarcodeBuffer();
        return false;
      }

      const finishedAt = submittedByEnter ? Date.now() : barcodeLastKeyAt.current;
      const elapsed = Math.max(1, finishedAt - barcodeStartedAt.current);
      const averageMsPerChar = elapsed / Math.max(1, barcode.length);
      const minLength = submittedByEnter ? SCANNER_ENTER_MIN_LENGTH : SCANNER_AUTO_MIN_LENGTH;
      const maxAverageMs = submittedByEnter ? SCANNER_ENTER_MAX_AVG_MS : SCANNER_AUTO_MAX_AVG_MS;
      const looksLikeScanner =
        barcode.length >= minLength &&
        averageMsPerChar <= maxAverageMs &&
        BARCODE_CHAR_PATTERN.test(barcode);

      resetBarcodeBuffer();

      if (!looksLikeScanner) return false;

      event?.preventDefault();
      event?.stopPropagation();
      clearFocusedScannerText(barcode);
      void handleBarcodeDetected(barcode);
      return true;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === 'Enter') {
        if (barcodeBuffer.current) {
          flushBarcodeBuffer(true, e);
        }
        return;
      }

      if (e.key.length !== 1) return;

      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;

      const now = Date.now();
      if (!barcodeBuffer.current || now - barcodeLastKeyAt.current > SCANNER_RESET_GAP_MS) {
        barcodeBuffer.current = '';
        barcodeStartedAt.current = now;
        barcodeTarget.current = e.target;
      }

      barcodeBuffer.current += e.key;
      barcodeLastKeyAt.current = now;
      clearTimeout(barcodeTimer.current);
      barcodeTimer.current = setTimeout(() => {
        flushBarcodeBuffer(false);
      }, SCANNER_IDLE_FLUSH_MS);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      resetBarcodeBuffer();
    };
  }, [handleBarcodeDetected]);

  // Clear scan feedback after 3 seconds
  useEffect(() => {
    if (!scanFeedback) return;
    const t = setTimeout(() => {
      setScanFeedback(null);
      setScanFeedbackType(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [scanFeedback]);

  /* ── Submit order ──────────────────────────────────────────────────── */
  const executeSubmit = useCallback(async () => {
    if (!channelId || cart.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);

    const currentChannel = channels.find(c => c.id === Number(channelId));
    const isPOS = currentChannel?.channel_type === 'POS';

    if (activePickupOrder) {
      try {
        const result = await orderService.checkoutPOS(activePickupOrder.id, {
          payment_method: paymentMethod,
          payment_method_title:
            paymentMethod === 'cash'
              ? 'Cash'
              : paymentMethod === 'card'
                ? 'Card'
                : 'Bank Transfer',
          customer_note: customerNote,
        });

        setPrintData({
          order: result,
          channel: currentChannel,
          client: selectedClient ?? undefined,
          paymentMethod,
          amountReceived,
          changeAmount,
          cashierName,
          discountTotal: Math.max(0, cartOriginalTotal - cartTotal),
          ticketNumber: result.ticket_id || result.order_number,
          logoSrc: currentChannel?.brand_logo ?? undefined,
        });
        setCompletedOrder(result);
        releasePickupOrder();
        void customerDisplayService.showTotal(0);
        await Promise.all([
          fetchWaitingPOSOrders(),
          fetchPOSHistoryOrders(),
          refreshPOSProductCache(),
        ]);
        notifyCaisseStatsChanged();
        if (isMobile) setCartDrawerOpen(false);
      } catch (err: unknown) {
        setErrorMsg(describeRequestError(err, 'Could not complete this pickup order.'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (activeHistoryOrder) {
      try {
        const editSubtotal = cart.reduce(
          (sum, line) => sum + line.quantity * getUnitPrice(line.product),
          0
        );
        const rawManualDiscount = Number(manualDiscountValue || 0);
        const safeManualDiscount = Number.isFinite(rawManualDiscount)
          ? Math.max(0, rawManualDiscount)
          : 0;
        const editManualDiscount =
          safeManualDiscount <= 0
            ? 0
            : manualDiscountType === 'percentage'
              ? Math.min(editSubtotal, (editSubtotal * Math.min(safeManualDiscount, 100)) / 100)
              : Math.min(editSubtotal, safeManualDiscount);

        const updated = await orderService.editOrder(activeHistoryOrder.id, {
          lines: cart.map(line => {
            const originalLine = activeHistoryOrder.lines?.find(
              existing => existing.product === line.product.id || existing.product_id === line.product.id
            );
            return {
              id: originalLine?.id,
              product: line.product.id,
              product_name: line.product.name,
              barcode: line.product.barcode ?? '',
              quantity: line.quantity,
              unit_price: getUnitPrice(line.product).toFixed(2),
            };
          }),
          discount_type:
            editManualDiscount > 0
              ? manualDiscountType === 'percentage'
                ? 'PERCENTAGE'
                : 'FIXED'
              : 'NONE',
          discount_value:
            editManualDiscount > 0
              ? manualDiscountType === 'percentage'
                ? Math.min(safeManualDiscount, 100).toFixed(2)
                : editManualDiscount.toFixed(2)
              : '0.00',
          customer_note: customerNote,
          internal_note: 'Edited from POS history',
        });

        setPrintData({
          order: updated,
          channel: currentChannel,
          client: selectedClient ?? undefined,
          paymentMethod,
          amountReceived,
          changeAmount,
          cashierName,
          discountTotal: Math.max(0, Number(updated.discount_total || 0)),
          ticketNumber: updated.ticket_id || updated.order_number,
          logoSrc: currentChannel?.brand_logo ?? undefined,
        });
        setCompletedOrder(updated);

        releaseHistoryOrder();
        await Promise.all([
          fetchPOSHistoryOrders(),
          refreshPOSProductCache(),
        ]);
        notifyCaisseStatsChanged();
        if (isMobile) setCartDrawerOpen(false);
      } catch (err: unknown) {
        setErrorMsg(describeRequestError(err, 'Could not update this order.'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Always fetch fresh discounts at submission time — one batch call avoids
    // stale state and N-request race conditions.
    const freshDiscounts: Record<number, number> = {};
    if (isPOS && isOnlineMode && cart.length > 0) {
      try {
        const response = await promotionService.batchCalculateDiscounts({
          product_ids: cart.map(l => l.product.id),
          sales_channel_id: Number(channelId),
        });
        Object.entries(response.results).forEach(([productId, result]) => {
          const p = Number(result.discounted_price);
          if (Number.isFinite(p)) {
            freshDiscounts[Number(productId)] = p;
          }
        });
        // Sync background state so the cart UI stays consistent
        setDiscountedPrices(prev => ({ ...prev, ...freshDiscounts }));
      } catch (err) {
        // Promotions unavailable — submit at original prices
        console.warn('[POS] Promotion fetch failed at submission:', err);
      }
    }

    const getSubmitPrice = (product: ProductListItem): number => {
      const fresh = freshDiscounts[product.id];
      if (typeof fresh === 'number' && Number.isFinite(fresh)) return fresh;
      // Fall back to background-fetched price, then original price
      return getUnitPrice(product);
    };

    const submitSubtotal = cart.reduce(
      (sum, l) => sum + l.quantity * getSubmitPrice(l.product),
      0,
    );
    const rawManualDiscount = Number(manualDiscountValue || 0);
    const safeManualDiscount = Number.isFinite(rawManualDiscount)
      ? Math.max(0, rawManualDiscount)
      : 0;
    const submitManualDiscount =
      safeManualDiscount <= 0
        ? 0
        : manualDiscountType === 'percentage'
          ? Math.min(submitSubtotal, (submitSubtotal * Math.min(safeManualDiscount, 100)) / 100)
          : Math.min(submitSubtotal, safeManualDiscount);
    const submitTotal = Math.max(0, submitSubtotal - submitManualDiscount);

    const ticketIdentity = createOfflineTicketIdentity();
    const payload: POSOrderCreateRequest = {
      sales_channel: Number(channelId),
      ticket_id: ticketIdentity.ticket_id,
      client_ticket_uuid: ticketIdentity.client_ticket_uuid,
      billing: selectedClient
        ? {
            email: selectedClient.email,
            first_name: selectedClient.first_name,
            last_name: selectedClient.last_name,
            phone: selectedClient.phone ?? undefined,
            city: '',
            state: selectedClient.governorate || selectedClient.state || currentChannel?.state || '',
            address_1: selectedClient.address || currentChannel?.address || '',
          }
        : undefined,
      line_items: cart.map(l => ({
        local_product_id: l.product.id,
        name: l.product.name,
        sku: l.product.barcode ?? '',
        quantity: l.quantity,
        price: getSubmitPrice(l.product).toFixed(2),
        total: (l.quantity * getSubmitPrice(l.product)).toFixed(2),
      })),
      payment_method: paymentMethod,
      payment_method_title:
        paymentMethod === 'cash'
          ? 'Cash'
          : paymentMethod === 'card'
            ? 'Card'
            : 'Bank Transfer',
      customer_note: customerNote,
      status: 'completed',
      discount_type:
        submitManualDiscount > 0
          ? manualDiscountType === 'percentage'
            ? 'PERCENTAGE'
            : 'FIXED'
          : 'NONE',
      discount_value:
        submitManualDiscount > 0
          ? manualDiscountType === 'percentage'
            ? Math.min(safeManualDiscount, 100).toFixed(2)
            : submitManualDiscount.toFixed(2)
          : '0.00',
      discount_total: submitManualDiscount.toFixed(2),
      total: submitTotal.toFixed(2),
    };

    const queueCurrentTicketOffline = async (notice?: string): Promise<boolean> => {
      const stockCheck = await offlinePOSService.validateLocalStock(Number(channelId), cart);
      if (!stockCheck.ok) {
        setErrorMsg(stockCheck.message);
        return false;
      }

      const queued: OfflineTicket = await offlinePOSService.queueTicketAndApplySale(
        {
          ...ticketIdentity,
          sales_channel: Number(channelId),
          payload,
          created_at: new Date().toISOString(),
        },
        cart,
      );

      await loadCachedPOSProducts(Number(channelId));
      await refreshPendingOfflineCount();

      const localOrder = {
        id: -Date.now(),
        order_number: queued.ticket_id,
        ticket_id: queued.ticket_id,
        client_ticket_uuid: queued.client_ticket_uuid,
        external_order_id: '',
        company: currentChannel?.company_id ?? 0,
        company_name: '',
        sales_channel: Number(channelId),
        sales_channel_name: currentChannel?.name ?? '',
        brand: currentChannel?.brand ?? null,
        brand_name: currentChannel?.brand_name ?? null,
        client: selectedClient?.id ?? null,
        client_id: selectedClient?.id ?? null,
        client_email: selectedClient?.email ?? null,
        client_phone: selectedClient?.phone ?? null,
        client_name: selectedClient?.full_name ?? null,
        client_points: selectedClient?.points ?? 0,
        status: 'COMPLETED',
        source: 'POS',
        payment_status: 'PAID',
        payment_method:
          paymentMethod === 'cash'
            ? 'Cash'
            : paymentMethod === 'card'
              ? 'Card'
              : 'Bank Transfer',
        billing_phone: selectedClient?.phone ?? '',
        currency: 'TND',
        subtotal: submitSubtotal.toFixed(2),
        tax_total: '0.00',
        shipping_total: '0.00',
        discount_type: payload.discount_type,
        discount_value: payload.discount_value,
        discount_total: submitManualDiscount.toFixed(2),
        total: submitTotal.toFixed(2),
        is_deleted: false,
        line_count: cart.length,
        outcome: 'CONFIRMED',
        confirmed_at: new Date().toISOString(),
        delay_date: null,
        delay_reason: '',
        cancellation_reason: '',
        outcome_note: 'Offline POS checkout',
        outcome_changed_at: new Date().toISOString(),
        delivery_reference: '',
        delivery_code: '',
        delivery_external_reference: '',
        delivery_status_id: null,
        delivery_order_id: null,
        delivery_client_id: null,
        delivery_cod_amount: null,
        delivery_submitted_at: null,
        delivery_submitted_by: null,
        delivery_attempts: 0,
        in_store_pickup: false,
        pos_sales_channel: Number(channelId),
        pos_sales_channel_name: currentChannel?.name ?? null,
        pos_sales_channel_code: currentChannel?.code ?? null,
        sent_to_pos_at: null,
        sent_to_pos_by: null,
        pos_validated_at: new Date().toISOString(),
        pos_validated_by: null,
        returned_at: null,
        returned_by: null,
        return_reason: '',
        stock_restored_at: null,
        stock_restored_by: null,
        delete_reason: '',
        lifecycle_priority: null,
        created_at: queued.created_at,
        updated_at: queued.created_at,
        lines: cart.map((line, index) => {
          const price = getSubmitPrice(line.product);
          return {
            id: -index - 1,
            product: line.product.id,
            product_id: line.product.id,
            external_line_id: `${queued.client_ticket_uuid}:${line.product.id}`,
            wc_product_id: line.product.wc_product_id,
            product_name: line.product.name,
            product_name_from_api: line.product.name,
            product_status: line.product.status,
            barcode: line.product.barcode ?? '',
            product_image: line.product.image_url ?? '',
            quantity: line.quantity,
            unit_price: price.toFixed(2),
            subtotal: (line.quantity * price).toFixed(2),
            tax: '0.00',
            total: (line.quantity * price).toFixed(2),
          };
        }),
      } as unknown as OrderDetail;

      setPrintData({
        order: localOrder,
        channel: currentChannel,
        client: selectedClient ?? undefined,
        paymentMethod,
        amountReceived,
        changeAmount,
        cashierName,
        discountTotal: Math.max(0, cartOriginalTotal - submitTotal),
        ticketNumber: queued.ticket_id,
        logoSrc: currentChannel?.brand_logo ?? undefined,
      });
      setCompletedOrder(localOrder);

      setCart([]);
      setCustomerNote('');
      setManualDiscountValue('');
      setSelectedClient(null);
      setClientSkipped(false);
      void customerDisplayService.showTotal(0);
      if (isMobile) setCartDrawerOpen(false);
      if (notice) toast.warning(notice);
      return true;
    };

    if (!isOnlineMode) {
      try {
        await queueCurrentTicketOffline();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save offline ticket.';
        setErrorMsg(msg);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const result = await orderService.createPOS(payload);

      // Snapshot print data BEFORE clearing state
      setPrintData({
        order: result,
        channel: currentChannel,
        client: selectedClient ?? undefined,
        paymentMethod,
        amountReceived,
        changeAmount,
        cashierName,
        discountTotal: Math.max(0, cartOriginalTotal - submitTotal),
        ticketNumber: result.ticket_id || result.order_number,
        logoSrc: currentChannel?.brand_logo ?? undefined,
      });

      setCompletedOrder(result);

      // Reset form state
      setCart([]);
      setCustomerNote('');
      setManualDiscountValue('');
      setSelectedClient(null);
      setClientSkipped(false);
      void customerDisplayService.showTotal(0);
      await Promise.all([
        fetchPOSHistoryOrders(),
        refreshPOSProductCache(),
      ]);
      notifyCaisseStatsChanged();
      if (isMobile) setCartDrawerOpen(false);
    } catch (err: unknown) {
      if (isConnectivityError(err)) {
        setIsOnlineMode(false);
        try {
          await queueCurrentTicketOffline('Connexion perdue. Ticket enregistré en mode offline.');
          return;
        } catch (offlineErr: unknown) {
          const msg = offlineErr instanceof Error
            ? offlineErr.message
            : 'Connexion perdue et sauvegarde offline impossible.';
          setErrorMsg(msg);
          return;
        }
      }
      setErrorMsg(describeRequestError(err, 'Could not place the order. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }, [
    activeHistoryOrder, activePickupOrder,
    channelId, cart, selectedClient, channels,
    paymentMethod, customerNote, amountReceived, changeAmount,
    manualDiscountType, manualDiscountValue,
    isMobile, getUnitPrice, releaseHistoryOrder, releasePickupOrder, fetchPOSHistoryOrders, fetchWaitingPOSOrders,
    cashierName, cartOriginalTotal, isOnlineMode,
    loadCachedPOSProducts, refreshPendingOfflineCount,
    refreshPOSProductCache, notifyCaisseStatsChanged,
  ]);

  const handleSubmit = useCallback(() => {
    if (activePickupOrder || activeHistoryOrder) {
      executeSubmit();
      return;
    }
    // If customer not selected AND not skipped → show prompt
    if (!selectedClient && !clientSkipped) {
      setClientPromptOpen(true);
      return;
    }
    executeSubmit();
  }, [activeHistoryOrder, activePickupOrder, selectedClient, clientSkipped, executeSubmit]);

  // Called from the prompt dialog when user chooses "Skip"
  const handlePromptSkipAndSubmit = useCallback(() => {
    setClientSkipped(true);
    // Need to execute submit after state update
    setTimeout(() => executeSubmit(), 0);
  }, [executeSubmit]);

  /* ── Print handlers ────────────────────────────────────────────────── */
  const handlePrint = useCallback((mode: 'receipt' | 'invoice') => {
    setPrintMode(mode);
    // Invoice printing needs the shared body-level clone created by
    // printInvoice(). The effect below runs after React mounts InvoiceDocument.
    if (mode === 'invoice') return;

    // Body class switches on the matching print isolation (receipt → pos-print
    // .css). Removed on afterprint (with a timeout fallback).
    const cls = `lk-print-${mode}`;
    document.body.classList.add(cls);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      document.body.classList.remove(cls);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, []);

  useEffect(() => {
    if (printMode !== 'invoice' || !printData) return;
    printInvoice();
  }, [printData, printMode]);

  const handlePrintReceipt = useCallback(async () => {
    if (!printData) {
      handlePrint('receipt');
      return;
    }

    const sentToBridge = await printBridge.printReceipt(
      buildReceiptPayload({
        order: printData.order,
        channel: printData.channel,
        paymentMethod: printData.paymentMethod,
        amountReceived: printData.amountReceived,
        changeAmount: printData.changeAmount,
        cashier: printData.cashierName,
        displaySubtotal:
          Number(printData.order.total || 0) + Number(printData.discountTotal || 0),
        discountTotal: Number(printData.discountTotal || 0),
      }),
    );

    if (!sentToBridge) {
      console.warn('[POS] print bridge offline — falling back to browser print');
      handlePrint('receipt');
    }
  }, [handlePrint, printData]);

  const handleClosePostOrder = useCallback(() => {
    setCompletedOrder(null);
    setPrintData(null);
    setPrintMode(null);
    setAmountReceived(0);
  }, []);

  useEffect(() => {
    const handler = () => setPrintMode(null);
    window.addEventListener('afterprint', handler);
    return () => window.removeEventListener('afterprint', handler);
  }, []);

  /* ── Channel change handler ────────────────────────────────────────── */
  const handleChannelChange = useCallback((v: string) => {
    if (activePickupOrder) {
      releasePickupOrder();
    }
    if (activeHistoryOrder) {
      releaseHistoryOrder();
    }
    try {
      window.localStorage.setItem(POS_SELECTED_CHANNEL_KEY, v);
    } catch (cacheErr) {
      console.warn('[POS] Could not persist selected channel:', cacheErr);
    }
    setChannelId(v);
    setCart([]);
    setAmountReceived(0);
    setManualDiscountValue('');
  }, [activeHistoryOrder, activePickupOrder, releaseHistoryOrder, releasePickupOrder]);

  /* ── Shared cart props ─────────────────────────────────────────────── */
  const canAddClient = !!channelId && !!selectedChannel;
  const pickupOrderLabel = activePickupOrder
    ? `Pickup checkout ${activePickupOrder.order_number}`
    : undefined;
  const pickupOrderMeta = activePickupOrder
    ? `${activePickupOrder.client_name || 'Walk-in pickup'} · ${activePickupOrder.billing_phone || activePickupOrder.client_phone || 'No phone'}`
    : undefined;
  
  const cartProps = {
    cart,
    cartTotal,
    cartOriginalTotal,
    cartItemCount,
    onQtyChange: changeQty,
    onRemove: removeFromCart,
    onClearCart: clearCart,
    getPrice: getUnitPrice,
    clients,
    selectedClient,
    clientSkipped,
    onSelectClient: handleSelectClient,
    onSkipClient: handleSkipClient,
    onClearClient: handleClearClient,
    onAddClientClick: () => {
      // ✨ Validate channel is selected before opening dialog
      if (!canAddClient) {
        setErrorMsg('⚠️ Sales Channel Required: Please select a sales channel first before adding a client.');
        return;
      }
      setAddClientOpen(true);
    },
    canAddClient,  // ✨ Pass to component so it can disable button
    paymentMethod,
    onPaymentMethodChange: setPaymentMethod,
    manualDiscountType,
    manualDiscountValue,
    manualDiscountAmount,
    onManualDiscountTypeChange: setManualDiscountType,
    onManualDiscountValueChange: setManualDiscountValue,
    customerNote,
    onNoteChange: setCustomerNote,
    amountReceived,
    onAmountReceivedChange: setAmountReceived,
    onSubmit: handleSubmit,
    submitting,
    disabled: cart.length === 0 || !channelId,
    readOnlyCart: !!activePickupOrder,
    lockedOrderLabel: activeHistoryOrder
      ? `Editing ticket ${activeHistoryOrder.ticket_id || activeHistoryOrder.order_number}`
      : pickupOrderLabel,
    lockedOrderMeta: activeHistoryOrder
      ? 'Scan products to add, use quantity controls, or remove lines.'
      : pickupOrderMeta,
    onReleaseLockedOrder: activeHistoryOrder ? releaseHistoryOrder : releasePickupOrder,
    onReturnLockedOrder: activeHistoryOrder
      ? () => void handleReturnHistoryOrder(activeHistoryOrder)
      : undefined,
    returningLockedOrder: activeHistoryOrder ? returningOrderId === activeHistoryOrder.id : false,
    submitLabel: activePickupOrder
      ? 'Checkout Pickup'
      : activeHistoryOrder
        ? 'Update & Print Ticket'
        : 'Place Order',
    submittingLabel: activePickupOrder
      ? 'Validating pickup checkout...'
      : activeHistoryOrder
        ? 'Updating ticket...'
        : undefined,
    compact: isMobile,
  };

  /* ── Loading state ─────────────────────────────────────────────────── */
  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="size-5 animate-spin" />
        Loading POS...
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <>
      <div className="flex h-[calc(100dvh-var(--header-height)-2rem)] min-h-[520px] flex-col overflow-hidden lg:flex-row md:h-[calc(100dvh-var(--header-height)-3rem)]">
        {/* ── LEFT: Product Browser ──────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3 lg:p-4">
          <div className="mb-2 flex shrink-0 flex-col gap-2 rounded-md border bg-card/80 px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={isOnlineMode ? 'default' : 'destructive'}
                className="gap-1.5"
              >
                {isOnlineMode ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                {isOnlineMode ? 'Mode en ligne' : 'Mode offline'}
              </Badge>
              <Badge variant="secondary" className="gap-1.5">
                <ShoppingCart className="size-3.5" />
                {pendingOfflineCount} ticket{pendingOfflineCount === 1 ? '' : 's'} en attente
              </Badge>
              {promotionsLoading ? (
                <Badge variant="outline" className="gap-1.5 animate-pulse">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading promotions…
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {offlineLastSyncLabel}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 self-start sm:self-auto"
              onClick={() => {
                void refreshPOSProductCache();
                void syncOfflineTickets();
              }}
              disabled={!channelId || syncingOffline}
            >
              <RefreshCw className={`size-3.5 ${syncingOffline ? 'animate-spin' : ''}`} />
              Sync
            </Button>
          </div>

          {/* Tabs: sales/checkout workflow (Ventes) vs. cash-register
              management — fond, alimentation, dépenses & solde (Caisse). */}
          <Tabs value={posTab} onValueChange={v => setPosTab(v as 'caisse' | 'depenses')} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mb-2 shrink-0 self-start">
              <TabsTrigger value="caisse" className="gap-1.5">
                <ShoppingCart className="size-3.5" /> Ventes
              </TabsTrigger>
              <TabsTrigger value="depenses" className="gap-1.5">
                <Wallet className="size-3.5" /> Caisse
              </TabsTrigger>
            </TabsList>

            <TabsContent value="caisse" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
              <POSProductGrid
                channels={channels}
                channelId={channelId}
                onChannelChange={handleChannelChange}
                productSearch={productSearch}
                onSearchChange={setProductSearch}
                products={channelProducts}
                cartQuantities={cartQuantities}
                onAddToCart={addToCart}
                onCameraScan={() => setCameraOpen(true)}
                isLoading={offlineProducts.length === 0 && isProductsLoading}
                isFetchingNextPage={offlineProducts.length === 0 && isFetchingNextPage}
                hasNextPage={offlineProducts.length === 0 && hasNextPage}
                fetchNextPage={fetchNextPage}
                getPrice={getUnitPrice}
                selectedChannel={selectedChannel}
                waitingOrders={waitingPOSOrders}
                waitingOrdersLoading={waitingPOSLoading || submitting}
                waitingOrderCount={waitingPOSCount}
                selectedWaitingOrderId={activePickupOrder?.id ?? null}
                onSelectWaitingOrder={handleSelectWaitingOrder}
                onRefreshWaitingOrders={fetchWaitingPOSOrders}
                historyOrders={posHistoryOrders}
                historyOrdersLoading={posHistoryLoading || submitting}
                historyOrderCount={posHistoryCount}
                historySearch={posHistorySearch}
                onHistorySearchChange={setPosHistorySearch}
                historyDateFrom={posHistoryDateFrom}
                onHistoryDateFromChange={setPosHistoryDateFrom}
                historyDateTo={posHistoryDateTo}
                onHistoryDateToChange={setPosHistoryDateTo}
                selectedHistoryOrderId={activeHistoryOrder?.id ?? null}
                onSelectHistoryOrder={handleSelectHistoryOrder}
                onReturnHistoryOrder={order => void handleReturnHistoryOrder(order)}
                onRefreshHistoryOrders={fetchPOSHistoryOrders}
              />
            </TabsContent>

            <TabsContent value="depenses" className="mt-0 min-h-0 flex-1 overflow-y-auto">
              <POSCaisseTab
                channelId={channelId ? Number(channelId) : null}
                channelName={selectedChannel?.name}
                refreshSignal={caisseRefreshSignal}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── RIGHT: Cart (desktop only) ─────────────────────────────── */}
        {!isMobile && (
          <div className="flex min-h-0 w-[340px] flex-col border-l bg-card p-3 xl:w-[390px] 2xl:w-[420px]">
            <POSCart {...cartProps} />
          </div>
        )}

        {/* ── Mobile: Sticky bottom bar ──────────────────────────────── */}
        {isMobile && (
          <div className="sticky bottom-0 z-30 bg-background border-t px-4 py-3 flex items-center gap-3 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold tabular-nums truncate">
                {fmtTND(cartTotal)}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  TND
                </span>
              </p>
            </div>
            <Button
              className="gap-2 h-11 px-5"
              onClick={() => setCartDrawerOpen(true)}
            >
              <ShoppingCart className="size-4" />
              Cart
              {cartItemCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0"
                >
                  {cartItemCount}
                </Badge>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* ── Mobile: Cart Drawer ───────────────────────────────────────── */}
      {isMobile && (
        <Drawer
          open={cartDrawerOpen}
          onOpenChange={setCartDrawerOpen}
          direction="bottom"
        >
          <DrawerContent className="flex h-[90dvh] max-h-[90dvh] flex-col">
            <DrawerHeader className="shrink-0 pb-2">
              <DrawerTitle>Shopping Cart</DrawerTitle>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
              <POSCart {...cartProps} />
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* ── Camera barcode scanner ─────────────────────────────────── */}
      <POSCameraScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onBarcodeDetected={handleBarcodeDetected}
        feedbackMessage={scanFeedback}
        feedbackType={scanFeedbackType}
      />

      {/* ── Add client dialog ──────────────────────────────────────── */}
      <POSAddClientDialog
        open={addClientOpen}
        onOpenChange={setAddClientOpen}
        channel={selectedChannel}
        onClientCreated={handleClientCreated}
      />

      {/* ── Client prompt dialog (order validation) ────────────────── */}
      <POSClientPromptDialog
        open={clientPromptOpen}
        onOpenChange={setClientPromptOpen}
        onSelectClient={handleClearClient} // Opens customer section in default state
        onAddClient={() => setAddClientOpen(true)}
        onSkip={handlePromptSkipAndSubmit}
      />

      {/* ── Post-order dialog ────────────────────────────────────────── */}
      <POSPostOrderDialog
        order={completedOrder}
        onClose={handleClosePostOrder}
        onPrintReceipt={handlePrintReceipt}
        onPrintInvoice={() => handlePrint('invoice')}
      />

      {/* ── Error dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!errorMsg} onOpenChange={() => setErrorMsg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Error
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line">{errorMsg}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorMsg(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Hidden print targets ─────────────────────────────────────── */}
      {printMode === 'receipt' && printData && (
        <POSReceiptPrint data={printData} />
      )}
      {printMode === 'invoice' && printData && (
        <InvoiceDocument data={invoiceFromPOS(printData, invoiceCompany ?? null)} />
      )}
    </>
  );
}
