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
  Package, AlertCircle, TrendingUp, Search, ChevronDown,
  CreditCard, Calendar, User, MapPin, Percent, MessageSquare,
  Phone, MessageCircleMore, CalendarClock, Ban, ThumbsUp, Clock,
  ChevronLeft, ChevronRight, Truck, ShieldAlert, ScanLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { getMediaUrl } from '@/utils/helpers';
import { productService } from '@/services/product.service';
import { useAuthStore } from '@/store/authStore';
import { POSCameraScanner } from '../pos/POSCameraScanner';
import { OrderClientSelector } from './OrderClientSelector';
import { CleanStatusBadge, SyncStatusBadge } from './orderStatusBadges';
import type {
  OrderDetail, OrderLine, OrderEditRequest, OrderLogEntry, OrderDiscountType,
  ProductListItem, SalesChannel, OrderStatus, OrderStockCheck,
  POSOrderCreateRequest, Client,
} from '@/types';
import type { OrderStatusFieldsPayload, WooCommerceOrderPreviewResponse } from '@/services/order.service';

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

          {/* Footer */}
          {footer && (
            <div className="border-t px-4 py-3 bg-background/95 backdrop-blur">
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

const STATUS_MAP: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  PENDING:    { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Pending' },
  PROCESSING: { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Processing' },
  ON_HOLD:    { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500',  label: 'On Hold' },
  COMPLETED:  { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Completed' },
  CANCELLED:  { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Cancelled' },
  REFUNDED:   { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500',  label: 'Refunded' },
  FAILED:     { bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400',    label: 'Failed' },
};

const OUTCOME_MAP: Record<string, { bg: string; text: string; icon: typeof CheckCircle; label: string }> = {
  NONE:      { bg: 'bg-gray-50',    text: 'text-gray-500',    icon: Clock,         label: 'Awaiting' },
  CONFIRMED: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: ThumbsUp,      label: 'Confirmed' },
  DELAYED:   { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: CalendarClock, label: 'Delayed' },
  CANCELLED: { bg: 'bg-red-50',     text: 'text-red-700',     icon: Ban,           label: 'Cancelled' },
};

function OutcomePill({ outcome }: { outcome: string }) {
  const o = OUTCOME_MAP[outcome] ?? OUTCOME_MAP.NONE!;
  const Icon = o.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${o.bg} ${o.text}`}>
      <Icon className="size-3" />
      {o.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.FAILED!;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

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

function StockAvailabilityPanel({ stock }: { stock?: OrderStockCheck }) {
  if (!stock) return null;

  const websiteOk = stock.can_fulfill_from_website;
  const posOk = stock.can_fulfill_from_pos;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stock availability
          </h4>
          <p className="mt-1 text-sm font-medium">
            {stock.has_warnings ? 'Stock warnings found' : 'All linked products have enough stock'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={websiteOk ? 'default' : 'destructive'} className="text-[10px]">
            Website {websiteOk ? 'OK' : 'Warning'}
          </Badge>
          {posOk !== null && (
            <Badge variant={posOk ? 'default' : 'destructive'} className="text-[10px]">
              POS {posOk ? 'OK' : 'Warning'}
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-xs">Product</TableHead>
              <TableHead className="h-8 text-xs text-center w-14">Req</TableHead>
              <TableHead className="h-8 text-xs text-center w-24">Website</TableHead>
              {stock.pos_channel && <TableHead className="h-8 text-xs text-center w-24">POS</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stock.items.map(item => (
              <TableRow key={item.product_id} className={item.has_warning ? 'bg-amber-50/50' : ''}>
                <TableCell className="py-2">
                  <div className="min-w-0">
                    {/* Long product names wrap instead of truncating. */}
                    <p className="text-xs font-medium whitespace-normal break-words leading-snug">{item.product_name}</p>
                    {item.issues.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-amber-700">
                        {item.issues.join(' ')}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center text-xs tabular-nums">{item.required_quantity}</TableCell>
                <TableCell className="text-center text-xs tabular-nums">
                  {item.website_available_quantity}
                </TableCell>
                {stock.pos_channel && (
                  <TableCell className="text-center text-xs tabular-nums">
                    {item.pos_available_quantity ?? 0}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {stock.unlinked_lines.map(line => (
              <TableRow key={`unlinked-${line.line_id}`} className="bg-red-50/60">
                <TableCell className="py-2 text-xs">
                  <p className="font-medium">{line.product_name}</p>
                  <p className="text-[11px] text-red-700">{line.issue}</p>
                </TableCell>
                <TableCell className="text-center text-xs">{line.required_quantity}</TableCell>
                <TableCell className="text-center text-xs">-</TableCell>
                {stock.pos_channel && <TableCell className="text-center text-xs">-</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Website stock: {stock.website_channel?.name ?? 'Not configured'}
        {stock.pos_channel ? ` · POS stock: ${stock.pos_channel.name}` : ''}
      </p>
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
  confirm: boolean;
  delay: boolean;
  cancel: boolean;
  sendToPos: boolean;
  sendToDelivery: boolean;
  processReturn: boolean;
  packageOrder: boolean;
  delete: boolean;
  restore: boolean;
}

function OrderViewMode({
  order,
  onStatusChange,
  onStatusFieldsChange,
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
  permissions,
  packagingProducts,
  loadingPackagingProducts,
}: Readonly<{
  order: OrderDetail;
  onStatusChange: (id: number, status: OrderStatus) => void;
  onStatusFieldsChange: (id: number, payload: OrderStatusFieldsPayload) => void;
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
  permissions?: OrderDialogPermissions;
  packagingProducts: ProductListItem[];
  loadingPackagingProducts?: boolean;
}>) {
  const directPOSCompleted =
    order.source === 'POS' && order.status === 'COMPLETED' && !order.in_store_pickup;
  const totalsRows = useMemo(() => [
    { label: 'Subtotal', value: order.subtotal },
    { label: 'Tax', value: order.tax_total },
    { label: 'Shipping', value: order.shipping_total },
    ...(parseFloat(order.discount_total) > 0 ? [{ label: 'Discount', value: `-${order.discount_total}` }] : []),
  ], [order]);
  const customerLines = order.customer_lines ?? order.lines.filter(line => line.product_type !== 'packaging_item');
  const packagingLines = order.packaging_lines ?? order.lines.filter(line => line.product_type === 'packaging_item');
  // Multi-select packaging: product_id → quantity. Lets the user tick (or scan)
  // several packaging products and Save them all in one shot.
  const [packagingSelection, setPackagingSelection] = useState<Record<number, number>>({});
  const [packagingSearch, setPackagingSearch] = useState('');
  const [packagingScannerOpen, setPackagingScannerOpen] = useState(false);
  const [packagingScanFeedback, setPackagingScanFeedback] =
    useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notAnsweredAttempts = order.not_answered_attempts ?? 0;
  const canEscalateNoAnswer = notAnsweredAttempts > 3 || order.outcome === 'DELAYED';
  const isDelayed = order.outcome === 'DELAYED' || order.contact_status === 'DELAYED';
  const canProcessAfterDone = order.final_outcome === 'SUCCESSFUL_SALE' || order.workflow_status === 'done';

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
        // Deselect every currently-filtered product.
        for (const p of filteredPackagingProducts) delete next[p.id];
      } else {
        // Select every currently-filtered product (keep existing quantities).
        for (const p of filteredPackagingProducts) {
          if (next[p.id] === undefined) next[p.id] = 1;
        }
      }
      return next;
    });
  }, [filteredPackagingProducts]);

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
    setPackagingSelection(prev => ({ ...prev, [match.id]: (prev[match.id] ?? 0) + 1 }));
    setPackagingScanFeedback({ message: `Added ${match.name}`, type: 'success' });
  }, [packagingProducts]);

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
    onPackageOrder(items, packagingLines.length > 0 || order.packaging_status !== 'NOT_PACKAGED');
    setPackagingSelection({});
    setPackagingSearch('');
    setPackagingScanFeedback(null);
  }, [
    onPackageOrder,
    order.packaging_status,
    packagingLines,
    packagingSelection,
    selectedPackagingCount,
  ]);

  return (
    <div className="space-y-6">
      {/* Main layout: 2-col on large */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Left column */}
        <Tabs defaultValue="details" className="gap-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="details" className="text-xs gap-1.5">
              <User className="size-3.5" /> Details
            </TabsTrigger>
            <TabsTrigger value="items" className="text-xs gap-1.5">
              <Package className="size-3.5" /> Customer ({customerLines.length})
            </TabsTrigger>
            <TabsTrigger value="packaging" className="text-xs gap-1.5">
              <Package className="size-3.5" /> Packaging ({packagingLines.length})
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

              {/* Client Card */}
              <div className={`rounded-lg border p-4 flex items-start gap-3 ${order.client_is_blocked ? 'border-red-200 bg-red-50' : 'bg-gradient-to-br from-indigo-50/30 to-transparent'}`}>
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
              </div>

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
                    <StatusPill status={order.status} />
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
                    <p className="text-[11px] text-muted-foreground">Contact Status</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.contact_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Delivery Status</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.delivery_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Return / Exchange</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.return_exchange_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Packaging Status</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.packaging_status.replace('_', ' ')}</Badge>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Final Outcome</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{order.final_outcome.replace(/_/g, ' ')}</Badge>
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

              <StockAvailabilityPanel stock={order.stock_check} />
            </div>
          </TabsContent>

          {/* Tab: Line Items */}
          <TabsContent value="items">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 text-xs font-medium">Product</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-center w-14">Qty</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-right w-20 hidden sm:table-cell">Unit</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-right w-24">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerLines.map(line => (
                    <TableRow key={line.id} className="hover:bg-muted/30">
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ProductImage src={line.product_image} alt={line.product_name} size="md" />
                          <div className="min-w-0">
                            <p className="max-w-[36rem] whitespace-normal break-words text-sm font-medium leading-snug">{line.product_name}</p>
                            {line.barcode && <p className="text-[11px] text-muted-foreground font-mono">{line.barcode}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">{line.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground hidden sm:table-cell">{order.currency} {line.unit_price}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-semibold">{order.currency} {line.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Tab: Packaging */}
          <TabsContent value="packaging">
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packaging step</p>
                    <p className="mt-1 text-sm font-medium">{order.packaging_status.replace('_', ' ')}</p>
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
                  <Badge variant={order.packaging_status === 'NOT_PACKAGED' ? 'outline' : 'default'} className="w-fit">
                    {order.packaging_status === 'NOT_PACKAGED' ? 'Waiting packaging' : 'Packaged'}
                  </Badge>
                </div>
              </div>

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

              {permissions?.packageOrder && !order.is_deleted && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add packaging items</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Tick the packaging/store products (box, card, bag, sticker, sample) — or scan their
                        barcodes — then Save once.
                      </p>
                    </div>
                    {selectedPackagingCount > 0 && (
                      <Badge variant="secondary" className="w-fit">{selectedPackagingCount} selected</Badge>
                    )}
                  </div>

                  {/* Search + barcode scan */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        value={packagingSearch}
                        onChange={event => setPackagingSearch(event.target.value)}
                        placeholder="Search packaging products or barcode..."
                        className="h-9 pl-8"
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
                      Scan
                    </Button>
                  </div>

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
                              <p className="text-[11px] text-muted-foreground">{product.barcode || '—'} · {product.sales_price} TND</p>
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

          {/* Outcome badge */}
          <div className="rounded-lg border p-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outcome</h4>
            <OutcomePill outcome={order.outcome} />
            {order.outcome === 'DELAYED' && order.delay_date && (
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
            {order.outcome === 'CANCELLED' && order.cancellation_reason && (
              <p className="text-xs text-muted-foreground mt-2">
                <span className="font-medium">Reason:</span> {order.cancellation_reason}
              </p>
            )}
            {order.outcome_note && (
              <p className="text-xs text-muted-foreground italic mt-1">{order.outcome_note}</p>
            )}
            {order.contact_status === 'NOT_ANSWERED' && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <p className="font-medium">Unanswered attempts: {notAnsweredAttempts}</p>
                {notAnsweredAttempts <= 3 ? (
                  <p className="mt-0.5 text-rose-700">Delay is available anytime. Cancel becomes safer after more than 3 attempts.</p>
                ) : (
                  <p className="mt-0.5 text-rose-700">More than 3 attempts. You can now delay or cancel this order.</p>
                )}
              </div>
            )}
          </div>

          {(order.delivery_reference || order.delivery_code || order.delivery_status !== 'NONE') && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery</h4>
              <Badge variant="outline" className="text-[10px]">{order.delivery_status}</Badge>
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
          {order.status !== 'CANCELLED' && order.outcome !== 'CANCELLED' && !order.is_deleted && !directPOSCompleted && (
            <div className="space-y-2">
              {order.outcome !== 'CONFIRMED' && permissions?.confirm && (
                <Button
                  size="sm"
                  className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={onConfirm}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />}
                  Confirm Order
                </Button>
              )}
              {order.outcome !== 'CONFIRMED' && order.contact_status !== 'DELAYED' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50"
                  onClick={onNotAnswered}
                  disabled={isLoading}
                >
                  <Phone className="size-3.5" />
                  No Answer {notAnsweredAttempts ? `(${notAnsweredAttempts})` : ''}
                </Button>
              )}
              {isDelayed && permissions?.delay && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={onRestoreDelayed}
                  disabled={isLoading}
                >
                  <Undo2 className="size-3.5" /> Restore to Pending
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
              {permissions?.cancel && (canEscalateNoAnswer || order.contact_status !== 'NOT_ANSWERED') && (
                <Button
                  size="sm" variant="outline"
                  className="w-full gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={onOpenCancel}
                  disabled={isLoading}
                >
                  <Ban className="size-3.5" /> Cancel Order
                </Button>
              )}
            </div>
          )}

          {order.outcome === 'CONFIRMED' && order.status !== 'CANCELLED' && !order.is_deleted && !directPOSCompleted && (
            <div className="space-y-2">
              <Separator />
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fulfillment</h4>
              {permissions?.sendToDelivery && !order.sent_to_pos_at && !order.delivery_reference && (
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={onSendDelivery}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
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
              {permissions?.processReturn && !order.returned_at && (canProcessAfterDone || order.delivery_status === 'DELIVERED' || !!order.pos_validated_at) && (
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

          {permissions?.edit && !order.is_deleted && (
            <div className="space-y-3">
              <Separator />
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Status Edit</h4>
              <div className="space-y-2">
                <Label className="text-[11px] text-muted-foreground">Local Order Status</Label>
                <Select
                  value={order.status}
                  onValueChange={value => onStatusChange(order.id, value as OrderStatus)}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['PENDING', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'].map(status => (
                      <SelectItem key={status} value={status}>{status.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] text-muted-foreground">Contact Status</Label>
                <Select
                  value={order.contact_status}
                  onValueChange={value => {
                    if (value === 'DELAYED') onOpenDelay();
                    else if (value === 'NOT_ANSWERED') onNotAnswered();
                    else onStatusFieldsChange(order.id, { contact_status: value as OrderStatusFieldsPayload['contact_status'] });
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['NONE', 'ANSWERED', 'NOT_ANSWERED', 'DELAYED'].map(status => (
                      <SelectItem key={status} value={status}>{status.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] text-muted-foreground">Return / Exchange</Label>
                <Select
                  value={order.return_exchange_status}
                  onValueChange={value => onStatusFieldsChange(order.id, { return_exchange_status: value as OrderStatusFieldsPayload['return_exchange_status'] })}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['NONE', 'RETURNED', 'EXCHANGED'].map(status => (
                      <SelectItem key={status} value={status}>{status.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

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
  isSaving?: boolean;
}

function OrderEditMode({
  editForm, editProducts, loadingEditProducts, currency,
  onUpdateLine, onUpdateLineProduct,
  onAddLine, onRemoveLine, onSaveEdit, onCancel,
  onChangeDiscount, onChangeNote, isSaving,
}: Readonly<OrderEditModeProps>) {
  const liveSubtotal = useMemo(() =>
    editForm.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
  [editForm.lines]);

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
                        className="size-8 mt-6 text-gray-300 hover:text-red-600 hover:bg-red-50 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150 rounded-lg flex items-center justify-center"
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
                          min={1}
                          value={line.quantity}
                          onChange={e => onUpdateLine(i, 'quantity', e.target.value)}
                          className="h-9 text-sm text-center border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Price</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unit_price}
                          onChange={e => onUpdateLine(i, 'unit_price', e.target.value)}
                          className="h-9 text-sm text-right border-gray-200 focus-visible:border-gray-400 focus-visible:ring-1 focus-visible:ring-gray-200 rounded-lg transition-colors"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-gray-700 mb-1.5 block">Total</Label>
                        <div className="h-9 flex items-center justify-end text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-2.5 tabular-nums">
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
  onStatusChange: (id: number, status: OrderStatus) => void;
  onStatusFieldsChange: (id: number, payload: OrderStatusFieldsPayload) => void;
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
  onOpenLogs: () => void;
  onDelete: () => void;
  onRestore: () => void;
  permissions?: OrderDialogPermissions;
}

export function OrderDetailDialog({
  open, onOpenChange, order, isDetailLoading,
  isEditMode, editForm, editProducts, loadingEditProducts,
  packagingProducts, loadingPackagingProducts,
  savingEdit, mutatingOrder,
  onStatusChange, onStatusFieldsChange, onConfirmOrder, onNotAnswered, onDelayOrder, onRestoreDelayed, onCancelOrder,
  onOpenSendPOS, onSendDelivery, onProcessReturn, onPackageOrder, onUnpackageOrder,
  onEditModeChange,
  onUpdateLine, onUpdateLineProduct,
  onAddLine, onRemoveLine, onSaveEdit,
  onChangeDiscount, onChangeNote,
  onOpenLogs, onDelete, onRestore,
  permissions,
}: Readonly<OrderDetailDialogProps>) {
  const [delayDialogOpen, setDelayDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

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
      {order.is_deleted && permissions?.restore ? (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={onRestore} disabled={mutatingOrder}>
          {mutatingOrder ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />} Restore
        </Button>
      ) : !order.is_deleted && permissions?.delete ? (
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete} disabled={mutatingOrder}>
          {mutatingOrder ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} Delete
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
            <CleanStatusBadge status={order.order_status} label={order.order_status_display} />
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
              onStatusFieldsChange={onStatusFieldsChange}
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
              permissions={permissions}
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
  const sameBrandPOS = useMemo(
    () => channels.filter(ch =>
      ch.channel_type === 'POS' &&
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

        {sameBrandPOS.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>No active same-brand POS location is available for this order.</span>
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
                {sameBrandPOS.map(ch => (
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
    lineConditions: Array<{ line_id: number; condition: BackendCondition }>;
  }) => void;
  isLoading?: boolean;
}

/** One item row inside the return popup — image, name/qty, and the disposition picker. */
function ReturnItemRow({
  line, value, onChange, disabled,
}: Readonly<{
  line: OrderLine;
  value: ReturnDisposition | undefined;
  onChange: (value: ReturnDisposition) => void;
  disabled?: boolean;
}>) {
  const restocks = value ? DISPOSITION_RESTOCKS[value] : null;
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProductImage src={line.product_image} alt={line.product_name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium whitespace-normal break-words leading-snug">{line.product_name}</p>
          <p className="text-[11px] text-muted-foreground">
            Qty {line.quantity}{line.barcode ? ` · ${line.barcode}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:flex-shrink-0">
        <Select
          value={value ?? ''}
          onValueChange={v => onChange(v as ReturnDisposition)}
          disabled={disabled}
        >
          <SelectTrigger
            className={`h-9 w-full text-xs sm:w-[210px] ${value ? '' : 'border-amber-400 text-amber-700 dark:text-amber-400'}`}
          >
            <SelectValue placeholder="Select condition…" />
          </SelectTrigger>
          <SelectContent>
            {DISPOSITION_OPTIONS.map(opt => (
              <SelectItem key={opt} value={opt}>
                <span className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${DISPOSITION_RESTOCKS[opt] ? 'bg-emerald-500' : 'bg-rose-500'}`}
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
    </div>
  );
}

/**
 * Return processing popup. Shows the full order context, then forces the operator
 * to classify EVERY item (customer products AND packaging) before saving. Each
 * item's four-way condition decides whether it returns to available stock or is
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
  const [dispositions, setDispositions] = useState<Record<number, ReturnDisposition>>({});

  // (Re)initialise whenever a different order is opened. Intentionally leave every
  // item UNSET so the operator must consciously classify each one before saving.
  useEffect(() => {
    if (!open || !order) return;
    setDispositions({});
    setReason('');
  }, [open, order]);

  const setLineDisposition = useCallback((lineId: number, value: ReturnDisposition) => {
    setDispositions(prev => ({ ...prev, [lineId]: value }));
  }, []);

  const pendingCount = allLines.filter(l => !dispositions[l.id]).length;
  const restockCount = allLines.filter(l => {
    const d = dispositions[l.id];
    return d ? DISPOSITION_RESTOCKS[d] : false;
  }).length;
  const wasteCount = allLines.filter(l => {
    const d = dispositions[l.id];
    return d ? !DISPOSITION_RESTOCKS[d] : false;
  }).length;
  const allClassified = allLines.length > 0 && pendingCount === 0;

  const channelName = order
    ? (order.pos_validated_at && order.pos_sales_channel_name ? order.pos_sales_channel_name : order.sales_channel_name)
    : '';

  const handleSubmit = useCallback(() => {
    if (!order) return;
    // Resolve every line's disposition up front; bail if any is still unset so we
    // never submit a partially-classified return.
    const classified: Array<{ line: OrderLine; disposition: ReturnDisposition }> = [];
    for (const line of allLines) {
      const disposition = dispositions[line.id];
      if (!disposition) return;
      classified.push({ line, disposition });
    }
    if (classified.length === 0) return;

    const lineConditions = classified.map(({ line, disposition }) => ({
      line_id: line.id,
      condition: DISPOSITION_TO_BACKEND[disposition],
    }));
    // Preserve the precise four-way per-item choice in the audit trail — the
    // backend enum only distinguishes GOOD/DAMAGED, so the human-readable detail
    // lives in the reason recorded on the OrderLog.
    const breakdown = classified
      .map(({ line, disposition }) => `${line.product_name} ×${line.quantity}: ${DISPOSITION_LABEL[disposition]}`)
      .join('; ');
    const typed = reason.trim();
    const returnReason = typed ? `${typed} | Item conditions — ${breakdown}` : `Item conditions — ${breakdown}`;
    onSubmit({ returnReason, returnType: 'RETURNED', lineConditions });
  }, [order, allLines, dispositions, reason, onSubmit]);

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
                <CleanStatusBadge status={order.order_status} label={order.order_status_display} />
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {order.total} {order.currency}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <User className="size-3.5 shrink-0" />
                <span className="truncate text-foreground">{order.client_name || 'Walk-in customer'}</span>
              </span>
              {order.client_phone && (
                <span className="flex items-center gap-1.5 min-w-0">
                  <Phone className="size-3.5 shrink-0" />
                  <span className="truncate">{order.client_phone}</span>
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
                      value={dispositions[line.id]}
                      onChange={v => setLineDisposition(line.id, v)}
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
                      value={dispositions[line.id]}
                      onChange={v => setLineDisposition(line.id, v)}
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
  const [customerNote, setCustomerNote] = useState('');

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
    setDiscountType('NONE'); setDiscountValue(''); setCustomerNote('');
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

  // Load the brand's products whenever the channel (hence brand) changes; a new
  // brand means a different catalogue, so any half-built cart is cleared.
  useEffect(() => {
    if (!open || !brandId) { setProducts([]); return; }
    let cancelled = false;
    setLoadingProducts(true);
    setLines([]);
    // A brand change may also mean a different company; drop any picked client
    // so we never submit a cross-tenant customer (the backend rejects it too).
    setClient(null);
    productService.getAllProducts({ brand: brandId, page_size: 500 })
      .then(items => { if (!cancelled) setProducts((items || []).filter(p => p.product_type !== 'packaging_item')); })
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
    setLines(prev => prev.map(l => (l.product.id === productId ? { ...l, price } : l)));
  }, []);
  const removeLine = useCallback((productId: number) => {
    setLines(prev => prev.filter(l => l.product.id !== productId));
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * (parseFloat(l.price) || 0), 0),
    [lines],
  );

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
  const grandTotal = Math.max(0, subtotal - discountTotal);

  const canSubmit = !!channelId && lines.length > 0 && !discountInvalid && !isLoading;

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
      discount_type: discountType,
      discount_value:
        discountType === 'NONE' ? '0.00' : (parseFloat(discountValue) || 0).toFixed(2),
    };
    onSubmit(payload);
  }, [
    channelId, lines, client, paymentMethod, customerNote,
    orderStatus, discountType, discountValue, discountInvalid, onSubmit,
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
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-sm font-medium">Total: {grandTotal.toFixed(2)} TND</span>
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
        }
      >
        <div className="space-y-4">
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

          {lines.length > 0 && (
            <div className="divide-y rounded-lg border">
              {lines.map(l => (
                <div key={l.product.id} className="flex items-center gap-3 p-3">
                  <ProductImage src={l.product.image_url} alt={l.product.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium whitespace-normal break-words leading-snug">{l.product.name}</p>
                    <p className="text-[11px] text-muted-foreground">{l.product.barcode || '—'}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={e => updateQty(l.product.id, parseInt(e.target.value, 10))}
                      className="h-8 w-16 text-xs"
                      aria-label="Quantity"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.price}
                      onChange={e => updatePrice(l.product.id, e.target.value)}
                      className="h-8 w-24 text-xs"
                      aria-label="Unit price"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-600"
                      onClick={() => removeLine(l.product.id)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium">Customer (optional)</Label>
            <OrderClientSelector
              value={client}
              onChange={setClient}
              salesChannelId={selectedChannel?.id ?? null}
              brandId={brandId ?? null}
              disabled={isLoading}
            />
          </div>

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
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
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
              <div className="space-y-1 border-t pt-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{subtotal.toFixed(2)} TND</span>
                </div>
                {discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount</span>
                    <span>−{discountTotal.toFixed(2)} TND</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{grandTotal.toFixed(2)} TND</span>
                </div>
              </div>
            </div>
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

const LOG_COLORS: Record<string, string> = {
  CREATED: 'bg-green-500',
  UPDATED: 'bg-blue-500',
  STATUS_CHANGED: 'bg-indigo-500',
  DISCOUNT_APPLIED: 'bg-purple-500',
  SOFT_DELETED: 'bg-red-500',
  RESTORED: 'bg-emerald-500',
};

interface LogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber?: string;
  logs: OrderLogEntry[];
  isLoading?: boolean;
}

export function LogsDialog({ open, onOpenChange, orderNumber, logs, isLoading }: Readonly<LogsDialogProps>) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={`Logs — ${orderNumber ?? ''}`} description="Audit trail">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Loading logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <History className="size-6 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">No audit logs found</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

          <div className="space-y-0">
            {logs.map((log) => {
              const dotColor = LOG_COLORS[log.action] ?? 'bg-gray-400';
              return (
                <div key={log.id} className="relative pl-7 pb-5 last:pb-0">
                  {/* Dot */}
                  <div className={`absolute left-0 top-1.5 size-[15px] rounded-full border-2 border-background ${dotColor}`} />

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{log.action.replace(/_/g, ' ')}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {new Date(log.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      by <span className="font-medium text-foreground">{log.user_name || 'System'}</span>
                    </p>
                    {Object.keys(log.details).length > 0 && (
                      <pre className="text-[11px] font-mono bg-muted rounded-md p-2 mt-1.5 max-h-20 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
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
