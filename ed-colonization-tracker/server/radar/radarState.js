// server/radar/radarState.js
//
// The radar's working memory: everything within 200 ly of the commander, split into layers.
//
//   density    — ~how many commanders are active nearby, deduped by EDDN uploaderID (an obfuscated
//                per-uploader constant), rolling 15-minute window. An ACTIVITY LEVEL, not a census:
//                only tool-running players appear, so every surfaced count carries the
//                "…that I've heard of" hedge. Own events are filtered (see noteOwnEvents).
//   builds     — colonisation/construction events. THE HEADLINE: rival-build detection.
//   prospects  — live Scan accumulation per system, scored by the CANONICAL scorer (scoreSystem);
//                partial data is scored as-is and flagged partial — a fresh lead, not a verdict.
//   atmoLeads  — single bodies whose atmosphere passes the rating system's interest test,
//                regardless of composite score (layer 3b).
//   conflicts  — systems whose faction arrays show war/civil war/election states.
//   power      — controlling power / faction / population per system.
//
// Anti-invention: every layer holds only what the stream/aggregators actually said. Empty = quiet.

import { scoreSystem } from '../journal/scorer.js';
import { journalBodiesToSpanshFormat } from '../journal/overlay.js';

export const RADAR_RANGE_LY = 200;

const DENSITY_WINDOW_MS = 15 * 60_000;
const LIVE_EVENT_TTL_MS = 30 * 60_000;    // live blips age out after half an hour
const OWN_EVENT_WINDOW_MS = 120_000;      // own-journal fingerprint match window
const MAX_LIST = 120;                     // per-layer cap; oldest evicted

const state = {
  center: { system: '', pos: null },      // [x,y,z]
  uploaders: new Map(),                   // uploaderID -> lastSeen (in-radius only)
  ownFingerprints: [],                    // { key: `${event}|${system}`, at }
  builds: [],                             // { sys, pos, ev, stationName?, at, live:true }
  atmoLeads: [],                          // { sys, body, atmo, pos, at, newToYou, live }
  prospects: new Map(),                   // sys -> { pos, bodies:[], score, partial, at, newToYou, complete }
  conflicts: new Map(),                   // sys -> { pos, factions:[{name,state}], at, live }
  power: new Map(),                       // sys -> { pos, power, faction, population, at, live }
  lookback: { systems: [], fetchedAt: 0, weekCount: 0 },
  scouted: [],                            // in-range scored systems from the commander's own list
  eddn: { msgs: 0, inRadius: 0, connected: false, lastMsgAt: 0 },
};

// Known-set membership for the NEW TO YOU tag — name sets injected on recenter (lowercased).
let knownNames = new Set();
// Colonization gate (commander's rule, 2026-07-24): "anything with population already would not be
// colonizable" — a system known to be populated can NEVER be a prospect or a lead. Fed from live
// FSDJump/Location population figures, lookback rows, and the commander's own colonised list.
// Unknown population stays eligible — most frontier scans are pop-0 and the stream can't prove a
// negative; only CONFIRMED population excludes.
const populatedNames = new Set();
export function notePopulated(sysName) { if (sysName) populatedNames.add(String(sysName).toLowerCase()); }
export function isKnownPopulated(sysName) { return populatedNames.has(String(sysName || '').toLowerCase()); }

export function setKnownNames(names) { knownNames = names; }
export function isNewToYou(sysName) { return !knownNames.has(String(sysName || '').toLowerCase()); }

export function setCenter(system, pos) {
  const moved = state.center.system !== system;
  state.center = { system: system || '', pos: Array.isArray(pos) ? pos : null };
  // Recentering does NOT clear the uploader map (since v1.28.6): every entry carries its own
  // position, so ACTIVE NEARBY re-filters spatially on read and the 15-min window handles
  // aging. Clearing here zeroed the density stat on every jump.
  return moved;
}
export function getCenter() { return state.center; }

export function distLyFrom(pos) {
  const c = state.center.pos;
  if (!c || !Array.isArray(pos)) return null;
  return Math.hypot(pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]);
}
export function inRadius(pos) {
  const d = distLyFrom(pos);
  return d != null && d <= RADAR_RANGE_LY;
}

/** Own-journal fingerprints — the commander's own EDMC feeds EDDN too; don't count yourself. */
export function noteOwnEvents(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  for (const e of events) {
    if (!e || !e.event) continue;
    const sys = e.StarSystem || state.center.system;
    if (!sys) continue;
    state.ownFingerprints.push({ key: `${e.event}|${sys}`, at: now });
  }
  const cutoff = now - OWN_EVENT_WINDOW_MS;
  state.ownFingerprints = state.ownFingerprints.filter((f) => f.at >= cutoff);
}

export function isOwnEvent(event, system) {
  const key = `${event}|${system}`;
  const cutoff = Date.now() - OWN_EVENT_WINDOW_MS;
  return state.ownFingerprints.some((f) => f.key === key && f.at >= cutoff);
}

export function markUploader(uploaderID, pos) {
  if (!uploaderID) return;
  // Last-seen time + last-known position per anonymized uploader. Positions (no IDs) go to the
  // client so the density stat can follow the zoom range; they're already public per-message.
  state.uploaders.set(String(uploaderID), { at: Date.now(), pos: Array.isArray(pos) ? pos : null });
}

// ---- per-system unique visitors (the "how many people have been HERE" number) -----------------
// sysLower -> Map<uploaderID, lastAt>. Survives recentering (history of a system stays true when
// you move); starts empty each exe boot — it only counts what this process personally heard.
const systemVisitors = new Map();
const VISITOR_WINDOW_MS = 24 * 3600_000;
export function noteSystemVisitor(sysName, uploaderID) {
  if (!sysName || !uploaderID) return;
  const key = String(sysName).toLowerCase();
  let m = systemVisitors.get(key);
  if (!m) { m = new Map(); systemVisitors.set(key, m); }
  m.set(String(uploaderID), Date.now());
  if (systemVisitors.size > 800) {
    // evict the system with the stalest most-recent visit
    let oldK = null, oldAt = Infinity;
    for (const [k, mm] of systemVisitors) {
      let mx = 0;
      for (const at of mm.values()) if (at > mx) mx = at;
      if (mx < oldAt) { oldAt = mx; oldK = k; }
    }
    if (oldK) systemVisitors.delete(oldK);
  }
}
export function visitorsIn(sysName) {
  const m = systemVisitors.get(String(sysName || '').toLowerCase());
  if (!m) return 0;
  const cutoff = Date.now() - VISITOR_WINDOW_MS;
  let n = 0;
  for (const [id, at] of m) { if (at < cutoff) m.delete(id); else n += 1; }
  return n;
}

// Center-system EDSM traffic, refreshed once per jump by the recenter hook.
let centerTraffic = null; // { sys, edsm: {day,week,total}|null, at }
export function setCenterTraffic(sys, edsm) { centerTraffic = { sys, edsm: edsm || null, at: Date.now() }; }

export function noteEddn(inRad, connected) {
  state.eddn.msgs += 1;
  if (inRad) state.eddn.inRadius += 1;
  state.eddn.lastMsgAt = Date.now();
  if (connected != null) state.eddn.connected = connected;
}
export function setEddnConnected(v) { state.eddn.connected = !!v; }

function push(list, item) {
  list.push(item);
  if (list.length > MAX_LIST) list.splice(0, list.length - MAX_LIST);
}

export function addBuild(ev) { push(state.builds, ev); }
export function addAtmoLead(ev) {
  // One lead per body — re-scans refresh the timestamp instead of duplicating.
  const dup = state.atmoLeads.find((l) => l.sys === ev.sys && l.body === ev.body);
  if (dup) { dup.at = ev.at; dup.live = true; return; }
  push(state.atmoLeads, ev);
}

/**
 * Accumulate a live-scanned body into its system and re-score with the canonical scorer.
 * EDDN journal Scan messages are the same shape as local journal Scan events, so the existing
 * journal→Spansh converter is reused verbatim — the radar and the Spansh search rate identically.
 */
export function addScannedBody(sysName, pos, scanMsg, complete) {
  let entry = state.prospects.get(sysName);
  if (!entry) {
    entry = { pos, bodies: [], at: 0, complete: false };
    state.prospects.set(sysName, entry);
    if (state.prospects.size > MAX_LIST) {
      // evict oldest
      let oldest = null;
      for (const [k, v] of state.prospects) if (!oldest || v.at < oldest[1].at) oldest = [k, v];
      if (oldest && oldest[0] !== sysName) state.prospects.delete(oldest[0]);
    }
  }
  if (scanMsg) {
    const id = scanMsg.BodyID ?? scanMsg.BodyName;
    if (!entry.bodies.some((b) => (b.BodyID ?? b.BodyName) === id)) entry.bodies.push(scanMsg);
  }
  if (complete) entry.complete = true;
  entry.at = Date.now();
  entry.pos = pos || entry.pos;
  try {
    const spanshBodies = journalBodiesToSpanshFormat(entry.bodies, sysName);
    entry.score = scoreSystem(spanshBodies);
  } catch { /* scoring must never kill ingestion */ }
  entry.partial = !entry.complete;
  entry.newToYou = isNewToYou(sysName);
  return entry;
}

export function addConflict(sysName, pos, factions) {
  state.conflicts.set(sysName, { pos, factions, at: Date.now(), live: true });
  trimMap(state.conflicts);
}
export function addPower(sysName, pos, rec) {
  state.power.set(sysName, Object.assign({ pos, at: Date.now(), live: true }, rec));
  if (rec && rec.population > 0) notePopulated(sysName);
  trimMap(state.power);
}
function trimMap(m) {
  if (m.size <= MAX_LIST) return;
  let oldest = null;
  for (const [k, v] of m) if (!oldest || v.at < oldest[1].at) oldest = [k, v];
  if (oldest) m.delete(oldest[0]);
}

export function setLookback(systems, weekCount) {
  state.lookback = { systems: systems || [], fetchedAt: Date.now(), weekCount: weekCount || 0 };
  for (const s of systems || []) if (s && s.population > 0) notePopulated(s.name);
}
export function setScoutedInRange(rows) { state.scouted = rows || []; }

/** The full picture, aged and radius-filtered at read time. */
export function snapshot() {
  const now = Date.now();
  const densityCutoff = now - DENSITY_WINDOW_MS;
  let liveCmdrs = 0;
  const cmdrPositions = [];
  for (const [k, u] of state.uploaders) {
    if (u.at < densityCutoff) {
      // long-stale uploader — drop it so the map doesn't grow unbounded over a long session
      if (u.at < now - 2 * DENSITY_WINDOW_MS) state.uploaders.delete(k);
      continue;
    }
    liveCmdrs += 1;
    if (u.pos) cmdrPositions.push([
      Math.round(u.pos[0] * 10) / 10, Math.round(u.pos[1] * 10) / 10, Math.round(u.pos[2] * 10) / 10,
    ]);
  }

  const liveCutoff = now - LIVE_EVENT_TTL_MS;
  const fresh = (arr) => arr.filter((e) => e.at >= liveCutoff && (!e.pos || inRadius(e.pos)));
  const claimable = (arr) => fresh(arr).filter((e) => !isKnownPopulated(e.sys));

  const prospects = [];
  for (const [sys, p] of state.prospects) {
    if (p.at < liveCutoff || (p.pos && !inRadius(p.pos))) continue;
    if (isKnownPopulated(sys)) continue; // populated = not colonizable = not a prospect
    prospects.push({
      name: sys, pos: p.pos, at: p.at, partial: !!p.partial, newToYou: !!p.newToYou,
      bodies: p.bodies.length, complete: !!p.complete,
      score: p.score ? (p.score.total ?? p.score.score ?? 0) : 0,
      src: 'live',
    });
  }

  const mapOut = (m) => {
    const out = [];
    for (const [sys, v] of m) {
      if (v.pos && !inRadius(v.pos)) continue;
      out.push(Object.assign({ sys }, v));
    }
    return out.sort((a, b) => b.at - a.at).slice(0, MAX_LIST);
  };

  return {
    center: state.center,
    range: RADAR_RANGE_LY,
    at: now,
    eddn: Object.assign({}, state.eddn),
    density: {
      liveCmdrs,
      positions: cmdrPositions, // anonymous last-known positions — never IDs
      windowMin: DENSITY_WINDOW_MS / 60000,
      weekSystems: state.lookback.weekCount,
    },
    centerTraffic: {
      sys: state.center.system,
      edsm: centerTraffic && centerTraffic.sys === state.center.system ? centerTraffic.edsm : null,
      liveVisitors: visitorsIn(state.center.system),
      windowH: VISITOR_WINDOW_MS / 3600_000,
    },
    builds: fresh(state.builds).sort((a, b) => b.at - a.at),
    atmoLeads: claimable(state.atmoLeads).sort((a, b) => b.at - a.at),
    liveProspects: prospects.sort((a, b) => b.score - a.score),
    conflicts: mapOut(state.conflicts),
    power: mapOut(state.power),
    scouted: state.scouted,
    lookback: { fetchedAt: state.lookback.fetchedAt, systems: state.lookback.systems },
  };
}
