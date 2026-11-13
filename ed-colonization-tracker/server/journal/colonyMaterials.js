// server/journal/colonyMaterials.js
//
// Material exposure across the commander's colony bodies (1.63.0): which bodies in the colony systems carry a raw
// material, and how much of the surface mix it is. The Materials page's "Colony bodies" tab reads this.
//
// Sources, journal first:
//   - the surface ledger's 'body' lines: a landable body's Materials from the commander's own Scan. surfaceMining.js
//     writes them as scans happen and backfills them from every journal on disk;
//   - Spansh's cached copy of a body, only where no scan of the commander's exists. A supplement, never a requirement,
//     and labelled as such;
//   - a landable body with neither is listed as unscanned. A missing scan is never a zero.
//
// Pure: state and ledger records in, a plain object out. No file, network or clock access.

import { isFleetCarrier, isColonisationShip } from './util.js';

const low = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const siteKey = (n) => low(String(n).replace(/^(planetary|orbital) construction site:\s*/i, ''));

/** "thin neon atmosphere" → "thin neon"; an airless body → "none"; nothing on file → null. */
export function tidyAtmosphere(a) {
  const s = String(a ?? '').trim();
  if (!s) return null;
  if (/^(none|no atmosphere)$/i.test(s)) return 'none';
  return s.replace(/\s+atmosphere$/i, '').toLowerCase();
}

/**
 * The surface ledger's survey of each body, keyed by lower-cased body name: materials and gravity from the newest scan,
 * class and atmosphere from any line that carries them (lines written before the ledger kept those simply lack the keys).
 * The same reading getSurfaceSummary gives the Surface Mining page.
 */
export function latestSurveys(records) {
  const out = new Map();
  for (const r of records || []) {
    if (!r || r.k !== 'body' || !r.body) continue;
    const k = low(r.body);
    let b = out.get(k);
    if (!b) { b = { body: r.body, system: r.system || null, at: null, materials: null, gravity: null, planetClass: undefined, atmosphere: undefined }; out.set(k, b); }
    const at = String(r.at || '');
    if (r.materials && (!b.at || at > b.at)) {
      b.at = at; b.materials = r.materials; b.gravity = num(r.gravity) ?? b.gravity; b.body = r.body;
      if (r.system) b.system = r.system;
    }
    if (r.planetClass !== undefined) { b.planetClass = r.planetClass; b.atmosphere = r.atmosphere ?? null; }
  }
  for (const [k, b] of out) if (!b.materials || !Object.keys(b.materials).length) out.delete(k);
  return out;
}

/**
 * Every body in the colony systems with a surface mix on file, the landable ones without, and the colony systems the
 * app holds no bodies for.
 * @param state      the app state (journalExplorationCache, scoutedSystems, knownStations, projects, …)
 * @param records    the surface ledger's records (readSurfaceRecords())
 * @param colonies   the colony systems, lower-cased (colonySystemsOf(state))
 */
export function colonyMaterialBodies(state, records, colonies) {
  const s = state || {};
  const mine = new Set([...(colonies || [])].map(low).filter(Boolean));
  const surveys = latestSurveys(records);

  // How each colony system is written: the journal's spelling first, then whoever else names it.
  const names = new Map();
  const name = (sys) => { const k = low(sys); if (k && mine.has(k) && !names.has(k)) names.set(k, String(sys).trim()); };
  for (const e of Object.values(s.journalExplorationCache || {})) if (e) name(e.systemName);
  for (const b of surveys.values()) name(b.system);
  for (const e of Object.values(s.scoutedSystems || {})) if (e) name(e.name);
  for (const p of s.projects || []) if (p) name(p.systemName || p.system);
  for (const m of s.manualColonizedSystems || []) name(m);
  for (const k of mine) if (!names.has(k)) names.set(k, k);

  // What else is on file about a body: whether it can be landed on, how far it is from the star, its class.
  const info = new Map(); // body (lower) → { name, sys, landable, ls, cls, atmo, spansh }
  for (const e of Object.values(s.journalExplorationCache || {})) {
    if (!e || !mine.has(low(e.systemName))) continue;
    for (const b of e.scannedBodies || []) {
      if (!b || !b.bodyName) continue;
      info.set(low(b.bodyName), { name: b.bodyName, sys: low(e.systemName), landable: !!(b.isLandable ?? b.landable), ls: num(b.distanceToArrival), cls: b.subType || null, atmo: b.atmosphereType ?? null, spansh: null });
    }
  }
  for (const e of Object.values(s.scoutedSystems || {})) {
    if (!e || !mine.has(low(e.name))) continue;
    for (const b of e.cachedBodies || []) {
      if (!b || !b.name) continue;
      const cur = info.get(low(b.name));
      if (cur) { cur.spansh = b; if (cur.ls == null) cur.ls = num(b.distanceToArrival); if (!cur.cls) cur.cls = b.subType || null; }
      else info.set(low(b.name), { name: b.name, sys: low(e.name), landable: !!b.isLandable, ls: num(b.distanceToArrival), cls: b.subType || null, atmo: b.atmosphereType ?? null, spansh: b });
    }
  }

  // The commander's sites at each body: the stations on file there, a construction site and the port it became counted once.
  const sites = new Map(); // body (lower) → Map(siteKey → name)
  const over = s.stationBodyOverrides || {};
  for (const st of Object.values(s.knownStations || {})) {
    if (!st || !st.stationName || !mine.has(low(st.systemName))) continue;
    // Not the commander's sites: carriers, the colonisation ship that sits there while a system is claimed, megaships.
    if (isFleetCarrier(st.stationType, st.marketId) || isColonisationShip(st.stationName, st.stationType) || st.stationType === 'MegaShip' || /^Trailblazer /i.test(st.stationName)) continue;
    const body = st.body || over[`${low(st.systemName)}|${low(st.stationName)}`] || null;
    if (!body) continue;
    const k = low(body);
    if (!sites.has(k)) sites.set(k, new Map());
    const at = sites.get(k); const sk = siteKey(st.stationName);
    const built = !/^(planetary|orbital) construction site:/i.test(st.stationName);
    if (!at.has(sk) || built) at.set(sk, st.stationName);
  }
  const sitesAt = (k) => (sites.has(k) ? [...sites.get(k).values()].sort(natural) : []);

  const row = (k, o) => ({
    body: o.body, system: o.system, source: o.source, at: o.at || null, materials: o.materials,
    gravity: o.gravity == null ? null : round2(o.gravity), planetClass: o.planetClass || null, atmosphere: tidyAtmosphere(o.atmosphere),
    icy: /icy/i.test(String(o.planetClass || '')), distanceLs: o.ls == null ? null : Math.round(o.ls), sites: sitesAt(k),
  });

  const bodies = []; const have = new Set();
  for (const [k, b] of surveys) {
    if (!mine.has(low(b.system))) continue;
    const i = info.get(k);
    bodies.push(row(k, {
      body: b.body, system: names.get(low(b.system)), source: 'scan', at: b.at, materials: b.materials, gravity: b.gravity,
      planetClass: b.planetClass ?? (i ? i.cls : null), atmosphere: b.atmosphere !== undefined ? b.atmosphere : (i ? i.atmo : null), ls: i ? i.ls : null,
    }));
    have.add(k);
  }
  for (const [k, i] of info) {
    if (have.has(k) || !i.landable || !i.spansh || !i.spansh.materials || typeof i.spansh.materials !== 'object') continue;
    const mats = {};
    for (const [n, p] of Object.entries(i.spansh.materials)) if (num(p) != null && p > 0) mats[low(n)] = round1(p);
    if (!Object.keys(mats).length) continue;
    bodies.push(row(k, {
      body: i.name, system: names.get(i.sys), source: 'spansh', at: i.spansh.updateTime || null, materials: mats, gravity: num(i.spansh.gravity),
      planetClass: i.spansh.subType || i.cls, atmosphere: i.spansh.atmosphereType ?? i.atmo, ls: i.ls,
    }));
    have.add(k);
  }
  bodies.sort((a, b) => natural(a.system, b.system) || natural(a.body, b.body));

  const unscannedBy = new Map();
  for (const [k, i] of info) {
    if (have.has(k) || !i.landable) continue;
    if (!unscannedBy.has(i.sys)) unscannedBy.set(i.sys, []);
    unscannedBy.get(i.sys).push(i.name);
  }
  const known = new Set([...info.values()].map((i) => i.sys));
  const systems = [...names].map(([k, n]) => ({
    name: n,
    bodies: bodies.filter((b) => low(b.system) === k).length,
    spansh: bodies.filter((b) => low(b.system) === k && b.source === 'spansh').length,
    unscanned: (unscannedBy.get(k) || []).length,
  })).sort((a, b) => natural(a.name, b.name));
  return {
    systems,
    bodies,
    unscanned: [...unscannedBy].map(([k, list]) => ({ system: names.get(k), bodies: list.sort(natural) })).sort((a, b) => natural(a.system, b.system)),
    empty: [...names].filter(([k]) => !known.has(k) && !bodies.some((b) => low(b.system) === k)).map(([, n]) => n).sort(natural),
  };
}
