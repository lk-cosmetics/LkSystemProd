import { getMediaUrl } from '@/utils/helpers';
import type { InvoiceData } from './types';
import './invoice.css';

const FALLBACK_LOGO = '/logo.svg';

const money = (raw: number | string | undefined): string => {
  const value = typeof raw === 'string' ? Number(raw) : (raw ?? 0);
  if (!Number.isFinite(value)) return '0,000';
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
};

const qty = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');

interface Props {
  data: InvoiceData;
  preview?: boolean;
}

export function InvoiceDocument({ data, preview = false }: Props) {
  const {
    company,
    invoiceNumber,
    orderNumber,
    dateISO,
    client,
    lines,
    subtotal,
    discountTotal = 0,
    deliveryFee = 0,
    taxTotal = 0,
    taxRate,
    stampDuty,
    total,
    currency = 'TND',
    payment,
    cashierName,
    note,
    amountInWords,
  } = data;

  const logo = getMediaUrl(company?.logo ?? null) || FALLBACK_LOGO;
  const sellerName = company?.legal_name || company?.name || 'Société';
  const date = new Date(dateISO);
  const dateLabel = Number.isNaN(date.getTime())
    ? dateISO
    : date.toLocaleDateString('fr-TN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
  const clientName = client?.name?.trim();
  const hasPromotionColumn = lines.some(line => Boolean(line.promotionLabel));
  const showDiscount = discountTotal > 0.0005;
  const showDelivery = deliveryFee > 0.0005;
  const showTax = taxTotal > 0.0005;
  const showStampDuty = stampDuty > 0.0005;

  return (
    <article className={`lk-invoice${preview ? ' lk-invoice--preview' : ''}`}>
      <header className="lk-invoice__brand">
        <img
          className="lk-invoice__logo"
          src={logo}
          alt={sellerName}
          onError={(event) => {
            if (event.currentTarget.src !== window.location.origin + FALLBACK_LOGO) {
              event.currentTarget.src = FALLBACK_LOGO;
            }
          }}
        />
      </header>

      <h1 className="lk-invoice__title">Facture</h1>

      <section className="lk-invoice__identity">
        <div className="lk-invoice__client">
          {clientName && <strong>{clientName}</strong>}
          {client?.address && <span>{client.address}</span>}
          {client?.city && <span>{client.city}</span>}
          {client?.phone && <span>{client.phone}</span>}
          {client?.email && <span>{client.email}</span>}
          {client?.clientType === 'COMPANY' && client.matriculeFiscale && (
            <span>M/F : {client.matriculeFiscale}</span>
          )}
          {!clientName && !client?.address && !client?.phone && <span>Client comptoir</span>}
        </div>

        <dl className="lk-invoice__meta">
          <div><dt>N° de facture</dt><dd>{invoiceNumber}</dd></div>
          {orderNumber && <div><dt>N° de commande</dt><dd>{orderNumber}</dd></div>}
          <div><dt>Date de facture</dt><dd>{dateLabel}</dd></div>
          {payment?.methodLabel && <div><dt>Méthode de paiement</dt><dd>{payment.methodLabel}</dd></div>}
          {cashierName && <div><dt>Émis par</dt><dd>{cashierName}</dd></div>}
        </dl>
      </section>

      <table className="lk-invoice__table">
        <thead>
          <tr>
            <th>Produit</th>
            <th className="lk-invoice__c-qty">Quantité</th>
            {hasPromotionColumn && <th className="lk-invoice__c-promo">Promotion</th>}
            <th className="lk-invoice__num lk-invoice__c-pu">Prix HT</th>
            <th className="lk-invoice__num lk-invoice__c-tot">Prix TTC</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.barcode || line.name}-${index}`}>
              <td>
                <div className="lk-invoice__name">{line.name}</div>
                {line.barcode && <div className="lk-invoice__bc">{line.barcode}</div>}
              </td>
              <td className="lk-invoice__c-qty">{qty(line.quantity)}</td>
              {hasPromotionColumn && (
                <td className="lk-invoice__c-promo">{line.promotionLabel || '—'}</td>
              )}
              <td className="lk-invoice__num lk-invoice__c-pu">{money(line.totalHt)}</td>
              <td className="lk-invoice__num lk-invoice__c-tot">{money(line.totalTtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="lk-invoice__summary">
        <div className="lk-invoice__words">
          <strong>Arrêtée la présente facture à la somme de :</strong>
          <span>{amountInWords}</span>
          {note && <p>{note}</p>}
        </div>

        <div className="lk-invoice__totals">
          <div><strong>Total HT</strong><span>{money(subtotal)} {currency}</span></div>
          {showDiscount && (
            <div className="lk-invoice__discount">
              <strong>Remise commande</strong><span>- {money(discountTotal)} {currency}</span>
            </div>
          )}
          {showTax && <div><strong>TVA ({taxRate} %)</strong><span>{money(taxTotal)} {currency}</span></div>}
          {showDelivery && <div><strong>Livraison</strong><span>{money(deliveryFee)} {currency}</span></div>}
          {showStampDuty && <div><strong>Droit de timbre</strong><span>{money(stampDuty)} {currency}</span></div>}
          <div className="lk-invoice__grand">
            <strong>Total TTC</strong><span>{money(total)} {currency}</span>
          </div>
        </div>
      </section>

      <div className="lk-invoice__direction">La direction</div>

      <footer className="lk-invoice__footer">
        <strong>{sellerName}</strong>
        {company?.address && (
          <span>{company.address}{company.city ? `, ${company.city}` : ''}</span>
        )}
        {company?.phone && <span>{company.phone}</span>}
        {company?.email && <span>{company.email}</span>}
        {company?.matricule_fiscale && (
          <span><strong>Matricule fiscal :</strong> {company.matricule_fiscale}</span>
        )}
        {company?.registre_commerce && <span>RC : {company.registre_commerce}</span>}
        {company?.rib && (
          <span>RIB : {company.rib}{company.bank_name ? ` — ${company.bank_name}` : ''}</span>
        )}
        {company?.invoice_footer?.trim() && <span>{company.invoice_footer.trim()}</span>}
      </footer>
    </article>
  );
}

export default InvoiceDocument;
