import { useEffect, useRef, useState } from "react";

export function useAlertSocket({ enabled, onAlert }) {
  const [status, setStatus] = useState("Disconnected");
  const [toasts, setToasts] = useState([]);
  const seen = useRef(new Set());
  const toastTimers = useRef(new Set());
  const callback = useRef(onAlert);
  useEffect(() => { callback.current = onAlert; }, [onAlert]);

  useEffect(() => {
    if (!enabled) return undefined;
    let socket, timer, delay = 1000, closed = false;
    const effectToastTimers = toastTimers.current;
    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/alerts`);
      socket.onopen = () => { delay = 1000; setStatus("Connected"); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "NEW_ALERT" || !message.alert) return;
          const alert = message.alert;
          const id = String(alert.alert_id ?? alert.transaction_id ?? "");
          if (!id || seen.current.has(id)) return;
          seen.current.add(id);
          const toast = { id, text: `New ${alert.risk_category === "HIGH_RISK" ? "HIGH-RISK" : alert.risk_category || "fraud"} alert: ${alert.account_masked || "account unavailable"}, ${Number(alert.amount || 0).toFixed(2)}` };
          setToasts(items => [...items.slice(-3), toast]);
          const toastTimer = window.setTimeout(() => {
            setToasts(items => items.filter(item => item.id !== id));
            toastTimers.current.delete(toastTimer);
          }, 7000);
          toastTimers.current.add(toastTimer);
          callback.current?.(alert);
          window.dispatchEvent(new CustomEvent("fraudlens:new-alert", { detail: alert }));
        } catch { /* Ignore malformed server frames. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        setStatus("Disconnected");
        if (!closed) { timer = window.setTimeout(connect, delay); delay = Math.min(delay * 2, 30000); }
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      effectToastTimers.forEach(window.clearTimeout);
      effectToastTimers.clear();
      socket?.close();
    };
  }, [enabled]);

  return { status: enabled ? status : "Disconnected", toasts };
}
