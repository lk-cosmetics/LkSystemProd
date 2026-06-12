/**
 * Presentation for THE canonical order lifecycle (``order.status``).
 *
 * Eight states: new → confirmed → packaging → done → returned, with
 * not_answered / delayed side states and canceled reachable from every
 * non-terminal state. One hue per state drives the chip AND the row tint so
 * the queue reads at a glance. payment_status / sync_status stay secondary
 * badges. Leaf module — OrdersPage and OrderDialogs render identical chips.
 */
import { Badge } from '@/components/ui/badge';

// Chip palette (saturated): new=slate, confirmed=blue, not_answered=orange,
// delayed=amber, packaging=purple, done=emerald, returned=rose, canceled=red.
export const ORDER_STATUS_STYLES: Record<string, string> = {
  new:          'bg-slate-100 text-slate-700',
  confirmed:    'bg-blue-100 text-blue-800',
  not_answered: 'bg-orange-100 text-orange-800',
  delayed:      'bg-amber-100 text-amber-800',
  packaging:    'bg-purple-100 text-purple-800',
  done:         'bg-emerald-100 text-emerald-800',
  returned:     'bg-rose-100 text-rose-800',
  canceled:     'bg-red-100 text-red-800',
};

// Soft per-status row tint for the orders table (same hue as the chip).
export const ORDER_STATUS_ROW_STYLES: Record<string, string> = {
  new:          'bg-slate-50/60 hover:bg-slate-100/60',
  confirmed:    'bg-blue-50/60 hover:bg-blue-100/60',
  not_answered: 'bg-orange-50/60 hover:bg-orange-100/60',
  delayed:      'bg-amber-50/60 hover:bg-amber-100/60',
  packaging:    'bg-purple-50/60 hover:bg-purple-100/60',
  done:         'bg-emerald-50/50 hover:bg-emerald-100/50',
  returned:     'bg-rose-50/60 hover:bg-rose-100/60',
  canceled:     'bg-red-50/60 hover:bg-red-100/60',
};

export const orderStatusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// THE lifecycle chip.
export function OrderStatusBadge({ status, label }: Readonly<{ status?: string; label?: string }>) {
  if (!status) return null;
  const styles = ORDER_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <Badge variant="outline" className={`text-xs border-transparent font-semibold ${styles}`}>
      {label || orderStatusLabel(status)}
    </Badge>
  );
}

// WooCommerce push-sync state colours (only shown when noteworthy).
export const SYNC_STATUS_STYLES: Record<string, string> = {
  pending_sync: 'bg-amber-100 text-amber-800',
  syncing:      'bg-blue-100 text-blue-800',
  synced:       'bg-emerald-100 text-emerald-800',
  sync_failed:  'bg-red-100 text-red-800',
};

// WooCommerce push-sync state. 'imported' = nothing to push yet, so it is
// hidden to avoid clutter; only in-flight/terminal states show.
export function SyncStatusBadge({ status, label }: Readonly<{ status?: string; label?: string }>) {
  if (!status || status === 'imported') return null;
  const styles = SYNC_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <Badge variant="outline" className={`text-[10px] border-transparent ${styles}`}>
      Sync: {label || status.replace(/_/g, ' ')}
    </Badge>
  );
}
