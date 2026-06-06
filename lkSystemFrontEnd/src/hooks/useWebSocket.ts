import { useEffect, useRef, useCallback } from 'react';
import { authService } from '@/services/auth.service';

interface UseWebSocketOptions {
  /** Path relative to ws host, e.g. '/ws/orders/' */
  path: string;
  /** Called for every incoming JSON message */
  onMessage: (data: unknown) => void;
  /** Whether the socket should be active (default true) */
  enabled?: boolean;
  /** Notified whenever the live connection state changes */
  onStatusChange?: (connected: boolean) => void;
  /**
   * Append the JWT access token as ``?token=`` so the Channels JWT middleware
   * can authenticate the socket. Default true. Public feeds still work without
   * a token (they just arrive as AnonymousUser server-side).
   */
  withAuth?: boolean;
}

const MAX_BACKOFF_MS = 30_000;
const PING_INTERVAL_MS = 25_000;

/**
 * Resilient WebSocket hook for the Django Channels (daphne) backend.
 *
 * - Same-origin by default: connects to ``wss://<host>/ws/...`` so it flows
 *   through nginx's ``/ws/`` proxy to the daphne sidecar. Set ``VITE_WS_PORT``
 *   to talk to a backend port directly (non-dockerised local dev).
 * - Authenticates with the in-memory JWT access token via ``?token=``.
 * - Reconnects with exponential backoff + jitter, resets on success, and
 *   reconnects immediately when the tab becomes visible again.
 * - Sends a lightweight ping so idle sockets aren't reaped by proxies.
 */
export function useWebSocket({
  path,
  onMessage,
  enabled = true,
  onStatusChange,
  withAuth = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const manualCloseRef = useRef(false);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  const buildUrl = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Direct-to-backend override for non-dockerised dev; otherwise same-origin
    // so nginx's /ws/ proxy forwards to the daphne sidecar.
    const explicitPort = import.meta.env.VITE_WS_PORT as string | undefined;
    const hostBase = explicitPort
      ? `${window.location.hostname}:${explicitPort}`
      : window.location.host;

    let url = `${wsProtocol}://${hostBase}${path}`;
    if (withAuth) {
      const token = authService.getStoredAccessToken?.();
      if (token) {
        url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
      }
    }
    return url;
  }, [path, withAuth]);

  // Forward declaration so connect()/scheduleReconnect() can reference each other.
  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!enabled || manualCloseRef.current) return;
    if (reconnectTimer.current) return;
    const exp = Math.min(attemptRef.current, 6); // cap exponent → ≤ ~30s
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** exp);
    const delay = base + Math.random() * 0.3 * base; // +0–30% jitter
    attemptRef.current = exp + 1;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      connectRef.current();
    }, delay);
  }, [enabled]);

  const connect = useCallback(() => {
    if (!enabled) return;
    // Don't open a second socket if one is already live/connecting.
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildUrl());
    } catch {
      // Constructor can throw on a malformed URL — schedule a retry.
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      onStatusRef.current?.(true);
      // Keepalive ping so proxies/load-balancers don't drop the idle socket.
      if (pingTimer.current) clearInterval(pingTimer.current);
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* ignore */
          }
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Swallow internal handshake/keepalive frames.
        const t = (data as { type?: string } | null)?.type;
        if (t === 'pong' || t === 'connected') return;
        onMessageRef.current(data);
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      onStatusRef.current?.(false);
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
      if (!manualCloseRef.current) scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire next and own the reconnect.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, buildUrl, scheduleReconnect]);

  // Keep the ref pointing at the latest connect closure.
  connectRef.current = connect;

  useEffect(() => {
    if (!enabled) return;
    manualCloseRef.current = false;
    connect();

    // Reconnect promptly when returning to the tab.
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        attemptRef.current = 0;
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      manualCloseRef.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearTimers();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, enabled, clearTimers]);
}
