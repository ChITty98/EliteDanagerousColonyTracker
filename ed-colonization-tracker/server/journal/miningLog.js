// server/journal/miningLog.js
//
// Append-only prospected-asteroid log, one JSON object per line.
//
// WHY ITS OWN FILE: colony-data.json is already ~21.5MB and is hydrated to every connected device.
// A rock record is ~310 bytes, so an unbounded log inside the state blob would add megabytes to
// every sync. Here appends are O(1) (fs.appendFile, no read-modify-write) and NOTHING is ever
// dropped — no cap, no rotation, no truncation. Same precedent as colony-images/.
//
// ROCK IDENTITY: ProspectedAsteroid carries no asteroid id, but Materials proportions are 6-decimal
// floats. Verified on 2026-07-21: one Serendibite rock prospected 3 times produced byte-identical
// proportions (Lepidolite 22.367233 / Bertrandite 10.206140 / Uraninite 4.708119). The sorted
// (name, proportion) tuple is therefore a reliable fingerprint, so re-prospects update ONE record
// instead of double-counting as separate asteroids.
//
// SELF-CALIBRATION: each record pairs a prospect (material proportions) with the tonnes actually
// refined while that rock was current. That pairing is what lets getYieldTable() re-derive tonnes
// per 1% PER MATERIAL from real outcomes, replacing the bootstrap constant as data accumulates.
// Measured spread across this commander's history is wide enough to matter — pooled 0.163 t/1%
// (n=322, r=0.56) but Bromellite alone runs ~0.437 (n=10). A flat constant under-calls Bromellite
// by ~2.7x, which is exactly the material they are on mission for.

import fs from 'node:fs';
import path from 'node:path';
import { getRingClassOf } from './miningIndex.js';

const FLUSH_MS = 4000;

let LOG_PATH = null;
let ANNOT_PATH = null;
// Hotspot annotations — GROUND TRUTH the journal cannot provide (no in-ring position exists), so
// the commander supplies it: "this ring/session was mined in a hotspot". Kept in a sidecar so the
// append-only log is never rewritten. Matchers: {ring, day?, hotspot, material?} — day null means
// the whole ring's history. Applied at read time in readRocks().
let annotations = { marks: [] };
let pending = [];       // records queued for append
let flushTimer = null;
let current = null;     // rock being mined right now (not yet written)
// The DEFERRED-SWITCH slot. The commander prospects the next rock while collectors still work the
// current one, so an instant handoff at prospect time credited rock A's trailing refines to rock B
// (the "earned isn't lined up with the rock" report, 2026-07-23). The literal fix they proposed —
// wait until Remaining ticks off 100% — is unobservable (Remaining only writes on re-prospect), so
// the next rock WAITS here while refines keep crediting the current one; mining.js promotes it when
// the refine stream goes quiet (pipeline drained) or a hard cap expires.
let nextRock = null;
let readCache = null;   // { rows, mtimeMs }

/** Point the log at the app data dir. Call once at boot. */
export function initMiningLog(appDir) {
  LOG_PATH = path.join(appDir, 'mining-log.jsonl');
  try {
    if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '', 'utf8');
  } catch (e) {
    console.error('[MiningLog] init failed:', e && e.message);
    LOG_PATH = null;
  }
  ANNOT_PATH = path.join(appDir, 'mining-annotations.json');
  try {
    if (fs.existsSync(ANNOT_PATH)) {
      const j = JSON.parse(fs.readFileSync(ANNOT_PATH, 'utf8'));
      if (j && Array.isArray(j.marks)) annotations = j;
    } else {
      // Seeded with the commander's stated ground truth (2026-07-22): the Col 285 DG-S sessions
      // were parked in a Bromellite hotspot; the HIP 52629 A 9 B session explicitly was NOT.
      annotations = { marks: [
        { ring: 'Col 285 Sector DG-S b19-5 1 A Ring', day: null, hotspot: true, material: 'bromellite' },
        { ring: 'HIP 52629 A 9 B Ring', day: null, hotspot: false },
      ] };
      saveAnnotations();
    }
  } catch { /* fresh */ }
  return LOG_PATH;
}

function saveAnnotations() {
  if (!ANNOT_PATH) return;
  try { fs.writeFileSync(ANNOT_PATH, JSON.stringify(annotations, null, 1), 'utf8'); } catch { /* non-fatal */ }
}

/** Mark (or unmark) a ring+day bucket as hotspot-mined. day null = the whole ring. */
export function markHotspot(ring, day, hotspot, material) {
  if (!ring) return annotations.marks;
  annotations.marks = annotations.marks.filter((m) => !(m.ring === ring && (m.day || null) === (day || null)));
  annotations.marks.push({ ring, day: day || null, hotspot: !!hotspot, material: material || null });
  saveAnnotations();
  readCache = null; // annotations join at read time — cached rows are stale now
  return annotations.marks;
}

export function getAnnotations() { return annotations.marks.slice(); }

/** Sidecar marks override; a rock's own live-toggle flag wins only where no mark matches. */
function applyAnnotations(rows) {
  for (const r of rows) {
    // Older rows predate ring-class capture; the index knows every seen ring's class.
    if (!r.ringClass && r.ring) r.ringClass = getRingClassOf(r.ring) || r.ringClass;
  }
  if (!annotations.marks.length) return rows;
  for (const r of rows) {
    for (const m of annotations.marks) {
      if (r.ring !== m.ring) continue;
      if (m.day && !String(r.t || '').startsWith(m.day)) continue;
      r.hotspot = m.hotspot;
      if (m.material) r.hotspotMaterial = m.material;
      else if (!m.hotspot) r.hotspotMaterial = undefined; // "not a hotspot" can't keep a material
    }
  }
  return rows;
}

export function miningLogPath() { return LOG_PATH; }

/** Sorted (name, proportion) tuple — stable identity for one asteroid. */
export function fingerprint(materials) {
  return (Array.isArray(materials) ? materials : [])
    .map((m) => `${String(m.Name || m.n || '').toLowerCase()}:${Number(m.Proportion ?? m.p ?? 0).toFixed(6)}`)
    .sort()
    .join('|');
}

/**
 * Begin (or re-observe) a rock. Returns the live record. A matching fingerprint means the SAME
 * asteroid re-prospected — update it in place rather than opening a second record.
 */
export function beginRock(rec) {
  if (current && current.id === rec.id) {
    current.prospects += 1;
    current.lastT = rec.t;
    if (rec.remaining != null) current.remaining = rec.remaining;
    return current;
  }
  finalizeRock();
  current = Object.assign({ prospects: 1, got: {} }, rec);
  return current;
}

/**
 * Credit a refined tonne to the rock currently being mined.
 *
 * `credits` is the value AT THE MOMENT OF REFINING (mission rate when one is live, else the
 * commander's observed market average). Recording it at refine time rather than computing it later
 * matters: mission rates expire, and a tonne pulled while a 136k/t mission was running really was
 * worth that, even if the mission is gone by the time the log is read.
 */
export function creditRefined(commodityKey, tonnes = 1, credits = 0) {
  if (!current || !commodityKey) return;
  current.got[commodityKey] = (current.got[commodityKey] || 0) + tonnes;
  if (credits > 0) current.gotValue = (current.gotValue || 0) + credits;
}

export function getCurrentRock() { return current; }

export function hasPendingRock() { return !!nextRock; }
export function getPendingRock() { return nextRock; }

/** Park the next rock without switching accounting. Same-id re-prospect updates in place. */
export function stageNextRock(rec) {
  if (nextRock && nextRock.id === rec.id) {
    nextRock.prospects += 1;
    nextRock.lastT = rec.t;
    if (rec.remaining != null) nextRock.remaining = rec.remaining;
    return nextRock;
  }
  nextRock = Object.assign({ prospects: 1, got: {} }, rec);
  return nextRock;
}

/** The drained handoff: the (already finalized) current slot is taken over by the pending rock. */
export function promotePendingRock() {
  if (!nextRock) return null;
  current = nextRock;
  nextRock = null;
  return current;
}

/** Close current AND anything pending (ring exit / jump / session idle) — nothing left open. */
export function finalizeAllRocks() {
  finalizeRock();
  if (nextRock) { current = nextRock; nextRock = null; finalizeRock(); }
}

/** Close the open rock and queue it for append. Safe to call when nothing is open. */
export function finalizeRock() {
  if (!current) return;
  const rec = current;
  current = null;
  rec.gotTotal = Object.values(rec.got).reduce((a, b) => a + b, 0);
  rec.gotValue = rec.gotValue || 0;
  pending.push(rec);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer || !LOG_PATH) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}

export function flushNow() {
  if (!LOG_PATH || pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    fs.appendFileSync(LOG_PATH, batch.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    readCache = null;
  } catch (e) {
    console.error('[MiningLog] append failed:', e && e.message);
  }
}

/**
 * Seed the log from journal history.
 *
 * Without this the log starts empty, so getYieldTable() has no samples and every estimate falls
 * back to the pooled 0.163 bootstrap — which under-calls Bromellite by ~2.7x (its measured ratio is
 * ~0.437), and Bromellite is exactly what this commander is on mission for. Backfilling makes the
 * estimate correct on day one instead of after weeks of mining.
 *
 * Backfilled rows carry backfill:true and NO estValue: prices at the time are unknown, and pricing
 * old rocks with today's market would be inventing a number. They exist for the yield table and the
 * rate history, both of which need only proportions and tonnes.
 *
 * Runs once — guarded on the log already containing backfilled rows.
 */
export function backfillFromJournals(journalDir, listFiles, ringLookup) {
  if (!LOG_PATH) return { skipped: 'no log path' };
  const existing = readRocks();
  if (existing.some((r) => r.backfill)) return { skipped: 'already backfilled', rocks: existing.length };

  let files = [];
  try { files = listFiles(journalDir); } catch { return { skipped: 'no journals' }; }

  const out = [];
  let sys = '', ring = '', ringClass = '', reserve = '';
  let open = null;
  const close = () => {
    if (!open) return;
    open.gotTotal = Object.values(open.got).reduce((a, b) => a + b, 0);
    // A rock that produced nothing teaches the yield table nothing and would bloat the log.
    if (open.gotTotal > 0) out.push(open);
    open = null;
  };

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.fullPath, 'utf8'); } catch { continue; }
    if (!/ProspectedAsteroid|MiningRefined/.test(text)) continue;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      switch (ev.event) {
        case 'FSDJump':
        case 'Location':
          sys = ev.StarSystem || sys;
          if (ev.event === 'FSDJump') { close(); ring = ''; ringClass = ''; reserve = ''; }
          break;
        case 'SupercruiseExit':
          if (ev.BodyType === 'PlanetaryRing') ring = ev.Body || '';
          else { close(); ring = ''; }
          break;
        case 'ProspectedAsteroid': {
          const id = fingerprint(ev.Materials);
          if (open && open.id === id) { open.prospects += 1; open.lastT = ev.timestamp; open.remaining = ev.Remaining; break; }
          close();
          open = {
            id, t: ev.timestamp, lastT: ev.timestamp, sys, ring, ringClass, reserve,
            content: String(ev.Content_Localised || ev.Content || '').replace(/^.*Content_/, '').replace(/;$/, ''),
            remaining: ev.Remaining,
            motherlode: ev.MotherlodeMaterial ? (ev.MotherlodeMaterial_Localised || ev.MotherlodeMaterial) : null,
            mats: (ev.Materials || []).map((m) => ({
              k: normKey(m.Name_Localised || m.Name), n: m.Name_Localised || m.Name, p: m.Proportion || 0, est: null, price: null,
            })),
            estValue: null, got: {}, prospects: 1, backfill: true,
          };
          break;
        }
        case 'MiningRefined':
          if (open) {
            const k = normKey(ev.Type_Localised || ev.Type);
            open.got[k] = (open.got[k] || 0) + 1;
          }
          break;
        default:
          break;
      }
    }
  }
  close();

  // Ring class and reserve live on the parent body's Scan, not on any mining event — take them
  // from the ring index rather than leaving the columns blank.
  if (typeof ringLookup === 'function') {
    for (const r of out) {
      if (!r.ring) continue;
      const info = ringLookup(r.ring);
      if (!info) continue;
      r.ringClass = info.ringClass || '';
      r.reserve = info.reserve || '';
    }
  }

  if (!out.length) return { skipped: 'nothing to backfill' };
  try {
    fs.appendFileSync(LOG_PATH, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    readCache = null;
  } catch (e) {
    return { error: e.message };
  }
  return { backfilled: out.length };
}

// Local copy of the key normalizer — importing miningMissions here would create a cycle.
function normKey(s) {
  const c = String(s || '').toLowerCase().replace(/^\$/, '').replace(/_name;?$/, '').replace(/[\s.]/g, '').trim();
  return c.startsWith('lowtemp') ? 'lowtemperaturediamond' : c.replace(/s$/, '');
}

/** All logged rocks, newest last. Cached against file mtime. */
export function readRocks() {
  if (!LOG_PATH) return [];
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(LOG_PATH).mtimeMs; } catch { return []; }
  if (readCache && readCache.mtimeMs === mtimeMs) return readCache.rows;
  let rows = [];
  try {
    rows = fs.readFileSync(LOG_PATH, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
  readCache = { rows: applyAnnotations(rows), mtimeMs };
  return readCache.rows;
}

/**
 * Per-material tonnes-per-1%-proportion, re-derived from logged outcomes.
 * Only rocks where the material was actually extracted count — a material left in the ground
 * (ignored, or the rock was abandoned) says nothing about how much the rock held.
 * Falls back to the caller's bootstrap for materials with too few samples to trust.
 */
export function getYieldTable(minSamples = 6) {
  const acc = {};
  for (const r of readRocks()) {
    for (const m of r.mats || []) {
      const key = m.k || m.n;
      const got = (r.got || {})[key];
      if (!key || !(m.p > 0) || !(got > 0)) continue;
      const a = acc[key] || (acc[key] = { n: 0, sum: 0 });
      a.n += 1;
      a.sum += got / m.p;
    }
  }
  const table = {};
  for (const [k, a] of Object.entries(acc)) {
    if (a.n >= minSamples) table[k] = { tPerPct: a.sum / a.n, n: a.n };
  }
  return table;
}

/**
 * Extraction rate per system/ring over time — what the user asked for as "extraction rate by
 * systems over time". Buckets logged rocks by ring and by day, reporting measured tonnes/hour.
 * Span is derived from rock timestamps, so idle time between sessions never inflates the rate.
 */
export function getRateHistory() {
  const rows = readRocks().filter((r) => r.t && r.gotTotal > 0);
  const byRing = {};
  for (const r of rows) {
    const ring = r.ring || r.sys || 'unknown';
    const day = String(r.t).slice(0, 10);
    const key = `${ring}|${day}`;
    const b = byRing[key] || (byRing[key] = {
      ring, sys: r.sys || '', ringClass: r.ringClass || '', reserve: r.reserve || '',
      day, tonnes: 0, rocks: 0, value: 0, credits: 0, first: r.t, last: r.t,
    });
    b.tonnes += r.gotTotal;
    b.rocks += 1;
    b.value += r.estValue || 0;
    b.credits += r.gotValue || 0;
    if (r.hotspot) b.hotspotRocks = (b.hotspotRocks || 0) + 1;
    if (r.t < b.first) b.first = r.t;
    if (r.t > b.last) b.last = r.t;
  }
  return Object.values(byRing).map((b) => {
    const hrs = (Date.parse(b.last) - Date.parse(b.first)) / 3600000;
    return Object.assign(b, {
      hours: hrs,
      tonnesPerHour: hrs > 0.02 ? b.tonnes / hrs : null,
      hotspotPct: b.rocks ? Math.round(100 * (b.hotspotRocks || 0) / b.rocks) : 0,
    });
  }).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * Rock-value percentiles per ring, from the logged rock population valued by `valueFn`.
 *
 * This exists to kill the last invented constant in the feature. "Worth it" was a hardcoded 60,000
 * Cr, which measurement showed to be meaningless: median rock value across this commander's rings
 * spans 24x — HIP 43296 5 A Ring sits at ~402k while HIP 52629 A 9 B Ring sits at ~17k. One global
 * line would mark every rock in the first ring worth mining and every rock in the second a skip,
 * carrying no information in either. A percentile of the ring's OWN population adapts automatically
 * and means "better than most rocks here", which is the actual decision being made.
 *
 * Cached against log mtime; the valuation depends on live prices so the cache is short-lived.
 */
const VALUE_STATS_TTL = 60_000;
let valueStatsCache = null;

export function getRingValueStats(valueFn, minSamples = 12) {
  if (valueStatsCache && Date.now() - valueStatsCache.at < VALUE_STATS_TTL) return valueStatsCache.stats;

  const byRing = {};
  const all = [];
  for (const r of readRocks()) {
    const v = valueFn(r);
    if (!(v > 0)) continue;
    all.push(v);
    const k = r.ring || '(none)';
    (byRing[k] = byRing[k] || []).push(v);
  }
  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };
  const stats = { rings: {}, global: null };
  for (const [ring, arr] of Object.entries(byRing)) {
    if (arr.length < minSamples) continue;
    stats.rings[ring] = { n: arr.length, p25: pct(arr, 0.25), median: pct(arr, 0.5), p75: pct(arr, 0.75) };
  }
  if (all.length >= minSamples) {
    stats.global = { n: all.length, p25: pct(all, 0.25), median: pct(all, 0.5), p75: pct(all, 0.75) };
  }
  valueStatsCache = { stats, at: Date.now() };
  return stats;
}

/**
 * All-time rock values, descending — the basis for "new best rock" and "Nth best ever".
 *
 * Records are worth having precisely because the log is uncapped: 346 rocks and counting means a
 * personal best is a real bar rather than a session artefact. Cached briefly since the valuation
 * depends on live prices.
 */
const RECORDS_TTL = 60_000;
let recordsCache = null;

export function getRockRecords(valueFn) {
  if (recordsCache && Date.now() - recordsCache.at < RECORDS_TTL) return recordsCache.data;
  const values = [];
  for (const r of readRocks()) {
    if (!r.gotTotal) continue;
    const v = valueFn(r);
    if (v > 0) values.push(v);
  }
  values.sort((a, b) => b - a);
  const data = {
    best: values[0] || 0,
    top10: values.slice(0, 10),
    count: values.length,
    /** 1-based all-time rank a value would take, or null if outside the top 10. */
    rankOf(v) {
      if (!(v > 0)) return null;
      const idx = values.findIndex((x) => v > x);
      if (idx === -1 || idx >= 10) return null;
      return idx + 1;
    },
  };
  recordsCache = { data, at: Date.now() };
  return data;
}

/** Drop the records cache so a brand-new best is reflected immediately. */
export function invalidateRecords() { recordsCache = null; catchCache = null; }

/**
 * Distribution of every mined rock by BOTH credits and tonnage, for the catch card.
 *
 * Two dimensions because they're different achievements: a 25t rock of cheap ore and an 11t rock of
 * Low Temperature Diamonds are both worth showing off, for opposite reasons. The card tiers on
 * whichever percentile is higher and says which one earned it.
 *
 * Returns a coarse histogram alongside the raw percentile so the client can draw the "measuring
 * board" — seeing the catch sit out on the tail is what makes it read as a whopper rather than
 * just a number.
 */
const CATCH_TTL = 60_000;
let catchCache = null;
const HIST_BUCKETS = 24;

const normRingClass = (c) => {
  const x = String(c || '').replace(/^eRingClass_/, '');
  return x === 'Metalic' ? 'Metallic' : x;
};

/**
 * Population stats, optionally restricted to one ring class ("Icy"/"Metallic"/...). The class
 * filter exists because icy asteroids measure ~2x the content of metallic ones in this log — a
 * pooled backdrop made every icy prospect look far-right regardless of merit. Falls back to the
 * pooled population (flagged in the result) when the class has under 12 rocks.
 */
export function getCatchStats(valueFn, ringClass) {
  const clsKey = ringClass ? normRingClass(ringClass) : 'all';
  if (catchCache && Date.now() - catchCache.at < CATCH_TTL && catchCache.byClass[clsKey]) {
    return catchCache.byClass[clsKey];
  }
  if (!catchCache || Date.now() - catchCache.at >= CATCH_TTL) catchCache = { at: Date.now(), byClass: {} };

  const values = [];
  const tonnes = [];
  for (const r of readRocks()) {
    if (!r.gotTotal) continue;
    if (clsKey !== 'all' && normRingClass(r.ringClass) !== clsKey) continue;
    const v = valueFn(r);
    if (v > 0) values.push(v);
    tonnes.push(r.gotTotal);
  }
  if (clsKey !== 'all' && values.length < 12) {
    const pooled = getCatchStats(valueFn); // fall back, but say so
    const out = Object.assign({}, pooled, { classApplied: 'all', classRequested: clsKey });
    catchCache.byClass[clsKey] = out;
    return out;
  }
  values.sort((a, b) => a - b);
  tonnes.sort((a, b) => a - b);

  // Log-scaled buckets: rock values span ~1k to ~4M, so linear buckets would pile everything into
  // the first two and flatten the shape the card is meant to show.
  const hist = (arr) => {
    if (!arr.length) return { buckets: [], min: 0, max: 0 };
    const min = Math.max(1, arr[0]);
    const max = Math.max(min + 1, arr[arr.length - 1]);
    const lo = Math.log(min), hi = Math.log(max);
    const buckets = new Array(HIST_BUCKETS).fill(0);
    for (const v of arr) {
      const i = Math.min(HIST_BUCKETS - 1, Math.floor(((Math.log(Math.max(1, v)) - lo) / (hi - lo)) * HIST_BUCKETS));
      buckets[i] += 1;
    }
    return { buckets, min, max };
  };

  const pctOf = (arr) => (x) => {
    if (!arr.length || !(x > 0)) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
    return lo / arr.length;
  };

  const data = {
    count: values.length,
    classApplied: clsKey,
    value: { hist: hist(values), best: values[values.length - 1] || 0, pct: pctOf(values) },
    tonnes: { hist: hist(tonnes), best: tonnes[tonnes.length - 1] || 0, pct: pctOf(tonnes) },
  };
  catchCache.byClass[clsKey] = data;
  return data;
}

/**
 * Lifetime totals per location — credits, tonnes and rocks, rolled up by ring and by system.
 *
 * `credits` counts only tonnes refined while the tracker was watching, because that is when a real
 * price (mission or market) was observable. Rocks seeded from journal history contribute tonnes but
 * no credits: pricing two-year-old tonnage at today's market would be inventing a number. The UI
 * reports both so the difference is visible rather than hidden in an average.
 */
export function getLocationTotals(priceFn, rockValueFn) {
  const rings = {};
  const systems = {};
  // Retrospective valuation of tonnage that predates credit tracking. Kept in its own field and
  // labelled "at today's prices" in the UI — it is emphatically NOT what was earned at the time.
  const valueNow = (got) => {
    if (typeof priceFn !== 'function') return 0;
    let v = 0;
    for (const [k, t] of Object.entries(got || {})) v += (priceFn(k) || 0) * t;
    return v;
  };

  // "Worth mining" = a rock at or above its ring's own median. Reported as a percentage so the page
  // can distinguish two rings with identical tonnes/hour where one gives a good rock half the time
  // and the other one in six.
  //
  // Deliberately uses `rockValueFn` — the SAME estimated-from-proportions valuation the overlay
  // judges a live rock with — not the refined-tonnage value used for the credit columns. Otherwise
  // "worth it 40%" on this page would be measuring something different from the overlay's
  // worth-it/skip call on an identical rock, and the two would visibly disagree.
  // Reference is the GLOBAL median rock across every ring, not each ring's own median. Comparing a
  // ring against itself is a tautology — it returns ~50% for every ring by construction, which is
  // exactly what the first version of this did and why it told you nothing. Against a shared
  // yardstick, a rich ring reads well above 50% and a poor one well below, which is the comparison
  // worth having when choosing where to fly.
  const valueForRank = typeof rockValueFn === 'function' ? rockValueFn : (r) => valueNow(r.got);
  const allRocks = readRocks().filter((r) => r.gotTotal);
  const allValues = [];
  const ringValues = {};
  for (const r of allRocks) {
    const v = valueForRank(r);
    if (!(v > 0)) continue;
    allValues.push(v);
    (ringValues[r.ring || '(no ring)'] = ringValues[r.ring || '(no ring)'] || []).push(v);
  }
  const globalMedian = allValues.length >= 12
    ? allValues.slice().sort((a, b) => a - b)[Math.floor(allValues.length / 2)]
    : null;
  const medians = {};
  for (const k of Object.keys(ringValues)) {
    if (ringValues[k].length >= 6 && globalMedian != null) medians[k] = globalMedian;
  }

  for (const r of allRocks) {
    const ringKey = r.ring || '(no ring)';
    const sysKey = r.sys || '(unknown)';
    const ring = rings[ringKey] || (rings[ringKey] = {
      name: ringKey, sys: sysKey, ringClass: r.ringClass || '', reserve: r.reserve || '',
      credits: 0, valueToday: 0, tonnes: 0, rocks: 0, worthRocks: 0, first: r.t, last: r.t,
    });
    const sys = systems[sysKey] || (systems[sysKey] = {
      name: sysKey, credits: 0, valueToday: 0, tonnes: 0, rocks: 0, rings: new Set(),
    });

    const today = valueNow(r.got);
    ring.credits += r.gotValue || 0;
    ring.valueToday += today;
    ring.tonnes += r.gotTotal;
    ring.rocks += 1;
    if (medians[ringKey] != null && valueForRank(r) >= medians[ringKey]) ring.worthRocks += 1;
    if (r.t < ring.first) ring.first = r.t;
    if (r.t > ring.last) ring.last = r.t;

    sys.credits += r.gotValue || 0;
    sys.valueToday += today;
    sys.tonnes += r.gotTotal;
    sys.rocks += 1;
    sys.rings.add(ringKey);
  }
  const rank = (a, b) => (b.credits || b.valueToday) - (a.credits || a.valueToday) || b.tonnes - a.tonnes;
  return {
    rings: Object.values(rings).map((r) => ({
      ...r,
      valueToday: Math.round(r.valueToday),
      avgPerRock: r.rocks ? Math.round(r.valueToday / r.rocks) : 0,
      worthPct: medians[r.name] != null && r.rocks ? Math.round((r.worthRocks / r.rocks) * 100) : null,
    })).sort(rank),
    systems: Object.values(systems)
      .map((s) => ({ ...s, valueToday: Math.round(s.valueToday), rings: s.rings.size }))
      .sort(rank),
  };
}

/**
 * Measured tonnes/hour for one commodity. Null when unmeasured.
 *
 * Rate is computed PER SESSION and then median-aggregated, not as total-tonnes over
 * first-to-last-timestamp. The naive span version reported Osmium at 0.0 t/hr over 28,826 hours
 * because samples existed in both Nov 2024 and today, so the "span" was 623 days of mostly not
 * mining. Sessions are split on gaps longer than SESSION_GAP_MS, and the median session rate is
 * used so one short unrepresentative burst can't dominate.
 */
const SESSION_GAP_MS = 15 * 60_000;

export function measuredRateFor(commodityKey) {
  const rows = readRocks()
    .filter((r) => r.t && (r.got || {})[commodityKey] > 0)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (rows.length < 3) return null;

  const sessions = [];
  let cur = null;
  for (const r of rows) {
    const ts = Date.parse(r.t);
    if (!cur || ts - cur.last > SESSION_GAP_MS) {
      cur = { first: ts, last: ts, tonnes: 0, rocks: 0 };
      sessions.push(cur);
    }
    cur.last = ts;
    cur.tonnes += r.got[commodityKey];
    cur.rocks += 1;
  }

  const rates = sessions
    .map((s) => ({ ...s, hours: (s.last - s.first) / 3600000 }))
    .filter((s) => s.hours > 0.05 && s.tonnes > 0)
    .map((s) => ({ rate: s.tonnes / s.hours, tonnes: s.tonnes, hours: s.hours }));
  if (!rates.length) return null;

  const sorted = rates.map((r) => r.rate).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const tonnes = rates.reduce((a, r) => a + r.tonnes, 0);
  const hours = rates.reduce((a, r) => a + r.hours, 0);
  return { tonnes, hours, tonnesPerHour: median, rocks: rows.length, sessions: rates.length };
}
