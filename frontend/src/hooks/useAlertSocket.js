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
    let readyTimer;
    let pollTimer;
    let pollRequest;
    let polling = false;
    let delay = 1000;
    let wsFailures = 0;
    let closed = false;
    let pollingPrimed = false;
    const lifecycle = new AbortController();
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
      if (!polling) return;
      const controller = new AbortController();
      pollRequest = controller;
      try {
        const data = await request("/api/alerts?page=1&page_size=5", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.items)) throw new Error("Unexpected alert response");
        setStatus("HTTP polling");
        const { items } = data;
        if (!pollingPrimed) {
          items.forEach(item => {
            const id = String(item.alert_id ?? item.transaction_id ?? "");
            if (id) seen.current.add(id);
          });
          pollingPrimed = true;
          return;
        }
        items.slice().reverse().forEach(emitAlertToast);
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus("Unavailable");
        if (error?.status === 403) stopPolling();
      } finally {
        if (pollRequest === controller) {
          pollRequest = null;
          if (polling) pollTimer = window.setTimeout(pollOnce, 5000);
        }
      }
    };

    const startPollingFallback = () => {
      if (closed || polling || !canPollAlerts) return;
      polling = true;
      void pollOnce();
    };

    function stopPolling() {
      polling = false;
      window.clearTimeout(pollTimer);
      pollRequest?.abort();
      pollRequest = null;
    }

    const connect = async () => {
      if (closed) return;
      if (!polling) setStatus("Connecting");
      try {
        const session = await request("/api/auth/me", {
          signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(5000)]),
        });
        if (closed) return;
        if (session?.role !== role) {
          stopPolling();
          setStatus("Unavailable");
          return;
        }
      } catch (error) {
        if (closed) return;
        if (error?.code === "UNAUTHENTICATED" || error?.code === "UNAUTHORIZED") {
          stopPolling();
          setStatus("Unavailable");
        } else {
          onSocketFailure();
        }
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      let client;
      try {
        client = new WebSocket(`${protocol}//${window.location.host}/ws/alerts`);
        socket = client;
      } catch {
        onSocketFailure();
        return;
      }
      readyTimer = window.setTimeout(() => client.close(), 8000);
      client.onmessage = event => {
        if (closed || socket !== client) return;
        try {
          const message = JSON.parse(event.data);
          const receivedAlert = message?.type === "NEW_ALERT" && message.alert;
          if (message?.type !== "READY" && !receivedAlert) return;
          window.clearTimeout(readyTimer);
          stopPolling();
          wsFailures = 0;
          delay = 1000;
          setStatus("Live WebSocket");
          if (receivedAlert) emitAlertToast(message.alert);
        } catch { /* Ignore malformed server frames. */ }
      };
      client.onerror = () => client.close();
      client.onclose = () => {
        if (socket !== client) return;
        socket = null;
        window.clearTimeout(readyTimer);
        onSocketFailure();
      };
    };

    function onSocketFailure() {
      if (closed) return;
      if (!polling) setStatus("Unavailable");
      wsFailures += 1;
      if (wsFailures >= 2) startPollingFallback();
      reconnectTimer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    }

    void connect();
    return () => {
      closed = true;
      lifecycle.abort();
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(readyTimer);
      stopPolling();
      effectToastTimers.forEach(window.clearTimeout);
      effectToastTimers.clear();
      socket?.close();
    };
  }, [enabled, role, toastScope]);

  const status = !enabled ? "Unavailable" : connection.scope === toastScope ? connection.status : "Connecting";
  return { status, toasts: toasts.filter(toast => toast.scope === toastScope) };
}
