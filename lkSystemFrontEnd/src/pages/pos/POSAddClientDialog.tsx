/**
 * POSAddClientDialog – Quick inline client creation for POS flow.
 * Minimal fields: first_name, last_name, phone, email.
 * Fast submit → returns the newly created Client.
 */
import { useState, useCallback } from 'react';
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { clientService } from '@/services/client.service';
import { TUNISIA_GOVERNORATES } from '@/constants/tunisia';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Client, SalesChannel } from '@/types';

interface POSAddClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: SalesChannel | undefined;
  onClientCreated: (client: Client) => void;
}

export function POSAddClientDialog({
  open,
  onOpenChange,
  channel,
  onClientCreated,
}: POSAddClientDialogProps) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    client_type: 'PERSON' as 'PERSON' | 'COMPANY',
    matricule_fiscale: '',
    date_of_birth: '',
    state: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetForm = useCallback(() => {
    setForm({ first_name: '', last_name: '', phone: '', email: '', client_type: 'PERSON', matricule_fiscale: '', date_of_birth: '', state: '' });
    setError('');
  }, []);

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) resetForm();
      onOpenChange(v);
    },
    [onOpenChange, resetForm],
  );

  const handleSubmit = useCallback(async () => {
    if (!form.first_name.trim() && !form.phone.trim()) {
      setError('At least a name or phone number is required.');
      return;
    }
    if (!channel) {
      setError('No sales channel selected.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      // ✨ Use createFromPOS endpoint with brand auto-assignment
      const created = await clientService.createFromPOS({
        sales_channel: channel.id,  // ✨ Brand extracted from this
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        client_type: form.client_type,
        matricule_fiscale: form.client_type === 'COMPANY' ? form.matricule_fiscale.trim() : '',
        date_of_birth: form.date_of_birth || null,
        state: form.state,
        // Note: NO need to send brand_id, source, or company
        // They are auto-assigned by the backend
      });
      onClientCreated(created);
      if (created.is_blocked) {
        setError('Client is blocked because they reached the return threshold.');
        return;
      }
      handleClose(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to create client';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [form, channel, onClientCreated, handleClose]);

  const updateField = (field: keyof typeof form, value: string | 'PERSON' | 'COMPANY') =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Add New Client
          </DialogTitle>
          <DialogDescription>
            Quick client registration for this order.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          The system checks existing clients by normalized phone. For example +21624512995 and 24512995 are treated as the same number.
        </div>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label className="text-xs">Client Type</Label>
            <Select value={form.client_type} onValueChange={value => updateField('client_type', value as 'PERSON' | 'COMPANY')}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSON">Person</SelectItem>
                <SelectItem value="COMPANY">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.client_type === 'COMPANY' && (
            <div className="col-span-2">
              <Label className="text-xs">Matricule Fiscale</Label>
              <Input
                value={form.matricule_fiscale}
                onChange={e => updateField('matricule_fiscale', e.target.value)}
                placeholder="Tax ID — appears on the client's invoices"
                className="h-9 mt-1"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">First Name</Label>
            <Input
              value={form.first_name}
              onChange={e => updateField('first_name', e.target.value)}
              placeholder="First name"
              className="h-9 mt-1"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <Label className="text-xs">Last Name</Label>
            <Input
              value={form.last_name}
              onChange={e => updateField('last_name', e.target.value)}
              placeholder="Last name"
              className="h-9 mt-1"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              value={form.phone}
              onChange={e => updateField('phone', e.target.value)}
              placeholder="+216 XX XXX XXX"
              className="h-9 mt-1"
              type="tel"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <Label className="text-xs">Email (optional)</Label>
            <Input
              value={form.email}
              onChange={e => updateField('email', e.target.value)}
              placeholder="email@example.com"
              className="h-9 mt-1"
              type="email"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <Label className="text-xs">Date of Birth</Label>
            <Input
              value={form.date_of_birth}
              onChange={e => updateField('date_of_birth', e.target.value)}
              className="h-9 mt-1"
              type="date"
            />
          </div>
          <div>
            <Label className="text-xs">Governorate</Label>
            <Select value={form.state} onValueChange={value => updateField('state', value)}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="Select governorate" />
              </SelectTrigger>
              <SelectContent>
                {TUNISIA_GOVERNORATES.map(gov => (
                  <SelectItem key={gov} value={gov}>{gov}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Add Client
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
