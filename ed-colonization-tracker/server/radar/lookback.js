// server/radar/lookback.js
//
// The 7-day picture, populated on every recenter so the scope isn't empty until live events
// trickle in. Two sources, both honest about what they are:
//
//   1. The commander's OWN scouted list (2,895 scored systems with coordinates) filtered to the
//      radius — layer 3a's instant population, real composite scores, zero API calls.
//   2. Spansh systems updated in the last 7 days within the radius — a "someone submitted fresh
//      data here this week" activity proxy (NOT a commander count), which also carries power /
//      faction / population for the context layers.

import { setLookback, setScoutedInRange, setKnownNames, notePopulated, RADAR_RANGE_LY } from './radarState.js';

const REFRESH_MIN_MS = 5 * 60_000; // don't hammer Spansh when hopping between neighbors
let lastFetch = { system: '', at: 0 };

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * @param {object} state    colony-data.json contents
 * @param {string} system   current system name
 * @param {[number,number,number]} pos
 */
export async function refreshLookback(state, system, pos) {
  if (!pos) return;
  const scouted = collectScoutedInRange(state, pos);
  setScoutedInRange(scouted.rows);
  setKnownNames(scouted.known);

  if (lastFetch.system === system && Date.now() - lastFetch.at < REFRESH_MIN_MS) return;
  lastFetch = { system, at: Date.now() };

  try {
    // Spansh date filters want a RANGE: comparison "<=>" with [from, to] (a bare ">=" matches
    // almost nothing — verified live: >= returned count=1 globally, <=> returned 10,000).
    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const until = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const res = await fetch('https://spansh.co.uk/api/systems/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: { updated_at: { comparison: '<=>', value: [since, until] } },
        sort: [{ distance: { direction: 'asc' } }],
        size: 100,
        reference_coords: { x: pos[0], y: pos[1], z: pos[2] },
      }),
    });
    if (!res.ok) throw new Error('spansh ' + res.status);
    const j = await res.json();
    const rows = (Array.isArray(j.results) ? j.results : [])
      .filter((s) => s && typeof s.x === 'number' && dist([s.x, s.y, s.z], pos) <= RADAR_RANGE_LY)
      .map((s) => ({
        name: s.name,
        pos: [s.x, s.y, s.z],
        distLy: Math.round(dist([s.x, s.y, s.z], pos)),
        updatedAt: s.updated_at || null,
        power: s.power && s.power.length ? s.power[0] : (s.controlling_power || null),
        faction: s.controlling_minor_faction || null,
        allegiance: s.allegiance || null,
        population: s.population || 0,
      }));
    setLookback(rows, rows.length);
    console.log(`[Radar] lookback: ${rows.length} system(s) updated ≤7d within ${RADAR_RANGE_LY} ly of ${system}`);
  } catch (e) {
    console.error('[Radar] lookback fetch failed:', e && e.message);
    setLookback([], 0); // honest empty, never stale-presented-as-fresh
  }
}

function collectScoutedInRange(state, pos) {
  const rows = [];
  const known = new Set();
  const sc = (state && state.scoutedSystems) || {};
  for (const key of Object.keys(sc)) {
    const s = sc[key];
    if (!s || !s.name) continue;
    known.add(String(s.name).toLowerCase());
    const c = s.coordinates;
    if (!c || typeof c.x !== 'number') continue;
    const d = dist([c.x, c.y, c.z], pos);
    if (d > RADAR_RANGE_LY) continue;
    if (s.isColonised) { notePopulated(s.name); continue; } // already claimed — not a radar prospect
    const score = s.score ? (s.score.total ?? s.score.score ?? 0) : 0;
    rows.push({
      name: s.name,
      pos: [c.x, c.y, c.z],
      distLy: Math.round(d),
      score,
      isColonised: !!s.isColonised,
      atmospheres: s.score ? (s.score.atmosphereCount || 0) : 0,
      oxygen: s.score ? (s.score.oxygenCount || 0) : 0,
    });
  }
  for (const name of Object.keys((state && state.knownSystems) || {})) {
    known.add(String(name).toLowerCase());
    const ks = state.knownSystems[name];
    if (ks && ks.population > 0) notePopulated(name);
  }
  rows.sort((a, b) => b.score - a.score);
  return { rows: rows.slice(0, 400), known };
}
