/**
 * ProductsPage — Product management with soft delete, barcode scanning,
 * pack/bundle support, and responsive modern UI.
 *
 * Performance optimizations:
 *   - Memoized ProductRow prevents unnecessary re-renders
 *   - Debounced search (300ms) for live table filtering
 *   - Lazy-loaded camera scanner (html5-qrcode only when dialog opens)
 *   - Stable callback refs avoid effect re-subscriptions
 *   - PackBuilder only fetches all products when pack form is open
 */
import {
  useCallback, useEffect, useState, useMemo, useRef, memo, lazy, Suspense,
} from 'react';
import {
  Eye, Pencil, Trash2, Search, MoreVertical, Package,
  Plus, RefreshCw, Globe, Loader2, Check,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RotateCcw, ScanBarcode, ExternalLink, X, Filter, Warehouse, Boxes,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuthStore } from '@/store/authStore';
import { hasRole } from '@/hooks/useAuth';
import { getMediaUrl } from '@/utils/helpers';
import { productService } from '@/services/product.service';
import {
  useProducts,
  useProductsPaginated,
  useSalesChannels,
  useBrands,
  useDeleteProduct,
  useHardDeleteProduct,
  useBulkDeleteProducts,
  useBulkHardDeleteProducts,
  useBulkRestoreProducts,
  useCreateProduct,
  usePartialUpdateProduct,
  useRestoreProduct,
  useSyncProductsFromWooCommerce,
  usePreviewProductsFromWooCommerce,
  useSyncSelectedProductsFromWooCommerce,
} from '@/hooks/queries';
import type {
  Product, ProductListItem, ProductStatus, ProductType, PackItem,
} from '@/types';

const POSCameraScanner = lazy(async () => {
  const mod = await import('./pos/POSCameraScanner');
  return { default: mod.POSCameraScanner };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = (p: string | number | null | undefined): string => {
  if (p == null || p === '') return '—';
  const n = typeof p === 'number' ? p : Number.parseFloat(p);
  return Number.isNaN(n) ? '—' : `${n.toFixed(2)} TND`;
};

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDateTime = (d: string | null | undefined): string => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
};

const STATUS_CONFIG: Record<ProductStatus, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
  publish: { variant: 'default', label: 'Published' },
  draft: { variant: 'secondary', label: 'Draft' },
  pending: { variant: 'outline', label: 'Pending' },
  private: { variant: 'outline', label: 'Private' },
};

const statusBadge = (s: ProductStatus) => {
  const cfg = STATUS_CONFIG[s] ?? { variant: 'outline' as const, label: s };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
};

const HTML_TAG_RE = /<[^>]+>/;

const normalizeErrorText = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const looksLikeHtml = trimmed.includes('<!DOCTYPE html') || HTML_TAG_RE.test(trimmed);
  const plain = looksLikeHtml
    ? trimmed
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
    : trimmed;

  if (!plain) return '';

  if (looksLikeHtml || plain.length > 320) {
    return 'Server error while processing barcode. Please retry. If it continues, contact support.';
  }

  return plain;
};

const extractErr = (error: unknown): string => {
  const fallback = 'An error occurred.';
  if (!error || typeof error !== 'object') return fallback;
  const e = error as {
    response?: { data?: Record<string, unknown> | string; status?: number };
    message?: string;
  };

  if (e.response?.status && e.response.status >= 500) {
    return 'Server error while processing barcode. Please retry in a moment.';
  }

  if (e.response?.data) {
    const d = e.response.data;
    if (typeof d === 'string') return normalizeErrorText(d) || fallback;
    const msgs = Object.entries(d).flatMap(([k, v]) => {
      const name = k.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      if (Array.isArray(v)) {
        return v
          .map(m => normalizeErrorText(String(m)))
          .filter(Boolean)
          .map(m => `${name}: ${m}`);
      }
      if (typeof v === 'string') {
        const safeMsg = normalizeErrorText(v);
        return safeMsg ? [`${name}: ${safeMsg}`] : [];
      }
      return [];
    });
    if (msgs.length) return msgs.join('\n');
    return normalizeErrorText((d.detail as string) ?? (d.message as string) ?? '') || fallback;
  }
  return normalizeErrorText(e.message ?? '') || fallback;
};

// ─── ProductRow (memoized) ────────────────────────────────────────────────────

interface RowProps {
  product: ProductListItem;
  isSelected: boolean;
  selectionMode: boolean;
  onSelect: (id: number) => void;
  onView: (p: ProductListItem) => void;
  onEdit: (p: ProductListItem) => void;
  onDelete: (p: ProductListItem) => void;
  onHardDelete: (p: ProductListItem) => void;
  onRestore: (p: ProductListItem) => void;
  onScanBarcode: (p: ProductListItem) => void;
}

const ProductRow = memo(function ProductRow({
  product: p, isSelected, selectionMode,
  onSelect, onView, onEdit, onDelete, onHardDelete, onRestore, onScanBarcode,
}: RowProps) {
  const [imgErr, setImgErr] = useState(false);
  const img = getMediaUrl(p.image_url);
  const showImg = !!img && !imgErr;

  const onRowClick = useCallback((e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('[role="checkbox"]') || t.closest('button') || t.closest('[role="menu"]') || t.closest('[role="menuitem"]')) return;
    selectionMode ? onSelect(p.id) : onView(p);
  }, [selectionMode, p, onSelect, onView]);

  return (
    <TableRow
      className={`cursor-pointer transition-colors hover:bg-muted/50
        ${isSelected ? 'bg-primary/5 hover:bg-primary/10' : ''}
        ${p.is_deleted ? 'opacity-50' : ''}`}
      onClick={onRowClick}
    >
      {/* Checkbox */}
      <TableCell className="w-10 px-3" onClick={e => e.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={() => onSelect(p.id)} />
      </TableCell>

      {/* Product name + image */}
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg overflow-hidden bg-muted flex items-center justify-center border flex-shrink-0">
            {showImg
              ? <img src={img} alt={p.name} className="size-full object-cover" loading="lazy" onError={() => setImgErr(true)} />
              : <Package className="size-4 text-muted-foreground" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-medium truncate max-w-[140px] sm:max-w-[200px] md:max-w-[260px]">{p.name}</p>
              {p.is_pack && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">Pack</Badge>}
            </div>
            {p.brand_name && <p className="text-xs text-muted-foreground truncate">{p.brand_name}</p>}
          </div>
        </div>
      </TableCell>

      {/* Barcode */}
      <TableCell className="min-w-[150px]">
        <span className="text-sm font-mono text-muted-foreground">{p.barcode || '—'}</span>
      </TableCell>

      {/* Type */}
      <TableCell className="min-w-[110px]">
        <Badge variant="outline" className="capitalize text-xs">{p.product_type}</Badge>
      </TableCell>

      {/* Purchase price */}
      <TableCell className="text-right min-w-[120px] tabular-nums">{fmtPrice(p.purchase_price)}</TableCell>

      {/* Sales price */}
      <TableCell className="text-right font-medium min-w-[120px] tabular-nums">{fmtPrice(p.sales_price)}</TableCell>

      {/* Total stock */}
      <TableCell className="text-right min-w-[100px] tabular-nums">
        <Badge variant="outline" className="rounded-full">
          {Number(p.stock_total ?? 0)}
        </Badge>
      </TableCell>

      {/* Status */}
      <TableCell className="min-w-[110px]">{statusBadge(p.status)}</TableCell>

      {/* Deleted badge */}
      <TableCell className="min-w-[100px]">
        {p.is_deleted && <Badge variant="destructive" className="text-xs">Deleted</Badge>}
      </TableCell>

      {/* Created at */}
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap min-w-[110px]">
        {fmtDate(p.created_at)}
      </TableCell>

      {/* Actions — ALWAYS VISIBLE */}
      <TableCell className="text-right pr-3 w-14 sticky right-0 bg-card border-l" onClick={e => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 bg-background border border-border/70 shadow-sm hover:bg-accent opacity-100"
            >
              <MoreVertical className="size-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onView(p)} className="gap-2">
              <Eye className="size-4" /> View Details
            </DropdownMenuItem>
            {!p.is_deleted && (
              <>
                <DropdownMenuItem onClick={() => onEdit(p)} className="gap-2">
                  <Pencil className="size-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onScanBarcode(p)} className="gap-2">
                  <ScanBarcode className="size-4" /> Scan Barcode
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(p)} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="size-4" /> Soft Delete
                </DropdownMenuItem>
              </>
            )}
            {p.is_deleted && (
              <>
                <DropdownMenuItem onClick={() => onRestore(p)} className="gap-2 text-green-600 focus:text-green-600">
                  <RotateCcw className="size-4" /> Restore
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onHardDelete(p)} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="size-4" /> Delete Permanently
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

// ─── Form data ────────────────────────────────────────────────────────────────

interface FormData {
  id?: number;
  name: string;
  barcode: string;
  brand: string;
  product_type: string;
  status: string;
  purchase_price: string;
  sales_price: string;
  image_url: string;
  product_link: string;
  is_pack: boolean;
  pack_items: PackItem[];
}

const EMPTY_FORM: FormData = {
  name: '', barcode: '', brand: '', product_type: 'resell', status: 'draft',
  purchase_price: '0.00', sales_price: '0.00', image_url: '', product_link: '',
  is_pack: false, pack_items: [],
};

// ─── ResponsiveSheet (Dialog on desktop / Drawer on mobile) ───────────────────

function ResponsiveSheet({
  open, onOpenChange, title, description, children, footer, className = '',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const mobile = useIsMobile();

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left px-4 pt-4 pb-2">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-2">{children}</div>
          {footer && <div className="flex gap-2 p-4 pt-2 border-t">{footer}</div>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[85vh] flex flex-col ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

// ─── PackBuilder — searchable product picker with images + barcode ────────────

function PackBuilder({
  form, setForm, allProducts, onScanRequest,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  /**
   * Used only to render the **names** of products already in the pack — the
   * picker itself searches the backend, so it doesn't depend on this array
   * being complete. With the iterating ``getAllProducts`` upstream this is
   * complete in practice, but the picker no longer cares.
   */
  allProducts: ProductListItem[];
  onScanRequest: () => void;
}) {
  const [packSearch, setPackSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Server-side search: debounce the input so we don't slam the API while
  // the user is typing, then call the paginated products endpoint. Backend
  // ``SearchFilter`` already covers name + barcode (icontains), so the
  // search box matches by either field.
  const debouncedSearch = useDebounce(packSearch, 250);
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);
    productService
      .getProductsPaginated({
        search: debouncedSearch.trim() || undefined,
        page_size: 50,
      })
      .then(page => {
        if (!cancelled) setResults(page.results);
      })
      .catch(() => {
        if (!cancelled) {
          setSearchError('Could not load products.');
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, debouncedSearch]);

  const usedIds = useMemo(
    () => new Set(form.pack_items.map(pi => pi.product_id)),
    [form.pack_items],
  );

  const filteredProducts = useMemo(
    () =>
      results.filter(p => !p.is_deleted && p.id !== form.id && !usedIds.has(p.id)),
    [results, form.id, usedIds],
  );

  const addProduct = useCallback((p: ProductListItem) => {
    setForm(f => ({
      ...f,
      pack_items: [...f.pack_items, { product_id: p.id, quantity: 1 }],
    }));
    setPackSearch('');
    setPickerOpen(false);
  }, [setForm]);

  const updateQty = useCallback((pid: number, qty: number) => {
    setForm(f => ({
      ...f,
      pack_items: f.pack_items.map(pi =>
        pi.product_id === pid ? { ...pi, quantity: Math.max(1, qty) } : pi
      ),
    }));
  }, [setForm]);

  const removeItem = useCallback((pid: number) => {
    setForm(f => ({ ...f, pack_items: f.pack_items.filter(pi => pi.product_id !== pid) }));
  }, [setForm]);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Pack Items</span>
          {form.pack_items.length > 0 && (
            <Badge variant="secondary" className="text-xs">{form.pack_items.length}</Badge>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onScanRequest}>
            <ScanBarcode className="size-3" /> Scan
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setPickerOpen(true); setPackSearch(''); }}>
            <Plus className="size-3" /> Add
          </Button>
        </div>
      </div>

      {/* Current items */}
      {form.pack_items.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <Package className="size-8 text-muted-foreground/40 mx-auto" />
          <p className="text-xs text-muted-foreground">No items yet. Add products or scan barcodes.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {form.pack_items.map(item => {
            const p = allProducts.find(ap => ap.id === item.product_id);
            const img = p ? getMediaUrl(p.image_url) : null;
            return (
              <div key={item.product_id} className="flex items-center gap-2.5 rounded-md border bg-background p-2 transition-colors hover:bg-muted/30">
                <div className="size-9 rounded-md overflow-hidden bg-muted flex items-center justify-center border flex-shrink-0">
                  {img ? <img src={img} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-3.5 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p?.name ?? `#${item.product_id}`}</p>
                  {p?.barcode && <p className="text-[11px] text-muted-foreground font-mono truncate">{p.barcode}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" variant="ghost" size="icon" className="size-6"
                    onClick={() => updateQty(item.product_id, item.quantity - 1)}
                    disabled={item.quantity <= 1}>
                    <span className="text-sm font-bold">−</span>
                  </Button>
                  <Input
                    type="number" min={1} value={item.quantity}
                    onChange={e => updateQty(item.product_id, parseInt(e.target.value) || 1)}
                    className="w-12 h-7 text-center text-sm p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <Button type="button" variant="ghost" size="icon" className="size-6"
                    onClick={() => updateQty(item.product_id, item.quantity + 1)}>
                    <span className="text-sm font-bold">+</span>
                  </Button>
                </div>
                <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive shrink-0"
                  onClick={() => removeItem(item.product_id)}>
                  <X className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Product Picker */}
      {pickerOpen && (
        <div className="rounded-lg border bg-background shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search by name, barcode, or brand..."
                className="pl-8 h-8 text-sm"
                value={packSearch}
                onChange={e => setPackSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setPickerOpen(false); }}
              />
            </div>
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {isSearching && results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Searching…
              </p>
            ) : searchError ? (
              <p className="text-xs text-destructive text-center py-4">
                {searchError}
              </p>
            ) : filteredProducts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {packSearch ? 'No matching products found' : 'No available products'}
              </p>
            ) : (
              filteredProducts.slice(0, 50).map(p => {
                const img = getMediaUrl(p.image_url);
                return (
                  <button
                    key={p.id} type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => addProduct(p)}
                  >
                    <div className="size-8 rounded overflow-hidden bg-muted flex items-center justify-center border flex-shrink-0">
                      {img ? <img src={img} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-3 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.barcode && <span className="font-mono">{p.barcode}</span>}
                        {p.barcode && p.brand_name && ' · '}
                        {p.brand_name}
                        {!p.barcode && !p.brand_name && '—'}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtPrice(p.sales_price)}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="p-1.5 border-t">
            <Button type="button" variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => setPickerOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toast notification ───────────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: { type: 'success' | 'error'; msg: string }; onClose: () => void }) {
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium animate-in slide-in-from-top-2 duration-300
      ${toast.type === 'success'
        ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800'
        : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'}`}
    >
      {toast.type === 'success' ? <Check className="size-4 shrink-0" /> : <X className="size-4 shrink-0" />}
      <span className="max-w-xs truncate">{toast.msg}</span>
      <Button variant="ghost" size="icon" className="size-6 -mr-1 shrink-0" onClick={onClose}><X className="size-3" /></Button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Page
// ═════════════════════════════════════════════════════════════════════════════

export default function ProductsPage() {
  const { user } = useAuthStore();
  const isMobile = useIsMobile();

  // ── Pagination & filters ──
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [brandF, setBrandF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [typeF, setTypeF] = useState('all');
  const [packF, setPackF] = useState('all'); // 'all' | 'pack' | 'single'
  const [showDeleted, setShowDeleted] = useState(false);
  const [onlyDeleted, setOnlyDeleted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Debounce search — 300ms for snappy live filtering
  useEffect(() => {
    const t = setTimeout(() => { setDebSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [brandF, statusF, typeF, packF, showDeleted, onlyDeleted]);

  // Count active filters (excluding search)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (brandF !== 'all') count++;
    if (statusF !== 'all') count++;
    if (typeF !== 'all') count++;
    if (packF !== 'all') count++;
    if (showDeleted) count++;
    if (onlyDeleted) count++;
    return count;
  }, [brandF, statusF, typeF, packF, showDeleted, onlyDeleted]);

  const qp = useMemo(() => ({
    page,
    page_size: pageSize,
    search: debSearch || undefined,
    brand: brandF !== 'all' ? Number(brandF) : undefined,
    status: (statusF !== 'all' ? statusF : undefined) as ProductStatus | undefined,
    product_type: typeF !== 'all' ? typeF : undefined,
    is_pack: packF === 'pack' ? true : packF === 'single' ? false : undefined,
    show_deleted: (showDeleted || onlyDeleted) || undefined,
    only_deleted: onlyDeleted || undefined,
  }), [page, pageSize, debSearch, brandF, statusF, typeF, packF, showDeleted, onlyDeleted]);

  // ── Data ──
  const { data: paginated, isLoading, refetch } = useProductsPaginated(qp);
  const products = paginated?.results ?? [];
  const total = paginated?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const { data: salesChannels = [] } = useSalesChannels();
  const { data: brands = [] } = useBrands();

  // ── Mutations ──
  const deleteMut = useDeleteProduct();
  const hardDeleteMut = useHardDeleteProduct();
  const bulkDeleteMut = useBulkDeleteProducts();
  const bulkHardDeleteMut = useBulkHardDeleteProducts();
  const bulkRestoreMut = useBulkRestoreProducts();
  const createMut = useCreateProduct();
  const updateMut = usePartialUpdateProduct();
  const restoreMut = useRestoreProduct();
  const syncMut = useSyncProductsFromWooCommerce();
  const previewMut = usePreviewProductsFromWooCommerce();
  const syncSelMut = useSyncSelectedProductsFromWooCommerce();

  // ── UI state ──
  const [selected, setSelected] = useState<(ProductListItem | Product) | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [toDelete, setToDelete] = useState<ProductListItem | null>(null);
  const [toHardDelete, setToHardDelete] = useState<ProductListItem | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ── Camera barcode scanner states ──
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scanFeedbackType, setScanFeedbackType] = useState<'success' | 'error' | null>(null);

  const [bcUpdateOpen, setBcUpdateOpen] = useState(false);
  const [bcUpdateProduct, setBcUpdateProduct] = useState<ProductListItem | null>(null);
  const [bcUpdateFeedback, setBcUpdateFeedback] = useState<string | null>(null);
  const [bcUpdateFeedbackType, setBcUpdateFeedbackType] = useState<'success' | 'error' | null>(null);

  const [packScanOpen, setPackScanOpen] = useState(false);
  const [packScanFeedback, setPackScanFeedback] = useState<string | null>(null);
  const [packScanFeedbackType, setPackScanFeedbackType] = useState<'success' | 'error' | null>(null);

  // ── Hardware barcode buffer ──
  const barBuf = useRef('');
  const barTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bulk selection ──
  const [selIds, setSelIds] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [bulkActionType, setBulkActionType] = useState<'soft-delete' | 'hard-delete' | 'restore' | null>(null);
  const selMode = selIds.length > 0;
  const selSet = useMemo(() => new Set(selIds), [selIds]);
  const selectedProducts = useMemo(
    () => products.filter(p => selSet.has(p.id)),
    [products, selSet],
  );
  const selectedActiveIds = useMemo(
    () => selectedProducts.filter(p => !p.is_deleted).map(p => p.id),
    [selectedProducts],
  );
  const selectedDeletedIds = useMemo(
    () => selectedProducts.filter(p => p.is_deleted).map(p => p.id),
    [selectedProducts],
  );
  const hasSelectedActive = selectedActiveIds.length > 0;
  const hasSelectedDeleted = selectedDeletedIds.length > 0;

  // ── Sync ──
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncCh, setSyncCh] = useState('');
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevData, setPrevData] = useState<{
    sales_channel: number; sales_channel_name: string;
    total_count: number; existing_count: number; new_count: number;
    products: Array<{
      wc_id: number; name: string; sku: string; price: string;
      status: string; type: string; image: string; exists_locally: boolean;
    }>;
  } | null>(null);
  const [selWc, setSelWc] = useState<number[]>([]);

  const needAllProducts = useMemo(
    () => ((addOpen || editOpen) && form.is_pack) || (viewOpen && !!selected?.is_pack),
    [addOpen, editOpen, form.is_pack, viewOpen, selected?.is_pack],
  );
  const { data: allProducts = [] } = useProducts(needAllProducts);

  const isSuperAdmin = hasRole(user, 'SuperAdmin');
  const wcCh = useMemo(() => salesChannels.filter(c => c.channel_type === 'WOOCOMMERCE'), [salesChannels]);

  // ── Auto-clear toasts ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!scanFeedback) return;
    const t = setTimeout(() => { setScanFeedback(null); setScanFeedbackType(null); }, 3000);
    return () => clearTimeout(t);
  }, [scanFeedback]);

  useEffect(() => {
    if (!bcUpdateFeedback) return;
    const t = setTimeout(() => { setBcUpdateFeedback(null); setBcUpdateFeedbackType(null); }, 3000);
    return () => clearTimeout(t);
  }, [bcUpdateFeedback]);

  useEffect(() => {
    if (!packScanFeedback) return;
    const t = setTimeout(() => { setPackScanFeedback(null); setPackScanFeedbackType(null); }, 3000);
    return () => clearTimeout(t);
  }, [packScanFeedback]);

  // ── Barcode: search product ──

  const handleSearchBarcode = useCallback(async (code: string) => {
    const local = products.find(p => p.barcode?.toLowerCase() === code.toLowerCase());
    if (local) {
      setSelected(local);
      setViewOpen(true);
      setScanOpen(false);
      setScanFeedback(`Found: ${local.name}`);
      setScanFeedbackType('success');
      setSelectedLoading(true);
      productService.getProductById(local.id)
        .then(detail => setSelected(detail))
        .catch(() => undefined)
        .finally(() => setSelectedLoading(false));
      return true;
    }
    try {
      const api = await productService.searchByBarcode(code);
      if (api) {
        setSelected(api);
        setViewOpen(true);
        setScanOpen(false);
        setScanFeedback(`Found: ${api.name}`);
        setScanFeedbackType('success');
        return true;
      }
      setScanFeedback(`Barcode "${code}" not found`);
      setScanFeedbackType('error');
      return false;
    } catch (err) {
      setScanFeedback(extractErr(err));
      setScanFeedbackType('error');
      return false;
    }
  }, [products]);

  // ── Barcode: assign to product ──

  const handleBcUpdateDetected = useCallback(async (code: string) => {
    if (!bcUpdateProduct) return;
    try {
      await updateMut.mutateAsync({ id: bcUpdateProduct.id, data: { barcode: code } });
      setBcUpdateFeedback(`Barcode "${code}" assigned to ${bcUpdateProduct.name}`);
      setBcUpdateFeedbackType('success');
      setTimeout(() => setBcUpdateOpen(false), 1200);
    } catch (err) {
      setBcUpdateFeedback(extractErr(err));
      setBcUpdateFeedbackType('error');
    }
  }, [bcUpdateProduct, updateMut]);

  // ── Barcode: add pack item by barcode ──

  const handlePackScanBarcode = useCallback(async (code: string) => {
    // Server-side lookup — relying on a pre-loaded ``allProducts`` array
    // meant any product past the first page (default page_size=20) was
    // invisible to the scan. Hit the backend with the barcode, then exact-
    // match in the (small) candidate set so a partial-match SearchFilter
    // can't smuggle in the wrong product.
    const trimmed = code.trim();
    if (!trimmed) return;
    let found: ProductListItem | undefined;
    try {
      const page = await productService.getProductsPaginated({
        search: trimmed,
        page_size: 10,
      });
      found = page.results.find(
        p => !p.is_deleted && (p.barcode || '').toLowerCase() === trimmed.toLowerCase(),
      );
    } catch {
      setPackScanFeedback('Network error while looking up barcode');
      setPackScanFeedbackType('error');
      return;
    }
    if (!found) {
      setPackScanFeedback(`Barcode "${trimmed}" not found`);
      setPackScanFeedbackType('error');
      return;
    }
    if (found.id === form.id) {
      setPackScanFeedback('A pack cannot contain itself');
      setPackScanFeedbackType('error');
      return;
    }
    const existing = form.pack_items.find(pi => pi.product_id === found!.id);
    if (existing) {
      setForm(f => ({
        ...f,
        pack_items: f.pack_items.map(pi =>
          pi.product_id === found!.id ? { ...pi, quantity: pi.quantity + 1 } : pi
        ),
      }));
      setPackScanFeedback(`+1 ${found.name} (qty: ${existing.quantity + 1})`);
      setPackScanFeedbackType('success');
    } else {
      setForm(f => ({
        ...f,
        pack_items: [...f.pack_items, { product_id: found!.id, quantity: 1 }],
      }));
      setPackScanFeedback(`Added: ${found.name}`);
      setPackScanFeedbackType('success');
    }
  }, [form.id, form.pack_items]);

  // ── Hardware barcode scanner (keyboard interception) ──

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      if (e.key === 'Enter' && barBuf.current.length >= 3) {
        const code = barBuf.current;
        barBuf.current = '';
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleSearchBarcode(code);
      } else if (e.key.length === 1) {
        barBuf.current += e.key;
        if (barTimer.current) clearTimeout(barTimer.current);
        barTimer.current = setTimeout(() => { barBuf.current = ''; }, 150);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (barTimer.current) clearTimeout(barTimer.current);
    };
  }, [handleSearchBarcode]);

  // ── CRUD actions ──

  const openView = useCallback((p: ProductListItem) => {
    setSelected(p);
    setViewOpen(true);
    setSelectedLoading(true);
    productService.getProductById(p.id)
      .then(detail => setSelected(detail))
      .catch(err => setToast({ type: 'error', msg: extractErr(err) }))
      .finally(() => setSelectedLoading(false));
  }, []);

  const openEdit = useCallback((p: ProductListItem) => {
    setForm({
      id: p.id, name: p.name, barcode: p.barcode,
      brand: p.brand ? String(p.brand) : '', product_type: p.product_type,
      status: p.status, purchase_price: p.purchase_price, sales_price: p.sales_price,
      image_url: p.image_url, product_link: p.product_link,
      is_pack: p.is_pack, pack_items: p.pack_items ?? [],
    });
    setEditOpen(true);
  }, []);

  const openDel = useCallback((p: ProductListItem) => {
    setToDelete(p);
    setDeleteOpen(true);
  }, []);

  const openHardDel = useCallback((p: ProductListItem) => {
    setToHardDelete(p);
    setHardDeleteOpen(true);
  }, []);

  const doRestore = useCallback(async (p: ProductListItem) => {
    try {
      await restoreMut.mutateAsync(p.id);
      setToast({ type: 'success', msg: `"${p.name}" restored` });
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  }, [restoreMut]);

  const openBcScan = useCallback((p: ProductListItem) => {
    setBcUpdateProduct(p);
    setBcUpdateFeedback(null);
    setBcUpdateFeedbackType(null);
    setBcUpdateOpen(true);
  }, []);

  const handleAdd = () => { setForm(EMPTY_FORM); setAddOpen(true); };
  const setF = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submitCreate = async () => {
    if (!form.name.trim()) { setToast({ type: 'error', msg: 'Name is required.' }); return; }
    if (form.is_pack && form.pack_items.length === 0) { setToast({ type: 'error', msg: 'A pack must have at least one item.' }); return; }
    try {
      await createMut.mutateAsync({
        name: form.name.trim(), barcode: form.barcode,
        product_type: form.product_type as ProductType, status: form.status as ProductStatus,
        brand: form.brand ? Number(form.brand) : undefined,
        purchase_price: form.purchase_price, sales_price: form.sales_price,
        image_url: form.image_url, product_link: form.product_link,
        is_pack: form.is_pack,
        pack_items: form.is_pack ? form.pack_items : null,
      });
      setToast({ type: 'success', msg: 'Product created!' });
      setAddOpen(false);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  };

  const submitEdit = async () => {
    if (!form.id || !form.name.trim()) { setToast({ type: 'error', msg: 'Name is required.' }); return; }
    if (form.is_pack && form.pack_items.length === 0) { setToast({ type: 'error', msg: 'A pack must have at least one item.' }); return; }
    try {
      await updateMut.mutateAsync({
        id: form.id,
        data: {
          name: form.name.trim(), barcode: form.barcode,
          product_type: form.product_type as ProductType, status: form.status as ProductStatus,
          brand: form.brand ? Number(form.brand) : null,
          purchase_price: form.purchase_price, sales_price: form.sales_price,
          image_url: form.image_url, product_link: form.product_link,
          is_pack: form.is_pack,
          pack_items: form.is_pack ? form.pack_items : null,
        },
      });
      setToast({ type: 'success', msg: 'Product updated!' });
      setEditOpen(false);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  };

  const confirmDel = async () => {
    if (!toDelete) return;
    try {
      await deleteMut.mutateAsync(toDelete.id);
      setToast({ type: 'success', msg: `"${toDelete.name}" deleted` });
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
    setDeleteOpen(false);
  };

  const confirmHardDel = async () => {
    if (!toHardDelete) return;
    try {
      await hardDeleteMut.mutateAsync(toHardDelete.id);
      setToast({ type: 'success', msg: `"${toHardDelete.name}" permanently deleted` });
      if (selected?.id === toHardDelete.id) {
        setSelected(null);
        setViewOpen(false);
      }
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
    setHardDeleteOpen(false);
  };

  const toggle = useCallback((id: number) =>
    setSelIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  , []);
  const selectAll = useCallback(() => setSelIds(products.map(p => p.id)), [products]);

  useEffect(() => {
    // Keep selection aligned with currently rendered rows after filters/page changes.
    setSelIds(prev => prev.filter(id => products.some(p => p.id === id)));
  }, [products]);

  const openBulkActionConfirm = useCallback((action: 'soft-delete' | 'hard-delete' | 'restore') => {
    setBulkActionType(action);
    setBulkActionOpen(true);
  }, []);

  const confirmBulkAction = async () => {
    if (!bulkActionType) {
      setBulkActionOpen(false);
      return;
    }

    const targetIds = bulkActionType === 'soft-delete'
      ? selectedActiveIds
      : selectedDeletedIds;

    if (targetIds.length === 0) {
      setBulkActionOpen(false);
      return;
    }

    try {
      if (bulkActionType === 'hard-delete') {
        const r = await bulkHardDeleteMut.mutateAsync(targetIds);
        setToast({
          type: r.errorCount > 0 ? 'error' : 'success',
          msg: `Permanently deleted ${r.successCount}${r.errorCount ? `, ${r.errorCount} failed` : ''}`,
        });
      } else if (bulkActionType === 'restore') {
        const r = await bulkRestoreMut.mutateAsync(targetIds);
        setToast({
          type: r.errorCount > 0 ? 'error' : 'success',
          msg: `Restored ${r.successCount}${r.errorCount ? `, ${r.errorCount} failed` : ''}`,
        });
      } else {
        const r = await bulkDeleteMut.mutateAsync(targetIds);
        setToast({ type: 'success', msg: `Deleted ${r.successCount}${r.errorCount ? `, ${r.errorCount} failed` : ''}` });
      }
      setSelIds([]);
      setBulkActionOpen(false);
      setBulkActionType(null);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
      setBulkActionOpen(false);
    }
  };

  // ── Sync ──
  const doSync = async () => {
    if (!syncCh) return;
    try {
      await syncMut.mutateAsync(Number(syncCh));
      setToast({ type: 'success', msg: 'Synced!' });
      setSyncOpen(false);
      setSyncCh('');
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
      setSyncOpen(false);
    }
  };

  const doPreview = async () => {
    if (!syncCh) return;
    try {
      const d = await previewMut.mutateAsync(Number(syncCh));
      setPrevData(d);
      setSelWc([]);
      setSyncOpen(false);
      setPrevOpen(true);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  };

  const doSyncSel = async () => {
    if (!prevData || !selWc.length) return;
    try {
      const r = await syncSelMut.mutateAsync({ salesChannelId: prevData.sales_channel, wcProductIds: selWc });
      setToast({ type: 'success', msg: `Created: ${r.created ?? 0}, Updated: ${r.updated ?? 0}` });
      setPrevOpen(false);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  };

  const doSyncAllPrev = async () => {
    if (!prevData) return;
    try {
      await syncMut.mutateAsync(prevData.sales_channel);
      setToast({ type: 'success', msg: 'All synced!' });
      setPrevOpen(false);
    } catch (e) {
      setToast({ type: 'error', msg: extractErr(e) });
    }
  };

  // Reset filters
  const clearFilters = () => {
    setBrandF('all');
    setStatusF('all');
    setTypeF('all');
    setPackF('all');
    setShowDeleted(false);
    setOnlyDeleted(false);
  };

  // ── Product form (shared between Add/Edit) ──

  const productForm = (
    <div className="space-y-5 py-2">
      <div className="space-y-1.5">
        <Label htmlFor="pf-name">Product Name <span className="text-destructive">*</span></Label>
        <Input id="pf-name" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Product name" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Barcode / SKU</Label>
          <div className="flex gap-2">
            <Input value={form.barcode} onChange={e => setF('barcode', e.target.value)} placeholder="Barcode" className="flex-1" />
            {form.id && (
              <Button
                type="button" variant="outline" size="icon" className="shrink-0"
                title="Scan barcode for this product"
                onClick={() => {
                  const p = products.find(pr => pr.id === form.id);
                  if (p) { setEditOpen(false); openBcScan(p); }
                }}
              >
                <ScanBarcode className="size-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Brand</Label>
          <Select value={form.brand || 'none'} onValueChange={v => setF('brand', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select brand" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Brand</SelectItem>
              {brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={form.product_type} onValueChange={v => setF('product_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="resell">Resell</SelectItem>
              <SelectItem value="packaging">Packaging</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setF('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="publish">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Purchase Price</Label>
          <Input type="number" step="0.01" min="0" value={form.purchase_price} onChange={e => setF('purchase_price', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Sales Price</Label>
          <Input type="number" step="0.01" min="0" value={form.sales_price} onChange={e => setF('sales_price', e.target.value)} />
        </div>
      </div>

      <Separator />

      <div className="space-y-1.5">
        <Label>Image URL</Label>
        <Input value={form.image_url} onChange={e => setF('image_url', e.target.value)} placeholder="https://..." />
        {form.image_url && (
          <div className="mt-2 flex justify-center">
            <img src={getMediaUrl(form.image_url)} alt="Preview" className="max-h-24 rounded-lg object-contain border" loading="lazy" />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Product Link</Label>
        <Input value={form.product_link} onChange={e => setF('product_link', e.target.value)} placeholder="https://..." />
      </div>

      <Separator />

      {/* Pack/Bundle Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="pf-ispack" className="text-sm font-medium">Product Pack / Bundle</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Combine multiple products into one pack</p>
        </div>
        <Switch
          id="pf-ispack"
          checked={form.is_pack}
          onCheckedChange={v => setForm(f => ({ ...f, is_pack: v, pack_items: v ? f.pack_items : [] }))}
        />
      </div>

      {form.is_pack && (
        <PackBuilder form={form} setForm={setForm} allProducts={allProducts} onScanRequest={() => setPackScanOpen(true)} />
      )}
    </div>
  );

  // ═════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4 sm:space-y-5 p-3 sm:p-6">
      {/* Toast */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Package className="size-5 sm:size-6" /> Products
          </h1>
          <p className="text-sm text-muted-foreground">
            {total} product{total !== 1 ? 's' : ''}
            {debSearch && <span className="ml-1">matching "{debSearch}"</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleAdd} className="gap-1.5">
            <Plus className="size-4" /> Add
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setScanFeedback(null); setScanOpen(true); }} className="gap-1.5">
            <ScanBarcode className="size-4" />{!isMobile && ' Scan'}
          </Button>
          <Button
            variant={onlyDeleted ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setOnlyDeleted(v => !v);
              setShowDeleted(false);
            }}
            className="gap-1.5"
          >
            <Trash2 className="size-4" />{!isMobile && ' Deleted'}
          </Button>
          {isSuperAdmin && wcCh.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)} className="gap-1.5">
              <Globe className="size-4" />{!isMobile && ' Sync'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="gap-1.5">
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Search + Filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search products by name or barcode..."
            className="pl-9 h-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <Button
              variant="ghost" size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
              onClick={() => setSearch('')}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <Button
          variant={activeFilterCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Filter className="size-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="size-5 p-0 flex items-center justify-center text-[10px] rounded-full">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Filter panel (expandable) */}
      {filtersOpen && (
        <Card className="p-3 sm:p-4 animate-in slide-in-from-top-1 duration-200">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[130px]">
              <Label className="text-xs text-muted-foreground">Brand</Label>
              <Select value={brandF} onValueChange={setBrandF}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[120px]">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusF} onValueChange={setStatusF}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="publish">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[110px]">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={typeF} onValueChange={setTypeF}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="resell">Resell</SelectItem>
                  <SelectItem value="packaging">Packaging</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[110px]">
              <Label className="text-xs text-muted-foreground">Pack</Label>
              <Select value={packF} onValueChange={setPackF}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pack">Packs Only</SelectItem>
                  <SelectItem value="single">Singles Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch
                checked={showDeleted}
                onCheckedChange={v => {
                  setShowDeleted(v);
                  if (v) setOnlyDeleted(false);
                }}
                id="show-del"
                className="scale-90"
              />
              <Label htmlFor="show-del" className="text-xs cursor-pointer whitespace-nowrap">Show Deleted</Label>
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="size-3" /> Clear all
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Bulk selection bar */}
      {selMode && (
        <div className="flex items-center gap-2 sm:gap-3 p-2.5 bg-muted/50 rounded-lg border text-sm">
          <span className="font-medium">{selIds.length} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selectAll}>All</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelIds([])}>Clear</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="destructive" className="h-7 text-xs gap-1 ml-auto">
                <Trash2 className="size-3" /> Group Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {hasSelectedActive && (
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={() => openBulkActionConfirm('soft-delete')}
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownMenuItem>
              )}
              {hasSelectedDeleted && (
                <DropdownMenuItem
                  className="gap-2 text-green-600 focus:text-green-600"
                  onClick={() => openBulkActionConfirm('restore')}
                >
                  <RotateCcw className="size-4" /> Restore
                </DropdownMenuItem>
              )}
              {hasSelectedDeleted && (
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={() => openBulkActionConfirm('hard-delete')}
                >
                  <Trash2 className="size-4" /> Delete Permanently
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[1160px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-3">
                  <Checkbox
                    checked={products.length > 0 && selIds.length === products.length}
                    onCheckedChange={c => c ? selectAll() : setSelIds([])}
                  />
                </TableHead>
                <TableHead className="min-w-[180px]">Product</TableHead>
                <TableHead className="min-w-[150px]">Barcode</TableHead>
                <TableHead className="min-w-[110px]">Type</TableHead>
                <TableHead className="text-right min-w-[120px]">Purchase</TableHead>
                <TableHead className="text-right min-w-[120px]">Sales</TableHead>
                <TableHead className="text-right min-w-[100px]">Stock</TableHead>
                <TableHead className="min-w-[110px]">Status</TableHead>
                <TableHead className="min-w-[100px] w-20" />
                <TableHead className="min-w-[110px]">Created</TableHead>
                <TableHead className="text-right w-14 sticky right-0 bg-card border-l z-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin inline-block mr-2" /> Loading products...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-16">
                    <Package className="size-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No products found</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {debSearch || activeFilterCount > 0
                        ? 'Try adjusting your search or filters'
                        : 'Create your first product to get started'}
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && products.map(p => (
                <ProductRow
                  key={p.id} product={p}
                  isSelected={selSet.has(p.id)} selectionMode={selMode}
                  onSelect={toggle} onView={openView} onEdit={openEdit}
                  onDelete={openDel} onHardDelete={openHardDel} onRestore={doRestore} onScanBarcode={openBcScan}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground text-xs sm:text-sm">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="size-8" onClick={() => setPage(1)} disabled={page === 1}>
              <ChevronsLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="flex items-center px-3 text-sm font-medium tabular-nums">{page}</span>
            <Button variant="outline" size="icon" className="size-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-8" onClick={() => setPage(totalPages)} disabled={page === totalPages}>
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════ DIALOGS ═══════════ */}

      {/* View Detail */}
      <ResponsiveSheet
        open={viewOpen} onOpenChange={setViewOpen}
        title="Product Details"
        className="sm:max-w-3xl"
        footer={selected && !selected.is_deleted ? (
          <>
            <Button variant="outline" size="sm" className="gap-1.5 flex-1 sm:flex-none" onClick={() => { if (selected) { setViewOpen(false); openBcScan(selected); } }}>
              <ScanBarcode className="size-4" /> Scan Barcode
            </Button>
            <Button size="sm" className="gap-1.5 flex-1 sm:flex-none" onClick={() => { if (selected) { setViewOpen(false); openEdit(selected); } }}>
              <Pencil className="size-4" /> Update
            </Button>
          </>
        ) : selected?.is_deleted ? (
          <Button variant="outline" size="sm" className="gap-1.5 flex-1 sm:flex-none text-green-600" onClick={() => { if (selected) { setViewOpen(false); doRestore(selected); } }}>
            <RotateCcw className="size-4" /> Restore
          </Button>
        ) : undefined}
      >
        {selected && (
          <div className="space-y-5 py-2">
            {selectedLoading && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading live stock...
              </div>
            )}
            {/* Hero image */}
            {selected.image_url && (
              <div className="relative flex justify-center rounded-xl overflow-hidden bg-muted/30 border">
                <img src={getMediaUrl(selected.image_url)} alt={selected.name} className="max-h-48 object-contain p-2" loading="lazy" />
                {selected.is_pack && (
                  <Badge variant="secondary" className="absolute top-2 left-2 text-xs">Pack</Badge>
                )}
                {selected.is_deleted && (
                  <Badge variant="destructive" className="absolute top-2 right-2 text-xs">Deleted</Badge>
                )}
              </div>
            )}
            {!selected.image_url && (selected.is_pack || selected.is_deleted) && (
              <div className="flex gap-2">
                {selected.is_pack && <Badge variant="secondary">Pack</Badge>}
                {selected.is_deleted && <Badge variant="destructive">Deleted — {fmtDateTime(selected.deleted_at)}</Badge>}
              </div>
            )}

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                <p className="font-semibold text-base">{selected.name}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Barcode</p>
                <p className="font-mono text-sm">{selected.barcode || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Brand</p>
                <p>{selected.brand_name ?? '—'}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Type</p>
                <Badge variant="outline" className="capitalize">{selected.product_type}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                {statusBadge(selected.status)}
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Purchase Price</p>
                <p className="tabular-nums">{fmtPrice(selected.purchase_price)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Sales Price</p>
                <p className="font-semibold tabular-nums">{fmtPrice(selected.sales_price)}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                <p className="text-xs">{fmtDateTime(selected.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Updated</p>
                <p className="text-xs">{fmtDateTime(selected.updated_at)}</p>
              </div>

              {selected.product_link && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-0.5">Product Link</p>
                  <a href={selected.product_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-sm break-all">
                    {selected.product_link} <ExternalLink className="size-3 shrink-0" />
                  </a>
                </div>
              )}

              {Boolean((selected as Product).category_names?.length) && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Categories</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(selected as Product).category_names?.map(name => (
                      <Badge key={name} variant="secondary" className="rounded-full">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Stock by sales point */}
            <Separator />
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Warehouse className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Stock by sales point</span>
                </div>
                <Badge variant="outline" className="w-fit gap-1.5 rounded-full px-3 tabular-nums">
                  <Boxes className="size-3.5" />
                  Total: {Number((selected as Product).stock_total ?? selected.stock_total ?? 0)}
                </Badge>
              </div>

              {((selected as Product).stock_by_channel ?? []).length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {((selected as Product).stock_by_channel ?? []).map(row => {
                    const isLow = row.available_quantity <= row.minimum_quantity;
                    const isOut = row.available_quantity <= 0;
                    return (
                      <div key={row.sales_channel_id} className="rounded-lg border bg-card p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{row.sales_channel_name}</p>
                            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                              {row.sales_channel_type || 'Sales point'}
                            </p>
                          </div>
                          <Badge variant={isOut ? 'destructive' : isLow ? 'secondary' : 'outline'} className="shrink-0">
                            {isOut ? 'Out' : isLow ? 'Low' : 'OK'}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-[11px] text-muted-foreground">Qty</p>
                            <p className="font-semibold tabular-nums">{row.quantity}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-[11px] text-muted-foreground">Reserved</p>
                            <p className="font-semibold tabular-nums">{row.reserved_quantity}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-2">
                            <p className="text-[11px] text-muted-foreground">Available</p>
                            <p className="font-semibold tabular-nums">{row.available_quantity}</p>
                          </div>
                        </div>
                        {row.bin_location && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Location: <span className="font-medium text-foreground">{row.bin_location}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                  No stock rows found for this product yet.
                </div>
              )}
            </div>

            {/* Pack Contents */}
            {selected.is_pack && selected.pack_items && selected.pack_items.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Package className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Pack Contents</span>
                    <Badge variant="secondary" className="text-xs">{selected.pack_items.length}</Badge>
                  </div>
                  <div className="rounded-lg border divide-y">
                    {selected.pack_items.map((item, idx) => {
                      const child = allProducts.find(ap => ap.id === item.product_id);
                      const img = child ? getMediaUrl(child.image_url) : null;
                      return (
                        <div key={idx} className="flex items-center gap-3 p-2.5">
                          <div className="size-9 rounded-md bg-muted flex items-center justify-center border flex-shrink-0 overflow-hidden">
                            {img ? <img src={img} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-3.5 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{child?.name ?? `Product #${item.product_id}`}</p>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              {child?.barcode && <span className="font-mono">{child.barcode}</span>}
                              {child?.sales_price && <span className="tabular-nums">{fmtPrice(child.sales_price)}</span>}
                            </div>
                          </div>
                          <Badge variant="outline" className="shrink-0 tabular-nums font-medium">×{item.quantity}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </ResponsiveSheet>

      {/* Add Product */}
      <ResponsiveSheet open={addOpen} onOpenChange={setAddOpen} title="New Product" description="Fill in the details to create a product." className="sm:max-w-lg"
        footer={<>
          <Button variant="outline" onClick={() => setAddOpen(false)} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={submitCreate} disabled={createMut.isPending} className="flex-1 sm:flex-none gap-1.5">
            {createMut.isPending && <Loader2 className="size-4 animate-spin" />} Create
          </Button>
        </>}>
        {productForm}
      </ResponsiveSheet>

      {/* Edit Product */}
      <ResponsiveSheet open={editOpen} onOpenChange={setEditOpen} title="Edit Product" description={form.name || 'Update product details'} className="sm:max-w-lg"
        footer={<>
          <Button variant="outline" onClick={() => setEditOpen(false)} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={submitEdit} disabled={updateMut.isPending} className="flex-1 sm:flex-none gap-1.5">
            {updateMut.isPending && <Loader2 className="size-4 animate-spin" />} Save Changes
          </Button>
        </>}>
        {productForm}
      </ResponsiveSheet>

      {/* Delete Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" /> Soft Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              <span className="font-medium text-foreground">"{toDelete?.name}"</span> will be marked as deleted. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5">
              <Trash2 className="size-4" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard Delete Confirm */}
      <AlertDialog open={hardDeleteOpen} onOpenChange={setHardDeleteOpen}>
        <AlertDialogContent className="max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-destructive" /> Permanent Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will permanently remove <span className="font-medium text-foreground">"{toHardDelete?.name}"</span> from database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmHardDel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            >
              <Trash2 className="size-4" /> Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Group Action */}
      <AlertDialog open={bulkActionOpen} onOpenChange={setBulkActionOpen}>
        <AlertDialogContent className="max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {bulkActionType === 'restore' ? (
                <RotateCcw className="size-5 text-green-600" />
              ) : (
                <Trash2 className="size-5 text-destructive" />
              )}
              {bulkActionType === 'hard-delete'
                ? `Permanently Delete ${selectedDeletedIds.length} Products`
                : bulkActionType === 'restore'
                  ? `Restore ${selectedDeletedIds.length} Products`
                  : `Delete ${selectedActiveIds.length} Products`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkActionType === 'hard-delete'
                ? 'All selected deleted products will be permanently removed from database. This cannot be undone.'
                : bulkActionType === 'restore'
                  ? 'All selected deleted products will be restored and available again.'
                  : 'All selected active products will be soft-deleted. You can restore them later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkAction}
              disabled={bulkDeleteMut.isPending || bulkHardDeleteMut.isPending || bulkRestoreMut.isPending}
              className={bulkActionType === 'restore'
                ? 'bg-green-600 text-white hover:bg-green-700 gap-1.5'
                : 'bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5'}
            >
              {bulkActionType === 'restore' ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />}
              {bulkActionType === 'hard-delete'
                ? 'Delete Permanently'
                : bulkActionType === 'restore'
                  ? 'Restore'
                  : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Camera Barcode scanners */}
      {(scanOpen || bcUpdateOpen || packScanOpen) && (
        <Suspense fallback={null}>
          {scanOpen && (
            <POSCameraScanner
              open={scanOpen}
              onOpenChange={setScanOpen}
              onBarcodeDetected={handleSearchBarcode}
              feedbackMessage={scanFeedback}
              feedbackType={scanFeedbackType}
            />
          )}
          {bcUpdateOpen && (
            <POSCameraScanner
              open={bcUpdateOpen}
              onOpenChange={setBcUpdateOpen}
              onBarcodeDetected={handleBcUpdateDetected}
              feedbackMessage={bcUpdateFeedback}
              feedbackType={bcUpdateFeedbackType}
            />
          )}
          {packScanOpen && (
            <POSCameraScanner
              open={packScanOpen}
              onOpenChange={setPackScanOpen}
              onBarcodeDetected={handlePackScanBarcode}
              feedbackMessage={packScanFeedback}
              feedbackType={packScanFeedbackType}
            />
          )}
        </Suspense>
      )}

      {/* WC Sync */}
      <ResponsiveSheet open={syncOpen} onOpenChange={setSyncOpen} title="WooCommerce Sync" description="Select a sales channel to sync products from." className="sm:max-w-md"
        footer={<>
          <Button variant="outline" onClick={doPreview} disabled={!syncCh || previewMut.isPending} className="flex-1 sm:flex-none gap-1.5">
            {previewMut.isPending && <Loader2 className="size-4 animate-spin" />} Preview
          </Button>
          <Button onClick={doSync} disabled={!syncCh || syncMut.isPending} className="flex-1 sm:flex-none gap-1.5">
            {syncMut.isPending && <Loader2 className="size-4 animate-spin" />} Sync All
          </Button>
        </>}>
        <div className="py-4">
          <Label className="text-sm mb-2 block">Sales Channel</Label>
          <Select value={syncCh} onValueChange={setSyncCh}>
            <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
            <SelectContent>{wcCh.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </ResponsiveSheet>

      {/* WC Preview */}
      <ResponsiveSheet open={prevOpen} onOpenChange={setPrevOpen} title="WooCommerce Preview"
        description={`${prevData?.sales_channel_name} — ${prevData?.total_count} products (${prevData?.new_count} new)`} className="sm:max-w-2xl"
        footer={<>
          <Button variant="outline" onClick={doSyncAllPrev} disabled={syncMut.isPending} className="flex-1 sm:flex-none">Sync All</Button>
          <Button onClick={doSyncSel} disabled={!selWc.length || syncSelMut.isPending} className="flex-1 sm:flex-none">Sync ({selWc.length})</Button>
        </>}>
        <div className="space-y-3 py-2">
          <div className="flex gap-2 text-xs">
            <Button size="sm" variant="outline" className="h-7" onClick={() => prevData && setSelWc(prevData.products.map(p => p.wc_id))}>Select All</Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setSelWc([])}>Clear</Button>
            <span className="text-muted-foreground self-center ml-auto">{selWc.length} selected</span>
          </div>
          <div className="border rounded-lg max-h-[45vh] overflow-y-auto divide-y">
            {prevData?.products.map(p => (
              <div key={p.wc_id} className="flex items-center gap-3 p-2.5 hover:bg-muted/50 transition-colors">
                <Checkbox checked={selWc.includes(p.wc_id)} onCheckedChange={() => setSelWc(s => s.includes(p.wc_id) ? s.filter(x => x !== p.wc_id) : [...s, p.wc_id])} />
                {p.image && <img src={p.image} alt="" className="size-9 rounded object-cover shrink-0" loading="lazy" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku || 'No SKU'} · {p.price} TND</p>
                </div>
                {p.exists_locally
                  ? <Badge variant="secondary" className="text-xs shrink-0"><Check className="size-3 mr-1" />Exists</Badge>
                  : <Badge className="text-xs bg-green-600 shrink-0">New</Badge>}
              </div>
            ))}
          </div>
        </div>
      </ResponsiveSheet>
    </div>
  );
}
