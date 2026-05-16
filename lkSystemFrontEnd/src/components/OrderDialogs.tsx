/**
 * OrderDialogs – Professional, responsive dialog components for Orders page.
 *
 * Architecture:
 *   - ResponsiveSheet: Dialog on desktop, Drawer on mobile
 *   - Product images displayed in line items (view + edit)
 *   - WCAG-accessible with keyboard navigation
 *   - Clean separation: snapshot, lines, totals, edit, sync, preview, logs
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  CheckCircle, XCircle, RefreshCw, Eye, History, Undo2,
  Trash2, Plus, Loader2, Pencil, Store, Globe, Check,
  Package, AlertCircle, TrendingUp, Search, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { getMediaUrl } from '@/utils/helpers';
import { BillingSection } from './BillingSection';
import type {
  OrderDetail, OrderEditRequest, OrderLogEntry, OrderDiscountType,
  ProductListItem, SalesChannel, OrderStatus,
} from '@/types';
import type { WooCommerceOrderPreviewResponse } from '@/services/order.service';

/* ═══════════════════════════════════════════════════════════════════════════ */
/* RESPONSIVE SHEET – Dialog on desktop, Drawer on mobile                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ResponsiveSheet({
  open, onOpenChange, title, description, children, className = '',
  wide = false,
}: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}>) {
  const mobile = useIsMobile();

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[94dvh] flex flex-col">
          <DrawerHeader className="text-left px-4 pt-4 pb-2 flex-shrink-0">
            <DrawerTitle className="text-lg font-bold">{title}</DrawerTitle>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${wide ? 'max-w-5xl w-[96vw]' : 'max-w-2xl'} max-h-[88vh] flex flex-col p-0 gap-0 ${className}`}>
        <div className="sticky top-0 z-10 border-b bg-muted/30 px-6 py-4 flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
            {description && <DialogDescription className="text-sm mt-1">{description}</DialogDescription>}
          </DialogHeader>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* HELPERS                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_MAP: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:    { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending' },
  PROCESSING: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
  ON_HOLD:    { bg: 'bg-orange-100', text: 'text-orange-800', label: 'On Hold' },
  COMPLETED:  { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Completed' },
  CANCELLED:  { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' },
  REFUNDED:   { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Refunded' },
  FAILED:     { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Failed' },
};

function StatusBadgeInline({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  return <Badge variant="outline" className={`text-xs ${s.bg} ${s.text} border-transparent`}>{s.label}</Badge>;
}

const SOURCE_MAP: Record<string, { bg: string; text: string }> = {
  WOOCOMMERCE: { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  POS:         { bg: 'bg-teal-100', text: 'text-teal-800' },
  MANUAL:      { bg: 'bg-slate-100', text: 'text-slate-700' },
};

function SourceBadgeInline({ source }: { source: string }) {
  const s = SOURCE_MAP[source] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
  return <Badge variant="outline" className={`text-xs ${s.bg} ${s.text} border-transparent`}>{source}</Badge>;
}

function ProductImage({ src, alt, size = 'sm' }: { src?: string | null; alt: string; size?: 'sm' | 'md' }) {
  const [err, setErr] = useState(false);
  const url = getMediaUrl(src);
  const dim = size === 'md' ? 'size-10' : 'size-8';

  if (!url || err) {
    return (
      <div className={`${dim} rounded-md bg-muted flex items-center justify-center border flex-shrink-0`}>
        <Package className="size-3.5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={`${dim} rounded-md border object-cover flex-shrink-0`}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}

/* fmtCurrency available but used inline via template literals */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* PRODUCT SEARCH DROPDOWN (for edit mode)                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ProductSearchSelect({
  products, value, onChange, loading,
}: Readonly<{
  products: ProductListItem[];
  value: number | null | undefined;
  onChange: (productId: string) => void;
  loading?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 50);
    const q = query.toLowerCase();
    return products.filter(
      p => p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [products, query]);

  const selected = products.find(p => p.id === value);

  const handleSelect = useCallback((productId: string) => {
    onChange(productId);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  // Close on outside click
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex items-center gap-2 w-full h-9 px-3 border rounded-md text-sm bg-background hover:bg-accent/50 transition-colors text-left"
      >
        {selected ? (
          <>
            <ProductImage src={selected.image_url} alt={selected.name} />
            <span className="truncate flex-1">{selected.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground flex-1">Select product...</span>
        )}
        <ChevronDown className="size-3.5 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-64 flex flex-col">
          <div className="p-2 border-b flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name or barcode..."
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Manual line option */}
            <button
              type="button"
              onClick={() => handleSelect('__manual__')}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/50 transition-colors text-left border-b"
            >
              <Plus className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Manual line item</span>
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground ml-2">Loading...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">No products found</div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(String(p.id))}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-accent/50 transition-colors text-left ${
                    value === p.id ? 'bg-accent/30' : ''
                  }`}
                >
                  <ProductImage src={p.image_url} alt={p.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.barcode || '—'} · {p.sales_price} TND
                    </p>
                  </div>
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
/* ORDER SNAPSHOT                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function OrderSnapshot({ order }: Readonly<{ order: OrderDetail }>) {
  const fields = useMemo(() => [
    { label: 'Channel', value: order.sales_channel_name },
    { label: 'Client', value: order.client_name ?? order.client_email ?? '—' },
    { label: 'Source', value: <SourceBadgeInline source={order.source} /> },
    { label: 'Status', value: <StatusBadgeInline status={order.status} /> },
    { label: 'Payment', value: `${order.payment_method || '—'} (${order.payment_status})` },
    {
      label: 'Created',
      value: new Date(order.created_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      }),
    },
  ], [order]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Order Snapshot</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {fields.map(f => (
            <div key={f.label} className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{f.label}</span>
              <div className="font-medium">{f.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* LINE ITEMS TABLE (view mode — with product images)                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

function LineItemsTable({ lines, currency }: Readonly<{ lines: OrderDetail['lines']; currency: string }>) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">
          Line Items ({lines.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="h-9 text-xs">Product</TableHead>
                <TableHead className="h-9 text-xs text-right w-16">Qty</TableHead>
                <TableHead className="h-9 text-xs text-right w-24">Unit Price</TableHead>
                <TableHead className="h-9 text-xs text-right w-24">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(line => (
                <TableRow key={line.id} className="hover:bg-muted/20">
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ProductImage src={line.product_image} alt={line.product_name} size="md" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate max-w-[200px] sm:max-w-none">{line.product_name}</p>
                        {line.barcode && (
                          <p className="text-xs text-muted-foreground font-mono">{line.barcode}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{currency} {line.unit_price}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{currency} {line.total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ORDER TOTALS + STATUS ACTIONS                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

function OrderTotals({
  order, onStatusChange, isLoading,
}: Readonly<{
  order: OrderDetail;
  onStatusChange: (id: number, status: OrderStatus) => void;
  isLoading?: boolean;
}>) {
  const rows = useMemo(() => [
    { label: 'Subtotal', value: order.subtotal },
    { label: 'Tax', value: order.tax_total },
    { label: 'Shipping', value: order.shipping_total },
    { label: 'Discount', value: `-${order.discount_total}` },
  ], [order]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="tabular-nums">{order.currency} {r.value}</span>
          </div>
        ))}
        <Separator />
        <div className="flex justify-between items-center">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-bold text-emerald-600">{order.currency} {order.total}</span>
        </div>

        <div className="pt-3 space-y-2">
          {order.status !== 'COMPLETED' && (
            <Button
              size="sm"
              className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2"
              onClick={() => onStatusChange(order.id, 'COMPLETED')}
              disabled={isLoading}
            >
              <CheckCircle className="size-4" /> Mark Completed
            </Button>
          )}
          {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
            <Button
              size="sm"
              variant="destructive"
              className="w-full gap-2"
              onClick={() => onStatusChange(order.id, 'CANCELLED')}
              disabled={isLoading}
            >
              <XCircle className="size-4" /> Cancel Order
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* EDIT MODE (with product images + search)                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface OrderEditModeProps {
  editForm: OrderEditRequest;
  editProducts: ProductListItem[];
  loadingEditProducts: boolean;
  currency: string;
  onUpdateLine: (index: number, key: 'quantity' | 'unit_price', value: string) => void;
  onUpdateLineField: (index: number, key: 'product_name' | 'barcode', value: string) => void;
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
  onUpdateLine, onUpdateLineField, onUpdateLineProduct,
  onAddLine, onRemoveLine, onSaveEdit, onCancel,
  onChangeDiscount, onChangeNote, isSaving,
}: Readonly<OrderEditModeProps>) {
  // Calculate live subtotal
  const liveSubtotal = useMemo(() => {
    return editForm.lines.reduce((sum, l) => {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unit_price) || 0;
      return sum + qty * price;
    }, 0);
  }, [editForm.lines]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <Pencil className="size-4 text-blue-600" />
          Edit Order Lines
        </h3>
        <Button size="sm" variant="outline" onClick={onAddLine} disabled={loadingEditProducts} className="gap-1.5 h-8">
          <Plus className="size-3.5" /> Add Line
        </Button>
      </div>

      {loadingEditProducts && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading products...
        </div>
      )}

      {/* Line items */}
      <div className="space-y-3">
        {editForm.lines.map((line, i) => {
          const lineTotal = ((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)).toFixed(2);

          return (
            <Card key={line.id ?? `new-${i}`} className="overflow-hidden">
              <CardContent className="p-3 space-y-3">
                {/* Row 1: Product selector */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Product</Label>
                  <ProductSearchSelect
                    products={editProducts}
                    value={line.product}
                    onChange={val => onUpdateLineProduct(i, val)}
                    loading={loadingEditProducts}
                  />
                </div>

                {/* Row 2: name (only if manual) */}
                {!line.product && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Product Name</Label>
                    <Input
                      value={line.product_name ?? ''}
                      onChange={e => onUpdateLineField(i, 'product_name', e.target.value)}
                      placeholder="Enter product name"
                      className="h-9 text-sm"
                    />
                  </div>
                )}

                {/* Row 3: qty, price, total, remove */}
                <div className="flex items-end gap-3">
                  <div className="w-20">
                    <Label className="text-xs text-muted-foreground mb-1 block">Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={e => onUpdateLine(i, 'quantity', e.target.value)}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Unit Price</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unit_price}
                      onChange={e => onUpdateLine(i, 'unit_price', e.target.value)}
                      className="h-9 text-sm text-right"
                    />
                  </div>
                  <div className="w-24 text-right">
                    <Label className="text-xs text-muted-foreground mb-1 block">Total</Label>
                    <p className="h-9 flex items-center justify-end text-sm font-semibold tabular-nums">
                      {currency} {lineTotal}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onRemoveLine(i)}
                    disabled={editForm.lines.length <= 1}
                    className="size-9 text-destructive hover:bg-destructive/10 flex-shrink-0"
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Live subtotal */}
      <div className="flex justify-end text-sm">
        <span className="text-muted-foreground mr-2">Subtotal:</span>
        <span className="font-semibold tabular-nums">{currency} {liveSubtotal.toFixed(2)}</span>
      </div>

      <Separator />

      {/* Discount */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Discount</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
            <Select
              value={editForm.discount_type ?? 'NONE'}
              onValueChange={v => onChangeDiscount('type', v as OrderDiscountType)}
            >
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="FIXED">Fixed Amount</SelectItem>
                <SelectItem value="PERCENTAGE">Percentage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Value</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={editForm.discount_value ?? '0.00'}
              onChange={e => onChangeDiscount('value', e.target.value)}
              className="h-9 text-sm text-right"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Notes */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</h4>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Customer Note</Label>
          <Textarea
            value={editForm.customer_note ?? ''}
            onChange={e => onChangeNote('customer', e.target.value)}
            placeholder="Visible to customer..."
            className="min-h-16 text-sm resize-none"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Internal Note</Label>
          <Textarea
            value={editForm.internal_note ?? ''}
            onChange={e => onChangeNote('internal', e.target.value)}
            placeholder="Internal use only..."
            className="min-h-16 text-sm resize-none"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>Cancel</Button>
        <Button
          onClick={onSaveEdit}
          disabled={isSaving}
          className="gap-2 bg-blue-600 hover:bg-blue-700"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save Changes
        </Button>
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
  savingEdit: boolean;
  mutatingOrder: boolean;
  onStatusChange: (id: number, status: OrderStatus) => void;
  onEditModeChange: (enabled: boolean) => void;
  onUpdateLine: (index: number, key: 'quantity' | 'unit_price', value: string) => void;
  onUpdateLineField: (index: number, key: 'product_name' | 'barcode', value: string) => void;
  onUpdateLineProduct: (index: number, productId: string) => void;
  onUpdateBilling: (field: keyof OrderEditRequest, value: string) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  onSaveEdit: () => void;
  onChangeDiscount: (field: 'type' | 'value', val: string | OrderDiscountType) => void;
  onChangeNote: (field: 'customer' | 'internal', val: string) => void;
  onOpenLogs: () => void;
  onDelete: () => void;
  onRestore: () => void;
}

export const OrderDetailDialog: React.FC<OrderDetailDialogProps> = (
  props
) => {
  const {
    open, onOpenChange, order, isDetailLoading,
    isEditMode, editForm, editProducts, loadingEditProducts,
    savingEdit, mutatingOrder,
    onStatusChange, onEditModeChange,
    onUpdateLine, onUpdateLineField, onUpdateLineProduct, onUpdateBilling,
    onAddLine, onRemoveLine, onSaveEdit,
    onChangeDiscount, onChangeNote,
    onOpenLogs, onDelete, onRestore,
  } = props;
  const title = order ? `Order ${order.order_number}` : 'Loading...';
  const desc = order?.external_order_id
    ? `WooCommerce #${order.external_order_id}`
    : 'Local order';

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={title} description={desc} wide>
      {isDetailLoading && !order ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading order details...</p>
        </div>
      ) : order ? (
        <div className="space-y-5">
          {/* Deleted banner */}
          {order.is_deleted && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span className="font-medium">This order has been soft-deleted.</span>
            </div>
          )}

          {/* View mode */}
          {!isEditMode && (
            <>
              {/* Top grid: snapshot + totals */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <OrderSnapshot order={order} />
                  <LineItemsTable lines={order.lines} currency={order.currency} />

                  {order.customer_note && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Customer Note</CardTitle></CardHeader>
                      <CardContent><p className="text-sm text-muted-foreground leading-relaxed">{order.customer_note}</p></CardContent>
                    </Card>
                  )}

                  {order.internal_note && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Internal Note</CardTitle></CardHeader>
                      <CardContent><p className="text-sm text-muted-foreground leading-relaxed">{order.internal_note}</p></CardContent>
                    </Card>
                  )}

                </div>

                <div>
                  <BillingSection
                    order={order}
                    editForm={editForm || { lines: [] }}
                    isEditMode={false}
                    onEditModeChange={onEditModeChange}
                    onUpdateBilling={onUpdateBilling}
                    onSaveEdit={onSaveEdit}
                    isSaving={savingEdit}
                  />
                </div>

                <div>
                  <OrderTotals order={order} onStatusChange={onStatusChange} isLoading={mutatingOrder} />
                </div>
              </div>

              {/* Action bar */}
              <Separator />
              <div className="flex flex-wrap gap-2 justify-end">
                {!order.is_deleted && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => onEditModeChange(true)}>
                    <Pencil className="size-4" /> Edit Order
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-2" onClick={onOpenLogs}>
                  <History className="size-4" /> View Logs
                </Button>
                {order.is_deleted ? (
                  <Button
                    size="sm" variant="outline"
                    className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    onClick={onRestore} disabled={mutatingOrder}
                  >
                    <Undo2 className="size-4" /> Restore
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" className="gap-2" onClick={onDelete} disabled={mutatingOrder}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Edit mode */}
          {isEditMode && editForm && (
            <div className="space-y-6">
              <OrderEditMode
                editForm={editForm}
                editProducts={editProducts}
                loadingEditProducts={loadingEditProducts}
                currency={order.currency}
                onUpdateLine={onUpdateLine}
                onUpdateLineField={onUpdateLineField}
                onUpdateLineProduct={onUpdateLineProduct}
                onAddLine={onAddLine}
                onRemoveLine={onRemoveLine}
                onSaveEdit={onSaveEdit}
                onCancel={() => onEditModeChange(false)}
                onChangeDiscount={onChangeDiscount}
                onChangeNote={onChangeNote}
                isSaving={savingEdit}
              />

              <Separator className="my-4" />

              <BillingSection
                order={order}
                editForm={editForm}
                isEditMode={true}
                onEditModeChange={() => {}}
                onUpdateBilling={onUpdateBilling}
                onSaveEdit={onSaveEdit}
                isSaving={savingEdit}
              />

            </div>
          )}
        </div>
      ) : null}
    </ResponsiveSheet>
  );
};

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
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Sync Orders" description="Import orders from WooCommerce">
      <div className="space-y-5">
        {wcChannels.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <Globe className="size-12 text-muted-foreground/30 mx-auto" />
            <p className="font-medium">No WooCommerce Channels</p>
            <p className="text-sm text-muted-foreground">Create a WooCommerce sales channel first.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Select Store</Label>
              <Select value={selectedChannel} onValueChange={onChannelChange}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Choose a store" /></SelectTrigger>
                <SelectContent>
                  {wcChannels.map(ch => (
                    <SelectItem key={ch.id} value={String(ch.id)}>
                      <span className="font-medium">{ch.name}</span>
                      <Badge variant="outline" className="ml-2 text-xs">{ch.brand_name}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sel && (
              <div className="p-3 rounded-lg border bg-muted/30 flex items-start gap-2">
                <Store className="size-4 text-indigo-600 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">{sel.name}</p>
                  {sel.wc_store_url && <p className="text-xs text-muted-foreground">{sel.wc_store_url}</p>}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={onPreview}
                disabled={isPreviewing || !selectedChannel}
                variant="outline"
                className="flex-1 gap-2"
              >
                <Eye className={`size-4 ${isPreviewing ? 'animate-pulse' : ''}`} />
                {isPreviewing ? 'Loading...' : 'Preview'}
              </Button>
              <Button
                onClick={onSyncAll}
                disabled={isSyncing || !selectedChannel}
                className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                <RefreshCw className={`size-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync All'}
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
}

export function PreviewDialog({
  open, onOpenChange, data, selectedIds,
  onToggleOrder, onSelectAll, onDeselectAll,
  onSyncSelected, onSyncAll, isSyncingSelected,
}: Readonly<PreviewDialogProps>) {
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`WooCommerce Orders – ${data?.sales_channel_name ?? ''}`}
      description="Preview and select orders to import"
      wide
    >
      {data && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1.5 text-xs">
              <Package className="size-3" /> Total: {data.total_count}
            </Badge>
            <Badge className="gap-1.5 text-xs bg-emerald-600">
              <TrendingUp className="size-3" /> New: {data.new_count}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <Check className="size-3" /> Update: {data.existing_count}
            </Badge>
          </div>

          {/* Selection controls */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/40 border">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onSelectAll} className="h-7 text-xs">Select All</Button>
              <Button size="sm" variant="outline" onClick={onDeselectAll} className="h-7 text-xs">Deselect</Button>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{selectedIds.length} selected</span>
          </div>

          {/* Orders list */}
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-10 h-9">
                    <Checkbox
                      checked={selectedIds.length === data.orders.length && data.orders.length > 0}
                      onCheckedChange={checked => checked ? onSelectAll() : onDeselectAll()}
                    />
                  </TableHead>
                  <TableHead className="h-9 text-xs">Order #</TableHead>
                  <TableHead className="h-9 text-xs">Customer</TableHead>
                  <TableHead className="h-9 text-xs hidden sm:table-cell">Status</TableHead>
                  <TableHead className="h-9 text-xs text-right">Total</TableHead>
                  <TableHead className="h-9 text-xs hidden md:table-cell">Items</TableHead>
                  <TableHead className="h-9 text-xs hidden md:table-cell">Payment</TableHead>
                  <TableHead className="h-9 text-xs w-20">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.map(o => (
                  <TableRow
                    key={o.wc_id}
                    className="hover:bg-muted/20 cursor-pointer"
                    onClick={() => onToggleOrder(o.wc_id)}
                  >
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(o.wc_id)}
                        onCheckedChange={() => onToggleOrder(o.wc_id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{o.order_number || o.wc_id}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[140px]">{o.customer_name || '—'}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[140px] hidden sm:block">{o.customer_email}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">{o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{o.currency} {o.total}</TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{o.line_items_count}</TableCell>
                    <TableCell className="text-xs hidden md:table-cell">{o.payment_method_title || '—'}</TableCell>
                    <TableCell>
                      {o.exists_locally ? (
                        <Badge variant="secondary" className="text-xs gap-1 bg-blue-100 text-blue-700"><RefreshCw className="size-3" /> Update</Badge>
                      ) : (
                        <Badge className="text-xs gap-1 bg-emerald-600"><Plus className="size-3" /> New</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 justify-between pt-2">
            <div className="flex gap-2">
              <Button
                onClick={onSyncSelected}
                disabled={isSyncingSelected || selectedIds.length === 0}
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                {isSyncingSelected ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Sync Selected ({selectedIds.length})
              </Button>
              <Button onClick={onSyncAll} disabled={isSyncingSelected} variant="outline" className="gap-2">
                <RefreshCw className="size-4" /> Sync All
              </Button>
            </div>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* LOGS DIALOG                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface LogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber?: string;
  logs: OrderLogEntry[];
  isLoading?: boolean;
}

export function LogsDialog({ open, onOpenChange, orderNumber, logs, isLoading }: Readonly<LogsDialogProps>) {
  const actionColors: Record<string, string> = {
    CREATED: 'bg-green-100 text-green-800',
    UPDATED: 'bg-blue-100 text-blue-800',
    DISCOUNT_APPLIED: 'bg-purple-100 text-purple-800',
    SOFT_DELETED: 'bg-red-100 text-red-800',
    RESTORED: 'bg-emerald-100 text-emerald-800',
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Audit Logs – Order ${orderNumber ?? ''}`}
      description="Complete history of changes"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <AlertCircle className="size-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No audit logs found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => (
            <Card key={log.id}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline" className={`text-xs border-transparent ${actionColors[log.action] ?? 'bg-gray-100 text-gray-700'}`}>
                    {log.action.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm mt-2">
                  <span className="font-medium">By:</span> {log.user_name || 'System'}
                </p>
                {Object.keys(log.details).length > 0 && (
                  <div className="mt-2">
                    <pre className="text-xs font-mono bg-muted rounded p-2.5 max-h-28 overflow-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
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
      <AlertDialogContent className={`border ${ok ? 'border-green-200' : 'border-red-200'}`}>
        <AlertDialogHeader>
          <AlertDialogTitle className={`flex items-center gap-2 ${ok ? 'text-green-700' : 'text-red-700'}`}>
            {ok ? <CheckCircle className="size-5" /> : <XCircle className="size-5" />}
            {ok ? 'Success' : 'Error'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm">{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
