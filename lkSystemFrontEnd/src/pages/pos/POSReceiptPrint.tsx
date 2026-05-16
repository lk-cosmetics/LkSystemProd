/**
 * POSReceiptPrint
 *
 * 80 mm thermal receipt template tuned for HPRT TP80BE (printable area
 * ≈ 72 mm / 576 dots). Pure black-and-white, monospaced, no inline styles —
 * presentation lives entirely in `pos-print.css`. Print is driven by
 * `window.print()` together with the `.pos-receipt` rules.
 */

import { QRCodeSVG } from 'qrcode.react';
import { fmtTND } from './types';
import type { PrintableOrderData } from './types';

const DEFAULT_LOGO = '/logo.svg';
const CURRENCY = 'TND';

const slug = (s?: string | null): string =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const paymentLabel = (method: string): string => {
  switch (method) {
    case 'cash':          return 'Espèces';
    case 'card':          return 'Carte';
    case 'bank_transfer': return 'Virement';
    default:              return method;
  }
};

const fmtQty = (q: number): string =>
  Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, '');

const fmtReceiptMoney = (n: number): string => fmtTND(n).replace('.', ',');

export function POSReceiptPrint({ data }: { data: PrintableOrderData }) {
  const {
    order,
    channel,
    paymentMethod,
    amountReceived,
    changeAmount,
    cashierName,
    discountTotal,
    ticketNumber,
    logoSrc,
  } = data;

  const created = new Date(order.created_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(created.getDate())}/${pad(created.getMonth() + 1)}/${created.getFullYear()}`;
  const time = `${pad(created.getHours())}:${pad(created.getMinutes())}`;

  const ticket = ticketNumber ?? order.order_number;

  // Logo resolution:
  //   1. explicit `logoSrc` prop
  //   2. brand convention: /brands/{slug(brand_name)}.png  (drop a file in /public/brands/)
  //   3. fallback to the generic /logo.svg
  // On 404 / load failure the <img> hides itself; brand name still renders below.
  const brandSlug = slug(channel?.brand_name);
  const resolvedLogo =
    logoSrc !== ''
      ? logoSrc ?? (brandSlug ? `/brands/${brandSlug}.png` : DEFAULT_LOGO)
      : null;

  const storeName = channel?.name || 'POS';

  const discount = Number(discountTotal ?? 0);
  const showDiscount = discount > 0.0005;
  const showTax = Number(order.tax_total) > 0.0005;
  const subtotalBeforeDiscount = showDiscount
    ? Number(order.total) + discount
    : Number(order.subtotal);
  const totalHt =
    showTax ? Math.max(0, Number(order.total) - Number(order.tax_total)) : null;

  return (
    <div className="pos-receipt">
      <header className="r-header">
        {resolvedLogo && (
          <img
            className="r-logo"
            src={resolvedLogo}
            alt=""
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              if (img.src.endsWith(DEFAULT_LOGO)) {
                img.style.display = 'none';
              } else {
                img.src = DEFAULT_LOGO;
              }
            }}
          />
        )}
        <h1 className="r-title">{storeName}</h1>
        {channel?.brand_name && <p className="r-subtitle">{channel.brand_name}</p>}
        {channel?.address && <p className="r-store">{channel.address}</p>}
        {channel?.phone && <p className="r-store">Tél : {channel.phone}</p>}
      </header>

      <hr className="r-rule" />

      <section className="r-ticket-title">
        <strong>TICKET DE CAISSE</strong>
        <span>N° {ticket}</span>
      </section>

      <hr className="r-rule" />

      <section className="r-meta">
        <div><span>Date</span><span>{date} {time}</span></div>
        <div><span>Caisse</span><span>01</span></div>
        {cashierName && <div><span>Caissier</span><span>{cashierName}</span></div>}
      </section>

      <hr className="r-rule" />

      <section className="r-items">
        <div className="r-items-head">
          <div>Article</div>
          <div className="r-num">Montant</div>
        </div>
        {order.lines?.map((line, i) => (
          <div key={i} className="r-item">
            <div className="r-name">{line.product_name}</div>
            <div className="r-line-detail">
              <span>Qté : {fmtQty(Number(line.quantity))}</span>
              <span className="r-num">{fmtReceiptMoney(Number(line.total))}</span>
            </div>
          </div>
        ))}
      </section>

      <hr className="r-rule" />

      <section className="r-totals">
        <div className="r-row">
          <span>Sous-total</span>
          <span className="r-amount">{fmtReceiptMoney(subtotalBeforeDiscount)}</span>
        </div>
        {showDiscount && (
          <div className="r-row">
            <span>Remise</span>
            <span className="r-amount">-{fmtReceiptMoney(discount)}</span>
          </div>
        )}
        {totalHt !== null && (
          <div className="r-row">
            <span>Total HT</span>
            <span className="r-amount">{fmtReceiptMoney(totalHt)}</span>
          </div>
        )}
        {showTax && (
          <div className="r-row">
            <span>TVA</span>
            <span className="r-amount">{fmtReceiptMoney(Number(order.tax_total))}</span>
          </div>
        )}
        <div className="r-grand">
          <span>TOTAL TTC</span>
          <span className="r-amount">
            {fmtReceiptMoney(Number(order.total))}
            <span className="r-currency">{CURRENCY}</span>
          </span>
        </div>
      </section>

      <section className="r-pay">
        <div className="r-row">
          <span>Paiement</span>
          <span className="r-amount">{paymentLabel(paymentMethod)}</span>
        </div>
        {paymentMethod === 'cash' && amountReceived > 0 && (
          <>
            <div className="r-row">
              <span>Reçu</span>
              <span className="r-amount">{fmtReceiptMoney(amountReceived)}</span>
            </div>
            <div className="r-row r-pay-change">
              <span>Rendu</span>
              <span className="r-amount">{fmtReceiptMoney(changeAmount)}</span>
            </div>
          </>
        )}
      </section>

      <figure className="r-qr">
        <QRCodeSVG value={String(ticket)} size={112} level="M" includeMargin={false} />
        <figcaption>Scanner pour vérifier le ticket</figcaption>
      </figure>

      <footer className="r-thanks">
        <p>Merci pour votre visite</p>
        <p>À bientôt !</p>
        <hr className="r-rule" />
        <p className="r-policy">Échange sous 7 jours<br />avec ticket original</p>
      </footer>
    </div>
  );
}
