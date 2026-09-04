// server/chains/threatWatch.js
//
// Encroachment watch on systems the commander has FLAGGED as theirs to lose.
//
// WHY IT WATCHES A RADIUS, NOT THE SYSTEM: colonization spreads by claim hops of ~15 ly (see
// chainWatch's LINK_LY). Watching a flagged system only tells you it is gone. Watching 50 ly
// around it — roughly three hops — shows a chain bridging toward it while there is still time to
// claim. That distinction is the whole feature: HD 79624 (a 98 on the commander's own scale) was
// noticed only after it reached population 8,279.
//
// WHY FLAGS AND NOT SCORES: 5,715 scouted systems are candidates, not intent. Ranking them picks
// what a formula likes; flagging picks what the commander actually means to hold. Without that
// distinction the watch fires on everything — a sweep on 2026-08-28 found 39 systems being
// colonised nearby, 36 of them around a bubble the commander had deliberately left open.
//
// WHY THE COMMANDER'S OWN SYSTEMS ARE EXCLUDED: Spansh reports is_being_colonised for THEIR active
// builds too. Unfiltered, the first thing this feature would do is alarm them about themselves —
// two of five "threats" near one target were their own construction.

import { rateLimitedFetch } from '../journal/spansh.js';

const SPANSH_SEARCH = 'https://spansh.co.uk/api/systems/search';
const LINK_LY = 16;          // one claim hop, per chainWatch
const DEFAULT_RADIUS_LY = 50; // the commander's stated warning radius — ~3 hops
const PAGE_SIZE = 100;
const SPACING_MS = 700;       // be a good citizen; one query per flagged system

/** Claim hops between a threat and the flagged system it is approaching. */
export function hopsFor(distanceLy) {
  if (!(distanceLy > 0)) return 0;
  return Math.max(1, Math.ceil(distanceLy / LINK_LY));
}

/**
 * Colonisation activity within `radius` of one flagged system, excluding anything the commander
 * already holds.
 *
 * Returns null (not an empty result) when the query fails, so a network blip is never reported to
 * the commander as "all clear" — a false all-clear is the one output this feature must never give.
 */
async function activityNear(systemName, domainLower, radius, coords) {
  // ANCHOR BY COORDINATES WHEN WE HAVE THEM. Spansh's search index does not contain every system
  // the commander has scouted — Col 173 Sector YI-V c17-29, their highest-scoring target at 117,
  // is absent, so reference_system returned HTTP 400 and the flag sat permanently "unknown".
  // Their scouted records carry x/y/z regardless, which resolves it.
  //
  // ⚠️ The coordinate anchor MUST be the object form. `reference_coords: [x,y,z]` and
  // `reference_x/y/z` both return HTTP 200 with results silently anchored at SOL — plausible-looking
  // data for entirely the wrong place. Verified 2026-08-28. Only { x, y, z } is correct.
  const anchor = coords && [coords.x, coords.y, coords.z].every((n) => typeof n === 'number')
    ? { reference_coords: { x: coords.x, y: coords.y, z: coords.z } }
    : { reference_system: systemName };

  let rows;
  try {
    const r = await rateLimitedFetch(SPANSH_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          is_being_colonised: { value: true },
          distance: { min: '0', max: String(radius) },
        },
        sort: [{ distance: { direction: 'asc' } }],
        size: PAGE_SIZE,
        page: 0,
        ...anchor,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    rows = j.results || [];
  } catch {
    return null;
  }

  return rows
    .filter((s) => s && s.name && !domainLower.has(String(s.name).toLowerCase()))
    // The flagged system itself being colonised is the worst case, not a near miss — keep it.
    .map((s) => ({
      name: s.name,
      distanceLy: typeof s.distance === 'number' ? s.distance : null,
      population: s.population ?? 0,
    }))
    .sort((a, b) => (a.distanceLy ?? 1e9) - (b.distanceLy ?? 1e9));
}

/**
 * Is the system in Spansh's search index yet?
 *
 * Worth surfacing rather than hiding: a system Spansh has never heard of is one nobody has visited
 * or reported, which is a signal in its own right — and it is why the name-anchored query fails and
 * the coordinate anchor exists. Returns null when the lookup itself failed, so "we could not ask"
 * never renders as "not registered".
 */
async function isRegistered(systemName) {
  try {
    const r = await rateLimitedFetch(SPANSH_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { name: { value: systemName } }, size: 20 }),
    });
    if (!r.ok) return null;
    const rows = (await r.json())?.results || [];
    return rows.some((s) => String(s.name).toLowerCase() === String(systemName).toLowerCase());
  } catch {
    return null;
  }
}

/**
 * Assess every flagged system.
 *
 * `watched`   — array of { id, name, score?, nearestLy?, ... } (the stored flags)
 * `domain`    — iterable of the commander's own system names
 * Returns a report per flag, plus `alerts` describing what CHANGED since the stored reading:
 * a first sighting inside the radius, or a chain that has moved closer. Steady-state produces no
 * alerts, so the 2nd screen only speaks when something actually happened.
 */
export async function assessThreats(watched, domain, { radius = DEFAULT_RADIUS_LY } = {}) {
  const domainLower = new Set([...(domain || [])].map((s) => String(s).toLowerCase()));
  const report = [];
  const alerts = [];

  for (const w of watched || []) {
    if (!w || !w.name) continue;
    const found = await activityNear(w.name, domainLower, radius, w.coordinates);
    // Checked every pass, not cached: registration is exactly the kind of thing that changes, and
    // watching it change is part of what the commander asked for.
    await new Promise((r) => setTimeout(r, 250));
    const registered = await isRegistered(w.name);

    if (found === null) {
      // Unknown, explicitly. Carries the previous reading forward untouched.
      report.push({
        ...w, status: 'unknown', threats: [], threatCount: 0,
        nearestLy: w.nearestLy ?? null, nearestName: w.nearestName ?? null,
        registered: registered ?? w.registered ?? null,
        checkFailed: true,
      });
      await new Promise((r) => setTimeout(r, SPACING_MS));
      continue;
    }

    const nearest = found[0] || null;
    const nearestLy = nearest ? nearest.distanceLy : null;
    const prevLy = typeof w.nearestLy === 'number' ? w.nearestLy : null;
    const taken = found.some((f) => f.name.toLowerCase() === String(w.name).toLowerCase());

    // Closing counts only as a real approach, not float jitter on the same anchor.
    const closing = prevLy != null && nearestLy != null && nearestLy < prevLy - 0.5;
    const firstContact = prevLy == null && nearestLy != null;

    if (taken) {
      alerts.push({ kind: 'taken', system: w.name, score: w.score ?? null });
    } else if (firstContact) {
      alerts.push({ kind: 'appeared', system: w.name, score: w.score ?? null, nearest: nearest.name, distanceLy: nearestLy, hops: hopsFor(nearestLy) });
    } else if (closing) {
      alerts.push({ kind: 'closing', system: w.name, score: w.score ?? null, nearest: nearest.name, distanceLy: nearestLy, fromLy: prevLy, hops: hopsFor(nearestLy) });
    }

    report.push({
      ...w,
      status: taken ? 'taken' : found.length ? 'threatened' : 'clear',
      threats: found.slice(0, 10),
      threatCount: found.length,
      nearestLy,
      nearestName: nearest ? nearest.name : null,
      hops: nearestLy != null ? hopsFor(nearestLy) : null,
      registered: registered ?? w.registered ?? null,
      closing,
      prevNearestLy: prevLy,
      lastCheckedAt: new Date().toISOString(),
      checkFailed: false,
    });

    await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  return { report, alerts, radius };
}
