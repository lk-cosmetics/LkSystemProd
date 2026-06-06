/**
 * OrdersPage – Clean, responsive order management with KPI dashboard,
 * filtering, detail/edit dialogs (responsive: Dialog on desktop, Drawer on mobile),
 * WooCommerce sync, and soft-delete support.
 *
 * Architecture:
 *   - Data fetched via service layer (no React Query — matches existing pattern)
 *   - Server-side search/filter/pagination for scalable lists
 *   - Memoised helpers to avoid re-renders
 *   - Mobile-responsive table with progressive column hiding
 *   - Always-visible action buttons (no opacity tricks)
 */
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue, type ReactNode } from 'react';
import {
  ShoppingCart, Search, RefreshCw, Eye, MoreVertical,
  CheckCircle, Clock, Package, Pencil, History, Trash2,
  Undo2, Loader2, TrendingUp,
  Truck, Store, RotateCcw, Star, ArrowUpDown, ArrowUp, ArrowDown,
  X, SlidersHorizontal, AlertTriangle, Phone, ShieldAlert, Plus, Ban,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { orderService } from '@/services/order.service';
import { productService } from '@/services/product.service';
import { salesChannelService } from '@/services/salesChannel.service';
import { useAuthStore } from '@/store/authStore';
import { hasPermission } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import type {
  OrderListItem, OrderDetail, OrderEditLineInput, OrderEditRequest,
  OrderDiscountType, OrderSummary, OrderStatus, SalesChannel, ProductListItem,
  OrderLogEntry, CleanOrderStatus, POSOrderCreateRequest,
} from '@/types';
import type { OrderStatusFieldsPayload, OrderSyncEvent, WooCommerceOrderPreviewResponse, BulkOrderAction } from '@/services/order.service';

import {
  OrderDetailDialog, SyncDialog, PreviewDialog, LogsDialog, MessageAlert,
  SendToPOSDialog, ReturnLookupDialog, ReturnDialog, CreateOrderDialog,
  PackagingDialog,
} from './components/OrderDialogs';
import { CleanStatusBadge, SyncStatusBadge, cleanStatusLabel } from './components/orderStatusBadges';

/* ═══════════════════════════════════════════════════════════════════════════ */
/* HELPERS                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

// Phase 1 raw Order.status palette — still referenced by detail modal helpers
// elsewhere via a runtime lookup, so keep the export. Suppress unused warning.
// @ts-ignore — kept for compatibility with consumers in OrderDialogs.
const STATUS_STYLES: Record<string, string> = {
  PENDING:    'bg-amber-100 text-amber-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  ON_HOLD:    'bg-orange-100 text-orange-800',
  COMPLETED:  'bg-emerald-100 text-emerald-800',
  CANCELLED:  'bg-red-100 text-red-800',
  REFUNDED:   'bg-purple-100 text-purple-800',
  FAILED:     'bg-gray-100 text-gray-800',
};
void STATUS_STYLES;

// How often the priority queue silently refetches so new orders (WooCommerce
// webhooks, POS, manual) appear live without a manual refresh. This is the
// FALLBACK cadence used when the realtime WebSocket is down; when the socket is
// connected we poll far less often (the socket drives immediacy) but never stop
// entirely, so a missed/coalesced event still self-heals.
const ORDERS_REFRESH_MS = 5000;
const ORDERS_REFRESH_FALLBACK_MS = 20000;
// A burst of WebSocket signals (e.g. a 1000-order WooCommerce import) is
// coalesced into at most one silent refetch per this window.
const WS_REFRESH_DEBOUNCE_MS = 600;

const SOURCE_STYLES: Record<string, string> = {
  WOOCOMMERCE: 'bg-indigo-100 text-indigo-800',
  POS:         'bg-teal-100 text-teal-800',
  MANUAL:      'bg-slate-100 text-slate-700',
};

// Social channel a manual order came in on (Instagram, WhatsApp, …).
const ORDER_SOURCE_STYLES: Record<string, string> = {
  instagram: 'bg-pink-100 text-pink-700',
  whatsapp:  'bg-green-100 text-green-700',
  facebook:  'bg-blue-100 text-blue-700',
  tiktok:    'bg-neutral-200 text-neutral-800',
  other:     'bg-slate-100 text-slate-600',
};

const PAYMENT_STYLES: Record<string, string> = {
  PAID:     'bg-emerald-100 text-emerald-800',
  UNPAID:   'bg-red-100 text-red-800',
  PARTIAL:  'bg-amber-100 text-amber-800',
  REFUNDED: 'bg-purple-100 text-purple-800',
};

type OrderFlowTab =
  | 'all'
  | 'pending'
  | 'confirmed'
  | 'not_answered'
  | 'delayed'
  | 'preparing'
  | 'done'
  | 'returns'
  | 'canceled'
  | 'deleted';

const DEFAULT_ORDERING = 'lifecycle_priority,-client__points,-created_at';

// Phase D — the tabs speak ONE language: the clean derived ``order_status``.
// Each tab maps to the order_status value(s) it represents, so the tab filter
// (?order_status=…), the count (order_status_kpis.by_status) and the row chip
// (CleanStatusBadge) are always consistent. 'all' and 'deleted' are special
// (no order_status filter); 'deleted' is gated by view_soft_deleted_orders.
const FLOW_TABS: Array<{
  value: OrderFlowTab;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  statuses: CleanOrderStatus[];
}> = [
  { value: 'all',          label: 'All',          shortLabel: 'All',     icon: <ShoppingCart className="size-3.5" />, statuses: [] },
  { value: 'pending',      label: 'Pending',      shortLabel: 'Pending', icon: <Clock className="size-3.5" />,        statuses: ['new', 'awaiting_confirmation'] },
  { value: 'confirmed',    label: 'Confirmed',    shortLabel: 'Conf',    icon: <CheckCircle className="size-3.5" />,  statuses: ['confirmed'] },
  { value: 'not_answered', label: 'Not Answered', shortLabel: 'No ans',  icon: <Phone className="size-3.5" />,        statuses: ['not_answered'] },
  { value: 'delayed',      label: 'Delayed',      shortLabel: 'Delay',   icon: <Clock className="size-3.5" />,        statuses: ['delayed'] },
  { value: 'preparing',    label: 'Preparing',    shortLabel: 'Prep',    icon: <Package className="size-3.5" />,      statuses: ['preparing'] },
  { value: 'done',         label: 'Done',         shortLabel: 'Done',    icon: <CheckCircle className="size-3.5" />,  statuses: ['done'] },
  { value: 'returns',      label: 'Returns',      shortLabel: 'Return',  icon: <RotateCcw className="size-3.5" />,    statuses: ['returned', 'exchanged'] },
  { value: 'canceled',     label: 'Canceled',     shortLabel: 'Cancel',  icon: <X className="size-3.5" />,            statuses: ['canceled'] },
  { value: 'deleted',      label: 'Deleted',      shortLabel: 'Trash',   icon: <Trash2 className="size-3.5" />,       statuses: [] },
];

// Phase D — admin/manager backward overrides. Mirrors the backend
// ALLOWED_MANUAL_TRANSITIONS exactly; the server re-validates, so this map is
// purely to drive the UI (which targets to offer, when to show the action).
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  done:         ['preparing'],
  preparing:    ['confirmed'],
  confirmed:    ['awaiting_confirmation'],
  delayed:      ['awaiting_confirmation'],
  not_answered: ['awaiting_confirmation'],
  canceled:     ['awaiting_confirmation', 'confirmed'],
  returned:     ['done'],
  exchanged:    ['done'],
};

function getPrimarySort(ordering: string) {
  const first = ordering.split(',')[0] || DEFAULT_ORDERING;
  return {
    field: first.replace(/^-/, ''),
    direction: first.startsWith('-') ? 'desc' : 'asc',
  };
}

function stringifyApiError(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => stringifyApiError(item)).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    const direct = stringifyApiError(data.detail) ?? stringifyApiError(data.message) ?? stringifyApiError(data.error);
    if (direct) return direct;

    const fieldMessages = Object.entries(data)
      .map(([field, fieldValue]) => {
        const message = stringifyApiError(fieldValue);
        return message ? `${field}: ${message}` : null;
      })
      .filter(Boolean);
    return fieldMessages.length ? fieldMessages.join(' ') : null;
  }
  return null;
}

function extractErrorMessage(error: unknown, fallback: string) {
  const responseData = (error as { response?: { data?: unknown } } | null)?.response?.data;
  return stringifyApiError(responseData) ?? (error instanceof Error ? error.message : fallback);
}

function SortableHead({
  label,
  field,
  ordering,
  onSort,
  className,
}: Readonly<{
  label: string;
  field: string;
  ordering: string;
  onSort: (field: string) => void;
  className?: string;
}>) {
  const active = getPrimarySort(ordering);
  const isActive = active.field === field;
  const Icon = !isActive ? ArrowUpDown : active.direction === 'desc' ? ArrowDown : ArrowUp;

  return (
    <TableHead className={`h-10 text-xs font-semibold ${className ?? ''}`}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 gap-1.5 px-2 text-xs font-semibold"
        onClick={() => onSort(field)}
      >
        {label}
        <Icon className={`size-3.5 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`} />
      </Button>
    </TableHead>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className={`text-xs border-transparent ${SOURCE_STYLES[source] ?? ''}`}>
      {source}
    </Badge>
  );
}

function OrderSourceBadge({ source, label }: { source: string; label?: string }) {
  if (!source) return null;
  return (
    <Badge variant="outline" className={`text-[10px] border-transparent ${ORDER_SOURCE_STYLES[source] ?? 'bg-slate-100 text-slate-600'}`}>
      {label || source}
    </Badge>
  );
}

function PaymentBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs border-transparent ${PAYMENT_STYLES[status] ?? ''}`}>
      {status}
    </Badge>
  );
}

const fmtCurrency = (currency: string, value: string) => `${currency} ${value}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const isDirectPOSCompleted = (order: OrderListItem) =>
  order.source === 'POS' && order.status === 'COMPLETED' && !order.in_store_pickup;

function PriorityBadge({ priority }: { priority?: number | null }) {
  if (!priority || priority > 5) return <Badge variant="outline" className="text-[10px]">Normal</Badge>;
  if (priority <= 2) return <Badge className="text-[10px] bg-rose-600 hover:bg-rose-600">Call client</Badge>;
  return <Badge className="text-[10px] bg-blue-600 hover:bg-blue-600">Next step</Badge>;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* KPI CARD                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

function KpiCard({ title, value, tone, icon }: Readonly<{
  title: string; value: string | number; tone?: string; icon?: ReactNode;
}>) {
  return (
    <Card>
      <CardHeader className="p-4 pb-1">
        <CardTitle className={`text-xs flex items-center gap-1 text-muted-foreground ${tone ?? ''}`}>
          {icon}{title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className={`text-2xl font-bold tracking-tight tabular-nums ${tone ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MAIN PAGE                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function OrdersPage() {
  /* ── core state ─── */
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [flowFilter, setFlowFilter] = useState<OrderFlowTab>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [ordering, setOrdering] = useState(DEFAULT_ORDERING);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const pageSize = 20;

  /* ── detail / edit state ─── */
  const [viewOrder, setViewOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editLockToken, setEditLockToken] = useState('');
  // Take-over prompt shown when another user already holds this order's lock.
  const [takeoverInfo, setTakeoverInfo] = useState<{ orderId: number; userName: string } | null>(null);
  // Mirror of the active lock so it can be best-effort released on page unload.
  const lockRef = useRef<{ orderId: number; token: string } | null>(null);
  const [editForm, setEditForm] = useState<OrderEditRequest | null>(null);
  const [editProducts, setEditProducts] = useState<ProductListItem[]>([]);
  const [loadingEditProducts, setLoadingEditProducts] = useState(false);
  const [packagingProducts, setPackagingProducts] = useState<ProductListItem[]>([]);
  const [loadingPackagingProducts, setLoadingPackagingProducts] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [mutatingOrder, setMutatingOrder] = useState(false);
  const [logsDialog, setLogsDialog] = useState(false);
  const [orderLogs, setOrderLogs] = useState<OrderLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [sendPOSDialog, setSendPOSDialog] = useState(false);
  const [sendPOSOrder, setSendPOSOrder] = useState<OrderDetail | null>(null);
  const [selectedPOSChannel, setSelectedPOSChannel] = useState('');

  // ── Bulk selection + group actions ───────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPosOpen, setBulkPosOpen] = useState(false);
  const [bulkPosChannel, setBulkPosChannel] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [sendingPOS, setSendingPOS] = useState(false);
  const [returnLookupDialog, setReturnLookupDialog] = useState(false);
  const [returnLookupLoading, setReturnLookupLoading] = useState(false);
  const [lookupMode, setLookupMode] = useState<'return' | 'packaging'>('return');
  // Focused packaging popup — opens from the "Scan Packaging" lookup and
  // automatically after an order is dispatched to the delivery API. It loads
  // its own packaging products so it works independently of the detail dialog.
  const [packagingDialogOpen, setPackagingDialogOpen] = useState(false);
  const [packagingDialogOrder, setPackagingDialogOrder] = useState<OrderDetail | null>(null);
  const [packagingDialogWarnings, setPackagingDialogWarnings] = useState<string[]>([]);
  const [packagingDialogProducts, setPackagingDialogProducts] = useState<ProductListItem[]>([]);
  const [loadingPackagingDialogProducts, setLoadingPackagingDialogProducts] = useState(false);
  // Per-item return / exchange disposition (back to stock vs damaged vs missing).
  const [returnOrder, setReturnOrder] = useState<OrderDetail | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  // Manual order creation.
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);

  /* ── manual status rollback (Phase D) ─── */
  const [manualOrder, setManualOrder] = useState<OrderListItem | OrderDetail | null>(null);
  const [manualTarget, setManualTarget] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  /* ── sync state ─── */
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [syncDialog, setSyncDialog] = useState(false);
  const [selectedSyncChannel, setSelectedSyncChannel] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [previewData, setPreviewData] = useState<WooCommerceOrderPreviewResponse | null>(null);
  const [selectedWcOrders, setSelectedWcOrders] = useState<number[]>([]);
  const [syncingSelected, setSyncingSelected] = useState(false);
  const [activeSyncEvent, setActiveSyncEvent] = useState<OrderSyncEvent | null>(null);

  /* ── alert state ─── */
  const [successDialog, setSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorDialog, setErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const user = useAuthStore(s => s.user);
  // Cross-brand order filter is for users who span multiple brands
  // (company-scoped roles hold switch_brands; superuser bypasses).
  const canFilterByBrand = hasPermission(user, 'switch_brands');
  // Revenue aggregates are sensitive financial data — only Super Admin / CEO
  // (anyone holding can_view_financial_reports) sees them. The backend strips
  // the figures for everyone else, so a revenue card renders ONLY when the
  // value is actually present. That presence is the authoritative gate and
  // also avoids a stale permission cache rendering "TND undefined".
  const canViewRevenue = hasPermission(user, 'can_view_financial_reports');
  const showRevenue = canViewRevenue && summary?.revenue != null;
  const showNetRevenue =
    canViewRevenue && summary?.order_status_kpis?.revenue != null;
  const canImportOrders = hasPermission(user, 'import_orders');
  const canCreateOrders = hasPermission(user, 'create_orders');
  const canUpdateUnconfirmedOrders = hasPermission(user, 'update_unconfirmed_orders');
  const canUpdateConfirmedOrders = hasPermission(user, 'update_confirmed_orders');
  const canConfirmOrders = hasPermission(user, 'confirm_orders');
  const canDelayOrders = hasPermission(user, 'delay_orders');
  const canCancelOrders = hasPermission(user, 'cancel_orders_lifecycle');
  const canSendToPos = hasPermission(user, 'send_to_pos_orders');
  const canValidatePos = hasPermission(user, 'validate_pos_orders');
  const canSendToDelivery = hasPermission(user, 'send_to_delivery_orders');
  const canProcessReturn = hasPermission(user, 'process_return_orders');
  const canPackageOrders = canUpdateConfirmedOrders;
  const canSoftDelete = hasPermission(user, 'soft_delete_orders');
  const canRestoreDeleted = hasPermission(user, 'restore_soft_deleted_orders');
  const canViewDeleted = hasPermission(user, 'view_soft_deleted_orders');
  // Phase D — admin/manager-only audited backward status override.
  const canManualOverride = hasPermission(user, 'manual_status_override');
  const deferredSearch = useDeferredValue(search);

  /* ── brand/channel maps ─── */
  const availableBrands = useMemo(() => {
    const m = new Map<number, string>();
    channels.forEach(c => { if (!m.has(c.brand)) m.set(c.brand, c.brand_name); });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  const visibleFlowTabs = useMemo(
    () => FLOW_TABS.filter(tab => tab.value !== 'deleted' || canViewDeleted),
    [canViewDeleted],
  );

  const hasActiveFilters = Boolean(
    deferredSearch ||
    flowFilter !== 'all' ||
    statusFilter !== 'all' ||
    sourceFilter !== 'all' ||
    paymentFilter !== 'all' ||
    brandFilter !== 'all' ||
    channelFilter !== 'all' ||
    includeDeleted ||
    ordering !== DEFAULT_ORDERING,
  );

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* DATA FETCHING                                                            */
  /* ══════════════════════════════════════════════════════════════════════════ */

  const handleSort = useCallback((field: string) => {
    setOrdering(prev => {
      const current = getPrimarySort(prev);
      if (current.field !== field) return field === 'created_at' ? `-${field}` : field;
      return current.direction === 'asc' ? `-${field}` : field;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setFlowFilter('all');
    setStatusFilter('all');
    setSourceFilter('all');
    setPaymentFilter('all');
    setBrandFilter('all');
    setChannelFilter('all');
    setIncludeDeleted(false);
    setOrdering(DEFAULT_ORDERING);
  }, []);

  const fetchData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const sharedFilters = {
        ...(statusFilter !== 'all' ? { status: statusFilter as OrderStatus } : {}),
        ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
        ...(paymentFilter !== 'all' ? { payment_status: paymentFilter } : {}),
        ...(brandFilter !== 'all' ? { brand: Number(brandFilter) } : {}),
        ...(channelFilter !== 'all' ? { sales_channel: Number(channelFilter) } : {}),
        ...(deferredSearch ? { search: deferredSearch } : {}),
      };
      // Phase D — translate the active tab into the clean order_status filter.
      // 'all' filters nothing; 'deleted' is orthogonal to order_status so it
      // keeps the dedicated is_deleted flow; every other tab maps to one or
      // more order_status values (joined for grouped tabs like Pending/Returns).
      const activeTab = FLOW_TABS.find(t => t.value === flowFilter);
      const tabParams: { flow?: string; order_status?: string } =
        flowFilter === 'all'
          ? {}
          : flowFilter === 'deleted'
            ? { flow: 'deleted' }
            : { order_status: (activeTab?.statuses ?? []).join(',') };
      const [ordersRes, summaryRes] = await Promise.all([
        orderService.getAll({
          page: currentPage,
          page_size: pageSize,
          include_deleted: (includeDeleted || flowFilter === 'deleted') && canViewDeleted,
          ordering,
          ...tabParams,
          ...sharedFilters,
        }),
        orderService.getSummary(sharedFilters),
      ]);
      const paginated = !Array.isArray(ordersRes) && Array.isArray(ordersRes.results);
      setOrders(paginated ? ordersRes.results : ordersRes);
      setTotalOrders(paginated ? ordersRes.count : ordersRes.length);
      setSummary(summaryRes);
    } catch (err) {
      console.error('Failed to fetch orders', err);
    }
    // Channels change rarely — skip them on silent auto-refresh ticks.
    if (!silent) {
      try {
        const ch = await salesChannelService.getAllChannels();
        setChannels(ch);
      } catch (err) {
        console.error('Failed to fetch channels', err);
      }
    }
    if (!silent) setLoading(false);
  }, [
    brandFilter,
    canViewDeleted,
    channelFilter,
    currentPage,
    deferredSearch,
    flowFilter,
    includeDeleted,
    ordering,
    paymentFilter,
    sourceFilter,
    statusFilter,
  ]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Real-time auto-refresh ────────────────────────────────────────────────
  // The priority queue refetches SILENTLY (no spinner) on an interval so new
  // orders show up live. A tick is skipped when the tab is hidden or the user is
  // mid-action (detail open, rows selected, or a mutation in flight) so the
  // refresh never disrupts them or wipes a selection.
  // Realtime connection state — drives the "Live" badge and the fallback poll
  // cadence (slow when the socket is up, fast when it's down).
  const [wsConnected, setWsConnected] = useState(false);
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoRefreshBlockedRef = useRef(false);
  autoRefreshBlockedRef.current =
    mutatingOrder || bulkBusy || selectedIds.size > 0 || !!viewOrder;

  useEffect(() => {
    const pollMs = wsConnected ? ORDERS_REFRESH_FALLBACK_MS : ORDERS_REFRESH_MS;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (autoRefreshBlockedRef.current) return;
      fetchData({ silent: true });
    };
    const id = window.setInterval(tick, pollMs);
    const onVisible = () => {
      if (!document.hidden && !autoRefreshBlockedRef.current) fetchData({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchData, wsConnected]);

  // ── Realtime push (WebSocket) ─────────────────────────────────────────────
  // The daphne sidecar pushes a lightweight signal (order id + status) the
  // instant an order is created/updated/deleted anywhere in the user's scope.
  // Bursts (e.g. a 1000-order WooCommerce import) are coalesced into a single
  // SILENT refetch, and we skip while the user is mid-action. The authoritative,
  // server-scoped list still comes from REST, so the socket can never surface an
  // order the user may not see. The interval poll above stays as an automatic
  // fallback, so losing the socket is a non-event.
  const requestSilentRefresh = useCallback(() => {
    if (wsDebounceRef.current) return; // a refetch is already queued this window
    wsDebounceRef.current = setTimeout(() => {
      wsDebounceRef.current = null;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (autoRefreshBlockedRef.current) return;
      fetchData({ silent: true });
    }, WS_REFRESH_DEBOUNCE_MS);
  }, [fetchData]);

  useEffect(
    () => () => {
      if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current);
    },
    [],
  );

  const handleWsStatus = useCallback((connected: boolean) => {
    setWsConnected(connected);
  }, []);

  useWebSocket({
    path: '/ws/orders/',
    onMessage: requestSilentRefresh,
    onStatusChange: handleWsStatus,
  });

  useEffect(() => {
    if (!activeSyncEvent || activeSyncEvent.status !== 'RUNNING') return;
    const syncEventId = activeSyncEvent.id;

    let cancelled = false;
    const poll = async () => {
      try {
        const event = await orderService.getSyncEvent(syncEventId);
        if (cancelled) return;
        setActiveSyncEvent(event);
        if (event.status !== 'RUNNING') {
          await fetchData();
          const action = event.status === 'FAILED' ? setErrorMessage : setSuccessMessage;
          action(
            event.status === 'FAILED'
              ? `WooCommerce sync failed: ${event.error_detail?.[0]?.error ?? 'Unknown error'}`
              : `WooCommerce sync finished: ${event.created_count} created, ${event.updated_count} updated${event.error_count ? `, ${event.error_count} errors` : ''}.`
          );
          if (event.status === 'FAILED') setErrorDialog(true);
          else setSuccessDialog(true);
        }
      } catch (err) {
        console.warn('Failed to refresh sync event', err);
      }
    };

    const interval = window.setInterval(poll, 4000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSyncEvent?.id, activeSyncEvent?.status, fetchData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    brandFilter,
    channelFilter,
    deferredSearch,
    flowFilter,
    includeDeleted,
    ordering,
    paymentFilter,
    sourceFilter,
    statusFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* DETAIL / EDIT ACTIONS                                                    */
  /* ══════════════════════════════════════════════════════════════════════════ */

  const openDetail = async (id: number, opts?: { force?: boolean }) => {
    setDetailLoading(true);
    try {
      // Acquire (or take over) the exclusive lock BEFORE opening the popup —
      // the backend is the source of truth for who is handling the order.
      let lockResult;
      try {
        lockResult = await orderService.acquireEditLock(id, opts?.force ?? false);
      } catch (err: unknown) {
        const response = (err as { response?: { status?: number; data?: { lock?: { user_name?: string | null } } } }).response;
        if (response?.status === 409 && !opts?.force) {
          // Held by someone else → ask whether to take over (take-over dialog).
          setTakeoverInfo({ orderId: id, userName: response.data?.lock?.user_name || 'another user' });
          return;
        }
        throw err;
      }

      const detail = await orderService.getById(id);
      setEditLockToken(lockResult.lock.token);
      setViewOrder(detail);
      setEditMode(false);
      const customerLines = detail.customer_lines ?? detail.lines.filter(line => line.product_type !== 'packaging_item');
      setEditForm({
        lines: customerLines.map((l): OrderEditLineInput => ({
          id: l.id, product: l.product, product_name: l.product_name,
          barcode: l.barcode, quantity: l.quantity, unit_price: l.unit_price,
        })),
        discount_type: detail.discount_type,
        discount_value: detail.discount_value,
        customer_note: detail.customer_note,
        internal_note: detail.internal_note,
        // Billing fields
        billing_first_name: detail.billing_first_name,
        billing_last_name: detail.billing_last_name,
        billing_company: detail.billing_company,
        billing_email: detail.billing_email,
        billing_phone: detail.billing_phone,
        billing_address_1: detail.billing_address_1,
        billing_address_2: detail.billing_address_2,
        billing_city: detail.billing_city,
        billing_state: detail.billing_state,
        billing_postcode: detail.billing_postcode,
        billing_country: detail.billing_country,
      });
    } catch (err) {
      console.error('Failed to load order detail', err);
      setErrorMessage(extractErrorMessage(err, 'Failed to load order detail.'));
      setErrorDialog(true);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleStatusChange = async (id: number, status: OrderStatus) => {
    try {
      await orderService.updateStatus(id, status);
      const updated = await orderService.getById(id);
      setViewOrder(updated);
      fetchData();
    } catch (err) {
      console.error('Failed to update status', err);
      setErrorMessage(extractErrorMessage(err, 'Failed to update status.'));
      setErrorDialog(true);
    }
  };

  const handleStatusFieldsChange = async (id: number, payload: OrderStatusFieldsPayload) => {
    try {
      const updated = await orderService.updateStatusFields(id, payload);
      setViewOrder(updated);
      fetchData();
      setSuccessMessage('Order status updated.');
      setSuccessDialog(true);
    } catch (err) {
      console.error('Failed to update order statuses', err);
      setErrorMessage(extractErrorMessage(err, 'Failed to update order statuses.'));
      setErrorDialog(true);
    }
  };

  const handleEditModeChange = (enabled: boolean) => {
    if (!viewOrder) return;
    // The exclusive lock is acquired when the popup opens and held for its whole
    // lifetime (released on close / takeover), so toggling edit mode only flips
    // the UI here — there is no separate lock to acquire or release.
    setEditMode(enabled);
  };

  // Keep the lock alive while the popup is open. A 409 means another user took
  // the order over, so we close our popup (the backend rejects us anyway).
  useEffect(() => {
    if (!viewOrder || !editLockToken) return undefined;
    const timer = window.setInterval(async () => {
      try {
        await orderService.heartbeatEditLock(viewOrder.id, editLockToken);
      } catch (err: unknown) {
        const response = (err as { response?: { data?: { lock?: { user_name?: string | null } } } }).response;
        const name = response?.data?.lock?.user_name || 'another user';
        setEditLockToken('');
        setEditMode(false);
        setViewOrder(null);
        setErrorMessage(`This order was taken over by ${name}.`);
        setErrorDialog(true);
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [editMode, editLockToken, viewOrder?.id]);

  // Mirror the active lock into a ref + release it best-effort if the user
  // navigates away or closes the tab with the popup still open. The 90s server
  // TTL is the ultimate safety net for closed tabs and logout.
  useEffect(() => {
    lockRef.current = viewOrder && editLockToken
      ? { orderId: viewOrder.id, token: editLockToken }
      : null;
  }, [editLockToken, viewOrder?.id]);
  useEffect(() => {
    const release = () => {
      const l = lockRef.current;
      if (l) orderService.releaseEditLock(l.orderId, l.token).catch(() => undefined);
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, []);

  useEffect(() => {
    if (!viewOrder) {
      setPackagingProducts([]);
      return;
    }
    const brandId = viewOrder.brand ?? channels.find(c => c.id === viewOrder.sales_channel)?.brand;
    if (!brandId) {
      setPackagingProducts([]);
      return;
    }
    setLoadingPackagingProducts(true);
    productService.getAllProducts({ brand: brandId, product_type: 'packaging_item', page_size: 500 })
      .then(products => setPackagingProducts(products || []))
      .catch(err => {
        console.error('Failed to load packaging products:', err);
        setPackagingProducts([]);
      })
      .finally(() => setLoadingPackagingProducts(false));
  }, [viewOrder?.id, viewOrder?.brand, viewOrder?.sales_channel, channels]);

  // Packaging products for the dedicated packaging popup (independent of the
  // detail dialog's order, since the popup can be opened straight from a lookup
  // or right after dispatching to delivery).
  useEffect(() => {
    if (!packagingDialogOrder) {
      setPackagingDialogProducts([]);
      return;
    }
    const brandId = packagingDialogOrder.brand
      ?? channels.find(c => c.id === packagingDialogOrder.sales_channel)?.brand;
    if (!brandId) {
      setPackagingDialogProducts([]);
      return;
    }
    setLoadingPackagingDialogProducts(true);
    productService.getAllProducts({ brand: brandId, product_type: 'packaging_item', page_size: 500 })
      .then(products => setPackagingDialogProducts(products || []))
      .catch(err => {
        console.error('Failed to load packaging products:', err);
        setPackagingDialogProducts([]);
      })
      .finally(() => setLoadingPackagingDialogProducts(false));
  }, [packagingDialogOrder?.id, packagingDialogOrder?.brand, packagingDialogOrder?.sales_channel, channels]);

  // Load products when entering edit mode
  useEffect(() => {
    if (!editMode || !viewOrder) { 
      setEditProducts([]); 
      return; 
    }
    
    // Determine brand ID from current view
    const brandId = viewOrder.brand ?? channels.find(c => c.id === viewOrder.sales_channel)?.brand;
    if (!brandId) { 
      console.warn('No brand found for order', viewOrder.id);
      setEditProducts([]); 
      return; 
    }

    setLoadingEditProducts(true);
    productService.getAllProducts({ brand: brandId, page_size: 500 })
      .then(products => {
        if (!products || products.length === 0) {
          console.warn(`No products found for brand ${brandId}`);
        }
        setEditProducts((products || []).filter(product => product.product_type !== 'packaging_item'));
      })
      .catch(err => {
        console.error('Failed to load edit products:', err);
        setEditProducts([]);
      })
      .finally(() => setLoadingEditProducts(false));
  }, [editMode, viewOrder, channels]);

  /* ── edit form helpers ─── */
  const updateEditLine = useCallback((index: number, key: 'quantity' | 'unit_price', value: string) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const lines = [...prev.lines];
      const cur = lines[index];
      if (!cur) return prev;
      if (key === 'quantity') {
        const qty = Number(value);
        lines[index] = { ...cur, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
      } else {
        lines[index] = { ...cur, unit_price: String(value || '0.00') };
      }
      return { ...prev, lines };
    });
  }, []);

  const updateEditLineProduct = useCallback((index: number, selectedValue: string) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const lines = [...prev.lines];
      const cur = lines[index];
      if (!cur) return prev;

      // Manual entry mode
      if (selectedValue === '__manual__') {
        lines[index] = { 
          ...cur, 
          product: null, 
          product_name: cur.product_name ?? '',
          quantity: cur.quantity || 1,
          unit_price: cur.unit_price || '0.00',
          barcode: cur.barcode || '',
        };
        return { ...prev, lines };
      }

      // Lookup product from loaded products
      const pid = Number(selectedValue);
      const selectedProduct = editProducts.find(x => x.id === pid);
      
      if (!selectedProduct) {
        console.warn(`Product ${pid} not found in editProducts. Available: ${editProducts.map(p => p.id).join(',')}`);
        return prev;
      }

      // Sync all product data including price
      lines[index] = {
        ...cur, 
        product: selectedProduct.id, 
        product_name: selectedProduct.name,
        barcode: selectedProduct.barcode || cur.barcode || '',
        quantity: cur.quantity || 1,
        unit_price: String(selectedProduct.sales_price || cur.unit_price || '0.00'),
      };
      return { ...prev, lines };
    });
  }, [editProducts]);

  const handleAddLine = useCallback(() => {
    setEditForm(prev => prev ? {
      ...prev,
      lines: [...prev.lines, { product: null, product_name: '', barcode: '', quantity: 1, unit_price: '0.00' }],
    } : prev);
  }, []);

  const handleRemoveLine = useCallback((index: number) => {
    setEditForm(prev => {
      if (!prev || prev.lines.length <= 1) return prev;
      return { ...prev, lines: prev.lines.filter((_, i) => i !== index) };
    });
  }, []);

  const handleSaveEdit = async () => {
    if (!viewOrder || !editForm) return;
    if (editForm.lines.some(l => !l.product && !(l.product_name ?? '').trim())) {
      setErrorMessage('Each line must have either a product or a name.'); setErrorDialog(true);
      return;
    }

    setSavingEdit(true);
    try {
      const payload: OrderEditRequest = {
        ...editForm,
        discount_type: (editForm.discount_type ?? 'NONE') as OrderDiscountType,
        discount_value: editForm.discount_value ?? '0.00',
        lines: editForm.lines.map(l => ({
          id: l.id, product: l.product, product_name: l.product_name, barcode: l.barcode,
          quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
          unit_price: String(l.unit_price ?? '0'),
        })),
      };
      const updated = await orderService.editOrder(viewOrder.id, payload);
      if (editLockToken) {
        orderService.releaseEditLock(viewOrder.id, editLockToken).catch(() => undefined);
        setEditLockToken('');
      }
      setViewOrder(updated);
      setEditMode(false);
      await fetchData();
      setSuccessMessage('Order updated successfully.'); setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to update order.')); setErrorDialog(true);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      await orderService.softDelete(viewOrder.id, 'Deleted from Orders page');
      setViewOrder(null); setEditMode(false);
      await fetchData();
      setSuccessMessage('Order soft-deleted.'); setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to delete.')); setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleRestoreOrder = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      const restored = await orderService.restore(viewOrder.id);
      setViewOrder(restored);
      await fetchData();
      setSuccessMessage('Order restored.'); setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to restore.')); setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleOpenLogs = async () => {
    if (!viewOrder) return;
    setLoadingLogs(true); setLogsDialog(true);
    try {
      setOrderLogs(await orderService.getLogs(viewOrder.id));
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to load logs.')); setErrorDialog(true);
      setLogsDialog(false);
    } finally { setLoadingLogs(false); }
  };

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* ORDER OUTCOME HANDLERS                                                   */
  /* ══════════════════════════════════════════════════════════════════════════ */

  const handleConfirmOrder = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.confirmOrder(id);
      setViewOrder(updated);
      await fetchData();
      setSuccessMessage('Order confirmed successfully.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to confirm order.'));
      setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleNotAnswered = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.markNotAnswered(id);
      setViewOrder(updated);
      await fetchData();
      const attempts = updated.not_answered_attempts ?? 0;
      setSuccessMessage(
        attempts > 3
          ? `No answer recorded (${attempts} attempts). You can now delay or cancel the order.`
          : `No answer recorded (${attempts} attempt${attempts === 1 ? '' : 's'}).`
      );
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to record no-answer attempt.'));
      setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleDelayOrder = async (id: number, data: { delay_date: string; delay_reason: string; note?: string }) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.delayOrder(id, data);
      setViewOrder(updated);
      await fetchData();
      setSuccessMessage('Order marked as delayed.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to delay order.'));
      setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleRestoreDelayed = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.restoreDelayed(id);
      setViewOrder(updated);
      await fetchData();
      setSuccessMessage('Delayed order restored to pending.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to restore delayed order.'));
      setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const handleCancelOrder = async (id: number, data: { cancellation_reason: string; note?: string }) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.cancelOrder(id, data);
      setViewOrder(updated);
      await fetchData();
      setSuccessMessage('Order cancelled.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to cancel order.'));
      setErrorDialog(true);
    } finally { setMutatingOrder(false); }
  };

  const runLifecycleAction = async (
    action: () => Promise<OrderDetail | unknown>,
    success: string,
    reloadDetail = false,
  ) => {
    setMutatingOrder(true);
    try {
      const result = await action();
      if (reloadDetail && viewOrder) {
        setViewOrder(await orderService.getById(viewOrder.id));
      } else if (result && typeof result === 'object' && 'id' in result) {
        setViewOrder(result as OrderDetail);
      }
      await fetchData();
      setSuccessMessage(success);
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Order action failed.'));
      setErrorDialog(true);
    } finally {
      setMutatingOrder(false);
    }
  };

  /* ── Bulk selection + group actions ─── */
  // Only non-deleted rows are selectable; deleted orders are excluded everywhere.
  const selectableOrders = useMemo(() => orders.filter(o => !o.is_deleted), [orders]);
  const allVisibleSelected =
    selectableOrders.length > 0 && selectableOrders.every(o => selectedIds.has(o.id));
  const someVisibleSelected = selectableOrders.some(o => selectedIds.has(o.id));

  // Any time the visible order set is replaced (page, filter, sort, refetch),
  // drop the selection so we never act on rows the user can no longer see.
  useEffect(() => { setSelectedIds(new Set()); }, [orders]);

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selectableOrders.every(o => next.has(o.id))) {
        selectableOrders.forEach(o => next.delete(o.id));
      } else {
        selectableOrders.forEach(o => next.add(o.id));
      }
      return next;
    });
  };
  const toggleSelectOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const selectedOrders = useMemo(
    () => orders.filter(o => selectedIds.has(o.id)),
    [orders, selectedIds],
  );
  // Mirror the per-row gates: only confirmed orders not already routed qualify.
  const posEligibleIds = useMemo(
    () => selectedOrders
      .filter(o => !o.is_deleted && o.outcome === 'CONFIRMED' && !o.sent_to_pos_at && !o.delivery_reference)
      .map(o => o.id),
    [selectedOrders],
  );
  const deliveryEligibleIds = useMemo(
    () => selectedOrders
      .filter(o => !o.is_deleted && o.outcome === 'CONFIRMED' && !o.in_store_pickup && !o.delivery_reference)
      .map(o => o.id),
    [selectedOrders],
  );
  const bulkPosChannels = useMemo(
    () => channels.filter(c => c.is_active && c.channel_type === 'POS'),
    [channels],
  );

  const runBulk = async (
    action: BulkOrderAction,
    ids: number[],
    options: { pos_sales_channel?: number; reason?: string } | undefined,
    verbPast: string,
  ) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await orderService.bulkAction(action, ids, options);
      const { succeeded, failed, total } = res.summary;
      await fetchData(); // refreshes the table and clears the selection
      if (failed === 0) {
        setSuccessMessage(`${verbPast} ${succeeded} order${succeeded !== 1 ? 's' : ''}.`);
      } else {
        const firstErr = res.results.find(r => !r.ok && r.error)?.error;
        setSuccessMessage(
          `${verbPast} ${succeeded} of ${total} order${total !== 1 ? 's' : ''}. `
          + `${failed} skipped${firstErr ? ` — e.g. "${firstErr}"` : ''}.`,
        );
      }
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Bulk action failed.'));
      setErrorDialog(true);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelivery = () =>
    runBulk('submit_delivery', deliveryEligibleIds, undefined, 'Sent to delivery');
  const openBulkPos = () => { setBulkPosChannel(''); setBulkPosOpen(true); };
  const handleBulkPos = async () => {
    if (!bulkPosChannel) return;
    await runBulk('send_to_pos', posEligibleIds, { pos_sales_channel: Number(bulkPosChannel) }, 'Sent to POS');
    setBulkPosOpen(false);
  };
  const handleBulkCancelOrDelete = async () => {
    if (!bulkConfirm) return;
    const ids = Array.from(selectedIds);
    const reason = bulkReason.trim() || undefined;
    if (bulkConfirm === 'cancel') {
      await runBulk('cancel', ids, { reason }, 'Cancelled');
    } else {
      await runBulk('delete', ids, { reason }, 'Deleted');
    }
    setBulkConfirm(null);
    setBulkReason('');
  };

  /* ── manual rollback + WC re-sync (Phase D) ─── */
  const openManualRollback = (order: OrderListItem | OrderDetail) => {
    const targets = MANUAL_TRANSITIONS[order.order_status] ?? [];
    setManualOrder(order);
    setManualTarget(targets[0] ?? '');
    setManualReason('');
  };

  const handleManualTransition = async () => {
    if (!manualOrder || !manualTarget || manualReason.trim().length < 3) return;
    setManualSubmitting(true);
    try {
      const updated = await orderService.manualTransition(
        manualOrder.id,
        manualTarget as OrderListItem['order_status'],
        manualReason.trim(),
      );
      if (viewOrder?.id === updated.id) setViewOrder(updated);
      setManualOrder(null);
      await fetchData();
      setSuccessMessage(`Order rolled back to "${cleanStatusLabel(updated.order_status)}".`);
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to override order status.'));
      setErrorDialog(true);
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleRetrySync = (id: number) =>
    runLifecycleAction(() => orderService.retrySync(id), 'WooCommerce re-sync attempted.');

  const openSendPOSDialog = async (order: OrderDetail | OrderListItem) => {
    setSendingPOS(false);
    setSelectedPOSChannel('');
    setSendPOSDialog(true);
    if ('lines' in order) {
      setSendPOSOrder(order);
      return;
    }
    try {
      setMutatingOrder(true);
      const detail = await orderService.getById(order.id);
      setSendPOSOrder(detail);
    } catch (err) {
      setSendPOSDialog(false);
      setErrorMessage(extractErrorMessage(err, 'Failed to load order before POS routing.'));
      setErrorDialog(true);
    } finally {
      setMutatingOrder(false);
    }
  };

  const handleSendPOS = async () => {
    if (!sendPOSOrder || !selectedPOSChannel) return;
    setSendingPOS(true);
    try {
      const updated = await orderService.sendToPOS(sendPOSOrder.id, Number(selectedPOSChannel));
      setSendPOSDialog(false);
      setSendPOSOrder(null);
      setSelectedPOSChannel('');
      if (viewOrder?.id === updated.id) setViewOrder(updated);
      await fetchData();
      setSuccessMessage('Order sent to the selected POS location. Status remains Confirmed.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to send order to POS.'));
      setErrorDialog(true);
    } finally {
      setSendingPOS(false);
    }
  };

  const handleSubmitDelivery = async (id: number) => {
    setMutatingOrder(true);
    try {
      await orderService.submitDelivery(id);
      // Pull the fresh detail (now carrying the delivery reference/code) so the
      // packaging popup can show the dispatch context.
      const detail = await orderService.getById(id);
      if (viewOrder?.id === id) setViewOrder(detail);
      await fetchData();
      if (canPackageOrders) {
        // The order is dispatched — surface the focused packaging popup so the
        // operator can scan/add packaging items and mark it done. Close the
        // detail sheet first so the packaging popup is the only modal on screen.
        if (viewOrder?.id === id && editLockToken) {
          orderService.releaseEditLock(id, editLockToken).catch(() => undefined);
          setEditLockToken('');
        }
        setViewOrder(null);
        setDetailLoading(false);
        setEditMode(false);
        setPackagingDialogWarnings([]);
        setPackagingDialogOrder(detail);
        setPackagingDialogOpen(true);
      } else {
        setSuccessMessage('Order sent to delivery and response saved.');
        setSuccessDialog(true);
      }
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to send the order to delivery.'));
      setErrorDialog(true);
    } finally {
      setMutatingOrder(false);
    }
  };

  // Save from the focused packaging popup: persist, mark the order done, refresh
  // the list, then close the popup and confirm.
  const handlePackageFromDialog = async (
    items: Array<{ product_id: number; quantity: number }>,
    allowUpdate: boolean,
  ) => {
    if (!packagingDialogOrder) return;
    const targetId = packagingDialogOrder.id;
    setMutatingOrder(true);
    try {
      const updated = await orderService.packageOrder(targetId, {
        packaging_items: items,
        allow_update: allowUpdate,
      });
      if (viewOrder?.id === targetId) setViewOrder(updated);
      await fetchData();
      setPackagingDialogOpen(false);
      setPackagingDialogOrder(null);
      setPackagingDialogWarnings([]);
      setSuccessMessage('Packaging saved, packaging stock adjusted, and order marked done.');
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Could not save packaging.'));
      setErrorDialog(true);
    } finally {
      setMutatingOrder(false);
    }
  };

  // Reverse packaging from the focused popup; keep it open showing the restored
  // (un-packaged) state so the operator can re-pack if needed.
  const handleUnpackageFromDialog = async () => {
    if (!packagingDialogOrder) return;
    if (!window.confirm('Reverse packaging stock movements for this order?')) return;
    const targetId = packagingDialogOrder.id;
    setMutatingOrder(true);
    try {
      const updated = await orderService.unpackageOrder(targetId);
      if (viewOrder?.id === targetId) setViewOrder(updated);
      setPackagingDialogOrder(updated);
      await fetchData();
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Could not reverse packaging.'));
      setErrorDialog(true);
    } finally {
      setMutatingOrder(false);
    }
  };

  // Open the per-item return dialog. We need the full detail (with lines), so
  // reuse the already-loaded order when available and fetch it otherwise.
  const handleProcessReturn = async (id: number) => {
    let detail = viewOrder && viewOrder.id === id ? viewOrder : null;
    if (!detail) {
      try {
        detail = await orderService.getById(id);
      } catch (err) {
        setErrorMessage(extractErrorMessage(err, 'Could not load the order to process its return.'));
        setErrorDialog(true);
        return;
      }
    }
    setReturnOrder(detail);
    setReturnDialogOpen(true);
  };

  const handleConfirmReturn = async (payload: {
    returnReason: string;
    returnType: 'RETURNED' | 'EXCHANGED' | 'DAMAGED' | 'MISSING' | 'OTHER';
    lineConditions: Array<{ line_id: number; condition: 'GOOD' | 'DAMAGED' | 'MISSING' }>;
  }) => {
    if (!returnOrder) return;
    const targetId = returnOrder.id;
    await runLifecycleAction(
      () => orderService.processReturn(targetId, payload),
      'Return processed: good items restocked, damaged items written off.',
    );
    setReturnDialogOpen(false);
    setReturnOrder(null);
  };

  const handleCreateOrder = async (payload: POSOrderCreateRequest) => {
    setCreatingOrder(true);
    try {
      const created = await orderService.createManual(payload);
      setCreateOrderOpen(false);
      await fetchData();
      setSuccessMessage(`Order ${created.order_number} created.`);
      setSuccessDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to create the order.'));
      setErrorDialog(true);
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleReturnLookup = async (query: string) => {
    setReturnLookupLoading(true);
    try {
      if (lookupMode === 'packaging') {
        const result = await orderService.packagingLookup(query);
        setReturnLookupDialog(false);
        // Open the focused packaging popup directly on the matched order — the
        // operator scans the order ticket, then scans/adds packaging items here.
        setPackagingDialogWarnings(result.warnings ?? []);
        setPackagingDialogOrder(result.order);
        setPackagingDialogOpen(true);
      } else {
        // Return mode: open the return-processing popup directly on the matched
        // order so the operator can classify each item and save the return.
        const result = await orderService.returnLookup(query);
        setReturnLookupDialog(false);
        setReturnOrder(result.order);
        setReturnDialogOpen(true);
      }
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'No order found for this return lookup.'));
      setErrorDialog(true);
    } finally {
      setReturnLookupLoading(false);
    }
  };

  const handlePackageOrder = async (
    id: number,
    items: Array<{ product_id: number; quantity: number }>,
    allowUpdate: boolean,
  ) => {
    await runLifecycleAction(
      () => orderService.packageOrder(id, { packaging_items: items, allow_update: allowUpdate }),
      'Packaging saved, packaging stock adjusted, and order marked done.',
    );
  };

  const handleUnpackageOrder = async (id: number) => {
    if (!window.confirm('Reverse packaging stock movements for this order?')) return;
    await runLifecycleAction(
      () => orderService.unpackageOrder(id),
      'Packaging reversed and packaging stock restored.',
    );
  };

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* SYNC HANDLERS                                                            */
  /* ══════════════════════════════════════════════════════════════════════════ */

  const handleConfirmSync = async () => {
    if (!selectedSyncChannel) return;
    setSyncing(true);
    try {
      const res = await orderService.syncFromWooCommerce(Number(selectedSyncChannel), { incremental: true });
      setSyncDialog(false); setSelectedSyncChannel('');
      if (res.async && res.event_id) {
        const event = await orderService.getSyncEvent(res.event_id);
        setActiveSyncEvent(event);
        setSuccessMessage(`WooCommerce sync started in background. Event #${res.event_id}.`);
        setSuccessDialog(true);
      } else {
        setSuccessMessage(`Synced! ${res.created ?? 0} created, ${res.updated ?? 0} updated${res.errors ? `, ${res.errors} errors` : ''}.`);
        setSuccessDialog(true);
        fetchData();
      }
    } catch (err) {
      setSyncDialog(false);
      setErrorMessage(extractErrorMessage(err, 'Sync failed.')); setErrorDialog(true);
    } finally { setSyncing(false); }
  };

  const handlePreviewOrders = async (page: unknown = 1) => {
    if (!selectedSyncChannel) return;
    const safePage = typeof page === 'number' && Number.isFinite(page) ? page : 1;
    setPreviewing(true);
    try {
      const data = await orderService.previewFromWooCommerce(Number(selectedSyncChannel), {
        page: safePage,
        page_size: previewData?.page_size ?? 25,
        new_only: true,
      });
      setPreviewData(data);
      setSelectedWcOrders([]);
      setSyncDialog(false);
      setPreviewDialog(true);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Preview failed.')); setErrorDialog(true);
    } finally { setPreviewing(false); }
  };

  const toggleWcOrder = (wcId: number) =>
    setSelectedWcOrders(p => p.includes(wcId) ? p.filter(x => x !== wcId) : [...p, wcId]);

  const handleSyncSelected = async () => {
    if (!previewData || !selectedWcOrders.length) return;
    setSyncingSelected(true);
    try {
      const res = await orderService.syncSelectedFromWooCommerce(previewData.sales_channel, selectedWcOrders);
      setPreviewDialog(false);
      setSuccessMessage(`${res.created ?? 0} created, ${res.updated ?? 0} updated${res.errors ? `, ${res.errors} errors` : ''}.`);
      setSuccessDialog(true); fetchData();
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Sync failed.')); setErrorDialog(true);
    } finally { setSyncingSelected(false); }
  };

  const handleSyncAllFromPreview = async () => {
    if (!previewData) return;
    setSyncing(true);
    try {
      const res = await orderService.syncFromWooCommerce(previewData.sales_channel, { incremental: true });
      setPreviewDialog(false);
      if (res.async && res.event_id) {
        const event = await orderService.getSyncEvent(res.event_id);
        setActiveSyncEvent(event);
        setSuccessMessage(`WooCommerce sync started in background. Event #${res.event_id}.`);
        setSuccessDialog(true);
      } else {
        setSuccessMessage(`All synced: ${res.created ?? 0} created, ${res.updated ?? 0} updated.`);
        setSuccessDialog(true);
        fetchData();
      }
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Sync failed.')); setErrorDialog(true);
    } finally { setSyncing(false); }
  };

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* RENDER                                                                   */
  /* ══════════════════════════════════════════════════════════════════════════ */

  // Phase D — every tab count is summed from the clean order_status breakdown
  // (order_status_kpis.by_status), the same field the row chip renders. Tabs,
  // counts and badges therefore always agree. 'deleted' is counted separately
  // (it is orthogonal to order_status).
  const tabCounts = useMemo(() => {
    const byStatus = summary?.order_status_kpis?.by_status ?? {};
    const sumOf = (keys: CleanOrderStatus[]) =>
      keys.reduce((n, k) => n + (byStatus[k] ?? 0), 0);
    const counts: Record<string, number> = {
      all: summary?.order_status_kpis?.total_orders ?? summary?.total_orders ?? 0,
      deleted: summary?.flow_counts?.deleted ?? 0,
    };
    for (const tab of FLOW_TABS) {
      if (tab.value === 'all' || tab.value === 'deleted') continue;
      counts[tab.value] = sumOf(tab.statuses);
    }
    return counts;
  }, [summary]);

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* ── Header ─── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
            <ShoppingCart className="size-6" /> Order Operations
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Confirm clients, route orders to POS, submit delivery, and process returns
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateOrders && (
            <Button
              size="sm"
              onClick={() => setCreateOrderOpen(true)}
              className="gap-2"
            >
              <Plus className="size-4" /> Create Order
            </Button>
          )}
          {canPackageOrders && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setLookupMode('packaging'); setReturnLookupDialog(true); }}
              className="gap-2"
            >
              <Package className="size-4" /> Scan Packaging
            </Button>
          )}
          {canProcessReturn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setLookupMode('return'); setReturnLookupDialog(true); }}
              className="gap-2"
            >
              <RotateCcw className="size-4" /> Find Return
            </Button>
          )}
          {canImportOrders && (
            <Button variant="outline" size="sm" onClick={() => setSyncDialog(true)} className="gap-2">
              <RefreshCw className="size-4" /> Sync WC
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={`size-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {activeSyncEvent && activeSyncEvent.status === 'RUNNING' && (
        <Card className="border-blue-200 bg-blue-50/70">
          <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-blue-900">
              <Loader2 className="size-4 animate-spin" />
              <span className="font-medium">WooCommerce sync is running</span>
              <span className="text-blue-700">
                {activeSyncEvent.sales_channel_name} · event #{activeSyncEvent.id}
              </span>
            </div>
            <div className="text-xs text-blue-700">
              Imported so far: {activeSyncEvent.created_count} new, {activeSyncEvent.updated_count} updated, {activeSyncEvent.error_count} errors
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── KPIs ─── */}
      {summary && (
        <div className="space-y-3">
          <div className={`grid grid-cols-2 gap-3 ${showRevenue ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <KpiCard title="Total" value={summary.total_orders} icon={<ShoppingCart className="size-3" />} />
            <KpiCard title="Pending" value={summary.pending} tone="text-amber-600" icon={<Clock className="size-3" />} />
            <KpiCard title="Processing" value={summary.processing} tone="text-blue-600" icon={<Package className="size-3" />} />
            <KpiCard title="Completed" value={summary.completed} tone="text-emerald-600" icon={<CheckCircle className="size-3" />} />
            {showRevenue && (
              <KpiCard title="Revenue" value={`TND ${summary.revenue}`} tone="text-emerald-600" icon={<TrendingUp className="size-3" />} />
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard title="Confirmed" value={summary.confirmed_count} tone="text-emerald-600" icon={<CheckCircle className="size-3" />} />
            <KpiCard title="Delayed" value={summary.delayed_count} tone="text-amber-600" icon={<Clock className="size-3" />} />
            <KpiCard title="Cancelled" value={summary.cancelled_outcome} tone="text-red-600" icon={<ShoppingCart className="size-3" />} />
          </div>
          {/* Phase D — clean order_status KPIs (genuinely successful sales only). */}
          {summary.order_status_kpis && (
            <div className={`grid grid-cols-2 gap-3 ${showNetRevenue ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
              <KpiCard title="Successful Sales" value={summary.order_status_kpis.successful_sales} tone="text-emerald-600" icon={<CheckCircle className="size-3" />} />
              {showNetRevenue && (
                <KpiCard title="Net Revenue" value={`TND ${summary.order_status_kpis.revenue}`} tone="text-emerald-600" icon={<TrendingUp className="size-3" />} />
              )}
              <KpiCard title="In Confirmation" value={summary.order_status_kpis.in_confirmation} tone="text-amber-600" icon={<Phone className="size-3" />} />
              <KpiCard title="In Fulfillment" value={summary.order_status_kpis.in_fulfillment} tone="text-blue-600" icon={<Package className="size-3" />} />
              <KpiCard title="Returned" value={summary.order_status_kpis.returned} tone="text-purple-600" icon={<RotateCcw className="size-3" />} />
              <KpiCard title="Canceled" value={summary.order_status_kpis.canceled} tone="text-red-600" icon={<X className="size-3" />} />
            </div>
          )}
        </div>
      )}

      {/* Flow tabs */}
      <Tabs value={flowFilter} onValueChange={value => setFlowFilter(value as OrderFlowTab)}>
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-md bg-muted/60 p-1">
          {visibleFlowTabs.map(tab => {
            const count = tabCounts[tab.value] ?? 0;
            const active = flowFilter === tab.value;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-11 min-w-[118px] justify-between gap-2 px-2 text-xs data-[state=active]:shadow-sm"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {tab.icon}
                  <span className="hidden truncate 2xl:inline">{tab.label}</span>
                  <span className="truncate 2xl:hidden">{tab.shortLabel}</span>
                </span>
                <Badge
                  variant={active ? 'default' : 'secondary'}
                  className={`h-5 min-w-6 justify-center rounded-full px-1.5 text-[10px] tabular-nums ${count === 0 ? 'opacity-60' : ''}`}
                >
                  {count > 999 ? '999+' : count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* ── Filters ─── */}
      <Card className="border-muted/70">
        <CardHeader className="p-4 pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" />
            Filters and Sorting
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                {search && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
                    onClick={() => setSearch('')}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              <Input
                  placeholder="Order id, order number, client name, phone..."
                  className="pl-9 pr-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="ON_HOLD">On Hold</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Source</span>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="WOOCOMMERCE">WooCommerce</SelectItem>
                  <SelectItem value="POS">POS</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Payment</span>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payments</SelectItem>
                  <SelectItem value="UNPAID">Unpaid</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Channel</span>
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {channels.map(channel => (
                    <SelectItem key={channel.id} value={String(channel.id)}>{channel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canFilterByBrand ? (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Brand</span>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger><SelectValue placeholder="Brand" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brands</SelectItem>
                    {availableBrands.map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : <div />}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {loading ? 'Loading...' : `${totalOrders} order${totalOrders !== 1 ? 's' : ''}`}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {canViewDeleted && (
                <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                  <Checkbox
                    checked={includeDeleted}
                    onCheckedChange={c => setIncludeDeleted(Boolean(c))}
                  />
                  Include deleted
                </label>
              )}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Orders table ─── */}
      <Card className="overflow-hidden border-muted/70">
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Priority order queue</h2>
            <p className="text-xs text-muted-foreground">Rows are sorted by action needed, client points, then newest.</p>
          </div>
          {wsConnected ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
              title="Connected — new orders appear instantly"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
              title="Realtime reconnecting — new orders still refresh automatically"
            >
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
              Auto
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="h-10 w-10 px-2">
                  <Checkbox
                    checked={allVisibleSelected ? true : (someVisibleSelected ? 'indeterminate' : false)}
                    onCheckedChange={toggleSelectAll}
                    disabled={selectableOrders.length === 0}
                    aria-label="Select all orders on this page"
                  />
                </TableHead>
                <SortableHead label="Priority" field="lifecycle_priority" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Order #" field="order_number" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Client" field="client__last_name" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Points" field="client__points" ordering={ordering} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableHead label="Channel" field="sales_channel__name" ordering={ordering} onSort={handleSort} className="hidden md:table-cell" />
                <SortableHead label="Source" field="source" ordering={ordering} onSort={handleSort} className="hidden sm:table-cell" />
                <SortableHead label="Status" field="order_status" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Payment" field="payment_status" ordering={ordering} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableHead label="Total" field="total" ordering={ordering} onSort={handleSort} className="text-right" />
                <SortableHead label="Date" field="created_at" ordering={ordering} onSort={handleSort} className="hidden md:table-cell" />
                <TableHead className="h-10 text-xs font-semibold w-12 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={12} className="py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading orders...</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-16 text-muted-foreground">
                    No orders found.
                  </TableCell>
                </TableRow>
              )}
              {!loading && orders.map(o => (
                <TableRow
                  key={o.id}
                  className={`group hover:bg-muted/30 cursor-pointer transition-colors ${o.is_deleted ? 'opacity-50' : ''}`}
                  onClick={() => openDetail(o.id)}
                >
                  <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(o.id)}
                      onCheckedChange={() => toggleSelectOne(o.id)}
                      disabled={o.is_deleted}
                      aria-label={`Select order ${o.order_number}`}
                    />
                  </TableCell>
                  <TableCell><PriorityBadge priority={o.lifecycle_priority} /></TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{o.order_number}</TableCell>
                  <TableCell>
                    <div className="max-w-[170px]">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-sm font-medium">{o.client_name ?? o.client_email ?? '—'}</p>
                        {o.client_is_blocked && (
                          <Badge variant="destructive" className="h-4 px-1 text-[9px] gap-0.5 shrink-0">
                            <AlertTriangle className="size-2.5" /> Blocked
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{o.client_phone ?? o.client_email ?? o.billing_phone ?? 'No phone'}</p>
                      {o.client_is_blocked && (
                        <p className="text-[10px] text-red-600">Returned {o.client_return_count ?? 0} times</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Star className="size-3" /> {o.client_points ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{o.sales_channel_name}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <SourceBadge source={o.source} />
                      {o.order_source && <OrderSourceBadge source={o.order_source} label={o.order_source_display} />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Phase D — ONE canonical lifecycle chip (the derived
                          order_status). The internal mechanism fields
                          (workflow_status / contact_status / outcome / wc_status /
                          packaging_status / final_outcome) now live only in the
                          order detail dialog, so the list stays readable. */}
                      <CleanStatusBadge status={o.order_status} label={o.order_status_display} />
                      {/* WooCommerce push-sync state — only when noteworthy (hidden for 'imported'). */}
                      <SyncStatusBadge status={o.sync_status} label={o.sync_status_display} />
                      {o.is_deleted && <Badge variant="destructive" className="text-xs">Deleted</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell"><PaymentBadge status={o.payment_status} /></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtCurrency(o.currency, o.total)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{fmtDate(o.created_at)}</TableCell>
                  <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2 text-xs"
                        onClick={() => openDetail(o.id)}
                      >
                        <Eye className="size-3.5" /> View
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>Lifecycle actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openDetail(o.id)} className="gap-2">
                            <Eye className="size-4" /> View Details
                          </DropdownMenuItem>
                          {!o.is_deleted && (o.outcome === 'CONFIRMED' ? canUpdateConfirmedOrders : canUpdateUnconfirmedOrders) && (
                            <DropdownMenuItem onClick={() => openDetail(o.id)} className="gap-2">
                              <Pencil className="size-4" /> Edit Order
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { openDetail(o.id).then(() => { setLogsDialog(true); }); }} className="gap-2">
                            <History className="size-4" /> View Logs
                          </DropdownMenuItem>
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.outcome !== 'CONFIRMED' && canConfirmOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.confirmOrder(o.id), 'Order confirmed.')} className="gap-2">
                              <CheckCircle className="size-4" /> Confirm
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.outcome !== 'CONFIRMED' && o.contact_status !== 'DELAYED' && canUpdateUnconfirmedOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.markNotAnswered(o.id), 'No-answer attempt recorded.')} className="gap-2">
                              <Phone className="size-4" /> No Answer ({o.not_answered_attempts ?? 0})
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && o.outcome === 'DELAYED' && canDelayOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.restoreDelayed(o.id), 'Delayed order restored to pending.')} className="gap-2">
                              <Undo2 className="size-4" /> Restore Delay
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.outcome === 'CONFIRMED' && !o.sent_to_pos_at && !o.delivery_reference && canSendToPos && (
                            <DropdownMenuItem onClick={() => openSendPOSDialog(o)} className="gap-2">
                              <Store className="size-4" /> Send to POS
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && o.sent_to_pos_at && !o.pos_validated_at && canValidatePos && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.validatePOS(o.id), 'POS order validated.')} className="gap-2">
                              <CheckCircle className="size-4" /> Validate POS
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.outcome === 'CONFIRMED' && !o.in_store_pickup && !o.delivery_reference && canSendToDelivery && (
                            <DropdownMenuItem onClick={() => handleSubmitDelivery(o.id)} className="gap-2">
                              <Truck className="size-4" /> Send Delivery
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !o.returned_at && (o.final_outcome === 'SUCCESSFUL_SALE' || o.delivery_status === 'DELIVERED' || o.pos_validated_at) && canProcessReturn && (
                            <DropdownMenuItem onClick={() => handleProcessReturn(o.id)} className="gap-2">
                              <RotateCcw className="size-4" /> Process Return
                            </DropdownMenuItem>
                          )}
                          {/* Phase D — WooCommerce push retry for parked / failed syncs. */}
                          {!o.is_deleted && o.source === 'WOOCOMMERCE' && o.external_order_id && (o.sync_status === 'sync_failed' || o.sync_status === 'pending_sync') && canImportOrders && (
                            <DropdownMenuItem onClick={() => handleRetrySync(o.id)} className="gap-2">
                              <RefreshCw className="size-4" /> Retry WC Sync
                            </DropdownMenuItem>
                          )}
                          {/* Phase D — audited, reason-required backward override (admin/manager). */}
                          {!o.is_deleted && canManualOverride && (MANUAL_TRANSITIONS[o.order_status]?.length ?? 0) > 0 && (
                            <DropdownMenuItem onClick={() => openManualRollback(o)} className="gap-2 text-amber-700">
                              <ShieldAlert className="size-4" /> Manual Rollback
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {o.is_deleted && canRestoreDeleted ? (
                            <DropdownMenuItem className="gap-2 text-emerald-700" onClick={async () => {
                              try { await orderService.restore(o.id); fetchData(); setSuccessMessage('Order restored.'); setSuccessDialog(true); }
                              catch { setErrorMessage('Failed to restore.'); setErrorDialog(true); }
                            }}>
                              <Undo2 className="size-4" /> Restore
                            </DropdownMenuItem>
                          ) : !o.is_deleted && canSoftDelete ? (
                            <DropdownMenuItem className="gap-2 text-destructive" onClick={async () => {
                              try { await orderService.softDelete(o.id, 'Quick delete'); fetchData(); setSuccessMessage('Order deleted.'); setSuccessDialog(true); }
                              catch { setErrorMessage('Failed to delete.'); setErrorDialog(true); }
                            }}>
                              <Trash2 className="size-4" /> Soft Delete
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage <= 1}
            onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage >= totalPages}
            onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Take-over confirmation shown when the order is locked by another user */}
      <Dialog open={!!takeoverInfo} onOpenChange={(open) => { if (!open) setTakeoverInfo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Order in use</DialogTitle>
            <DialogDescription>
              This order is currently being handled by{' '}
              <span className="font-semibold text-foreground">{takeoverInfo?.userName}</span>.
              {' '}Do you want to take over this order?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTakeoverInfo(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const id = takeoverInfo?.orderId;
                setTakeoverInfo(null);
                if (id != null) openDetail(id, { force: true });
              }}
            >
              Yes, take over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialogs ─── */}
      <OrderDetailDialog
        open={detailLoading || !!viewOrder}
        onOpenChange={() => {
          if (viewOrder && editLockToken) {
            orderService.releaseEditLock(viewOrder.id, editLockToken).catch(() => undefined);
          }
          setEditLockToken('');
          setViewOrder(null);
          setDetailLoading(false);
          setEditMode(false);
        }}
        order={viewOrder}
        isDetailLoading={detailLoading}
        isEditMode={editMode}
        editForm={editForm}
        editProducts={editProducts}
        loadingEditProducts={loadingEditProducts}
        packagingProducts={packagingProducts}
        loadingPackagingProducts={loadingPackagingProducts}
        savingEdit={savingEdit}
        mutatingOrder={mutatingOrder}
        onStatusChange={handleStatusChange}
        onStatusFieldsChange={handleStatusFieldsChange}
        onConfirmOrder={handleConfirmOrder}
        onNotAnswered={handleNotAnswered}
        onDelayOrder={handleDelayOrder}
        onRestoreDelayed={handleRestoreDelayed}
        onCancelOrder={handleCancelOrder}
        onOpenSendPOS={openSendPOSDialog}
        onSendDelivery={handleSubmitDelivery}
        onProcessReturn={handleProcessReturn}
        onPackageOrder={handlePackageOrder}
        onUnpackageOrder={handleUnpackageOrder}
        onEditModeChange={handleEditModeChange}
        onUpdateLine={updateEditLine}
        onUpdateLineProduct={updateEditLineProduct}
        onAddLine={handleAddLine}
        onRemoveLine={handleRemoveLine}
        onSaveEdit={handleSaveEdit}
        onChangeDiscount={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field === 'type' ? 'discount_type' : 'discount_value']: val } : prev);
        }}
        onChangeNote={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field === 'customer' ? 'customer_note' : 'internal_note']: val } : prev);
        }}
        onOpenLogs={handleOpenLogs}
        onDelete={handleSoftDelete}
        onRestore={handleRestoreOrder}
        permissions={{
          edit: viewOrder ? (viewOrder.outcome === 'CONFIRMED' ? canUpdateConfirmedOrders : canUpdateUnconfirmedOrders) : false,
          confirm: canConfirmOrders,
          delay: canDelayOrders,
          cancel: canCancelOrders,
          sendToPos: canSendToPos,
          sendToDelivery: canSendToDelivery,
          processReturn: canProcessReturn,
          packageOrder: canPackageOrders,
          delete: canSoftDelete,
          restore: canRestoreDeleted,
        }}
      />

      <SendToPOSDialog
        open={sendPOSDialog}
        onOpenChange={(open) => {
          setSendPOSDialog(open);
          if (!open) {
            setSendPOSOrder(null);
            setSelectedPOSChannel('');
          }
        }}
        order={sendPOSOrder}
        channels={channels}
        selectedChannelId={selectedPOSChannel}
        onChannelChange={setSelectedPOSChannel}
        onSubmit={handleSendPOS}
        isLoading={sendingPOS || mutatingOrder}
      />

      {/* ── Floating bulk action bar ─── */}
      {selectedIds.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border bg-background/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <span className="whitespace-nowrap px-2 text-sm font-semibold">
              {selectedIds.size} selected
            </span>
            <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
            {canSendToPos && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5"
                disabled={bulkBusy || posEligibleIds.length === 0}
                title={posEligibleIds.length === 0 ? 'Only confirmed orders that are not yet routed can go to POS' : undefined}
                onClick={openBulkPos}
              >
                <Store className="size-3.5" /> POS
                {posEligibleIds.length > 0 && <span className="tabular-nums">({posEligibleIds.length})</span>}
              </Button>
            )}
            {canSendToDelivery && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5"
                disabled={bulkBusy || deliveryEligibleIds.length === 0}
                title={deliveryEligibleIds.length === 0 ? 'Only confirmed orders that are not yet routed can go to delivery' : undefined}
                onClick={handleBulkDelivery}
              >
                <Truck className="size-3.5" /> Delivery
                {deliveryEligibleIds.length > 0 && <span className="tabular-nums">({deliveryEligibleIds.length})</span>}
              </Button>
            )}
            {canCancelOrders && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5 text-amber-700 hover:text-amber-800"
                disabled={bulkBusy}
                onClick={() => { setBulkReason(''); setBulkConfirm('cancel'); }}
              >
                <Ban className="size-3.5" /> Cancel
              </Button>
            )}
            {canSoftDelete && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive"
                disabled={bulkBusy}
                onClick={() => { setBulkReason(''); setBulkConfirm('delete'); }}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
            <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
            {bulkBusy ? (
              <Loader2 className="mx-1 size-4 animate-spin text-muted-foreground" />
            ) : (
              <Button size="icon" variant="ghost" className="size-8" onClick={clearSelection} aria-label="Clear selection">
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Bulk: send selected to POS ─── */}
      <Dialog open={bulkPosOpen} onOpenChange={(o) => { if (!bulkBusy) setBulkPosOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send {posEligibleIds.length} order{posEligibleIds.length !== 1 ? 's' : ''} to POS</DialogTitle>
            <DialogDescription>
              Pick the point of sale that will fulfil the selected confirmed orders. Any selected order that isn't eligible is skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">POS location</Label>
            <Select value={bulkPosChannel} onValueChange={setBulkPosChannel} disabled={bulkBusy}>
              <SelectTrigger><SelectValue placeholder="Choose a POS location" /></SelectTrigger>
              <SelectContent>
                {bulkPosChannels.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No active POS locations.</div>
                )}
                {bulkPosChannels.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPosOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button onClick={handleBulkPos} disabled={bulkBusy || !bulkPosChannel || posEligibleIds.length === 0} className="gap-1.5">
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
              Send to POS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk: cancel / delete confirm ─── */}
      <Dialog open={bulkConfirm !== null} onOpenChange={(o) => { if (!o && !bulkBusy) { setBulkConfirm(null); setBulkReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkConfirm === 'cancel' ? 'Cancel' : 'Delete'} {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}?
            </DialogTitle>
            <DialogDescription>
              {bulkConfirm === 'cancel'
                ? 'The selected orders will be marked cancelled. Orders that cannot be cancelled from their current status are skipped.'
                : 'The selected orders will be soft-deleted (they remain recoverable). Orders you cannot delete are skipped.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reason (optional)</Label>
            <Textarea
              value={bulkReason}
              onChange={e => setBulkReason(e.target.value)}
              rows={2}
              placeholder={bulkConfirm === 'cancel' ? 'Why are these being cancelled?' : 'Why are these being deleted?'}
              disabled={bulkBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkConfirm(null); setBulkReason(''); }} disabled={bulkBusy}>
              Keep orders
            </Button>
            <Button
              variant={bulkConfirm === 'delete' ? 'destructive' : 'default'}
              onClick={handleBulkCancelOrDelete}
              disabled={bulkBusy}
              className="gap-1.5"
            >
              {bulkBusy
                ? <Loader2 className="size-4 animate-spin" />
                : (bulkConfirm === 'cancel' ? <Ban className="size-4" /> : <Trash2 className="size-4" />)}
              {bulkConfirm === 'cancel' ? 'Cancel orders' : 'Delete orders'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReturnLookupDialog
        open={returnLookupDialog}
        onOpenChange={setReturnLookupDialog}
        onSearch={handleReturnLookup}
        isLoading={returnLookupLoading}
        title={lookupMode === 'packaging' ? 'Scan Packaging Order' : 'Find Returned Order'}
        description={
          lookupMode === 'packaging'
            ? 'Scan or type the delivery code (e.g. SID188370591574) to open the order for packaging. Ticket ID, internal order code, or WooCommerce order ID also work.'
            : 'Scan a barcode or QR code, or type a ticket ID, WooCommerce order ID, internal order code, or delivery code.'
        }
        placeholder={lookupMode === 'packaging' ? 'Delivery code, e.g. SID188370591574' : 'Ticket ID, WC ID, delivery code...'}
      />

      <PackagingDialog
        open={packagingDialogOpen}
        onOpenChange={(open) => {
          setPackagingDialogOpen(open);
          if (!open) {
            setPackagingDialogOrder(null);
            setPackagingDialogWarnings([]);
          }
        }}
        order={packagingDialogOrder}
        packagingProducts={packagingDialogProducts}
        loadingPackagingProducts={loadingPackagingDialogProducts}
        isLoading={mutatingOrder}
        canPackage={canPackageOrders}
        warnings={packagingDialogWarnings}
        onPackageOrder={handlePackageFromDialog}
        onUnpackageOrder={handleUnpackageFromDialog}
      />

      <ReturnDialog
        open={returnDialogOpen}
        onOpenChange={(open) => {
          setReturnDialogOpen(open);
          if (!open) setReturnOrder(null);
        }}
        order={returnOrder}
        onSubmit={handleConfirmReturn}
        isLoading={mutatingOrder}
      />

      <CreateOrderDialog
        open={createOrderOpen}
        onOpenChange={setCreateOrderOpen}
        channels={channels}
        onSubmit={handleCreateOrder}
        isLoading={creatingOrder}
      />

      <SyncDialog
        open={syncDialog} onOpenChange={setSyncDialog}
        channels={channels} selectedChannel={selectedSyncChannel}
        onChannelChange={setSelectedSyncChannel}
        onPreview={() => handlePreviewOrders(1)} onSyncAll={handleConfirmSync}
        isPreviewing={previewing} isSyncing={syncing}
      />

      <PreviewDialog
        open={previewDialog} onOpenChange={setPreviewDialog}
        data={previewData} selectedIds={selectedWcOrders}
        onToggleOrder={toggleWcOrder}
        onSelectAll={() => setSelectedWcOrders(previewData?.orders.map(o => o.wc_id) ?? [])}
        onDeselectAll={() => setSelectedWcOrders([])}
        onSyncSelected={handleSyncSelected} onSyncAll={handleSyncAllFromPreview}
        isSyncingSelected={syncingSelected}
        isPreviewing={previewing}
        onPageChange={handlePreviewOrders}
      />

      <LogsDialog
        open={logsDialog} onOpenChange={setLogsDialog}
        orderNumber={viewOrder?.order_number} logs={orderLogs} isLoading={loadingLogs}
      />

      {/* Phase D — audited manual status rollback (admin/manager only). */}
      <Dialog open={!!manualOrder} onOpenChange={open => { if (!open) setManualOrder(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-600" /> Manual status rollback
            </DialogTitle>
            <DialogDescription>
              Roll {manualOrder?.order_number} back to an earlier status. This is audited and requires a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Current status:
              <CleanStatusBadge status={manualOrder?.order_status} label={manualOrder?.order_status_display} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-target">Roll back to</Label>
              <Select value={manualTarget} onValueChange={setManualTarget}>
                <SelectTrigger id="manual-target"><SelectValue placeholder="Select a status" /></SelectTrigger>
                <SelectContent>
                  {(manualOrder ? MANUAL_TRANSITIONS[manualOrder.order_status] ?? [] : []).map(t => (
                    <SelectItem key={t} value={t}>{cleanStatusLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-reason">Reason <span className="text-red-500">*</span></Label>
              <Textarea
                id="manual-reason"
                rows={3}
                value={manualReason}
                onChange={e => setManualReason(e.target.value)}
                placeholder="Explain why this order is being rolled back (min 3 characters)…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOrder(null)} disabled={manualSubmitting}>Cancel</Button>
            <Button
              onClick={handleManualTransition}
              disabled={manualSubmitting || !manualTarget || manualReason.trim().length < 3}
              className="gap-2"
            >
              {manualSubmitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
              Confirm rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MessageAlert open={successDialog} onOpenChange={setSuccessDialog} type="success" message={successMessage} />
      <MessageAlert open={errorDialog} onOpenChange={setErrorDialog} type="error" message={errorMessage} />
    </div>
  );
}
