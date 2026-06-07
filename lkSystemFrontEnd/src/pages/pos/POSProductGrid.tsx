import { useEffect, useRef, useState } from 'react';
import {
  Search,
  Store,
  Loader2,
  Camera,
  Tag,
  ShoppingBag,
  Clock3,
  Phone,
  User,
  RefreshCw,
  History,
  Pencil,
  CalendarDays,
  RotateCcw,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { POSProductCard } from './POSProductCard';
import { POSPromotionsPanel } from './POSPromotionsPanel';
import { fmtTND } from './types';
import type { OrderListItem, ProductListItem, SalesChannel } from '@/types';

interface POSProductGridProps {
  channels: SalesChannel[];
  channelId: string;
  onChannelChange: (value: string) => void;
  productSearch: string;
  onSearchChange: (value: string) => void;
  products: ProductListItem[];
  cartQuantities: Map<number, number>;
  onAddToCart: (product: ProductListItem) => void;
  onCameraScan: () => void;
  getPrice?: (product: ProductListItem) => number;
  isLoading?: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  selectedChannel?: SalesChannel;
  waitingOrders?: OrderListItem[];
  waitingOrdersLoading?: boolean;
  waitingOrderCount?: number;
  selectedWaitingOrderId?: number | null;
  onSelectWaitingOrder?: (order: OrderListItem) => void;
  onRefreshWaitingOrders?: () => void;
  historyOrders?: OrderListItem[];
  historyOrdersLoading?: boolean;
  historyOrderCount?: number;
  historySearch?: string;
  onHistorySearchChange?: (value: string) => void;
  historyDateFrom?: string;
  onHistoryDateFromChange?: (value: string) => void;
  historyDateTo?: string;
  onHistoryDateToChange?: (value: string) => void;
  selectedHistoryOrderId?: number | null;
  onSelectHistoryOrder?: (order: OrderListItem) => void;
  onReturnHistoryOrder?: (order: OrderListItem) => void;
  onRefreshHistoryOrders?: () => void;
}

type ActiveTab = 'products' | 'waiting_pos' | 'promotions' | 'history';

export function POSProductGrid({
  channels,
  channelId,
  onChannelChange,
  productSearch,
  onSearchChange,
  products,
  cartQuantities,
  onAddToCart,
  onCameraScan,
  getPrice,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  selectedChannel,
  waitingOrders = [],
  waitingOrdersLoading = false,
  waitingOrderCount = 0,
  selectedWaitingOrderId = null,
  onSelectWaitingOrder,
  onRefreshWaitingOrders,
  historyOrders = [],
  historyOrdersLoading = false,
  historyOrderCount = 0,
  historySearch = '',
  onHistorySearchChange,
  historyDateFrom = '',
  onHistoryDateFromChange,
  historyDateTo = '',
  onHistoryDateToChange,
  selectedHistoryOrderId = null,
  onSelectHistoryOrder,
  onReturnHistoryOrder,
  onRefreshHistoryOrders,
}: POSProductGridProps) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('products');
  const hasHistoryFilters = Boolean(historySearch || historyDateFrom || historyDateTo);
  const sortedHistoryOrders = [...historyOrders].sort((a, b) => {
    const bTime = new Date(b.created_at || b.updated_at || '').getTime() || 0;
    const aTime = new Date(a.created_at || a.updated_at || '').getTime() || 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(b.ticket_id || b.order_number).localeCompare(String(a.ticket_id || a.order_number));
  });

  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node || !hasNextPage || !fetchNextPage) return;

    const observer = new IntersectionObserver(
      entries => {
        const [entry] = entries;
        if (!entry.isIntersecting || isFetchingNextPage) return;
        fetchNextPage();
      },
      { root: null, rootMargin: '200px', threshold: 0.1 }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {/* Controls Row */}
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <div className="w-full sm:w-52 lg:w-48 xl:w-56">
          <Label className="text-xs mb-1 block">Sales Channel</Label>
          <Select value={channelId} onValueChange={onChannelChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select channel..." />
            </SelectTrigger>
            <SelectContent>
              {channels.map(ch => (
                <SelectItem key={ch.id} value={String(ch.id)}>
                  <div className="flex items-center gap-2">
                    <Store className="size-3.5 text-muted-foreground" />
                    {ch.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {activeTab === 'products' && (
          <div className="flex-1">
            <Label className="text-xs mb-1 block">Search Products</Label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or barcode..."
                  className="pl-9"
                  value={productSearch}
                  onChange={e => onSearchChange(e.target.value)}
                  disabled={!channelId}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 size-9"
                onClick={onCameraScan}
                disabled={!channelId}
                aria-label="Scan barcode with camera"
                title="Scan with Camera"
              >
                <Camera className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b px-1 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => setActiveTab('products')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'products'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShoppingBag className="size-3.5" />
          Products
        </button>
        <button
          onClick={() => setActiveTab('waiting_pos')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'waiting_pos'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock3 className="size-3.5" />
          Waiting POS
          <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[11px]">
            {waitingOrderCount}
          </Badge>
        </button>
        <button
          onClick={() => setActiveTab('promotions')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'promotions'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Tag className="size-3.5" />
          Promotions
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'history'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="size-3.5" />
          History
          <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[11px]">
            {historyOrderCount}
          </Badge>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'waiting_pos' ? (
        <div className="flex-1 min-h-0 w-full overflow-hidden">
          <ScrollArea className="h-full w-full">
            <div className="space-y-3 px-4 pb-4">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Orders waiting for this POS checkout</p>
                <p className="text-xs text-muted-foreground">
                  {selectedChannel
                    ? `Showing orders assigned to ${selectedChannel.name}.`
                    : 'Select a sales channel to see assigned orders.'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onRefreshWaitingOrders}
                disabled={waitingOrdersLoading}
              >
                <RefreshCw className={`size-3.5 ${waitingOrdersLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {waitingOrdersLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-10 mb-3 opacity-40 animate-spin" />
                <p className="text-sm">Loading waiting orders...</p>
              </div>
            ) : !channelId ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Store className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Select a sales channel first</p>
              </div>
            ) : waitingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Clock3 className="size-10 mb-3 opacity-40" />
                <p className="text-sm">No orders waiting for POS</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {waitingOrders.map(order => {
                  const isSelected = selectedWaitingOrderId === order.id;
                  const customerName = order.client_name || 'Walk-in pickup';
                  const customerPhone = order.client_phone || order.billing_phone || 'No phone';
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => onSelectWaitingOrder?.(order)}
                      className={`rounded-md border bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/30 ${
                        isSelected ? 'border-primary ring-1 ring-primary/30' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {order.order_number}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {order.sales_channel_name}
                          </p>
                        </div>
                        <Badge variant={isSelected ? 'default' : 'secondary'}>
                          {fmtTND(Number(order.total || 0))} TND
                        </Badge>
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <User className="size-3.5 shrink-0" />
                          <span className="truncate">{customerName}</span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Phone className="size-3.5 shrink-0" />
                          <span className="truncate">{customerPhone}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {order.line_count} item{order.line_count === 1 ? '' : 's'}
                        </span>
                        <span className="text-xs font-medium text-primary">
                          {isSelected ? 'Loaded' : 'Load order'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </ScrollArea>
        </div>
      ) : activeTab === 'promotions' ? (
        <POSPromotionsPanel channelId={channelId} selectedChannel={selectedChannel} />
      ) : activeTab === 'history' ? (
        <div className="flex-1 min-h-0 w-full overflow-hidden">
          <ScrollArea className="h-full w-full">
            <div className="space-y-3 px-4 pb-4">
            <div className="rounded-md border bg-muted/30 px-3 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">Current POS order history</p>
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                      Latest first
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Search by ticket, client or phone. Scan a receipt QR to open it fast.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hasHistoryFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => {
                        onHistorySearchChange?.('');
                        onHistoryDateFromChange?.('');
                        onHistoryDateToChange?.('');
                      }}
                      disabled={historyOrdersLoading}
                    >
                      <X className="size-3.5" />
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2"
                    onClick={onRefreshHistoryOrders}
                    disabled={historyOrdersLoading}
                  >
                    <RefreshCw className={`size-3.5 ${historyOrdersLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_160px_160px]">
                <div>
                  <Label className="mb-1 block text-xs">Search history</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Ticket, client name or phone..."
                      value={historySearch}
                      onChange={event => onHistorySearchChange?.(event.target.value)}
                      disabled={!channelId}
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1 block text-xs">From</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-9"
                      value={historyDateFrom}
                      onChange={event => onHistoryDateFromChange?.(event.target.value)}
                      disabled={!channelId}
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1 block text-xs">To</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-9"
                      value={historyDateTo}
                      min={historyDateFrom || undefined}
                      onChange={event => onHistoryDateToChange?.(event.target.value)}
                      disabled={!channelId}
                    />
                  </div>
                </div>
              </div>
            </div>

            {historyOrdersLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-10 mb-3 opacity-40 animate-spin" />
                <p className="text-sm">Loading history...</p>
              </div>
            ) : !channelId ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Store className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Select a sales channel first</p>
              </div>
            ) : historyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <History className="size-10 mb-3 opacity-40" />
                <p className="text-sm">No POS orders yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sortedHistoryOrders.map(order => {
                  const isSelected = selectedHistoryOrderId === order.id;
                  const customerName = order.client_name || 'Walk-in customer';
                  const ticket = order.ticket_id || order.order_number;
                  const isReturned = Boolean(order.returned_at) || order.return_exchange_status === 'RETURNED' || order.status === 'REFUNDED';
                  const createdAt = order.created_at
                    ? new Intl.DateTimeFormat('fr-TN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(order.created_at))
                    : '';
                  return (
                    <div
                      key={order.id}
                      className={`group rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/60 hover:bg-muted/20 ${
                        isSelected ? 'border-primary ring-1 ring-primary/30' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate text-sm font-semibold">#{ticket}</p>
                            {isReturned && (
                              <Badge variant="destructive" className="h-5 shrink-0 px-2 text-[11px]">
                                Returned
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {customerName}
                          </p>
                          {createdAt && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {createdAt}
                            </p>
                          )}
                        </div>
                        <Badge variant={isSelected ? 'default' : 'secondary'} className="shrink-0 rounded-full tabular-nums">
                          {fmtTND(Number(order.total || 0))} TND
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                        <Badge variant="outline" className="h-6 rounded-full px-2 text-[11px]">
                          {order.line_count} item{order.line_count === 1 ? '' : 's'}
                        </Badge>
                        <div className="flex items-center gap-1.5">
                          {!isReturned && onReturnHistoryOrder && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs text-amber-700 hover:text-amber-800"
                              onClick={() => onReturnHistoryOrder(order)}
                            >
                              <RotateCcw className="size-3.5" />
                              Return
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant={isSelected ? 'default' : 'ghost'}
                            size="sm"
                            className="h-7 gap-1.5 px-2 text-xs"
                            onClick={() => onSelectHistoryOrder?.(order)}
                            disabled={isReturned}
                          >
                            <Pencil className="size-3.5" />
                            {isSelected ? 'Editing' : 'Edit'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex-1 min-h-0 w-full overflow-hidden">
          <ScrollArea className="h-full w-full">
            {!channelId ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Store className="size-10 mb-3 opacity-40" />
              <p className="text-sm">Select a sales channel to browse products</p>
            </div>
          ) : isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-10 mb-3 opacity-40 animate-spin" />
                <p className="text-sm">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="size-10 mb-3 opacity-40" />
                <p className="text-sm">No products found</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-2 pb-4 sm:px-3 lg:px-4">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                  {products.map(p => (
                    <POSProductCard
                      key={p.id}
                      product={p}
                      cartQuantity={cartQuantities.get(p.id) ?? 0}
                      onAdd={() => onAddToCart(p)}
                      price={getPrice ? getPrice(p) : undefined}
                    />
                  ))}
                </div>
                {hasNextPage && (
                  <div className="mt-2">
                    <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden="true" />
                    <div className="flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchNextPage?.()}
                        disabled={isFetchingNextPage}
                      >
                        {isFetchingNextPage && <Loader2 className="mr-2 size-4 animate-spin" />}
                        Load More
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
