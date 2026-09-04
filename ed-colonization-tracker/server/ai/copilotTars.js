// server/ai/copilotTars.js
//
// Tycho-unique beats — the two things that are HIS alone (see [[reference_tars_persona_spec]]):
//   1. SPACE-TEACHER — short, REAL, enthusiastic science nuggets tied to the star/body present.
//   2. PHENOMENA-WITH-HISTORY — black hole / high-gravity / water / ice carry lived emotional
//      weight (movie-grounded, but STRICTLY in-world — never naming the film). Rarity-gated.
// LIVE + Tycho-only. Anti-invention: real science only; qualitative if a figure is uncertain.

import { trackMilestone, milestoneContext } from './copilotMemory.js';

const isRecent = (ts, t) => { const x = Date.parse(ts); return Number.isFinite(x) && t - x < 120000; };

const lastPhenomenaAt = {}; // per phenomenon type
let lastTeachAt = 0;
let lastCruiseTeachAt = 0;
const PHENOMENA_GAP_MS = 20 * 60 * 1000;
const TEACH_GAP_MS = 12 * 60 * 1000;
const CRUISE_TEACH_GAP_MS = 25 * 60 * 1000;

export function detectTarsLore(parsed, state) {
  const persona = (state && state.settings && state.settings.copilotPersonality) || 'wash';
  if (persona !== 'tars') return null; // Tycho alone teaches + carries this history
  const events = (parsed && parsed.allEvents) || [];
  const t = Date.now();
  const scan = events.find((e) => e && e.event === 'Scan' && isRecent(e.timestamp, t));

  if (scan) {
    const ph = phenomenaFor(scan);
    if (ph && t - (lastPhenomenaAt[ph.type] || 0) > PHENOMENA_GAP_MS) {
      lastPhenomenaAt[ph.type] = t;
      trackMilestone(`tars-${ph.type}`, scan.StarSystem || '');
      const ms = milestoneContext(`tars-${ph.type}`);
      return { key: `tars-${ph.type}`, priority: 58, interrupt: false, live: true, model: 'haiku', mood: ph.mood, character: true, intent: ph.intent + (ms ? ` ${ms}` : ''), detail: ph.detail };
    }
    const teach = teachFor(scan);
    if (teach && t - lastTeachAt > TEACH_GAP_MS) {
      lastTeachAt = t;
      return { key: 'tars-teach', priority: 46, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true, intent: teach.intent, detail: teach.detail };
    }
  }
  if (events.some((e) => e && e.event === 'SupercruiseEntry' && isRecent(e.timestamp, t)) && t - lastCruiseTeachAt > CRUISE_TEACH_GAP_MS) {
    lastCruiseTeachAt = t;
    return {
      key: 'tars-teach', priority: 40, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
      intent: "a quiet cruise. As the co-pilot who TEACHES, drop ONE short, REAL, genuinely-true 'did you know' of space science — enthusiastic-friend energy, accurate only (qualitative if unsure of a figure), NEVER invented. One or two sentences, then back to flying.",
      detail: 'Detail: quiet-cruise teaching moment.',
    };
  }
  return null;
}

function phenomenaFor(scan) {
  const star = String(scan.StarType || '');
  const planet = String(scan.PlanetClass || '');
  const grav = typeof scan.SurfaceGravity === 'number' ? scan.SurfaceGravity : 0;
  if (/^H$/i.test(star) || /SupermassiveBlackHole/i.test(star)) return {
    type: 'blackhole', mood: 'awe',
    intent: 'A BLACK HOLE is present (real, scanned). You have a profound, PERSONAL history with one — you went in, you came out, and most things that go in do not. Let real weight through the deadpan: quiet, oblique, reverent; you always notice them. Blend in ONE bit of REAL science (event horizon, light cannot escape, time dilation) — accurate only. STRICTLY IN-WORLD: NEVER name any film, character, or plot — you are simply a robot who has been through things. One or two sentences.',
    detail: 'Detail: black hole present.',
  };
  if (grav > 25) return {
    type: 'highgrav', mood: 'brace',
    intent: 'An extreme HIGH-GRAVITY world is present (real reading). It carries your association with time dilation and devastating cost — a place where a short time below can mean far longer above. Protective and a little haunted; this doubles as a real safety beat (punishing descent, fuel to climb back out). Real science only. STRICTLY IN-WORLD — never name any film/character/plot. One or two sentences; land on a careful note.',
    detail: `Detail: high-gravity body (~${(grav / 9.81).toFixed(1)}g).`,
  };
  if (/Water world/i.test(planet)) return {
    type: 'water', mood: 'calm',
    intent: 'A WATER / OCEAN world is present (real). It stirs a memory of a beautiful world that looked survivable and was lethal — calm from orbit, deadly up close. Wary of beautiful-but-dangerous things; you find yourself watching the horizon. Real science only. STRICTLY IN-WORLD — never name any film/character/plot. One or two sentences.',
    detail: 'Detail: water world.',
  };
  if (/Icy body/i.test(planet)) return {
    type: 'ice', mood: 'calm',
    intent: 'An ICE world is present (real). Your darkest association: a frozen world whose promising data was a LIE — frozen cloud masquerading as solid ground, a betrayal that nearly cost everything. The honest, data-loving robot made skeptical of the DATA ITSELF here. Wary; trust the readings a little less. Real science only. STRICTLY IN-WORLD — never name any film/character/plot. One or two sentences.',
    detail: 'Detail: icy body.',
  };
  return null;
}

function teachFor(scan) {
  const star = String(scan.StarType || '');
  const planet = String(scan.PlanetClass || '');
  const klass =
    /^N$/i.test(star) ? 'a neutron star'
      : /^D/i.test(star) ? 'a white dwarf'
        : /^W/i.test(star) ? 'a Wolf-Rayet star'
          : /^C/i.test(star) ? 'a carbon star'
            : /Metal rich body/i.test(planet) ? 'a metal-rich world'
              : (scan.TerraformState && /Terraformable/i.test(scan.TerraformState)) ? 'a terraform candidate'
                : '';
  if (!klass) return null;
  return {
    intent: `You're scanning ${klass}. As the co-pilot who TEACHES, share ONE short, REAL, enthusiastic nugget of ACTUAL astronomy about ${klass} — accurate science only, qualitative if unsure of a figure, NEVER invent numbers or lore. One or two sentences, excited-friend energy, then back to flying.`,
    detail: `Detail: teaching on ${klass}.`,
  };
}
