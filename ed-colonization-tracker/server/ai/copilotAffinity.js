// server/ai/copilotAffinity.js
//
// The persona affinity matrix → LIVE, arbiter-gated reaction beats. Each persona
// only perks up at what fits their character (Wash/Agriculture, TARS/High Tech,
// K2/Military+Industrial, etc.). These are LIVE (the reaction references the
// specific economy / allegiance / world), but the salience arbiter keeps them
// rare — once or twice per place, never every dock. FLAVOUR ONLY: an affinity
// never changes how helpful the co-pilot is, and never invents game state.
//
// v1 covers economy, superpower, body/feature, station services, and a basic
// ship reaction. Deferred (need roster research / market cross-ref): the
// single-seat constraint, ship role/vintage/tenure, and the occasional
// real-commodity garnish.

import { isSingleSeatShip, isCrampedShip, shipRole } from '../journal/extractor.js';
import { getMemory, saveMemory } from './copilotMemory.js';
import { liveCarrierFreeSpace } from './copilotContext.js';

// Economy (StationEconomy) → per-persona stance text folded into the intent.
const ECONOMY = {
  Agriculture: { wash: 'loves it — food, comfort, real coffee, the good things in life' },
  'High Tech': { tars: 'values it — advanced engineering, the good components' },
  Industrial: { k2: 'respects it — this system MAKES things (composites, fabricators)' },
  Military: { k2: 'respects it — strength and defense, his kind of place' },
  Extraction: {
    wash: 'likes the frontier honesty — rough, get-things-done, nobody checking paperwork too close',
    tars: 'feels mild disdain — raw, unrefined, the dirty input to better things',
    k2: 'is comfortable here — tough, lawless, an industrial edge',
  },
  Refinery: { tars: 'mildly approves — the processing step toward what he values' },
  Tourism: {
    wash: 'enjoys it — a view worth seeing, plus wealthy tourists and loose credits he notices out loud',
    tars: 'is indifferent, characterfully so — "produces experiences; I do not experience"',
    k2: 'DISLIKES it most — a combat droid among vacationers; no threats, no purpose, wants to leave',
  },
};

// Superpower (SystemAllegiance) → per-persona political stance.
const SUPERPOWER = {
  Alliance: { wash: 'likes it — independent, nobody telling you how to fly' },
  Federation: {
    wash: 'dislikes it — controlling, gives him the creeps',
    tars: 'approves — orderly, democratic, efficient, fits his nature',
  },
  Empire: {
    wash: 'dislikes it — too clean and obedient, creeps him out',
    k2: "is at his former employer's door — a defector's familiarity and detachment; he knows the protocols, no longer loyal",
  },
};

// Per-persona reaction to a ship's ROLE (what it was built for).
const ROLE_STANCE = {
  combat: {
    wash: 'a fighting ship — teeth and speed, his hands itch on the stick; a little nervous about what the teeth invite',
    tars: 'a combat hull — capable at what it does, but not what interests him most (he values range and discovery)',
    k2: 'a combat ship — his element, built for what he was built for; approval he does not bother to hide',
  },
  hauler: {
    wash: 'a working hauler — sky is a commute in this thing, flies it for the paycheque not the thrill',
    tars: 'a cargo hauler — purpose-built logistics; he respects the engineering simplicity',
    k2: 'a cargo hauler — slow, unarmed, no threat capability; endured',
  },
  explorer: {
    wash: 'an explorer — range and sensors, built to go far and see things nobody has',
    tars: 'an exploration vessel — this is what he values MOST: range, sensors, the tools to understand what you find',
    k2: 'an explorer — no armour, no teeth, built to run; uncomfortably exposed for his tastes',
  },
  passenger: {
    wash: 'a passenger liner — elegant, comfortable, someone else is paying for all of this',
    tars: 'a passenger vessel — fragile cargo that complains; an interesting logistics problem',
    k2: 'a passenger liner — soft, luxurious, defenceless; everything he is not',
  },
  multi: {
    wash: 'a jack-of-all-trades — she can do anything, master of none, but that flexibility is freedom',
    tars: 'a multi-role hull — adaptable; he respects the engineering compromise but prefers specialisation',
    k2: 'a multi-role ship — it can fight if it needs to, which is the only thing that matters',
  },
};

// Three truly-ancient hull designs with centuries of in-lore service — not an axis, just
// heritage flavour. TARS leads (respects the history); Wash nods softly; K2 is indifferent.
const HERITAGE = {
  sidewinder: 'one of the oldest hull designs still flying — centuries of service, the ship that taught half the galaxy to fly',
  python: 'a hull design with centuries of service — one of the oldest still in production, a workhorse across every era of human expansion',
  anaconda: 'a hull with centuries of lineage — backbone of long-range exploration and heavy operations since before most stations were built',
};

function shipTenure(state, shipType) {
  const usage = state && state.journalScan && state.journalScan.shipUsage;
  if (!usage || !usage.ships) return null;
  const s = usage.ships[String(shipType).toLowerCase()];
  return s && typeof s.hours === 'number' ? s.hours : null;
}

function tenureFlavour(hours) {
  if (hours == null) return '';
  if (hours >= 200) return `an old friend — about ${hours} hours in this hull together`;
  if (hours >= 50) return `well-worn — about ${hours} hours in this hull`;
  if (hours >= 10) return `getting familiar — ${hours} hours so far`;
  if (hours >= 1) return `still fresh — only ${hours} hours in this hull`;
  return '';
}

let lastShipType = ''; // so ship reactions fire on a real hull change, not module tweaks
let lastSingleSeat = null;              // was the previous hull single-seat? → greet crossing the co-pilot-seat boundary
let currentShip = '';                   // the hull we're flying NOW (from LoadGame/Loadout/ShipyardSwap)
const shipReactedAt = new Map();        // shipType -> ts of last ship reaction (periodic, not every dock)
const SHIP_REACT_MS = 90 * 60 * 1000;   // at most one ship-feel reaction per hull per 90 min
const powerplaySaid = new Map();        // system -> ts (powerplay reaction once per system per session-ish)
const POWERPLAY_MS = 6 * 60 * 60 * 1000;
const anarchySaid = new Map();          // system -> ts (populated-anarchy comment once per system per ~6h)
const ANARCHY_MS = 6 * 60 * 60 * 1000;
let lastEmptySysAt = 0;                 // empty-system character beat — occasional, not every hop
const EMPTY_SYS_MS = 12 * 60 * 1000;
// Star class → what the light out the canopy is actually like (persona-agnostic, class letter only).
const STAR_LOOK = {
  O: 'a blazing blue O-class giant — hard, violent light', B: 'a blue-white B-class star, bright enough to squint at',
  A: 'a white A-class star, clean cold light', F: 'a yellow-white F-class star',
  G: 'a yellow G-class star, sunlike and warm-looking', K: 'an orange K-class star, low amber light',
  M: 'a dim red M-dwarf, everything bathed in rust', L: 'a dark L-class dwarf, barely a glow',
  T: 'a T-class brown dwarf, more ember than star', Y: 'a Y-class dwarf, so cold it barely shines',
  D: 'a white dwarf — a dead star, tiny and fierce', N: 'a neutron star', H: 'a black hole',
};
const slaverySaid = new Map();          // marketId -> ts (slave-market beat once per station per window)
const SLAVERY_MS = 6 * 60 * 60 * 1000;  // you hit the build station all day → at most once per ~session
// (carrier tritium watch → copilotContext.detectCarrierFuel, state-driven)

function cleanEcon(s) {
  const m = String(s || '').match(/economy_(\w+)/i);
  return m ? m[1].replace(/([a-z])([A-Z])/g, '$1 $2') : '';
}

function econKey(localised, raw) {
  const e = localised || cleanEcon(raw);
  if (/high\s*tech/i.test(e)) return 'High Tech';
  for (const k of Object.keys(ECONOMY)) if (k.toLowerCase() === e.toLowerCase()) return k;
  return e;
}

function serviceHit(services, persona) {
  const set = (services || []).map((s) => String(s).toLowerCase());
  const has = (k) => set.some((s) => s.includes(k));
  if (persona === 'k2' && has('blackmarket')) return "a black market — his old enforcer programming says disapprove; that programming has been edited (unbothered, faintly amused)";
  if (persona === 'tars' && (has('materialtrader') || has('techbroker'))) return 'optimization tools — a Material Trader / Tech Broker he appreciates';
  if (persona === 'wash' && has('bartender')) return 'a bar — human comforts, somewhere to actually unwind';
  return null;
}

function bodyStance(ev, persona) {
  const pc = String(ev.PlanetClass || '').toLowerCase();
  const volc = String(ev.Volcanism || '').toLowerCase();
  if (persona === 'tars' && pc.includes('metal rich')) return 'a Metal-Rich body — mostly the good elements, genuinely useful (rarer than ordinary high-metal-content)';
  if (persona === 'wash' && /geyser/.test(volc)) return 'geysers — nature putting on a show, pure spectacle';
  if (persona === 'k2' && volc && !/^no /.test(volc)) return 'active volcanism — a hostile, indifferent world he respects (watch the heat)';
  return null;
}

function shipKinship(shipType, persona) {
  const t = String(shipType || '').toLowerCase();
  // K2's ship gripe, branched by attribute: SINGLE-SEAT (no cockpit seat → flies from the hold; the
  // roomy Type-6/7/8 are this but NOT cramped) vs CRAMPED (small flight deck → folded in). Both can apply.
  if (persona === 'k2' && isSingleSeatShip(t)) return isCrampedShip(t)
    ? 'a cramped single-seater — a heavy combat frame folded into a tiny cockpit, and no co-pilot seat besides; grumpy on both counts'
    : 'a hull with no co-pilot seat — roomy enough (he is NOT cramped), but he flies it from the CARGO HOLD, not the cockpit, and is grumpy about being stuck in the back';
  if (persona === 'k2' && isCrampedShip(t)) return 'a cramped flight deck — a heavy combat frame folded into a cockpit built for someone half his size; openly, characterfully grumpy about it';
  const heritage = HERITAGE[t];
  if (heritage) {
    if (persona === 'tars') return `${heritage} — TARS knows the history and respects it; a teaching moment about the design lineage`;
    if (persona === 'wash') return `${heritage} — an old design that still flies; there is something to that`;
  }
  if (persona === 'k2' && t.includes('imperial')) return "Gutamaya / Imperial lines — the rounded shape he's built like; a bittersweet kinship he won't quite admit";
  if (persona === 'tars' && /(cobra|python|anaconda|krait|viper|sidewinder)/.test(t)) return 'a Faulcon DeLacy hull — he finds the design language agreeable, an aesthetic lineage they share';
  // Wash: the big slow cargo bricks (Panther Clipper, Type-7/9/10, Cutter, Beluga) are the
  // OPPOSITE of what he loves — he flies them for the job, not the joy, and says so.
  if (persona === 'wash' && /(panther|type.?7|type.?9|type.?10|cutter|beluga)/.test(t)) return "a vast, slow cargo BRICK — the exact opposite of the nimble ship he loves; he flies it because the JOB demands it, not for one second of joy, and he'll cheerfully complain about it";
  if (persona === 'wash' && /(sidewinder|eagle|viper|cobra|dolphin|asp|courier|diamondback|mamba|fer.?de.?lance)/.test(t)) return 'a ship you actually FEEL in the turns — exactly his kind; let the affection show';
  return null;
}

function shipTaste(persona) {
  if (persona === 'wash') return 'Wash loves nimble, experiential ships you FEEL in the turns, and grumbles in a flying brick';
  if (persona === 'tars') return 'TARS cares about efficiency and capability — jump range, thermals, cargo ratio, good engineering — not "fun"';
  return 'K2 respects tough, combat-capable, heavy ships and is physically uncomfortable folded into a cramped cockpit';
}

// A periodic, in-character read on the hull we're CURRENTLY flying — so the ship gets
// remarked on even when we haven't just swapped (the #1 miss: flying a Panther Clipper for
// hours and never hearing Wash's take on it). Guarded per hull so it's occasional.
function maybeShipBeat(persona, state) {
  if (!currentShip) return null;
  const now = Date.now();
  const last = shipReactedAt.get(currentShip);
  if (last && now - last < SHIP_REACT_MS) return null;
  shipReactedAt.set(currentShip, now);
  const kin = shipKinship(currentShip, persona);
  const role = shipRole(currentShip);
  const roleStance = role && ROLE_STANCE[role] && ROLE_STANCE[role][persona];
  const tenure = shipTenure(state, currentShip);
  const tenureText = tenureFlavour(tenure);
  const hLower = String(currentShip).toLowerCase();
  const heritage = HERITAGE[hLower];
  const heritageBit = heritage && persona === 'tars' ? `This hull has HISTORY: ${heritage}.`
    : heritage && persona === 'wash' ? `An old design: ${heritage}.` : '';
  const layers = [
    `Right now you're flying a ${currentShip}. ${shipTaste(persona)}.`,
    kin ? `Specifically: ${kin}.` : '',
    roleStance ? `This is ${roleStance}.` : '',
    tenureText ? `Tenure: ${tenureText}.` : '',
    heritageBit,
    'A brief in-character read on the ship you\'re strapped into — only what you genuinely know; if unsure, speak to how it FEELS, not invented specs.',
  ].filter(Boolean).join(' ');
  return {
    key: 'affinity-ship', priority: 44, interrupt: false, live: true, model: 'sonnet', mood: 'calm', character: true,
    intent: layers,
    inputs: { ship: currentShip },
  };
}

function beat(key, intent, ev, priority) {
  return {
    key, priority: priority || 52, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true, intent,
    inputs: {
      body: (ev && ev.BodyName) || null,
      station: (ev && ev.StationName) || null,
      system: (ev && ev.StarSystem) || null,
      ship: (ev && (ev.Ship || ev.ShipType)) || null,
    },
  };
}

/**
 * A LIVE affinity beat for this event + persona, or null. The arbiter gates
 * whether it actually fires (rare per place). Never invents game state.
 */
export function detectAffinityBeat(ev, persona, hauling, state) {
  if (!ev || !persona) return null;
  // Track the hull we're flying from any event that names it, so maybeShipBeat() can react
  // to the CURRENT ship — not only at a swap (which is why the Panther Clipper was silent).
  if (ev.event === 'LoadGame' || ev.event === 'Loadout' || ev.event === 'ShipyardSwap') {
    const st = ev.Ship || ev.ShipType;
    if (st) currentShip = st;
  }
  // ...and seed it from PERSISTED state when no LoadGame/Loadout fired this session. Without this the
  // periodic ship read stays silent after a server restart while you're already in the ship — the
  // exact reason Wash never remarked on the Panther Clipper. state.currentShip.type is the hull id.
  if (!currentShip && state && state.currentShip) {
    const cs = state.currentShip;
    currentShip = (typeof cs === 'object' ? cs.type : cs) || '';
  }
  switch (ev.event) {
    // (Fleet-carrier tritium watch moved to copilotContext.detectCarrierFuel — STATE-driven off the
    // persisted fuelLevel, so it works without a live CarrierStats event and re-offers if it loses
    // arbitration. The event-edge version here sat silent while the carrier ran at 193t for days.)
    // FC docking requested — surface the carrier's REMAINING cargo capacity as a heads-up.
    case 'DockingRequested': {
      const fc = (state && state.settings) || {};
      const isMyFc = (fc.myFleetCarrierMarketId != null && ev.MarketID === fc.myFleetCarrierMarketId) || (!!fc.myFleetCarrier && ev.StationName === fc.myFleetCarrier);
      if (!isMyFc) return null;
      const callsign = fc.myFleetCarrier;
      const u = callsign && state.fleetCarrierSpaceUsage ? state.fleetCarrierSpaceUsage[callsign] : null;
      // LIVE free space (snapshot adjusted by cargo delta) — the raw CarrierStats snapshot can be
      // thousands of tonnes stale after a depositing run (18,257 vs a real 7,890 — a hard 👎).
      const free = liveCarrierFreeSpace(state, callsign);
      if (free == null) return null;
      const cn = (u && u.name) || '';
      const nearlyFull = free < 2000;
      // Frame the free space against the SHIP's cargo capacity — without it the model guesses
      // ("1,305t — not a full load" when 1,305 IS exactly one full Panther load).
      const cap = Number((state && state.settings && state.settings.cargoCapacity) || 0);
      const loads = cap > 0 ? Math.round((free / cap) * 10) / 10 : 0;
      const loadsBit = loads > 0 ? ` That is about ${loads} full ship-load${loads === 1 ? '' : 's'} of space (the ship carries ~${cap.toLocaleString()}t).` : '';
      const angle = nearlyFull
        ? 'She is nearly FULL — the useful nudge is to send the carrier to the build / drop-off and unload soon, rather than keep packing more in here.'
        : 'A brief, useful heads-up on the remaining capacity as we come in to dock.';
      return beat('fc-dock-request', `Docking requested at the commander's OWN carrier${cn ? ` (the ${cn})` : ''} — ${free.toLocaleString()}t of free cargo space left in the hold.${loadsBit} ${angle} Refer to it by NAME, never the callsign.`, ev, 51);
    }
    case 'Docked': {
      // The commander's OWN fleet carrier — home base / the mothership.
      const fc = (state && state.settings) || {};
      if ((fc.myFleetCarrierMarketId != null && ev.MarketID === fc.myFleetCarrierMarketId) || (!!fc.myFleetCarrier && ev.StationName === fc.myFleetCarrier)) {
        const cn = (fc.myFleetCarrier && state.fleetCarrierSpaceUsage && state.fleetCarrierSpaceUsage[fc.myFleetCarrier] && state.fleetCarrierSpaceUsage[fc.myFleetCarrier].name) || '';
        // WORK stop, not a homecoming scene — the "react to being HOME" framing produced waxing
        // about ownership ("nothing else out here is YOURS like that is yours") that the commander
        // hated. Useful first; one dry aside at most.
        const freeHome = liveCarrierFreeSpace(state, fc.myFleetCarrier);
        return beat('carrier-home', `Just docked at the commander's OWN fleet carrier${cn ? ` — the ${cn}` : ''}. Refer to it by its NAME${cn ? ` (${cn})` : ''}, NEVER its callsign. This is a WORK stop — be USEFUL first${freeHome != null ? `: about ${freeHome.toLocaleString()}t of cargo space free in her hold` : ''}. One dry aside is fine. Do NOT wax about it being home, being theirs, or what it means — no lyricism about ownership, no sentiment about the ship. Short.`, ev, 47);
      }
      // This station's market trades in PEOPLE — fire ONLY when slaves are actually in the stored
      // snapshot (anti-invention). Catches raw Slaves at lawless anarchy holes AND Imperial Slaves at
      // Empire stations. Guarded per station: you dock the build station all day → once-per-session.
      const snap = (state && state.marketSnapshots && ev.MarketID != null) ? state.marketSnapshots[String(ev.MarketID)] : null;
      const slaveCom = snap && Array.isArray(snap.commodities)
        ? snap.commodities.find((c) => /slav/i.test(c.commodityId || '') || /slav/i.test(c.name || '') || /slavery/i.test(c.category || ''))
        : null;
      if (slaveCom) {
        const mkKey = String(ev.MarketID);
        const lastSl = slaverySaid.get(mkKey);
        if (!(lastSl && Date.now() - lastSl < SLAVERY_MS)) {
          slaverySaid.set(mkKey, Date.now());
          const imperial = /imperial/i.test(slaveCom.commodityId || '') || /imperial/i.test(slaveCom.name || '');
          const kind = imperial
            ? "Imperial Slaves — the Empire's legalised, paperwork-dressed indenture"
            : 'raw Slaves — open human trafficking, the kind only a lawless anarchy trades in the open';
          const a = persona === 'wash'
            ? `Wash is quietly revolted — ${imperial ? "the Empire calling it 'indenture' doesn't wash the stink off" : 'this is the ugly kind, no euphemism'}. Do the job, don't linger; he wants no part of it`
            : persona === 'k2'
            ? `K2 is clinically detached — ${imperial ? 'his ex-Imperial-enforcer half respects the ORDER of it (the Empire files the paperwork); the edited rest is unbothered' : 'no law here, no pretense — he notes it without feeling, dimly aware he ought to feel something'}`
            : `TARS is honest about it — this place trades in people; he names it plainly, neither sermon nor shrug`;
          return beat('affinity-slavery', `This station's market deals in ${kind}. ${a}. FLAVOUR ONLY — react to the FACT that they trade in people; do NOT recite stock numbers or invent specifics. Voice YOUR OWN discomfort/read — never tell the commander what to do or not do (they're the captain).`, ev, 50);
        }
      }
      const fst = ev.StationFaction && ev.StationFaction.FactionState;
      if (fst && /War|CivilWar|Boom|Famine|Outbreak|Lockdown/i.test(fst)) {
        const a = persona === 'k2' ? 'K2 reads it tactically — security will be erratic, conditions he finds familiar; stay alert'
          : persona === 'wash' ? 'Wash is wary — the place has an edge now; do our business and not make friends'
          : 'TARS notes the security and market implications, factually';
        return beat('faction-state', `The controlling faction here is in ${fst}. ${a}.`, ev, 49);
      }
      if (!hauling) {
        const econ = econKey(ev.StationEconomy_Localised, ev.StationEconomy);
        const stance = econ && ECONOMY[econ] && ECONOMY[econ][persona];
        if (stance) return beat('affinity-economy', `Just docked at a ${econ} economy station. Your persona ${stance}. Lead with character; the economy is the hook, not a list.`, ev);
        const svc = serviceHit(ev.StationServices, persona);
        if (svc) return beat('affinity-service', `This station has ${svc}. A brief, characterful nod — don't list services.`, ev, 46);
      }
      return maybeShipBeat(persona, state); // quiet fallback: a read on the hull we're flying (fires even mid-haul)
    }
    case 'FSDJump': {
      // Powerplay — who controls / contests this system. Fires even mid-haul; once per system.
      const power = ev.ControllingPower;
      const powers = Array.isArray(ev.Powers) ? ev.Powers.filter(Boolean) : [];
      if (power || powers.length) {
        const sysKey = String(ev.SystemAddress || ev.StarSystem || '');
        const nowPP = Date.now();
        const lastPP = powerplaySaid.get(sysKey);
        if (!(lastPP && nowPP - lastPP < POWERPLAY_MS)) {
          powerplaySaid.set(sysKey, nowPP);
          const ppState = ev.PowerplayState ? ` (${ev.PowerplayState})` : '';
          const desc = power ? `under ${power}'s control${ppState}` : `contested between ${powers.join(' and ')}`;
          const a = persona === 'k2' ? "K2 clocks the controlling power's doctrine and what it means for enforcement here"
            : persona === 'wash' ? 'Wash would rather stay clear of Powerplay politics — just passing through, heads down'
            : 'TARS notes the controlling power and the practical security / market implications, factually';
          return beat('powerplay', `This system sits ${desc} in the Powerplay contest. ${a}. Flavour only — NEVER invent galaxy-wide standings, who is winning, or fabricated orders.`, ev, 45);
        }
      }
      const alleg = ev.SystemAllegiance;
      const stance = alleg && SUPERPOWER[alleg] && SUPERPOWER[alleg][persona];
      if (!hauling && stance) return beat('affinity-superpower', `Just crossed into ${alleg} space. Your persona ${stance}. A brief reaction to whose territory this is — flavour only, NEVER invent patrols or intel.`, ev);
      const sec = String(ev.SystemSecurity_Localised || ev.SystemSecurity || '').toLowerCase();
      // "Anarchy" only means something where PEOPLE live — ED reports every unpopulated system as
      // anarchy, which had the co-pilot crying "lawless!" on every hop through uncolonized space.
      // Populated anarchy fires once per system per ~6h (the haul loop crosses the same one all night).
      if (sec.includes('anarchy') && (ev.Population || 0) > 0) {
        const aKey = String(ev.SystemAddress || ev.StarSystem || '');
        const lastA = anarchySaid.get(aKey);
        if (!(lastA && Date.now() - lastA < ANARCHY_MS)) {
          anarchySaid.set(aKey, Date.now());
          const a = persona === 'k2' ? 'K2 is comfortable — no laws, no authority; he should find it alarming and does not'
            : persona === 'wash' ? 'Wash is nervous — nobody in charge and everybody armed; keep our heads down and cargo close'
            : 'TARS notes it factually — minimal security, elevated interdiction odds';
          return beat('faction-anarchy', `Just jumped into an ANARCHY system (no system authority). ${a}.`, ev, 50);
        }
      }
      // Empty, unclaimed space — the more common case out here. Occasional character read built
      // from what the jump actually knows (the arrival star's class), never invented bodies.
      if ((ev.Population || 0) === 0) {
        const nowE = Date.now();
        if (nowE - lastEmptySysAt > EMPTY_SYS_MS) {
          const cls = String(ev.StarClass || '').toUpperCase();
          const look = STAR_LOOK[cls] || '';
          if (look) {
            lastEmptySysAt = nowE;
            return beat('system-character', `Jumped into ${ev.StarSystem || 'a system'} — EMPTY, unclaimed space: nobody lives here, no authority, no markets. The arrival star is ${look}. React briefly in character to the emptiness or the light — the void between claims, a star nobody's named a port after. FLAVOUR ONLY: never invent bodies, stations, signals, or anything the scan hasn't shown.`, ev, 46);
          }
        }
      }
      return maybeShipBeat(persona, state);
    }
    case 'Scan': {
      const stance = bodyStance(ev, persona);
      if (stance) return beat('affinity-body', `Scanned ${ev.BodyName || 'a body'}: ${stance}. React with the specific wonder / respect / spectacle your persona feels.`, ev, 55);
      return null;
    }
    case 'Loadout':
    case 'ShipyardSwap': {
      const shipType = ev.Ship || ev.ShipType;
      if (shipType && shipType !== lastShipType) {
        lastShipType = shipType;
        shipReactedAt.set(shipType, Date.now()); // the swap IS a ship reaction; the periodic one waits
        const nowSingle = isSingleSeatShip(shipType);
        const nowCramped = isCrampedShip(shipType);
        const wasSingle = lastSingleSeat;
        lastSingleSeat = nowSingle;
        const _mem = getMemory();
        const _wasKnown = _mem.ships && _mem.ships[shipType] && _mem.ships[shipType].name;
        if (ev.ShipName) {
          if (!_mem.ships) _mem.ships = {};
          _mem.ships[shipType] = { name: ev.ShipName, firstSeenAt: (_mem.ships[shipType] && _mem.ships[shipType].firstSeenAt) || ev.timestamp || new Date().toISOString() };
          saveMemory();
        }
        const nm = ev.ShipName || shipType;
        // ONE seat-grumble path, two sub-variants by ship attribute: IN THE HOLD (single-seat → no
        // cockpit seat, even in a roomy hauler like the Type-8) and CRAMPED (small flight deck). A small
        // single-seater is both; the Type-8 is hold-only; a Cobra/Vulture is cramped-only.
        if (nowSingle && wasSingle !== true) {
          const tight = nowCramped ? ' On top of that the flight deck is cramped — a tight little hull.' : ' (Plenty of room in this hull — you are just not up front.)';
          const a = persona === 'k2' ? `You are a heavy combat frame with no cockpit station of your own, flying from the CARGO HOLD by remote.${tight} Be grumpy about being stuck in the back.`
            : persona === 'wash' ? `No seat up front — you ride in the CARGO HOLD.${nowCramped ? ' And it is a tight little hull at that.' : ''} Put-upon but wry; make the best of the luggage.`
            : `No co-pilot seat — you run things from the CARGO HOLD.${nowCramped ? ' A cramped one, no less.' : ''} Dry and deadpan about the indignity.`;
          return beat('single-seat-boarded', `Just boarded a ${nm} (${shipType}) — there is NO co-pilot seat, so you (the co-pilot) are relegated to the CARGO HOLD, flying by remote from the back. ${a} A wry one-liner, not a complaint essay.`, ev, 55);
        }
        if (!nowSingle && wasSingle === true) {
          const a = persona === 'k2' ? 'A proper station and a real view again — acceptable. Dry relief, not effusive.'
            : persona === 'wash' ? 'Relief and a stretch — a real seat, a real view, dignity restored after the cargo hold.'
            : 'Dry, understated relief at having an actual seat again.';
          return beat('single-seat-relief', `Just switched OUT of a single-seat hull into a ${nm} (${shipType}) — a ship that actually HAS a co-pilot seat. React in character to finally having a proper seat and a real forward view again after riding in the cargo hold. ${a} A wry one-liner.`, ev, 55);
        }
        // CRAMPED but NOT single-seat — he has a seat, it's just a tight fit (K2's big-frame gripe; the
        // single-seat "in the hold" case above already folds in cramped when a hull is both).
        if (nowCramped && persona === 'k2') {
          return beat('cramped-cockpit', `Just switched into a ${nm} (${shipType}) — a small, cramped flight deck. React as K2: a large combat frame folded into a cockpit built for someone half his size, packed in, pointedly and repeatedly displeased.`, ev, 55);
        }
        const kin = shipKinship(shipType, persona);
        const role = shipRole(shipType);
        const roleStance = role && ROLE_STANCE[role] && ROLE_STANCE[role][persona];
        const tenure = shipTenure(state, shipType);
        const tenureText = tenureFlavour(tenure);
        const nameCallback = _wasKnown && ev.ShipName === _wasKnown ? `You KNOW this ship — "${_wasKnown}" — you've flown her before.` : '';
        const parts = [
          `Just switched into a ${ev.ShipName || shipType} (${shipType}). ${shipTaste(persona)}.`,
          kin ? `Also: ${kin}.` : '',
          roleStance ? `This is ${roleStance}.` : '',
          tenureText ? `Tenure: ${tenureText}.` : '',
          nameCallback,
          'React in character to flying THIS ship — only to what you genuinely know about it; if unsure, speak to how it feels, not invented specs.',
        ].filter(Boolean).join(' ');
        return beat('affinity-ship', parts, ev, 54);
      }
      return null;
    }
    default:
      return null;
  }
}
