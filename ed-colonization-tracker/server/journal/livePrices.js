// server/journal/livePrices.js
//
// Live market basis for mined commodities: the best non-Fleet-Carrier sell price WITHIN 500 LY of
// the commander (one carrier jump — ore goes onto the carrier and the carrier goes to the buyer),
// with real demand, from the Ardent Insight API (EDDN-fed; same source as the Sources page).
// Verified 2026-07-23 from HIP 52629: Bromellite 116,750 @ 266 ly, LTD 384,562 @ 364 ly, Painite
// 266,412 @ 238 ly — all one jump out, all matching Inara to the credit. Falls back to the
// galaxy-wide board when no reference system is known yet.
//
// FCs are excluded (player-set squadron prices, not a market), demand must cover a real load, and
// everything is cached — one fetch per commodity per hour, sequential with spacing, fail-quiet to
// the visited-average fallback in valueOf().

const CARRIER_RANGE_LY = 500;       // one Fleet Carrier jump — the commander's stated selling radius
const TTL_MS = 60 * 60_000;         // refresh cadence per commodity
const SERVE_MS = 6 * 60 * 60_000;   // serve-while-stale ceiling — beyond this, fall back
// Commander's rule: under ~10k demand a top price isn't legitimate — small-demand listings collapse
// after a few loads, and the ore arrives by CARRIER, so the buyer must absorb carrier-scale tonnage.
const MIN_DEMAND = 10_000;
const FETCH_SPACING_MS = 400;

// Our commodityKey() output is journal-style already (bromellite, lowtemperaturediamond, …).
// The exceptions where Ardent's journal id differs:
const ARDENT_ALIAS = { voidopal: 'opal' };

const cache = new Map(); // key -> { cr, station, system, demand, updatedAt, at }
let queue = [];
let running = false;

/** Sync read for the hot path. Null when never fetched or too stale to trust. */
export function getLivePrice(key) {
  const hit = cache.get(key);
  if (!hit || !hit.cr) return null; // miss markers carry cr:0 — never serve them
  if (Date.now() - hit.at > SERVE_MS) return null;
  return hit;
}

let refSystem = null; // anchor for the 500 ly search; a region move re-anchors naturally via TTL

/** Queue keys for background refresh (deduped; fresh entries skipped). Fire-and-forget. */
export function refreshLivePrices(keys, referenceSystem) {
  if (referenceSystem) refSystem = String(referenceSystem);
  const now = Date.now();
  for (const k of keys || []) {
    if (!k) continue;
    const hit = cache.get(k);
    if (hit && now - hit.at < TTL_MS) continue;
    if (!queue.includes(k)) queue.push(k);
  }
  if (!running && queue.length) void drain();
}

async function drain() {
  running = true;
  try {
    while (queue.length) {
      const key = queue.shift();
      await fetchOne(key);
      if (queue.length) await new Promise((r) => setTimeout(r, FETCH_SPACING_MS));
    }
  } finally {
    running = false;
  }
}

async function fetchOne(key) {
  const name = ARDENT_ALIAS[key] || key;
  try {
    const url = refSystem
      ? `https://api.ardent-insight.com/v2/system/name/${encodeURIComponent(refSystem)}/commodity/name/${encodeURIComponent(name)}/nearby/imports?maxDistance=${CARRIER_RANGE_LY}`
      : `https://api.ardent-insight.com/v2/commodity/name/${encodeURIComponent(name)}/imports`;
    const res = await fetch(url);
    if (!res.ok) { markMiss(key); return; }
    const rows = await res.json();
    if (!Array.isArray(rows)) { markMiss(key); return; }
    const good = rows
      .filter((x) => x && x.stationType !== 'FleetCarrier' && (x.demand ?? 0) >= MIN_DEMAND && (x.sellPrice ?? 0) > 0)
      // Price caps make exact ties common — at equal pay, the nearest station wins (it's a haul).
      .sort((a, b) => (b.sellPrice || 0) - (a.sellPrice || 0) || ((a.distance ?? 1e9) - (b.distance ?? 1e9)));
    const best = good[0];
    if (!best) { markMiss(key); return; }
    cache.set(key, {
      cr: best.sellPrice,
      station: best.stationName || '',
      system: best.systemName || '',
      demand: best.demand ?? 0,
      distanceLy: best.distance != null ? Math.round(best.distance) : null,
      updatedAt: best.updatedAt || '',
      at: Date.now(),
    });
    console.log(`[LivePrice] ${key}: ${best.sellPrice.toLocaleString()} Cr/t @ ${best.stationName} (${best.systemName})${best.distance != null ? ` ${Math.round(best.distance)} ly` : ''}`);
  } catch {
    markMiss(key);
  }
}

// A failed fetch still stamps the clock so we don't hammer a down API; getLivePrice
// returns null for these (no cr), letting valueOf fall through to the visited average.
function markMiss(key) {
  const prev = cache.get(key);
  if (prev && prev.cr) { prev.at = Date.now() - TTL_MS + 10 * 60_000; return; } // retry old data in 10m
  cache.set(key, { cr: 0, at: Date.now() - TTL_MS + 10 * 60_000 });
}

export function livePriceStats() {
  const out = {};
  for (const [k, v] of cache) if (v.cr) out[k] = { cr: v.cr, station: v.station, system: v.system };
  return out;
}
