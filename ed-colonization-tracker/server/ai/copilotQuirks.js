// server/ai/copilotQuirks.js
//
// Undisclosed per-persona quirks — CONCRETE, characterful triggers tied to
// specific, evocative things at the RIGHT moment (a black hole spooks Wash; a
// brutal-gravity LANDING makes him feel it). Naturally rare (you don't scan black
// holes often), and arbiter-gated on top. Anti-invention holds — every trigger is
// a real journal value. Meant to be met in play, not announced.
//
// (Replaces an earlier statistical-percentile approach that mis-fired on scans
// and skewed on non-landable bodies.)

import { trackMilestone, milestoneContext } from './copilotMemory.js';

function quirkBeat(key, intent, ev) {
  return {
    key, priority: 58, interrupt: false, live: true, model: 'haiku', mood: 'awe', character: true,
    inputs: { body: (ev && ev.BodyName) || null },
    intent,
  };
}

// A body's surface gravity (in G) / atmosphere from its prior scan — Touchdown and
// Liftoff carry neither, so we look them up from the exploration cache.
function bodyField(state, bodyName, field) {
  if (!bodyName) return null;
  const cache = (state && state.journalExplorationCache) || {};
  for (const addr of Object.keys(cache)) {
    for (const b of ((cache[addr] && cache[addr].scannedBodies) || [])) {
      if (b && b.bodyName === bodyName && b[field] != null) return b[field];
    }
  }
  return null;
}
const bodyGravity = (state, name) => { const g = bodyField(state, name, 'gravity'); return typeof g === 'number' ? g : null; };
const bodyAtmosphere = (state, name) => bodyField(state, name, 'atmosphereType');

const isBlackHole = (ev) => ev.StarType === 'H' || ev.StarType === 'SupermassiveBlackHole';
const isNeutron = (ev) => ev.StarType === 'N';
const isEarthlike = (ev) => /earth/i.test(ev.PlanetClass || '');

// (Ship cockpit-size / single-seat attributes now live in extractor.js — isCrampedShip /
// isSingleSeatShip, the single source of truth. The K2 cramped-cockpit grumble and the single-seat
// "stuck in the hold" grumble are now ONE path in copilotAffinity's Loadout/ShipyardSwap greeting,
// branched on those two attributes — no separate drifting SMALL_SHIPS set here any more.)

/** A concrete, persona-specific quirk for this tick, or null. Arbiter-gated downstream. */
export function detectQuirk(parsed, state, persona) {
  if (!persona) return null;
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };

  for (const ev of events) {
    if (!ev || !isRecent(ev.timestamp)) continue;

    // Wash is unnerved by black holes (scanning one).
    if (persona === 'wash' && ev.event === 'Scan' && isBlackHole(ev)) {
      trackMilestone('blackhole', ev.StarSystem || '');
      const ms = milestoneContext('blackhole');
      return quirkBeat('quirk-blackhole', `You just scanned a BLACK HOLE. React as Wash — genuinely spooked by a hole in the universe that eats light itself; he does not like being near it and would really rather not get any closer. Human, rattled, a little funny about being rattled.${ms ? ` ${ms}` : ''}`, ev);
    }

    // Wash FEELS a brutal-gravity world — but only on the LANDING, not from orbit.
    if (persona === 'wash' && ev.event === 'Touchdown') {
      const g = bodyGravity(state, ev.Body || ev.BodyName);
      if (g != null && g >= 3) {
        return quirkBeat('quirk-gravity-land', `You just set down on a world pulling roughly ${g.toFixed(1)} G — genuinely brutal. React as Wash, all sensory: the crushing weight, pinned in the seat, arms made of lead, getting up will be a whole project.`, ev);
      }
    }

    // Wash + sulphur dioxide world — the SMELL in the scrubbers, on landing or liftoff.
    // Baked-in / documented (only the human registers smell).
    if (persona === 'wash' && (ev.event === 'Touchdown' || ev.event === 'Liftoff')) {
      const atmo = bodyAtmosphere(state, ev.Body || ev.BodyName);
      if (/sulphur ?dioxide|sulfur ?dioxide/i.test(String(atmo || ''))) {
        return quirkBeat('quirk-sulphur', 'You just landed on / lifted off a SULPHUR DIOXIDE world. React as Wash — only the human registers smell: that sulphur stink gets into the air scrubbers and does NOT leave, you will be smelling this world for a week. Grumbly, funny, resigned. Worth it. Probably.', ev);
      }
    }

    // K2's tactical read on a soft, living world.
    if (persona === 'k2' && ev.event === 'Scan' && isEarthlike(ev)) {
      trackMilestone('earthlike', ev.StarSystem || '');
      const ms = milestoneContext('earthlike');
      return quirkBeat('quirk-earthlike-k2', `You just scanned an EARTH-LIKE WORLD. React as K2 — the security read on a soft, living, defenceless place: he clocks its (nonexistent) defenses out of old habit, judges it both worth protecting and easy to take, and is faintly unsettled to find he cares which.${ms ? ` ${ms}` : ''}`, ev);
    }

    // TARS and a neutron star — precise, flat fascination.
    if (persona === 'tars' && ev.event === 'Scan' && isNeutron(ev)) {
      return quirkBeat('quirk-neutron-tars', 'You just scanned a NEUTRON STAR. React as TARS — precise and, in his flat way, faintly reverent: the absurd density, the mathematics of it, a teaspoon of it outweighing this entire ship. He could study it indefinitely and notes, dryly, that he will not.', ev);
    }

    // Wash squints at a blinding O/B-type star on arrival (human eyes, human gripe).
    if (persona === 'wash' && ev.event === 'FSDJump' && /^[ob]/i.test(String(ev.StarClass || ''))) {
      return quirkBeat('quirk-bright-star', `You just jumped in beside a blazing ${ev.StarClass}-class star — blinding. React as Wash, human eyes: the glare like staring into a welder, wanting to angle away, his retinas filing a formal complaint.`, ev);
    }

    // (K2's cramped-cockpit grumble on a swap moved to copilotAffinity's swap greeting, where it is
    // branched against the single-seat "in the hold" grumble — one path, no overlap.)
  }
  return null;
}
