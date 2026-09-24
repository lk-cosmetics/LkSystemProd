import { memo, useState } from 'react';
import { Minus, Package, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMediaUrl } from '@/utils/helpers';
import { getEffectivePrice, fmtTND } from './types';
import type { CartLine } from './types';

interface POSCartItemProps {
  line: CartLine;
  onQty: (productId: number, delta: number) => void;
  onRemove: (productId: number) => void;
  getPrice?: (product: CartLine['product']) => number;
  readOnly?: boolean;
}

export const POSCartItem = memo(function POSCartItem({
  line,
  onQty,
  onRemove,
  getPrice,
  readOnly = false,
}: POSCartItemProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const originalPrice = getEffectivePrice(line.product);
  const unitPrice = getPrice ? getPrice(line.product) : originalPrice;
  const hasDiscount = unitPrice < originalPrice - 0.001;
  const lineTotal = fmtTND(line.quantity * unitPrice);
  const imageUrl = getMediaUrl(line.product.image || line.product.image_url);
  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div className="group py-2.5 transition-colors hover:bg-muted/20">
      <div className="flex items-start gap-2.5">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
          {showImage ? (
            <img
              src={imageUrl ?? undefined}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Package
              className="size-5 text-muted-foreground/40"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
            {line.product.name}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span
              className={`text-[11px] font-semibold tabular-nums ${hasDiscount ? 'text-rose-600' : 'text-muted-foreground'}`}
            >
              {fmtTND(unitPrice)} TND
            </span>
            {hasDiscount && (
              <span className="text-[10px] text-muted-foreground line-through tabular-nums">
                {fmtTND(originalPrice)}
              </span>
            )}
          </div>
        </div>

        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0 text-muted-foreground/60 transition-colors hover:text-destructive group-hover:text-destructive"
            onClick={() => onRemove(line.product.id)}
            aria-label={`Remove ${line.product.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 pl-[4.125rem]">
        {readOnly ? (
          <span className="inline-flex h-7 min-w-12 items-center justify-center rounded-full border bg-muted/40 px-2 text-xs font-semibold tabular-nums">
            x{line.quantity}
          </span>
        ) : (
          <div className="inline-flex h-8 shrink-0 items-center rounded-full border bg-muted/30 p-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-7 rounded-full"
              onClick={() => onQty(line.product.id, -1)}
              aria-label={`Decrease ${line.product.name}`}
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">
              {line.quantity}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-7 rounded-full"
              onClick={() => onQty(line.product.id, 1)}
              aria-label={`Increase ${line.product.name}`}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        )}

        <div className="min-w-0 text-right">
          <p className="text-[10px] text-muted-foreground">Line total</p>
          <p
            className={`text-sm font-bold tabular-nums leading-tight ${hasDiscount ? 'text-rose-600' : ''}`}
          >
            {lineTotal}{' '}
            <span className="text-[10px] font-medium text-muted-foreground">
              TND
            </span>
          </p>
        </div>
      </div>
    </div>
  );
});
