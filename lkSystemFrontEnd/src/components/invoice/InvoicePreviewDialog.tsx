import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Printer, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InvoiceDocument } from './InvoiceDocument';
import { printInvoice } from './printInvoice';
import type { InvoiceData } from './types';
import type { InvoiceMutationPayload } from '@/services/order.service';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: InvoiceData | null;
  canEditInvoice?: boolean;
  onSaveInvoice?: (payload: InvoiceMutationPayload) => Promise<void>;
}

interface InvoiceFormState {
  invoice_number: string;
  invoice_date: string;
  invoice_client_name: string;
  invoice_client_type: 'PERSON' | 'COMPANY';
  invoice_client_matricule_fiscale: string;
  invoice_client_phone: string;
  invoice_client_email: string;
  invoice_client_address: string;
  invoice_client_city: string;
}

const formFromInvoice = (data: InvoiceData | null): InvoiceFormState => ({
  invoice_number: data?.invoiceNumber ?? '',
  invoice_date: data?.dateISO?.slice(0, 10) ?? '',
  invoice_client_name: data?.client?.name ?? '',
  invoice_client_type: data?.client?.clientType ?? 'PERSON',
  invoice_client_matricule_fiscale: data?.client?.matriculeFiscale ?? '',
  invoice_client_phone: data?.client?.phone ?? '',
  invoice_client_email: data?.client?.email ?? '',
  invoice_client_address: data?.client?.address ?? '',
  invoice_client_city: data?.client?.city ?? '',
});

/**
 * On-screen invoice preview + a Print button (browser Print / Save-as-PDF).
 * Used by the order pages; the POS reuses the same {@link InvoiceDocument} via
 * its own print flow.
 */
export function InvoicePreviewDialog({
  open,
  onOpenChange,
  data,
  canEditInvoice = false,
  onSaveInvoice,
}: Props) {
  const [editingInvoice, setEditingInvoice] = useState(false);
  const [form, setForm] = useState<InvoiceFormState>(() => formFromInvoice(data));
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setForm(formFromInvoice(data));
    setEditingInvoice(false);
    setFormError('');
  }, [
    open,
    data?.invoiceNumber,
    data?.dateISO,
    data?.client?.name,
    data?.client?.clientType,
    data?.client?.matriculeFiscale,
    data?.client?.phone,
    data?.client?.email,
    data?.client?.address,
    data?.client?.city,
  ]);

  const saveInvoice = async () => {
    const normalized = form.invoice_number.trim();
    if (!/^\d{4}\/\d+$/.test(normalized)) {
      setFormError('Use the invoice number format 2026/001.');
      return;
    }
    if (!form.invoice_date) {
      setFormError('Invoice date is required.');
      return;
    }
    if (!onSaveInvoice) return;
    setSavingInvoice(true);
    setFormError('');
    try {
      await onSaveInvoice({
        ...form,
        invoice_number: normalized,
        invoice_client_name: form.invoice_client_name.trim(),
        invoice_client_matricule_fiscale: form.invoice_client_matricule_fiscale.trim(),
        invoice_client_phone: form.invoice_client_phone.trim(),
        invoice_client_email: form.invoice_client_email.trim(),
        invoice_client_address: form.invoice_client_address.trim(),
        invoice_client_city: form.invoice_client_city.trim(),
      });
      setEditingInvoice(false);
    } catch (error) {
      const response = (
        error as { response?: { data?: Record<string, string | string[]> } }
      ).response?.data;
      const firstFieldError = response
        ? Object.values(response).find(value => Array.isArray(value) || typeof value === 'string')
        : undefined;
      setFormError(
        (Array.isArray(firstFieldError) ? firstFieldError[0] : firstFieldError)
        || 'Could not update the invoice.',
      );
    } finally {
      setSavingInvoice(false);
    }
  };

  const updateField = <K extends keyof InvoiceFormState>(
    field: K,
    value: InvoiceFormState[K],
  ) => setForm(current => ({ ...current, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[96vw] sm:max-w-[230mm] max-h-[92vh] overflow-y-auto gap-0 p-0"
      >
        <DialogHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 space-y-0 border-b bg-background px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="truncate text-base">
              Facture {data?.invoiceNumber ? `#${data.invoiceNumber}` : ''}
            </DialogTitle>
            {canEditInvoice && data && onSaveInvoice && !editingInvoice && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5"
                onClick={() => setEditingInvoice(true)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => printInvoice()} disabled={!data} className="gap-1.5">
              <Printer className="size-4" /> Imprimer
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} className="gap-1.5">
              <X className="size-4" /> Fermer
            </Button>
          </div>
        </DialogHeader>

        {editingInvoice && (
          <div className="border-b bg-background p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-number">Invoice number</Label>
                <Input
                  id="invoice-number"
                  value={form.invoice_number}
                  onChange={event => updateField('invoice_number', event.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-date">Invoice date</Label>
                <Input
                  id="invoice-date"
                  type="date"
                  value={form.invoice_date}
                  onChange={event => updateField('invoice_date', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client type</Label>
                <Select
                  value={form.invoice_client_type}
                  onValueChange={value => updateField(
                    'invoice_client_type',
                    value as 'PERSON' | 'COMPANY',
                  )}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERSON">Person</SelectItem>
                    <SelectItem value="COMPANY">Company</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-client-name">Client name</Label>
                <Input
                  id="invoice-client-name"
                  value={form.invoice_client_name}
                  onChange={event => updateField('invoice_client_name', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-client-phone">Phone</Label>
                <Input
                  id="invoice-client-phone"
                  value={form.invoice_client_phone}
                  onChange={event => updateField('invoice_client_phone', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-client-email">Email</Label>
                <Input
                  id="invoice-client-email"
                  type="email"
                  value={form.invoice_client_email}
                  onChange={event => updateField('invoice_client_email', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-client-city">City</Label>
                <Input
                  id="invoice-client-city"
                  value={form.invoice_client_city}
                  onChange={event => updateField('invoice_client_city', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-client-mf">Matricule fiscale</Label>
                <Input
                  id="invoice-client-mf"
                  value={form.invoice_client_matricule_fiscale}
                  onChange={event => updateField(
                    'invoice_client_matricule_fiscale',
                    event.target.value,
                  )}
                  disabled={form.invoice_client_type !== 'COMPANY'}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="invoice-client-address">Address</Label>
                <Input
                  id="invoice-client-address"
                  value={form.invoice_client_address}
                  onChange={event => updateField('invoice_client_address', event.target.value)}
                />
              </div>
            </div>
            {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setForm(formFromInvoice(data));
                  setFormError('');
                  setEditingInvoice(false);
                }}
                disabled={savingInvoice}
              >
                Cancel
              </Button>
              <Button onClick={saveInvoice} disabled={savingInvoice} className="gap-1.5">
                {savingInvoice
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Check className="size-4" />}
                Save invoice
              </Button>
            </div>
          </div>
        )}

        <div className="bg-muted/40 p-4 sm:p-6">
          {data && <InvoiceDocument data={data} preview />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default InvoicePreviewDialog;
