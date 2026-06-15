/**
 * OrderDetailController — the shared order-detail popup experience.
 *
 * Owns the full detail session: the `OrderDetailDialog` plus every sub-dialog it
 * can spawn (SendToPOS, Packaging, Return, Logs, Take-over, Stock-warning), the
 * working-lock lifecycle (acquire-on-open, heartbeat, take-over, release), the
 * edit form + product loading, and ALL lifecycle handlers — with the dialog's
 * own per-button loading (`activeAction` + `mutatingOrder`).
 *
 * It reuses the exact same dialog components as the Order Management page, so
 * the popup is identical on every page that mounts it. Permissions are derived
 * from the current user, so the same controller naturally shows a manager's full
 * action set or an employee's subset — no per-page branching.
 *
 * Usage (imperative): keep a ref and call `ref.current.open(orderId)`.
 *   const ctrl = useRef<OrderDetailControllerHandle>(null);
 *   <OrderDetailController ref={ctrl} channels={channels} onChanged={refresh} />
 *   // row click: ctrl.current?.open(order.id)
 */

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';

import { orderService } from '@/services/order.service';
import { productService } from '@/services/product.service';
import { useAuthStore } from '@/store/authStore';
import { hasPermission } from '@/hooks/useAuth';
import type {
  OrderDetail, OrderDiscountType, OrderEditLineInput, OrderEditRequest,
  OrderLogEntry, OrderStatus, ProductListItem, SalesChannel,
} from '@/types';
import type { ReturnLineCondition } from '@/services/order.service';

import {
  OrderDetailDialog, SendToPOSDialog, PackagingDialog, ReturnDialog, LogsDialog,
  MessageAlert, ALLOWED_NEXT_STATUSES,
} from './OrderDialogs';
import { getMissingStock, type MissingStockLine } from './orderStock';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

export interface OrderDetailControllerHandle {
  /** Open the detail popup on an order (acquires the working lock). */
  open: (id: number) => void;
  /** Open the detail popup and immediately reveal the audit log. */
  openWithLogs: (id: number) => void;
}

export interface OrderDetailControllerProps {
  /** Sales channels for brand lookups in edit/packaging product loads. */
  channels: SalesChannel[];
  /** Called after any mutation so the host list refreshes. */
  onChanged?: () => void | Promise<void>;
  /** Called when the popup fully closes (lock already released). */
  onClose?: () => void;
  /** Manager hosts can clear an active customer search when a billing edit
   *  changes the customer identity (so the row doesn't vanish from a filter). */
  onCustomerIdentityChanged?: () => void;
  /** Optional: reports when the popup is open or busy, so the host can pause
   *  auto-refresh. Fires true while a mutation, load, or any sub-dialog is up. */
  onBusyChange?: (busy: boolean) => void;
}

/** Self-contained error → message extractor (no host coupling). */
function extractErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const direct = d.detail ?? d.message ?? d.error;
    if (typeof direct === 'string' && direct) return direct;
    for (const v of Object.values(d)) {
      if (typeof v === 'string' && v) return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function OrderDetailControllerInner(
  { channels, onChanged, onClose, onCustomerIdentityChanged, onBusyChange }: OrderDetailControllerProps,
  ref: React.Ref<OrderDetailControllerHandle>,
) {
  const user = useAuthStore(s => s.user);

  /* ── detail / edit state ─── */
  const [viewOrder, setViewOrder] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editLockToken, setEditLockToken] = useState('');
  const [lockedByOther, setLockedByOther] = useState<{ user_name: string; user_id: number | null } | null>(null);
  const [takeoverInfo, setTakeoverInfo] = useState<{ orderId: number; userName: string } | null>(null);
  const lockRef = useRef<{ orderId: number; token: string } | null>(null);
  const [editForm, setEditForm] = useState<OrderEditRequest | null>(null);
  const [editProducts, setEditProducts] = useState<ProductListItem[]>([]);
  const [loadingEditProducts, setLoadingEditProducts] = useState(false);
  const [packagingProducts, setPackagingProducts] = useState<ProductListItem[]>([]);
  const [loadingPackagingProducts, setLoadingPackagingProducts] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [mutatingOrder, setMutatingOrder] = useState(false);
  const [actionFailures, setActionFailures] = useState<Record<number, number>>({});
  const bumpActionFailure = (id: number) =>
    setActionFailures(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  const resetActionFailure = (id: number) =>
    setActionFailures(prev => (prev[id] ? { ...prev, [id]: 0 } : prev));
  const [stockWarn, setStockWarn] = useState<{ title: string; items: MissingStockLine[]; onProceed: () => void } | null>(null);
  const [logsDialog, setLogsDialog] = useState(false);
  const [orderLogs, setOrderLogs] = useState<OrderLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [sendPOSDialog, setSendPOSDialog] = useState(false);
  const [sendPOSOrder, setSendPOSOrder] = useState<OrderDetail | null>(null);
  const [selectedPOSChannel, setSelectedPOSChannel] = useState('');
  const [posDestinations, setPosDestinations] = useState<SalesChannel[]>([]);
  const [sendingPOS, setSendingPOS] = useState(false);
  const [packagingDialogOpen, setPackagingDialogOpen] = useState(false);
  const [packagingDialogOrder, setPackagingDialogOrder] = useState<OrderDetail | null>(null);
  const [packagingDialogWarnings, setPackagingDialogWarnings] = useState<string[]>([]);
  const [packagingDialogProducts, setPackagingDialogProducts] = useState<ProductListItem[]>([]);
  const [loadingPackagingDialogProducts, setLoadingPackagingDialogProducts] = useState(false);
  const [returnOrder, setReturnOrder] = useState<OrderDetail | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  /* ── controller-private alerts (independent of any host alerts) ─── */
  const [successDialog, setSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorDialog, setErrorDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  /* ── permissions (same codenames as Order Management; user-scoped) ─── */
  const canUpdateUnconfirmedOrders = hasPermission(user, 'update_unconfirmed_orders');
  const canUpdateConfirmedOrders = hasPermission(user, 'update_confirmed_orders');
  const canConfirmOrders = hasPermission(user, 'confirm_orders');
  const canDelayOrders = hasPermission(user, 'delay_orders');
  const canCancelOrders = hasPermission(user, 'cancel_orders_lifecycle');
  const canSendToPos = hasPermission(user, 'send_to_pos_orders');
  const canSendToDelivery = hasPermission(user, 'send_to_delivery_orders');
  const canProcessReturn = hasPermission(user, 'process_return_orders');
  const canPackageOrders = canUpdateConfirmedOrders;
  const canSoftDelete = hasPermission(user, 'soft_delete_orders');
  const canRestoreDeleted = hasPermission(user, 'restore_soft_deleted_orders');
  const canManualOverride = hasPermission(user, 'manual_status_override');
  const canViewInvoices = hasPermission(user, 'view_invoices');
  const canEditInvoiceNumbers = hasPermission(user, 'edit_invoice_numbers');

  const notify = useCallback((msg: string) => { setSuccessMessage(msg); setSuccessDialog(true); }, []);
  const fail = useCallback((err: unknown, fallback: string) => {
    setErrorMessage(extractErrorMessage(err, fallback)); setErrorDialog(true);
  }, []);

  /* ── edit form snapshot (pure) ─── */
  const buildEditForm = (detail: OrderDetail): OrderEditRequest => {
    const customerLines = detail.customer_lines ?? detail.lines.filter(line => line.product_type !== 'packaging_item');
    return {
      lines: customerLines.map((l): OrderEditLineInput => ({
        id: l.id, product: l.product, product_name: l.product_name,
        barcode: l.barcode, quantity: l.quantity, unit_price: l.unit_price,
      })),
      discount_type: detail.discount_type,
      discount_value: detail.discount_value,
      delivery_fee: parseFloat(detail.delivery_fee) > 0 ? detail.delivery_fee : detail.shipping_total,
      customer_note: detail.customer_note,
      internal_note: detail.internal_note,
      billing_first_name: detail.billing_first_name,
      billing_last_name: detail.billing_last_name,
      billing_company: detail.billing_company,
      billing_email: detail.billing_email,
      billing_phone: detail.billing_phone,
      billing_address_1: detail.billing_address_1,
      billing_address_2: detail.billing_address_2,
      billing_city: detail.billing_city,
      billing_state: detail.billing_state,
      billing_postcode: detail.billing_postcode,
      billing_country: detail.billing_country,
      shipping_first_name: detail.shipping_first_name,
      shipping_last_name: detail.shipping_last_name,
      shipping_phone: detail.shipping_phone,
      shipping_address_1: detail.shipping_address_1,
      shipping_city: detail.shipping_city,
      shipping_state: detail.shipping_state,
      shipping_postcode: detail.shipping_postcode,
      shipping_country: detail.shipping_country,
    };
  };

  /* ── open / lock ─── */
  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    // Release any lock we still hold on a DIFFERENT order before acquiring a new
    // one, so switching orders never abandons a lock until its 90s TTL. Read the
    // live lockRef (not this callback's captured state) to avoid a stale token.
    const prior = lockRef.current;
    if (prior && prior.orderId !== id) {
      orderService.releaseEditLock(prior.orderId, prior.token).catch(() => undefined);
    }
    try {
      let lockResult: Awaited<ReturnType<typeof orderService.acquireEditLock>> | null = null;
      let heldBy: { user_name?: string | null; user_id?: number | null } | null = null;
      try {
        lockResult = await orderService.acquireEditLock(id, false);
      } catch (err: unknown) {
        const response = (err as { response?: { status?: number; data?: { lock?: { user_name?: string | null; user_id?: number | null } } } }).response;
        if (response?.status === 409) {
          heldBy = response.data?.lock ?? null;
        }
      }
      const detail = lockResult?.order ?? await orderService.getById(id);
      setViewOrder(detail);
      setEditMode(false);
      setEditForm(buildEditForm(detail));
      if (lockResult) {
        setEditLockToken(lockResult.lock.token);
        setLockedByOther(null);
      } else {
        setEditLockToken('');
        setLockedByOther({ user_name: heldBy?.user_name || 'another user', user_id: heldBy?.user_id ?? null });
      }
    } catch (err) {
      console.error('Failed to load order detail', err);
      fail(err, 'Failed to load order detail.');
    } finally {
      setDetailLoading(false);
    }
  }, [fail]);

  const closeDetail = useCallback(() => {
    if (viewOrder && editLockToken) {
      orderService.releaseEditLock(viewOrder.id, editLockToken).catch(() => undefined);
    }
    setEditLockToken('');
    setLockedByOther(null);
    setViewOrder(null);
    setDetailLoading(false);
    setEditMode(false);
    onClose?.();
  }, [viewOrder, editLockToken, onClose]);

  useImperativeHandle(ref, () => ({
    open: (id: number) => { void openDetail(id); },
    openWithLogs: (id: number) => { void openDetail(id).then(() => setLogsDialog(true)); },
  }), [openDetail]);

  const takeOverLock = async (id: number) => {
    try {
      const lockResult = await orderService.acquireEditLock(id, true);
      if (lockResult.order) {
        setViewOrder(lockResult.order);
        setEditForm(buildEditForm(lockResult.order));
      }
      setEditLockToken(lockResult.lock.token);
      setLockedByOther(null);
    } catch (err) {
      fail(err, 'Failed to take over this order.');
    }
  };

  const handleStatusChange = async (id: number, status: OrderStatus) => {
    try {
      const current = viewOrder?.id === id ? viewOrder.status : undefined;
      const onMatrix = current ? (ALLOWED_NEXT_STATUSES[current] ?? []).includes(status) : true;
      const updated = onMatrix
        ? await orderService.transitionStatus(id, status)
        : await orderService.manualTransition(id, status, 'Status changed manually from the order detail.');
      setViewOrder(updated);
      await onChanged?.();
    } catch (err) {
      console.error('Failed to update status', err);
      fail(err, 'Failed to update status.');
    }
  };

  const handleEditModeChange = (enabled: boolean) => {
    if (!viewOrder) return;
    setEditMode(enabled);
  };

  // Keep the lock alive while the popup is open; a genuine takeover by another
  // user drops us to read-only. Transient errors self-heal on the next tick.
  useEffect(() => {
    if (!viewOrder || !editLockToken) return undefined;
    const timer = window.setInterval(async () => {
      try {
        await orderService.heartbeatEditLock(viewOrder.id, editLockToken);
      } catch (err: unknown) {
        const response = (err as {
          response?: { status?: number; data?: { lock?: { user_id?: number | null; user_name?: string | null; locked?: boolean } } };
        }).response;
        const lock = response?.data?.lock;
        const takenOverByOther =
          response?.status === 409 && lock?.locked === true && lock?.user_id != null && lock.user_id !== user?.id;
        if (!takenOverByOther) return;
        setEditLockToken('');
        setEditMode(false);
        setLockedByOther({ user_name: lock?.user_name || 'another user', user_id: lock?.user_id ?? null });
        setErrorMessage(`This order was taken over by ${lock?.user_name || 'another user'}. You're now in read-only mode.`);
        setErrorDialog(true);
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [editLockToken, viewOrder?.id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lockRef.current = viewOrder && editLockToken ? { orderId: viewOrder.id, token: editLockToken } : null;
  }, [editLockToken, viewOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const release = () => {
      const l = lockRef.current;
      if (l) orderService.releaseEditLock(l.orderId, l.token).catch(() => undefined);
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, []);

  /* ── product loads (packaging + edit), brand-scoped ─── */
  useEffect(() => {
    if (!viewOrder) { setPackagingProducts([]); return; }
    const brandId = viewOrder.brand ?? channels.find(c => c.id === viewOrder.sales_channel)?.brand;
    if (!brandId) { setPackagingProducts([]); return; }
    setLoadingPackagingProducts(true);
    productService.getAllProducts({ brand: brandId, product_type: 'packaging_item', page_size: 500 })
      .then(products => setPackagingProducts(products || []))
      .catch(err => { console.error('Failed to load packaging products:', err); setPackagingProducts([]); })
      .finally(() => setLoadingPackagingProducts(false));
  }, [viewOrder?.id, viewOrder?.brand, viewOrder?.sales_channel, channels]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!packagingDialogOrder) { setPackagingDialogProducts([]); return; }
    const brandId = packagingDialogOrder.brand ?? channels.find(c => c.id === packagingDialogOrder.sales_channel)?.brand;
    if (!brandId) { setPackagingDialogProducts([]); return; }
    setLoadingPackagingDialogProducts(true);
    productService.getAllProducts({ brand: brandId, product_type: 'packaging_item', page_size: 500 })
      .then(products => setPackagingDialogProducts(products || []))
      .catch(err => { console.error('Failed to load packaging products:', err); setPackagingDialogProducts([]); })
      .finally(() => setLoadingPackagingDialogProducts(false));
  }, [packagingDialogOrder?.id, packagingDialogOrder?.brand, packagingDialogOrder?.sales_channel, channels]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editMode || !viewOrder) { setEditProducts([]); return; }
    const brandId = viewOrder.brand ?? channels.find(c => c.id === viewOrder.sales_channel)?.brand;
    if (!brandId) { setEditProducts([]); return; }
    setLoadingEditProducts(true);
    productService.getAllProducts({ brand: brandId, page_size: 500 })
      .then(products => setEditProducts((products || []).filter(product => product.product_type !== 'packaging_item')))
      .catch(err => { console.error('Failed to load edit products:', err); setEditProducts([]); })
      .finally(() => setLoadingEditProducts(false));
  }, [editMode, viewOrder, channels]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── edit handlers ─── */
  const updateEditLine = useCallback((index: number, key: 'quantity' | 'unit_price', value: string) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const lines = [...prev.lines];
      const cur = lines[index];
      if (!cur) return prev;
      if (key === 'quantity') {
        const qty = Number(value);
        lines[index] = { ...cur, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
      } else {
        lines[index] = { ...cur, unit_price: String(value || '0.00') };
      }
      return { ...prev, lines };
    });
  }, []);

  const updateEditLineProduct = useCallback((index: number, selectedValue: string) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const lines = [...prev.lines];
      const cur = lines[index];
      if (!cur) return prev;
      if (selectedValue === '__manual__') {
        lines[index] = {
          ...cur, product: null, product_name: cur.product_name ?? '',
          quantity: cur.quantity || 1, unit_price: cur.unit_price || '0.00', barcode: cur.barcode || '',
        };
        return { ...prev, lines };
      }
      const pid = Number(selectedValue);
      const selectedProduct = editProducts.find(x => x.id === pid);
      if (!selectedProduct) return prev;
      const dupIndex = lines.findIndex((l, i) => i !== index && l.product === selectedProduct.id);
      if (dupIndex !== -1) {
        const addQty = cur.quantity || 1;
        const merged = lines.map((l, i) => (i === dupIndex ? { ...l, quantity: (l.quantity || 1) + addQty } : l));
        merged.splice(index, 1);
        return { ...prev, lines: merged };
      }
      lines[index] = {
        ...cur, product: selectedProduct.id, product_name: selectedProduct.name,
        barcode: selectedProduct.barcode || cur.barcode || '', quantity: cur.quantity || 1,
        unit_price: String(selectedProduct.sales_price || cur.unit_price || '0.00'),
      };
      return { ...prev, lines };
    });
  }, [editProducts]);

  const handleAddLine = useCallback(() => {
    setEditForm(prev => prev ? {
      ...prev, lines: [...prev.lines, { product: null, product_name: '', barcode: '', quantity: 1, unit_price: '0.00' }],
    } : prev);
  }, []);

  const handleRemoveLine = useCallback((index: number) => {
    setEditForm(prev => {
      if (!prev || prev.lines.length <= 1) return prev;
      return { ...prev, lines: prev.lines.filter((_, i) => i !== index) };
    });
  }, []);

  const handleSaveEdit = async () => {
    if (!viewOrder || !editForm) return;
    if (editForm.lines.some(l => !l.product && !(l.product_name ?? '').trim())) {
      fail(null, 'Each line must have either a product or a name.');
      return;
    }
    setSavingEdit(true);
    try {
      const payload: OrderEditRequest = {
        ...editForm,
        discount_type: (editForm.discount_type ?? 'NONE') as OrderDiscountType,
        discount_value: editForm.discount_value ?? '0.00',
        lines: editForm.lines.map(l => ({
          id: l.id, product: l.product, product_name: l.product_name, barcode: l.barcode,
          quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1, unit_price: String(l.unit_price ?? '0'),
        })),
      };
      const customerIdentityChanged = (
        (payload.billing_first_name ?? '') !== (viewOrder.billing_first_name ?? '')
        || (payload.billing_last_name ?? '') !== (viewOrder.billing_last_name ?? '')
        || (payload.billing_email ?? '') !== (viewOrder.billing_email ?? '')
        || (payload.billing_phone ?? '') !== (viewOrder.billing_phone ?? '')
      );
      const updated = await orderService.editOrder(viewOrder.id, payload);
      setViewOrder(updated);
      setEditMode(false);
      if (customerIdentityChanged) {
        // A manager host clears its customer search so the row stays visible;
        // every host still refreshes its list so the edit shows immediately.
        onCustomerIdentityChanged?.();
        await onChanged?.();
        notify('Order updated. Customer search was cleared to keep the order visible.');
      } else {
        await onChanged?.();
        notify('Order updated successfully.');
      }
    } catch (err) {
      fail(err, 'Failed to update order.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      await orderService.softDelete(viewOrder.id, 'Deleted from order detail');
      closeDetail();
      await onChanged?.();
      notify('Order soft-deleted.');
    } catch (err) {
      fail(err, 'Failed to delete.');
    } finally { setMutatingOrder(false); }
  };

  const handleRestoreOrder = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      const restored = await orderService.restore(viewOrder.id);
      setViewOrder(restored);
      await onChanged?.();
      notify('Order restored.');
    } catch (err) {
      fail(err, 'Failed to restore.');
    } finally { setMutatingOrder(false); }
  };

  const handleCreateInvoice = async () => {
    if (!viewOrder) return;
    setMutatingOrder(true);
    try {
      const updated = await orderService.createInvoice(viewOrder.id);
      setViewOrder(updated);
      await onChanged?.();
    } catch (err) {
      fail(err, 'Failed to create invoice.');
      throw err;
    } finally {
      setMutatingOrder(false);
    }
  };

  const handleUpdateInvoice = async (payload: Parameters<typeof orderService.updateInvoice>[1]) => {
    if (!viewOrder) return;
    const updated = await orderService.updateInvoice(viewOrder.id, payload);
    setViewOrder(updated);
    await onChanged?.();
  };

  const handleOpenLogs = async () => {
    if (!viewOrder) return;
    setLoadingLogs(true); setLogsDialog(true);
    try {
      setOrderLogs(await orderService.getLogs(viewOrder.id));
    } catch (err) {
      fail(err, 'Failed to load logs.');
      setLogsDialog(false);
    } finally { setLoadingLogs(false); }
  };

  /* ── order outcome handlers ─── */
  const handleConfirmOrder = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.confirmOrder(id);
      setViewOrder(updated);
      await onChanged?.();
      resetActionFailure(id);
      notify('Order confirmed successfully.');
    } catch (err) {
      bumpActionFailure(id);
      fail(err, 'Failed to confirm order.');
    } finally { setMutatingOrder(false); }
  };

  const handleNotAnswered = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.markNotAnswered(id);
      setViewOrder(updated);
      await onChanged?.();
      const attempts = updated.not_answered_attempts ?? 0;
      notify(attempts >= 3
        ? `No answer recorded (${attempts} attempts). Consider delaying the order for a later follow-up.`
        : `No answer recorded (${attempts} attempt${attempts === 1 ? '' : 's'}).`);
    } catch (err) {
      fail(err, 'Failed to record no-answer attempt.');
    } finally { setMutatingOrder(false); }
  };

  const handleDelayOrder = async (id: number, data: { delay_date: string; delay_reason: string; note?: string }) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.delayOrder(id, data);
      setViewOrder(updated);
      await onChanged?.();
      resetActionFailure(id);
      notify('Order marked as delayed.');
    } catch (err) {
      bumpActionFailure(id);
      fail(err, 'Failed to delay order.');
    } finally { setMutatingOrder(false); }
  };

  const handleRestoreDelayed = async (id: number) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.restoreDelayed(id);
      setViewOrder(updated);
      await onChanged?.();
      notify('Delayed order restored to pending.');
    } catch (err) {
      fail(err, 'Failed to restore delayed order.');
    } finally { setMutatingOrder(false); }
  };

  const handleCancelOrder = async (id: number, data: { cancellation_reason: string; note?: string }) => {
    setMutatingOrder(true);
    try {
      const updated = await orderService.cancelOrder(id, data);
      setViewOrder(updated);
      await onChanged?.();
      notify('Order cancelled.');
    } catch (err) {
      fail(err, 'Failed to cancel order.');
    } finally { setMutatingOrder(false); }
  };

  const runLifecycleAction = async (
    action: () => Promise<OrderDetail | unknown>,
    success: string,
    reloadDetail = false,
  ) => {
    setMutatingOrder(true);
    try {
      const result = await action();
      if (reloadDetail && viewOrder) {
        setViewOrder(await orderService.getById(viewOrder.id));
      } else if (result && typeof result === 'object' && 'id' in result) {
        setViewOrder(result as OrderDetail);
      }
      await onChanged?.();
      notify(success);
    } catch (err) {
      fail(err, 'Order action failed.');
    } finally {
      setMutatingOrder(false);
    }
  };

  /* ── send to POS ─── */
  const openSendPOSDialog = async (order: OrderDetail) => {
    setSendingPOS(false);
    setSelectedPOSChannel('');
    setPosDestinations([]);
    setSendPOSDialog(true);
    try {
      setMutatingOrder(true);
      setSendPOSOrder(order);
      // Offer every active same-brand channel as a destination (backend re-checks).
      const dests = await orderService.getPosDestinations(order.id);
      setPosDestinations(dests);
    } catch (err) {
      setSendPOSDialog(false);
      fail(err, 'Failed to load order before POS routing.');
    } finally {
      setMutatingOrder(false);
    }
  };

  const handleSendPOS = async () => {
    if (!sendPOSOrder || !selectedPOSChannel) return;
    setSendingPOS(true);
    try {
      const updated = await orderService.sendToPOS(sendPOSOrder.id, Number(selectedPOSChannel));
      setSendPOSDialog(false);
      setSendPOSOrder(null);
      setSelectedPOSChannel('');
      if (viewOrder?.id === updated.id) setViewOrder(updated);
      await onChanged?.();
      notify('Order sent to the selected POS location. Status remains Confirmed.');
    } catch (err) {
      fail(err, 'Failed to send order to POS.');
    } finally {
      setSendingPOS(false);
    }
  };

  /* ── delivery + stock guard ─── */
  const handleSubmitDelivery = async (id: number, force = false) => {
    setMutatingOrder(true);
    try {
      await orderService.submitDelivery(id, { force });
      const detail = await orderService.getById(id);
      if (viewOrder?.id === id) setViewOrder(detail);
      await onChanged?.();
      if (canPackageOrders) {
        if (viewOrder?.id === id && editLockToken) {
          orderService.releaseEditLock(id, editLockToken).catch(() => undefined);
          setEditLockToken('');
        }
        setViewOrder(null);
        setDetailLoading(false);
        setEditMode(false);
        setPackagingDialogWarnings([]);
        setPackagingDialogOrder(detail);
        setPackagingDialogOpen(true);
      } else {
        notify('Order sent to delivery and response saved.');
      }
    } catch (err) {
      fail(err, 'Failed to send the order to delivery.');
    } finally {
      setMutatingOrder(false);
    }
  };

  const guardStock = (id: number, title: string, run: (forced: boolean) => void) => {
    const ord = viewOrder?.id === id ? viewOrder : undefined;
    const missing = ord ? getMissingStock(ord) : [];
    if (missing.length > 0) {
      setStockWarn({ title, items: missing, onProceed: () => run(true) });
    } else {
      run(false);
    }
  };
  const submitDeliveryWithStockGuard = (id: number) =>
    guardStock(id, 'Send to delivery with missing products?', forced => handleSubmitDelivery(id, forced));

  /* ── packaging popup ─── */
  const handlePackageFromDialog = async (
    items: Array<{ product_id: number; quantity: number }>,
    allowUpdate: boolean,
  ) => {
    if (!packagingDialogOrder) return;
    const targetId = packagingDialogOrder.id;
    setMutatingOrder(true);
    try {
      const updated = await orderService.packageOrder(targetId, { packaging_items: items, allow_update: allowUpdate });
      if (viewOrder?.id === targetId) setViewOrder(updated);
      await onChanged?.();
      setPackagingDialogOpen(false);
      setPackagingDialogOrder(null);
      setPackagingDialogWarnings([]);
      notify('Packaging saved, packaging stock adjusted, and order marked done.');
    } catch (err) {
      fail(err, 'Could not save packaging.');
    } finally {
      setMutatingOrder(false);
    }
  };

  const handleUnpackageFromDialog = async () => {
    if (!packagingDialogOrder) return;
    if (!window.confirm('Reverse packaging stock movements for this order?')) return;
    const targetId = packagingDialogOrder.id;
    setMutatingOrder(true);
    try {
      const updated = await orderService.unpackageOrder(targetId);
      if (viewOrder?.id === targetId) setViewOrder(updated);
      setPackagingDialogOrder(updated);
      await onChanged?.();
    } catch (err) {
      fail(err, 'Could not reverse packaging.');
    } finally {
      setMutatingOrder(false);
    }
  };

  /* ── return ─── */
  const handleProcessReturn = async (id: number) => {
    let detail = viewOrder && viewOrder.id === id ? viewOrder : null;
    if (!detail) {
      try {
        detail = await orderService.getById(id);
      } catch (err) {
        fail(err, 'Could not load the order to process its return.');
        return;
      }
    }
    setReturnOrder(detail);
    setReturnDialogOpen(true);
  };

  const handleConfirmReturn = async (payload: {
    returnReason: string;
    returnType: 'RETURNED' | 'EXCHANGED' | 'DAMAGED' | 'MISSING' | 'OTHER';
    lineConditions: ReturnLineCondition[];
  }) => {
    if (!returnOrder) return;
    const targetId = returnOrder.id;
    await runLifecycleAction(
      () => orderService.processReturn(targetId, payload),
      'Return processed: good items restocked, damaged items written off.',
    );
    setReturnDialogOpen(false);
    setReturnOrder(null);
  };

  const handlePackageOrder = async (
    id: number,
    items: Array<{ product_id: number; quantity: number }>,
    allowUpdate: boolean,
  ) => {
    await runLifecycleAction(
      () => orderService.packageOrder(id, { packaging_items: items, allow_update: allowUpdate }),
      'Packaging saved, packaging stock adjusted, and order marked done.',
    );
  };

  const handleUnpackageOrder = async (id: number) => {
    if (!window.confirm('Reverse packaging stock movements for this order?')) return;
    await runLifecycleAction(
      () => orderService.unpackageOrder(id),
      'Packaging reversed and packaging stock restored.',
    );
  };

  /* ── report busy/open so a host can pause auto-refresh ─── */
  const busy = !!viewOrder || detailLoading || mutatingOrder || savingEdit
    || sendPOSDialog || packagingDialogOpen || returnDialogOpen || logsDialog
    || !!stockWarn || !!takeoverInfo;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  return (
    <>
      <OrderDetailDialog
        open={detailLoading || !!viewOrder}
        onOpenChange={(open) => { if (!open) closeDetail(); }}
        order={viewOrder}
        isDetailLoading={detailLoading}
        isEditMode={editMode}
        editForm={editForm}
        editProducts={editProducts}
        loadingEditProducts={loadingEditProducts}
        packagingProducts={packagingProducts}
        loadingPackagingProducts={loadingPackagingProducts}
        savingEdit={savingEdit}
        mutatingOrder={mutatingOrder}
        failedActionAttempts={viewOrder ? (actionFailures[viewOrder.id] ?? 0) : 0}
        isLockOwner={!!editLockToken}
        lockedByName={lockedByOther?.user_name ?? null}
        onTakeOver={() => { if (viewOrder) setTakeoverInfo({ orderId: viewOrder.id, userName: lockedByOther?.user_name || 'another user' }); }}
        onStatusChange={handleStatusChange}
        onConfirmOrder={handleConfirmOrder}
        onNotAnswered={handleNotAnswered}
        onDelayOrder={handleDelayOrder}
        onRestoreDelayed={handleRestoreDelayed}
        onCancelOrder={handleCancelOrder}
        onOpenSendPOS={openSendPOSDialog}
        onSendDelivery={submitDeliveryWithStockGuard}
        onProcessReturn={handleProcessReturn}
        onPackageOrder={handlePackageOrder}
        onUnpackageOrder={handleUnpackageOrder}
        onEditModeChange={handleEditModeChange}
        onUpdateLine={updateEditLine}
        onUpdateLineProduct={updateEditLineProduct}
        onAddLine={handleAddLine}
        onRemoveLine={handleRemoveLine}
        onSaveEdit={handleSaveEdit}
        onChangeDiscount={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field === 'type' ? 'discount_type' : 'discount_value']: val } : prev);
        }}
        onChangeNote={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field === 'customer' ? 'customer_note' : 'internal_note']: val } : prev);
        }}
        onChangeBilling={(field, val) => {
          setEditForm(prev => prev ? { ...prev, [field]: val } : prev);
        }}
        onOpenLogs={handleOpenLogs}
        onDelete={handleSoftDelete}
        onRestore={handleRestoreOrder}
        onCreateInvoice={handleCreateInvoice}
        onUpdateInvoice={handleUpdateInvoice}
        permissions={{
          edit: !!editLockToken && (viewOrder ? (['confirmed', 'packaging', 'done'].includes(viewOrder.status) ? canUpdateConfirmedOrders : canUpdateUnconfirmedOrders) : false),
          confirm: !!editLockToken && canConfirmOrders,
          delay: !!editLockToken && canDelayOrders,
          cancel: !!editLockToken && canCancelOrders,
          sendToPos: !!editLockToken && canSendToPos,
          sendToDelivery: !!editLockToken && canSendToDelivery,
          processReturn: !!editLockToken && canProcessReturn,
          packageOrder: !!editLockToken && canPackageOrders,
          delete: !!editLockToken && canSoftDelete,
          restore: !!editLockToken && canRestoreDeleted,
          manualOverride: !!editLockToken && canManualOverride,
          viewInvoice: canViewInvoices,
          editInvoice: canEditInvoiceNumbers,
        }}
      />

      <SendToPOSDialog
        open={sendPOSDialog}
        onOpenChange={(open) => {
          setSendPOSDialog(open);
          if (!open) { setSendPOSOrder(null); setSelectedPOSChannel(''); setPosDestinations([]); }
        }}
        order={sendPOSOrder}
        channels={posDestinations}
        selectedChannelId={selectedPOSChannel}
        onChannelChange={setSelectedPOSChannel}
        onSubmit={handleSendPOS}
        isLoading={sendingPOS || mutatingOrder}
      />

      <PackagingDialog
        open={packagingDialogOpen}
        onOpenChange={(open) => {
          setPackagingDialogOpen(open);
          if (!open) { setPackagingDialogOrder(null); setPackagingDialogWarnings([]); }
        }}
        order={packagingDialogOrder}
        packagingProducts={packagingDialogProducts}
        loadingPackagingProducts={loadingPackagingDialogProducts}
        isLoading={mutatingOrder}
        canPackage={canPackageOrders}
        warnings={packagingDialogWarnings}
        onPackageOrder={handlePackageFromDialog}
        onUnpackageOrder={handleUnpackageFromDialog}
      />

      <ReturnDialog
        open={returnDialogOpen}
        onOpenChange={(open) => { setReturnDialogOpen(open); if (!open) setReturnOrder(null); }}
        order={returnOrder}
        onSubmit={handleConfirmReturn}
        isLoading={mutatingOrder}
      />

      <LogsDialog
        open={logsDialog} onOpenChange={setLogsDialog}
        orderNumber={viewOrder?.order_number} logs={orderLogs} isLoading={loadingLogs}
      />

      {/* Take-over confirmation shown when the order is locked by another user */}
      <Dialog open={!!takeoverInfo} onOpenChange={(open) => { if (!open) setTakeoverInfo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take over this order?</DialogTitle>
            <DialogDescription>
              This order is currently being handled by{' '}
              <span className="font-semibold text-foreground">{takeoverInfo?.userName}</span>.
              {' '}Taking over ends their session and makes you the sole handler. This is logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTakeoverInfo(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const id = takeoverInfo?.orderId;
                setTakeoverInfo(null);
                if (id != null) void takeOverLock(id);
              }}
            >
              Yes, take over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Missing-stock review — shown before Send-delivery proceeds. */}
      <Dialog open={!!stockWarn} onOpenChange={(open) => { if (!open) setStockWarn(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="size-5" /> {stockWarn?.title}
            </DialogTitle>
            <DialogDescription>
              This order has products that aren't fully in stock on its fulfilment channel:
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
            {(stockWarn?.items ?? []).map(it => (
              <li key={it.name} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{it.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  required <span className="font-semibold text-foreground">{it.required}</span>,
                  available <span className={`font-semibold ${it.available <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>{it.available}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Are you sure you want to continue anyway?</p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setStockWarn(null)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => { const proceed = stockWarn?.onProceed; setStockWarn(null); proceed?.(); }}
            >
              Continue anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MessageAlert open={successDialog} onOpenChange={setSuccessDialog} type="success" message={successMessage} />
      <MessageAlert open={errorDialog} onOpenChange={setErrorDialog} type="error" message={errorMessage} />
    </>
  );
}

export const OrderDetailController = forwardRef(OrderDetailControllerInner);
