/**
 * SalesChannelsPage – manages WOOCOMMERCE, POS, and WEB sales channels.
 *
 * Key design decisions:
 *  - WebFields / WooFields are defined at module level (not inside the component)
 *    to prevent React from remounting them on every parent render.
 *  - Tunisian governorates are managed from a local canonical list.
 *  - SearchSelect is a lightweight headless combobox that avoids adding new
 *    dependencies (no @radix-ui/react-popover or cmdk required).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Eye, Pencil, Trash2, Search, Filter, MoreVertical,
  Building2, Tag, Calendar, Store, Plus, Globe, Key,
  Copy, Check, RefreshCw, Link2, Power, MapPin, Truck,
  ChevronDown, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useSalesChannels, useCreateSalesChannel, usePartialUpdateSalesChannel,
  useDeleteSalesChannel, useRegenerateWebhook, salesChannelsKeys,
} from '@/hooks/queries/useSalesChannels';
import { useBrands } from '@/hooks/queries/useBrands';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TUNISIA_GOVERNORATE_OPTIONS } from '@/constants/tunisia';
import type { SalesChannel, ChannelType, CreateSalesChannelRequest } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// SearchSelect – lightweight combobox, defined at module level
// ─────────────────────────────────────────────────────────────────────────────

interface SearchSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
  disabled?: boolean;
}

function SearchSelect({ value, onChange, options, placeholder, disabled }: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find(o => o.value === value);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (!open) setOpen(true);
  };

  const handleInputFocus = () => {
    setQuery('');
    setOpen(true);
  };

  const handleSelect = (opt: { label: string; value: string }) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onChange('');
    setQuery('');
    setOpen(false);
  };

  const displayValue = open ? query : (selected?.label ?? '');

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-14"
          autoComplete="off"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onMouseDown={handleClear}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No results found</p>
          ) : (
            filtered.map(opt => (
              <div
                key={opt.value}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt); }}
                className={`px-3 py-2 text-sm cursor-pointer select-none transition-colors hover:bg-accent hover:text-accent-foreground ${
                  opt.value === value ? 'bg-accent/60 font-medium' : ''
                }`}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form types
// ─────────────────────────────────────────────────────────────────────────────

interface ChannelFormData {
  name: string;
  brand: string;
  channel_type: ChannelType;
  is_active: boolean;
  // Location (WEB channels)
  state: string;
  city: string;
  // WooCommerce
  wc_store_url: string;
  wc_consumer_key: string;
  wc_consumer_secret: string;
  delivery_api_key: string;
}

const EMPTY_FORM: ChannelFormData = {
  name: '', brand: '', channel_type: 'WOOCOMMERCE', is_active: true,
  state: '', city: '',
  wc_store_url: '', wc_consumer_key: '', wc_consumer_secret: '', delivery_api_key: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// WooCommerce fields block – defined at module level (critical!)
// ─────────────────────────────────────────────────────────────────────────────

interface WooFieldsProps {
  form: ChannelFormData;
  onChange: <K extends keyof ChannelFormData>(k: K, v: ChannelFormData[K]) => void;
  /** When editing, show webhook token row */
  webhookToken?: string;
  onRegenerateWebhook?: () => void;
  regenerating?: boolean;
}

function WooFields({ form, onChange, webhookToken, onRegenerateWebhook, regenerating }: WooFieldsProps) {
  return (
    <div className="space-y-4 rounded-lg border border-purple-200 bg-purple-50/40 dark:bg-purple-950/20 dark:border-purple-800/40 p-4">
      <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide flex items-center gap-1.5">
        <Globe className="size-3.5" /> WooCommerce Configuration
      </p>

      <div className="space-y-2">
        <Label htmlFor="woo-store-url">Store URL *</Label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="woo-store-url"
            value={form.wc_store_url}
            onChange={e => onChange('wc_store_url', e.target.value)}
            className="pl-10"
            placeholder="https://store.example.com"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 min-w-0">
          <Label htmlFor="woo-ck">Consumer Key *</Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="woo-ck"
              value={form.wc_consumer_key}
              onChange={e => onChange('wc_consumer_key', e.target.value)}
              className="pl-10 font-mono text-sm"
              placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx"
            />
          </div>
        </div>

        <div className="space-y-2 min-w-0">
          <Label htmlFor="woo-cs">Consumer Secret *</Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="woo-cs"
              type="password"
              value={form.wc_consumer_secret}
              onChange={e => onChange('wc_consumer_secret', e.target.value)}
              className="pl-10 font-mono text-sm"
              placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="woo-delivery-key">Delivery API Key</Label>
        <div className="relative">
          <Key className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Textarea
            id="woo-delivery-key"
            value={form.delivery_api_key}
            onChange={e => onChange('delivery_api_key', e.target.value)}
            className="min-h-24 pl-10 font-mono text-xs resize-none break-all"
            placeholder="Paste the full JAX JWT token here"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Long JAX JWT tokens are supported and saved from this WooCommerce channel.
        </p>
      </div>

      {/* Webhook token — only shown when editing */}
      {onRegenerateWebhook !== undefined && (
        <div className="space-y-2">
          <Label>Webhook Token</Label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={webhookToken ?? 'No token generated'}
              className="flex-1 min-w-0 font-mono text-xs bg-muted"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={regenerating}
              onClick={onRegenerateWebhook}
              className="gap-1 shrink-0"
            >
              <RefreshCw className={`size-4 ${regenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure this token in WooCommerce → Settings → Advanced → Webhooks.
          </p>
        </div>
      )}

      {onRegenerateWebhook === undefined && (
        <p className="text-xs text-muted-foreground">
          Get credentials from WooCommerce → Settings → Advanced → REST API
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Location fields block (POS channels) – defined at module level
// ─────────────────────────────────────────────────────────────────────────────

interface WebLocationFieldsProps {
  form: ChannelFormData;
  onChange: <K extends keyof ChannelFormData>(k: K, v: ChannelFormData[K]) => void;
  governorateOptions: { label: string; value: string }[];
}

function WebLocationFields({ form, onChange, governorateOptions }: WebLocationFieldsProps) {
  const handleGovernorateChange = (v: string) => {
    onChange('state', v);
    onChange('city', '');
  };

  return (
    <div className="space-y-4 rounded-lg border border-teal-200 bg-teal-50/40 dark:bg-teal-950/20 dark:border-teal-800/40 p-4">
      <p className="text-xs font-semibold text-teal-700 dark:text-teal-400 uppercase tracking-wide flex items-center gap-1.5">
        <MapPin className="size-3.5" /> POS Location
      </p>

      <div className="grid gap-3">
        <div className="space-y-2">
          <Label>Governorate</Label>
          <SearchSelect
            value={form.state}
            onChange={handleGovernorateChange}
            options={governorateOptions}
            placeholder="Search governorate"
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ─────────────────────────────────────────────────────────────────────────────

function ChannelTypeBadge({ type }: { type: ChannelType }) {
  const map: Record<ChannelType, { label: string; cls: string }> = {
    WOOCOMMERCE: { label: 'WooCommerce', cls: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300' },
    POS:         { label: 'POS',         cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' },
    WEB:         { label: 'Web',         cls: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300' },
  };
  const { label, cls } = map[type] ?? { label: type, cls: '' };
  return <Badge variant="outline" className={cls}>{label}</Badge>;
}

function ChannelIcon({ type, className = 'size-5' }: { type: ChannelType; className?: string }) {
  if (type === 'WOOCOMMERCE') return <Globe className={`${className} text-purple-500`} />;
  if (type === 'WEB')         return <Truck  className={`${className} text-teal-500`}   />;
  return                             <Store  className={`${className} text-blue-500`}   />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error extraction utility
// ─────────────────────────────────────────────────────────────────────────────

function extractErrorMessage(error: unknown): string {
  const fallback = 'An error occurred. Please try again.';
  if (!error || typeof error !== 'object') return fallback;
  const err = error as { response?: { data?: unknown }; message?: string };
  if (err.response?.data) {
    const data = err.response.data;
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const msgs = Object.entries(data as Record<string, unknown>).flatMap(([f, v]) => {
        const name = f.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        return Array.isArray(v) ? v.map(m => `${name}: ${m}`) : typeof v === 'string' ? [`${name}: ${v}`] : [];
      });
      if (msgs.length) return msgs.join('\n');
      const d = data as { detail?: string; message?: string };
      return d.detail ?? d.message ?? fallback;
    }
    if (typeof data === 'string') return data;
  }
  return err.message ?? fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket event shape
// ─────────────────────────────────────────────────────────────────────────────

interface WsEvent {
  event: 'created' | 'updated' | 'deleted';
  channel_id: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────────────────────────────────────

export default function SalesChannelsPage() {
  const queryClient = useQueryClient();
  const { data: channels = [], isLoading, error: queryError } = useSalesChannels();
  const { data: brands = [] } = useBrands();

  const createMutation   = useCreateSalesChannel();
  const updateMutation   = usePartialUpdateSalesChannel();
  const deleteMutation   = useDeleteSalesChannel();
  const regenerateMutation = useRegenerateWebhook();

  const localMutationRef = useRef(false);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useWebSocket({
    path: '/ws/sales-channels/',
    onMessage: (raw: unknown) => {
      const data = raw as WsEvent;
      queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
      if (localMutationRef.current) { localMutationRef.current = false; return; }
      const msgs: Record<WsEvent['event'], string> = {
        created: 'A new sales channel was added',
        updated: 'A sales channel was updated',
        deleted: 'A sales channel was removed',
      };
      if (data.event && msgs[data.event]) {
        toast.info(msgs[data.event], { description: 'Data refreshed automatically.', duration: 3000 });
      }
    },
  });

  // ── Filters ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [typeFilter,  setTypeFilter]  = useState('all');

  const filteredChannels = useMemo(() => {
    let list = channels;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(ch =>
        ch.name.toLowerCase().includes(q) ||
        ch.brand_name.toLowerCase().includes(q) ||
        ch.company_name.toLowerCase().includes(q) ||
        ch.state?.toLowerCase().includes(q)
      );
    }
    if (brandFilter !== 'all') list = list.filter(ch => ch.brand === Number(brandFilter));
    if (typeFilter  !== 'all') list = list.filter(ch => ch.channel_type === typeFilter);
    return list;
  }, [channels, searchQuery, brandFilter, typeFilter]);

  // ── Dialog & form state ────────────────────────────────────────────────────
  const [selectedChannel,  setSelectedChannel]  = useState<SalesChannel | null>(null);
  const [channelToDelete,  setChannelToDelete]  = useState<SalesChannel | null>(null);
  const [editForm,         setEditForm]         = useState<(ChannelFormData & { id: number }) | null>(null);
  const [addForm,          setAddForm]          = useState<ChannelFormData>(EMPTY_FORM);

  const [viewDialog,        setViewDialog]        = useState(false);
  const [editDialog,        setEditDialog]        = useState(false);
  const [addDialog,         setAddDialog]         = useState(false);
  const [deleteDialog,      setDeleteDialog]      = useState(false);
  const [credentialsDialog, setCredentialsDialog] = useState(false);

  const [newChannelCredentials, setNewChannelCredentials] = useState<SalesChannel | null>(null);
  const [copiedField,           setCopiedField]           = useState<string | null>(null);

  // ── Canonical Tunisian governorates ───────────────────────────────────────
  const governorateOptions = TUNISIA_GOVERNORATE_OPTIONS;

  // ── Utilities ──────────────────────────────────────────────────────────────
  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch { /* ignore */ }
  };

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => copyToClipboard(text, field)}>
      {copiedField === field ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );

  const maskSecret = (value: string) => (
    value.length > 28 ? `${value.slice(0, 16)}...${value.slice(-8)}` : value
  );

  const updateAdd  = <K extends keyof ChannelFormData>(k: K, v: ChannelFormData[K]) =>
    setAddForm(prev => ({ ...prev, [k]: v }));

  const updateEdit = <K extends keyof ChannelFormData>(k: K, v: ChannelFormData[K]) =>
    setEditForm(prev => prev ? { ...prev, [k]: v } : prev);

  // ── Validation & payload ───────────────────────────────────────────────────
  const validateForm = (f: ChannelFormData): string | null => {
    if (!f.name.trim()) return 'Channel name is required.';
    if (!f.brand)       return 'Please select a brand.';
    if (f.channel_type === 'WOOCOMMERCE') {
      if (!f.wc_store_url.trim())    return 'Store URL is required for WooCommerce channels.';
      if (!f.wc_consumer_key.trim()) return 'Consumer Key is required for WooCommerce channels.';
      if (!f.wc_consumer_secret.trim()) return 'Consumer Secret is required for WooCommerce channels.';
    }
    return null;
  };

  const buildPayload = (f: ChannelFormData): CreateSalesChannelRequest => ({
    name:         f.name.trim(),
    brand:        Number(f.brand),
    channel_type: f.channel_type,
    is_active:    f.is_active,
    city:         '',
    state:        f.state,
    ...(f.channel_type === 'WOOCOMMERCE' && {
      wc_store_url:     f.wc_store_url.trim(),
      wc_consumer_key:  f.wc_consumer_key.trim(),
      wc_consumer_secret: f.wc_consumer_secret.trim(),
      delivery_api_key: f.delivery_api_key.trim(),
    }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleView = useCallback((ch: SalesChannel) => { setSelectedChannel(ch); setViewDialog(true); }, []);

  const handleEdit = useCallback((ch: SalesChannel) => {
    setEditForm({
      id:                 ch.id,
      name:               ch.name,
      brand:              String(ch.brand),
      channel_type:       ch.channel_type,
      is_active:          ch.is_active,
      state:              ch.state ?? '',
      city:               '',
      wc_store_url:       ch.wc_store_url ?? '',
      wc_consumer_key:    ch.wc_consumer_key ?? '',
      wc_consumer_secret: ch.wc_consumer_secret ?? '',
      delivery_api_key:   ch.delivery_api_key ?? '',
    });
    setEditDialog(true);
  }, []);

  const handleAddChannel = () => {
    const err = validateForm(addForm);
    if (err) { toast.error(err); return; }

    localMutationRef.current = true;
    createMutation.mutate(buildPayload(addForm), {
      onSuccess: created => {
        setAddDialog(false);
        setAddForm(EMPTY_FORM);
        if (addForm.channel_type === 'WOOCOMMERCE' && created.wc_webhook_token) {
          setNewChannelCredentials(created);
          setCredentialsDialog(true);
        } else {
          toast.success('Sales channel created successfully!');
        }
      },
      onError: err => { localMutationRef.current = false; toast.error(extractErrorMessage(err)); },
    });
  };

  const handleSaveEdit = () => {
    if (!editForm) return;
    const err = validateForm(editForm);
    if (err) { toast.error(err); return; }

    localMutationRef.current = true;
    updateMutation.mutate(
      { id: editForm.id, data: buildPayload(editForm) },
      {
        onSuccess: () => { setEditDialog(false); toast.success('Sales channel updated successfully!'); },
        onError: err => { localMutationRef.current = false; toast.error(extractErrorMessage(err)); },
      },
    );
  };

  const handleDelete = useCallback((ch: SalesChannel) => { setChannelToDelete(ch); setDeleteDialog(true); }, []);

  const confirmDelete = () => {
    if (!channelToDelete) return;
    localMutationRef.current = true;
    deleteMutation.mutate(channelToDelete.id, {
      onSuccess: () => { setDeleteDialog(false); toast.success('Sales channel deleted successfully!'); },
      onError: err => { localMutationRef.current = false; toast.error(extractErrorMessage(err)); },
    });
  };

  const handleRegenerateWebhook = useCallback((ch: SalesChannel) => {
    localMutationRef.current = true;
    regenerateMutation.mutate(ch.id, {
      onSuccess: () => toast.success('Webhook token regenerated successfully!'),
      onError: err => toast.error(extractErrorMessage(err)),
    });
  }, [regenerateMutation]);

  const handleRegenerateFromEdit = () => {
    if (!editForm) return;
    localMutationRef.current = true;
    regenerateMutation.mutate(editForm.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() });
        toast.success('Webhook token regenerated!');
      },
      onError: err => toast.error(extractErrorMessage(err)),
    });
  };

  const handleToggleStatus = (ch: SalesChannel) => {
    localMutationRef.current = true;
    updateMutation.mutate(
      { id: ch.id, data: { is_active: !ch.is_active } },
      {
        onSuccess: () => toast.success(`Channel ${ch.is_active ? 'deactivated' : 'activated'} successfully!`),
        onError: err => toast.error(extractErrorMessage(err)),
      },
    );
  };

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading sales channels…</p>
        </div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center">
          <p className="text-red-500 mb-4">Failed to load sales channels. Please try again.</p>
          <Button onClick={() => queryClient.invalidateQueries({ queryKey: salesChannelsKeys.lists() })}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  // ── The live webhook token for the channel being edited ────────────────────
  const editChannelLiveToken = editForm
    ? channels.find(c => c.id === editForm.id)?.wc_webhook_token
    : undefined;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sales Channels</h1>
            <p className="text-muted-foreground mt-1">Manage WooCommerce, POS and Web sales channels</p>
          </div>
          <Button onClick={() => { setAddForm(EMPTY_FORM); setAddDialog(true); }} className="gap-2">
            <Plus className="size-4" /> Add Channel
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, brand, or governorate..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {brands.length > 0 && (
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="w-full md:w-[200px]">
                  <Tag className="size-4 mr-2" /><SelectValue placeholder="Filter by brand" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <Filter className="size-4 mr-2" /><SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="WOOCOMMERCE">WooCommerce</SelectItem>
                <SelectItem value="POS">POS</SelectItem>
                <SelectItem value="WEB">Web</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Showing {filteredChannels.length} of {channels.length} channels
          </p>
        </Card>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredChannels.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No sales channels found
                </TableCell>
              </TableRow>
            ) : (
              filteredChannels.map(ch => (
                <TableRow
                  key={ch.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleView(ch)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg bg-muted flex items-center justify-center border">
                        <ChannelIcon type={ch.channel_type} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{ch.name}</p>
                        <p className="text-xs text-muted-foreground">{ch.company_name}</p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Tag className="size-3.5 shrink-0" /> {ch.brand_name}
                    </div>
                  </TableCell>

                  <TableCell><ChannelTypeBadge type={ch.channel_type} /></TableCell>

                  <TableCell>
                    {ch.state ? (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" />
                        <span className="truncate max-w-[150px]">
                          {ch.state}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge variant={ch.is_active ? 'default' : 'destructive'}>
                      {ch.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Calendar className="size-3.5" />
                      {new Date(ch.created_at).toLocaleDateString()}
                    </div>
                  </TableCell>

                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreVertical className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleView(ch)}><Eye className="size-4 mr-2" />View Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(ch)}><Pencil className="size-4 mr-2" />Edit Channel</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleStatus(ch)}><Power className="size-4 mr-2" />{ch.is_active ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                        {ch.channel_type === 'WOOCOMMERCE' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleRegenerateWebhook(ch)} disabled={regenerateMutation.isPending}>
                              <Key className="size-4 mr-2" />Regenerate Webhook Token
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDelete(ch)} className="text-red-600 dark:text-red-400">
                          <Trash2 className="size-4 mr-2" />Delete Channel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* ── View Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={viewDialog} onOpenChange={setViewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Channel Details</DialogTitle>
            <DialogDescription>Complete information about this sales channel</DialogDescription>
          </DialogHeader>

          {selectedChannel && (
            <div className="space-y-5">
              {/* Header row */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <div className="size-16 rounded-xl bg-muted flex items-center justify-center border-2">
                  <ChannelIcon type={selectedChannel.channel_type} className="size-8" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold">{selectedChannel.name}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <ChannelTypeBadge type={selectedChannel.channel_type} />
                    <Badge variant={selectedChannel.is_active ? 'default' : 'destructive'}>
                      {selectedChannel.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Core info */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Tag,       label: 'Brand',   val: selectedChannel.brand_name },
                  { icon: Building2, label: 'Company', val: selectedChannel.company_name },
                  { icon: Calendar,  label: 'Created', val: new Date(selectedChannel.created_at).toLocaleString() },
                  { icon: Calendar,  label: 'Updated', val: new Date(selectedChannel.updated_at).toLocaleString() },
                ].map(({ icon: Icon, label, val }) => (
                  <div key={label} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    <div className="flex items-center gap-2 p-2.5 bg-muted/40 rounded-lg text-sm">
                      <Icon className="size-4 text-primary shrink-0" /> {val}
                    </div>
                  </div>
                ))}
              </div>

              {/* Location */}
              {selectedChannel.state && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <MapPin className="size-3.5" />
                    {selectedChannel.channel_type === 'POS' ? 'POS Location' : 'Location'}
                  </p>
                  <div className="grid gap-3">
                    {selectedChannel.state && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Governorate</p>
                        <div className="p-2.5 bg-muted/40 rounded-lg text-sm font-medium">{selectedChannel.state}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* WooCommerce config */}
              {selectedChannel.channel_type === 'WOOCOMMERCE' && (
                <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/40 dark:bg-purple-950/20 dark:border-purple-800/40 p-4">
                  <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide flex items-center gap-1.5">
                    <Globe className="size-3.5" /> WooCommerce Configuration
                  </p>

                  {[
                    { key: 'url',     label: 'Store URL',        val: selectedChannel.wc_store_url },
                    { key: 'ck',      label: 'Consumer Key',     val: selectedChannel.wc_consumer_key },
                    { key: 'cs',      label: 'Consumer Secret',  val: selectedChannel.wc_consumer_secret },
                    { key: 'wh',      label: 'Webhook Token',    val: selectedChannel.wc_webhook_token },
                    { key: 'del-key', label: 'Delivery API Key', val: selectedChannel.delivery_api_key },
                  ].filter(f => f.val).map(f => (
                    <div key={f.key} className="space-y-1">
                      <p className="text-xs text-muted-foreground">{f.label}</p>
                      <div className="flex items-center gap-2 p-2.5 bg-background/60 rounded-lg border">
                        <span className="text-sm font-mono flex-1 truncate">
                          {f.key === 'del-key' ? maskSecret(f.val) : f.val}
                        </span>
                        <CopyButton text={f.val} field={f.key} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-2 border-t">
                <Button onClick={() => { setViewDialog(false); handleEdit(selectedChannel); }} className="flex-1 gap-2">
                  <Pencil className="size-4" /> Edit Channel
                </Button>
                {selectedChannel.channel_type === 'WOOCOMMERCE' && (
                  <Button
                    variant="outline"
                    onClick={() => handleRegenerateWebhook(selectedChannel)}
                    className="gap-2"
                    disabled={regenerateMutation.isPending}
                  >
                    <RefreshCw className={`size-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                    Regenerate Webhook
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ───────────────────────────────────────────────────────── */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Edit Sales Channel</DialogTitle>
            <DialogDescription>Update channel information</DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 min-w-0">
                  <Label>Channel Name *</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input value={editForm.name} onChange={e => updateEdit('name', e.target.value)} className="pl-10" placeholder="Channel name" />
                  </div>
                </div>

                {brands.length > 0 && (
                  <div className="space-y-2 min-w-0">
                    <Label>Brand *</Label>
                    <Select value={editForm.brand} onValueChange={v => updateEdit('brand', v)}>
                      <SelectTrigger><SelectValue placeholder="Select a brand" /></SelectTrigger>
                      <SelectContent>{brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editForm.is_active ? 'active' : 'inactive'} onValueChange={v => updateEdit('is_active', v === 'active')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editForm.channel_type === 'WOOCOMMERCE' && (
                <WooFields
                  form={editForm}
                  onChange={updateEdit}
                  webhookToken={editChannelLiveToken}
                  onRegenerateWebhook={handleRegenerateFromEdit}
                  regenerating={regenerateMutation.isPending}
                />
              )}

              {editForm.channel_type === 'POS' && (
                <WebLocationFields
                  form={editForm}
                  onChange={updateEdit}
                  governorateOptions={governorateOptions}
                />
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} className="flex-1 gap-2">
                  <Pencil className="size-4" />
                  {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => setEditDialog(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add Dialog ────────────────────────────────────────────────────────── */}
      <Dialog open={addDialog} onOpenChange={open => { setAddDialog(open); if (!open) setAddForm(EMPTY_FORM); }}>
        <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Add New Sales Channel</DialogTitle>
            <DialogDescription>Create a WooCommerce, POS, or Web channel</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 min-w-0">
                <Label>Channel Name *</Label>
                <div className="relative">
                  <Store className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input value={addForm.name} onChange={e => updateAdd('name', e.target.value)} className="pl-10" placeholder="Enter channel name" />
                </div>
              </div>

              {brands.length > 0 && (
                <div className="space-y-2 min-w-0">
                  <Label>Brand *</Label>
                  <Select value={addForm.brand} onValueChange={v => updateAdd('brand', v)}>
                    <SelectTrigger><SelectValue placeholder="Select a brand" /></SelectTrigger>
                    <SelectContent>{brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Channel Type *</Label>
              <Select
                value={addForm.channel_type}
                onValueChange={v => setAddForm({ ...EMPTY_FORM, name: addForm.name, brand: addForm.brand, channel_type: v as ChannelType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WOOCOMMERCE">
                    <div className="flex items-center gap-2"><Globe className="size-4 text-purple-500" />WooCommerce</div>
                  </SelectItem>
                  <SelectItem value="POS">
                    <div className="flex items-center gap-2"><Store className="size-4 text-blue-500" />POS</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addForm.channel_type === 'WOOCOMMERCE' && (
              <WooFields form={addForm} onChange={updateAdd} />
            )}

            {addForm.channel_type === 'POS' && (
              <WebLocationFields
                form={addForm}
                onChange={updateAdd}
                governorateOptions={governorateOptions}
              />
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
              <Button onClick={handleAddChannel} disabled={createMutation.isPending} className="flex-1 gap-2">
                <Plus className="size-4" />
                {createMutation.isPending ? 'Creating…' : 'Create Channel'}
              </Button>
              <Button variant="outline" onClick={() => { setAddDialog(false); setAddForm(EMPTY_FORM); }} className="flex-1">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Credentials Dialog ───────────────────────────────────────────────── */}
      <Dialog open={credentialsDialog} onOpenChange={open => { setCredentialsDialog(open); if (!open) setNewChannelCredentials(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Key className="size-5" /> Channel Created Successfully
            </DialogTitle>
            <DialogDescription>Save the webhook token below — it will not be shown again after you close this dialog.</DialogDescription>
          </DialogHeader>

          {newChannelCredentials?.wc_webhook_token && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Configure this token in WooCommerce → Settings → Advanced → Webhooks.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Webhook Token</p>
                <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border">
                  <span className="text-sm font-mono flex-1 break-all">{newChannelCredentials.wc_webhook_token}</span>
                  <CopyButton text={newChannelCredentials.wc_webhook_token} field="wh-new" />
                </div>
              </div>
            </div>
          )}

          <Button onClick={() => { setCredentialsDialog(false); setNewChannelCredentials(null); }} className="w-full mt-2">
            Done
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ───────────────────────────────────────────────── */}
      <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sales Channel?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{channelToDelete?.name}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
