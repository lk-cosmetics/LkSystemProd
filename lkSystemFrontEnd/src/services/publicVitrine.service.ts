import { API_CONFIG } from '@/utils/constants';

export type PublicVitrineProductType = 'resell_product' | 'pack';
export type PublicVitrineDiscountType = 'percentage' | 'fixed';

export interface PublicVitrinePromotion {
  id: number;
  name: string;
  discount_type: PublicVitrineDiscountType;
  discount_value: string;
  discounted_price: string;
  savings: string;
}

export interface PublicVitrinePackComponent {
  product_id: number | null;
  name: string;
  barcode: string;
  image_url: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface PublicVitrineProduct {
  id: number;
  name: string;
  barcode: string;
  image_url: string;
  product_link: string;
  product_type: PublicVitrineProductType;
  is_pack: boolean;
  sales_price: string;
  effective_price: string;
  available_quantity: number;
  is_out_of_stock: boolean;
  category_ids: number[];
  category_names: string[];
  promotion: PublicVitrinePromotion | null;
  pack_components: PublicVitrinePackComponent[];
  pack_components_total: string;
  pack_savings: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PublicVitrineCategory {
  id: number;
  name: string;
  slug: string;
  display_order: number;
  product_count: number;
}

export interface PublicVitrineSalesChannel {
  id: number;
  name: string;
  code: string | null;
  address: string;
  phone: string;
  state: string;
  brand_id: number;
  brand_name: string;
  brand_logo: string;
}

export interface PublicVitrineResponse {
  sales_channel: PublicVitrineSalesChannel;
  generated_at: string;
  categories: PublicVitrineCategory[];
  products: PublicVitrineProduct[];
}

export interface CachedPublicVitrine {
  cache_key: string;
  data: PublicVitrineResponse;
  cached_at: string;
}

const DB_NAME = 'lk-system-public-vitrine';
const DB_VERSION = 1;
const VITRINE_STORE = 'vitrines';

const buildPublicApiUrl = (path: string) => {
  const base = API_CONFIG.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
};

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

const canUseIndexedDB = () =>
  typeof window !== 'undefined' && 'indexedDB' in window;

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!canUseIndexedDB()) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VITRINE_STORE)) {
        db.createObjectStore(VITRINE_STORE, { keyPath: 'cache_key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const makeLocalStorageKey = (salesChannelId: number | string) =>
  `lk-public-vitrine:${String(salesChannelId).trim().toLowerCase()}`;

const makeCacheKeys = (
  salesChannelId: number | string,
  data?: PublicVitrineResponse,
) => {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const key = String(value ?? '').trim().toLowerCase();
    if (key) keys.add(key);
  };

  add(salesChannelId);
  add(data?.sales_channel.id);
  add(data?.sales_channel.code);
  add(data?.sales_channel.name);

  return Array.from(keys);
};

const readLocalStorageCache = (salesChannelId: number | string): CachedPublicVitrine | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(makeLocalStorageKey(salesChannelId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedPublicVitrine;
  } catch {
    window.localStorage.removeItem(makeLocalStorageKey(salesChannelId));
    return null;
  }
};

const writeLocalStorageCache = (record: CachedPublicVitrine) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(makeLocalStorageKey(record.cache_key), JSON.stringify(record));
  } catch {
    // IndexedDB is the primary cache; localStorage is only a small fallback.
  }
};

class PublicVitrineService {
  async getCachedPOSVitrine(salesChannelId: number | string): Promise<CachedPublicVitrine | null> {
    const cacheKey = String(salesChannelId).trim().toLowerCase();
    if (!cacheKey) return null;

    try {
      const db = await openDB();
      try {
        const transaction = db.transaction(VITRINE_STORE, 'readonly');
        const cached = await requestToPromise<CachedPublicVitrine | undefined>(
          transaction.objectStore(VITRINE_STORE).get(cacheKey),
        );
        return cached ?? readLocalStorageCache(cacheKey);
      } finally {
        db.close();
      }
    } catch {
      return readLocalStorageCache(cacheKey);
    }
  }

  async savePOSVitrine(
    salesChannelId: number | string,
    data: PublicVitrineResponse,
  ): Promise<void> {
    const cachedAt = new Date().toISOString();
    const records = makeCacheKeys(salesChannelId, data).map(cacheKey => ({
      cache_key: cacheKey,
      data,
      cached_at: cachedAt,
    }));

    records.forEach(writeLocalStorageCache);

    try {
      const db = await openDB();
      try {
        const transaction = db.transaction(VITRINE_STORE, 'readwrite');
        const store = transaction.objectStore(VITRINE_STORE);
        records.forEach(record => store.put(record));
        await transactionDone(transaction);
      } finally {
        db.close();
      }
    } catch {
      // LocalStorage fallback above already keeps a last-known-good snapshot.
    }
  }

  async getPOSVitrine(salesChannelId: number | string): Promise<PublicVitrineResponse> {
    const response = await fetch(
      buildPublicApiUrl(
        `/api/v1/products/public-vitrine/?sales_channel=${encodeURIComponent(String(salesChannelId))}`,
      ),
      {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      let message = 'Impossible de charger la vitrine.';
      try {
        const payload = await response.json();
        if (payload?.detail) message = payload.detail;
      } catch {
        // Keep the friendly fallback for non-JSON server errors.
      }
      throw new Error(message);
    }

    const payload = await response.json() as PublicVitrineResponse;
    await this.savePOSVitrine(salesChannelId, payload);
    return payload;
  }
}

export const publicVitrineService = new PublicVitrineService();
