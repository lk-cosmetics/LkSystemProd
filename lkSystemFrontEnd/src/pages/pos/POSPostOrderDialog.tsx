import { CheckCircle2, Receipt, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { fmtTND } from './types';
import type { OrderDetail } from '@/types';

interface POSPostOrderDialogProps {
  order: OrderDetail | null;
  onClose: () => void;
  onPrintReceipt: () => void | Promise<void>;
  onPrintInvoice: () => void | Promise<void>;
}

export function POSPostOrderDialog({
  order,
  onClose,
  onPrintReceipt,
  onPrintInvoice,
}: POSPostOrderDialogProps) {
  if (!order) return null;
  const ticketNumber = order.ticket_id || order.order_number;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center items-center">
          <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
            <CheckCircle2 className="size-8 text-green-600" />
          </div>
          <DialogTitle className="text-lg">Ticket créé</DialogTitle>
          <DialogDescription className="text-center">
            Ticket{' '}
            <span className="font-semibold text-foreground">
              {ticketNumber}
            </span>{' '}
            validé avec succès.
          </DialogDescription>
        </DialogHeader>

        {/* Order Summary */}
        <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Articles</span>
            <span className="font-medium">{order.lines?.length ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paiement</span>
            <span className="font-medium capitalize">
              {order.payment_method?.replace('_', ' ') || 'Cash'}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between text-base">
            <span className="font-semibold">Total</span>
            <span className="font-bold">
              {fmtTND(Number(order.total))} TND
            </span>
          </div>
        </div>

        {/* Print Options */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground text-center">
            Choisir le document à imprimer
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-16 flex-col gap-1.5"
              onClick={onPrintReceipt}
            >
              <Receipt className="size-5" />
              <span className="text-xs font-medium">Reçu caisse</span>
            </Button>
            <Button
              variant="outline"
              className="h-16 flex-col gap-1.5"
              onClick={onPrintInvoice}
            >
              <FileText className="size-5" />
              <span className="text-xs font-medium">Facture</span>
            </Button>
          </div>
        </div>

        <Button
          variant="ghost"
          className="w-full gap-2 text-muted-foreground"
          onClick={onClose}
        >
          <X className="size-4" />
          Fermer sans imprimer
        </Button>
      </DialogContent>
    </Dialog>
  );
}
