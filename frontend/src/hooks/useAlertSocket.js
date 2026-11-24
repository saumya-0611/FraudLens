import { useEffect, useRef, useState } from "react";
import { request } from "../services/api";

export function useAlertSocket({ enabled, role, onAlert }) {
  const [status, setStatus] = useState("Disconnected");
  const [toasts, setToasts] = useState([]);
  const seen = useRef(new Set());
  const toastTimers = useRef(new Set());
  const callback = useRef(onAlert);
  useEffect(() => { callback.current = onAlert; }, [onAlert]);

  useEffect(() => {
    if (!enabled) return undefined;
    let socket;
    let reconnectTimer;
    let pollTimer;
    let delay = 1000;
    let wsFailures = 0;
    let closed = false;
    let pollingPrimed = false;
    const effectToastTimers = toastTimers.current;
    const canPollAlerts = role === "ADMIN" || role === "ANALYST";

    const emitAlertToast = (alert) => {
      const id = String(alert.alert_id ?? alert.transaction_id ?? "");
      if (!id || seen.current.has(id)) return;
      seen.current.add(id);
      const toast = {
        id,
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

    const startPollingFallback = () => {
      if (closed || pollTimer) return;
      if (!canPollAlerts) {
        setStatus("Live");
        return;
      }

      const pollOnce = async () => {
        if (closed) return;
        try {
          const data = await request("/api/alerts?page=1&page_size=5");
          if (closed) return;
          setStatus("Live");
          const items = Array.isArray(data?.items) ? data.items : [];
          if (!pollingPrimed) {
            items.forEach((item) => {
              const id = String(item.alert_id ?? item.transaction_id ?? "");
              if (id) seen.current.add(id);
            });
            pollingPrimed = true;
            return;
          }
          items.slice().reverse().forEach(emitAlertToast);
        } catch {
          if (!closed) setStatus("Disconnected");
        }
      };

      void pollOnce();
      pollTimer = window.setInterval(() => void pollOnce(), 5000);
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/alerts`);
      socket.onopen = () => {
        wsFailures = 0;
        delay = 1000;
        setStatus("Connected");
      };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "NEW_ALERT" || !message.alert) return;
          emitAlertToast(message.alert);
        } catch { /* Ignore malformed server frames. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (closed) return;
        wsFailures += 1;
        // On platforms whose HTTP rewrites do not proxy WebSockets (e.g. Vercel),
        // seamlessly switch to 5s HTTPS polling after 2 failed handshake attempts.
        if (wsFailures >= 2) {
          startPollingFallback();
          return;
        }
        setStatus("Disconnected");
        reconnectTimer = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      effectToastTimers.forEach(window.clearTimeout);
      effectToastTimers.clear();
      socket?.close();
    };
  }, [enabled, role]);

  return { status: enabled ? status : "Disconnected", toasts };
}
