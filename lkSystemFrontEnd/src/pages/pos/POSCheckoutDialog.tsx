import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Split,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';
import { POSCustomerSection } from './POSCustomerSection';
import { calculatePOSPayment, roundTND, type POSPaymentMethod } from './posPayment';
import { fmtTND } from './types';

type CheckoutStep = 'customer' | 'payment';

interface POSCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: CheckoutStep;
  onStepChange: (step: CheckoutStep) => void;
  total: number;
  itemCount: number;
  clients: Client[];
  selectedClient: Client | null;
  clientSkipped: boolean;
  onSelectClient: (client: Client) => void;
  onSkipClient: () => void;
  onClearClient: () => void;
  onAddClient: () => void;
  canAddClient: boolean;
  paymentMethod: POSPaymentMethod;
  onPaymentMethodChange: (method: POSPaymentMethod) => void;
  cashAmount: number;
  onCashAmountChange: (value: number) => void;
  cardAmount: number;
  onCardAmountChange: (value: number) => void;
  amountReceived: number;
  onAmountReceivedChange: (value: number) => void;
  customerNote: string;
  onCustomerNoteChange: (value: string) => void;
  submitting: boolean;
  onConfirm: () => void;
}

const PAYMENT_METHODS: Array<{
  value: POSPaymentMethod;
  label: string;
  description: string;
  icon: typeof Banknote;
}> = [
  { value: 'cash', label: 'Espèces', description: 'Montant reçu et monnaie', icon: Banknote },
  { value: 'card', label: 'Carte', description: 'Total réglé par carte', icon: CreditCard },
  { value: 'split', label: 'Espèces + carte', description: 'Répartir le paiement', icon: Split },
];

const safeAmount = (raw: string) => {
  const parsed = Number(raw.replace(',', '.'));
  return roundTND(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
};

export function POSCheckoutDialog({
  open,
  onOpenChange,
  step,
  onStepChange,
  total,
  itemCount,
  clients,
  selectedClient,
  clientSkipped,
  onSelectClient,
  onSkipClient,
  onClearClient,
  onAddClient,
  canAddClient,
  paymentMethod,
  onPaymentMethodChange,
  cashAmount,
  onCashAmountChange,
  cardAmount,
  onCardAmountChange,
  amountReceived,
  onAmountReceivedChange,
  customerNote,
  onCustomerNoteChange,
  submitting,
  onConfirm,
}: POSCheckoutDialogProps) {
  const payment = calculatePOSPayment({
    method: paymentMethod,
    total,
    cashAmount,
    cardAmount,
    amountReceived,
  });

  const selectAndContinue = (client: Client) => {
    onSelectClient(client);
    onStepChange('payment');
  };

  const skipAndContinue = () => {
    onSkipClient();
    onStepChange('payment');
  };

  const handleMethodChange = (method: POSPaymentMethod) => {
    onPaymentMethodChange(method);
    if (method === 'cash') {
      onCashAmountChange(total);
      onCardAmountChange(0);
      onAmountReceivedChange(0);
    } else if (method === 'card') {
      onCashAmountChange(0);
      onCardAmountChange(total);
      onAmountReceivedChange(0);
    } else {
      onCashAmountChange(0);
      onCardAmountChange(total);
      onAmountReceivedChange(0);
    }
  };

  const handleCashPortionChange = (raw: string) => {
    const cash = Math.min(total, safeAmount(raw));
    onCashAmountChange(cash);
    onCardAmountChange(roundTND(Math.max(0, total - cash)));
    if (amountReceived < cash) onAmountReceivedChange(cash);
  };

  const handleCardPortionChange = (raw: string) => {
    const card = Math.min(total, safeAmount(raw));
    const cash = roundTND(Math.max(0, total - card));
    onCardAmountChange(card);
    onCashAmountChange(cash);
    if (amountReceived < cash) onAmountReceivedChange(cash);
  };

  return (
    <Dialog open={open} onOpenChange={openState => !submitting && onOpenChange(openState)}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4 pr-6">
            <div>
              <DialogTitle className="text-lg">Encaissement</DialogTitle>
              <DialogDescription className="mt-1">
                {itemCount} article{itemCount === 1 ? '' : 's'} · {fmtTND(total)} TND
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Badge variant={step === 'customer' ? 'default' : 'secondary'}>1 Client</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant={step === 'payment' ? 'default' : 'secondary'}>2 Paiement</Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {step === 'customer' ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Associer un client</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recherchez par nom, téléphone ou e-mail, créez un client, ou continuez sans client.
                </p>
              </div>
              <POSCustomerSection
                clients={clients}
                selectedClient={selectedClient}
                clientSkipped={clientSkipped}
                onSelectClient={selectAndContinue}
                onSkipClient={skipAndContinue}
                onClearClient={onClearClient}
                onAddClientClick={onAddClient}
                canAddClient={canAddClient}
              />
              {(selectedClient || clientSkipped) && (
                <Button className="w-full" onClick={() => onStepChange('payment')}>
                  Continuer vers le paiement
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/25 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {selectedClient?.full_name || 'Client de passage'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedClient?.phone || selectedClient?.email || 'Aucun client associé'}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onStepChange('customer')}>
                  Modifier
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PAYMENT_METHODS.map(method => {
                  const Icon = method.icon;
                  const active = paymentMethod === method.value;
                  return (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => handleMethodChange(method.value)}
                      className={cn(
                        'flex min-h-20 items-center gap-3 rounded-md border p-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background hover:border-foreground/30 hover:bg-muted/40',
                      )}
                    >
                      <Icon className="size-5 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{method.label}</span>
                        <span className={cn('mt-0.5 block text-[11px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                          {method.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-md border p-4">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <span className="text-sm text-muted-foreground">Total à payer</span>
                  <span className="text-2xl font-bold tabular-nums">{fmtTND(total)} TND</span>
                </div>

                {paymentMethod === 'cash' && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pos-amount-received">Montant reçu</Label>
                      <Input
                        id="pos-amount-received"
                        inputMode="decimal"
                        autoFocus
                        value={amountReceived || ''}
                        onChange={event => onAmountReceivedChange(safeAmount(event.target.value))}
                        placeholder="0.000"
                        className="h-12 text-xl font-semibold tabular-nums"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => onAmountReceivedChange(roundTND(total))}>
                        Exact
                      </Button>
                      {[5, 10, 20, 50].map(extra => (
                        <Button
                          key={extra}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onAmountReceivedChange(roundTND(total + extra))}
                        >
                          +{extra}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {paymentMethod === 'card' && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-3">
                    <span className="text-sm">Montant carte</span>
                    <span className="font-semibold tabular-nums">{fmtTND(total)} TND</span>
                  </div>
                )}

                {paymentMethod === 'split' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="pos-cash-portion">Part espèces</Label>
                        <Input
                          id="pos-cash-portion"
                          inputMode="decimal"
                          value={cashAmount || ''}
                          onChange={event => handleCashPortionChange(event.target.value)}
                          placeholder="0.000"
                          className="h-11 text-base font-semibold tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pos-card-portion">Part carte</Label>
                        <Input
                          id="pos-card-portion"
                          inputMode="decimal"
                          value={cardAmount || ''}
                          onChange={event => handleCardPortionChange(event.target.value)}
                          placeholder="0.000"
                          className="h-11 text-base font-semibold tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pos-split-received">Espèces reçues</Label>
                      <Input
                        id="pos-split-received"
                        inputMode="decimal"
                        value={amountReceived || ''}
                        onChange={event => onAmountReceivedChange(safeAmount(event.target.value))}
                        placeholder="0.000"
                        className="h-11 text-base font-semibold tabular-nums"
                      />
                    </div>
                  </div>
                )}

                <Separator className="my-4" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Total affecté</span>
                  <span className="text-right font-medium tabular-nums">{fmtTND(payment.totalPaid)} TND</span>
                  <span className="text-muted-foreground">Reste</span>
                  <span className="text-right font-medium tabular-nums">{fmtTND(payment.remaining)} TND</span>
                  {(paymentMethod === 'cash' || paymentMethod === 'split') && (
                    <>
                      <span className="text-muted-foreground">Monnaie à rendre</span>
                      <span className="text-right font-semibold tabular-nums text-emerald-600">{fmtTND(payment.change)} TND</span>
                    </>
                  )}
                </div>
              </div>

              {payment.error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {payment.error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pos-checkout-note">Note de vente (optionnelle)</Label>
                <Textarea
                  id="pos-checkout-note"
                  rows={2}
                  value={customerNote}
                  onChange={event => onCustomerNoteChange(event.target.value)}
                  placeholder="Information utile sur cette vente..."
                  className="resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {step === 'payment' && (
          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => onStepChange('customer')} disabled={submitting}>
              <ArrowLeft className="size-4" /> Client
            </Button>
            <Button className="min-w-44" onClick={onConfirm} disabled={!payment.valid || submitting}>
              {submitting ? (
                <><Loader2 className="size-4 animate-spin" /> Traitement...</>
              ) : (
                <><CheckCircle2 className="size-4" /> Confirmer le paiement</>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
