import { useState, memo } from 'react';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getMediaUrl } from '@/utils/helpers';
import type { ProductListItem } from '@/types';
import { getEffectivePrice, fmtTND } from './types';

interface POSProductCardProps {
  product: ProductListItem;
  cartQuantity: number;
  onAdd: () => void;
  price?: number;
  availableQuantity?: number | null;
  disabled?: boolean;
  stockMode?: 'offline' | 'cached';
}

export const POSProductCard = memo(function POSProductCard({
  product,
  cartQuantity,
  onAdd,
  price: priceOverride,
  availableQuantity = null,
  disabled = false,
  stockMode = 'cached',
}: POSProductCardProps) {
  const [imgError, setImgError] = useState(false);

  const resolvedImg = getMediaUrl(product.image_url);
  const showImage = !!resolvedImg && !imgError;

  const originalPrice = getEffectivePrice(product);
  const displayPrice = priceOverride ?? originalPrice;
  const hasDiscount =
    typeof priceOverride === 'number' &&
    Number.isFinite(priceOverride) &&
    priceOverride < originalPrice;
  const stockKnown =
    typeof availableQuantity === 'number' && Number.isFinite(availableQuantity);
  const outOfStock = stockKnown && availableQuantity <= 0;
  const isDisabled = disabled || outOfStock;

  return (
    <Card
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`Add ${product.name} — ${fmtTND(displayPrice)} TND`}
      aria-disabled={isDisabled}
      className="group min-w-0 cursor-pointer overflow-hidden transition-all duration-150
        hover:border-primary hover:shadow-md active:scale-[0.97] select-none
        data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60 data-[disabled=true]:hover:border-border data-[disabled=true]:hover:shadow-none"
      data-disabled={isDisabled}
      onClick={() => {
        if (!isDisabled) onAdd();
      }}
      onKeyDown={e => {
        if (isDisabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdd();
        }
      }}
    >
      {/* Image */}
      <div className="relative h-24 bg-muted flex items-center justify-center overflow-hidden sm:h-28 xl:h-32">
        {showImage ? (
          <img
            src={resolvedImg}
            alt={product.name}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <Package className="size-8 text-muted-foreground/40" />
        )}

        {/* Cart quantity badge */}
        {cartQuantity > 0 && (
          <Badge className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0 min-w-[20px] justify-center">
            {cartQuantity}
          </Badge>
        )}

        {/* Promotion SALE badge */}
        {hasDiscount && (
          <Badge className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0 bg-rose-500 hover:bg-rose-500 text-white border-0">
            SALE
          </Badge>
        )}

        {stockKnown && (
          <Badge
            variant={outOfStock ? 'destructive' : 'secondary'}
            className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate text-[10px] px-1.5 py-0"
          >
            {outOfStock ? 'Rupture' : `Stock ${Math.floor(availableQuantity)}`}
            {stockMode === 'offline' && !outOfStock ? ' offline' : ''}
          </Badge>
        )}
      </div>

      {/* Info */}
      <CardContent className="p-2.5 !pt-2">
        <p className="line-clamp-2 min-h-[2rem] text-sm font-medium leading-tight">
          {product.name}
        </p>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {product.barcode || '—'}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
          <span className={`text-sm font-bold ${hasDiscount ? 'text-rose-600' : ''}`}>
            {fmtTND(displayPrice)}
          </span>
          <span className="text-[10px] text-muted-foreground">TND</span>
          {hasDiscount && (
            <span className="text-[10px] text-muted-foreground line-through ml-auto">
              {fmtTND(originalPrice)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
