import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  Eye,
  Search,
  Filter,
  MoreVertical,
  Package,
  ArrowUpDown,
  AlertTriangle,
  Plus,
  RefreshCw,
  ArrowRightLeft,
  Loader2,
  Minus,
  TrendingUp,
  TrendingDown,
  BarChart3,
  XCircle,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  PackagePlus,
  PackageMinus,
  Factory,
  PackageCheck,
  Camera,
  Lock,
  Unlock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { POSCameraScanner } from './pos/POSCameraScanner';
import {
  storeInventoryService,
  inventoryMovementService,
} from '@/services/inventory.service';
import { salesChannelService } from '@/services/salesChannel.service';
import { toast } from 'sonner';
import { productService } from '@/services/product.service';
import { useDebounce } from '@/hooks/useDebounce';
import type {
  SalesChannelInventory,
  InventoryMovement,
  SalesChannel,
  MovementSummary,
  ProductListItem,
  ProductType,
  MovementType,
} from '@/types';

// ─── Helper ─────────────────────────────────────────────────────────────────
const extractErrorMessage = (error: unknown): string => {
  const defaultMsg = 'An error occurred. Please try again.';
  if (!error || typeof error !== 'object') return defaultMsg;
  const err = error as { response?: { data?: unknown }; message?: string };
  if (err.response?.data) {
    const data = err.response.data;
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const fieldErrors = Object.entries(
        data as Record<string, unknown>
      ).flatMap(([field, messages]) => {
        const name = field
          .split('_')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        if (Array.isArray(messages)) return messages.map(m => `${name}: ${m}`);
        return typeof messages === 'string' ? [`${name}: ${messages}`] : [];
      });
      if (fieldErrors.length > 0)
        return 'Validation errors:\n\n' + fieldErrors.join('\n');
      const d = data as { detail?: string; message?: string };
      return d.detail ?? d.message ?? defaultMsg;
    }
    if (typeof data === 'string') return data;
  }
  if (err.message?.includes('Network Error'))
    return 'Network error. Please check your connection.';
  if (err.message?.includes('timeout'))
    return 'Request timeout. Please try again.';
  return err.message ?? defaultMsg;
};

// ─── Movement type badges ───────────────────────────────────────────────────
function movementBadge(type: string) {
  const map: Record<
    string,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline';
      icon: React.ReactNode;
    }
  > = {
    PURCHASE: {
      variant: 'default',
      icon: <TrendingUp className="h-3 w-3 mr-1" />,
    },
    RETURN_IN: {
      variant: 'default',
      icon: <TrendingUp className="h-3 w-3 mr-1" />,
    },
    TRANSFER_IN: {
      variant: 'default',
      icon: <ArrowRightLeft className="h-3 w-3 mr-1" />,
    },
    ADJUSTMENT_IN: {
      variant: 'default',
      icon: <Plus className="h-3 w-3 mr-1" />,
    },
    INITIAL: {
      variant: 'secondary',
      icon: <Package className="h-3 w-3 mr-1" />,
    },
    SALE: {
      variant: 'destructive',
      icon: <TrendingDown className="h-3 w-3 mr-1" />,
    },
    RETURN_OUT: {
      variant: 'destructive',
      icon: <TrendingDown className="h-3 w-3 mr-1" />,
    },
    TRANSFER_OUT: {
      variant: 'outline',
      icon: <ArrowRightLeft className="h-3 w-3 mr-1" />,
    },
    ADJUSTMENT_OUT: {
      variant: 'outline',
      icon: <Minus className="h-3 w-3 mr-1" />,
    },
    DAMAGE: {
      variant: 'destructive',
      icon: <AlertTriangle className="h-3 w-3 mr-1" />,
    },
    SENT_TO_FACTORY: {
      variant: 'outline',
      icon: <Factory className="h-3 w-3 mr-1" />,
    },
    PRODUCTION_IN: {
      variant: 'default',
      icon: <PackageCheck className="h-3 w-3 mr-1" />,
    },
    RESERVATION: {
      variant: 'outline',
      icon: <Lock className="h-3 w-3 mr-1" />,
    },
    RELEASE: {
      variant: 'outline',
      icon: <Unlock className="h-3 w-3 mr-1" />,
    },
  };
  const m = map[type] ?? { variant: 'secondary' as const, icon: null };
  return (
    <Badge variant={m.variant} className="flex items-center w-fit text-xs">
      {m.icon}
      {type.split('_').join(' ')}
    </Badge>
  );
}

// Quantity cell for a movement row. On-hand movements read as +in (green) /
// -out (red). A RESERVATION/RELEASE moves only `reserved_quantity` — on-hand is
// unchanged (quantity_before == quantity_after) — so it is shown neutrally
// (amber, with a lock icon) and never as a red stock-out.
function MovementQuantity({ mov }: Readonly<{ mov: InventoryMovement }>) {
  if (mov.is_stock_in) {
    return <span className="font-semibold text-green-600">+{mov.quantity}</span>;
  }
  if (mov.is_stock_out) {
    return <span className="font-semibold text-red-600">-{mov.quantity}</span>;
  }
  const reserved = mov.movement_type === 'RESERVATION';
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold text-amber-600"
      title={
        reserved
          ? 'Reserved — on-hand stock unchanged, available reduced'
          : 'Released — on-hand stock unchanged, available restored'
      }
    >
      {reserved ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      {mov.quantity}
    </span>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case 'COMPLETED':
      return (
        <Badge variant="default" className="flex items-center gap-1 w-fit">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
          <Clock className="h-3 w-3" /> Pending
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
          <XCircle className="h-3 w-3" /> Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ─── Stock status badge ─────────────────────────────────────────────────────
function stockStatusBadge(inv: {
  is_out_of_stock: boolean;
  is_low_stock: boolean;
}) {
  if (inv.is_out_of_stock) {
    return (
      <Badge variant="destructive" className="text-xs">
        Out of Stock
      </Badge>
    );
  }
  if (inv.is_low_stock) {
    return (
      <Badge
        variant="secondary"
        className="text-xs bg-amber-100 text-amber-800"
      >
        Low Stock
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs text-green-700 border-green-300"
    >
      In Stock
    </Badge>
  );
}

// ─── Filter helpers (outside component to reduce cognitive complexity) ───────
function filterInventoryItems(
  items: SalesChannelInventory[],
  query: string,
  channelId: string,
  stock: string
): SalesChannelInventory[] {
  let result = items;
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(
      i =>
        i.product_name.toLowerCase().includes(q) ||
        i.sales_channel_name.toLowerCase().includes(q) ||
        i.product_barcode?.toLowerCase().includes(q) ||
        i.bin_location?.toLowerCase().includes(q)
    );
  }
  if (channelId !== 'all') {
    result = result.filter(i => i.sales_channel === Number(channelId));
  }
  if (stock === 'low') result = result.filter(i => i.is_low_stock);
  else if (stock === 'out') result = result.filter(i => i.is_out_of_stock);
  else if (stock === 'ok')
    result = result.filter(i => !i.is_low_stock && !i.is_out_of_stock);
  return result;
}

function filterMovementItems(
  items: InventoryMovement[],
  query: string,
  channelId: string,
  typeFilter: string,
  statusFilter: string,
  dateFrom: string,
  dateTo: string
): InventoryMovement[] {
  let result = items;
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(
      m =>
        m.product_name.toLowerCase().includes(q) ||
        m.sales_channel_name.toLowerCase().includes(q) ||
        m.reference_number.toLowerCase().includes(q)
    );
  }
  if (channelId !== 'all')
    result = result.filter(m => m.sales_channel === Number(channelId));
  if (typeFilter !== 'all')
    result = result.filter(m => m.movement_type === typeFilter);
  if (statusFilter !== 'all')
    result = result.filter(m => m.status === statusFilter);
  if (dateFrom)
    result = result.filter(m => (m.created_at || '').slice(0, 10) >= dateFrom);
  if (dateTo)
    result = result.filter(m => (m.created_at || '').slice(0, 10) <= dateTo);
  return result;
}

// ─── Tab-specific filter controls (extracted to reduce complexity) ───────────
function TabFilters({
  activeTab,
  stockFilter,
  setStockFilter,
  movementTypeFilter,
  setMovementTypeFilter,
  movementStatusFilter,
  setMovementStatusFilter,
  movementDateFrom,
  setMovementDateFrom,
  movementDateTo,
  setMovementDateTo,
}: Readonly<{
  activeTab: string;
  stockFilter: string;
  setStockFilter: (v: string) => void;
  movementTypeFilter: string;
  setMovementTypeFilter: (v: string) => void;
  movementStatusFilter: string;
  setMovementStatusFilter: (v: string) => void;
  movementDateFrom: string;
  setMovementDateFrom: (v: string) => void;
  movementDateTo: string;
  setMovementDateTo: (v: string) => void;
}>) {
  if (activeTab === 'inventory') {
    return (
      <div className="w-[160px]">
        <Label className="text-xs text-muted-foreground mb-1 block">
          Stock status
        </Label>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="ok">In Stock</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (activeTab === 'movements') {
    return (
      <>
        <div className="w-[160px]">
          <Label className="text-xs text-muted-foreground mb-1 block">
            Type
          </Label>
          <Select
            value={movementTypeFilter}
            onValueChange={setMovementTypeFilter}
          >
            <SelectTrigger>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="PURCHASE">Purchase</SelectItem>
              <SelectItem value="SALE">Sale</SelectItem>
              <SelectItem value="TRANSFER_IN">Transfer In</SelectItem>
              <SelectItem value="TRANSFER_OUT">Transfer Out</SelectItem>
              <SelectItem value="ADJUSTMENT_IN">Adjustment In</SelectItem>
              <SelectItem value="ADJUSTMENT_OUT">Adjustment Out</SelectItem>
              <SelectItem value="RETURN_IN">Return In</SelectItem>
              <SelectItem value="RETURN_OUT">Return Out</SelectItem>
              <SelectItem value="DAMAGE">Damage</SelectItem>
              <SelectItem value="INITIAL">Initial</SelectItem>
              <SelectItem value="RESERVATION">Reserved</SelectItem>
              <SelectItem value="RELEASE">Released</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[150px]">
          <Label className="text-xs text-muted-foreground mb-1 block">
            Status
          </Label>
          <Select
            value={movementStatusFilter}
            onValueChange={setMovementStatusFilter}
          >
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[150px]">
          <Label className="text-xs text-muted-foreground mb-1 block">
            From date
          </Label>
          <Input
            type="date"
            value={movementDateFrom}
            onChange={e => setMovementDateFrom(e.target.value)}
          />
        </div>
        <div className="w-[150px]">
          <Label className="text-xs text-muted-foreground mb-1 block">
            To date
          </Label>
          <Input
            type="date"
            value={movementDateTo}
            onChange={e => setMovementDateTo(e.target.value)}
          />
        </div>
      </>
    );
  }
  return null;
}

// ─── Inventory detail content (extracted to reduce complexity) ───────────────
function InventoryDetailContent({
  inv,
  onAdjust,
  onTransfer,
  onEdit,
}: Readonly<{
  inv: SalesChannelInventory;
  onAdjust: (i: SalesChannelInventory) => void;
  onTransfer: (i: SalesChannelInventory) => void;
  onEdit: (i: SalesChannelInventory) => void;
}>) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-2">
        <div>
          <span className="text-muted-foreground block text-xs">Product</span>
          <p className="font-medium">{inv.product_name}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Barcode</span>
          <p className="font-mono">{inv.product_barcode}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Channel</span>
          <p className="font-medium">{inv.sales_channel_name}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">
            Channel Code
          </span>
          <p className="font-mono">{inv.sales_channel_code || '\u2014'}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Quantity</span>
          <p className="font-semibold text-lg">{inv.quantity}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Reserved</span>
          <p>{inv.reserved_quantity}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Available</span>
          <p className="text-green-600 font-semibold">
            {inv.available_quantity}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Min Qty</span>
          <p>{inv.minimum_quantity}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Max Qty</span>
          <p>{inv.maximum_quantity ?? '\u2014'}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">
            Bin Location
          </span>
          <p>{inv.bin_location || '\u2014'}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Company</span>
          <p>{inv.company_name}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">
            Last Counted
          </span>
          <p>
            {inv.last_counted_at
              ? new Date(inv.last_counted_at).toLocaleString()
              : '\u2014'}
          </p>
        </div>
      </div>
      <DialogFooter className="mt-4 gap-2">
        <Button size="sm" variant="outline" onClick={() => onAdjust(inv)}>
          <PackagePlus className="h-4 w-4 mr-1" /> Adjust
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTransfer(inv)}>
          <ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(inv)}>
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Movement detail content (extracted to reduce complexity) ────────────────
function MovementDetailContent({
  mov,
  onComplete,
}: Readonly<{
  mov: InventoryMovement;
  onComplete: (m: InventoryMovement) => void;
}>) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mt-2">
        <div>
          <span className="text-muted-foreground block text-xs">Reference</span>
          <p className="font-mono">{mov.reference_number}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Type</span>
          <div className="mt-1">{movementBadge(mov.movement_type)}</div>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Product</span>
          <p className="font-medium">{mov.product_name}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Barcode</span>
          <p className="font-mono">{mov.product_barcode}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Channel</span>
          <p>{mov.sales_channel_name}</p>
        </div>
        {mov.destination_channel_name && (
          <div>
            <span className="text-muted-foreground block text-xs">
              Destination
            </span>
            <p>{mov.destination_channel_name}</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground block text-xs">Quantity</span>
          <p>
            <MovementQuantity mov={mov} />
          </p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Status</span>
          <div className="mt-1">{statusBadge(mov.status)}</div>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Before</span>
          <p className="font-mono">{mov.quantity_before}</p>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">After</span>
          <p className="font-mono">{mov.quantity_after}</p>
        </div>
        {mov.unit_cost && (
          <div>
            <span className="text-muted-foreground block text-xs">
              Unit Cost
            </span>
            <p>{mov.unit_cost}</p>
          </div>
        )}
        {mov.total_cost && (
          <div>
            <span className="text-muted-foreground block text-xs">
              Total Cost
            </span>
            <p>{mov.total_cost}</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground block text-xs">Created</span>
          <p>{new Date(mov.created_at).toLocaleString()}</p>
        </div>
        {mov.completed_at && (
          <div>
            <span className="text-muted-foreground block text-xs">
              Completed
            </span>
            <p>{new Date(mov.completed_at).toLocaleString()}</p>
          </div>
        )}
        {mov.created_by_name && (
          <div>
            <span className="text-muted-foreground block text-xs">
              Created By
            </span>
            <p>{mov.created_by_name}</p>
          </div>
        )}
        {mov.notes && (
          <div className="col-span-2">
            <span className="text-muted-foreground block text-xs">Notes</span>
            <p className="mt-1 bg-muted p-2 rounded text-xs">{mov.notes}</p>
          </div>
        )}
      </div>
      {mov.status === 'PENDING' && (
        <DialogFooter className="mt-4">
          <Button size="sm" onClick={() => onComplete(mov)}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Complete This Movement
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

// ─── Check if filters are active (outside component) ────────────────────────
function hasActiveFilters(
  sq: string,
  ch: string,
  st: string,
  mt: string,
  ms: string
): boolean {
  return (
    sq !== '' || ch !== 'all' || st !== 'all' || mt !== 'all' || ms !== 'all'
  );
}

function SearchableProductSelect({
  products,
  value,
  onChange,
  placeholder = 'Search by product name or barcode...',
  disabled = false,
  emptyMessage = 'No product found',
  autoFocus = false,
}: {
  products: ProductListItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = products.find(p => String(p.id) === value) || null;
  const showResults = !disabled && (focused || !selected || query.trim().length > 0);
  const selectProduct = useCallback(
    (product: ProductListItem) => {
      onChange(String(product.id));
      setQuery('');
      inputRef.current?.focus();
    },
    [onChange]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? products.filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q) ||
            (p.brand_name || '').toLowerCase().includes(q)
        )
      : products;
    return rows.slice(0, 40);
  }, [products, query]);
  const exactBarcodeMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 3) return null;
    return (
      products.find(p => (p.barcode || '').toLowerCase() === q) || null
    );
  }, [products, query]);

  useEffect(() => {
    if (disabled || !exactBarcodeMatch) return;
    const timer = window.setTimeout(() => {
      selectProduct(exactBarcodeMatch);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [disabled, exactBarcodeMatch, selectProduct]);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 140);
    return () => window.clearTimeout(timer);
  }, [autoFocus, disabled, products.length]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    if (exactBarcodeMatch) {
      selectProduct(exactBarcodeMatch);
      return;
    }

    if (filtered.length === 1) {
      selectProduct(filtered[0]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="pl-9"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleSearchKeyDown}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
      {!disabled && (
        <p className="text-[11px] text-muted-foreground">
          Scan a barcode in this field, or type a product name. Enter selects an exact barcode.
        </p>
      )}

      {selected && (
        <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{selected.barcode || 'No barcode'}</span>
              {selected.brand_name ? ` · ${selected.brand_name}` : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => {
              onChange('');
              setQuery('');
              setFocused(true);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Change
          </Button>
        </div>
      )}

      {showResults && (
      <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          filtered.map(product => {
            const isSelected = String(product.id) === value;
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => selectProduct(product)}
                className={`flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{product.barcode || 'No barcode'}</span>
                    {product.brand_name ? ` · ${product.brand_name}` : ''}
                  </p>
                </div>
                {isSelected && (
                  <Badge variant="secondary" className="shrink-0">
                    Selected
                  </Badge>
                )}
              </button>
            );
          })
        )}
      </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
type InventoryTab =
  | 'inventory'
  | 'packs'
  | 'movements'
  | 'low-stock'
  | 'daily-out'
  | 'demand';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

// A row in the bulk add/update editor.
type BulkRow = {
  product: number;
  product_name: string;
  product_barcode: string;
  product_image: string | null;
  mode: 'set' | 'add' | 'subtract';
  quantity: string;
  minimum_quantity: string;
  maximum_quantity: string;
  bin_location: string;
};

// Small square product thumbnail with a graceful icon fallback.
function ProductThumb({
  src,
  size = 'h-9 w-9',
}: Readonly<{ src?: string | null; size?: string }>) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={`${size} flex-shrink-0 rounded border object-cover`}
      />
    );
  }
  return (
    <div
      className={`${size} flex flex-shrink-0 items-center justify-center rounded border bg-muted`}
    >
      <Package className="h-4 w-4 text-muted-foreground/50" />
    </div>
  );
}

// Canonical product taxonomy (matches Product.ProductType on the backend), used
// by the inventory report tabs.
const PRODUCT_TYPE_META: { key: ProductType; label: string }[] = [
  { key: 'resell_product', label: 'Resell Product' },
  { key: 'pack', label: 'Pack' },
  { key: 'component', label: 'Component' },
  { key: 'packaging_item', label: 'Packaging Item' },
];

export default function InventoryPage() {
  // ── Data ────────────────────────────────────────────────────────────────
  const [inventories, setInventories] = useState<SalesChannelInventory[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [lowStock, setLowStock] = useState<SalesChannelInventory[]>([]);
  const [summary, setSummary] = useState<MovementSummary | null>(null);

  // ── Page UI ─────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Inventory-tab pagination. Client-side over the (now-complete) list — the
  // summary cards still see every row, only the table is sliced.
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(25);
  // Movements-tab pagination (client-side over the filtered set).
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(25);
  // Daily Stock Out: outgoing units on a chosen day, by product type + channel.
  const [stockOutDate, setStockOutDate] = useState<string>(() => todayISO());
  const [stockOutChannelId, setStockOutChannelId] = useState('all');
  // Order Demand: consolidated stock needed across all open orders (backend agg).
  const [demandChannelId, setDemandChannelId] = useState('all');
  const [demand, setDemand] = useState<
    Awaited<ReturnType<typeof storeInventoryService.getOrderDemand>> | null
  >(null);
  const [demandLoading, setDemandLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryTab>('inventory');
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [inventoryBarcodeQuery, setInventoryBarcodeQuery] = useState('');
  const [inventoryBarcodeFeedback, setInventoryBarcodeFeedback] = useState('');
  const [inventoryBarcodeLoading, setInventoryBarcodeLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementStatusFilter, setMovementStatusFilter] = useState('all');
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');
  const inventoryBarcodeInputRef = useRef<HTMLInputElement>(null);

  // ── Dialog state ────────────────────────────────────────────────────────
  const [viewInventory, setViewInventory] =
    useState<SalesChannelInventory | null>(null);
  const [viewProductInventory, setViewProductInventory] =
    useState<ProductListItem | null>(null);
  const [viewMovement, setViewMovement] = useState<InventoryMovement | null>(
    null
  );

  // Bulk add / update stock (multi-row editor) + multi-select delete.
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkChannel, setBulkChannel] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedInvIds, setSelectedInvIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Add Inventory
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({
    sales_channel: '',
    product: '',
    quantity: '',
    minimum_quantity: '0',
    maximum_quantity: '',
    bin_location: '',
  });
  const [addProductSearch, setAddProductSearch] = useState('');
  const [addScanOpen, setAddScanOpen] = useState(false);
  const [addScanFeedback, setAddScanFeedback] = useState('');
  // Server-side picker results for the Add-Stock dialog. Filtering a
  // client-side ``products`` array missed anything past the first page;
  // hitting the paginated search endpoint always reflects what the user's
  // role can actually see.
  const [addPickerResults, setAddPickerResults] = useState<ProductListItem[]>([]);
  const [addPickerLoading, setAddPickerLoading] = useState(false);
  const debouncedAddSearch = useDebounce(addProductSearch, 250);

  // Adjust Stock
  const [adjustDialog, setAdjustDialog] = useState(false);
  const [adjustTarget, setAdjustTarget] =
    useState<SalesChannelInventory | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    quantity_change: '',
    movement_type: 'ADJUSTMENT_IN' as 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT',
    notes: '',
  });

  // Edit Inventory
  const [editDialog, setEditDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<SalesChannelInventory | null>(
    null
  );
  const [editForm, setEditForm] = useState({
    minimum_quantity: '',
    maximum_quantity: '',
    bin_location: '',
  });

  // Delete Inventory
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<SalesChannelInventory | null>(null);

  // Transfer
  const [transferDialog, setTransferDialog] = useState(false);
  const [transferForm, setTransferForm] = useState({
    source_channel: '',
    destination_channel: '',
    product: '',
    quantity: '',
    notes: '',
  });

  // Record Movement
  const [movementDialog, setMovementDialog] = useState(false);
  const [movementForm, setMovementForm] = useState({
    sales_channel: '',
    product: '',
    movement_type: 'PURCHASE' as MovementType,
    quantity: '',
    unit_cost: '',
    notes: '',
  });

  // Complete Movement
  const [completeDialog, setCompleteDialog] = useState(false);
  const [completeTarget, setCompleteTarget] =
    useState<InventoryMovement | null>(null);
  const [completeNotes, setCompleteNotes] = useState('');

  // Success / Error feedback
  const [successDialog, setSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorDialog, setErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // ── Data fetching ───────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [inv, mov, ch, prod, low, sum] = await Promise.all([
        storeInventoryService.getAllStoreInventories(),
        inventoryMovementService.getAllMovements(),
        salesChannelService.getAllChannels(),
        productService.getAllProducts().catch(() => [] as ProductListItem[]),
        storeInventoryService
          .getLowStockItems()
          .catch(() => [] as SalesChannelInventory[]),
        inventoryMovementService.getMovementSummary().catch(() => null),
      ]);
      setInventories(inv);
      setMovements(mov);
      setChannels(ch);
      setProducts(prod);
      setLowStock(low);
      setSummary(sum);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Order Demand is a backend aggregation — fetch it when the tab is active or
  // the channel filter changes.
  useEffect(() => {
    if (activeTab !== 'demand') return;
    let cancelled = false;
    setDemandLoading(true);
    storeInventoryService
      .getOrderDemand(
        demandChannelId === 'all' ? {} : { sales_channel: Number(demandChannelId) },
      )
      .then(d => {
        if (!cancelled) setDemand(d);
      })
      .catch(() => {
        if (!cancelled) setDemand(null);
      })
      .finally(() => {
        if (!cancelled) setDemandLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, demandChannelId]);

  useEffect(() => {
    if (isLoading) return;
    const timer = window.setTimeout(() => {
      inventoryBarcodeInputRef.current?.focus();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  // ── Show feedback ───────────────────────────────────────────────────────
  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setSuccessDialog(true);
  };
  const showError = (msg: string) => {
    setErrorMessage(msg);
    setErrorDialog(true);
  };

  // ── Filtered data ───────────────────────────────────────────────────────
  const filteredInventories = useMemo(
    () =>
      filterInventoryItems(
        inventories,
        searchQuery,
        channelFilter,
        stockFilter
      ),
    [inventories, searchQuery, channelFilter, stockFilter]
  );

  // Visible slice for the inventory table. Reset to page 1 whenever the
  // filter narrows below the current page's start — otherwise the user
  // would land on a blank "page 7 of 2".
  const inventoryTotalPages = Math.max(
    1,
    Math.ceil(filteredInventories.length / inventoryPageSize),
  );
  const safeInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
  useEffect(() => {
    if (safeInventoryPage !== inventoryPage) setInventoryPage(safeInventoryPage);
  }, [safeInventoryPage, inventoryPage]);
  useEffect(() => {
    setInventoryPage(1);
  }, [searchQuery, channelFilter, stockFilter, inventoryPageSize]);
  const paginatedInventories = useMemo(
    () => {
      const start = (safeInventoryPage - 1) * inventoryPageSize;
      return filteredInventories.slice(start, start + inventoryPageSize);
    },
    [filteredInventories, safeInventoryPage, inventoryPageSize],
  );

  const filteredMovements = useMemo(
    () =>
      filterMovementItems(
        movements,
        searchQuery,
        channelFilter,
        movementTypeFilter,
        movementStatusFilter,
        movementDateFrom,
        movementDateTo
      ),
    [
      movements,
      searchQuery,
      channelFilter,
      movementTypeFilter,
      movementStatusFilter,
      movementDateFrom,
      movementDateTo,
    ]
  );

  // Movements pagination (mirror of the inventory-tab pattern above).
  const movementTotalPages = Math.max(
    1,
    Math.ceil(filteredMovements.length / movementPageSize),
  );
  const safeMovementPage = Math.min(movementPage, movementTotalPages);
  useEffect(() => {
    if (safeMovementPage !== movementPage) setMovementPage(safeMovementPage);
  }, [safeMovementPage, movementPage]);
  useEffect(() => {
    setMovementPage(1);
  }, [
    searchQuery,
    channelFilter,
    movementTypeFilter,
    movementStatusFilter,
    movementDateFrom,
    movementDateTo,
    movementPageSize,
  ]);
  const paginatedMovements = useMemo(() => {
    const start = (safeMovementPage - 1) * movementPageSize;
    return filteredMovements.slice(start, start + movementPageSize);
  }, [filteredMovements, safeMovementPage, movementPageSize]);

  // Map product id -> product type, used by the Daily Stock Out report below.
  const productTypeById = useMemo(() => {
    const m = new Map<number, ProductType>();
    for (const p of products) m.set(p.id, p.product_type);
    return m;
  }, [products]);

  // ── Daily Stock Out: outgoing units on the selected date ──────────────────
  // Sources every stock-OUT movement (sale, transfer-out, damage, write-off …)
  // dated on ``stockOutDate``, optionally narrowed to one channel, then groups
  // by product type and aggregates per product+channel.
  const dailyStockOut = useMemo(() => {
    const movs = movements.filter(
      m =>
        m.is_stock_out &&
        (m.created_at || '').slice(0, 10) === stockOutDate &&
        (stockOutChannelId === 'all' ||
          m.sales_channel === Number(stockOutChannelId)),
    );
    type Row = {
      product_name: string;
      product_barcode: string;
      sales_channel_name: string;
      qty: number;
    };
    const byTypeMap = new Map<string, { total: number; rows: Map<string, Row> }>();
    const byChannelMap = new Map<string, number>();
    let total = 0;
    for (const m of movs) {
      total += m.quantity;
      const type = productTypeById.get(m.product) ?? 'unknown';
      const bucket = byTypeMap.get(type) ?? { total: 0, rows: new Map<string, Row>() };
      bucket.total += m.quantity;
      const key = `${m.product}:${m.sales_channel}`;
      const row =
        bucket.rows.get(key) ?? {
          product_name: m.product_name,
          product_barcode: m.product_barcode,
          sales_channel_name: m.sales_channel_name,
          qty: 0,
        };
      row.qty += m.quantity;
      bucket.rows.set(key, row);
      byTypeMap.set(type, bucket);
      byChannelMap.set(
        m.sales_channel_name,
        (byChannelMap.get(m.sales_channel_name) ?? 0) + m.quantity,
      );
    }
    const typeOrder = ['packaging_item', 'resell_product', 'component', 'pack', 'unknown'];
    const byType = [...byTypeMap.entries()]
      .map(([type, v]) => ({
        type,
        label: PRODUCT_TYPE_META.find(t => t.key === type)?.label ?? 'Other',
        total: v.total,
        rows: [...v.rows.values()].sort(
          (a, b) => b.qty - a.qty || a.product_name.localeCompare(b.product_name),
        ),
      }))
      .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
    const byChannel = [...byChannelMap.entries()]
      .map(([name, qty]) => ({ name, total: qty }))
      .sort((a, b) => b.total - a.total);
    return { total, lines: movs.length, byType, byChannel };
  }, [movements, stockOutDate, stockOutChannelId, productTypeById]);

  const selectedAddProduct = useMemo(
    () => products.find(p => String(p.id) === addForm.product) || null,
    [addForm.product, products]
  );

  const addExistingInventory = useMemo(() => {
    if (!addForm.sales_channel || !addForm.product) return null;
    return (
      inventories.find(
        inv =>
          inv.sales_channel === Number(addForm.sales_channel) &&
          inv.product === Number(addForm.product)
      ) || null
    );
  }, [addForm.product, addForm.sales_channel, inventories]);

  // Server-side debounced search. Fires every time the dialog is open and
  // the search input settles. Empty query returns the top-50 of the user's
  // scope so the picker is never blank. ``selectProductForAdd`` writes the
  // selected product's name to ``addProductSearch`` — that re-fires this
  // effect with the name-as-query, which is harmless (still finds it) and
  // keeps the list relevant if the user types more.
  useEffect(() => {
    if (!addDialog) return;
    let cancelled = false;
    setAddPickerLoading(true);
    productService
      .getProductsPaginated({
        search: debouncedAddSearch.trim() || undefined,
        page_size: 50,
      })
      .then(page => {
        if (!cancelled) setAddPickerResults(page.results);
      })
      .catch(() => {
        if (!cancelled) setAddPickerResults([]);
      })
      .finally(() => {
        if (!cancelled) setAddPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addDialog, debouncedAddSearch]);

  const filteredAddProducts = useMemo(
    () => addPickerResults.slice(0, 50),
    [addPickerResults],
  );

  const transferSourceInventory = useMemo(() => {
    if (!transferForm.source_channel) return [];
    return inventories.filter(
      inv =>
        inv.sales_channel === Number(transferForm.source_channel) &&
        inv.available_quantity > 0
    );
  }, [inventories, transferForm.source_channel]);

  const transferProductOptions = useMemo(() => {
    const sourceProductIds = new Set(transferSourceInventory.map(inv => inv.product));
    return products.filter(product => sourceProductIds.has(product.id));
  }, [products, transferSourceInventory]);

  const transferSelectedInventory = useMemo(() => {
    if (!transferForm.product) return null;
    return (
      transferSourceInventory.find(inv => inv.product === Number(transferForm.product)) ||
      null
    );
  }, [transferForm.product, transferSourceInventory]);

  const productInventoryRows = useMemo(() => {
    if (!viewProductInventory) return [];
    return channels
      .filter(channel => channel.is_active)
      .map(channel => ({
        channel,
        inventory:
          inventories.find(
            inv =>
              inv.product === viewProductInventory.id &&
              inv.sales_channel === channel.id
          ) || null,
      }));
  }, [channels, inventories, viewProductInventory]);

  const productInventoryTotals = useMemo(
    () =>
      productInventoryRows.reduce(
        (totals, row) => ({
          quantity: totals.quantity + (row.inventory?.quantity || 0),
          reserved:
            totals.reserved + (row.inventory?.reserved_quantity || 0),
          available:
            totals.available + (row.inventory?.available_quantity || 0),
        }),
        { quantity: 0, reserved: 0, available: 0 }
      ),
    [productInventoryRows]
  );

  const packAvailabilityRows = useMemo(() => {
    const productById = new Map(products.map(product => [product.id, product]));
    const inventoryByChannelProduct = new Map(
      inventories.map(inv => [`${inv.sales_channel}:${inv.product}`, inv])
    );
    const scopedChannels = channels.filter(channel => (
      channel.is_active &&
      (channelFilter === 'all' || channel.id === Number(channelFilter))
    ));

    return products
      .filter(product => product.is_pack)
      .flatMap(pack => scopedChannels.map(channel => {
        const components = (pack.pack_items || []).map(item => {
          const component = productById.get(item.product_id);
          const inventory = inventoryByChannelProduct.get(`${channel.id}:${item.product_id}`);
          const required = Math.max(1, Number(item.quantity || 1));
          const available = inventory?.available_quantity ?? 0;
          return {
            id: item.product_id,
            name: component?.name || `Component #${item.product_id}`,
            barcode: component?.barcode || '',
            required,
            available,
            possiblePacks: Math.floor(available / required),
            missing: !component || !inventory,
          };
        });
        const availablePacks = components.length > 0
          ? Math.max(0, Math.min(...components.map(component => component.possiblePacks)))
          : 0;
        return {
          key: `${pack.id}:${channel.id}`,
          pack,
          channel,
          components,
          availablePacks,
          hasProblem: components.length === 0 || components.some(component => component.missing || component.available < component.required),
        };
      }))
      .filter(row => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          row.pack.name.toLowerCase().includes(q) ||
          (row.pack.barcode || '').toLowerCase().includes(q) ||
          row.components.some(component =>
            component.name.toLowerCase().includes(q) ||
            (component.barcode || '').toLowerCase().includes(q)
          )
        );
      });
  }, [channelFilter, channels, inventories, products, searchQuery]);

  // ── Stats ───────────────────────────────────────────────────────────────
  const totalProducts = useMemo(
    () => new Set(inventories.map(i => i.product)).size,
    [inventories]
  );
  const totalQty = useMemo(
    () => inventories.reduce((s, i) => s + i.quantity, 0),
    [inventories]
  );
  const outOfStock = useMemo(
    () => inventories.filter(i => i.is_out_of_stock).length,
    [inventories]
  );

  // ═══════════════════════════════════════════════════════════════════════
  // ACTION HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  const findProductRecordByBarcode = async (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) return null;

    // The server is the source of truth. The local ``products`` array can
    // be partial (pagination, role scoping, deleted-since-load), so we
    // always hit ``search_barcode/`` first and fall back to the local
    // cache only if the API is unreachable — that way an outdated cache
    // can never silently shadow the right answer.
    try {
      const remoteProduct = await productService.searchByBarcode(clean);
      if (remoteProduct) {
        setProducts(prev =>
          prev.some(p => p.id === remoteProduct.id) ? prev : [remoteProduct, ...prev]
        );
        return remoteProduct;
      }
    } catch {
      // fall through to the local cache as a last resort
    }

    const localProduct = products.find(
      p => (p.barcode || '').toLowerCase() === clean.toLowerCase()
    );
    return localProduct ?? null;
  };

  const openProductInventoryLookup = async (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) {
      inventoryBarcodeInputRef.current?.focus();
      return;
    }

    setInventoryBarcodeLoading(true);
    setInventoryBarcodeFeedback('');
    try {
      const product = await findProductRecordByBarcode(clean);
      if (!product) {
        setInventoryBarcodeFeedback(`No product found for barcode ${clean}`);
        return;
      }

      setViewProductInventory(product);
      setSearchQuery(product.barcode || product.name);
      setChannelFilter('all');
      setActiveTab('inventory');
      setInventoryBarcodeQuery('');
      setInventoryBarcodeFeedback(`Opened inventory for ${product.name}`);
    } catch (err) {
      setInventoryBarcodeFeedback(extractErrorMessage(err));
    } finally {
      setInventoryBarcodeLoading(false);
      window.setTimeout(() => inventoryBarcodeInputRef.current?.focus(), 120);
    }
  };

  const handleInventoryBarcodeKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void openProductInventoryLookup(inventoryBarcodeQuery);
  };

  // ── Bulk add/update + multi-select delete ────────────────────────────────
  const openBulkDialog = () => {
    setBulkChannel('');
    setBulkRows([]);
    setBulkSearch('');
    setBulkDialog(true);
  };
  const addBulkProduct = (p: ProductListItem) => {
    setBulkRows(rows => {
      if (rows.some(r => r.product === p.id)) return rows; // already in the list
      return [
        ...rows,
        {
          product: p.id,
          product_name: p.name,
          product_barcode: p.barcode,
          product_image: p.image || p.image_url || null,
          mode: 'add',
          quantity: '',
          minimum_quantity: '',
          maximum_quantity: '',
          bin_location: '',
        },
      ];
    });
    setBulkSearch('');
  };
  const setBulkRow = (i: number, patch: Partial<BulkRow>) =>
    setBulkRows(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeBulkRow = (i: number) =>
    setBulkRows(rows => rows.filter((_, idx) => idx !== i));
  const bulkSearchResults = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase();
    if (!q) return [] as ProductListItem[];
    const added = new Set(bulkRows.map(r => r.product));
    return products
      .filter(
        p =>
          !added.has(p.id) &&
          ((p.name || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q)),
      )
      .slice(0, 25);
  }, [bulkSearch, products, bulkRows]);
  const handleBulkScanEnter = () => {
    const q = bulkSearch.trim().toLowerCase();
    if (!q) return;
    const exact = products.find(p => (p.barcode || '').toLowerCase() === q);
    if (exact) {
      addBulkProduct(exact);
      return;
    }
    if (bulkSearchResults.length === 1) addBulkProduct(bulkSearchResults[0]);
  };
  const saveBulk = async () => {
    const channelId = Number(bulkChannel);
    if (!channelId) {
      toast.error('Pick a sales channel for the batch.');
      return;
    }
    const items = bulkRows
      .filter(r => r.quantity !== '' && !Number.isNaN(Number(r.quantity)))
      .map(r => ({
        sales_channel: channelId,
        product: r.product,
        mode: r.mode,
        quantity: Number(r.quantity),
        ...(r.minimum_quantity !== '' && !Number.isNaN(Number(r.minimum_quantity))
          ? { minimum_quantity: Number(r.minimum_quantity) }
          : {}),
        ...(r.maximum_quantity !== '' && !Number.isNaN(Number(r.maximum_quantity))
          ? { maximum_quantity: Number(r.maximum_quantity) }
          : {}),
        ...(r.bin_location.trim() ? { bin_location: r.bin_location.trim() } : {}),
      }));
    if (items.length === 0) {
      toast.error('Add at least one product and set its quantity.');
      return;
    }
    setBulkSaving(true);
    try {
      const res = await storeInventoryService.bulkUpsert(items);
      toast.success(
        `Saved ${res.total} row(s): ${res.created} added, ${res.updated} updated.`,
      );
      setBulkDialog(false);
      await fetchData();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setBulkSaving(false);
    }
  };
  // Current on-hand for a product on the chosen bulk channel (null = not stocked).
  const bulkRowCurrent = (productId: number): number | null => {
    if (!bulkChannel) return null;
    const inv = inventories.find(
      i => i.sales_channel === Number(bulkChannel) && i.product === productId,
    );
    return inv ? inv.quantity : null;
  };
  // Resulting on-hand after applying the row's operation.
  const bulkRowResult = (row: BulkRow): number => {
    const cur = bulkRowCurrent(row.product) ?? 0;
    const q = Number(row.quantity) || 0;
    if (row.mode === 'add') return cur + q;
    if (row.mode === 'subtract') return Math.max(0, cur - q);
    return q;
  };

  const toggleInvSelected = (id: number) =>
    setSelectedInvIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkDeleteSelected = async () => {
    if (selectedInvIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await storeInventoryService.bulkDelete([...selectedInvIds]);
      toast.success(`Deleted ${res.deleted} inventory row(s).`);
      setSelectedInvIds(new Set());
      await fetchData();
    } catch (err) {
      toast.error(extractErrorMessage(err));
    } finally {
      setBulkDeleting(false);
    }
  };

  const openAddDialog = () => {
    setAddForm({
      sales_channel: '',
      product: '',
      quantity: '',
      minimum_quantity: '0',
      maximum_quantity: '',
      bin_location: '',
    });
    setAddProductSearch('');
    setAddScanFeedback('');
    setAddDialog(true);
  };

  const openAddDialogForProductChannel = (
    product: ProductListItem,
    salesChannelId: number
  ) => {
    setViewProductInventory(null);
    setAddForm({
      sales_channel: String(salesChannelId),
      product: String(product.id),
      quantity: '',
      minimum_quantity: '0',
      maximum_quantity: '',
      bin_location: '',
    });
    setAddProductSearch(`${product.name}${product.barcode ? ` ${product.barcode}` : ''}`);
    setAddScanFeedback(`Selected ${product.name}`);
    setAddDialog(true);
  };

  const selectProductForAdd = (product: ProductListItem, feedback?: string) => {
    setAddForm(prev => ({ ...prev, product: String(product.id) }));
    setAddProductSearch(`${product.name}${product.barcode ? ` ${product.barcode}` : ''}`);
    if (feedback) setAddScanFeedback(feedback);
  };

  const findProductByBarcode = async (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) return;

    const product = await findProductRecordByBarcode(clean);
    if (product) {
      selectProductForAdd(product, `Selected ${product.name}`);
      return;
    }

    setAddScanFeedback(`No product found for barcode ${clean}`);
  };

  const handleAddBarcodeSubmit = async () => {
    await findProductByBarcode(addProductSearch);
  };

  const handleAddInventory = async () => {
    if (!addForm.sales_channel || !addForm.product || !addForm.quantity) return;
    setActionLoading(true);
    try {
      const salesChannelId = Number(addForm.sales_channel);
      const productId = Number(addForm.product);
      const quantity = Number(addForm.quantity) || 0;
      const existing = inventories.find(
        inv => inv.sales_channel === salesChannelId && inv.product === productId
      );

      if (existing) {
        const result = await storeInventoryService.adjustStock(existing.id, {
          quantity_change: quantity,
          movement_type: 'ADJUSTMENT_IN',
          notes:
            addForm.bin_location || addForm.minimum_quantity !== '0'
              ? `Stock added from quick add. Bin: ${addForm.bin_location || 'unchanged'}`
              : 'Stock added from quick add.',
        });
        showSuccess(
          `Stock added to existing record. New quantity: ${result.new_quantity}.`
        );
      } else {
        await storeInventoryService.createStoreInventory({
          sales_channel: salesChannelId,
          product: productId,
          quantity,
          minimum_quantity: Number(addForm.minimum_quantity) || 0,
          maximum_quantity: addForm.maximum_quantity
            ? Number(addForm.maximum_quantity)
            : null,
          bin_location: addForm.bin_location,
        });
        showSuccess('Inventory record created successfully.');
      }
      setAddDialog(false);
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openAdjustDialog = (inv: SalesChannelInventory) => {
    setAdjustTarget(inv);
    setAdjustForm({
      quantity_change: '',
      movement_type: 'ADJUSTMENT_IN',
      notes: '',
    });
    setAdjustDialog(true);
  };

  const handleAdjustStock = async () => {
    if (!adjustTarget || !adjustForm.quantity_change) return;
    setActionLoading(true);
    try {
      const result = await storeInventoryService.adjustStock(adjustTarget.id, {
        quantity_change: Number(adjustForm.quantity_change),
        movement_type: adjustForm.movement_type,
        notes: adjustForm.notes,
      });
      setAdjustDialog(false);
      showSuccess(
        `Stock adjusted. New quantity: ${result.new_quantity}. Ref: ${result.movement_reference}`
      );
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openEditDialog = (inv: SalesChannelInventory) => {
    setEditTarget(inv);
    setEditForm({
      minimum_quantity: String(inv.minimum_quantity),
      maximum_quantity:
        inv.maximum_quantity === null || inv.maximum_quantity === undefined
          ? ''
          : String(inv.maximum_quantity),
      bin_location: inv.bin_location || '',
    });
    setEditDialog(true);
  };

  const handleEditInventory = async () => {
    if (!editTarget) return;
    setActionLoading(true);
    try {
      await storeInventoryService.updateStoreInventory(editTarget.id, {
        minimum_quantity: Number(editForm.minimum_quantity) || 0,
        maximum_quantity: editForm.maximum_quantity
          ? Number(editForm.maximum_quantity)
          : null,
        bin_location: editForm.bin_location,
      });
      setEditDialog(false);
      showSuccess('Inventory settings updated successfully.');
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openDeleteDialog = (inv: SalesChannelInventory) => {
    setDeleteTarget(inv);
    setDeleteDialog(true);
  };

  const handleDeleteInventory = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      await storeInventoryService.deleteStoreInventory(deleteTarget.id);
      setDeleteDialog(false);
      showSuccess(
        `Inventory record for "${deleteTarget.product_name}" removed.`
      );
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openTransferDialog = (inv?: SalesChannelInventory) => {
    setTransferForm({
      source_channel: inv ? String(inv.sales_channel) : '',
      destination_channel: '',
      product: inv ? String(inv.product) : '',
      quantity: '',
      notes: '',
    });
    setTransferDialog(true);
  };

  const handleSwapTransferChannels = () => {
    if (!transferForm.source_channel || !transferForm.destination_channel) return;

    const nextSource = transferForm.destination_channel;
    const selectedProductHasStockInNextSource =
      transferForm.product &&
      inventories.some(
        inv =>
          inv.sales_channel === Number(nextSource) &&
          inv.product === Number(transferForm.product) &&
          inv.available_quantity > 0
      );

    setTransferForm({
      ...transferForm,
      source_channel: nextSource,
      destination_channel: transferForm.source_channel,
      product: selectedProductHasStockInNextSource ? transferForm.product : '',
      quantity: selectedProductHasStockInNextSource ? transferForm.quantity : '',
    });
  };

  const handleTransfer = async () => {
    if (
      !transferForm.source_channel ||
      !transferForm.destination_channel ||
      !transferForm.product ||
      !transferForm.quantity
    )
      return;
    if (transferForm.source_channel === transferForm.destination_channel) {
      showError('Source and destination channels must be different.');
      return;
    }
    if (!transferSelectedInventory) {
      showError('Selected product has no available stock in the source channel.');
      return;
    }
    if (Number(transferForm.quantity) > transferSelectedInventory.available_quantity) {
      showError('Transfer quantity is higher than available stock.');
      return;
    }
    setActionLoading(true);
    try {
      const result = await inventoryMovementService.createTransfer({
        source_channel: Number(transferForm.source_channel),
        destination_channel: Number(transferForm.destination_channel),
        product: Number(transferForm.product),
        quantity: Number(transferForm.quantity),
        notes: transferForm.notes,
      });
      setTransferDialog(false);
      const inRef = result.transfer_in_reference
        ? ' | In: ' + result.transfer_in_reference
        : '';
      showSuccess(
        'Transfer created! Out: ' + result.transfer_out_reference + inRef
      );
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openMovementDialog = () => {
    setMovementForm({
      sales_channel: '',
      product: '',
      movement_type: 'PURCHASE',
      quantity: '',
      unit_cost: '',
      notes: '',
    });
    setMovementDialog(true);
  };

  const handleRecordMovement = async () => {
    if (
      !movementForm.sales_channel ||
      !movementForm.product ||
      !movementForm.quantity
    )
      return;
    setActionLoading(true);
    try {
      const result = await inventoryMovementService.createMovement({
        sales_channel: Number(movementForm.sales_channel),
        product: Number(movementForm.product),
        movement_type: movementForm.movement_type,
        quantity: Number(movementForm.quantity),
        unit_cost: movementForm.unit_cost
          ? Number(movementForm.unit_cost)
          : undefined,
        notes: movementForm.notes,
      });
      setMovementDialog(false);
      showSuccess(`Movement recorded: ${result.reference_number}`);
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openCompleteDialog = (mov: InventoryMovement) => {
    setCompleteTarget(mov);
    setCompleteNotes('');
    setCompleteDialog(true);
  };

  const handleCompleteMovement = async () => {
    if (!completeTarget) return;
    setActionLoading(true);
    try {
      await inventoryMovementService.completeMovement(
        completeTarget.id,
        completeNotes || undefined
      );
      setCompleteDialog(false);
      showSuccess(`Movement ${completeTarget.reference_number} completed.`);
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-2">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-muted-foreground text-sm">
            Control stock levels, adjust quantities, and transfer between channels
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Stock
          </Button>
          <Button size="sm" variant="outline" onClick={openBulkDialog}>
            <PackagePlus className="h-4 w-4 mr-1.5" /> Bulk Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openTransferDialog()}
          >
            <ArrowRightLeft className="h-4 w-4 mr-1.5" /> Transfer
          </Button>
          <Button size="sm" variant="outline" onClick={openMovementDialog}>
            <ArrowUpDown className="h-4 w-4 mr-1.5" /> Record Movement
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total SKUs</p>
                <p className="text-2xl font-semibold">{totalProducts}</p>
              </div>
            </Card>
            <Card className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-md bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Quantity</p>
                <p className="text-2xl font-semibold">
                  {totalQty.toLocaleString()}
                </p>
              </div>
            </Card>
            <Card
              className="p-4 flex items-start gap-3 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                setStockFilter('low');
                setActiveTab('inventory');
              }}
            >
              <div className="p-2 rounded-md bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock Items</p>
                <p className="text-2xl font-semibold">{lowStock.length}</p>
              </div>
            </Card>
            <Card
              className="p-4 flex items-start gap-3 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => {
                setStockFilter('out');
                setActiveTab('inventory');
              }}
            >
              <div className="p-2 rounded-md bg-red-500/10">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-semibold">{outOfStock}</p>
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Barcode stock lookup</p>
                <p className="text-xs text-muted-foreground">
                  Scan a product barcode to open its stock in every active sales point.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-2xl">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inventoryBarcodeInputRef}
                    className="pl-9"
                    value={inventoryBarcodeQuery}
                    onChange={e => setInventoryBarcodeQuery(e.target.value)}
                    onKeyDown={handleInventoryBarcodeKeyDown}
                    placeholder="Scan barcode here..."
                    disabled={inventoryBarcodeLoading}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => void openProductInventoryLookup(inventoryBarcodeQuery)}
                  disabled={inventoryBarcodeLoading || !inventoryBarcodeQuery.trim()}
                >
                  {inventoryBarcodeLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-1.5" />
                  )}
                  Show Stock
                </Button>
              </div>
            </div>
            {inventoryBarcodeFeedback && (
              <p className="mt-2 text-xs text-muted-foreground">
                {inventoryBarcodeFeedback}
              </p>
            )}
          </Card>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={value =>
          setActiveTab(value as InventoryTab)
        }
      >
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="inventory">
              <Package className="h-4 w-4 mr-1.5" /> Stock Levels
            </TabsTrigger>
            <TabsTrigger value="packs">
              <PackageCheck className="h-4 w-4 mr-1.5" /> Pack Availability (
              {packAvailabilityRows.length})
            </TabsTrigger>
            <TabsTrigger value="movements">
              <ArrowUpDown className="h-4 w-4 mr-1.5" /> Movements (
              {summary?.total_movements ?? movements.length})
            </TabsTrigger>
            <TabsTrigger value="low-stock">
              <AlertTriangle className="h-4 w-4 mr-1.5" /> Low Stock (
              {lowStock.length})
            </TabsTrigger>
            <TabsTrigger value="daily-out">
              <TrendingDown className="h-4 w-4 mr-1.5" /> Daily Stock Out
            </TabsTrigger>
            <TabsTrigger value="demand">
              <BarChart3 className="h-4 w-4 mr-1.5" /> Order Demand
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Filters (shared row) ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <div className="flex-1 min-w-[200px] max-w-sm">
            <Label className="text-xs text-muted-foreground mb-1 block">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Product, channel, barcode…"
                className="pl-9"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="w-[180px]">
            <Label className="text-xs text-muted-foreground mb-1 block">
              Channel
            </Label>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {channels.map(ch => (
                  <SelectItem key={ch.id} value={String(ch.id)}>
                    {ch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TabFilters
            activeTab={activeTab}
            stockFilter={stockFilter}
            setStockFilter={setStockFilter}
            movementTypeFilter={movementTypeFilter}
            setMovementTypeFilter={setMovementTypeFilter}
            movementStatusFilter={movementStatusFilter}
            setMovementStatusFilter={setMovementStatusFilter}
            movementDateFrom={movementDateFrom}
            setMovementDateFrom={setMovementDateFrom}
            movementDateTo={movementDateTo}
            setMovementDateTo={setMovementDateTo}
          />

          {hasActiveFilters(
            searchQuery,
            channelFilter,
            stockFilter,
            movementTypeFilter,
            movementStatusFilter
          ) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setChannelFilter('all');
                setStockFilter('all');
                setMovementTypeFilter('all');
                setMovementStatusFilter('all');
              }}
            >
              <Filter className="h-4 w-4 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* ── TAB: Stock Levels ────────────────────────────────────────── */}
        <TabsContent value="inventory" className="mt-4 space-y-4">
          {selectedInvIds.size > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">
                {selectedInvIds.size} selected
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedInvIds(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={bulkDeleteSelected}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1.5" />
                  )}
                  Delete selected
                </Button>
              </div>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer align-middle"
                      aria-label="Select all on this page"
                      checked={
                        paginatedInventories.length > 0 &&
                        paginatedInventories.every(i => selectedInvIds.has(i.id))
                      }
                      onChange={e => {
                        const pageIds = paginatedInventories.map(i => i.id);
                        setSelectedInvIds(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) pageIds.forEach(id => next.add(id));
                          else pageIds.forEach(id => next.delete(id));
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      {searchQuery || channelFilter !== 'all' || stockFilter !== 'all' ? (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Filter className="h-10 w-10 opacity-30" />
                          <p className="text-sm font-medium">No items match the current filters</p>
                          <p className="text-xs">Try adjusting or clearing your filters</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1"
                            onClick={() => {
                              setSearchQuery('');
                              setChannelFilter('all');
                              setStockFilter('all');
                            }}
                          >
                            <Filter className="h-4 w-4 mr-1" /> Clear filters
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Package className="h-10 w-10 opacity-30" />
                          <p className="text-sm">No inventory records found</p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1"
                            onClick={openAddDialog}
                          >
                            <Plus className="h-4 w-4 mr-1" /> Add your first stock record
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedInventories.map(inv => (
                    <TableRow
                      key={inv.id}
                      className="group"
                      data-state={selectedInvIds.has(inv.id) ? 'selected' : undefined}
                    >
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer align-middle"
                          checked={selectedInvIds.has(inv.id)}
                          onChange={() => toggleInvSelected(inv.id)}
                          aria-label={`Select ${inv.product_name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {inv.product_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {inv.product_barcode}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {inv.sales_channel_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {inv.sales_channel_code ?? ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inv.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inv.reserved_quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {inv.available_quantity}
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv.bin_location || '—'}
                      </TableCell>
                      <TableCell>{stockStatusBadge(inv)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setViewInventory(inv)}
                            >
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openAdjustDialog(inv)}
                            >
                              <PackagePlus className="h-4 w-4 mr-2" /> Adjust
                              Stock
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openEditDialog(inv)}
                            >
                              <Pencil className="h-4 w-4 mr-2" /> Edit Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openTransferDialog(inv)}
                            >
                              <ArrowRightLeft className="h-4 w-4 mr-2" />{' '}
                              Transfer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => openDeleteDialog(inv)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete Record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination footer — only when there's at least one row in the
                filtered set, otherwise the empty-state already explains it. */}
            {filteredInventories.length > 0 && (
              <div className="flex flex-col gap-3 border-t px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground tabular-nums">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {(safeInventoryPage - 1) * inventoryPageSize + 1}
                    –
                    {Math.min(safeInventoryPage * inventoryPageSize, filteredInventories.length)}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium text-foreground">{filteredInventories.length}</span>{' '}
                  rows
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-muted-foreground">Rows per page</Label>
                    <Select
                      value={String(inventoryPageSize)}
                      onValueChange={v => setInventoryPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100, 200].map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      disabled={safeInventoryPage <= 1}
                      onClick={() => setInventoryPage(p => Math.max(1, p - 1))}
                    >
                      ‹ Prev
                    </Button>
                    <span className="px-2 tabular-nums text-muted-foreground">
                      Page <span className="font-medium text-foreground">{safeInventoryPage}</span> /{' '}
                      {inventoryTotalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      disabled={safeInventoryPage >= inventoryTotalPages}
                      onClick={() => setInventoryPage(p => Math.min(inventoryTotalPages, p + 1))}
                    >
                      Next ›
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── TAB: Pack Availability ───────────────────────────────────── */}
        <TabsContent value="packs" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-primary" />
                  Pack availability from component stock
                </h3>
                <p className="text-xs text-muted-foreground">
                  Packs are sellable products, but availability is calculated from their component stock in each sales channel.
                </p>
              </div>
              <Badge variant="secondary">
                {packAvailabilityRows.length} pack row{packAvailabilityRows.length === 1 ? '' : 's'}
              </Badge>
            </div>

            {packAvailabilityRows.length === 0 ? (
              <div className="mt-6 flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-muted-foreground">
                <PackageCheck className="h-10 w-10 opacity-30" />
                <p className="text-sm font-medium">No pack availability rows found</p>
                <p className="max-w-md text-xs">
                  Create pack products with components, or adjust the current search/channel filters.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                {packAvailabilityRows.map(row => (
                  <div key={row.key} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm truncate">{row.pack.name}</p>
                          <Badge variant="outline">Pack</Badge>
                          {row.hasProblem && (
                            <Badge variant="destructive">Stock warning</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.channel.name}{row.channel.code ? ` · ${row.channel.code}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold tabular-nums">{row.availablePacks}</p>
                        <p className="text-[11px] text-muted-foreground">packs available</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {row.components.length === 0 ? (
                        <p className="text-xs text-destructive">
                          No components configured for this pack.
                        </p>
                      ) : (
                        row.components.map(component => (
                          <div
                            key={component.id}
                            className="flex items-center justify-between gap-3 rounded bg-muted/40 px-2 py-1.5 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{component.name}</p>
                              <p className="text-muted-foreground">
                                Need {component.required} / pack{component.barcode ? ` · ${component.barcode}` : ''}
                              </p>
                            </div>
                            <Badge variant={component.missing || component.available < component.required ? 'destructive' : 'secondary'}>
                              {component.available} available
                            </Badge>
                          </div>
                        ))
                      )}
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {row.pack.name}: {row.availablePacks} packs available based on component stock.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── TAB: Movements ───────────────────────────────────────────── */}
        <TabsContent value="movements" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Order / Source</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ArrowUpDown className="h-10 w-10 opacity-30" />
                        <p className="text-sm">No movements found</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1"
                          onClick={openMovementDialog}
                        >
                          <Plus className="h-4 w-4 mr-1" /> Record a movement
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMovements.map(mov => (
                    <TableRow key={mov.id}>
                      <TableCell className="font-mono text-xs">
                        {mov.reference_number}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {mov.product_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {mov.product_barcode}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <span className="block font-mono text-xs">
                          {mov.external_reference || '\u2014'}
                        </span>
                        {mov.notes && (
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            title={mov.notes}
                          >
                            {mov.notes}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {mov.sales_channel_name}
                        <span className="block text-xs text-muted-foreground">
                          {[mov.destination_channel_name]
                            .filter(Boolean)
                            .map(n => '\u2192 ' + n)}
                        </span>
                      </TableCell>
                      <TableCell>{movementBadge(mov.movement_type)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <MovementQuantity mov={mov} />
                      </TableCell>
                      <TableCell>{statusBadge(mov.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(mov.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setViewMovement(mov)}
                            >
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
                            {mov.status === 'PENDING' && (
                              <DropdownMenuItem
                                onClick={() => openCompleteDialog(mov)}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-2" />{' '}
                                Complete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination footer (only when the filtered set is non-empty). */}
            {filteredMovements.length > 0 && (
              <div className="flex flex-col gap-3 border-t px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground tabular-nums">
                  Showing{' '}
                  <span className="font-medium text-foreground">
                    {(safeMovementPage - 1) * movementPageSize + 1}
                    –
                    {Math.min(safeMovementPage * movementPageSize, filteredMovements.length)}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium text-foreground">{filteredMovements.length}</span>{' '}
                  movements
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-muted-foreground">Rows per page</Label>
                    <Select
                      value={String(movementPageSize)}
                      onValueChange={v => setMovementPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100, 200].map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      disabled={safeMovementPage <= 1}
                      onClick={() => setMovementPage(p => Math.max(1, p - 1))}
                    >
                      ‹ Prev
                    </Button>
                    <span className="px-2 tabular-nums text-muted-foreground">
                      Page <span className="font-medium text-foreground">{safeMovementPage}</span> /{' '}
                      {movementTotalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2"
                      disabled={safeMovementPage >= movementTotalPages}
                      onClick={() => setMovementPage(p => Math.min(movementTotalPages, p + 1))}
                    >
                      Next ›
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── TAB: Low Stock ───────────────────────────────────────────── */}
        <TabsContent value="low-stock" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Deficit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <CheckCircle2 className="h-10 w-10 text-green-500 opacity-50" />
                        <p className="text-sm">All stock levels are healthy!</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  lowStock.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {inv.product_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {inv.product_barcode}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv.sales_channel_name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inv.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inv.minimum_quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-600 font-semibold">
                        {inv.quantity - inv.minimum_quantity}
                      </TableCell>
                      <TableCell>{stockStatusBadge(inv)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => openAdjustDialog(inv)}
                        >
                          <PackagePlus className="h-3 w-3 mr-1" /> Restock
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── TAB: Daily Stock Out (outgoing units on a chosen date) ────── */}
        <TabsContent value="daily-out" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Date</Label>
              <Input
                type="date"
                value={stockOutDate}
                onChange={e => setStockOutDate(e.target.value)}
                className="h-9 w-[170px]"
              />
            </div>
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Sales channel
              </Label>
              <Select
                value={stockOutChannelId}
                onValueChange={setStockOutChannelId}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {channels.map(ch => (
                    <SelectItem key={ch.id} value={String(ch.id)}>
                      {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary: grand total + per product-type totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total out</p>
              <p className="text-2xl font-semibold tabular-nums text-red-600">
                {dailyStockOut.total.toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground">
                units · {dailyStockOut.lines} lines
              </p>
            </Card>
            {dailyStockOut.byType.map(g => (
              <Card key={g.type} className="p-4">
                <p className="text-xs text-muted-foreground">{g.label}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {g.total.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">units out</p>
              </Card>
            ))}
          </div>

          {dailyStockOut.total === 0 ? (
            <Card className="p-10 text-center">
              <TrendingDown className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm font-medium">No stock went out</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Nothing left {stockOutChannelId === 'all' ? 'any channel' : 'this channel'} on{' '}
                {stockOutDate || 'the selected date'}.
              </p>
            </Card>
          ) : (
            <>
              {/* Grouped by product type: each product + its channel + qty out */}
              {dailyStockOut.byType.map(g => (
                <Card key={g.type}>
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <h3 className="text-sm font-semibold">{g.label}</h3>
                    <span className="text-xs text-muted-foreground">
                      Total out:{' '}
                      <span className="font-semibold tabular-nums text-foreground">
                        {g.total.toLocaleString()}
                      </span>
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Sales Channel</TableHead>
                        <TableHead className="text-right">Qty Out</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {r.product_name}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {r.product_barcode}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.sales_channel_name}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold text-red-600">
                            {r.qty}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              ))}

              {/* By Sales Channel — only when aggregating across channels */}
              {stockOutChannelId === 'all' && dailyStockOut.byChannel.length > 1 && (
                <Card>
                  <div className="border-b px-4 py-2.5">
                    <h3 className="text-sm font-semibold">By Sales Channel</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sales Channel</TableHead>
                        <TableHead className="text-right">Qty Out</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyStockOut.byChannel.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{c.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {c.total}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── TAB: Order Demand (stock needed across all open orders) ───── */}
        <TabsContent value="demand" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px]">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Sales channel
              </Label>
              <Select value={demandChannelId} onValueChange={setDemandChannelId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {channels.map(ch => (
                    <SelectItem key={ch.id} value={String(ch.id)}>
                      {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              Stock needed to fulfil all <span className="font-medium">open</span>{' '}
              orders (confirmed &amp; preparing). When an order is completed it
              leaves this total — its consumption moves to the Daily Stock Out /
              Movements history.
            </p>
          </div>

          {demandLoading ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto h-6 w-6 animate-spin opacity-50" />
              <p className="mt-2">Calculating demand…</p>
            </Card>
          ) : !demand || demand.rows.length === 0 ? (
            <Card className="p-10 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-500 opacity-50" />
              <p className="mt-3 text-sm font-medium">No open-order demand</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                There are no confirmed / preparing orders needing stock
                {demandChannelId === 'all' ? '' : ' on this channel'}.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Open orders', value: demand.totals.open_orders, red: false },
                  { label: 'Products needed', value: demand.totals.products, red: false },
                  { label: 'Short products', value: demand.totals.short_products, red: true },
                  { label: 'Total shortfall', value: demand.totals.total_shortfall, red: true },
                ].map(c => (
                  <Card key={c.label} className="p-4">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        c.red && c.value > 0 ? 'text-red-600' : ''
                      }`}
                    >
                      {c.value.toLocaleString()}
                    </p>
                  </Card>
                ))}
              </div>

              <Card>
                <div className="max-h-[520px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">In orders</TableHead>
                        <TableHead className="text-right">Required</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Shortfall</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demand.rows.map(r => (
                        <TableRow
                          key={r.product_id}
                          className={r.shortfall > 0 ? 'bg-red-50/40 dark:bg-red-950/10' : ''}
                        >
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {r.product_name}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {r.barcode}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.order_count}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {r.required}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {r.available}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {r.shortfall > 0 ? (
                              <span className="text-red-600">-{r.shortfall}</span>
                            ) : (
                              <span className="text-green-600">OK</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

      </Tabs>

      {/* ── Product Inventory Lookup Dialog ────────────────────────────── */}
      <Dialog
        open={!!viewProductInventory}
        onOpenChange={open => {
          if (!open) setViewProductInventory(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Product Stock Across Sales Points</DialogTitle>
            <DialogDescription>
              Inventory result from barcode scan
            </DialogDescription>
          </DialogHeader>
          {viewProductInventory && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center">
                {viewProductInventory.image_url ? (
                  <img
                    src={viewProductInventory.image_url}
                    alt={viewProductInventory.name}
                    className="h-16 w-16 rounded-md border bg-background object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-background">
                    <Package className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">
                    {viewProductInventory.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Barcode:{' '}
                    <span className="font-mono">
                      {viewProductInventory.barcode || 'No barcode'}
                    </span>
                    {viewProductInventory.brand_name
                      ? ` · ${viewProductInventory.brand_name}`
                      : ''}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[300px]">
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-[11px] text-muted-foreground">Total</p>
                    <p className="font-semibold">{productInventoryTotals.quantity}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-[11px] text-muted-foreground">Reserved</p>
                    <p className="font-semibold">{productInventoryTotals.reserved}</p>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-[11px] text-muted-foreground">Available</p>
                    <p className="font-semibold text-emerald-600">
                      {productInventoryTotals.available}
                    </p>
                  </div>
                </div>
              </div>

              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sales Point</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productInventoryRows.map(({ channel, inventory }) => (
                      <TableRow key={channel.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{channel.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {channel.code || channel.city || 'No code'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {channel.channel_type_display || channel.channel_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {inventory?.quantity ?? 0}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {inventory?.reserved_quantity ?? 0}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">
                          {inventory?.available_quantity ?? 0}
                        </TableCell>
                        <TableCell className="text-sm">
                          {inventory?.bin_location || '—'}
                        </TableCell>
                        <TableCell>
                          {inventory ? (
                            stockStatusBadge(inventory)
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              No stock row
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {inventory ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setViewProductInventory(null);
                                    setViewInventory(inventory);
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-2" /> View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setViewProductInventory(null);
                                    openAdjustDialog(inventory);
                                  }}
                                >
                                  <PackagePlus className="h-4 w-4 mr-2" /> Adjust Stock
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setViewProductInventory(null);
                                    openTransferDialog(inventory);
                                  }}
                                >
                                  <ArrowRightLeft className="h-4 w-4 mr-2" /> Transfer
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                openAddDialogForProductChannel(
                                  viewProductInventory,
                                  channel.id
                                )
                              }
                            >
                              <Plus className="h-4 w-4 mr-1" /> Add
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewProductInventory(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inventory Detail Dialog ────────────────────────────────────── */}
      <Dialog
        open={!!viewInventory}
        onOpenChange={() => setViewInventory(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>Inventory Detail</DialogTitle>
            <DialogDescription>
              Stock information for this product / channel pair
            </DialogDescription>
          </DialogHeader>
          {viewInventory && (
            <InventoryDetailContent
              inv={viewInventory}
              onAdjust={i => {
                setViewInventory(null);
                openAdjustDialog(i);
              }}
              onTransfer={i => {
                setViewInventory(null);
                openTransferDialog(i);
              }}
              onEdit={i => {
                setViewInventory(null);
                openEditDialog(i);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Movement Detail Dialog ─────────────────────────────────────── */}
      <Dialog open={!!viewMovement} onOpenChange={() => setViewMovement(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>Movement Detail</DialogTitle>
            <DialogDescription>
              Reference: {viewMovement?.reference_number}
            </DialogDescription>
          </DialogHeader>
          {viewMovement && (
            <MovementDetailContent
              mov={viewMovement}
              onComplete={m => {
                setViewMovement(null);
                openCompleteDialog(m);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add Stock / Inventory Record ───────────────────────────────── */}
      {/* Bulk add / update stock — scan/search to add, set qty + min/max/bin */}
      <Dialog open={bulkDialog} onOpenChange={setBulkDialog}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b p-4 sm:p-5">
            <DialogTitle>Bulk add / update stock</DialogTitle>
            <DialogDescription>
              Pick a channel, scan or search products to add rows, then set each
              quantity (and optional min / max / bin) and save them all at once.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Sales channel *</Label>
                <Select value={bulkChannel} onValueChange={setBulkChannel}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a channel…" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map(ch => (
                      <SelectItem key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Scan or search product</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="h-9 pl-9"
                    placeholder="Barcode or name…"
                    value={bulkSearch}
                    onChange={e => setBulkSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleBulkScanEnter();
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
            </div>

            {bulkSearch.trim() && (
              <div className="max-h-56 divide-y overflow-auto rounded-md border">
                {bulkSearchResults.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    No products match “{bulkSearch.trim()}”.
                  </p>
                ) : (
                  bulkSearchResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addBulkProduct(p)}
                      className="flex w-full items-center gap-3 p-2 text-left hover:bg-muted/60"
                    >
                      <ProductThumb src={p.image || p.image_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.barcode || '—'}
                        </p>
                      </div>
                      <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            )}

            {bulkRows.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                No products added yet — scan or search above to add them to the batch.
              </div>
            ) : (
              <div className="space-y-2">
                {bulkRows.map((row, i) => {
                  const current = bulkRowCurrent(row.product);
                  return (
                    <div key={row.product} className="rounded-md border p-2.5">
                      <div className="flex items-center gap-3">
                        <ProductThumb src={row.product_image} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{row.product_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {row.product_barcode || '—'}
                          </p>
                        </div>
                        {bulkChannel && (
                          <span
                            className={`flex-shrink-0 rounded px-2 py-0.5 text-xs ${
                              current === null
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {current === null ? 'New' : `In stock: ${current}`}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0"
                          onClick={() => removeBulkRow(i)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-12">
                        <div className="space-y-1 sm:col-span-3">
                          <Label className="text-[11px] text-muted-foreground">Operation</Label>
                          <Select
                            value={row.mode}
                            onValueChange={v => setBulkRow(i, { mode: v as BulkRow['mode'] })}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="add">Add (+)</SelectItem>
                              <SelectItem value="subtract">Remove (−)</SelectItem>
                              <SelectItem value="set">Set to</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Qty *</Label>
                          <Input
                            type="number" min={0} className="h-8"
                            value={row.quantity}
                            onChange={e => setBulkRow(i, { quantity: e.target.value })}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Min</Label>
                          <Input
                            type="number" min={0} className="h-8"
                            value={row.minimum_quantity}
                            onChange={e => setBulkRow(i, { minimum_quantity: e.target.value })}
                            placeholder="—"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Max</Label>
                          <Input
                            type="number" min={0} className="h-8"
                            value={row.maximum_quantity}
                            onChange={e => setBulkRow(i, { maximum_quantity: e.target.value })}
                            placeholder="—"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-3">
                          <Label className="text-[11px] text-muted-foreground">Bin</Label>
                          <Input
                            className="h-8"
                            value={row.bin_location}
                            onChange={e => setBulkRow(i, { bin_location: e.target.value })}
                            placeholder="—"
                          />
                        </div>
                      </div>
                      {bulkChannel && row.quantity !== '' && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          New on-hand:{' '}
                          <span className="font-semibold tabular-nums text-foreground">
                            {bulkRowResult(row)}
                          </span>
                          {row.mode !== 'set' && current !== null && (
                            <span> (was {current})</span>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t p-4 sm:p-5">
            <Button variant="outline" onClick={() => setBulkDialog(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button onClick={saveBulk} disabled={bulkSaving || bulkRows.length === 0}>
              {bulkSaving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <PackagePlus className="h-4 w-4 mr-1.5" />
              )}
              Save {bulkRows.length || ''} row{bulkRows.length === 1 ? '' : 's'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" /> Add Stock
            </DialogTitle>
            <DialogDescription>
              Scan a barcode or search a product, then add the received stock quantity.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 mt-2">
            <div>
              <Label>
                Sales Channel <span className="text-destructive">*</span>
              </Label>
              <Select
                value={addForm.sales_channel}
                onValueChange={v =>
                  setAddForm({ ...addForm, sales_channel: v })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {channels
                    .filter(c => c.is_active)
                    .map(ch => (
                      <SelectItem key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Product <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={addProductSearch}
                    onChange={e => {
                      setAddProductSearch(e.target.value);
                      setAddScanFeedback('');
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddBarcodeSubmit();
                      }
                    }}
                    placeholder="Search product or scan barcode..."
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setAddScanOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                  Scan
                </Button>
              </div>

              {addScanFeedback && (
                <p
                  className={`text-xs ${
                    addScanFeedback.startsWith('No product')
                      ? 'text-destructive'
                      : 'text-emerald-600'
                  }`}
                >
                  {addScanFeedback}
                </p>
              )}

              <div className="max-h-56 overflow-y-auto rounded-md border bg-background">
                {addPickerLoading && filteredAddProducts.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Searching…
                  </div>
                ) : filteredAddProducts.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No product found. Try another name or scan the barcode.
                  </div>
                ) : (
                  filteredAddProducts.map(product => {
                    const isSelected = String(product.id) === addForm.product;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => selectProductForAdd(product)}
                        className={`flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">
                              {product.barcode || 'No barcode'}
                            </span>
                            {product.brand_name ? ` · ${product.brand_name}` : ''}
                          </p>
                        </div>
                        {isSelected && (
                          <Badge variant="secondary" className="shrink-0">
                            Selected
                          </Badge>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {selectedAddProduct && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {selectedAddProduct.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">
                          {selectedAddProduct.barcode || 'No barcode'}
                        </span>
                        {selectedAddProduct.brand_name
                          ? ` · ${selectedAddProduct.brand_name}`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={addExistingInventory ? 'default' : 'outline'}>
                      {addExistingInventory
                        ? `Current stock ${addExistingInventory.quantity}`
                        : 'New stock record'}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>
                  Quantity to add <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  className="mt-1"
                  placeholder="e.g. 24"
                  value={addForm.quantity}
                  onChange={e =>
                    setAddForm({ ...addForm, quantity: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Min Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  className="mt-1"
                  value={addForm.minimum_quantity}
                  onChange={e =>
                    setAddForm({ ...addForm, minimum_quantity: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Max Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  className="mt-1"
                  placeholder="Optional"
                  value={addForm.maximum_quantity}
                  onChange={e =>
                    setAddForm({ ...addForm, maximum_quantity: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label>Bin Location</Label>
              <Input
                className="mt-1"
                placeholder="e.g. A1-B2"
                value={addForm.bin_location}
                onChange={e =>
                  setAddForm({ ...addForm, bin_location: e.target.value })
                }
              />
              {addExistingInventory && addForm.bin_location && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This quick add increases stock. Bin settings can still be edited from
                  the inventory row.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddInventory}
              disabled={
                actionLoading ||
                !addForm.sales_channel ||
                !addForm.product ||
                !addForm.quantity ||
                Number(addForm.quantity) <= 0
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <PackagePlus className="h-4 w-4 mr-1" />
              )}
              {addExistingInventory ? 'Add to Stock' : 'Create Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <POSCameraScanner
        open={addScanOpen}
        onOpenChange={setAddScanOpen}
        onBarcodeDetected={barcode => {
          void findProductByBarcode(barcode);
          setAddScanOpen(false);
        }}
        feedbackMessage={addScanFeedback || null}
        feedbackType={
          addScanFeedback
            ? addScanFeedback.startsWith('No product')
              ? 'error'
              : 'success'
            : null
        }
      />

      {/* ── Adjust Stock Dialog ────────────────────────────────────────── */}
      <Dialog open={adjustDialog} onOpenChange={setAdjustDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" /> Adjust Stock
            </DialogTitle>
            <DialogDescription>
              {adjustTarget
                ? `${adjustTarget.product_name} @ ${adjustTarget.sales_channel_name}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {adjustTarget && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <span className="text-sm text-muted-foreground">
                  Current Quantity
                </span>
                <span className="text-2xl font-bold">
                  {adjustTarget.quantity}
                </span>
              </div>
              <div>
                <Label>Adjustment Type</Label>
                <Select
                  value={adjustForm.movement_type}
                  onValueChange={v =>
                    setAdjustForm({
                      ...adjustForm,
                      movement_type: v as 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT',
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADJUSTMENT_IN">
                      <span className="flex items-center gap-2">
                        <PackagePlus className="h-4 w-4 text-green-600" /> Add
                        Stock (In)
                      </span>
                    </SelectItem>
                    <SelectItem value="ADJUSTMENT_OUT">
                      <span className="flex items-center gap-2">
                        <PackageMinus className="h-4 w-4 text-red-600" /> Remove
                        Stock (Out)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  className="mt-1"
                  placeholder="Enter quantity to adjust"
                  value={adjustForm.quantity_change}
                  onChange={e =>
                    setAdjustForm({
                      ...adjustForm,
                      quantity_change: e.target.value,
                    })
                  }
                />
                {adjustForm.quantity_change && (
                  <p className="text-xs text-muted-foreground mt-1">
                    New quantity will be:{' '}
                    <span className="font-semibold">
                      {adjustForm.movement_type === 'ADJUSTMENT_IN'
                        ? adjustTarget.quantity +
                          Number(adjustForm.quantity_change)
                        : Math.max(
                            0,
                            adjustTarget.quantity -
                              Number(adjustForm.quantity_change)
                          )}
                    </span>
                  </p>
                )}
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  className="mt-1"
                  placeholder="Reason for adjustment (optional)"
                  rows={2}
                  value={adjustForm.notes}
                  onChange={e =>
                    setAdjustForm({ ...adjustForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAdjustDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdjustStock}
              disabled={
                actionLoading ||
                !adjustForm.quantity_change ||
                Number(adjustForm.quantity_change) <= 0
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Inventory Dialog ──────────────────────────────────────── */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" /> Edit Inventory Settings
            </DialogTitle>
            <DialogDescription>
              {editTarget
                ? `${editTarget.product_name} @ ${editTarget.sales_channel_name}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Minimum Quantity (reorder point)</Label>
              <Input
                type="number"
                min="0"
                className="mt-1"
                value={editForm.minimum_quantity}
                onChange={e =>
                  setEditForm({ ...editForm, minimum_quantity: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Maximum Quantity</Label>
              <Input
                type="number"
                min="0"
                className="mt-1"
                placeholder="Optional"
                value={editForm.maximum_quantity}
                onChange={e =>
                  setEditForm({ ...editForm, maximum_quantity: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Bin Location</Label>
              <Input
                className="mt-1"
                placeholder="e.g. A1-B2"
                value={editForm.bin_location}
                onChange={e =>
                  setEditForm({ ...editForm, bin_location: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditInventory} disabled={actionLoading}>
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────────────── */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inventory Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the stock record for{' '}
              <span className="font-semibold">
                {deleteTarget?.product_name}
              </span>{' '}
              from{' '}
              <span className="font-semibold">
                {deleteTarget?.sales_channel_name}
              </span>
              .
              <br />
              <br />
              Current quantity:{' '}
              <span className="font-mono font-semibold">
                {deleteTarget?.quantity}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteInventory}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Transfer Dialog ────────────────────────────────────────────── */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Transfer Stock
            </DialogTitle>
            <DialogDescription>
              Move stock from one channel to another
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <div>
              <Label>
                Source Channel <span className="text-destructive">*</span>
              </Label>
              <Select
                value={transferForm.source_channel}
                onValueChange={v =>
                  setTransferForm({
                    ...transferForm,
                    source_channel: v,
                    destination_channel:
                      transferForm.destination_channel === v
                        ? ''
                        : transferForm.destination_channel,
                    product: '',
                    quantity: '',
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="From channel" />
                </SelectTrigger>
                <SelectContent>
                  {channels
                    .filter(c => c.is_active)
                    .map(ch => (
                      <SelectItem key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-center sm:pb-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-1 h-10 w-10 rounded-full"
                title="Switch source and destination"
                disabled={
                  !transferForm.source_channel ||
                  !transferForm.destination_channel
                }
                onClick={handleSwapTransferChannels}
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>
            </div>
            <div>
              <Label>
                Destination Channel <span className="text-destructive">*</span>
              </Label>
              <Select
                value={transferForm.destination_channel}
                onValueChange={v =>
                  setTransferForm({ ...transferForm, destination_channel: v })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="To channel" />
                </SelectTrigger>
                <SelectContent>
                  {channels
                    .filter(
                      c =>
                        c.is_active &&
                        String(c.id) !== transferForm.source_channel
                    )
                    .map(ch => (
                      <SelectItem key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            </div>
            <div>
              <Label>
                Product <span className="text-destructive">*</span>
              </Label>
              <div className="mt-1">
                <SearchableProductSelect
                  products={transferProductOptions}
                  value={transferForm.product}
                  onChange={v =>
                    setTransferForm({
                      ...transferForm,
                      product: v,
                      quantity: '',
                    })
                  }
                  disabled={!transferForm.source_channel}
                  placeholder={
                    transferForm.source_channel
                      ? 'Scan barcode or search products available in source...'
                      : 'Select a source channel first'
                  }
                  emptyMessage="No available stock found in this source channel"
                  autoFocus={transferDialog && Boolean(transferForm.source_channel)}
                />
              </div>
              {transferForm.source_channel && transferProductOptions.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This source channel has no products with available stock.
                </p>
              )}
            </div>
            {transferSelectedInventory && (
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current stock</p>
                  <p className="text-lg font-semibold">{transferSelectedInventory.quantity}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reserved</p>
                  <p className="text-lg font-semibold">{transferSelectedInventory.reserved_quantity}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Available</p>
                  <p className="text-lg font-semibold text-emerald-600">
                    {transferSelectedInventory.available_quantity}
                  </p>
                </div>
              </div>
            )}
            {transferForm.product && transferForm.source_channel && !transferSelectedInventory && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                The selected product has no available stock in the source channel. Choose another product or source channel.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <Label>
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min="1"
                className="mt-1"
                placeholder="Quantity to transfer"
                value={transferForm.quantity}
                onChange={e =>
                  setTransferForm({ ...transferForm, quantity: e.target.value })
                }
              />
              {transferSelectedInventory &&
                Number(transferForm.quantity || 0) >
                  transferSelectedInventory.available_quantity && (
                  <p className="mt-1 text-xs text-destructive">
                    Quantity is higher than available stock.
                  </p>
                )}
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                placeholder="Optional notes"
                rows={2}
                value={transferForm.notes}
                onChange={e =>
                  setTransferForm({ ...transferForm, notes: e.target.value })
                }
              />
            </div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setTransferDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleTransfer}
              disabled={
                actionLoading ||
                !transferForm.source_channel ||
                !transferForm.destination_channel ||
                !transferForm.product ||
                !transferForm.quantity ||
                Number(transferForm.quantity) <= 0 ||
                (transferSelectedInventory
                  ? Number(transferForm.quantity) >
                    transferSelectedInventory.available_quantity
                  : true)
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-1" />
              )}
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Movement Dialog ─────────────────────────────────────── */}
      <Dialog open={movementDialog} onOpenChange={setMovementDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" /> Record Movement
            </DialogTitle>
            <DialogDescription>
              Manually record a stock movement (purchase, sale, damage, etc.)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>
                Sales Channel <span className="text-destructive">*</span>
              </Label>
              <Select
                value={movementForm.sales_channel}
                onValueChange={v =>
                  setMovementForm({ ...movementForm, sales_channel: v })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {channels
                    .filter(c => c.is_active)
                    .map(ch => (
                      <SelectItem key={ch.id} value={String(ch.id)}>
                        {ch.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>
                Product <span className="text-destructive">*</span>
              </Label>
              <div className="mt-1">
                <SearchableProductSelect
                  products={products}
                  value={movementForm.product}
                  onChange={v =>
                    setMovementForm({ ...movementForm, product: v })
                  }
                />
              </div>
            </div>
            <div>
              <Label>
                Movement Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={movementForm.movement_type}
                onValueChange={v =>
                  setMovementForm({
                    ...movementForm,
                    movement_type: v as MovementType,
                  })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PURCHASE">Purchase / Receipt</SelectItem>
                  <SelectItem value="SALE">Sale</SelectItem>
                  <SelectItem value="RETURN_IN">Customer Return</SelectItem>
                  <SelectItem value="RETURN_OUT">Return to Supplier</SelectItem>
                  <SelectItem value="ADJUSTMENT_IN">
                    Adjustment (Add)
                  </SelectItem>
                  <SelectItem value="ADJUSTMENT_OUT">
                    Adjustment (Remove)
                  </SelectItem>
                  <SelectItem value="DAMAGE">Damage / Expired</SelectItem>
                  <SelectItem value="INITIAL">Initial Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  className="mt-1"
                  value={movementForm.quantity}
                  onChange={e =>
                    setMovementForm({
                      ...movementForm,
                      quantity: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>Unit Cost</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  placeholder="Optional"
                  value={movementForm.unit_cost}
                  onChange={e =>
                    setMovementForm({
                      ...movementForm,
                      unit_cost: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                placeholder="Optional notes"
                rows={2}
                value={movementForm.notes}
                onChange={e =>
                  setMovementForm({ ...movementForm, notes: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setMovementDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRecordMovement}
              disabled={
                actionLoading ||
                !movementForm.sales_channel ||
                !movementForm.product ||
                !movementForm.quantity
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowUpDown className="h-4 w-4 mr-1" />
              )}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Complete Movement Dialog ───────────────────────────────────── */}
      <Dialog open={completeDialog} onOpenChange={setCompleteDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Complete
              Movement
            </DialogTitle>
            <DialogDescription>
              Mark{' '}
              <span className="font-mono">
                {completeTarget?.reference_number}
              </span>{' '}
              as completed?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {completeTarget && (
              <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Product:</span>{' '}
                  {completeTarget.product_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Type:</span>{' '}
                  {completeTarget.movement_type.split('_').join(' ')}
                </p>
                <p>
                  <span className="text-muted-foreground">Quantity:</span>{' '}
                  {completeTarget.quantity}
                </p>
              </div>
            )}
            <div>
              <Label>Completion Notes</Label>
              <Textarea
                className="mt-1"
                placeholder="Optional notes"
                rows={2}
                value={completeNotes}
                onChange={e => setCompleteNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCompleteDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCompleteMovement} disabled={actionLoading}>
              {actionLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Success Dialog ─────────────────────────────────────────────── */}
      <AlertDialog open={successDialog} onOpenChange={setSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" /> Success
            </AlertDialogTitle>
            <AlertDialogDescription>{successMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Error Dialog ───────────────────────────────────────────────── */}
      <AlertDialog open={errorDialog} onOpenChange={setErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> Error
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {errorMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
