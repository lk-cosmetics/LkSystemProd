import type {
  POSOrderCreateRequest,
  POSProductCacheResponse,
  POSProductStockSnapshot,
  PromotionListItem,
  ProductListItem,
} from '@/types';

const DB_NAME = 'lk-system-pos-offline';
const DB_VERSION = 2;
const PRODUCT_STORE = 'products';
const META_STORE = 'cache_meta';
const TICKET_STORE = 'tickets';
const PROMOTION_STORE = 'promotions';

/**
 * Wall-clock truth for "is this promotion live right now?".
 *
 * The backend serializer's ``is_currently_active`` is computed once at
 * response time and frozen into IndexedDB by ``savePromotions``. That stale
 * boolean can drop in/out of correctness between cache refreshes (e.g. a
 * promotion crosses its ``start_date`` or ``end_date``), so we recompute
 * the predicate at *read* time from raw fields. ``end_date`` may be null
 * — that means "no upper bound" (run until manually deactivated).
 */
export function isPromotionLive(
  promo: Pick<PromotionListItem, 'is_active' | 'start_date' | 'end_date'>,
  now: Date = new Date(),
): boolean {
  if (promo.is_active === false) return false;
  if (promo.start_date) {
    const start = new Date(promo.start_date);
    if (!Number.isNaN(start.getTime()) && start > now) return false;
  }
  if (promo.end_date) {
    const end = new Date(promo.end_date);
    if (!Number.isNaN(end.getTime()) && end < now) return false;
  }
  return true;
}

type OfflineTicketStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface CachedPOSProduct extends ProductListItem {
  cache_key: string;
  sales_channel: number;
  sales_channel_name: string;
  offline_stock: POSProductStockSnapshot;
  cached_at: string;
}

export interface OfflineTicket {
  ticket_id: string;
  client_ticket_uuid: string;
  sales_channel: number;
  payload: POSOrderCreateRequest;
  created_at: string;
  status: OfflineTicketStatus;
  synced_at?: string | null;
  backend_order_id?: number | null;
  last_error?: string;
}

export interface CachedPOSPromotion extends PromotionListItem {
  cache_key: string;
  sales_channel: number;
  cached_at: string;
}

interface OfflineTicketDraft {
  ticket_id: string;
  client_ticket_uuid: string;
  sales_channel: number;
  payload: POSOrderCreateRequest;
  created_at: string;
}

interface CartLikeLine {
  product: ProductListItem;
  quantity: number;
}

function buildStockRequirements(cart: CartLikeLine[], productMap: Map<number, CachedPOSProduct>) {
  const requirements = new Map<number, {
    product: CachedPOSProduct | undefined;
    quantity: number;
    packName?: string;
  }>();
  const problems: string[] = [];

  cart.forEach(line => {
    const product = productMap.get(line.product.id);
    if (!product) {
      problems.push(`${line.product.name}: produit non disponible en cache offline.`);
      return;
    }

    if (product.is_pack) {
      if (!product.pack_items?.length) {
        problems.push(`Impossible de vendre ce pack ${product.name}: composant manquant.`);
        return;
      }

      product.pack_items.forEach(item => {
        const component = productMap.get(item.product_id);
        const required = Math.max(1, Number(item.quantity || 1)) * line.quantity;
        if (!component) {
          problems.push(`Impossible de vendre ce pack ${product.name}: composant manquant.`);
          return;
        }
        const current = requirements.get(component.id) ?? {
          product: component,
          quantity: 0,
          packName: product.name,
        };
        current.quantity += required;
        requirements.set(component.id, current);
      });
      return;
    }

    const current = requirements.get(product.id) ?? {
      product,
      quantity: 0,
    };
    current.quantity += line.quantity;
    requirements.set(product.id, current);
  });

  return { requirements, problems };
}

interface CacheMeta {
  sales_channel: number;
  sales_channel_name: string;
  brand: number | null;
  brand_name: string | null;
  last_sync: string;
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        const productStore = db.createObjectStore(PRODUCT_STORE, {
          keyPath: 'cache_key',
        });
        productStore.createIndex('sales_channel', 'sales_channel', {
          unique: false,
        });
        productStore.createIndex('barcode', 'barcode', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'sales_channel' });
      }

      if (!db.objectStoreNames.contains(TICKET_STORE)) {
        const ticketStore = db.createObjectStore(TICKET_STORE, {
          keyPath: 'client_ticket_uuid',
        });
        ticketStore.createIndex('status', 'status', { unique: false });
        ticketStore.createIndex('sales_channel', 'sales_channel', {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(PROMOTION_STORE)) {
        const promotionStore = db.createObjectStore(PROMOTION_STORE, {
          keyPath: 'cache_key',
        });
        promotionStore.createIndex('sales_channel', 'sales_channel', {
          unique: false,
        });
        promotionStore.createIndex('product', 'product', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getAllFromStore = async <T>(
  storeName: string,
  mode: IDBTransactionMode = 'readonly'
): Promise<T[]> => {
  const db = await openDB();
  try {
    const transaction = db.transaction(storeName, mode);
    const rows = await requestToPromise<T[]>(
      transaction.objectStore(storeName).getAll()
    );
    return rows;
  } finally {
    db.close();
  }
};

const makeProductCacheKey = (salesChannelId: number, productId: number) =>
  `${salesChannelId}:${productId}`;

const makePromotionCacheKey = (salesChannelId: number, promotionId: number) =>
  `${salesChannelId}:${promotionId}`;

const getTodayCounterKey = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `lk-pos-ticket-counter:${y}${m}${d}`;
};

export const createOfflineTicketIdentity = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const counterKey = getTodayCounterKey();
  const next = Number(localStorage.getItem(counterKey) || '0') + 1;
  localStorage.setItem(counterKey, String(next));

  const ticket_id = `${day}${month}${year}${String(next).padStart(4, '0')}`;
  const browserCrypto = globalThis.crypto;
  const random =
    browserCrypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    ticket_id,
    client_ticket_uuid: `offline-${ticket_id}-${random}`,
  };
};

export const offlinePOSService = {
  async saveProductSnapshot(snapshot: POSProductCacheResponse): Promise<void> {
    const db = await openDB();
    try {
      const transaction = db.transaction(
        [PRODUCT_STORE, META_STORE],
        'readwrite'
      );
      const productStore = transaction.objectStore(PRODUCT_STORE);
      const metaStore = transaction.objectStore(META_STORE);

      const existing = await requestToPromise<CachedPOSProduct[]>(
        productStore.index('sales_channel').getAll(snapshot.sales_channel)
      );
      existing.forEach(product => productStore.delete(product.cache_key));

      snapshot.products.forEach(product => {
        const cached: CachedPOSProduct = {
          ...product,
          cache_key: makeProductCacheKey(snapshot.sales_channel, product.id),
          sales_channel: snapshot.sales_channel,
          sales_channel_name: snapshot.sales_channel_name,
          offline_stock: product.stock,
          cached_at: snapshot.last_sync,
        };
        productStore.put(cached);
      });

      const meta: CacheMeta = {
        sales_channel: snapshot.sales_channel,
        sales_channel_name: snapshot.sales_channel_name,
        brand: snapshot.brand,
        brand_name: snapshot.brand_name,
        last_sync: snapshot.last_sync,
      };
      metaStore.put(meta);

      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },

  async getCachedProducts(salesChannelId: number): Promise<CachedPOSProduct[]> {
    const rows = await getAllFromStore<CachedPOSProduct>(PRODUCT_STORE);
    return rows
      .filter(product => product.sales_channel === salesChannelId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getCacheMeta(salesChannelId: number): Promise<CacheMeta | null> {
    const db = await openDB();
    try {
      const transaction = db.transaction(META_STORE, 'readonly');
      const row = await requestToPromise<CacheMeta | undefined>(
        transaction.objectStore(META_STORE).get(salesChannelId)
      );
      return row ?? null;
    } finally {
      db.close();
    }
  },

  async savePromotions(
    salesChannelId: number,
    promotions: PromotionListItem[]
  ): Promise<void> {
    const db = await openDB();
    try {
      const transaction = db.transaction(PROMOTION_STORE, 'readwrite');
      const store = transaction.objectStore(PROMOTION_STORE);
      const existing = await requestToPromise<CachedPOSPromotion[]>(
        store.index('sales_channel').getAll(salesChannelId)
      );
      existing.forEach(promotion => store.delete(promotion.cache_key));
      const cachedAt = new Date().toISOString();

      promotions.forEach(promotion => {
        store.put({
          ...promotion,
          cache_key: makePromotionCacheKey(salesChannelId, promotion.id),
          sales_channel: salesChannelId,
          cached_at: cachedAt,
        });
      });

      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },

  async getCachedPromotions(salesChannelId: number): Promise<CachedPOSPromotion[]> {
    const rows = await getAllFromStore<CachedPOSPromotion>(PROMOTION_STORE);
    const now = new Date();
    return rows
      .filter(promotion => promotion.sales_channel === salesChannelId)
      .filter(promotion => isPromotionLive(promotion, now))
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  },

  async validateLocalStock(salesChannelId: number, cart: CartLikeLine[]) {
    const cachedProducts = await this.getCachedProducts(salesChannelId);
    const productMap = new Map(cachedProducts.map(product => [product.id, product]));
    const { requirements, problems } = buildStockRequirements(cart, productMap);

    requirements.forEach(({ product, quantity, packName }) => {
      const available = product?.offline_stock.available_quantity ?? 0;
      if (!product || quantity > available) {
        problems.push(
          packName
            ? `Stock insuffisant pour le pack ${packName}. Le produit ${product?.name ?? 'composant'} est insuffisant (${available} disponible, ${quantity} demandé).`
            : `${product?.name ?? 'Produit'}: stock insuffisant (${available} disponible, ${quantity} demandé).`
        );
      }
    });

    return {
      ok: problems.length === 0,
      message: problems.join('\n'),
    };
  },

  async queueTicketAndApplySale(
    draft: OfflineTicketDraft,
    cart: CartLikeLine[]
  ): Promise<OfflineTicket> {
    const db = await openDB();
    try {
      const transaction = db.transaction(
        [PRODUCT_STORE, TICKET_STORE],
        'readwrite'
      );
      const productStore = transaction.objectStore(PRODUCT_STORE);
      const ticketStore = transaction.objectStore(TICKET_STORE);

      const existingTicket = await requestToPromise<OfflineTicket | undefined>(
        ticketStore.get(draft.client_ticket_uuid)
      );
      if (existingTicket) return existingTicket;

      const cachedProducts = await Promise.all(cart.map(async line => {
        return requestToPromise<CachedPOSProduct | undefined>(
          productStore.get(makeProductCacheKey(draft.sales_channel, line.product.id))
        );
      }));
      const baseProductMap = new Map(
        cachedProducts
          .filter((product): product is CachedPOSProduct => Boolean(product))
          .map(product => [product.id, product])
      );

      for (const product of cachedProducts) {
        if (!product?.pack_items?.length) continue;
        for (const item of product.pack_items) {
          if (baseProductMap.has(item.product_id)) continue;
          const component = await requestToPromise<CachedPOSProduct | undefined>(
            productStore.get(makeProductCacheKey(draft.sales_channel, item.product_id))
          );
          if (component) baseProductMap.set(component.id, component);
        }
      }

      const { requirements, problems } = buildStockRequirements(cart, baseProductMap);
      if (problems.length) {
        throw new Error(problems.join('\n'));
      }

      for (const { product: cached, quantity, packName } of requirements.values()) {
        if (!cached) {
          throw new Error('Impossible de vendre ce pack: composant manquant.');
        }
        const available = cached.offline_stock.available_quantity;
        if (quantity > available) {
          throw new Error(
            packName
              ? `Stock insuffisant pour le pack ${packName}. Le produit ${cached.name} est insuffisant (${available} disponible).`
              : `${cached.name}: stock insuffisant (${available} disponible).`
          );
        }

        const nextQuantity = Math.max(0, cached.offline_stock.quantity - quantity);
        const nextAvailable = Math.max(
          0,
          cached.offline_stock.available_quantity - quantity
        );

        productStore.put({
          ...cached,
          offline_stock: {
            ...cached.offline_stock,
            quantity: nextQuantity,
            available_quantity: nextAvailable,
            updated_at: new Date().toISOString(),
          },
          cached_at: new Date().toISOString(),
        });
      }

      const ticket: OfflineTicket = {
        ...draft,
        payload: {
          ...draft.payload,
          ticket_id: draft.ticket_id,
          client_ticket_uuid: draft.client_ticket_uuid,
        },
        status: 'PENDING',
        synced_at: null,
        backend_order_id: null,
      };
      ticketStore.put(ticket);

      await transactionDone(transaction);
      return ticket;
    } finally {
      db.close();
    }
  },

  async getPendingTickets(): Promise<OfflineTicket[]> {
    const rows = await getAllFromStore<OfflineTicket>(TICKET_STORE);
    return rows
      .filter(ticket =>
        ticket.status === 'PENDING' ||
        ticket.status === 'FAILED' ||
        ticket.status === 'SYNCING'
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  async getPendingCount(): Promise<number> {
    const tickets = await this.getPendingTickets();
    return tickets.length;
  },

  async markTicketSyncing(ticket: OfflineTicket): Promise<void> {
    await this.updateTicket({
      ...ticket,
      status: 'SYNCING',
      last_error: '',
    });
  },

  async markTicketSynced(
    ticket: OfflineTicket,
    backendOrderId: number
  ): Promise<void> {
    await this.updateTicket({
      ...ticket,
      status: 'SYNCED',
      synced_at: new Date().toISOString(),
      backend_order_id: backendOrderId,
      last_error: '',
    });
  },

  async markTicketFailed(ticket: OfflineTicket, message: string): Promise<void> {
    await this.updateTicket({
      ...ticket,
      status: 'FAILED',
      last_error: message,
    });
  },

  async updateTicket(ticket: OfflineTicket): Promise<void> {
    const db = await openDB();
    try {
      const transaction = db.transaction(TICKET_STORE, 'readwrite');
      transaction.objectStore(TICKET_STORE).put(ticket);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  },
};
