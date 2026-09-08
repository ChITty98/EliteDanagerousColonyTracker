// server/ai/copilotSurface.js
//
// Bridge between surface mining (server/journal/surfaceMining.js) and the co-pilot — the same
// one-direction push queue as copilotMining.js. surfaceMining.js already knows the moments; it
// PUSHES them here and the co-pilot's detector drains the freshest on its next tick. One direction
// of import (surfaceMining.js → here ← copilot.js), no cycle.
//
// Every surface beat is CANNED-ONLY: they fire while the commander is in the Rhino, where a
// `claude -p` wait would land the line a minute after the moment. Pools: copilotSurfaceLines.js.
//
// The co-pilot is not in the SRV. The "away" conceit (copilotAway.js) puts them overhead in the
// ship with eyes on — so these lines read as radio from above: what they can SEE on the display
// right now, in the present tense. The driving rating is on that display as a quality of the
// ground, never as something the commander once said, and a line never reads a number back.
//
// ANTI-INVENTION: a line may reference only what the data carries — the rating band, the signal
// number, the body, and whether the ship is landed near the SRV. No directions, no "last time",
// no terrain the app never saw. copilotSurfaceLines.js repeats this rule at the top of the file.

const queue = [];
const MAX_QUEUE = 6;

/** Called by surfaceMining.js at moment-of-event. Cheap; drops oldest beyond a small cap. */
export function pushSurfaceBeat(kind, data = {}, opts = {}) {
  queue.push({ kind, data, at: Date.now() });
  if (queue.length > MAX_QUEUE) queue.shift();
  // A beat born on a TIMER (the recall confirmed after the departure window, the target nudge)
  // lands between journal writes, and nothing ticks the co-pilot then — on foot the next event
  // can be the ship landing half a minute later. So the pusher may ask for one synthetic tick.
  if (opts && opts.kick && kick) { try { kick(kind); } catch (e) { console.error('[Copilot] surface kick:', e && e.message); } }
}

let kick = null;
/** copilot.js registers the synthetic-tick function here; tests may register a spy or null. */
export function setSurfaceKick(fn) { kick = typeof fn === 'function' ? fn : null; }

/**
 * Driving score 1–5 → the band the pools are keyed by. The words are the commander's own scale
 * (1 very flat, 2 flat with bumpy segments, 4 huge valleys); 3 and 5 are extrapolated from those.
 * Anything missing or outside the scale is 'unrated', which has its own honest pool.
 */
export function bandFor(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n < 1) return 'unrated';
  if (n <= 1) return 'flat';
  if (n <= 2) return 'bumpy';
  if (n <= 3) return 'broken';
  if (n <= 4) return 'valleys';
  return 'brutal';
}

// Beat templates per kind. Arrival sits with the scene-setting beats (ring-entry is 40); the hold
// sits above them because it is the one line that changes what the commander does next.
const BEATS = {
  arrive: (d) => ({
    key: `surface-arrive-${bandFor(d.driving)}`, priority: 44, interrupt: false, live: false, mood: 'calm',
    inputs: { site: d.siteIndex != null ? String(d.siteIndex) : 'this signal', body: d.body || 'the surface' },
  }),
  // Two states. The ship does NOT move on her own — only a RECALL brings her — and during Rhino
  // ops she never lands at all: she hovers ~30 m up, the Rhino drops from her and docks back into
  // her. "near" = the app knows where she is (the deploy point, an unmanned touchdown, or where a
  // recall brought her — see shipMoveKind) and the SRV is within reach of that spot. "far" = she
  // is not within reach, or the app lost her (a relog: she is simply not there until recalled).
  hold: (d) => ({
    key: d.ship === 'near' ? 'surface-hold-near' : 'surface-hold-far',
    priority: 56, interrupt: false, live: false, mood: 'calm',
    inputs: {},
  }),
  // TIME-BASED: armed on arrival at a signal with a logged commodity, fired by surfaceMining.js only
  // after a while on site with none of it in the refinery. Never fires without a commodity — the
  // line names something, so there has to be something on file to name.
  target: (d) => (d.commodity ? {
    key: 'surface-target', priority: 42, interrupt: false, live: false, mood: 'calm',
    inputs: { commodity: String(d.commodity), site: d.siteIndex != null ? String(d.siteIndex) : 'this signal' },
  } : null),
  // The ship leaving on her own once the SRV drives out of range (or on a dismiss) — Liftoff with
  // PlayerControlled: false. The co-pilot is the one flying it up.
  'ship-away': () => ({
    key: 'surface-ship-away', priority: 50, interrupt: false, live: false, mood: 'calm',
    inputs: {},
  }),
  // The commander pressed RECALL. The journal has no event for it, but the game tells on itself:
  // the moment the ship's AI takes over it re-emits SAASignalsFound for every mapped body in
  // range — while the commander is sitting in an SRV or standing on the surface, where the DSS
  // cannot fire. On foot she lands ~30 s later (26–33 s in 25 of 26 recalls on file); from the
  // Rhino she hovers and gets boarded 40–75 s later. The same burst precedes an auto-departure
  // by 3 s, which is what shipMoveKind and the departure window are for. She IS coming: this is
  // the one place "on my way" is true — still never "land", "set down" or "hover" (she does one
  // or the other depending on where the commander is, and the app does not know which).
  recall: () => ({
    key: 'surface-recall', priority: 52, interrupt: false, live: false, mood: 'calm',
    inputs: {},
  }),
  // Stepping out of the SRV onto the surface (Disembark SRV:true, OnPlanet). Keyed by the body's
  // surface temperature ON FILE — the scan the commander did — and by nothing when there is none:
  // the unknown pool makes no temperature claim at all.
  foot: (d) => ({
    key: `surface-foot-${tempBand(d.tempK)}`, priority: 46, interrupt: false, live: false, mood: 'calm',
    inputs: { body: d.body || 'the surface' },
  }),
};

/**
 * Drain the freshest queued surface moment into a beat candidate, or null.
 * Stale entries (older than a minute) are dropped — a reaction delivered late reads as a bug,
 * not a character.
 */
export function detectSurfaceBeat() {
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

/**
 * Which commodity the commander is out here FOR. Not the most-pulled, not the most-sighted — the
 * most VALUABLE thing logged at the signal, because that is what anyone drives to a rock for. And
 * nothing at all below the floor: a nudge about copper is worse than silence.
 *
 * @param {Iterable<string>} names   commodities the ledger has for this signal, canonical spelling
 * @param {(c: string) => number|null|undefined} priceOf   credits per tonne
 * @param {number} [minCr]           the floor — the commander's "90k or above"
 * @returns {string|null}
 */
export const TARGET_MIN_CR = 90_000;
export function pickTargetCommodity(names, priceOf, minCr = TARGET_MIN_CR) {
  let best = null;
  for (const c of new Set(names)) {
    if (!c) continue;
    const cr = Number(priceOf(c)) || 0;
    if (cr < minCr) continue;
    if (!best || cr > best.cr) best = { c, cr };
  }
  return best ? best.c : null;
}

// ---- the ship's AI taking over: recall or departure ------------------------------------------
// Empirical (every journal on this PC, 2018–2026): an SAASignalsFound burst seen from an SRV or on
// foot is followed by an unmanned Liftoff within 3 s when she is LEAVING (drove out of range), and
// by nothing at all when she is COMING (recall) — then a landing ~30 s later on foot, a boarding
// 40–75 s later from the Rhino. The pusher waits out the window before calling it a recall.
export const BURST_DEPARTURE_WINDOW_MS = 5_000;
export const RECALL_ARRIVAL_MS = 30_000;

/**
 * @param {number} burstAtMs   when the SAASignalsFound burst was written
 * @param {number|null} liftoffAtMs   an unmanned Liftoff seen since, or null
 * @returns {'departure'|'recall'}
 */
export function shipMoveKind(burstAtMs, liftoffAtMs) {
  if (Number.isFinite(liftoffAtMs) && Number.isFinite(burstAtMs)
    && liftoffAtMs >= burstAtMs - 1_000 && liftoffAtMs - burstAtMs <= BURST_DEPARTURE_WINDOW_MS) return 'departure';
  return 'recall';
}

/**
 * Surface temperature (K) → the on-foot pool. Same bands the live dossier uses (copilotContext
 * dossierFlavour): under 255 K cold, over 350 K hot, between them mild; nothing on file → unknown.
 */
export function tempBand(k) {
  const n = Number(k);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  if (n < 255) return 'cold';
  if (n > 350) return 'hot';
  return 'mild';
}

/**
 * The body's surface temperature as the app has it: the commander's own scan first
 * (journalExplorationCache), else the scouted cache (Spansh). Null when neither has it — a line
 * never guesses. Body names are unique galaxy-wide, so a missing system address still resolves.
 */
export function surfaceTempFromState(state, systemAddress, bodyName) {
  if (!state || !bodyName) return null;
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const scans = state.journalExplorationCache || {};
  const scouted = state.scoutedSystems || {};
  const addr = systemAddress != null ? String(systemAddress) : '';
  const addrs = addr && (scans[addr] || scouted[addr]) ? [addr] : [...new Set([...Object.keys(scans), ...Object.keys(scouted)])];
  for (const a of addrs) {
    const scanned = ((scans[a] || {}).scannedBodies || []).find((b) => b && eq(b.bodyName, bodyName));
    if (scanned && Number.isFinite(Number(scanned.surfaceTemperature)) && Number(scanned.surfaceTemperature) > 0) return Number(scanned.surfaceTemperature);
    const cached = ((scouted[a] || {}).cachedBodies || []).find((b) => b && eq(b.name, bodyName));
    if (cached && Number.isFinite(Number(cached.surfaceTemperature)) && Number(cached.surfaceTemperature) > 0) return Number(cached.surfaceTemperature);
  }
  return null;
}

/** Test hook: forget everything queued. */
export function _resetSurfaceQueue() { queue.length = 0; }
