/**
 * Shared SSE bus — one EventSource, many subscribers.
 *
 * Replaces the previous architecture where the store's startStateSyncListener
 * AND CompanionPage each opened their own EventSource('/api/events'). That
 * asymmetry caused the iPad bug: CompanionPage's connection would open
 * synchronously on tab mount, store's was gated behind checkServerStorage() +
 * setTimeout(1000) and would fail to open on iPad — meaning target alerts
 * worked but state-driven updates (FC quantities, project progress) didn't.
 *
 * One connection, one failure surface. If subscribers don't get events, they
 * all don't get events; if they do, they all do.
 *
 * Usage:
 *   const unsub = sseSubscribe('state_updated', (ev) => { ... });
 *   ...
 *   unsub();
 *
 * Synthetic events:
 *   '__open' — fires every time the underlying EventSource (re)opens. Useful
 *              for state-sync consumers that want a forced rehydrate after a
 *              disconnect/reconnect cycle.
 */

type SseEvent = { type: string; [k: string]: unknown };
type SseHandler = (ev: SseEvent) => void;

const subscribers = new Map<string, Set<SseHandler>>();
let es: EventSource | null = null;

function getToken(): string | null {
  try { return sessionStorage.getItem('colony-token'); } catch { return null; }
}

function buildUrl(): string {
  const tk = getToken();
  return tk ? `/api/events?token=${tk}` : '/api/events';
}

function ensureOpen(): void {
  if (es) return;
  try {
    es = new EventSource(buildUrl());
    es.onopen = () => {
      // Fire synthetic '__open' so state-sync consumers can run a catch-up
      // rehydrate after a (re)connect. Browser EventSource fires onopen on
      // initial connect AND on auto-reconnect after a transient drop.
      dispatch({ type: '__open' });
    };
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as SseEvent;
        if (!ev || typeof ev.type !== 'string') return;
        dispatch(ev);
      } catch { /* malformed payload — drop */ }
    };
    es.onerror = () => {
      // Browser auto-reconnects. We don't tear down or recreate; we just wait
      // for the next onopen which will fire '__open' for catch-up.
      // Fire '__error' for consumers that want to show a "disconnected" UI badge.
      dispatch({ type: '__error' });
    };
  } catch {
    es = null;
  }
}

function dispatch(ev: SseEvent): void {
  const handlers = subscribers.get(ev.type);
  if (!handlers || handlers.size === 0) return;
  for (const h of handlers) {
    try { h(ev); } catch { /* one handler's error doesn't kill others */ }
  }
}

export function sseSubscribe(eventType: string, handler: SseHandler): () => void {
  // Open the connection lazily on first subscribe — no checkServerStorage
  // gate, no setTimeout. If we have a token + a fetch capability, we can talk
  // to the server. Hydration / storage availability concerns belong elsewhere.
  ensureOpen();
  let set = subscribers.get(eventType);
  if (!set) {
    set = new Set();
    subscribers.set(eventType, set);
  }
  set.add(handler);
  return () => {
    const s = subscribers.get(eventType);
    if (s) {
      s.delete(handler);
      if (s.size === 0) subscribers.delete(eventType);
    }
  };
}

/** Diagnostic: snapshot of current bus state. */
export function sseBusStatus() {
  return {
    connected: es != null && (es.readyState === EventSource.OPEN),
    readyState: es?.readyState ?? null,
    subscribedTypes: Array.from(subscribers.keys()),
  };
}
