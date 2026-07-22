// server/journal/miningTrophies.js
//
// Records, badges and the target streak — the trophy shelf.
//
// Badge thresholds are STATIC, deliberately: percentile-based bars would drift as the log grows and
// a badge that can un-earn itself is not a badge. The tiers were chosen against the commander's real
// history at ship time (biggest rock 3.82M, best night 27.9M, best rate 224 t/hr, longest streak 43)
// so several unlock retroactively and the next ones are genuinely reachable.
//
// Persistence: mining-trophies.json next to the exe — tiny, and OUT of the 21MB synced state blob,
// same policy as mining-log.jsonl. First evaluation marks everything history has already earned as
// `legacy` with NO celebration events (ten popups on boot would cheapen every future unlock);
// only transitions after that first pass pop.

import fs from 'node:fs';
import path from 'node:path';

let FILE = null;
let state = { badges: {}, streak: { current: 0, best: 0, bestAt: null } };
let initialized = false;

export function initTrophies(appDir) {
  FILE = path.join(appDir, 'mining-trophies.json');
  try {
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (j && j.badges) { state = j; initialized = true; }
    }
  } catch { /* fresh shelf */ }
  return FILE;
}

function save() {
  if (!FILE) return;
  try { fs.writeFileSync(FILE, JSON.stringify(state, null, 1), 'utf8'); } catch { /* non-fatal */ }
}

// ---- Badge definitions ----------------------------------------------------------------------
// Predicates run over the aggregate stats computed in evaluate(). Icons are Win10-safe emoji.

export const BADGES = [
  { id: 'first-whopper', icon: '💎', label: 'First Whopper', desc: 'A single rock worth 1M+', test: (a) => a.biggestRock >= 1_000_000 },
  { id: 'monster-hunter', icon: '🔥', label: 'Monster Hunter', desc: 'A single rock worth 2M+', test: (a) => a.biggestRock >= 2_000_000 },
  { id: 'leviathan', icon: '🐋', label: 'Leviathan', desc: 'A single rock worth 4M+', test: (a) => a.biggestRock >= 4_000_000 },
  { id: 'kilotonne', icon: '⚖️', label: 'Kilotonne', desc: '1,000 lifetime tonnes refined', test: (a) => a.lifetimeTonnes >= 1_000 },
  { id: 'heavy-industry', icon: '🏭', label: 'Heavy Industry', desc: '2,500 lifetime tonnes refined', test: (a) => a.lifetimeTonnes >= 2_500 },
  { id: 'strip-miner', icon: '🪐', label: 'Strip Miner', desc: '5,000 lifetime tonnes refined', test: (a) => a.lifetimeTonnes >= 5_000 },
  { id: 'ten-mil-night', icon: '💰', label: '10M Night', desc: '10M credits in one session', test: (a) => a.bestSessionCredits >= 10_000_000 },
  { id: 'twenty-mil-night', icon: '🤑', label: '20M Night', desc: '20M credits in one session', test: (a) => a.bestSessionCredits >= 20_000_000 },
  { id: 'thirty-mil-night', icon: '👑', label: '30M Night', desc: '30M credits in one session', test: (a) => a.bestSessionCredits >= 30_000_000 },
  { id: 'fast-hands', icon: '⚡', label: 'Fast Hands', desc: '150+ t/hr in a session', test: (a) => a.bestSessionTph >= 150 },
  { id: 'speed-demon', icon: '🚀', label: 'Speed Demon', desc: '200+ t/hr in a session', test: (a) => a.bestSessionTph >= 200 },
  { id: 'overdrive', icon: '☄️', label: 'Overdrive', desc: '250+ t/hr in a session', test: (a) => a.bestSessionTph >= 250 },
  { id: 'century-night', icon: '💯', label: 'Century Night', desc: '100 rocks mined in one session', test: (a) => a.bestSessionRocks >= 100 },
  { id: 'on-a-roll', icon: '🎯', label: 'On a Roll', desc: '10-rock target streak', test: (a) => a.bestStreak >= 10 },
  { id: 'locked-in', icon: '🔒', label: 'Locked In', desc: '25-rock target streak', test: (a) => a.bestStreak >= 25 },
  { id: 'unerring', icon: '🏹', label: 'Unerring', desc: '50-rock target streak', test: (a) => a.bestStreak >= 50 },
  { id: 'prospector-500', icon: '🔍', label: 'Prospector 500', desc: '500 lifetime rocks prospected', test: (a) => a.lifetimeProspects >= 500 },
  { id: 'ring-tourist', icon: '🗺️', label: 'Ring Tourist', desc: 'Mined in 10 different rings', test: (a) => a.distinctRings >= 10 },
  { id: 'ring-cartographer', icon: '🧭', label: 'Ring Cartographer', desc: 'Mined in 20 different rings', test: (a) => a.distinctRings >= 20 },
];

const SESSION_GAP_MS = 15 * 60_000;

/**
 * Aggregate the log into the stats badges test against. `valueFn` prices a rock's refined tonnage
 * (mission-aware, today's rates) — same basis the records display uses.
 */
export function computeAggregates(rocks, valueFn) {
  let lifetimeTonnes = 0;
  let lifetimeProspects = 0;
  let biggestRock = 0;
  let biggestRockTonnes = 0;
  let biggestRockAt = null;
  let biggestRockRing = '';
  const rings = new Set();

  // Session grouping by time gaps (same rule measuredRateFor uses).
  const timed = rocks.filter((r) => r.t).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const sessions = [];
  let cur = null;
  for (const r of timed) {
    lifetimeProspects += 1;
    const tonnes = r.gotTotal || 0;
    if (!tonnes) continue;
    lifetimeTonnes += tonnes;
    if (r.ring) rings.add(r.ring);
    const v = valueFn(r);
    if (v > biggestRock) { biggestRock = v; biggestRockTonnes = tonnes; biggestRockAt = r.t; biggestRockRing = r.ring || r.sys || ''; }
    const ts = Date.parse(r.t);
    if (!cur || ts - cur.last > SESSION_GAP_MS) { cur = { first: ts, last: ts, tonnes: 0, credits: 0, rocks: 0, day: String(r.t).slice(0, 10) }; sessions.push(cur); }
    cur.last = ts;
    cur.tonnes += tonnes;
    cur.credits += v;
    cur.rocks += 1;
  }

  let bestSessionCredits = 0, bestSessionCreditsDay = null;
  let bestSessionTph = 0, bestSessionTphDay = null;
  let bestSessionRocks = 0;
  for (const s of sessions) {
    const hrs = (s.last - s.first) / 3600000;
    if (s.credits > bestSessionCredits) { bestSessionCredits = s.credits; bestSessionCreditsDay = s.day; }
    if (hrs > 0.25 && s.tonnes / hrs > bestSessionTph) { bestSessionTph = s.tonnes / hrs; bestSessionTphDay = s.day; }
    if (s.rocks > bestSessionRocks) bestSessionRocks = s.rocks;
  }

  return {
    lifetimeTonnes, lifetimeProspects, distinctRings: rings.size,
    biggestRock, biggestRockTonnes, biggestRockAt, biggestRockRing,
    bestSessionCredits, bestSessionCreditsDay,
    bestSessionTph: Math.round(bestSessionTph), bestSessionTphDay,
    bestSessionRocks,
    bestStreak: state.streak.best,
    sessionCount: sessions.length,
  };
}

/**
 * Evaluate badges against fresh aggregates. Returns badges newly earned SINCE the last evaluation
 * (empty on the very first pass — history unlocks silently as `legacy`).
 */
export function evaluateBadges(agg) {
  const firstPass = !initialized;
  const newly = [];
  for (const b of BADGES) {
    if (state.badges[b.id]) continue;
    if (!b.test(agg)) continue;
    state.badges[b.id] = { earnedAt: new Date().toISOString(), legacy: firstPass };
    if (!firstPass) newly.push(b);
  }
  if (firstPass) initialized = true;
  save();
  return newly;
}

/** Badge list with earned state, for the trophy wall. */
export function badgeStates() {
  return BADGES.map((b) => ({
    id: b.id, icon: b.icon, label: b.label, desc: b.desc,
    earnedAt: state.badges[b.id] ? state.badges[b.id].earnedAt : null,
    legacy: !!(state.badges[b.id] && state.badges[b.id].legacy),
  }));
}

// ---- Target streak --------------------------------------------------------------------------
// Counts target-bearing rocks (>=3% of a hunted commodity) the commander actually mined.
// A skipped/abandoned target rock breaks it; junk rocks don't touch it — skipping junk is
// discipline, not failure. Survives across sessions: it measures discipline, not uptime.

/** @returns {{current:number, best:number, isNewBest:boolean, broke:boolean, ended:number}} */
export function recordStreakRock(hadTarget, mined) {
  if (!hadTarget) return { current: state.streak.current, best: state.streak.best, isNewBest: false, broke: false, ended: 0 };
  let broke = false;
  let isNewBest = false;
  let ended = 0;
  if (mined) {
    state.streak.current += 1;
    if (state.streak.current > state.streak.best) {
      state.streak.best = state.streak.current;
      state.streak.bestAt = new Date().toISOString();
      isNewBest = state.streak.best >= 5; // a "new best" of 2 isn't an event
    }
  } else {
    ended = state.streak.current;
    broke = ended >= 5; // only mourn streaks that were worth having
    state.streak.current = 0;
  }
  save();
  return { current: state.streak.current, best: state.streak.best, isNewBest, broke, ended };
}

export function getStreak() { return { ...state.streak }; }
