import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Factory,
  Loader2,
  MoreVertical,
  Package,
  PackageCheck,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { ResponsiveSheet } from '@/components/dialogs/ResponsiveSheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  billOfMaterialsService,
  productionBatchService,
  storeInventoryService,
} from '@/services/inventory.service';
import { productService } from '@/services/product.service';
import { salesChannelService } from '@/services/salesChannel.service';
import type {
  BillOfMaterials,
  InFactorySummary,
  ProductListItem,
  ProductionBatch,
  SalesChannel,
} from '@/types';

type ManufacturingTab = 'boms' | 'factory-stock' | 'production-orders';

type BomFormState = {
  finished_product: string;
  name: string;
  notes: string;
  items: Array<{ component: string; quantity_per_unit: string; notes: string }>;
};

type QuickPackagingFormState = {
  name: string;
  barcode: string;
  sales_channel: string;
  initial_stock: string;
  bin_location: string;
};

type SendFactoryFormState = {
  sales_channel: string;
  finished_product: string;
  planned_quantity: string;
  notes: string;
};

type ReceiveFactoryFormState = {
  received_quantity: string;
  reason: 'PRODUCTION_RETURNED' | 'LAB_RECEIVED' | 'PARTIAL_PRODUCTION_RETURNED' | 'OTHER';
  notes: string;
};

const PAGE_SIZE = 10;
const EMPTY_BOM_FORM: BomFormState = {
  finished_product: '',
  name: '',
  notes: '',
  items: [{ component: '', quantity_per_unit: '1', notes: '' }],
};

const EMPTY_PACKAGING_FORM: QuickPackagingFormState = {
  name: '',
  barcode: '',
  sales_channel: '',
  initial_stock: '',
  bin_location: '',
};

const extractErrorMessage = (error: unknown): string => {
  const fallback = 'Something went wrong. Please try again.';
  if (!error || typeof error !== 'object') return fallback;
  const err = error as { response?: { data?: unknown }; message?: string };
  const data = err.response?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const fieldErrors = Object.entries(record).flatMap(([field, messages]) => {
      const label = field
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
      if (Array.isArray(messages)) return messages.map(message => `${label}: ${message}`);
      return typeof messages === 'string' ? [`${label}: ${messages}`] : [];
    });
    if (fieldErrors.length > 0) return fieldErrors.join('\n');
    if (typeof record.detail === 'string') return record.detail;
    if (typeof record.message === 'string') return record.message;
  }
  if (typeof data === 'string') return data;
  return err.message || fallback;
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const formatQty = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

function productionStatusBadge(status: string, label?: string) {
  const statusConfig: Record<string, string> = {
    SENT_TO_FACTORY: 'border-blue-200 bg-blue-50 text-blue-700',
    PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-700',
    COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    CANCELLED: 'border-red-200 bg-red-50 text-red-700',
    DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  const icon =
    status === 'COMPLETED' ? <CheckCircle2 className="h-3 w-3" /> :
    status === 'CANCELLED' ? <XCircle className="h-3 w-3" /> :
    status === 'PARTIALLY_RECEIVED' ? <Clock className="h-3 w-3" /> :
    <Factory className="h-3 w-3" />;

  return (
    <Badge
      variant="outline"
      className={`w-fit gap-1 ${statusConfig[status] ?? 'border-muted bg-muted/40'}`}
    >
      {icon}
      {label || status.split('_').join(' ')}
    </Badge>
  );
}

function usePaginatedRows<T>(rows: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return {
    page,
    setPage,
    totalPages,
    pageRows: rows.slice((page - 1) * pageSize, page * pageSize),
  };
}

function PaginationBar({
  page,
  totalPages,
  totalRows,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t px-3 py-3 text-sm text-muted-foreground sm:gap-2 sm:px-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs sm:text-sm">
        {totalRows === 0
          ? 'No rows'
          : `Page ${page} of ${totalPages} • ${totalRows} rows`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="text-xs sm:text-sm"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="px-2 text-xs font-medium">
          {page}/{totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="text-xs sm:text-sm"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  detail,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  detail: string;
}) {
  return (
    <Card className="rounded-lg py-4">
      <CardContent className="flex items-start gap-3 px-4">
        <div className="rounded-md border bg-muted/40 p-2">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTableRow({
  colSpan,
  title,
  description,
}: {
  colSpan: number;
  title: string;
  description: string;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">
          <Package className="h-9 w-9 opacity-30" />
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs">{description}</p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ProductSearchSelect({
  products,
  value,
  onChange,
  placeholder,
  disabled = false,
  emptyMessage = 'No product found',
}: {
  products: ProductListItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState('');
  const selected = products.find(product => String(product.id) === value);
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    const rows = clean
      ? products.filter(product =>
          product.name.toLowerCase().includes(clean) ||
          (product.barcode || '').toLowerCase().includes(clean) ||
          (product.brand_name || '').toLowerCase().includes(clean)
        )
      : products;
    return rows.slice(0, 40);
  }, [products, query]);

  const selectProduct = (product: ProductListItem) => {
    onChange(String(product.id));
    setQuery('');
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          disabled={disabled}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const exactBarcode = products.find(
              product => (product.barcode || '').toLowerCase() === query.trim().toLowerCase()
            );
            if (exactBarcode) selectProduct(exactBarcode);
            else if (filtered.length === 1) selectProduct(filtered[0]);
          }}
          placeholder={placeholder}
        />
      </div>

      {selected && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {selected.barcode || 'No barcode'}
              {selected.brand_name ? ` - ${selected.brand_name}` : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onChange('');
              setQuery('');
            }}
          >
            Change
          </Button>
        </div>
      )}

      {!disabled && !selected && (
        <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            filtered.map(product => (
              <button
                key={product.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                onClick={() => selectProduct(product)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{product.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {product.barcode || 'No barcode'}
                    {product.brand_name ? ` - ${product.brand_name}` : ''}
                  </span>
                </span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {product.product_type}
                </Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ManufacturingPage() {
  const [activeTab, setActiveTab] = useState<ManufacturingTab>('boms');
  const [boms, setBoms] = useState<BillOfMaterials[]>([]);
  const [factoryStock, setFactoryStock] = useState<InFactorySummary[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionBatch[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [productionStatusFilter, setProductionStatusFilter] = useState('all');

  const [bomDialogOpen, setBomDialogOpen] = useState(false);
  const [editingBomId, setEditingBomId] = useState<number | null>(null);
  const [bomForm, setBomForm] = useState<BomFormState>(EMPTY_BOM_FORM);
  const [quickPackagingForm, setQuickPackagingForm] =
    useState<QuickPackagingFormState>(EMPTY_PACKAGING_FORM);
  const [quickPackagingLoading, setQuickPackagingLoading] = useState(false);

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendForm, setSendForm] = useState<SendFactoryFormState>({
    sales_channel: '',
    finished_product: '',
    planned_quantity: '',
    notes: '',
  });
  const [sendBomDetail, setSendBomDetail] = useState<BillOfMaterials | null>(null);
  const [sendBomLoading, setSendBomLoading] = useState(false);

  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<ProductionBatch | null>(null);
  const [receiveForm, setReceiveForm] = useState<ReceiveFactoryFormState>({
    received_quantity: '',
    reason: 'PRODUCTION_RETURNED',
    notes: '',
  });

  const [viewProductionOrder, setViewProductionOrder] =
    useState<ProductionBatch | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ProductionBatch | null>(null);
  const [cancelNotes, setCancelNotes] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [bomList, factoryRows, batchList, channelList, productList] =
        await Promise.all([
          billOfMaterialsService.getAll(),
          productionBatchService.getInFactorySummary(),
          productionBatchService.getAll(),
          salesChannelService.getAllChannels(),
          productService.getAllProducts(),
        ]);
      setBoms(bomList);
      setFactoryStock(factoryRows);
      setProductionOrders(batchList);
      setChannels(channelList);
      setProducts(productList);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const showSuccess = (message: string) => setSuccessMessage(message);
  const showError = (message: string) => setErrorMessage(message);

  // A BOM produces a sellable finished good. Per the canonical taxonomy that is
  // a ``resell_product`` (perfume / cosmetic / normal product) — never a pack,
  // component or packaging item. The backend enforces the same rule.
  const finishedProducts = useMemo(
    () =>
      products.filter(
        product =>
          product.product_type === 'resell_product' &&
          !product.is_pack &&
          !product.is_deleted
      ),
    [products]
  );

  // BOM line items may only reference ``component`` products (bottle, cap,
  // label, liquid, raw material) — not packaging items, not sellable goods.
  const componentProducts = useMemo(
    () =>
      products.filter(product => product.product_type === 'component' && !product.is_deleted),
    [products]
  );

  const activeBoms = useMemo(() => boms.filter(bom => bom.is_active), [boms]);

  const selectedBomFinishedProduct = useMemo(
    () => products.find(product => product.id === Number(bomForm.finished_product)),
    [bomForm.finished_product, products]
  );

  const sendPreview = useMemo(() => {
    if (!sendBomDetail?.items?.length || !sendForm.planned_quantity) return [];
    const plannedQty = Number(sendForm.planned_quantity);
    if (plannedQty <= 0 || Number.isNaN(plannedQty)) return [];
    return sendBomDetail.items.map(item => ({
      name: item.component_name,
      barcode: item.component_barcode,
      required: Math.ceil(Number(item.quantity_per_unit) * plannedQty),
    }));
  }, [sendBomDetail, sendForm.planned_quantity]);

  const receivePreview = useMemo(() => {
    if (!receiveTarget?.components?.length || !receiveForm.received_quantity) return [];
    const receivedQty = Number(receiveForm.received_quantity);
    if (receivedQty <= 0 || Number.isNaN(receivedQty)) return [];
    const newTotalReceived = receiveTarget.received_quantity + receivedQty;
    return receiveTarget.components.map(component => {
      const consumedTotal = Math.min(
        component.quantity_sent,
        Math.ceil(
          (component.quantity_sent * newTotalReceived) /
            Math.max(1, receiveTarget.planned_quantity)
        )
      );
      return {
        name: component.component_name,
        barcode: component.component_barcode,
        willConsume: consumedTotal - component.quantity_consumed,
        willRemain: component.quantity_sent - consumedTotal,
      };
    });
  }, [receiveForm.received_quantity, receiveTarget]);

  const query = searchQuery.trim().toLowerCase();
  const filteredBoms = useMemo(
    () =>
      boms.filter(bom => {
        if (!query) return true;
        return (
          bom.name.toLowerCase().includes(query) ||
          bom.finished_product_name.toLowerCase().includes(query) ||
          (bom.finished_product_barcode || '').toLowerCase().includes(query)
        );
      }),
    [boms, query]
  );

  const filteredFactoryStock = useMemo(
    () =>
      factoryStock.filter(row => {
        if (!query) return true;
        return (
          row.component_name.toLowerCase().includes(query) ||
          (row.component_barcode || '').toLowerCase().includes(query)
        );
      }),
    [factoryStock, query]
  );

  const filteredProductionOrders = useMemo(
    () =>
      productionOrders.filter(order => {
        const matchesStatus =
          productionStatusFilter === 'all' || order.status === productionStatusFilter;
        const matchesQuery =
          !query ||
          order.batch_number.toLowerCase().includes(query) ||
          order.finished_product_name.toLowerCase().includes(query) ||
          order.sales_channel_name.toLowerCase().includes(query);
        return matchesStatus && matchesQuery;
      }),
    [productionOrders, productionStatusFilter, query]
  );

  const bomPages = usePaginatedRows(filteredBoms);
  const factoryPages = usePaginatedRows(filteredFactoryStock);
  const productionPages = usePaginatedRows(filteredProductionOrders);
  const inProgressCount = productionOrders.filter(order =>
    ['SENT_TO_FACTORY', 'PARTIALLY_RECEIVED'].includes(order.status)
  ).length;

  const populateBomForm = (bom: BillOfMaterials) => {
    setEditingBomId(bom.id);
    setBomForm({
      finished_product: String(bom.finished_product),
      name: bom.name || '',
      notes: bom.notes || '',
      items: bom.items?.length
        ? bom.items.map(item => ({
            component: String(item.component),
            quantity_per_unit: String(item.quantity_per_unit),
            notes: item.notes || '',
          }))
        : [{ component: '', quantity_per_unit: '1', notes: '' }],
    });
  };

  const openBomDialog = async (bom?: BillOfMaterials) => {
    setQuickPackagingForm(EMPTY_PACKAGING_FORM);
    if (!bom) {
      setEditingBomId(null);
      setBomForm(EMPTY_BOM_FORM);
      setBomDialogOpen(true);
      return;
    }
    setActionLoading(true);
    try {
      const detail = await billOfMaterialsService.getById(bom.id);
      populateBomForm(detail);
      setBomDialogOpen(true);
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleBomFinishedProductChange = async (value: string) => {
    const existingBom = boms.find(bom => String(bom.finished_product) === value);
    if (!existingBom) {
      setEditingBomId(null);
      setBomForm({ ...EMPTY_BOM_FORM, finished_product: value });
      return;
    }
    setActionLoading(true);
    try {
      const detail = await billOfMaterialsService.getById(existingBom.id);
      populateBomForm(detail);
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const updateBomItem = (
    index: number,
    field: 'component' | 'quantity_per_unit' | 'notes',
    value: string
  ) => {
    setBomForm(current => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const handleSaveBom = async () => {
    const validItems = bomForm.items.filter(
      item => item.component && Number(item.quantity_per_unit) > 0
    );
    if (!bomForm.finished_product || validItems.length === 0) return;
    setActionLoading(true);
    try {
      const finishedProduct = products.find(
        product => product.id === Number(bomForm.finished_product)
      );
      const existingBom =
        editingBomId !== null
          ? boms.find(bom => bom.id === editingBomId)
          : boms.find(bom => bom.finished_product === Number(bomForm.finished_product));
      const payload = {
        finished_product: Number(bomForm.finished_product),
        name: bomForm.name || `${finishedProduct?.name ?? 'Product'} BOM`,
        version: existingBom?.version ?? 1,
        is_active: true,
        notes: bomForm.notes,
        items: validItems.map(item => ({
          component: Number(item.component),
          quantity_per_unit: item.quantity_per_unit,
          waste_percent: '0',
          notes: item.notes,
        })),
      };
      if (existingBom) await billOfMaterialsService.update(existingBom.id, payload);
      else await billOfMaterialsService.create(payload);
      setBomDialogOpen(false);
      showSuccess(existingBom ? 'Bill of Materials updated.' : 'Bill of Materials created.');
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreatePackagingComponent = async () => {
    const name = quickPackagingForm.name.trim();
    const openingStock = Number(quickPackagingForm.initial_stock || 0);
    if (!name) return;
    if (Number.isNaN(openingStock) || openingStock < 0) {
      showError('Opening stock must be a positive number.');
      return;
    }
    if (openingStock > 0 && !quickPackagingForm.sales_channel) {
      showError('Choose a sales point before adding opening stock.');
      return;
    }
    setQuickPackagingLoading(true);
    try {
      const created = await productService.createProduct({
        name,
        barcode: quickPackagingForm.barcode.trim() || undefined,
        // Quick-create from the BOM dialog always produces a BOM component.
        product_type: 'component',
        status: 'publish',
        brand: selectedBomFinishedProduct?.brand ?? undefined,
        purchase_price: '0.00',
        sales_price: '0.00',
        is_pack: false,
      });
      if (quickPackagingForm.sales_channel) {
        await storeInventoryService.createStoreInventory({
          sales_channel: Number(quickPackagingForm.sales_channel),
          product: created.id,
          quantity: openingStock,
          minimum_quantity: 0,
          bin_location: quickPackagingForm.bin_location.trim(),
        });
      }
      setProducts(current => [...current, created]);
      setBomForm(current => ({
        ...current,
        items:
          current.items.length === 1 && !current.items[0].component
            ? [{ component: String(created.id), quantity_per_unit: '1', notes: '' }]
            : [
                ...current.items,
                { component: String(created.id), quantity_per_unit: '1', notes: '' },
              ],
      }));
      setQuickPackagingForm({
        ...EMPTY_PACKAGING_FORM,
        sales_channel: quickPackagingForm.sales_channel,
      });
      if (quickPackagingForm.sales_channel) await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setQuickPackagingLoading(false);
    }
  };

  const openSendDialog = (bom?: BillOfMaterials) => {
    const defaultChannel = channels.find(
      channel => channel.channel_type === 'WOOCOMMERCE' && channel.is_active
    );
    setSendForm({
      sales_channel: defaultChannel ? String(defaultChannel.id) : '',
      finished_product: bom ? String(bom.finished_product) : '',
      planned_quantity: '',
      notes: '',
    });
    setSendBomDetail(null);
    if (bom) {
      void (async () => {
        setSendBomLoading(true);
        try {
          setSendBomDetail(await billOfMaterialsService.getById(bom.id));
        } catch {
          setSendBomDetail(null);
        } finally {
          setSendBomLoading(false);
        }
      })();
    }
    setSendDialogOpen(true);
  };

  const handleSendProductChange = async (value: string) => {
    setSendForm(current => ({ ...current, finished_product: value }));
    setSendBomDetail(null);
    const matchingBom = boms.find(
      bom => String(bom.finished_product) === value && bom.is_active
    );
    if (!matchingBom) return;
    setSendBomLoading(true);
    try {
      setSendBomDetail(await billOfMaterialsService.getById(matchingBom.id));
    } catch {
      setSendBomDetail(null);
    } finally {
      setSendBomLoading(false);
    }
  };

  const handleSendToFactory = async () => {
    if (!sendForm.sales_channel || !sendForm.finished_product || !sendForm.planned_quantity) {
      return;
    }
    setActionLoading(true);
    try {
      const batch = await productionBatchService.sendToFactory({
        sales_channel: Number(sendForm.sales_channel),
        finished_product: Number(sendForm.finished_product),
        planned_quantity: Number(sendForm.planned_quantity),
        notes: sendForm.notes,
      });
      setSendDialogOpen(false);
      showSuccess(`Production order ${batch.batch_number} created and components sent.`);
      await fetchData();
      setActiveTab('production-orders');
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openReceiveDialog = async (batch: ProductionBatch) => {
    setActionLoading(true);
    try {
      const detail = await productionBatchService.getById(batch.id);
      setReceiveTarget(detail);
      setReceiveForm({
        received_quantity: '',
        reason:
          detail.in_factory_quantity === detail.planned_quantity
            ? 'PRODUCTION_RETURNED'
            : 'PARTIAL_PRODUCTION_RETURNED',
        notes: '',
      });
      setReceiveDialogOpen(true);
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const openProductionDetail = async (batch: ProductionBatch) => {
    setActionLoading(true);
    try {
      setViewProductionOrder(await productionBatchService.getById(batch.id));
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceiveFromFactory = async () => {
    if (!receiveTarget || !receiveForm.received_quantity) return;
    setActionLoading(true);
    try {
      const batch = await productionBatchService.receiveFromFactory(receiveTarget.id, {
        received_quantity: Number(receiveForm.received_quantity),
        reason: receiveForm.reason,
        notes: receiveForm.notes,
      });
      setReceiveDialogOpen(false);
      showSuccess(`Finished products received for ${batch.batch_number}.`);
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateProductionNotes = async () => {
    if (!viewProductionOrder) return;
    setActionLoading(true);
    try {
      const updated = await productionBatchService.update(viewProductionOrder.id, {
        notes: viewProductionOrder.notes,
      });
      setViewProductionOrder(updated);
      showSuccess('Production order notes updated.');
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelProductionOrder = async () => {
    if (!cancelTarget) return;
    setActionLoading(true);
    try {
      await productionBatchService.cancel(cancelTarget.id, { notes: cancelNotes });
      setCancelTarget(null);
      setCancelNotes('');
      showSuccess('Production order cancelled and remaining components returned.');
      await fetchData();
    } catch (err) {
      showError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-2">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[360px] items-center justify-center p-4">
        <Card className="max-w-lg rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Manufacturing data unavailable
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void fetchData()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-3 sm:p-6">
      <header className="flex flex-col gap-4 rounded-lg border bg-background p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 flex items-center gap-2">
            <div className="rounded-md border bg-muted/40 p-2">
              <Factory className="h-5 w-5 text-primary" />
            </div>
            <Badge variant="outline">Manufacturing</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Manufacturing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage product recipes, component balances at the factory, and production orders from one clean workspace.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap">
          <Button variant="outline" onClick={() => void fetchData()} className="justify-center">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => void openBomDialog()} className="justify-center">
            <PackagePlus className="mr-2 h-4 w-4" />
            New BOM
          </Button>
          <Button onClick={() => openSendDialog()} className="justify-center">
            <Send className="mr-2 h-4 w-4" />
            New Production Order
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Bills of Materials"
          value={boms.length}
          icon={<Boxes className="h-5 w-5 text-sky-600" />}
          detail={`${activeBoms.length} active recipes`}
        />
        <MetricCard
          title="In Progress"
          value={inProgressCount}
          icon={<CalendarClock className="h-5 w-5 text-amber-600" />}
          detail="Orders currently at factory"
        />
        <MetricCard
          title="Factory Components"
          value={formatQty(factoryStock.reduce((sum, row) => sum + row.in_factory_quantity, 0))}
          icon={<Factory className="h-5 w-5 text-violet-600" />}
          detail={`${factoryStock.length} component balances`}
        />
        <MetricCard
          title="Completed Orders"
          value={productionOrders.filter(order => order.status === 'COMPLETED').length}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          detail="Finished products received"
        />
      </div>

      <Card className="rounded-lg py-4">
        <CardContent className="space-y-4 px-3 sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ManufacturingTab)} className="w-full lg:w-auto">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3 lg:w-auto">
                <TabsTrigger value="boms" className="h-9">Bills of Materials</TabsTrigger>
                <TabsTrigger value="factory-stock" className="h-9">In Factory Stock</TabsTrigger>
                <TabsTrigger value="production-orders" className="h-9">Production Orders</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <div className="relative sm:min-w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search product, SKU, order..."
                />
              </div>
              {activeTab === 'production-orders' && (
                <Select value={productionStatusFilter} onValueChange={setProductionStatusFilter}>
                  <SelectTrigger className="sm:w-48">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="SENT_TO_FACTORY">Sent to factory</SelectItem>
                    <SelectItem value="PARTIALLY_RECEIVED">Partially received</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Separator />

          <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ManufacturingTab)}>
            <TabsContent value="boms" className="mt-0">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>BOM Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Product</TableHead>
                      <TableHead className="hidden md:table-cell">Components</TableHead>
                      <TableHead className="hidden md:table-cell">Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bomPages.pageRows.length === 0 ? (
                      <EmptyTableRow
                        colSpan={6}
                        title="No Bills of Materials"
                        description="Create a BOM to define which components are required for a finished product."
                      />
                    ) : (
                      bomPages.pageRows.map(bom => (
                        <TableRow key={bom.id}>
                          <TableCell>
                            <div className="font-medium">{bom.finished_product_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {bom.name || 'Default BOM'}
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <div className="text-sm">{bom.finished_product_barcode || 'No SKU'}</div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant="secondary" className="whitespace-nowrap">{bom.items_count} components</Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant={bom.is_active ? 'default' : 'secondary'}>
                              {bom.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{formatDate(bom.updated_at)}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>BOM actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => void openBomDialog(bom)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit BOM
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openSendDialog(bom)}>
                                  <Send className="mr-2 h-4 w-4" />
                                  Create production order
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Card className="rounded-t-none rounded-lg py-0">
                <PaginationBar
                  page={bomPages.page}
                  totalPages={bomPages.totalPages}
                  totalRows={filteredBoms.length}
                  onPageChange={bomPages.setPage}
                />
              </Card>
            </TabsContent>

            <TabsContent value="factory-stock" className="mt-0">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="hidden sm:table-cell">SKU</TableHead>
                      <TableHead className="text-right">Available Qty</TableHead>
                      <TableHead className="hidden md:table-cell text-right">Reserved Qty</TableHead>
                      <TableHead className="hidden lg:table-cell">Unit</TableHead>
                      <TableHead className="hidden lg:table-cell">Location</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {factoryPages.pageRows.length === 0 ? (
                      <EmptyTableRow
                        colSpan={7}
                        title="No factory stock"
                        description="Components sent to the factory will appear here until finished products are received."
                      />
                    ) : (
                      factoryPages.pageRows.map(row => (
                        <TableRow key={row.component_id}>
                          <TableCell>
                            <div className="font-medium">{row.component_name}</div>
                            <div className="text-xs text-muted-foreground">
                              <span className="block sm:inline">Sent {formatQty(row.quantity_sent)}</span>
                              <span className="hidden sm:inline"> • </span>
                              <span className="block sm:inline">Consumed {formatQty(row.quantity_consumed)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell font-mono text-xs">
                            {row.component_barcode || 'No SKU'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatQty(row.in_factory_quantity)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right text-muted-foreground">0</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm">pcs</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm">Factory / Lab</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveTab('production-orders')}
                              className="whitespace-nowrap"
                            >
                              View Orders
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Card className="rounded-t-none rounded-lg py-0">
                <PaginationBar
                  page={factoryPages.page}
                  totalPages={factoryPages.totalPages}
                  totalRows={filteredFactoryStock.length}
                  onPageChange={factoryPages.setPage}
                />
              </Card>
            </TabsContent>

            <TabsContent value="production-orders" className="mt-0">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order Number</TableHead>
                      <TableHead className="hidden sm:table-cell">Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="hidden md:table-cell">Status</TableHead>
                      <TableHead className="hidden lg:table-cell">Start Date</TableHead>
                      <TableHead className="text-right">Received %</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productionPages.pageRows.length === 0 ? (
                      <EmptyTableRow
                        colSpan={7}
                        title="No production orders"
                        description="Create a production order to send BOM components to your factory or laboratory."
                      />
                    ) : (
                      productionPages.pageRows.map(order => {
                        const receivedPercent =
                          order.planned_quantity > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (order.received_quantity / order.planned_quantity) * 100
                                )
                              )
                            : 0;

                        return (
                          <TableRow key={order.id}>
                            <TableCell>
                              <div className="font-mono text-sm font-medium">{order.batch_number}</div>
                              <div className="text-xs text-muted-foreground">{order.sales_channel_name}</div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <div className="text-sm font-medium">{order.finished_product_name}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-semibold">{formatQty(order.planned_quantity)}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatQty(order.received_quantity)} received
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              {productionStatusBadge(order.status, order.status_display)}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {formatDate(order.sent_at || order.created_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1">
                                <span className="font-mono text-sm font-semibold">
                                  {receivedPercent}%
                                </span>
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:w-20">
                                  <div
                                    className={`h-full rounded-full ${
                                      receivedPercent >= 100
                                        ? 'bg-emerald-500'
                                        : receivedPercent > 0
                                          ? 'bg-amber-500'
                                          : 'bg-muted-foreground/30'
                                    }`}
                                    style={{ width: `${receivedPercent}%` }}
                                  />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="View details"
                                  onClick={() => void openProductionDetail(order)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {order.in_factory_quantity > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Receive finished products"
                                    onClick={() => void openReceiveDialog(order)}
                                  >
                                    <PackageCheck className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                )}
                                {order.received_quantity === 0 && order.status !== 'CANCELLED' && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Cancel order"
                                    onClick={() => {
                                      setCancelTarget(order);
                                      setCancelNotes('');
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <Card className="rounded-t-none rounded-lg py-0">
                <PaginationBar
                  page={productionPages.page}
                  totalPages={productionPages.totalPages}
                  totalRows={filteredProductionOrders.length}
                  onPageChange={productionPages.setPage}
                />
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ResponsiveSheet
        open={bomDialogOpen}
        onOpenChange={setBomDialogOpen}
        title={editingBomId ? 'Edit Bill of Materials' : 'Create Bill of Materials'}
        description="Link a finished product (resell product) to the components needed to produce one unit."
        wide={true}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setBomDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveBom}
              disabled={
                actionLoading ||
                !bomForm.finished_product ||
                !bomForm.items.some(item => item.component && Number(item.quantity_per_unit) > 0)
              }
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingBomId ? 'Update BOM' : 'Create BOM'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-[1.3fr_0.9fr]">
              <div>
                <Label>Finished product</Label>
                <div className="mt-1">
                  <ProductSearchSelect
                    products={finishedProducts}
                    value={bomForm.finished_product}
                    onChange={value => void handleBomFinishedProductChange(value)}
                    placeholder="Search or scan finished product..."
                    emptyMessage="No finished product found"
                  />
                </div>
              </div>
              <div>
                <Label>BOM name</Label>
                <Input
                  className="mt-1"
                  value={bomForm.name}
                  onChange={event => setBomForm({ ...bomForm, name: event.target.value })}
                  placeholder="Optional display name"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Create missing component product</h3>
                <p className="text-xs text-muted-foreground">
                  Add a bottle, cap, label, liquid, or other component, with optional opening stock.
                </p>
              </div>
              <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_0.7fr]">
                <div>
                  <Label>Component name</Label>
                  <Input
                    className="mt-1"
                    value={quickPackagingForm.name}
                    onChange={event =>
                      setQuickPackagingForm({ ...quickPackagingForm, name: event.target.value })
                    }
                    placeholder="Bottle 100ml, cap, label..."
                  />
                </div>
                <div>
                  <Label>Barcode</Label>
                  <Input
                    className="mt-1"
                    value={quickPackagingForm.barcode}
                    onChange={event =>
                      setQuickPackagingForm({ ...quickPackagingForm, barcode: event.target.value })
                    }
                    placeholder="Optional barcode"
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-[1fr_150px_1fr_auto] md:items-end">
                <div>
                  <Label>Sales point</Label>
                  <Select
                    value={quickPackagingForm.sales_channel}
                    onValueChange={value =>
                      setQuickPackagingForm({ ...quickPackagingForm, sales_channel: value })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Optional stock location" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels
                        .filter(channel => channel.is_active)
                        .map(channel => (
                          <SelectItem key={channel.id} value={String(channel.id)}>
                            {channel.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Opening stock</Label>
                  <Input
                    type="number"
                    min="0"
                    className="mt-1"
                    value={quickPackagingForm.initial_stock}
                    onChange={event =>
                      setQuickPackagingForm({
                        ...quickPackagingForm,
                        initial_stock: event.target.value,
                      })
                    }
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label>Bin / shelf</Label>
                  <Input
                    className="mt-1"
                    value={quickPackagingForm.bin_location}
                    onChange={event =>
                      setQuickPackagingForm({
                        ...quickPackagingForm,
                        bin_location: event.target.value,
                      })
                    }
                    placeholder="Optional"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCreatePackagingComponent}
                  disabled={
                    quickPackagingLoading ||
                    !quickPackagingForm.name.trim() ||
                    (Number(quickPackagingForm.initial_stock || 0) > 0 &&
                      !quickPackagingForm.sales_channel)
                  }
                >
                  {quickPackagingLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PackagePlus className="mr-2 h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Components</h3>
                  <p className="text-xs text-muted-foreground">Quantities are required for one finished product.</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {bomForm.items.length}{' '}
                  {bomForm.items.length === 1 ? 'component' : 'components'}
                </span>
              </div>

              <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                {bomForm.items.map((item, index) => (
                <div
                  key={`${index}-${item.component || 'new'}`}
                  className="grid gap-3 rounded-lg border p-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.4fr_150px_1fr_auto] md:items-start"
                >
                  <div>
                    <Label className="text-xs">Component</Label>
                    <ProductSearchSelect
                      products={componentProducts.filter(
                        product => String(product.id) !== bomForm.finished_product
                      )}
                      value={item.component}
                      onChange={value => updateBomItem(index, 'component', value)}
                      placeholder="Search or scan component..."
                      emptyMessage="No component found"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Qty / unit</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1"
                      value={item.quantity_per_unit}
                      onChange={event =>
                        updateBomItem(index, 'quantity_per_unit', event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input
                      className="mt-1"
                      value={item.notes}
                      onChange={event => updateBomItem(index, 'notes', event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-5"
                    disabled={bomForm.items.length === 1}
                    onClick={() =>
                      setBomForm(current => ({
                        ...current,
                        items: current.items.filter((_, itemIndex) => itemIndex !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() =>
                  setBomForm(current => ({
                    ...current,
                    items: [
                      ...current.items,
                      { component: '', quantity_per_unit: '1', notes: '' },
                    ],
                  }))
                }
              >
                <PackagePlus className="mr-2 h-4 w-4" />
                Add component
              </Button>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1 min-h-20"
                value={bomForm.notes}
                onChange={event => setBomForm({ ...bomForm, notes: event.target.value })}
                placeholder="Internal instructions or component notes..."
              />
            </div>
          </div>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        title="New Production Order"
        description="Send required BOM components to the factory and track the balance until finished products return."
        wide={true}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendToFactory}
              disabled={
                actionLoading ||
                !sendForm.sales_channel ||
                !sendForm.finished_product ||
                !sendForm.planned_quantity ||
                Number(sendForm.planned_quantity) <= 0
              }
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send to Factory
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <div>
                <Label>Source sales point</Label>
                <Select
                  value={sendForm.sales_channel}
                  onValueChange={value => setSendForm({ ...sendForm, sales_channel: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose stock source" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels
                      .filter(channel => channel.is_active)
                      .map(channel => (
                        <SelectItem key={channel.id} value={String(channel.id)}>
                          {channel.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Planned quantity</Label>
                <Input
                  type="number"
                  min="1"
                  className="mt-1"
                  value={sendForm.planned_quantity}
                  onChange={event => setSendForm({ ...sendForm, planned_quantity: event.target.value })}
                  placeholder="100"
                />
              </div>
            </div>
            <div>
              <Label>Finished product with active BOM</Label>
              <Select value={sendForm.finished_product} onValueChange={value => void handleSendProductChange(value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose BOM product" />
                </SelectTrigger>
                <SelectContent>
                  {activeBoms.map(bom => (
                    <SelectItem key={bom.id} value={String(bom.finished_product)}>
                      {bom.finished_product_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sendBomLoading && (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                Loading component preview...
              </div>
            )}
            {!sendBomLoading && sendForm.finished_product && (
              <div className="rounded-lg border bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">Components to send</h3>
                {sendPreview.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add a planned quantity to preview component requirements.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {sendPreview.map(component => (
                      <div key={`${component.name}-${component.barcode}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {component.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {component.barcode || 'No SKU'}
                          </span>
                        </span>
                        <Badge variant="outline">{formatQty(component.required)} pcs</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                value={sendForm.notes}
                onChange={event => setSendForm({ ...sendForm, notes: event.target.value })}
                placeholder="Factory/lab instructions..."
              />
            </div>
          </div>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={receiveDialogOpen}
        onOpenChange={setReceiveDialogOpen}
        title="Receive Finished Products"
        description="Finished stock will increase and factory component balance will be consumed."
        wide={false}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReceiveFromFactory}
              disabled={
                actionLoading ||
                !receiveForm.received_quantity ||
                Number(receiveForm.received_quantity) <= 0 ||
                Number(receiveForm.received_quantity) > (receiveTarget?.in_factory_quantity ?? 0)
              }
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Receive Stock
            </Button>
          </div>
        }
      >
        {receiveTarget && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 grid-cols-1 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Order</p>
                  <p className="font-mono text-sm font-semibold">{receiveTarget.batch_number}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Product</p>
                  <p className="text-sm font-semibold">{receiveTarget.finished_product_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Still at factory</p>
                  <p className="text-sm font-semibold text-amber-700">
                    {formatQty(receiveTarget.in_factory_quantity)}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                <div>
                  <Label>Received quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    max={receiveTarget.in_factory_quantity}
                    className="mt-1"
                    value={receiveForm.received_quantity}
                    onChange={event =>
                      setReceiveForm({ ...receiveForm, received_quantity: event.target.value })
                    }
                    placeholder={`Max ${receiveTarget.in_factory_quantity}`}
                  />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Select
                    value={receiveForm.reason}
                    onValueChange={value =>
                      setReceiveForm({
                        ...receiveForm,
                        reason: value as ReceiveFactoryFormState['reason'],
                      })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCTION_RETURNED">Production returned</SelectItem>
                      <SelectItem value="LAB_RECEIVED">Received from laboratory</SelectItem>
                      <SelectItem value="PARTIAL_PRODUCTION_RETURNED">Partial return</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {receivePreview.length > 0 && (
                <div className="rounded-lg border bg-emerald-50/60 p-4">
                  <h3 className="text-sm font-semibold text-emerald-900">Component impact</h3>
                  <div className="mt-3 space-y-2">
                    {receivePreview.map(component => (
                      <div key={`${component.name}-${component.barcode}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {component.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {component.barcode || 'No SKU'}
                          </span>
                        </span>
                        <span className="text-right text-xs">
                          consume <b>{formatQty(component.willConsume)}</b> - remain{' '}
                          <b>{formatQty(component.willRemain)}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <Label>Notes</Label>
                <Textarea
                  className="mt-1"
                  value={receiveForm.notes}
                  onChange={event => setReceiveForm({ ...receiveForm, notes: event.target.value })}
                  placeholder="Receipt notes..."
                />
              </div>
            </div>
          )}
      </ResponsiveSheet>

      <ResponsiveSheet
        open={!!viewProductionOrder}
        onOpenChange={() => setViewProductionOrder(null)}
        title="Production Order Detail"
        description={viewProductionOrder?.batch_number}
        wide={true}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setViewProductionOrder(null)}>
              Close
            </Button>
            {viewProductionOrder?.in_factory_quantity ? (
              <Button
                variant="outline"
                onClick={() => {
                  const order = viewProductionOrder;
                  setViewProductionOrder(null);
                  void openReceiveDialog(order);
                }}
              >
                <PackageCheck className="mr-2 h-4 w-4" />
                Receive
              </Button>
            ) : null}
            <Button onClick={handleUpdateProductionNotes} disabled={actionLoading || !viewProductionOrder}>
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Notes
            </Button>
          </div>
        }
      >
        {viewProductionOrder && (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
                <Card className="rounded-lg py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <div className="mt-2">{productionStatusBadge(viewProductionOrder.status, viewProductionOrder.status_display)}</div>
                  </CardContent>
                </Card>
                <Card className="rounded-lg py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">Planned</p>
                    <p className="mt-1 text-xl font-semibold">{formatQty(viewProductionOrder.planned_quantity)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-lg py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">Received</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-700">{formatQty(viewProductionOrder.received_quantity)}</p>
                  </CardContent>
                </Card>
                <Card className="rounded-lg py-4">
                  <CardContent className="px-4">
                    <p className="text-xs text-muted-foreground">Still at factory</p>
                    <p className="mt-1 text-xl font-semibold text-amber-700">{formatQty(viewProductionOrder.in_factory_quantity)}</p>
                  </CardContent>
                </Card>
              </div>

              <Card className="overflow-hidden rounded-lg py-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="hidden sm:table-cell text-right">Consumed</TableHead>
                        <TableHead className="text-right">At Factory</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(viewProductionOrder.components ?? []).length === 0 ? (
                        <EmptyTableRow
                          colSpan={4}
                          title="No component tracking"
                          description="This order has no component balance rows."
                        />
                      ) : (
                        (viewProductionOrder.components ?? []).map(component => (
                          <TableRow key={component.id}>
                            <TableCell>
                              <div className="font-medium">{component.component_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {component.component_barcode || 'No SKU'}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{formatQty(component.quantity_sent)}</TableCell>
                            <TableCell className="hidden sm:table-cell text-right">{formatQty(component.quantity_consumed)}</TableCell>
                            <TableCell className="text-right font-semibold text-amber-700">
                              {formatQty(component.in_factory_quantity)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              <div>
                <Label>Notes</Label>
                <Textarea
                  className="mt-1"
                  value={viewProductionOrder.notes}
                  onChange={event =>
                    setViewProductionOrder({
                      ...viewProductionOrder,
                      notes: event.target.value,
                    })
                  }
                />
              </div>
          </div>
        )}
      </ResponsiveSheet>

      <AlertDialog open={!!cancelTarget} onOpenChange={open => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel production order?</AlertDialogTitle>
            <AlertDialogDescription>
              Remaining components for {cancelTarget?.batch_number} will be returned from factory balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={cancelNotes}
            onChange={event => setCancelNotes(event.target.value)}
            placeholder="Reason or note..."
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelProductionOrder}>
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!successMessage} onOpenChange={open => !open && setSuccessMessage('')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Done
            </AlertDialogTitle>
            <AlertDialogDescription>{successMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!errorMessage} onOpenChange={open => !open && setErrorMessage('')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Error
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
