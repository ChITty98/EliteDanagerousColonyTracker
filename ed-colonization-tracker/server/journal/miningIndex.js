// server/journal/miningIndex.js
//
// Ring index built from the commander's own journals: which rings have which hotspots, how rich the
// system is, what the ring is made of, and how deep in-system it sits.
//
// Sources (all verified present in this commander's journals on 2026-07-21):
//   SAASignalsFound  → Signals[{Type, Count}] per ring        (111 rings mapped)
//   Scan.ReserveLevel → Pristine / Major / Common / Low / Depleted
//   Scan.Rings[].RingClass → eRingClass_Icy | Rocky | MetalRich | Metalic
//   Scan.DistanceFromArrivalLS → in-system depth              (7,734 bodies)
//   FSDJump / Location StarPos → system coordinates for range
//
// WHAT COUNT MEANS: Signals[].Count is how many hotspots of that type exist in the ring. The payload
// carries no positions and no radii, so overlap between hotspots is NOT knowable from the journal
// and no yield multiplier is inferred from the number. Display it, don't interpret it.
//
// This index covers only rings the commander has personally DSS-mapped. Galaxy-wide discovery comes
// from Spansh (see spansh.js searchRingsBySignals); the two are merged at the API layer, because
// only this one can be joined against what they actually extracted there.

import fs from 'node:fs';
import path from 'node:path';
import { listJournalFiles } from './paths.js';
import { commodityKey } from './miningMissions.js';

const CACHE_FILE = 'mining-rings.json';
const RESCAN_MS = 10 * 60_000;

// `rings` = DSS-mapped (SAASignalsFound). `allRings` = every planetary ring ever seen in a body
// Scan — the superset that makes "seen but never deep-scanned" computable. Belts are excluded:
// they can't be DSS-mapped (0 of this commander's 111 SAASignalsFound records is a belt).
let index = { rings: {}, allRings: {}, coords: {}, materials: {}, builtAt: 0 };
let cachePath = null;
let building = false;

const RESERVE_RANK = { Pristine: 5, Major: 4, Common: 3, Low: 2, Depleted: 1 };

export function initRingIndex(appDir) {
  cachePath = path.join(appDir, CACHE_FILE);
  try {
    if (fs.existsSync(cachePath)) {
      const j = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (j && j.rings) index = Object.assign({ allRings: {} }, j); // pre-allRings cache files lack the field
    }
  } catch { /* rebuild from journals */ }
  return cachePath;
}

const ringParent = (ringName) => String(ringName || '').replace(/\s+[A-Z]\s+Ring$/, '');
const normReserve = (s) => String(s || '').replace(/Resources$/, '');
const normClass = (s) => String(s || '').replace(/^eRingClass_/, '').replace(/Metalic/, 'Metallic');

/** Full journal sweep. Expensive but idempotent; cached to disk and refreshed on a long interval. */
export function buildRingIndex(journalDir, force = false) {
  if (building) return index;
  if (!force && Date.now() - index.builtAt < RESCAN_MS && Object.keys(index.rings).length) return index;
  building = true;
  try {
    const rings = Object.assign({}, index.rings);
    const allRings = Object.assign({}, index.allRings);
    const coords = Object.assign({}, index.coords);
    const materials = Object.assign({}, index.materials);
    const depth = {};
    const reserve = {};
    const rclass = {};

    // The minable-material catalog is EVIDENCE-DERIVED, not a hardcoded game table: the union of
    // what has been prospected, refined, cracked as a core, or mapped as a ring hotspot. It comes
    // out at 33 for this commander. Deriving it means it self-extends when something new is
    // encountered, and means no material is classified by assumption — a mistake already made once
    // in this feature's design by assuming LTD/Bromellite were core-only when they laser fine.
    const noteMaterial = (label, from) => {
      if (!label) return;
      const key = commodityKey(label);
      if (!key || /biolog|geolog/i.test(label)) return;
      const m = materials[key] || (materials[key] = { key, label, from: [] });
      if (label.length > m.label.length) m.label = label;
      if (!m.from.includes(from)) m.from.push(from);
    };

    let files = [];
    try { files = listJournalFiles(journalDir); } catch { files = []; }

    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f.fullPath, 'utf8'); } catch { continue; }
      if (!/SAASignalsFound|"Scan"|FSDJump|"Location"|ProspectedAsteroid|MiningRefined/.test(text)) continue;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (!/SAASignalsFound|"Scan"|FSDJump|"Location"|ProspectedAsteroid|MiningRefined/.test(line)) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.event === 'ProspectedAsteroid') {
          for (const m of ev.Materials || []) noteMaterial(m.Name_Localised || m.Name, 'prospect');
          if (ev.MotherlodeMaterial) noteMaterial(ev.MotherlodeMaterial_Localised || ev.MotherlodeMaterial, 'core');
          continue;
        }
        if (ev.event === 'MiningRefined') { noteMaterial(ev.Type_Localised || ev.Type, 'refined'); continue; }
        if ((ev.event === 'FSDJump' || ev.event === 'Location') && ev.StarPos && ev.StarSystem) {
          coords[ev.StarSystem] = ev.StarPos;
        } else if (ev.event === 'Scan') {
          if (ev.BodyName && ev.DistanceFromArrivalLS != null) depth[ev.BodyName] = ev.DistanceFromArrivalLS;
          for (const r of ev.Rings || []) {
            if (!r || !r.Name) continue;
            rclass[r.Name] = normClass(r.RingClass);
            if (ev.ReserveLevel) reserve[r.Name] = normReserve(ev.ReserveLevel);
            if (!/Belt$/i.test(r.Name)) {
              const prev = allRings[r.Name] || {};
              allRings[r.Name] = {
                name: r.Name,
                system: ev.StarSystem || prev.system || '',
                systemAddress: ev.SystemAddress ?? prev.systemAddress ?? null,
                ringClass: normClass(r.RingClass) || prev.ringClass || '',
                reserve: ev.ReserveLevel ? normReserve(ev.ReserveLevel) : (prev.reserve || ''),
                depthLs: ev.DistanceFromArrivalLS != null ? Math.round(ev.DistanceFromArrivalLS) : (prev.depthLs ?? null),
              };
            }
          }
        } else if (ev.event === 'SAASignalsFound' && /Ring/i.test(ev.BodyName || '')) {
          const sig = {};
          for (const s of ev.Signals || []) {
            const label = s.Type_Localised || s.Type;
            if (!label || /biolog|geolog/i.test(label)) continue;
            sig[commodityKey(label)] = { label, count: s.Count || 1 };
            noteMaterial(label, 'hotspot');
          }
          rings[ev.BodyName] = Object.assign(rings[ev.BodyName] || {}, {
            name: ev.BodyName,
            systemAddress: ev.SystemAddress,
            bodyId: ev.BodyID,
            signals: sig,
            mappedAt: ev.timestamp,
          });
        }
      }
    }

    // Second pass joins ring-level facts that live on the PARENT body's Scan.
    for (const [name, r] of Object.entries(rings)) {
      const parent = ringParent(name);
      r.ringClass = rclass[name] || r.ringClass || '';
      r.reserve = reserve[name] || r.reserve || '';
      r.depthLs = depth[parent] != null ? Math.round(depth[parent]) : (r.depthLs ?? null);
      r.systemName = r.systemName || guessSystem(name, coords);
    }

    index = { rings, allRings, coords, materials, builtAt: Date.now() };
    if (cachePath) {
      try { fs.writeFileSync(cachePath, JSON.stringify(index), 'utf8'); } catch { /* non-fatal */ }
    }
  } finally {
    building = false;
  }
  return index;
}

/**
 * Ring names embed the system name, but body suffixes vary ("A 5 B Ring", "AB 2 A Ring", "2 c A Ring").
 * Matching against known system names beats regex-guessing the split point.
 */
function guessSystem(ringName, coords) {
  const names = Object.keys(coords);
  let best = '';
  for (const n of names) {
    if (ringName.startsWith(n + ' ') && n.length > best.length) best = n;
  }
  return best;
}

/** Live hook so a fresh DSS scan shows up without waiting for a rebuild. */
export function ingestRingEvent(ev) {
  if (!ev) return;
  if (ev.event === 'SAASignalsFound' && /Ring/i.test(ev.BodyName || '')) {
    const sig = {};
    for (const s of ev.Signals || []) {
      const label = s.Type_Localised || s.Type;
      if (!label || /biolog|geolog/i.test(label)) continue;
      sig[commodityKey(label)] = { label, count: s.Count || 1 };
    }
    index.rings[ev.BodyName] = Object.assign(index.rings[ev.BodyName] || {}, {
      name: ev.BodyName, systemAddress: ev.SystemAddress, bodyId: ev.BodyID,
      signals: sig, mappedAt: ev.timestamp,
      systemName: guessSystem(ev.BodyName, index.coords),
    });
  } else if (ev.event === 'Scan') {
    for (const r of ev.Rings || []) {
      if (!r || !r.Name) continue;
      // A freshly scanned body's rings join the seen-set live, so the DSS-gap list is current
      // without waiting for the next full rebuild.
      if (!/Belt$/i.test(r.Name)) {
        const prev = index.allRings[r.Name] || {};
        index.allRings[r.Name] = {
          name: r.Name,
          system: ev.StarSystem || prev.system || '',
          systemAddress: ev.SystemAddress ?? prev.systemAddress ?? null,
          ringClass: normClass(r.RingClass) || prev.ringClass || '',
          reserve: ev.ReserveLevel ? normReserve(ev.ReserveLevel) : (prev.reserve || ''),
          depthLs: ev.DistanceFromArrivalLS != null ? Math.round(ev.DistanceFromArrivalLS) : (prev.depthLs ?? null),
        };
      }
      if (!index.rings[r.Name]) continue;
      index.rings[r.Name].ringClass = normClass(r.RingClass);
      if (ev.ReserveLevel) index.rings[r.Name].reserve = normReserve(ev.ReserveLevel);
    }
  } else if ((ev.event === 'FSDJump' || ev.event === 'Location') && ev.StarPos && ev.StarSystem) {
    index.coords[ev.StarSystem] = ev.StarPos;
  }
}

const dist3 = (a, b) => {
  if (!a || !b) return null;
  const g = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
  const [x1, y1, z1] = g(a), [x2, y2, z2] = g(b);
  if ([x1, y1, z1, x2, y2, z2].some((n) => typeof n !== 'number')) return null;
  return Math.hypot(x1 - x2, y1 - y2, z1 - z2);
};

/**
 * Rings from the commander's own mapping that carry any of `targets`.
 * Distance in ly and depth in Ls are reported SEPARATELY and never blended — a ring 70ly away at
 * 1,500Ls and one 70ly away at 13,460Ls are not the same trip, which is exactly why depth is here.
 */
export function findRingsForTargets(targets, referenceCoords, opts = {}) {
  const want = new Set((targets || []).map(commodityKey).filter(Boolean));
  if (!want.size) return [];
  const out = [];
  for (const r of Object.values(index.rings)) {
    const hits = [];
    for (const key of want) {
      const s = (r.signals || {})[key];
      if (s) hits.push({ key, label: s.label, count: s.count });
    }
    if (!hits.length) continue;
    const sysCoord = r.systemName ? index.coords[r.systemName] : null;
    out.push({
      source: 'journal',
      ring: r.name,
      system: r.systemName || '',
      ringClass: r.ringClass || '',
      reserve: r.reserve || '',
      reserveRank: RESERVE_RANK[r.reserve] || 0,
      depthLs: r.depthLs ?? null,
      distanceLy: dist3(referenceCoords, sysCoord),
      hits,
      hitCount: hits.reduce((a, h) => a + h.count, 0),
      other: Object.values(r.signals || {}).filter((s) => !want.has(commodityKey(s.label))).map((s) => s.label),
    });
  }
  return rankRings(out, opts);
}

/**
 * Composite quality score, so no single dimension can dominate the others.
 *
 * A strict priority ordering (hits → reserve → distance) was tried first and ranked a Pristine ring
 * 1,539 ly away ABOVE a Major ring 232 ly away — reserve level outweighing a 1,300 ly trip, which is
 * plainly wrong. Distance and depth therefore subtract continuously rather than acting as tiebreaks.
 *
 * Weights are a judgement call, not a measurement, and are exposed via `scoreParts` so the ranking
 * can be argued with instead of taken on faith. The one thing deliberately weighted heaviest is
 * MEASURED throughput: a ring this commander has personally pulled tonnes from beats any inferred
 * signal, because it is the only number here that isn't a proxy.
 */
export function scoreRing(r) {
  // Journal rows carry reserveRank; Spansh rows only carry the label. Derive when missing so both
  // sources score on the same scale.
  const rank = r.reserveRank ?? (RESERVE_RANK[normReserve(r.reserve)] || 0);
  const parts = {
    hotspots: (r.hitCount || 0) * 10,
    reserve: { 5: 15, 4: 10, 3: 5, 2: 0, 1: -10 }[rank] ?? 0,
    distance: r.distanceLy != null ? -(r.distanceLy / 10) : -5,
    depth: r.depthLs != null ? -(r.depthLs / 2000) : 0,
    measured: r.measuredTph ? r.measuredTph / 2 : 0,
  };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

export function rankRings(rows, opts = {}) {
  const measured = opts.measuredByRing || {};
  for (const r of rows) {
    const m = measured[r.ring];
    if (m && m.tonnesPerHour) r.measuredTph = m.tonnesPerHour;
    const { score, parts } = scoreRing(r);
    r.score = Math.round(score * 10) / 10;
    r.scoreParts = parts;
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Ring the commander is currently in, if it is one we have hotspot data for. */
export function getRingInfo(ringName) {
  return ringName ? index.rings[ringName] || null : null;
}

/**
 * DSS-mapped rings inside the given systems, richest first.
 *
 * Deliberately scoped to the commander's OWN systems: hunting a ring to mine is already served by
 * the ring finder on the mining page, which searches the galaxy. This answers a different question —
 * what does the ground I hold actually contain — so a better ring two hundred light years away is
 * not an answer, it is a distraction.
 *
 * Ranked on total hotspot count, then variety, because a ring concentrating one material and a ring
 * spreading five are worth different things and the count alone would flatten them.
 */
export function getRingsInSystems(systemsLower) {
  const want = systemsLower instanceof Set ? systemsLower : new Set(systemsLower || []);
  if (!want.size) return [];
  const out = [];
  for (const r of Object.values(index.rings || {})) {
    const sys = String(r.systemName || '').toLowerCase();
    if (!sys || !want.has(sys)) continue;
    const signals = Object.values(r.signals || {})
      .map((s) => ({ label: s.label || '', count: Number(s.count) || 0 }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    out.push({
      name: r.name,
      systemName: r.systemName || '',
      ringClass: String(r.ringClass || '').replace(/^eRingClass_/, ''),
      reserve: r.reserve || '',
      depthLs: r.depthLs ?? null,
      signals,
      hotspots: signals.reduce((a, s) => a + s.count, 0),
      kinds: signals.length,
      mappedAt: r.mappedAt || '',
    });
  }
  return out.sort((a, b) => b.hotspots - a.hotspots || b.kinds - a.kinds || a.name.localeCompare(b.name));
}

/**
 * Evidence-derived minable materials for the target picker.
 * `laserProven` marks materials actually seen in a ProspectedAsteroid Materials list. Hotspot-only
 * entries are surfaced but sorted below, because a commander without a seismic charge launcher
 * cannot act on a core-only material — this is observation, not a claim about game mechanics.
 */
// The journal is inconsistent about casing — some events carry Name_Localised ("Bromellite"),
// others only a raw lowercase Name ("tritium", "water", "gold"). Title-case the all-lowercase ones
// at the catalog boundary so every consumer (target picker, ignore chips) inherits the fix.
const displayLabel = (s) => {
  const t = String(s || '').trim();
  return t && t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t;
};

export function getMaterialCatalog() {
  return Object.values(index.materials)
    .map((m) => ({
      key: m.key,
      label: displayLabel(m.label),
      from: m.from,
      laserProven: m.from.includes('prospect') || m.from.includes('refined'),
    }))
    .sort((a, b) => {
      if (a.laserProven !== b.laserProven) return a.laserProven ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

/**
 * Rings seen in a body Scan but never DSS-mapped — the "you should scan these" list.
 * `systemsLower` (a Set of lowercased system names) narrows it, e.g. to colony systems.
 * Only covers systems where the parent body was actually scanned; a never-FSS'd system's rings
 * are invisible to the journal and cannot appear here.
 */
export function getUnmappedRings(systemsLower) {
  const out = [];
  for (const r of Object.values(index.allRings || {})) {
    if (index.rings[r.name]) continue;
    if (systemsLower && !systemsLower.has(String(r.system || '').toLowerCase())) continue;
    out.push(r);
  }
  return out.sort((a, b) =>
    String(a.system).localeCompare(String(b.system)) || String(a.name).localeCompare(String(b.name)));
}

/** Ring class for ANY seen ring — mapped or not (allRings carries classes from body Scans). */
export function getRingClassOf(ringName) {
  if (!ringName) return '';
  const m = index.rings[ringName];
  if (m && m.ringClass) return m.ringClass;
  const a = (index.allRings || {})[ringName];
  return (a && a.ringClass) || '';
}

export function ringIndexStats() {
  return {
    rings: Object.keys(index.rings).length,
    ringsSeen: Object.keys(index.allRings || {}).length,
    systems: Object.keys(index.coords).length,
    materials: Object.keys(index.materials).length,
    builtAt: index.builtAt,
  };
}
