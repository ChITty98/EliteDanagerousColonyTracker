/**
 * Colonization Chain Watch — turns anonymous "green tendrils" into named, coordinate-known
 * targets. Watches colonization events (galaxy-wide, off the same EDDN socket the radar
 * runs) and Spansh's is_being_colonised records, assembles anchors into CHAINS (connected
 * sequences within claim-link range), and reports them filtered to the commander's
 * operational regions. The trigger is the product: it says WHERE new opportunity opened,
 * never whether it's good — scoring requires visiting, and this feature never pretends.
 *
 * Anti-invention discipline (load-bearing):
 *  - anchors come ONLY from real EDDN events or real Spansh records — nothing inferred;
 *  - growth status reflects observed additions/updates, never projection;
 *  - unresolved region/coords are reported as unresolved, not guessed;
 *  - seed truncation is stated (count vs fetched), never silent.
 */
import fs from 'node:fs';
import { rateLimitedFetch } from '../journal/spansh.js';

const LINK_LY = 16;                       // claim range ~15 ly + rounding slop
const ACTIVE_WINDOW_MS = 14 * 86400_000;  // chain counts as actively growing
const WEEK_MS = 7 * 86400_000;
const SEED_PAGE_SIZE = 100;
const SEED_MAX_PAGES = 20;                // ≤2,000 most-recent per region — truncation is REPORTED
const REACH_BAND_LY = 100;                // the commander's stated chainable-if-worth-it envelope

// Fallback only: this exact value was resolved LIVE from Spansh on 2026-08-04
// (Colonia → "Inner Scutum-Centaurus Arm"). resolveColoniaRegion() re-resolves at
// first run per the spec's do-not-hardcode-from-assumption rule; the constant just
// covers the offline case.
const COLONIA_REGION_FALLBACK = 'Inner Scutum-Centaurus Arm';
const BUBBLE_REGION = 'Inner Orion Spur';

let filePath = null;
let state = null; // { version, watchingSince, seedInfo, anchors: { sysLower: anchor } }
let saveTimer = null;
let chainsCache = null; // recomputed lazily on dirty
let dirty = true;
let seeding = false;

function freshState() {
  return { version: 1, watchingSince: new Date().toISOString(), seedInfo: {}, anchors: {} };
}

export function initChainWatch(file) {
  filePath = file;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.version === 1 && j.anchors) state = j;
  } catch { /* absent/corrupt → fresh ledger */ }
  if (!state) state = freshState();
  dirty = true;
  return state;
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(filePath, JSON.stringify(state)); }
    catch (e) { console.error('[ChainWatch] save failed:', e && e.message); }
  }, 5000);
}

/**
 * Record a colonization event (from EDDN, galaxy-wide — called BEFORE the radar's
 * radius gate). Live events mark real growth: lastSeen advances, liveEvents counts.
 */
export function noteColonisationEvent(sysName, pos, ev) {
  if (!state || !sysName) return false;
  const key = String(sysName).toLowerCase();
  const now = Date.now();
  let a = state.anchors[key];
  const isNew = !a; // a NEW anchor = the frontier actually moved (contribution spam is not growth)
  if (!a) {
    a = state.anchors[key] = {
      name: sysName,
      pos: Array.isArray(pos) && pos.length === 3 ? pos : null,
      region: null,
      firstSeen: now,
      lastSeen: now,
      liveEvents: 0,
      seeded: false,
      pop: null,
    };
  }
  a.lastSeen = now;
  a.liveEvents = (a.liveEvents || 0) + 1;
  if (!a.pos && Array.isArray(pos) && pos.length === 3) a.pos = pos;
  dirty = true;
  saveSoon();
  return isNew;
}

/** Resolve the Colonia-side region name from live data (falls back to the recorded value). */
export async function resolveColoniaRegion() {
  if (state?.seedInfo?.coloniaRegion) return state.seedInfo.coloniaRegion;
  try {
    const r = await rateLimitedFetch('https://spansh.co.uk/api/systems/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { name: { value: 'Colonia' } }, size: 1 }),
    });
    const j = await r.json();
    const region = j?.results?.[0]?.region;
    if (region) {
      state.seedInfo.coloniaRegion = region;
      saveSoon();
      return region;
    }
  } catch { /* offline — fallback below */ }
  return COLONIA_REGION_FALLBACK;
}

export async function defaultRegions() {
  return [BUBBLE_REGION, await resolveColoniaRegion()];
}

/**
 * One-time (re-runnable) seed: pull is_being_colonised systems for the given regions from
 * Spansh, newest-updated first, bounded pages. Seeded anchors carry region/pos/pop straight
 * from the record; their lastSeen = the record's updated_at (real observed recency, so
 * growth status is honest from day one). Seeded ≠ grown: only live events count as growth.
 */
export async function seedChainWatch(regions, onProgress) {
  if (seeding) return { started: false, reason: 'already seeding' };
  seeding = true;
  try {
    for (const region of regions) {
      let fetched = 0, count = null;
      for (let page = 0; page < SEED_MAX_PAGES; page++) {
        const r = await rateLimitedFetch('https://spansh.co.uk/api/systems/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: { is_being_colonised: { value: true }, region: { value: [region] } },
            sort: [{ updated_at: { direction: 'desc' } }],
            size: SEED_PAGE_SIZE,
            from: page * SEED_PAGE_SIZE,
          }),
        });
        const j = await r.json();
        if (count == null) count = j.count || 0;
        const results = j.results || [];
        if (!results.length) break;
        for (const s of results) {
          if (typeof s.x !== 'number') continue;
          const key = String(s.name).toLowerCase();
          const updatedMs = s.updated_at ? Date.parse(s.updated_at) : Date.now();
          const prev = state.anchors[key];
          state.anchors[key] = {
            name: s.name,
            pos: [s.x, s.y, s.z],
            region: s.region || null,
            firstSeen: prev?.firstSeen ?? updatedMs,
            lastSeen: Math.max(prev?.lastSeen ?? 0, updatedMs),
            liveEvents: prev?.liveEvents ?? 0,
            seeded: true,
            pop: s.population ?? null,
          };
        }
        fetched += results.length;
        if (onProgress) onProgress(region, fetched, count);
        if (fetched >= count) break;
      }
      state.seedInfo[region] = {
        count, fetched, truncated: count != null && fetched < count,
        seededAt: new Date().toISOString(),
      };
      console.log(`[ChainWatch] seeded ${region}: ${fetched} of ${count}${fetched < (count || 0) ? ' (TRUNCATED — most-recent first)' : ''}`);
    }
    dirty = true;
    saveSoon();
    return { started: true };
  } finally {
    seeding = false;
  }
}

/** Slow-drip region resolution for live-discovered anchors (seeded ones arrive resolved). */
let resolving = false;
export async function resolvePendingRegions() {
  if (resolving || !state) return;
  const pending = Object.values(state.anchors).filter((a) => !a.region && a.name).slice(0, 5);
  if (!pending.length) return;
  resolving = true;
  try {
    for (const a of pending) {
      try {
        const r = await rateLimitedFetch('https://spansh.co.uk/api/systems/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { name: { value: a.name } }, size: 1 }),
        });
        const j = await r.json();
        const rec = j?.results?.[0];
        if (rec && rec.name?.toLowerCase() === a.name.toLowerCase()) {
          a.region = rec.region || a.region;
          if (!a.pos && typeof rec.x === 'number') a.pos = [rec.x, rec.y, rec.z];
          if (a.pop == null && rec.population != null) a.pop = rec.population;
          dirty = true;
        } else {
          a.region = a.region || 'unresolved'; // honest: we asked, Spansh had nothing
        }
      } catch { /* transient — retry next drip */ }
    }
    saveSoon();
  } finally {
    resolving = false;
  }
}

// --- Chain assembly (union-find over anchors with coords, links ≤ LINK_LY) -----------------
function computeChains() {
  const anchors = Object.values(state.anchors).filter((a) => Array.isArray(a.pos));
  const n = anchors.length;
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < n; i++) {
    const pi = anchors[i].pos;
    for (let j = i + 1; j < n; j++) {
      const pj = anchors[j].pos;
      const dx = pi[0] - pj[0]; if (dx > LINK_LY || dx < -LINK_LY) continue;
      const dy = pi[1] - pj[1]; if (dy > LINK_LY || dy < -LINK_LY) continue;
      const dz = pi[2] - pj[2];
      if (dx * dx + dy * dy + dz * dz <= LINK_LY * LINK_LY) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (groups.get(root) || groups.set(root, []).get(root)).push(anchors[i]);
  }
  const now = Date.now();
  const sectorOf = (name) => {
    const m = /^(.*?)\s+[A-Z]{2}-[A-Z]\s+[a-h]\d+(?:-\d+)?(?:\s|$)/i.exec(name || '');
    return m ? m[1].replace(/\s+Sector$/i, '') : null;
  };
  const chains = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.firstSeen - b.firstSeen);
    const start = members[0];
    let tip = members[0];
    for (const m of members) if (m.lastSeen > tip.lastSeen) tip = m;
    // extent: span between the two farthest-apart members (exact for small chains,
    // sampled for very large blobs so a 2k-anchor mass doesn't cost O(n²) here)
    let extent = 0;
    const sample = members.length > 200 ? members.filter((_, i) => i % Math.ceil(members.length / 200) === 0) : members;
    for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < sample.length; j++) {
      const a = sample[i].pos, b = sample[j].pos;
      const dd = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (dd > extent) extent = dd;
    }
    const lastGrowthAt = Math.max(...members.map((m) => m.lastSeen));
    const recentLive = members.filter((m) => m.liveEvents > 0 && m.lastSeen >= now - WEEK_MS).length;
    const recentAny = members.filter((m) => m.lastSeen >= now - WEEK_MS).length;
    const sectors = [...new Set(members.map((m) => sectorOf(m.name)).filter(Boolean))];
    const regions = [...new Set(members.map((m) => m.region).filter((r) => r && r !== 'unresolved'))];
    chains.push({
      id: start.name,
      count: members.length,
      start: { name: start.name, pos: start.pos },
      tip: { name: tip.name, pos: tip.pos },
      extentLy: Math.round(extent),
      reachBandLy: REACH_BAND_LY,
      status: lastGrowthAt >= now - ACTIVE_WINDOW_MS ? 'active' : 'stalled',
      lastGrowthAt,
      recentWeek: recentAny,
      recentWeekLive: recentLive,
      sectors: sectors.slice(0, 6),
      regions,
      anchors: members.map((m) => ({
        name: m.name, pos: m.pos, region: m.region, pop: m.pop,
        firstSeen: m.firstSeen, lastSeen: m.lastSeen, live: m.liveEvents > 0, seeded: !!m.seeded,
      })),
    });
  }
  chains.sort((a, b) => b.lastGrowthAt - a.lastGrowthAt);
  return chains;
}

export function snapshotChains({ regions, center, holdings } = {}) {
  if (!state) return { chains: [], meta: {} };
  if (dirty || !chainsCache) { chainsCache = computeChains(); dirty = false; }
  const wl = Array.isArray(regions) && regions.length ? new Set(regions) : null;
  let chains = chainsCache;
  if (wl) chains = chains.filter((c) => c.regions.some((r) => wl.has(r)) || c.regions.length === 0);
  const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const enrich = chains.map((c) => {
    let distFromYou = null, distFromHoldings = null;
    if (center) {
      distFromYou = Math.min(...c.anchors.map((a) => d3(a.pos, center)));
    }
    if (Array.isArray(holdings) && holdings.length) {
      distFromHoldings = Math.min(...c.anchors.flatMap((a) => holdings.map((h) => d3(a.pos, h))));
    }
    return { ...c, distFromYou: distFromYou != null ? Math.round(distFromYou) : null, distFromHoldings: distFromHoldings != null ? Math.round(distFromHoldings) : null };
  });
  const unresolved = Object.values(state.anchors).filter((a) => !a.region || a.region === 'unresolved').length;
  return {
    chains: enrich,
    meta: {
      watchingSince: state.watchingSince,
      seedInfo: state.seedInfo,
      anchorTotal: Object.keys(state.anchors).length,
      unresolvedRegions: unresolved,
      seeding,
      linkLy: LINK_LY,
      activeDays: ACTIVE_WINDOW_MS / 86400_000,
    },
  };
}
