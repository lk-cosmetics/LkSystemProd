import { describe, it, expect } from 'vitest';
import { invoiceFromOrder, invoiceFromPOS } from './buildInvoiceData';
import type { Company, OrderDetail } from '@/types';
import type { PrintableOrderData } from '@/pages/pos/types';

const company = {
  id: 1,
  name: 'LK',
  legal_name: 'LK SARL',
  matricule_fiscale: '123A',
  logo: null,
} as unknown as Company;

function makeOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 42,
    order_number: 'ORD-42',
    invoice_number: '2026/042',
    invoice_date: '2026-06-11',
    invoice_client_name: 'Acme Invoice Client',
    invoice_client_type: 'COMPANY',
    invoice_client_matricule_fiscale: 'INV-999B',
    invoice_client_phone: '+21621111111',
    invoice_client_email: 'invoice@example.com',
    invoice_client_address: '42 Invoice Street',
    invoice_client_city: 'Ariana',
    ticket_id: '',
    created_at: '2026-06-10T10:00:00Z',
    currency: 'TND',
    client_name: 'Acme Co',
    client_type: 'COMPANY',
    client_matricule_fiscale: '999B',
    client_phone: '+21620000000',
    client_email: 'acme@example.com',
    billing_first_name: '',
    billing_last_name: '',
    billing_company: '',
    billing_phone: '',
    billing_address_1: '21 Rue X',
    billing_city: 'Tunis',
    discount_total: '5.00',
    delivery_fee: '7.00',
    tax_total: '0.00',
    total: '102.00',
    customer_note: 'Handle with care',
    lines: [
      { id: 1, product_name: 'Widget', barcode: 'BC1', quantity: 2, catalog_unit_price: '60.00', unit_price: '50.00', subtotal: '100.00', tax: '0.00', total: '100.00', is_deleted: false },
      { id: 2, product_name: 'Deleted', barcode: '', quantity: 1, unit_price: '9.00', subtotal: '9.00', tax: '0.00', total: '9.00', is_deleted: true },
    ],
    ...overrides,
  } as unknown as OrderDetail;
}

describe('invoiceFromOrder', () => {
  it('maps number, date, currency and the seller company', () => {
    const inv = invoiceFromOrder(makeOrder(), company);
    expect(inv.invoiceNumber).toBe('2026/042');
    expect(inv.dateISO).toBe('2026-06-11');
    expect(inv.currency).toBe('TND');
    expect(inv.company).toBe(company);
  });

  it('drops soft-deleted lines and maps the rest', () => {
    const inv = invoiceFromOrder(makeOrder(), company);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({
      name: 'Widget',
      barcode: 'BC1',
      quantity: 2,
      unitPriceTtc: 50,
      totalTtc: 100,
      promotionLabel: '17%',
    });
  });

  it('extracts the standard 19% VAT from TTC product prices', () => {
    const inv = invoiceFromOrder(makeOrder({ discount_total: '0.00' }), company);
    expect(inv.subtotal).toBeCloseTo(84.0336, 4);
    expect(inv.taxTotal).toBeCloseTo(15.9664, 4);
  });

  it('carries discount and delivery, then adds the 1 TND stamp duty', () => {
    const inv = invoiceFromOrder(makeOrder(), company);
    expect(inv.discountTotal).toBe(5);
    expect(inv.deliveryFee).toBe(7);
    expect(inv.stampDuty).toBe(1);
    expect(inv.total).toBe(103);
  });

  it('matches the supplied 22% promotion and Tunisian invoice calculation', () => {
    const inv = invoiceFromOrder(makeOrder({
      discount_total: '0.00',
      delivery_fee: '7.00',
      total: '183.00',
      lines: [{
        id: 1,
        product: null,
        product_id: null,
        wc_product_id: null,
        product_name: 'PACK SUMMER ESSENTIALS',
        product_image: '',
        barcode: '',
        quantity: 1,
        catalog_unit_price: '225.00',
        unit_price: '176.00',
        subtotal: '176.00',
        tax: '0.00',
        total: '176.00',
        is_deleted: false,
      }],
    }), company);

    expect(inv.lines[0].promotionLabel).toBe('22%');
    expect(inv.subtotal).toBeCloseTo(147.899, 3);
    expect(inv.taxTotal).toBeCloseTo(28.101, 3);
    expect(inv.stampDuty).toBe(1);
    expect(inv.total).toBe(184);
    expect(inv.amountInWords).toBe('Cent quatre-vingt-quatre dinars tunisiens.');
  });

  it('maps the bill-to client incl. the B2B Matricule Fiscale', () => {
    const inv = invoiceFromOrder(makeOrder(), company);
    expect(inv.client?.name).toBe('Acme Invoice Client');
    expect(inv.client?.clientType).toBe('COMPANY');
    expect(inv.client?.matriculeFiscale).toBe('INV-999B');
    expect(inv.client?.phone).toBe('+21621111111');
  });

  it('does not add stamp duty or expose a fiscal number for a person', () => {
    const inv = invoiceFromOrder(makeOrder({
      client_type: 'PERSON',
      invoice_client_type: 'PERSON',
    }), company);
    expect(inv.client?.clientType).toBe('PERSON');
    expect(inv.client?.matriculeFiscale).toBeUndefined();
    expect(inv.stampDuty).toBe(0);
    expect(inv.total).toBe(102);
  });

  it('keeps the invoice number empty when the order has not been invoiced', () => {
    const inv = invoiceFromOrder(makeOrder({
      invoice_number: '',
      order_number: '',
      ticket_id: '',
    }), company);
    expect(inv.invoiceNumber).toBe('');
  });

  it('tolerates a null company', () => {
    expect(invoiceFromOrder(makeOrder(), null).company).toBeNull();
  });
});

describe('invoiceFromPOS', () => {
  it('adds payment label + cashier and overrides discount from POS data', () => {
    const printData = {
      order: makeOrder(),
      channel: undefined,
      client: undefined,
      paymentMethod: 'cash',
      amountReceived: 110,
      changeAmount: 8,
      cashierName: 'Sami',
      discountTotal: 12,
    } as unknown as PrintableOrderData;

    const inv = invoiceFromPOS(printData, company);
    expect(inv.payment?.methodLabel).toBe('Espèces');
    expect(inv.payment?.amountReceived).toBe(110);
    expect(inv.payment?.changeAmount).toBe(8);
    expect(inv.cashierName).toBe('Sami');
    expect(inv.discountTotal).toBe(12);
    expect(inv.stampDuty).toBe(0);
    expect(inv.total).toBe(102);
  });

  it('adds stamp duty and the selected company fiscal number in POS', () => {
    const printData = {
      order: makeOrder(),
      channel: undefined,
      client: {
        client_type: 'COMPANY',
        matricule_fiscale: 'POS-MF-77',
        full_name: 'Client Société',
        first_name: 'Client',
        last_name: 'Société',
        phone: '+21671111222',
        email: 'company@example.com',
        address: '1 Rue POS',
        city: 'Tunis',
      },
      paymentMethod: 'cash',
      amountReceived: 110,
      changeAmount: 7,
    } as unknown as PrintableOrderData;

    const inv = invoiceFromPOS(printData, company);
    expect(inv.client?.clientType).toBe('COMPANY');
    expect(inv.client?.matriculeFiscale).toBe('POS-MF-77');
    expect(inv.stampDuty).toBe(1);
    expect(inv.total).toBe(103);
  });

  it('removes stamp duty and fiscal number when the selected POS client is a person', () => {
    const printData = {
      order: makeOrder(),
      channel: undefined,
      client: {
        client_type: 'PERSON',
        matricule_fiscale: 'SHOULD-NOT-PRINT',
        full_name: 'Client Particulier',
        first_name: 'Client',
        last_name: 'Particulier',
      },
      paymentMethod: 'cash',
      amountReceived: 102,
      changeAmount: 0,
    } as unknown as PrintableOrderData;

    const inv = invoiceFromPOS(printData, company);
    expect(inv.client?.clientType).toBe('PERSON');
    expect(inv.client?.matriculeFiscale).toBeUndefined();
    expect(inv.stampDuty).toBe(0);
    expect(inv.total).toBe(102);
  });
});
