export type POSPaymentMethod = 'cash' | 'card' | 'split';

const MILLIMES = 1000;

export const toMillimes = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * MILLIMES) : 0;

export const fromMillimes = (value: number): number => value / MILLIMES;

export const roundTND = (value: number): number => fromMillimes(toMillimes(value));

export interface POSPaymentBreakdown {
  method: POSPaymentMethod;
  cashAmount: number;
  cardAmount: number;
  amountReceived: number;
  totalPaid: number;
  remaining: number;
  change: number;
  valid: boolean;
  error: string | null;
}

export function calculatePOSPayment(params: {
  method: POSPaymentMethod;
  total: number;
  cashAmount: number;
  cardAmount: number;
  amountReceived: number;
}): POSPaymentBreakdown {
  const total = Math.max(0, toMillimes(params.total));
  let cash = Math.max(0, toMillimes(params.cashAmount));
  let card = Math.max(0, toMillimes(params.cardAmount));
  let received = Math.max(0, toMillimes(params.amountReceived));

  if (params.method === 'cash') {
    cash = total;
    card = 0;
  } else if (params.method === 'card') {
    cash = 0;
    card = total;
    received = 0;
  }

  const paid = cash + card;
  const remaining = Math.max(0, total - paid);
  const change = params.method === 'card' ? 0 : Math.max(0, received - cash);

  let error: string | null = null;
  if (total <= 0) {
    error = 'Le total doit être supérieur à zéro.';
  } else if (params.method === 'cash' && received < total) {
    error = 'Le montant reçu est inférieur au total.';
  } else if (params.method === 'split' && (cash <= 0 || card <= 0)) {
    error = 'Saisissez une part en espèces et une part par carte.';
  } else if (params.method === 'split' && paid !== total) {
    error = paid < total
      ? 'Le paiement ne couvre pas encore le total.'
      : 'La répartition dépasse le total.';
  } else if (params.method === 'split' && received < cash) {
    error = 'Le montant espèces reçu est inférieur à la part espèces.';
  }

  return {
    method: params.method,
    cashAmount: fromMillimes(cash),
    cardAmount: fromMillimes(card),
    amountReceived: fromMillimes(received),
    totalPaid: fromMillimes(paid),
    remaining: fromMillimes(remaining),
    change: fromMillimes(change),
    valid: error === null,
    error,
  };
}
