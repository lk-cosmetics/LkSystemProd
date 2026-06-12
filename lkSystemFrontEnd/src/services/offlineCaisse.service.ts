/**
 * Offline cash-register (caisse) WRITE queue.
 *
 * The caisse *reads* (stats / history / expenses / deposits) stay available
 * offline through the service worker (NetworkFirst runtime cache — see
 * vite.config.ts). This module covers the *writes*: when a cashier records an
 * expense or an alimentation while offline — or a write fails on a flaky link —
 * the operation is persisted in IndexedDB and replayed to the backend on
 * reconnect. It mirrors the offline POS-ticket queue (offlinePOS.service.ts) so
 * the till stays accurate through a network outage.
 *
 * Reads are served from the SW cache; only writes need this explicit queue
 * because the SW deliberately does NOT cache/replay mutating requests.
 */
import {
  expenseService,
  cashDepositService,
  type ExpenseCreate,
  type CashDepositCreate,
} from './expense.service';

const DB_NAME = 'lk-system-caisse-offline';
const DB_VERSION = 1;
const STORE = 'pending_ops';
const CHANNEL_INDEX = 'by_channel';

export type PendingCaisseKind = 'expense' | 'deposit';

export interface PendingCaisseOp {
  /** Client-generated id, also the IndexedDB key. */
  local_id: string;
  kind: PendingCaisseKind;
  sales_channel: number;
  /** The exact payload to POST on sync. */
  payload: ExpenseCreate | CashDepositCreate;
  /** Denormalised for instant optimistic rendering without re-parsing payload. */
  amount: number;
  note: string;
  /** Human label (category or deposit-kind) for the pending row. */
  label: string;
  created_at: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let counter = 0;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'local_id' });
        store.createIndex(CHANNEL_INDEX, 'sales_channel', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message ?? 'IndexedDB request failed'));
  });
  return dbPromise;
}

function createLocalId(): string {
  counter += 1;
  // Date.now is fine in the browser; the counter disambiguates same-ms writes.
  return `caisse-${Date.now()}-${counter}`;
}

export const offlineCaisseService = {
  /** Build + persist a pending expense; returns the optimistic row. */
  async queueExpense(payload: ExpenseCreate, label: string): Promise<PendingCaisseOp> {
    const op: PendingCaisseOp = {
      local_id: createLocalId(),
      kind: 'expense',
      sales_channel: payload.sales_channel,
      payload,
      amount: Number(payload.amount) || 0,
      note: payload.note ?? '',
      label,
      created_at: new Date().toISOString(),
    };
    await put(op);
    return op;
  },

  /** Build + persist a pending alimentation; returns the optimistic row. */
  async queueDeposit(payload: CashDepositCreate, label: string): Promise<PendingCaisseOp> {
    const op: PendingCaisseOp = {
      local_id: createLocalId(),
      kind: 'deposit',
      sales_channel: payload.sales_channel,
      payload,
      amount: Number(payload.amount) || 0,
      note: payload.note ?? '',
      label,
      created_at: new Date().toISOString(),
    };
    await put(op);
    return op;
  },

  /** Pending ops for one channel, oldest first. */
  async listPending(channelId: number): Promise<PendingCaisseOp[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index(CHANNEL_INDEX).getAll(channelId);
      request.onsuccess = () =>
        resolve(
          (request.result as PendingCaisseOp[]).sort((a, b) =>
            a.created_at < b.created_at ? -1 : 1,
          ),
        );
      request.onerror = () => reject(new Error(request.error?.message ?? 'IndexedDB request failed'));
    });
  },

  /** Drop a single queued op (used when the cashier deletes a not-yet-synced row). */
  async remove(localId: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(tx.error?.message ?? 'IndexedDB transaction failed'));
    });
  },

  /**
   * Replay every queued op for a channel to the backend, oldest first. Each op
   * is best-effort and independent: a permanent failure (e.g. 400) is dropped
   * so it can't wedge the queue, a transient one (network) is kept for the next
   * attempt. Returns how many synced / were dropped / remain.
   */
  async sync(channelId: number): Promise<{ synced: number; dropped: number; remaining: number }> {
    const ops = await this.listPending(channelId);
    let synced = 0;
    let dropped = 0;
    for (const op of ops) {
      try {
        if (op.kind === 'expense') {
          await expenseService.create(op.payload as ExpenseCreate);
        } else {
          await cashDepositService.create(op.payload as CashDepositCreate);
        }
        await this.remove(op.local_id);
        synced += 1;
      } catch (err) {
        // Network/timeout (no HTTP response) → keep for the next reconnect.
        // A real server rejection (4xx/5xx with a response) → drop it so one
        // bad row can't block the rest of the till from syncing.
        const hasResponse = Boolean((err as { response?: unknown })?.response);
        if (hasResponse) {
          await this.remove(op.local_id);
          dropped += 1;
        }
      }
    }
    const remaining = (await this.listPending(channelId)).length;
    return { synced, dropped, remaining };
  },
};

async function put(op: PendingCaisseOp): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(op);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(tx.error?.message ?? 'IndexedDB transaction failed'));
  });
}

export default offlineCaisseService;
