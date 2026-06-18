/**
 * MyOrdersPage — an employee's personal queue.
 *
 * Shows only the orders assigned to the logged-in employee (?assigned_to_me),
 * and opens each one in the SAME detail popup used on the Order Management page
 * (via OrderDetailController) — identical design, behaviour, lifecycle actions,
 * and per-button loading.
 *
 * Defaults to FIFO (oldest order first). Supports search, sort, the full set of
 * status tabs, pagination, and a multi-select group-action bar (Send to POS /
 * Delivery / Cancel) that mirrors the Order Management page — each action gated
 * by the employee's own permissions.
 *
 * Mobile-first: card stack on phones, table on desktop; the popup is a bottom
 * Drawer on phones.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban, CheckCircle, ChevronLeft, ChevronRight, ClipboardList, Loader2, Phone,
  RefreshCw, Search, Star, Store, Truck, User, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

import { orderService, type BulkOrderAction } from '@/services/order.service';
import { salesChannelService } from '@/services/salesChannel.service';
import { useAuthStore } from '@/store/authStore';
import { hasPermission } from '@/hooks/useAuth';
import type { OrderListItem, SalesChannel } from '@/types';
import { OrderStatusBadge, ORDER_STATUS_ROW_STYLES } from './components/orderStatusBadges';
import {
  OrderDetailController, type OrderDetailControllerHandle,
} from './components/OrderDetailController';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'not_answered', label: 'Not answered' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'done', label: 'Done' },
  { value: 'returned', label: 'Returned' },
  { value: 'canceled', label: 'Canceled' },
];

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'created_at', label: 'Oldest first (FIFO)' },
  { value: '-created_at', label: 'Newest first' },
  { value: '-updated_at', label: 'Recently updated' },
  { value: '-total', label: 'Highest total' },
];

const PAGE_SIZE = 20;

function fmtCurrency(currency: string, value: string | number) {
  const n = typeof value === 'number' ? value : Number(value || 0);
  return `${currency || 'TND'} ${n.toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function PointsBadge({ points }: { points: number }) {
  return (
    <Badge variant="secondary" className="gap-1 tabular-nums font-medium">
      <Star className="size-3 text-amber-500" /> {points}
    </Badge>
  );
}

export default function MyOrdersPage() {
  const user = useAuthStore(s => s.user);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [ordering, setOrdering] = useState('created_at'); // FIFO default
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const detailCtrl = useRef<OrderDetailControllerHandle>(null);

  // ── group-action selection ──
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPosOpen, setBulkPosOpen] = useState(false);
  const [bulkPosChannel, setBulkPosChannel] = useState('');
  const [bulkPosDestinations, setBulkPosDestinations] = useState<SalesChannel[]>([]);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');

  const canSendToPos = hasPermission(user, 'send_to_pos_orders');
  const canSendToDelivery = hasPermission(user, 'send_to_delivery_orders');
  const canCancelOrders = hasPermission(user, 'cancel_orders_lifecycle');
  const canBulk = canSendToPos || canSendToDelivery || canCancelOrders;

  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter/search/sort change resets to page 1.
  useEffect(() => { setCurrentPage(1); }, [statusFilter, search, ordering]);

  // Selection never spans pages/filters — clear it whenever the view changes.
  useEffect(() => { setSelectedIds(new Set()); }, [statusFilter, search, ordering, currentPage]);

  const fetchOrders = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await orderService.getAll({
        assigned_to_me: true,
        page: currentPage,
        page_size: PAGE_SIZE,
        ordering,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
      });
      const paginated = !Array.isArray(res) && Array.isArray(res.results);
      setOrders(paginated ? res.results : (res as OrderListItem[]));
      setTotalOrders(paginated ? res.count : (res as OrderListItem[]).length);
    } catch (err) {
      console.error('Failed to load my orders', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, ordering, search, currentPage]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Channels power the popup's edit/packaging product loads + the bulk POS picker.
  useEffect(() => {
    salesChannelService.getAllChannels()
      .then(setChannels)
      .catch(err => console.error('Failed to load channels', err));
  }, []);

  const openOrder = (o: OrderListItem) => detailCtrl.current?.open(o.id);

  // ── selection helpers ──
  const selectableOrders = useMemo(() => orders.filter(o => !o.is_deleted), [orders]);
  const allSelected = selectableOrders.length > 0 && selectableOrders.every(o => selectedIds.has(o.id));
  const someSelected = selectableOrders.some(o => selectedIds.has(o.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (selectableOrders.every(o => prev.has(o.id))) return new Set();
      return new Set(selectableOrders.map(o => o.id));
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

  const selectedOrders = useMemo(() => orders.filter(o => selectedIds.has(o.id)), [orders, selectedIds]);
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
  const bulkPosChannels = bulkPosDestinations.length ? bulkPosDestinations : channels.filter(c => c.is_active);

  // ── bulk runner ──
  const runBulk = async (
    action: BulkOrderAction,
    ids: number[],
    options: { pos_sales_channel?: number; reason?: string } | undefined,
    verbPast: string,
  ) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await orderService.bulkAction(action, ids, options);
      const { succeeded, failed, total } = res.summary;
      await fetchOrders({ silent: true });
      clearSelection();
      if (failed === 0) {
        toast.success(`${verbPast} ${succeeded} order${succeeded !== 1 ? 's' : ''}.`);
      } else {
        toast.warning(`${verbPast} ${succeeded} of ${total}. ${failed} skipped.`);
      }
    } catch {
      toast.error('Bulk action failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelivery = () =>
    runBulk('submit_delivery', deliveryEligibleIds, undefined, 'Sent to delivery');

  const openBulkPos = async () => {
    setBulkPosChannel('');
    setBulkPosDestinations([]);
    setBulkPosOpen(true);
    try {
      const eligible = selectedOrders.filter(o => posEligibleIds.includes(o.id));
      const repByBrand = new Map<number, number>();
      eligible.forEach(o => { if (o.brand != null && !repByBrand.has(o.brand)) repByBrand.set(o.brand, o.id); });
      const lists = await Promise.all([...repByBrand.values()].map(id => orderService.getPosDestinations(id)));
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
  const handleBulkCancel = async () => {
    await runBulk('cancel', Array.from(selectedIds), { reason: bulkReason.trim() || undefined }, 'Cancelled');
    setBulkCancelOpen(false);
    setBulkReason('');
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold sm:text-xl">My Orders</h1>
            <p className="text-sm text-muted-foreground">
              Orders assigned to {user?.full_name || 'you'} — worked oldest first.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fetchOrders()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by order #, name, phone or address…"
            className="h-10 pl-9 pr-9"
          />
          {searchInput && (
            <Button
              type="button" variant="ghost" size="icon"
              className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchInput('')} aria-label="Clear search"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <Select value={ordering} onValueChange={setOrdering}>
          <SelectTrigger className="h-10 w-full sm:w-56"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Status filter tabs — the full lifecycle (swipeable on phones) */}
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {STATUS_FILTERS.map(s => {
          const active = statusFilter === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              aria-pressed={active}
              className={`shrink-0 snap-start whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/50'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      <Card className="overflow-hidden border-muted/70">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your orders…
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <CheckCircle className="size-8 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">
              {search || statusFilter !== 'all' ? 'No orders match your filters' : 'No orders assigned to you'}
            </p>
            <p className="text-xs">
              {search || statusFilter !== 'all'
                ? 'Try a different search or status.'
                : 'New orders you’re responsible for will appear here.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  {canBulk && (
                    <TableHead className="h-10 w-10 px-2">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all on this page"
                      />
                    </TableHead>
                  )}
                  <TableHead className="h-10 text-xs font-semibold">Order</TableHead>
                  <TableHead className="h-10 text-xs font-semibold">Customer</TableHead>
                  <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Points</TableHead>
                  <TableHead className="h-10 text-xs font-semibold">Status</TableHead>
                  <TableHead className="h-10 text-right text-xs font-semibold">Total</TableHead>
                  <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Created</TableHead>
                  <TableHead className="h-10 w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(o => (
                  <TableRow
                    key={o.id}
                    className={`cursor-pointer ${ORDER_STATUS_ROW_STYLES[o.status] ?? ''}`}
                    onClick={() => openOrder(o)}
                  >
                    {canBulk && (
                      <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelectOne(o.id)}
                          disabled={o.is_deleted}
                          aria-label={`Select ${o.order_number}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{o.order_number}</TableCell>
                    <TableCell className="max-w-[12rem] truncate">
                      <span className="flex items-center gap-1.5">
                        {o.delivery_name || o.client_name || '—'}
                        {o.client_is_blocked && (
                          <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[9px]">Blocked</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums text-sm">
                      {o.delivery_phone || o.client_phone || '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <PointsBadge points={o.client_points ?? 0} />
                    </TableCell>
                    <TableCell><OrderStatusBadge status={o.status} label={o.status_display} /></TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtCurrency(o.currency, o.total)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{fmtDate(o.created_at)}</TableCell>
                    <TableCell><ChevronRight className="size-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Mobile cards */}
            <div className="divide-y md:hidden">
              {orders.map(o => (
                <div key={o.id} className="flex items-start gap-2 p-3">
                  {canBulk && (
                    <Checkbox
                      checked={selectedIds.has(o.id)}
                      onCheckedChange={() => toggleSelectOne(o.id)}
                      disabled={o.is_deleted}
                      className="mt-1 shrink-0"
                      aria-label={`Select ${o.order_number}`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => openOrder(o)}
                    className="flex min-w-0 flex-1 flex-col gap-2 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{o.order_number}</span>
                      <OrderStatusBadge status={o.status} label={o.status_display} />
                    </div>
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{o.delivery_name || o.client_name || '—'}</span>
                      {o.client_is_blocked && (
                        <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[9px]">Blocked</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {(o.delivery_phone || o.client_phone) && (
                        <a
                          href={`tel:${o.delivery_phone || o.client_phone}`}
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-primary"
                        >
                          <Phone className="size-3 shrink-0" />
                          <span className="truncate">{o.delivery_phone || o.client_phone}</span>
                        </a>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 text-amber-500" /> {o.client_points ?? 0} pts
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                      <span className="text-xs text-muted-foreground">{fmtDate(o.created_at)}</span>
                      <span className="text-sm font-semibold tabular-nums">{fmtCurrency(o.currency, o.total)}</span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Pagination */}
      {totalOrders > 0 && (
        <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center text-muted-foreground sm:text-left">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalOrders)} of {totalOrders}
            {' · '}Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button
              variant="outline" size="sm" className="flex-1 gap-1 sm:flex-none"
              disabled={loading || currentPage <= 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            <span className="shrink-0 px-1 text-sm font-medium tabular-nums text-muted-foreground sm:hidden">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm" className="flex-1 gap-1 sm:flex-none"
              disabled={loading || currentPage >= totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating group-action bar */}
      {canBulk && selectedIds.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border bg-background/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <span className="whitespace-nowrap px-2 text-sm font-semibold">{selectedIds.size} selected</span>
            <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
            {canSendToPos && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5"
                disabled={bulkBusy || posEligibleIds.length === 0}
                title={posEligibleIds.length === 0 ? 'Only confirmed orders not yet routed can go to POS' : undefined}
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
                title={deliveryEligibleIds.length === 0 ? 'Only confirmed orders not yet routed can go to delivery' : undefined}
                onClick={handleBulkDelivery}
              >
                <Truck className="size-3.5" /> Delivery
                {deliveryEligibleIds.length > 0 && <span className="tabular-nums">({deliveryEligibleIds.length})</span>}
              </Button>
            )}
            {canCancelOrders && (
              <Button
                size="sm" variant="outline" className="h-8 gap-1.5 text-amber-700 hover:text-amber-800"
                disabled={bulkBusy}
                onClick={() => { setBulkReason(''); setBulkCancelOpen(true); }}
              >
                <Ban className="size-3.5" /> Cancel
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

      {/* Bulk: send selected to POS */}
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
                {bulkPosChannels.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
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

      {/* Bulk: cancel confirm */}
      <Dialog open={bulkCancelOpen} onOpenChange={(o) => { if (!bulkBusy) { setBulkCancelOpen(o); if (!o) setBulkReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}?</DialogTitle>
            <DialogDescription>
              The selected orders will be marked cancelled. Orders that can't be cancelled from their current status are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reason (optional)</Label>
            <Textarea
              value={bulkReason}
              onChange={e => setBulkReason(e.target.value)}
              rows={2}
              placeholder="Why are these being cancelled?"
              disabled={bulkBusy}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkCancelOpen(false); setBulkReason(''); }} disabled={bulkBusy}>
              Keep orders
            </Button>
            <Button onClick={handleBulkCancel} disabled={bulkBusy} className="gap-1.5">
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancel orders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The SAME detail popup as Order Management. */}
      <OrderDetailController
        ref={detailCtrl}
        channels={channels}
        onChanged={() => fetchOrders({ silent: true })}
      />
    </div>
  );
}
