/**
 * ClientsPage - Customer management with phone-safe identity, governorate-first
 * location data, computed points, and linked order history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Eye,
  FileText,
  Hash,
  Loader2,
  Mail,
  MapPin,
  MessageCircleMore,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ResponsiveSheet } from '@/components/dialogs/ResponsiveSheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  useBrands, useClients, useCreateClient, useUpdateClient,
  useDeleteClient, useBlockClient,
} from '@/hooks/queries';
import { clientService } from '@/services/client.service';
import { TUNISIA_GOVERNORATES } from '@/constants/tunisia';
import type { Client, CreateClientRequest, OrderDetail, OrderListItem } from '@/types';

const SOURCE_BADGE: Record<string, string> = {
  WOOCOMMERCE: 'bg-indigo-100 text-indigo-800 border-transparent',
  POS: 'bg-teal-100 text-teal-800 border-transparent',
  MANUAL: 'bg-slate-100 text-slate-700 border-transparent',
};

const fmtDate = (date?: string | null) =>
  date ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const fmtMoney = (value?: string | number | null) =>
  Number(value ?? 0).toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function SourceBadge({ source }: { source: string }) {
  return <Badge variant="outline" className={`text-xs ${SOURCE_BADGE[source] ?? ''}`}>{source}</Badge>;
}

function ClientTypeBadge({ type }: { type?: Client['client_type'] }) {
  return (
    <Badge variant="outline" className="text-xs gap-1">
      {type === 'COMPANY' ? <Building2 className="size-3" /> : <Users className="size-3" />}
      {type === 'COMPANY' ? 'Company' : 'Person'}
    </Badge>
  );
}

function StatusBadge({ blocked }: { blocked: boolean }) {
  return blocked
    ? <Badge variant="destructive" className="text-xs gap-1"><ShieldAlert className="size-3" /> Blocked</Badge>
    : <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-800 border-transparent">Active</Badge>;
}

function Field({ label, value, icon, children }: {
  label: string;
  value?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground text-xs flex items-center gap-1">{icon}{label}</span>
      {children ?? <p className="font-medium text-sm mt-0.5 break-words">{value ?? '-'}</p>}
    </div>
  );
}

interface ClientDetailDialogProps {
  client: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (client: Client) => void;
  onBlock: (id: number, blocked: boolean) => void;
  onDelete: (client: Client) => void;
  blockLoading?: boolean;
}

function ClientDetailDialog({
  client,
  open,
  onOpenChange,
  onEdit,
  onBlock,
  onDelete,
  blockLoading,
}: ClientDetailDialogProps) {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);

  useEffect(() => {
    if (!open || !client) return;
    setOrdersLoading(true);
    setSelectedOrder(null);
    clientService.getOrders(client.id)
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false));
  }, [client, open]);

  if (!client) return null;

  const phone = client.phone;
  const cleanPhone = phone?.replace(/[^0-9+]/g, '') ?? '';

  const openOrder = async (order: OrderListItem) => {
    setOrderLoading(true);
    try {
      const detail = await clientService.getOrderDetail(client.id, order.id);
      setSelectedOrder(detail);
    } finally {
      setOrderLoading(false);
    }
  };

  const footer = (
    <div className="grid w-full gap-2 sm:flex sm:justify-end">
      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => onEdit(client)}>
        <Pencil className="size-3" /> Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={`gap-1.5 h-8 text-xs ${client.is_blocked ? 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' : 'text-amber-700 border-amber-200 hover:bg-amber-50'}`}
        onClick={() => onBlock(client.id, !client.is_blocked)}
        disabled={blockLoading}
      >
        {blockLoading ? <Loader2 className="size-3 animate-spin" /> : client.is_blocked ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
        {client.is_blocked ? 'Unblock' : 'Block'}
      </Button>
      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => onDelete(client)}>
        <Trash2 className="size-3" /> Delete
      </Button>
    </div>
  );

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={client.full_name || client.email}
      description="Customer profile, return risk, points, and linked order history."
      wide={true}
      footer={footer}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientTypeBadge type={client.client_type} />
            <StatusBadge blocked={client.is_blocked} />
          </div>
        </div>

        {client.is_blocked && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            This client is blocked because they reached {client.number_of_returns} returned orders.
          </div>
        )}

        {phone && (
          <div className="flex gap-2 flex-col sm:flex-row">
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8 text-xs" onClick={() => window.open(`tel:${cleanPhone}`, '_self')}>
              <Phone className="size-3" /> Call {phone}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 h-8 text-xs text-green-700 border-green-200 hover:bg-green-50" onClick={() => window.open(`https://wa.me/${cleanPhone}`, '_blank')}>
              <MessageCircleMore className="size-3" /> WhatsApp
            </Button>
          </div>
        )}

        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Client Data</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3 text-sm">
              <Field icon={<Mail className="size-3.5" />} label="Email" value={client.email} />
              <Field icon={<Phone className="size-3.5" />} label="Phone" value={phone || '-'} />
              <Field icon={<Hash className="size-3.5" />} label="Normalized Phone" value={client.phone_normalized || '-'} />
              <Field icon={<Calendar className="size-3.5" />} label="Date of Birth" value={fmtDate(client.date_of_birth)} />
              <Field icon={<Store className="size-3.5" />} label="Brand" value={client.brand_name ?? '-'} />
              <Field label="Channel" value={client.sales_channel_name ?? '-'} />
              <Field icon={<MapPin className="size-3.5" />} label="Governorate" value={client.governorate || client.state || '-'} />
              <Field label="Country" value={client.country || '-'} />
              <Field label="Source"><SourceBadge source={client.source} /></Field>
              <Field label="WC ID" value={client.wc_customer_id != null ? String(client.wc_customer_id) : '-'} />
              <Field label="Points" value={`${fmtMoney(client.points)} pts`} />
              <Field label="Orders" value={client.number_of_orders} />
              <Field label="Returns" value={client.number_of_returns} />
              <Field label="Created" value={fmtDate(client.created_at)} />
              <div className="col-span-1 sm:col-span-2"><Field label="Address" value={client.address || '-'} /></div>
              <div className="col-span-1 sm:col-span-2"><Field icon={<FileText className="size-3.5" />} label="Notes" value={client.notes || '-'} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShoppingBag className="size-4" /> Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Code</TableHead>
                      <TableHead className="h-9 text-xs hidden sm:table-cell">Source</TableHead>
                      <TableHead className="h-9 text-xs">Status</TableHead>
                      <TableHead className="h-9 text-xs text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersLoading && (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground"><Loader2 className="size-4 animate-spin inline mr-2" />Loading orders...</TableCell></TableRow>
                    )}
                    {!ordersLoading && orders.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No orders found.</TableCell></TableRow>
                    )}
                    {!ordersLoading && orders.map(order => (
                      <TableRow key={order.id} className="cursor-pointer hover:bg-muted/40" onClick={() => void openOrder(order)}>
                        <TableCell className="font-mono text-xs">{order.ticket_id || order.order_number || order.external_order_id}</TableCell>
                        <TableCell className="hidden sm:table-cell"><SourceBadge source={order.source} /></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{order.return_exchange_status !== 'NONE' ? order.return_exchange_status : order.status}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(order.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {orderLoading && <p className="text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin inline mr-1" />Opening order...</p>}
              {selectedOrder && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{selectedOrder.ticket_id || selectedOrder.order_number}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(selectedOrder.created_at)} · {selectedOrder.payment_method || '-'}</p>
                    </div>
                    <Badge variant="outline">{fmtMoney(selectedOrder.total)} TND</Badge>
                  </div>
                  <div className="space-y-1">
                    {selectedOrder.lines.map(line => (
                      <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs">
                        <span className="break-words">{line.product_name}</span>
                        <span className="tabular-nums">x{line.quantity}</span>
                        <span className="font-medium tabular-nums">{fmtMoney(line.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  brands: { id: number; name: string }[];
  onSave: (data: Partial<CreateClientRequest>, id?: number) => Promise<void>;
  saving: boolean;
}

function ClientEditDialog({ open, onOpenChange, client, brands, onSave, saving }: EditDialogProps) {
  const isEdit = !!client;
  const [form, setForm] = useState<Partial<CreateClientRequest>>({});
  const [error, setError] = useState('');

  const handleOpen = useCallback((value: boolean) => {
    if (value && client) {
      setForm({
        email: client.email,
        first_name: client.first_name ?? '',
        last_name: client.last_name ?? '',
        phone: client.phone ?? '',
        client_type: client.client_type ?? 'PERSON',
        date_of_birth: client.date_of_birth,
        address: client.address ?? '',
        state: client.governorate || client.state || '',
        postcode: client.postcode ?? '',
        country: client.country ?? 'TN',
        brand: client.brand,
        notes: client.notes ?? '',
      });
    } else if (value) {
      setForm({ client_type: 'PERSON', country: 'TN' });
    }
    setError('');
    onOpenChange(value);
  }, [client, onOpenChange]);

  const set = (field: keyof CreateClientRequest, value: string | number | null) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.email?.trim()) {
      setError('Email is required.');
      return;
    }
    try {
      setError('');
      await onSave({ ...form, country: form.country || 'TN' }, client?.id);
      handleOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save client.';
      setError(msg.includes('phone') ? 'This phone number is already registered.' : msg);
    }
  };

  const footer = (
    <div className="grid w-full gap-2 sm:flex sm:justify-end">
      <Button variant="outline" onClick={() => handleOpen(false)} disabled={saving}>Cancel</Button>
      <Button onClick={handleSubmit} disabled={saving || !form.email?.trim()} className="gap-1.5">
        {saving ? <><Loader2 className="size-4 animate-spin" /> Saving...</> : isEdit ? 'Save Changes' : 'Add Client'}
      </Button>
    </div>
  );

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={handleOpen}
      title={isEdit ? 'Edit Client' : 'Add Client'}
      description="Phones are matched safely, so +21624512995 and 24512995 point to the same client."
      footer={footer}
    >
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium">Client Type</Label>
            <Select value={form.client_type ?? 'PERSON'} onValueChange={value => set('client_type', value as Client['client_type'])}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSON">Person</SelectItem>
                <SelectItem value="COMPANY">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Email *</Label>
            <Input value={form.email ?? ''} onChange={e => set('email', e.target.value)} placeholder="client@example.com" className="h-9 mt-1" type="email" />
          </div>
          <div>
            <Label className="text-xs font-medium">First Name</Label>
            <Input value={form.first_name ?? ''} onChange={e => set('first_name', e.target.value)} placeholder="First name" className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium">Last Name / Company Name</Label>
            <Input value={form.last_name ?? ''} onChange={e => set('last_name', e.target.value)} placeholder="Last name or company" className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium">Phone</Label>
            <Input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="+216 XX XXX XXX" className="h-9 mt-1" type="tel" />
          </div>
          <div>
            <Label className="text-xs font-medium">Date of Birth</Label>
            <Input value={form.date_of_birth ?? ''} onChange={e => set('date_of_birth', e.target.value || null)} className="h-9 mt-1" type="date" />
          </div>
          <div>
            <Label className="text-xs font-medium">Governorate</Label>
            <Select value={form.state ?? ''} onValueChange={value => set('state', value)}>
              <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Select governorate" /></SelectTrigger>
              <SelectContent>
                {TUNISIA_GOVERNORATES.map(gov => <SelectItem key={gov} value={gov}>{gov}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Postcode</Label>
            <Input value={form.postcode ?? ''} onChange={e => set('postcode', e.target.value)} placeholder="Postcode" className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium">Brand</Label>
            <Select value={form.brand != null ? String(form.brand) : ''} onValueChange={value => set('brand', value ? Number(value) : null)}>
              <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Select brand" /></SelectTrigger>
              <SelectContent>
                {brands.map(brand => <SelectItem key={brand.id} value={String(brand.id)}>{brand.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium">Country</Label>
            <Input value={form.country ?? 'TN'} onChange={e => set('country', e.target.value)} placeholder="TN" className="h-9 mt-1" />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label className="text-xs font-medium">Address</Label>
            <Input value={form.address ?? ''} onChange={e => set('address', e.target.value)} placeholder="Full address" className="h-9 mt-1" />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label className="text-xs font-medium">Notes</Label>
            <Textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." className="min-h-16 text-sm resize-none mt-1" />
          </div>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

export default function ClientsPage() {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [blockedFilter, setBlockedFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [governorateFilter, setGovernorateFilter] = useState('all');
  const [viewClient, setViewClient] = useState<Client | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const { data: brands = [] } = useBrands();
  const { data: clientsResponse, isLoading, error, refetch } = useClients({ page_size: 500 });
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();
  const blockMutation = useBlockClient();

  const clients = useMemo(() => {
    if (!clientsResponse) return [];
    return Array.isArray(clientsResponse) ? clientsResponse : (clientsResponse.results ?? []);
  }, [clientsResponse]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(client => {
      const governorate = (client.governorate || client.state || '').toLowerCase();
      const matchesSearch = !q
        || client.email.toLowerCase().includes(q)
        || client.full_name.toLowerCase().includes(q)
        || (client.phone ?? '').toLowerCase().includes(q)
        || (client.phone_normalized ?? '').includes(q.replace(/\D/g, ''))
        || governorate.includes(q);

      return matchesSearch
        && (sourceFilter === 'all' || client.source === sourceFilter)
        && (blockedFilter === 'all' || (blockedFilter === 'blocked' ? client.is_blocked : !client.is_blocked))
        && (brandFilter === 'all' || String(client.brand) === brandFilter)
        && (typeFilter === 'all' || client.client_type === typeFilter)
        && (governorateFilter === 'all' || client.governorate === governorateFilter || client.state === governorateFilter);
    });
  }, [clients, search, sourceFilter, blockedFilter, brandFilter, typeFilter, governorateFilter]);

  const stats = useMemo(() => ({
    total: clients.length,
    wc: clients.filter(c => c.source === 'WOOCOMMERCE').length,
    pos: clients.filter(c => c.source === 'POS').length,
    blocked: clients.filter(c => c.is_blocked).length,
    points: clients.reduce((sum, client) => sum + Number(client.points || 0), 0),
  }), [clients]);

  const handleOpenEdit = (client: Client | null) => {
    setEditingClient(client);
    setEditDialogOpen(true);
    if (client) setViewClient(null);
  };

  const handleSave = async (data: Partial<CreateClientRequest>, id?: number) => {
    if (id) await updateMutation.mutateAsync({ id, payload: data });
    else await createMutation.mutateAsync(data as CreateClientRequest);
    void refetch();
  };

  const handleBlock = async (id: number, blocked: boolean) => {
    const updated = await blockMutation.mutateAsync({ id, is_blocked: blocked });
    if (viewClient?.id === id) setViewClient(prev => prev ? { ...prev, ...updated } : null);
    void refetch();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
    setViewClient(null);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
            <Users className="size-6" /> Clients
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Phone-safe customer management with points, returns, and order history.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Button size="sm" onClick={() => handleOpenEdit(null)} className="gap-1.5"><Plus className="size-4" /> Add Client</Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`size-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-red-900 mb-1">Failed to Load Clients</h3>
              <p className="text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</p>
            </div>
            <Button size="sm" onClick={() => refetch()} disabled={isLoading}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="WooCommerce" value={stats.wc} className="text-indigo-600" />
        <KpiCard label="POS" value={stats.pos} className="text-teal-600" />
        <KpiCard label="Blocked" value={stats.blocked} className="text-red-600" />
        <KpiCard label="Points" value={fmtMoney(stats.points)} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="relative sm:col-span-2 xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Search by name, phone, email, governorate..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="WOOCOMMERCE">WooCommerce</SelectItem>
                <SelectItem value="POS">POS</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="PERSON">Person</SelectItem>
                <SelectItem value="COMPANY">Company</SelectItem>
              </SelectContent>
            </Select>
            <Select value={blockedFilter} onValueChange={setBlockedFilter}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
            <Select value={governorateFilter} onValueChange={setGovernorateFilter}>
              <SelectTrigger><SelectValue placeholder="Governorate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Governorates</SelectItem>
                {TUNISIA_GOVERNORATES.map(gov => <SelectItem key={gov} value={gov}>{gov}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{isLoading ? 'Loading...' : `${filtered.length} client${filtered.length !== 1 ? 's' : ''}`}</p>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="h-8 w-full sm:w-48"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {brands.map(brand => <SelectItem key={brand.id} value={String(brand.id)}>{brand.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {isLoading && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Loading clients...</CardContent></Card>
        )}
        {!isLoading && filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No clients found.</CardContent></Card>
        )}
        {!isLoading && filtered.map(client => (
          <Card
            key={client.id}
            className={`cursor-pointer transition-colors active:bg-muted/50 ${client.is_blocked ? 'border-red-200 bg-red-50/60' : ''}`}
            onClick={() => setViewClient(client)}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-semibold">{client.full_name || client.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{client.email}</p>
                  <p className="font-mono text-xs text-muted-foreground">{client.phone || '-'}</p>
                </div>
                <StatusBadge blocked={client.is_blocked} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ClientTypeBadge type={client.client_type} />
                <SourceBadge source={client.source} />
                <Badge variant="outline" className="text-xs">{client.governorate || client.state || 'No governorate'}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/30 p-2 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Points</p>
                  <p className="text-xs font-semibold tabular-nums">{fmtMoney(client.points)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Orders</p>
                  <p className="text-xs font-semibold tabular-nums">{client.number_of_orders}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Returns</p>
                  <p className="text-xs font-semibold tabular-nums">{client.number_of_returns}</p>
                </div>
              </div>
              <div className="flex justify-end gap-1" onClick={event => event.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setViewClient(client)}><Eye className="mr-1 size-3.5" />View</Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => handleOpenEdit(client)}><Pencil className="mr-1 size-3.5" />Edit</Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-red-600" onClick={() => setDeleteTarget(client)}><Trash2 className="mr-1 size-3.5" />Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="h-10 text-xs font-semibold">Client</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden md:table-cell">Phone</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden md:table-cell">Orders</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Governorate</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Brand</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden lg:table-cell">Points</TableHead>
                <TableHead className="h-10 text-xs font-semibold hidden md:table-cell">Source</TableHead>
                <TableHead className="h-10 text-xs font-semibold">Status</TableHead>
                <TableHead className="h-10 text-xs font-semibold text-center hidden md:table-cell">Returns</TableHead>
                <TableHead className="h-10 text-xs font-semibold w-24 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={10} className="py-16 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin inline mr-2" />Loading clients...</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">No clients found.</TableCell></TableRow>
              )}
              {!isLoading && filtered.map(client => (
                <TableRow key={client.id} className={`group hover:bg-muted/30 cursor-pointer transition-colors ${client.is_blocked ? 'bg-red-50/50' : ''}`} onClick={() => setViewClient(client)}>
                  <TableCell className="min-w-[180px]">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm break-words">{client.full_name || client.email}</span>
                      <span className="text-xs text-muted-foreground truncate">{client.email}</span>
                      <ClientTypeBadge type={client.client_type} />
                    </div>
                  </TableCell>
                  <TableCell className="text-xs hidden md:table-cell font-mono">{client.phone || '-'}</TableCell>
                  <TableCell className="text-xs text-center hidden md:table-cell">{client.number_of_orders}</TableCell>
                  <TableCell className="text-xs hidden lg:table-cell">{client.governorate || client.state || '-'}</TableCell>
                  <TableCell className="text-xs hidden lg:table-cell">{client.brand_name ?? '-'}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums hidden lg:table-cell">{fmtMoney(client.points)}</TableCell>
                  <TableCell className="hidden md:table-cell"><SourceBadge source={client.source} /></TableCell>
                  <TableCell><StatusBadge blocked={client.is_blocked} /></TableCell>
                  <TableCell className="text-center hidden md:table-cell">
                    <Badge variant={client.number_of_returns >= 5 ? 'destructive' : 'outline'}>{client.number_of_returns}</Badge>
                  </TableCell>
                  <TableCell className="text-center" onClick={event => event.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => setViewClient(client)}><Eye className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => handleOpenEdit(client)}><Pencil className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => setDeleteTarget(client)}><Trash2 className="size-3.5 text-red-500" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <ClientDetailDialog
        client={viewClient}
        open={!!viewClient}
        onOpenChange={() => setViewClient(null)}
        onEdit={handleOpenEdit}
        onBlock={handleBlock}
        onDelete={client => {
          setViewClient(null);
          setDeleteTarget(client);
        }}
        blockLoading={blockMutation.isPending}
      />

      <ClientEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        client={editingClient}
        brands={brands}
        onSave={handleSave}
        saving={saving}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-1"><CardTitle className={`text-xs text-muted-foreground ${className}`}>{label}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0"><p className={`text-2xl font-bold tabular-nums ${className}`}>{value}</p></CardContent>
    </Card>
  );
}
