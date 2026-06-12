/**
 * Print the currently-mounted <InvoiceDocument>.
 *
 * Adds the body class that switches on the invoice print isolation in
 * invoice.css (scoped so it never collides with the POS receipt print), prints
 * on the next frame, then removes the class on `afterprint` (with a timeout
 * fallback for browsers that don't fire it).
 */
const PRINT_CLASS = 'lk-print-invoice';
const PRINT_HOST_CLASS = 'lk-invoice-print-host';
const PRINT_WIDTH_MM = 190;
const PRINT_HEIGHT_MM = 276;

export type InvoicePrintDensity = 'normal' | 'compact' | 'dense' | 'ultra';

export function getInvoicePrintDensity(lineCount: number): InvoicePrintDensity {
  if (lineCount >= 28) return 'ultra';
  if (lineCount >= 16) return 'dense';
  if (lineCount >= 8) return 'compact';
  return 'normal';
}

export function calculateInvoicePrintScale(
  contentHeight: number,
  availableHeight: number,
): number {
  if (
    !Number.isFinite(contentHeight)
    || !Number.isFinite(availableHeight)
    || contentHeight <= 0
    || availableHeight <= 0
    || contentHeight <= availableHeight
  ) {
    return 1;
  }

  // Round down so browser sub-pixel rounding cannot push the final row onto a
  // second sheet. There is intentionally no readability floor: one A4 page is
  // the hard requirement, while density classes keep normal cases legible.
  return Math.max(0.01, Math.floor((availableHeight / contentHeight) * 1000) / 1000);
}

export function printInvoice(): void {
  const invoice = document.querySelector<HTMLElement>('.lk-invoice');
  if (!invoice) return;

  document.querySelector(`.${PRINT_HOST_CLASS}`)?.remove();

  // The order invoice is normally mounted inside a fixed, transformed,
  // scrollable dialog. Printing that node in place makes browser pagination
  // inherit the dialog constraints. A temporary body-level clone gives the
  // print engine a clean A4 document instead.
  const printHost = document.createElement('div');
  printHost.className = PRINT_HOST_CLASS;
  printHost.setAttribute('aria-hidden', 'true');

  const printableInvoice = invoice.cloneNode(true) as HTMLElement;
  printableInvoice.classList.remove('lk-invoice--preview');
  printableInvoice.classList.add('lk-invoice--print-sheet');
  const lineCount = printableInvoice.querySelectorAll('.lk-invoice__table tbody tr').length;
  const density = getInvoicePrintDensity(lineCount);
  if (density !== 'normal') {
    printableInvoice.classList.add(`lk-invoice--print-${density}`);
  }
  printHost.appendChild(printableInvoice);
  document.body.appendChild(printHost);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.body.classList.remove(PRINT_CLASS);
    printHost.remove();
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60_000);

  // Measure the real cloned document at its final 190 mm width. The scale is
  // then applied to a fixed 276 mm print sheet, keeping every invoice on one
  // A4 page even when product names wrap or optional billing blocks are shown.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const bounds = printableInvoice.getBoundingClientRect();
      const pixelsPerMillimeter = bounds.width > 0
        ? bounds.width / PRINT_WIDTH_MM
        : 96 / 25.4;
      const availableHeight = PRINT_HEIGHT_MM * pixelsPerMillimeter;
      const contentHeight = Math.max(printableInvoice.scrollHeight, bounds.height);
      const scale = calculateInvoicePrintScale(contentHeight, availableHeight);

      printHost.style.setProperty('--lk-invoice-print-scale', String(scale));
      printHost.dataset.printScale = String(scale);
      printHost.dataset.printDensity = density;
      document.body.classList.add(PRINT_CLASS);

      requestAnimationFrame(() => window.print());
    });
  });
}
