// server/ai/copilotColonyWatch.js
//
// Colony Watch — area-activity awareness around the commander's OWN colonies, sourced from the
// Spansh / EDSM aggregators the app already uses. Two features share this one module:
//   A. Post-dock activity ping (~50ly) — "word from local contacts" on nearby traffic.
//   B. Session-boundary snapshot + diff (~15ly) — "while you were away" changes near colonies.
//
// Core discipline (see the handoff doc): both are POLL-based (no firehose), anonymized (NEVER a
// named commander), and honest about staleness — the "...that I've heard of" hedge is load-bearing.
// Aggregator queries are network I/O, so they run in the BACKGROUND (kicked off on LoadGame /
// Docked) and write results that the detectors read on a LATER poll tick — they never block the
// co-pilot's per-tick work. Anti-invention: only ever report what the aggregators actually return;
// on any failure / empty result, say "quiet" — never fabricate activity, a ship, or a commander.

import { searchNearbySystems, resolveSystemName } from '../journal/spansh.js';
import { getMemory, saveMemory } from './copilotMemory.js';
import { getGalaxyTick } from '../journal/tick.js';

const WATCH_RADIUS = 15;                 // Feature B — tight "backyard" sphere around each colony
const PING_MAX_EDSM = 5;                 // Feature A — cap EDSM traffic calls per dock (360/hr limit)
const PING_COOLDOWN_MS = 25 * 60 * 1000; // Feature A — at most one area ping per ~25 min
const EDSM_BASE = 'https://www.edsm.net';
const TRAFFIC_TTL = 30 * 60 * 1000;      // EDSM traffic cache (aggregate counts change slowly)

// Colonisation build sites surface as pseudo-"stations" with these markers (same recognition the
// SyncAll pipeline uses) — the real-time "a rival is building right now" signal.
const CONSTRUCTION_RE = /\$EXT_PANEL_ColonisationShip|Colonisation Ship|Construction Site/i;
const CARRIER_TYPE_RE = /carrier/i; // fleet carriers are transient — never count them as new construction

// ── Ephemeral session state (resets on restart; own-presence must not persist) ──────────────
const sessionVisited = new Set();   // lowercased system names the commander has been in THIS session
let watchSpoken = false;            // Feature B fires once per session
let pendingReport = null;           // Feature B result, awaiting a tick to speak: { colonies:[...], hadPrior }
let pendingPing = null;             // Feature A result, awaiting a tick to speak: { system,... } | { quiet:true }
let lastPingAt = 0;                 // Feature A cooldown
let lastKickedSession = -1;         // session counter we last kicked a refresh for (LoadGame recurs across ticks)
let refreshing = false;             // re-entrancy guard on the async refresh
const trafficCache = new Map();     // system(lower) -> { data, ts }

// ── Colony enumeration (mirrors isUserColony: manual list + project systems) ─────────────────
function listColonies(state) {
  const s = state || {};
  const out = new Map(); // lowerName -> displayName (dedup, preserve display case)
  for (const n of (Array.isArray(s.manualColonizedSystems) ? s.manualColonizedSystems : [])) {
    if (n) out.set(String(n).toLowerCase(), String(n));
  }
  for (const p of (Array.isArray(s.projects) ? s.projects : [])) {
    if (p && p.systemName) out.set(String(p.systemName).toLowerCase(), String(p.systemName));
  }
  return out;
}

// ── Snapshot / diff ─────────────────────────────────────────────────────────────────────────
function snapshotSystems(results) {
  const systems = {};
  for (const sys of (results || [])) {
    if (!sys || !sys.name) continue;
    const stationList = (Array.isArray(sys.stations) ? sys.stations : [])
      .filter((st) => st && st.name && !CARRIER_TYPE_RE.test(st.type || ''))
      .map((st) => ({ name: st.name, type: st.type || '' }));
    systems[sys.name] = {
      population: sys.population || 0,
      economy: sys.primary_economy || '',
      factionState: sys.controlling_minor_faction_state || '', // defensive — absent from the search contract, present at runtime for some systems
      stations: stationList,
      hasConstruction: stationList.some((st) => CONSTRUCTION_RE.test(st.name)),
    };
  }
  return systems;
}

// Compare a colony's prior sphere snapshot to the fresh one → meaningful, weighted changes.
// Skips the commander's OWN colony systems (their new stations are the commander's work, not a
// rival's). Construction > new station > new settlement > population/faction, matching the doc's
// "weight new construction highest".
function diffSnapshots(oldS, newS, colonySet, opts = {}) {
  // tickMoved=false → the galaxy BGS tick has NOT advanced between snapshots: faction-state and
  // population "changes" would be EDDN-lag noise, not real BGS movement — suppress them.
  // Construction/station diffs always fire (sites appear from PLAYER actions, not ticks).
  const tickMoved = opts.tickMoved !== false;
  const changes = [];
  for (const sysName of Object.keys(newS)) {
    if (colonySet.has(sysName.toLowerCase())) continue; // our own turf, not rival activity
    const o = oldS[sysName];
    const n = newS[sysName];
    if (!o) {
      // Newly IN the sphere usually just means "not previously scanned", not news — surface only if
      // it now shows a real presence (active construction, or a populated system with stations).
      if (n.hasConstruction) changes.push({ system: sysName, weight: 3, detail: `new construction underway in ${sysName} — someone's building` });
      else if (n.population > 0 && n.stations.length) changes.push({ system: sysName, weight: 2, detail: `${sysName} now shows a settled presence nearby` });
      continue;
    }
    if (n.hasConstruction && !o.hasConstruction) {
      changes.push({ system: sysName, weight: 3, detail: `new construction underway in ${sysName} — someone's building near us` });
    }
    const oldNames = new Set(o.stations.map((s) => s.name));
    const added = n.stations.filter((s) => !oldNames.has(s.name) && !CONSTRUCTION_RE.test(s.name));
    if (added.length) {
      changes.push({ system: sysName, weight: 3, detail: `${added.length === 1 ? 'a new station' : `${added.length} new stations`} appeared in ${sysName}` });
    }
    if (tickMoved && o.population > 0) {
      const inc = n.population - o.population;
      if (inc > 0 && inc / o.population >= 0.15 && inc >= 5000) {
        changes.push({ system: sysName, weight: 1, detail: `${sysName} has clearly grown busier` });
      }
    }
    if (tickMoved && o.factionState && n.factionState && o.factionState !== n.factionState
        && /War|CivilWar|Boom|Famine|Outbreak|Lockdown/i.test(n.factionState)) {
      changes.push({ system: sysName, weight: 1, detail: `${sysName} has shifted into ${n.factionState}` });
    }
  }
  return changes;
}

// Background refresh: snapshot each colony's ~15ly sphere, diff vs the stored snapshot, store fresh.
// Fire-and-forget from onSessionAndPresence(LoadGame). Never invents — a failed query just skips.
async function refreshColonyWatch(state) {
  if (refreshing) return;
  refreshing = true;
  try {
    await doRefresh(state);
  } finally {
    refreshing = false;
  }
}

async function doRefresh(state) {
  const mem = getMemory();
  if (!mem.colonyWatch || typeof mem.colonyWatch !== 'object') mem.colonyWatch = {};
  const colonies = listColonies(state);
  const colonySet = new Set(colonies.keys());
  const report = [];
  let hadPrior = false;

  for (const [key, colony] of colonies) {
    const prior = mem.colonyWatch[key];
    let coords = prior && prior.coords;
    if (!coords) {
      const r = await resolveSystemName(colony);
      if (!r) continue; // unresolvable → skip this colony, no invention
      coords = { x: r.x, y: r.y, z: r.z };
    }
    let results;
    try { results = await searchNearbySystems(coords, WATCH_RADIUS); }
    catch { continue; } // aggregator hiccup → skip, say nothing about this colony
    const newSystems = snapshotSystems(results);
    const nowTick = getGalaxyTick();
    if (prior && prior.systems) {
      hadPrior = true;
      // No tick boundary crossed between snapshots → BGS-state deltas are noise; construction
      // diffs still count. Tick unknown (service down / old snapshot) → allow all (old behaviour).
      const tickMoved = !(nowTick && prior.tickAt) || prior.tickAt !== nowTick;
      const changes = diffSnapshots(prior.systems, newSystems, colonySet, { tickMoved });
      if (changes.length) report.push({ colony, changes });
    }
    mem.colonyWatch[key] = { snapshotAt: new Date().toISOString(), coords, colonyName: colony, systems: newSystems, tickAt: nowTick };
  }

  // Prune snapshots for systems that are no longer colonies (kept the memory from growing forever).
  for (const k of Object.keys(mem.colonyWatch)) if (!colonySet.has(k)) delete mem.colonyWatch[k];

  saveMemory();
  pendingReport = { colonies: report, hadPrior };
}

// ── EDSM traffic (Feature A) ─────────────────────────────────────────────────────────────────
async function edsmTraffic(system) {
  const key = String(system).toLowerCase();
  const hit = trafficCache.get(key);
  if (hit && Date.now() - hit.ts < TRAFFIC_TTL) return hit.data;
  try {
    const res = await fetch(`${EDSM_BASE}/api-system-v1/traffic?systemName=${encodeURIComponent(system)}`,
      { headers: { 'User-Agent': 'ed-colony-tracker' } });
    const data = res.ok ? await res.json() : null;
    trafficCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    trafficCache.set(key, { data: null, ts: Date.now() });
    return null;
  }
}

// Background area ping: reuse the colony-watch spheres already in memory as the candidate list (no
// extra Spansh call), drop anything the commander visited this session (own-presence) and the dock
// system itself (we ARE its traffic), then check EDSM traffic for a bounded handful. Err to quiet.
async function runAreaPing(state, currentSystem) {
  const mem = getMemory();
  const cur = currentSystem ? String(currentSystem).toLowerCase() : '';
  const candidates = new Set();
  for (const k of Object.keys(mem.colonyWatch || {})) {
    const snap = mem.colonyWatch[k];
    for (const sysName of Object.keys((snap && snap.systems) || {})) {
      const low = sysName.toLowerCase();
      if (low === cur || sessionVisited.has(low)) continue; // it's us, or we were just there
      candidates.add(sysName);
    }
  }
  const list = [...candidates].slice(0, PING_MAX_EDSM);
  let best = null;
  for (const sys of list) {
    const t = await edsmTraffic(sys);
    const day = (t && t.traffic && t.traffic.day) || 0;
    const week = (t && t.traffic && t.traffic.week) || 0;
    const score = day * 7 + week; // recent-weighted
    if (score > 0 && (!best || score > best.score)) best = { system: sys, day, week, score };
  }
  pendingPing = best ? { system: best.system, day: best.day, week: best.week } : { quiet: true };
}

// ── Public: side-effecting hooks (call each tick from runCopilot) ────────────────────────────
/** Track own-presence + kick the session-start snapshot/diff on a fresh LoadGame. */
export function onSessionAndPresence(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  // FRESH PROCESS + live play → kick a refresh even with no LoadGame in sight. The exe frequently
  // starts MID-session (rebuilds), so the LoadGame was hours ago and the LoadGame-only kick never
  // fired — the reason the watch snapshotted exactly ONCE (2026-07-04) and then went dark.
  if (lastKickedSession === -1 && events.some((e) => e && isRecent(e.timestamp))) {
    lastKickedSession = getMemory().sessions.count || 0;
    refreshColonyWatch(state).catch(() => {});
  }
  for (const e of events) {
    if (!e) continue;
    if (e.event === 'LoadGame' && isRecent(e.timestamp)) {
      // LoadGame can appear "recent" across several consecutive poll ticks — kick the refresh only
      // once per REAL session (the session counter is bumped once per load by ingestWorld, which runs
      // before this). A second kick would read the just-written snapshot as its baseline and clobber
      // the real diff with an empty one.
      const sessionN = getMemory().sessions.count || 0;
      if (sessionN !== lastKickedSession) {
        lastKickedSession = sessionN;
        sessionVisited.clear();
        watchSpoken = false;
        pendingReport = null;
        refreshColonyWatch(state).catch(() => {}); // background — writes pendingReport when done
      }
    }
    if (e.StarSystem && /^(FSDJump|Location|Docked|SupercruiseExit|CarrierJump)$/.test(e.event)) {
      sessionVisited.add(String(e.StarSystem).toLowerCase());
    }
  }
}

/** Kick the area ping on a dock (cooldown-gated). Result is read by detectAreaActivity next tick. */
export function onDock(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const dock = events.find((e) => e && e.event === 'Docked' && isRecent(e.timestamp));
  if (!dock || now - lastPingAt < PING_COOLDOWN_MS) return;
  lastPingAt = now;
  runAreaPing(state, dock.StarSystem).catch(() => {});
}

// ── Public: beat detectors (call each tick; return a beat or null) ───────────────────────────
/** Feature B — the "while you were away" report, once per session, when the refresh has settled. */
export function detectColonyWatch(parsed, state) {
  if (!pendingReport || watchSpoken) return null;
  const report = pendingReport;
  pendingReport = null;
  watchSpoken = true;

  const persona = (state && state.settings && state.settings.copilotPersonality) || 'wash';
  const changes = report.colonies.flatMap((c) => c.changes);
  if (!changes.length) {
    if (!report.hadPrior) return null; // first time we've watched — nothing to compare, stay silent
    const line = pickQuiet(persona, 'watch');
    return line ? { key: 'colony-watch-quiet', priority: 34, interrupt: false, mood: 'calm', character: true, line } : null;
  }
  changes.sort((a, b) => b.weight - a.weight);
  const top = changes.slice(0, 2);
  const facts = top.map((c) => c.detail).join(' / ');
  const framing = persona === 'wash' ? 'social, a little gossipy — word through the grapevine'
    : persona === 'tars' ? 'precise and sourced — traffic / system data from the watch radius'
    : 'a threat / assessment read — someone has been building near us, and you do not like surprises';
  return {
    key: 'colony-watch', priority: 50, interrupt: false, live: true, model: 'sonnet', mood: 'calm', character: true,
    intent: `A "while you were away" report on the neighborhood around the commander's colonies, built from aggregator data — anonymized and slightly stale, so frame it as word from local contacts / things you have HEARD OF: NEVER a named commander, NEVER a specific ship, NEVER real-time certainty. Surface the ONE or two most notable, ${framing}: ${facts}. New construction near a colony is the big one — a rival building on the doorstep is exactly what the commander wants to know. One or two natural sentences in character; NEVER a list, and NEVER invent anything beyond these facts.`,
    detail: `Detail: colony-watch — ${facts}.`,
  };
}

/** Feature A — the post-dock area ping, when a kicked ping has settled. */
export function detectAreaActivity(parsed, state) {
  if (!pendingPing) return null;
  const ping = pendingPing;
  pendingPing = null;
  const persona = (state && state.settings && state.settings.copilotPersonality) || 'wash';
  if (ping.quiet) {
    const line = pickQuiet(persona, 'area');
    return line ? { key: 'area-quiet', priority: 30, interrupt: false, mood: 'calm', character: true, line } : null;
  }
  const framing = persona === 'wash' ? 'social and a little gossipy — "heard through the grapevine..."'
    : persona === 'tars' ? `precise — traffic data indicates recent movement near ${ping.system}`
    : 'an assessment / threat read — movement in the area, worth noting; could be nothing, could be your build-race rival';
  return {
    key: 'area-activity', priority: 44, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    intent: `Just docked, and word from local contacts is there's been recent commander activity in the area — around ${ping.system} (traffic seen there lately, aggregate and anonymized). Report it as slightly-stale scuttlebutt you have HEARD OF: NEVER name a commander, NEVER a specific ship or action, NEVER claim it's live. ${framing}. One natural line; an honest hedge like "...that I've heard of" fits well.`,
    detail: `Detail: area activity near ${ping.system}.`,
  };
}

// ── Quiet-line pools (literal, instant — no claude -p for a throwaway "all quiet") ───────────
const QUIET_LINES = {
  watch: {
    wash: [
      "Neighborhood's been quiet since last time — nobody's moved in on us that I've heard of.",
      "Checked around home while we were out. All quiet, no new neighbors worth mentioning.",
      "No word from the grapevine — the systems around ours look the same as we left them.",
    ],
    tars: [
      "No meaningful changes in the fifteen-light-year watch radius since last session.",
      "The neighborhood around the colonies is unchanged since last we looked. Noted.",
      "Watch radius scan: nothing new near the colonies that I've heard of.",
    ],
    k2: [
      "The area around our colonies is unchanged. Good. Surprises are for enemies.",
      "No one has built near us since last time. I would tell you if they had.",
      "Quiet around home. It rarely stays that way. Enjoy it while it lasts.",
    ],
  },
  area: {
    wash: [
      "No commanders within fifty light-years that I've heard of. Quiet out here.",
      "Grapevine's got nothing — quiet in the area, nobody around that I know of.",
    ],
    tars: [
      "No commander traffic within fifty light-years that I've heard of. Quiet.",
      "Traffic data from the nearby systems is flat. No movement worth noting.",
    ],
    k2: [
      "No movement in the area that I know of. Note the quiet. It rarely lasts.",
      "The area reads empty. That I've heard of. Stay alert regardless.",
    ],
  },
};
function pickQuiet(persona, kind) {
  const byKind = QUIET_LINES[kind] || {};
  const pool = byKind[persona] || byKind.wash || [];
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
}
