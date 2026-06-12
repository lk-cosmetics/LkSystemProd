import { useEffect, useState } from 'react';

/**
 * Reactive connectivity flag. Mirrors `navigator.onLine` and re-renders on the
 * browser's `online` / `offline` events so components can switch between live
 * and offline (queued) behaviour without hand-rolling listeners each time.
 *
 * Note: `navigator.onLine === true` only means the device has a network
 * interface, not that the API is reachable — callers should still fall back to
 * the offline path when a request actually fails (see POSCaisseTab).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

export default useOnlineStatus;
