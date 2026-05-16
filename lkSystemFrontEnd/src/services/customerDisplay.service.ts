/**
 * Customer display (LED8) service.
 *
 * Posts to the local FastAPI bridge running on the cashier PC. Failures are
 * silent — checkout never blocks if the bridge is offline. A console.warn is
 * emitted in dev so the hardware status is visible while testing.
 */

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const DEFAULT_TOKEN = 'change-me';
const REQUEST_TIMEOUT_MS = 700;

const STORAGE_KEYS = {
  enabled: 'lk_pos_customer_display_enabled',
  url: 'lk_pos_customer_display_url',
  token: 'lk_pos_customer_display_token',
} as const;

type DisplayLabel = 'price' | 'total' | 'collect' | 'change' | null;

const hasBrowserStorage = () =>
  typeof window !== 'undefined' && !!window.localStorage;

const getStored = (key: string, fallback: string): string => {
  if (!hasBrowserStorage()) return fallback;
  return window.localStorage.getItem(key) || fallback;
};

const isEnabled = (): boolean => {
  if (!hasBrowserStorage()) return true;
  return window.localStorage.getItem(STORAGE_KEYS.enabled) !== 'false';
};

const getBridgeUrl = (): string => {
  const configured = getStored(STORAGE_KEYS.url, DEFAULT_BRIDGE_URL).trim();
  return configured.replace(/\/+$/, '') || DEFAULT_BRIDGE_URL;
};

const getBridgeToken = (): string => getStored(STORAGE_KEYS.token, DEFAULT_TOKEN);

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const postToBridge = async (path: string, payload?: unknown): Promise<boolean> => {
  if (!isEnabled()) return false;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBridgeUrl()}${path}`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'X-Display-Token': getBridgeToken(),
      },
      body: payload ? JSON.stringify(payload) : '{}',
      signal: controller.signal,
    });
    if (!response.ok && isDev) {
      console.warn(`[customer-display] ${path} → HTTP ${response.status}`);
    }
    return response.ok;
  } catch (err) {
    if (isDev) console.warn(`[customer-display] ${path} failed:`, err);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
};

/* ── Dedupe cache ─────────────────────────────────────────────────────────
 * Skip identical (label, value) repeats so we don't spam the serial port
 * during React re-renders. Any clear/init/test resets the cache.
 */

let lastLabel: DisplayLabel = null;
let lastValue: string | null = null;

const resetCache = () => {
  lastLabel = null;
  lastValue = null;
};

const formatValue = (value: number): string => {
  const n = Number.isFinite(value) ? value : 0;
  return n.toFixed(3);
};

const showLabelled = async (
  label: Exclude<DisplayLabel, null>,
  path: string,
  bodyKey: 'value' | 'total',
  value: number,
): Promise<boolean> => {
  const formatted = formatValue(value);
  if (lastLabel === label && lastValue === formatted) {
    return true; // already on screen
  }
  const ok = await postToBridge(path, { [bodyKey]: Number(formatted) });
  if (ok) {
    lastLabel = label;
    lastValue = formatted;
  }
  return ok;
};

class CustomerDisplayService {
  init(): Promise<boolean> {
    resetCache();
    return postToBridge('/display/init');
  }

  clear(): Promise<boolean> {
    resetCache();
    return postToBridge('/display/clear');
  }

  showPrice(value: number): Promise<boolean> {
    return showLabelled('price', '/display/price', 'value', value);
  }

  showTotal(value: number): Promise<boolean> {
    return showLabelled('total', '/display/total', 'total', value);
  }

  showCollect(value: number): Promise<boolean> {
    return showLabelled('collect', '/display/collect', 'value', value);
  }

  showChange(value: number): Promise<boolean> {
    return showLabelled('change', '/display/change', 'value', value);
  }

  test(): Promise<boolean> {
    resetCache();
    return postToBridge('/display/test');
  }
}

export const customerDisplayService = new CustomerDisplayService();
