// server/radar/nearbyNow.js
//
// "Right now, here" from EDDN — other pilots being cleared to dock, docking, or being turned away at a
// station, and fresh market uploads for it, over the last 30 minutes. Memory only, nothing persisted:
// the commander's rule is that only nearby, current activity matters, and the station you are docking
// at is nearby by definition.
//
// EDDN's dockinggranted/dockingdenied messages carry a MarketID but no system or position, so everything
// is keyed by MarketID and only ever asked about one station at a time. Uploaders are anonymous in EDDN
// and are never stored here — counts only.
//
// Own presence: the commander's own EDMC uploads to the same feed. Their own journal events are noted
// with noteOwnNearby(), and an EDDN event of the same kind at the same station within two minutes of
// one of them is not counted. Market uploads are ignored while the commander is docked at that station.

const WINDOW_MS = 30 * 60_000;
const OWN_MATCH_MS = 2 * 60_000;
const MAX_MARKETS = 20_000;

const seen = new Map(); // marketId -> [{ kind, at, reason }]
const own = new Map();  // marketId -> [{ kind, at }]

const tsOf = (iso, fallback) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : fallback;
};

function prune(list, now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i].at < cutoff) i++;
  if (i) list.splice(0, i);
}

/** One EDDN event at a station. kind: 'granted' | 'denied' | 'docked' | 'market'. */
export function noteNearbyEvent(kind, marketId, iso, extra = {}, now = Date.now()) {
  if (marketId == null || !kind) return;
  const k = String(marketId);
  let list = seen.get(k);
  if (!list) {
    if (seen.size >= MAX_MARKETS) {
      for (const [mk, l] of seen) { prune(l, now); if (!l.length) seen.delete(mk); }
      if (seen.size >= MAX_MARKETS) return;
    }
    list = [];
    seen.set(k, list);
  }
  list.push({ kind, at: tsOf(iso, now), reason: extra.reason || null });
  list.sort((a, b) => a.at - b.at);
  prune(list, now);
}

/** The commander's own docking events, so their own uploads are not counted as other pilots. */
export function noteOwnNearby(kind, marketId, iso, now = Date.now()) {
  if (marketId == null || !kind) return;
  const k = String(marketId);
  const list = own.get(k) || [];
  list.push({ kind, at: tsOf(iso, now) });
  list.sort((a, b) => a.at - b.at);
  prune(list, now);
  own.set(k, list);
}

/**
 * Other pilots at this station in the last 30 minutes.
 * @returns {{ granted: number, docked: number, denied: number, deniedReasons: object, marketUpdates: number, windowMin: number }}
 */
export function nearbyNow(marketId, now = Date.now()) {
  const k = String(marketId);
  const list = seen.get(k) || [];
  prune(list, now);
  const mine = own.get(k) || [];
  prune(mine, now);
  const dockedHere = mine.some((o) => o.kind === 'docked');
  const isOwn = (e) => mine.some((o) => o.kind === e.kind && Math.abs(o.at - e.at) <= OWN_MATCH_MS);
  const out = { granted: 0, docked: 0, denied: 0, deniedReasons: {}, marketUpdates: 0, windowMin: WINDOW_MS / 60_000 };
  for (const e of list) {
    if (e.kind === 'market') { if (!dockedHere) out.marketUpdates++; continue; }
    if (isOwn(e)) continue;
    if (e.kind === 'granted') out.granted++;
    else if (e.kind === 'docked') out.docked++;
    else if (e.kind === 'denied') {
      out.denied++;
      const r = e.reason || 'Unknown';
      out.deniedReasons[r] = (out.deniedReasons[r] || 0) + 1;
    }
  }
  // A pilot is usually granted and then docks — count the larger, not both.
  const cleared = Math.max(out.granted, out.docked);
  out.granted = cleared;
  out.docked = 0;
  return out;
}

/** Test seam. */
export function _resetNearby() { seen.clear(); own.clear(); }
