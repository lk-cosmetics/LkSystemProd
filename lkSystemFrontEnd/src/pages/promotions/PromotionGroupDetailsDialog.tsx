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

import { memo, useMemo, useState } from 'react';
import {
  IconBox,
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
import { TUNIS_TZ } from '@/lib/tunisTime';
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
  // Promotion windows are Tunisia time — render in `Africa/Tunis` regardless
  // of the viewer's machine timezone.
  return d.toLocaleString(undefined, {
    timeZone: TUNIS_TZ,
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

function isPackMember(member: PromotionGroupMember) {
  return member.is_pack || member.product_type === 'pack';
}

function groupMembersByDiscount(members: PromotionGroupMember[]) {
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      discount_type: DiscountType;
      discount_value: string;
      members: PromotionGroupMember[];
    }
  >();

  members.forEach(member => {
    const value = String(member.discount_value ?? '0');
    const key = `${member.discount_type}:${value}`;
    const existing = map.get(key);

    if (existing) {
      existing.members.push(member);
      return;
    }

    map.set(key, {
      key,
      label: `${badgeForType(member.discount_type)} ${discountLabel(member)}`,
      discount_type: member.discount_type,
      discount_value: value,
      members: [member],
    });
  });

  return Array.from(map.values());
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
  const [activeDiscountGroupKey, setActiveDiscountGroupKey] = useState<string>('');

  const discountGroups = useMemo(
    () => groupMembersByDiscount(group?.members ?? []),
    [group?.members],
  );

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

  const activeDiscountGroup =
    discountGroups.find(discountGroup => discountGroup.key === activeDiscountGroupKey) ??
    discountGroups[0] ??
    null;

  const renderProductItem = (member: PromotionGroupMember) => (
    <li
      key={member.id}
      className="group flex items-center justify-between gap-2 rounded-lg border bg-background p-2.5 transition-colors hover:bg-muted/50"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {member.product_image ? (
            <img
              src={member.product_image}
              alt={member.product_name}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <IconBox className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {member.product_name}
          </p>
          {member.product_barcode ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {member.product_barcode}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge
          variant={isPackMember(member) ? 'default' : 'secondary'}
          className="text-[10px]"
        >
          {isPackMember(member) ? 'Pack' : 'Product'}
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${member.product_name}`}
          disabled={removingId === member.id}
          onClick={() => handleRemoveMember(member.id, member.product_name)}
        >
          {removingId === member.id ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <IconX className="size-3.5" />
          )}
        </Button>
      </div>
    </li>
  );

  // ── Shared header / body / footer pieces ────────────────────────────────
  const header = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-2xl font-bold tracking-tight">
            {group.name}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm">
            Campaign ID: {group.group_id}
          </DialogDescription>
        </div>
        <Badge
          variant={group.is_currently_active ? 'default' : 'secondary'}
          className="mt-1 shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold mr-10"
        >
          {group.is_currently_active ? (
            <IconCheck className="size-3" />
          ) : (
            <IconClockHour4 className="size-3" />
          )}
          {group.is_currently_active ? 'Live' : group.status || 'Scheduled'}
        </Badge>
      </div>
      
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-center">
          <p className="text-2xl font-bold">{group.members.length}</p>
          <p className="text-xs text-muted-foreground">
            {group.members.length === 1 ? 'Product' : 'Products'}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-center">
          <p className="text-2xl font-bold">{group.sales_channels.length}</p>
          <p className="text-xs text-muted-foreground">
            {group.sales_channels.length === 1 ? 'Channel' : 'Channels'}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-center">
          <p className="text-2xl font-bold">{discountGroups.length}</p>
          <p className="text-xs text-muted-foreground">
            {discountGroups.length === 1 ? 'Discount' : 'Discounts'}
          </p>
        </div>
        {group.brand_name && (
          <div className="rounded-lg border bg-muted/40 p-3 text-center sm:col-span-1">
            <p className="truncate text-xs font-semibold">{group.brand_name}</p>
            <p className="text-xs text-muted-foreground">Brand</p>
          </div>
        )}
      </div>
    </div>
  );

  const overviewPanel = (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Campaign Details</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Start Date
            </p>
            <p className="mt-1 truncate font-mono text-xs font-medium">
              {formatDateTime(group.start_date) ?? '—'}
            </p>
          </div>
          <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              End Date
            </p>
            <p className="mt-1 truncate font-mono text-xs font-medium">
              {group.end_date
                ? (formatDateTime(group.end_date) ?? '—')
                : 'No end date'}
            </p>
          </div>
          <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Stackable
            </p>
            <p className="mt-1 text-xs font-medium">
              {group.is_stackable ? (
                <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
                  <IconCheck className="size-3" /> Yes
                </Badge>
              ) : (
                'No'
              )}
            </p>
          </div>
          {group.code && (
            <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Promo Code
              </p>
              <p className="mt-1 truncate font-mono text-xs font-semibold">{group.code}</p>
            </div>
          )}
          {group.max_usage && (
            <div className="min-w-0 rounded-lg border bg-muted/30 p-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Max Usage
              </p>
              <p className="mt-1 truncate text-xs font-semibold">{group.max_usage}</p>
            </div>
          )}
        </div>
      </div>

      {group.description && (
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Description</h3>
          <p className="mt-2 line-clamp-2 rounded-lg border bg-muted/30 p-2.5 text-sm leading-relaxed text-muted-foreground">
            {group.description}
          </p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold tracking-tight">Sales Channels</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {group.sales_channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">No channels</p>
          ) : (
            group.sales_channels.map(ch => (
              <Badge
                key={ch.id}
                variant="secondary"
                className="gap-1 rounded-full"
              >
                <IconBuildingStore className="size-3" />
                {ch.name || channelNames?.[ch.id] || `Channel #${ch.id}`}
              </Badge>
            ))
          )}
        </div>
      </div>
    </div>
  );

  // The products list is always in its own scrollable region. On desktop the
  // ScrollArea caps the height; on mobile the surrounding Drawer is already
  // a scroll container, so we let it expand naturally and rely on the Drawer
  // for the scroll affordance.
  const productsSection = (
    <div className="flex min-h-0 flex-col space-y-2">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Products in Campaign</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {group.members.length} product{group.members.length !== 1 ? 's' : ''} •{' '}
          {discountGroups.length} discount group{discountGroups.length !== 1 ? 's' : ''}
        </p>
      </div>

      {group.members.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 py-8 text-center">
          <IconBox className="mx-auto size-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">
            No products in this campaign
          </p>
        </div>
      ) : (
        <div className="min-h-0 space-y-2">
          <ScrollArea className="w-full rounded-lg border bg-muted/20">
            <div
              role="tablist"
              aria-label="Discount groups"
              className="flex w-max gap-1 p-1"
            >
              {discountGroups.map(discountGroup => {
                const isActive = activeDiscountGroup?.key === discountGroup.key;

                return (
                  <button
                    key={discountGroup.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`min-w-32 rounded-md px-3 py-2 text-left transition-colors ${
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                    }`}
                    onClick={() => setActiveDiscountGroupKey(discountGroup.key)}
                  >
                    <span className="block max-w-40 truncate text-xs font-semibold">
                      {discountGroup.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-normal">
                      {discountGroup.members.length} item
                      {discountGroup.members.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div className="overflow-hidden rounded-lg border bg-background">
            {activeDiscountGroup ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      {activeDiscountGroup.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {activeDiscountGroup.members.length} item
                      {activeDiscountGroup.members.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full bg-background text-[10px]"
                  >
                    {activeDiscountGroup.discount_type === 'percentage'
                      ? 'Percentage'
                      : 'Fixed'}
                  </Badge>
                </div>

                <ScrollArea className="h-[54dvh] max-h-[54dvh] sm:h-[470px] sm:max-h-[52vh]">
                  <ul className="space-y-1 p-2">
                    {activeDiscountGroup.members.map(renderProductItem)}
                  </ul>
                </ScrollArea>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirmDeleteGroup(true)}
        disabled={deleteGroup.isPending}
      >
        <IconTrash className="size-4" />
        Delete Campaign
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
        {onEdit && (
          <Button
            type="button"
            size="sm"
            className="gap-2"
            onClick={() => onEdit(group)}
          >
            <IconEdit className="size-4" />
            Edit Campaign
          </Button>
        )}
      </div>
    </div>
  );

  const contentBody = (
    <div className="min-h-0 space-y-4">
      {overviewPanel}
      {productsSection}
    </div>
  );

  return (
    <>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="flex h-[92dvh] max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl">
            <DrawerHeader className="border-b px-4 py-4">
              <DrawerTitle asChild>
                <div>
                  <p className="text-lg font-bold">{group.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Campaign ID: {group.group_id}
                  </p>
                </div>
              </DrawerTitle>
            </DrawerHeader>
            <ScrollArea className="min-h-0 flex-1 px-4">
              <div className="space-y-4 py-4">
                {contentBody}
              </div>
            </ScrollArea>
            <div className="border-t bg-background p-4">
              {footer}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="flex max-h-[92vh] w-[min(96vw,920px)] flex-col overflow-hidden p-0 sm:max-w-4xl">
            <DialogHeader className="border-b px-6 py-5">
              {header}
            </DialogHeader>
            <ScrollArea className="min-h-0 flex-1 px-6">
              <div className="py-4">
                {contentBody}
              </div>
            </ScrollArea>
            <div className="border-t bg-muted/30 px-6 py-4">
              {footer}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={confirmDeleteGroup} onOpenChange={setConfirmDeleteGroup}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {group.members.length} product
              {group.members.length !== 1 ? 's' : ''} from this campaign. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              disabled={deleteGroup.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroup.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const PromotionGroupDetailsDialog = memo(PromotionGroupDetailsDialogImpl);
