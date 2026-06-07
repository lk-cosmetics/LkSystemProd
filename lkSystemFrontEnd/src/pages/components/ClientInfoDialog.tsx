/**
 * ClientInfoDialog — read-only client profile popup.
 *
 * A focused, accessible client snapshot for contexts where you only need to
 * *view* a client (e.g. from an order), not manage them. It opens as a modal
 * (Radix Dialog → Escape / backdrop / close-button all dismiss it) and pulls
 * the full profile lazily via ``clientService.getById`` when opened, falling
 * back to whatever instant fields the caller already has so the popup is never
 * empty while loading.
 *
 * For full client management (edit / block / delete) use ClientsPage's
 * ClientDetailDialog instead — this one is intentionally view-only.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Award, Calendar, Loader2, Mail, MapPin, Phone, RotateCcw,
  ShieldAlert, ShoppingBag, Store,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { clientService } from '@/services/client.service';
import type { Client } from '@/types';

export interface ClientInfoFallback {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  points?: number;
  isBlocked?: boolean;
  returnCount?: number;
}

interface ClientInfoDialogProps {
  clientId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Instant values from the caller, shown immediately and while loading. */
  fallback?: ClientInfoFallback;
}

const getInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';

function Stat({ icon: Icon, label, value, tone }: {
  icon: LucideIcon; label: string; value: React.ReactNode; tone?: 'indigo' | 'red';
}) {
  const color = tone === 'indigo' ? 'text-indigo-600' : tone === 'red' ? 'text-red-600' : 'text-muted-foreground';
  return (
    <div className="rounded-lg border bg-card p-2.5 text-center">
      <Icon className={`mx-auto size-4 ${color}`} />
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value, href }: {
  icon: LucideIcon; label: string; value: string; href?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {href ? (
          <a href={href} className="break-words font-medium text-indigo-600 hover:underline">{value}</a>
        ) : (
          <p className="break-words font-medium">{value}</p>
        )}
      </div>
    </div>
  );
}

export function ClientInfoDialog({ clientId, open, onOpenChange, fallback }: Readonly<ClientInfoDialogProps>) {
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    clientService.getById(clientId)
      .then(c => { if (!cancelled) setClient(c); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, clientId]);

  // Drop stale data when the popup closes so the next open starts clean.
  useEffect(() => {
    if (!open) { setClient(null); setFailed(false); setLoading(false); }
  }, [open]);

  const name = client?.full_name?.trim() || fallback?.name || fallback?.email || 'Client';
  const blocked = client?.is_blocked ?? fallback?.isBlocked ?? false;
  const phone = client?.phone || fallback?.phone || '';
  const email = client?.email || fallback?.email || '';
  const points = client?.points ?? fallback?.points ?? 0;
  const returns = client?.number_of_returns ?? fallback?.returnCount ?? 0;
  const ordersCount = client?.number_of_orders;
  const address = client
    ? [client.address, client.city, client.governorate || client.state, client.postcode, client.country]
        .map(s => (s || '').trim()).filter(Boolean).join(', ')
    : '';
  const memberSince = client?.created_at
    ? new Date(client.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className={`space-y-0 border-b p-4 ${blocked ? 'bg-red-50' : 'bg-muted/30'}`}>
          <div className="flex items-center gap-3 pr-6">
            <div className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${blocked ? 'bg-red-100 text-red-700' : 'bg-indigo-600/10 text-indigo-700'}`}>
              {getInitials(name)}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-left text-base">{name}</DialogTitle>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {client?.client_type && (
                  <Badge variant="secondary" className="text-[10px]">
                    {client.client_type === 'COMPANY' ? 'Entreprise' : 'Particulier'}
                  </Badge>
                )}
                {client?.source && <Badge variant="outline" className="text-[10px]">{client.source}</Badge>}
                {blocked && (
                  <Badge variant="destructive" className="gap-1 text-[10px]">
                    <ShieldAlert className="size-3" /> Bloqué
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {blocked && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>Client bloqué — {returns} retour{returns === 1 ? '' : 's'} enregistré{returns === 1 ? '' : 's'}.</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Stat icon={Award} label="Points" value={points} tone="indigo" />
            <Stat icon={ShoppingBag} label="Commandes" value={ordersCount ?? '—'} />
            <Stat icon={RotateCcw} label="Retours" value={returns} tone={returns > 0 ? 'red' : undefined} />
          </div>

          <Separator className="my-4" />

          <div className="space-y-3">
            <Row icon={Phone} label="Téléphone" value={phone || '—'} href={phone ? `tel:${phone}` : undefined} />
            <Row icon={Mail} label="Email" value={email || '—'} href={email ? `mailto:${email}` : undefined} />
            <Row icon={MapPin} label="Adresse" value={address || '—'} />
            {client?.sales_channel_name && <Row icon={Store} label="Canal d'origine" value={client.sales_channel_name} />}
            {memberSince && <Row icon={Calendar} label="Client depuis" value={memberSince} />}
          </div>

          {loading && !client && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Chargement des détails…
            </p>
          )}
          {failed && !client && (
            <p className="mt-4 text-xs text-amber-600">
              Détails complets indisponibles — informations limitées affichées.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
