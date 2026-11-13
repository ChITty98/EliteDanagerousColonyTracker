// server/journal/materialTraders.js
//
// Where to trade an engineering material (1.61.2). Two answers, kept apart on purpose:
//   - WHICH TRADER follows the material's category and is always known, offline: raw materials trade at
//     a Raw material trader (Extraction or Refinery stations), manufactured at a Manufactured trader
//     (Industrial), encoded at an Encoded trader (High Tech or Military) — the trader's type is set by
//     the station's economy.
//   - WHICH STATION is a lookup: Spansh's station search for "Material Trader", nearest first from where
//     the commander is (cached six hours per system), with the stations the commander has docked at as
//     the offline fallback — Spansh is a supplement, never a requirement.

import { rateLimitedFetch } from './spansh.js';

export const TRADER_TYPES = {
  raw: { label: 'Raw material trader', economies: ['Extraction', 'Refinery'] },
  manufactured: { label: 'Manufactured material trader', economies: ['Industrial'] },
  encoded: { label: 'Encoded material trader', economies: ['High Tech', 'Military'] },
};

/** The trader a station's (primary) economy gives it, or null for economies without one. */
export function traderTypeForEconomy(econ) {
  const e = String(econ || '').toLowerCase();
  if (/extraction|refinery/.test(e)) return 'raw';
  if (/industrial/.test(e)) return 'manufactured';
  if (/high ?tech|military/.test(e)) return 'encoded';
  return null;
}

const PER_TYPE = 3;
const TTL_MS = 6 * 3600e3;
const cache = new Map(); // reference system (lower-case) -> { at, data }
const round1 = (n) => Math.round(Number(n) * 10) / 10;

/**
 * The nearest stations with a material trader, three of each type, from Spansh.
 * @param {string} referenceSystem  where to measure from
 * @param {{ fetchImpl?: Function, now?: number }} [o]  fetchImpl is a test seam
 */
export async function spanshNearestTraders(referenceSystem, { fetchImpl = rateLimitedFetch, now = Date.now() } = {}) {
  const key = String(referenceSystem || '').trim().toLowerCase();
  if (!key) throw new Error('no reference system');
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return { ...hit.data, cached: true };
  const body = {
    filters: { distance: { min: '0', max: '2500' }, services: [{ name: 'Material Trader' }] },
    sort: [{ distance: { direction: 'asc' } }],
    size: 150,
    page: 0,
    reference_system: referenceSystem,
  };
  const res = await fetchImpl('https://spansh.co.uk/api/stations/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ED Colony Architect' },
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) throw new Error(`Spansh station search failed${res && res.status ? ` (${res.status})` : ''}`);
  const j = await res.json();
  const traders = { raw: [], manufactured: [], encoded: [] };
  for (const r of Array.isArray(j && j.results) ? j.results : []) {
    const t = traderTypeForEconomy(r.primary_economy);
    if (!t || traders[t].length >= PER_TYPE) continue;
    traders[t].push({
      station: r.name || null,
      system: r.system_name || null,
      ly: round1(r.distance),
      ls: Math.round(r.distance_to_arrival || 0),
      stationType: r.type || null,
      largePads: r.large_pads || 0,
      mediumPads: r.medium_pads || 0,
      planetary: !!r.is_planetary,
      economy: r.primary_economy || null,
      updatedAt: r.updated_at || null,
    });
  }
  const data = { reference: referenceSystem, fetchedAt: new Date(now).toISOString(), traders };
  cache.set(key, { at: now, data });
  return { ...data, cached: false };
}

/**
 * Offline: the nearest stations the commander has DOCKED AT that list a material trader, one per type,
 * typed by the main economy seen there. Needs the commander's coordinates and the systems' coordinates.
 */
export function knownNearestTraders(state, origin) {
  const s = state || {};
  const o = origin && Number.isFinite(origin.x) ? origin : null;
  const systems = s.knownSystems || {};
  const coordsOf = (name) => {
    const k = systems[name] || Object.values(systems).find((x) => x && x.systemName === name);
    return k && k.coordinates && Number.isFinite(k.coordinates.x) ? k.coordinates : null;
  };
  const best = { raw: null, manufactured: null, encoded: null };
  for (const st of Object.values(s.knownStations || {})) {
    if (!st || /fleetcarrier/i.test(String(st.stationType || ''))) continue;
    const services = (st.services || []).map((x) => String(x).toLowerCase());
    if (!services.includes('materialtrader')) continue;
    const main = (st.economies || []).slice().sort((a, b) => (b.proportion || 0) - (a.proportion || 0))[0];
    const t = traderTypeForEconomy(main && (main.nameLocalised || main.name));
    if (!t) continue;
    const c = coordsOf(st.systemName);
    const ly = o && c ? Math.hypot(c.x - o.x, c.y - o.y, c.z - o.z) : null;
    const cand = { station: st.stationName, system: st.systemName, ly: ly == null ? null : round1(ly), ls: Math.round(st.distFromStarLS || 0), economy: main.nameLocalised || main.name || null, lastDocked: st.lastDocked || st.lastSeen || null };
    const cur = best[t];
    if (!cur || (cand.ly != null && (cur.ly == null || cand.ly < cur.ly))) best[t] = cand;
  }
  return best;
}

/** Test seam. */
export function _clearTraderCache() { cache.clear(); }
