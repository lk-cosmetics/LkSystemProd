import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, Check, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';

interface POSClientAssociationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  initialClientId?: string;
  isCreatingClient?: boolean;
  onSkip: () => void;
  onConfirmClient: (clientId: string) => void;
  onCreateClient: (payload: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
  }) => Promise<string>;
}

export function POSClientAssociationDialog({
  open,
  onOpenChange,
  clients,
  initialClientId,
  isCreatingClient,
  onSkip,
  onConfirmClient,
  onCreateClient,
}: POSClientAssociationDialogProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const firstNameInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'select' | 'create'>('select');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(initialClientId ?? '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('select');
    setSearchTerm('');
    setSelectedClientId(initialClientId ?? '');
    setErrorMessage(null);
  }, [open, initialClientId]);

  useEffect(() => {
    if (!open) return;

    const focusTimer = setTimeout(() => {
      if (mode === 'select') {
        searchInputRef.current?.focus();
      } else {
        firstNameInputRef.current?.focus();
      }
    }, 20);

    return () => clearTimeout(focusTimer);
  }, [mode, open]);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return clients;

    const query = searchTerm.toLowerCase();
    return clients.filter(client => {
      return (
        client.full_name.toLowerCase().includes(query) ||
        (client.phone ?? '').toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query)
      );
    });
  }, [clients, searchTerm]);

  const selectedClient = useMemo(
    () => clients.find(client => String(client.id) === selectedClientId),
    [clients, selectedClientId]
  );

  const handleCreateAndSelect = async () => {
    if (!firstName.trim() && !lastName.trim()) {
      setErrorMessage('Please enter at least a first name or last name.');
      return;
    }

    if (!phone.trim() && !email.trim()) {
      setErrorMessage('Please provide at least a phone or email.');
      return;
    }

    setErrorMessage(null);

    try {
      const newClientId = await onCreateClient({
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
      });
      onConfirmClient(newClientId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to create client. Please try again.';
      setErrorMessage(message);
    }
  };

  const handleDialogKeyDown: React.KeyboardEventHandler<HTMLDivElement> = e => {
    if (e.key !== 'Enter') return;

    if (mode === 'select' && selectedClientId) {
      e.preventDefault();
      onConfirmClient(selectedClientId);
      return;
    }

    if (mode === 'create' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleCreateAndSelect();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" onKeyDown={handleDialogKeyDown}>
        <DialogHeader>
          <DialogTitle>Associate Client</DialogTitle>
          <DialogDescription>
            Search and select a client, or create a new one quickly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'select' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => {
              setMode('select');
              setErrorMessage(null);
            }}
          >
            <Search className="size-4 mr-2" />
            Existing Client
          </Button>
          <Button
            type="button"
            variant={mode === 'create' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => {
              setMode('create');
              setErrorMessage(null);
            }}
          >
            <UserPlus className="size-4 mr-2" />
            New Client
          </Button>
        </div>

        {mode === 'select' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
                placeholder="Search by name, phone, or email"
              />
            </div>

            <ScrollArea className="h-60 rounded-md border">
              <div className="p-2 space-y-1">
                {filteredClients.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No clients found
                  </p>
                ) : (
                  filteredClients.map(client => {
                    const isSelected = selectedClientId === String(client.id);
                    return (
                      <button
                        type="button"
                        key={client.id}
                        className={cn(
                          'w-full text-left rounded-md border p-3 transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-transparent hover:border-border hover:bg-muted/40'
                        )}
                        onClick={() => setSelectedClientId(String(client.id))}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{client.full_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{client.phone || '-'}</p>
                            <p className="text-xs text-muted-foreground truncate">{client.email || '-'}</p>
                          </div>
                          {isSelected && <Check className="size-4 text-primary mt-0.5" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            {selectedClient && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 border p-2.5 text-xs text-muted-foreground">
                <User className="size-3.5" />
                Selected: <span className="font-medium text-foreground">{selectedClient.full_name}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-first-name">First Name</Label>
                <Input
                  ref={firstNameInputRef}
                  id="pos-client-first-name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-last-name">Last Name</Label>
                <Input
                  id="pos-client-last-name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-phone">Phone</Label>
                <Input
                  id="pos-client-phone"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+216..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-client-email">Email (Optional)</Label>
                <Input
                  id="pos-client-email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: Email can be left empty. The system will generate one automatically for POS speed.
            </p>
            <p className="text-xs text-muted-foreground">
              Shortcut: Press Ctrl+Enter to create and use this client.
            </p>
          </div>
        )}

        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onSkip}>
            Skip Client
          </Button>
          {mode === 'select' ? (
            <Button
              type="button"
              onClick={() => selectedClientId && onConfirmClient(selectedClientId)}
              disabled={!selectedClientId}
            >
              Confirm Client (Enter)
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleCreateAndSelect}
              disabled={isCreatingClient}
            >
              {isCreatingClient ? 'Creating...' : 'Create And Use Client'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
