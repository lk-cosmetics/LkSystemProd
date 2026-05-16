/**
 * PromotionsPage — campaign list view.
 *
 * One row per promotion *group* (wizard-created siblings share a UUID).
 * Bulk-actions toolbar covers Activate / Deactivate / Delete. Clicking a row
 * opens the read-only details dialog with per-product remove + an Edit
 * button that hands off to the same wizard in edit mode.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  Loader2,
  MoreVertical,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useAuthStore } from '@/store/authStore';
import { hasRole } from '@/hooks/useAuth';
import {
  promotionsKeys,
  useActivatePromotion,
  useBulkActivatePromotions,
  useBulkDeactivatePromotions,
  useBulkDeletePromotions,
  useDeactivatePromotion,
  useDeletePromotionGroup,
  usePromotionGroup,
  usePromotionGroups,
} from '@/hooks/queries/usePromotions';
import { useQueryClient } from '@tanstack/react-query';
import { PromotionWizardDialog } from '@/pages/promotions/PromotionWizardDialog';
import { PromotionGroupDetailsDialog } from '@/pages/promotions/PromotionGroupDetailsDialog';

import type {
  PromotionGroupDetail,
  PromotionGroupListItem,
  PromotionStatus,
} from '@/types';

// =============================================================================
// Constants & helpers
// =============================================================================

const STATUS_FILTER_OPTIONS: { value: 'all' | PromotionStatus; label: string }[] = [
  { value: 'all',       label: 'All statuses' },
  { value: 'active',    label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'draft',     label: 'Draft' },
  { value: 'paused',    label: 'Paused' },
  { value: 'expired',   label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function discountSummary(group: PromotionGroupListItem) {
  const min = group.discount_min ? Number(group.discount_min) : null;
  const max = group.discount_max ? Number(group.discount_max) : null;
  const types = group.discount_types;
  if (min == null || max == null) return null;
  const allPercent = types.length === 1 && types[0] === 'percentage';
  const allFixed = types.length === 1 && types[0] === 'fixed';
  const suffix = allPercent ? '%' : allFixed ? ' TND' : '';
  if (min === max) return `${min}${suffix}`;
  return `${min}–${max}${suffix}`;
}

function statusBadge(group: PromotionGroupListItem) {
  if (!group.is_active) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Pause className="size-3" /> Inactive
      </Badge>
    );
  }
  if (group.is_currently_active) {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
        <CheckCircle2 className="size-3" /> Live
      </Badge>
    );
  }
  if (group.status === 'scheduled') {
    return (
      <Badge variant="outline" className="gap-1">
        <CalendarClock className="size-3" /> Scheduled
      </Badge>
    );
  }
  if (group.status === 'paused') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Pause className="size-3" /> Paused
      </Badge>
    );
  }
  if (group.status === 'expired') {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <XCircle className="size-3" /> Expired
      </Badge>
    );
  }
  return <Badge variant="outline">{group.status}</Badge>;
}

// =============================================================================
// Row component
// =============================================================================

interface RowProps {
  group: PromotionGroupListItem;
  isSelected: boolean;
  selectionMode: boolean;
  canManage: boolean;
  onToggle: (groupId: string) => void;
  onOpen: (groupId: string) => void;
  onEdit: (groupId: string) => void;
  onActivate: (group: PromotionGroupListItem) => void;
  onDeactivate: (group: PromotionGroupListItem) => void;
  onDelete: (group: PromotionGroupListItem) => void;
}

const PromotionGroupRow = memo(function PromotionGroupRow({
  group, isSelected, selectionMode, canManage,
  onToggle, onOpen, onEdit, onActivate, onDeactivate, onDelete,
}: RowProps) {
  const handleRowClick = () => {
    if (selectionMode) {
      onToggle(group.group_id);
    } else {
      onOpen(group.group_id);
    }
  };

  return (
    <TableRow
      data-state={isSelected ? 'selected' : undefined}
      className="cursor-pointer"
      onClick={handleRowClick}
    >
      <TableCell className="w-10" onClick={e => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle(group.group_id)}
          aria-label={`Select ${group.name}`}
        />
      </TableCell>

      <TableCell>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {group.product_count} product{group.product_count === 1 ? '' : 's'}
            </Badge>
            {group.code ? (
              <span className="font-mono">{group.code}</span>
            ) : null}
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden text-sm sm:table-cell">
        <span className="truncate">{group.brand_name ?? '—'}</span>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-1.5">
          {group.discount_types.length === 1 && group.discount_types[0] === 'percentage' ? (
            <Percent className="size-3.5 text-muted-foreground" />
          ) : null}
          <span className="text-sm font-medium tabular-nums">
            {discountSummary(group) ?? '—'}
          </span>
        </div>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <Badge variant="outline" className="gap-1">
          <Store className="size-3" />
          {group.channel_count}
        </Badge>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="text-xs">
          <p>{formatDate(group.start_date)}</p>
          {group.end_date ? (
            <p className="text-muted-foreground">to {formatDate(group.end_date)}</p>
          ) : (
            <Badge variant="outline" className="mt-0.5 h-5 px-1.5 text-[10px]">
              No end date
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell>{statusBadge(group)}</TableCell>

      <TableCell className="w-10" onClick={e => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Open actions">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Campaign</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onOpen(group.group_id)}>
              <Eye className="size-3.5" /> View details
            </DropdownMenuItem>
            {canManage ? (
              <>
                <DropdownMenuItem onClick={() => onEdit(group.group_id)}>
                  <Pencil className="size-3.5" /> Edit
                </DropdownMenuItem>
                {group.is_active ? (
                  <DropdownMenuItem onClick={() => onDeactivate(group)}>
                    <Pause className="size-3.5" /> Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onActivate(group)}>
                    <Play className="size-3.5" /> Activate
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(group)}
                >
                  <Trash2 className="size-3.5" /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

// =============================================================================
// Page
// =============================================================================

export default function PromotionsPage() {
  const currentUser = useAuthStore(state => state.user);
  const canManage =
    hasRole(currentUser, 'SuperAdmin') ||
    hasRole(currentUser, 'Admin') ||
    hasRole(currentUser, 'Manager') ||
    hasRole(currentUser, 'CEO');

  const queryClient = useQueryClient();
  const groupsQuery = usePromotionGroups();
  const groups = groupsQuery.data ?? [];

  // ── UI state ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PromotionStatus>('all');

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroupId, setDetailsGroupId] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<PromotionGroupListItem | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // ── Hooks ──────────────────────────────────────────────────────────────
  const activateMutation = useActivatePromotion();
  const deactivateMutation = useDeactivatePromotion();
  const bulkActivate = useBulkActivatePromotions();
  const bulkDeactivate = useBulkDeactivatePromotions();
  const bulkDelete = useBulkDeletePromotions();
  const deleteGroup = useDeletePromotionGroup();

  const detailsGroupQuery = usePromotionGroup(detailsGroupId);
  const editGroupQuery = usePromotionGroup(editGroupId);

  // When the edit-mode fetch fails, close the wizard and tell the user. The
  // wizard is otherwise stuck on a "Loading campaign…" stub.
  useEffect(() => {
    if (editGroupQuery.isError && editGroupId) {
      toast.error("Couldn't load the campaign for editing.");
      setIsWizardOpen(false);
      setEditGroupId(null);
    }
  }, [editGroupQuery.isError, editGroupId]);

  // ── Derived ────────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter(g => {
      if (statusFilter !== 'all' && g.status !== statusFilter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        (g.code ?? '').toLowerCase().includes(q) ||
        (g.brand_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [groups, search, statusFilter]);

  const selectionMode = selectedGroupIds.length > 0;
  const allFilteredSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every(g => selectedGroupIds.includes(g.group_id));

  // Member-id resolution for bulk-promotion-id endpoints. The list response
  // already counts members but doesn't include their IDs, so we look them up
  // by re-fetching each selected group's detail page on demand (only when the
  // user clicks a bulk action).
  const memberIdsForGroup = useCallback(
    async (groupId: string): Promise<number[]> => {
      const cached = queryClient.getQueryData<PromotionGroupDetail>(
        promotionsKeys.group(groupId),
      );
      if (cached) return cached.members.map(m => m.id);
      const fresh = await queryClient.fetchQuery<PromotionGroupDetail>({
        queryKey: promotionsKeys.group(groupId),
        queryFn: () =>
          import('@/services/promotion.service').then(m =>
            m.promotionService.getPromotionGroupById(groupId),
          ),
      });
      return fresh.members.map(m => m.id);
    },
    [queryClient],
  );

  const collectMemberIds = useCallback(
    async (groupIds: string[]): Promise<number[]> => {
      const lists = await Promise.all(groupIds.map(memberIdsForGroup));
      return lists.flat();
    },
    [memberIdsForGroup],
  );

  // ── Handlers ───────────────────────────────────────────────────────────
  const toggleGroup = useCallback((groupId: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId],
    );
  }, []);

  const toggleAllVisible = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(filteredGroups.map(g => g.group_id));
    }
  }, [allFilteredSelected, filteredGroups]);

  const openDetails = useCallback((groupId: string) => {
    setDetailsGroupId(groupId);
    setDetailsOpen(true);
  }, []);

  const openEdit = useCallback((groupId: string) => {
    setDetailsOpen(false);
    setEditGroupId(groupId);
    setIsWizardOpen(true);
  }, []);

  const handleActivateGroup = useCallback(
    async (group: PromotionGroupListItem) => {
      try {
        const memberIds = await memberIdsForGroup(group.group_id);
        if (memberIds.length === 1) {
          await activateMutation.mutateAsync(memberIds[0]);
        } else {
          await bulkActivate.mutateAsync(memberIds);
        }
        toast.success(`“${group.name}” activated.`);
      } catch {
        toast.error('Could not activate the campaign.');
      }
    },
    [activateMutation, bulkActivate, memberIdsForGroup],
  );

  const handleDeactivateGroup = useCallback(
    async (group: PromotionGroupListItem) => {
      try {
        const memberIds = await memberIdsForGroup(group.group_id);
        if (memberIds.length === 1) {
          await deactivateMutation.mutateAsync(memberIds[0]);
        } else {
          await bulkDeactivate.mutateAsync(memberIds);
        }
        toast.success(`“${group.name}” deactivated.`);
      } catch {
        toast.error('Could not deactivate the campaign.');
      }
    },
    [bulkDeactivate, deactivateMutation, memberIdsForGroup],
  );

  const handleDeleteGroup = useCallback(
    async (group: PromotionGroupListItem) => {
      try {
        await deleteGroup.mutateAsync(group.group_id);
        toast.success(`“${group.name}” deleted.`);
      } catch {
        toast.error('Could not delete the campaign.');
      } finally {
        setConfirmDelete(null);
      }
    },
    [deleteGroup],
  );

  const handleBulkActivate = useCallback(async () => {
    if (selectedGroupIds.length === 0) return;
    try {
      const ids = await collectMemberIds(selectedGroupIds);
      await bulkActivate.mutateAsync(ids);
      toast.success(`Activated ${selectedGroupIds.length} campaign(s).`);
      setSelectedGroupIds([]);
    } catch {
      toast.error('Could not activate the selected campaigns.');
    }
  }, [bulkActivate, collectMemberIds, selectedGroupIds]);

  const handleBulkDeactivate = useCallback(async () => {
    if (selectedGroupIds.length === 0) return;
    try {
      const ids = await collectMemberIds(selectedGroupIds);
      await bulkDeactivate.mutateAsync(ids);
      toast.success(`Deactivated ${selectedGroupIds.length} campaign(s).`);
      setSelectedGroupIds([]);
    } catch {
      toast.error('Could not deactivate the selected campaigns.');
    }
  }, [bulkDeactivate, collectMemberIds, selectedGroupIds]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedGroupIds.length === 0) return;
    try {
      const ids = await collectMemberIds(selectedGroupIds);
      await bulkDelete.mutateAsync(ids);
      toast.success(`Deleted ${selectedGroupIds.length} campaign(s).`);
      setSelectedGroupIds([]);
      setConfirmBulkDelete(false);
    } catch {
      toast.error('Could not delete the selected campaigns.');
    }
  }, [bulkDelete, collectMemberIds, selectedGroupIds]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Tag className="size-5 text-primary" />
            Promotions
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage multi-channel campaigns. Each campaign can carry many products with their own discounts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => groupsQuery.refetch()}
            disabled={groupsQuery.isFetching}
          >
            <RefreshCw className={`size-4 ${groupsQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditGroupId(null);
                setIsWizardOpen(true);
              }}
            >
              <Plus className="size-4" />
              New Promotion
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns, codes, brands…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as 'all' | PromotionStatus)}>
            <SelectTrigger className="sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Selection toolbar */}
      {selectionMode && canManage ? (
        <Card className="border-primary/40 bg-primary/5 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium text-primary">
              {selectedGroupIds.length} campaign{selectedGroupIds.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkActivate}
                disabled={bulkActivate.isPending}
              >
                <Play className="size-4" /> Activate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDeactivate}
                disabled={bulkDeactivate.isPending}
              >
                <Pause className="size-4" /> Deactivate
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkDelete.isPending}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedGroupIds([])}>
                Clear
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* List */}
      <Card className="overflow-hidden">
        {groupsQuery.isError ? (
          <div className="flex items-center gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            Couldn't load campaigns.
            <Button variant="ghost" size="sm" onClick={() => groupsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allFilteredSelected && filteredGroups.length > 0}
                    onCheckedChange={toggleAllVisible}
                    aria-label="Select all visible campaigns"
                    disabled={filteredGroups.length === 0}
                  />
                </TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="hidden sm:table-cell">Brand</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead className="hidden md:table-cell">Channels</TableHead>
                <TableHead className="hidden md:table-cell">Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupsQuery.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="size-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell />
                  </TableRow>
                ))
              ) : filteredGroups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-sm text-muted-foreground">
                      <Tag className="size-8 opacity-50" />
                      <p>
                        {groups.length === 0
                          ? 'No promotions yet.'
                          : 'No campaign matches the current filter.'}
                      </p>
                      {canManage && groups.length === 0 ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditGroupId(null);
                            setIsWizardOpen(true);
                          }}
                        >
                          <Plus className="size-4" /> Create a campaign
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredGroups.map(group => (
                  <PromotionGroupRow
                    key={group.group_id}
                    group={group}
                    isSelected={selectedGroupIds.includes(group.group_id)}
                    selectionMode={selectionMode}
                    canManage={canManage}
                    onToggle={toggleGroup}
                    onOpen={openDetails}
                    onEdit={openEdit}
                    onActivate={handleActivateGroup}
                    onDeactivate={handleDeactivateGroup}
                    onDelete={g => setConfirmDelete(g)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Wizard (create or edit). Pass the loaded group only when editing. */}
      <PromotionWizardDialog
        open={isWizardOpen}
        onOpenChange={open => {
          setIsWizardOpen(open);
          if (!open) setEditGroupId(null);
        }}
        initialGroup={editGroupId ? editGroupQuery.data ?? null : null}
        isLoadingInitialGroup={!!editGroupId && editGroupQuery.isLoading}
      />

      {/* Details */}
      <PromotionGroupDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        group={detailsGroupId ? detailsGroupQuery.data ?? null : null}
        onEdit={group => openEdit(group.group_id)}
      />

      {/* Single-group delete confirmation */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={v => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              All {confirmDelete?.product_count ?? 0} member promotions will be deleted in one atomic operation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroup.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDeleteGroup(confirmDelete)}
              disabled={deleteGroup.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroup.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedGroupIds.length} campaign{selectedGroupIds.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every member promotion of the selected campaigns will be removed in one atomic backend call.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDelete.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

