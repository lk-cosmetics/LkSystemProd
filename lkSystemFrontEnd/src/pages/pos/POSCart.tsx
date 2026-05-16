import {
  ShoppingCart,
  CreditCard,
  Banknote,
  Building2,
  Loader2,
  Receipt,
  Trash2,
  Tag,
  PackageCheck,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { POSCartItem } from './POSCartItem';
import { POSCalculator } from './POSCalculator';
import { POSCustomerSection } from './POSCustomerSection';
import { fmtTND } from './types';
import type { Client } from '@/types';
import type { CartLine } from './types';

/* ── Payment options ───────────────────────────────────────────────────── */

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Transfer', icon: Building2 },
] as const;

/* ── Props ─────────────────────────────────────────────────────────────── */

interface POSCartProps {
  cart: CartLine[];
  cartTotal: number;
  cartOriginalTotal: number;
  cartItemCount: number;
  onQtyChange: (productId: number, delta: number) => void;
  onRemove: (productId: number) => void;
  onClearCart: () => void;
  getPrice?: (product: CartLine['product']) => number;
  /* Customer handling */
  clients: Client[];
  selectedClient: Client | null;
  clientSkipped: boolean;
  onSelectClient: (client: Client) => void;
  onSkipClient: () => void;
  onClearClient: () => void;
  onAddClientClick: () => void;
  canAddClient?: boolean;
  /* Payment & checkout */
  paymentMethod: string;
  onPaymentMethodChange: (value: string) => void;
  manualDiscountType: 'fixed' | 'percentage';
  manualDiscountValue: string;
  manualDiscountAmount: number;
  onManualDiscountTypeChange: (value: 'fixed' | 'percentage') => void;
  onManualDiscountValueChange: (value: string) => void;
  customerNote: string;
  onNoteChange: (value: string) => void;
  amountReceived: number;
  onAmountReceivedChange: (amount: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  readOnlyCart?: boolean;
  lockedOrderLabel?: string;
  lockedOrderMeta?: string;
  onReleaseLockedOrder?: () => void;
  onReturnLockedOrder?: () => void;
  returningLockedOrder?: boolean;
  submitLabel?: string;
  submittingLabel?: string;
  compact?: boolean;
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function POSCart({
  cart,
  cartTotal,
  cartOriginalTotal,
  cartItemCount,
  onQtyChange,
  onRemove,
  onClearCart,
  getPrice,
  clients,
  selectedClient,
  clientSkipped,
  onSelectClient,
  onSkipClient,
  onClearClient,
  onAddClientClick,
  canAddClient = true,
  paymentMethod,
  onPaymentMethodChange,
  manualDiscountType,
  manualDiscountValue,
  manualDiscountAmount,
  onManualDiscountTypeChange,
  onManualDiscountValueChange,
  customerNote,
  onNoteChange,
  amountReceived,
  onAmountReceivedChange,
  onSubmit,
  submitting,
  disabled,
  readOnlyCart = false,
  lockedOrderLabel,
  lockedOrderMeta,
  onReleaseLockedOrder,
  onReturnLockedOrder,
  returningLockedOrder = false,
  submitLabel,
  submittingLabel,
  compact = false,
}: POSCartProps) {
  const hasItems = cart.length > 0;
  const savings = Math.max(0, cartOriginalTotal - cartTotal);
  const promotionSavings = Math.max(0, cartOriginalTotal - cartTotal - manualDiscountAmount);
  const hasDiscount = savings > 0.001;
  const hasManualDiscount = manualDiscountAmount > 0.001;
  const hasPromotionDiscount = promotionSavings > 0.001;
  const itemAreaClass = compact
    ? 'max-h-[32dvh] shrink-0 -mx-1 overflow-y-auto pr-1'
    : 'max-h-[15rem] shrink-0 -mx-1 overflow-y-auto pr-1';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-4" />
          <span className="font-semibold text-sm">Cart</span>
          {cartItemCount > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {cartItemCount}
            </Badge>
          )}
        </div>
        {hasItems && readOnlyCart && onReleaseLockedOrder && (
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={onReleaseLockedOrder}
          >
            <X className="size-3" />
            Release
          </Button>
        )}
        {hasItems && !readOnlyCart && (
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive gap-1"
            onClick={onClearCart}
          >
            <Trash2 className="size-3" />
            Clear
          </Button>
        )}
      </div>

      {lockedOrderLabel && (
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="flex min-w-0 items-center gap-2">
              <PackageCheck className="size-4 shrink-0 text-primary" />
              <span className="truncate">{lockedOrderLabel}</span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {onReturnLockedOrder && (
                <Button
                  variant="outline"
                  size="xs"
                  className="h-6 gap-1 text-amber-700 hover:text-amber-800"
                  onClick={onReturnLockedOrder}
                  disabled={returningLockedOrder}
                >
                  {returningLockedOrder ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  Return
                </Button>
              )}
              {onReleaseLockedOrder && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 gap-1"
                  onClick={onReleaseLockedOrder}
                >
                  <X className="size-3" />
                  Release
                </Button>
              )}
            </div>
          </div>
          {lockedOrderMeta && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {lockedOrderMeta}
            </p>
          )}
        </div>
      )}

      {/* ── Items list ──────────────────────────────────────────────── */}
      <div className={hasItems ? itemAreaClass : 'shrink-0 rounded-md border bg-background/60'}>
        {!hasItems ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ShoppingCart className="size-8 mb-2 opacity-30" />
            <p className="text-sm">Cart is empty</p>
            <p className="text-xs mt-1">Tap a product to add it</p>
          </div>
        ) : (
          <div className="space-y-2 px-1 py-1">
            {cart.map(line => (
              <POSCartItem
                key={line.product.id}
                line={line}
                onQty={onQtyChange}
                onRemove={onRemove}
                getPrice={getPrice}
                readOnly={readOnlyCart}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Checkout section ────────────────────────────────────────── */}
      {hasItems && (
        <>
          <Separator className="shrink-0" />

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {/* Customer */}
            {!readOnlyCart && (
              <div>
                <Label className="text-xs mb-1.5 block">Customer</Label>
                <POSCustomerSection
                  clients={clients}
                  selectedClient={selectedClient}
                  clientSkipped={clientSkipped}
                  onSelectClient={onSelectClient}
                  onSkipClient={onSkipClient}
                  onClearClient={onClearClient}
                  onAddClientClick={onAddClientClick}
                  canAddClient={canAddClient}
                />
              </div>
            )}

            {/* Payment Method */}
            <div>
              <Label className="text-xs mb-1 block">Payment</Label>
              <div className="flex gap-1.5">
                {PAYMENT_METHODS.map(pm => {
                  const Icon = pm.icon;
                  const isActive = paymentMethod === pm.value;
                  return (
                    <Button
                      key={pm.value}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1 gap-1.5 h-8 text-xs"
                      onClick={() => onPaymentMethodChange(pm.value)}
                    >
                      <Icon className="size-3.5" />
                      {pm.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {!readOnlyCart && (
              <div className="rounded-md border bg-muted/20 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label className="text-xs">Discount</Label>
                  <div className="flex rounded-md border bg-background p-0.5">
                    <Button
                      type="button"
                      variant={manualDiscountType === 'fixed' ? 'default' : 'ghost'}
                      size="xs"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => onManualDiscountTypeChange('fixed')}
                    >
                      TND
                    </Button>
                    <Button
                      type="button"
                      variant={manualDiscountType === 'percentage' ? 'default' : 'ghost'}
                      size="xs"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => onManualDiscountTypeChange('percentage')}
                    >
                      %
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max={manualDiscountType === 'percentage' ? 100 : undefined}
                    step={manualDiscountType === 'percentage' ? 1 : 0.001}
                    value={manualDiscountValue}
                    onChange={e => onManualDiscountValueChange(e.target.value)}
                    placeholder={manualDiscountType === 'percentage' ? 'Discount %' : 'Discount amount'}
                    className="h-9 text-sm"
                  />
                  <Badge variant="outline" className="h-9 shrink-0 px-2 tabular-nums">
                    -{fmtTND(manualDiscountAmount)}
                  </Badge>
                </div>
              </div>
            )}

            {/* Note */}
            <div>
              <Label className="text-xs mb-1 block">Note</Label>
              <Textarea
                rows={compact ? 1 : 2}
                value={customerNote}
                onChange={e => onNoteChange(e.target.value)}
                placeholder="Optional note..."
                className="text-sm resize-none"
              />
            </div>

            {/* Calculator (cash only) */}
            {paymentMethod === 'cash' && (
              <POSCalculator
                total={cartTotal}
                amountReceived={amountReceived}
                onAmountChange={onAmountReceivedChange}
                compact={compact}
              />
            )}

            {/* ── Totals & Submit ─────────────────────────────────────── */}
            <div className="border-t pt-3 space-y-1.5">

              {/* Subtotal row — only when a discount applies */}
              {hasDiscount && (
                <div className="flex justify-between items-baseline text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums line-through">
                    {fmtTND(cartOriginalTotal)} TND
                  </span>
                </div>
              )}

              {/* Savings row */}
              {hasPromotionDiscount && (
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                    <Tag className="size-3.5" />
                    Promotions
                  </span>
                  <span className="text-sm font-semibold text-green-600 tabular-nums">
                    −{fmtTND(promotionSavings)} TND
                  </span>
                </div>
              )}

              {hasManualDiscount && (
                <div className="flex justify-between items-center">
                  <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                    <Tag className="size-3.5" />
                    Manual discount
                  </span>
                  <span className="text-sm font-semibold text-green-600 tabular-nums">
                    −{fmtTND(manualDiscountAmount)} TND
                  </span>
                </div>
              )}

              {/* Total */}
              <div className="flex justify-between items-baseline pt-0.5">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className={`text-xl font-bold tabular-nums ${hasDiscount ? 'text-green-600' : ''}`}>
                  {fmtTND(cartTotal)}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    TND
                  </span>
                </span>
              </div>

              <Button
                className="w-full h-11 text-sm font-semibold gap-2 mt-1"
                size="lg"
                disabled={disabled || submitting}
                onClick={onSubmit}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {submittingLabel ?? 'Applying promotions & processing...'}
                  </>
                ) : (
                  <>
                    <Receipt className="size-4" />
                    {submitLabel ?? 'Place Order'} — {fmtTND(cartTotal)} TND
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
