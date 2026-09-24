import { useState, memo } from 'react';
import { Package } from 'lucide-react';
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

  const resolvedImg = getMediaUrl(product.image || product.image_url);
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
  const isPack = product.product_type === 'pack' || product.is_pack;

  return (
    <button
      type="button"
      disabled={isDisabled}
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`Add ${product.name} — ${fmtTND(displayPrice)} TND`}
      aria-disabled={isDisabled}
      className="group grid h-full min-w-0 grid-rows-[auto_7.75rem] appearance-none overflow-hidden bg-transparent p-0 text-left transition-opacity duration-150 active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-55 select-none"
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
      <div className="relative aspect-square w-full overflow-hidden bg-neutral-100">
        {showImage ? (
          <img
            src={resolvedImg}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <Package className="size-8 text-muted-foreground/40" />
        )}

        {/* Cart quantity badge */}
        {cartQuantity > 0 && (
          <Badge className="absolute right-2 top-2 min-w-5 justify-center rounded-sm bg-black px-1.5 py-0 text-[10px] text-white hover:bg-black">
            {cartQuantity}
          </Badge>
        )}

        {/* Promotion SALE badge */}
        {hasDiscount && (
          <Badge className="absolute left-2 top-2 rounded-sm border-0 bg-black px-2 py-0.5 text-[10px] font-bold uppercase text-white hover:bg-black">
            Promo
          </Badge>
        )}

        {isPack && (
          <Badge
            className={`absolute rounded-sm bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-black shadow-sm hover:bg-white ${hasDiscount ? 'left-2 top-8' : 'left-2 top-2'}`}
          >
            Pack
          </Badge>
        )}

        {stockKnown && (
          <Badge
            variant={outOfStock ? 'destructive' : 'secondary'}
            className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] truncate rounded-sm px-1.5 py-0 text-[10px]"
          >
            {outOfStock ? 'Rupture' : `Stock ${Math.floor(availableQuantity)}`}
            {stockMode === 'offline' && !outOfStock ? ' offline' : ''}
          </Badge>
        )}
      </div>

      {/* Info */}
      <div className="grid min-h-[7.75rem] grid-rows-[2.5rem_1rem_1.5rem] content-start gap-y-1.5 pt-2.5">
        <p className="line-clamp-2 min-h-10 text-sm font-semibold uppercase leading-snug tracking-normal text-foreground">
          {product.name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {product.barcode || '—'}
        </p>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-black text-foreground">
            {fmtTND(displayPrice)} TND
          </span>
          {hasDiscount && (
            <span className="text-[10px] text-muted-foreground line-through">
              {fmtTND(originalPrice)} TND
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
