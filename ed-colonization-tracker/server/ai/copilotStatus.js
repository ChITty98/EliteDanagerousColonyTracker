// server/ai/copilotStatus.js
//
// Status.json gives a LIVE state vector the journal doesn't — a Flags bitfield +
// Pips that update every few seconds. We poll it and fire the co-pilot on the
// RISING EDGE of notable flags (fuel just got low, hardpoints just deployed,
// flight-assist just went off, etc.) — never on every write, and never on the
// falling edge. Synthetic events flow through the normal runCopilot path, so the
// arbiter gates them like everything else. Anti-invention holds: we only react to
// flags actually present in Status.json.

import fs from 'node:fs';
import path from 'node:path';
import { runCopilot } from './copilot.js';
import { setNavDestination } from './copilotContext.js';

// ED Status.json Flags bit positions.
const FLAGS = {
  FlightAssistOff: 1 << 5,
  LowFuel: 1 << 19,   // < 25%
  OverHeating: 1 << 20, // > 100%
  NightVision: 1 << 28,
};
// NOTE: a weapons-deployed beat (HardpointsDeployed = Flags 1 << 6) was deliberately DROPPED — the raw
// flag is true for the Discovery Scanner HONK, mining lasers, AND combat alike, which produced false
// "combat posture" lines. It is BUILDABLE later IF gated to combat-intent hardpoints: exclude the honk
// (a recent FSSDiscoveryScan / Discovery-Scanner signature) and mining contexts, or require a
// threat / under-attack signal. The bar is "we can tell a honk from weapons" — fire on the real
// condition, not the blunt flag.
// Flags2 — the second Status.json bitfield.
const FLAGS2 = {
  FsdScoActive: 1 << 20, // Supercruise Overcharge (verified 2026-06-29: Flags2 0->1048576 on engage)
  FsdScaActive: 1 << 21, // Supercruise Assist — co-pilot flying the cruise (verified 2026-06-29: Flags2 bit 21 / 2097152)
};
const ASSIST_REACT_MS = 10 * 60 * 1000; // SCO/SCA fire on nearly every cruise leg — react rarely

let lastMtime = 0;
let lastFlags = null;  // null until the first read establishes a baseline
let lastFlags2 = null; // null until the first read establishes a baseline
let lastSysPips = null;
let lastScoAt = 0;

/** Poll Status.json; on a notable rising transition, fire the co-pilot. */
export function pollStatus(journalDir, deps) {
  const file = path.join(journalDir, 'Status.json');
  let st;
  try { st = fs.statSync(file); } catch { return; }
  if (st.mtimeMs <= lastMtime) return;
  lastMtime = st.mtimeMs;

  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  const flags = typeof data.Flags === 'number' ? data.Flags : 0;
  const flags2 = typeof data.Flags2 === 'number' ? data.Flags2 : 0;
  const pips = Array.isArray(data.Pips) ? data.Pips : null;
  const sysPips = pips ? pips[0] : null; // half-pips, 0..8 (8 = full 4 pips to SYS)
  // Nav-locked destination (the target we're cruising to) → lets the arrival beat tell a CARRIER
  // drop from a body/site drop. Updated on every Status write, even when no beat fires.
  setNavDestination((data.Destination && data.Destination.Name)
    ? { name: String(data.Destination.Name), system: data.Destination.System || null, body: data.Destination.Body || null }
    : null);

  const events = [];
  const now = new Date().toISOString();
  const rose = (mask) => lastFlags !== null && !(lastFlags & mask) && (flags & mask) !== 0;
  const rose2 = (mask) => lastFlags2 !== null && !(lastFlags2 & mask) && (flags2 & mask) !== 0;

  if (rose(FLAGS.LowFuel)) events.push({ event: 'StatusLowFuel', timestamp: now });
  if (rose(FLAGS.FlightAssistOff)) events.push({ event: 'StatusFlightAssistOff', timestamp: now });
  if (rose(FLAGS.NightVision)) events.push({ event: 'StatusNightVision', timestamp: now });
  // Supercruise Overcharge just engaged — the COMMANDER flooring the FSD for a speed
  // burst. NOT while Supercruise Assist is flying (that's the co-pilot, not the
  // commander — the sca beat owns that, so the "you floored it" framing would be wrong).
  if (rose2(FLAGS2.FsdScoActive) && !(flags2 & FLAGS2.FsdScaActive) && Date.now() - lastScoAt > ASSIST_REACT_MS) {
    lastScoAt = Date.now();
    events.push({ event: 'StatusScoActive', timestamp: now });
  }
  // Supercruise Assist just engaged — the CO-PILOT now flying the cruise leg, hands-off for the
  // commander. This is a control HANDOFF the commander always wants acknowledged ("my ship"), so it
  // fires on EVERY engage — NO rate limit. The rising-edge check (rose2) already stops it re-firing
  // while assist stays on; only a fresh 0->1 transition counts.
  if (rose2(FLAGS2.FsdScaActive)) {
    events.push({ event: 'StatusScaActive', timestamp: now });
  }
  // Pips swung to full shields — a deliberate "expecting trouble" config (this
  // commander's baseline is engines), so the swing is the signal.
  if (sysPips === 8 && lastSysPips !== null && lastSysPips < 8) {
    events.push({ event: 'StatusPipsShields', timestamp: now });
  }

  lastFlags = flags;
  lastFlags2 = flags2;
  if (sysPips !== null) lastSysPips = sysPips;

  if (events.length === 0) return;
  Promise.resolve(runCopilot({ allEvents: events }, deps.readState(), deps))
    .catch((e) => console.error('[Copilot] status poll:', e && e.message));
}
