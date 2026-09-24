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
  type POSPaymentBreakdown,
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
          className="h-11 pr-14 text-lg font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          TND
        </span>
      </div>
    </div>
  );
}

function PaymentSummary({ payment }: { payment: POSPaymentBreakdown }) {
  const showCash = payment.method !== 'card';
  const showCard = payment.method !== 'cash';

  return (
    <aside
      className="rounded-md border bg-muted/20 p-4"
      aria-label="Récapitulatif du paiement"
    >
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        Récapitulatif
      </p>
      <dl className="mt-3 space-y-2.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-semibold tabular-nums">
            {fmtTND(payment.cashAmount + payment.cardAmount)} TND
          </dd>
        </div>
        {showCash ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Part espèces</dt>
            <dd className="font-semibold tabular-nums">
              {fmtTND(payment.cashAmount)} TND
            </dd>
          </div>
        ) : null}
        {showCard ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Part carte</dt>
            <dd className="font-semibold tabular-nums">
              {fmtTND(payment.cardAmount)} TND
            </dd>
          </div>
        ) : null}
        {showCash ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Espèces reçues</dt>
            <dd className="font-semibold tabular-nums">
              {fmtTND(payment.amountReceived)} TND
            </dd>
          </div>
        ) : null}
      </dl>

      {showCash ? (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-4">
          <div>
            <p className="text-xs text-muted-foreground">Reste à encaisser</p>
            <p
              className={`mt-1 text-lg font-bold tabular-nums ${payment.remaining > 0 ? 'text-destructive' : ''}`}
            >
              {fmtTND(payment.remaining)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Monnaie à rendre</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-emerald-700">
              {fmtTND(payment.change)}
            </p>
          </div>
        </div>
      ) : null}
    </aside>
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
              className="space-y-4"
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
              className="space-y-4"
              aria-labelledby="checkout-payment-title"
            >
              <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Total à payer
                  </p>
                  <h3
                    id="checkout-payment-title"
                    className="mt-1 text-3xl font-bold tabular-nums"
                  >
                    {fmtTND(total)}{' '}
                    <span className="text-lg font-semibold">TND</span>
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onStepChange('customer')}
                  className="flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

              <div className="grid gap-2 sm:grid-cols-3">
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
                      className="min-h-[5.25rem]"
                    />
                  );
                })}
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_19rem]">
                <div className="rounded-md border p-4">
                  {paymentMethod === 'cash' ? (
                    <div className="space-y-4">
                      <MoneyInput
                        id="pos-amount-received"
                        label="Espèces remises par le client"
                        value={amountReceived}
                        onChange={onAmountReceivedChange}
                        autoFocus
                      />
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label="Montants rapides"
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-3"
                          onClick={() =>
                            onAmountReceivedChange(roundTND(total))
                          }
                        >
                          Montant exact
                        </Button>
                        {[5, 10, 20, 50].map(extra => (
                          <Button
                            key={extra}
                            type="button"
                            variant="outline"
                            className="h-9 px-3"
                            onClick={() =>
                              onAmountReceivedChange(roundTND(total + extra))
                            }
                          >
                            +{extra} TND
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {paymentMethod === 'card' ? (
                    <div className="flex min-h-28 items-center justify-between gap-4 rounded-md bg-muted/40 px-4 py-4">
                      <div>
                        <p className="text-sm font-semibold">
                          Paiement par carte
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          La totalité est affectée automatiquement à la carte.
                        </p>
                      </div>
                      <p className="shrink-0 text-xl font-bold tabular-nums">
                        {fmtTND(total)} TND
                      </p>
                    </div>
                  ) : null}

                  {paymentMethod === 'split' ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <MoneyInput
                          id="pos-cash-portion"
                          label="Montant à régler en espèces"
                          value={cashAmount}
                          onChange={handleCashPart}
                          autoFocus
                        />
                        <div className="space-y-2">
                          <Label className="text-sm font-semibold">
                            Reste calculé sur carte
                          </Label>
                          <output className="flex h-11 items-center justify-between rounded-md border bg-muted/40 px-3 text-lg font-semibold tabular-nums">
                            {fmtTND(cardAmount)}{' '}
                            <span className="text-sm text-muted-foreground">
                              TND
                            </span>
                          </output>
                        </div>
                      </div>
                      <MoneyInput
                        id="pos-split-received"
                        label="Espèces réellement remises"
                        value={amountReceived}
                        onChange={onAmountReceivedChange}
                      />
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label="Espèces reçues rapidement"
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 px-3"
                          onClick={() =>
                            onAmountReceivedChange(roundTND(cashAmount))
                          }
                        >
                          Espèces exactes
                        </Button>
                        {[5, 10, 20].map(extra => (
                          <Button
                            key={extra}
                            type="button"
                            variant="outline"
                            className="h-9 px-3"
                            onClick={() =>
                              onAmountReceivedChange(
                                roundTND(cashAmount + extra)
                              )
                            }
                          >
                            +{extra} TND
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        La part carte se recalcule automatiquement. Tout surplus
                        en espèces apparaît comme monnaie à rendre.
                      </p>
                    </div>
                  ) : null}
                </div>

                <PaymentSummary payment={payment} />
              </div>

              {payment.error ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
                >
                  {payment.error}
                </div>
              ) : null}

              <div className="space-y-1.5">
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
                  rows={1}
                  value={customerNote}
                  onChange={event => onCustomerNoteChange(event.target.value)}
                  placeholder="Information utile sur cette vente…"
                  className="min-h-10 resize-none text-sm"
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
