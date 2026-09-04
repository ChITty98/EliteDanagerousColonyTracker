// server/journal/surfaceMining.js
//
// Surface (Rhino / SRV) mining ledger — append-only, one JSON object per line.
//
// WHY IT IS SEPARATE FROM miningLog.js: ring mining and surface mining share the `MiningRefined`
// event and nothing else. Ring mining is rock-centric — ProspectedAsteroid gives a material
// fingerprint, a hotspot, a ring class. Surface mining has NO prospect event, no rock, no ring;
// it is a fixed DEPOSIT at a lat/lon on a body, worked by rigs and emptied in bursts. Forcing it
// through the rock model would mean inventing a rock per collection.
//
// WHY A SIDECAR, NOT STATE: same reason as miningLog.js — colony-data.json is ~27MB and is
// hydrated to every connected device, so per-collection records belong outside it.
//
// WHAT THE GAME DOES NOT TELL US (verified against the 2026-09-02 release journal):
//   - Rig deployment is NOT journalled. Neither is rig progress, nor a rig reaching 9/9. A
//     67-minute stretch of deploying and waiting produced ZERO journal lines.
//   - Rigs are not in ShipLocker/Backpack either, so rigs-consumed cannot be counted. The HUD's
//     "RIG HATCH 10/12" exists only on screen.
//   - MiningRefined carries NO position and NO count — one event per tonne, commodity only.
// So a "deployment" is not observable. What IS observable is a COLLECTION: a burst of
// MiningRefined while in the SRV. That is the unit this file records, and effectiveness is
// measured per collection and per deposit over time.
//
// COORDINATES: lat/lon exist only in Status.json, which the game overwrites every few seconds and
// never archives. We sample it at the first refine of a burst — you are parked at the rig when
// collecting, so that fixes the deposit. Historical collections cannot be located, only attributed
// to a body; backfillFromJournals() therefore writes body-level records with lat/lon null.

import fs from 'node:fs';
import path from 'node:path';
import { rawMaterial } from './rawMaterials.js';
import { getNavLock } from './navLock.js';
import { galacticAvgSell, canonicalCommodityName } from './commodityPricesMirror.js';
import { friendlyShip, padSizeFor } from './extractor.js';

/** One key per commodity however the journal or a finger spelled it — "Low Temp. Diamonds" and
 *  "Low Temperature Diamonds" are the same deposit. */
const commodityId = (name) => canonicalCommodityName(String(name || '')).toLowerCase();

// A burst is one rig-hatch emptying. Observed 2026-09-02: refines land 1-2s apart inside a burst
// (8 tonnes in 9s), with minutes between bursts. 60s is comfortably clear of both.
const BURST_GAP_MS = 60_000;
const FLUSH_MS = 4000;
const F_IN_SRV = 1 << 26; // Status.json Flags bit 26 — the discriminator vs ring mining.
const fmtCr = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);

let LOG_PATH = null;
let ANNOT_PATH = null;
let JOURNAL_DIR = null;
let pending = [];
let flushTimer = null;
let open = null; // the burst being accumulated
let overlayDeps = null; // the last deps seen by ingest — so a burst closing on its timer can still speak
let closeTimer = null;
// Commander-supplied ground truth: MINERAL AMOUNT and DENSITY are on the deposit's HUD panel and
// nowhere on disk (verified — the journal's only "density" hits are highdensitycomposites and
// shielddensityreports). Same sidecar pattern as mining-annotations.json, and for the same reason:
// the append-only ledger is never rewritten, so marks join at read time.
let annotations = { marks: [] };
// The compass: one steering target at a time (a deposit, the ship, a recall spot), persisted in the
// annotations file. The breadcrumb track is its own sidecar — positions every ~10 s while near the
// surface, so the drive between rigs and to the ship becomes a line instead of dots.
let TRACK_PATH = null;
let navTarget = null;   // { lat, lon, label, kind, body, setAt }
let lastCompass = null; // { label, kind, distance, bearing, turn, at }
let lastTrack = null;   // { ms, lat, lon }
let lastCompassSent = null; // { distance, bearing, turn, ms } — what the overlay and the page last heard
let farNotified = false;    // said "too far" once; quiet until closer
const COMPASS_FAR_M = 50_000;
const COMPASS_REFRESH_MS = 3000; // keeps the 4 s overlay line alive without a change
const TRACK_MIN_MS = 10_000;
const TRACK_MIN_M = 25;
const TRACK_MAX_ALT_M = 5000;
const ARRIVE_M = 50;

export function initSurfaceMining(appDir, journalDir) {
  LOG_PATH = path.join(appDir, 'surface-mining-log.jsonl');
  JOURNAL_DIR = journalDir || null;
  try {
    if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '', 'utf8');
  } catch (e) {
    console.error('[SurfaceMining] init failed:', e && e.message);
    LOG_PATH = null;
  }
  ANNOT_PATH = path.join(appDir, 'surface-mining-annotations.json');
  TRACK_PATH = path.join(appDir, 'surface-track.jsonl');
  try {
    if (fs.existsSync(ANNOT_PATH)) {
      const j = JSON.parse(fs.readFileSync(ANNOT_PATH, 'utf8'));
      if (j && Array.isArray(j.marks)) annotations = j;
    }
  } catch { /* fresh */ }
  if (!annotations.hulls) annotations.hulls = {}; // pad sizes the commander told us, by hull id
  if (!annotations.pins) annotations.pins = [];   // named points at the commander's own position
  navTarget = annotations.compass || null; // the steering target survives a restart
  refreshGroveCache();
  seedLiveStateFromLedger();
  return LOG_PATH;
}

/**
 * Re-seed the live state from the ledger. lastDrop/lastLanding lived only in memory, so every
 * restart forgot which site the commander was on — the hero read "site unknown" over a drop that
 * had been on disk, verified, for forty minutes. The LATEST drop by time wins, ties to the later
 * record (a hand-set site outranks the journal drop it is dated to). File order alone is not
 * enough: a backfill appends restored drops after everything else. Called at init and again after
 * a backfill, so a restored drop becomes "current" without a restart.
 */
export function seedLiveStateFromLedger() {
  try {
    const recs = readSurfaceRecords();
    let drop = null; let landing = null;
    for (const r of recs) {
      if (!r) continue;
      if (r.k === 'drop') {
        if (!drop || r.at >= drop.at) {
          const raw = r.siteIndex == null && r.navName
            ? parseMiningLock({ name: r.navName, body: r.navBody, system: r.systemAddress }) : null;
          drop = raw ? { ...r, siteIndex: raw.index, bodyId: r.bodyId ?? raw.bodyId } : r;
        }
      } else if (r.k === 'land') {
        if (!landing || r.at >= landing.at) landing = r;
      }
    }
    lastDrop = drop;
    lastLanding = landing;
    // The "this visit" tally too — it restarted from zero on every relaunch, so the hero said 47t
    // while the ship held 154t from the same visit. Rebuild it from the collections since the
    // current drop on its body. A drop with nothing after it is still the current visit, at 0t.
    if (lastDrop && lastDrop.body) {
      const since = recs.filter((r) => r && r.k === 'collect' && r.body === lastDrop.body && r.at >= lastDrop.at);
      const commodities = {};
      for (const r of since) for (const [k, v] of Object.entries(r.commodities || {})) commodities[k] = (commodities[k] || 0) + v;
      const lastEnd = since.length ? Math.max(...since.map((r) => Date.parse(r.endedAt || r.at))) : NaN;
      session = {
        startedAt: lastDrop.at,
        body: lastDrop.body,
        tonnes: since.reduce((t, r) => t + (r.tonnes || 0), 0),
        commodities,
        lastRefineAt: Number.isFinite(lastEnd) ? lastEnd : 0,
      };
      // The trip too: what has been refined since the last drop-off inside this visit.
      const lastTrip = recs.filter((r) => r && r.k === 'trip' && r.body === lastDrop.body && r.at >= lastDrop.at).map((r) => r.at).sort().pop() || null;
      const tripRecs = since.filter((r) => !lastTrip || r.at > lastTrip);
      const tripCommodities = {};
      for (const r of tripRecs) for (const [k, v] of Object.entries(r.commodities || {})) tripCommodities[k] = (tripCommodities[k] || 0) + v;
      trip = {
        startedAt: tripRecs.length ? tripRecs[0].at : null,
        tonnes: tripRecs.reduce((t, r) => t + (r.tonnes || 0), 0),
        commodities: tripCommodities,
      };
    }
  } catch { /* fresh */ }
}

function saveAnnotations() {
  if (!ANNOT_PATH) return;
  try { fs.writeFileSync(ANNOT_PATH, JSON.stringify(annotations, null, 1), 'utf8'); } catch { /* non-fatal */ }
}

/**
 * Pad size the commander told us for a hull the ship table does not know (the Caspian Explorer,
 * the Type-11 Prospector). Asked once, remembered for good — never guessed.
 */
export function setHullSize(shipType, size) {
  const t = String(shipType || '').toLowerCase();
  const s = String(size || '').toUpperCase();
  if (!t || !['S', 'M', 'L'].includes(s)) return false;
  annotations.hulls = annotations.hulls || {};
  annotations.hulls[t] = s;
  saveAnnotations();
  return true;
}
export function hullSizeFor(shipType) {
  const t = String(shipType || '').toLowerCase();
  return (annotations.hulls && annotations.hulls[t]) || null;
}

/**
 * How much a full rig holds, dated: 9 t since the Rhino landed (the HUD's 9/9), 12 t since the
 * patch of 4 September 2026 (02:00 Central, 07:00 UTC — the commander's report). Collections divide
 * by the capacity in force at their time. Fixed here, not by a control: Frontier sets it, and the
 * one time it changed the number was known before the page was opened. An older annotations file
 * may still carry a rigCapacity list from the control that used to exist; it is ignored.
 */
const RIG_CAPACITY = [
  { from: '2026-09-02T00:00:00Z', tonnes: 9 },
  { from: '2026-09-04T07:00:00Z', tonnes: 12 },
];
export function rigCapacityAt(at) {
  let cap = RIG_CAPACITY[0].tonnes;
  for (const e of RIG_CAPACITY) if (!at || e.from <= at) cap = e.tonnes;
  return cap;
}
export function getRigCapacity() { return rigCapacityAt(null); }

/**
 * Tag a deposit with what only the commander can see. `id` is the deposit key (body|lat,lon).
 * amount/density are 'low' | 'medium' | 'high'; commodity names what the deposit supplies, which
 * matters because one body carries several (Col 173 AX-J d9-52 2 a has both Helium and Uranium).
 */
export function markDeposit(id, { commodity, amount, density, note, site, rigs } = {}) {
  if (!id) return annotations.marks;
  // MERGE, never replace. Setting the site used to blank the amount and density the commander had
  // already recorded, because a partial write rebuilt the whole mark from only the fields passed.
  // Undefined means "leave alone"; an empty string is how a field is explicitly cleared.
  const prior = annotations.marks.find((m) => m.id === id) || {};
  annotations.marks = annotations.marks.filter((m) => m.id !== id);
  const clean = (v) => (v == null || v === '' ? null : String(v).toLowerCase());
  const keep = (next, was) => (next === undefined ? was ?? null : next || null);
  const keepLower = (next, was) => (next === undefined ? was ?? null : clean(next));
  // How many rigs fit at this deposit at once — 1 unless the commander says otherwise.
  const rigCount = rigs === undefined ? (prior.rigs ?? null) : (Number.isInteger(Number(rigs)) && Number(rigs) >= 1 && Number(rigs) <= 4 ? Number(rigs) : null);
  if (commodity || amount || density || note || site || rigs || Object.keys(prior).length) {
    annotations.marks.push({
      id,
      commodity: keep(commodity, prior.commodity),
      amount: keepLower(amount, prior.amount),
      density: keepLower(density, prior.density),
      note: keep(note, prior.note),
      // The site the deposit belongs to, e.g. "3" for Planetary Mining Location Signal (3).
      // Commander-supplied because the game names the body and never the site.
      site: keep(site, prior.site),
      rigs: rigCount,
      at: new Date().toISOString(),
    });
  }
  saveAnnotations();
  return annotations.marks;
}

export function getDepositAnnotations() { return annotations.marks.slice(); }

/**
 * "I know where I am." The commander sets the current site by hand — for a drop made without a
 * nav lock, or with the exe closed, or when the game simply did not say. Written as a drop record
 * flagged `manual`, so every downstream path (visit grouping, site rows, collection stamping)
 * treats it exactly like a lock-derived drop. Dated at the start of the current visit, so tonnage
 * already pulled this visit re-files under the site too, not just what comes next.
 */
/** The most recent drop on a body from the ledger — what a surface login inherits its signal from. */
function lastDropOnBody(body) {
  let found = null;
  for (const r of readSurfaceRecords()) if (r && r.k === 'drop' && r.body === body && (!found || r.at > found.at)) found = r;
  return found;
}

export function setCurrentSite({ body, siteIndex, system, systemAddress, moved } = {}) {
  const idx = Number(siteIndex);
  if (!Number.isFinite(idx) || idx < 0) return null;
  const pos = readSurfacePosition();
  const b = body || (pos && pos.body) || (lastDrop && lastDrop.body) || null;
  if (!b) return null;
  // Two intents, both explicit. "Fix this visit" keeps the visit's own drop time, so the record
  // lands on the same instant as the journal drop it corrects and the summary merges them into one
  // visit. "Moved here" is a NEW visit from now: a hop in normal space writes nothing to the
  // journal, so only the commander can say the previous site's window has closed.
  const isMove = !!moved;
  const sameBody = !!(lastDrop && lastDrop.body === b);   // body facts carry over either way
  const keepPos = sameBody && !isMove;                    // the old drop's position does not
  const at = !isMove && session.startedAt && session.body === b ? session.startedAt : new Date().toISOString();
  const rec = {
    k: 'drop',
    manual: true,
    moved: isMove || undefined,
    at,
    body: b,
    system: system || (sameBody ? lastDrop.system : null) || null,
    systemAddress: systemAddress ?? (sameBody ? lastDrop.systemAddress : null) ?? null,
    lat: pos && pos.lat != null ? pos.lat : (keepPos ? lastDrop.lat : null),
    lon: pos && pos.lon != null ? pos.lon : (keepPos ? lastDrop.lon : null),
    radius: pos && pos.radius != null ? pos.radius : (sameBody ? lastDrop.radius ?? null : null),
    navName: null,
    navLabel: `Signal ${idx} (${isMove ? 'moved here' : 'set by hand'})`,
    navBody: keepPos ? lastDrop.navBody ?? null : null,
    siteIndex: idx,
    bodyId: sameBody ? lastDrop.bodyId ?? null : null,
  };
  appendRecord(rec);
  flushNow();
  lastDrop = rec;
  if (isMove || !session.startedAt || session.body !== b) session = { startedAt: at, body: b, tonnes: 0, commodities: {}, lastRefineAt: 0 };
  return rec;
}

/**
 * Log a commodity SEEN on a body without going to it. The deposit panel names the commodity at
 * targeting range (mineral amount and density only appear up close), so "I targeted it, saw
 * Uranium, decided it wasn't worth the drive" is real information — and without it the ledger
 * would only ever record what was mined, quietly implying a body carries whatever you happened
 * to work first.
 */
export function recordSighting({
  body, system, systemAddress, commodity, note, site, amount, density, bodyId, siteIndex,
} = {}) {
  if (!body || !commodity) return false;
  const idx = siteIndex != null && siteIndex !== '' ? Number(siteIndex) : null;
  // One row per (site, commodity). Tagging the same site twice from orbit — a re-look weeks later —
  // must not double it, or the body would appear to carry two Samarium deposits it does not have.
  if (idx != null) {
    const recs = readSurfaceRecords();
    // A tag retracted later is not "already there" — tagging again re-activates it.
    const same = (r) => r && r.body === body && r.siteIndex === idx
      && commodityId(r.commodity) === commodityId(commodity);
    const lastSight = recs.filter((r) => r && r.k === 'sight' && same(r)).map((r) => r.at).sort().pop() || null;
    const lastUnsight = recs.filter((r) => r && r.k === 'unsight' && same(r)).map((r) => r.at).sort().pop() || null;
    if (lastSight && (!lastUnsight || lastUnsight < lastSight)) return 'exists';
    // Already PULLED there counts as already there — Thortveitite got tagged onto a site it had
    // given 122t from, because only sightings were checked.
    if (pulledAtSite(recs, body, idx).has(commodityId(commodity))) return 'exists';
  }
  appendRecord({
    k: 'sight',
    at: new Date().toISOString(),
    body, system: system || null, systemAddress: systemAddress ?? null,
    commodity, note: note || null,
    // The site it belongs to. From the nav lock this is the game's own index (the "(4)" in
    // "Planetary Mining Location Signal (4)"); `site` remains as a free label for anything logged
    // without a lock.
    bodyId: bodyId ?? null,
    siteIndex: idx,
    site: site || (idx != null ? String(idx) : null),
    amount: amount || null,
    density: density || null,
  });
  flushNow();
  return true;
}

/**
 * The site count read off the system map. The map shows "Planetary Mining Location (18)" for any
 * body you have discovered, but the journal only writes that number on a DSS — SAASignalsFound is
 * the sole event that ever carries PlanetaryMiningLocation (checked across 582 journal files;
 * FSSBodySignals never does). Until the body is mapped the commander is the only source. Stored as
 * a `signal` flagged manual; a DSS count always outranks it in the summary.
 */
export function recordSiteCount({ body, system, systemAddress, count, bodyId, clear } = {}) {
  // A wrong number is replaced by typing again (latest hand-typed wins); an empty one CLEARS it —
  // a manual record with a null count — so the body goes back to Needs a DSS. A DSS still wins.
  const clearing = !!clear || count == null || count === '';
  const n = clearing ? null : Number(count);
  if (!body || (!clearing && (!Number.isFinite(n) || n < 0))) return false;
  appendRecord({
    k: 'signal',
    manual: true,
    at: new Date().toISOString(),
    body, system: system || null, systemAddress: systemAddress ?? null,
    bodyId: bodyId ?? null,
    count: clearing ? null : Math.round(n),
  });
  flushNow();
  return true;
}

/**
 * Take a tag back. Append-only: an `unsight` line for that signal + commodity; the summary treats
 * the tag as active only while no later retraction exists. The mistake and the correction both
 * stay in the history. Pulled commodities cannot be retracted — they are journal facts.
 */
export function retractSighting({ body, siteIndex, commodity } = {}) {
  const idx = siteIndex != null && siteIndex !== '' ? Number(siteIndex) : null;
  if (!body || !commodity || idx == null || !Number.isFinite(idx)) return false;
  appendRecord({ k: 'unsight', at: new Date().toISOString(), body, siteIndex: idx, commodity });
  flushNow();
  return true;
}

/**
 * A commander's rating of a signal: landing difficulty IN A NAMED HULL (a Caspian is not a
 * Type-11) and driving difficulty, 1 = easy, 5 = brutal. Append-only; the summary keeps the latest
 * driving score per signal and the latest landing score per signal per ship type.
 */
export function recordRating({ body, system, systemAddress, bodyId, siteIndex, landing, driving, ship, shipType, size, note } = {}) {
  const idx = Number(siteIndex);
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const l = num(landing); const d = num(driving);
  const ok = (v) => v == null || (Number.isInteger(v) && v >= 1 && v <= 5);
  if (!body || !Number.isFinite(idx) || !ok(l) || !ok(d) || (l == null && d == null)) return false;
  appendRecord({
    k: 'rating', at: new Date().toISOString(), body, system: system || null, systemAddress: systemAddress ?? null,
    bodyId: bodyId ?? null, siteIndex: idx, landing: l, driving: d,
    ship: ship || null, shipType: shipType ? String(shipType).toLowerCase() : null,
    size: size || null, // pad size of that hull at the time, so the chip needs no lookup later
    note: note || null,
  });
  flushNow();
  return true;
}

/**
 * Commodity names collected at one site of a body, lower-cased. Membership is by drop window —
 * the same rule the summary uses — with same-instant drops resolving to the later record's site
 * (a hand-set site over the journal drop it corrects). Reads the ledger only; it never closes an
 * open burst, so tagging mid-collection cannot split the collection in two.
 */
function pulledAtSite(recs, body, idx) {
  const drops = recs.filter((r) => r && r.k === 'drop' && r.body === body).sort((a, c) => (a.at < c.at ? -1 : 1));
  const siteAt = new Map(); // instant → the site it resolves to
  for (const d of drops) {
    const parsed = d.siteIndex == null && d.navName
      ? parseMiningLock({ name: d.navName, body: d.navBody, system: d.systemAddress }) : null;
    const site = d.siteIndex ?? (parsed ? parsed.index : null);
    if (site != null || !siteAt.has(d.at)) siteAt.set(d.at, site ?? null);
  }
  const instants = [...siteAt.keys()].sort();
  const out = new Set();
  instants.forEach((at, i) => {
    if (siteAt.get(at) !== idx) return;
    const end = instants[i + 1] || null;
    for (const r of recs) {
      if (!r || r.k !== 'collect' || r.body !== body || r.at < at || (end && r.at >= end)) continue;
      for (const k of Object.keys(r.commodities || {})) out.add(commodityId(k));
    }
  });
  return out;
}

/** Every site label known for a body — the picker's options, so a site is named once and reused. */
export function knownSites(recs) {
  const out = new Map();
  const add = (body, site) => {
    if (!body || !site) return;
    if (!out.has(body)) out.set(body, new Set());
    out.get(body).add(String(site));
  };
  for (const r of recs) if (r.k === 'sight') add(r.body, r.site);
  for (const m of annotations.marks) {
    if (!m.site) continue;
    const bar = m.id.lastIndexOf('|');
    add(m.id.startsWith('site:') ? m.id.slice(5, bar) : m.id.slice(0, bar), m.site);
  }
  return out;
}

export function surfaceMiningLogPath() { return LOG_PATH; }

/**
 * Status.json's in-SRV flag right now. Exported for the ring-mining module: MiningRefined is the
 * one event the two share, and without this check every surface tonne went through the rock
 * pipeline — its overlay, its session tally, its visited-market pricing.
 */
export function isInSrvNow() {
  // Status now, OR the journal order (LaunchSRV … DockSRV) — see journalSrv. The ring module asks
  // this before the surface module has seen the batch, so journalSrv still reflects the previous
  // batch: true across a boarding batch (blocks the trailing refines), false across a launch batch
  // (Status covers those). Both cases land right.
  const pos = readSurfacePosition();
  return !!(pos && pos.inSrv) || journalSrv;
}

/**
 * True when an F10 marker in the ledger named this screenshot file — the only files the photo
 * delete endpoint may ever touch inside the game's screenshot folder.
 */
export function isRecordedScreenshot(basename) {
  const b = String(basename || '').toLowerCase();
  if (!b) return false;
  return readSurfaceRecords().some((r) => r && r.k === 'mark' && r.file
    && String(r.file).replace(/\\/g, '/').split('/').pop().toLowerCase() === b);
}

/** Status.json is the ONLY source of surface position. Read at burst start, never guessed. */
function readSurfacePosition() {
  if (!JOURNAL_DIR) return null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(JOURNAL_DIR, 'Status.json'), 'utf8'));
    const flags = typeof d.Flags === 'number' ? d.Flags : 0;
    const flags2 = typeof d.Flags2 === 'number' ? d.Flags2 : 0;
    return {
      inSrv: (flags & F_IN_SRV) !== 0,
      landed: (flags & (1 << 1)) !== 0,   // Flags bit 1 — the ship is on the ground
      onFoot: (flags2 & (1 << 4)) !== 0,  // Flags2 bit 4 — on foot on a planet
      lat: typeof d.Latitude === 'number' ? d.Latitude : null,
      lon: typeof d.Longitude === 'number' ? d.Longitude : null,
      body: d.BodyName || null,
      radius: typeof d.PlanetRadius === 'number' ? d.PlanetRadius : null,
      altitude: typeof d.Altitude === 'number' ? d.Altitude : null,
      heading: typeof d.Heading === 'number' ? d.Heading : null,
    };
  } catch { return null; }
}

function appendRecord(rec) {
  if (!LOG_PATH) return;
  pending.push(JSON.stringify(rec));
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}

export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!LOG_PATH || !pending.length) return;
  const batch = pending.join('\n') + '\n';
  pending = [];
  try { fs.appendFileSync(LOG_PATH, batch); } catch (e) { console.error('[SurfaceMining] write:', e && e.message); }
}

/** Close the open burst and commit it. A burst ends by silence, so this is timer-driven. */
function closeBurst() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  if (!open) return;
  const b = open;
  open = null;
  if (!b.tonnes) return;
  appendRecord({
    k: 'collect',
    at: b.at,
    endedAt: new Date().toISOString(),
    body: b.body,
    system: b.system,
    systemAddress: b.systemAddress,
    lat: b.lat,
    lon: b.lon,
    radius: b.radius,
    siteIndex: b.siteIndex ?? null,
    bodyId: b.bodyId ?? null,
    commodity: b.commodity,
    commodities: b.commodities,
    tonnes: b.tonnes,
    materials: b.materials,
  });
  flushNow();
  // No overlay here. A burst closing is a rig emptied, not anything ending — "Collection done"
  // read as the session being over when the commander was just driving to the ship. The trip
  // drop-off (endTrip) is the line that marks an end.
}

/**
 * Close the trip: write it, say it, reset it. The overlay line here is the one that marks an end —
 * a hold emptied into the ship — with the visit total behind it. Rig emptyings no longer announce
 * themselves; they never ended anything.
 */
function endTrip(ev, reason, toShip, deps) {
  const at = (ev && ev.timestamp) || new Date().toISOString();
  const rec = {
    k: 'trip',
    at,
    startedAt: trip.startedAt,
    body: session.body || (lastDrop && lastDrop.body) || null,
    system: lastDrop ? lastDrop.system : null,
    systemAddress: lastDrop ? lastDrop.systemAddress : null,
    siteIndex: lastDrop ? lastDrop.siteIndex ?? null : null,
    bodyId: lastDrop ? lastDrop.bodyId ?? null : null,
    tonnes: trip.tonnes,
    commodities: { ...trip.commodities },
    reason,
    transferred: toShip.map((t) => ({ commodity: t.Type_Localised || t.Type, count: t.Count })),
  };
  appendRecord(rec);
  flushNow();
  if (deps && typeof deps.sendOverlay === 'function') {
    const tripCr = Object.entries(rec.commodities).reduce((t, [k, v]) => t + galacticAvgSell(k) * v, 0);
    const visitCr = Object.entries(session.commodities || {}).reduce((t, [k, v]) => t + galacticAvgSell(k) * v, 0);
    const what = Object.entries(rec.commodities).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v}t ${k}`).join(', ');
    const signal = rec.siteIndex != null ? ` · Signal ${rec.siteIndex}` : '';
    const text = `${reason === 'boarded' ? 'Boarded with' : 'Dropped off'} ${what}${tripCr ? ` = ${fmtCr(tripCr)}` : ''}${signal} · visit ${session.tonnes}t${visitCr ? ` / ~${fmtCr(visitCr)}` : ''}`;
    try {
      deps.sendOverlay({ id: 'edcolony_surface_trip', text, color: '#fbbf24', x: 40, y: 460, ttl: 8 });
    } catch { /* overlay is best-effort */ }
  }
  trip = { startedAt: null, tonnes: 0, commodities: {} };
}

function scheduleClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(closeBurst, BURST_GAP_MS);
  if (closeTimer.unref) closeTimer.unref();
}

// Overlay row for a material pickup: grade + how much room is left. STATES FACTS, gives no
// verdict — the commander's standing rule. "Yttrium G4 · 37/150" is enough to decide with;
// "worth grabbing!" is not ours to say. Grade 4 is coloured only because rarity is the fact
// that matters most, and a material at cap says FULL because that is also a fact.
const MAT_GUARD_MS = 8000;
const matSaid = new Map();

function emitMaterialOverlay(ev, ctx, deps) {
  if (!deps || !deps.sendOverlay) return;
  const id = String(ev.Name || '').toLowerCase();
  const mat = rawMaterial(id);
  if (!mat) return; // manufactured/encoded don't come off the surface; nothing useful to say
  const now = Date.now();
  if (matSaid.get(id) && now - matSaid.get(id) < MAT_GUARD_MS) return; // one line per material per burst
  matSaid.set(id, now);

  const held = typeof ctx.materialCount === 'function' ? ctx.materialCount(id) : null;
  const room = held == null ? null : mat.cap - held;
  const full = room != null && room <= 0;
  const stock = held == null ? '' : ` · ${held}/${mat.cap}${full ? '  FULL' : ''}`;
  const color = full ? '#a3a3a3' : mat.grade >= 4 ? '#fbbf24' : mat.grade === 3 ? '#4ade80' : '#9ca3af';

  try {
    deps.sendOverlay({
      id: 'edcolony_surface_material',
      text: `${mat.name}  G${mat.grade}${stock}`,
      color, x: 40, y: 432, ttl: 5,
    });
  } catch { /* overlay is best-effort */ }
}

/**
 * Ingest a tick's events. Call from the mining event path.
 * `ctx` supplies the system the journal already resolved plus a material-count lookup:
 * { system, systemAddress, materialCount }.
 */
export function ingestSurfaceMining(parsed, ctx = {}, deps = null) {
  if (deps) overlayDeps = deps;
  const events = (parsed && parsed.allEvents) || [];
  if (!events.length) return;

  for (const ev of events) {
    if (!ev || !ev.event) continue;

    // --- opportunities: the DSS signal count for a body, dropped by every other consumer -------
    // checklist.js reads only ev.Genuses from SAASignalsFound and skips when empty, and
    // miningIndex only ingests /Ring/i bodies — so this signal type reached nothing.
    if (ev.event === 'SAASignalsFound' && Array.isArray(ev.Signals)) {
      const spot = ev.Signals.find((s) => s && /PlanetaryMiningLocation/i.test(String(s.Type || '')));
      if (spot && ev.BodyName) {
        appendRecord({
          k: 'signal',
          at: ev.timestamp || new Date().toISOString(),
          body: ev.BodyName,
          system: ctx.system || null,
          systemAddress: ev.SystemAddress ?? ctx.systemAddress ?? null,
          bodyId: ev.BodyID ?? null,
          count: spot.Count || 0,
        });
      }
      continue;
    }

    // --- survey: what a landable body's surface is MADE OF ------------------------------------
    // Scan carries per-body material percentages for landable bodies and they are stored nowhere:
    // materials.js tracks only what the commander HOLDS, and miningIndex only reads rings. This is
    // the answer to "where could I mine Yttrium if I wanted to", and unlike coordinates it
    // backfills across every journal ever written.
    if (ev.event === 'Scan' && ev.Landable && Array.isArray(ev.Materials) && ev.Materials.length) {
      const mats = {};
      for (const m of ev.Materials) {
        const n = String(m.Name || '').toLowerCase();
        if (n && typeof m.Percent === 'number') mats[n] = Math.round(m.Percent * 10) / 10;
      }
      if (Object.keys(mats).length) {
        appendRecord({
          k: 'body',
          at: ev.timestamp || new Date().toISOString(),
          body: ev.BodyName,
          system: ev.StarSystem || ctx.system || null,
          systemAddress: ev.SystemAddress ?? ctx.systemAddress ?? null,
          gravity: typeof ev.SurfaceGravity === 'number' ? Math.round(ev.SurfaceGravity / 9.80665 * 100) / 100 : null,
          // BodyID is how a nav lock names a body ("Body": 14); the scan is where name ↔ id meet.
          bodyId: ev.BodyID ?? null,
          // What kind of world — an icy body is a skip by the commander's standing rule.
          planetClass: ev.PlanetClass || null,
          atmosphere: ev.Atmosphere || ev.AtmosphereType || null,
          materials: mats,
        });
      }
      continue;
    }

    // --- F10 marker: the ONLY player-triggered surface position the game records --------------
    // Verified against the journal docs and 581 local journals: Screenshot, CodexEntry,
    // Touchdown, Liftoff, ApproachSettlement and Location are the only events carrying lat/lon,
    // and Screenshot is the only one you can fire at will, anywhere, repeatedly. It also happens
    // to photograph the HUD panel naming the deposit's commodity / mineral amount / density —
    // the three facts nothing writes to disk. So F10 at a deposit is both a pin and its evidence.
    if (ev.event === 'Screenshot' && ev.Latitude != null && ev.Longitude != null) {
      appendRecord({
        k: 'mark',
        at: ev.timestamp || new Date().toISOString(),
        body: ev.Body || null,
        system: ev.System || ctx.system || null,
        systemAddress: ctx.systemAddress ?? null,
        lat: ev.Latitude,
        lon: ev.Longitude,
        heading: ev.Heading ?? null,
        // Altitude separates a marker dropped from the SRV (~0m) from a flyover — the commander's
        // 2026-09-02 pass over 2 a was logged at 1,691m and is not a deposit.
        altitude: ev.Altitude ?? null,
        file: ev.Filename || null,
      });
      continue;
    }

    // --- drop point: where a surface visit began ----------------------------------------------
    // SupercruiseExit names the BODY and carries no coordinates, so the position has to come from
    // Status.json at that instant. Live-only, unlike the F10 marker — nothing before this build
    // can be placed.
    if (ev.event === 'SupercruiseExit' && (ev.Body || ev.BodyName)) {
      const pos = readSurfacePosition();
      if (pos && pos.lat != null) {
        // THE SITE'S OWN IDENTITY, if the game gives it. Selecting a target in the left nav panel
        // populates Status.json's Destination — that is exactly how ring hotspots are attributed
        // ("$SAA_RingHotspot:#type=$Tritium_name;;"), and navLock.js was written expecting
        // planetary mining locations to arrive the same way. Stored RAW: the token's shape for a
        // planetary site has not been observed yet, so parsing it now would be guesswork. Once one
        // real sample lands, the label resolves from this without re-capturing anything.
        const lock = getNavLock();
        const sameSystem = lock && lock.system != null && ev.SystemAddress != null
          ? String(lock.system) === String(ev.SystemAddress)
          : true;
        // Parsed as well as raw: the raw token is kept so a future change in Frontier's format is
        // recoverable from the ledger, the parsed index is what everything keys on.
        const site = sameSystem ? parseMiningLock(lock) : null;
        const rec = {
          k: 'drop',
          at: ev.timestamp || new Date().toISOString(),
          body: ev.Body || ev.BodyName,
          system: ev.StarSystem || ctx.system || null,
          systemAddress: ev.SystemAddress ?? ctx.systemAddress ?? null,
          lat: pos.lat,
          lon: pos.lon,
          radius: pos.radius,
          navName: lock && sameSystem ? lock.name || null : null,
          navLabel: lock && sameSystem ? lock.nameLocalised || null : null,
          navBody: lock && sameSystem ? (lock.body ?? null) : null,
          siteIndex: site ? site.index : null,
          bodyId: site ? site.bodyId : null,
        };
        appendRecord(rec);
        lastDrop = rec;
        // A drop starts a visit: the hero's "since you landed" counters restart here.
        session = { startedAt: rec.at, body: rec.body, tonnes: 0, commodities: {}, lastRefineAt: 0 };
        trip = { startedAt: null, tonnes: 0, commodities: {} };
        if (deps && typeof deps.broadcastEvent === 'function') {
          try {
            deps.broadcastEvent({
              type: 'surface_drop', timestamp: rec.at, body: rec.body, bodyId: rec.bodyId,
              siteIndex: rec.siteIndex, label: rec.navLabel, lat: rec.lat, lon: rec.lon,
            });
          } catch { /* SSE is best-effort */ }
        }
      }
      continue;
    }

    // --- resume: a login on the surface is a visit boundary too --------------------------------
    // Logging out on a body and back in writes no SupercruiseExit; without this, a signal worked
    // across two evenings read as one 20-hour visit (1 b signal 7: 230 t at "2.5 M/h", ranked
    // eighth). Location at login carries the surface position, the body and its id; the signal
    // is inherited from the last drop on that body, because the nav lock at login is empty.
    if (ev.event === 'Location' && ev.Latitude != null && ev.Longitude != null && (ev.Body || ev.BodyName)) {
      const body = ev.Body || ev.BodyName;
      const prev = lastDrop && lastDrop.body === body ? lastDrop : lastDropOnBody(body);
      const rec = {
        k: 'drop',
        resume: true,
        at: ev.timestamp || new Date().toISOString(),
        body,
        system: ev.StarSystem || ctx.system || null,
        systemAddress: ev.SystemAddress ?? ctx.systemAddress ?? null,
        lat: ev.Latitude,
        lon: ev.Longitude,
        radius: prev ? prev.radius ?? null : null,
        navName: prev ? prev.navName ?? null : null,
        navLabel: prev && prev.siteIndex != null ? `Signal ${prev.siteIndex} (resumed)` : null,
        navBody: prev ? prev.navBody ?? null : null,
        siteIndex: prev ? prev.siteIndex ?? null : null,
        bodyId: ev.BodyID ?? (prev ? prev.bodyId ?? null : null),
      };
      appendRecord(rec);
      lastDrop = rec;
      session = { startedAt: rec.at, body: rec.body, tonnes: 0, commodities: {}, lastRefineAt: 0 };
      trip = { startedAt: null, tonnes: 0, commodities: {} };
      if (deps && typeof deps.broadcastEvent === 'function') {
        try {
          deps.broadcastEvent({
            type: 'surface_drop', timestamp: rec.at, body: rec.body, bodyId: rec.bodyId,
            siteIndex: rec.siteIndex, label: rec.navLabel, lat: rec.lat, lon: rec.lon, resume: true,
          });
        } catch { /* SSE is best-effort */ }
      }
      continue;
    }

    // --- landing: where the surface visit ACTUALLY begins --------------------------------------
    // SupercruiseExit is sampled kilometres up and moving — every collection on 1 a measured
    // 26–29km "from drop". LaunchSRV fires with the ship parked, and Status.json then holds the
    // landed position. That is the anchor distances are measured from.
    // --- the hold, and the trips that empty it -------------------------------------------------
    if (ev.event === 'Cargo' && ev.Vessel === 'SRV' && typeof ev.Count === 'number') {
      srvHold = ev.Count;
      journalSrv = true; // the game only reports the SRV's hold while you are in it
      continue;
    }
    if (ev.event === 'SRVDestroyed' || ev.event === 'LoadGame') journalSrv = false;
    // A drop-off is the thing that actually ends something: the trip. Either you drove to the
    // hovering ship and transferred (CargoTransfer toship), or you boarded with cargo (DockSRV).
    if (ev.event === 'CargoTransfer' || ev.event === 'DockSRV') {
      const toShip = ev.event === 'CargoTransfer'
        ? (Array.isArray(ev.Transfers) ? ev.Transfers : []).filter((t) => t && t.Direction === 'toship')
        : [];
      if (ev.event === 'CargoTransfer' && !toShip.length) continue; // carrier moves are the ship's business
      if (trip.tonnes > 0) endTrip(ev, ev.event === 'DockSRV' ? 'boarded' : 'transfer', toShip, deps);
      if (ev.event === 'DockSRV') { srvHold = 0; journalSrv = false; }
      continue;
    }

    if (ev.event === 'LaunchSRV') {
      journalSrv = true;
      const pos = readSurfacePosition();
      if (pos && pos.lat != null) {
        const same = lastDrop && lastDrop.body === pos.body;
        const rec = {
          k: 'land',
          at: ev.timestamp || new Date().toISOString(),
          body: pos.body || (lastDrop && lastDrop.body) || null,
          system: ctx.system || null,
          systemAddress: ctx.systemAddress ?? null,
          lat: pos.lat,
          lon: pos.lon,
          radius: pos.radius,
          siteIndex: same ? lastDrop.siteIndex : null,
          bodyId: same ? lastDrop.bodyId : null,
        };
        appendRecord(rec);
        lastLanding = rec;
      }
      continue;
    }

    // --- results: a collection burst ---------------------------------------------------------
    if (ev.event === 'MiningRefined') {
      const live = readSurfacePosition();
      if (live && live.inSrv) lastSrvPos = live;
      // In the SRV is what separates this from ring mining; both emit MiningRefined. Status says
      // "now"; the journal order says whether this line was written between LaunchSRV and DockSRV.
      // Either is enough. A refine that trails a DockSRV in the same batch takes the last position
      // sampled while in the SRV. Neither source: no guess, no record — a rock logged as a deposit
      // is worse than a gap.
      const pos = live && live.inSrv ? live : (journalSrv && lastSrvPos ? lastSrvPos : null);
      if (!pos) continue;
      const name = ev.Type_Localised || ev.Type || '';
      // A rig yields ONE commodity, so a different commodity mid-burst is a different rig. The 60s
      // gap assumed you could not reach another deposit that fast; the Rhino covered the 970m from
      // a Ruby deposit to a Thortveitite one inside it, and 17t landed on the Ruby coordinate.
      // Commit the old burst and open a new one at the CURRENT position.
      if (open && open.commodity && open.commodity !== name) closeBurst();
      // A rig is a PLACE, too. Scooting to a second rig of the same commodity inside the 60s window
      // filed its tonnes at the first one (1 b Signal 12: two Bastnasite spots read as one 20t
      // collection, "3 rigs"). Moving further than one deposit's span is a new collection.
      if (open && open.lat != null && pos.lat != null
        && (metresBetween(open.lat, open.lon, pos.lat, pos.lon, pos.radius || open.radius) ?? 0) > SAME_DEPOSIT_M) closeBurst();
      if (!open) {
        open = {
          at: ev.timestamp || new Date().toISOString(),
          body: pos.body || null,
          system: ctx.system || null,
          systemAddress: ctx.systemAddress ?? null,
          lat: pos.lat,
          lon: pos.lon,
          radius: pos.radius, // the body's real radius, so distance-from-drop is metres not guesswork
          // The site you dropped on, if the drop knew it. Stamped live so it survives even if the
          // read-time drop matching ever changes; read-time matching remains the fallback.
          siteIndex: lastDrop && lastDrop.body === pos.body ? lastDrop.siteIndex : null,
          bodyId: lastDrop && lastDrop.body === pos.body ? lastDrop.bodyId : null,
          commodity: name,
          commodities: {},
          tonnes: 0,
          materials: {},
        };
      }
      open.tonnes += 1;
      open.commodities[name] = (open.commodities[name] || 0) + 1;
      // Session = since the drop (or since the first refine, if the exe missed the drop). A change
      // of body without a drop record means the visit counters would be lying — reset them.
      if (session.body && pos.body && session.body !== pos.body) {
        session = { startedAt: null, body: null, tonnes: 0, commodities: {}, lastRefineAt: 0 };
      }
      if (!session.startedAt) { session.startedAt = ev.timestamp || new Date().toISOString(); session.body = pos.body || null; }
      session.tonnes += 1;
      session.commodities[name] = (session.commodities[name] || 0) + 1;
      session.lastRefineAt = Date.now();
      if (!trip.startedAt) trip.startedAt = ev.timestamp || new Date().toISOString();
      trip.tonnes += 1;
      trip.commodities[name] = (trip.commodities[name] || 0) + 1;
      // Per-tonne live event — the hero band moves on this, not on the 15s poll. Priced on the
      // client at galactic average, so this stays a plain statement of what came out.
      if (deps && typeof deps.broadcastEvent === 'function') {
        try {
          deps.broadcastEvent({
            type: 'surface_refined', timestamp: new Date().toISOString(),
            commodity: name, body: open.body, siteIndex: open.siteIndex,
            burstTonnes: open.tonnes,
            sessionTonnes: session.tonnes, sessionCommodities: session.commodities,
            sessionStartedAt: session.startedAt,
          });
        } catch { /* SSE is best-effort */ }
      }
      // The surface tonne's own overlay line, in the slot the rock line used to take (the ring
      // module now ignores refines made in the SRV). Only the tonne's own facts: what came out,
      // its galactic average from the page's own table, this collection, this signal. The visit
      // total is a separate line when the collection ends (closeBurst).
      if (deps && typeof deps.sendOverlay === 'function') {
        const price = galacticAvgSell(name);
        const signal = open.siteIndex != null ? ` · Signal ${open.siteIndex}` : '';
        const text = `⛏ ${name} +1t${price ? ` @ ${fmtCr(price)}` : ''} · ${open.tonnes}t this collection${signal}`;
        try {
          deps.sendOverlay({ id: 'edcolony_surface_refined', text, color: price ? '#4ade80' : '#a3a3a3', x: 40, y: 404, ttl: 6 });
        } catch { /* overlay is best-effort */ }
      }
      scheduleClose();
      continue;
    }

    // Raw materials. Attributed to a deposit only while a burst is open, so ordinary SRV
    // rock-shooting between collections is not credited to one — but the OVERLAY fires either
    // way, because "is this worth stopping for" is a question you have while driving, not only
    // while emptying a rig.
    if (ev.event === 'MaterialCollected') {
      const nm = ev.Name_Localised || ev.Name || '';
      if (nm && open) open.materials[nm] = (open.materials[nm] || 0) + (ev.Count || 1);
      if (nm) emitMaterialOverlay(ev, ctx, deps);
      // A pickup inside a brain-tree grove is a HARVEST: attributed to the grove so it gets a
      // yield table (units by grade, units per hour) the way a deposit gets a tonnage one.
      if (nm) {
        const pos = readSurfacePosition();
        const grove = groveNear(pos, null);
        if (grove) {
          const mat = rawMaterial(String(ev.Name || '').toLowerCase());
          appendRecord({
            k: 'harvest', at: ev.timestamp || new Date().toISOString(), body: pos.body || grove.body || null,
            system: ctx.system || null, systemAddress: ctx.systemAddress ?? null,
            groveId: grove.id, name: nm, id: String(ev.Name || '').toLowerCase(), grade: mat ? mat.grade : null, count: ev.Count || 1,
            lat: pos.lat, lon: pos.lon,
          });
        }
      }
    }
  }
}

/** Commit anything in flight (shutdown, or before a read). */
export function finalizeSurfaceMining() {
  closeBurst();
  flushNow();
}

export function readSurfaceRecords() {
  if (!LOG_PATH) return [];
  let text = '';
  try { text = fs.readFileSync(LOG_PATH, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return out;
}

/** Round to ~11m. Used for record identity; deposits are CLUSTERED below, not keyed on this. */
function coordKey(lat, lon) {
  if (lat == null || lon == null) return null;
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * How close two placed records must be to be the SAME deposit.
 *
 * 11m rounding was wrong: you do not park in the same spot twice. Measured on the commander's
 * Rhodplumsite deposit — the F10 marker and the collection that followed it sit ~200m apart and
 * are unarguably one deposit, while the next deposit along is 1,256m away. 300m separates those
 * cases with room on both sides.
 */
const SAME_DEPOSIT_M = 300;

/**
 * Group placed records into deposits by proximity. The cluster keeps its FIRST record's position
 * as the anchor, so an id stays stable as later visits accrete to it — which matters because
 * annotations (commodity, amount, density) are keyed on that id.
 */
function clusterByProximity(items, radiusFor) {
  const clusters = [];
  for (const it of items) {
    const r = radiusFor(it);
    const com = it.commodity || null;
    let hit = null;
    for (const c of clusters) {
      if (c.body !== it.body) continue;
      // A deposit is a place AND a commodity. Two rigs 50m apart yielding Ruby and Thortveitite are
      // two deposits, whatever the radius says. Records without a commodity (F10 markers) join the
      // nearest cluster of any commodity; a marker-only cluster adopts the first commodity to arrive.
      if (com && c.commodity && c.commodity !== com) continue;
      const d = metresBetween(c.lat, c.lon, it.lat, it.lon, r);
      if (d != null && d <= SAME_DEPOSIT_M) { hit = c; break; }
    }
    if (hit) {
      hit.items.push(it);
      if (!hit.commodity && com) hit.commodity = com;
    } else {
      clusters.push({ body: it.body, lat: it.lat, lon: it.lon, commodity: com, items: [it] });
    }
  }
  return clusters;
}

/**
 * One collection record may carry several commodities — a burst that ran across two rigs before
 * the live split existed. Expand it into one pseudo-record per commodity so clustering can key on
 * commodity. Only the LEADING commodity was refined where the position was sampled; the others
 * are flagged positionUncertain and the UI says so, rather than pinning Thortveitite to the Ruby
 * coordinate as if measured.
 */
function expandBursts(recs) {
  const out = [];
  for (const r of recs) {
    if (!r || r.k !== 'collect') { out.push(r); continue; }
    const names = Object.keys(r.commodities || {}).filter((n) => (r.commodities[n] || 0) > 0);
    if (names.length <= 1) { out.push(r); continue; }
    const lead = names.includes(r.commodity) ? r.commodity : names[0];
    for (const n of names) {
      const t = r.commodities[n];
      out.push({
        ...r,
        commodity: n,
        commodities: { [n]: t },
        tonnes: t,
        materials: n === lead ? r.materials : {},
        positionUncertain: n !== lead,
      });
    }
  }
  return out;
}

/**
 * Re-join collections that were sliced by a summary read (the finaliser used to run on every
 * poll): consecutive records of the same commodity at the same spot whose gap is inside the
 * burst window. Read-time only — the ledger is append-only and keeps what was written. The merged
 * record keeps the first position and start, sums the rest, and counts as ONE collection.
 */
function coalesceCollections(recs) {
  const out = [];
  let prev = null;
  for (const r of recs) {
    if (!r || r.k !== 'collect') { out.push(r); continue; }
    if (prev && prev.body === r.body && prev.commodity === r.commodity
      && !prev.positionUncertain && !r.positionUncertain
      && prev.lat != null && r.lat != null
      && Date.parse(r.at) - Date.parse(prev.endedAt || prev.at) <= BURST_GAP_MS
      && (metresBetween(prev.lat, prev.lon, r.lat, r.lon, r.radius || prev.radius) ?? Infinity) <= SAME_DEPOSIT_M) {
      if ((r.endedAt || r.at) > (prev.endedAt || prev.at)) prev.endedAt = r.endedAt || r.at;
      prev.tonnes += r.tonnes || 0;
      for (const [k, v] of Object.entries(r.commodities || {})) prev.commodities[k] = (prev.commodities[k] || 0) + v;
      for (const [k, v] of Object.entries(r.materials || {})) prev.materials[k] = (prev.materials[k] || 0) + v;
      prev.merged = (prev.merged || 1) + 1;
      continue;
    }
    prev = { ...r, commodities: { ...(r.commodities || {}) }, materials: { ...(r.materials || {}) } };
    out.push(prev);
  }
  return out;
}

/**
 * Great-circle metres between two surface points. Needed to answer the only question the journal
 * leaves open about sites: a deposit 200m from where you dropped is the site you dropped ON; one
 * 17km away (as the commander's Helium and Uranium are) was reached by driving somewhere else.
 * Radius comes from Status.json's PlanetRadius, so it is the body's real size, not an assumption.
 */
function metresBetween(aLat, aLon, bLat, bLon, radiusM) {
  if ([aLat, aLon, bLat, bLon].some((v) => v == null) || !radiusM) return null;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * radiusM * Math.asin(Math.min(1, Math.sqrt(s))));
}

// Beyond this, a deposit was driven to rather than dropped on. Deliberately generous: it only
// controls a "same site / drove elsewhere" LABEL, and the real distance is always shown, so the
// commander can see for themselves what a site's radius turns out to be.
const SAME_SITE_M = 3000;

// The Rhino and planetary mining deposits shipped in game version 4.4.1.0; the commander's first
// evidence of it is a RestockVehicle for mev_rhino at 2026-09-02T14:58:17Z. Nothing before that
// date can be a deposit marker, so F10 shots older than this are scenery and stay out of the
// deposit views. Stored regardless — this only gates what is SHOWN.
const SURFACE_MINING_EPOCH = '2026-09-02';

/**
 * Is this F10 marker a SURFACE position at all? Altitude is written only on or near a surface, so
 * a docked or in-space shot has no such field — that is what let 'Cavallo Nero Corona' through as
 * a deposit. The epoch drops anything older than planetary mining itself.
 */
function isSurfaceMark(m) {
  return !!(m && m.body && m.lat != null && m.altitude != null && m.altitude < 200
    && (m.at || '') >= SURFACE_MINING_EPOCH);
}

// ---- the nav lock: the one moment the game names a SITE ----------------------------------------
//
// Captured live on 2026-09-03T01:12:30Z while the commander was nav-locked onto a site from orbit:
//   "Destination": { "System": 1797401856371, "Body": 14,
//                    "Name": "$SAA_Unknown_Signal:#type=$PlanetaryMiningLocation_Name;:#index=2;",
//                    "Name_Localised": "Planetary Mining Location Signal (2)" }
// #index is the site's own number — the "(2)" the nav panel shows — and Body is the BodyID. That
// gives a site a stable, game-issued key (systemAddress, bodyId, index), the same way
// "$SAA_RingHotspot:#type=$Tritium_name;;" identifies a ring hotspot. Nothing else in any file
// names a site; the drop and the F10 marker only give a body and a position.
const MINING_LOCK_RE = /^\$SAA_Unknown_Signal:#type=\$PlanetaryMiningLocation_Name;:#index=(\d+);/;

/** A nav lock (from navLock.js) → { index, bodyId, systemAddress }, or null when it is not a site. */
export function parseMiningLock(lock) {
  if (!lock || !lock.name) return null;
  const m = MINING_LOCK_RE.exec(String(lock.name));
  if (!m) return null;
  return {
    index: Number(m[1]),
    bodyId: lock.body ?? null,
    systemAddress: lock.system ?? null,
    label: lock.nameLocalised || `Planetary Mining Location Signal (${m[1]})`,
  };
}

const siteKey = (systemAddress, bodyId, index) => `${systemAddress}|${bodyId}|${index}`;

// Live state the snapshot serves. Module-level because the page polls it between journal ticks.
let currentLock = null;  // { index, bodyId, systemAddress, label, at } — the site you are looking at
let lastLockKey = null;
let lastDrop = null;     // the most recent drop: { at, body, bodyId, siteIndex, lat, lon, systemAddress }
let lastLanding = null;  // position at LaunchSRV — the real anchor; the drop is sampled km up, moving
let session = { startedAt: null, body: null, tonnes: 0, commodities: {}, lastRefineAt: 0 };
// A TRIP is one Rhino hold cycle inside a visit: from the last drop-off at the ship (CargoTransfer
// to ship, or boarding) to the next. A visit holds several rigs and possibly several 72t trips;
// a drive to the ship is part of it, not the end of it.
let trip = { startedAt: null, tonnes: 0, commodities: {} };
let srvHold = null; // the SRV's cargo count from the last Cargo{Vessel:"SRV"} event
// "In the SRV" by JOURNAL ORDER: LaunchSRV / Cargo{Vessel:"SRV"} set it, DockSRV / SRVDestroyed /
// LoadGame clear it. Status.json says "now"; the batch that carries the last refines also carries
// the DockSRV written after them, and by then Status says ship — so those tonnes went to the ring
// module as a rock and vanished from this ledger (14 t in one afternoon). The order decides.
let journalSrv = false;
let lastSrvPos = null; // the last position sampled while Status said SRV — where late tonnes belong
const RHINO_HOLD_T = 72;
const ACTIVE_WINDOW_MS = 20 * 60_000; // in the SRV with a tonne this recent = still working the signal

/**
 * Called from the watcher tick with the current nav lock (null when nothing is locked). Records a
 * `lock` when the locked SITE changes — that is "you looked at Site 4", which is what lets the page
 * show a site's commodities while you are still in orbit deciding whether to bother.
 */
export function noteMiningLock(lock) {
  const p = parseMiningLock(lock);
  if (!p) {
    currentLock = null;
    lastLockKey = null; // re-locking the same site later is a fresh look, and should say so
    return null;
  }
  const key = siteKey(p.systemAddress, p.bodyId, p.index);
  currentLock = { ...p, at: new Date().toISOString() };
  if (key === lastLockKey) return currentLock;
  lastLockKey = key;
  appendRecord({
    k: 'lock',
    at: currentLock.at,
    systemAddress: p.systemAddress,
    bodyId: p.bodyId,
    siteIndex: p.index,
    label: p.label,
    body: null, // the lock carries a BodyID, not a name; resolved at read time from scans
  });
  return currentLock;
}

/**
 * What the hero band shows between polls: are we mining, where, which site is locked, and what
 * has come out of the ground since the drop. `active` mirrors the ticker's rule — refines within
 * the last 150s, or a burst still open.
 */
export function getSurfaceSnapshot() {
  const pos = readSurfacePosition();
  const now = Date.now();
  const inSrv = !!(pos && pos.inSrv);
  // ACTIVE = in the SRV, working a signal: a burst open, or a tonne within the last twenty minutes.
  // The old 150s window flipped the hero to idle during every drive to the hovering ship.
  const active = inSrv && (!!open || (session.lastRefineAt > 0 && now - session.lastRefineAt < ACTIVE_WINDOW_MS));
  return {
    active,
    inSrv,
    body: pos ? pos.body : null,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
    altitude: pos ? pos.altitude : null,
    trip: { startedAt: trip.startedAt, tonnes: trip.tonnes, commodities: trip.commodities },
    hold: srvHold,
    holdMax: RHINO_HOLD_T,
    heading: pos ? pos.heading : null,
    radius: pos ? pos.radius : null,
    target: navTarget,
    compass: lastCompass,
    // This visit's driving, from the track since the drop.
    drive: (() => {
      if (!lastDrop || !lastDrop.body) return null;
      const pts = (readTrackAll()[lastDrop.body] || []).filter((p) => p.at >= lastDrop.at);
      return pts.length ? trackMetrics(pts, (pos && pos.radius) || lastDrop.radius || null) : null;
    })(),
    lock: currentLock,
    drop: lastDrop,
    landing: lastLanding,
    session: {
      startedAt: session.startedAt,
      body: session.body,
      tonnes: session.tonnes,
      commodities: session.commodities,
      lastRefineAt: session.lastRefineAt || null,
    },
  };
}

// ---- compass, track, recall ------------------------------------------------------------------

/** Initial great-circle bearing from A to B, degrees 0–360 (0 = north, 90 = east). */
function bearingBetween(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const φ1 = aLat * rad; const φ2 = bLat * rad; const dλ = (bLon - aLon) * rad;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Set the steering target. Facts only downstream: distance, bearing, turn. */
export function setNavTarget({ lat, lon, label, kind, body } = {}) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  navTarget = { lat, lon, label: String(label || 'target'), kind: String(kind || 'point'), body: body || null, setAt: new Date().toISOString() };
  annotations.compass = navTarget;
  saveAnnotations();
  lastCompass = null; lastCompassSent = null; farNotified = false;
  return navTarget;
}
export function clearNavTarget() {
  navTarget = null; lastCompass = null; lastCompassSent = null; farNotified = false;
  annotations.compass = null;
  saveAnnotations();
}
export function getNavTarget() { return navTarget; }

/**
 * Called from the watcher tick, beside the nav-lock check. Two jobs: append a breadcrumb when near
 * the surface and moved, and — with a target set — say where it is from here. The overlay line
 * refreshes each tick; the SSE event feeds the page and the Companion. Arriving within 50 m
 * clears the target and says so.
 */
export function tickCompass() {
  const pos = readSurfacePosition();
  if (!pos || pos.lat == null || pos.lon == null) return;
  const now = Date.now();
  const deps = overlayDeps;

  // Breadcrumb: near the surface, at most one point per 10 s, and only after moving 25 m.
  if (TRACK_PATH && (pos.altitude == null || pos.altitude < TRACK_MAX_ALT_M) && pos.body) {
    const moved = lastTrack ? metresBetween(lastTrack.lat, lastTrack.lon, pos.lat, pos.lon, pos.radius) : null;
    if (!lastTrack || (now - lastTrack.ms >= TRACK_MIN_MS && (moved == null || moved >= TRACK_MIN_M))) {
      lastTrack = { ms: now, lat: pos.lat, lon: pos.lon };
      try {
        fs.appendFileSync(TRACK_PATH, JSON.stringify({ at: new Date(now).toISOString(), body: pos.body, lat: pos.lat, lon: pos.lon, heading: pos.heading, alt: pos.altitude, srv: pos.inSrv, foot: pos.onFoot, landed: pos.landed }) + '\n');
        trackCache = null; // the next read sees the new point
      } catch { /* the track is a nicety; never break the tick */ }
    }
  }

  if (!navTarget) return;
  if (navTarget.body && pos.body && navTarget.body !== pos.body) return; // another body: nothing to steer by
  const distance = metresBetween(pos.lat, pos.lon, navTarget.lat, navTarget.lon, pos.radius);
  if (distance == null) return;
  const bearing = Math.round(bearingBetween(pos.lat, pos.lon, navTarget.lat, navTarget.lon));
  const turn = pos.heading == null ? null : Math.round(((bearing - pos.heading + 540) % 360) - 180); // −180..180, + = right
  const arrived = distance <= ARRIVE_M;
  lastCompass = { label: navTarget.label, kind: navTarget.kind, distance: Math.round(distance), bearing, turn, arrived, at: new Date(now).toISOString(), lat: navTarget.lat, lon: navTarget.lon };

  if (deps) {
    const dist = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
    // Too far to steer by: say so once, then hold your peace until you are closer.
    if (distance > COMPASS_FAR_M && !arrived) {
      if (!farNotified) {
        farNotified = true;
        const text = `⤴ ${navTarget.label} is ${dist} away — fly, or clear it`;
        if (typeof deps.sendOverlay === 'function') { try { deps.sendOverlay({ id: 'edcolony_surface_compass', text, color: '#a3a3a3', x: 40, y: 488, ttl: 8 }); } catch { /* best-effort */ } }
        if (typeof deps.broadcastEvent === 'function') { try { deps.broadcastEvent({ type: 'surface_compass', timestamp: lastCompass.at, ...lastCompass, far: true }); } catch { /* best-effort */ } }
      }
      return;
    }
    farNotified = false;
    // Send on a real change — 1% or 5 m of distance, 2° of bearing or turn — or as a quiet refresh
    // every 3 s so the overlay line outlives its TTL. Refreshes carry `quiet` and are not logged;
    // one line per tick was the wall of text in the exe window.
    const prev = lastCompassSent;
    const changed = !prev
      || Math.abs(prev.distance - distance) > Math.max(5, distance * 0.01)
      || Math.abs(prev.bearing - bearing) >= 2
      || (turn != null && prev.turn != null && Math.abs(prev.turn - turn) >= 2)
      || arrived;
    const refresh = !changed && prev && now - prev.ms >= COMPASS_REFRESH_MS;
    if (!changed && !refresh) return;
    lastCompassSent = { distance, bearing, turn, ms: now };
    const turnTxt = turn == null ? '' : Math.abs(turn) < 5 ? ' · straight on' : ` · ${turn < 0 ? '←' : '→'} ${Math.abs(turn)}°`;
    const text = arrived ? `⌖ ${navTarget.label} — you're here` : `⤴ ${navTarget.label} · ${dist} · brg ${bearing}°${turnTxt}`;
    if (typeof deps.sendOverlay === 'function') {
      try { deps.sendOverlay({ id: 'edcolony_surface_compass', text, color: arrived ? '#4ade80' : '#38bdf8', x: 40, y: 488, ttl: arrived ? 8 : 4, quiet: !changed }); } catch { /* best-effort */ }
    }
    if (typeof deps.broadcastEvent === 'function') {
      try { deps.broadcastEvent({ type: 'surface_compass', timestamp: lastCompass.at, ...lastCompass, quiet: !changed }); } catch { /* best-effort */ }
    }
  }
  if (arrived) clearNavTarget();
}

/** Every breadcrumb ever, per body, parsed once per file change. */
let trackCache = null; // { mtimeMs, byBody }
function readTrackAll() {
  if (!TRACK_PATH) return {};
  let st; try { st = fs.statSync(TRACK_PATH); } catch { return {}; }
  if (trackCache && trackCache.mtimeMs === st.mtimeMs) return trackCache.byBody;
  let text = '';
  try { text = fs.readFileSync(TRACK_PATH, 'utf8'); } catch { return {}; }
  const byBody = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    let p; try { p = JSON.parse(line); } catch { continue; }
    if (!p || !p.body || p.lat == null || p.lon == null) continue;
    (byBody[p.body] = byBody[p.body] || []).push({ at: p.at, lat: p.lat, lon: p.lon, alt: p.alt ?? null, srv: !!p.srv, foot: !!p.foot, landed: !!p.landed });
  }
  for (const k of Object.keys(byBody)) byBody[k].sort((a, b) => (a.at < b.at ? -1 : 1));
  trackCache = { mtimeMs: st.mtimeMs, byBody };
  return byBody;
}

/** Breadcrumbs for the given bodies, last 48 h, newest 3000 per body — the map's line. */
export function readTrack(bodies) {
  const all = readTrackAll();
  const since = Date.now() - 48 * 3600_000;
  const out = {};
  for (const [body, pts] of Object.entries(all)) {
    if (bodies && !bodies.has(body)) continue;
    const recent = pts.filter((p) => Date.parse(p.at) >= since);
    out[body] = recent.length > 3000 ? recent.slice(-3000) : recent;
  }
  return out;
}

/**
 * What the track says about a stretch of driving: distance, climb and descent, moving speed, and
 * the highest ground reached. Only SRV-to-SRV legs count as driving; speed only over legs 30 s or
 * closer, so parked time does not drag it down. "Highest ground" refuses SRV jumps: an SRV point
 * counts only when it sits no higher than its neighbours (a jump is a spike), while on-foot and
 * landed-ship points count as they are.
 */
function trackMetrics(points, radius) {
  let driven = 0; let climb = 0; let descent = 0; let movingM = 0; let movingS = 0; let maxMs = 0;
  let highest = null;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.alt != null) {
      const prev = points[i - 1]; const next = points[i + 1];
      const stable = (!prev || prev.alt == null || p.alt <= prev.alt + 3) && (!next || next.alt == null || p.alt <= next.alt + 3);
      const grounded = p.foot || p.landed || (p.srv && stable);
      if (grounded && (!highest || p.alt > highest.alt)) highest = { alt: Math.round(p.alt), lat: p.lat, lon: p.lon, at: p.at, how: p.foot ? 'on foot' : p.landed ? 'landed' : 'in the SRV' };
    }
    if (i === 0) continue;
    const q = points[i - 1];
    if (!(p.srv && q.srv)) continue;
    const m = metresBetween(q.lat, q.lon, p.lat, p.lon, radius);
    const dt = (Date.parse(p.at) - Date.parse(q.at)) / 1000;
    if (m == null || !(dt > 0)) continue;
    driven += m;
    if (p.alt != null && q.alt != null) { const d = p.alt - q.alt; if (d > 0) climb += d; else descent -= d; }
    if (dt <= 30) { movingM += m; movingS += dt; maxMs = Math.max(maxMs, m / dt); }
  }
  return {
    drivenM: Math.round(driven), climbM: Math.round(climb), descentM: Math.round(descent),
    avgKmh: movingS > 0 ? Math.round((movingM / movingS) * 3.6) : null,
    maxKmh: maxMs > 0 ? Math.round(maxMs * 3.6) : null,
    points: points.length,
    highest,
  };
}

// ---- pins and groves ---------------------------------------------------------------------------

/** A named point at the commander's own position — the manual nav lock for things the game never writes. */
export function addPin({ label, kind, lat, lon, body, system } = {}) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !body) return null;
  annotations.pins = annotations.pins || [];
  const pin = { id: `pin:${Date.now().toString(36)}`, at: new Date().toISOString(), label: String(label || 'pin'), kind: String(kind || 'point'), lat, lon, body, system: system || null };
  annotations.pins.push(pin);
  saveAnnotations();
  refreshGroveCache();
  return pin;
}
export function removePin(id) {
  annotations.pins = (annotations.pins || []).filter((p) => p.id !== id);
  saveAnnotations();
  refreshGroveCache();
  return true;
}

// Brain-tree groves the live path can attribute harvests to: pins of that kind plus codex entries
// restored from the journals (k:'poi'). Refreshed when either changes.
let groveCache = [];
function refreshGroveCache() {
  const out = [];
  for (const p of annotations.pins || []) if (p.kind === 'braintree') out.push({ id: p.id, body: p.body, lat: p.lat, lon: p.lon, label: p.label });
  try {
    for (const r of readSurfaceRecords()) if (r && r.k === 'poi' && r.kind === 'braintree' && r.lat != null) out.push({ id: `poi:${r.at}`, body: r.body || null, bodyId: r.bodyId ?? null, systemAddress: r.systemAddress ?? null, lat: r.lat, lon: r.lon, label: r.name || 'Brain Tree' });
  } catch { /* fresh */ }
  groveCache = out;
}
/** The grove (if any) within 300 m of a position on a body — by name, or by BodyID for codex points. */
function groveNear(pos, bodyId) {
  if (!pos || pos.lat == null) return null;
  for (const g of groveCache) {
    const sameBody = (g.body && g.body === pos.body) || (g.body == null && bodyId != null && g.bodyId === bodyId);
    if (!sameBody) continue;
    const m = metresBetween(g.lat, g.lon, pos.lat, pos.lon, pos.radius);
    if (m != null && m <= SAME_DEPOSIT_M) return g;
  }
  return null;
}

/**
 * Recall spot: the tonnage-weighted geometric median of a signal's worked deposits — the point
 * with the least total driving to them (Weiszfeld, in local metres on the body's radius). Terrain
 * is unknown to us; whether a ship can set down there is the commander's call on arrival.
 */
function recallSpotFor(pts, radius) {
  if (!radius || pts.length < 2) return null;
  const rad = Math.PI / 180;
  const lat0 = pts.reduce((t, p) => t + p.lat, 0) / pts.length;
  const lon0 = pts.reduce((t, p) => t + p.lon, 0) / pts.length;
  const kx = radius * rad * Math.cos(lat0 * rad); const ky = radius * rad;
  const local = pts.map((p) => ({ x: (p.lon - lon0) * kx, y: (p.lat - lat0) * ky, w: Math.max(1, p.tonnes || 1), p }));
  let x = local.reduce((t, q) => t + q.x * q.w, 0) / local.reduce((t, q) => t + q.w, 0);
  let y = local.reduce((t, q) => t + q.y * q.w, 0) / local.reduce((t, q) => t + q.w, 0);
  for (let i = 0; i < 60; i += 1) {
    let nx = 0; let ny = 0; let den = 0;
    for (const q of local) { const d = Math.max(0.5, Math.hypot(q.x - x, q.y - y)); nx += q.w * q.x / d; ny += q.w * q.y / d; den += q.w / d; }
    const x2 = nx / den; const y2 = ny / den;
    const step = Math.hypot(x2 - x, y2 - y); x = x2; y = y2;
    if (step < 0.1) break;
  }
  const lat = lat0 + y / ky; const lon = lon0 + x / kx;
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    distances: local.map((q) => ({ id: q.p.id, commodity: q.p.commodity || q.p.taggedCommodity || null, metres: Math.round(Math.hypot(q.x - x, q.y - y)) })),
  };
}

/**
 * Body name for a (system, BodyID) from the ledger alone — drops, scans, signals and sightings
 * all carry both. The exploration cache in state is the other source; this one knows every body
 * that was ever mined, whether or not it was ever scanned from this machine.
 */
export function bodyNameFromLedger(systemAddress, bodyId) {
  if (systemAddress == null || bodyId == null) return null;
  for (const r of readSurfaceRecords()) {
    if (!r || !r.body || r.systemAddress == null || String(r.systemAddress) !== String(systemAddress)) continue;
    if (r.bodyId != null && String(r.bodyId) === String(bodyId)) return r.body;
    if (r.k === 'drop' && r.navBody != null && String(r.navBody) === String(bodyId)) return r.body;
  }
  return null;
}

/**
 * Aggregate the ledger for the UI: opportunities per body (DSS signal counts) joined with
 * results per body and per deposit location.
 */
export function getSurfaceSummary(priceFn, resolveBody, bestSellFn) {
  // Never close the live burst from a READ. The page polls this every 15s and after every tag,
  // and finalising here sliced one rig emptying into 3t/6t/1t/8t records seconds apart — which
  // made "collections" meaningless. The open burst is included as a transient copy so the page
  // still sees it; it closes on its own when the refines stop.
  flushNow();
  const stored = readSurfaceRecords();
  if (open && open.tonnes) {
    stored.push({
      k: 'collect', at: open.at, endedAt: new Date().toISOString(), body: open.body, system: open.system,
      systemAddress: open.systemAddress, lat: open.lat, lon: open.lon, radius: open.radius,
      siteIndex: open.siteIndex ?? null, bodyId: open.bodyId ?? null, commodity: open.commodity,
      commodities: { ...open.commodities }, tonnes: open.tonnes, materials: { ...open.materials }, live: true,
    });
  }
  const recs = coalesceCollections(expandBursts(stored));
  // Tag retractions: a sighting is active only if no later `unsight` names the same signal and
  // commodity; tagging again after a retraction re-activates it. Both lines stay in the ledger.
  const retractedAt = new Map(); // body|siteIndex|commodity → latest retraction time
  for (const r of recs) {
    if (!r || r.k !== 'unsight' || !r.body || !r.commodity) continue;
    const key = `${r.body}|${r.siteIndex ?? ''}|${commodityId(r.commodity)}`;
    if (!retractedAt.has(key) || r.at > retractedAt.get(key)) retractedAt.set(key, r.at);
  }
  const isRetracted = (s) => {
    const t = retractedAt.get(`${s.body}|${s.siteIndex ?? ''}|${commodityId(s.commodity)}`);
    return !!t && t > s.at;
  };
  const ratings = []; // commander's landing/driving scores per signal
  const trips = [];   // hold cycles: drop-offs at the ship inside a visit
  const harvests = []; // material pickups inside a brain-tree grove
  const pois = [];     // codex entries with a position (brain trees), restored from the journals
  const bodies = new Map();
  const deposits = new Map();
  const drops = [];
  const dropAt = new Map(); // body|at → the one drop kept for that instant (see the merge below)
  const marks = [];
  const locks = []; // "you looked at Site N" — from the nav lock, resolved to a body name below
  const lands = []; // LaunchSRV positions — the anchor distances are measured from
  // Every record with a position, clustered into deposits after the pass.
  const placed = [];
  const sightings = [];
  // record key -> deposit cluster id, so a marker knows whether its deposit has been worked
  const clusterOf = new Map();

  const body = (name) => {
    let b = bodies.get(name);
    if (!b) {
      b = {
        body: name, system: null, systemAddress: null,
        spots: null, spotsAt: null,
        surface: null, surveyAt: null, gravity: null,
        tonnes: 0, collections: 0, commodities: {}, materials: {},
        firstAt: null, lastAt: null, located: 0,
      };
      bodies.set(name, b);
    }
    return b;
  };

  // BodyID → body name, from every record that carries both (scans, DSS signals, drops). A nav
  // lock names a body by id only ("Body": 14), so this is how "you looked at Site 4 on Body 14"
  // becomes "Site 4 on 1 a" without storing a name the lock never had.
  const nameByBodyId = new Map();
  for (const r of recs) {
    if (!r || !r.body || r.systemAddress == null) continue;
    if (r.bodyId != null) nameByBodyId.set(`${r.systemAddress}|${r.bodyId}`, r.body);
    // Drops written before bodyId was stamped still carry the lock's BodyID as navBody.
    if (r.k === 'drop' && r.navBody != null) nameByBodyId.set(`${r.systemAddress}|${r.navBody}`, r.body);
  }
  // Ledger first, then the caller's resolver (the exploration cache in state) for bodies whose
  // scan predates bodyId capture — the ledger is append-only, so those records never gain it.
  const bodyNameFor = (systemAddress, bodyId) =>
    nameByBodyId.get(`${systemAddress}|${bodyId}`)
    || (typeof resolveBody === 'function' ? resolveBody(systemAddress, bodyId) : null)
    || null;

  for (const r of recs) {
    if (r && r.k === 'lock') {
      locks.push({ ...r, body: bodyNameFor(r.systemAddress, r.bodyId) });
      continue;
    }
    if (!r || !r.body) continue;
    const b = body(r.body);
    if (r.system && !b.system) b.system = r.system;
    if (r.systemAddress != null && b.systemAddress == null) b.systemAddress = r.systemAddress;
    if (r.radius && !b.radius) b.radius = r.radius; // the body's real radius, for the map and the recall spot

    if (r.k === 'signal') {
      // Latest scan wins — the count is a property of the body, re-reported on every DSS. A count
      // typed from the system map (manual) fills the gap until a DSS exists and never outranks one.
      if (r.manual) {
        if (!b.spotsJournal && (!b.spotsAt || r.at > b.spotsAt)) { b.spots = r.count; b.spotsAt = r.at; b.spotsManual = true; }
      } else if (!b.spotsJournal || !b.spotsAt || r.at > b.spotsAt) {
        b.spots = r.count; b.spotsAt = r.at; b.spotsJournal = true; b.spotsManual = false;
      }
      continue;
    }
    if (r.k === 'body') {
      // Surface composition. Latest scan wins; percentages are a property of the body.
      if (!b.surveyAt || r.at > b.surveyAt) {
        b.surveyAt = r.at;
        b.surface = r.materials || {};
        b.gravity = r.gravity ?? b.gravity ?? null;
      }
      // Class and atmosphere from any record that carries them — older records simply lack the key.
      if (r.planetClass !== undefined) { b.planetClass = r.planetClass; b.atmosphere = r.atmosphere ?? null; }
      continue;
    }
    if (r.k === 'land') { lands.push(r); continue; }
    if (r.k === 'drop') {
      // Drops written before the site index was stamped still carry the raw lock token — the
      // 01:11:41 drop on 1 a did, and read as "no site" until this re-parse. The raw token is kept
      // in the ledger precisely so identity can be recovered from it later.
      const fromRaw = r.siteIndex == null && r.navName
        ? parseMiningLock({ name: r.navName, body: r.navBody, system: r.systemAddress })
        : null;
      const d = fromRaw ? { ...r, siteIndex: fromRaw.index, bodyId: r.bodyId ?? fromRaw.bodyId } : r;
      // A hand-set site for a visit is dated to the visit's own drop, so it lands on the same
      // instant as the journal drop it corrects. Two drops at one instant would be two visits
      // claiming the same collections — merge instead: the later record wins the site, the
      // journal's coordinates survive when the correction has none.
      const key = `${d.body}|${d.at}`;
      const prev = dropAt.get(key);
      if (prev) {
        const merged = {
          ...prev, ...d,
          lat: d.lat ?? prev.lat, lon: d.lon ?? prev.lon, radius: d.radius ?? prev.radius,
          bodyId: d.bodyId ?? prev.bodyId, navBody: d.navBody ?? prev.navBody,
          siteIndex: d.siteIndex ?? prev.siteIndex,
        };
        drops[drops.indexOf(prev)] = merged;
        dropAt.set(key, merged);
      } else {
        drops.push(d);
        dropAt.set(key, d);
        b.drops = (b.drops || 0) + 1;
      }
      continue;
    }
    if (r.k === 'mark') {
      marks.push(r);
      // A marker is a POSITION as much as a photo — cluster it with collections so the spot you
      // flagged and the rig you emptied 200m away resolve to one deposit, not two.
      if (isSurfaceMark(r)) placed.push(r);
      continue;
    }
    if (r.k === 'unsight') continue; // applied through isRetracted above
    if (r.k === 'rating') { ratings.push(r); continue; }
    if (r.k === 'trip') { trips.push(r); continue; }
    if (r.k === 'harvest') { harvests.push(r); continue; }
    if (r.k === 'poi') { pois.push(r); continue; }
    if (r.k === 'sight') {
      if (isRetracted(r)) continue;
      sightings.push(r);
      // A commodity seen but never mined: recorded so the body's inventory is what it CARRIES,
      // not merely what got worked. Zero tonnes, so it can never inflate a measured rate.
      b.seen = b.seen || {};
      b.seen[r.commodity] = (b.seen[r.commodity] || 0) + 1;
      continue;
    }
    if (r.k !== 'collect') continue;

    b.tonnes += r.tonnes || 0;
    b.collections += 1;
    if (!b.firstAt || r.at < b.firstAt) b.firstAt = r.at;
    if (!b.lastAt || r.at > b.lastAt) b.lastAt = r.at;
    for (const [k, v] of Object.entries(r.commodities || {})) b.commodities[k] = (b.commodities[k] || 0) + v;
    for (const [k, v] of Object.entries(r.materials || {})) b.materials[k] = (b.materials[k] || 0) + v;

    if (r.lat == null || r.lon == null) continue; // backfilled — counts for the body, not placeable
    b.located += 1;
    placed.push(r);
  }

  // Deposits are CLUSTERS, not coordinates. You never park twice in the same spot: the commander's
  // Rhodplumsite marker and the collection at it sit ~200m apart and are one deposit, while the
  // next deposit along is 1,256m away. Keying on the raw position split them into two rows that
  // had to be tagged separately.
  for (const c of clusterByProximity(placed, (r) => r.radius || 2961030)) {
    const first = c.items.reduce((a, x) => (x.at < a.at ? x : a));
    const id = `${c.body}|${coordKey(first.lat, first.lon)}`;
    const d = {
      id, body: c.body, system: first.system || (bodies.get(c.body) || {}).system || null,
      lat: first.lat, lon: first.lon,
      tonnes: 0, collections: 0, commodities: {}, materials: {},
      firstAt: first.at, lastAt: first.at,
      at: first.at,
      // Every position that resolved to this deposit — so a later visit parked 200m off still
      // lands here rather than spawning a twin.
      positions: c.items.length,
      // The F10 shots taken inside this cluster. Without carrying these forward, a marker that
      // merged into a worked deposit lost its filename and the deposit showed no photo — even
      // though the picture was adopted into the gallery and is the whole record of what the
      // HUD panel said.
      files: c.items.filter((x) => x.k === 'mark' && x.file).map((x) => x.file),
      // First stamped site index among the cluster's records — live collections carry it.
      siteIndex: (c.items.find((x) => x.siteIndex != null) || {}).siteIndex ?? null,
      // The deposit's commodity is part of its identity (see clusterByProximity).
      commodity: c.commodity || null,
      // True when every record here came from a split burst's trailing commodity — the position
      // is the previous rig's, not this one's, and the UI must say so.
      uncertain: c.items.length > 0 && c.items.every((x) => x.positionUncertain),
    };
    for (const r of c.items) {
      d.tonnes += r.tonnes || 0;
      if (r.k === 'collect') {
        d.collections += 1;
        if ((r.tonnes || 0) > (d.maxCollection || 0)) { d.maxCollection = r.tonnes || 0; d.maxCollectionAt = r.at; }
      }
      if (r.at < d.firstAt) d.firstAt = r.at;
      if (r.at > d.lastAt) d.lastAt = r.at;
      for (const [k, v] of Object.entries(r.commodities || {})) d.commodities[k] = (d.commodities[k] || 0) + v;
      for (const [k, v] of Object.entries(r.materials || {})) d.materials[k] = (d.materials[k] || 0) + v;
    }
    for (const r of c.items) clusterOf.set(r.at + '|' + r.k, id);
    if (d.tonnes > 0) deposits.set(id, d);
  }

  const value = (map) => {
    if (typeof priceFn !== 'function') return null;
    let cr = 0; let known = false;
    for (const [k, t] of Object.entries(map || {})) {
      const p = priceFn(k);
      if (p > 0) { cr += p * t; known = true; }
    }
    return known ? cr : null;
  };

  // A full rig holds 9 units (the HUD's "9/9"), and every single-rig collection on file lands at
  // 8–9 t: the largest single collection at a deposit is therefore a count of rigs. An ESTIMATE,
  // labelled as such and never written over a count the commander set. The capacity is dated —
  // Frontier may raise it — so each collection divides by the capacity in force when it happened.
  const decorate = (x) => {
    const cap = x.maxCollection ? rigCapacityAt(x.maxCollectionAt) : null;
    return {
      ...x,
      perCollection: x.collections ? Math.round((x.tonnes / x.collections) * 10) / 10 : 0,
      credits: value(x.commodities),
      rigsEstimate: x.maxCollection && cap ? Math.min(4, Math.max(1, Math.ceil((x.maxCollection - 1) / cap))) : null,
      rigsBasis: x.maxCollection && cap ? `${x.maxCollection}t in one collection at ${cap}t per full rig` : null,
    };
  };

  /** Collections that belong to a drop: same body, after it, before the next drop on that body. */
  const collectsFor = (d) => {
    const next = drops.filter((o) => o.body === d.body && o.at > d.at).sort((a, c) => (a.at < c.at ? -1 : 1))[0];
    return recs.filter((r) => r && r.k === 'collect' && r.body === d.body && r.at >= d.at && (!next || r.at < next.at));
  };

  /**
   * Site-level control. A body's sites come from three sources with three different meanings:
   *   known   — the DSS count ("Planetary Mining Location (9)"), from SAASignalsFound
   *   seen    — sites you nav-locked from orbit, whether or not you dropped
   *   tagged  — sites you logged commodities for from the target panel
   *   worked  — sites you dropped on and pulled tonnage from
   * Kept as separate numbers because they answer different questions, and because subtracting
   * them would be wrong: seen and worked overlap, and known counts sites you have never looked at.
   */
  const withSites = (b) => {
    const idxOf = (arr) => new Set(arr.map((x) => x.siteIndex).filter((i) => i != null));
    const bodyLocks = locks.filter((l) => l.body === b.body);
    const bodySights = sightings.filter((s) => s.body === b.body);
    const bodyDrops = drops.filter((d) => d.body === b.body);
    const seen = idxOf(bodyLocks);
    const tagged = idxOf(bodySights);
    const worked = new Set(bodyDrops.filter((d) => d.siteIndex != null && collectsFor(d).length).map((d) => d.siteIndex));
    // Dropped on, tonnage or not. Landing at Site 2 and leaving without mining is still a visit,
    // and the site should be listed — otherwise the row only appears once you have pulled from it.
    const visited = idxOf(bodyDrops);
    // Every site the DSS (or the commander, from the map) says exists gets a row, so a site can be
    // tagged from orbit before anyone has locked, dropped or pulled on it.
    const known = Array.from({ length: Math.max(0, Math.min(Number(b.spots) || 0, 64)) }, (_, i) => i + 1);
    const indices = [...new Set([...known, ...seen, ...tagged, ...visited, ...worked])].sort((a, c) => a - c);
    const siteRows = indices.map((index) => {
      const cs = bodyDrops.filter((d) => d.siteIndex === index).flatMap(collectsFor);
      const commodities = {};
      for (const r of cs) for (const [k, v] of Object.entries(r.commodities || {})) commodities[k] = (commodities[k] || 0) + v;
      const lastLock = bodyLocks.filter((l) => l.siteIndex === index).map((l) => l.at).sort().pop() || null;
      const lastPull = cs.map((r) => r.at).sort().pop() || null;
      return {
        index,
        seen: seen.has(index),
        visited: visited.has(index),
        worked: worked.has(index),
        // What the target panel said is there, plus what actually came out. A pulled commodity is
        // the strongest "expected" there is; keeping it in a separate column let the same name be
        // tagged on a site it had already been mined from.
        expected: [...new Set([
          ...bodySights.filter((s) => s.siteIndex === index).map((s) => s.commodity),
          ...Object.keys(commodities),
        ])],
        // What actually came out.
        commodities,
        tonnes: cs.reduce((t, r) => t + (r.tonnes || 0), 0),
        collections: cs.length,
        lastAt: lastPull || lastLock,
        // The commander's scores: latest driving per signal, latest landing per signal per hull.
        ratings: (() => {
          const rs = ratings.filter((x) => x.body === b.body && x.siteIndex === index).sort((x, y) => (x.at < y.at ? -1 : 1));
          const driving = rs.filter((x) => x.driving != null).pop() || null;
          const landing = new Map();
          for (const x of rs) if (x.landing != null) landing.set(x.shipType || x.ship || '?', x);
          return {
            driving: driving ? { score: driving.driving, at: driving.at } : null,
            // Name and pad size resolve from the hull id at READ time: early records stored a
            // prettified id ("Explorer Nx") and no size; the ledger is append-only, so fix it here.
            landing: [...landing.values()].map((x) => ({
              score: x.landing,
              ship: x.shipType ? (friendlyShip(x.shipType) !== x.shipType ? friendlyShip(x.shipType) : x.ship) : x.ship,
              shipType: x.shipType,
              size: x.size ?? (x.shipType ? (padSizeFor(x.shipType) || hullSizeFor(x.shipType) || null) : null),
              at: x.at,
            })),
          };
        })(),
      };
    });
    return {
      ...b,
      sitesKnown: b.spots ?? null,
      sitesManual: !!b.spotsManual,
      sitesSeen: seen.size,
      sitesTagged: tagged.size,
      sitesWorked: worked.size,
      sitesVisited: visited.size,
      siteRows,
    };
  };

  const trackAll = readTrackAll();

  // One visit per drop: what came out between landing and the next drop, and how fast. The rate
  // is measured from the drop to the last collection's end — real elapsed time, not an estimate.
  const visits = drops
    .map((d) => {
      const cs = collectsFor(d);
      const tonnes = cs.reduce((t, r) => t + (r.tonnes || 0), 0);
      const endMs = cs.length ? Math.max(...cs.map((r) => Date.parse(r.endedAt || r.at))) : NaN;
      const hours = Number.isFinite(endMs) ? (endMs - Date.parse(d.at)) / 3600000 : 0;
      const commodities = {};
      for (const r of cs) for (const [k, v] of Object.entries(r.commodities || {})) commodities[k] = (commodities[k] || 0) + v;
      // Trips inside this visit's window — drop-offs at the ship, i.e. how many hold-fulls.
      const next = drops.filter((o) => o.body === d.body && o.at > d.at).sort((a, c) => (a.at < c.at ? -1 : 1))[0];
      const tripCount = trips.filter((t) => t.body === d.body && t.at >= d.at && (!next || t.at < next.at)).length;
      // The drive inside the same window, from the breadcrumb track (nothing before it was recorded).
      const pts = (trackAll[d.body] || []).filter((p) => p.at >= d.at && (!next || p.at < next.at));
      const drive = pts.length > 1 ? trackMetrics(pts, d.radius || null) : null;
      return {
        at: d.at, body: d.body, system: d.system, lat: d.lat, lon: d.lon,
        siteIndex: d.siteIndex ?? null, label: d.navLabel || null,
        tonnes, collections: cs.length, commodities,
        trips: tripCount,
        drive,
        hours: Math.round(hours * 100) / 100,
        tph: hours > 0.02 ? Math.round(tonnes / hours) : null,
      };
    })
    .sort((a, c) => (a.at < c.at ? 1 : -1));

  // Marks join at read time so the ledger stays append-only.
  const markOf = new Map(annotations.marks.map((m) => [m.id, m]));

  /**
   * Find a deposit's annotation by POSITION, not just by id.
   *
   * Deposit ids are anchored on the cluster's earliest record, so the anchor can move when an
   * earlier position joins the cluster — which silently orphaned a tag the commander had already
   * written (Rhodplumsite, amount high / density low, keyed to the collection's coordinates before
   * a marker 200m away became the anchor). Matching within SAME_DEPOSIT_M means a tag survives
   * re-anchoring, which is the only behaviour that does not quietly lose their work.
   */
  const annotationFor = (d) => {
    const exact = markOf.get(d.id) || null;
    let near = null;
    for (const m of annotations.marks) {
      if (m.id.startsWith('site:')) continue;
      const bar = m.id.lastIndexOf('|');
      if (bar < 0 || m.id.slice(0, bar) !== d.body) continue;
      const [la, lo] = m.id.slice(bar + 1).split(',').map(Number);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      if (exact && m.id === exact.id) continue;
      const dist = metresBetween(la, lo, d.lat, d.lon, 2961030);
      if (dist != null && dist <= SAME_DEPOSIT_M) { near = m; break; }
    }
    if (!exact) return near;
    if (!near) return exact;
    // Both exist (the anchor moved after an earlier tag): the exact mark wins field by field, but
    // anything it does not carry falls back to the older nearby one instead of being lost.
    return {
      ...near,
      ...Object.fromEntries(Object.entries(exact).filter(([, v]) => v != null)),
    };
  };

  const withMark = (d) => {
    const m = annotationFor(d);
    return m ? { ...d, amount: m.amount, density: m.density, taggedCommodity: m.commodity, note: m.note, site: m.site, rigs: m.rigs ?? null } : d;
  };

  /** The drop that began the visit a record belongs to: same body, most recent drop before it. */
  const dropFor = (rec) => {
    let best = null;
    for (const d of drops) {
      if (d.body !== rec.body || d.at > rec.at) continue;
      if (!best || d.at > best.at) best = d;
    }
    return best;
  };

  /** The landing that began the visit: LaunchSRV position on the same body, most recent before it. */
  const landingFor = (rec) => {
    let best = null;
    for (const l of lands) {
      if (l.body !== rec.body || l.at > rec.at) continue;
      if (!best || l.at > best.at) best = l;
    }
    return best;
  };
  // Distances anchor on the LANDING when one was captured; the drop (sampled km up, moving) is the
  // fallback for visits recorded before landings were.
  const anchorFor = (rec) => landingFor(rec) || dropFor(rec);

  // Distance from the drop is what connects a SITE to its DEPOSITS. The journal never says which
  // site a deposit belongs to, so rather than invent an assignment we state the measured distance
  // and let it speak: ~0 means you dropped on it, kilometres mean you drove somewhere else.
  const withDrop = (d) => {
    const drop = dropFor(d);
    const anchor = anchorFor(d);
    if (!anchor) return d;
    const m = metresBetween(anchor.lat, anchor.lon, d.lat, d.lon, d.radius || anchor.radius);
    return {
      ...d,
      anchorAt: anchor.at,
      anchorLat: anchor.lat,
      anchorLon: anchor.lon,
      // 'landing' = measured from where the ship set down (LaunchSRV); 'drop' = the supercruise
      // exit, which can be tens of km off and is only used when no landing was captured.
      anchor: anchor.k === 'land' ? 'landing' : 'drop',
      metresFromAnchor: m,
      metresFromDrop: m, // kept for older clients; same value
      sameSite: m == null ? null : m <= SAME_SITE_M,
      // The site the drop was made on, if the lock named it. The deposit's own stamp (written live)
      // wins; the read-time drop match is the fallback for records made before stamping existed.
      siteIndex: d.siteIndex ?? (drop ? drop.siteIndex : null) ?? null,
    };
  };

  // F10 markers that are NOT already a mined deposit — places you flagged but never worked.
  //
  // Two filters, both there to stop this becoming a photo album. Altitude drops flyovers (a
  // marker at 1,691m is a picture, not a deposit). The date cutoff drops everything older than
  // surface mining itself: planetary mining deposits did not exist before the 2026-09-02 update,
  // so a 2024 screenshot of Goldstein's Rock cannot be marking one. Records are still STORED —
  // filtering happens here so the cutoff can move without re-backfilling.
  // A marker is 'worked' when its CLUSTER carries tonnage — exact-id matching missed the case
  // that matters, where the rig was emptied a couple of hundred metres from where you stood.
  const pinnedKeys = new Set([...deposits.values()].filter((d) => d.tonnes > 0).map((d) => d.id));
  const surfaceMarks = marks
    // Altitude PRESENT is the discriminator, not merely low. The game writes Altitude only when
    // you are on or near a surface, so a docked or in-space shot simply has no such field —
    // "Cavallo Nero Corona" and "Jaques Station" both arrived with lat 0.0000 and no altitude and
    // were wrongly listed as surface markers. Requiring the field excludes them by construction,
    // and the < 200m bound then drops flyovers like the 1,691m pass over 2 a.
    .filter(isSurfaceMark)
    .map((m) => {
      const id = clusterOf.get(m.at + '|mark') || `${m.body}|${coordKey(m.lat, m.lon)}`;
      const anchor = anchorFor(m);
      const drop = dropFor(m);
      const tag = markOf.get(id) || null;
      return {
        id, at: m.at, body: m.body, system: m.system, lat: m.lat, lon: m.lon,
        heading: m.heading, altitude: m.altitude, file: m.file,
        // The site of the visit the shot was taken on — so the page can nest it under that site.
        siteIndex: drop ? drop.siteIndex ?? null : null,
        worked: pinnedKeys.has(id),
        // F10 is ALSO the Sights key, so a marker is a CANDIDATE, never a deposit on its own.
        // Tagging it with a commodity is what promotes it — an untagged shot is just a postcard,
        // and guessing would fill the deposit table with scenery.
        promoted: !!(tag && tag.commodity),
        amount: tag ? tag.amount : null,
        density: tag ? tag.density : null,
        commodity: tag ? tag.commodity : null,
        rigs: tag ? tag.rigs ?? null : null,
        metresFromDrop: anchor ? metresBetween(anchor.lat, anchor.lon, m.lat, m.lon, m.radius || anchor.radius) : null,
        metresFromAnchor: anchor ? metresBetween(anchor.lat, anchor.lon, m.lat, m.lon, m.radius || anchor.radius) : null,
        anchor: anchor ? (anchor.k === 'land' ? 'landing' : 'drop') : null,
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  // A promoted marker is a real deposit with no tonnage yet — you flagged it, you have not
  // worked it. Kept out of `deposits` until promoted so the table never contains a postcard.
  const promotedMarks = surfaceMarks
    .filter((m) => m.promoted && !m.worked)
    .map((m) => ({
      id: m.id, body: m.body, system: m.system, lat: m.lat, lon: m.lon,
      tonnes: 0, collections: 0, perCollection: 0, credits: null,
      commodities: {}, materials: {},
      firstAt: m.at, lastAt: m.at,
      amount: m.amount, density: m.density, taggedCommodity: m.commodity, rigs: m.rigs ?? null,
      metresFromDrop: m.metresFromDrop,
      markedOnly: true,
      // Carry the shot forward — same defect as the cluster case: rebuilding the row without
      // its filename silently dropped the photo of the panel that named this deposit.
      at: m.at,
      files: m.file ? [m.file] : [],
    }));

  const bodiesOut = [...bodies.values()].map(decorate).map(withSites)
    .sort((a, b) => (b.tonnes - a.tonnes) || ((b.spots || 0) - (a.spots || 0)));
  const depositsOut = [...deposits.values()].map(decorate).map(withDrop).map(withMark)
    .concat(promotedMarks)
    .sort((a, b) => b.tonnes - a.tonnes || (a.lastAt < b.lastAt ? 1 : -1));
  // Recall spot per signal: the least-total-driving point among its worked deposits.
  for (const b of bodiesOut) {
    for (const r of b.siteRows) {
      const pts = depositsOut.filter((d) => d.body === b.body && d.siteIndex === r.index && d.tonnes > 0 && !d.uncertain && d.lat != null && d.lon != null);
      r.recall = recallSpotFor(pts, b.radius || (pts[0] && pts[0].radius) || null);
    }
    // Lifetime driving on the body, and the highest ground reached (jump-proofed).
    const pts = trackAll[b.body] || [];
    b.drive = pts.length > 1 ? trackMetrics(pts, b.radius || null) : null;
  }
  const trackBodies = new Set(bodiesOut.filter((b) => b.tonnes > 0 || b.siteRows.length > 0).map((b) => b.body));

  // Brain-tree groves: pins of that kind plus codex positions, deduped within 300 m, each with the
  // harvests attributed to it — units by material and grade, and units per hour of harvesting.
  const groves = [];
  const addGrove = (g) => {
    const dup = groves.find((o) => o.body === g.body && (metresBetween(o.lat, o.lon, g.lat, g.lon, o.radius || 2_000_000) ?? Infinity) <= SAME_DEPOSIT_M);
    if (dup) { dup.ids.push(g.id); return; }
    groves.push({ ...g, ids: [g.id] });
  };
  for (const p of annotations.pins || []) if (p.kind === 'braintree') addGrove({ id: p.id, body: p.body, system: p.system, lat: p.lat, lon: p.lon, label: p.label, source: 'pin', at: p.at, radius: (bodies.get(p.body) || {}).radius || null });
  for (const r of pois) {
    if (r.kind !== 'braintree' || r.lat == null) continue;
    const bodyName = r.body || bodyNameFor(r.systemAddress, r.bodyId);
    if (!bodyName) continue;
    addGrove({ id: `poi:${r.at}`, body: bodyName, system: r.system || null, lat: r.lat, lon: r.lon, label: r.name || 'Brain Tree', source: 'codex', at: r.at, radius: (bodies.get(bodyName) || {}).radius || null });
  }
  for (const g of groves) {
    const hs = harvests.filter((h) => g.ids.includes(h.groveId)).sort((a, c) => (a.at < c.at ? -1 : 1));
    const materials = {}; const byGrade = {};
    for (const h of hs) { materials[h.name] = (materials[h.name] || 0) + (h.count || 1); const gr = h.grade || 0; byGrade[gr] = (byGrade[gr] || 0) + (h.count || 1); }
    const units = hs.reduce((t, h) => t + (h.count || 1), 0);
    const hours = hs.length > 1 ? (Date.parse(hs[hs.length - 1].at) - Date.parse(hs[0].at)) / 3600000 : 0;
    g.harvest = units ? { units, materials, byGrade, hours: Math.round(hours * 100) / 100, unitsPerHour: hours > 0.05 ? Math.round(units / hours) : null, first: hs[0].at, last: hs[hs.length - 1].at, pickups: hs.length } : null;
    delete g.ids;
  }
  const pinsOut = (annotations.pins || []).map((p) => ({ ...p }));

  // Prices for everything on the page: the galactic average (live mean when the game has given
  // one, else the table) and the best sell among the commander's own visited markets, with where
  // and when. Keyed by the table's spelling so the page looks up what it displays.
  const priceNames = new Set();
  for (const b of bodiesOut) {
    for (const c of Object.keys(b.commodities || {})) priceNames.add(canonicalCommodityName(c));
    for (const r of b.siteRows) for (const c of r.expected || []) priceNames.add(canonicalCommodityName(c));
  }
  for (const s of sightings) priceNames.add(canonicalCommodityName(s.commodity));
  const prices = {};
  for (const n of priceNames) {
    prices[n] = { mean: galacticAvgSell(n), best: typeof bestSellFn === 'function' ? (bestSellFn(n) || null) : null };
  }

  return {
    bodies: bodiesOut,
    deposits: depositsOut,
    // Breadcrumbs (48 h) for the bodies on the page, and the current steering target.
    track: readTrack(trackBodies),
    target: navTarget,
    rigCapacity: getRigCapacity(),
    pins: pinsOut,
    groves,
    prices,
    // Surface F10 shots awaiting a decision. Untagged ones are almost certainly Sights postcards;
    // tagging one with a commodity promotes it into `deposits` above.
    marks: surfaceMarks.filter((m) => !m.promoted && !m.worked),
    // Deposits logged from the HUD without driving to them, grouped by the site you named. Zero
    // tonnage by construction, so scouting can never inflate a measured extraction rate.
    sightings: sightings
      .map((r) => ({
        at: r.at, body: r.body, system: r.system, commodity: r.commodity,
        site: r.site || null, amount: r.amount || null, density: r.density || null,
      }))
      .sort((a, b) => (a.at < b.at ? 1 : -1)),
    // Site labels already used on each body — the picker's options, so a site is named once.
    sites: Object.fromEntries([...knownSites(recs)].map(([b, set]) => [b, [...set].sort()])),
    drops: drops.length,
    // One row per drop, with measured tonnes and rate for that visit.
    visits,
    // Live state — the same object /api/surface-mining/snapshot serves at a faster cadence. The
    // lock's body is resolved HERE too: the page took this snapshot every 15s and after every tag,
    // and an unresolved lock read "Body 14" and disabled Add until the 5s poll put "1 a" back.
    snapshot: (() => {
      const s = getSurfaceSnapshot();
      return s.lock && s.lock.bodyId != null
        ? { ...s, lock: { ...s.lock, body: bodyNameFor(s.lock.systemAddress, s.lock.bodyId) } }
        : s;
    })(),
    // The visit in progress: the most recent drop, with what has been pulled since. The site's
    // own name comes from the nav lock IF the game supplies one for planetary sites the way it
    // does for ring hotspots; otherwise the commander labels it once and proximity does the rest.
    currentVisit: (() => {
      const last = drops.length ? drops.reduce((a, d) => (d.at > a.at ? d : a)) : null;
      if (!last) return null;
      const id = `site:${last.body}|${coordKey(last.lat, last.lon)}`;
      const tag = markOf.get(id) || null;
      // A label already given to a nearby drop carries over — that is what makes naming a site
      // a one-time act rather than something retyped on every visit.
      let inherited = null;
      if (!tag) {
        for (const m of annotations.marks) {
          if (!m.id.startsWith('site:') || !m.note) continue;
          const d = drops.find((x) => `site:${x.body}|${coordKey(x.lat, x.lon)}` === m.id);
          if (!d || d.body !== last.body) continue;
          const dist = metresBetween(d.lat, d.lon, last.lat, last.lon, last.radius);
          if (dist != null && dist <= SAME_SITE_M) { inherited = m.note; break; }
        }
      }
      const since = recs.filter((r) => r.k === 'collect' && r.body === last.body && r.at >= last.at);
      return {
        id,
        at: last.at,
        body: last.body,
        system: last.system,
        lat: last.lat,
        lon: last.lon,
        label: (tag && tag.note) || inherited || null,
        // Raw, unparsed. If planetary sites populate Destination the way ring hotspots do
        // ("$SAA_RingHotspot:#type=$Tritium_name;;"), the site's own name is in here.
        navName: last.navName || null,
        navLabel: last.navLabel || null,
        tonnesSince: since.reduce((t, r) => t + (r.tonnes || 0), 0),
        collectionsSince: since.length,
      };
    })(),
    // Honest, and the UI says so rather than implying a rig counter exists.
    unmeasurable: ['rig deployments', 'rig progress', 'rigs remaining'],
  };
}

/**
 * Rebuild body-level history from the journals. Coordinates are NOT recoverable (Status.json is
 * never archived), so these records carry lat/lon null and count only toward the body.
 * Surface mining is identified by a MiningRefined that follows a LaunchSRV with no intervening
 * DockSRV — the SRV flag is a live-only signal and cannot be replayed.
 */
export function backfillFromJournals(journalDir, listFiles) {
  if (!LOG_PATH) return { added: 0, files: 0 };
  const existing = readSurfaceRecords();
  const have = new Set(existing.filter((r) => r && r.k === 'collect').map((r) => r.at));
  // Dedupe keys per kind: signals repeat per scan (body+time), body composition is once per body,
  // markers once per shot. Without seeding all three a re-run duplicates everything.
  const haveSignals = new Set([
    ...existing.filter((r) => r && r.k === 'signal').map((r) => `${r.body}|${r.at}`),
    // A body record written before planetClass existed gets one refreshed record (the key is
    // absent, not null); after that the body is skipped like the rest.
    ...existing.filter((r) => r && r.k === 'body' && r.planetClass !== undefined).map((r) => `body|${r.body}`),
    ...existing.filter((r) => r && r.k === 'mark').map((r) => `mark|${r.at}`),
    // A hand-set site dated to a visit's drop shares that instant — it already stands for it.
    ...existing.filter((r) => r && r.k === 'drop').map((r) => `drop|${r.at}`),
    ...existing.filter((r) => r && r.k === 'trip').map((r) => `trip|${r.at}`),
    ...existing.filter((r) => r && r.k === 'poi').map((r) => `poi|${r.at}`),
  ]);
  let files = 0; let added = 0;
  const out = [];
  // Drops are only kept for bodies that were actually mined (decided after the pass, because the
  // collections that prove it can be later in the same file or in the next one).
  const dropCandidates = [];

  // listJournalFiles yields {name, fullPath, mtimeMs, size}, not plain paths.
  for (const entry of listFiles(journalDir)) {
    const file = (entry && entry.fullPath) || entry;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    // Not just mining journals: F10 markers and DSS site counts live in journals with no mining
    // in them at all, and skipping those silently lost every historical marker.
    if (!text.includes('MiningRefined') && !text.includes('"Screenshot"')
      && !text.includes('SAASignalsFound') && !text.includes('"Landable":true')
      && !text.includes('"SupercruiseExit"') && !text.includes('"CodexEntry"')
      && !text.includes('"Latitude"')) continue; // a login on a surface — a visit boundary
    files += 1;
    let inSrv = false; let system = null; let systemAddress = null; let bodyName = null;
    let burst = null;
    const commit = () => {
      if (burst && burst.tonnes && !have.has(burst.at)) { out.push(burst); added += 1; }
      burst = null;
    };
    // Trips replay too: refines since the last drop-off, closed by a transfer to the ship or by
    // boarding. Same unit the live path records, so history and live agree.
    let tripT = 0; let tripC = {};
    const pushTrip = (at, reason, transferred) => {
      if (tripT > 0) {
        const key = `trip|${at}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          out.push({ k: 'trip', at, body: bodyName, system, systemAddress, tonnes: tripT, commodities: tripC, reason, transferred, backfilled: true });
          added += 1;
        }
      }
      tripT = 0; tripC = {};
    };
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.StarSystem) { system = e.StarSystem; systemAddress = e.SystemAddress ?? systemAddress; }

      // Surface composition replays too — this is the part of the survey that works retroactively
      // across every journal, because Scan is history and Status.json is not.
      if (e.event === 'Scan' && e.Landable && Array.isArray(e.Materials) && e.Materials.length && e.BodyName) {
        const key = `body|${e.BodyName}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          const mats = {};
          for (const m of e.Materials) {
            const n = String(m.Name || '').toLowerCase();
            if (n && typeof m.Percent === 'number') mats[n] = Math.round(m.Percent * 10) / 10;
          }
          if (Object.keys(mats).length) {
            out.push({
              k: 'body', at: e.timestamp, body: e.BodyName, system: e.StarSystem || system,
              systemAddress: e.SystemAddress ?? systemAddress,
              gravity: typeof e.SurfaceGravity === 'number' ? Math.round(e.SurfaceGravity / 9.80665 * 100) / 100 : null,
              bodyId: e.BodyID ?? null,
              planetClass: e.PlanetClass || null,
              atmosphere: e.Atmosphere || e.AtmosphereType || null,
              materials: mats, backfilled: true,
            });
            added += 1;
          }
        }
      }

      // F10 markers replay from history — the whole reason this beats a live-only pin button.
      if (e.event === 'Screenshot' && e.Latitude != null && e.Longitude != null) {
        const key = `mark|${e.timestamp}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          out.push({
            k: 'mark', at: e.timestamp, body: e.Body || null, system: e.System || system,
            systemAddress: e.SystemAddress ?? systemAddress, lat: e.Latitude, lon: e.Longitude,
            heading: e.Heading ?? null, altitude: e.Altitude ?? null, file: e.Filename || null,
            backfilled: true,
          });
          added += 1;
        }
      }

      // Brain-tree codex entries carry a position — the only journal event that places a grove.
      // Restored as points of interest; the body name resolves at read time from the BodyID.
      if (e.event === 'CodexEntry' && e.Latitude != null && e.Longitude != null && /brain\s*tree/i.test(e.Name_Localised || e.Name || '')) {
        const key = `poi|${e.timestamp}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          out.push({
            k: 'poi', kind: 'braintree', at: e.timestamp, name: e.Name_Localised || e.Name,
            system: e.System || system, systemAddress: e.SystemAddress ?? systemAddress, bodyId: e.BodyID ?? null,
            body: null, lat: e.Latitude, lon: e.Longitude, backfilled: true,
          });
          added += 1;
        }
      }

      // Site counts are in journal history too — without replaying them, Opportunities stays empty
      // until the commander happens to re-scan a body they mapped months ago.
      if (e.event === 'SAASignalsFound' && Array.isArray(e.Signals) && e.BodyName) {
        const spot = e.Signals.find((s) => s && /PlanetaryMiningLocation/i.test(String(s.Type || '')));
        if (spot) {
          const key = `${e.BodyName}|${e.timestamp}`;
          if (!haveSignals.has(key)) {
            haveSignals.add(key);
            out.push({
              k: 'signal', at: e.timestamp, body: e.BodyName, system,
              systemAddress: e.SystemAddress ?? systemAddress, bodyId: e.BodyID ?? null,
              count: spot.Count || 0, backfilled: true,
            });
            added += 1;
          }
        }
      }
      // Drops replay too — the visit boundary. SupercruiseExit names the body and nothing else
      // (Status.json is not archived), so a restored drop has no coordinates and no site; it still
      // ends the previous visit at the right instant, which is what keeps one site's tonnage from
      // bleeding into the next when the exe missed the move. Kept only for mined bodies, below.
      if (e.event === 'SupercruiseExit' && (e.Body || e.BodyName) && e.BodyType === 'Planet'
        && typeof e.timestamp === 'string' && e.timestamp >= SURFACE_MINING_EPOCH) {
        const key = `drop|${e.timestamp}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          dropCandidates.push({
            k: 'drop', at: e.timestamp, body: e.Body || e.BodyName, system: e.StarSystem || system,
            systemAddress: e.SystemAddress ?? systemAddress, lat: null, lon: null, radius: null,
            navName: null, navLabel: null, navBody: null, siteIndex: null, bodyId: e.BodyID ?? null,
            backfilled: true,
          });
        }
      }
      // A login on the surface is a visit boundary too (see the live handler). Location carries the
      // position; the signal is inherited from the previous drop on the body when the candidates
      // are committed, once every drop on file is known.
      if (e.event === 'Location' && e.Latitude != null && e.Longitude != null && (e.Body || e.BodyName)
        && typeof e.timestamp === 'string' && e.timestamp >= SURFACE_MINING_EPOCH) {
        const key = `drop|${e.timestamp}`;
        if (!haveSignals.has(key)) {
          haveSignals.add(key);
          dropCandidates.push({
            k: 'drop', resume: true, at: e.timestamp, body: e.Body || e.BodyName, system: e.StarSystem || system,
            systemAddress: e.SystemAddress ?? systemAddress, lat: e.Latitude, lon: e.Longitude, radius: null,
            navName: null, navLabel: null, navBody: null, siteIndex: null, bodyId: e.BodyID ?? null,
            backfilled: true,
          });
        }
      }
      if (e.event === 'LaunchSRV') { inSrv = true; tripT = 0; tripC = {}; continue; }
      // A journal file that starts mid-drive (relog, or a part rollover) never contains the
      // LaunchSRV — the commander's 2026-09-03 file opened at 23:57 already in the Rhino and every
      // one of its 184 refines was skipped. Cargo{Vessel:"SRV"} is the game stating the SRV's hold
      // changed, which is proof enough that you are in it.
      if (e.event === 'Cargo' && e.Vessel === 'SRV') { inSrv = true; }
      if (e.event === 'Cargo' && e.Vessel === 'Ship' && inSrv && !burst) { inSrv = false; }
      if (e.event === 'DockSRV' || e.event === 'SRVDestroyed') {
        commit();
        if (e.event === 'DockSRV') pushTrip(e.timestamp, 'boarded', []); else { tripT = 0; tripC = {}; }
        inSrv = false;
        continue;
      }
      if (e.event === 'SupercruiseEntry' || e.event === 'FSDJump') { commit(); inSrv = false; tripT = 0; tripC = {}; }
      if (e.Body || e.BodyName) bodyName = e.BodyName || e.Body || bodyName;
      if (e.event === 'CargoTransfer' && inSrv) {
        const toShip = (Array.isArray(e.Transfers) ? e.Transfers : []).filter((t) => t && t.Direction === 'toship');
        if (toShip.length) pushTrip(e.timestamp, 'transfer', toShip.map((t) => ({ commodity: t.Type_Localised || t.Type, count: t.Count })));
        continue;
      }
      if (!inSrv) continue;
      if (e.event === 'MiningRefined') {
        const name = e.Type_Localised || e.Type || '';
        const t = Date.parse(e.timestamp);
        if (burst && Number.isFinite(t) && t - burst.lastMs > BURST_GAP_MS) commit();
        if (!burst) {
          burst = {
            k: 'collect', at: e.timestamp, body: bodyName, system, systemAddress,
            lat: null, lon: null, commodity: name, commodities: {}, tonnes: 0, materials: {},
            backfilled: true, lastMs: t,
          };
        }
        burst.tonnes += 1;
        burst.commodities[name] = (burst.commodities[name] || 0) + 1;
        burst.lastMs = Number.isFinite(t) ? t : burst.lastMs;
        tripT += 1;
        tripC[name] = (tripC[name] || 0) + 1;
      } else if (e.event === 'MaterialCollected' && burst) {
        const nm = e.Name_Localised || e.Name || '';
        if (nm) burst.materials[nm] = (burst.materials[nm] || 0) + (e.Count || 1);
      }
    }
    commit();
  }

  // Visit boundaries for mined bodies only — a settlement drop on a body you never dug is not a
  // visit, and would sit in the visits table at 0t forever.
  const mined = new Set(existing.filter((r) => r && r.k === 'collect' && r.body).map((r) => r.body));
  for (const b of out) if (b.k === 'collect' && b.body) mined.add(b.body);
  // A restored login inherits the signal of the last drop before it on the same body — existing or
  // restored in this pass — exactly as the live handler does from the nav lock's absence.
  const allDrops = [...existing.filter((r) => r && r.k === 'drop'), ...dropCandidates].sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const d of dropCandidates) {
    if (!d.resume) continue;
    let prev = null;
    for (const o of allDrops) { if (o === d || o.body !== d.body || o.at >= d.at) continue; if (!prev || o.at > prev.at) prev = o; }
    if (prev) {
      d.siteIndex = prev.siteIndex ?? null;
      d.navName = prev.navName ?? null;
      d.navLabel = prev.siteIndex != null ? `Signal ${prev.siteIndex} (resumed)` : null;
      d.navBody = prev.navBody ?? null;
      d.radius = prev.radius ?? null;
      if (d.bodyId == null) d.bodyId = prev.bodyId ?? null;
    }
  }
  for (const d of dropCandidates) if (mined.has(d.body)) { out.push(d); added += 1; }

  for (const b of out) { delete b.lastMs; appendRecord(b); }
  flushNow();
  // A restored drop has to become the current visit now, not after the next restart. Left alone
  // while a burst is open — the live tally would lose the tonnes not yet on disk.
  if (added && !open) seedLiveStateFromLedger();
  if (added) refreshGroveCache();
  return { added, files };
}
