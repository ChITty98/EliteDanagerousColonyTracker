// server/journal/mining.js
//
// Mining assist overlay. Answers what the game HUD doesn't, using only measured data:
//
//   1. IS THIS ROCK WORTH IT?  Not a material list (the HUD shows that) — an expected CREDIT TOTAL.
//      Proportion → tonnes via a per-material yield table, tonnes → credits via mission rate where
//      one is live, else the commander's own observed market average. Ignored materials are shown
//      but excluded from the total, so a low number is explained rather than mysterious.
//
//   2. IS THIS ROCK ONE I'M HUNTING?  Target hits alert regardless of value — a mission commodity
//      matters even when it prices low.
//
//   3. HAS COLLECTION STOPPED?  Reported only when a rock that WAS delivering goes quiet, and
//      stated as facts (elapsed silence, limpets, last collector launch) — never as a named cause.
//      Attributing causes from Status.json flags was tried and removed; see stallFacts().
//
//   4. AM I ABOUT TO RUN OUT OF HOLD?  On EFFECTIVE ore space, not raw free space.
//
// CALIBRATION (measured from this commander's 625 prospects / 1,967 refined tonnes on 2026-07-21):
//   • Pooled yield 0.163 t per 1% proportion (n=322, r=0.56) — the bootstrap below.
//   • Content level does NOT modulate yield: Low 0.216 / Medium 0.213 / High 0.211. No multiplier.
//   • Per-material variance dwarfs ring-class variance (Bromellite ~0.437 vs pooled 0.163), which is
//     why getYieldTable() overrides the constant per material as the log accumulates.
//   • Gap between refined tonnes: median 11s, p75 22s, p90 58s (68s in a later session, max 352s).
//     The original STALL_MS of 12s fired below the MEDIAN; 60s still caught 15% of normal gaps.
//     Hence 90s, plus the requirement that the rock was already producing.

import fs from 'node:fs';
import path from 'node:path';
import { commodityKey, missionRateFor, missionTargetKeys, ingestMissionEvent } from './miningMissions.js';
import {
  beginRock, creditRefined, finalizeRock, fingerprint, getYieldTable, getCurrentRock, getRingValueStats,
  getRockRecords, invalidateRecords, getCatchStats, readRocks,
  stageNextRock, hasPendingRock, promotePendingRock, finalizeAllRocks,
} from './miningLog.js';
import { ingestRingEvent, getRingInfo, getUnmappedRings, getMaterialCatalog } from './miningIndex.js';
import { getNavLock, ringHotspotFromNavLock } from './navLock.js';
import { pushMiningBeat } from '../ai/copilotMining.js';
import { recordStreakRock, getStreak, computeAggregates, evaluateBadges } from './miningTrophies.js';
import { getLivePrice, refreshLivePrices } from './livePrices.js';

const X_LEFT = 40;
const Y_TARGET = 296;
const Y_PROSPECT = 320;
const Y_STALL = 348;
const Y_CARGO = 376;
const Y_REFINED = 404;

// Status.json Flags bits (verified against the decoding already in copilotStatus.js).
const F_DOCKED = 1 << 0;
const F_LANDED = 1 << 1;
const F_SUPERCRUISE = 1 << 4;
const F_HARDPOINTS = 1 << 6;   // lasers out. Ambiguous in general (honk/combat), unambiguous in a ring.
const F_SCOOP = 1 << 9;
const F_OVERHEAT = 1 << 20;
const F_DANGER = 1 << 22;

const YIELD_BOOTSTRAP = 0.163;   // t per 1% proportion, pooled across 322 samples
const MIN_EST_TONNES = 1;
const WORTH_MIN_PROP = 3;        // below this a material is a trace, not a reason to fire lasers
// Fallback only — used until the log holds enough rocks to derive a threshold from the ring itself.
// A fixed line is provably wrong as a general rule: measured median rock value spans 24x across
// this commander's rings (402k in HIP 43296 5 A Ring vs 17k in HIP 52629 A 9 B Ring).
const WORTH_CR_FALLBACK = 60_000;
const COLD_WINDOW = 10;          // rocks in the rolling window used for the going-cold check
const COLD_RATIO = 0.5;          // recent median below this fraction of the ring baseline
const COLD_COOLDOWN_MS = 5 * 60_000;
// Session milestone step. Was 50M, which could never fire — this commander's best DAY on record is
// 27.9M, so the trophy was dead code. 5M lands a handful of times in a good session.
const MILESTONE_CR = 5_000_000;
// 15% of this commander's inter-tonne gaps exceeded 60s in a single measured session (p90 = 68s,
// max 352s), so 60s sat inside the normal range and fired during ordinary mining.
const STALL_MS = 90_000;
const SLOW_WINDOW_MS = 90_000;
const SLOW_DROP = 0.4;           // recent rate below 40% of the rock's early rate
const STALL_COOLDOWN_MS = 45_000;
const CARGO_COOLDOWN_MS = 60_000;
const COLLECTOR_QUIET_MS = 90_000;
const PRICE_CACHE_MS = 60_000;
const MINING_WINDOW_MS = 120_000;
// Deferred-switch timing: a 30s refine gap means the previous rock's pipeline is drained (median
// inter-tonne gap 11s, p75 22s), so the pending rock takes over accounting there; the hard cap
// forces the boundary when two rocks' streams genuinely overlap without a pause.
const DRAIN_GAP_MS = 30_000;
const PENDING_HARD_CAP_MS = 120_000;

// Ephemeral session state.
let lastMiningActivityAt = 0;
let lastCargoTotal = null;
let lastRefineAt = 0;
let lastCollectorLaunchAt = 0;
let lastStallAlertAt = 0;
let lastCargoAlertAt = 0;
let refineTimes = [];            // timestamps of recent refined tonnes, for rate collapse detection
let rockStartedAt = 0;
let currentRing = null;          // { name, ringClass, reserve }
let currentSystem = '';
let priceMap = null;
let priceMapAt = 0;
let cargoWarnLevel = 0;          // 0 none, 1 warned, 2 full
let sessionStartedAt = 0;        // first refine of the current session — the live-rate gauge's clock
let sessionCredits = 0;          // credits refined since the current mining session began
let sessionTonnes = 0;
let rockCredits = 0;             // credits refined off the rock currently under the lasers
let lastMilestone = 0;           // highest session milestone already celebrated
let recentRockValues = [];       // rolling window of prospected rock values, for going-cold
let lastColdAlertAt = 0;
let lastRingNudgedFor = null;    // ring already nudged about missing hotspot data
let unmappedNudgedSystems = new Set(); // colony systems already nudged about DSS gaps this run
// Commander-declared "I'm parked in a hotspot" — journal has no in-ring position, so this is the
// only source of truth. Stamped onto every rock logged while on; positional, so it clears on any
// ring change or jump rather than silently mislabeling the next site.
let inHotspot = false;
// WHICH hotspot, when the nav lock told us (e.g. 'tritium'). Null when the commander toggled the
// flag by hand without one, which stays valid — they know where they are parked.
let hotspotMaterial = null;
let pendingStagedAt = 0;         // when the deferred-switch slot was filled

export function setInHotspot(v) {
  inHotspot = !!v;
  if (!inHotspot) hotspotMaterial = null; // "not in a hotspot" can't carry a material
  return inHotspot;
}

/**
 * Freeze the nav-locked hotspot for this ring visit.
 *
 * FROZEN AT RING ENTRY, not at first rock: on arrival the lock is still exactly what was flown to.
 * By the time a rock is prospected the commander may have re-locked the carrier to go unload, and
 * that would attribute the whole patch to the wrong place.
 *
 * Fills a gap only. It runs right after inHotspot resets to false on a ring change, so a later
 * manual setInHotspot() naturally wins, and the read-time sidecar marks in miningLog override both.
 */
function freezeNavLockHotspot(systemAddress) {
  const hs = ringHotspotFromNavLock(getNavLock(), systemAddress);
  if (!hs) return; // not locked onto a hotspot ⇒ not in one. The commander's rule.
  inHotspot = true;
  hotspotMaterial = hs.material;
}

const now = () => Date.now();
const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now() - t < 120_000; };
const fmtCr = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const markActive = () => { lastMiningActivityAt = now(); };

/**
 * Push a line to the in-game overlay and, when it carries enough signal to be worth interrupting
 * for, to the SSE bus so the in-app card pops on whatever tab is open.
 *
 * Refined tonnes ARE broadcast every time — they feed the browser mining ticker, which is a
 * persistent HUD element rather than an auto-dismissing card, so a tonne every ~11s is exactly what
 * it wants. `mining_refined` is deliberately NOT in the popup's headline list; routing it there was
 * the earlier mistake, since a 20s card versus an 11s event leaves a card permanently on screen.
 */
function emit(deps, overlay, sse) {
  if (deps && deps.sendOverlay && overlay) deps.sendOverlay(overlay);
  if (sse && deps && typeof deps.broadcastEvent === 'function') {
    try {
      deps.broadcastEvent(Object.assign({ timestamp: new Date().toISOString() }, sse));
    } catch { /* SSE is best-effort; never break the overlay path */ }
  }
}

// The journal is inconsistent about material casing — some events supply Name_Localised ("Bromellite")
// and some only a raw Name ("tritium", "water", "silver", "gold"). Title-case the all-lowercase ones
// so the overlay doesn't read half-shouted.
const displayName = (s) => {
  const t = String(s || '').trim();
  return t && t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t;
};

/**
 * Average sell price per commodity from the commander's own market visits. AVERAGE, not max —
 * a single best market is a spike (Osmium reads 273k at one station, 62k averaged) and prices
 * fluctuate, so the mean over everywhere seen is the honest number.
 */
function getPriceMap(state) {
  if (priceMap && now() - priceMapAt < PRICE_CACHE_MS) return priceMap;
  const acc = {};
  for (const s of Object.values((state && state.marketSnapshots) || {})) {
    for (const c of (s.commodities || [])) {
      if (!c || !(c.sellPrice > 0)) continue;
      const id = commodityKey(c.commodityId || c.name);
      const a = acc[id] || (acc[id] = { sum: 0, n: 0 });
      a.sum += c.sellPrice; a.n += 1;
    }
  }
  const map = {};
  for (const [id, a] of Object.entries(acc)) map[id] = { p: Math.round(a.sum / a.n), n: a.n };
  priceMap = map; priceMapAt = now();
  return map;
}

/**
 * Value ladder: mission rate → live galaxy best (non-FC, real demand, via Ardent) → the average of
 * visited markets as the offline fallback. The live tier exists because the commander's selling
 * rule is "highest non-FC payout, wherever it is" — visited-average Bromellite read 36k while the
 * galaxy top-of-book sat at 116,750 (and LTD 144k vs 384,562), a 3x mispricing of every verdict.
 */
function valueOf(key, prices) {
  const mission = missionRateFor(key);
  if (mission) return { cr: mission.crPerTonne, source: 'mission', label: mission.label };
  const live = getLivePrice(key);
  if (live) return { cr: live.cr, source: 'live', station: live.station, system: live.system };
  const m = prices[key];
  return m ? { cr: m.p, source: 'market' } : null;
}

/** Per-material tonnes-per-1%, measured where the log has enough samples, bootstrap otherwise. */
function yieldFor(key, table) {
  const t = table[key];
  return t ? { tPerPct: t.tPerPct, measured: true, n: t.n } : { tPerPct: YIELD_BOOTSTRAP, measured: false };
}

function ignoredSet(state) {
  return new Set(((state && state.miningIgnored) || []).map(commodityKey));
}

/** Value a LOGGED rock at today's prices — the common basis for the per-ring threshold. */
function valueLoggedRock(rec, state, table, ignored) {
  const prices = getPriceMap(state);
  let total = 0;
  for (const m of rec.mats || []) {
    if (!(m.p >= WORTH_MIN_PROP) || ignored.has(m.k)) continue;
    const y = yieldFor(m.k, table);
    const est = Math.max(MIN_EST_TONNES, Math.round(m.p * y.tPerPct));
    const v = valueOf(m.k, prices);
    if (v) total += est * v.cr;
  }
  return total;
}

/**
 * "Worth it" line for the ring you're in — the median rock of that ring's own logged population.
 * Falls back to the galaxy-wide median of your log, then to a fixed constant only when there is no
 * history at all. Returns the basis too, so the overlay can say where the number came from rather
 * than presenting it as an oracle.
 */
function worthThreshold(ringName, state, table, ignored) {
  const stats = getRingValueStats((rec) => valueLoggedRock(rec, state, table, ignored));
  const ring = ringName ? stats.rings[ringName] : null;
  if (ring) return { cr: ring.median, strong: ring.p75, basis: 'ring', n: ring.n };
  if (stats.global) return { cr: stats.global.median, strong: stats.global.p75, basis: 'your log', n: stats.global.n };
  return { cr: WORTH_CR_FALLBACK, strong: WORTH_CR_FALLBACK * 2, basis: 'default', n: 0 };
}

/** User-chosen targets plus anything a live mission demands. */
function targetSet(state) {
  const s = new Set(((state && state.miningTargets) || []).map(commodityKey));
  for (const k of missionTargetKeys()) s.add(k);
  return s;
}

/** Event-driven half. Called per journal tick. */
export function processMiningEvents(parsed, state, deps) {
  const events = (parsed && parsed.allEvents) || [];
  for (const ev of events) {
    if (!ev) continue;
    // Index/mission ingestion is cheap and must run regardless of overlay availability or recency.
    ingestMissionEvent(ev);
    ingestRingEvent(ev);

    if (ev.event === 'SupercruiseExit') {
      if (ev.BodyType === 'PlanetaryRing') {
        const info = getRingInfo(ev.Body);
        const changedRing = !currentRing || currentRing.name !== ev.Body;
        if (changedRing) { inHotspot = false; hotspotMaterial = null; } // hotspot is positional
        currentRing = { name: ev.Body, ringClass: (info && info.ringClass) || '', reserve: (info && info.reserve) || '' };
        recentRockValues = [];   // new ring, new baseline — don't carry the last patch's window over
        if (changedRing) freezeNavLockHotspot(ev.SystemAddress);
        ringEntryNudge(ev.Body, info, deps);
      } else {
        finalizeAllRocks();
        currentRing = null;
        inHotspot = false;
        hotspotMaterial = null;
      }
    } else if (ev.event === 'FSDJump' || ev.event === 'Location') {
      currentSystem = ev.StarSystem || currentSystem;
      if (ev.event === 'FSDJump') { finalizeAllRocks(); currentRing = null; inHotspot = false; hotspotMaterial = null; }
      // Logging in INSIDE a ring writes no SupercruiseExit — but Location carries the body
      // (verified: Body "HIP 52629 A 9 B Ring", BodyType "PlanetaryRing" at login). Without this,
      // a whole session's rocks land ring-less and hotspot marks have nothing to key on.
      if (ev.event === 'Location' && ev.BodyType === 'PlanetaryRing' && ev.Body) {
        const info = getRingInfo(ev.Body);
        currentRing = { name: ev.Body, ringClass: (info && info.ringClass) || '', reserve: (info && info.reserve) || '' };
        freezeNavLockHotspot(ev.SystemAddress); // logging in inside a ring still deserves attribution
      }
      if (isRecent(ev.timestamp)) maybeNudgeUnmappedRings(state, deps);
    }

    if (!deps || !deps.sendOverlay || !isRecent(ev.timestamp)) continue;

    switch (ev.event) {
      case 'MiningRefined': {
        markActive();
        // Deferred switch decides BEFORE the clock resets — measuring the quiet gap after
        // lastRefineAt is overwritten always reads zero and the handoff never fires.
        if (hasPendingRock()) {
          const quiet = lastRefineAt ? now() - lastRefineAt : Infinity;
          if (quiet >= DRAIN_GAP_MS || (pendingStagedAt && now() - pendingStagedAt >= PENDING_HARD_CAP_MS)) {
            promoteWithFanfare(state, deps);
          }
        }
        lastRefineAt = now();
        refineTimes.push(now());
        if (refineTimes.length > 120) refineTimes = refineTimes.slice(-120);
        refinedHelper(ev, state, deps);
        break;
      }
      case 'LaunchDrone':
        markActive();
        if (ev.Type === 'Collection') lastCollectorLaunchAt = now();
        break;
      case 'BuyDrones':
        markActive();
        break;
      case 'Cargo':
        if (typeof ev.Count === 'number') lastCargoTotal = ev.Count;
        break;
      case 'ProspectedAsteroid':
        markActive();
        prospectHelper(ev, state, deps);
        break;
      default:
        break;
    }
  }
}

/** "My systems" = every project's system plus the manually-marked colonies — the same definition
 *  the Sources page uses. Lowercased for joining. */
export function colonySystemsOf(state) {
  const s = new Set();
  for (const p of (state && state.projects) || []) {
    const n = p && (p.systemName || p.system);
    if (n) s.add(String(n).toLowerCase());
  }
  for (const n of (state && state.manualColonizedSystems) || []) s.add(String(n).toLowerCase());
  return s;
}

/**
 * Arrival nudge: entering one of YOUR systems that has rings you've seen but never DSS-mapped.
 * Measured 2026-07-22: 63 such rings across the commander's 28 colony systems — almost all
 * Pristine, including 5 in the active build system. Fires once per system per server run, on
 * arrival only, so it prompts without nagging. Scoped to colony systems deliberately: an alert on
 * every jump anywhere would fire constantly (496 unmapped rings galaxy-wide) and train the
 * commander to ignore it.
 */
function maybeNudgeUnmappedRings(state, deps) {
  if (!currentSystem) return;
  const key = currentSystem.toLowerCase();
  if (unmappedNudgedSystems.has(key)) return;
  if (!colonySystemsOf(state).has(key)) return;
  const rows = getUnmappedRings(new Set([key]));
  if (!rows.length) return;
  unmappedNudgedSystems.add(key);

  // "HIP 52629 A 9 B Ring" → "A 9 B" for the in-system shortlist.
  const short = rows.map((r) => (r.name.startsWith(currentSystem)
    ? r.name.slice(currentSystem.length).replace(/\s*Ring$/i, '').trim()
    : r.name));
  emit(deps, {
    id: 'edcolony_mining_unmapped',
    text: `🔭 ${rows.length} ring${rows.length === 1 ? '' : 's'} here need a DSS scan — ${short.slice(0, 4).join(', ')}${rows.length > 4 ? '…' : ''}`,
    color: '#a78bfa', x: X_LEFT, y: Y_PROSPECT - 28, ttl: 12,
  }, { type: 'mining_unmapped', system: currentSystem, count: rows.length, rings: short });
}

/**
 * On dropping into a ring: report its hotspots, or point out that it has none recorded.
 *
 * The unmapped case is the useful one. HIP 52629 A 9 B Ring — where 250t was mined — has no
 * SAASignalsFound record, so the tracker cannot tell what it concentrates and neither the ring
 * finder nor the value baseline can account for it. A DSS pass fixes that permanently.
 */
function ringEntryNudge(ringName, info, deps) {
  if (!deps || !deps.sendOverlay || lastRingNudgedFor === ringName) return;
  lastRingNudgedFor = ringName;

  const signals = info && info.signals ? Object.values(info.signals) : [];
  if (signals.length) {
    const list = signals
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((s) => `${s.label}${s.count > 1 ? ` ×${s.count}` : ''}`)
      .join(' · ');
    emit(deps, {
      id: 'edcolony_mining_ring', text: `💠 ${list}`, color: '#a78bfa',
      x: X_LEFT, y: Y_PROSPECT - 28, ttl: 10,
    }, { type: 'mining_ring', ring: ringName, summary: list, mapped: true });
    if (info && info.reserve === 'Pristine') pushMiningBeat('ring-entry', { ring: ringName });
  } else {
    emit(deps, {
      id: 'edcolony_mining_ring', text: '💠 No hotspot data for this ring — map it with the DSS',
      color: '#a78bfa', x: X_LEFT, y: Y_PROSPECT - 28, ttl: 10,
    }, { type: 'mining_ring', ring: ringName, summary: 'No hotspot data — map it with the DSS', mapped: false });
  }
}

/**
 * Going-cold check: are the rocks in this patch worse than this ring's norm?
 *
 * Answers the original question — "am I moving effectively through the area" — as far as the data
 * honestly allows. ProspectedAsteroid carries no coordinates, so there is no way to know WHERE in
 * the ring you are or whether you're circling. What is knowable is whether the rocks you're finding
 * right now are materially poorer than what this ring has historically given you, which is the
 * actionable half: relocate. Phrased as a suggestion, never as "the ring is depleted".
 */
function trackPatchQuality(rockValue, bar, deps) {
  recentRockValues.push(rockValue);
  if (recentRockValues.length > COLD_WINDOW) recentRockValues = recentRockValues.slice(-COLD_WINDOW);
  if (recentRockValues.length < COLD_WINDOW) return;
  if (bar.basis === 'default' || !(bar.cr > 0)) return;      // no baseline worth comparing against
  if (now() - lastColdAlertAt < COLD_COOLDOWN_MS) return;

  const sorted = recentRockValues.slice().sort((a, b) => a - b);
  const recentMedian = sorted[Math.floor(sorted.length / 2)];
  if (recentMedian >= bar.cr * COLD_RATIO) return;

  lastColdAlertAt = now();
  emit(deps, {
    id: 'edcolony_mining_cold',
    text: `❄ Last ${COLD_WINDOW} rocks median ~${fmtCr(recentMedian)} vs ~${fmtCr(bar.cr)} for this ring — try moving`,
    color: '#93c5fd', x: X_LEFT, y: Y_PROSPECT - 28, ttl: 10,
  }, { type: 'mining_cold', recentMedian, baseline: bar.cr, window: COLD_WINDOW });
}

/**
 * Rotating copy per value tier. The same sentence every 11 seconds stops registering — variety is
 * the only lever the EDMC overlay has, since it renders text and colour and nothing else.
 * Indexed by tonne count rather than randomly so it cycles predictably instead of repeating.
 */
const TIER_LINES = {
  huge: ['MASSIVE', 'that one hurt the hold', 'enormous', 'beautiful rock'],
  big: ['nice', 'good pull', 'tidy', 'that will do'],
  mid: ['solid', 'steady', 'banked', 'in the hold'],
  low: ['', '', '', ''],
};
function flavour(credits, n) {
  const tier = credits >= 150_000 ? 'huge' : credits >= 60_000 ? 'big' : credits >= 20_000 ? 'mid' : 'low';
  const line = TIER_LINES[tier][n % TIER_LINES[tier].length];
  return line ? ` — ${line}` : '';
}

/**
 * The drained handoff. Rock A gets its catch card WITH its trailing tonnes included, then the
 * pending rock takes over the accounting from zero.
 */
function promoteWithFanfare(state, deps) {
  if (!hasPendingRock()) return;
  closeRockWithFanfare(state, deps);   // finalizes A (streak, badges, catch card)
  promotePendingRock();                // B becomes the earning rock
  pendingStagedAt = 0;
  rockCredits = 0;
  refineTimes = [];
  rockStartedAt = now();
}

/**
 * Tier by percentile. Named like a fishing catch because that's the feeling being built — the point
 * is "wow, that was a whopper", not a P&L line.
 *
 * A card fires on EVERY rock that produced tonnes, not just standouts: choosing to spend time
 * lasering a rock is itself the filter, so by the time one is finished it was already worth the
 * commander's attention. Prospected-and-skipped rocks never reach here.
 */
function catchTier(pct) {
  if (pct >= 0.99) return { key: 'monster', label: 'MONSTER', icon: '🔥', color: '#f97316' };
  if (pct >= 0.95) return { key: 'whopper', label: 'WHOPPER', icon: '💎', color: '#22d3ee' };
  if (pct >= 0.90) return { key: 'trophy', label: 'TROPHY', icon: '✨', color: '#a78bfa' };
  if (pct >= 0.50) return { key: 'good', label: 'GOOD ONE', icon: '⛏', color: '#4ade80' };
  return { key: 'catch', label: 'IN THE HOLD', icon: '✔', color: '#86efac' };
}

/**
 * Close out the rock we were on and present it. Called when a new rock is prospected, i.e. when the
 * previous one is genuinely landed.
 */
function closeRockWithFanfare(state, deps) {
  const rock = getCurrentRock();
  const tonnes = rock ? Object.values(rock.got || {}).reduce((a, b) => a + b, 0) : 0;

  // Target streak — evaluated on EVERY closed rock. Rule (user-confirmed): a target-bearing rock
  // (>=3% of a hunted commodity) mined extends it, one skipped/abandoned breaks it, junk rocks
  // never touch it — skipping junk is discipline, not failure.
  if (rock) {
    const targets = targetSet(state);
    const hadTarget = (rock.mats || []).some((m) => m && m.p >= WORTH_MIN_PROP && targets.has(m.k));
    const st = recordStreakRock(hadTarget, tonnes > 0);
    if (st.broke) {
      emit(deps, {
        id: 'edcolony_mining_streak',
        text: `💔 Streak ends at ${st.ended} — best ${st.best}`,
        color: '#94a3b8', x: X_LEFT, y: Y_TARGET - 28, ttl: 7,
      }, { type: 'mining_streak', event: 'broke', current: 0, ended: st.ended, best: st.best });
    } else if (hadTarget && tonnes > 0 && (st.isNewBest || st.current === 5 || st.current === 10 || st.current === 25 || st.current === 50)) {
      const label = st.isNewBest ? `🔥 ${st.current} streak — NEW BEST` : `🔥 ${st.current} target rocks straight`;
      emit(deps, {
        id: 'edcolony_mining_streak', text: label, color: '#fb923c',
        x: X_LEFT, y: Y_TARGET - 28, ttl: 8,
      }, { type: 'mining_streak', event: st.isNewBest ? 'best' : 'milestone', current: st.current, best: st.best });
      pushMiningBeat('streak', { streak: st.current });
    }
  }

  if (!rock || !(tonnes > 0)) { finalizeRock(); return; }

  // Rank every rock — historical and current — on ONE consistent basis: refined tonnage priced at
  // today's rates. Ranking the new rock by what it actually earned (mission rates, ~136k/t for
  // Bromellite) against history priced at market (~37k/t) would declare a record on virtually every
  // mission rock and make the whole thing meaningless within one session.
  const prices = getPriceMap(state);
  const valueOfGot = (got) => {
    let v = 0;
    for (const [k, t] of Object.entries(got || {})) {
      const p = valueOf(k, prices);
      if (p) v += p.cr * t;
    }
    return v;
  };
  const earned = valueOfGot(rock.got);
  const stats = getCatchStats((r) => valueOfGot(r.got));
  const records = getRockRecords((r) => valueOfGot(r.got));
  const rank = records.rankOf(earned);

  // Both dimensions count, and they reward different things — a fat 25t haul of cheap ore and a
  // lean 11t of Low Temperature Diamonds are each worth showing off. Tier on whichever percentile
  // is higher and say which one earned it.
  const pctValue = stats.value.pct(earned);
  const pctTonnes = stats.tonnes.pct(tonnes);
  const by = pctTonnes > pctValue ? 'tonnes' : 'value';
  const pct = Math.max(pctValue, pctTonnes);
  const isBest = earned > 0 && earned >= stats.value.best;
  const isBestTonnes = tonnes >= stats.tonnes.best;
  const tier = isBest || isBestTonnes
    ? { key: 'record', label: 'PERSONAL BEST', icon: '🏆', color: '#fbbf24' }
    : catchTier(pct);

  // Keys are squashed ("lowtemperaturediamond"), so displayName alone would render
  // "Lowtemperaturediamond" — resolve through the material catalog for the proper label.
  const labels = {};
  for (const m of getMaterialCatalog()) labels[m.key] = m.label;
  const parts = Object.entries(rock.got || {})
    .map(([k, t]) => ({ key: k, name: labels[k] || displayName(k), tonnes: t, credits: (valueOf(k, prices) || { cr: 0 }).cr * t }))
    .sort((a, b) => b.credits - a.credits);

  finalizeRock();
  invalidateRecords();

  // Character reaction for the big ones; the arbiter paces it so it never machine-guns.
  if (tier.key === 'record') pushMiningBeat('record', { credits: earned, tonnes });
  else if (tier.key === 'monster' || tier.key === 'whopper') pushMiningBeat('catch', { credits: earned, tonnes, tierLabel: tier.label });

  // Badges — evaluated now the log contains this rock. First-ever pass marks history quietly
  // (legacy, no events); only genuine transitions celebrate.
  try {
    const agg = computeAggregates(readRocks(), (r) => valueOfGot(r.got));
    for (const b of evaluateBadges(agg)) {
      emit(deps, {
        id: 'edcolony_mining_badge', text: `🏅 BADGE — ${b.icon} ${b.label}: ${b.desc}`,
        color: '#fbbf24', x: X_LEFT, y: Y_TARGET - 28, ttl: 12,
      }, { type: 'mining_badge', id: b.id, icon: b.icon, label: b.label, desc: b.desc });
    }
  } catch { /* trophies must never break the catch path */ }

  const headline = `${tier.icon} ${tier.label} — ${tonnes}t · ${fmtCr(earned)}`;
  const detail = rank ? `  (${ordinal(rank)} best ever)` : `  (top ${Math.max(1, Math.round((1 - pct) * 100))}%)`;
  emit(deps, {
    id: 'edcolony_mining_catch',
    text: headline + (pct >= 0.5 ? detail : ''),
    color: tier.color, x: X_LEFT, y: Y_REFINED - 28, ttl: tier.key === 'record' ? 14 : 9,
  }, {
    type: 'mining_catch',
    tier: tier.key,
    tierLabel: tier.label,
    icon: tier.icon,
    credits: earned,
    tonnes,
    parts,
    ring: rock.ring || '',
    pctValue,
    pctTonnes,
    tieredBy: by,
    rank,
    bestValue: stats.value.best,
    bestTonnes: stats.tonnes.best,
    valueHist: stats.value.hist,
    tonnesHist: stats.tonnes.hist,
    sampleSize: stats.count,
    streak: getStreak().current,
  });
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * A tonne just finished refining and is in the hold. Bank it and say so.
 *
 * Value is taken at THIS moment (mission rate while one is live, else market average) and recorded
 * on the rock, so the log holds what the tonne was actually worth rather than what it would fetch
 * whenever someone later reads the file.
 */
function refinedHelper(ev, state, deps) {
  const key = commodityKey(ev.Type_Localised || ev.Type);
  const label = displayName(ev.Type_Localised || ev.Type);
  const val = valueOf(key, getPriceMap(state));
  const credits = val ? val.cr : 0;

  creditRefined(key, 1, credits);
  if (!sessionStartedAt) sessionStartedAt = now();
  rockCredits += credits;
  sessionCredits += credits;
  sessionTonnes += 1;

  if (!credits) {
    emit(deps, {
      id: 'edcolony_mining_refined', text: `✅ ${label} +1t — no price data`,
      color: '#a3a3a3', x: X_LEFT, y: Y_REFINED, ttl: 5,
    }, null);
    return;
  }

  // Escalating flourish for the genuinely big tonnes — a 196k/t mission Osmium tonne shouldn't
  // read the same as a 4k Coltan one.
  const mark = credits >= 150_000 ? '💎' : credits >= 60_000 ? '💰' : '✅';
  const missionTag = val.source === 'mission' ? ' (mission)' : '';
  const text = `${mark} ${label} +${fmtCr(credits)}${missionTag}${flavour(credits, sessionTonnes)}  ·  rock ${fmtCr(rockCredits)}  ·  session ${fmtCr(sessionCredits)} / ${sessionTonnes}t`;
  emit(deps, { id: 'edcolony_mining_refined', text, color: '#4ade80', x: X_LEFT, y: Y_REFINED, ttl: 6 },
    { type: 'mining_refined', commodity: label, credits, rockCredits, sessionCredits, sessionTonnes, mission: val.source === 'mission', streak: getStreak().current, sessionStartedAt });

  // Session milestones, every 50M. Uses its own overlay id so it doesn't stomp the per-tonne line.
  const milestone = Math.floor(sessionCredits / MILESTONE_CR);
  if (milestone > lastMilestone) {
    lastMilestone = milestone;
    pushMiningBeat('milestone', { sessionCredits, sessionTonnes });
    emit(deps, {
      id: 'edcolony_mining_milestone',
      text: `🏆 ${fmtCr(sessionCredits)} this session — ${sessionTonnes}t refined`,
      color: '#fbbf24', x: X_LEFT, y: Y_REFINED - 28, ttl: 10,
    }, { type: 'mining_milestone', sessionCredits, sessionTonnes });
  }
}

/** Value verdict + target alert for a freshly prospected rock, and the log record for it. */
function prospectHelper(ev, state, deps) {
  try {
    refreshLivePrices((Array.isArray(ev.Materials) ? ev.Materials : [])
      .map((m) => commodityKey(m.Name_Localised || m.Name)).filter(Boolean), currentSystem);
  } catch { /* pricing must never break the prospect path */ }
  const prices = getPriceMap(state);
  const table = getYieldTable();
  const ignored = ignoredSet(state);
  const targets = targetSet(state);

  const raw = Array.isArray(ev.Materials) ? ev.Materials : [];
  const mats = raw.map((m) => {
    const key = commodityKey(m.Name_Localised || m.Name);
    const prop = m.Proportion || 0;
    const y = yieldFor(key, table);
    const est = Math.max(MIN_EST_TONNES, Math.round(prop * y.tPerPct));
    const val = valueOf(key, prices);
    return {
      k: key,
      n: displayName(m.Name_Localised || m.Name),
      p: prop,
      est,
      measured: y.measured,
      price: val ? val.cr : null,
      priceSource: val ? val.source : null,
      value: val ? est * val.cr : 0,
      ignored: ignored.has(key),
      target: targets.has(key),
    };
  });

  // Motherlode is recorded for completeness but deliberately NOT alerted on: this commander has no
  // seismic charge launcher fitted and zero AsteroidCracked events across 527 journals, so a core
  // callout would be an alert about a mechanic the ship cannot perform.
  const motherlode = ev.MotherlodeMaterial ? (ev.MotherlodeMaterial_Localised || ev.MotherlodeMaterial) : null;

  const counted = mats.filter((m) => !m.ignored && m.p >= WORTH_MIN_PROP);
  const total = counted.reduce((a, m) => a + m.value, 0);

  // Log record. Fingerprint identity means a re-prospect updates the SAME rock (wherever it sits).
  const rec = {
    id: fingerprint(raw),
    t: ev.timestamp,
    lastT: ev.timestamp,
    sys: currentSystem,
    ring: currentRing ? currentRing.name : '',
    ringClass: currentRing ? currentRing.ringClass : '',
    reserve: currentRing ? currentRing.reserve : '',
    hotspot: inHotspot || undefined,
    hotspotMaterial: hotspotMaterial || undefined,
    content: String(ev.Content_Localised || ev.Content || '').replace(/^.*Content_/, '').replace(/;$/, ''),
    remaining: ev.Remaining,
    motherlode,
    mats: mats.map((m) => ({ k: m.k, n: m.n, p: m.p, est: m.est, price: m.price })),
    estValue: total,
  };
  const cur = getCurrentRock();
  if (cur && cur.id === rec.id) {
    beginRock(rec); // re-prospect of the rock being mined — in-place update
  } else if (cur && Object.keys(cur.got || {}).length > 0) {
    // The commander prospects ahead while collectors finish the current rock — DEFER the switch so
    // the trailing refines keep crediting the rock they came from. A third prospect before the
    // drain forces the boundary now (best effort).
    if (hasPendingRock()) promoteWithFanfare(state, deps);
    stageNextRock(rec);
    pendingStagedAt = now();
  } else {
    // Nothing earned on the current slot — instant switch, exactly the old behavior.
    closeRockWithFanfare(state, deps);
    beginRock(rec);
    rockStartedAt = now();
    refineTimes = [];
    rockCredits = 0;
  }

  // Target alert — fires on value-independent grounds, above the verdict so it can't be missed.
  // Still gated on WORTH_MIN_PROP: a 1.8% trace of a mission commodity is ~1t and alerting on it
  // would fire on nearly every rock, which is how a useful alert becomes wallpaper.
  const hits = mats.filter((m) => m.target && !m.ignored && m.p >= WORTH_MIN_PROP);
  if (hits.length) {
    const txt = hits.map((m) => `${m.n.toUpperCase()} ${m.p.toFixed(1)}% ~${m.est}t`).join(' · ');
    emit(deps, {
      id: 'edcolony_mining_target', text: `🎯 ${txt} — TARGET`, color: '#22d3ee',
      // Long TTL by design: this is the "commit to this rock" signal and the commander is busy
      // flying when it lands. 9s proved too short to reliably catch.
      x: X_LEFT, y: Y_TARGET, ttl: 25,
    }, { type: 'mining_target', summary: txt, materials: hits.map((m) => ({ name: m.n, pct: m.p, est: m.est })) });
  }

  if (!counted.length && !mats.length) return;

  const shown = counted.slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((m) => `${m.n} ${m.p.toFixed(1)}% ~${m.est}t`);
  const ign = mats.filter((m) => m.ignored && m.p >= WORTH_MIN_PROP);
  const ignTxt = ign.length ? `  ·  ignored: ${ign.map((m) => `${m.n} ${m.p.toFixed(0)}%`).join(', ')}` : '';
  const missionFlag = counted.some((m) => m.priceSource === 'mission') ? ' (mission)' : '';

  // Threshold comes from this ring's own logged rocks, not a constant — "worth it" means better
  // than most rocks HERE, which is the comparison actually being made when deciding to fire lasers.
  const bar = worthThreshold(currentRing ? currentRing.name : null, state, table, ignored);

  let text, color;
  if (!counted.some((m) => m.price)) {
    text = `⛏ ${shown.join(' · ') || 'trace only'} — no price data${ignTxt}`;
    color = '#a3a3a3';
  } else if (total >= bar.strong) {
    text = `⛏ ~${fmtCr(total)}${missionFlag} — GOOD ONE  ·  ${shown.join(' · ')}${ignTxt}`;
    color = '#22d3ee';
  } else if (total >= bar.cr) {
    text = `⛏ ~${fmtCr(total)}${missionFlag}  ·  ${shown.join(' · ')}${ignTxt}`;
    color = '#4ade80';
  } else {
    const vs = bar.basis === 'default' ? '' : ` (below ${fmtCr(bar.cr)} ${bar.basis} median)`;
    text = `⛏ ~${fmtCr(total)} — skip${vs}  ·  ${shown.join(' · ')}${ignTxt}`;
    color = '#9ca3af';
  }
  emit(deps, { id: 'edcolony_mining_prospect', text, color, x: X_LEFT, y: Y_PROSPECT, ttl: 8 },
    total >= bar.strong
      ? { type: 'mining_prospect', value: total, summary: shown.join(' · '), good: true, ring: currentRing ? currentRing.name : '' }
      : null);

  // Board ping: EVERY prospect, the moment it's scanned — value vs this ring's bar, before the
  // commander commits lasers. Consumed only by the Mining page's distribution board (not a popup).
  emit(deps, null, {
    type: 'mining_scan',
    value: total,
    bar: bar.cr,
    strong: bar.strong,
    basis: bar.basis,
    hasTarget: hits.length > 0,
    ring: currentRing ? currentRing.name : '',
    streak: getStreak().current,
  });

  trackPatchQuality(total, bar, deps);
}

/** Periodic half — a stall is the ABSENCE of events, so it cannot live in the event path. */
export function checkMiningStall(journalDir, deps) {
  if (!deps || !deps.sendOverlay) return;
  const state = typeof deps.readState === 'function' ? deps.readState() : null;
  const status = readStatus(journalDir);
  const flags = status ? status.flags : 0;

  // Hardpoints deployed is the gate. Without it the old 90s activity window kept warning while
  // simply flying between rocks with weapons stowed.
  const lasersOut = !!(flags & F_HARDPOINTS) && !(flags & (F_SUPERCRUISE | F_DOCKED | F_LANDED));
  const miningRecently = now() - lastMiningActivityAt < MINING_WINDOW_MS;
  if (!miningRecently) {
    // Session ended — bank the open rock and reset the running totals so the next session's
    // popup doesn't read as a continuation of one that finished hours ago.
    if (sessionTonnes > 0) { finalizeAllRocks(); sessionCredits = 0; sessionTonnes = 0; lastMilestone = 0; rockCredits = 0; sessionStartedAt = 0; }
    cargoWarnLevel = 0;
    return;
  }

  if (status && status.cargo != null) lastCargoTotal = status.cargo;
  if (hasPendingRock() && lastRefineAt && now() - lastRefineAt >= DRAIN_GAP_MS) {
    promoteWithFanfare(state, deps);
  }
  const limpets = readLimpetCount(journalDir);

  // Only a rock that WAS delivering and then stopped is worth flagging. Requiring the open rock to
  // have already produced a tonne is what removes the false positives at the root: flying between
  // rocks, prospecting, and fighting all follow a rock that produced nothing, so none of them can
  // trip it. `HardpointsDeployed` alone was useless as a gate — miners leave hardpoints out
  // permanently, so it was true nearly all session.
  const rock = getCurrentRock();
  const rockWasProducing = !!(rock && rock.gotValue !== undefined ? Object.keys(rock.got || {}).length : 0);
  const inDanger = !!(flags & (F_DANGER | F_OVERHEAT));

  if (lasersOut && lastRefineAt && rockWasProducing && !inDanger) {
    const quiet = now() - lastRefineAt;
    const collapsed = rateCollapsed();
    if ((quiet >= STALL_MS || collapsed) && now() - lastStallAlertAt >= STALL_COOLDOWN_MS) {
      lastStallAlertAt = now();
      const { text, color } = stallFacts(limpets, quiet >= STALL_MS, quiet);
      pushMiningBeat('stall');
      emit(deps, { id: 'edcolony_mining_stall', text, color, x: X_LEFT, y: Y_STALL, ttl: 9 },
        { type: 'mining_stall', summary: text.replace(/^⚠ /, ''), limpets });
    }
  }

  checkCargo(state, status, limpets, deps);
}

/**
 * Rate collapse: tonnes in the recent window against the rock's earlier pace. Catches "half my
 * collectors died" — a genuine slowdown that never trips a binary no-tonnes-at-all stall.
 */
function rateCollapsed() {
  if (refineTimes.length < 4 || !rockStartedAt) return false;
  const t = now();
  const recent = refineTimes.filter((x) => t - x <= SLOW_WINDOW_MS).length;
  const elapsedEarly = (refineTimes[refineTimes.length - 1] - refineTimes[0]) / 1000;
  if (elapsedEarly < 30) return false;
  const earlyRate = refineTimes.length / elapsedEarly;          // tonnes/sec over the rock so far
  const recentRate = recent / (SLOW_WINDOW_MS / 1000);
  return earlyRate > 0 && recentRate / earlyRate < SLOW_DROP;
}

/**
 * Report the DURABLE facts about a stall. Deliberately does not name a cause.
 *
 * The previous version ran a cause ladder off Status.json flags and was wrong twice in one session
 * on real hardware:
 *   • "hostiles on you" fired with no hostiles present (IsInDanger is a generic danger/damage state,
 *     not an attack indicator — it appears to be set by things as ordinary as nudging a limpet).
 *   • "cargo scoop is retracted" fired with the scoop deployed. Captured flag transitions show the
 *     scoop bit genuinely toggling mid-mining (06:14:36 set → 06:14:44 clear → 06:14:48 set), and a
 *     5-second poll lands in those gaps.
 *
 * Both failures share one root: a flag sampled at a single instant was asserted as a sustained
 * cause. Rather than patch each symptom, cause attribution from instantaneous flags is gone. What's
 * reported now is only what's independently checkable — elapsed silence, limpets aboard, time since
 * the last collector went out — and the commander draws the conclusion.
 */
function stallFacts(limpets, hardStop, quietMs) {
  if (limpets === 0) return { text: '⚠ OUT of limpets', color: '#f87171' };

  const verb = hardStop ? 'Collection stopped' : 'Collection slowed';
  const bits = [`${Math.round(quietMs / 1000)}s since last tonne`];
  const sinceLaunch = lastCollectorLaunchAt ? now() - lastCollectorLaunchAt : null;
  if (sinceLaunch != null && sinceLaunch > COLLECTOR_QUIET_MS) {
    bits.push(`no collector out in ${Math.round(sinceLaunch / 60000)}m`);
  }
  if (limpets != null) bits.push(`${limpets} limpet${limpets === 1 ? '' : 's'}`);
  return { text: `⚠ ${verb} — ${bits.join(' · ')}`, color: '#fbbf24' };
}

/**
 * Hold warning on EFFECTIVE ore space: capacity − cargo + limpets aboard.
 * Limpets occupy cargo but each launch returns a tonne, so raw free space understates the room you
 * actually have — at 250/256 with 20 limpets there is 26t of ore room, not 6t, and warning on the
 * raw number would send the commander to a station early.
 */
function checkCargo(state, status, limpets, deps) {
  const cap = state && state.currentShip && state.currentShip.cargoCapacity;
  if (!cap || !status || status.cargo == null) return;
  const cargo = status.cargo;
  const drones = limpets || 0;
  const effectiveFree = Math.max(0, cap - cargo + drones);
  const oreHeld = Math.max(0, cargo - drones);
  const pct = Math.round((oreHeld / cap) * 100);

  let level = 0;
  if (effectiveFree <= 0) level = 2;
  else if (effectiveFree <= cap * 0.15) level = 1;
  if (level === 0) { cargoWarnLevel = 0; return; }
  if (level <= cargoWarnLevel && now() - lastCargoAlertAt < CARGO_COOLDOWN_MS) return;
  cargoWarnLevel = level;
  lastCargoAlertAt = now();

  const text = level === 2
    ? '⛔ HOLD FULL — refinery backing up'
    : `⚠ Hold ${pct}% · ~${effectiveFree}t ore space${drones ? ` (${drones} limpets)` : ''}`;
  emit(deps, {
    id: 'edcolony_mining_cargo', text, color: level === 2 ? '#f87171' : '#fbbf24',
    x: X_LEFT, y: Y_CARGO, ttl: 9,
  }, { type: 'mining_cargo', summary: text.replace(/^[⛔⚠] /, ''), level, effectiveFree, pct });
}

function readStatus(journalDir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(journalDir, 'Status.json'), 'utf8'));
    return { flags: typeof d.Flags === 'number' ? d.Flags : 0, cargo: typeof d.Cargo === 'number' ? d.Cargo : null };
  } catch { return null; }
}

function readLimpetCount(journalDir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(journalDir, 'Cargo.json'), 'utf8'));
    const inv = Array.isArray(d.Inventory) ? d.Inventory : [];
    const drones = inv.find((i) => i && commodityKey(i.Name) === 'drone');
    return drones ? (drones.Count || 0) : (inv.length ? 0 : null);
  } catch { return null; }
}

/**
 * Value of one tonne of a commodity right now. Exposed so the mining page can put a retrospective
 * figure on historical tonnage — explicitly as "at today's prices", never as credits earned.
 */
export function commodityValueNow(key, state) {
  const v = valueOf(key, getPriceMap(state));
  return v ? v.cr : 0;
}

/**
 * Value a logged rock the same way the overlay values a live one — estimated tonnes from
 * proportions, priced at current mission/market rates, ignored materials excluded.
 * Shared so the page's "worth it %" and the overlay's worth-it call can never disagree.
 */
export function rockValueNow(rec, state) {
  return valueLoggedRock(rec, state, getYieldTable(), ignoredSet(state));
}

/** Live snapshot for the mining page — the in-flight rock the log hasn't written yet. */
export function getMiningSnapshot() {
  return {
    ring: currentRing,
    system: currentSystem,
    currentRock: getCurrentRock(),
    lastRefineAt: lastRefineAt || null,
    miningActive: now() - lastMiningActivityAt < MINING_WINDOW_MS,
    sessionCredits,
    sessionTonnes,
    rockCredits,
    sessionStartedAt: sessionStartedAt || null,
    streak: getStreak(),
    inHotspot,
    hotspotMaterial,
  };
}
