/**
 * POSCustomerSection – Customer selection for POS.
 * Supports: search existing, add new, skip (no client), clear selection.
 * Customer starts as null — no default "Walk-in".
 */
import { useState, useRef, useEffect, memo } from 'react';
import {
  User,
  UserPlus,
  UserX,
  Search,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Client } from '@/types';

interface POSCustomerSectionProps {
  clients: Client[];
  selectedClient: Client | null;
  clientSkipped: boolean;
  onSelectClient: (client: Client) => void;
  onSkipClient: () => void;
  onClearClient: () => void;
  onAddClientClick: () => void;
  canAddClient?: boolean;  /* ✨ Whether sales channel is selected */
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? clients.filter(c => {
        const q = query.toLowerCase();
        return (
          c.full_name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.includes(q)
        );
      })
    : clients;

  // Focus search input when dropdown opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [searchOpen]);

  // ── Client is selected ──
  if (selectedClient) {
    return (
      <div className={`space-y-2 p-2 rounded-md border ${selectedClient.is_blocked ? 'border-red-200 bg-red-50' : 'bg-muted/30'}`}>
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center size-7 rounded-full shrink-0 ${selectedClient.is_blocked ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary'}`}>
            <User className="size-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedClient.full_name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {selectedClient.phone || selectedClient.email || '—'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={onClearClient}
            aria-label="Remove customer"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        {selectedClient.is_blocked && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-700">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            Blocked client. Returns: {selectedClient.number_of_returns}.
          </div>
        )}
      </div>
    );
  }

  // ── Client explicitly skipped ──
  if (clientSkipped) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-md border border-dashed">
        <div className="flex items-center justify-center size-7 rounded-full bg-muted text-muted-foreground shrink-0">
          <UserX className="size-3.5" />
        </div>
        <p className="text-sm text-muted-foreground flex-1">No customer</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={onClearClient}
        >
          Change
        </Button>
      </div>
    );
  }

  // ── No selection yet — show search / add / skip ──
  if (searchOpen) {
    return (
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search name, email, phone..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-8 pl-8 pr-8 text-sm"
            onKeyDown={e => {
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
            onClick={() => setSearchOpen(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <ScrollArea className="max-h-36 border rounded-md">
          {filtered.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-xs text-muted-foreground mb-2">
                {query ? 'No clients found' : 'No clients available'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setSearchOpen(false);
                  onAddClientClick();
                }}
              >
                <UserPlus className="size-3" />
                Add New Client
              </Button>
            </div>
          ) : (
            <div className="p-1">
              {filtered.slice(0, 50).map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-accent text-left text-sm transition-colors"
                  onClick={() => {
                    onSelectClient(c);
                    setSearchOpen(false);
                  }}
                >
                  <div className="flex items-center justify-center size-6 rounded-full bg-muted text-muted-foreground shrink-0">
                    <User className="size-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{c.full_name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.phone || c.email}
                    </p>
                    {c.is_blocked && (
                      <Badge variant="destructive" className="mt-1 h-4 px-1 text-[9px]">
                        Blocked · {c.number_of_returns} returns
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  // ── Default: 3-button row ──
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-8 text-xs gap-1.5"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-3" />
          Select Client
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1.5 px-2.5"
          onClick={onAddClientClick}
          disabled={!canAddClient}
          title={!canAddClient ? '⚠️ Select a sales channel first' : 'Add new client'}
        >
          <UserPlus className="size-3" />
          Add
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5 px-2.5 text-muted-foreground"
          onClick={onSkipClient}
        >
          <UserX className="size-3" />
          Skip
        </Button>
      </div>
      {!canAddClient && (
        <div className="text-[10px] text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
          ⚠️ <strong>Channel Required:</strong> Select a sales channel above before adding a client
        </div>
      )}
      {canAddClient && (
        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
          No customer selected
        </Badge>
      )}
    </div>
  );
});
