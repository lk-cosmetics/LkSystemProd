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
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from 'react';
import {
  ShoppingCart, Search, RefreshCw, Eye, MoreVertical,
  CheckCircle, Clock, Package, Pencil, History, Trash2,
  Undo2, Loader2, TrendingUp,
  Truck, Store, RotateCcw, Star, ArrowUpDown, ArrowUp, ArrowDown,
  X, SlidersHorizontal, AlertTriangle, Phone, ShieldAlert, Plus, Ban,
  User, ChevronRight, ChevronLeft, ChevronDown, Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  DEFAULT_LIFO_ORDERING,
  PENDING_FIFO_ORDERING,
  buildPaginationItems,
  defaultOrderingForFlow,
} from './orderQueue';
import type {
  OrderListItem, OrderDetail, OrderEditLineInput, OrderEditRequest,
  OrderDiscountType, OrderSummary, OrderStatus, SalesChannel, ProductListItem,
  OrderLogEntry, POSOrderCreateRequest, AssignableEmployee,
} from '@/types';
import type {
  OrderSyncEvent,
  WooCommerceOrderPreviewResponse,
  BulkOrderAction,
  ReturnLineCondition,
} from '@/services/order.service';

import {
  OrderDetailDialog, SyncDialog, PreviewDialog, LogsDialog, MessageAlert,
  SendToPOSDialog, ReturnLookupDialog, ReturnDialog, CreateOrderDialog,
  PackagingDialog, ALLOWED_NEXT_STATUSES,
} from './components/OrderDialogs';
import { getMissingStock, type MissingStockLine } from './components/orderStock';
import {
  AssignmentBadge, AssignEmployeeDialog, AutoAssignmentSettingsDialog,
} from './components/OrderAssignment';
import {
  ORDER_STATUS_ROW_STYLES, OrderStatusBadge,
  SyncStatusBadge, orderStatusLabel,
} from './components/orderStatusBadges';

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
  | 'new'
  | 'confirmed'
  | 'not_answered'
  | 'delayed'
  | 'packaging'
  | 'done'
  | 'returned'
  | 'canceled';

const PRIORITY_QUEUE_ORDERING = 'lifecycle_priority,business_priority_rank,-client__points,-created_at';

const ORDER_SORT_OPTIONS = [
  { value: DEFAULT_LIFO_ORDERING, label: 'Recently updated first (LIFO)' },
  { value: PENDING_FIFO_ORDERING, label: 'Oldest created first (FIFO)' },
  { value: PRIORITY_QUEUE_ORDERING, label: 'Action and business priority' },
  { value: '-total,-created_at', label: 'Highest total first' },
  { value: 'total,-created_at', label: 'Lowest total first' },
  { value: 'business_priority_rank,-created_at', label: 'Business priority' },
  { value: '-client__points,-created_at', label: 'Client points' },
] as const;

// Shared label styling for the filter-bar dropdowns (compact, uppercase, muted).
const FILTER_LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

// The tabs ARE the canonical lifecycle (plus "All"). Each tab maps 1:1 to a
// status value, so the tab filter (?status=…), the count (by_status) and the
// row chip always agree.
const FLOW_TABS: Array<{
  value: OrderFlowTab;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  statuses: OrderStatus[];
}> = [
  { value: 'all',          label: 'All',          shortLabel: 'All',     icon: <ShoppingCart className="size-3.5" />, statuses: [] },
  { value: 'new',          label: 'New',          shortLabel: 'New',     icon: <Clock className="size-3.5" />,        statuses: ['new'] },
  { value: 'confirmed',    label: 'Confirmed',    shortLabel: 'Conf',    icon: <CheckCircle className="size-3.5" />,  statuses: ['confirmed'] },
  { value: 'not_answered', label: 'Not Answered', shortLabel: 'No ans',  icon: <Phone className="size-3.5" />,        statuses: ['not_answered'] },
  { value: 'delayed',      label: 'Delayed',      shortLabel: 'Delay',   icon: <Clock className="size-3.5" />,        statuses: ['delayed'] },
  { value: 'packaging',    label: 'Packaging',    shortLabel: 'Pack',    icon: <Package className="size-3.5" />,      statuses: ['packaging'] },
  { value: 'done',         label: 'Done',         shortLabel: 'Done',    icon: <CheckCircle className="size-3.5" />,  statuses: ['done'] },
  { value: 'returned',     label: 'Returned',     shortLabel: 'Return',  icon: <RotateCcw className="size-3.5" />,    statuses: ['returned'] },
  { value: 'canceled',     label: 'Canceled',     shortLabel: 'Cancel',  icon: <Ban className="size-3.5" />,          statuses: ['canceled'] },
];

// Admin/manager backward overrides on the canonical pipeline. Mirrors the
// backend ALLOWED_MANUAL_TRANSITIONS (server re-validates; this only drives
// which targets the UI offers).
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  done:         ['packaging'],
  packaging:    ['confirmed'],
  confirmed:    ['new'],
  delayed:      ['new'],
  not_answered: ['new'],
  returned:     ['done'],
  canceled:     ['new', 'confirmed'],
};

function getPrimarySort(ordering: string) {
  const first = ordering.split(',')[0] || DEFAULT_LIFO_ORDERING;
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
  order.source === 'POS' && order.status === 'done' && !order.in_store_pickup;

function PriorityBadge({
  actionPriority,
  businessPriority,
}: Readonly<{
  actionPriority?: number | null;
  businessPriority?: OrderListItem['priority_level'];
}>) {
  let actionBadge: ReactNode;
  if (actionPriority === 0) {
    actionBadge = <Badge className="bg-rose-600 text-[10px] hover:bg-rose-600">Overdue</Badge>;
  } else if (actionPriority === 1) {
    actionBadge = <Badge className="bg-rose-600 text-[10px] hover:bg-rose-600">Action now</Badge>;
  } else if (actionPriority === 2) {
    actionBadge = <Badge className="bg-amber-600 text-[10px] hover:bg-amber-600">Follow-up</Badge>;
  } else if (actionPriority != null && actionPriority <= 5) {
    actionBadge = <Badge className="bg-blue-600 text-[10px] hover:bg-blue-600">Next step</Badge>;
  } else {
    actionBadge = <Badge variant="outline" className="text-[10px]">Normal</Badge>;
  }

  const businessClass = businessPriority === 'high'
    ? 'border-violet-300 bg-violet-50 text-violet-700'
    : businessPriority === 'low'
      ? 'border-slate-300 bg-slate-50 text-slate-600'
      : 'border-amber-300 bg-amber-50 text-amber-700';

  return (
    <div className="flex min-w-[92px] flex-col items-start gap-1">
      {actionBadge}
      <Badge
        variant="outline"
        className={`text-[9px] capitalize ${businessClass}`}
        title="Business priority combines order value and stock availability."
      >
        {businessPriority ?? 'medium'} priority
      </Badge>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* KPI CARD                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

function KpiCard({ title, value, unit, accent = false, icon }: Readonly<{
  title: string;
  value: string | number;
  /** Small currency/unit label rendered before the value (e.g. "TND") so the
   *  hero number never wraps onto its own line. */
  unit?: string;
  /** Emerald highlight for the headline metrics (net revenue, sales). */
  accent?: boolean;
  icon?: ReactNode;
}>) {
  return (
    <div className="flex min-w-[8rem] shrink-0 snap-start flex-col gap-2 rounded-xl border bg-card p-3.5 shadow-sm sm:min-w-0 sm:p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon && (
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${accent ? 'bg-emerald-50 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
            {icon}
          </span>
        )}
        <span className="truncate">{title}</span>
      </span>
      <span className="flex items-baseline gap-1">
        {unit && <span className="text-xs font-semibold text-muted-foreground">{unit}</span>}
        <span className={`text-xl font-bold tabular-nums tracking-tight sm:text-2xl ${accent ? 'text-emerald-600' : 'text-foreground'}`}>
          {value}
        </span>
      </span>
    </div>
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
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  // Assignment filters: 'all' | 'unassigned' | '<employeeId>' and 'all'|'auto'|'manual'.
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [assignmentTypeFilter, setAssignmentTypeFilter] = useState('all');
  const [ordering, setOrdering] = useState(DEFAULT_LIFO_ORDERING);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  // Filters card is collapsible. Default open on tablet/desktop, collapsed on
  // phones (where the search + 6 dropdowns otherwise eat the whole screen).
  const [filtersOpen, setFiltersOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageJump, setPageJump] = useState('1');
  const [totalOrders, setTotalOrders] = useState(0);
  const pageSize = 20;

  /* ── detail / edit state ─── */
  const [viewOrder, setViewOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // The working lock. `editLockToken` is non-empty only while WE hold the lock
  // (acquired on open); `lockedByOther` carries the holder when SOMEONE ELSE has
  // it (we then view read-only until we take over).
  const [editLockToken, setEditLockToken] = useState('');
  const [lockedByOther, setLockedByOther] = useState<{ user_name: string; user_id: number | null } | null>(null);
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
  // Per-order tally of failed Confirm/Delay attempts, keyed by order id so one
  // order's failures never leak into another's (scoped per order, not global).
  // Drives the last-resort Cancel button in the detail popup: it stays hidden
  // until an order's confirm/delay has failed 3 times, and the count resets the
  // moment either action succeeds.
  const [actionFailures, setActionFailures] = useState<Record<number, number>>({});
  const bumpActionFailure = (id: number) =>
    setActionFailures(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  const resetActionFailure = (id: number) =>
    setActionFailures(prev => (prev[id] ? { ...prev, [id]: 0 } : prev));
  // Missing-stock review popup shown before Confirm / Send-delivery proceed.
  const [stockWarn, setStockWarn] = useState<{ title: string; items: MissingStockLine[]; onProceed: () => void } | null>(null);
  const [logsDialog, setLogsDialog] = useState(false);
  const [orderLogs, setOrderLogs] = useState<OrderLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [sendPOSDialog, setSendPOSDialog] = useState(false);
  const [sendPOSOrder, setSendPOSOrder] = useState<OrderDetail | null>(null);
  const [selectedPOSChannel, setSelectedPOSChannel] = useState('');
  // POS destinations are fetched per-order (every active same-brand channel),
  // independent of the user's pinned-channel visibility — so a sales-point
  // employee can still route an order to any sibling channel of the brand.
  const [posDestinations, setPosDestinations] = useState<SalesChannel[]>([]);

  // ── Bulk selection + group actions ───────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPosOpen, setBulkPosOpen] = useState(false);
  const [bulkPosChannel, setBulkPosChannel] = useState('');
  const [bulkPosDestinations, setBulkPosDestinations] = useState<SalesChannel[]>([]);
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
  const canViewInvoices = hasPermission(user, 'view_invoices');
  const canEditInvoiceNumbers = hasPermission(user, 'edit_invoice_numbers');
  // Phase D — admin/manager-only audited backward status override.
  const canManualOverride = hasPermission(user, 'manual_status_override');
  const canAssign = hasPermission(user, 'assign_orders');

  // Manual (re)assignment + auto-assignment pool (managers only).
  const [assignTarget, setAssignTarget] = useState<OrderListItem | null>(null);
  const [assignmentSettingsOpen, setAssignmentSettingsOpen] = useState(false);
  const [assignEmployees, setAssignEmployees] = useState<AssignableEmployee[]>([]);
  const [assignEmployeesLoading, setAssignEmployeesLoading] = useState(false);
  const deferredSearch = useDeferredValue(search);

  /* ── brand/channel maps ─── */
  const availableBrands = useMemo(() => {
    const m = new Map<number, string>();
    channels.forEach(c => { if (!m.has(c.brand)) m.set(c.brand, c.brand_name); });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  // The tabs are exactly the six canonical statuses (+ All); soft-deleted
  // rows live behind the "Include deleted" checkbox, not a tab.
  const visibleFlowTabs = FLOW_TABS;

  const hasActiveFilters = Boolean(
    deferredSearch ||
    flowFilter !== 'all' ||
    priorityFilter !== 'all' ||
    sourceFilter !== 'all' ||
    paymentFilter !== 'all' ||
    brandFilter !== 'all' ||
    channelFilter !== 'all' ||
    assignedFilter !== 'all' ||
    assignmentTypeFilter !== 'all' ||
    includeDeleted ||
    ordering !== defaultOrderingForFlow(flowFilter),
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
    setPriorityFilter('all');
    setSourceFilter('all');
    setPaymentFilter('all');
    setBrandFilter('all');
    setChannelFilter('all');
    setAssignedFilter('all');
    setAssignmentTypeFilter('all');
    setIncludeDeleted(false);
    setOrdering(DEFAULT_LIFO_ORDERING);
  }, []);

  const handleFlowFilterChange = useCallback((flow: OrderFlowTab) => {
    setFlowFilter(flow);
    setOrdering(defaultOrderingForFlow(flow));
    setCurrentPage(1);
  }, []);

  const fetchData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const sharedFilters = {
        ...(priorityFilter !== 'all'
          ? { priority_level: priorityFilter as 'high' | 'medium' | 'low' }
          : {}),
        ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
        ...(paymentFilter !== 'all' ? { payment_status: paymentFilter } : {}),
        ...(brandFilter !== 'all' ? { brand: Number(brandFilter) } : {}),
        ...(channelFilter !== 'all' ? { sales_channel: Number(channelFilter) } : {}),
        ...(assignedFilter === 'unassigned'
          ? { unassigned: true }
          : assignedFilter !== 'all'
            ? { assigned_to: Number(assignedFilter) }
            : {}),
        ...(assignmentTypeFilter !== 'all'
          ? { assignment_type: assignmentTypeFilter as 'auto' | 'manual' }
          : {}),
        ...(deferredSearch ? { search: deferredSearch } : {}),
      };
      // Each tab maps 1:1 to a canonical order_status value; 'all' filters
      // nothing. The backend excludes exception-overlaid rows from specific
      // status queries, so tab contents always match the tab counts.
      const activeTab = FLOW_TABS.find(t => t.value === flowFilter);
      const tabParams: { status?: string } =
        flowFilter === 'all'
          ? {}
          : { status: (activeTab?.statuses ?? []).join(',') };
      const [ordersRes, summaryRes] = await Promise.all([
        orderService.getAll({
          page: currentPage,
          page_size: pageSize,
          include_deleted: includeDeleted && canViewDeleted,
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
    assignedFilter,
    assignmentTypeFilter,
    currentPage,
    deferredSearch,
    flowFilter,
    includeDeleted,
    ordering,
    paymentFilter,
    sourceFilter,
    priorityFilter,
  ]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Load the assignable-employee roster once for managers — powers the
  // "Assigned employee" filter, the assign dialog, and the settings modal.
  const loadAssignEmployees = useCallback(async () => {
    if (!canAssign) return;
    try {
      setAssignEmployeesLoading(true);
      const res = await orderService.getAssignmentSettings();
      setAssignEmployees(res.employees);
    } catch (err) {
      console.error('Failed to load assignable employees', err);
    } finally {
      setAssignEmployeesLoading(false);
    }
  }, [canAssign]);

  useEffect(() => { loadAssignEmployees(); }, [loadAssignEmployees]);

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
    priorityFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const paginationItems = useMemo(
    () => buildPaginationItems(currentPage, totalPages),
    [currentPage, totalPages],
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
      return;
    }
    setPageJump(String(currentPage));
  }, [currentPage, totalPages]);

  const goToPage = useCallback(() => {
    const parsed = Number.parseInt(pageJump, 10);
    if (!Number.isFinite(parsed)) {
      setPageJump(String(currentPage));
      return;
    }
    const target = Math.min(totalPages, Math.max(1, parsed));
    setCurrentPage(target);
    setPageJump(String(target));
  }, [currentPage, pageJump, totalPages]);

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* DETAIL / EDIT ACTIONS                                                    */
  /* ══════════════════════════════════════════════════════════════════════════ */

  // Build the editable form snapshot from an order detail. Pure — reused when
  // opening the popup and when (re)entering edit mode with a fresh snapshot.
  const buildEditForm = (detail: OrderDetail): OrderEditRequest => {
    const customerLines = detail.customer_lines ?? detail.lines.filter(line => line.product_type !== 'packaging_item');
    return {
      lines: customerLines.map((l): OrderEditLineInput => ({
        id: l.id, product: l.product, product_name: l.product_name,
        barcode: l.barcode, quantity: l.quantity, unit_price: l.unit_price,
      })),
      discount_type: detail.discount_type,
      discount_value: detail.discount_value,
      // Seed the EFFECTIVE delivery fee: WooCommerce orders carry the courier
      // fee on shipping_total (not always mirrored to delivery_fee on older
      // rows), so fall back to it. This makes the edit fee toggle start checked
      // for any order that actually has a fee, and saving heals delivery_fee.
      delivery_fee: parseFloat(detail.delivery_fee) > 0 ? detail.delivery_fee : detail.shipping_total,
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
      // Shipping / delivery fields
      shipping_first_name: detail.shipping_first_name,
      shipping_last_name: detail.shipping_last_name,
      shipping_phone: detail.shipping_phone,
      shipping_address_1: detail.shipping_address_1,
      shipping_city: detail.shipping_city,
      shipping_state: detail.shipping_state,
      shipping_postcode: detail.shipping_postcode,
      shipping_country: detail.shipping_country,
    };
  };

  // Open an order and ACQUIRE its working lock so only one user handles it at a
  // time. If another user already holds the lock, open read-only and remember
  // who has it — the user can then take over. The backend rejects (409) any
  // mutating action from a non-holder, so this is a real concurrency guard, not
  // just UI.
  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      let lockResult: Awaited<ReturnType<typeof orderService.acquireEditLock>> | null = null;
      let heldBy: { user_name?: string | null; user_id?: number | null } | null = null;
      try {
        lockResult = await orderService.acquireEditLock(id, false);
      } catch (err: unknown) {
        const response = (err as { response?: { status?: number; data?: { lock?: { user_name?: string | null; user_id?: number | null } } } }).response;
        if (response?.status === 409) {
          heldBy = response.data?.lock ?? null; // held by someone else → take over
        }
        // Any other failure (permission, transient) just degrades to read-only —
        // opening an order to view must never hard-fail on the lock.
      }
      // Prefer the fresh snapshot the lock response carries; otherwise fetch.
      const detail = lockResult?.order ?? await orderService.getById(id);
      setViewOrder(detail);
      setEditMode(false);
      setEditForm(buildEditForm(detail));
      if (lockResult) {
        setEditLockToken(lockResult.lock.token);
        setLockedByOther(null);
      } else {
        setEditLockToken('');
        setLockedByOther({ user_name: heldBy?.user_name || 'another user', user_id: heldBy?.user_id ?? null });
      }
    } catch (err) {
      console.error('Failed to load order detail', err);
      setErrorMessage(extractErrorMessage(err, 'Failed to load order detail.'));
      setErrorDialog(true);
    } finally {
      setDetailLoading(false);
    }
  };

  // Take over an order another user holds — force-acquires the lock (logged on
  // the backend as EDIT_LOCK_TAKEN_OVER) so the previous holder's in-flight
  // actions are rejected and we become the sole handler.
  const takeOverLock = async (id: number) => {
    try {
      const lockResult = await orderService.acquireEditLock(id, true);
      if (lockResult.order) {
        setViewOrder(lockResult.order);
        setEditForm(buildEditForm(lockResult.order));
      }
      setEditLockToken(lockResult.lock.token);
      setLockedByOther(null);
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to take over this order.'));
      setErrorDialog(true);
    }
  };

  const handleStatusChange = async (id: number, status: OrderStatus) => {
    try {
      const current = viewOrder?.id === id ? viewOrder.status : undefined;
      const onMatrix = current
        ? (ALLOWED_NEXT_STATUSES[current] ?? []).includes(status)
        : true;
      // Off-matrix moves (reopening canceled/returned) go through the
      // audited, permission-gated manual-override endpoint.
      const updated = onMatrix
        ? await orderService.transitionStatus(id, status)
        : await orderService.manualTransition(id, status, 'Status changed manually from the order detail.');
      setViewOrder(updated);
      fetchData();
    } catch (err) {
      console.error('Failed to update status', err);
      setErrorMessage(extractErrorMessage(err, 'Failed to update status.'));
      setErrorDialog(true);
    }
  };


  const handleEditModeChange = (enabled: boolean) => {
    if (!viewOrder) return;
    // We already hold the working lock for the whole detail session (taken on
    // open), so toggling edit mode is a pure UI flip — the lock is released on
    // close, not here.
    setEditMode(enabled);
  };

  // Keep the lock alive while we hold it (the detail is open). A genuine 409
  // where a DIFFERENT user actively holds the lock means someone took over: we
  // drop to read-only (the backend rejects our writes anyway) and surface who.
  // Network blips, timeouts, transient 5xx, or our own lapsed lock must NOT
  // trigger the takeover handling — the next heartbeat simply retries.
  useEffect(() => {
    if (!viewOrder || !editLockToken) return undefined;
    const timer = window.setInterval(async () => {
      try {
        await orderService.heartbeatEditLock(viewOrder.id, editLockToken);
      } catch (err: unknown) {
        const response = (err as {
          response?: {
            status?: number;
            data?: { lock?: { user_id?: number | null; user_name?: string | null; locked?: boolean } };
          };
        }).response;
        const lock = response?.data?.lock;
        const takenOverByOther =
          response?.status === 409 &&
          lock?.locked === true &&
          lock?.user_id != null &&
          lock.user_id !== user?.id;
        if (!takenOverByOther) return; // transient error / self-heal → keep holding
        // Lost the lock — switch this popup to read-only and show who took over.
        setEditLockToken('');
        setEditMode(false);
        setLockedByOther({ user_name: lock?.user_name || 'another user', user_id: lock?.user_id ?? null });
        setErrorMessage(`This order was taken over by ${lock?.user_name || 'another user'}. You're now in read-only mode.`);
        setErrorDialog(true);
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [editLockToken, viewOrder?.id, user?.id]);

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

      // If this product is already on another line, merge instead of creating a
      // duplicate row: add the current line's quantity to the existing line and
      // drop the current one. Mirrors the Create Order behaviour.
      const dupIndex = lines.findIndex((l, i) => i !== index && l.product === selectedProduct.id);
      if (dupIndex !== -1) {
        const addQty = cur.quantity || 1;
        const merged = lines.map((l, i) =>
          i === dupIndex ? { ...l, quantity: (l.quantity || 1) + addQty } : l
        );
        merged.splice(index, 1);
        return { ...prev, lines: merged };
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
      const customerIdentityChanged = (
        (payload.billing_first_name ?? '') !== (viewOrder.billing_first_name ?? '')
        || (payload.billing_last_name ?? '') !== (viewOrder.billing_last_name ?? '')
        || (payload.billing_email ?? '') !== (viewOrder.billing_email ?? '')
        || (payload.billing_phone ?? '') !== (viewOrder.billing_phone ?? '')
      );
      const updated = await orderService.editOrder(viewOrder.id, payload);
      // Keep the working lock — the user is still on the order. It's released
      // when the detail popup closes, not on each save.
      setViewOrder(updated);
      setEditMode(false);
      if (customerIdentityChanged && search.trim()) {
        // A search for the previous name/phone would immediately hide the row
        // after saving. Clear it and let the normal filter effect reload page 1.
        setSearch('');
        setCurrentPage(1);
        setSuccessMessage('Order updated. Customer search was cleared to keep the order visible.');
      } else {
        await fetchData();
        setSuccessMessage('Order updated successfully.');
      }
      setSuccessDialog(true);
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

  const handleCreateInvoice = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      const updated = await orderService.createInvoice(viewOrder.id);
      setViewOrder(updated);
      setOrders(current => current.map(order => (
        order.id === updated.id ? { ...order, ...updated } : order
      )));
    } catch (err) {
      setErrorMessage(extractErrorMessage(err, 'Failed to create invoice.'));
      setErrorDialog(true);
      throw err;
    } finally {
      setMutatingOrder(false);
    }
  };

  const handleUpdateInvoice = async (payload: Parameters<typeof orderService.updateInvoice>[1]) => {
    if (!viewOrder) return;
    const updated = await orderService.updateInvoice(viewOrder.id, payload);
    setViewOrder(updated);
    setOrders(current => current.map(order => (
      order.id === updated.id ? { ...order, ...updated } : order
    )));
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
      resetActionFailure(id); // success → clear the failed-attempt tally
      setSuccessMessage('Order confirmed successfully.');
      setSuccessDialog(true);
    } catch (err) {
      bumpActionFailure(id); // no successful response → count it toward Cancel
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
        attempts >= 3
          ? `No answer recorded (${attempts} attempts). Consider delaying the order for a later follow-up.`
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
      resetActionFailure(id); // success → clear the failed-attempt tally
      setSuccessMessage('Order marked as delayed.');
      setSuccessDialog(true);
    } catch (err) {
      bumpActionFailure(id); // no successful response → count it toward Cancel
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
      .filter(o => !o.is_deleted && o.status === 'confirmed' && !o.sent_to_pos_at && !o.delivery_reference)
      .map(o => o.id),
    [selectedOrders],
  );
  const deliveryEligibleIds = useMemo(
    () => selectedOrders
      .filter(o => !o.is_deleted && o.status === 'confirmed' && !o.in_store_pickup && !o.delivery_reference)
      .map(o => o.id),
    [selectedOrders],
  );
  const bulkPosChannels = useMemo(
    // Same-brand active destinations for the selected orders, fetched in
    // openBulkPos so a sales-point employee sees sibling channels — not just
    // their pinned one. Falls back to the caller's own active channels until
    // that fetch populates (or if it fails).
    () => (bulkPosDestinations.length ? bulkPosDestinations : channels.filter(c => c.is_active)),
    [bulkPosDestinations, channels],
  );

  const runBulk = async (
    action: BulkOrderAction,
    ids: number[],
    options: { pos_sales_channel?: number; reason?: string; employee_id?: number } | undefined,
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
  // Bulk assignment (managers): auto-distribute across the pool, or assign all
  // selected to one employee. Reload the roster after so open-order counts update.
  const handleBulkAutoAssign = async () => {
    await runBulk('auto_assign', Array.from(selectedIds), undefined, 'Auto-assigned');
    loadAssignEmployees();
  };
  const handleBulkAssignTo = async (employeeId: number) => {
    await runBulk('assign', Array.from(selectedIds), { employee_id: employeeId }, 'Assigned');
    loadAssignEmployees();
  };
  const openBulkPos = async () => {
    setBulkPosChannel('');
    setBulkPosDestinations([]);
    setBulkPosOpen(true);
    // Union every active same-brand destination across the selected eligible
    // orders' brands (one representative order per brand), deduped by id — so a
    // pinned employee can route to sibling channels here too.
    try {
      const eligible = selectedOrders.filter(o => posEligibleIds.includes(o.id));
      const repByBrand = new Map<number, number>();
      eligible.forEach(o => {
        if (o.brand != null && !repByBrand.has(o.brand)) repByBrand.set(o.brand, o.id);
      });
      const lists = await Promise.all(
        [...repByBrand.values()].map(id => orderService.getPosDestinations(id)),
      );
      const merged = new Map<number, SalesChannel>();
      lists.flat().forEach(c => merged.set(c.id, c));
      setBulkPosDestinations([...merged.values()]);
    } catch {
      setBulkPosDestinations([]);
    }
  };
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

  /* ── manual rollback + exception reopen + WC re-sync ─── */
  // Targets come from the overlay map when the order is cancelled/returned/
  // exchanged (reopen), otherwise from the backward pipeline map.
  const manualTargetsFor = (order: OrderListItem | OrderDetail) =>
    MANUAL_TRANSITIONS[order.status] ?? [];

  const openManualRollback = (order: OrderListItem | OrderDetail) => {
    const targets = manualTargetsFor(order);
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
        manualTarget as OrderListItem['status'],
        manualReason.trim(),
      );
      if (viewOrder?.id === updated.id) setViewOrder(updated);
      setManualOrder(null);
      await fetchData();
      setSuccessMessage(`Order rolled back to "${orderStatusLabel(updated.status)}".`);
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
    setPosDestinations([]);
    setSendPOSDialog(true);
    try {
      setMutatingOrder(true);
      const detail = 'lines' in order ? order : await orderService.getById(order.id);
      setSendPOSOrder(detail);
      // Offer every ACTIVE, same-brand channel as a destination — not only the
      // caller's pinned sales point. The backend re-checks brand + stock.
      const dests = await orderService.getPosDestinations(detail.id);
      setPosDestinations(dests);
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

  const handleSubmitDelivery = async (id: number, force = false) => {
    setMutatingOrder(true);
    try {
      await orderService.submitDelivery(id, { force });
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

  // Stock guard — stock is reserved when an order is SENT TO DELIVERY (not at
  // confirm, which is now a plain status move). Dispatching an order whose
  // products are short stays POSSIBLE, but we surface a review popup first
  // listing the shortfalls; acknowledging it sends as a backorder (force).
  // (Only the detail popup carries per-product stock, so the guard runs there.)
  const guardStock = (id: number, title: string, run: (forced: boolean) => void) => {
    const ord = viewOrder?.id === id ? viewOrder : undefined;
    const missing = ord ? getMissingStock(ord) : [];
    if (missing.length > 0) {
      setStockWarn({ title, items: missing, onProceed: () => run(true) });
    } else {
      run(false);
    }
  };
  const submitDeliveryWithStockGuard = (id: number) =>
    guardStock(id, 'Send to delivery with missing products?', forced => handleSubmitDelivery(id, forced));

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
    lineConditions: ReturnLineCondition[];
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

  // Every tab count comes from the canonical order_status breakdown
  // (order_status_kpis.by_status, exception-overlaid rows excluded) — the same
  // field the row chip renders, so tabs, counts and badges always agree.
  const tabCounts = useMemo(() => {
    const byStatus = summary?.order_status_kpis?.by_status ?? {};
    const sumOf = (keys: OrderStatus[]) =>
      keys.reduce((n, k) => n + (byStatus[k] ?? 0), 0);
    const counts: Record<string, number> = {
      all: summary?.order_status_kpis?.total_orders ?? summary?.total_orders ?? 0,
    };
    for (const tab of FLOW_TABS) {
      if (tab.value === 'all') continue;
      counts[tab.value] = sumOf(tab.statuses);
    }
    return counts;
  }, [summary]);

  // Secondary header actions — rendered as a button row on tablet/desktop and
  // collapsed into a "⋮ More" menu on phones so the header never wraps.
  const secondaryActions: Array<{ icon: typeof Package; label: string; onClick: () => void; spin?: boolean }> = [
    ...(canPackageOrders ? [{ icon: Package, label: 'Scan Packaging', onClick: () => { setLookupMode('packaging'); setReturnLookupDialog(true); } }] : []),
    ...(canProcessReturn ? [{ icon: RotateCcw, label: 'Find Return', onClick: () => { setLookupMode('return'); setReturnLookupDialog(true); } }] : []),
    ...(canImportOrders ? [{ icon: RefreshCw, label: 'Sync WC', onClick: () => setSyncDialog(true) }] : []),
    ...(canAssign ? [{ icon: Users, label: 'Auto-assignment', onClick: () => setAssignmentSettingsOpen(true) }] : []),
    { icon: RefreshCw, label: 'Refresh', onClick: () => fetchData(), spin: loading },
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">

      {/* ── Header ─── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 tracking-tight">
            <ShoppingCart className="size-5 sm:size-6 shrink-0" /> Order Operations
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
            Confirm clients, route to POS, submit delivery, and process returns
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canCreateOrders && (
            <Button size="sm" onClick={() => setCreateOrderOpen(true)} className="gap-1.5">
              <Plus className="size-4" /> <span className="hidden sm:inline">Create Order</span><span className="sm:hidden">Create</span>
            </Button>
          )}
          {/* Tablet / desktop: full button row */}
          <div className="hidden items-center gap-2 sm:flex">
            {secondaryActions.map(a => (
              <Button key={a.label} variant="outline" size="sm" onClick={a.onClick} disabled={a.spin} className="gap-1.5">
                <a.icon className={`size-4 ${a.spin ? 'animate-spin' : ''}`} /> {a.label}
              </Button>
            ))}
          </div>
          {/* Phone: collapse secondary actions into a menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-9 sm:hidden" aria-label="More actions">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {secondaryActions.map(a => (
                <DropdownMenuItem key={a.label} onClick={a.onClick} className="gap-2">
                  <a.icon className={`size-4 ${a.spin ? 'animate-spin' : ''}`} /> {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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


      {/* ── Lifecycle tabs ──────────────────────────────────────────────────
          Canonical status tabs choose the lifecycle stage; the Filters card
          below then narrows the working set shown in the queue. */}
      <div className="space-y-3">
        {canViewRevenue && summary && (showRevenue || showNetRevenue) && (
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-x-visible sm:px-0 sm:pb-0">
            {showNetRevenue && (
              <KpiCard title="Net Revenue" unit="TND" value={summary.order_status_kpis?.revenue ?? '—'} accent icon={<TrendingUp className="size-3.5" />} />
            )}
            {showRevenue && (
              <KpiCard title="Gross Revenue" unit="TND" value={summary.revenue ?? '—'} icon={<TrendingUp className="size-3.5" />} />
            )}
            {summary.order_status_kpis?.successful_sales != null && (
              <KpiCard title="Successful Sales" value={summary.order_status_kpis.successful_sales} accent icon={<CheckCircle className="size-3.5" />} />
            )}
          </div>
        )}

        {/* Phones: one horizontally-scrollable row of compact stat-chips.
            Tablet/desktop: a wrapping grid of cards. */}
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-x-visible sm:px-0 sm:pb-0 md:grid-cols-4 xl:grid-cols-7">
          {visibleFlowTabs.map(tab => {
            const count = tabCounts[tab.value] ?? 0;
            const active = flowFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => handleFlowFilterChange(tab.value)}
                aria-pressed={active}
                className={`flex shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition sm:w-full sm:justify-between sm:rounded-xl ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={active ? 'text-primary-foreground' : 'text-muted-foreground'}>{tab.icon}</span>
                  {tab.label}
                </span>
                <span className={`min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${
                  active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  {count > 9999 ? '9999+' : count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters (collapsible) ─── */}
      <Card className="border-muted/70">
        <button
          type="button"
          onClick={() => setFiltersOpen(open => !open)}
          aria-expanded={filtersOpen}
          aria-controls="orders-filters-body"
          className="flex w-full items-center justify-between gap-2 rounded-t-xl p-4 text-left transition hover:bg-muted/30"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SlidersHorizontal className="size-4" />
            </span>
            Filters &amp; sorting
            {hasActiveFilters && (
              <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                Active
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="tabular-nums font-medium">
              {loading ? '…' : `${totalOrders} order${totalOrders !== 1 ? 's' : ''}`}
            </Badge>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {filtersOpen && (
        <CardContent id="orders-filters-body" className="space-y-4 p-4 pt-0">
          {/* Search — the primary filter, full width and prominent. */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by order #, delivery name, phone or address…"
              className="h-10 pl-9 pr-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>

          {/* Dropdown filters — even, responsive grid. `min-w-0` lets each cell
              shrink so long select values (e.g. the sort label) truncate inside
              the trigger instead of overflowing the card. The long "Sort by"
              spans the full row on phones so it stays readable. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
            <div className="min-w-0 space-y-1.5">
              <label className={FILTER_LABEL}>Priority</label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className={FILTER_LABEL}>Source</label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="WOOCOMMERCE">WooCommerce</SelectItem>
                  <SelectItem value="POS">POS</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <label className={FILTER_LABEL}>Payment</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payments</SelectItem>
                  <SelectItem value="UNPAID">Unpaid</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canFilterByBrand && (
              <div className="min-w-0 space-y-1.5">
                <label className={FILTER_LABEL}>Brand</label>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Brand" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brands</SelectItem>
                    {availableBrands.map(brand => (
                      <SelectItem key={brand.id} value={String(brand.id)}>{brand.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <label className={FILTER_LABEL}>Channel</label>
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Channel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  {channels.map(channel => (
                    <SelectItem key={channel.id} value={String(channel.id)}>{channel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canAssign && (
              <>
                <div className="min-w-0 space-y-1.5">
                  <label className={FILTER_LABEL}>Assigned to</label>
                  <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                    <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Assigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Anyone</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {assignEmployees.map(emp => (
                        <SelectItem key={emp.id} value={String(emp.id)}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <label className={FILTER_LABEL}>Assignment</label>
                  <Select value={assignmentTypeFilter} onValueChange={setAssignmentTypeFilter}>
                    <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any type</SelectItem>
                      <SelectItem value="auto">Automatic</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
              <label className={FILTER_LABEL}>Sort by</label>
              <Select value={ordering} onValueChange={setOrdering}>
                <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  {ORDER_SORT_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Footer — secondary toggles + reset, set off by a divider. */}
          {(canViewDeleted || hasActiveFilters) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              {canViewDeleted ? (
                <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                  <Checkbox
                    checked={includeDeleted}
                    onCheckedChange={c => setIncludeDeleted(Boolean(c))}
                  />
                  Include deleted orders
                </label>
              ) : <span />}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={clearFilters}
                >
                  <X className="size-3.5" /> Clear filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* ── Orders table ─── */}
      <Card className="overflow-hidden border-muted/70">
        <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Priority order queue</h2>
            <p className="text-xs text-muted-foreground">
              Action urgency and business priority are separate signals. Current sort:{' '}
              {ORDER_SORT_OPTIONS.find(option => option.value === ordering)?.label ?? 'Table column'}.
            </p>
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
        {/* Desktop / tablet: full sortable table. Hidden on phones, which get
            the touch-friendly card list below. */}
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="h-10 w-10 px-2">
                  <Checkbox
                    checked={allVisibleSelected ? true : (someVisibleSelected ? 'indeterminate' : false)}
                    onCheckedChange={toggleSelectAll}
                    disabled={selectableOrders.length === 0}
                    aria-label="Select all orders on this page"
                  />
                </TableHead>
                <SortableHead label="Action / Priority" field="lifecycle_priority" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Order #" field="order_number" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Delivery contact" field="billing_last_name" ordering={ordering} onSort={handleSort} />
                <SortableHead label="Points" field="client__points" ordering={ordering} onSort={handleSort} className="hidden lg:table-cell" />
                <SortableHead label="Channel" field="sales_channel__name" ordering={ordering} onSort={handleSort} className="hidden md:table-cell" />
                <SortableHead label="Source" field="source" ordering={ordering} onSort={handleSort} className="hidden sm:table-cell" />
                <SortableHead label="Status" field="status" ordering={ordering} onSort={handleSort} />
                {canAssign && <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Assigned To</TableHead>}
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
                  className={`group cursor-pointer transition-colors ${ORDER_STATUS_ROW_STYLES[o.status] ?? 'hover:bg-muted/30'} ${o.is_deleted ? 'opacity-50' : ''}`}
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
                  <TableCell>
                    <PriorityBadge
                      actionPriority={o.lifecycle_priority}
                      businessPriority={o.priority_level}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{o.order_number}</TableCell>
                  <TableCell>
                    {/* Delivery contact — the order's recipient snapshot (shipping
                        block, billing fallback), NEVER the linked client record:
                        customers change the recipient name/phone/address per order. */}
                    <div className="max-w-[190px]">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-sm font-medium">{o.delivery_name || o.client_email || '—'}</p>
                        {o.client_is_blocked && (
                          <Badge variant="destructive" className="h-4 px-1 text-[9px] gap-0.5 shrink-0">
                            <AlertTriangle className="size-2.5" /> Blocked
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{o.delivery_phone || 'No phone'}</p>
                      {o.delivery_address && (
                        <p className="truncate text-[11px] text-muted-foreground/80" title={o.delivery_address}>
                          {o.delivery_address}
                        </p>
                      )}
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
                      {/* THE canonical lifecycle chip. */}
                      <OrderStatusBadge status={o.status} label={o.status_display} />
                      {/* WooCommerce push-sync state — only when noteworthy (hidden for 'imported'). */}
                      <SyncStatusBadge status={o.sync_status} label={o.sync_status_display} />
                      {o.is_deleted && <Badge variant="destructive" className="text-xs">Deleted</Badge>}
                    </div>
                  </TableCell>
                  {canAssign && (
                    <TableCell className="hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                      <AssignmentBadge order={o} canAssign onClick={() => setAssignTarget(o)} />
                    </TableCell>
                  )}
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
                          {!o.is_deleted && (['confirmed', 'packaging', 'done'].includes(o.status) ? canUpdateConfirmedOrders : canUpdateUnconfirmedOrders) && (
                            <DropdownMenuItem onClick={() => openDetail(o.id)} className="gap-2">
                              <Pencil className="size-4" /> Edit Order
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { openDetail(o.id).then(() => { setLogsDialog(true); }); }} className="gap-2">
                            <History className="size-4" /> View Logs
                          </DropdownMenuItem>
                          {/* Actions follow the one transition matrix:
                              new → confirmed / not_answered / delayed;
                              delayed | not_answered → confirmed;
                              confirmed → packaging (POS / delivery) → done. */}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && ['new', 'delayed', 'not_answered'].includes(o.status) && canConfirmOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.confirmOrder(o.id), 'Order confirmed.')} className="gap-2">
                              <CheckCircle className="size-4" /> Confirm
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.status === 'new' && canUpdateUnconfirmedOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.markNotAnswered(o.id), 'No-answer attempt recorded.')} className="gap-2">
                              <Phone className="size-4" /> No Answer ({o.not_answered_attempts ?? 0})
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && o.status === 'delayed' && canDelayOrders && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.restoreDelayed(o.id), 'Delayed order restored to pending.')} className="gap-2">
                              <Undo2 className="size-4" /> Restore Delay
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.status === 'confirmed' && !o.sent_to_pos_at && !o.delivery_reference && canSendToPos && (
                            <DropdownMenuItem onClick={() => openSendPOSDialog(o)} className="gap-2">
                              <Store className="size-4" /> Send to POS
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && o.sent_to_pos_at && !o.pos_validated_at && canValidatePos && (
                            <DropdownMenuItem onClick={() => runLifecycleAction(() => orderService.validatePOS(o.id), 'POS order validated.')} className="gap-2">
                              <CheckCircle className="size-4" /> Validate POS
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && !isDirectPOSCompleted(o) && o.status === 'confirmed' && !o.in_store_pickup && !o.delivery_reference && canSendToDelivery && (
                            <DropdownMenuItem onClick={() => handleSubmitDelivery(o.id)} className="gap-2">
                              <Truck className="size-4" /> Send Delivery
                            </DropdownMenuItem>
                          )}
                          {!o.is_deleted && o.status === 'done' && canProcessReturn && (
                            <DropdownMenuItem onClick={() => handleProcessReturn(o.id)} className="gap-2">
                              <RotateCcw className="size-4" /> Process Return
                            </DropdownMenuItem>
                          )}
                          {/* WooCommerce push retry for parked / failed syncs. */}
                          {!o.is_deleted && o.source === 'WOOCOMMERCE' && o.external_order_id && (o.sync_status === 'sync_failed' || o.sync_status === 'pending_sync') && canImportOrders && (
                            <DropdownMenuItem onClick={() => handleRetrySync(o.id)} className="gap-2">
                              <RefreshCw className="size-4" /> Retry WC Sync
                            </DropdownMenuItem>
                          )}
                          {/* Audited, reason-required backward override / exception reopen. */}
                          {!o.is_deleted && canManualOverride && manualTargetsFor(o).length > 0 && (
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

        {/* Phones: each order as a tappable card. Tap opens the full detail
            (where every lifecycle action lives); the checkbox feeds bulk
            actions. Keeps the data dense but readable on a narrow screen. */}
        <div className="divide-y md:hidden">
          {loading && (
            <div className="flex flex-col items-center gap-2 py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading orders…</span>
            </div>
          )}
          {!loading && orders.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">No orders found.</div>
          )}
          {!loading && orders.map(o => (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(o.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(o.id); } }}
              className={`flex w-full cursor-pointer flex-col gap-2 px-3 py-3 text-left transition-colors active:bg-muted/50 ${ORDER_STATUS_ROW_STYLES[o.status] ?? ''} ${o.is_deleted ? 'opacity-60' : ''}`}
            >
              {/* Top: select + order# + priority, status on the right */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span onClick={e => e.stopPropagation()} className="flex">
                    <Checkbox
                      checked={selectedIds.has(o.id)}
                      onCheckedChange={() => toggleSelectOne(o.id)}
                      disabled={o.is_deleted}
                      aria-label={`Select order ${o.order_number}`}
                    />
                  </span>
                  <span className="truncate font-mono text-xs font-semibold">{o.order_number}</span>
                  <PriorityBadge actionPriority={o.lifecycle_priority} businessPriority={o.priority_level} />
                </div>
                <OrderStatusBadge status={o.status} label={o.status_display} />
              </div>

              {/* Delivery contact (recipient snapshot — never the client record) */}
              <div className="min-w-0 pl-7">
                <div className="flex items-center gap-1.5">
                  <User className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{o.delivery_name || o.client_email || '—'}</span>
                  {o.client_is_blocked && (
                    <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[9px]">Blocked</Badge>
                  )}
                </div>
                {(o.delivery_phone || o.delivery_address) && (
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="size-3 shrink-0" />
                    <span className="truncate">{o.delivery_phone || o.delivery_address}</span>
                  </div>
                )}
              </div>

              {/* Footer: badges + total/date + chevron affordance */}
              <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 pl-7">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <SourceBadge source={o.source} />
                  <SyncStatusBadge status={o.sync_status} label={o.sync_status_display} />
                  {o.is_deleted && <Badge variant="destructive" className="text-[10px]">Deleted</Badge>}
                  {canAssign && (
                    <span onClick={e => e.stopPropagation()}>
                      <AssignmentBadge order={o} canAssign onClick={() => setAssignTarget(o)} />
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{fmtCurrency(o.currency, o.total)}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(o.created_at)}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-3 text-sm lg:flex-row lg:items-center lg:justify-between">
        <span className="text-center text-muted-foreground lg:text-left">
          {totalOrders > 0
            ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, totalOrders)} of ${totalOrders}`
            : 'No orders'}
          {' · '}
          Page {currentPage} of {totalPages}
        </span>
        {/* Phones: a clean ‹ Prev · X / Y · Next › bar (no wrapping grid).
            Tablet/desktop: full numbered pages + a "Go to" jump box. */}
        <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 sm:flex-none"
            disabled={loading || currentPage <= 1}
            onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>

          <div className="hidden items-center gap-1 sm:flex" aria-label="Order result pages">
            {paginationItems.map(item => (
              typeof item === 'number' ? (
                <Button
                  key={item}
                  type="button"
                  variant={item === currentPage ? 'default' : 'outline'}
                  size="icon"
                  className="size-8 text-xs"
                  disabled={loading}
                  aria-label={`Go to page ${item}`}
                  aria-current={item === currentPage ? 'page' : undefined}
                  onClick={() => setCurrentPage(item)}
                >
                  {item}
                </Button>
              ) : (
                <span
                  key={item}
                  className="flex size-8 items-center justify-center text-muted-foreground"
                  aria-hidden
                >
                  …
                </span>
              )
            ))}
          </div>

          {/* Compact page indicator — phones only. */}
          <span className="shrink-0 px-1 text-sm font-medium tabular-nums text-muted-foreground sm:hidden">
            {currentPage} / {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 sm:flex-none"
            disabled={loading || currentPage >= totalPages}
            onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>

          <div className="ml-1 hidden items-center gap-1.5 border-l pl-2 sm:flex">
            <Label htmlFor="orders-page-jump" className="whitespace-nowrap text-xs text-muted-foreground">
              Go to
            </Label>
            <Input
              id="orders-page-jump"
              type="number"
              min={1}
              max={totalPages}
              inputMode="numeric"
              value={pageJump}
              onChange={event => setPageJump(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToPage();
                }
              }}
              className="h-8 w-16 px-2 text-center text-xs"
              aria-label={`Page number between 1 and ${totalPages}`}
              disabled={loading}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5"
              onClick={goToPage}
              disabled={loading}
            >
              Go
            </Button>
          </div>
        </div>
      </div>

      {/* Take-over confirmation shown when the order is locked by another user */}
      <Dialog open={!!takeoverInfo} onOpenChange={(open) => { if (!open) setTakeoverInfo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take over this order?</DialogTitle>
            <DialogDescription>
              This order is currently being handled by{' '}
              <span className="font-semibold text-foreground">{takeoverInfo?.userName}</span>.
              {' '}Taking over ends their session and makes you the sole handler. This is logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTakeoverInfo(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const id = takeoverInfo?.orderId;
                setTakeoverInfo(null);
                if (id != null) void takeOverLock(id);
              }}
            >
              Yes, take over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Missing-stock review — shown before Confirm / Send-delivery proceeds. */}
      <Dialog open={!!stockWarn} onOpenChange={(open) => { if (!open) setStockWarn(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="size-5" /> {stockWarn?.title}
            </DialogTitle>
            <DialogDescription>
              This order has products that aren't fully in stock on its fulfilment channel:
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
            {(stockWarn?.items ?? []).map(it => (
              <li key={it.name} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{it.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  required <span className="font-semibold text-foreground">{it.required}</span>,
                  available <span className={`font-semibold ${it.available <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>{it.available}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Are you sure you want to continue anyway?</p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setStockWarn(null)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => { const proceed = stockWarn?.onProceed; setStockWarn(null); proceed?.(); }}
            >
              Continue anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialogs ─── */}
      <OrderDetailDialog
        open={detailLoading || !!viewOrder}
        onOpenChange={() => {
          // Release our working lock so the order frees up for the next user.
          if (viewOrder && editLockToken) {
            orderService.releaseEditLock(viewOrder.id, editLockToken).catch(() => undefined);
          }
          setEditLockToken('');
          setLockedByOther(null);
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
        failedActionAttempts={viewOrder ? (actionFailures[viewOrder.id] ?? 0) : 0}
        isLockOwner={!!editLockToken}
        lockedByName={lockedByOther?.user_name ?? null}
        onTakeOver={() => { if (viewOrder) setTakeoverInfo({ orderId: viewOrder.id, userName: lockedByOther?.user_name || 'another user' }); }}
        onStatusChange={handleStatusChange}
        onConfirmOrder={handleConfirmOrder}
        onNotAnswered={handleNotAnswered}
        onDelayOrder={handleDelayOrder}
        onRestoreDelayed={handleRestoreDelayed}
        onCancelOrder={handleCancelOrder}
        onOpenSendPOS={openSendPOSDialog}
        onSendDelivery={submitDeliveryWithStockGuard}
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
        onChangeBilling={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field]: val } : prev);
        }}
        onOpenLogs={handleOpenLogs}
        onDelete={handleSoftDelete}
        onRestore={handleRestoreOrder}
        onCreateInvoice={handleCreateInvoice}
        onUpdateInvoice={handleUpdateInvoice}
        permissions={{
          // Every mutating action also requires holding the working lock — a
          // read-only viewer (someone else holds it) sees the buttons hidden and
          // the take-over banner instead. The backend enforces the same rule.
          edit: !!editLockToken && (viewOrder ? (['confirmed', 'packaging', 'done'].includes(viewOrder.status) ? canUpdateConfirmedOrders : canUpdateUnconfirmedOrders) : false),
          confirm: !!editLockToken && canConfirmOrders,
          delay: !!editLockToken && canDelayOrders,
          cancel: !!editLockToken && canCancelOrders,
          sendToPos: !!editLockToken && canSendToPos,
          sendToDelivery: !!editLockToken && canSendToDelivery,
          processReturn: !!editLockToken && canProcessReturn,
          packageOrder: !!editLockToken && canPackageOrders,
          delete: !!editLockToken && canSoftDelete,
          restore: !!editLockToken && canRestoreDeleted,
          manualOverride: !!editLockToken && canManualOverride,
          viewInvoice: canViewInvoices,
          editInvoice: canEditInvoiceNumbers,
        }}
      />

      <SendToPOSDialog
        open={sendPOSDialog}
        onOpenChange={(open) => {
          setSendPOSDialog(open);
          if (!open) {
            setSendPOSOrder(null);
            setSelectedPOSChannel('');
            setPosDestinations([]);
          }
        }}
        order={sendPOSOrder}
        channels={posDestinations}
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
            {canAssign && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={bulkBusy}>
                    <Users className="size-3.5" /> Assign
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  <DropdownMenuItem onClick={handleBulkAutoAssign} className="gap-2">
                    <Users className="size-4" /> Auto-assign (balanced)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Assign all to
                  </DropdownMenuLabel>
                  {assignEmployees.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No employees found.</div>
                  ) : (
                    assignEmployees.map(emp => (
                      <DropdownMenuItem key={emp.id} onClick={() => handleBulkAssignTo(emp.id)} className="gap-2">
                        <User className="size-4" />
                        <span className="truncate">{emp.name}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{emp.open_orders} open</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
              <OrderStatusBadge status={manualOrder?.status} label={manualOrder?.status_display} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-target">Roll back to</Label>
              <Select value={manualTarget} onValueChange={setManualTarget}>
                <SelectTrigger id="manual-target"><SelectValue placeholder="Select a status" /></SelectTrigger>
                <SelectContent>
                  {(manualOrder ? MANUAL_TRANSITIONS[manualOrder.status] ?? [] : []).map(t => (
                    <SelectItem key={t} value={t}>{orderStatusLabel(t)}</SelectItem>
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

      {/* Manual (re)assignment + auto-assignment pool (assign_orders only) */}
      {canAssign && (
        <>
          <AssignEmployeeDialog
            open={!!assignTarget}
            onOpenChange={open => { if (!open) setAssignTarget(null); }}
            order={assignTarget}
            employees={assignEmployees}
            loadingEmployees={assignEmployeesLoading}
            onAssigned={() => {
              setAssignTarget(null);
              fetchData({ silent: true });
              loadAssignEmployees();
            }}
          />
          <AutoAssignmentSettingsDialog
            open={assignmentSettingsOpen}
            onOpenChange={setAssignmentSettingsOpen}
            employees={assignEmployees}
            loading={assignEmployeesLoading}
            onSaved={emps => { setAssignEmployees(emps); fetchData({ silent: true }); }}
          />
        </>
      )}
    </div>
  );
}
