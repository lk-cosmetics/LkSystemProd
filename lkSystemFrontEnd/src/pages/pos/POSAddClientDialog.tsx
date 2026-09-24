import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Loader2,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';
import { TUNISIA_GOVERNORATES } from '@/constants/tunisia';
import { cn } from '@/lib/utils';
import { clientService } from '@/services/client.service';
import type { Client, SalesChannel } from '@/types';
import {
  POSDialogBody,
  POSDialogContent,
  POSDialogFooter,
  POSDialogHeader,
  POSPrimaryButton,
  POSSecondaryButton,
} from './POSDialog';

interface POSAddClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: SalesChannel | undefined;
  onClientCreated: (client: Client) => void;
}

interface POSClientForm {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  client_type: 'PERSON' | 'COMPANY';
  matricule_fiscale: string;
  date_of_birth: string;
  state: string;
}

const EMPTY_FORM: POSClientForm = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  client_type: 'PERSON',
  matricule_fiscale: '',
  date_of_birth: '',
  state: '',
};

function extractClientError(error: unknown): string {
  const data = (error as { response?: { data?: unknown } } | null)?.response
    ?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const direct = record.detail ?? record.message ?? record.error;
    if (typeof direct === 'string' && direct) return direct;
    for (const value of Object.values(record)) {
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return error instanceof Error
    ? error.message
    : 'Impossible d’ajouter ce client.';
}

export function POSAddClientDialog({
  open,
  onOpenChange,
  channel,
  onClientCreated,
}: POSAddClientDialogProps) {
  const [form, setForm] = useState<POSClientForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingClient, setExistingClient] = useState<Client | null>(null);

  const reset = useCallback(() => {
    setForm(EMPTY_FORM);
    setError('');
    setExistingClient(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && !saving) reset();
      if (!saving) onOpenChange(next);
    },
    [onOpenChange, reset, saving]
  );

  const update = <Key extends keyof POSClientForm>(
    key: Key,
    value: POSClientForm[Key]
  ) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setError('');
    setExistingClient(null);
  };

  const useExisting = () => {
    if (!existingClient) return;
    onClientCreated(existingClient);
    reset();
    onOpenChange(false);
  };

  const submit = useCallback(async () => {
    if (!channel) {
      setError('Sélectionnez un point de vente avant de créer un client.');
      return;
    }
    if (!form.first_name.trim() && !form.last_name.trim()) {
      setError('Saisissez au moins un prénom ou un nom.');
      return;
    }
    if (!form.phone.trim()) {
      setError(
        'Le numéro de téléphone est obligatoire pour éviter les doublons.'
      );
      return;
    }

    setSaving(true);
    setError('');
    setExistingClient(null);
    try {
      const client = await clientService.createFromPOS({
        sales_channel: channel.id,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        client_type: form.client_type,
        matricule_fiscale:
          form.client_type === 'COMPANY' ? form.matricule_fiscale.trim() : '',
        date_of_birth: form.date_of_birth || null,
        state: form.state,
      });

      if (client.existing) {
        setExistingClient(client);
        setError(
          'Un client avec ce numéro existe déjà. Utilisez sa fiche existante.'
        );
        return;
      }
      onClientCreated(client);
      reset();
      onOpenChange(false);
    } catch (requestError) {
      setError(extractClientError(requestError));
    } finally {
      setSaving(false);
    }
  }, [channel, form, onClientCreated, onOpenChange, reset]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <POSDialogContent size="default">
        <POSDialogHeader
          title="Nouveau client"
          description="Coordonnées essentielles · vérification automatique du téléphone"
          aside={
            <span className="flex size-11 items-center justify-center rounded-md border bg-muted/40">
              <UserPlus className="size-5" />
            </span>
          }
        />

        <POSDialogBody className="py-4 sm:py-4">
          <form
            id="pos-add-client-form"
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Type de client</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['PERSON', 'Particulier', UserRound],
                    ['COMPANY', 'Entreprise', Building2],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update('client_type', value)}
                    className={cn(
                      'flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
                      form.client_type === value &&
                        'border-foreground bg-foreground text-background'
                    )}
                    aria-pressed={form.client_type === value}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-first-name">Prénom</Label>
                <Input
                  id="pos-client-first-name"
                  value={form.first_name}
                  onChange={event => update('first_name', event.target.value)}
                  placeholder="Prénom"
                  autoFocus
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-last-name">Nom</Label>
                <Input
                  id="pos-client-last-name"
                  value={form.last_name}
                  onChange={event => update('last_name', event.target.value)}
                  placeholder="Nom"
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-phone">
                  Téléphone <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pos-client-phone"
                  type="tel"
                  value={form.phone}
                  onChange={event => update('phone', event.target.value)}
                  placeholder="+216 XX XXX XXX"
                  className="h-11 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  +21624512995 et 24512995 sont reconnus comme le même numéro.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-email">
                  E-mail{' '}
                  <span className="font-normal text-muted-foreground">
                    (optionnel)
                  </span>
                </Label>
                <Input
                  id="pos-client-email"
                  type="email"
                  value={form.email}
                  onChange={event => update('email', event.target.value)}
                  placeholder="client@example.com"
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-birth-date">Date de naissance</Label>
                <Input
                  id="pos-client-birth-date"
                  type="date"
                  value={form.date_of_birth}
                  onChange={event =>
                    update('date_of_birth', event.target.value)
                  }
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gouvernorat</Label>
                <SearchSelect
                  value={form.state}
                  onChange={value => update('state', value)}
                  options={TUNISIA_GOVERNORATES.map(governorate => ({
                    label: governorate,
                    value: governorate,
                  }))}
                  placeholder="Rechercher un gouvernorat…"
                  className="h-11 text-base"
                />
              </div>
              {form.client_type === 'COMPANY' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pos-client-tax-id">Matricule fiscal</Label>
                  <Input
                    id="pos-client-tax-id"
                    value={form.matricule_fiscale}
                    onChange={event =>
                      update('matricule_fiscale', event.target.value)
                    }
                    placeholder="Identifiant fiscal de l’entreprise"
                    className="h-11 text-base"
                  />
                </div>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                className={cn(
                  'flex items-start gap-3 rounded-md border px-4 py-3 text-sm',
                  existingClient
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-destructive/30 bg-destructive/5 text-destructive'
                )}
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{error}</p>
                  {existingClient ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <span>
                        {existingClient.full_name} · {existingClient.phone}
                      </span>
                      <button
                        type="button"
                        onClick={useExisting}
                        className="font-semibold underline underline-offset-4"
                      >
                        Utiliser ce client
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </form>
        </POSDialogBody>

        <POSDialogFooter>
          <POSSecondaryButton
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            Annuler
          </POSSecondaryButton>
          {existingClient ? (
            <POSPrimaryButton type="button" onClick={useExisting}>
              <CheckCircle2 className="size-4" /> Utiliser ce client
            </POSPrimaryButton>
          ) : (
            <POSPrimaryButton
              type="submit"
              form="pos-add-client-form"
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Vérification…
                </>
              ) : (
                <>
                  <UserPlus className="size-4" /> Ajouter le client
                </>
              )}
            </POSPrimaryButton>
          )}
        </POSDialogFooter>
      </POSDialogContent>
    </Dialog>
  );
}
