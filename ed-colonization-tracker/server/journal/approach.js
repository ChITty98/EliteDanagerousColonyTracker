/**
 * Approach recorder — every descent from orbital cruise to a pad or a surface site, measured
 * against the commander's own shortest run at that target.
 *
 * The game gives three kinds of signal and this module joins them:
 *   - journal events: ApproachBody opens a run; ApproachSettlement names the port and carries
 *     its latitude/longitude; SupercruiseExit, DockingRequested, DockingGranted mark moments;
 *     Music "DockingComputer" is the hand-off to the docking computer (any other track while it
 *     has the ship is a retake); Docked or Touchdown closes the run; LeaveBody, an FSD jump, a
 *     death or a relog abandons it. (All of these are read from parsed.allEvents.)
 *   - Status.json, sampled once a second while a run is open: latitude, longitude, altitude,
 *     heading, the supercruise flag (Flags bit 4) and Glide Mode (Flags2 bit 12). Position is
 *     present from orbital cruise onward, which is exactly when a run is open.
 *   - derived: distance to the target on the body's radius (the surface module's own helper),
 *     closing speed, slope, seconds-to-target at the current closing speed — the app's version
 *     of the countdown the commander holds at 0:07.
 *
 * Runs are appended to approach-runs.jsonl in the app folder with their samples; the reference
 * for a target (shortest clean run, envelope, corridor, recommendations) is derived on read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { metresBetween, getNavTarget } from './surfaceMining.js';
import { friendlyShip } from './extractor.js';

const F_SUPERCRUISE = 1 << 4;
const F_HASLATLON = 1 << 21;
const IDLE_MS = 1000; // between looks at Status.json while no run is open — one small file read; every second, because the well is over in five to eight
const NAV_LOCK_FRESH_MS = 12 * 3600 * 1000; // a surface nav lock older than this is last week's site, not today's target
const CLOSING_FIXES = 2; // consecutive fixes closing on the target before a run opens on its own — two: every fix waited for is a second of coaching lost from a well that lasts five to eight (was three)
const OC_LINE_DEFAULT_M = 700000; // a position-opened run that starts below the line (the target's reference entry altitude, or this) is already in orbital cruise: a hop between ports on one body never crosses a line
export const DOCK_REQUEST_M = 7500; // the game takes a docking request inside this range
export const DOCK_AHEAD_M = 5000;   // the count-in to it while still in the glide
const DROP_GRACE_S = 5;  // seconds after leaving supercruise for the glide flag to appear; none = thrown out, too fast
// The words. An entry that would need this pitch or more from the line to the fastest run's glide point ended in a curl or a
// throw-out on every run on file; under EARLY_DEG it crossed far out and low. The countdown rules are the commander's own.
export const SHARP_DEG = 50;        // from here the entry is sharp: landable with the speed managed (22:21 landed direct from 57°), and every throw-out crossed here
export const RED_DEG = 60;          // the ladder's red zone: a glide will not engage past it, and no run has landed direct from an entry needing this
export const EARLY_DEG = 30;
export const EASY_DEG = 45;         // under this, INCREASE SPEED may be said
export const VERDICT_WITHIN_S = 5;  // the straight projection to the line held on every run within this many seconds of it, and failed once at eight
export const SLOW_MARGIN_S = 4;     // INCREASE SPEED: this many seconds of countdown above the fastest run's at the same altitude
export const FLOOR_QUIET_M = 40000; // below this the countdown climbs on every good run; INCREASE SPEED stays quiet
export const FLAT_LOW_M = 150000;   // two seconds at 0:05 or under below this is a curl call
export const GEOMETRY_FLOOR_M = 200000; // below this the angle to the glide point only measures the glide point approaching; the geometry curl is judged above it
const MAX_SECONDS_TO_TARGET = 120; // beyond this the countdown is noise (a near-zero closing speed)
const F2_GLIDE = 1 << 12;
const SAMPLE_MS = 1000;
/** A glide that ends above this is a broken glide: the flag cleared while the ship was still high. Nominal until data says otherwise. */
export const GLIDE_BROKEN_ALT_M = 5000;
/** Corridor drawn until three clean glides at a target set their own (degrees below horizontal). */
export const NOMINAL_CORRIDOR = [15, 55];
const ABANDON_AFTER_MS = 30 * 60 * 1000; // a run nobody closed (crash, alt-F4) is dropped at the next event this long after it opened
const ENVELOPE_STEP_M = 250;
/**
 * The clock starts here. Orbital cruise begins at a body-set altitude but at whatever distance the
 * approach angle happens to give (485 km one run, 783 km the next at the same pad), so time since
 * ApproachBody rewards luck. Everything inside the gate is the commander's: the glide decision, the
 * slope, the hand-off. The run-up before it is kept and shown, never counted.
 */
export const GATE_M = 100000;

let APP_DIR = null, JOURNAL_DIR = null, FILE = null;
let deps = { broadcastEvent: null, sendOverlay: null, applyStatePatch: null, readState: null };
let statusReader = null;   // tests inject a scripted Status.json
let clock = () => Date.now();
let runs = [];             // completed runs on file
let targets = new Map();   // key → { key, kind, name, marketId, lat, lon, bodyId, body }
let run = null;            // the open run
let timer = null;
let idleTimer = null;
let lastFigures = null;
const liveState = { prevCd: null, prevCd2: null, entryVerdict: null }; // the overlay's memory: the countdown one and two seconds ago, and the verdict on the entry
let noFixSamples = 0;
let idleFixes = []; // the last few idle fixes: { key, dist, alt } — a run opens only when they close on one target

// ---------- file ----------
export function initApproach(appDir, journalDir, d) {
  APP_DIR = appDir; JOURNAL_DIR = journalDir || null; FILE = path.join(appDir, 'approach-runs.jsonl');
  if (d) deps = { ...deps, ...d };
  runs = []; targets = new Map(); run = null; lastFigures = null;
  if (timer) { clearInterval(timer); timer = null; }
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (JOURNAL_DIR) idleTimer = setInterval(() => { try { idleTick(); } catch (e) { console.error('[Approach] idle:', e && e.message); } }, IDLE_MS);
  let raw = '';
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { return { runs: 0, targets: 0 }; }
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.k === 'target' && r.key) targets.set(r.key, r);
    if (r.k === 'run' && r.id) runs.push(withGate(remeasure(r)));
  }
  return { runs: runs.length, targets: targets.size };
}
export function setApproachDeps(d) { deps = { ...deps, ...d }; }
export function _setStatusReader(fn) { statusReader = fn; }
export function _setClock(fn) { clock = fn; }
function append(r) { if (!FILE) return; try { fs.appendFileSync(FILE, JSON.stringify(r) + '\n', 'utf8'); } catch { /* non-fatal */ } }

// ---------- Status.json ----------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export function normalizeStatus(d) {
  if (!d) return null;
  return {
    at: typeof d.timestamp === 'string' ? d.timestamp : null,
    flags: typeof d.Flags === 'number' ? d.Flags : 0,
    flags2: typeof d.Flags2 === 'number' ? d.Flags2 : 0,
    lat: num(d.Latitude), lon: num(d.Longitude), alt: num(d.Altitude), hdg: num(d.Heading),
    radius: num(d.PlanetRadius), body: d.BodyName || null,
    destination: d.Destination && typeof d.Destination === 'object' ? d.Destination : null,
  };
}
function readStatus() {
  if (statusReader) return statusReader();
  if (!JOURNAL_DIR) return null;
  try { return normalizeStatus(JSON.parse(fs.readFileSync(path.join(JOURNAL_DIR, 'Status.json'), 'utf8'))); } catch { return null; }
}

// ---------- time ----------
const ms = (iso) => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : null; };
const secondsSinceStart = (iso) => { const a = ms(run && run.startedAt), b = ms(iso) ?? clock(); return a == null ? 0 : Math.max(0, Math.round((b - a) / 1000)); };
const nowIso = () => new Date(clock()).toISOString();

// ---------- the open run ----------
function siteTargetFrom(nav, body, bodyId) {
  if (!nav || typeof nav.lat !== 'number' || typeof nav.lon !== 'number') return null;
  // The lock persists across sessions; six days on it still named a deposit on the far side of the body.
  const setAt = ms(nav.setAt);
  if (setAt == null || clock() - setAt > NAV_LOCK_FRESH_MS) return null;
  if (nav.body && body && nav.body !== body) return null;
  return { kind: 'site', key: `site:${body || nav.body || '?'}:${nav.label || 'target'}`, name: nav.label || 'target', lat: nav.lat, lon: nav.lon, bodyId: bodyId ?? null, body: body || nav.body || null };
}
/** The ship being flown, from the state the watcher keeps: type as the journal spells it, plus a friendly name. */
function shipNow(ctxShip) {
  let sh = ctxShip || null;
  if (!sh && deps.readState) { try { sh = deps.readState().currentShip || null; } catch { sh = null; } }
  if (!sh || !sh.type) return null;
  const type = String(sh.type).toLowerCase();
  return { type, name: friendlyShip(type), ident: sh.ident || null, shipId: sh.shipId ?? null };
}
function openRun({ at, body, bodyId, system, systemAddress, openedBy, target, ship, openedInCruise }) {
  liveState.prevCd = null; liveState.prevCd2 = null; liveState.entryVerdict = null;
  if (run) abandon('new approach');
  run = {
    id: `${(at || nowIso()).replace(/[-:]/g, '').slice(0, 15)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: at || nowIso(), openedBy, openedInCruise: !!openedInCruise,
    body: body || null, bodyId: bodyId ?? null, system: system || null, systemAddress: systemAddress ?? null,
    target: target || null, samples: [], marks: [], computer: false, retakes: 0, ship: shipNow(ship), scExitT: null,
  };
  if (run.target) rememberTarget(run.target);
  noFixSamples = 0;
  startTimer();
  emit('approach_start', { runId: run.id, body: run.body, target: run.target });
}
/** ApproachBody: orbital cruise begins. A run already open from a position fix on this body just gains the mark. */
function startRun(ev, ctx) {
  if (run && run.openedBy === 'position' && (run.bodyId == null || ev.BodyID == null || run.bodyId === ev.BodyID) && !hasMark('approach_body')) {
    run.body = run.body || ev.Body || null; run.bodyId = run.bodyId ?? ev.BodyID ?? null;
    run.system = run.system || ev.StarSystem || ctx.system || null; run.systemAddress = run.systemAddress ?? ev.SystemAddress ?? ctx.systemAddress ?? null;
    mark('approach_body', ev);
    return;
  }
  openRun({ at: ev.timestamp, body: ev.Body, bodyId: ev.BodyID, system: ev.StarSystem || ctx.system, systemAddress: ev.SystemAddress ?? ctx.systemAddress, openedBy: 'event', target: siteTargetFrom(ctx.navTarget, ev.Body || null, ev.BodyID ?? null), ship: ctx.ship });
  mark('approach_body', ev);
}
/** Re-measure every sample against the run's target: distance, then closing speed and slope from the distances. */
export function remeasure(r) {
  if (!r || !r.target || !Array.isArray(r.samples)) return r;
  let prev = null;
  for (const p of r.samples) {
    p.dist = p.radius ? metresBetween(p.lat, p.lon, r.target.lat, r.target.lon, p.radius) : null;
    p.speed = null; p.slope = null;
    if (prev && p.dist != null && prev.dist != null && p.t > prev.t) {
      const dd = prev.dist - p.dist, da = (prev.alt ?? 0) - (p.alt ?? 0), dt = p.t - prev.t;
      p.speed = Math.round(dd / dt);
      p.vrate = Math.round(da / dt);
      p.slope = dd > 0 ? Math.round(Math.atan(da / dd) * 180 / Math.PI) : null;
    }
    prev = p;
  }
  for (const m of r.marks || []) {
    const i = r.samples.reduce((b, p, k) => (b < 0 || Math.abs(p.t - m.t) < Math.abs(r.samples[b].t - m.t) ? k : b), -1);
    const near = i >= 0 ? r.samples[i] : null;
    if (near && m.dist != null) { m.dist = near.dist; m.speed = near.speed; }
    if (near) { const rg = hudRange(near), cd = i > 0 ? hudCountdown(near, r.samples[i - 1]) : null; m.rangeM = rg == null ? null : Math.round(rg); m.countdownS = cd == null ? null : Math.round(cd); }
  }
  return r;
}
/** A port on file that Status.json's Destination names, on this body when the body is known. */
function portFromDestination(st) {
  if (!st || !st.destination || !st.destination.Name) return null;
  const name = String(st.destination.Name).toLowerCase();
  const bodyId = st.destination.Body ?? null;
  for (const t of targets.values()) if (t.kind === 'port' && String(t.name).toLowerCase() === name && (bodyId == null || t.bodyId == null || t.bodyId === bodyId)) return { ...t };
  return null;
}
/**
 * While no run is open: the game gives a position inside a body's gravity well well before orbital
 * cruise (1.25 Mm up at 1.70 Mm out, in the commander's own screenshot). If the ship is in supercruise
 * with a fix, heading for a target we know — a port on file named by Destination, or a surface nav lock —
 * the run opens here, so the whole approach is on the slope. The clock still starts at the gate.
 */
export function idleTick() {
  if (run) return;
  const st = readStatus();
  if (!st || st.lat == null || st.lon == null || !(st.flags & F_HASLATLON) || !(st.flags & F_SUPERCRUISE)) return;
  const target = portFromDestination(st) || siteTargetFrom(getNavTarget(), st.body, st.destination ? st.destination.Body ?? null : null);
  if (!target) { idleFixes = []; return; }
  // Closing, not departing: two fixes in a row nearer the target and lower. A takeoff climbs away and never qualifies.
  const dist = st.radius ? metresBetween(st.lat, st.lon, target.lat, target.lon, st.radius) : null;
  if (dist == null) { idleFixes = []; return; }
  const now = ms(st.at) ?? clock();
  if (idleFixes.length && (idleFixes[idleFixes.length - 1].key !== target.key || now - idleFixes[idleFixes.length - 1].at > 10000)) idleFixes = [];
  idleFixes.push({ key: target.key, dist, alt: st.alt ?? 0, at: now, st });
  if (idleFixes.length > CLOSING_FIXES) idleFixes.shift();
  if (idleFixes.length < CLOSING_FIXES) return;
  for (let i = 1; i < idleFixes.length; i++) if (!(idleFixes[i].dist < idleFixes[i - 1].dist)) return;
  if (!(idleFixes[idleFixes.length - 1].alt <= idleFixes[0].alt)) return;
  const fixes = idleFixes; idleFixes = [];
  // The run starts at the first of those fixes, not the last: the game gives position from about 1.7 Mm out, and the
  // seconds before the line are where the entry can still be read. The fixes the watch collected become the first samples.
  // Below the line already (the target's own reference entry altitude, or OC_LINE_DEFAULT_M without one): orbital cruise from the
  // first sample. A hop between two ports on one body never crosses a line, and used to sit in "Gravity well" the whole way down.
  const refAtOpen = summarizeTarget(target.key);
  const lineAltM = refAtOpen && refAtOpen.recommendation && refAtOpen.recommendation.cruise && refAtOpen.recommendation.cruise.entryAltM != null ? refAtOpen.recommendation.cruise.entryAltM : OC_LINE_DEFAULT_M;
  const openedInCruise = (fixes[0].alt ?? 0) < lineAltM;
  openRun({ at: fixes[0].st.at, body: st.body || target.body || null, bodyId: target.bodyId ?? (st.destination ? st.destination.Body ?? null : null), system: null, systemAddress: st.destination ? st.destination.System ?? null : null, openedBy: 'position', target, openedInCruise });
  for (let i = 0; i < fixes.length; i++) { ingestStatus(fixes[i].st); if (i === 0) mark('position_fix', { timestamp: fixes[0].st.at }); }
  const last = lastSample();
  if (last) afterSample(last);
}

function rememberTarget(t) {
  if (!t || !t.key) return;
  const prior = targets.get(t.key);
  if (prior && prior.lat === t.lat && prior.lon === t.lon && prior.name === t.name) return;
  targets.set(t.key, { ...t });
  append({ k: 'target', ...t });
}

function setTargetFromSettlement(ev) {
  if (!run || typeof ev.Latitude !== 'number' || typeof ev.Longitude !== 'number') return;
  const t = { kind: 'port', key: `port:${ev.MarketID}`, name: ev.Name || ev.Name_Localised || 'port', marketId: ev.MarketID ?? null, lat: ev.Latitude, lon: ev.Longitude, bodyId: ev.BodyID ?? run.bodyId, body: ev.BodyName || run.body };
  run.target = t;
  rememberTarget(t);
  // The station dossier gets the pad's coordinates too, field-level, only when the record exists.
  try {
    if (deps.readState && deps.applyStatePatch && t.marketId != null) {
      const ks = (deps.readState().knownStations || {})[String(t.marketId)];
      if (ks && !(ks.surface && ks.surface.lat === t.lat && ks.surface.lon === t.lon)) {
        deps.applyStatePatch({ knownStations: { __upsert: { [String(t.marketId)]: { ...ks, surface: { lat: t.lat, lon: t.lon, bodyId: t.bodyId, bodyName: t.body, at: ev.timestamp || nowIso() } } } } });
      }
    }
  } catch { /* dossier write is a courtesy */ }
  // The port is authoritative: every sample so far is re-measured to it (a stale site lock had run 4 at
  // Deshpande Plant measuring 1,700 km to a deposit for its first fifteen seconds).
  remeasure(run);
  mark('target_known', ev);
}

/** A run that opened without a port: Status.json's Destination names one we have on file. */
function targetFromDestination(st) {
  if (!run || run.target) return;
  const t = portFromDestination(st);
  if (t && (run.bodyId == null || t.bodyId == null || t.bodyId === run.bodyId)) { run.target = t; remeasure(run); mark('target_known', { timestamp: st.at }); }
}

function lastSample() { return run && run.samples.length ? run.samples[run.samples.length - 1] : null; }

function mark(kind, ev, extra = {}) {
  if (!run) return;
  const s = lastSample();
  const at = (ev && ev.timestamp) || (ev && ev.at) || nowIso();
  const prev = run.samples.length >= 2 ? run.samples[run.samples.length - 2] : null;
  const rangeM = s ? hudRange(s) : null, cd = s && prev ? hudCountdown(s, prev) : null;
  const m = { kind, t: secondsSinceStart(at), at, dist: s ? s.dist : null, alt: s ? s.alt : null, speed: s ? s.speed : null, rangeM: rangeM == null ? null : Math.round(rangeM), countdownS: cd == null ? null : Math.round(cd), ...extra };
  run.marks.push(m);
  if (kind === 'handoff') run.computer = true;
  if (kind === 'retake') { run.computer = false; run.retakes += 1; }
  emit('approach_mark', { runId: run.id, mark: m });
  return m;
}

const hasMark = (kind) => !!(run && run.marks.some((m) => m.kind === kind));
const markOf = (r, kind) => (r.marks || []).find((m) => m.kind === kind) || null;

export function phaseAt(r, t) {
  const at = (kind) => { const m = markOf(r, kind); return m ? m.t : null; };
  const gs = at('glide_start'), ge = at('glide_end'), dr = at('docking_requested'), ho = at('handoff'), ab = at('approach_body');
  if (ho != null && t >= ho) return 'Docking';
  if (dr != null && t >= dr) return 'Docking';
  if (ge != null && t >= ge) return 'Normal flight';
  if (gs != null && t >= gs) return 'Glide';
  if (markOf(r, 'position_fix') && !r.openedInCruise && (ab == null || t < ab)) return 'Gravity well';
  return 'Orbital cruise';
}

// ---------- sampling ----------
function startTimer() { if (timer) clearInterval(timer); timer = setInterval(() => { try { sampleOnce(); } catch (e) { console.error('[Approach] sample:', e && e.message); } }, SAMPLE_MS); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

/** One Status.json sample into the open run. Exported so tests (and the companion tick) can drive it. */
export function sampleOnce() {
  if (!run) return null;
  if (ms(run.startedAt) != null && clock() - ms(run.startedAt) > ABANDON_AFTER_MS) { abandon('timeout'); return null; }
  const st = readStatus();
  // No new position (the game rewrites Status.json only when the ship has moved enough): hold the
  // overlay line rather than let it expire between samples under the docking computer.
  if (!st || st.lat == null || st.lon == null) {
    if (run.openedBy === 'position' && !hasMark('approach_body') && ++noFixSamples >= 10) { abandon('left the gravity well'); return null; }
    if (lastFigures) overlay(lastFigures); return null;
  }
  noFixSamples = 0;
  if (!run.target) targetFromDestination(st);
  const s = ingestStatus(st);
  if (!s) { if (lastFigures) overlay(lastFigures); return null; }
  return afterSample(s);
}
/** One Status.json fix into the open run as a sample, measured against the sample before it. Null when it is the same second. */
function ingestStatus(st) {
  if (!run || !st || st.lat == null || st.lon == null) return null;
  const t = secondsSinceStart(st.at);
  const prev = lastSample();
  if (prev && prev.t === t) return null;
  const dist = run.target ? metresBetween(st.lat, st.lon, run.target.lat, run.target.lon, st.radius) : null;
  const s = { t, at: st.at || nowIso(), lat: st.lat, lon: st.lon, alt: st.alt, hdg: st.hdg, radius: st.radius, dist, glide: (st.flags2 & F2_GLIDE) !== 0, sc: (st.flags & F_SUPERCRUISE) !== 0, speed: null, slope: null };
  if (prev && dist != null && prev.dist != null && t > prev.t) {
    const dd = prev.dist - dist, da = (prev.alt ?? 0) - (s.alt ?? 0), dt = t - prev.t;
    s.speed = Math.round(dd / dt);                                     // closing speed, m/s (ground)
    s.vrate = Math.round(da / dt);                                     // descent rate, m/s (positive = down)
    s.slope = dd > 0 ? Math.round(Math.atan(da / dd) * 180 / Math.PI) : null; // degrees below horizontal
  }
  run.samples.push(s);
  return s;
}
/** After a sample: the drop check, the glide marks, the figures for the page and the overlay. */
function afterSample(s) {
  if (run.scExitT != null && !hasMark('glide_start') && !hasMark('docking_requested') && !s.glide && !s.sc && s.t - run.scExitT >= DROP_GRACE_S && (s.alt ?? 0) > GLIDE_BROKEN_ALT_M) {
    finishRun('dropped', { timestamp: s.at });
    return null;
  }
  if (s.glide && !hasMark('glide_start')) mark('glide_start', { timestamp: s.at });
  if (!s.glide && hasMark('glide_start') && !hasMark('glide_end')) mark('glide_end', { timestamp: s.at }, { broken: (s.alt ?? 0) > GLIDE_BROKEN_ALT_M });
  const fig = liveFigures(s);
  lastFigures = fig;
  emit('approach_sample', fig);
  overlay(fig);
  return s;
}

/** The HUD's own range to the target: the straight line through space, from the arc on the surface and the altitude above it. */
export function hudRange(s) {
  if (!s || s.dist == null || s.alt == null || !s.radius) return null;
  const R = s.radius, h = s.alt, th = s.dist / R;
  return Math.sqrt(R * R + (R + h) * (R + h) - 2 * R * (R + h) * Math.cos(th));
}
/** The HUD countdown at a sample: its range over how fast that range closed since the sample before. Null when it is noise. */
export function hudCountdown(s, prev) {
  const c = hudRange(s), p = hudRange(prev);
  if (c == null || p == null || !prev || !(s.t > prev.t)) return null;
  const rate = (p - c) / (s.t - prev.t);
  if (!(rate > 0)) return null;
  const cd = c / rate;
  return cd <= MAX_SECONDS_TO_TARGET ? cd : null;
}
/**
 * Ladder pitch, nose below the horizon, that reaches a point (ground distance, altitude) from a sample: the slope over
 * the ground, corrected for the ship moving above the surface the ground is measured on. Null past the point.
 */
export function pitchTo(s, distM, altM) {
  if (!s || s.dist == null || s.alt == null || !s.radius || distM == null || altM == null || s.dist <= distM) return null;
  const apparent = Math.atan2(s.alt - altM, s.dist - distM);
  return Math.round(Math.atan(Math.tan(apparent) * s.radius / (s.radius + s.alt)) * 180 / Math.PI);
}
/** A run's HUD countdown when it was at this altitude on the way down; null outside its samples. */
export function countdownAtAltitude(samples, alt) {
  if (alt == null) return null;
  const pts = (samples || []).filter((p) => p.alt != null && p.dist != null && p.radius);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.alt >= alt && b.alt < alt) {
      const ca = i >= 2 ? hudCountdown(a, pts[i - 2]) : null, cb = hudCountdown(b, a);
      if (cb == null) return ca; if (ca == null) return cb;
      const u = a.alt === b.alt ? 0 : (a.alt - alt) / (a.alt - b.alt);
      return ca + (cb - ca) * u;
    }
  }
  return null;
}
/** A run's altitude when its HUD range read this on the way in; null when the run has no sample that far out. */
export function altAtHudRange(samples, rangeM) {
  const pts = (samples || []).filter((p) => p.alt != null && p.dist != null && p.radius).map((p) => ({ r: hudRange(p), alt: p.alt }));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.r >= rangeM && b.r < rangeM) { const u = a.r === b.r ? 0 : (a.r - rangeM) / (a.r - b.r); return a.alt + (b.alt - a.alt) * u; }
  }
  return null;
}
const fmtMm = (m) => `${(m / 1e6).toFixed(2)} Mm`;
const fmtPitch = (deg) => (deg >= 0 ? `-${deg}°` : `+${-deg}°`);
const fmtCd = (cd) => `0:${String(Math.round(cd)).padStart(2, '0')}`;

function liveFigures(s) {
  const phase = phaseAt(run, s.t);
  const rawSeconds = s.dist != null && s.speed > 0 ? Math.round(s.dist / s.speed) : null;
  const secondsToTarget = rawSeconds != null && rawSeconds <= MAX_SECONDS_TO_TARGET ? rawSeconds : null;
  const ref = run.target ? summarizeTarget(run.target.key, run.id, run.ship ? run.ship.type : null) : null;
  const shortest = ref && ref.shortest ? ref.shortest : null;
  let vsShortestS = null, vsShortestAltM = null;
  const gateT = gateTimeOf(run.samples);
  const runT = gateT == null ? null : Math.max(0, s.t - gateT);
  if (shortest && s.dist != null && runT != null && shortest.gateT != null) {
    const rt = valueAtDistance(shortest.samples, s.dist, 't'), ra = valueAtDistance(shortest.samples, s.dist, 'alt');
    if (rt != null) vsShortestS = Math.round((rt - shortest.gateT) - runT); // + = ahead of the shortest run at this distance, both clocks from the gate
    if (ra != null && s.alt != null) vsShortestAltM = Math.round(s.alt - ra);
  }
  const lineAltM = shortest && s.dist != null ? valueAtDistance(shortest.samples, s.dist, 'alt') : null;
  const lineDeg = shortest && s.dist != null ? slopeAtDistance(shortest.samples, s.dist) : null;
  // The HUD's numbers: the range through space and the countdown the commander flies by; and the fastest run's countdown here.
  const prev = run.samples.length >= 2 ? run.samples[run.samples.length - 2] : null;
  const rangeM = hudRange(s);
  const countdownS = prev ? hudCountdown(s, prev) : null;
  const refCd = shortest && s.alt != null ? countdownAtAltitude(shortest.samples, s.alt) : null;
  return {
    runId: run.id, target: run.target ? { key: run.target.key, name: run.target.name, kind: run.target.kind } : null,
    phase, t: s.t, gateT, runT, dist: s.dist, alt: s.alt, speed: s.speed, slope: s.slope, glide: s.glide, computer: run.computer,
    lat: s.lat, lon: s.lon, hdg: s.hdg, radius: s.radius,
    secondsToTarget, vsShortestS, vsShortestAltM, lineAltM: lineAltM == null ? null : Math.round(lineAltM), lineDeg,
    rangeM: rangeM == null ? null : Math.round(rangeM), countdownS: countdownS == null ? null : Math.round(countdownS * 10) / 10, refCountdownS: refCd == null ? null : Math.round(refCd * 10) / 10,
    ...coachLine(phase, s, ref, vsShortestS, countdownS, refCd),
    refShip: shortest && shortest.ship ? { type: shortest.ship.type, name: shortest.ship.name, same: ref.sameShip } : null,
    at: s.at,
  };
}

/**
 * The HUD line: one of six words, or nothing. Before the line, a verdict on the entry once the line is within a straight
 * projection's reach: ON TRACK, ENTRY TOO SHARP (the crossing would need SHARP_DEG or more to the fastest run's glide point —
 * every such entry on file curled or was thrown out), ENTRY TOO EARLY (under EARLY_DEG: far out and low). In orbital cruise,
 * from the countdown the commander already watches: DECREASE SPEED at 0:05, or 0:06 and falling; CURL ROUTE ADVISED when it
 * has dropped twice in a row to 0:05 or under, or sat there two seconds below FLAT_LOW_M, or the pitch to the glide point has
 * reached SHARP_DEG; INCREASE SPEED when the geometry is easy, the ship is above FLOOR_QUIET_M and the countdown runs
 * SLOW_MARGIN_S or more above the fastest run's at this altitude; ON TRACK otherwise. No speeds, no angles on the HUD.
 */
function coachLine(phase, s, ref, vsShortestS, countdownS, refCd) {
  const km = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const rec = ref && ref.recommendation;
  const cr = rec && rec.cruise;
  const shortest = ref && ref.shortest;
  const who = ref && ref.sameShip === false && ref.shortest && ref.shortest.ship ? ` (${ref.shortest.ship.name})` : '';
  const gp = shortest && shortest.glide && shortest.glide.startDistM != null && shortest.glide.startAltM != null ? { dist: shortest.glide.startDistM, alt: shortest.glide.startAltM } : null;
  let word = null, docking = null, note = null, clock = null, need = null;
  const detail = [];
  const shown = countdownS == null ? null : Math.round(countdownS);
  const prev = liveState.prevCd == null ? null : Math.round(liveState.prevCd), prev2 = liveState.prevCd2 == null ? null : Math.round(liveState.prevCd2);
  const falling = shown != null && prev != null && shown < prev;
  if (countdownS != null) detail.push(`countdown ${fmtCd(countdownS)}${falling ? ' falling' : ''}`);
  if (phase === 'Gravity well') {
    if (cr && cr.entryAltM != null && gp && s.alt != null && s.alt > cr.entryAltM && s.vrate > 0 && s.speed != null && s.dist != null && s.radius) {
      const tTo = (s.alt - cr.entryAltM) / s.vrate;
      // The straight projection to the line: firm within VERDICT_WITHIN_S (it held on every run there), an early read before
      // that — the well lasts five to eight seconds at cruise speed, and a word six seconds out is worth more than a firm one
      // at two. Only the firm word stands for the descent.
      const ground = Math.max(0, s.dist - s.speed * tTo);
      need = pitchTo({ dist: ground, alt: cr.entryAltM, radius: s.radius }, gp.dist, gp.alt);
      if (need != null) {
        const verdict = need >= RED_DEG ? 'ENTRY TOO SHARP' : need >= SHARP_DEG ? 'ENTRY SHARP' : need < EARLY_DEG ? 'ENTRY TOO EARLY' : 'ON TRACK';
        if (tTo <= VERDICT_WITHIN_S) {
          word = verdict;
          liveState.entryVerdict = word; // the last verdict before the line stands for the descent
          detail.push(`crossing ${fmtMm(hudRange({ dist: ground, alt: cr.entryAltM, radius: s.radius }))} in ${Math.round(tTo)} s, needs ${need}° to the glide point`);
        } else {
          word = `${verdict} (early)`;
          detail.push(`line in ${Math.round(tTo)} s, early read: needs ${need}° to the glide point`);
        }
      } else detail.push(`line in ${Math.round(tTo)} s`);
    }
    if (!cr) note = 'no reference yet at this target';
  } else if (phase === 'Orbital cruise') {
    need = gp ? pitchTo(s, gp.dist, gp.alt) : null;
    if (need != null) detail.push(`pitch ${fmtPitch(need)} to the glide point`);
    if (refCd != null) detail.push(`fastest run here ${fmtCd(refCd)}`);
    // The entry decides whether speed is coached at all: every throw-out on file crossed sharp, and no run that crossed
    // on track has ever been thrown out, three of them holding 0:05 into the last 40 km. Without a verdict from the well
    // (a run opened at the line), the first look above GEOMETRY_FLOOR_M stands in for it.
    if (liveState.entryVerdict == null && need != null && s.alt != null && s.alt > GEOMETRY_FLOOR_M) liveState.entryVerdict = need >= RED_DEG ? 'ENTRY TOO SHARP' : need >= SHARP_DEG ? 'ENTRY SHARP' : need < EARLY_DEG ? 'ENTRY TOO EARLY' : 'ON TRACK';
    const sharpEntry = liveState.entryVerdict === 'ENTRY SHARP' || liveState.entryVerdict === 'ENTRY TOO SHARP';
    if (liveState.entryVerdict) detail.push(liveState.entryVerdict === 'ENTRY TOO SHARP' ? 'entry too sharp' : liveState.entryVerdict === 'ENTRY SHARP' ? 'sharp entry' : liveState.entryVerdict === 'ENTRY TOO EARLY' ? 'early entry' : 'entry on track');
    // The countdown words live below FLAT_LOW_M: every throw-out collapsed there, and a 0:05 above it has never hurt a run.
    const low = s.alt != null && s.alt < FLAT_LOW_M;
    const slow = sharpEntry && low && shown != null && (shown <= 5 || (shown === 6 && falling));
    const twoDrops = sharpEntry && low && shown != null && prev != null && prev2 != null && shown <= 5 && shown < prev && prev < prev2;
    const flatLow = sharpEntry && shown != null && prev != null && shown <= 5 && prev <= 5 && s.alt != null && s.alt < FLAT_LOW_M;
    const steepHigh = need != null && need >= RED_DEG && s.alt != null && s.alt > GEOMETRY_FLOOR_M; // the red zone, judged high up: near the glide point the angle to it climbs on every run
    if (twoDrops || flatLow || steepHigh) word = 'CURL ROUTE ADVISED';
    else if (slow) word = 'DECREASE SPEED';
    else if (need != null && need < EASY_DEG && s.alt != null && s.alt > FLOOR_QUIET_M && refCd != null && countdownS != null && countdownS >= refCd + SLOW_MARGIN_S) word = 'INCREASE SPEED';
    else if (need != null) word = 'ON TRACK';
    if (!cr) note = 'no reference yet at this target';
  } else if (phase === 'Glide' || phase === 'Normal flight') {
    // The game takes a docking request inside DOCK_REQUEST_M. The word waits for that — it used to sit on the HUD from the
    // glide's end, 32 s early when the glide ended at 19 km — with a count-in: through normal flight, and in the glide once
    // the range is within DOCK_AHEAD_M of it.
    const rng = hudRange(s);
    if (rng != null) {
      if (rng <= DOCK_REQUEST_M) docking = 'request docking';
      else if (phase === 'Normal flight' || rng <= DOCK_REQUEST_M + DOCK_AHEAD_M) docking = `request docking in ${km(rng - DOCK_REQUEST_M)}`;
    }
  } else if (phase === 'Docking') {
    if (!run.computer) {
      if (rec && rec.handoff && s.dist != null) {
        const gap = s.dist - rec.handoff.distM;
        docking = gap > 200 ? `hand off in ${km(gap)}` : gap >= -200 ? 'hand off now' : `hand off passed by ${km(-gap)}`;
      } else docking = 'hand off when ready';
    } else if (rec && rec.handoff && rec.handoff.computerS != null) {
      const ho = markOf(run, 'handoff');
      if (ho) docking = `computer: best from here ${rec.handoff.computerS} s${who}, now ${Math.max(0, Math.round(s.t - ho.t))} s`;
    } else docking = 'docking computer has the ship';
  }
  liveState.prevCd2 = liveState.prevCd; liveState.prevCd = countdownS;
  const inWell = phase === 'Gravity well' || phase === 'Orbital cruise';
  if (inWell && s.dist != null && s.dist > GATE_M) note = note || 'run-up, clock starts at 100 km';
  if (vsShortestS != null && phase !== 'Docking') clock = vsShortestS === 0 ? `level with shortest${who}` : `${Math.abs(vsShortestS)} s ${vsShortestS > 0 ? 'ahead of' : 'behind'} shortest${who}`;
  const full = [word, ...detail, docking, note, clock].filter(Boolean).join(' · ');
  const brief = inWell ? (word || '') : docking || (phase === 'Glide' ? clock : null) || '';
  return { coach: full, brief, word, needDeg: need };
}

function overlay(fig) {
  if (!deps.sendOverlay) return;
  const km = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const color = fig.phase === 'Glide' ? '#d95926' : fig.phase === 'Docking' ? '#199e70' : '#3987e5';
  try {
    deps.sendOverlay({ id: 'edcolony_approach', text: `🛬 ${fig.phase}${fig.brief ? ' · ' + fig.brief : ''}`, color, x: 20, y: 300, ttl: 5, quiet: true });
  } catch { /* overlay is optional */ }
}

function emit(type, payload) { if (deps.broadcastEvent) { try { deps.broadcastEvent({ type, ...payload, timestamp: nowIso() }); } catch { /* optional */ } } }

// ---------- closing a run ----------
function finishRun(kind, ev) {
  if (!run) return;
  // A Music line written in the same second as Docked is the pad, not a retake.
  const endT = secondsSinceStart(ev.timestamp);
  run.marks = run.marks.filter((m) => !(m.kind === 'retake' && m.t >= endT - 1));
  if (run.marks.some((m) => m.kind === 'retake')) run.retakes = run.marks.filter((m) => m.kind === 'retake').length; else run.retakes = 0;
  if (hasMark('glide_start') && !hasMark('glide_end')) mark('glide_end', { timestamp: ev.timestamp }, { broken: false }); // flag still set at the pad: ended on the ground
  mark(kind, ev, ev.LandingPad != null ? { pad: ev.LandingPad } : {});
  const done = summarizeRun(run, kind, ev);
  const target = run.target ? run.target.key : null;
  const before = target ? summarizeTarget(target, null, done.ship ? done.ship.type : null) : null;
  const newShortest = !!(done.clean && before && (!before.shortest || !before.sameShip || done.runS < before.shortest.runS));
  runs.push(done);
  append({ k: 'run', ...done });
  stopTimer();
  run = null; lastFigures = null;
  emit('approach_complete', { run: stripSamples(done), newShortest, summary: target ? summarizeTarget(target, null, done.ship ? done.ship.type : null) : null });
  if (deps.sendOverlay) {
    try {
      if (kind === 'dropped') deps.sendOverlay({ id: 'edcolony_approach', text: '🛬 Dropped out of supercruise — too fast for the body', color: '#f3c46b', x: 20, y: 300, ttl: 6 });
      else {
        deps.sendOverlay({ id: 'edcolony_approach', text: `🛬 ${done.target ? done.target.name : 'landed'} — ${fmtT(done.runS)} from 100 km${newShortest ? ' · new shortest run' : before && before.shortest ? ` · shortest ${fmtT(before.shortest.runS)}` : ''}`, color: newShortest ? '#fcd34d' : '#e2e8f0', x: 20, y: 300, ttl: 20 });
        // The sectors, coloured as a lap is: purple for the best that sector has been here, green for faster than the
        // shortest run's, yellow for slower. Judged against the record as it stood before this run.
        const refS = before && before.shortest && before.shortest.sectors ? before.shortest.sectors : null;
        const bestS = before && before.sectorBest ? before.sectorBest : null;
        SECTOR_NAMES.forEach(([k, name], i) => {
          const v = done.sectors ? done.sectors[k] : null;
          if (v == null) return;
          const c = sectorColour(v, refS ? refS[k] : null, bestS ? bestS[k] : null, done.clean);
          deps.sendOverlay({ id: `edcolony_approach_${k}`, text: `${k.toUpperCase()} ${name} ${v} s${refS && refS[k] != null ? ` · shortest ${refS[k]}` : ''}`, color: c, x: 20, y: 322 + i * 20, ttl: 20 });
        });
      }
    } catch { /* optional */ }
  }
  return done;
}

function abandon(reason) {
  if (!run) return;
  const r = run; run = null; lastFigures = null; stopTimer();
  emit('approach_abandoned', { runId: r.id, reason, target: r.target });
}

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
export const SECTOR_NAMES = [['s1', 'descent'], ['s2', 'glide'], ['s3', 'alignment'], ['s4', 'docking']];
export const SECTOR_COLOURS = { purple: '#c084fc', green: '#4ade80', yellow: '#facc15', plain: '#e2e8f0' };
/** A sector's colour: purple = at or under the best this sector has been at the target, green = under the shortest run's, yellow = over it. */
export function sectorColour(v, shortestV, bestV, clean = true) {
  if (v == null) return SECTOR_COLOURS.plain;
  if (clean && bestV != null && v <= bestV) return SECTOR_COLOURS.purple;
  if (shortestV == null) return SECTOR_COLOURS.plain;
  return v < shortestV ? SECTOR_COLOURS.green : SECTOR_COLOURS.yellow;
}

function summarizeRun(r, endKind, ev) {
  const m = (kind) => markOf(r, kind);
  const gs = m('glide_start'), ge = m('glide_end'), dr = m('docking_requested'), dg = m('docking_granted'), ho = m('handoff'), end = m(endKind);
  const totalS = end ? end.t : secondsSinceStart(ev.timestamp);
  // seconds-to-target the commander was holding when the glide began: closing speed over the 3 s before it
  let secondsToTargetAtGlide = null;
  if (gs) {
    const before = r.samples.filter((s) => s.t <= gs.t && s.t >= gs.t - 3 && s.speed > 0 && s.dist != null);
    if (before.length) { const b = before[before.length - 1]; secondsToTargetAtGlide = Math.round(b.dist / b.speed); }
  }
  const glide = gs ? { startT: gs.t, startDistM: gs.dist, startAltM: gs.alt, endT: ge ? ge.t : null, endDistM: ge ? ge.dist : null, endAltM: ge ? ge.alt : null, broken: !!(ge && ge.broken), slopeDeg: ge && gs.dist != null && ge.dist != null && gs.dist > ge.dist ? Math.round(Math.atan(((gs.alt ?? 0) - (ge.alt ?? 0)) / (gs.dist - ge.dist)) * 180 / Math.PI) : null, secondsToTargetAtStart: secondsToTargetAtGlide } : null;
  const docking = dr || dg ? {
    requestedT: dr ? dr.t : null, grantedT: dg ? dg.t : null, pad: dg ? dg.pad ?? null : null,
    handoffT: ho ? ho.t : null, handoffDistM: ho ? ho.dist : null, handoffAltM: ho ? ho.alt : null, handoffSpeedMps: ho ? ho.speed : null,
    computerS: ho && end ? end.t - ho.t : null, clearanceToPadS: dg && end ? end.t - dg.t : null, retakes: r.retakes || 0,
  } : null;
  const oc = { startDistM: r.samples.length ? r.samples.find((s) => s.dist != null)?.dist ?? null : null, startAltM: r.samples.length ? r.samples[0].alt : null, durationS: gs ? gs.t : null };
  return withGate({
    id: r.id, startedAt: r.startedAt, endedAt: end ? end.at : ev.timestamp || nowIso(), endKind,
    body: r.body, bodyId: r.bodyId, system: r.system, systemAddress: r.systemAddress,
    target: r.target, ship: r.ship || null, totalS, clean: !!(gs && ge && !ge.broken) && endKind !== 'dropped', oc, glide, docking,
    marks: r.marks, samples: r.samples,
  });
}
const stripSamples = (r) => { const { samples, ...rest } = r; return { ...rest, sampleCount: samples ? samples.length : 0 }; };

// ---------- the gate ----------
/** Seconds since the run opened when the ship crossed the gate, interpolated between samples; null before it has. */
export function gateTimeOf(samples, gateM = GATE_M) {
  const pts = (samples || []).filter((p) => p.dist != null);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.dist > gateM) continue;
    if (i === 0) return p.t; // already inside the gate at the first fix: the clock starts there
    const a = pts[i - 1];
    const u = a.dist === p.dist ? 1 : (a.dist - gateM) / (a.dist - p.dist);
    return Math.round(a.t + (p.t - a.t) * u);
  }
  return null;
}
/** A stored run with its gate figures: gateT, runS (the counted time), runupS (before the gate). Idempotent. */
function withGate(r) {
  if (!r) return r;
  const gateT = gateTimeOf(r.samples);
  const g = gateT == null ? 0 : gateT;
  const first = (r.samples || []).find((p) => p.dist != null) || null;
  // The crossing into orbital cruise as the HUD showed it: range through space and the countdown, from the first sample
  // within three seconds of the ApproachBody mark that has both; and the ground distance and altitude the recorder keeps.
  const ab = (r.marks || []).find((m) => m.kind === 'approach_body') || null;
  const samples = r.samples || [];
  const nearT = (t) => samples.reduce((b, p) => (p.dist != null && (b == null || Math.abs(p.t - t) < Math.abs(b.t - t)) ? p : b), null);
  const ocEntry = ab ? nearT(ab.t) : null;
  let entryHudRangeM = null, entryCountdownS = null;
  if (ab) for (let i = 1; i < samples.length; i++) {
    const p = samples[i]; if (p.t < ab.t) continue; if (p.t > ab.t + 3) break;
    const cd = hudCountdown(p, samples[i - 1]); const rg = hudRange(p);
    if (cd != null && rg != null) { entryHudRangeM = Math.round(rg); entryCountdownS = Math.round(cd); break; }
  }
  const cruise = { entryDistM: ocEntry ? ocEntry.dist : null, entryAltM: ocEntry ? ocEntry.alt : null, entryT: ab ? ab.t : null, entryHudRangeM, entryCountdownS };
  // Sectors, as a lap is split: S1 the line to the glide (angle and speed, the whole descent), S2 the glide (where the
  // floor was met), S3 the glide's end to the hand-off (alignment), S4 the hand-off to the pad (the computer). With no
  // hand-off, S3 runs to the pad and S4 is empty.
  const tOf = (k) => { const m = (r.marks || []).find((x) => x.kind === k); return m ? m.t : null; };
  const lineT = tOf('approach_body'), gsT = tOf('glide_start'), geT = tOf('glide_end'), hoT = tOf('handoff'), endT = tOf('docked') ?? tOf('touchdown') ?? null;
  const sectors = {
    s1: lineT != null && gsT != null && gsT >= lineT ? gsT - lineT : null,
    s2: gsT != null && geT != null && geT >= gsT ? geT - gsT : null,
    s3: geT != null && (hoT ?? endT) != null && (hoT ?? endT) >= geT ? (hoT ?? endT) - geT : null,
    s4: hoT != null && endT != null && endT >= hoT ? endT - hoT : null,
  };
  return { ...r, gateT, runS: Math.max(0, (r.totalS ?? 0) - g), runupS: g, cruise, sectors, gateFallback: gateT == null || (first != null && first.t === gateT) };
}

// ---------- reference per target ----------
/** Descent angle of a run's line at a distance, degrees below horizontal over the kilometre either side; null outside its range. */
export function slopeAtDistance(samples, dist) {
  const a = valueAtDistance(samples, dist + 1000, 'alt'), b = valueAtDistance(samples, Math.max(0, dist - 1000), 'alt');
  if (a == null || b == null) return null;
  const run = dist + 1000 - Math.max(0, dist - 1000);
  return Math.round(Math.atan((a - b) / run) * 180 / Math.PI);
}
/** Value (t or alt) of a run's profile at a distance, linear between samples; null outside the run's range. */
export function valueAtDistance(samples, dist, key) {
  if (!Array.isArray(samples) || samples.length < 2 || dist == null) return null;
  const pts = samples.filter((s) => s.dist != null && s[key] != null);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (dist <= a.dist && dist >= b.dist) { const u = a.dist === b.dist ? 0 : (a.dist - dist) / (a.dist - b.dist); return a[key] + (b[key] - a[key]) * u; }
  }
  return null;
}
const median = (arr) => { const a = arr.filter((v) => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };

export function summarizeTarget(key, excludeRunId = null, shipType = null) {
  const target = targets.get(key) || null;
  const list = runs.filter((r) => r.target && r.target.key === key && r.id !== excludeRunId);
  const clean = list.filter((r) => r.clean);
  // The ship matters where the ship flies: the docking. The shortest run and the hand-off come from
  // runs in the same hull when there are any; orbital cruise and the glide are the game's, pooled.
  const sameHull = shipType ? clean.filter((r) => r.ship && r.ship.type === shipType) : [];
  const pool = sameHull.length ? sameHull : clean;
  const sameShip = !shipType || sameHull.length > 0 || clean.length === 0;
  const shortest = pool.length ? pool.reduce((b, r) => (r.runS < b.runS ? r : b), pool[0]) : null;
  // envelope: min/max altitude by distance across clean runs
  const envelope = [];
  if (clean.length >= 2) {
    const maxD = Math.max(...clean.map((r) => Math.max(...r.samples.filter((s) => s.dist != null).map((s) => s.dist), 0)));
    for (let d = 0; d <= maxD; d += ENVELOPE_STEP_M) {
      const alts = clean.map((r) => valueAtDistance(r.samples, d, 'alt')).filter((v) => v != null);
      if (alts.length >= 2) envelope.push({ dist: d, min: Math.round(Math.min(...alts)), max: Math.round(Math.max(...alts)) });
    }
  }
  const bestOf = (list2, k) => { const v = list2.map((r) => r.sectors && r.sectors[k]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
  const sectorBest = { s1: bestOf(clean, 's1'), s2: bestOf(clean, 's2'), s3: bestOf(pool, 's3'), s4: bestOf(pool, 's4') }; // alignment and the computer are the hull's
  const slopes = clean.map((r) => r.glide && r.glide.slopeDeg).filter((v) => v != null);
  const corridor = slopes.length >= 3 ? [Math.min(...slopes), Math.max(...slopes)] : NOMINAL_CORRIDOR;
  // recommendations: the glide start from the clean runs, weighted to the shortest; the hand-off from the fastest clearance-to-pad
  let recommendation = null;
  if (clean.length >= 1) {
    const gsD = clean.map((r) => r.glide.startDistM).filter((v) => v != null), gsA = clean.map((r) => r.glide.startAltM).filter((v) => v != null);
    const glideStart = shortest && shortest.glide.startDistM != null ? {
      distM: Math.round((shortest.glide.startDistM * 2 + (median(gsD) ?? shortest.glide.startDistM)) / 3),
      altM: Math.round((shortest.glide.startAltM * 2 + (median(gsA) ?? shortest.glide.startAltM)) / 3),
      windowM: Math.max(1000, Math.round((Math.max(...gsD) - Math.min(...gsD)) / 2)),
      secondsToTarget: shortest.glide.secondsToTargetAtStart, slopeDeg: shortest.glide.slopeDeg, fromRuns: clean.length,
    } : null;
    const hullList = shipType && list.some((r) => r.ship && r.ship.type === shipType) ? list.filter((r) => r.ship && r.ship.type === shipType) : list;
    const withHandoff = hullList.filter((r) => r.docking && r.docking.handoffT != null && r.docking.clearanceToPadS != null);
    const fastest = withHandoff.length ? withHandoff.reduce((b, r) => (r.docking.clearanceToPadS < b.docking.clearanceToPadS ? r : b), withHandoff[0]) : null;
    const retook = withHandoff.filter((r) => r.docking.retakes > 0), kept = withHandoff.filter((r) => r.docking.retakes === 0);
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, r) => a + r.docking.clearanceToPadS, 0) / arr.length) : null);
    const handoff = fastest ? {
      distM: fastest.docking.handoffDistM, altM: fastest.docking.handoffAltM, speedMps: fastest.docking.handoffSpeedMps,
      computerS: fastest.docking.computerS, clearanceToPadS: fastest.docking.clearanceToPadS, fromRuns: withHandoff.length,
      retakes: { withS: avg(retook), withoutS: avg(kept), runsWith: retook.length, runsWithout: kept.length },
      ship: fastest.ship || null,
    } : null;
    // The entry the commander flies by: the shortest run's own crossing, as the HUD showed it. Never a blend.
    const sc = shortest && shortest.cruise ? shortest.cruise : null;
    const cruise = sc && sc.entryDistM != null ? { entryDistM: sc.entryDistM, entryAltM: sc.entryAltM ?? null, entryHudRangeM: sc.entryHudRangeM ?? null, entryCountdownS: sc.entryCountdownS ?? null, checkpointAltM: (() => { const a = altAtHudRange(shortest.samples, 1e6); return a == null ? null : Math.round(a); })(), fromRuns: clean.length } : null;
    recommendation = { cruise, glideStart, handoff, corridor, nominalCorridor: slopes.length < 3 };
  }
  return {
    target, runs: list.length, cleanRuns: clean.length,
    shortest: shortest ? { id: shortest.id, totalS: shortest.totalS, runS: shortest.runS, runupS: shortest.runupS, gateT: shortest.gateT, startedAt: shortest.startedAt, ship: shortest.ship || null, samples: shortest.samples, marks: shortest.marks, glide: shortest.glide, docking: shortest.docking, oc: shortest.oc, sectors: shortest.sectors || null } : null,
    sectorBest,
    sameShip, shipType: shipType || null,
    envelope, corridor, recommendation,
  };
}

// ---------- reads for the API ----------
export function getApproachTargets() {
  const out = [];
  for (const t of targets.values()) {
    const list = runs.filter((r) => r.target && r.target.key === t.key);
    const clean = list.filter((r) => r.clean);
    const shortest = clean.length ? Math.min(...clean.map((r) => r.runS)) : null;
    if (!list.length && !(run && run.target && run.target.key === t.key)) continue; // a lock that never became a run is not a target
    out.push({ ...t, runs: list.length, cleanRuns: clean.length, shortestS: shortest, lastAt: list.length ? list[list.length - 1].endedAt : null });
  }
  out.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
  return { targets: out, live: run ? { runId: run.id, target: run.target, ship: run.ship } : null, currentShip: shipNow(null) };
}
export function getApproachRuns(key, shipType = null) {
  if (shipType === 'current') { const now = shipNow(null); shipType = now ? now.type : null; } // the page's default: the hull the commander is in
  const list = runs.filter((r) => r.target && r.target.key === key);
  const ships = {};
  for (const r of list) { const t = r.ship ? r.ship.type : 'unknown'; ships[t] = ships[t] || { type: t, name: r.ship ? r.ship.name : 'unknown ship', runs: 0 }; ships[t].runs += 1; }
  return { target: targets.get(key) || null, runs: list, summary: summarizeTarget(key, null, shipType), ships: Object.values(ships), currentShip: shipNow(null) };
}
export function getLiveApproach() {
  if (!run) return { live: null };
  return { live: { runId: run.id, startedAt: run.startedAt, body: run.body, target: run.target, ship: run.ship, marks: run.marks, samples: run.samples, computer: run.computer, openedInCruise: !!run.openedInCruise, figures: lastFigures } };
}

// ---------- journal intake ----------
export function noteApproachEvent(ev, ctx = {}) {
  if (!ev || !ev.event) return;
  switch (ev.event) {
    case 'ApproachBody': startRun(ev, ctx); break;
    case 'ApproachSettlement': if (run) setTargetFromSettlement(ev); break;
    case 'SupercruiseExit': if (run) { mark('supercruise_exit', ev); run.scExitT = secondsSinceStart(ev.timestamp); } break;
    case 'DockingRequested': if (run) mark('docking_requested', ev); break;
    case 'DockingGranted': if (run) mark('docking_granted', ev, { pad: ev.LandingPad ?? null }); break;
    case 'Music':
      if (!run) break;
      if (ev.MusicTrack === 'DockingComputer') { if (!run.computer) mark('handoff', ev); }
      else if (run.computer) mark('retake', ev);
      break;
    case 'Docked': if (run) finishRun('docked', ev); break;
    case 'Touchdown': if (run) finishRun('touchdown', ev); break;
    case 'LeaveBody': case 'FSDJump': case 'Died': case 'LoadGame': case 'Shutdown': abandon(ev.event); break;
    case 'SupercruiseEntry': if (run && hasMark('glide_start')) abandon('back to supercruise'); break;
    default: break;
  }
}
export function ingestApproachEvents(parsed, ctx = {}, d = null) {
  if (d) deps = { ...deps, ...d };
  const evs = (parsed && parsed.allEvents) || [];
  for (const ev of evs) noteApproachEvent(ev, ctx);
}
export function approachRunOpen() { return !!run; }
