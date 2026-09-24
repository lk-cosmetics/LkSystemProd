import { memo, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  UserPlus,
  UserRound,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';
import { POSActionCard } from './POSDialog';

interface POSCustomerSectionProps {
  clients: Client[];
  selectedClient: Client | null;
  clientSkipped: boolean;
  onSelectClient: (client: Client) => void;
  onSkipClient: () => void;
  onClearClient: () => void;
  onAddClientClick: () => void;
  canAddClient?: boolean;
}

const normalizePhone = (value: string) =>
  value.replace(/\D/g, '').replace(/^216/, '');

export const POSCustomerSection = memo(function POSCustomerSection({
  clients,
  selectedClient,
  clientSkipped,
  onSelectClient,
  onSkipClient,
  onClearClient,
  onAddClientClick,
  canAddClient = true,
}: POSCustomerSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const debouncedQuery = useDebounce(query.trim(), 180);

  const matches = useMemo(() => {
    if (!debouncedQuery) return [];
    const text = debouncedQuery.toLocaleLowerCase('fr');
    const phone = normalizePhone(debouncedQuery);
    return clients
      .filter(client => {
        const names = [client.first_name, client.last_name, client.full_name]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('fr');
        const clientPhone = normalizePhone(
          client.phone_normalized || client.phone || ''
        );
        return (
          names.includes(text) ||
          (client.email || '').toLocaleLowerCase('fr').includes(text) ||
          (phone.length > 0 && clientPhone.includes(phone))
        );
      })
      .slice(0, 30);
  }, [clients, debouncedQuery]);

  if (selectedClient) {
    return (
      <div
        className={cn(
          'rounded-md border-2 p-4',
          selectedClient.is_blocked
            ? 'border-destructive/40 bg-destructive/5'
            : 'border-emerald-600/50 bg-emerald-50/50'
        )}
      >
        <div className="flex items-start gap-4">
          <span
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              selectedClient.is_blocked
                ? 'bg-destructive/10 text-destructive'
                : 'bg-emerald-100 text-emerald-700'
            )}
          >
            {selectedClient.is_blocked ? (
              <AlertTriangle className="size-5" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Client sélectionné
            </p>
            <p className="mt-1 break-words text-base font-semibold">
              {selectedClient.full_name}
            </p>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">
              {selectedClient.phone ||
                selectedClient.email ||
                'Aucune coordonnée'}
            </p>
            {selectedClient.is_blocked ? (
              <p className="mt-2 text-sm font-medium text-destructive">
                Client bloqué · {selectedClient.number_of_returns || 0}{' '}
                retour(s)
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            onClick={onClearClient}
          >
            Modifier
          </Button>
        </div>
      </div>
    );
  }

  if (clientSkipped) {
    return (
      <div className="flex items-center gap-4 rounded-md border-2 border-dashed p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserX className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Vente anonyme
          </p>
          <p className="mt-1 text-base font-semibold">Continuer sans client</p>
        </div>
        <Button variant="outline" className="h-11" onClick={onClearClient}>
          Modifier
        </Button>
      </div>
    );
  }

  const showResults = searchFocused && query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="pos-customer-search" className="text-sm font-semibold">
          Rechercher un client
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            id="pos-customer-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                setQuery('');
                inputRef.current?.blur();
              }
              if (event.key === 'Enter' && matches.length === 1) {
                event.preventDefault();
                onSelectClient(matches[0]);
              }
            }}
            placeholder="Nom, prénom, téléphone ou e-mail"
            autoComplete="off"
            className="h-12 pl-12 text-base"
          />
        </div>

        {showResults ? (
          <ScrollArea
            className="max-h-64 rounded-md border"
            aria-label="Résultats clients"
          >
            <div className="p-2">
              {matches.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium">Aucun client trouvé</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Vérifiez la recherche ou créez un nouveau client.
                  </p>
                </div>
              ) : (
                matches.map(client => (
                  <button
                    key={client.id}
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelectClient(client)}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {client.full_name}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {[client.phone, client.email]
                          .filter(Boolean)
                          .join(' · ') || 'Aucune coordonnée'}
                      </span>
                    </span>
                    {client.is_blocked ? (
                      <span className="shrink-0 text-xs font-semibold text-destructive">
                        Bloqué
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <POSActionCard
          icon={<UserPlus className="size-5" />}
          title="Nouveau client"
          description="Créer et associer une fiche client"
          onClick={onAddClientClick}
          disabled={!canAddClient}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        />
        <POSActionCard
          icon={<UserX className="size-5" />}
          title="Continuer sans client"
          description="Vente rapide à un client de passage"
          onClick={onSkipClient}
        />
      </div>

      {!canAddClient ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-sm text-amber-700"
        >
          <AlertTriangle className="size-4 shrink-0" /> Sélectionnez
          d&apos;abord un point de vente.
        </p>
      ) : null}
    </div>
  );
});
