import { fmtTND } from './types';
import type React from 'react';
import type { PrintableOrderData } from './types';

interface POSInvoicePrintProps {
  data: PrintableOrderData;
}

const paymentLabel = (method: string): string => {
  switch (method) {
    case 'cash':
      return 'Espèces';
    case 'card':
      return 'Carte bancaire';
    case 'bank_transfer':
      return 'Virement';
    default:
      return method;
  }
};

const fmtQty = (q: number): string =>
  Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, '');

export function POSInvoicePrint({ data }: POSInvoicePrintProps) {
  const {
    order,
    channel,
    client,
    paymentMethod,
    amountReceived,
    changeAmount,
    discountTotal,
    ticketNumber,
    logoSrc,
  } = data;

  const date = new Date(order.created_at);
  const invoiceNumber = ticketNumber ?? order.ticket_id ?? order.order_number;
  const logo = logoSrc ?? channel?.brand_logo ?? undefined;
  const discount = Number(discountTotal ?? order.discount_total ?? 0);
  const showDiscount = discount > 0.0005;
  const subtotalBeforeDiscount = Number(order.total || 0) + discount;

  const fmtDate = date.toLocaleDateString('fr-TN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const fmtTime = date.toLocaleTimeString('fr-TN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="pos-invoice"
      style={{ page: 'invoice' } as React.CSSProperties}
    >
      <header className="invoice-header">
        <div className="invoice-brand">
          {logo && (
            <img
              className="invoice-logo"
              src={logo}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div>
            <h1>{channel?.name || 'Point de vente'}</h1>
            {channel?.address && (
              <p>
                {channel.address}
                {channel.city ? `, ${channel.city}` : ''}
              </p>
            )}
            {channel?.phone && <p>Tél: {channel.phone}</p>}
            {channel?.email && <p>{channel.email}</p>}
          </div>
        </div>
        <div className="invoice-title">
          <span>Facture</span>
          <strong>#{invoiceNumber}</strong>
          <small>
            {fmtDate} à {fmtTime}
          </small>
        </div>
      </header>

      <section className="invoice-info-grid">
        <div>
          <h2>Client</h2>
          {client ? (
            <>
              <p className="strong">
                {[client.first_name, client.last_name].filter(Boolean).join(' ') ||
                  'Client'}
              </p>
              {client.phone && <p>Tél: {client.phone}</p>}
              {client.email && <p>{client.email}</p>}
              {client.address && <p>{client.address}</p>}
              {client.city && <p>{client.city}</p>}
            </>
          ) : (
            <p className="muted">Client comptoir</p>
          )}
        </div>
        <div>
          <h2>Paiement</h2>
          <p>
            <span>Méthode</span>
            <strong>{paymentLabel(paymentMethod)}</strong>
          </p>
          {paymentMethod === 'cash' && amountReceived > 0 && (
            <>
              <p>
                <span>Reçu</span>
                <strong>{fmtTND(amountReceived)} TND</strong>
              </p>
              <p>
                <span>Rendu</span>
                <strong>{fmtTND(changeAmount)} TND</strong>
              </p>
            </>
          )}
        </div>
      </section>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>Article</th>
            <th>Code-barres</th>
            <th>Qté</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines?.map((line, index) => (
            <tr key={`${line.id ?? index}-${line.product_name}`}>
              <td>{line.product_name}</td>
              <td>{line.barcode || '-'}</td>
              <td>{fmtQty(Number(line.quantity))}</td>
              <td>{fmtTND(Number(line.total))} TND</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="invoice-summary">
        <div>
          <span>Sous-total</span>
          <strong>{fmtTND(subtotalBeforeDiscount)} TND</strong>
        </div>
        {showDiscount && (
          <div>
            <span>Remise</span>
            <strong>-{fmtTND(discount)} TND</strong>
          </div>
        )}
        {Number(order.tax_total) > 0.0005 && (
          <div>
            <span>TVA</span>
            <strong>{fmtTND(Number(order.tax_total))} TND</strong>
          </div>
        )}
        <div className="invoice-total">
          <span>Total</span>
          <strong>{fmtTND(Number(order.total))} TND</strong>
        </div>
      </section>

      <footer className="invoice-footer">
        <p>Merci pour votre confiance.</p>
        <p>Document généré depuis le point de vente.</p>
      </footer>
    </div>
  );
}
