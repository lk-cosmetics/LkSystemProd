import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InvoicePreviewDialog, invoiceFromOrder } from '@/components/invoice';
import { hasPermission } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { companyService } from '@/services/company.service';
import {
  orderService,
  type InvoiceMutationPayload,
  type InvoiceListItem,
  type InvoiceListParams,
  type InvoiceSettings,
} from '@/services/order.service';
import type { Company, OrderDetail } from '@/types';
import { buildPaginationItems } from './orderQueue';

const PAGE_SIZE = 20;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('fr-TN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));

const formatMoney = (currency: string, value: string) =>
  new Intl.NumberFormat('fr-TN', {
    style: 'currency',
    currency: currency || 'TND',
    minimumFractionDigits: 3,
  }).format(Number(value) || 0);

function apiError(error: unknown, fallback: string) {
  return (
    error as { response?: { data?: { detail?: string } } }
  ).response?.data?.detail ?? fallback;
}

export default function InvoicesPage() {
  const user = useAuthStore(state => state.user);
  const canEditNumbers = hasPermission(user, 'edit_invoice_numbers');
  const companyCache = useRef(new Map<number, Company>());

  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ordering, setOrdering] = useState<NonNullable<InvoiceListParams['ordering']>>('-date');
  const [page, setPage] = useState(1);
  const [pageJump, setPageJump] = useState('1');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadInvoices = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const [list, nextSettings] = await Promise.all([
        orderService.getInvoices({
          page,
          page_size: PAGE_SIZE,
          ordering,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
        }),
        orderService.getInvoiceSettings(),
      ]);
      setRows(list.results);
      setCount(list.count);
      setSettings(nextSettings);
    } catch (loadError) {
      setError(apiError(loadError, 'Could not load invoices.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFrom, dateTo, debouncedSearch, ordering, page]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const paginationItems = useMemo(
    () => buildPaginationItems(page, totalPages),
    [page, totalPages],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    setPageJump(String(Math.min(page, totalPages)));
  }, [page, totalPages]);

  const openInvoice = async (row: InvoiceListItem) => {
    setOpeningId(row.id);
    try {
      const order = await orderService.getById(row.id);
      let company = companyCache.current.get(order.company) ?? null;
      if (!company) {
        company = await companyService.getCompanyById(order.company);
        companyCache.current.set(order.company, company);
      }
      setSelectedOrder(order);
      setSelectedCompany(company);
      setPreviewOpen(true);
    } catch (openError) {
      toast.error(apiError(openError, 'Could not open this invoice.'));
    } finally {
      setOpeningId(null);
    }
  };

  const updateSelectedInvoice = async (payload: InvoiceMutationPayload) => {
    if (!selectedOrder) return;
    const updated = await orderService.updateInvoice(selectedOrder.id, payload);
    setSelectedOrder(updated);
    await loadInvoices(true);
    toast.success(`Invoice ${updated.invoice_number} updated.`);
  };

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setDateFrom('');
    setDateTo('');
    setOrdering('-date');
    setPage(1);
  };

  const goToPage = () => {
    const requested = Number(pageJump);
    if (!Number.isFinite(requested)) return;
    setPage(Math.min(totalPages, Math.max(1, Math.trunc(requested))));
  };

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
            <FileText className="size-4" />
            Billing registry
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search, review, print, and manage invoice numbers generated from orders.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2 self-start sm:self-auto"
          onClick={() => void loadInvoices(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Next available invoice number
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <p className="font-mono text-2xl font-bold tracking-tight">
              {settings?.next_invoice_number ?? 'Not available'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Assigned only when an authorized user creates an invoice for an order.
            </p>
          </CardContent>
        </Card>
        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Matching invoices
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <p className="text-2xl font-bold tracking-tight">{count}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Results in the current company and brand workspace.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4" />
            Search and filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-5 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_170px_170px_220px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Name, invoice, client, or phone"
              className="pl-9"
            />
          </div>
          <div>
            <Label htmlFor="invoice-date-from" className="sr-only">From date</Label>
            <Input
              id="invoice-date-from"
              type="date"
              value={dateFrom}
              onChange={event => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="invoice-date-to" className="sr-only">To date</Label>
            <Input
              id="invoice-date-to"
              type="date"
              value={dateTo}
              onChange={event => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={ordering}
            onValueChange={value => {
              setOrdering(value as NonNullable<InvoiceListParams['ordering']>);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Sort invoices">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-date">Newest date first</SelectItem>
              <SelectItem value="date">Oldest date first</SelectItem>
              <SelectItem value="-invoice_number">Highest invoice first</SelectItem>
              <SelectItem value="invoice_number">Lowest invoice first</SelectItem>
              <SelectItem value="-total">Highest total first</SelectItem>
              <SelectItem value="total">Lowest total first</SelectItem>
              <SelectItem value="client">Client A to Z</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={clearFilters}>Clear</Button>
        </CardContent>
      </Card>

      {error ? (
        <Card className="items-center gap-3 border-destructive/40 p-8 text-center">
          <p className="font-medium text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void loadInvoices()}>Try again</Button>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Company / Brand</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-20 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <div className="h-9 animate-pulse rounded-md bg-muted" />
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="font-mono font-semibold">{row.invoice_number}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.client_name || 'Walk-in customer'}</p>
                      <p className="text-xs text-muted-foreground">{row.phone || 'No phone'}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.order_number}</TableCell>
                    <TableCell>
                      <p className="text-sm">{row.company_name}</p>
                      {row.brand_name && <p className="text-xs text-muted-foreground">{row.brand_name}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <CalendarDays className="size-3.5 text-muted-foreground" />
                        {formatDate(row.invoice_date)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(row.currency, row.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => void openInvoice(row)}
                        disabled={openingId !== null}
                      >
                        {openingId === row.id
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <Eye className="size-3.5" />}
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="divide-y md:hidden">
            {loading && Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="p-4">
                <div className="h-24 animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
            {!loading && rows.map(row => (
              <button
                key={row.id}
                type="button"
                className="w-full p-4 text-left transition-colors hover:bg-muted/40"
                onClick={() => void openInvoice(row)}
                disabled={openingId !== null}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold">{row.invoice_number}</p>
                    <p className="mt-1 truncate text-sm font-medium">{row.client_name || 'Walk-in customer'}</p>
                    <p className="text-xs text-muted-foreground">{row.phone || row.order_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatMoney(row.currency, row.total)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.invoice_date)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant="secondary">{row.brand_name || row.company_name}</Badge>
                  {openingId === row.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Eye className="size-4 text-muted-foreground" />}
                </div>
              </button>
            ))}
          </div>

          {!loading && rows.length === 0 && (
            <div className="p-12 text-center">
              <FileText className="mx-auto mb-3 size-10 text-muted-foreground" />
              <p className="font-medium">No invoices found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create an invoice from the selected order’s detail popup.
              </p>
            </div>
          )}
        </Card>
      )}

      {!loading && !error && count > 0 && (
        <div className="flex flex-col gap-3 text-sm lg:flex-row lg:items-center lg:justify-between">
          <span className="text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, count)} of {count}
            {' · '}Page {page} of {totalPages}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || refreshing}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            {paginationItems.map(item => (
              typeof item === 'number' ? (
                <Button
                  key={item}
                  variant={item === page ? 'default' : 'outline'}
                  size="icon"
                  className="size-8 text-xs"
                  onClick={() => setPage(item)}
                  aria-current={item === page ? 'page' : undefined}
                >
                  {item}
                </Button>
              ) : (
                <span key={item} className="flex size-8 items-center justify-center text-muted-foreground">…</span>
              )
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || refreshing}
              onClick={() => setPage(current => Math.min(totalPages, current + 1))}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
            <div className="ml-1 flex items-center gap-1 border-l pl-2">
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={pageJump}
                onChange={event => setPageJump(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') goToPage();
                }}
                className="h-8 w-16 text-center text-xs"
                aria-label={`Page number between 1 and ${totalPages}`}
              />
              <Button size="sm" variant="outline" className="h-8" onClick={goToPage}>Go</Button>
            </div>
          </div>
        </div>
      )}

      <InvoicePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        data={selectedOrder ? invoiceFromOrder(selectedOrder, selectedCompany) : null}
        canEditInvoice={canEditNumbers}
        onSaveInvoice={updateSelectedInvoice}
      />
    </div>
  );
}
