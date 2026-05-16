import { useEffect, useRef, useCallback } from 'react';

interface UseWebSocketOptions {
  /** Path relative to ws host, e.g. '/ws/sales-channels/' */
  path: string;
  /** Called for every incoming JSON message */
  onMessage: (data: unknown) => void;
  /** Whether the socket should be active (default true) */
  enabled?: boolean;
}

/**
 * Lightweight WebSocket hook with auto-reconnect.
 * Connects to the Django Channels backend.
 */
export function useWebSocket({ path, onMessage, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;
    // Django Channels typically runs on port 8000
    const port = import.meta.env.VITE_WS_PORT || '8000';
    const url = `${protocol}://${host}:${port}${path}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [path, enabled]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}
