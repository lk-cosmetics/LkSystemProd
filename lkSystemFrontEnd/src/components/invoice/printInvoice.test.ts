import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateInvoicePrintScale,
  getInvoicePrintDensity,
  printInvoice,
} from './printInvoice';

describe('printInvoice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div data-slot="dialog-content" style="position: fixed; overflow: auto">
        <div class="lk-invoice lk-invoice--preview">
          <h1>Facture</h1>
        </div>
      </div>
    `;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 1020,
      height: 1020,
      left: 0,
      right: 718,
      top: 0,
      width: 718,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('prints a standalone clone without the popup preview styles', () => {
    printInvoice();

    const host = document.body.querySelector('.lk-invoice-print-host');
    const clone = host?.querySelector('.lk-invoice');

    expect(document.body.classList.contains('lk-print-invoice')).toBe(true);
    expect(host?.parentElement).toBe(document.body);
    expect(clone).not.toBeNull();
    expect(clone?.classList.contains('lk-invoice--preview')).toBe(false);
    expect(clone?.classList.contains('lk-invoice--print-sheet')).toBe(true);
    expect(host?.getAttribute('data-print-density')).toBe('normal');
    expect(host?.getAttribute('data-print-scale')).toBe('1');
    expect(window.print).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('afterprint'));

    expect(document.body.classList.contains('lk-print-invoice')).toBe(false);
    expect(document.body.querySelector('.lk-invoice-print-host')).toBeNull();
  });

  it('uses ultra density and scales a long invoice to the printable A4 height', () => {
    document.body.innerHTML = `
      <div class="lk-invoice">
        <table class="lk-invoice__table">
          <tbody>
            ${Array.from({ length: 30 }, (_, index) => `<tr><td>Produit ${index}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('lk-invoice') ? 2086 : 0;
    });

    printInvoice();

    const host = document.body.querySelector<HTMLElement>('.lk-invoice-print-host');
    const clone = host?.querySelector('.lk-invoice');
    const scale = Number(host?.dataset.printScale);

    expect(host?.dataset.printDensity).toBe('ultra');
    expect(clone?.classList.contains('lk-invoice--print-ultra')).toBe(true);
    expect(scale).toBeGreaterThan(0.49);
    expect(scale).toBeLessThanOrEqual(0.5);
    expect(window.print).toHaveBeenCalledOnce();
  });
});

describe('invoice print sizing', () => {
  it('selects progressive density levels from the number of products', () => {
    expect(getInvoicePrintDensity(7)).toBe('normal');
    expect(getInvoicePrintDensity(8)).toBe('compact');
    expect(getInvoicePrintDensity(16)).toBe('dense');
    expect(getInvoicePrintDensity(28)).toBe('ultra');
  });

  it('keeps short invoices at full size and scales overflowing invoices down', () => {
    expect(calculateInvoicePrintScale(900, 1000)).toBe(1);
    expect(calculateInvoicePrintScale(2000, 1000)).toBe(0.5);
    expect(calculateInvoicePrintScale(300, 276)).toBe(0.92);
  });
});
