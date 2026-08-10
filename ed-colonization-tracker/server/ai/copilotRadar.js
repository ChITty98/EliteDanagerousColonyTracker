// server/ai/copilotRadar.js
//
// Radar → co-pilot bridge, same one-way queue pattern as copilotMining: the EDDN listener pushes
// notable moments, the co-pilot's detector drains at most one per tick, the arbiter paces it.
// The screen is always-on ambient; the voice only earns the interrupt for the genuinely notable —
// and every line keeps the honesty hedge, because EDDN only hears tool-running commanders.

const queue = [];
const MAX_QUEUE = 4;

// Rate limits per kind — a busy neighborhood must not become a chatterbox.
const COOLDOWN_MS = { build: 10 * 60_000, lead: 6 * 60_000, quiet: 45 * 60_000, chain: 30 * 60_000 };
const lastPushed = {};

export function pushRadarBeat(kind, data = {}) {
  const now = Date.now();
  if (lastPushed[kind] && now - lastPushed[kind] < (COOLDOWN_MS[kind] || 300_000)) return;
  lastPushed[kind] = now;
  queue.push({ kind, data, at: now });
  if (queue.length > MAX_QUEUE) queue.shift();
}

const BEATS = {
  build: (d) => ({
    key: 'radar-build', priority: 60, interrupt: false, live: false, mood: 'calm', character: true,
    inputs: { dist: String(d.distLy ?? '?'), system: d.sys || 'an uncharted system' },
  }),
  lead: (d) => ({
    key: 'radar-lead', priority: 52, interrupt: false, live: false, mood: 'hyped',
    inputs: { dist: String(d.distLy ?? '?'), system: d.sys || 'a nearby system' },
  }),
  chain: (d) => ({
    key: 'radar-chain', priority: 45, interrupt: false, live: false, mood: 'calm',
    inputs: { system: d.sys || 'a frontier system', region: d.region || 'the frontier' },
  }),
  quiet: () => ({
    key: 'radar-quiet', priority: 20, interrupt: false, live: false, mood: 'calm',
    inputs: {},
  }),
};

export function detectRadarBeat() {
  const now = Date.now();
  while (queue.length) {
    const item = queue.pop();
    if (now - item.at > 90_000) continue;
    const make = BEATS[item.kind];
    if (!make) continue;
    queue.length = 0;
    return make(item.data);
  }
  return null;
}
