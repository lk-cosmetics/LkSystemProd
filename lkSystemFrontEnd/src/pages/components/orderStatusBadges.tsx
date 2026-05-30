/**
 * Shared, presentation-only badges for the Phase D "clean" order status surface.
 *
 * The backend lifecycle service is the single writer of the derived
 * ``order_status`` and ``sync_status`` fields; these components only render
 * them. Extracted into a leaf module so both the orders list (OrdersPage) and
 * the order detail dialog (OrderDialogs) render an identical, single-sourced
 * status chip — no palette duplication, no circular import.
 */
import { Badge } from '@/components/ui/badge';

// Clean order_status palette (the single canonical lifecycle status).
export const CLEAN_STATUS_STYLES: Record<string, string> = {
  new:                   'bg-slate-100 text-slate-700',
  awaiting_confirmation: 'bg-amber-100 text-amber-800',
  confirmed:             'bg-blue-100 text-blue-800',
  delayed:               'bg-orange-100 text-orange-800',
  not_answered:          'bg-rose-100 text-rose-800',
  canceled:              'bg-red-100 text-red-800',
  preparing:             'bg-violet-100 text-violet-800',
  done:                  'bg-emerald-100 text-emerald-800',
  returned:              'bg-purple-100 text-purple-800',
  exchanged:             'bg-indigo-100 text-indigo-800',
};

// WooCommerce push-sync state colours (only shown when noteworthy).
export const SYNC_STATUS_STYLES: Record<string, string> = {
  pending_sync: 'bg-amber-100 text-amber-800',
  syncing:      'bg-blue-100 text-blue-800',
  synced:       'bg-emerald-100 text-emerald-800',
  sync_failed:  'bg-red-100 text-red-800',
};

export const cleanStatusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// The clean, derived order_status as the canonical lifecycle chip.
export function CleanStatusBadge({ status, label }: Readonly<{ status?: string; label?: string }>) {
  if (!status) return null;
  const styles = CLEAN_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <Badge variant="outline" className={`text-xs border-transparent font-semibold ${styles}`}>
      {label || cleanStatusLabel(status)}
    </Badge>
  );
}

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
