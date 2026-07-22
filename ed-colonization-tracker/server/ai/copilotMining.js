// server/ai/copilotMining.js
//
// Bridge between the mining assist (server/journal/mining.js) and the co-pilot.
//
// mining.js already computes the moments worth reacting to — catch tiers, records, streaks,
// milestones, stalls — so rather than re-deriving them from raw events here, it PUSHES them into
// this queue and the co-pilot's detector drains it on its next tick. One direction of import
// (mining.js → here ← copilot.js), no cycle.
//
// All mining beats are CANNED-ONLY: they fire mid-mining where latency kills the moment, and the
// user's standing rule is no `claude -p` waits. Hand-written pools live in copilotCannedData.js.
//
// Moods map to the character-art packs the Cockpit already serves (/copilot-art/<persona>/<mood>.png,
// falls back to calm.png): 'hyped' for big catches and streaks, 'proud' for records.

const queue = [];
const MAX_QUEUE = 6;

/** Called by mining.js at moment-of-event. Cheap; drops oldest beyond a small cap. */
export function pushMiningBeat(kind, data = {}) {
  queue.push({ kind, data, at: Date.now() });
  if (queue.length > MAX_QUEUE) queue.shift();
}

const fmtCr = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n || 0)}`);

// Beat templates per kind. `priority` sits below danger interrupts (dmg-critical ~90) and above
// routine chatter; records are character moments and rare, so they float highest.
const BEATS = {
  record: (d) => ({
    key: 'mining-record', priority: 74, interrupt: false, live: false, mood: 'proud', character: true,
    rarity: 8,
    inputs: { value: fmtCr(d.credits), tonnes: String(d.tonnes) },
  }),
  catch: (d) => ({
    key: 'mining-catch', priority: 62, interrupt: false, live: false, mood: 'hyped', character: true,
    inputs: { value: fmtCr(d.credits), tonnes: String(d.tonnes), tier: String(d.tierLabel || 'WHOPPER').toLowerCase() },
  }),
  streak: (d) => ({
    key: 'mining-streak', priority: 58, interrupt: false, live: false, mood: 'hyped', character: true,
    inputs: { streak: String(d.streak) },
  }),
  milestone: (d) => ({
    key: 'mining-milestone', priority: 55, interrupt: false, live: false, mood: 'hyped',
    inputs: { session: fmtCr(d.sessionCredits), tonnes: String(d.sessionTonnes) },
  }),
  stall: () => ({
    key: 'mining-stall', priority: 45, interrupt: false, live: false, mood: 'calm',
    inputs: {},
  }),
  'ring-entry': (d) => ({
    key: 'mining-ring-entry', priority: 40, interrupt: false, live: false, mood: 'calm',
    inputs: { ring: d.ring || 'the ring' },
  }),
};

/**
 * Drain the freshest queued mining moment into a beat candidate, or null.
 * Stale entries (older than a minute) are dropped — a reaction delivered late reads as a bug,
 * not a character.
 */
export function detectMiningBeat() {
  const now = Date.now();
  while (queue.length) {
    const item = queue.pop(); // freshest first; older ones die below
    if (now - item.at > 60_000) continue;
    const make = BEATS[item.kind];
    if (!make) continue;
    queue.length = 0; // one reaction per tick — don't machine-gun the whole backlog
    return make(item.data);
  }
  return null;
}
