import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  Split,
  UserRound,
} from 'lucide-react';
import type { KeyboardEventHandler } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { Client } from '@/types';
import {
  POSActionCard,
  POSDialogBody,
  POSDialogContent,
  POSDialogFooter,
  POSDialogHeader,
  POSPrimaryButton,
  POSSecondaryButton,
  POSStepIndicator,
} from './POSDialog';
import { POSCustomerSection } from './POSCustomerSection';
import {
  calculatePOSPayment,
  roundTND,
  type POSPaymentMethod,
} from './posPayment';
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

const PAYMENT_METHODS = [
  {
    value: 'cash' as const,
    label: 'Espèces',
    description: 'Saisir le montant reçu et calculer la monnaie',
    icon: Banknote,
  },
  {
    value: 'card' as const,
    label: 'Carte',
    description: 'Régler automatiquement la totalité par carte',
    icon: CreditCard,
  },
  {
    value: 'split' as const,
    label: 'Espèces + carte',
    description: 'Répartir le total entre les deux moyens',
    icon: Split,
  },
];

const safeAmount = (raw: string) => {
  const parsed = Number(raw.replace(',', '.'));
  return roundTND(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
};

function MoneyInput({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoFocus={autoFocus}
          value={value || ''}
          onChange={event => onChange(safeAmount(event.target.value))}
          placeholder="0.000"
          className="h-13 pr-14 text-xl font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          TND
        </span>
      </div>
    </div>
  );
}

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

  const handleCashPart = (value: number) => {
    const cash = Math.min(total, value);
    onCashAmountChange(cash);
    onCardAmountChange(roundTND(Math.max(0, total - cash)));
    if (amountReceived < cash) onAmountReceivedChange(cash);
  };

  const handleCardPart = (value: number) => {
    const card = Math.min(total, value);
    const cash = roundTND(Math.max(0, total - card));
    onCardAmountChange(card);
    onCashAmountChange(cash);
    if (amountReceived < cash) onAmountReceivedChange(cash);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = event => {
    if (
      event.key !== 'Enter' ||
      step !== 'payment' ||
      !payment.valid ||
      submitting
    )
      return;
    if (event.target instanceof HTMLTextAreaElement || event.shiftKey) return;
    event.preventDefault();
    onConfirm();
  };

  const canContinue = Boolean(selectedClient || clientSkipped);

  return (
    <Dialog
      open={open}
      onOpenChange={next => !submitting && onOpenChange(next)}
    >
      <POSDialogContent size="payment" onKeyDown={handleKeyDown}>
        <POSDialogHeader
          title="Encaissement"
          description={`${itemCount} article${itemCount === 1 ? '' : 's'} · ${fmtTND(total)} TND`}
          aside={
            <POSStepIndicator
              current={step === 'customer' ? 1 : 2}
              steps={['Client', 'Paiement']}
            />
          }
        />

        <POSDialogBody>
          {step === 'customer' ? (
            <section
              className="space-y-5"
              aria-labelledby="checkout-customer-title"
            >
              <div>
                <h3
                  id="checkout-customer-title"
                  className="text-base font-semibold"
                >
                  Client
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sélectionnez une fiche, créez un client ou continuez sans
                  association.
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
            </section>
          ) : (
            <section
              className="space-y-6"
              aria-labelledby="checkout-payment-title"
            >
              <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Total à payer
                  </p>
                  <h3
                    id="checkout-payment-title"
                    className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl"
                  >
                    {fmtTND(total)}{' '}
                    <span className="text-lg font-semibold">TND</span>
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onStepChange('customer')}
                  className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <UserRound className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {selectedClient?.full_name || 'Client de passage'}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Modifier le client
                    </span>
                  </span>
                </button>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {PAYMENT_METHODS.map(method => {
                  const Icon = method.icon;
                  return (
                    <POSActionCard
                      key={method.value}
                      icon={<Icon className="size-5" />}
                      title={method.label}
                      description={method.description}
                      selected={paymentMethod === method.value}
                      onClick={() => handleMethodChange(method.value)}
                      className="lg:min-h-32 lg:flex-col lg:items-start"
                    />
                  );
                })}
              </div>

              <div className="rounded-md border p-5 sm:p-6">
                {paymentMethod === 'cash' ? (
                  <div className="space-y-5">
                    <MoneyInput
                      id="pos-amount-received"
                      label="Montant reçu"
                      value={amountReceived}
                      onChange={onAmountReceivedChange}
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 px-4"
                        onClick={() => onAmountReceivedChange(roundTND(total))}
                      >
                        Montant exact
                      </Button>
                      {[5, 10, 20, 50].map(extra => (
                        <Button
                          key={extra}
                          type="button"
                          variant="outline"
                          className="h-11 px-4"
                          onClick={() =>
                            onAmountReceivedChange(roundTND(total + extra))
                          }
                        >
                          +{extra}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {paymentMethod === 'card' ? (
                  <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-4 py-5">
                    <div>
                      <p className="text-sm font-semibold">Montant carte</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        La totalité est affectée automatiquement.
                      </p>
                    </div>
                    <p className="text-xl font-bold tabular-nums">
                      {fmtTND(total)} TND
                    </p>
                  </div>
                ) : null}

                {paymentMethod === 'split' ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MoneyInput
                        id="pos-cash-portion"
                        label="Part espèces"
                        value={cashAmount}
                        onChange={handleCashPart}
                        autoFocus
                      />
                      <MoneyInput
                        id="pos-card-portion"
                        label="Part carte"
                        value={cardAmount}
                        onChange={handleCardPart}
                      />
                    </div>
                    <MoneyInput
                      id="pos-split-received"
                      label="Espèces réellement reçues"
                      value={amountReceived}
                      onChange={onAmountReceivedChange}
                    />
                  </div>
                ) : null}

                <Separator className="my-5" />
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">Total affecté</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {fmtTND(payment.totalPaid)} TND
                  </dd>
                  <dt className="text-muted-foreground">Reste à affecter</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {fmtTND(payment.remaining)} TND
                  </dd>
                  {paymentMethod !== 'card' ? (
                    <>
                      <dt className="self-end text-base font-semibold">
                        Monnaie à rendre
                      </dt>
                      <dd className="text-right text-2xl font-bold tabular-nums text-emerald-700">
                        {fmtTND(payment.change)} TND
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>

              {payment.error ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
                >
                  {payment.error}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label
                  htmlFor="pos-checkout-note"
                  className="text-sm font-semibold"
                >
                  Note de vente{' '}
                  <span className="font-normal text-muted-foreground">
                    (optionnelle)
                  </span>
                </Label>
                <Textarea
                  id="pos-checkout-note"
                  rows={2}
                  value={customerNote}
                  onChange={event => onCustomerNoteChange(event.target.value)}
                  placeholder="Information utile sur cette vente…"
                  className="resize-none text-base"
                />
              </div>
            </section>
          )}
        </POSDialogBody>

        <POSDialogFooter>
          {step === 'customer' ? (
            <>
              <POSSecondaryButton onClick={() => onOpenChange(false)}>
                Annuler
              </POSSecondaryButton>
              <POSPrimaryButton
                disabled={!canContinue}
                onClick={() => onStepChange('payment')}
              >
                Continuer vers le paiement
              </POSPrimaryButton>
            </>
          ) : (
            <>
              <POSSecondaryButton
                onClick={() => onStepChange('customer')}
                disabled={submitting}
              >
                <ArrowLeft className="size-4" /> Retour
              </POSSecondaryButton>
              <POSPrimaryButton
                onClick={onConfirm}
                disabled={!payment.valid || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Traitement…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> Confirmer le paiement
                  </>
                )}
              </POSPrimaryButton>
            </>
          )}
        </POSDialogFooter>
      </POSDialogContent>
    </Dialog>
  );
}
