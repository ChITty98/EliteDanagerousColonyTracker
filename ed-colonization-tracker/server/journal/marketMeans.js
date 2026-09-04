// server/journal/marketMeans.js
//
// Galactic averages from the game itself. Market.json carries MeanPrice for every commodity a
// station lists — the same number the in-game inventory shows — the 2026 surface commodities
// included. Until 2026-09-04 those numbers were read off the screen and typed into the price
// table by hand; this keeps them current from every market the commander opens, in a small file
// beside the exe, and feeds the price mirror so the page, the overlay and the co-pilot agree.
//
// Also: the BEST sell price among the commander's own visited markets (state.marketSnapshots),
// with where and when — because a station can pay 185% of the average (Atmo Sky Cairn: Iridium,
// Thortveitite and Periclase Dunite at 240k against a 129,763 mean), and "skip Thortveitite"
// was a decision made on the average alone.
import fs from 'node:fs';
import path from 'node:path';
import { setLiveMeans } from './commodityPricesMirror.js';

let MEANS_PATH = null;
let means = {};   // flattened name → { name, mean, at, station }
let saveTimer = null;

const flatten = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliasKey = (k) => (k.startsWith('lowtemp') ? 'lowtemperaturediamond' : k);
const keyOf = (name) => aliasKey(flatten(name));

export function initMarketMeans(appDir) {
  MEANS_PATH = path.join(appDir, 'market-means.json');
  try {
    const j = JSON.parse(fs.readFileSync(MEANS_PATH, 'utf8'));
    if (j && typeof j === 'object') means = j;
  } catch { means = {}; }
  push();
}

function push() {
  try { setLiveMeans(Object.entries(means).map(([k, v]) => [k, v.mean])); } catch { /* mirror not loaded yet */ }
}

function save() {
  if (!MEANS_PATH) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(MEANS_PATH, JSON.stringify(means, null, 1), 'utf8'); } catch { /* non-fatal */ }
  }, 1500);
  if (saveTimer.unref) saveTimer.unref();
}

/** Called with the normalised Market.json items (extractor.readMarketJson) on every market read. */
export function noteMarketMeans(items, station) {
  if (!Array.isArray(items)) return 0;
  let changed = 0;
  const at = (station && station.timestamp) || new Date().toISOString();
  for (const it of items) {
    const mean = Number(it.meanPrice);
    if (!(mean > 0)) continue;
    const label = it.nameLocalised || String(it.name || '').replace(/^\$/, '').replace(/_name;$/i, '');
    const k = keyOf(label);
    if (!k) continue;
    const prev = means[k];
    if (!prev || prev.mean !== mean) changed += 1;
    means[k] = { name: label, mean, at, station: (station && station.stationName) || null };
  }
  if (changed) { save(); push(); }
  return changed;
}

export function meanPriceFor(name) {
  const m = means[keyOf(name)];
  return m ? m.mean : 0;
}

export function getMeans() { return means; }

/** A market reading older than this is not a price anyone should plan a trip around. */
export const FRESH_MARKET_MS = 30 * 24 * 3600e3;
/**
 * "Your galaxy" ends here. Colonia (Jaques, TolaGarf's Junkyard …) is 22,000 ly from the bubble
 * and posts the top price on every board — and the commander's own Colonia-tour snapshots are
 * still inside the 30-day window. A station farther than this from the commander is ignored;
 * from Colonia, the same rule ignores the bubble.
 */
export const MAX_REACH_LY = 10000;

/** Light years between the commander and a system in the state, or null when either is unknown. */
export function distanceFromCommander(state, systemName) {
  const me = state && state.commanderPosition;
  const a = me && me.coordinates;
  if (!a || !systemName) return null;
  if (me.systemName && me.systemName.toLowerCase() === systemName.toLowerCase()) return 0;
  const ks = ((state && state.knownSystems) || {})[systemName.toLowerCase()];
  const b = ks && ks.coordinates;
  if (!b || ![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Best sell price for a commodity among the commander's own market snapshots — where it was and
 * when. Only real sell prices (demand side); fleet carriers are excluded upstream by the snapshot
 * writer; readings older than maxAgeMs are skipped (0 = no cutoff) so a stale high price cannot
 * shadow a fresh real one; stations farther than reachLy from the commander are skipped (0 = no
 * cutoff; unknown distance passes). Returns null when no fresh visited market buys it.
 */
export function bestSellFromSnapshots(state, name, maxAgeMs = FRESH_MARKET_MS, reachLy = MAX_REACH_LY) {
  const k = keyOf(name);
  const cutoff = Date.now() - maxAgeMs;
  let best = null;
  for (const snap of Object.values((state && state.marketSnapshots) || {})) {
    if (!snap || !Array.isArray(snap.commodities)) continue;
    if (maxAgeMs > 0 && !(Date.parse(snap.updatedAt) >= cutoff)) continue;
    if (reachLy > 0) { const d = distanceFromCommander(state, snap.systemName); if (d != null && d > reachLy) continue; }
    for (const c of snap.commodities) {
      if (!c || !(c.sellPrice > 0)) continue;
      if (keyOf(c.name) !== k && keyOf(c.commodityId) !== k) continue;
      if (!best || c.sellPrice > best.price) {
        best = { price: c.sellPrice, station: snap.stationName || null, system: snap.systemName || null, at: snap.updatedAt || null, demand: c.demand ?? null };
      }
    }
  }
  return best;
}
