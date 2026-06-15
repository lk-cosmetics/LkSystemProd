/**
 * Order assignment UI — reused by the Orders page (managers) and elsewhere.
 *
 *   • EmployeeAvatar               — initials bubble.
 *   • AssignmentBadge              — compact "assigned to …" chip (table/cards).
 *   • AssignEmployeeDialog         — pick / change / clear an order's employee.
 *   • AutoAssignmentSettingsDialog — toggle which employees are in the
 *                                    auto-assignment pool.
 *
 * All dialogs use ResponsiveSheet → full Dialog on desktop, bottom Drawer on
 * phones, so a manager can assign from any device.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Search, UserCheck, UserPlus, UserX, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResponsiveSheet } from '@/components/dialogs/ResponsiveSheet';
import { orderService } from '@/services/order.service';
import type { AssignableEmployee, OrderDetail, OrderListItem } from '@/types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function EmployeeAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${className ?? 'size-7 text-[11px]'}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Compact assignee chip for table cells / mobile cards. Clickable for managers. */
export function AssignmentBadge({
  order, canAssign, onClick,
}: {
  order: Pick<OrderListItem, 'assigned_agent' | 'assigned_agent_name' | 'assignment_type'>;
  canAssign?: boolean;
  onClick?: () => void;
}) {
  const interactive = !!(canAssign && onClick);
  const common = 'inline-flex items-center gap-1.5 rounded-full text-xs transition';

  if (!order.assigned_agent) {
    return (
      <button
        type="button"
        disabled={!interactive}
        onClick={interactive ? onClick : undefined}
        className={`${common} border border-dashed px-2 py-1 text-muted-foreground ${interactive ? 'cursor-pointer hover:border-primary/50 hover:text-foreground' : 'cursor-default'}`}
      >
        <UserPlus className="size-3.5" />
        {interactive ? 'Assign' : 'Unassigned'}
      </button>
    );
  }

  const name = order.assigned_agent_name?.trim() || `#${order.assigned_agent}`;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? onClick : undefined}
      title={order.assignment_type === 'auto' ? 'Auto-assigned' : 'Manually assigned'}
      className={`${common} border bg-card px-1.5 py-0.5 ${interactive ? 'cursor-pointer hover:border-primary/50' : 'cursor-default'}`}
    >
      <EmployeeAvatar name={name} className="size-5 text-[9px]" />
      <span className="max-w-[8rem] truncate font-medium">{name}</span>
      {order.assignment_type === 'auto' && <Wand2 className="size-3 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function EmployeeSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search employees…"
        className="h-10 pl-9"
      />
    </div>
  );
}

function useEmployeeFilter(employees: AssignableEmployee[], search: string) {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      e =>
        e.name.toLowerCase().includes(q) ||
        e.matricule.toLowerCase().includes(q) ||
        (e.email ?? '').toLowerCase().includes(q),
    );
  }, [employees, search]);
}

/** Pick / change / clear the employee responsible for an order. */
export function AssignEmployeeDialog({
  open, onOpenChange, order, employees, loadingEmployees, onAssigned,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  order: OrderListItem | null;
  employees: AssignableEmployee[];
  loadingEmployees?: boolean;
  onAssigned: (updated: OrderDetail) => void;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<number | 'clear' | null>(null);

  useEffect(() => {
    if (open) setSearch('');
  }, [open, order?.id]);

  const filtered = useEmployeeFilter(employees, search);

  async function doAssign(employeeId: number | null) {
    if (!order) return;
    try {
      setSaving(employeeId ?? 'clear');
      const updated = await orderService.assign(order.id, employeeId);
      toast.success(employeeId ? 'Order assigned' : 'Assignment cleared');
      onAssigned(updated);
      onOpenChange(false);
    } catch {
      toast.error('Could not update the assignment');
    } finally {
      setSaving(null);
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={order ? `Assign order ${order.order_number}` : 'Assign order'}
      description="Choose the employee responsible for processing this order."
    >
      <div className="space-y-3">
        <EmployeeSearch value={search} onChange={setSearch} />

        {order?.assigned_agent && (
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-muted-foreground"
            disabled={saving !== null}
            onClick={() => doAssign(null)}
          >
            {saving === 'clear' ? <Loader2 className="size-4 animate-spin" /> : <UserX className="size-4" />}
            Unassign{order.assigned_agent_name ? ` (currently ${order.assigned_agent_name})` : ''}
          </Button>
        )}

        <ScrollArea className="max-h-[50vh] pr-2">
          <div className="space-y-1.5">
            {loadingEmployees ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading employees…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No employees found.</p>
            ) : (
              filtered.map(emp => {
                const current = emp.id === order?.assigned_agent;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    disabled={saving !== null}
                    onClick={() => doAssign(emp.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition disabled:opacity-60 ${
                      current ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <EmployeeAvatar name={emp.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{emp.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {emp.role || emp.matricule} · {emp.open_orders} open
                      </div>
                    </div>
                    {saving === emp.id ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    ) : current ? (
                      <UserCheck className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </ResponsiveSheet>
  );
}

/** Toggle which employees are eligible for automatic assignment. */
export function AutoAssignmentSettingsDialog({
  open, onOpenChange, employees, loading, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees: AssignableEmployee[];
  loading?: boolean;
  onSaved: (employees: AssignableEmployee[]) => void;
}) {
  const [enabled, setEnabled] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEnabled(new Set(employees.filter(e => e.enabled).map(e => e.id)));
      setSearch('');
    }
  }, [open, employees]);

  const filtered = useEmployeeFilter(employees, search);
  const count = enabled.size;

  function toggle(id: number, on: boolean) {
    setEnabled(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    try {
      setSaving(true);
      const res = await orderService.updateAssignmentSettings([...enabled]);
      toast.success('Auto-assignment pool updated');
      onSaved(res.employees);
      onOpenChange(false);
    } catch {
      toast.error('Could not save the settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Auto-assignment settings"
      description="New WooCommerce orders are shared automatically among the employees enabled here — each new order goes to whoever has the fewest open orders."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {count} employee{count !== 1 ? 's' : ''} in the pool
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || loading}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <EmployeeSearch value={search} onChange={setSearch} />
        <ScrollArea className="max-h-[55vh] pr-2">
          <div className="space-y-1.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading employees…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No employees found.</p>
            ) : (
              filtered.map(emp => (
                <label
                  key={emp.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/40"
                >
                  <EmployeeAvatar name={emp.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{emp.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {emp.role || emp.matricule} · {emp.open_orders} open
                    </div>
                  </div>
                  <Switch
                    checked={enabled.has(emp.id)}
                    onCheckedChange={v => toggle(emp.id, Boolean(v))}
                  />
                </label>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </ResponsiveSheet>
  );
}
