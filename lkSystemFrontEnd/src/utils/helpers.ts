/**
 * Common utility functions
 */

import { API_CONFIG } from './constants';

/**
 * Gets the full URL for a media/image file from the backend.
 *
 * Handles:
 * - null / undefined / empty → returns undefined (no image)
 * - data: URIs → returned as-is (local previews)
 * - Absolute external URLs (https://cdn.example.com/…) → returned as-is
 * - Absolute URLs pointing at the current origin → returned as-is
 * - Absolute URLs with stale/internal hosts (e.g. http://backend:8000/media/…)
 *   → stripped to a relative path so the current origin serves them
 * - Relative paths (/media/…) → prepended with API base URL
 */
export function getMediaUrl(
  url: string | null | undefined
): string | undefined {
  if (!url) return undefined;

  // data: URIs (local file previews) — pass through
  if (url.startsWith('data:')) return url;

  // Strip stale absolute URLs that contain a /media/ path back to the
  // relative path.  This handles URLs stored in the DB with a host that no
  // longer matches (e.g. http://backend:8000/media/products/abc.jpg or
  // http://localhost:8000/media/products/abc.jpg when the app now runs on
  // a different port).
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const mediaIdx = url.indexOf('/media/');
    if (mediaIdx !== -1) {
      // Turn it into a relative path that the current origin can serve
      url = url.substring(mediaIdx); // e.g. /media/products/abc.jpg
    } else {
      // External URL (WooCommerce / WordPress images) — proxy through
      // our own Nginx to avoid CORS, hotlink-blocking, and mixed-content
      // issues.  The proxy rewrites:
      //   https://therapybylk.com/wp-content/uploads/2024/11/img.png
      //   → /wp-proxy/wp-content/uploads/2024/11/img.png
      try {
        const parsed = new URL(url);
        // Only proxy known WordPress/WooCommerce image paths
        if (parsed.pathname.includes('/wp-content/uploads/')) {
          return `/wp-proxy${parsed.pathname}`;
        }
      } catch {
        // Malformed URL — fall through to relative handling
      }
      // Other external URLs — return as-is
      return url;
    }
  }

  // Relative URL — prepend API base URL
  const baseUrl = API_CONFIG.BASE_URL.endsWith('/')
    ? API_CONFIG.BASE_URL.slice(0, -1)
    : API_CONFIG.BASE_URL;

  const mediaPath = url.startsWith('/') ? url : `/${url}`;

  return `${baseUrl}${mediaPath}`;
}

/**
 * Combines class names
 */
export function cn(...inputs: (string | undefined | null | boolean)[]): string {
  return inputs.filter(Boolean).join(' ');
}

/**
 * Formats a date string to a readable format
 */
export function formatDate(
  date: string | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(dateObj);
}

/**
 * Capitalizes the first letter of a string
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Generates a random ID string
 */
export function generateId(length = 8): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Truncates a string to a specified length
 */
export function truncate(str: string, length: number, suffix = '...'): string {
  if (str.length <= length) return str;
  return str.slice(0, length - suffix.length) + suffix;
}

/**
 * Debounces a function call
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttles a function call
 */
export function throttle<T extends (...args: never[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Deep clones an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as T;

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Checks if a value is empty (null, undefined, empty string, empty array, empty object)
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object')
    return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/**
 * Safely accesses nested object properties
 */
export function get(
  obj: Record<string, unknown>,
  path: string,
  defaultValue?: unknown
): unknown {
  const keys = path.split('.');
  let result: unknown = obj;

  for (const key of keys) {
    if (
      result === null ||
      result === undefined ||
      typeof result !== 'object' ||
      !(key in result)
    ) {
      return defaultValue;
    }
    result = (result as Record<string, unknown>)[key];
  }

  return result;
}
