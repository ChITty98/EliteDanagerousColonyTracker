// server/radar/populatedStore.js
//
// Populated systems for the Map's "Populated" layer. Seeded from the commander's own Spansh
// regional dump (scripts/gen-populated-systems.mjs → populated-systems.json beside colony-data.json)
// and kept current from the journal stream: every FSDJump / Location / CarrierJump the EDDN relay
// carries — from every reporting player — has the system's StarPos and Population, and so do the
// commander's own. New colonies appear as someone jumps into them; populations refresh.
//
// Scope is a list of bubbles — the 700 ly one around HIP 47126 ("start with the 700 ly bubble",
// 2026-09-06) and the 500 ly one around Praea Euq AT-U d2-47, the two areas the commander has
// regional dumps for. Add a bubble here and reseed. Its own file on purpose: colony-data.json is
// 27 MB and syncs to every tab.
import fs from 'node:fs';
import path from 'node:path';

export const BUBBLES = [
  { name: 'HIP 47126', x: 955.875, y: -13.71875, z: 108.59375, radiusLy: 700 },
  { name: 'Praea Euq AT-U d2-47', x: 1061.15625, y: 12.40625, z: 488.1875, radiusLy: 500 },
];
// The first bubble is the primary; kept for callers that still think in one centre.
export const BUBBLE_CENTRE = BUBBLES[0];
export const BUBBLE_RADIUS_LY = BUBBLES[0].radiusLy;
const WRITE_DEBOUNCE_MS = 5_000;

let FILE = null;          // null = memory only (tests)
let header = null;        // { generatedAt, source, centre, radiusLy, live }
let byName = new Map();   // lower-case name -> row
let dirty = false;
let timer = null;
let loadedMtimeMs = 0;    // the file as last read — a newer one on disk is a reseed to adopt, not overwrite

function empty() {
  return { generatedAt: null, source: null, centre: BUBBLE_CENTRE, radiusLy: BUBBLE_RADIUS_LY, bubbles: BUBBLES, live: 0 };
}

export function initPopulatedStore(appDir) {
  FILE = appDir ? path.join(appDir, 'populated-systems.json') : null;
  header = empty();
  byName = new Map();
  dirty = false;
  readFile();
  return { count: byName.size, file: FILE };
}

/** Load the file into memory, keeping the live rows already in memory on top of it. */
function readFile() {
  if (!FILE || !fs.existsSync(FILE)) return false;
  try {
    const st = fs.statSync(FILE);
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const mine = [...byName.values()].filter((r) => r && r.live);
    header = { generatedAt: j.generatedAt || null, source: j.source || null, centre: j.centre || BUBBLE_CENTRE, radiusLy: j.radiusLy || BUBBLE_RADIUS_LY, bubbles: BUBBLES, live: j.live || 0 };
    byName = new Map();
    for (const r of j.systems || []) if (r && r.name && Number.isFinite(r.x)) byName.set(String(r.name).toLowerCase(), r);
    for (const r of mine) { const k = String(r.name).toLowerCase(); if (!byName.has(k)) header.live = (header.live || 0) + 1; byName.set(k, r); }
    loadedMtimeMs = st.mtimeMs;
    return true;
  } catch (e) {
    console.warn('[Populated] could not read populated-systems.json:', e && e.message);
    return false;
  }
}

/** A reseed written by the generator while the server runs: adopt it instead of overwriting it. */
function reloadIfNewer() {
  if (!FILE) return false;
  let st; try { st = fs.statSync(FILE); } catch { return false; }
  if (st.mtimeMs <= loadedMtimeMs) return false;
  const ok = readFile();
  if (ok) { console.log(`[Populated] adopted a newer populated-systems.json — ${byName.size} systems`); dirty = true; }
  return ok;
}

/** Inside any of the bubbles. */
export function inBubble(pos) {
  if (!Array.isArray(pos) || pos.length < 3 || !pos.every(Number.isFinite)) return false;
  return BUBBLES.some((b) => Math.hypot(pos[0] - b.x, pos[1] - b.y, pos[2] - b.z) <= b.radiusLy);
}

/**
 * A system seen with a population and a position. Upserts by name; a system outside the bubble or
 * with no population is ignored. Returns true when something changed.
 */
export function notePopulatedSystem({ name, id64, pos, population, economy, at } = {}) {
  if (!header) return false;
  const pop = Number(population);
  if (!name || !(pop > 0) || !inBubble(pos)) return false;
  const key = String(name).toLowerCase();
  const prev = byName.get(key);
  const seenAt = at ? new Date(at).toISOString() : new Date().toISOString();
  if (prev && prev.pop === pop && prev.x === pos[0] && prev.y === pos[1] && prev.z === pos[2]) {
    prev.at = seenAt; // still there — a cheap refresh, no rewrite needed
    return false;
  }
  const row = {
    id64: id64 ?? (prev ? prev.id64 : null), name: String(name), x: pos[0], y: pos[1], z: pos[2], pop,
    economy: economy || (prev ? prev.economy : null) || null, economy2: prev ? prev.economy2 ?? null : null,
    star: prev ? prev.star ?? null : null, at: seenAt, live: true,
  };
  if (!prev) header.live = (header.live || 0) + 1;
  byName.set(key, row);
  dirty = true;
  scheduleWrite();
  return true;
}

function scheduleWrite() {
  if (!FILE || timer) return;
  timer = setTimeout(() => { timer = null; flushPopulatedStore(); }, WRITE_DEBOUNCE_MS);
  if (timer.unref) timer.unref();
}

export function flushPopulatedStore() {
  if (!FILE || !header) return false;
  reloadIfNewer();
  if (!dirty) return false;
  try {
    fs.writeFileSync(FILE, JSON.stringify({ ...header, count: byName.size, systems: [...byName.values()] }));
    try { loadedMtimeMs = fs.statSync(FILE).mtimeMs; } catch { /* keep the old stamp */ }
    dirty = false;
    return true;
  } catch (e) {
    console.warn('[Populated] write failed:', e && e.message);
    return false;
  }
}

export function getPopulatedSystems() {
  if (!header) return { ...empty(), count: 0, systems: [] };
  reloadIfNewer();
  return { ...header, count: byName.size, systems: [...byName.values()] };
}

/** Test hook. */
export function _resetPopulatedStore() { FILE = null; header = null; byName = new Map(); dirty = false; loadedMtimeMs = 0; if (timer) { clearTimeout(timer); timer = null; } }
