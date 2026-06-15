import { useEffect, useState } from 'react';
import {
  Tag,
  Loader2,
  Percent,
  DollarSign,
  CalendarClock,
  Package,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { promotionService } from '@/services/promotion.service';
import { isPromotionLive } from '@/services/offlinePOS.service';
import { TUNIS_TZ } from '@/lib/tunisTime';
import type { PromotionListItem, SalesChannel } from '@/types';
import { fmtTND } from './types';

interface POSPromotionsPanelProps {
  channelId: string;
  selectedChannel: SalesChannel | undefined;
}

function formatDiscount(promo: PromotionListItem): string {
  const val = Number(promo.default_discount_value);
  if (promo.discount_type === 'percentage') return `${val}%`;
  return `${fmtTND(val)} TND`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-TN', {
    timeZone: TUNIS_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function POSPromotionsPanel({ channelId, selectedChannel }: POSPromotionsPanelProps) {
  const [promotions, setPromotions] = useState<PromotionListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId || !selectedChannel?.brand) {
      setPromotions([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    promotionService
      .getAllPromotions({
        sales_channel: Number(channelId),
        current_only: true,
        is_active: true,
        page_size: 500,
      })
      .then(data => {
        if (cancelled) return;
        // Belt-and-braces: the server already filtered, but we apply the
        // same time-aware predicate the POS uses so this panel never
        // shows a row that the price calc would silently ignore.
        const now = new Date();
        setPromotions(data.filter(p => isPromotionLive(p, now)));
      })
      .catch(() => {
        if (!cancelled) setPromotions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId, selectedChannel]);

  if (!channelId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Tag className="size-10 mb-3 opacity-40" />
        <p className="text-sm">Select a sales channel to view promotions</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-10 mb-3 opacity-40 animate-spin" />
        <p className="text-sm">Loading promotions...</p>
      </div>
    );
  }

  if (promotions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Tag className="size-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No active promotions</p>
        <p className="text-xs mt-1 text-center max-w-[220px]">
          Activate promotions from the Promotions management page to see them here.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col gap-2 pr-2 pb-4">
        <p className="text-xs text-muted-foreground px-0.5">
          {promotions.length} active promotion{promotions.length !== 1 ? 's' : ''}
        </p>
        {promotions.map(promo => (
          <div
            key={promo.id}
            className="rounded-lg border bg-card p-3 flex flex-col gap-2"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{promo.name}</p>
                {promo.code && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5">
                    {promo.code}
                  </Badge>
                )}
              </div>
              <Badge
                className={
                  promo.discount_type === 'percentage'
                    ? 'bg-violet-100 text-violet-700 border-violet-200 text-[11px] shrink-0'
                    : 'bg-amber-100 text-amber-700 border-amber-200 text-[11px] shrink-0'
                }
                variant="outline"
              >
                {promo.discount_type === 'percentage' ? (
                  <Percent className="size-3 mr-1" />
                ) : (
                  <DollarSign className="size-3 mr-1" />
                )}
                {formatDiscount(promo)} off
              </Badge>
            </div>

            {/* Product */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="size-3.5 shrink-0" />
              <span className="truncate">{promo.product_name}</span>
            </div>

            {/* Dates + usage */}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarClock className="size-3.5" />
                <span>
                  {formatDate(promo.start_date)} – {promo.end_date ? formatDate(promo.end_date) : 'no end date'}
                </span>
              </div>
              {promo.max_usage != null ? (
                <span className="tabular-nums">
                  {promo.current_usage}/{promo.max_usage} used
                </span>
              ) : (
                <span>Unlimited</span>
              )}
            </div>

            {/* Active indicator */}
            <div className="flex items-center gap-1 text-[11px]">
              {promo.is_currently_active ? (
                <>
                  <CheckCircle2 className="size-3.5 text-green-500" />
                  <span className="text-green-600 font-medium">Currently active</span>
                </>
              ) : (
                <>
                  <XCircle className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Scheduled</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
