/**
 * OrderDialogs — Clean, production-ready dialog system for order management.
 *
 * Components exported:
 *   - OrderDetailDialog  — View + edit order (responsive: Dialog desktop / Drawer mobile)
 *   - SyncDialog         — WooCommerce import
 *   - PreviewDialog      — WC order preview + selective sync
 *   - LogsDialog         — Audit trail timeline
 *   - MessageAlert       — Success / error feedback
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  CheckCircle, XCircle, RefreshCw, Eye, History, Undo2,
  Trash2, Plus, Loader2, Pencil, Store, Globe, Check,
  Package, Boxes, AlertCircle, TrendingUp, Search, ChevronDown,
  CreditCard, Calendar, User, MapPin, Percent, MessageSquare,
  Phone, MessageCircleMore, CalendarClock, Ban, ThumbsUp, Clock,
  ChevronLeft, ChevronRight, Truck, ShieldAlert, ScanLine,
  Lock, Unlock, RotateCcw, Send, PackageCheck, AlertTriangle,
  Award, Link2, Unlink, ArrowRight, Tag, FileText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';
import { TUNISIA_GOVERNORATE_OPTIONS } from '@/constants/tunisia';
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { getMediaUrl } from '@/utils/helpers';
import { productService } from '@/services/product.service';
import { promotionService } from '@/services/promotion.service';
import { useAuthStore } from '@/store/authStore';
import { POSCameraScanner } from '../pos/POSCameraScanner';
import { OrderClientSelector } from './OrderClientSelector';
import { useCurrentCompany } from '@/hooks/queries/useCompanies';
import { InvoicePreviewDialog, invoiceFromOrder } from '@/components/invoice';
import { ClientInfoDialog } from './ClientInfoDialog';
import { OrderStatusBadge, SyncStatusBadge, orderStatusLabel } from './orderStatusBadges';

// Mirrors the backend OrderStatusService.ALLOWED_TRANSITIONS (server
// re-validates; this only drives which targets the UI offers).
export const ALLOWED_NEXT_STATUSES: Record<string, OrderStatus[]> = {
  new:          ['confirmed', 'not_answered', 'delayed', 'canceled'],
  not_answered: ['confirmed', 'delayed', 'canceled'],
  delayed:      ['confirmed', 'not_answered', 'canceled'],
  confirmed:    ['packaging', 'delayed', 'canceled'],
  packaging:    ['done', 'canceled'],
  done:         ['returned'],
  returned:     [],
  canceled:     [],
};

// Terminal statuses can be REOPENED through the audited manual-override
// endpoint (admin/manager permission) — mirrors the backend
// ALLOWED_MANUAL_TRANSITIONS reopen entries.
export const REOPEN_TARGETS: Record<string, OrderStatus[]> = {
  canceled: ['new', 'confirmed'],
  returned: ['done'],
};
import type {
  OrderDetail, OrderLine, OrderEditRequest, OrderLogEntry, OrderDiscountType,
  ProductListItem, SalesChannel, OrderStatus, OrderStockByChannel,
  POSOrderCreateRequest, Client, OrderSocialSource, DiscountCalculationResult,
  OrderChannelStock,
} from '@/types';
import { ORDER_SOCIAL_SOURCES, SELLABLE_PRODUCT_TYPES } from '@/types';
import {
  getFulfilmentChannelStock, stockItemFor, stockStatusOf, worstStatus,
  type StockStatus,
} from './orderStock';
import type {
  InvoiceMutationPayload,
  ReturnLineCondition,
  WooCommerceOrderPreviewResponse,
} from '@/services/order.service';

/* ═══════════════════════════════════════════════════════════════════════════ */
/* RESPONSIVE SHEET                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ResponsiveSheet({
  open, onOpenChange, title, description, children,
  wide = false, footer,
}: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}>) {
  const mobile = useIsMobile();

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[95dvh] max-h-[95dvh] flex flex-col rounded-t-2xl">

          {/* Header */}
          <DrawerHeader className="text-left px-4 pt-4 pb-3 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <DrawerTitle className="text-base font-semibold tracking-tight">
              {title}
            </DrawerTitle>
            {description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </DrawerHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {children}
          </div>

          {/* Footer — sticky bottom bar, kept clear of the device safe area */}
          {footer && (
            <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background/95 backdrop-blur">
              {footer}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`
          ${wide ? 'max-w-3xl lg:max-w-4xl w-[96vw]' : 'max-w-lg'}
          max-h-[90vh]
          flex flex-col
          p-0
          gap-0
          rounded-xl
          overflow-hidden
          shadow-2xl
        `}
      >
        {/* Dialog Header - Sticky */}
        <div className="border-b border-border px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-background to-muted/20 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-xs sm:text-sm mt-1 text-muted-foreground leading-relaxed">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
            {children}
          </div>
        </div>

        {/* Dialog Footer - Sticky */}
        {footer && (
          <div className="border-t border-border px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-t from-muted/30 to-background sticky bottom-0 z-20 flex-shrink-0">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TOKENS                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */




/* ═══════════════════════════════════════════════════════════════════════════ */
/* PRODUCT IMAGE                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ProductImage({ src, alt, size = 'sm' }: { src?: string | null; alt: string; size?: 'sm' | 'md' }) {
  const [err, setErr] = useState(false);
  const url = getMediaUrl(src);
  const dims = size === 'sm' ? 'size-8' : 'size-10';

  if (!url || err) {
    return (
      <div className={`${dims} rounded-lg bg-muted flex items-center justify-center flex-shrink-0`}>
        <Package className="size-3.5 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <img
      src={url} alt={alt}
      className={`${dims} rounded-lg border object-cover flex-shrink-0`}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}

function titleCase(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Compact metric cell used by the mobile stock cards. */
function StockStat({
  label, value, tone = 'neutral',
}: Readonly<{ label: string; value: number; tone?: 'neutral' | 'ok' | 'bad' }>) {
  const color =
    tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-foreground';
  return (
    <div className="rounded-md bg-muted/40 px-1.5 py-1">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xs font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

/* ── Stock badge + Customer overview tab ──────────────────────────────────── */

const STOCK_BADGE: Record<StockStatus, { label: string; cls: string; icon: LucideIcon }> = {
  in:      { label: 'In stock',     cls: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400', icon: CheckCircle },
  low:     { label: 'Low stock',    cls: 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',          icon: AlertTriangle },
  out:     { label: 'Out of stock', cls: 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400',                icon: Ban },
  unknown: { label: 'Not tracked',  cls: 'border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400',           icon: AlertCircle },
};

/** Clear stock chip: state colour + (when tracked) available/required counts. */
function StockBadge({ status, available, required }: Readonly<{ status: StockStatus; available?: number; required?: number }>) {
  const cfg = STOCK_BADGE[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`shrink-0 gap-1 text-[10px] font-medium ${cfg.cls}`}>
      <Icon className="size-3" />
      {cfg.label}
      {status !== 'unknown' && available != null && required != null && (
        <span className="font-normal opacity-75 tabular-nums">· {available}/{required}</span>
      )}
    </Badge>
  );
}

/** One product (or pack) in the Customer tab, with its live stock status. */
function OrderProductCard({ line, stock, currency }: Readonly<{ line: OrderLine; stock: OrderChannelStock | null; currency: string }>) {
  const isPack = Boolean(line.is_pack || line.product_type === 'pack');
  const components = isPack ? (line.pack_items_detail ?? []) : [];
  const lineItem = stockItemFor(stock, line.product_id ?? line.product);
  const packStatus = worstStatus(components.map(c => stockStatusOf(stockItemFor(stock, c.product_id))));

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <ProductImage src={line.product_image} alt={line.product_name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="whitespace-normal break-words text-sm font-medium leading-snug">{line.product_name}</p>
                {isPack && <Badge variant="secondary" className="text-[9px]">Pack</Badge>}
              </div>
              {line.barcode && <p className="font-mono text-[11px] text-muted-foreground">{line.barcode}</p>}
            </div>
            <StockBadge
              status={isPack ? packStatus : stockStatusOf(lineItem)}
              available={isPack ? undefined : lineItem?.available_quantity}
              required={isPack ? undefined : lineItem?.required_quantity}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>Qty <span className="font-semibold text-foreground tabular-nums">{line.quantity}</span></span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{currency} {line.unit_price} each</span>
            <span className="ml-auto font-semibold text-foreground tabular-nums">{currency} {line.total}</span>
          </div>
        </div>
      </div>

      {isPack && components.length > 0 && (
        <div className="mt-2.5 rounded-md border bg-muted/20 p-2">
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold text-muted-foreground">Contains</p>
          <ul className="space-y-1.5">
            {components.map(comp => {
              const compItem = stockItemFor(stock, comp.product_id);
              return (
                <li key={comp.product_id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProductImage src={comp.product_image} alt={comp.product_name} size="sm" />
                    <span className="truncate text-xs">
                      {comp.product_name}
                      <span className="ml-1 font-semibold tabular-nums">×{comp.quantity * line.quantity}</span>
                    </span>
                  </span>
                  <StockBadge
                    status={stockStatusOf(compItem)}
                    available={compItem?.available_quantity}
                    required={compItem?.required_quantity}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Customer tab — the at-a-glance overview a team member sees first: who the
 * customer is, their history, then every ordered product with its stock status
 * (packs expanded inline) and a clear "safe to confirm?" banner.
 */
function CustomerOverviewTab({
  order, customerLines, currency, hasClient, onOpenClient,
}: Readonly<{
  order: OrderDetail;
  customerLines: OrderLine[];
  currency: string;
  hasClient: boolean;
  onOpenClient: () => void;
}>) {
  const stock = getFulfilmentChannelStock(order);
  // Genuine shortages (tracked but insufficient) drive the warning + amber
  // banner; untracked products can't be verified so they only get a soft note.
  const shortCount = stock ? stock.items.filter(it => it.has_inventory_row && !it.is_sufficient).length : 0;
  const hasUntracked = stock ? stock.items.some(it => !it.has_inventory_row) : false;
  const customerName = order.client_name || order.delivery_name || order.client_email || 'Walk-in customer';
  const phone = order.delivery_phone || order.client_phone || '';
  const address = order.delivery_address || '';

  return (
    <div className="space-y-3">
      {/* ── Blocked-client warning ───────────────────────────────────── */}
      {order.client_is_blocked && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-3 dark:border-red-500/40 dark:bg-red-500/10">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-red-800 dark:text-red-300">This client is blocked</p>
            <p className="mt-0.5 break-words text-red-700/90 dark:text-red-300/80">
              {order.client_blocked_reason || 'No reason provided.'}
            </p>
            {(order.client_return_count ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-red-600/80 dark:text-red-400/70">
                {order.client_return_count} returned order{order.client_return_count === 1 ? '' : 's'} on record.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Customer summary ─────────────────────────────────────────── */}
      <div className={`rounded-lg border p-3.5 ${order.client_is_blocked ? 'border-red-200 bg-red-50/60' : 'bg-card'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${order.client_is_blocked ? 'bg-red-100 text-red-700' : 'bg-indigo-600/10 text-indigo-600'}`}>
              {order.client_is_blocked ? <ShieldAlert className="size-4" /> : <User className="size-4" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold">{customerName}</p>
                {order.client_is_blocked && (
                  <Badge variant="destructive" className="h-4 px-1 text-[9px]">Blocked</Badge>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {phone && (
                  <p className="flex items-center gap-1.5"><Phone className="size-3 shrink-0" /><span className="truncate">{phone}</span></p>
                )}
                {address && (
                  <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 size-3 shrink-0" /><span className="min-w-0 break-words">{address}</span></p>
                )}
                {!phone && !address && <p className="italic">No contact details on this order.</p>}
              </div>
            </div>
          </div>
          {hasClient && (
            <button
              type="button"
              onClick={onOpenClient}
              className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-indigo-600"
            >
              <span className="hidden sm:inline">Profile</span><ChevronRight className="size-4" />
            </button>
          )}
        </div>
        {/* History stats */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { icon: Package, label: 'Orders', value: order.client_order_count ?? 0, tone: 'text-foreground' },
            { icon: Award, label: 'Points', value: order.client_points ?? 0, tone: 'text-amber-600' },
            { icon: RotateCcw, label: 'Returns', value: order.client_return_count ?? 0, tone: (order.client_return_count ?? 0) > 0 ? 'text-rose-600' : 'text-foreground' },
          ].map(stat => (
            <div key={stat.label} className="rounded-md border bg-muted/20 px-2 py-1.5 text-center">
              <p className={`flex items-center justify-center gap-1 text-sm font-bold tabular-nums ${stat.tone}`}>
                <stat.icon className="size-3.5 opacity-70" />{stat.value}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stock readiness banner ───────────────────────────────────── */}
      {!stock ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <AlertCircle className="size-4 shrink-0" />
          Stock isn't tracked for this order's channel — availability can't be verified.
        </div>
      ) : shortCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">{shortCount} product{shortCount === 1 ? '' : 's'} short</span> on {stock.sales_channel.name}.
            You can still confirm, but you'll be asked to review first.
          </span>
        </div>
      ) : hasUntracked ? (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          Some products aren't linked to stock — availability couldn't be fully verified.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle className="size-4 shrink-0" />
          All products are in stock — safe to confirm and dispatch.
        </div>
      )}

      {/* ── Ordered products ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 pt-1 text-xs font-semibold text-muted-foreground">
        <Package className="size-3.5" /> Ordered products
        <Badge variant="secondary" className="text-[10px]">{customerLines.length}</Badge>
      </div>
      {customerLines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No products on this order.</div>
      ) : (
        <div className="space-y-2">
          {customerLines.map(line => (
            <OrderProductCard key={line.id} line={line} stock={stock} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ChannelStockPanel — per-sales-channel stock breakdown.
 * Each channel is a sub-tab (horizontally scrollable on small screens).
 * Desktop renders a dense table; mobile renders stacked metric cards.
 */
function ChannelStockPanel({ data }: Readonly<{ data?: OrderStockByChannel }>) {
  const channels = data?.channels ?? [];
  const [active, setActive] = useState<string>(
    () => (channels[0] ? String(channels[0].sales_channel.id) : ''),
  );

  // Keep the selected sub-tab valid if the payload changes (e.g. after a refetch).
  useEffect(() => {
    if (channels.length && !channels.some(c => String(c.sales_channel.id) === active)) {
      setActive(String(channels[0].sales_channel.id));
    }
  }, [channels, active]);

  if (!data || channels.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Boxes className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">No stock-tracked products</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          This order has no linked products to check against channel inventory.
          {data && data.unlinked_lines.length > 0 &&
            ` ${data.unlinked_lines.length} unlinked line(s) are not stock-checked.`}
        </p>
      </div>
    );
  }

  const hasUnlinked = data.unlinked_lines.length > 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Stock by sales channel
        </h4>
        <p className="text-xs text-muted-foreground">
          {data.tracked_product_count} product{data.tracked_product_count === 1 ? '' : 's'} checked
          across {channels.length} channel{channels.length === 1 ? '' : 's'}. The order channel is
          used for delivery; the assigned POS is used for in-store fulfilment.
        </p>
      </div>

      {hasUnlinked && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            <span className="font-medium">
              {data.unlinked_lines.length} line{data.unlinked_lines.length === 1 ? '' : 's'} not
              stock-checked.
            </span>{' '}
            Unlinked products (no local match) never move stock and don&apos;t block fulfilment:{' '}
            {data.unlinked_lines.map(l => l.product_name).join(', ')}
          </p>
        </div>
      )}

      <Tabs value={active} onValueChange={setActive} className="gap-3">
        {/* Channel selector — scrolls horizontally when channels overflow. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="inline-flex h-auto w-max gap-1">
            {channels.map(ch => {
              const ChannelIcon = ch.sales_channel.channel_type === 'POS' ? Store : Globe;
              return (
                <TabsTrigger
                  key={ch.sales_channel.id}
                  value={String(ch.sales_channel.id)}
                  className="gap-1.5 text-xs"
                >
                  <ChannelIcon className="size-3.5" />
                  <span className="max-w-[120px] truncate">{ch.sales_channel.name}</span>
                  <span
                    className={`ml-0.5 inline-block size-2 rounded-full ${ch.can_fulfill ? 'bg-emerald-500' : 'bg-red-500'}`}
                    aria-hidden
                  />
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {channels.map(ch => {
          const ChannelIcon = ch.sales_channel.channel_type === 'POS' ? Store : Globe;
          return (
            <TabsContent key={ch.sales_channel.id} value={String(ch.sales_channel.id)} className="space-y-3">
              {/* Channel header */}
              <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <div className={`flex size-9 flex-shrink-0 items-center justify-center rounded-lg ${ch.can_fulfill ? 'bg-emerald-600/10' : 'bg-red-600/10'}`}>
                    <ChannelIcon className={`size-4 ${ch.can_fulfill ? 'text-emerald-600' : 'text-red-600'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{ch.sales_channel.name}</p>
                      {ch.is_order_channel && (
                        <Badge variant="secondary" className="text-[10px]">Order channel</Badge>
                      )}
                      {ch.is_pos_channel && (
                        <Badge variant="secondary" className="text-[10px]">Assigned POS</Badge>
                      )}
                      {!ch.sales_channel.is_active && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {ch.sales_channel.channel_type}
                      {ch.sales_channel.code ? ` · ${ch.sales_channel.code}` : ''}
                      {ch.sales_channel.store_type ? ` · ${titleCase(ch.sales_channel.store_type)}` : ''}
                    </p>
                  </div>
                </div>
                <Badge variant={ch.can_fulfill ? 'default' : 'destructive'} className="w-fit gap-1 text-[11px]">
                  {ch.can_fulfill ? <CheckCircle className="size-3" /> : <XCircle className="size-3" />}
                  {ch.can_fulfill ? 'Can fulfil order' : 'Insufficient stock'}
                </Badge>
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-hidden rounded-lg border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 text-xs">Product</TableHead>
                      <TableHead className="h-8 w-16 text-center text-xs">Required</TableHead>
                      <TableHead className="h-8 w-16 text-center text-xs">On hand</TableHead>
                      <TableHead className="h-8 w-16 text-center text-xs">Reserved</TableHead>
                      <TableHead className="h-8 w-20 text-center text-xs">Sale stock</TableHead>
                      <TableHead className="h-8 w-24 text-center text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ch.items.map(item => (
                      <TableRow key={item.product_id} className={item.is_sufficient ? '' : 'bg-red-50/50'}>
                        <TableCell className="py-2">
                          <p className="break-words text-xs font-medium leading-snug">{item.product_name}</p>
                          {item.barcode && (
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{item.barcode}</p>
                          )}
                          {!item.has_inventory_row && (
                            <p className="mt-0.5 text-[10px] text-amber-700">No inventory row in this channel</p>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums">{item.required_quantity}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-center text-xs tabular-nums text-muted-foreground">{item.reserved_quantity}</TableCell>
                        <TableCell className={`text-center text-xs font-semibold tabular-nums ${item.is_sufficient ? 'text-emerald-700' : 'text-red-700'}`}>
                          {item.available_quantity}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.is_sufficient ? (
                            <Badge variant="outline" className="gap-1 border-emerald-200 text-[10px] text-emerald-700">
                              <Check className="size-3" />OK
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">Short {item.shortfall}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-2 sm:hidden">
                {ch.items.map(item => (
                  <div key={item.product_id} className={`rounded-lg border p-3 ${item.is_sufficient ? '' : 'border-red-200 bg-red-50/50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-xs font-medium leading-snug">{item.product_name}</p>
                        {item.barcode && (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{item.barcode}</p>
                        )}
                      </div>
                      {item.is_sufficient ? (
                        <Badge variant="outline" className="gap-1 border-emerald-200 text-[10px] text-emerald-700">
                          <Check className="size-3" />OK
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="flex-shrink-0 text-[10px]">Short {item.shortfall}</Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                      <StockStat label="Req" value={item.required_quantity} />
                      <StockStat label="On hand" value={item.quantity} />
                      <StockStat label="Reserved" value={item.reserved_quantity} />
                      <StockStat label="Sale" value={item.available_quantity} tone={item.is_sufficient ? 'ok' : 'bad'} />
                    </div>
                    {!item.has_inventory_row && (
                      <p className="mt-1.5 text-[10px] text-amber-700">No inventory row in this channel</p>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* PRODUCT SEARCH SELECT (edit mode)                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ProductSearchSelect({
  products, value, onChange, loading, allowManual = true,
}: Readonly<{
  products: ProductListItem[];
  value: number | null | undefined;
  onChange: (productId: string) => void;
  loading?: boolean;
  allowManual?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 40);
    const q = query.toLowerCase();
    return products.filter(
      p => p.name.toLowerCase().includes(q) || (p.barcode?.toLowerCase().includes(q))
    ).slice(0, 40);
  }, [products, query]);

  const selected = products.find(p => p.id === value);

  const handleSelect = useCallback((pid: string) => {
    onChange(pid);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 60); }}
        className="flex min-h-9 items-center gap-2 w-full px-3 py-1.5 border rounded-md text-sm bg-background hover:bg-muted/30 transition-colors text-left"
      >
        {selected ? (
          <>
            <ProductImage src={selected.image_url} alt={selected.name} />
            {/* Long product names must wrap inside the trigger button. */}
            <span className="flex-1 min-w-0 font-medium whitespace-normal break-words leading-snug text-left">
              {selected.name}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground flex-1">Select product...</span>
        )}
        <ChevronDown className={`size-3.5 text-muted-foreground flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-64 flex flex-col overflow-hidden">
          <div className="p-2 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search products..."
                className="h-8 pl-8 text-sm border-0 bg-muted/40 focus-visible:ring-0"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {allowManual && (
              <button
                type="button"
                onClick={() => handleSelect('__manual__')}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left border-b"
              >
                <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                  <Plus className="size-3.5 text-muted-foreground" />
                </div>
                <span className="text-muted-foreground">Manual entry</span>
              </button>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">No products found</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(String(p.id))}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/40 transition-colors text-left ${value === p.id ? 'bg-primary/5' : ''}`}
                >
                  <ProductImage src={p.image_url} alt={p.name} />
                  <div className="min-w-0 flex-1">
                    {/* Long packaging-product names wrap instead of truncating. */}
                    <p className="font-medium text-[13px] whitespace-normal break-words leading-snug">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.barcode || '—'} · {p.sales_price} TND</p>
                  </div>
                  {value === p.id && <Check className="size-4 text-primary flex-shrink-0 mt-1" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ORDER DETAIL VIEW — tabbed layout (Details | Items | Notes)               */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface OrderDialogPermissions {
  edit: boolean;
  /** manual_status_override holders can reopen canceled/returned orders. */
  manualOverride?: boolean;
  confirm: boolean;
  delay: boolean;
  cancel: boolean;
  sendToPos: boolean;
  sendToDelivery: boolean;
  processReturn: boolean;
  packageOrder: boolean;
  delete: boolean;
  restore: boolean;
  viewInvoice?: boolean;
  editInvoice?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* PACKAGING ITEMS PICKER — shared between the detail dialog's Packaging tab    */
/* and the dedicated PackagingDialog. Self-contained: tracks its own selection, */
/* search and scanner state so it can be dropped in anywhere.                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function PackagingItemsPicker({
  order,
  packagingProducts,
  loadingPackagingProducts,
  isLoading,
  canPackage,
  onPackageOrder,
  onUnpackageOrder,
}: Readonly<{
  order: OrderDetail;
  packagingProducts: ProductListItem[];
  loadingPackagingProducts?: boolean;
  isLoading?: boolean;
  canPackage: boolean;
  onPackageOrder: (items: Array<{ product_id: number; quantity: number }>, allowUpdate: boolean) => void;
  onUnpackageOrder: () => void;
}>) {
  const packagingLines = order.packaging_lines ?? order.lines.filter(line => line.product_type === 'packaging_item');

  // Multi-select packaging: product_id → quantity. Lets the user tick (or scan)
  // several packaging products and Save them all in one shot.
  const [packagingSelection, setPackagingSelection] = useState<Record<number, number>>({});
  const [packagingSearch, setPackagingSearch] = useState('');
  const [packagingScannerOpen, setPackagingScannerOpen] = useState(false);
  const [packagingScanFeedback, setPackagingScanFeedback] =
    useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const filteredPackagingProducts = useMemo(() => {
    const q = packagingSearch.trim().toLowerCase();
    const base = q
      ? packagingProducts.filter(
          p => p.name.toLowerCase().includes(q) || (p.barcode?.toLowerCase().includes(q))
        )
      : packagingProducts;
    return base.slice(0, 100);
  }, [packagingProducts, packagingSearch]);

  const selectedPackagingCount = Object.keys(packagingSelection).length;
  const allFilteredSelected =
    filteredPackagingProducts.length > 0 &&
    filteredPackagingProducts.every(p => packagingSelection[p.id] !== undefined);

  const addPackagingProduct = useCallback((productId: number, qty = 1) => {
    setPackagingSelection(prev => ({ ...prev, [productId]: (prev[productId] ?? 0) + qty }));
  }, []);

  const togglePackagingProduct = useCallback((productId: number) => {
    setPackagingSelection(prev => {
      const next = { ...prev };
      if (next[productId] !== undefined) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  }, []);

  const setPackagingProductQty = useCallback((productId: number, qty: number) => {
    setPackagingSelection(prev => ({
      ...prev,
      [productId]: Number.isFinite(qty) && qty > 0 ? qty : 1,
    }));
  }, []);

  const toggleSelectAllPackaging = useCallback(() => {
    setPackagingSelection(prev => {
      const everyFilteredSelected =
        filteredPackagingProducts.length > 0 &&
        filteredPackagingProducts.every(p => prev[p.id] !== undefined);
      const next = { ...prev };
      if (everyFilteredSelected) {
        for (const p of filteredPackagingProducts) delete next[p.id];
      } else {
        for (const p of filteredPackagingProducts) {
          if (next[p.id] === undefined) next[p.id] = 1;
        }
      }
      return next;
    });
  }, [filteredPackagingProducts]);

  // Camera scan → exact barcode match adds +1.
  const handlePackagingScan = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const match = packagingProducts.find(
      p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
    );
    if (!match) {
      setPackagingScanFeedback({ message: `No packaging product matches "${code}"`, type: 'error' });
      return;
    }
    addPackagingProduct(match.id);
    setPackagingScanFeedback({ message: `Added ${match.name}`, type: 'success' });
  }, [packagingProducts, addPackagingProduct]);

  // Smart search/scan box. A hardware barcode reader types the full code then
  // fires Enter; pressing Enter adds an exact barcode match (the scanner case)
  // or the single remaining filtered product, otherwise it just narrows the
  // list. This keeps one field for both "scan with a reader" and "type to find".
  const handleSearchEnter = useCallback(() => {
    const code = packagingSearch.trim();
    if (!code) return;
    const exact = packagingProducts.find(
      p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase()
    );
    if (exact) {
      addPackagingProduct(exact.id);
      setPackagingScanFeedback({ message: `Added ${exact.name}`, type: 'success' });
      setPackagingSearch('');
      return;
    }
    if (filteredPackagingProducts.length === 1) {
      const only = filteredPackagingProducts[0];
      addPackagingProduct(only.id);
      setPackagingScanFeedback({ message: `Added ${only.name}`, type: 'success' });
      setPackagingSearch('');
      return;
    }
    if (filteredPackagingProducts.length === 0) {
      setPackagingScanFeedback({ message: `No packaging product matches "${code}"`, type: 'error' });
    }
  }, [packagingSearch, packagingProducts, filteredPackagingProducts, addPackagingProduct]);

  const submitPackaging = useCallback(() => {
    if (selectedPackagingCount === 0) return;
    // Merge the selected packaging products onto whatever is already on the
    // order, so Save stays additive (matches the previous one-at-a-time flow).
    const merged = new Map<number, number>();
    for (const line of packagingLines) {
      if (line.product_id) merged.set(Number(line.product_id), Number(line.quantity));
    }
    for (const [productId, qty] of Object.entries(packagingSelection)) {
      const id = Number(productId);
      const quantity = Number(qty) > 0 ? Number(qty) : 1;
      merged.set(id, (merged.get(id) ?? 0) + quantity);
    }
    const items = Array.from(merged.entries()).map(([product_id, quantity]) => ({ product_id, quantity }));
    if (items.length === 0) return;
    onPackageOrder(items, packagingLines.length > 0 || Boolean(order.packaged_at));
    setPackagingSelection({});
    setPackagingSearch('');
    setPackagingScanFeedback(null);
    // Keep focus on the scan box so a hardware reader can fire the next code.
    scanInputRef.current?.focus();
  }, [
    onPackageOrder,
    order.packaged_at,
    packagingLines,
    packagingSelection,
    selectedPackagingCount,
  ]);

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packaging step</p>
            <p className="mt-1 text-sm font-medium">{order.packaged_at ? 'Packaged' : 'Not packaged'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Packaging affects packaging/store stock only. When saved, this order is marked done locally.
            </p>
            {order.packaged_at && (
              <p className="mt-1 text-xs text-muted-foreground">
                Packaged {new Date(order.packaged_at).toLocaleString('en-GB')}
                {order.packaged_by_name ? ` by ${order.packaged_by_name}` : ''}
              </p>
            )}
          </div>
          <Badge variant={order.packaged_at ? 'default' : 'outline'} className="w-fit">
            {order.packaged_at ? 'Packaged' : 'Waiting packaging'}
          </Badge>
        </div>
      </div>

      {/* Current packaging items on the order */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9 text-xs font-medium">Packaging item</TableHead>
              <TableHead className="h-9 text-xs font-medium text-center w-20">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packagingLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                  No packaging items added yet.
                </TableCell>
              </TableRow>
            ) : packagingLines.map(line => (
              <TableRow key={line.id}>
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <ProductImage src={line.product_image} alt={line.product_name} size="md" />
                    <div className="min-w-0">
                      <p className="max-w-[34rem] whitespace-normal break-words text-sm font-medium leading-snug">{line.product_name}</p>
                      {line.barcode && <p className="text-[11px] text-muted-foreground font-mono">{line.barcode}</p>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center tabular-nums text-sm">{line.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canPackage && !order.is_deleted && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add packaging items</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scan with a barcode reader (type / scan then press Enter), use the camera, or tick the
                packaging products — set each quantity, then Save.
              </p>
            </div>
            {selectedPackagingCount > 0 && (
              <Badge variant="secondary" className="w-fit">{selectedPackagingCount} selected</Badge>
            )}
          </div>

          {/* Smart search + barcode reader (Enter) + camera scan */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                ref={scanInputRef}
                value={packagingSearch}
                onChange={event => { setPackagingSearch(event.target.value); setPackagingScanFeedback(null); }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); handleSearchEnter(); }
                }}
                placeholder="Scan barcode or search packaging products..."
                className="h-9 pl-8"
                autoFocus
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => { setPackagingScanFeedback(null); setPackagingScannerOpen(true); }}
            >
              <ScanLine className="size-3.5" />
              Camera
            </Button>
          </div>

          {packagingScanFeedback && (
            <p className={`text-xs ${packagingScanFeedback.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
              {packagingScanFeedback.message}
            </p>
          )}

          {/* Select-all toggle */}
          <label className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 cursor-pointer">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={allFilteredSelected}
                onCheckedChange={toggleSelectAllPackaging}
                disabled={filteredPackagingProducts.length === 0}
              />
              Select all{packagingSearch.trim() ? ' matching' : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {filteredPackagingProducts.length} product{filteredPackagingProducts.length === 1 ? '' : 's'}
            </span>
          </label>

          {/* Product checklist */}
          <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {loadingPackagingProducts ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading packaging products...</span>
              </div>
            ) : filteredPackagingProducts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No packaging products found.
              </div>
            ) : filteredPackagingProducts.map(product => {
              const selectedQty = packagingSelection[product.id];
              const isSelected = selectedQty !== undefined;
              return (
                <div
                  key={product.id}
                  className={`flex items-center gap-2.5 px-3 py-2 ${isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => togglePackagingProduct(product.id)}
                  />
                  <button
                    type="button"
                    onClick={() => togglePackagingProduct(product.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <ProductImage src={product.image_url} alt={product.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug whitespace-normal break-words">{product.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{product.barcode || 'No barcode'}</p>
                    </div>
                  </button>
                  {isSelected && (
                    <Input
                      value={selectedQty}
                      onChange={event => setPackagingProductQty(product.id, Number(event.target.value))}
                      type="number"
                      min={1}
                      className="h-8 w-16 text-center"
                      aria-label={`Quantity for ${product.name}`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              onClick={submitPackaging}
              disabled={isLoading || selectedPackagingCount === 0}
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Save{selectedPackagingCount > 0 ? ` (${selectedPackagingCount})` : ''}
            </Button>
            {packagingLines.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-red-700 border-red-200 hover:bg-red-50"
                onClick={onUnpackageOrder}
                disabled={isLoading}
              >
                <Undo2 className="size-3.5" />
                Reverse packaging stock
              </Button>
            )}
          </div>

          <POSCameraScanner
            open={packagingScannerOpen}
            onOpenChange={setPackagingScannerOpen}
            onBarcodeDetected={handlePackagingScan}
            feedbackMessage={packagingScanFeedback?.message}
            feedbackType={packagingScanFeedback?.type}
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* PACKAGING DIALOG — focused popup (mirrors the return flow). Opens from the   */
/* "Scan Packaging" lookup and automatically after an order is sent to delivery.*/
/* Shows what to pack + the packaging products to add, scan and Save.           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function PackagingDialog({
  open,
  onOpenChange,
  order,
  packagingProducts,
  loadingPackagingProducts,
  isLoading,
  canPackage,
  warnings,
  onPackageOrder,
  onUnpackageOrder,
}: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: OrderDetail | null;
  packagingProducts: ProductListItem[];
  loadingPackagingProducts?: boolean;
  isLoading?: boolean;
  canPackage: boolean;
  warnings?: string[];
  onPackageOrder: (items: Array<{ product_id: number; quantity: number }>, allowUpdate: boolean) => void;
  onUnpackageOrder: () => void;
}>) {
  const customerLines = order
    ? (order.customer_lines ?? order.lines.filter(line => line.product_type !== 'packaging_item'))
    : [];
  const title = order ? `Pack order ${order.order_number}` : 'Packaging';
  const desc = order
    ? (order.delivery_code
        ? `Delivery code ${order.delivery_code}`
        : (order.delivery_reference ? `Delivery ref ${order.delivery_reference}` : undefined))
    : undefined;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={title} description={desc} wide>
      {!order ? null : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-6">
          {/* ── LEFT COLUMN · context + read-only items to pack ───────────── */}
          <div className="space-y-4">
            {/* Delivery context */}
            {(order.delivery_code || order.delivery_reference || order.sent_to_pos_at) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                <Truck className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {order.sent_to_pos_at ? 'Sent to POS' : 'Sent to delivery'}
                </span>
                {order.delivery_code && <Badge variant="secondary" className="font-mono">{order.delivery_code}</Badge>}
                {order.delivery_reference && <Badge variant="outline">Ref {order.delivery_reference}</Badge>}
              </div>
            )}

            {/* Lookup warnings (e.g. order not yet dispatched) */}
            {warnings && warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 text-sm">
                <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  {warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              </div>
            )}

            {/* What the customer ordered — read-only checklist of items to pack */}
            <div className="rounded-lg border overflow-hidden">
              <div className="border-b bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Items to pack ({customerLines.length})
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 text-xs font-medium">Product</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-center w-16">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                        No items on this order.
                      </TableCell>
                    </TableRow>
                  ) : customerLines.map(line => (
                    <TableRow key={line.id}>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ProductImage src={line.product_image} alt={line.product_name} size="md" />
                          <div className="min-w-0">
                            <p className="whitespace-normal break-words text-sm font-medium leading-snug">{line.product_name}</p>
                            {line.barcode && <p className="text-[11px] text-muted-foreground font-mono">{line.barcode}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm font-semibold">{line.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* ── RIGHT COLUMN · scan / add / save packaging ────────────────── */}
          <PackagingItemsPicker
            order={order}
            packagingProducts={packagingProducts}
            loadingPackagingProducts={loadingPackagingProducts}
            isLoading={isLoading}
            canPackage={canPackage}
            onPackageOrder={onPackageOrder}
            onUnpackageOrder={onUnpackageOrder}
          />
        </div>
      )}
    </ResponsiveSheet>
  );
}

function OrderViewMode({
  order,
  onStatusChange,
  onConfirm,
  onNotAnswered,
  onOpenDelay,
  onRestoreDelayed,
  onOpenCancel,
  onOpenSendPOS,
  onSendDelivery,
  onProcessReturn,
  onPackageOrder,
  onUnpackageOrder,
  isLoading,
  activeAction,
  onRunAction,
  permissions,
  failedActionAttempts = 0,
  packagingProducts,
  loadingPackagingProducts,
}: Readonly<{
  order: OrderDetail;
  onStatusChange: (id: number, status: OrderStatus) => void;
  onConfirm: () => void;
  onNotAnswered: () => void;
  onOpenDelay: () => void;
  onRestoreDelayed: () => void;
  onOpenCancel: () => void;
  onOpenSendPOS: () => void;
  onSendDelivery: () => void;
  onProcessReturn: () => void;
  onPackageOrder: (items: Array<{ product_id: number; quantity: number }>, allowUpdate: boolean) => void;
  onUnpackageOrder: () => void;
  isLoading?: boolean;
  activeAction: string | null;
  onRunAction: (name: string, action: () => void | Promise<void>) => void;
  permissions?: OrderDialogPermissions;
  /** Per-order count of failed Confirm/Delay attempts; Cancel appears at 3. */
  failedActionAttempts?: number;
  packagingProducts: ProductListItem[];
  loadingPackagingProducts?: boolean;
}>) {
  const directPOSCompleted =
    order.source === 'POS' && order.status === 'done' && !order.in_store_pickup;
  const [clientInfoOpen, setClientInfoOpen] = useState(false);
  const hasClient = !!order.client_id;
  const totalsRows = useMemo(() => {
    // One fee row for every source: POS/manual orders store it on delivery_fee,
    // WooCommerce orders on shipping_total (ingestion now mirrors it into
    // delivery_fee, but older rows may only have shipping_total).
    const fee = parseFloat(order.delivery_fee) > 0 ? order.delivery_fee : order.shipping_total;
    return [
      { label: 'Subtotal', value: order.subtotal },
      { label: 'Tax', value: order.tax_total },
      { label: 'Delivery fee', value: fee },
      ...(parseFloat(order.discount_total) > 0 ? [{ label: 'Discount', value: `-${order.discount_total}` }] : []),
    ];
  }, [order]);
  const customerLines = order.customer_lines ?? order.lines.filter(line => line.product_type !== 'packaging_item');
  const packagingCount = (order.packaging_lines ?? order.lines.filter(line => line.product_type === 'packaging_item')).length;
  const notAnsweredAttempts = order.not_answered_attempts ?? 0;
  // The Cancel button is a last resort, hidden in the normal flow to keep
  // accidental cancellations away. It reveals once EITHER signal reaches the
  // threshold:
  //   • failedActionAttempts — Confirm/Delay kept failing (the order is stuck);
  //   • notAnsweredAttempts   — the customer has been unreachable 3+ times.
  // The first is a client-side tally owned by the parent (keyed per order); the
  // second is the server-persisted no-answer count.
  const CANCEL_REVEAL_THRESHOLD = 3;
  const showCancel =
    !!permissions?.cancel &&
    (failedActionAttempts >= CANCEL_REVEAL_THRESHOLD ||
      notAnsweredAttempts >= CANCEL_REVEAL_THRESHOLD);
  const isDelayed = order.status === 'delayed';
  const canProcessAfterDone = order.status === 'done';

  // Fulfilment-channel stock flag — drives the warning dot on the Stock tab.
  const stockByChannel = order.stock_by_channel;
  const orderChannelStock = stockByChannel?.channels.find(c => c.is_order_channel) ?? null;
  const posChannelStock = stockByChannel?.channels.find(c => c.is_pos_channel) ?? null;
  const fulfilmentChannelStock = order.pos_sales_channel_name ? posChannelStock : orderChannelStock;
  const stockBlocked = fulfilmentChannelStock ? !fulfilmentChannelStock.can_fulfill : false;

  return (
    <div className="space-y-6">
      {/* Read-only client profile — mounted at the root so it opens from any tab. */}
      {hasClient && (
        <ClientInfoDialog
          clientId={order.client_id}
          open={clientInfoOpen}
          onOpenChange={setClientInfoOpen}
          fallback={{
            name: order.client_name,
            email: order.client_email,
            phone: order.client_phone,
            points: order.client_points,
            isBlocked: order.client_is_blocked,
            returnCount: order.client_return_count,
          }}
        />
      )}
      {/* Main layout: 2-col on large */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Left column */}
        <Tabs defaultValue="items" className="gap-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="items" className="text-xs gap-1.5">
              <User className="size-3.5" /> Customer ({customerLines.length})
            </TabsTrigger>
            <TabsTrigger value="details" className="text-xs gap-1.5">
              <FileText className="size-3.5" /> Details
            </TabsTrigger>
            <TabsTrigger value="packaging" className="text-xs gap-1.5">
              <Package className="size-3.5" /> Packaging ({packagingCount})
            </TabsTrigger>
            <TabsTrigger value="stock" className="text-xs gap-1.5">
              <Boxes className="size-3.5" /> Stock
              {stockBlocked && (
                <span className="ml-0.5 inline-block size-1.5 rounded-full bg-red-500" aria-hidden />
              )}
            </TabsTrigger>
            {(order.customer_note || order.internal_note) && (
              <TabsTrigger value="notes" className="text-xs gap-1.5">
                <MessageSquare className="size-3.5" /> Notes
              </TabsTrigger>
            )}
          </TabsList>

          {/* Tab: Details */}
          <TabsContent value="details">
            <div className="space-y-3">
              {/* Channel Card */}
              <div className="rounded-lg border bg-gradient-to-br from-cyan-50/30 to-transparent p-4 flex items-start gap-3">
                <div className="size-9 rounded-lg bg-cyan-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MapPin className="size-4 text-cyan-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Channel</p>
                  <p className="text-sm font-medium text-foreground">{order.sales_channel_name}</p>
                </div>
              </div>

              {order.pos_sales_channel_name && (
                <div className="rounded-lg border bg-gradient-to-br from-emerald-50/30 to-transparent p-4 flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-emerald-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Store className="size-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Assigned POS</p>
                    <p className="text-sm font-medium text-foreground truncate">{order.pos_sales_channel_name}</p>
                    {order.sent_to_pos_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Sent {new Date(order.sent_to_pos_at).toLocaleString('en-GB')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Client Card — click to open the full client profile popup */}
              <button
                type="button"
                onClick={() => hasClient && setClientInfoOpen(true)}
                disabled={!hasClient}
                aria-haspopup="dialog"
                title={hasClient ? 'Voir les détails du client' : undefined}
                className={`group flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${order.client_is_blocked ? 'border-red-200 bg-red-50' : 'bg-gradient-to-br from-indigo-50/30 to-transparent'} ${hasClient ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40' : 'cursor-default'}`}
              >
                <div className={`size-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${order.client_is_blocked ? 'bg-red-100' : 'bg-indigo-600/10'}`}>
                  {order.client_is_blocked ? <ShieldAlert className="size-4 text-red-700" /> : <User className="size-4 text-indigo-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Client</p>
                  <p className="text-sm font-medium text-foreground truncate">{order.client_name ?? order.client_email ?? '—'}</p>
                  {order.client_is_blocked && (
                    <p className="mt-1 text-xs text-red-700">
                      Blocked client warning. Returned {order.client_return_count ?? 0} times.
                    </p>
                  )}
                </div>
                {hasClient && (
                  <span className="flex items-center gap-1 self-center text-xs text-muted-foreground transition-colors group-hover:text-indigo-600">
                    <span className="hidden sm:inline">Détails</span>
                    <ChevronRight className="size-4" />
                  </span>
                )}
              </button>

              {/* Delivery contact — the recipient for THIS order (shipping block,
                  billing fallback). May differ from the client profile above. */}
              {(order.delivery_name || order.delivery_phone || order.delivery_address) && (
                <div className="rounded-lg border bg-gradient-to-br from-teal-50/30 to-transparent p-4 flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-teal-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Truck className="size-4 text-teal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Delivery contact</p>
                    <p className="text-sm font-medium text-foreground truncate">{order.delivery_name || '—'}</p>
                    {order.delivery_phone && (
                      <a
                        href={`tel:${order.delivery_phone.replace(/[^0-9+]/g, '')}`}
                        className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-teal-700 hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        <Phone className="size-3" />
                        {order.delivery_phone}
                      </a>
                    )}
                    {order.delivery_address && (
                      <p className="mt-0.5 text-xs text-muted-foreground break-words">{order.delivery_address}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Source & Status Row */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-gradient-to-br from-violet-50/30 to-transparent p-4 flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-violet-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Store className="size-4 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Source</p>
                    <Badge variant="secondary" className="text-[10px]">{order.source}</Badge>
                  </div>
                </div>
                <div className="rounded-lg border bg-gradient-to-br from-orange-50/30 to-transparent p-4 flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-orange-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <TrendingUp className="size-4 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Local Order Status</p>
                    <OrderStatusBadge status={order.status} label={order.status_display} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Status Breakdown</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">WooCommerce Status</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.wc_status || '—'}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Payment</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.payment_status}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Sync</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.sync_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Delivery Reference</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.delivery_reference || '—'}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Packaged</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.packaged_at ? 'Yes' : 'No'}</Badge>
                  </div>
                </div>
              </div>

              {/* Payment Card */}
              <div className="rounded-lg border bg-gradient-to-br from-green-50/30 to-transparent p-4 flex items-start gap-3">
                <div className="size-9 rounded-lg bg-green-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CreditCard className="size-4 text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Payment</p>
                  <p className="text-sm font-medium text-foreground">{order.payment_method || '—'}</p>
                  <p className="text-xs text-muted-foreground mt-1">{order.payment_status}</p>
                </div>
              </div>

              {/* Created & External ID Row */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-gradient-to-br from-rose-50/30 to-transparent p-4 flex items-start gap-3">
                  <div className="size-9 rounded-lg bg-rose-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Calendar className="size-4 text-rose-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Created</p>
                    <p className="text-sm font-medium text-foreground">
                      {new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                {order.external_order_id && (
                  <div className="rounded-lg border bg-gradient-to-br from-slate-50/30 to-transparent p-4 flex items-start gap-3">
                    <div className="size-9 rounded-lg bg-slate-600/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Globe className="size-4 text-slate-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">External ID</p>
                      <code className="text-xs bg-muted/60 px-2 py-1 rounded-md font-mono block truncate">{order.external_order_id}</code>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </TabsContent>

          {/* Tab: Stock by sales channel */}
          <TabsContent value="stock">
            <ChannelStockPanel data={order.stock_by_channel} />
          </TabsContent>

          {/* Tab: Customer — the at-a-glance overview (customer + products + stock) */}
          <TabsContent value="items">
            <CustomerOverviewTab
              order={order}
              customerLines={customerLines}
              currency={order.currency}
              hasClient={hasClient}
              onOpenClient={() => setClientInfoOpen(true)}
            />
          </TabsContent>

          {/* Tab: Packaging */}
          <TabsContent value="packaging">
            <PackagingItemsPicker
              order={order}
              packagingProducts={packagingProducts}
              loadingPackagingProducts={loadingPackagingProducts}
              isLoading={isLoading}
              canPackage={!!permissions?.packageOrder}
              onPackageOrder={onPackageOrder}
              onUnpackageOrder={onUnpackageOrder}
            />
          </TabsContent>

          {/* Tab: Notes */}
          {(order.customer_note || order.internal_note) && (
            <TabsContent value="notes">
              <div className="space-y-3">
                {order.customer_note && (
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Customer Note</p>
                    <p className="text-sm leading-relaxed">{order.customer_note}</p>
                  </div>
                )}
                {order.internal_note && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-xs font-medium text-amber-700 mb-1.5">Internal Note</p>
                    <p className="text-sm leading-relaxed">{order.internal_note}</p>
                  </div>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Right sidebar: Totals + Contact + Outcome + Actions */}
        <div className="space-y-4">
          {/* Totals */}
          <div className="rounded-lg border p-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Summary</h4>
            {totalsRows.map(r => (
              <div key={r.label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="tabular-nums">{order.currency} {r.value}</span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between items-baseline pt-1">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-lg font-bold tabular-nums text-emerald-600">{order.currency} {order.total}</span>
            </div>
          </div>

          {/* Lifecycle status */}
          <div className="rounded-lg border p-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</h4>
            <OrderStatusBadge status={order.status} label={order.status_display} />
            {order.status === 'delayed' && order.delay_date && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Follow-up:</span>{' '}
                  {new Date(order.delay_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                {order.delay_reason && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Reason:</span> {order.delay_reason}
                  </p>
                )}
              </div>
            )}
            {order.status === 'canceled' && order.cancellation_reason && (
              <p className="text-xs text-muted-foreground mt-2">
                <span className="font-medium">Reason:</span> {order.cancellation_reason}
              </p>
            )}
            {order.outcome_note && (
              <p className="text-xs text-muted-foreground italic mt-1">{order.outcome_note}</p>
            )}
            {order.status === 'not_answered' && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p className="font-medium">Unanswered attempts: {notAnsweredAttempts}</p>
                <p className="mt-0.5 text-rose-700">
                  {notAnsweredAttempts >= CANCEL_REVEAL_THRESHOLD
                    ? 'The customer has been unreachable 3 times — you can now cancel the order, or delay it for a later follow-up.'
                    : 'Keep trying to reach the customer, or delay the order for a later follow-up.'}
                </p>
              </div>
            )}
          </div>

          {(order.delivery_reference || order.delivery_code) && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery</h4>
              {(order.delivery_code || order.delivery_reference) && (
                <code className="block truncate rounded-md bg-muted px-2 py-1 text-[11px]">
                  {order.delivery_code || order.delivery_reference}
                </code>
              )}
              {order.delivery_status_id !== null && order.delivery_status_id !== undefined && (
                <p className="text-xs text-muted-foreground">JAX status ID: {order.delivery_status_id}</p>
              )}
              {order.delivery_order_id && (
                <p className="text-xs text-muted-foreground">JAX order ID: {order.delivery_order_id}</p>
              )}
            </div>
          )}

          {/* Contact customer */}
          {(order.billing_phone || order.billing_address?.phone) && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact Customer</h4>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline"
                  className="flex-1 gap-1.5 h-8 text-xs"
                  onClick={() => {
                    const phone = order.billing_phone || order.billing_address?.phone || '';
                    window.open(`tel:${phone}`, '_self');
                  }}
                >
                  <Phone className="size-3" /> Call
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="flex-1 gap-1.5 h-8 text-xs text-green-700 border-green-200 hover:bg-green-50"
                  onClick={() => {
                    const phone = (order.billing_phone || order.billing_address?.phone || '').replace(/[^0-9+]/g, '');
                    window.open(`https://wa.me/${phone}`, '_blank');
                  }}
                >
                  <MessageCircleMore className="size-3" /> WhatsApp
                </Button>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-1">
                {order.billing_phone || order.billing_address?.phone}
              </p>
            </div>
          )}

          {/* Order outcome actions */}
          {['new', 'not_answered', 'delayed'].includes(order.status) && !order.is_deleted && !directPOSCompleted && (
            <div className="space-y-2">
              {permissions?.confirm && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => onRunAction('confirm', onConfirm)}
                  disabled={isLoading}
                >
                  {isLoading && activeAction === 'confirm' ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />}
                  Confirm Order
                </Button>
              )}
              {['new', 'delayed'].includes(order.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50"
                  onClick={() => onRunAction('notAnswered', onNotAnswered)}
                  disabled={isLoading}
                >
                  {isLoading && activeAction === 'notAnswered' ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
                  No Answer {notAnsweredAttempts ? `(${notAnsweredAttempts})` : ''}
                </Button>
              )}
              {isDelayed && permissions?.delay && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => onRunAction('restoreDelayed', onRestoreDelayed)}
                  disabled={isLoading}
                >
                  {isLoading && activeAction === 'restoreDelayed' ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />} Restore to Pending
                </Button>
              )}
              {permissions?.delay && (
                <Button
                  size="sm" variant="outline"
                  className="w-full gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
                  onClick={onOpenDelay}
                  disabled={isLoading}
                >
                  <CalendarClock className="size-3.5" /> Delay Order
                </Button>
              )}
              {showCancel && (
                <Button
                  size="sm" variant="outline"
                  className="w-full gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={onOpenCancel}
                  disabled={isLoading}
                >
                  <Ban className="size-3.5" /> Cancel Order
                </Button>
              )}
              {/* Discoverability: once an action has failed at least once but
                  the Cancel threshold isn't reached, show how close we are. */}
              {permissions?.cancel && !showCancel && failedActionAttempts > 0 && (
                <p className="text-center text-[11px] text-muted-foreground">
                  Confirm/Delay failed {failedActionAttempts}/{CANCEL_REVEAL_THRESHOLD} — the
                  Cancel button appears after {CANCEL_REVEAL_THRESHOLD} failed attempts.
                </p>
              )}
            </div>
          )}

          {['confirmed', 'packaging', 'done'].includes(order.status) && !order.is_deleted && !directPOSCompleted && (
            <div className="space-y-2">
              <Separator />
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fulfillment</h4>
              {permissions?.sendToDelivery && !order.sent_to_pos_at && !order.delivery_reference && (
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => onRunAction('delivery', onSendDelivery)}
                  disabled={isLoading}
                >
                  {isLoading && activeAction === 'delivery' ? <Loader2 className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
                  Send to Delivery
                </Button>
              )}
              {permissions?.sendToPos && !order.sent_to_pos_at && !order.delivery_reference && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={onOpenSendPOS}
                  disabled={isLoading}
                >
                  <Store className="size-3.5" />
                  Send to POS
                </Button>
              )}
              {order.sent_to_pos_at && (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <p className="font-medium">Waiting POS checkout</p>
                  <p className="text-muted-foreground">{order.pos_sales_channel_name ?? 'POS location selected'}</p>
                </div>
              )}
              {permissions?.processReturn && !order.returned_at && canProcessAfterDone && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
                  onClick={onProcessReturn}
                  disabled={isLoading}
                >
                  <RefreshCw className="size-3.5" />
                  Process Return
                </Button>
              )}
            </div>
          )}

          {directPOSCompleted && !order.is_deleted && (
            <div className="rounded-md border bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <p className="font-medium">Direct POS sale completed</p>
              <p className="mt-0.5 text-emerald-700">
                This order is already paid and does not need client confirmation or delivery routing.
              </p>
            </div>
          )}

          {(permissions?.edit || permissions?.manualOverride) && !order.is_deleted && (() => {
            const matrixTargets = ALLOWED_NEXT_STATUSES[order.status] ?? [];
            const reopenTargets = permissions?.manualOverride
              ? (REOPEN_TARGETS[order.status] ?? [])
              : [];
            const targets = [...matrixTargets, ...reopenTargets];
            return (
              <div className="space-y-3">
                <Separator />
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Move Status</h4>
                <div className="space-y-2">
                  <Label className="text-[11px] text-muted-foreground">
                    {reopenTargets.length > 0 && matrixTargets.length === 0
                      ? 'Reopen this order (audited admin override)'
                      : 'Allowed next steps (validated by the transition matrix)'}
                  </Label>
                  <Select
                    value={order.status}
                    onValueChange={value => onStatusChange(order.id, value as OrderStatus)}
                    disabled={isLoading || targets.length === 0}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={order.status} disabled>
                        {orderStatusLabel(order.status)} (current)
                      </SelectItem>
                      {targets.map(status => (
                        <SelectItem key={status} value={status}>
                          {orderStatusLabel(status)}
                          {reopenTargets.includes(status) && !matrixTargets.includes(status) ? ' (reopen)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* EDIT MODE                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface OrderEditModeProps {
  editForm: OrderEditRequest;
  editProducts: ProductListItem[];
  loadingEditProducts: boolean;
  currency: string;
  onUpdateLine: (index: number, key: 'quantity' | 'unit_price', value: string) => void;
  onUpdateLineProduct: (index: number, productId: string) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onSaveEdit: () => void;
  onCancel: () => void;
  onChangeDiscount: (field: 'type' | 'value', val: string | OrderDiscountType) => void;
  onChangeNote: (field: 'customer' | 'internal', val: string) => void;
  onChangeBilling: (field: keyof OrderEditRequest, val: string) => void;
  isSaving?: boolean;
}

function OrderEditMode({
  editForm, editProducts, loadingEditProducts, currency,
  onUpdateLine, onUpdateLineProduct,
  onAddLine, onRemoveLine, onSaveEdit, onCancel,
  onChangeDiscount, onChangeNote, onChangeBilling, isSaving,
}: Readonly<OrderEditModeProps>) {
  const liveSubtotal = useMemo(() =>
    editForm.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
  [editForm.lines]);

  // Delivery fee toggle. Initialised from the order's current fee so an
  // existing fee shows enabled; turning it off zeroes the fee, turning it back
  // on restores the last typed amount (default 7).
  const initialFee = editForm.delivery_fee ?? '0.00';
  const [deliveryFeeEnabled, setDeliveryFeeEnabled] = useState(parseFloat(initialFee) > 0);
  const [lastFee, setLastFee] = useState(parseFloat(initialFee) > 0 ? initialFee : '7.00');

  return (
    <div className="flex flex-col gap-6 pb-20">
      {/* Line Items Section */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        {/* Header */}
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 flex items-center gap-3 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-start sm:items-center gap-3">
            <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
              <Package className="size-3.5 sm:size-4 text-gray-700" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Line Items</h3>
              <p className="text-xs text-gray-500 mt-0.5">Manage products in this order</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 sm:px-6 py-5">
          {loadingEditProducts && (
            <div className="flex items-center gap-2.5 text-xs text-gray-600 py-4 px-4 bg-gray-50 rounded-lg border border-gray-200 animate-pulse">
              <Loader2 className="size-4 animate-spin" /> 
              <span>Loading products...</span>
            </div>
          )}

          {!loadingEditProducts && editForm.lines.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="flex justify-center">
                <Package className="size-12 text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-600">No items added yet</p>
              <p className="text-xs text-gray-500">Click "Add Item" to start adding products to this order</p>
            </div>
          ) : (
            <div className="space-y-3">
              {editForm.lines.map((line, i) => {
                const lineTotal = ((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)).toFixed(2);
                return (
                  <div key={line.id ?? `new-${i}`} className="rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-md transition-all duration-150 p-3 sm:p-4 space-y-3 group">
                    {/* Product Selection Row */}
                    <div className="flex items-start gap-2.5">
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Product</Label>
                        <ProductSearchSelect
                          products={editProducts}
                          value={line.product}
                          onChange={val => onUpdateLineProduct(i, val)}
                          loading={loadingEditProducts}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveLine(i)}
                        disabled={editForm.lines.length <= 1}
                        aria-label="Remove this product from the order"
                        title="Remove product"
                        className="mt-6 flex size-9 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 transition-all duration-150"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    {/* Quantity, Price, Subtotal Row */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Qty</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={line.quantity}
                          onChange={e => onUpdateLine(i, 'quantity', e.target.value)}
                          className="h-10 text-sm text-center border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Price</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={line.unit_price}
                          onChange={e => onUpdateLine(i, 'unit_price', e.target.value)}
                          className="h-10 text-sm text-right border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Total</Label>
                        <div className="h-10 flex items-center justify-end text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-2.5 tabular-nums">
                          {currency} {lineTotal}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Add Item Button - Below Last Item */}
              <button
                type="button"
                onClick={onAddLine}
                disabled={loadingEditProducts}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border-2 border-dashed border-gray-300 text-gray-700 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-150"
              >
                <Plus className="size-4" /> Add Item
              </button>
            </div>
          )}

          {/* Subtotal Summary */}
          {editForm.lines.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-lg px-4 py-3.5 sm:py-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Order Subtotal</span>
                  <p className="text-xs text-gray-600">Before discount and shipping</p>
                </div>
                <div className="text-right">
                  <span className="block text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">
                    {currency} {liveSubtotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discount Section */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white flex items-start sm:items-center gap-3">
          <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
            <Percent className="size-3.5 sm:size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">Discount</h4>
            <p className="text-xs text-gray-500 mt-0.5">Optional order-level discount (before shipping)</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-2 block">Type</Label>
              <Select value={editForm.discount_type ?? 'NONE'} onValueChange={v => onChangeDiscount('type', v as OrderDiscountType)}>
                <SelectTrigger className="h-9 text-sm border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-200 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No Discount</SelectItem>
                  <SelectItem value="FIXED">Fixed Amount</SelectItem>
                  <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-700 mb-2 block">Value</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editForm.discount_value ?? '0.00'}
                onChange={e => onChangeDiscount('value', e.target.value)}
                placeholder="0.00"
                className="h-9 text-sm text-right border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Delivery fee Section */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white flex items-start sm:items-center gap-3">
          <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
            <Truck className="size-3.5 sm:size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">Delivery fee</h4>
            <p className="text-xs text-gray-500 mt-0.5">Flat shipping fee added to the order total</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-gray-700">
            <Checkbox
              checked={deliveryFeeEnabled}
              onCheckedChange={(c) => {
                const on = c === true;
                setDeliveryFeeEnabled(on);
                onChangeBilling('delivery_fee', on ? (lastFee || '7.000') : '0.00');
              }}
              disabled={isSaving}
            />
            Charge a delivery fee for this order
          </label>
          {deliveryFeeEnabled && (
            <div className="max-w-[220px]">
              <Label className="text-xs font-semibold text-gray-700 mb-2 block">Amount ({currency})</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                inputMode="decimal"
                value={editForm.delivery_fee ?? '0.00'}
                onChange={e => { setLastFee(e.target.value); onChangeBilling('delivery_fee', e.target.value); }}
                placeholder="7.000"
                className="h-9 text-sm text-right border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
              />
            </div>
          )}
        </div>
      </div>

      {/* Billing / Delivery details */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white flex items-start sm:items-center gap-3">
          <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
            <MapPin className="size-3.5 sm:size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">Order customer details</h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Updates this order only; the shared client profile remains unchanged
            </p>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">First name</Label>
            <Input value={editForm.billing_first_name ?? ''} onChange={e => onChangeBilling('billing_first_name', e.target.value)} className="h-9 text-sm" placeholder="First name" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Last name</Label>
            <Input value={editForm.billing_last_name ?? ''} onChange={e => onChangeBilling('billing_last_name', e.target.value)} className="h-9 text-sm" placeholder="Last name" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Phone</Label>
            <Input type="tel" inputMode="tel" value={editForm.billing_phone ?? ''} onChange={e => onChangeBilling('billing_phone', e.target.value)} className="h-9 text-sm" placeholder="+216 ..." />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">City</Label>
            <Input value={editForm.billing_city ?? ''} onChange={e => onChangeBilling('billing_city', e.target.value)} className="h-9 text-sm" placeholder="City" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Address</Label>
            <Input value={editForm.billing_address_1 ?? ''} onChange={e => onChangeBilling('billing_address_1', e.target.value)} className="h-9 text-sm" placeholder="Street address" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Address (line 2)</Label>
            <Input value={editForm.billing_address_2 ?? ''} onChange={e => onChangeBilling('billing_address_2', e.target.value)} className="h-9 text-sm" placeholder="Apt, suite… (optional)" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Postcode</Label>
            <Input value={editForm.billing_postcode ?? ''} onChange={e => onChangeBilling('billing_postcode', e.target.value)} className="h-9 text-sm" placeholder="Postcode" />
          </div>
        </div>
      </div>

      {/* Delivery / shipping address */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white flex items-start sm:items-center gap-3">
          <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
            <Truck className="size-3.5 sm:size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">Delivery address</h4>
            <p className="text-xs text-gray-500 mt-0.5">Where this order ships — used to generate the delivery label</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">First name</Label>
            <Input value={editForm.shipping_first_name ?? ''} onChange={e => onChangeBilling('shipping_first_name', e.target.value)} className="h-9 text-sm" placeholder="First name" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Last name</Label>
            <Input value={editForm.shipping_last_name ?? ''} onChange={e => onChangeBilling('shipping_last_name', e.target.value)} className="h-9 text-sm" placeholder="Last name" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Address</Label>
            <Input value={editForm.shipping_address_1 ?? ''} onChange={e => onChangeBilling('shipping_address_1', e.target.value)} className="h-9 text-sm" placeholder="Street address" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Governorate</Label>
            <SearchSelect
              value={editForm.shipping_state ?? ''}
              onChange={val => onChangeBilling('shipping_state', val)}
              options={TUNISIA_GOVERNORATE_OPTIONS}
              placeholder="Search governorate…"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">City / Délégation</Label>
            <Input value={editForm.shipping_city ?? ''} onChange={e => onChangeBilling('shipping_city', e.target.value)} className="h-9 text-sm" placeholder="City" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Delivery phone</Label>
            <Input type="tel" inputMode="tel" value={editForm.shipping_phone ?? ''} onChange={e => onChangeBilling('shipping_phone', e.target.value)} className="h-9 text-sm" placeholder="Recipient phone — courier calls this number" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-700 mb-1.5 block">Postcode</Label>
            <Input value={editForm.shipping_postcode ?? ''} onChange={e => onChangeBilling('shipping_postcode', e.target.value)} className="h-9 text-sm" placeholder="Postcode" />
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="border-b border-gray-100 px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white flex items-start sm:items-center gap-3">
          <div className="size-8 sm:size-9 rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200 flex-shrink-0">
            <MessageSquare className="size-3.5 sm:size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-gray-900">Notes</h4>
            <p className="text-xs text-gray-500 mt-0.5">Add notes for customer and internal use</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-5">
          {/* Customer Note */}
          <div>
            <Label className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2 block">
              <Globe className="size-4 text-gray-600" />
              Customer Note
            </Label>
            <Textarea
              value={editForm.customer_note ?? ''}
              onChange={e => onChangeNote('customer', e.target.value)}
              placeholder="This note will be visible to the customer in their order confirmation..."
              className="min-h-20 text-sm resize-none border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors p-3"
            />
            <p className="text-xs text-gray-500 mt-2">Visible to customer in email and order page</p>
          </div>

          {/* Internal Note */}
          <div>
            <Label className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2 block">
              <AlertCircle className="size-4 text-gray-600" />
              Internal Note
            </Label>
            <Textarea
              value={editForm.internal_note ?? ''}
              onChange={e => onChangeNote('internal', e.target.value)}
              placeholder="Internal notes only (not visible to customer)..."
              className="min-h-20 text-sm resize-none border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors p-3"
            />
            <p className="text-xs text-gray-500 mt-2">For internal use and staff communication only</p>
          </div>
        </div>
      </div>

      {/* Sticky Save Bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm supports-[backdrop-filter]:bg-white/80 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-lg animate-in fade-in duration-300">
        <div className="text-xs sm:text-sm text-gray-600">
          <p className="font-medium">Unsaved changes</p>
          <p className="text-gray-500 text-xs">Changes will be saved immediately when you click save</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 sm:flex-none px-4 h-9 text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-150"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveEdit}
            disabled={isSaving}
            className="flex-1 sm:flex-none px-6 h-9 text-sm font-medium gap-2 min-w-32 bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-150 flex items-center justify-center"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="size-4" />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ORDER DETAIL DIALOG                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface OrderDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail | null;
  isDetailLoading: boolean;
  isEditMode: boolean;
  editForm: OrderEditRequest | null;
  editProducts: ProductListItem[];
  loadingEditProducts: boolean;
  packagingProducts: ProductListItem[];
  loadingPackagingProducts: boolean;
  savingEdit: boolean;
  mutatingOrder: boolean;
  /** Per-order count of failed Confirm/Delay attempts; gates the Cancel button. */
  failedActionAttempts?: number;
  onStatusChange: (id: number, status: OrderStatus) => void;
  onConfirmOrder: (id: number) => void;
  onNotAnswered: (id: number) => void;
  onDelayOrder: (id: number, data: { delay_date: string; delay_reason: string; note?: string }) => void;
  onRestoreDelayed: (id: number) => void;
  onCancelOrder: (id: number, data: { cancellation_reason: string; note?: string }) => void;
  onOpenSendPOS: (order: OrderDetail) => void;
  onSendDelivery: (id: number) => void;
  onProcessReturn: (id: number) => void;
  onPackageOrder: (id: number, items: Array<{ product_id: number; quantity: number }>, allowUpdate: boolean) => void;
  onUnpackageOrder: (id: number) => void;
  onEditModeChange: (enabled: boolean) => void;
  onUpdateLine: (index: number, key: 'quantity' | 'unit_price', value: string) => void;
  onUpdateLineProduct: (index: number, productId: string) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onSaveEdit: () => void;
  onChangeDiscount: (field: 'type' | 'value', val: string | OrderDiscountType) => void;
  onChangeNote: (field: 'customer' | 'internal', val: string) => void;
  onChangeBilling: (field: keyof OrderEditRequest, val: string) => void;
  onOpenLogs: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onCreateInvoice?: () => Promise<void>;
  onUpdateInvoice?: (payload: InvoiceMutationPayload) => Promise<void>;
  permissions?: OrderDialogPermissions;
  /** Whether the current user holds the working lock (can act) vs. read-only. */
  isLockOwner?: boolean;
  /** Name of the user currently handling the order (when we don't hold it). */
  lockedByName?: string | null;
  /** Open the take-over confirmation for a read-only viewer. */
  onTakeOver?: () => void;
}

export function OrderDetailDialog({
  open, onOpenChange, order, isDetailLoading,
  isEditMode, editForm, editProducts, loadingEditProducts,
  packagingProducts, loadingPackagingProducts,
  savingEdit, mutatingOrder, failedActionAttempts = 0,
  isLockOwner = true, lockedByName = null, onTakeOver,
  onStatusChange, onConfirmOrder, onNotAnswered, onDelayOrder, onRestoreDelayed, onCancelOrder,
  onOpenSendPOS, onSendDelivery, onProcessReturn, onPackageOrder, onUnpackageOrder,
  onEditModeChange,
  onUpdateLine, onUpdateLineProduct,
  onAddLine, onRemoveLine, onSaveEdit,
  onChangeDiscount, onChangeNote, onChangeBilling,
  onOpenLogs, onDelete, onRestore, onCreateInvoice, onUpdateInvoice,
  permissions,
}: Readonly<OrderDetailDialogProps>) {
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // Keep one shared action key for the whole popup. The global mutation flag
  // disables every conflicting control, while only the clicked action spins.
  const [activeAction, setActiveAction] = useState<string | null>(null);
  useEffect(() => {
    if (!mutatingOrder) setActiveAction(null);
  }, [mutatingOrder]);
  useEffect(() => {
    setActiveAction(null);
  }, [open, order?.id]);
  const runOrderAction = useCallback((
    name: string,
    action: () => void | Promise<void>,
  ) => {
    if (mutatingOrder) return;
    setActiveAction(name);
    void action();
  }, [mutatingOrder]);
  // Seller billing data for the invoice (logo, Matricule Fiscale, footer…).
  const { data: invoiceCompany } = useCurrentCompany();

  const title = order ? `Order ${order.order_number}` : 'Loading...';
  const desc = order?.external_order_id ? `WC #${order.external_order_id}` : undefined;

  const footerActions = order && !isEditMode ? (
    <div className="flex items-center gap-2 justify-end w-full flex-wrap">
      {!order.is_deleted && permissions?.edit && (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => onEditModeChange(true)}>
          <Pencil className="size-3" /> Edit
        </Button>
      )}
      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={onOpenLogs}>
        <History className="size-3" /> Logs
      </Button>
      {order.invoice_number && permissions?.viewInvoice && (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setInvoiceOpen(true)}>
          <FileText className="size-3" /> Invoice
        </Button>
      )}
      {!order.invoice_number && permissions?.editInvoice && onCreateInvoice && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs"
          disabled={mutatingOrder}
          onClick={() => runOrderAction('createInvoice', async () => {
            await onCreateInvoice();
            setInvoiceOpen(true);
          })}
        >
          {mutatingOrder && activeAction === 'createInvoice'
            ? <Loader2 className="size-3 animate-spin" />
            : <FileText className="size-3" />}
          Create Invoice
        </Button>
      )}
      {order.is_deleted && permissions?.restore ? (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => runOrderAction('restoreOrder', onRestore)} disabled={mutatingOrder}>
          {mutatingOrder && activeAction === 'restoreOrder' ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />} Restore
        </Button>
      ) : !order.is_deleted && permissions?.delete ? (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => runOrderAction('delete', onDelete)} disabled={mutatingOrder}>
          {mutatingOrder && activeAction === 'delete' ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Delete
        </Button>
      ) : null}
    </div>
  ) : undefined;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={title} description={desc} wide footer={footerActions}>
      {isDetailLoading && !order ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : order ? (
        <div className="space-y-5">
          {/* Working-lock banner — shown when another user is handling this
              order. The viewer is read-only until they take over (logged). */}
          {!isLockOwner && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2">
                <Lock className="size-4 shrink-0" />
                <span>
                  This order is currently being handled by{' '}
                  <span className="font-semibold">{lockedByName || 'another user'}</span>. You're in read-only mode.
                </span>
              </span>
              {onTakeOver && (
                <Button
                  size="sm"
                  className="shrink-0 gap-1.5 bg-amber-600 hover:bg-amber-700"
                  onClick={onTakeOver}
                >
                  <Unlock className="size-3.5" /> Take over
                </Button>
              )}
            </div>
          )}

          {/* Deleted banner */}
          {order.is_deleted && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>This order has been soft-deleted.</span>
            </div>
          )}

          {/* Phase D — canonical clean status + WooCommerce sync state strip. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <OrderStatusBadge status={order.status} label={order.status_display} />
            <SyncStatusBadge status={order.sync_status} label={order.sync_status_display} />
            {order.sync_status === 'sync_failed' && order.sync_error_message && (
              <span className="text-[11px] text-red-600 truncate max-w-[260px]" title={order.sync_error_message}>
                {order.sync_error_message}
              </span>
            )}
          </div>

          {!isEditMode ? (
            <OrderViewMode
              order={order}
              onStatusChange={onStatusChange}
              onConfirm={() => onConfirmOrder(order.id)}
              onNotAnswered={() => onNotAnswered(order.id)}
              onOpenDelay={() => setDelayDialogOpen(true)}
              onRestoreDelayed={() => onRestoreDelayed(order.id)}
              onOpenCancel={() => setCancelDialogOpen(true)}
              onOpenSendPOS={() => onOpenSendPOS(order)}
              onSendDelivery={() => onSendDelivery(order.id)}
              onProcessReturn={() => onProcessReturn(order.id)}
              onPackageOrder={(items, allowUpdate) => onPackageOrder(order.id, items, allowUpdate)}
              onUnpackageOrder={() => onUnpackageOrder(order.id)}
              isLoading={mutatingOrder}
              activeAction={activeAction}
              onRunAction={runOrderAction}
              permissions={permissions}
              failedActionAttempts={failedActionAttempts}
              packagingProducts={packagingProducts}
              loadingPackagingProducts={loadingPackagingProducts}
            />
          ) : editForm ? (
            <OrderEditMode
              editForm={editForm}
              editProducts={editProducts}
              loadingEditProducts={loadingEditProducts}
              currency={order.currency}
              onUpdateLine={onUpdateLine}
              onUpdateLineProduct={onUpdateLineProduct}
              onAddLine={onAddLine}
              onRemoveLine={onRemoveLine}
              onSaveEdit={onSaveEdit}
              onCancel={() => onEditModeChange(false)}
              onChangeDiscount={onChangeDiscount}
              onChangeNote={onChangeNote}
              onChangeBilling={onChangeBilling}
              isSaving={savingEdit}
            />
          ) : null}
        </div>
      ) : null}

      {/* ── Delay Order Dialog ── */}
      {order && (
        <DelayOrderDialog
          open={delayDialogOpen}
          onOpenChange={setDelayDialogOpen}
          onSubmit={(data) => {
            onDelayOrder(order.id, data);
            setDelayDialogOpen(false);
          }}
          isLoading={mutatingOrder}
        />
      )}

      {/* ── Cancel Order Dialog ── */}
      {order && (
        <CancelOrderDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onSubmit={(data) => {
            onCancelOrder(order.id, data);
            setCancelDialogOpen(false);
          }}
          isLoading={mutatingOrder}
        />
      )}

      {/* ── Invoice preview / print ── */}
      <InvoicePreviewDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        data={order?.invoice_number ? invoiceFromOrder(order, invoiceCompany ?? null) : null}
        canEditInvoice={permissions?.editInvoice}
        onSaveInvoice={onUpdateInvoice}
      />
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* DELAY ORDER DIALOG                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface DelayOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { delay_date: string; delay_reason: string; note?: string }) => void;
  isLoading?: boolean;
}

function DelayOrderDialog({ open, onOpenChange, onSubmit, isLoading }: Readonly<DelayOrderDialogProps>) {
  const [delayDate, setDelayDate] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDelayDate('');
      setDelayReason('');
      setNote('');
      setErrors({});
    }
  }, [open]);

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!delayDate) newErrors.delay_date = 'Follow-up date is required.';
    if (!delayReason.trim() || delayReason.trim().length < 3) newErrors.delay_reason = 'Reason must be at least 3 characters.';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    onSubmit({ delay_date: delayDate, delay_reason: delayReason.trim(), note: note.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <CalendarClock className="size-5" /> Delay Order
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Mark this order as delayed. The customer can be contacted later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Follow-up Date *</Label>
            <Input
              type="date"
              value={delayDate}
              onChange={e => { setDelayDate(e.target.value); setErrors(p => ({ ...p, delay_date: '' })); }}
              min={new Date().toISOString().split('T')[0]}
              className={`h-9 ${errors.delay_date ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
            />
            {errors.delay_date && <p className="text-xs text-red-600 mt-1">{errors.delay_date}</p>}
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Reason *</Label>
            <Textarea
              value={delayReason}
              onChange={e => { setDelayReason(e.target.value); setErrors(p => ({ ...p, delay_reason: '' })); }}
              placeholder="Customer unavailable, stock issue, scheduling conflict..."
              className={`min-h-20 text-sm resize-none ${errors.delay_reason ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
            />
            {errors.delay_reason && <p className="text-xs text-red-600 mt-1">{errors.delay_reason}</p>}
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Any additional details..."
              className="min-h-16 text-sm resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-amber-600 hover:bg-amber-700"
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarClock className="size-3.5" />}
              Mark Delayed
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CANCEL ORDER DIALOG                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { cancellation_reason: string; note?: string }) => void;
  isLoading?: boolean;
}

function CancelOrderDialog({ open, onOpenChange, onSubmit, isLoading }: Readonly<CancelOrderDialogProps>) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
      setErrors({});
    }
  }, [open]);

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    if (!reason.trim() || reason.trim().length < 3) newErrors.reason = 'Cancellation reason must be at least 3 characters.';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    onSubmit({ cancellation_reason: reason.trim(), note: note.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Ban className="size-5" /> Cancel Order
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This will cancel the order and set its status to Cancelled. This action cannot be easily undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 leading-relaxed">
                Cancelling this order will update both the outcome and the order status to <strong>Cancelled</strong>.
                The order will remain in the system for audit purposes.
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Cancellation Reason *</Label>
            <Textarea
              value={reason}
              onChange={e => { setReason(e.target.value); setErrors(p => ({ ...p, reason: '' })); }}
              placeholder="Customer requested cancellation, out of stock, fraud..."
              className={`min-h-20 text-sm resize-none ${errors.reason ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
            />
            {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason}</p>}
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Any additional internal details..."
              className="min-h-16 text-sm resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Keep Order
            </Button>
            <Button
              size="sm" variant="destructive"
              className="gap-1.5"
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
              Cancel Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SEND TO POS DIALOG                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface SendToPOSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail | null;
  channels: SalesChannel[];
  selectedChannelId: string;
  onChannelChange: (id: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

export function SendToPOSDialog({
  open,
  onOpenChange,
  order,
  channels,
  selectedChannelId,
  onChannelChange,
  onSubmit,
  isLoading,
}: Readonly<SendToPOSDialogProps>) {
  // Any active same-brand channel can be a POS pickup/checkout destination
  // (POS and WooCommerce alike) — the backend enforces brand + stock.
  const sameBrandChannels = useMemo(
    () => channels.filter(ch =>
      ch.is_active &&
      ch.brand === order?.brand
    ),
    [channels, order?.brand],
  );

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Send to POS"
      description={order ? `Choose the ${order.brand_name ?? 'same-brand'} POS location for ${order.order_number}.` : undefined}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={isLoading || !selectedChannelId} className="gap-1.5">
            {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Store className="size-3.5" />}
            Send
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{order?.order_number ?? 'Order'}</p>
          <p className="text-xs text-muted-foreground">
            Status stays Confirmed after routing. POS staff will validate checkout from the POS page.
          </p>
        </div>

        {sameBrandChannels.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>No active same-brand sales channel is available for this order.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs font-medium">POS location</Label>
            <Select value={selectedChannelId} onValueChange={onChannelChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select POS location..." />
              </SelectTrigger>
              <SelectContent>
                {sameBrandChannels.map(ch => (
                  <SelectItem key={ch.id} value={String(ch.id)}>
                    {ch.name}{ch.city ? ` - ${ch.city}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* RETURN LOOKUP DIALOG                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface ReturnLookupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (query: string) => void;
  isLoading?: boolean;
  title?: string;
  description?: string;
  placeholder?: string;
}

export function ReturnLookupDialog({
  open,
  onOpenChange,
  onSearch,
  isLoading,
  title = 'Find Returned Order',
  description = 'Scan a barcode or QR code, or type a ticket ID, WooCommerce order ID, internal order code, or delivery code.',
  placeholder = 'Ticket ID, WC ID, delivery code...',
}: Readonly<ReturnLookupDialogProps>) {
  const [query, setQuery] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const submit = useCallback((value = query) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSearch(trimmed);
  }, [onSearch, query]);

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => submit()} disabled={isLoading || !query.trim()} className="gap-1.5">
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Find
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Ticket ID, WooCommerce ID, order code, delivery code, barcode, or QR value</Label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                }}
                placeholder={placeholder}
                className="font-mono"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setCameraOpen(true)}>
                <ScanLine className="size-4" />
              </Button>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Hardware scanners type here automatically. Phone QR scan uses the camera button.
          </div>
        </div>
      </ResponsiveSheet>

      <POSCameraScanner
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onBarcodeDetected={(value) => {
          setCameraOpen(false);
          setQuery(value);
          submit(value);
        }}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* RETURN DIALOG — per-item disposition (back to stock vs waste), incl. packaging */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Per-item return disposition the operator chooses in the UI. Two simple options,
 * each mapping straight to a backend stock outcome:
 *   GOOD    → restock         (backend GOOD    → InventoryMovement RETURN_IN)
 *   DAMAGED → write-off/waste  (backend DAMAGED → InventoryMovement DAMAGE; never restocked)
 */
type ReturnDisposition = 'GOOD' | 'DAMAGED';

/** Backend stock condition accepted by process_return. */
type BackendCondition = 'GOOD' | 'DAMAGED' | 'MISSING';

const DISPOSITION_TO_BACKEND: Record<ReturnDisposition, BackendCondition> = {
  GOOD: 'GOOD',
  DAMAGED: 'DAMAGED',
};

/** Whether a chosen disposition puts the item back into available stock. */
const DISPOSITION_RESTOCKS: Record<ReturnDisposition, boolean> = {
  GOOD: true,
  DAMAGED: false,
};

const DISPOSITION_LABEL: Record<ReturnDisposition, string> = {
  GOOD: 'Good — back to stock',
  DAMAGED: 'Damaged — waste / no stock',
};

const DISPOSITION_OPTIONS: ReturnDisposition[] = ['GOOD', 'DAMAGED'];

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail | null;
  onSubmit: (payload: {
    returnReason: string;
    returnType: 'RETURNED' | 'EXCHANGED' | 'DAMAGED' | 'MISSING' | 'OTHER';
    lineConditions: ReturnLineCondition[];
  }) => void;
  isLoading?: boolean;
}

function isPackReturnLine(line: OrderLine) {
  return Boolean(line.is_pack || line.product_type === 'pack');
}

function unitKey(lineId: number, productId: number, unitIndex: number) {
  return `${lineId}:${productId}:${unitIndex}`;
}

/** One physical unit the operator inspects and classifies in the return popup. */
interface ReturnUnit {
  key: string;
  productId: number;
  productName: string;
  productImage?: string | null;
  productBarcode?: string | null;
  unitIndex: number;
  totalQuantity: number;
  fromPack: boolean;
}

/**
 * Expand an order line into the individual units to classify. A pack expands
 * into every component unit (quantity × composition); a normal line expands
 * into its `quantity` units of the same product — so a Qty-5 line becomes 5
 * separate Good/Damaged checks instead of one bulk decision.
 */
function getReturnUnits(line: OrderLine): ReturnUnit[] {
  if (isPackReturnLine(line)) {
    return (line.pack_items_detail ?? []).flatMap(item => {
      const totalQuantity = item.quantity * line.quantity;
      return Array.from({ length: totalQuantity }, (_, unitIndex) => ({
        key: unitKey(line.id, item.product_id, unitIndex),
        productId: item.product_id,
        productName: item.product_name,
        productImage: item.product_image,
        productBarcode: item.product_barcode,
        unitIndex,
        totalQuantity,
        fromPack: true,
      }));
    });
  }
  const productId = line.product_id ?? line.product ?? 0;
  return Array.from({ length: line.quantity }, (_, unitIndex) => ({
    key: unitKey(line.id, productId, unitIndex),
    productId,
    productName: line.product_name,
    productImage: line.product_image,
    productBarcode: line.barcode,
    unitIndex,
    totalQuantity: line.quantity,
    fromPack: false,
  }));
}

function ReturnDispositionPicker({
  value,
  onChange,
  disabled,
  compact = false,
}: Readonly<{
  value: ReturnDisposition | undefined;
  onChange: (value: ReturnDisposition) => void;
  disabled?: boolean;
  compact?: boolean;
}>) {
  const restocks = value ? DISPOSITION_RESTOCKS[value] : null;
  return (
    <div className="flex items-center gap-2 sm:flex-shrink-0">
      <Select
        value={value ?? ''}
        onValueChange={v => onChange(v as ReturnDisposition)}
        disabled={disabled}
      >
        <SelectTrigger
          className={`h-9 w-full text-xs ${compact ? 'sm:w-[190px]' : 'sm:w-[210px]'} ${
            value ? '' : 'border-amber-400 text-amber-700 dark:text-amber-400'
          }`}
        >
          <SelectValue placeholder="Select condition…" />
        </SelectTrigger>
        <SelectContent>
          {DISPOSITION_OPTIONS.map(opt => (
            <SelectItem key={opt} value={opt}>
              <span className="flex items-center gap-2">
                <span
                  className={`size-1.5 rounded-full ${
                    DISPOSITION_RESTOCKS[opt] ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                  aria-hidden
                />
                {DISPOSITION_LABEL[opt]}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Badge
          variant="outline"
          className={`hidden shrink-0 gap-1 text-[10px] sm:inline-flex ${
            restocks
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
              : 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
          }`}
        >
          {restocks ? <TrendingUp className="size-3" /> : <Ban className="size-3" />}
          {restocks ? 'Stock' : 'Waste'}
        </Badge>
      )}
    </div>
  );
}

/** One order line inside the return popup, classified unit by unit. */
function ReturnItemRow({
  line,
  units,
  unitValues,
  onUnitChange,
  disabled,
}: Readonly<{
  line: OrderLine;
  units: ReturnUnit[];
  unitValues: Record<string, ReturnDisposition>;
  onUnitChange: (key: string, value: ReturnDisposition) => void;
  disabled?: boolean;
}>) {
  const isPack = isPackReturnLine(line);
  // A single-unit normal line keeps the compact inline picker; anything with
  // more than one unit (multi-qty lines and packs) is classified unit by unit.
  const perUnit = isPack || units.length > 1;
  return (
    <div className="p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ProductImage src={line.product_image} alt={line.product_name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium whitespace-normal break-words leading-snug">{line.product_name}</p>
              {isPack && <Badge variant="secondary" className="text-[10px]">Pack</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Qty {line.quantity}{line.barcode ? ` · ${line.barcode}` : ''}
            </p>
          </div>
        </div>
        {!perUnit && units.length === 1 && (
          <ReturnDispositionPicker
            value={unitValues[units[0].key]}
            onChange={v => onUnitChange(units[0].key, v)}
            disabled={disabled}
          />
        )}
      </div>

      {isPack && units.length === 0 && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          Pack composition is unavailable. Update the pack before processing this return.
        </div>
      )}

      {perUnit && units.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg border bg-muted/20 p-2">
          <p className="px-1 text-xs font-medium">
            {isPack ? 'Classify every product inside the pack separately' : 'Classify each unit separately'}
          </p>
          {units.map(unit => (
            <div
              key={unit.key}
              className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <ProductImage src={unit.productImage} alt={unit.productName} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{unit.productName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Unit {unit.unitIndex + 1}/{unit.totalQuantity}
                    {unit.productBarcode ? ` · ${unit.productBarcode}` : ''}
                  </p>
                </div>
              </div>
              <ReturnDispositionPicker
                value={unitValues[unit.key]}
                onChange={nextValue => onUnitChange(unit.key, nextValue)}
                disabled={disabled}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Return processing popup. Shows the full order context, then forces the operator
 * to classify EVERY item (customer products AND packaging) before saving. Each
 * item's condition decides whether it returns to available stock or is
 * written off as waste; the backend then restocks, records inventory movements,
 * flips the order to RETURNED, reverses revenue/KPIs/points, and logs the action.
 */
export function ReturnDialog({ open, onOpenChange, order, onSubmit, isLoading }: Readonly<ReturnDialogProps>) {
  const customerLines = useMemo(
    () => (order
      ? (order.customer_lines ?? order.lines.filter(l => l.product_type !== 'packaging_item' && !l.is_deleted))
      : []),
    [order],
  );
  const packagingLines = useMemo(
    () => (order
      ? (order.packaging_lines ?? order.lines.filter(l => l.product_type === 'packaging_item' && !l.is_deleted))
      : []),
    [order],
  );
  const allLines = useMemo(() => [...customerLines, ...packagingLines], [customerLines, packagingLines]);

  const [reason, setReason] = useState('');
  // Every unit (pack component OR a single unit of a normal line) is keyed
  // individually so the operator classifies each one on its own.
  const [unitDispositions, setUnitDispositions] = useState<Record<string, ReturnDisposition>>({});

  // (Re)initialise whenever a different order is opened. Intentionally leave every
  // unit UNSET so the operator must consciously classify each one before saving.
  useEffect(() => {
    if (!open || !order) return;
    setUnitDispositions({});
    setReason('');
  }, [open, order]);

  const setUnitDisposition = useCallback((key: string, value: ReturnDisposition) => {
    setUnitDispositions(prev => ({ ...prev, [key]: value }));
  }, []);

  const classificationSummary = useMemo(() => {
    let pending = 0;
    let restock = 0;
    let waste = 0;
    for (const line of allLines) {
      const units = getReturnUnits(line);
      if (units.length === 0) {
        // Pack whose composition is unavailable — counts as one pending block.
        pending += 1;
        continue;
      }
      for (const unit of units) {
        const disposition = unitDispositions[unit.key];
        if (!disposition) pending += 1;
        else if (DISPOSITION_RESTOCKS[disposition]) restock += 1;
        else waste += 1;
      }
    }
    return { pending, restock, waste };
  }, [allLines, unitDispositions]);
  const pendingCount = classificationSummary.pending;
  const restockCount = classificationSummary.restock;
  const wasteCount = classificationSummary.waste;
  const allClassified = allLines.length > 0 && pendingCount === 0;

  const channelName = order
    ? (order.pos_validated_at && order.pos_sales_channel_name ? order.pos_sales_channel_name : order.sales_channel_name)
    : '';

  const handleSubmit = useCallback(() => {
    if (!order) return;
    const lineConditions: ReturnLineCondition[] = [];
    const breakdown: string[] = [];

    for (const line of allLines) {
      const units = getReturnUnits(line);
      if (units.length === 0) return; // pack with no composition → can't classify

      if (isPackReturnLine(line)) {
        // Group identical pack-component units by (product, condition) so the
        // backend gets one quantity-bearing entry per outcome.
        const grouped = new Map<string, {
          product_id: number;
          quantity: number;
          condition: BackendCondition;
        }>();
        const componentBreakdown = new Map<number, { name: string; good: number; damaged: number }>();
        let hasDamagedUnit = false;
        for (const unit of units) {
          const disposition = unitDispositions[unit.key];
          if (!disposition) return;
          const condition = DISPOSITION_TO_BACKEND[disposition];
          const groupKey = `${unit.productId}:${condition}`;
          const current = grouped.get(groupKey);
          if (current) current.quantity += 1;
          else grouped.set(groupKey, { product_id: unit.productId, quantity: 1, condition });
          const counts = componentBreakdown.get(unit.productId) ?? { name: unit.productName, good: 0, damaged: 0 };
          if (disposition === 'GOOD') counts.good += 1;
          else { counts.damaged += 1; hasDamagedUnit = true; }
          componentBreakdown.set(unit.productId, counts);
        }
        lineConditions.push({
          line_id: line.id,
          condition: hasDamagedUnit ? 'DAMAGED' : 'GOOD',
          component_conditions: Array.from(grouped.values()),
        });
        breakdown.push(
          `${line.product_name}: ${Array.from(componentBreakdown.values())
            .map(counts => `${counts.name} (${counts.good} good, ${counts.damaged} damaged)`)
            .join(', ')}`,
        );
        continue;
      }

      // Normal line — tally the per-unit verdicts.
      let good = 0;
      let damaged = 0;
      for (const unit of units) {
        const disposition = unitDispositions[unit.key];
        if (!disposition) return;
        if (disposition === 'GOOD') good += 1;
        else damaged += 1;
      }
      if (damaged === 0) {
        // All units good → simple whole-line restock.
        lineConditions.push({ line_id: line.id, condition: 'GOOD' });
        breakdown.push(`${line.product_name} ×${line.quantity}: all good`);
      } else if (good === 0) {
        // All units damaged → simple whole-line write-off.
        lineConditions.push({ line_id: line.id, condition: 'DAMAGED' });
        breakdown.push(`${line.product_name} ×${line.quantity}: all damaged`);
      } else {
        // Mixed → split this line's product into good vs damaged quantities.
        const productId = units[0].productId;
        lineConditions.push({
          line_id: line.id,
          condition: 'DAMAGED',
          component_conditions: [
            { product_id: productId, quantity: good, condition: 'GOOD' },
            { product_id: productId, quantity: damaged, condition: 'DAMAGED' },
          ],
        });
        breakdown.push(`${line.product_name} ×${line.quantity}: ${good} good, ${damaged} damaged`);
      }
    }
    if (lineConditions.length === 0) return;

    const breakdownText = breakdown.join('; ');
    const typed = reason.trim();
    const returnReason = typed
      ? `${typed} | Item conditions — ${breakdownText}`
      : `Item conditions — ${breakdownText}`;
    onSubmit({ returnReason, returnType: 'RETURNED', lineConditions });
  }, [order, allLines, unitDispositions, reason, onSubmit]);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Process Return"
      description={order ? `Classify every item from ${order.order_number}, then save the return.` : undefined}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs">
            {allLines.length === 0 ? (
              <span className="text-muted-foreground">No items to return.</span>
            ) : pendingCount > 0 ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {pendingCount} item{pendingCount === 1 ? '' : 's'} still need a condition
              </span>
            ) : (
              <span className="text-muted-foreground">
                <span className="font-medium text-emerald-600 dark:text-emerald-400">{restockCount} back to stock</span>
                {' · '}
                <span className="font-medium text-rose-600 dark:text-rose-400">{wasteCount} waste</span>
              </span>
            )}
          </span>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isLoading || !allClassified}
              className="gap-1.5"
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Save Return
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ── Order summary ─────────────────────────────────────────────── */}
        {order && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{order.order_number}</span>
                <OrderStatusBadge status={order.status} label={order.status_display} />
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {order.total} {order.currency}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
              {/* Delivery contact — what goes on the parcel, not the client record. */}
              <span className="flex items-center gap-1.5 min-w-0">
                <User className="size-3.5 shrink-0" />
                <span className="truncate text-foreground">{order.delivery_name || 'Walk-in customer'}</span>
              </span>
              {order.delivery_phone && (
                <span className="flex items-center gap-1.5 min-w-0">
                  <Phone className="size-3.5 shrink-0" />
                  <span className="truncate">{order.delivery_phone}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5 min-w-0">
                <Store className="size-3.5 shrink-0" />
                <span className="truncate">{channelName}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5 shrink-0" />
                {new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                <CreditCard className="size-3.5 shrink-0" />
                <span className="truncate">{order.payment_method || 'Payment N/A'}</span>
              </span>
              {order.client_return_count > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="size-3.5 shrink-0" />
                  {order.client_return_count} previous return{order.client_return_count === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Reason (optional)</Label>
          <Input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. wrong size, customer changed mind, defective…"
            disabled={isLoading}
            className="h-9"
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="font-medium text-foreground">Good</span> returns the item to available stock.
          </span>
          <span className="mx-2 hidden sm:inline">·</span>
          <span className="mt-1 flex items-center gap-1.5 sm:mt-0 sm:inline-flex">
            <span className="size-2 rounded-full bg-rose-500" aria-hidden />
            <span className="font-medium text-foreground">Damaged</span> is marked as waste (not restocked).
          </span>
        </div>

        {allLines.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            This order has no items to return.
          </div>
        ) : (
          <>
            {/* ── Order items ─────────────────────────────────────────────── */}
            {customerLines.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Package className="size-3.5" />
                  Order items
                  <Badge variant="secondary" className="text-[10px]">{customerLines.length}</Badge>
                </div>
                <div className="divide-y rounded-lg border">
                  {customerLines.map(line => (
                    <ReturnItemRow
                      key={line.id}
                      line={line}
                      units={getReturnUnits(line)}
                      unitValues={unitDispositions}
                      onUnitChange={setUnitDisposition}
                      disabled={isLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Packaging items ─────────────────────────────────────────── */}
            {packagingLines.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Package className="size-3.5" />
                  Packaging items
                  <Badge variant="secondary" className="text-[10px]">{packagingLines.length}</Badge>
                </div>
                <div className="divide-y rounded-lg border">
                  {packagingLines.map(line => (
                    <ReturnItemRow
                      key={line.id}
                      line={line}
                      units={getReturnUnits(line)}
                      unitValues={unitDispositions}
                      onUnitChange={setUnitDisposition}
                      disabled={isLoading}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CREATE ORDER DIALOG — manual order creation (Method B / POS ingestion)     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: SalesChannel[];
  onSubmit: (payload: POSOrderCreateRequest) => void;
  isLoading?: boolean;
}

/** Labelled divider that groups the create-order form into clear sections. */
function CreateSectionHeader({ icon: Icon, title, hint }: Readonly<{ icon: LucideIcon; title: string; hint?: string }>) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
      </div>
      <div className="hidden h-px flex-1 bg-border sm:block" />
    </div>
  );
}

interface DraftLine {
  product: ProductListItem;
  quantity: number;
  price: string;
}

/**
 * Manual order creation from the Order Operations page. Products are loaded for
 * the chosen channel's brand; lines can be added by search or barcode scan. The
 * payload is fed through the same POS ingestion path used by the till, so stock
 * reconciliation and totals are computed authoritatively on the server.
 */
export function CreateOrderDialog({
  open, onOpenChange, channels, onSubmit, isLoading,
}: Readonly<CreateOrderDialogProps>) {
  // Manual orders from the Order Manager are WooCommerce-style fulfilment orders
  // (they route through the delivery API), so only WooCommerce channels qualify —
  // POS/WEB channels are intentionally excluded here.
  const activeChannels = useMemo(
    () => channels.filter(c => c.is_active && c.channel_type === 'WOOCOMMERCE'),
    [channels],
  );
  // The user's focused workspace brand (null = whole-company focus). Used to
  // pre-scope the dialog so a multi-brand company doesn't dump every channel.
  const activeBrandId = useAuthStore(s => s.user?.current_brand_id ?? null);
  const [brandFilter, setBrandFilter] = useState('');
  const [channelId, setChannelId] = useState('');
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank'>('cash');
  const [orderStatus, setOrderStatus] = useState<'pending' | 'processing' | 'completed'>('processing');
  const [discountType, setDiscountType] = useState<OrderDiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  // Optional delivery fee — default 7 DT, only added when the user opts in.
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('7.000');
  const [customerNote, setCustomerNote] = useState('');
  const [orderSource, setOrderSource] = useState<OrderSocialSource | ''>('');
  // Auto-applied promotions, keyed by product id (the best active promo for the
  // chosen channel). `manualPriceIds` marks lines the user hand-edited so a promo
  // refresh never clobbers a deliberate price override.
  const [promoByProduct, setPromoByProduct] = useState<Record<number, DiscountCalculationResult>>({});
  const [promoLoading, setPromoLoading] = useState(false);
  const [manualPriceIds, setManualPriceIds] = useState<Set<number>>(new Set());

  // Distinct brands reachable through the (already tenant-scoped) channel list.
  const brandOptions = useMemo(() => {
    const m = new Map<number, string>();
    activeChannels.forEach(c => {
      if (c.brand != null && !m.has(c.brand)) m.set(c.brand, c.brand_name || `Brand ${c.brand}`);
    });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [activeChannels]);
  const multiBrand = brandOptions.length > 1;

  // Channels narrowed to the chosen brand. With no brand picked we fall back to
  // the full (company-scoped) list so single-brand companies are unaffected.
  const visibleChannels = useMemo(
    () => (brandFilter ? activeChannels.filter(c => String(c.brand) === brandFilter) : activeChannels),
    [activeChannels, brandFilter],
  );

  const selectedChannel = useMemo(
    () => activeChannels.find(c => String(c.id) === channelId),
    [activeChannels, channelId],
  );
  const brandId = selectedChannel?.brand;

  // Reset everything when the dialog closes so the next open starts clean.
  useEffect(() => {
    if (open) return;
    setBrandFilter(''); setChannelId(''); setProducts([]); setLines([]); setScanFeedback(null);
    setClient(null); setPaymentMethod('cash'); setOrderStatus('processing');
    setDiscountType('NONE'); setDiscountValue(''); setDeliveryEnabled(false); setDeliveryFee('7.000');
    setCustomerNote(''); setOrderSource('');
    setPromoByProduct({}); setManualPriceIds(new Set()); setPromoLoading(false);
  }, [open]);

  // On open, focus the brand: prefer the user's active workspace brand; with no
  // active brand a multi-brand company starts unset (forcing an explicit pick),
  // while a single-brand company is left as-is (the selector stays hidden).
  useEffect(() => {
    if (!open) return;
    setBrandFilter(
      activeBrandId && brandOptions.some(b => b.id === activeBrandId) ? String(activeBrandId) : '',
    );
    // brandOptions/activeBrandId are read once at open time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Drop the chosen channel if it no longer belongs to the focused brand, so the
  // channel select never shows a value from a different brand.
  useEffect(() => {
    if (!brandFilter) return;
    setChannelId(prev => {
      if (!prev) return prev;
      const ch = activeChannels.find(c => String(c.id) === prev);
      return ch && String(ch.brand) === brandFilter ? prev : '';
    });
  }, [brandFilter, activeChannels]);

  // When there's only one channel to pick from — a single-channel workspace, or
  // a brand that owns just one channel — select it automatically. Forcing a pick
  // from a one-option dropdown is pure friction, and it unblocks the product
  // loader (which is gated on a chosen channel) in one less tap.
  useEffect(() => {
    if (!open || channelId) return;
    if (visibleChannels.length === 1) setChannelId(String(visibleChannels[0].id));
  }, [open, channelId, visibleChannels]);

  // Keep the picked customer across brand/channel changes — clients are
  // company-scoped, not brand-scoped, so picking the client before the channel
  // must not silently wipe it. Only a channel from ANOTHER company invalidates
  // the selection (the backend rejects cross-tenant clients too).
  useEffect(() => {
    if (!selectedChannel) return;
    setClient(prev => (
      prev && prev.company != null && prev.company !== selectedChannel.company_id ? null : prev
    ));
  }, [selectedChannel]);

  // Load the brand's products whenever the channel (hence brand) changes; a new
  // brand means a different catalogue, so any half-built cart is cleared.
  useEffect(() => {
    if (!open || !brandId) { setProducts([]); return; }
    let cancelled = false;
    setLoadingProducts(true);
    setLines([]);
    setManualPriceIds(new Set());
    productService.getAllProducts({ brand: brandId, page_size: 500 })
      // Only sellable types may go on a customer order — show resell products and
      // packs, never components or packaging items.
      .then(items => { if (!cancelled) setProducts((items || []).filter(p => SELLABLE_PRODUCT_TYPES.includes(p.product_type))); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [open, brandId]);

  const addProduct = useCallback((productId: string) => {
    const product = products.find(p => String(p.id) === productId);
    if (!product) return;
    setLines(prev => {
      const existing = prev.find(l => l.product.id === product.id);
      if (existing) {
        return prev.map(l => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { product, quantity: 1, price: String(product.sales_price ?? '0') }];
    });
  }, [products]);

  const handleScan = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const match = products.find(p => p.barcode && p.barcode.toLowerCase() === code.toLowerCase());
    if (!match) {
      setScanFeedback({ message: `No product matches "${code}"`, type: 'error' });
      return;
    }
    addProduct(String(match.id));
    setScanFeedback({ message: `Added ${match.name}`, type: 'success' });
  }, [products, addProduct]);

  const updateQty = useCallback((productId: number, qty: number) => {
    setLines(prev => prev.map(l => (
      l.product.id === productId
        ? { ...l, quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1 }
        : l
    )));
  }, []);
  const updatePrice = useCallback((productId: number, price: string) => {
    // A hand-typed price wins over any promo and must not be auto-overwritten.
    setManualPriceIds(prev => (prev.has(productId) ? prev : new Set(prev).add(productId)));
    setLines(prev => prev.map(l => (l.product.id === productId ? { ...l, price } : l)));
  }, []);
  const removeLine = useCallback((productId: number) => {
    setLines(prev => prev.filter(l => l.product.id !== productId));
  }, []);

  // ── Auto-apply promotions (same engine POS uses) ─────────────────────────
  // Fetch the best active promotion for each line's product on the chosen
  // channel and use the discounted price. The backend re-applies this
  // authoritatively when the order is saved; this keeps the preview honest.
  const productIdsKey = useMemo(
    () => Array.from(new Set(lines.map(l => l.product.id))).sort((a, b) => a - b).join(','),
    [lines],
  );

  useEffect(() => {
    if (!channelId || !productIdsKey) { setPromoByProduct({}); return; }
    const productIds = productIdsKey.split(',').map(Number);
    let cancelled = false;
    setPromoLoading(true);
    promotionService
      .batchCalculateDiscounts({ product_ids: productIds, sales_channel_id: Number(channelId) })
      .then(res => { if (!cancelled) setPromoByProduct(res.results || {}); })
      .catch(() => { if (!cancelled) setPromoByProduct({}); })
      .finally(() => { if (!cancelled) setPromoLoading(false); });
    return () => { cancelled = true; };
  }, [channelId, productIdsKey]);

  // Push the promo price onto each line — but never over a manual override.
  useEffect(() => {
    setLines(prev => {
      let changed = false;
      const next = prev.map(l => {
        if (manualPriceIds.has(l.product.id)) return l;
        const promo = promoByProduct[l.product.id];
        const target = promo ? promo.discounted_price : String(l.product.sales_price ?? '0');
        if (l.price === target) return l;
        changed = true;
        return { ...l, price: target };
      });
      return changed ? next : prev;
    });
    // Keyed on promoByProduct only: a manual edit must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoByProduct]);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * (parseFloat(l.price) || 0), 0),
    [lines],
  );
  // Total units across all lines (a line of qty 3 counts as 3) — shown in the
  // totals ledger so the subtotal reads as "for N items".
  const itemCount = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);

  // Discount preview — mirrors the server's authoritative recompute so the UI
  // total matches what the order will actually be saved with.
  const discountNum = parseFloat(discountValue) || 0;
  const discountInvalid =
    discountType !== 'NONE' &&
    (discountNum < 0 || (discountType === 'PERCENTAGE' && discountNum > 100));
  const discountTotal = useMemo(() => {
    if (discountType === 'PERCENTAGE') {
      return Math.min(subtotal, subtotal * (Math.min(Math.max(discountNum, 0), 100) / 100));
    }
    if (discountType === 'FIXED') {
      return Math.min(subtotal, Math.max(discountNum, 0));
    }
    return 0;
  }, [discountType, discountNum, subtotal]);
  const deliveryFeeNum = deliveryEnabled ? Math.max(0, parseFloat(deliveryFee) || 0) : 0;
  const grandTotal = Math.max(0, subtotal - discountTotal) + deliveryFeeNum;

  const canSubmit = !!channelId && lines.length > 0 && !discountInvalid && !isLoading;
  // Human-readable reason the Create Order button is disabled (shown in the footer).
  const disabledReason = !channelId
    ? 'Select a sales channel'
    : lines.length === 0
      ? 'Add at least one product'
      : discountInvalid
        ? 'Fix the discount value'
        : '';

  const handleSubmit = useCallback(() => {
    if (!channelId || lines.length === 0 || discountInvalid) return;
    // Link the client by id; the server derives WooCommerce billing from the
    // stored Client and re-resolves it inside the ingest pipeline. We send only
    // the discount *intent* (type + value) and let the backend recompute
    // discount_total / total authoritatively — never trust client-side money.
    const payload: POSOrderCreateRequest = {
      sales_channel: Number(channelId),
      client: client?.id ?? null,
      line_items: lines.map(l => ({
        local_product_id: l.product.id,
        name: l.product.name,
        sku: l.product.barcode ?? '',
        quantity: l.quantity,
        price: (parseFloat(l.price) || 0).toFixed(2),
        total: (l.quantity * (parseFloat(l.price) || 0)).toFixed(2),
      })),
      payment_method: paymentMethod,
      payment_method_title:
        paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : 'Bank Transfer',
      customer_note: customerNote,
      status: orderStatus,
      order_source: orderSource || '',
      discount_type: discountType,
      discount_value:
        discountType === 'NONE' ? '0.00' : (parseFloat(discountValue) || 0).toFixed(2),
      delivery_fee: deliveryFeeNum.toFixed(2),
    };
    onSubmit(payload);
  }, [
    channelId, lines, client, paymentMethod, customerNote,
    orderStatus, orderSource, discountType, discountValue, deliveryFeeNum, discountInvalid, onSubmit,
  ]);

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        wide
        title="Create Order"
        description="Manually create an order. Stock and totals are reconciled on the server."
        footer={
          <div className="w-full space-y-2">
            {!canSubmit && disabledReason && (
              <p className="text-center text-[11px] text-amber-600 sm:text-left">
                {disabledReason} to create the order.
              </p>
            )}
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums">Total: {grandTotal.toFixed(2)} TND</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
                  {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Create Order
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <CreateSectionHeader icon={Store} title="Where to sell" hint="Pick the channel this order belongs to" />
          {multiBrand && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Brand</Label>
              <Select value={brandFilter} onValueChange={setBrandFilter} disabled={isLoading}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select a brand…" /></SelectTrigger>
                <SelectContent>
                  {brandOptions.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                This company has several brands. Pick one to scope the channels and products below.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Sales channel</Label>
            <Select
              value={channelId}
              onValueChange={setChannelId}
              disabled={isLoading || (multiBrand && !brandFilter)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={multiBrand && !brandFilter ? 'Select a brand first…' : 'Select a sales channel…'} />
              </SelectTrigger>
              <SelectContent>
                {visibleChannels.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}{c.brand_name ? ` · ${c.brand_name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeChannels.length === 0 && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-xs text-amber-800">
              No WooCommerce sales channel is available for your workspace. Manual delivery
              orders can only be created on a WooCommerce channel.
            </div>
          )}

          <div className="space-y-2">
            <CreateSectionHeader icon={User} title="Customer" hint="Attached to the order + used for the delivery label" />
            <OrderClientSelector
              value={client}
              onChange={setClient}
              salesChannelId={selectedChannel?.id ?? null}
              brandId={brandId ?? null}
              disabled={isLoading}
            />
            {!client && (
              <p className="text-[11px] text-muted-foreground">
                The customer's name, phone and address are attached to the order and used
                for the delivery label. Leave empty only for anonymous walk-in orders.
              </p>
            )}
          </div>

          <CreateSectionHeader icon={Package} title="Products" hint="Search or scan items to add to the order" />
          {channelId ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium">Add products</Label>
                <span className="text-[11px] text-muted-foreground">
                  {loadingProducts ? 'Loading…' : `${products.length} available · add as many as you need`}
                </span>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <ProductSearchSelect
                    products={products}
                    value={null}
                    onChange={addProduct}
                    loading={loadingProducts}
                    allowManual={false}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setScannerOpen(true)}
                  title="Scan barcode"
                >
                  <ScanLine className="size-4" />
                </Button>
              </div>
              {scanFeedback && (
                <p className={`text-xs ${scanFeedback.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {scanFeedback.message}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Select a sales channel to load its products.
            </div>
          )}

          {promoLoading && lines.length > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Checking for promotions…
            </p>
          )}
          {lines.length > 0 && (
            <div className="divide-y rounded-lg border">
              {lines.map(l => (
                <div key={l.product.id} className="flex flex-wrap items-center gap-3 p-3">
                  <ProductImage src={l.product.image_url} alt={l.product.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium whitespace-normal break-words leading-snug">{l.product.name}</p>
                    <p className="text-[11px] text-muted-foreground">{l.product.barcode || '—'}</p>
                    {promoByProduct[l.product.id] && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Tag className="size-2.5" />
                        {promoByProduct[l.product.id].discount_type.toLowerCase().includes('percent')
                          ? `-${Number(promoByProduct[l.product.id].discount_value)}%`
                          : `-${Number(promoByProduct[l.product.id].discount_value).toFixed(2)} TND`}
                        <span className="font-normal opacity-70">· was {Number(promoByProduct[l.product.id].original_price).toFixed(2)}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={l.quantity}
                      onChange={e => updateQty(l.product.id, parseInt(e.target.value, 10))}
                      className="h-9 w-16 text-sm tabular-nums"
                      aria-label={`Quantity for ${l.product.name}`}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={l.price}
                      onChange={e => updatePrice(l.product.id, e.target.value)}
                      className="h-9 w-24 text-sm tabular-nums"
                      aria-label={`Unit price for ${l.product.name}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => removeLine(l.product.id)}
                      aria-label={`Remove ${l.product.name} from the order`}
                      title="Remove item"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <CreateSectionHeader icon={CreditCard} title="Order details" hint="Payment, status and where the order came from" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Payment method</Label>
              <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as typeof paymentMethod)} disabled={isLoading}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Status</Label>
              <Select value={orderStatus} onValueChange={v => setOrderStatus(v as typeof orderStatus)} disabled={isLoading}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="pending">Pending (fulfil later)</SelectItem>
                  <SelectItem value="completed">Completed (paid)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Order source (optional)</Label>
            <Select
              value={orderSource || 'none'}
              onValueChange={v => setOrderSource(v === 'none' ? '' : (v as OrderSocialSource))}
              disabled={isLoading}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Where did this order come from?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {ORDER_SOCIAL_SOURCES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Customer note (optional)</Label>
            <Textarea
              value={customerNote}
              onChange={e => setCustomerNote(e.target.value)}
              rows={2}
              placeholder="Any note for this order…"
            />
          </div>

          {/* Discount + live totals — only meaningful once items exist. The
              preview mirrors the server's recompute; the backend remains the
              source of truth for the saved figures. */}
          {lines.length > 0 && (
            <>
            <CreateSectionHeader icon={Percent} title="Discount, delivery & total" hint="Apply a discount, add delivery, then review the live total" />
            <div className="space-y-3">
              {/* Discount */}
              <div className="space-y-3 rounded-xl border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Discount</Label>
                    <Select
                      value={discountType}
                      onValueChange={v => setDiscountType(v as OrderDiscountType)}
                      disabled={isLoading}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">No discount</SelectItem>
                        <SelectItem value="FIXED">Fixed amount (TND)</SelectItem>
                        <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {discountType !== 'NONE' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        {discountType === 'PERCENTAGE' ? 'Percentage (0–100)' : 'Amount (TND)'}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={discountType === 'PERCENTAGE' ? 100 : undefined}
                        step="0.01"
                        value={discountValue}
                        onChange={e => setDiscountValue(e.target.value)}
                        className="h-9"
                        placeholder={discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 5.00'}
                        aria-invalid={discountInvalid}
                      />
                    </div>
                  )}
                </div>
                {discountInvalid && (
                  <p className="text-xs text-red-600">
                    {discountType === 'PERCENTAGE'
                      ? 'Percentage must be between 0 and 100.'
                      : 'Discount amount cannot be negative.'}
                  </p>
                )}
              </div>

              {/* Delivery fee — a clear on/off row; the amount field reveals on enable. */}
              <div className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                      <Truck className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">Delivery fee</p>
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        {deliveryEnabled
                          ? `+${deliveryFeeNum.toFixed(2)} TND added to the order total`
                          : 'No delivery charge on this order'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={deliveryEnabled}
                    onCheckedChange={c => setDeliveryEnabled(c === true)}
                    disabled={isLoading}
                    aria-label="Add a delivery fee"
                  />
                </div>
                {deliveryEnabled && (
                  <div className="mt-3 space-y-1.5 border-t pt-3">
                    <Label htmlFor="delivery-fee-amount" className="text-xs font-medium">Delivery amount</Label>
                    <div className="relative">
                      <Input
                        id="delivery-fee-amount"
                        type="number"
                        min={0}
                        step="0.001"
                        inputMode="decimal"
                        value={deliveryFee}
                        onChange={e => setDeliveryFee(e.target.value)}
                        className="h-10 pr-14 text-right text-base font-semibold tabular-nums"
                        placeholder="7.000"
                        disabled={isLoading}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                        TND
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Live totals ledger — mirrors the server's authoritative recompute. */}
              <div className="space-y-2 rounded-xl border bg-muted/40 p-3.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal · {itemCount} item{itemCount === 1 ? '' : 's'}</span>
                  <span className="tabular-nums">{subtotal.toFixed(2)} TND</span>
                </div>
                {discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount</span>
                    <span className="tabular-nums">−{discountTotal.toFixed(2)} TND</span>
                  </div>
                )}
                {deliveryEnabled && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Truck className="size-3.5" /> Delivery fee</span>
                    <span className="tabular-nums">+{deliveryFeeNum.toFixed(2)} TND</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-2.5">
                  <span className="text-base font-semibold">Total</span>
                  <span className="text-lg font-bold tabular-nums text-primary">{grandTotal.toFixed(2)} TND</span>
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      </ResponsiveSheet>

      <POSCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onBarcodeDetected={handleScan}
        feedbackMessage={scanFeedback?.message}
        feedbackType={scanFeedback?.type}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* SYNC DIALOG                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: SalesChannel[];
  selectedChannel: string;
  onChannelChange: (id: string) => void;
  onPreview: () => void;
  onSyncAll: () => void;
  isPreviewing?: boolean;
  isSyncing?: boolean;
}

export function SyncDialog({
  open, onOpenChange, channels, selectedChannel, onChannelChange,
  onPreview, onSyncAll, isPreviewing, isSyncing,
}: Readonly<SyncDialogProps>) {
  const wcChannels = channels.filter(ch => ch.channel_type === 'WOOCOMMERCE');
  const sel = wcChannels.find(c => String(c.id) === selectedChannel);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Import Orders" description="Preview new WooCommerce processing orders or start a background sync">
      <div className="space-y-4">
        {wcChannels.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <Globe className="size-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm font-medium">No WooCommerce channels</p>
            <p className="text-xs text-muted-foreground">Create a WooCommerce sales channel first.</p>
          </div>
        ) : (
          <>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Store</Label>
              <Select value={selectedChannel} onValueChange={onChannelChange}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select a store..." />
                </SelectTrigger>
                <SelectContent>
                  {wcChannels.map(ch => (
                    <SelectItem key={ch.id} value={String(ch.id)}>
                      {ch.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{ch.brand_name}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sel && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="size-8 rounded-md bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Store className="size-4 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{sel.name}</p>
                  {sel.wc_store_url && <p className="text-xs text-muted-foreground truncate">{sel.wc_store_url}</p>}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button onClick={onPreview} disabled={isPreviewing || !selectedChannel} variant="outline" className="flex-1 gap-1.5 h-9">
                <Eye className={`size-3.5 ${isPreviewing ? 'animate-pulse' : ''}`} />
                {isPreviewing ? 'Loading...' : 'Preview'}
              </Button>
              <Button onClick={onSyncAll} disabled={isSyncing || !selectedChannel} className="flex-1 gap-1.5 h-9">
                <RefreshCw className={`size-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Starting...' : 'Sync Latest'}
              </Button>
            </div>
          </>
        )}
      </div>
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* PREVIEW DIALOG                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: WooCommerceOrderPreviewResponse | null;
  selectedIds: number[];
  onToggleOrder: (wcId: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSyncSelected: () => void;
  onSyncAll: () => void;
  isSyncingSelected?: boolean;
  isPreviewing?: boolean;
  onPageChange?: (page: number) => void;
}

export function PreviewDialog({
  open, onOpenChange, data, selectedIds,
  onToggleOrder, onSelectAll, onDeselectAll,
  onSyncSelected, onSyncAll, isSyncingSelected, isPreviewing, onPageChange,
}: Readonly<PreviewDialogProps>) {
  const footer = data ? (
    <div className="flex items-center gap-2 justify-between w-full">
      <div className="flex gap-2">
        <Button size="sm" onClick={onSyncSelected} disabled={isSyncingSelected || selectedIds.length === 0} className="gap-1.5 h-8 text-xs">
          {isSyncingSelected ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Sync ({selectedIds.length})
        </Button>
        <Button size="sm" onClick={onSyncAll} disabled={isSyncingSelected} variant="outline" className="gap-1.5 h-8 text-xs">
          <RefreshCw className="size-3" /> Start Background Sync
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">Close</Button>
    </div>
  ) : undefined;

  return (
    <ResponsiveSheet
      open={open} onOpenChange={onOpenChange}
      title={`Preview — ${data?.sales_channel_name ?? ''}`}
      description="Select orders to import"
      wide footer={footer}
    >
      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1"><Package className="size-3" /> {data.total_count} new shown</Badge>
            <Badge variant="outline" className="gap-1">{data.total_remote_count ?? data.total_count} processing remote</Badge>
            <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><TrendingUp className="size-3" /> {data.new_count} new on page</Badge>
            <Badge variant="secondary" className="gap-1"><Check className="size-3" /> {data.existing_count} already imported</Badge>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-muted/40 border text-xs">
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={onSelectAll} className="h-6 text-[11px] px-2">All</Button>
              <Button size="sm" variant="outline" onClick={onDeselectAll} className="h-6 text-[11px] px-2">None</Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{selectedIds.length} selected</span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPageChange?.(Math.max(1, (data.page ?? 1) - 1))}
                  disabled={isPreviewing || !data.has_previous}
                  className="h-6 px-2"
                >
                  <ChevronLeft className="size-3" />
                </Button>
                <span className="min-w-16 text-center text-[11px] text-muted-foreground">
                  {data.page ?? 1}/{Math.max(1, data.total_pages ?? 1)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPageChange?.((data.page ?? 1) + 1)}
                  disabled={isPreviewing || !data.has_next}
                  className="h-6 px-2"
                >
                  <ChevronRight className="size-3" />
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 h-8">
                    <Checkbox
                      checked={selectedIds.length === data.orders.length && data.orders.length > 0}
                      onCheckedChange={c => c ? onSelectAll() : onDeselectAll()}
                    />
                  </TableHead>
                  <TableHead className="h-8 text-xs font-medium">Order</TableHead>
                  <TableHead className="h-8 text-xs font-medium">Customer</TableHead>
                  <TableHead className="h-8 text-xs font-medium hidden sm:table-cell">Status</TableHead>
                  <TableHead className="h-8 text-xs font-medium text-right">Total</TableHead>
                  <TableHead className="h-8 text-xs font-medium w-16">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.map(o => (
                  <TableRow key={o.wc_id} className="hover:bg-muted/30 cursor-pointer" onClick={() => onToggleOrder(o.wc_id)}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.includes(o.wc_id)} onCheckedChange={() => onToggleOrder(o.wc_id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.order_number || o.wc_id}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[120px]">{o.customer_name || '—'}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[11px]">{o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{o.currency} {o.total}</TableCell>
                    <TableCell>
                      {o.exists_locally
                        ? <Badge variant="secondary" className="text-[10px] gap-0.5"><RefreshCw className="size-2.5" /> Update</Badge>
                        : <Badge className="text-[10px] gap-0.5 bg-emerald-600 hover:bg-emerald-600"><Plus className="size-2.5" /> New</Badge>
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* LOGS DIALOG — Timeline layout                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Visual tone palette for a log entry's icon chip + accents. */
type LogTone = 'green' | 'blue' | 'indigo' | 'purple' | 'amber' | 'red' | 'slate' | 'sky';

const TONE_STYLES: Record<LogTone, { chip: string; icon: string }> = {
  green:  { chip: 'bg-emerald-100 dark:bg-emerald-950/50', icon: 'text-emerald-600 dark:text-emerald-400' },
  blue:   { chip: 'bg-blue-100 dark:bg-blue-950/50',       icon: 'text-blue-600 dark:text-blue-400' },
  indigo: { chip: 'bg-indigo-100 dark:bg-indigo-950/50',   icon: 'text-indigo-600 dark:text-indigo-400' },
  purple: { chip: 'bg-purple-100 dark:bg-purple-950/50',   icon: 'text-purple-600 dark:text-purple-400' },
  amber:  { chip: 'bg-amber-100 dark:bg-amber-950/50',     icon: 'text-amber-600 dark:text-amber-400' },
  red:    { chip: 'bg-red-100 dark:bg-red-950/50',         icon: 'text-red-600 dark:text-red-400' },
  slate:  { chip: 'bg-slate-100 dark:bg-slate-800/60',     icon: 'text-slate-500 dark:text-slate-400' },
  sky:    { chip: 'bg-sky-100 dark:bg-sky-950/50',         icon: 'text-sky-600 dark:text-sky-400' },
};

/** Per-action presentation: a friendly label, an icon and a tone. */
const LOG_META: Record<string, { label: string; tone: LogTone; icon: LucideIcon }> = {
  CREATED:                    { label: 'Order created',                 tone: 'green',  icon: Plus },
  UPDATED:                    { label: 'Order updated',                 tone: 'blue',   icon: Pencil },
  SOFT_DELETED:               { label: 'Order deleted',                 tone: 'red',    icon: Trash2 },
  RESTORED:                   { label: 'Order restored',                tone: 'green',  icon: Undo2 },
  DISCOUNT_APPLIED:           { label: 'Discount applied',              tone: 'purple', icon: Percent },
  STATUS_CHANGED:             { label: 'Status changed',                tone: 'indigo', icon: RefreshCw },
  WOOCOMMERCE_STATUS_CHANGED: { label: 'WooCommerce status changed',    tone: 'sky',    icon: Globe },
  LOCAL_STATUS_CHANGED:       { label: 'Local status changed',          tone: 'indigo', icon: RefreshCw },
  CONTACT_STATUS_CHANGED:     { label: 'Contact status changed',        tone: 'blue',   icon: Phone },
  DELAY_DATE_CHANGED:         { label: 'Delay date changed',            tone: 'amber',  icon: CalendarClock },
  RETURN_EXCHANGE_CHANGED:    { label: 'Return / exchange changed',     tone: 'amber',  icon: RotateCcw },
  EDIT_LOCK_ACQUIRED:         { label: 'Edit lock acquired',            tone: 'slate',  icon: Lock },
  EDIT_LOCK_RELEASED:         { label: 'Edit lock released',            tone: 'slate',  icon: Unlock },
  EDIT_LOCK_TAKEN_OVER:       { label: 'Edit lock taken over',          tone: 'amber',  icon: Lock },
  OUTCOME_CONFIRMED:          { label: 'Order confirmed',               tone: 'green',  icon: ThumbsUp },
  OUTCOME_DELAYED:            { label: 'Order delayed',                 tone: 'amber',  icon: Clock },
  OUTCOME_CANCELLED:          { label: 'Order cancelled',               tone: 'red',    icon: Ban },
  SYNC_RECEIVED:              { label: 'Synced from WooCommerce',       tone: 'sky',    icon: RefreshCw },
  SYNC_FAILED:                { label: 'Sync failed',                   tone: 'red',    icon: AlertTriangle },
  DELIVERY_QUEUED:            { label: 'Queued for delivery',           tone: 'blue',   icon: Truck },
  DELIVERY_SUBMITTED:         { label: 'Submitted to provider',         tone: 'blue',   icon: Send },
  DELIVERY_ACCEPTED:          { label: 'Accepted by provider',          tone: 'green',  icon: CheckCircle },
  DELIVERY_FAILED:            { label: 'Delivery failed',               tone: 'red',    icon: XCircle },
  DELIVERY_DELIVERED:         { label: 'Delivered',                     tone: 'green',  icon: PackageCheck },
  DELIVERY_RETURNED:          { label: 'Returned to sender',            tone: 'amber',  icon: Undo2 },
  SENT_TO_POS:                { label: 'Sent to POS',                   tone: 'blue',   icon: Store },
  POS_VALIDATED:              { label: 'POS validated',                 tone: 'green',  icon: CheckCircle },
  RETURN_PROCESSED:           { label: 'Return processed',              tone: 'amber',  icon: RotateCcw },
  STOCK_RESTORED:             { label: 'Stock restored',                tone: 'green',  icon: Boxes },
  PACKAGED:                   { label: 'Packaged',                      tone: 'green',  icon: Package },
  PACKAGING_UPDATED:          { label: 'Packaging updated',             tone: 'blue',   icon: Package },
  PACKAGING_REVERSED:         { label: 'Packaging reversed',            tone: 'amber',  icon: Undo2 },
  RETURN_TYPE_SET:            { label: 'Return type set',               tone: 'amber',  icon: RotateCcw },
  FINAL_OUTCOME_CHANGED:      { label: 'Final outcome changed',         tone: 'indigo', icon: TrendingUp },
  DAMAGED_STOCK_RECORDED:     { label: 'Damaged stock recorded',        tone: 'red',    icon: AlertTriangle },
  REPLACEMENT_DEDUCTED:       { label: 'Replacement deducted',          tone: 'amber',  icon: Boxes },
  WORKFLOW_STATUS_CHANGED:    { label: 'Workflow status changed',       tone: 'indigo', icon: RefreshCw },
  AUTO_CANCELLED:             { label: 'Auto-cancelled (system)',       tone: 'red',    icon: Ban },
  POINTS_GRANTED:             { label: 'Loyalty points granted',        tone: 'purple', icon: Award },
  POINTS_REVERSED:            { label: 'Loyalty points reversed',       tone: 'amber',  icon: Award },
  WC_PRODUCT_LINKED:          { label: 'WooCommerce product linked',    tone: 'sky',    icon: Link2 },
  WC_PRODUCT_UNLINKED:        { label: 'WooCommerce product unlinked',  tone: 'slate',  icon: Unlink },
  ORDER_STATUS_CHANGED:       { label: 'Order status changed',          tone: 'indigo', icon: RefreshCw },
  MANUAL_STATUS_OVERRIDE:     { label: 'Manual status override',        tone: 'amber',  icon: ShieldAlert },
  WC_CANCEL_SYNCED:           { label: 'Cancellation synced to WooCommerce', tone: 'sky', icon: Globe },
  WC_SYNC_RETRIED:            { label: 'WooCommerce sync retried',      tone: 'sky',    icon: RefreshCw },
};

function logMeta(action: string, fallbackLabel?: string): { label: string; tone: LogTone; icon: LucideIcon } {
  return LOG_META[action] ?? {
    label: fallbackLabel || action.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    tone: 'slate',
    icon: History,
  };
}

/** snake_case / kebab-case key → "Title case" label. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Humanize a status-like token, but leave free text (with spaces) untouched. */
function humanizeToken(value: string): string {
  if (!value || value.includes(' ')) return value;
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Render any JSON detail value as a compact, readable string. */
function formatLogValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
    }
    return humanizeToken(value);
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => formatLogValue(v)).join(', ') : '—';
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanizeKey(k)}: ${formatLogValue(v)}`)
      .join(' · ');
  }
  return String(value);
}

/** Pairs of detail keys that represent a "before → after" transition. */
const LOG_TRANSITIONS: ReadonlyArray<{ from: string; to: string; label: string }> = [
  { from: 'old_order_status', to: 'new_order_status', label: 'Order status' },
  { from: 'old_status',       to: 'new_status',       label: 'Status' },
  { from: 'from_status',      to: 'to_status',        label: 'Status' },
  { from: 'previous_status',  to: 'new_status',       label: 'Status' },
  { from: 'old_wc_status',    to: 'new_wc_status',    label: 'WooCommerce status' },
  { from: 'old_workflow',     to: 'new_workflow',     label: 'Workflow' },
  { from: 'old_value',        to: 'new_value',        label: 'Value' },
  { from: 'old',              to: 'new',              label: 'Change' },
  { from: 'from',             to: 'to',               label: 'Change' },
  { from: 'previous',         to: 'current',          label: 'Change' },
];

/** Detail keys best shown as a free-text block rather than a one-line row. */
const LOG_TEXT_KEYS = new Set([
  'reason', 'note', 'message', 'error', 'detail', 'details', 'cancellation_reason',
  'delay_reason', 'return_reason', 'error_message', 'sync_error_message', 'comment',
]);

/** A clear WooCommerce sync-status pill for sync-related entries (or any entry whose details carry a sync_status). */
function syncPillFor(log: OrderLogEntry): { label: string; tone: LogTone; icon: LucideIcon } | null {
  switch (log.action) {
    case 'SYNC_RECEIVED':   return { label: 'Synced from WooCommerce', tone: 'green', icon: CheckCircle };
    case 'SYNC_FAILED':     return { label: 'Sync failed', tone: 'red', icon: XCircle };
    case 'WC_CANCEL_SYNCED':return { label: 'Cancellation pushed to WooCommerce', tone: 'sky', icon: Globe };
    case 'WC_SYNC_RETRIED': return { label: 'Sync retried', tone: 'sky', icon: RefreshCw };
    case 'WOOCOMMERCE_STATUS_CHANGED': return { label: 'WooCommerce updated', tone: 'sky', icon: Globe };
    default: break;
  }
  const ss = log.details?.sync_status;
  if (typeof ss === 'string' && ss) {
    const norm = ss.toLowerCase();
    if (norm.includes('fail')) return { label: 'Sync failed', tone: 'red', icon: XCircle };
    if (norm.includes('pending') || norm.includes('queue')) return { label: 'Pending sync', tone: 'amber', icon: Clock };
    if (norm.includes('sync') || norm.includes('success') || norm.includes('done') || norm.includes('complete')) {
      return { label: 'Synced', tone: 'green', icon: CheckCircle };
    }
  }
  return null;
}

function SyncPill({ pill }: Readonly<{ pill: { label: string; tone: LogTone; icon: LucideIcon } }>) {
  const t = TONE_STYLES[pill.tone];
  const Icon = pill.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.chip} ${t.icon}`}>
      <Icon className="size-3" />
      {pill.label}
    </span>
  );
}

/** Human-readable rendering of a log entry's `details` blob (never raw JSON). */
function LogDetails({ details, hideKeys }: Readonly<{ details: Record<string, unknown>; hideKeys?: Set<string> }>) {
  const present = (k: string) => k in details && details[k] !== null && details[k] !== undefined && details[k] !== '';

  const consumed = new Set<string>(hideKeys ?? []);
  const transitions: Array<{ label: string; from: unknown; to: unknown }> = [];
  for (const t of LOG_TRANSITIONS) {
    if (consumed.has(t.from) || consumed.has(t.to)) continue;
    if (present(t.from) && present(t.to)) {
      transitions.push({ label: t.label, from: details[t.from], to: details[t.to] });
      consumed.add(t.from);
      consumed.add(t.to);
    }
  }

  const rows = Object.entries(details).filter(
    ([k, v]) => !consumed.has(k) && v !== null && v !== undefined && v !== '',
  );

  if (transitions.length === 0 && rows.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border bg-muted/40 px-2.5 py-2">
      {transitions.map((t) => (
        <div key={`t-${t.label}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">{t.label}</span>
          <span className="rounded bg-background px-1.5 py-0.5 font-medium text-muted-foreground line-through decoration-muted-foreground/40">
            {formatLogValue(t.from)}
          </span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-foreground">
            {formatLogValue(t.to)}
          </span>
        </div>
      ))}
      {rows.map(([k, v]) => {
        const asText = LOG_TEXT_KEYS.has(k) || (typeof v === 'string' && v.length > 36);
        if (asText) {
          return (
            <div key={k} className="text-[11px]">
              <span className="text-muted-foreground">{humanizeKey(k)}</span>
              <p className="mt-0.5 whitespace-pre-wrap break-words rounded bg-background px-2 py-1 text-foreground">
                {formatLogValue(v)}
              </p>
            </div>
          );
        }
        return (
          <div key={k} className="flex items-start justify-between gap-3 text-[11px]">
            <span className="shrink-0 text-muted-foreground">{humanizeKey(k)}</span>
            <span className="break-words text-right font-medium text-foreground">{formatLogValue(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface LogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber?: string;
  logs: OrderLogEntry[];
  isLoading?: boolean;
}

export function LogsDialog({ open, onOpenChange, orderNumber, logs, isLoading }: Readonly<LogsDialogProps>) {
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Activity — ${orderNumber ?? ''}`}
      description="A timeline of everything that happened to this order."
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading activity…</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="space-y-2 py-12 text-center">
          <History className="mx-auto size-6 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No activity recorded yet</p>
        </div>
      ) : (
        <div className="relative pl-1">
          {/* Spine that threads through the icon chips */}
          <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border" />

          <div className="space-y-3">
            {logs.map((log) => {
              const meta = logMeta(log.action, log.action_display);
              const tone = TONE_STYLES[meta.tone];
              const Icon = meta.icon;
              const pill = syncPillFor(log);
              // Avoid showing the sync_status key twice when the pill already conveys it.
              const hideKeys = pill ? new Set(['sync_status']) : undefined;
              return (
                <div key={log.id} className="relative flex gap-3">
                  <div className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${tone.chip}`}>
                    <Icon className={`size-3.5 ${tone.icon}`} />
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold leading-tight">{meta.label}</span>
                      {pill && <SyncPill pill={pill} />}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatLogTime(log.created_at)}
                      {' · '}
                      <span className="font-medium text-foreground">{log.user_name || 'System'}</span>
                    </p>
                    <LogDetails details={log.details} hideKeys={hideKeys} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* MESSAGE ALERT                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface MessageAlertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  type: 'success' | 'error';
}

export function MessageAlert({ open, onOpenChange, message, type }: Readonly<MessageAlertProps>) {
  const ok = type === 'success';
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xs">
        <AlertDialogHeader className="text-center">
          <div className={`size-10 rounded-full mx-auto mb-2 flex items-center justify-center ${ok ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {ok ? <CheckCircle className="size-5 text-emerald-600" /> : <XCircle className="size-5 text-red-600" />}
          </div>
          <AlertDialogTitle className="text-sm font-semibold">{ok ? 'Success' : 'Error'}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm">{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="justify-center sm:justify-center">
          <AlertDialogAction onClick={() => onOpenChange(false)} className="min-w-[80px] h-8 text-sm">OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
