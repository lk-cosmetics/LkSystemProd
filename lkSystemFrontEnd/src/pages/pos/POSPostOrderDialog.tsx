import { CheckCircle2, FileText, Plus, Printer } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import type { OrderDetail } from '@/types';
import {
  POSDialogBody,
  POSDialogContent,
  POSDialogFooter,
  POSDialogHeader,
  POSPrimaryButton,
  POSSecondaryButton,
} from './POSDialog';
import { fmtTND } from './types';

interface POSPostOrderDialogProps {
  order: OrderDetail | null;
  onClose: () => void;
  onPrintReceipt: () => void | Promise<void>;
  onPrintInvoice: () => void | Promise<void>;
}

const paymentLabel = (method?: string) => {
  if (method === 'card') return 'Carte';
  if (method === 'split') return 'Espèces + carte';
  if (method === 'bank_transfer') return 'Virement';
  return 'Espèces';
};

export function POSPostOrderDialog({
  order,
  onClose,
  onPrintReceipt,
  onPrintInvoice,
}: POSPostOrderDialogProps) {
  if (!order) return null;
  const ticketNumber = order.ticket_id || order.order_number;

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <POSDialogContent size="compact">
        <POSDialogHeader
          title="Paiement enregistré"
          description={`Ticket ${ticketNumber}`}
          aside={
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-7" />
            </span>
          }
        />

        <POSDialogBody className="space-y-5">
          <div className="border-y py-5 text-center">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Montant encaissé
            </p>
            <p className="mt-2 text-4xl font-bold tabular-nums">
              {fmtTND(Number(order.total))} <span className="text-lg">TND</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {paymentLabel(order.payment_method)}
            </p>
          </div>

          <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Articles</dt>
            <dd className="text-right font-semibold">
              {order.lines?.reduce(
                (sum, line) => sum + Number(line.quantity || 0),
                0
              ) || 0}
            </dd>
            {order.client_name ? (
              <>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="max-w-64 break-words text-right font-semibold">
                  {order.client_name}
                </dd>
              </>
            ) : null}
            {order.payment_method === 'split' ? (
              <>
                <dt className="text-muted-foreground">Part espèces</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {fmtTND(Number(order.cash_amount || 0))} TND
                </dd>
                <dt className="text-muted-foreground">Part carte</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {fmtTND(Number(order.card_amount || 0))} TND
                </dd>
              </>
            ) : null}
            {Number(order.change_returned || 0) > 0 ? (
              <>
                <dt className="text-muted-foreground">Monnaie rendue</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {fmtTND(Number(order.change_returned))} TND
                </dd>
              </>
            ) : null}
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <POSSecondaryButton className="w-full" onClick={onPrintReceipt}>
              <Printer className="size-4" /> Voir / imprimer le reçu
            </POSSecondaryButton>
            <POSSecondaryButton className="w-full" onClick={onPrintInvoice}>
              <FileText className="size-4" /> Imprimer la facture
            </POSSecondaryButton>
          </div>
        </POSDialogBody>

        <POSDialogFooter className="sm:justify-end">
          <POSPrimaryButton className="w-full sm:w-auto" onClick={onClose}>
            <Plus className="size-4" /> Nouveau ticket
          </POSPrimaryButton>
        </POSDialogFooter>
      </POSDialogContent>
    </Dialog>
  );
}
