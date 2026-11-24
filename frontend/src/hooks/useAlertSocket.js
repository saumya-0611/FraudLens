import { useEffect, useRef, useState } from "react";
import { request } from "../services/api";

export function useAlertSocket({ enabled, role, onAlert }) {
  const toastScope = enabled ? role || "authenticated" : "disabled";
  const [connection, setConnection] = useState({ scope: "", status: "Unavailable" });
  const [toasts, setToasts] = useState([]);
  const seen = useRef(new Set());
  const toastTimers = useRef(new Set());
  const callback = useRef(onAlert);
  useEffect(() => { callback.current = onAlert; }, [onAlert]);

  useEffect(() => {
    seen.current.clear();
    if (!enabled) {
      return undefined;
    }

    let socket;
    let reconnectTimer;
    let pollTimer;
    let delay = 1000;
    let wsFailures = 0;
    let closed = false;
    let pollingPrimed = false;
    const effectToastTimers = toastTimers.current;
    const canPollAlerts = role === "ADMIN" || role === "ANALYST";
    const setStatus = value => setConnection({ scope: toastScope, status: value });

    const emitAlertToast = (alert) => {
      if (!alert || typeof alert !== "object") return;
      const id = String(alert.alert_id ?? alert.transaction_id ?? "");
      if (!id || seen.current.has(id)) return;
      seen.current.add(id);
      if (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value);
      const toast = {
        id,
        scope: toastScope,
        text: `New ${alert.risk_category === "HIGH_RISK" ? "HIGH-RISK" : alert.risk_category || "fraud"} alert: ${alert.account_masked || "account unavailable"}, ${Number(alert.amount || 0).toFixed(2)}`,
      };
      setToasts(items => [...items.slice(-3), toast]);
      const toastTimer = window.setTimeout(() => {
        setToasts(items => items.filter(item => item.id !== id));
        toastTimers.current.delete(toastTimer);
      }, 7000);
      toastTimers.current.add(toastTimer);
      callback.current?.(alert);
      window.dispatchEvent(new CustomEvent("fraudlens:new-alert", { detail: alert }));
    };

    const pollOnce = async () => {
      if (closed) return;
      try {
        const data = await request("/api/alerts?page=1&page_size=5");
        if (closed) return;
        setStatus("HTTP polling");
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!pollingPrimed) {
          items.forEach(item => {
            const id = String(item.alert_id ?? item.transaction_id ?? "");
            if (id) seen.current.add(id);
          });
          pollingPrimed = true;
          return;
        }
        items.slice().reverse().forEach(emitAlertToast);
      } catch {
        if (!closed) setStatus("Unavailable");
      }
    };

    const startPollingFallback = () => {
      if (closed || pollTimer) return;
      if (!canPollAlerts) {
        setStatus("Unavailable");
        return;
      }
      void pollOnce();
      pollTimer = window.setInterval(() => void pollOnce(), 5000);
    };

    const connect = async () => {
      if (closed) return;
      // Confirm the cookie session before opening the socket. Viewers use this
      // permitted endpoint and never call the ADMIN/ANALYST-only alerts API.
      try {
        await request("/api/auth/me");
      } catch {
        if (!closed) setStatus("Unavailable");
        return;
      }
      if (closed) return;
      setStatus("Connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        socket = new WebSocket(`${protocol}//${window.location.host}/ws/alerts`);
      } catch {
        onSocketFailure();
        return;
      }
      socket.onopen = () => {
        // The backend has no authenticated-ready acknowledgement. Keep the UI
        // at Connecting until an authenticated server event proves the channel.
      };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "NEW_ALERT" || !message.alert) return;
          wsFailures = 0;
          delay = 1000;
          setStatus("Live WebSocket");
          emitAlertToast(message.alert);
        } catch { /* Ignore malformed server frames. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = onSocketFailure;
    };

    function onSocketFailure() {
      if (closed) return;
      wsFailures += 1;
      if (wsFailures >= 2 && canPollAlerts) {
        startPollingFallback();
        return;
      }
      setStatus("Unavailable");
      reconnectTimer = window.setTimeout(() => {
        setStatus("Connecting");
        void connect();
      }, delay);
      delay = Math.min(delay * 2, 30000);
    }

    void connect();
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      effectToastTimers.forEach(window.clearTimeout);
      effectToastTimers.clear();
      socket?.close();
    };
  }, [enabled, role, toastScope]);

  const status = !enabled ? "Unavailable" : connection.scope === toastScope ? connection.status : "Connecting";
  return { status, toasts: toasts.filter(toast => toast.scope === toastScope) };
}
