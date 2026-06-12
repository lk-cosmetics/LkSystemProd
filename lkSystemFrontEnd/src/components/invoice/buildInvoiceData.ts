import type { Company, OrderDetail } from '@/types';
import type { PrintableOrderData } from '@/pages/pos/types';
import type { InvoiceData, InvoiceLine, InvoiceParty } from './types';
import { amountInFrenchTnd } from './amountInWords';

export const DEFAULT_INVOICE_TAX_RATE = 19;
export const DEFAULT_INVOICE_STAMP_DUTY = 1;

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  bank_transfer: 'Virement',
  bacs: 'Virement bancaire',
  cod: 'Paiement à la livraison',
  cash_on_delivery: 'Paiement à la livraison',
};
const paymentLabel = (m?: string): string | undefined =>
  m ? (PAYMENT_LABELS[m] ?? m) : undefined;

function promotionLabel(catalogUnitPrice: number, chargedUnitPrice: number): string | undefined {
  if (catalogUnitPrice <= 0 || chargedUnitPrice <= 0 || chargedUnitPrice >= catalogUnitPrice) {
    return undefined;
  }
  const percentage = ((catalogUnitPrice - chargedUnitPrice) / catalogUnitPrice) * 100;
  return `${Math.round(percentage)}%`;
}

function linesFromOrder(order: OrderDetail, taxRate: number): InvoiceLine[] {
  return (order.lines ?? [])
    .filter(l => !l.is_deleted)
    .map(l => {
      const quantity = Number(l.quantity) || 0;
      const unitPriceTtc = num(l.unit_price);
      const catalogUnitPrice = num(l.catalog_unit_price);
      const storedSubtotal = num(l.subtotal);
      const storedTax = num(l.tax);
      const totalTtc = storedTax > 0
        ? storedSubtotal + storedTax
        : (storedSubtotal || unitPriceTtc * quantity);
      return {
        name: l.product_name,
        barcode: l.barcode || undefined,
        quantity,
        catalogUnitPrice: catalogUnitPrice || undefined,
        unitPriceTtc,
        totalHt: totalTtc / (1 + taxRate / 100),
        totalTtc,
        promotionLabel: promotionLabel(catalogUnitPrice, unitPriceTtc),
      };
    });
}

function clientFromOrder(order: OrderDetail): InvoiceParty {
  const clientType = order.invoice_number
    ? order.invoice_client_type
    : (order.client_type ?? 'PERSON');
  const name =
    (order.invoice_number ? order.invoice_client_name?.trim() : '') ||
    order.client_name?.trim() ||
    [order.billing_first_name, order.billing_last_name].filter(Boolean).join(' ').trim() ||
    order.billing_company?.trim() ||
    undefined;
  return {
    name,
    clientType,
    matriculeFiscale: clientType === 'COMPANY'
      ? (
          (order.invoice_number ? order.invoice_client_matricule_fiscale : '')
          || order.client_matricule_fiscale
          || undefined
        )
      : undefined,
    phone: (
      (order.invoice_number ? order.invoice_client_phone : '')
      || order.client_phone
      || order.billing_phone
      || undefined
    ),
    email: (
      (order.invoice_number ? order.invoice_client_email : '')
      || order.client_email
      || undefined
    ),
    address: (
      (order.invoice_number ? order.invoice_client_address : '')
      || order.billing_address_1?.trim()
      || undefined
    ),
    city: (
      (order.invoice_number ? order.invoice_client_city : '')
      || order.billing_city
      || undefined
    ),
  };
}

/** Build invoice data for an order-management order + the seller company. */
export function invoiceFromOrder(order: OrderDetail, company: Company | null): InvoiceData {
  const taxRate = DEFAULT_INVOICE_TAX_RATE;
  const client = clientFromOrder(order);
  const lines = linesFromOrder(order, taxRate);
  const productTtc = lines.reduce((sum, line) => sum + line.totalTtc, 0);
  const discountTotal = num(order.discount_total);
  const taxableTtc = Math.max(0, productTtc - discountTotal);
  const storedTaxTotal = num(order.tax_total);
  const taxTotal = storedTaxTotal > 0
    ? storedTaxTotal
    : taxableTtc * taxRate / (100 + taxRate);
  const subtotal = Math.max(0, taxableTtc - taxTotal);
  const deliveryFee = num(order.delivery_fee) || num(order.shipping_total);
  const orderTotalBeforeStamp = num(order.total) || taxableTtc + deliveryFee;
  const stampDuty = orderTotalBeforeStamp > 0 && client.clientType === 'COMPANY'
    ? DEFAULT_INVOICE_STAMP_DUTY
    : 0;
  const total = orderTotalBeforeStamp > 0 ? orderTotalBeforeStamp + stampDuty : 0;
  // Ingestion stores the human-readable title (e.g. "Cash on delivery")
  // directly on payment_method — there is no separate title field.
  const paymentMethod = order.payment_method;
  return {
    company,
    invoiceNumber: order.invoice_number,
    orderNumber: order.external_order_id || undefined,
    dateISO: order.invoice_date || order.created_at,
    client,
    lines,
    subtotal,
    discountTotal,
    deliveryFee,
    taxTotal,
    taxRate,
    stampDuty,
    total,
    currency: order.currency || 'TND',
    payment: paymentMethod ? { methodLabel: paymentLabel(paymentMethod) } : undefined,
    amountInWords: amountInFrenchTnd(total),
    note: order.customer_note?.trim() || undefined,
  };
}

/** Build invoice data for a POS checkout (adds payment + cashier details). */
export function invoiceFromPOS(data: PrintableOrderData, company: Company | null): InvoiceData {
  const base = invoiceFromOrder(data.order, company);
  const posClient = data.client;
  const clientType = posClient?.client_type ?? 'PERSON';
  const client: InvoiceParty = posClient
    ? {
        name: posClient.full_name?.trim()
          || [posClient.first_name, posClient.last_name].filter(Boolean).join(' ').trim()
          || undefined,
        clientType,
        matriculeFiscale: clientType === 'COMPANY'
          ? posClient.matricule_fiscale?.trim() || undefined
          : undefined,
        phone: posClient.phone || undefined,
        email: posClient.email || undefined,
        address: posClient.address?.trim() || undefined,
        city: posClient.city || undefined,
      }
    : { clientType: 'PERSON' };
  const totalBeforeStamp = Math.max(0, base.total - base.stampDuty);
  const stampDuty = totalBeforeStamp > 0 && clientType === 'COMPANY'
    ? DEFAULT_INVOICE_STAMP_DUTY
    : 0;
  const total = totalBeforeStamp + stampDuty;
  return {
    ...base,
    invoiceNumber: data.order.invoice_number
      || data.order.order_number
      || data.order.ticket_id
      || String(data.order.id),
    client,
    discountTotal: data.discountTotal != null ? Number(data.discountTotal) : base.discountTotal,
    stampDuty,
    total,
    amountInWords: amountInFrenchTnd(total),
    cashierName: data.cashierName,
    payment: {
      methodLabel: paymentLabel(data.paymentMethod),
      amountReceived: data.amountReceived,
      changeAmount: data.changeAmount,
    },
  };
}
