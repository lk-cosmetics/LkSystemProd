/**
 * OrderClientSelector — pick or create the customer for a back-office order.
 *
 * Two modes share one control:
 *   • search  – type-ahead over existing clients (phone or name), tenant-scoped
 *               server-side via ``useClients({ search })``.
 *   • create  – inline "new client" form that reuses the exact Clients
 *               Management structure: email is required, ``client_type`` is
 *               Person/Company, and the create call goes through the same
 *               ``useCreateClient`` mutation (source defaults to MANUAL and the
 *               company is derived from the authenticated user server-side).
 *
 * The selected client is surfaced to the parent via ``onChange``; the parent
 * sends its id + a billing block to the order endpoint.
 */
import { useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  AlertTriangle,
  Building2,
  Check,
  Loader2,
  Mail,
  Phone,
  Search,
  Truck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
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
import { useClients, useCreateClient } from '@/hooks/queries/useClients';
import { useDebounce } from '@/hooks/useDebounce';
import { TUNISIA_GOVERNORATES } from '@/constants/tunisia';
import type { Client, CreateClientRequest, PaginatedResponse } from '@/types';

interface OrderClientSelectorProps {
  value: Client | null;
  onChange: (client: Client | null) => void;
  /**
   * Channel/brand a newly created client should be associated with. The
   * backend still derives the company from the authenticated user, so these
   * are convenience hints only and never a trust boundary.
   */
  salesChannelId?: number | null;
  brandId?: number | null;
  disabled?: boolean;
}

/** Pull a human-readable message out of an unknown (often Axios) error. */
function readApiError(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (typeof record.detail === 'string') return record.detail;
      const firstKey = Object.keys(record)[0];
      if (firstKey) {
        const val = record[firstKey];
        const msg = Array.isArray(val) ? String(val[0]) : String(val);
        // Friendly rewrite of the most common uniqueness clashes.
        if (/phone/i.test(firstKey) || /phone/i.test(msg)) {
          return 'This phone number is already registered.';
        }
        if (/email/i.test(firstKey) && /exist|registered|unique/i.test(msg)) {
          return 'This email is already registered.';
        }
        return firstKey === 'detail' ? msg : `${firstKey}: ${msg}`;
      }
    }
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function normalizeClients(
  data: PaginatedResponse<Client> | Client[] | undefined
): Client[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.results ?? [];
}

function clientLabel(client: Client): string {
  const name = client.full_name?.trim() || `${client.first_name} ${client.last_name}`.trim();
  return name || client.email || client.phone || `Client #${client.id}`;
}

const EMPTY_CREATE_FORM = {
  client_type: 'PERSON' as 'PERSON' | 'COMPANY',
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  // Delivery fields — the JAX delivery API needs the governorate (mapped from
  // ``state``), the delegation/city, and a street address to generate a label.
  state: '',
  city: '',
  address: '',
};

export function OrderClientSelector({
  value,
  onChange,
  salesChannelId,
  brandId,
  disabled = false,
}: OrderClientSelectorProps) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);

  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState('');

  const createMutation = useCreateClient();

  const searchEnabled = !value && mode === 'search' && debouncedSearch.length >= 2;
  const { data, isFetching } = useClients(
    { search: debouncedSearch, page_size: 8 },
    { enabled: searchEnabled }
  );
  const results = useMemo(() => normalizeClients(data), [data]);

  const setField = (field: keyof typeof createForm, val: string) =>
    setCreateForm(prev => ({ ...prev, [field]: val }));

  const openCreate = () => {
    // Pre-fill from whatever the user already typed so search→create is smooth.
    const term = search.trim();
    const prefill = { ...EMPTY_CREATE_FORM };
    if (term.includes('@')) prefill.email = term;
    else if (/^[+\d][\d\s-]{4,}$/.test(term)) prefill.phone = term;
    else if (term) prefill.first_name = term;
    setCreateForm(prefill);
    setCreateError('');
    setMode('create');
  };

  const cancelCreate = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError('');
    setMode('search');
  };

  const handleCreate = async () => {
    const email = createForm.email.trim();
    const phone = createForm.phone.trim();
    // Both phone and email are mandatory when creating a client from an order.
    if (!email) {
      setCreateError('Email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCreateError('Please enter a valid email address.');
      return;
    }
    if (!phone) {
      setCreateError('Phone number is required.');
      return;
    }
    setCreateError('');
    const payload: CreateClientRequest = {
      email,
      client_type: createForm.client_type,
      first_name: createForm.first_name.trim() || undefined,
      last_name: createForm.last_name.trim() || undefined,
      phone,
      country: 'TN',
      // Delivery details — only sent when filled so we never overwrite with blanks.
      ...(createForm.state ? { state: createForm.state } : {}),
      ...(createForm.city.trim() ? { city: createForm.city.trim() } : {}),
      ...(createForm.address.trim() ? { address: createForm.address.trim() } : {}),
      ...(brandId ? { brand: brandId } : {}),
      ...(salesChannelId ? { sales_channel: salesChannelId } : {}),
    };
    try {
      const created = await createMutation.mutateAsync(payload);
      onChange(created);
      setCreateForm(EMPTY_CREATE_FORM);
      setMode('search');
      setSearch('');
    } catch (err) {
      setCreateError(readApiError(err, 'Failed to create client.'));
    }
  };

  // ── Selected client card ─────────────────────────────────────────────────
  if (value) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {value.client_type === 'COMPANY' ? (
                <Building2 className="size-4" />
              ) : (
                <User className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{clientLabel(value)}</span>
                {value.is_blocked && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                    Blocked
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {value.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3" />
                    {value.phone}
                  </span>
                )}
                {value.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3" />
                    {value.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <X className="size-3.5" />
            Change
          </Button>
        </div>
        {value.is_blocked && (
          <div className="mt-2 flex gap-1.5 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>This client is blocked. Review before completing the order.</span>
          </div>
        )}
      </div>
    );
  }

  // ── Inline create form ─────────────────────────────────────────────────────
  if (mode === 'create') {
    return (
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <UserPlus className="size-4" />
            New client
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={cancelCreate}
            disabled={createMutation.isPending}
          >
            Back to search
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Client Type</Label>
            <Select
              value={createForm.client_type}
              onValueChange={val => setField('client_type', val as 'PERSON' | 'COMPANY')}
            >
              <SelectTrigger className="mt-1 h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSON">Normal (Person)</SelectItem>
                <SelectItem value="COMPANY">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Email *</Label>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={createForm.email}
              onChange={e => setField('email', e.target.value)}
              placeholder="client@example.com"
              className="mt-1 h-10"
            />
          </div>
          <div>
            <Label className="text-xs">
              {createForm.client_type === 'COMPANY' ? 'Contact First Name' : 'First Name'}
            </Label>
            <Input
              value={createForm.first_name}
              onChange={e => setField('first_name', e.target.value)}
              placeholder="First name"
              className="mt-1 h-10"
            />
          </div>
          <div>
            <Label className="text-xs">
              {createForm.client_type === 'COMPANY' ? 'Company Name' : 'Last Name'}
            </Label>
            <Input
              value={createForm.last_name}
              onChange={e => setField('last_name', e.target.value)}
              placeholder={createForm.client_type === 'COMPANY' ? 'Company' : 'Last name'}
              className="mt-1 h-10"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Phone *</Label>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={createForm.phone}
              onChange={e => setField('phone', e.target.value)}
              placeholder="+216 XX XXX XXX"
              className="mt-1 h-10"
            />
          </div>

          <div className="col-span-2 mt-1 flex items-center gap-1.5 border-t pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Truck className="size-3.5" />
            Delivery details
          </div>
          <div>
            <Label className="text-xs">Gouvernorat</Label>
            <Select value={createForm.state} onValueChange={val => setField('state', val)}>
              <SelectTrigger className="mt-1 h-10">
                <SelectValue placeholder="Select governorate" />
              </SelectTrigger>
              <SelectContent>
                {TUNISIA_GOVERNORATES.map(gov => (
                  <SelectItem key={gov} value={gov}>{gov}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Délégation / City</Label>
            <Input
              value={createForm.city}
              onChange={e => setField('city', e.target.value)}
              placeholder="e.g. La Marsa"
              className="mt-1 h-10"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Adresse de livraison</Label>
            <Input
              value={createForm.address}
              onChange={e => setField('address', e.target.value)}
              placeholder="Street, building, apartment…"
              className="mt-1 h-10"
            />
          </div>
          <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">
            Governorate and address are used to generate the delivery label — fill them in for orders that ship.
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Phones are matched safely — +21624512995 and 24512995 point to the same client.
        </p>

        {createError && (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{createError}</span>
          </div>
        )}

        <Button
          type="button"
          className="w-full gap-1.5"
          onClick={handleCreate}
          disabled={createMutation.isPending || !createForm.email.trim() || !createForm.phone.trim()}
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <UserPlus className="size-4" />
              Create client
            </>
          )}
        </Button>
      </div>
    );
  }

  // ── Search mode ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by phone or name…"
          className="h-9 pl-8"
          disabled={disabled}
        />
        {isFetching && (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {searchEnabled && (
        <div className="max-h-52 overflow-y-auto rounded-md border">
          {results.length === 0 && !isFetching ? (
            <div className="p-3 text-center text-xs text-muted-foreground">
              No clients match “{debouncedSearch}”.
            </div>
          ) : (
            results.map(client => (
              <button
                key={client.id}
                type="button"
                onClick={() => {
                  onChange(client);
                  setSearch('');
                }}
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {client.client_type === 'COMPANY' ? (
                    <Building2 className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{clientLabel(client)}</span>
                    {client.is_blocked && (
                      <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">
                        Blocked
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[client.phone, client.email].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <Check className="size-4 shrink-0 text-transparent" />
              </button>
            ))
          )}
        </div>
      )}

      {!searchEnabled && search.trim().length > 0 && search.trim().length < 2 && (
        <p className="text-xs text-muted-foreground">Type at least 2 characters to search.</p>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        onClick={openCreate}
        disabled={disabled}
      >
        <UserPlus className="mr-2 size-4" />
        Create new client
      </Button>
    </div>
  );
}
