/**
 * PromotionWizardDialog — multi-step bulk-create promotion flow.
 *
 *   Step 1 — Products: pick brand, search/scan/multi-select products, set per
 *            product discount type + value.
 *   Step 2 — Details:  shared name, code, description, schedule, status,
 *            stacking, usage cap, priority. End date is optional — empty
 *            means the promotion runs until manually deactivated.
 *   Step 3 — Channels & review: pick POS sales channels (filtered to the
 *            selected brand) and review before submitting.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { useBrands } from '@/hooks/queries/useBrands';
import {
  useBulkCreatePromotions,
  useUpdatePromotionGroup,
} from '@/hooks/queries/usePromotions';
import { salesChannelService } from '@/services/salesChannel.service';
import type {
  PromotionGroupDetail,
  PromotionStatus,
  SalesChannel,
} from '@/types';

import {
  PromotionProductPicker,
  type SelectedProductLine,
} from './PromotionProductPicker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hydrates the wizard for editing an existing campaign. */
  initialGroup?: PromotionGroupDetail | null;
  /**
   * Set by the parent when an edit is requested but the group detail is
   * still being fetched. Drives the loading stub so the wizard doesn't
   * render an empty Step 1 while the user waits.
   */
  isLoadingInitialGroup?: boolean;
}

type StepId = 'products' | 'details' | 'channels';

const STEPS: { id: StepId; label: string; description: string }[] = [
  { id: 'products', label: 'Products', description: 'Select products & discounts' },
  { id: 'details',  label: 'Details',  description: 'Promotion name & schedule' },
  { id: 'channels', label: 'Channels', description: 'Apply & review' },
];

const STATUS_OPTIONS: { value: PromotionStatus; label: string }[] = [
  { value: 'active',    label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'draft',     label: 'Draft' },
  { value: 'paused',    label: 'Paused' },
];

interface DetailsState {
  name: string;
  description: string;
  code: string;
  start_date: string;
  end_date: string;
  has_end_date: boolean;
  status: PromotionStatus;
  is_stackable: boolean;
  priority: string;
  max_usage: string;
}

const INITIAL_DETAILS: DetailsState = {
  name: '',
  description: '',
  code: '',
  start_date: '',
  end_date: '',
  has_end_date: false,
  status: 'active',
  is_stackable: false,
  priority: '0',
  max_usage: '',
};

/** Convert an <input type="datetime-local"> value to an ISO string. */
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : '';
}

/** Default the start-date input to "now" rounded to the minute. */
function nowLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  // YYYY-MM-DDTHH:MM
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/** Convert an ISO string back to a `<input type="datetime-local">` value. */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function PromotionWizardDialog({
  open,
  onOpenChange,
  initialGroup,
  isLoadingInitialGroup = false,
}: Props) {
  const isEdit = !!initialGroup || isLoadingInitialGroup;
  const [step, setStep] = useState<StepId>('products');
  const [brandId, setBrandId] = useState<number | null>(null);
  const [selected, setSelected] = useState<SelectedProductLine[]>([]);
  const [details, setDetails] = useState<DetailsState>(INITIAL_DETAILS);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Tracks which group_id we've already hydrated from in this open cycle.
  // Prevents background refetches (e.g. after an onSuccess invalidation) from
  // wiping the user's in-progress edits when the React-Query data ref changes.
  const [hydratedGroupId, setHydratedGroupId] = useState<string | null>(null);

  const { data: brands = [], isLoading: brandsLoading } = useBrands();
  const bulkCreate = useBulkCreatePromotions();
  const updateGroup = useUpdatePromotionGroup();

  /* Reset wizard on close, or hydrate from initialGroup on open. */
  useEffect(() => {
    if (!open) {
      setStep('products');
      setBrandId(null);
      setSelected([]);
      setDetails({ ...INITIAL_DETAILS, start_date: nowLocalInput() });
      setChannels([]);
      setSelectedChannels([]);
      setChannelsError(null);
      setHydratedGroupId(null);
      return;
    }

    // ── Edit mode: hydrate exactly once per group_id ────────────────────
    // React-Query can return a new ``initialGroup`` reference on background
    // refetches; without this guard the user's in-progress edits would be
    // overwritten by stale-equivalent data every refetch.
    if (initialGroup && initialGroup.group_id !== hydratedGroupId) {
      setBrandId(initialGroup.brand);
      setSelected(initialGroup.members.map(m => ({
        member_id: m.id,
        product_id: m.product,
        product: {
          id: m.product,
          name: m.product_name,
          barcode: m.product_barcode,
          image_url: m.product_image,
          product_type: 'resell_product',
        },
        discount_type: m.discount_type,
        discount_value: String(m.discount_value ?? '0'),
      })));
      setDetails({
        name: initialGroup.name,
        description: initialGroup.description ?? '',
        code: initialGroup.code ?? '',
        start_date: isoToLocalInput(initialGroup.start_date),
        end_date: isoToLocalInput(initialGroup.end_date),
        has_end_date: initialGroup.end_date != null,
        status: initialGroup.status,
        is_stackable: initialGroup.is_stackable,
        priority: String(initialGroup.priority ?? 0),
        max_usage: initialGroup.max_usage != null ? String(initialGroup.max_usage) : '',
      });
      setSelectedChannels(initialGroup.sales_channel_ids ?? []);
      setHydratedGroupId(initialGroup.group_id);
    } else if (!initialGroup && !details.start_date) {
      setDetails(d => ({ ...d, start_date: nowLocalInput() }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGroup]);

  /* Load POS channels for the selected brand. */
  useEffect(() => {
    if (!brandId) {
      setChannels([]);
      setSelectedChannels([]);
      return;
    }
    let cancelled = false;
    setChannelsLoading(true);
    setChannelsError(null);
    salesChannelService
      .getChannelsByBrand(brandId)
      .then(rows => {
        if (cancelled) return;
        setChannels(rows.filter(c => c.channel_type === 'POS' && c.is_active));
      })
      .catch(() => {
        if (cancelled) return;
        setChannelsError('Could not load sales channels.');
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const stepIndex = STEPS.findIndex(s => s.id === step);

  /* Validation per step — drives the Next button state. */
  const stepValid = useMemo(() => {
    if (step === 'products') {
      if (!brandId) return false;
      if (selected.length === 0) return false;
      return selected.every(line => {
        const n = Number(line.discount_value);
        return Number.isFinite(n) && n >= 0;
      });
    }
    if (step === 'details') {
      if (!details.name.trim()) return false;
      if (!details.start_date) return false;
      if (details.has_end_date && !details.end_date) return false;
      if (details.has_end_date && details.end_date && details.start_date) {
        if (new Date(details.end_date) <= new Date(details.start_date)) return false;
      }
      return true;
    }
    // channels
    return selectedChannels.length > 0;
  }, [step, brandId, selected, details, selectedChannels]);

  const goNext = useCallback(() => {
    if (!stepValid) return;
    const next = STEPS[stepIndex + 1]?.id;
    if (next) setStep(next);
  }, [stepIndex, stepValid]);

  const goBack = useCallback(() => {
    const prev = STEPS[stepIndex - 1]?.id;
    if (prev) setStep(prev);
  }, [stepIndex]);

  const toggleChannel = useCallback((id: number) => {
    setSelectedChannels(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  }, []);

  const submit = useCallback(async () => {
    if (!stepValid || submitting) return;
    setSubmitting(true);
    try {
      const sharedPayload = {
        name: details.name.trim(),
        description: details.description.trim() || undefined,
        code: details.code.trim() || undefined,
        start_date: toIso(details.start_date),
        end_date: details.has_end_date ? toIso(details.end_date) : null,
        status: details.status,
        is_active: true,
        is_stackable: details.is_stackable,
        priority: Number(details.priority) || 0,
        max_usage: details.max_usage ? Number(details.max_usage) : null,
        sales_channels: selectedChannels,
      };

      if (isEdit && initialGroup) {
        const updatePayload = {
          ...sharedPayload,
          items: selected.map(line => ({
            member_id: line.member_id ?? null,
            product: line.product_id,
            discount_type: line.discount_type,
            discount_value: Number(line.discount_value),
          })),
        };
        await updateGroup.mutateAsync({
          groupId: initialGroup.group_id,
          data: updatePayload,
        });
        toast.success('Promotion updated.');
      } else {
        const createPayload = {
          ...sharedPayload,
          brand: brandId ?? null,
          items: selected.map(line => ({
            product: line.product_id,
            discount_type: line.discount_type,
            discount_value: Number(line.discount_value),
          })),
        };
        const result = await bulkCreate.mutateAsync(createPayload);
        toast.success(
          `Created ${result.created} promotion${result.created === 1 ? '' : 's'}.`,
        );
      }
      onOpenChange(false);
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (isEdit ? 'Could not save changes.' : 'Could not create promotions.');
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  }, [
    bulkCreate, brandId, details, initialGroup, isEdit, onOpenChange,
    selected, selectedChannels, stepValid, submitting, updateGroup,
  ]);

  return (
    <Dialog open={open} onOpenChange={v => !submitting && onOpenChange(v)}>
      <DialogContent className="flex max-h-[92vh] w-[min(92vw,920px)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="space-y-1 px-4 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle className="text-lg">
            {isEdit ? 'Edit promotion' : 'New promotion'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the campaign meta, channels, and per-product discounts. Add or remove products as needed.'
              : 'Apply one promotion to multiple products at once, each with its own discount.'}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="border-b px-4 py-3 sm:px-6">
          <ol className="grid grid-cols-3 gap-2 text-[11px]">
            {STEPS.map((s, idx) => {
              const isActive = s.id === step;
              const isDone = idx < stepIndex;
              return (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                    isActive
                      ? 'border-primary/60 bg-primary/5'
                      : isDone
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-border bg-muted/30'
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isDone
                          ? 'bg-emerald-500 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="size-3" /> : idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{s.label}</p>
                    <p className="hidden truncate text-[10px] text-muted-foreground sm:block">
                      {s.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {isLoadingInitialGroup && !initialGroup ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              Loading campaign…
            </div>
          ) : step === 'products' ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:max-w-xs">
                <Label className="text-xs font-medium">
                  Brand{isEdit ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">(locked)</span> : null}
                </Label>
                {brandsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select
                    value={brandId ? String(brandId) : ''}
                    disabled={isEdit}
                    onValueChange={v => {
                      setBrandId(Number(v));
                      setSelected([]);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select a brand" />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map(b => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <PromotionProductPicker
                brandId={brandId}
                selected={selected}
                onChange={setSelected}
              />
            </div>
          ) : null}

          {step === 'details' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="promo-name">Promotion name</Label>
                <Input
                  id="promo-name"
                  value={details.name}
                  onChange={e => setDetails(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. End-of-month flash sale"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-code">Promo code (optional)</Label>
                <Input
                  id="promo-code"
                  value={details.code}
                  onChange={e =>
                    setDetails(d => ({ ...d, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="SUMMER20"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-status">Status</Label>
                <Select
                  value={details.status}
                  onValueChange={v =>
                    setDetails(d => ({ ...d, status: v as PromotionStatus }))
                  }
                >
                  <SelectTrigger id="promo-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="promo-desc">Description (optional)</Label>
                <Textarea
                  id="promo-desc"
                  value={details.description}
                  onChange={e =>
                    setDetails(d => ({ ...d, description: e.target.value }))
                  }
                  placeholder="Why this promotion runs, internal notes, …"
                  rows={3}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-start">Starts</Label>
                <Input
                  id="promo-start"
                  type="datetime-local"
                  value={details.start_date}
                  onChange={e =>
                    setDetails(d => ({ ...d, start_date: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-end" className="flex items-center justify-between gap-2">
                  <span>Ends</span>
                  <span className="inline-flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
                    Has end date
                    <Switch
                      checked={details.has_end_date}
                      onCheckedChange={v =>
                        setDetails(d => ({
                          ...d,
                          has_end_date: v,
                          end_date: v ? d.end_date : '',
                        }))
                      }
                    />
                  </span>
                </Label>
                <Input
                  id="promo-end"
                  type="datetime-local"
                  value={details.end_date}
                  onChange={e =>
                    setDetails(d => ({ ...d, end_date: e.target.value }))
                  }
                  disabled={!details.has_end_date}
                  placeholder="Runs until manually stopped"
                />
                {!details.has_end_date ? (
                  <p className="text-[11px] text-muted-foreground">
                    Promotion will run until you deactivate it manually.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-priority">Priority</Label>
                <Input
                  id="promo-priority"
                  type="number"
                  min={0}
                  value={details.priority}
                  onChange={e =>
                    setDetails(d => ({ ...d, priority: e.target.value }))
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Higher values are applied first when promotions stack.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="promo-max-usage">Max usage (optional)</Label>
                <Input
                  id="promo-max-usage"
                  type="number"
                  min={1}
                  value={details.max_usage}
                  onChange={e =>
                    setDetails(d => ({ ...d, max_usage: e.target.value }))
                  }
                  placeholder="Unlimited"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium">Stackable</p>
                  <p className="text-[11px] text-muted-foreground">
                    Allow this promotion to combine with other active promotions.
                  </p>
                </div>
                <Switch
                  checked={details.is_stackable}
                  onCheckedChange={v =>
                    setDetails(d => ({ ...d, is_stackable: v }))
                  }
                />
              </div>
            </div>
          ) : null}

          {step === 'channels' ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Sales channels</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Apply this promotion to the POS channels you check below.
                    The same per-product discount is mirrored to every channel.
                  </p>
                </div>

                {channelsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-md" />
                    ))}
                  </div>
                ) : channelsError ? (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle className="size-4" />
                    {channelsError}
                  </div>
                ) : channels.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No active POS channel under this brand. Create one first.
                  </div>
                ) : (
                  <ScrollArea className="max-h-[320px] rounded-md border">
                    <ul className="divide-y">
                      {channels.map(c => {
                        const checked = selectedChannels.includes(c.id);
                        return (
                          <li key={c.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={checked}
                                onChange={() => toggleChannel(c.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {c.name}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {c.code} · {c.channel_type}
                                </p>
                              </div>
                              {checked ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  Selected
                                </Badge>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                )}
              </div>

              {/* Review */}
              <div className="space-y-3 rounded-md border bg-card/60 p-3">
                <p className="text-xs font-medium text-muted-foreground">Review</p>
                <ReviewLine label="Name" value={details.name || '—'} />
                <ReviewLine
                  label="Schedule"
                  value={`${details.start_date.replace('T', ' ')} → ${
                    details.has_end_date && details.end_date
                      ? details.end_date.replace('T', ' ')
                      : 'no end date'
                  }`}
                />
                <ReviewLine label="Status" value={details.status} />
                <ReviewLine
                  label="Products"
                  value={`${selected.length} product${selected.length === 1 ? '' : 's'}`}
                />
                <ReviewLine
                  label="Channels"
                  value={`${selectedChannels.length} channel${selectedChannels.length === 1 ? '' : 's'}`}
                />
                <ReviewLine
                  label="Stackable"
                  value={details.is_stackable ? 'Yes' : 'No'}
                />
                {details.max_usage ? (
                  <ReviewLine label="Max usage" value={details.max_usage} />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={stepIndex === 0 || submitting}
            >
              <ChevronLeft className="size-4" /> Back
            </Button>
            {step !== 'channels' ? (
              <Button type="button" size="sm" onClick={goNext} disabled={!stepValid}>
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={submit}
                disabled={!stepValid || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {isEdit ? 'Saving…' : 'Creating…'}
                  </>
                ) : isEdit ? (
                  <>Save changes</>
                ) : (
                  <>Create {selected.length || ''} promotion{selected.length === 1 ? '' : 's'}</>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}
