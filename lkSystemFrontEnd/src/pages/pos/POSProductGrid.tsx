import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type {
  POSCatalogTypeCounts,
  POSCatalogTypeFilter,
} from './types';
import {
  Search,
  Store,
  Loader2,
  Camera,
  Tag,
  ShoppingBag,
  Boxes,
  Clock3,
  Phone,
  User,
  RefreshCw,
  History,
  Pencil,
  CalendarDays,
  RotateCcw,
  X,
  ExternalLink,
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
  /** Product-type axis, independent of the category. */
  typeFilter?: POSCatalogTypeFilter;
  onTypeFilterChange?: (value: POSCatalogTypeFilter) => void;
  /** How many products each segment would reveal in the current category. */
  typeCounts?: POSCatalogTypeCounts;
  /** Category axis, independent of the product type. */
  categoryFilter?: number | 'all';
  onCategoryFilterChange?: (value: number | 'all') => void;
  categoryOptions?: { id: number; name: string }[];
  /** Whether anything in the channel is currently discounted. */
  promotionsAvailable?: boolean;
  getPrice?: (product: ProductListItem) => number;
  getAvailableQuantity?: (product: ProductListItem) => number | null;
  isOfflineMode?: boolean;
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

/**
 * One catalog quick-filter chip.
 *
 * Extracted so every chip shares the exact same hit area (h-9, comfortable for
 * a finger on a counter tablet), radius, selected treatment and focus ring —
 * previously this markup was duplicated per chip and drifted easily.
 */
function FilterChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </button>
  );
}

/**
 * One product-type segment, carrying the count of what it would reveal.
 *
 * Mirrors the public vitrine's Tous / Produits / Packs control: a segment that
 * would show nothing is disabled rather than hidden, so the row does not
 * reflow under the cashier's finger as they move between categories.
 */
function TypeSegment({
  active,
  count,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  const empty = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-foreground bg-foreground text-background'
          : empty
            ? 'cursor-not-allowed border-border bg-muted/30 text-muted-foreground/50'
            : 'border-border bg-background text-foreground hover:bg-muted/60'
      }`}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
      <span
        className={`text-xs tabular-nums ${active ? 'opacity-70' : 'opacity-60'}`}
      >
        {count}
      </span>
    </button>
  );
}

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
  typeFilter = 'all',
  onTypeFilterChange,
  typeCounts = { all: 0, resell_product: 0, pack: 0, promo: 0 },
  categoryFilter = 'all',
  onCategoryFilterChange,
  categoryOptions = [],
  promotionsAvailable = false,
  getPrice,
  getAvailableQuantity,
  isOfflineMode = false,
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
  const openPublicVitrine = () => {
    if (!channelId) return;
    window.open(`/vitrine/${channelId}`, '_blank', 'noopener,noreferrer');
  };
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
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end">
        <div className="w-full sm:w-64 lg:w-60 xl:w-72">
          <Label className="mb-1 block text-xs">Canal de vente</Label>
          {/* Vitrine sits directly beside the channel select because it opens
              the storefront OF THAT CHANNEL. Grouping them makes the relation
              explicit, and it reclaims the full row the stacked button used to
              cost — that row now belongs to the product grid. */}
          <div className="flex gap-1.5">
            <Select value={channelId} onValueChange={onChannelChange}>
              <SelectTrigger className="h-10 min-w-0 flex-1">
                <SelectValue placeholder="Choisir un canal…" />
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
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 gap-1.5 px-3"
              onClick={openPublicVitrine}
              disabled={!channelId}
              aria-label="Ouvrir la vitrine de ce canal dans un nouvel onglet"
              title="Ouvrir la vitrine de ce canal"
            >
              <ExternalLink className="size-4" />
              <span className="hidden text-sm sm:inline">Vitrine</span>
            </Button>
          </div>
        </div>

        {activeTab === 'products' && (
          <div className="min-w-0 flex-1">
            <Label className="mb-1 block text-xs">Rechercher un produit</Label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Nom du produit ou code-barres…"
                  className="h-10 pl-9"
                  value={productSearch}
                  onChange={e => onSearchChange(e.target.value)}
                  disabled={!channelId}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                onClick={onCameraScan}
                disabled={!channelId}
                aria-label="Scanner un code-barres avec la caméra"
                title="Scanner avec la caméra"
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
          Produits
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
          En attente
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
          Historique
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
                <p className="text-sm font-medium">Commandes en attente d’encaissement</p>
                <p className="text-xs text-muted-foreground">
                  {selectedChannel
                    ? `Commandes assignées à ${selectedChannel.name}.`
                    : 'Sélectionnez un canal de vente pour voir les commandes.'}
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
                <p className="text-sm">Chargement des commandes…</p>
              </div>
            ) : !channelId ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Store className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Sélectionnez d’abord un canal de vente</p>
              </div>
            ) : waitingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Clock3 className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Aucune commande en attente</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {waitingOrders.map(order => {
                  const isSelected = selectedWaitingOrderId === order.id;
                  const customerName = order.client_name || 'Walk-in pickup';
                  const customerPhone = order.client_phone || order.billing_phone || 'Téléphone non renseigné';
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
                          {isSelected ? 'Chargée' : 'Charger'}
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
                      Plus récentes d’abord
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Recherche par ticket, client ou téléphone. Scannez le QR d’un reçu pour l’ouvrir directement.
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
                      Effacer
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
                      placeholder="Ticket, nom du client ou téléphone…"
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
                <p className="text-sm">Chargement de l’historique…</p>
              </div>
            ) : !channelId ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Store className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Sélectionnez d’abord un canal de vente</p>
              </div>
            ) : historyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <History className="size-10 mb-3 opacity-40" />
                <p className="text-sm">Aucune vente enregistrée</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sortedHistoryOrders.map(order => {
                  const isSelected = selectedHistoryOrderId === order.id;
                  const customerName = order.client_name || 'Walk-in customer';
                  const ticket = order.ticket_id || order.order_number;
                  const isReturned = Boolean(order.returned_at) || order.status === 'returned';
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
                              Retourner
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
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {channelId && (
            <div className="mb-1 shrink-0 space-y-1.5">
              {/* Category axis. Horizontal scroll with a 4px gutter so the
                  focus ring on the first/last chip is not sliced off by the
                  scroll container. */}
              {categoryOptions.length > 0 && (
                <div
                  role="group"
                  aria-label="Filtrer par catégorie"
                  className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <FilterChip
                    active={categoryFilter === 'all'}
                    onClick={() => onCategoryFilterChange?.('all')}
                  >
                    Toutes
                  </FilterChip>
                  {categoryOptions.map(category => (
                    <FilterChip
                      key={category.id}
                      active={categoryFilter === category.id}
                      onClick={() => onCategoryFilterChange?.(category.id)}
                    >
                      {category.name}
                    </FilterChip>
                  ))}
                </div>
              )}

              {/* Product-type axis: a segmented control carrying counts, so the
                  cashier can see what each segment holds before tapping it.
                  Independent of the category above. */}
              <div
                role="group"
                aria-label="Filtrer par type"
                className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <TypeSegment
                  active={typeFilter === 'all'}
                  count={typeCounts.all}
                  onClick={() => onTypeFilterChange?.('all')}
                >
                  Tous
                </TypeSegment>
                <TypeSegment
                  active={typeFilter === 'resell_product'}
                  count={typeCounts.resell_product}
                  onClick={() => onTypeFilterChange?.('resell_product')}
                  icon={ShoppingBag}
                >
                  Produits
                </TypeSegment>
                <TypeSegment
                  active={typeFilter === 'pack'}
                  count={typeCounts.pack}
                  onClick={() => onTypeFilterChange?.('pack')}
                  icon={Boxes}
                >
                  Packs
                </TypeSegment>
                {promotionsAvailable && (
                  <TypeSegment
                    active={typeFilter === 'promo'}
                    count={typeCounts.promo}
                    onClick={() => onTypeFilterChange?.('promo')}
                    icon={Tag}
                  >
                    Promotions
                  </TypeSegment>
                )}
              </div>
            </div>
          )}
          <div className="min-h-0 w-full flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full">
            {!channelId ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Store className="size-10 mb-3 opacity-40" />
              <p className="text-sm">Sélectionnez un canal de vente pour voir les produits</p>
            </div>
          ) : isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-10 mb-3 opacity-40 animate-spin" />
                <p className="text-sm">Chargement des produits…</p>
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="size-10 mb-3 opacity-40" />
                <p className="text-sm font-medium">Aucun produit trouvé</p>
                <p className="mt-1 text-xs">
                  Essayez un autre terme ou choisissez un autre filtre.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-2 pb-4 sm:px-3 lg:px-4">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
                  {products.map(p => {
                    const availableQuantity = getAvailableQuantity?.(p) ?? null;
                    return (
                      <POSProductCard
                        key={p.id}
                        product={p}
                        cartQuantity={cartQuantities.get(p.id) ?? 0}
                        onAdd={() => onAddToCart(p)}
                        price={getPrice ? getPrice(p) : undefined}
                        availableQuantity={availableQuantity}
                        disabled={isOfflineMode && availableQuantity !== null && availableQuantity <= 0}
                        stockMode={isOfflineMode ? 'offline' : 'cached'}
                      />
                    );
                  })}
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
                        Charger plus
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
