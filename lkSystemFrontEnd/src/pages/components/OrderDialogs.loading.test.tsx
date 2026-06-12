import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '@/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/queries/useCompanies', () => ({
  useCurrentCompany: () => ({ data: undefined }),
}));

import { OrderDetailDialog } from './OrderDialogs';

const order = {
  id: 1,
  order_number: 'ORD-TEST-1',
  external_order_id: '1',
  source: 'MANUAL',
  status: 'new',
  status_display: 'New',
  sync_status: 'local',
  sync_status_display: 'Local',
  sync_error_message: '',
  is_deleted: false,
  in_store_pickup: false,
  lines: [],
  subtotal: '100.00',
  tax_total: '0.00',
  delivery_fee: '0.00',
  shipping_total: '0.00',
  discount_total: '0.00',
  total: '100.00',
  currency: 'TND',
  billing_address: {},
  shipping_address: {},
} as unknown as OrderDetail;

function ActionLoadingHarness() {
  const [busy, setBusy] = useState(false);

  return (
    <OrderDetailDialog
      open
      onOpenChange={() => undefined}
      order={order}
      isDetailLoading={false}
      isEditMode={false}
      editForm={null}
      editProducts={[]}
      loadingEditProducts={false}
      packagingProducts={[]}
      loadingPackagingProducts={false}
      savingEdit={false}
      mutatingOrder={busy}
      onStatusChange={() => undefined}
      onConfirmOrder={() => setBusy(true)}
      onNotAnswered={() => setBusy(true)}
      onDelayOrder={() => setBusy(true)}
      onRestoreDelayed={() => setBusy(true)}
      onCancelOrder={() => setBusy(true)}
      onOpenSendPOS={() => undefined}
      onSendDelivery={() => setBusy(true)}
      onProcessReturn={() => undefined}
      onPackageOrder={() => undefined}
      onUnpackageOrder={() => undefined}
      onEditModeChange={() => undefined}
      onUpdateLine={() => undefined}
      onUpdateLineProduct={() => undefined}
      onAddLine={() => undefined}
      onRemoveLine={() => undefined}
      onSaveEdit={() => undefined}
      onChangeDiscount={() => undefined}
      onChangeNote={() => undefined}
      onChangeBilling={() => undefined}
      onOpenLogs={() => undefined}
      onDelete={() => setBusy(true)}
      onRestore={() => setBusy(true)}
      permissions={{
        edit: false,
        confirm: true,
        delay: false,
        cancel: false,
        sendToPos: false,
        sendToDelivery: false,
        processReturn: false,
        packageOrder: false,
        delete: true,
        restore: false,
      }}
    />
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function renderHarness() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<ActionLoadingHarness />));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')]
    .find(element => element.textContent?.includes(label));
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

describe('OrderDetailDialog action loading', () => {
  it('shows a spinner only on Confirm when Confirm is clicked', () => {
    renderHarness();

    act(() => button('Confirm Order').click());

    expect(button('Confirm Order').disabled).toBe(true);
    expect(button('Confirm Order').querySelector('.animate-spin')).not.toBeNull();
    expect(button('Delete').disabled).toBe(true);
    expect(button('Delete').querySelector('.animate-spin')).toBeNull();
  });

  it('shows a spinner only on Delete when Delete is clicked', () => {
    renderHarness();

    act(() => button('Delete').click());

    expect(button('Delete').disabled).toBe(true);
    expect(button('Delete').querySelector('.animate-spin')).not.toBeNull();
    expect(button('Confirm Order').disabled).toBe(true);
    expect(button('Confirm Order').querySelector('.animate-spin')).toBeNull();
  });
});
