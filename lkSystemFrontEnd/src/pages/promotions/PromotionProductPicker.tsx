import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Camera,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  PackageSearch,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  is_pack?: boolean;
}

export interface SelectedProductLine {
  /** Present when this line came from an existing promotion (edit mode). */
  member_id?: number | null;
  product_id: number;
  product: SelectedProductLineProduct;
  discount_type: DiscountType;
  discount_value: string;
  discount_group_id?: string | null;
  discount_group_name?: string | null;
}

interface Props {
  brandId: number | null;
  selected: SelectedProductLine[];
  onChange: (next: SelectedProductLine[]) => void;
}

type ProductTypeFilter = 'all' | 'resell_product' | 'pack';

interface CategoryOption {
  id: number | string;
  name: string;
  count: number;
}

interface ProductGroup {
  key: string;
  categoryId: CategoryOption['id'];
  name: string;
  products: ProductListItem[];
}

interface SelectedDiscountGroup {
  key: string;
  name: string;
  discount_type: DiscountType;
  discount_value: string;
  isMixed: boolean;
  lines: SelectedProductLine[];
}

const ALL_CATEGORIES_VALUE = 'all';
const UNCATEGORIZED_VALUE = 'uncategorized';

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function discountTypeLabel(type: DiscountType) {
  return type === 'percentage' ? 'Percentage' : 'Fixed';
}

function formatDiscount(type: DiscountType, value: string) {
  const numeric = Number(value);
  const displayValue = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value || '0';
  return type === 'percentage' ? `${displayValue}%` : `${displayValue} TND`;
}

function getLineGroupKey(line: SelectedProductLine) {
  return line.discount_group_id || `${line.discount_type}:${line.discount_value || '0'}`;
}

function getLineGroupName(line: SelectedProductLine) {
  return (
    line.discount_group_name ||
    `${discountTypeLabel(line.discount_type)} ${formatDiscount(line.discount_type, line.discount_value)}`
  );
}

function isSellablePromotionProduct(product: ProductListItem) {
  return product.product_type === 'resell_product' || isPackProduct(product);
}

function isPackProduct(product: ProductListItem) {
  return (
    product.product_type === 'pack' ||
    Boolean((product as ProductListItem & { is_pack?: boolean }).is_pack)
  );
}

function getPromotionProductFilterType(product: ProductListItem): ProductTypeFilter {
  return isPackProduct(product) ? 'pack' : 'resell_product';
}

function productTypeLabel(product: ProductListItem) {
  return isPackProduct(product) ? 'Pack' : 'Product';
}

function toSelectedLine(
  product: ProductListItem,
  discount_type: DiscountType = 'percentage',
  discount_value = '10',
  group?: { id: string; name: string },
): SelectedProductLine {
  return {
    product_id: product.id,
    product,
    discount_type,
    discount_value,
    discount_group_id: group?.id ?? null,
    discount_group_name: group?.name ?? null,
  };
}

function getProductCategoryEntries(product: ProductListItem) {
  const ids = product.categories ?? [];
  const names = product.category_names ?? [];

  if (ids.length === 0 && names.length === 0) {
    return [{ id: 'uncategorized' as const, name: 'Uncategorized' }];
  }

  if (ids.length > 0) {
    return ids.map((id, index) => ({
      id,
      name: names[index] || `Category #${id}`,
    }));
  }

  return names.map((name, index) => ({
    id: `name-${index}-${name}`,
    name,
  }));
}

function uniqueByProductId(products: ProductListItem[]) {
  const seen = new Set<number>();
  return products.filter(product => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

function sortPromotionProducts(products: ProductListItem[]) {
  return [...products].sort((a, b) => {
    const packSort = Number(isPackProduct(b)) - Number(isPackProduct(a));
    if (packSort !== 0) return packSort;
    return a.name.localeCompare(b.name);
  });
}

function PromotionProductPickerImpl({ brandId, selected, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [allProducts, setAllProducts] = useState<ProductListItem[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES_VALUE);
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedSelectedGroups, setExpandedSelectedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [bulkDiscountType, setBulkDiscountType] = useState<DiscountType>('percentage');
  const [bulkDiscountValue, setBulkDiscountValue] = useState('10');
  const [bulkApplyTarget, setBulkApplyTarget] = useState('all');

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!brandId) {
      setAllProducts([]);
      setLoadError(null);
      setExpandedGroups(new Set());
      setExpandedSelectedGroups(new Set());
      return;
    }

    let cancelled = false;
    setIsLoadingProducts(true);
    setLoadError(null);

    Promise.all([
      productService.getAllProducts({
        brand: brandId,
        status: 'publish',
        ordering: 'name',
      }),
      // Local packs are often created inside stock management and may not carry
      // a WooCommerce "publish" status. Fetch them explicitly so campaign
      // creation can promote packs and normal resell products together.
      productService.getAllProducts({
        brand: brandId,
        product_type: 'pack',
        ordering: 'name',
      }),
    ])
      .then(([publishedRows, packRows]) => {
        if (cancelled) return;
        const sellable = sortPromotionProducts(
          uniqueByProductId([...packRows, ...publishedRows])
            .filter(product => !product.is_deleted)
            .filter(isSellablePromotionProduct),
        );
        setAllProducts(sellable);
        setExpandedGroups(new Set(sellable.length ? ['all-products'] : []));
      })
      .catch(() => {
        if (cancelled) return;
        setAllProducts([]);
        setLoadError('Could not load products for this brand.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const selectedIds = useMemo(
    () => new Set(selected.map(s => s.product_id)),
    [selected],
  );

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const map = new Map<string, CategoryOption>();

    allProducts.forEach(product => {
      getProductCategoryEntries(product).forEach(category => {
        const key = String(category.id);
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(key, {
            id: category.id,
            name: category.name,
            count: 1,
          });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.id === 'uncategorized') return 1;
      if (b.id === 'uncategorized') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [allProducts]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(debouncedQuery);

    return allProducts.filter(product => {
      if (typeFilter !== 'all' && getPromotionProductFilterType(product) !== typeFilter) {
        return false;
      }

      if (categoryFilter !== ALL_CATEGORIES_VALUE) {
        const categories = getProductCategoryEntries(product).map(c => String(c.id));
        if (!categories.includes(categoryFilter)) return false;
      }

      if (!q) return true;

      const haystack = [
        product.name,
        product.barcode,
        product.category_names?.join(' '),
        productTypeLabel(product),
      ]
        .map(normalizeText)
        .join(' ');

      return haystack.includes(q);
    });
  }, [allProducts, categoryFilter, debouncedQuery, typeFilter]);

  const groupedProducts = useMemo<ProductGroup[]>(() => {
    if (categoryFilter !== ALL_CATEGORIES_VALUE) {
      const name =
        categoryOptions.find(c => String(c.id) === categoryFilter)?.name ??
        'Selected category';
      return [{
        key: `category-${categoryFilter}`,
        categoryId: categoryFilter === UNCATEGORIZED_VALUE
          ? 'uncategorized'
          : categoryFilter,
        name,
        products: uniqueByProductId(filteredProducts),
      }];
    }

    if (debouncedQuery || typeFilter !== 'all') {
      return [{
        key: 'filtered-products',
        categoryId: 'uncategorized',
        name: 'Filtered products',
        products: uniqueByProductId(filteredProducts),
      }];
    }

    const groups = new Map<string, ProductGroup>();

    filteredProducts.forEach(product => {
      getProductCategoryEntries(product).forEach(category => {
        const key = String(category.id);
        const existing = groups.get(key);
        if (existing) {
          existing.products.push(product);
        } else {
          groups.set(key, {
            key,
            categoryId: category.id === 'uncategorized'
              ? 'uncategorized'
              : category.id,
            name: category.name,
            products: [product],
          });
        }
      });
    });

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        products: uniqueByProductId(group.products),
      }))
      .sort((a, b) => {
        if (a.categoryId === 'uncategorized') return 1;
        if (b.categoryId === 'uncategorized') return -1;
        return a.name.localeCompare(b.name);
      });
  }, [categoryFilter, categoryOptions, debouncedQuery, filteredProducts, typeFilter]);

  const visibleProductIds = useMemo(
    () => new Set(filteredProducts.map(product => product.id)),
    [filteredProducts],
  );

  const selectedVisibleCount = useMemo(
    () => filteredProducts.filter(product => selectedIds.has(product.id)).length,
    [filteredProducts, selectedIds],
  );

  const selectedGroups = useMemo<SelectedDiscountGroup[]>(() => {
    const map = new Map<string, SelectedDiscountGroup>();

    selected.forEach(line => {
      const key = getLineGroupKey(line);
      const existing = map.get(key);

      if (existing) {
        existing.lines.push(line);
        existing.isMixed =
          existing.isMixed ||
          existing.discount_type !== line.discount_type ||
          existing.discount_value !== line.discount_value;
        return;
      }

      map.set(key, {
        key,
        name: getLineGroupName(line),
        discount_type: line.discount_type,
        discount_value: line.discount_value,
        isMixed: false,
        lines: [line],
      });
    });

    return Array.from(map.values());
  }, [selected]);

  useEffect(() => {
    if (
      bulkApplyTarget !== 'all' &&
      !selectedGroups.some(group => group.key === bulkApplyTarget)
    ) {
      setBulkApplyTarget('all');
    }
  }, [bulkApplyTarget, selectedGroups]);

  const addProducts = useCallback(
    (products: ProductListItem[], options?: {
      discount_type?: DiscountType;
      discount_value?: string;
      group_id?: string;
      group_name?: string;
    }) => {
      const next = [...selected];
      const nextIds = new Set(next.map(line => line.product_id));
      const discountType = options?.discount_type ?? bulkDiscountType;
      const discountValue = options?.discount_value ?? bulkDiscountValue;
      const groupName = options?.group_name;
      const groupId = options?.group_id;
      let added = 0;

      products.forEach(product => {
        if (nextIds.has(product.id)) return;
        next.push(toSelectedLine(
          product,
          discountType,
          discountValue,
          groupId && groupName ? { id: groupId, name: groupName } : undefined,
        ));
        nextIds.add(product.id);
        added += 1;
      });

      onChange(next);
      if (added > 0) {
        setExpandedSelectedGroups(prev =>
          new Set(prev).add(groupId || `${discountType}:${discountValue || '0'}`),
        );
      }
    },
    [bulkDiscountType, bulkDiscountValue, onChange, selected],
  );

  const removeProducts = useCallback(
    (productIds: Set<number>) => {
      onChange(selected.filter(line => !productIds.has(line.product_id)));
    },
    [onChange, selected],
  );

  const removeProduct = useCallback(
    (productId: number) => {
      onChange(selected.filter(s => s.product_id !== productId));
    },
    [onChange, selected],
  );

  const updateLine = useCallback(
    (productId: number, patch: Partial<SelectedProductLine>) => {
      const shouldRegroup =
        patch.discount_type !== undefined || patch.discount_value !== undefined;
      onChange(
        selected.map(s =>
          s.product_id === productId
            ? {
                ...s,
                ...patch,
                ...(shouldRegroup
                  ? { discount_group_id: null, discount_group_name: null }
                  : {}),
              }
            : s,
        ),
      );
    },
    [onChange, selected],
  );

  const applyBulkDiscount = useCallback(() => {
    const n = Number(bulkDiscountValue);
    if (!Number.isFinite(n) || n < 0) return;
    onChange(
      selected.map(line => {
        if (bulkApplyTarget !== 'all' && getLineGroupKey(line) !== bulkApplyTarget) {
          return line;
        }

        return {
          ...line,
          discount_type: bulkDiscountType,
          discount_value: bulkDiscountValue,
          discount_group_id: null,
          discount_group_name: null,
        };
      }),
    );
  }, [bulkApplyTarget, bulkDiscountType, bulkDiscountValue, onChange, selected]);

  const updateSelectedGroupDiscount = useCallback(
    (
      groupKey: string,
      patch: Partial<Pick<SelectedProductLine, 'discount_type' | 'discount_value'>>,
    ) => {
      onChange(
        selected.map(line => {
          if (getLineGroupKey(line) !== groupKey) return line;
          return {
            ...line,
            discount_type: patch.discount_type ?? line.discount_type,
            discount_value: patch.discount_value ?? line.discount_value,
            discount_group_id: null,
            discount_group_name: null,
          };
        }),
      );
    },
    [onChange, selected],
  );

  const removeSelectedGroup = useCallback(
    (groupKey: string) => {
      onChange(selected.filter(line => getLineGroupKey(line) !== groupKey));
      setExpandedSelectedGroups(prev => {
        const next = new Set(prev);
        next.delete(groupKey);
        return next;
      });
    },
    [onChange, selected],
  );

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleSelectedGroup = useCallback((key: string) => {
    setExpandedSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => {
    setExpandedGroups(new Set(groupedProducts.map(group => group.key)));
  }, [groupedProducts]);

  const collapseAllGroups = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  /** Resolve a scanned barcode to a product and add it (or report). */
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!barcode || !brandId) return;
      const normalizedBarcode = barcode.trim();
      const localMatch = allProducts.find(
        product => (product.barcode || '').trim() === normalizedBarcode,
      );

      if (localMatch) {
        if (selectedIds.has(localMatch.id)) {
          setScanFeedback({
            type: 'success',
            message: `"${localMatch.name}" is already selected.`,
          });
          return;
        }
        addProducts([localMatch]);
        setScanFeedback({
          type: 'success',
          message: `Added "${localMatch.name}".`,
        });
        return;
      }

      try {
        const rows = await productService.getAllProducts({
          brand: brandId,
          search: normalizedBarcode,
          page_size: 5,
        });
        const match = rows
          .filter(product => !product.is_deleted)
          .filter(isSellablePromotionProduct)
          .find(p => (p.barcode || '').trim() === normalizedBarcode) ??
          rows
            .filter(product => !product.is_deleted)
            .filter(isSellablePromotionProduct)[0];

        if (!match) {
          setScanFeedback({
            type: 'error',
            message: `No product found for barcode "${normalizedBarcode}".`,
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

        addProducts([match]);
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
    [addProducts, allProducts, brandId, selectedIds],
  );

  const resetFilters = useCallback(() => {
    setQuery('');
    setCategoryFilter(ALL_CATEGORIES_VALUE);
    setTypeFilter('all');
  }, []);

  const hasActiveFilters =
    Boolean(debouncedQuery) ||
    categoryFilter !== ALL_CATEGORIES_VALUE ||
    typeFilter !== 'all';

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(390px,0.75fr)] 2xl:grid-cols-[minmax(0,1.12fr)_minmax(430px,0.88fr)]">
      {/* Search and category selection */}
      <div className="flex min-h-0 flex-col rounded-md border bg-background shadow-sm">
        <div className="space-y-2 border-b p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Label className="text-sm font-semibold">Available products</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Use categories only to find products. Discount groups are built by value on the right.
              </p>
            </div>
            <Badge variant="secondary" className="w-fit rounded-full px-2.5">
              {filteredProducts.length} visible / {allProducts.length} total
            </Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_150px_132px_2.25rem]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={
                  brandId
                    ? 'Search name, barcode, category…'
                    : 'Pick a brand to enable product search'
                }
                disabled={!brandId}
                className="h-9 pl-9"
              />
            </div>

            <Select
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              disabled={!brandId || categoryOptions.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES_VALUE}>All categories</SelectItem>
                {categoryOptions.map(category => (
                  <SelectItem key={String(category.id)} value={String(category.id)}>
                    {category.name} ({category.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={typeFilter}
              onValueChange={value => setTypeFilter(value as ProductTypeFilter)}
              disabled={!brandId}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sellable</SelectItem>
                <SelectItem value="resell_product">Resell products</SelectItem>
                <SelectItem value="pack">Packs</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9"
              disabled={!brandId}
              onClick={() => setScannerOpen(true)}
              aria-label="Scan barcode"
              title="Scan barcode"
            >
              <Camera className="size-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1"
              disabled={!brandId || filteredProducts.length === 0}
              onClick={() => addProducts(filteredProducts)}
            >
              <CheckSquare className="size-4" />
              Add visible to discount
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={selectedVisibleCount === 0}
              onClick={() => removeProducts(visibleProductIds)}
            >
              Remove visible
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={!hasActiveFilters}
              onClick={resetFilters}
            >
              <X className="size-4" />
              Clear filters
            </Button>
            <div className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Filter className="size-3.5" />
              {selectedVisibleCount} selected in current view
            </div>
          </div>
        </div>

        <ScrollArea className="h-[min(52vh,500px)]">
          {!brandId ? (
            <PickerEmptyState
              icon={<ShoppingBag className="size-9 opacity-50" />}
              title="Select a brand first"
              description="Products and categories will load after the brand is selected."
            />
          ) : isLoadingProducts ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : loadError ? (
            <PickerEmptyState
              icon={<PackageSearch className="size-9 opacity-50" />}
              title="Products could not load"
              description={loadError}
            />
          ) : filteredProducts.length === 0 ? (
            <PickerEmptyState
              icon={<PackageSearch className="size-9 opacity-50" />}
              title="No products found"
              description="Try another search, category, or product type filter."
            />
          ) : (
            <div className="space-y-2 p-3">
              {groupedProducts.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Grouped by category for fast campaign creation.
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={expandAllGroups}
                    >
                      Expand
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={collapseAllGroups}
                    >
                      Collapse
                    </Button>
                  </div>
                </div>
              ) : null}

              {groupedProducts.map(group => {
                const selectedInGroup = group.products.filter(product =>
                  selectedIds.has(product.id),
                ).length;
                const isExpanded =
                  groupedProducts.length === 1 || expandedGroups.has(group.key);
                const groupIds = new Set(group.products.map(product => product.id));

                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-md border bg-card"
                  >
                    <div className="flex flex-col gap-2 border-b bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => toggleGroup(group.key)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {group.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {selectedInGroup}/{group.products.length} selected
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-md px-2 text-xs"
                          disabled={selectedInGroup === group.products.length}
                          onClick={() => addProducts(group.products)}
                        >
                          Add group
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-md px-2 text-xs"
                          disabled={selectedInGroup === 0}
                          onClick={() => removeProducts(groupIds)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <ul className="divide-y">
                        {group.products.map(product => {
                          const isSelected = selectedIds.has(product.id);
                          const toggleProductSelection = () => {
                            if (isSelected) {
                              removeProduct(product.id);
                            } else {
                              addProducts([product]);
                            }
                          };

                          return (
                            <li
                              key={product.id}
                              role="button"
                              tabIndex={0}
                              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                              onClick={toggleProductSelection}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  toggleProductSelection();
                                }
                              }}
                            >
                              <Checkbox
                                checked={isSelected}
                                onClick={event => event.stopPropagation()}
                                onCheckedChange={checked => {
                                  if (checked) {
                                    addProducts([product]);
                                  } else {
                                    removeProduct(product.id);
                                  }
                                }}
                                aria-label={`Select ${product.name}`}
                              />
                              <ProductImage product={product} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium leading-snug">
                                  {product.name}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {product.barcode || 'No barcode'}
                                </p>
                              </div>
                              <Badge
                                variant={isPackProduct(product) ? 'default' : 'secondary'}
                                className="inline-flex shrink-0 rounded-md px-1.5 py-0 text-[10px] capitalize"
                              >
                                {productTypeLabel(product)}
                              </Badge>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Selection and discount controls */}
      <div className="flex min-h-0 flex-col rounded-md border bg-background shadow-sm">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label className="text-sm font-semibold">
                Discount groups
                <Badge variant="secondary" className="ml-2 rounded-full text-[10px]">
                  {selected.length}
                </Badge>
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Products are grouped by discount, not by category. Example: Body can be split into 15% and 20%.
              </p>
            </div>
            {selected.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground"
                onClick={() => onChange([])}
              >
                <X className="size-3.5" /> Clear
              </Button>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px] font-medium text-muted-foreground">
                Discount tools
              </Label>
              <span className="text-[10px] text-muted-foreground">
                New selections use these values
              </span>
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(135px,1fr)_112px_minmax(88px,0.7fr)_auto]">
              <Select
                value={bulkApplyTarget}
                onValueChange={setBulkApplyTarget}
                disabled={selectedGroups.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Target" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All selected</SelectItem>
                  {selectedGroups.map(group => (
                    <SelectItem key={group.key} value={group.key}>
                      {group.name} ({group.lines.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={bulkDiscountType}
                onValueChange={value => setBulkDiscountType(value as DiscountType)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative min-w-0">
                <Input
                  type="number"
                  min={0}
                  step={bulkDiscountType === 'percentage' ? 1 : 0.01}
                  value={bulkDiscountValue}
                  onChange={e => setBulkDiscountValue(e.target.value)}
                  className="h-8 pr-12 text-xs"
                  aria-label="Bulk discount value"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase text-muted-foreground">
                  {bulkDiscountType === 'percentage' ? '%' : 'TND'}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 whitespace-nowrap rounded-md"
                disabled={selected.length === 0}
                onClick={applyBulkDiscount}
              >
                {bulkApplyTarget === 'all' ? 'Apply all' : 'Apply group'}
              </Button>
            </div>
          </div>

          {selectedGroups.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedGroups.map(group => (
                <Badge
                  key={group.key}
                  variant="outline"
                  className="rounded-full bg-muted/20 text-[10px]"
                >
                  {group.name} · {group.lines.length}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <ScrollArea className="h-[min(52vh,500px)]">
          {selected.length === 0 ? (
            <PickerEmptyState
              icon={<ShoppingBag className="size-9 opacity-50" />}
              title="No products selected"
              description="Select a category, filtered group, or scan a product barcode."
            />
          ) : (
            <div className="space-y-2 p-3">
              {selectedGroups.map(group => {
                const isExpanded =
                  selectedGroups.length === 1 || expandedSelectedGroups.has(group.key);

                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-md border bg-card"
                  >
                    <div className="border-b bg-muted/20 p-2.5">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => toggleSelectedGroup(group.key)}
                          aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <p className="max-w-full truncate text-sm font-semibold">
                              {group.name}
                            </p>
                            <Badge variant="secondary" className="rounded-full text-[10px]">
                              {group.lines.length}
                            </Badge>
                            {group.isMixed ? (
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                Mixed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full text-[10px]">
                                {formatDiscount(group.discount_type, group.discount_value)}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-[112px_minmax(0,1fr)_2rem] gap-2">
                            <Select
                              value={group.discount_type}
                              onValueChange={v =>
                                updateSelectedGroupDiscount(group.key, {
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
                            <div className="relative min-w-0">
                              <Input
                                type="number"
                                min={0}
                                step={group.discount_type === 'percentage' ? 1 : 0.01}
                                value={group.discount_value}
                                onChange={e =>
                                  updateSelectedGroupDiscount(group.key, {
                                    discount_value: e.target.value,
                                  })
                                }
                                className="h-8 pr-11 text-xs"
                                aria-label={`${group.name} discount value`}
                              />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase text-muted-foreground">
                                {group.discount_type === 'percentage' ? '%' : 'TND'}
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeSelectedGroup(group.key)}
                              aria-label={`Remove ${group.name}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded ? (
                      <ul className="divide-y">
                        {group.lines.map(line => (
                          <li key={line.product_id} className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              <ProductImage product={line.product as ProductListItem} />
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-sm font-semibold leading-snug">
                                  {line.product.name}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {line.product.barcode || 'No barcode'}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => removeProduct(line.product_id)}
                                aria-label={`Remove ${line.product.name}`}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>

                            <div className="mt-1.5 grid grid-cols-[112px_minmax(0,1fr)] gap-2 pl-10">
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
                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {line.discount_type === 'percentage' ? '%' : 'TND'}
                                </span>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
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

function ProductImage({ product }: { product: ProductListItem }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <ShoppingBag className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}

function PickerEmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-5 py-8 text-center text-sm text-muted-foreground">
      {icon}
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed">{description}</p>
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
