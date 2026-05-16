/**
 * PromotionGroupDetailsDialog
 *
 * Read-only campaign view. Shows the shared meta, the channel set and each
 * member product with its discount. Supports:
 *   - inline product removal (DELETE the underlying promotion row)
 *   - "Edit campaign" handoff to the wizard
 *   - "Delete campaign" via the group-delete endpoint
 *
 * Responsive shell: Dialog on desktop, bottom Drawer on mobile — same pattern
 * as ``OrderDialogs.ResponsiveSheet``. The products list always lives in its
 * own scrollable region so long campaigns never push the footer off-screen.
 */

import { memo, useState } from 'react';
import {
  IconBox,
  IconCalendar,
  IconCheck,
  IconClockHour4,
  IconEdit,
  IconBuildingStore,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useIsMobile } from '@/hooks/use-mobile';
import {
  useDeletePromotion,
  useDeletePromotionGroup,
} from '@/hooks/queries/usePromotions';
import type {
  DiscountType,
  PromotionGroupDetail,
  PromotionGroupMember,
} from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PromotionGroupDetail | null;
  /** Called with the group after the user clicks "Edit campaign". */
  onEdit?: (group: PromotionGroupDetail) => void;
  /** Optional channel-id → name resolution for nicer display. */
  channelNames?: Record<number, string>;
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function discountLabel(member: PromotionGroupMember) {
  const value = Number(member.discount_value);
  if (!Number.isFinite(value)) return '—';
  return member.discount_type === 'percentage'
    ? `${value}%`
    : `${value} TND`;
}

function badgeForType(type: DiscountType) {
  return type === 'percentage' ? 'Percentage' : 'Fixed';
}

function PromotionGroupDetailsDialogImpl({
  open,
  onOpenChange,
  group,
  onEdit,
  channelNames,
}: Props) {
  const deletePromotion = useDeletePromotion();
  const deleteGroup = useDeletePromotionGroup();
  const isMobile = useIsMobile();
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);

  if (!group) return null;

  const handleRemoveMember = async (memberId: number, name: string) => {
    if (removingId) return;
    setRemovingId(memberId);
    try {
      await deletePromotion.mutateAsync(memberId);
      toast.success(`Removed “${name}” from the campaign.`);
      // If we just removed the last member, ask whether to drop the whole group.
      if (group.members.length === 1) {
        setConfirmDeleteGroup(true);
      }
    } catch {
      toast.error(`Could not remove “${name}”.`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteGroup.mutateAsync(group.group_id);
      toast.success('Campaign deleted.');
      setConfirmDeleteGroup(false);
      onOpenChange(false);
    } catch {
      toast.error('Could not delete the campaign.');
    }
  };

  // ── Shared header / body / footer pieces ────────────────────────────────
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold tracking-tight sm:text-lg">
          {group.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {group.brand_name ? `${group.brand_name} · ` : ''}
          {group.members.length} product{group.members.length === 1 ? '' : 's'} ·{' '}
          {group.sales_channels.length} channel
          {group.sales_channels.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {group.is_currently_active ? (
          <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
            <IconCheck className="size-3.5" /> Live
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <IconClockHour4 className="size-3.5" /> {group.status}
          </Badge>
        )}
      </div>
    </div>
  );

  const meta = (
    <>
      <section className="grid gap-3 sm:grid-cols-2">
        <SummaryLine
          icon={<IconCalendar className="size-3.5" />}
          label="Starts"
          value={formatDateTime(group.start_date) ?? '—'}
        />
        <SummaryLine
          icon={<IconCalendar className="size-3.5" />}
          label="Ends"
          value={
            group.end_date
              ? (formatDateTime(group.end_date) ?? '—')
              : 'No end date'
          }
        />
        {group.code ? (
          <SummaryLine label="Code" value={group.code} />
        ) : null}
        <SummaryLine
          label="Stackable"
          value={group.is_stackable ? 'Yes' : 'No'}
        />
        {group.max_usage ? (
          <SummaryLine label="Max usage" value={String(group.max_usage)} />
        ) : null}
      </section>

      {group.description ? (
        <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
          {group.description}
        </p>
      ) : null}

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <IconBuildingStore className="size-3.5" /> Sales channels
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {group.sales_channels.length === 0 ? (
            <span className="text-xs text-muted-foreground">No channels</span>
          ) : (
            group.sales_channels.map(ch => (
              <Badge key={ch.id} variant="outline" className="text-[11px]">
                {ch.name || channelNames?.[ch.id] || `Channel #${ch.id}`}
              </Badge>
            ))
          )}
        </div>
      </section>
    </>
  );

  // The products list is always in its own scrollable region. On desktop the
  // ScrollArea caps the height; on mobile the surrounding Drawer is already
  // a scroll container, so we let it expand naturally and rely on the Drawer
  // for the scroll affordance.
  const productsSection = (
    <section className="flex min-h-0 flex-1 flex-col">
      <h3 className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>Products</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
          {group.members.length}
        </span>
      </h3>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <ScrollArea className="h-full max-h-[55vh]">
          {group.members.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No products in this campaign.
            </div>
          ) : (
            <ul className="divide-y">
              {group.members.map(member => (
                <li
                  key={member.id}
                  className="flex items-start gap-3 px-3 py-2"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {member.product_image ? (
                      <img
                        src={member.product_image}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <IconBox className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.product_name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {member.product_barcode || '—'}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {badgeForType(member.discount_type)}
                      </Badge>
                      <span className="text-xs font-medium tabular-nums">
                        {discountLabel(member)}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${member.product_name}`}
                    disabled={removingId === member.id}
                    onClick={() =>
                      handleRemoveMember(member.id, member.product_name)
                    }
                  >
                    {removingId === member.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <IconX className="size-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </section>
  );

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmDeleteGroup(true)}
      >
        <IconTrash className="size-4" /> Delete campaign
      </Button>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
        {onEdit ? (
          <Button
            type="button"
            size="sm"
            onClick={() => onEdit(group)}
            className="gap-1"
          >
            <IconEdit className="size-4" /> Edit campaign
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="flex h-[95dvh] max-h-[95dvh] flex-col rounded-t-2xl">
            <DrawerHeader className="border-b bg-background/80 px-4 pb-3 pt-4 text-left backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <DrawerTitle asChild>{header}</DrawerTitle>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
              {meta}
              {productsSection}
            </div>
            <div className="border-t bg-background/95 px-4 py-3 backdrop-blur">
              {footer}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            className="flex max-h-[90vh] w-[min(92vw,720px)] max-w-none flex-col gap-0 overflow-hidden p-0"
          >
            <DialogHeader className="border-b px-4 py-3 sm:px-6 sm:py-4">
              <DialogTitle asChild>{header}</DialogTitle>
              {/* Required for a11y — visually hidden because we already render
                  the description as part of the custom header above. */}
              <DialogDescription className="sr-only">
                Campaign details for {group.name}
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
              {meta}
              {productsSection}
            </div>

            <div className="border-t px-4 py-3 sm:px-6">{footer}</div>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={confirmDeleteGroup} onOpenChange={setConfirmDeleteGroup}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all member promotions ({group.members.length}) in one
              atomic operation. This action can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroup.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              disabled={deleteGroup.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroup.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SummaryLine({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}

export const PromotionGroupDetailsDialog = memo(PromotionGroupDetailsDialogImpl);
