import type { Company } from '@/types';

/** One billed line on the invoice. */
export interface InvoiceLine {
  name: string;
  barcode?: string;
  quantity: number;
  catalogUnitPrice?: number;
  unitPriceTtc: number;
  totalHt: number;
  totalTtc: number;
  promotionLabel?: string;
}

/** A party on the invoice (the bill-to client). */
export interface InvoiceParty {
  name?: string;
  clientType?: 'PERSON' | 'COMPANY';
  matriculeFiscale?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
}

/** Optional payment block (shown for POS / paid invoices). */
export interface InvoicePayment {
  methodLabel?: string;
  amountReceived?: number;
  changeAmount?: number;
}

/**
 * Everything the shared {@link InvoiceDocument} needs. Built from an order +
 * the current company (order pages) or from POS checkout data — see
 * buildInvoiceData.ts. The seller block always comes from the company table.
 */
export interface InvoiceData {
  /** Seller — drives the header (name, matricule, RC, RIB, logo, footer…). */
  company: Company | null;
  invoiceNumber: string;
  orderNumber?: string;
  dateISO: string;
  client?: InvoiceParty;
  lines: InvoiceLine[];
  /** Tax-exclusive total after order-level discount. */
  subtotal: number;
  discountTotal?: number;
  deliveryFee?: number;
  taxTotal?: number;
  taxRate: number;
  stampDuty: number;
  total: number;
  currency?: string;
  payment?: InvoicePayment;
  cashierName?: string;
  amountInWords: string;
  /** Free-text order note shown above the footer. */
  note?: string;
}
