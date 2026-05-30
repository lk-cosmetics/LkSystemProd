import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Camera,
  Loader2,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { POSCameraScanner } from '@/pages/pos/POSCameraScanner';
import { productService } from '@/services/product.service';
import type { DiscountType, ProductListItem } from '@/types';

/** Display-only product shape — keeps the picker decoupled from the full
 *  ProductListItem so edit mode can hydrate from a PromotionGroupMember
 *  without fetching the underlying product. */
export interface SelectedProductLineProduct {
  id: number;
  name: string;
  barcode: string | null;
  image_url: string | null;
  product_type?: string;
}

export interface SelectedProductLine {
  /** Present when this line came from an existing promotion (edit mode). */
  member_id?: number | null;
  product_id: number;
  product: SelectedProductLineProduct;
  discount_type: DiscountType;
  discount_value: string;
}

interface Props {
  brandId: number | null;
  selected: SelectedProductLine[];
  onChange: (next: SelectedProductLine[]) => void;
}

function PromotionProductPickerImpl({ brandId, selected, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // Debounce search input
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Search products whenever the (debounced) query or brand changes
  useEffect(() => {
    if (!brandId) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);
    // Typeahead: deliberately capped to the first page so the dropdown
    // doesn't render hundreds of rows for an empty / very broad query.
    // ``getAllProducts`` now iterates pagination, so we use the explicit
    // single-page variant here.
    productService
      .getProductsPaginated({
        brand: brandId,
        search: debouncedQuery || undefined,
        page_size: 30,
      })
      .then(page => {
        if (cancelled) return;
        // Promotions apply to sellable items only (resell_product / pack).
        setResults(page.results.filter(
          p => p.product_type === 'resell_product' || p.product_type === 'pack',
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setSearchError('Could not load products.');
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, debouncedQuery]);

  const selectedIds = useMemo(
    () => new Set(selected.map(s => s.product_id)),
    [selected],
  );

  const addProduct = useCallback(
    (product: ProductListItem) => {
      if (selectedIds.has(product.id)) return;
      onChange([
        ...selected,
        {
          product_id: product.id,
          product,
          discount_type: 'percentage',
          discount_value: '10',
        },
      ]);
    },
    [onChange, selected, selectedIds],
  );

  const removeProduct = useCallback(
    (productId: number) => {
      onChange(selected.filter(s => s.product_id !== productId));
    },
    [onChange, selected],
  );

  const updateLine = useCallback(
    (productId: number, patch: Partial<SelectedProductLine>) => {
      onChange(
        selected.map(s =>
          s.product_id === productId ? { ...s, ...patch } : s,
        ),
      );
    },
    [onChange, selected],
  );

  /** Resolve a scanned barcode to a product and add it (or report). */
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!barcode || !brandId) return;
      try {
        const rows = await productService.getAllProducts({
          brand: brandId,
          search: barcode,
          page_size: 5,
        });
        const exact = rows.find(p => (p.barcode || '').trim() === barcode.trim());
        const match = exact ?? rows[0];
        if (!match) {
          setScanFeedback({
            type: 'error',
            message: `No product found for barcode "${barcode}".`,
          });
          return;
        }
        if (match.product_type !== 'resell_product' && match.product_type !== 'pack') {
          setScanFeedback({
            type: 'error',
            message: `"${match.name}" is not a sellable product.`,
          });
          return;
        }
        if (selectedIds.has(match.id)) {
          setScanFeedback({
            type: 'success',
            message: `"${match.name}" is already selected.`,
          });
          return;
        }
        addProduct(match);
        setScanFeedback({
          type: 'success',
          message: `Added "${match.name}".`,
        });
      } catch {
        setScanFeedback({
          type: 'error',
          message: 'Lookup failed. Try again.',
        });
      }
    },
    [addProduct, brandId, selectedIds],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      {/* ── Search column ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
        <Label className="text-sm font-medium">Available products</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={
                brandId
                  ? 'Search by name or barcode…'
                  : 'Pick a brand to enable search'
              }
              disabled={!brandId}
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!brandId}
            onClick={() => setScannerOpen(true)}
            aria-label="Scan barcode"
            title="Scan barcode"
          >
            <Camera className="size-4" />
          </Button>
        </div>

        <ScrollArea className="h-[320px] rounded-md border">
          {!brandId ? (
            <div className="flex h-full items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
              Select a brand first to browse its products.
            </div>
          ) : isSearching && results.length === 0 ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : searchError ? (
            <div className="px-4 py-8 text-center text-sm text-destructive">
              {searchError}
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <ShoppingBag className="size-8 opacity-50" />
              {debouncedQuery
                ? 'No products match your search.'
                : 'No products available for this brand yet.'}
            </div>
          ) : (
            <ul className="divide-y">
              {results.map(p => {
                const isSelected = selectedIds.has(p.id);
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ShoppingBag className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {p.barcode || '—'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isSelected ? 'secondary' : 'outline'}
                      className="gap-1"
                      disabled={isSelected}
                      onClick={() => addProduct(p)}
                    >
                      {isSelected ? (
                        'Added'
                      ) : (
                        <>
                          <Plus className="size-3.5" /> Add
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>

      {/* ── Selection column ────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-medium">
            Selected products
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {selected.length}
            </Badge>
          </Label>
          {selected.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => onChange([])}
            >
              <X className="size-3.5" /> Clear all
            </Button>
          ) : null}
        </div>

        <ScrollArea className="h-[320px] rounded-md border">
          {selected.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <ShoppingBag className="size-8 opacity-50" />
              <p>Pick products from the list, search, or scan a barcode.</p>
              <p className="text-[11px]">
                Set a discount value for each one — same promotion, different
                discounts.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {selected.map(line => (
                <li key={line.product_id} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {line.product.image_url ? (
                        <img
                          src={line.product.image_url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ShoppingBag className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {line.product.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {line.product.barcode || '—'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground"
                      onClick={() => removeProduct(line.product_id)}
                      aria-label={`Remove ${line.product.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="mt-2 grid grid-cols-[120px_1fr] gap-2">
                    <Select
                      value={line.discount_type}
                      onValueChange={v =>
                        updateLine(line.product_id, {
                          discount_type: v as DiscountType,
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        step={line.discount_type === 'percentage' ? 1 : 0.01}
                        value={line.discount_value}
                        onChange={e =>
                          updateLine(line.product_id, {
                            discount_value: e.target.value,
                          })
                        }
                        className="h-8 pr-10 text-xs"
                        aria-label="Discount value"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {line.discount_type === 'percentage' ? '%' : 'TND'}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      <POSCameraScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onBarcodeDetected={handleScan}
        feedbackMessage={scanFeedback?.message}
        feedbackType={scanFeedback?.type}
      />
    </div>
  );
}

export const PromotionProductPicker = memo(PromotionProductPickerImpl);

/** Convenience: a tiny inline loader for use during async settings transitions. */
export function ProductPickerLoading() {
  return (
    <div className="flex h-[400px] items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
    </div>
  );
}
