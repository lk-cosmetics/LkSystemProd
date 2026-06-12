import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChunkLoadError,
  clearChunkReloadGuard,
  reloadForStaleChunkOnce,
  CHUNK_RELOAD_FLAG,
} from './lazyWithRetry';

describe('isChunkLoadError', () => {
  it('detects a ChunkLoadError by name', () => {
    const e = new Error('boom');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it.each([
    'Failed to fetch dynamically imported module: /assets/OrdersPage-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 5 failed.',
    "'text/html' is not a valid JavaScript MIME type",
  ])('detects the chunk-failure message: %s', (msg) => {
    expect(isChunkLoadError(new Error(msg))).toBe(true);
  });

  it('returns false for ordinary errors and nullish input', () => {
    expect(isChunkLoadError(new Error('x is not a function'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('returns false for an API error that has an HTTP response', () => {
    expect(isChunkLoadError({ response: { status: 500 }, message: 'Request failed' })).toBe(false);
  });
});

describe('stale-chunk reload guard — loop safety', () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock.mockClear();
    // jsdom's location.reload throws "Not implemented"; replace with a spy.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadMock, href: 'http://localhost/', origin: 'http://localhost' },
    });
  });

  it('reloads at most once per failure episode (no infinite loop)', () => {
    // First failure → schedules a reload and sets the guard.
    expect(reloadForStaleChunkOnce()).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe('1');

    // Second failure with the guard still set → NO reload (this is the loop guard).
    expect(reloadForStaleChunkOnce()).toBe(false);
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // A successful chunk load clears the guard → a new episode may reload again.
    clearChunkReloadGuard();
    expect(reloadForStaleChunkOnce()).toBe(true);
    expect(reloadMock).toHaveBeenCalledTimes(2);
  });
});
