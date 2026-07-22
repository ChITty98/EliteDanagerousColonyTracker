// server/ai/copilotArbiter.js
//
// The salience / budget arbiter — decides WHEN the co-pilot speaks among many
// eligible beats, so it never spams and never goes dead. Each tick the
// orchestrator scores every eligible beat and asks the arbiter for the winner;
// at most one line is spoken, governed by a dynamic threshold + a speech budget.
//
// This replaces the old "highest priority + fixed throttle" rule. The key
// behaviours it buys us:
//   - repeat-dock / repeat-system spam dies on the RECENCY penalty
//   - a long silent haul eventually surfaces something modest (threshold DECAYS)
//   - right after speaking, the bar JUMPS so lines don't chain
//   - danger (interrupt) always bypasses everything
//
// All weights are intentionally at the top and conservative — the commander
// tunes feel via the chattiness control; these are the starting point.

const FLOOR = 14;            // lowest the threshold decays to after long silence
const BASE_THRESHOLD = 48;   // resting bar a beat must clear to speak
const POST_SPEAK_BUMP = 18;  // added to the bar right after speaking (no chaining)
const STALENESS_MAX = 30;    // most the silence bonus can add
const RECENCY_MAX = 45;      // most the "we just did this" penalty can subtract
const RECENCY_HALFLIFE_MS = 150000; // recency penalty halves every ~2.5 min
const PLACE_RECENCY_WEIGHT = 0.8;   // same-place penalty vs same-beat penalty
const CHARACTER_BOOST = 8;          // personality/character beats float above routine reactive chatter

// Per-key / per-place last-fired timestamps (process memory, like recentLines).
const lastFired = new Map();
let thresholdBoostUntilEmptied = 0; // extra bar from the last spoken line, decays with silence

/** Exponential-decay factor in [0,1]: 1 right after an event, → 0 as it ages. */
function decay(ageMs, halfLife) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.pow(0.5, ageMs / halfLife);
}

function recencyPenalty(key, now) {
  const t = lastFired.get(key);
  if (!t) return 0;
  return RECENCY_MAX * decay(now - t, RECENCY_HALFLIFE_MS);
}

/**
 * Salience of one candidate beat.
 * @param {{ priority?:number, key:string, rarity?:number }} beat
 * @param {{ now:number, lastSpokeAt:number, place?:string|null }} ctx
 */
export function salience(beat, ctx) {
  const now = ctx.now;
  let s = beat.priority || 0;
  // Staleness: the longer we've been quiet, the more everything is worth saying.
  const quiet = now - (ctx.lastSpokeAt || 0);
  s += Math.min(STALENESS_MAX, quiet / 5000); // ~+1 per 5s quiet, capped
  // Recency: we just fired this beat, or just commented on this place → suppress.
  // Scaled by chattiness — at Chatty (chattyFactor 0) repeats are allowed through.
  const rf = ctx.chattyFactor != null ? ctx.chattyFactor : 1;
  s -= recencyPenalty(`beat:${beat.key}`, now) * rf;
  if (ctx.place) s -= PLACE_RECENCY_WEIGHT * recencyPenalty(`place:${ctx.place}`, now) * rf;
  // Personal rarity (first-ever / tail-of-distribution) lifts a beat.
  if (beat.rarity) s += beat.rarity;
  // Character moments (personality, affinities, quirks) float above routine reactive chatter.
  if (beat.character) s += CHARACTER_BOOST;
  return s;
}

/** The bar a beat must clear right now — decays toward FLOOR the longer we're quiet. */
export function threshold(ctx) {
  const cf = ctx.chattyFactor != null ? ctx.chattyFactor : 1;
  const quiet = ctx.now - (ctx.lastSpokeAt || 0);
  const interval = Math.max(30000, (ctx.chattinessMs || 240000));
  // Resting bar scales with chattiness: at Chatty it sits near the floor (even minor
  // events clear it), at Quiet it's the full bar. The post-speak anti-chaining boost
  // is likewise scaled out at Chatty so lines can chain on consecutive events.
  const restingBase = FLOOR + (BASE_THRESHOLD - FLOOR) * cf;
  const boost = thresholdBoostUntilEmptied * cf * Math.max(0, 1 - quiet / interval);
  const base = restingBase + boost;
  // Decay toward the floor as silence grows (a quiet haul eventually says something).
  const decayed = base - Math.min(base - FLOOR, (quiet / interval) * (base - FLOOR) * 1.2);
  return Math.max(FLOOR, decayed);
}

/**
 * Pick the winner among candidates, or null to stay silent.
 * Interrupt beats bypass the threshold + budget entirely.
 * @param {Array<{beat:object, place?:string|null}>} candidates
 */
export function arbitrate(candidates, ctx) {
  if (!candidates.length) return null;
  // Interrupts (danger) win immediately, highest priority first.
  const interrupts = candidates.filter((c) => c.beat.interrupt);
  if (interrupts.length) {
    return interrupts.sort((a, b) => (b.beat.priority || 0) - (a.beat.priority || 0))[0];
  }
  // Budget gate: outside an interrupt, honour a minimum spacing between lines.
  if (ctx.now - (ctx.lastSpokeAt || 0) < (ctx.minSpacingMs || 0)) return null;
  // Score everyone; the top must clear the (decaying) threshold.
  const scored = candidates
    .map((c) => ({ ...c, score: salience(c.beat, { ...ctx, place: c.place }) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  return top.score >= threshold(ctx) ? top : null;
}

/** Record that a beat spoke — feeds the recency penalty + bumps the bar. */
export function recordSpoken(key, place, now) {
  lastFired.set(`beat:${key}`, now);
  if (place) lastFired.set(`place:${place}`, now);
  thresholdBoostUntilEmptied = POST_SPEAK_BUMP;
}
