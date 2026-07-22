// server/ai/copilotCanned.js
//
// Runtime side of the canned-line system: loads the pre-generated pools and
// hands back a ready-to-show line for a routine beat — picked at random, with
// {slots} filled from live context and a rolling anti-repeat memory. Costs
// nothing (no `claude -p`). Live generation is reserved for the meaningful beats.

import CANNED from './copilotCannedData.js';
import PROMOTED from './copilotPromotedData.js';
import MINING from './copilotMiningLines.js';
import { CANNED_SCENARIOS } from './copilotScenarios.js';

const SCENARIO_KEYS = new Set(CANNED_SCENARIOS.map((s) => s.key));
// The INTERRUPT damage tiers (from detectDamageSeverity) draw INSTANT canned lines from the shared
// 'damage' panic pool — latency during combat is unacceptable for an interrupt beat, and the existing
// panic lines fit these tiers' tone. 'dmg-scratched' is deliberately NOT here: it's a calm, non-
// interrupt beat, so it stays on the live path for a richer context-aware line (no urgency to rush).
const DAMAGE_CANNED_TIERS = new Set(['dmg-hit', 'dmg-serious', 'dmg-critical']);
// Anti-repeat is PER-SCENARIO: each beat keeps its OWN recent list (sized to its pool), so a
// high-frequency beat (dock/launch, hit dozens of times a haul) shows ALL its lines before any
// repeat. A single global list let other scenarios' lines push a pool's out and resurface early.
const recentByKey = new Map(); // key -> string[] of recently shown lines for THAT key

/** Is this beat key served from the canned pool (vs. generated live)? */
export function isCannedScenario(key) {
  return SCENARIO_KEYS.has(key) || DAMAGE_CANNED_TIERS.has(key);
}

/**
 * Pick a canned line for `key` in the given personality's voice, filling any
 * {slots} from `ctx`. Returns '' if there's no usable line — the caller then
 * stays silent rather than paying to generate routine chatter.
 */
export function pickCanned(personality, key, ctx) {
  const pool = poolFor(personality, key);
  if (!pool.length) return '';
  // Usable = lines with no slots, or whose every slot we can fill. (A slotless
  // line satisfies this vacuously, so we never show a literal "{station}".)
  const usable = pool.filter((l) => slotsSatisfied(l, ctx));
  if (!usable.length) return '';
  const seen = recentByKey.get(key) || [];
  const fresh = usable.filter((l) => !seen.includes(l));
  const choice = pick(fresh.length ? fresh : usable);
  if (!choice) return '';
  remember(key, choice, usable.length);
  return fill(choice, ctx);
}

function poolFor(personality, key) {
  const byPers = CANNED[personality] || CANNED.wash || {};
  // The interrupt damage tiers share the hand-written 'damage' panic pool; promoted lines stay
  // keyed per-tier so the offline flywheel can still differentiate them later.
  const handKey = DAMAGE_CANNED_TIERS.has(key) ? 'damage' : key;
  let hand = Array.isArray(byPers[handKey]) ? byPers[handKey] : [];
  // Mining beats live in their own hand-written module (the regen tool rewrites CannedData
  // wholesale — an island there would eventually be clobbered).
  const mine = (MINING[personality] || {})[handKey];
  if (Array.isArray(mine) && mine.length) hand = hand.concat(mine);
  // Promoted lines (grown offline from rated LIVE captures) join the SAME pool +
  // anti-repeat — so a live beat's best lines become free, cycled like hand-canned.
  const pro = (PROMOTED[personality] || {})[key];
  return Array.isArray(pro) && pro.length ? hand.concat(pro) : hand;
}

function slotsSatisfied(line, ctx) {
  const slots = line.match(/\{(\w+)\}/g) || [];
  return slots.every((s) => {
    const k = s.slice(1, -1);
    return ctx && ctx[k] != null && String(ctx[k]).trim() !== '';
  });
}

function fill(line, ctx) {
  return line
    .replace(/\{(\w+)\}/g, (m, k) => (ctx && ctx[k] != null && String(ctx[k]).trim() !== '' ? String(ctx[k]) : m))
    .trim();
}

function pick(arr) {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : '';
}

function remember(key, line, poolSize) {
  const arr = recentByKey.get(key) || [];
  arr.push(line);
  // Keep at most poolSize-1, so once a pool is fully cycled it resets — every line shows before any repeat.
  while (arr.length > Math.max(1, poolSize - 1)) arr.shift();
  recentByKey.set(key, arr);
}
