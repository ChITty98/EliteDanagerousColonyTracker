// server/ai/copilotContext.js
//
// Builds the compact, live context the model needs to make a beat specific
// instead of generic. Everything here is best-effort and defensive — a missing
// state field must never throw; the line just gets a little less specific.

// --- World awareness (security / current body / atmosphere) -----------------
// Ephemeral, fed from the journal each tick by ingestWorld(); resets on restart
// until the next jump. buildSnapshot() folds it into every line's context.
import { getActiveProject, findMarketMatches, findCarrierLoadMatches } from '../journal/overlay.js';
import { friendlyShip, isSingleSeatShip, isCrampedShip } from '../journal/extractor.js';
import { getMemory, saveMemory } from './copilotMemory.js';
import { pickQuestion } from './copilotQuestions.js';
import { getGalaxyTick } from '../journal/tick.js';

// Ephemeral, reset on restart. The crew roster / session tenure / docking grudges that
// must SURVIVE a restart live in copilotMemory.js instead (getMemory()).
const world = { system: null, systemAddress: null, body: null, bodyAtmo: {}, hull: null };
let navDestination = null; // { name, system, body } of the nav-locked target (set by copilotStatus), or null
/** Set the nav-locked destination from the Status.json poll — lets the arrival beat tell a CARRIER
 *  drop from a body/site drop (calling the FC a "rock" was a real 👎). */
export function setNavDestination(d) { navDestination = (d && d.name) ? d : null; }
let lastHullDamageTs = 0; // journal-time of the last HullDamage — for the docking-grudge inference

// Atmosphere → its visual CHARACTER, deliberately hedged ("in daylight", "when
// lit") — the game can't tell us whether the commander is on the lit or dark
// side, so the co-pilot must never assert a sky colour as if it's visible now.
const ATMO_LOOK = [
  [/ammonia/i, 'an ammonia sky — warm yellow-to-orange around the sun (sometimes a deep orange sunset), with olive-green spreading out and darkening away from the light'],
  [/neon/i, 'a thin neon atmosphere — barely tints anything; a dark, near-black starry sky, almost like standing in vacuum'],
  [/argon/i, 'an argon sky — a vivid cobalt-blue glow around the sun fading to deep navy-black'],
  [/helium/i, 'a helium sky — a rich violet-magenta haze, deep purple overhead warming to a peachy-pink horizon'],
  [/sulphur dioxide|sulfur dioxide/i, 'a sulphur-dioxide sky — warm golden glow around the sun, greenish at the flanks, fading to dark blue-grey overhead'],
  [/carbon dioxide/i, 'a carbon-dioxide sky — clear blue in full daylight (almost Earth-like), dimming to slate-blue with a pale cream-green horizon toward dusk'],
  [/water/i, 'a water-vapour atmosphere — a hot, hazy world (sky colour varies; don\'t claim a specific tint)'],
  [/oxygen/i, 'a thin oxygen atmosphere — that signature light-purple cast where the sun catches it'],
  [/methane/i, 'a methane sky — warm amber glow low at the horizon fading to a dusky olive-brown overhead'],
  [/nitrogen/i, 'a thin nitrogen sky — clear pale blue overhead, warming to cream-yellow near the horizon'],
];

function atmoLook(atmo) {
  const a = String(atmo || '');
  if (!a || /no atmosphere|^none/i.test(a)) return 'no atmosphere — hard black sky, stars right down to the horizon';
  for (const [re, desc] of ATMO_LOOK) if (re.test(a)) return desc;
  return '';
}

function cleanSecurity(s) {
  const m = String(s || '').match(/security_(\w+)/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
}

/** Update world awareness from this tick's events. Call before buildSnapshot(). */
export function ingestWorld(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  for (const ev of events) {
    if (!ev) continue;
    switch (ev.event) {
      case 'FSDJump':
      case 'Location':
        world.system = {
          name: ev.StarSystem || '',
          security: ev.SystemSecurity_Localised || cleanSecurity(ev.SystemSecurity),
          allegiance: ev.SystemAllegiance || '',
          economy: ev.SystemEconomy_Localised || '',
          population: ev.Population || 0,
        };
        world.systemAddress = ev.SystemAddress || null;
        world.body = null;
        break;
      case 'SupercruiseExit':
      case 'ApproachBody':
      case 'Touchdown':
        if (ev.Body || ev.BodyName) world.body = ev.Body || ev.BodyName;
        if (ev.SystemAddress) world.systemAddress = ev.SystemAddress;
        break;
      case 'SupercruiseEntry':
      case 'Liftoff':
      case 'Undocked':
        world.body = null;
        break;
      case 'Scan':
        if (ev.BodyName && (ev.AtmosphereType || ev.Atmosphere)) {
          world.bodyAtmo[ev.BodyName] = ev.AtmosphereType || ev.Atmosphere;
        }
        break;
      // Standing hull-integrity read (0..1): Loadout sets the baseline, HullDamage
      // lowers it, a full repair / resurrect restores it.
      case 'Loadout':
        if (typeof ev.HullHealth === 'number') world.hull = ev.HullHealth;
        break;
      case 'HullDamage':
        if (typeof ev.Health === 'number') world.hull = ev.Health;
        lastHullDamageTs = Date.parse(ev.timestamp) || Date.now();
        break;
      case 'RepairAll':
      case 'Resurrect':
        world.hull = 1;
        break;
      case 'Repair':
        if (/^(all|hull|wear)$/i.test(ev.Item || '')) world.hull = 1;
        break;
      // NPC crew roster — names (frequent: wage events), combat rank (rare: hire/rank
      // events, best-effort), lifetime wages (Statistics, every game load). PERSISTED to
      // copilot-memory.json so the roster survives a restart and crew banter stays alive.
      case 'NpcCrewPaidWage':
        if (ev.NpcCrewName && ev.NpcCrewId != null) { getMemory().crew[ev.NpcCrewId] = ev.NpcCrewName; saveMemory(); }
        break;
      case 'NpcCrewRank':
        if (ev.NpcCrewName && ev.NpcCrewId != null) {
          const m = getMemory();
          m.crew[ev.NpcCrewId] = ev.NpcCrewName;
          if (typeof ev.RankCombat === 'number') m.crewRank[ev.NpcCrewId] = ev.RankCombat;
          saveMemory();
        }
        break;
      case 'CrewHire':
        if (ev.Name && ev.CrewID != null) {
          const m = getMemory();
          m.crew[ev.CrewID] = ev.Name;
          if (typeof ev.CombatRank === 'number') m.crewRank[ev.CrewID] = ev.CombatRank;
          saveMemory();
        }
        break;
      case 'CrewAssign':
        if (ev.Name && ev.CrewID != null) { getMemory().crew[ev.CrewID] = ev.Name; saveMemory(); }
        break;
      case 'CrewFire':
        if (ev.CrewID != null) { const m = getMemory(); delete m.crew[ev.CrewID]; delete m.crewRank[ev.CrewID]; saveMemory(); }
        break;
      case 'Statistics':
        if (ev.Crew && typeof ev.Crew.NpcCrew_TotalWages === 'number') { getMemory().crewWages = ev.Crew.NpcCrew_TotalWages; saveMemory(); }
        break;
      // New play session — bump the count (dedupe re-processed LoadGames by timestamp)
      // for the welcome-back beat + the relationship-tenure tone.
      case 'LoadGame': {
        const m = getMemory();
        const ts = ev.timestamp || '';
        if (ts && m.sessions.lastLoadAt !== ts) {
          m.sessions.lastLoadAt = ts;
          m.sessions.count = (m.sessions.count || 0) + 1;
          if (!m.sessions.firstSeenAt) m.sessions.firstSeenAt = ts;
          m.sessions.lastSeenAt = ts;
          if (m.qa) m.qa.session = {}; // new session → session-layer questions can be asked again
          saveMemory();
        }
        break;
      }
      // If the approach just clipped us (hull damage in the last ~45s), remember this
      // place — the co-pilot resurfaces the grudge warily on the next visit. Create-once
      // so a re-damaged return doesn't reset the "we tangled here before" memory.
      case 'Docked': {
        if (ev.MarketID != null && lastHullDamageTs) {
          const dts = Date.parse(ev.timestamp);
          if (Number.isFinite(dts) && dts - lastHullDamageTs > 0 && dts - lastHullDamageTs < 45000) {
            const m = getMemory();
            if (!m.grudges[ev.MarketID]) { m.grudges[ev.MarketID] = { stationName: ev.StationName || '', at: ev.timestamp }; saveMemory(); }
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

function isUserColony(s, systemName) {
  if (!systemName) return false;
  const name = String(systemName).toLowerCase();
  const manual = Array.isArray(s.manualColonizedSystems) ? s.manualColonizedSystems : [];
  if (manual.some((n) => String(n).toLowerCase() === name)) return true;
  const projects = Array.isArray(s.projects) ? s.projects : [];
  return projects.some((p) => p && p.systemName && String(p.systemName).toLowerCase() === name);
}

/** "Where are we / what's going on" — kept short on purpose. */
export function buildSnapshot(state) {
  const s = state || {};
  const settings = s.settings || {};
  const pos = s.commanderPosition || {};
  const system = pos.name || pos.system || pos.systemName || s.currentSystem || 'an unknown system';
  const parts = [
    `Commander: ${settings.commanderName || 'the commander'}.`,
    `System: ${system}.`,
  ];
  const cs = s.currentShip;
  const shipNm = (cs && typeof cs === 'object' && cs.name && String(cs.name).trim()) || '';
  const ship = currentShip(s);
  if (ship) parts.push(`Ship: ${ship}.${shipNm ? ` She's named "${shipNm}" — call her that when it fits, not just "she".` : ''}`);
  if (world.hull != null && world.hull < 0.95) {
    const pct = Math.round(world.hull * 100);
    parts.push(world.hull < 0.5
      ? `HULL at ${pct}% — getting dangerous; flag it, worth repairing at the next dock with services.`
      : `Hull integrity at ${pct}%.`);
  }
  const crewAboard = Object.values(getMemory().crew);
  if (crewAboard.length) parts.push(`Hired crew: ${crewAboard.join(', ')} — they live on the FLEET CARRIER, NOT this ship. Never place them aboard, speaking, or reacting mid-flight; they only come up when docked AT the carrier — and even then, never INVENT what they're doing (no imagined antics, gantries, or expressions).`);
  const sessN = getMemory().sessions.count || 0;
  if (sessN >= 2) parts.push(`Tenure: ~${sessN} sessions flown with this commander — ${relationshipTone(sessN)}.`);
  const qa = getMemory().qa || {};
  const known = [...Object.values(qa.durable || {}), ...Object.values(qa.session || {})]
    .filter((a) => a && a.question && a.label).map((a) => `"${a.question}" -> ${a.label}`);
  if (known.length) parts.push(`Things the commander has TOLD you — use them to quietly INFORM your read of them, almost never mention them out loud. NEVER quote their answers back at them ("for someone who says the port's the best part…"), never allude to "what you told me", never recite as a list: ${known.join('; ')}.`);
  if (s.currentDock && s.currentDock.stationName) parts.push(`Docked at ${s.currentDock.stationName}.`);

  // Active hauling session → the commander is WORKING, not resting. Without this,
  // ambient lines wrongly read downtime ("good place to catch our breath").
  const sess = activeSession(s);
  if (sess) {
    const proj = (s.projects || []).find((p) => p && p.id === sess.projectId);
    if (proj) {
      // MORALE RULE: the model gets PROGRESS (% done), never the remaining mountain — handing it
      // "~93,000 t still to deliver" made every beat rattle off the demoralizing number. The
      // co-pilot's whole job mid-haul is to make the grind feel GOOD.
      const comm = Array.isArray(proj.commodities) ? proj.commodities : [];
      const req = comm.reduce((t, c) => t + (c.requiredQuantity || 0), 0);
      const got = comm.reduce((t, c) => t + Math.min(c.providedQuantity || 0, c.requiredQuantity || 0), 0);
      const pct = req > 0 ? Math.floor((got / req) * 100) : 0;
      const prog = pct >= 97 ? 'nearly done' : `about ${pct}% delivered`;
      parts.push(`ACTIVE HAUL (background info — NOT your subject): the commander is mid-haul for ${proj.name || 'a build'}${proj.systemName ? ` in ${proj.systemName}` : ''}, WORKING right now, not resting (${prog}). They know their own big picture — do NOT talk about the build, the colony, what it will become, or how much is left (never quote remaining tonnage or counts). This context exists so you don't misread the moment as downtime; the haul only comes up for a concrete actionable note. The construction site is its OWN place in the system — never place the build where you are, never claim you can see it. The loop runs: collect at source markets / the carrier → deliver to the construction site.`);
    } else {
      parts.push('ACTIVE HAUL: a hauling session is running — the commander is working, not resting.');
    }
  }

  // System character (security / allegiance / economy) — only when it matches
  // where we actually are, so stale world info never leaks in.
  if (world.system && world.system.name && world.system.name.toLowerCase() === String(system).toLowerCase()) {
    const w = world.system;
    const bits = [w.security, w.allegiance, w.economy].filter(Boolean);
    if (bits.length) parts.push(`This system is ${bits.join(', ')}${w.population ? `, pop ${w.population.toLocaleString()}` : ', unpopulated'}.`);
  }
  if (isUserColony(s, system)) parts.push("This is one of the commander's OWN colonies — home turf, you helped build it.");
  if (world.body) {
    // Fold the full body dossier in so EVERY beat (not just arrival) knows where we actually are.
    const facts = dossierFlavour(bodyDossier(s, world.systemAddress, world.system && world.system.name, world.body));
    if (facts.length) {
      parts.push(`On ${world.body} — ${facts.slice(0, 3).join('; ')}. (They may be on the night side, so don't assume colour is visible right now.)`);
    } else {
      const look = atmoLook(world.bodyAtmo[world.body]);
      parts.push(look
        ? `On ${world.body} — ${look}. (They may be on the night side, so don't assume the colour is visible right now.)`
        : `On ${world.body}.`);
    }
  }

  // Real BGS-tick timing grounds the "board may lag" hedges — states/populations recorded
  // before the last tick may not reflect the current one. Absent tick service → no line.
  const gt = getGalaxyTick();
  if (gt) {
    const age = Date.now() - Date.parse(gt);
    if (Number.isFinite(age) && age >= 0) {
      const label = age >= 3600000 ? `${Math.floor(age / 3600000)}h` : `${Math.max(1, Math.floor(age / 60000))}m`;
      parts.push(`Last galaxy BGS tick: ~${label} ago — faction states and populations recorded before it may not reflect the current tick.`);
    }
  }

  return `Situation: ${parts.join(' ')}`;
}

function activeSession(s) {
  const id = s.activeSessionId;
  if (!id || !Array.isArray(s.sessions)) return null;
  return s.sessions.find((x) => x && x.id === id) || null;
}

function currentShip(s) {
  // currentShip is the captured object { type, name, ident, ... }. Surface the
  // user-given NAME (so the co-pilot can call her by it) + the type — NOT
  // String(object) === "[object Object]", which is what used to leak.
  const cs = s.currentShip;
  if (cs && typeof cs === 'object') {
    const name = cs.name && String(cs.name).trim();
    // Map the raw internal hull id ("panthermkii") to its display name ("Panther Clipper Mk II")
    // — the model was being handed the ugly token. friendlyShip falls through to the id if unknown.
    const type = cs.type && friendlyShip(String(cs.type).trim().toLowerCase());
    if (name && type) return `"${name}" (a ${type})`;
    return name || type || '';
  }
  if (cs) return friendlyShip(String(cs).toLowerCase());
  if (s.shipName) return String(s.shipName);
  return '';
}

/** Salient fields for the triggering event, as a short line. */
export function eventDetail(ev) {
  if (!ev) return '';
  switch (ev.event) {
    case 'Interdicted':
      return `Detail: interdicted by ${ev.Interdictor || 'a hostile'}${ev.IsPlayer ? ' (another commander)' : ''}.`;
    case 'HullDamage':
      return Number.isFinite(ev.Health) ? `Detail: hull at ${Math.round(ev.Health * 100)}%.` : '';
    case 'Disembark':
      return `Detail: stepping out onto ${ev.Body || 'the surface'}.`;
    case 'Embark':
      return `Detail: back aboard${ev.Body ? ` from ${ev.Body}` : ''}.`;
    case 'Touchdown':
      return `Detail: set down on ${ev.Body || 'the surface'}.`;
    case 'Scan':
      return `Detail: scanned ${ev.BodyName || 'a body'}${ev.__why ? ` — ${ev.__why}` : ''}.`;
    case 'MultiSellExplorationData':
    case 'SellExplorationData':
      return `Detail: exploration payout of ${fmtCr(ev.TotalEarnings ?? ev.BaseValue ?? 0)}.`;
    case 'FuelScoop':
      return Number.isFinite(ev.Total) ? `Detail: fuel tank now about ${Math.round(ev.Total)} tons.` : '';
    case 'DismissShip':
      return 'Detail: the ship has been sent away; you are flying it now.';
    case 'FSDJump':
      return `Detail: arrived in ${ev.StarSystem || 'a new system'}${Number.isFinite(ev.JumpDist) ? ` (${ev.JumpDist.toFixed(1)} ly jump)` : ''}.`;
    case 'Docked':
      return `Detail: docked at ${ev.StationName || 'the station'}${ev.StationType ? ` (${ev.StationType})` : ''}.`;
    case 'MarketBuy':
      return `Detail: loaded ${ev.Count || ''} ${ev.Type_Localised || ev.Type || 'cargo'} aboard.`;
    case 'CargoTransfer': {
      const toShip = (ev.Transfers || []).filter((t) => t && t.Direction === 'toship');
      if (toShip.length === 0) return '';
      const tons = toShip.reduce((s, t) => s + (t.Count || 0), 0);
      return `Detail: moved ${tons} tons aboard from the carrier.`;
    }
    default:
      return '';
  }
}

/**
 * Flag a Scan as noteworthy (and why) so the 'cool-scan' beat can fire. A
 * lightweight check now; can be swapped for the full scoring model later.
 */
export function decorateScan(ev) {
  if (!ev || ev.event !== 'Scan') return;
  const reasons = [];
  const planet = String(ev.PlanetClass || '').toLowerCase();
  const atmo = String(ev.AtmosphereType || ev.Atmosphere || '').toLowerCase();
  const ringed = Array.isArray(ev.Rings) && ev.Rings.length > 0;
  if (planet.includes('earth')) reasons.push('an Earth-like world');
  else if (planet.includes('water world')) reasons.push('a water world');
  else if (planet.includes('ammonia')) reasons.push('an ammonia world');
  if (atmo.includes('oxygen')) reasons.push('an oxygen atmosphere');
  if (ev.TerraformState) reasons.push('terraformable');
  if (ringed && ev.Landable) reasons.push('a ringed landable body');
  if (ev.WasDiscovered === false) reasons.push('a first discovery — nobody has seen it');
  if (reasons.length > 0) {
    ev.__noteworthy = true;
    ev.__why = reasons.join(', ');
  }
}

// Per-commodity delivered watermark (`${MarketID}|${Name}` -> last ProvidedAmount
// seen). Lets us fire EXACTLY when a commodity crosses its required amount.
const depotSeen = {};

/**
 * Did this tick's deliveries finish off a commodity for a build? Reads the
 * ColonisationConstructionDepot event — the SAME source that updates the build's
 * delivered totals (processors.js) — and tracks a per-commodity watermark, so it
 * fires once, the moment a commodity crosses its required amount. The earlier
 * version keyed off ColonisationContribution, which lands in a different tick and
 * resolves commodity ids through a different path — so real completions slipped
 * through. Recency-filtered: a full journal re-sync silently seeds the watermarks
 * instead of firing spurious "done!" beats.
 */
export function detectCompletion(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const completed = [];
  let marketId = null;
  for (const ev of events) {
    if (!ev || ev.event !== 'ColonisationConstructionDepot') continue;
    const recent = isRecent(ev.timestamp);
    for (const r of (ev.ResourcesRequired || [])) {
      if (!r || !r.Name) continue;
      const key = `${ev.MarketID}|${r.Name}`;
      const req = r.RequiredAmount || 0;
      const have = r.ProvidedAmount || 0;
      const prior = depotSeen[key];
      depotSeen[key] = have; // always advance the watermark (even on a re-sync)
      // Only celebrate a live transition we actually witnessed crossing the line.
      if (recent && req > 0 && have >= req && prior !== undefined && prior < req) {
        completed.push(cleanCommodityName(r));
        marketId = ev.MarketID;
      }
    }
  }
  if (completed.length === 0) return null;

  // What's still on the manifest? Drives a natural "X done, Y to go" line.
  let left = '';
  const proj = ((state && state.projects) || []).find((p) => p && p.marketId === marketId);
  if (proj && Array.isArray(proj.commodities)) {
    const rem = proj.commodities.filter((c) => (c.providedQuantity || 0) < (c.requiredQuantity || 0));
    if (rem.length) {
      const tons = rem.reduce((t, c) => t + Math.max(0, (c.requiredQuantity || 0) - (c.providedQuantity || 0)), 0);
      const names = rem.slice(0, 4).map((c) => c.name).filter(Boolean).join(', ');
      left = ` Still ${rem.length} to go (~${tons.toLocaleString()} t)${names ? `: ${names}${rem.length > 4 ? '…' : ''}` : ''}.`;
    } else {
      left = ' That was the last of the manifest — the build is fully supplied.';
    }
  }

  return {
    key: 'commodity-done',
    priority: 92,
    interrupt: true,
    live: true, // genuinely needs the live "what's left" context — worth a generation
    model: 'sonnet',
    mood: 'proud',
    inputs: {
      completed,
      remaining: proj && Array.isArray(proj.commodities)
        ? proj.commodities.filter((c) => (c.providedQuantity || 0) < (c.requiredQuantity || 0)).map((c) => c.name).filter(Boolean)
        : [],
      system: (proj && proj.systemName) || null,
    },
    intent: `The active build just took the LAST of ${completed.join(' and ')} — fully delivered. Call it out with real satisfaction, then glance at what's still on the manifest. Keep it natural, not a robotic list: "that's the liquid oxygen done — still steel and CMM to chew through."`,
    detail: `Detail: finished delivering ${completed.join(', ')} to the build.${left}`,
  };
}

function cleanCommodityName(r) {
  if (r && r.Name_Localised) return String(r.Name_Localised);
  const m = String((r && r.Name) || '').match(/\$?(\w+?)_name;?/i);
  if (m) return m[1].replace(/([a-z])([A-Z])/g, '$1 $2');
  return (r && r.Name) || 'that commodity';
}

// A finished BUILD (not just one commodity) — the construction site becomes a real,
// operational station. The biggest payoff beat in the whole co-pilot. Fires once
// per market (tracked), off the depot event's ConstructionComplete flag.
const buildCompleteFired = new Set();
export function detectBuildComplete(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  for (const ev of events) {
    if (!ev || ev.event !== 'ColonisationConstructionDepot' || !ev.ConstructionComplete || !isRecent(ev.timestamp)) continue;
    const key = String(ev.MarketID);
    if (buildCompleteFired.has(key)) continue;
    buildCompleteFired.add(key);
    const proj = ((state && state.projects) || []).find((p) => p && p.marketId === ev.MarketID);
    const where = proj && proj.systemName ? ` in ${proj.systemName}` : '';
    const named = proj && proj.name ? ` It is ${proj.name}${where}.` : '';
    return {
      key: 'build-complete', priority: 100, interrupt: true, live: true, model: 'sonnet', mood: 'proud',
      inputs: { system: (proj && proj.systemName) || null, name: (proj && proj.name) || null },
      intent: `THE BIG ONE — the construction you have been hauling to is COMPLETE. The build site is now a real, operational station. This is the payoff for days of hauling: the place you hauled a mountain to has a name now. React with genuine weight and pride, in character.${named}`,
      detail: `Detail: construction complete — the site is now an operational station${proj && proj.name ? ` (${proj.name})` : ''}.`,
    };
  }
  return null;
}

// Emergency drop (flew too close to a body) and hard landing — neither has a
// dedicated journal event; both are INFERRED from a damage event arriving in the
// same tick as the SupercruiseExit / Touchdown that caused it. No signal → silent
// (we can't see stick work, so never comment on landing quality without evidence).
export function detectInferredDamage(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const recent = events.filter((e) => e && isRecent(e.timestamp));
  if (!recent.some((e) => e.event === 'HullDamage')) return null;
  if (recent.some((e) => e.event === 'SupercruiseExit')) {
    return {
      key: 'emergency-drop', priority: 95, interrupt: true, live: true, model: 'haiku', mood: 'brace',
      intent: 'An EMERGENCY DROP just happened — flew too close to a stellar body, forced out of supercruise with hull/module damage and a ~40-second FSD reset. React: we got too close to something big, the hull is grumpy, we are stuck for a moment. Brace or wry per persona.',
      detail: 'Detail: emergency drop from supercruise (proximity to a body) — hull damage + ~40s FSD reset.',
    };
  }
  if (recent.some((e) => e.event === 'Touchdown')) {
    return {
      key: 'hard-landing', priority: 60, interrupt: false, live: true, model: 'haiku', mood: 'brace',
      intent: 'A HARD LANDING — a touchdown immediately followed by hull damage. React to the rough set-down (we felt that one), persona-flavoured. Never comment on landing quality otherwise.',
      detail: 'Detail: touchdown immediately followed by hull damage — a hard landing.',
    };
  }
  return null;
}

// The docking/launch computer just took control (Music → DockingComputer). The same
// signal fires for BOTH dock and launch, so we disambiguate by whether we're docked
// right now: docked → it's taking us OUT (launch); not docked → bringing us IN
// (dock). Keeps the co-pilot from ever narrating the wrong direction. Canned —
// the pool is split into autopilot-dock / autopilot-launch.
export function detectAutopilot(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const m = events.find((e) => e && e.event === 'Music' && e.MusicTrack === 'DockingComputer' && isRecent(e.timestamp));
  if (!m) return null;
  // Dock vs launch from the EVENTS, not state.currentDock. The journal proves why: on a
  // LAUNCH, Undocked and the docking-computer Music share the SAME timestamp, so they hit
  // one poll batch and currentDock is already cleared when we read it → it would wrongly say
  // 'dock'. On a DOCK, the Music fires ~50s BEFORE Docked, so currentDock is still null.
  // So read the event in the batch: Undocked/Liftoff → launch; Docked → dock; otherwise fall
  // back to currentDock (null while approaching = dock, set while on the pad = launch).
  const recent = (re) => events.some((e) => e && re.test(e.event) && isRecent(e.timestamp));
  const launching = recent(/^(Undocked|Liftoff)$/) ? true
    : recent(/^Docked$/) ? false
      : !!(state && state.currentDock && state.currentDock.stationName);
  return { key: launching ? 'autopilot-launch' : 'autopilot-dock', priority: 50, interrupt: false, mood: 'calm' };
}

// Single-seat hulls have NO co-pilot seat → the persona is crammed into the CARGO HOLD, flying the
// dock / launch / cruise by REMOTE from back there. A guarded gag on those control-handoff moments,
// ONLY in a single-seat ship. Higher prio than the normal autopilot/sca line, so when it fires it
// REPLACES that line (the gripe IS the acknowledgment that time); the 10-min guard keeps it to a joke
// or two, not every dock.
let lastCargoGripeAt = 0;
export function detectCargoBayGripe(parsed, state, persona) {
  const cs = state && state.currentShip;
  const type = cs && (typeof cs === 'object' ? cs.type : cs);
  if (!isSingleSeatShip(type)) return null;
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const autodock = events.some((e) => e && e.event === 'Music' && e.MusicTrack === 'DockingComputer' && isRecent(e.timestamp));
  const assist = events.some((e) => e && e.event === 'StatusScaActive' && isRecent(e.timestamp));
  if (!autodock && !assist) return null;
  if (now - lastCargoGripeAt < 10 * 60 * 1000) return null; // ~once / 10 min — a joke or two, not every handoff
  lastCargoGripeAt = now;
  const recent = (re) => events.some((e) => e && re.test(e.event) && isRecent(e.timestamp));
  const what = assist ? 'taking the ship into SUPERCRUISE'
    : recent(/^(Undocked|Liftoff)$/) ? 'LAUNCHING us off the pad'
    : recent(/^Docked$/) ? 'DOCKING us'
    : (state && state.currentDock && state.currentDock.stationName) ? 'LAUNCHING us off the pad' : 'DOCKING us';
  const cramped = isCrampedShip(type);
  const angle = persona === 'k2'
    ? `You are a heavy combat frame exiled to the hold with no cockpit station of your own${cramped ? ', folded into a cramped little hull on top of it' : ' (a roomy hull — you have the SPACE, you are just not up front)'} — be openly grumpy about flying from the back.`
    : persona === 'wash'
    ? 'Put-upon and wry — this is beneath a pilot of your talents, but here you are, flying from the luggage.'
    : 'Dry and deadpan — state the absurd indignity precisely and find it quietly funny.';
  const shipNm = friendlyShip(String(type).toLowerCase());
  return {
    key: 'cargo-bay-gripe', priority: 56, interrupt: false, live: true, model: 'sonnet', mood: 'calm', character: true,
    intent: `This ${shipNm} is a SINGLE-SEATER — there is no co-pilot seat for you, so you are crammed into the CARGO HOLD, ${what} by remote from back there: no forward view, wedged between cargo racks, flying by feel and instruments. React in character to the absurd indignity of it. ${angle} A wry one-liner — do not over-explain the joke.`,
    detail: `You (the co-pilot) are physically in the cargo hold of a single-seat ${shipNm}; the commander has the only seat.`,
  };
}

/**
 * Back aboard from the Nomad — DockSRV. The commander asked for the welcome-back
 * flavour to survive the away-team reframing: climbing back into the ship after a
 * surface run is a real arrival, and the co-pilot has been watching the whole time
 * from directly overhead, so they have something to greet them ABOUT.
 */
let lastSrvReturnAt = 0;
export function detectSrvReturn(parsed, state) {
  const ev = (parsed && parsed.dockSrvEvents || [])[0];
  if (!ev) return null;
  const now = Date.now();
  if (now - lastSrvReturnAt < 3 * 60 * 1000) return null; // one greeting per outing, not per bounce
  lastSrvReturnAt = now;
  const srv = String(ev.SRVType_Localised || 'SRV');
  const cs = state && state.currentShip;
  const hull = cs ? (typeof cs === 'object' ? cs.type : cs) : null;
  const ship = hull ? friendlyShip(String(hull).toLowerCase()) : 'the ship';
  return {
    key: 'srv-return', priority: 40, interrupt: false, live: true, model: 'sonnet', mood: 'warm', character: true,
    intent: `The commander just docked the ${srv} back into the ${ship} — they are ABOARD again, in the seat next to you. `
      + `You have been station-keeping overhead watching them work the surface, so greet the return with something you actually SAW, `
      + `not a generic hello. Warm, short, in character. Do not recap their whole outing.`,
    detail: `Detail: ${srv} docked — the commander is back aboard the ${ship} after a surface run.`,
  };
}

// ── Haul-aware dock awareness ───────────────────────────────────────────────
// The co-pilot's most useful job: when we dock mid-haul, call the next CONCRETE
// move — what to BUY here / LOAD off the carrier for the active build — and
// otherwise stay quiet. It NEVER recites the remaining total (the commander knows
// it; repeating it is the #1 way the co-pilot feels un-engaged), and it won't
// repeat the same action within HAUL_REPEAT_MS. Commodity-completion milestones
// are NOT handled here — detectCompletion (priority 92) already owns those. Reuses
// the overlay's exact project↔market matching so the numbers agree with the overlay.

let mcMusicTrack = '';                 // last-seen Music track (persists across ticks)
let lastDock = null;                   // { marketId, stationType } of the current dock
const haulSaid = new Map();            // actionFp -> ts last offered (anti-repetition)
const HAUL_REPEAT_MS = 10 * 60 * 1000; // don't repeat the same buy/load call within 10 min

// Track dock + docking-music transitions for this tick. Returns true on the
// Music→(not DockingComputer) FALLING edge — i.e. an auto-dock just FINISHED.
// Must be called once per tick (it advances mcMusicTrack / lastDock).
// Haul FLOW direction — is the commander STOCKPILING the carrier (buy at source → deposit) or
// DELIVERING from it (pull → run to the site)? Read from the actual recent activity, so the
// carrier dock note never says "pull Aluminium off" mid-stockpile ("I'm LOADING the carrier").
let lastBuyTs = 0;        // MarketBuy at a source market
let lastToCarrierTs = 0;  // CargoTransfer → tocarrier (depositing)
let lastToShipTs = 0;     // CargoTransfer → toship (pulling for a delivery run)

function trackDockMusic(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  let leftDocking = false;
  for (const e of events) {
    if (!e) continue;
    const ets = Date.parse(e.timestamp);
    if (Number.isFinite(ets)) {
      if (e.event === 'MarketBuy') lastBuyTs = Math.max(lastBuyTs, ets);
      else if (e.event === 'CargoTransfer' && Array.isArray(e.Transfers)) {
        for (const tr of e.Transfers) {
          if (tr && tr.Direction === 'tocarrier') lastToCarrierTs = Math.max(lastToCarrierTs, ets);
          else if (tr && tr.Direction === 'toship') lastToShipTs = Math.max(lastToShipTs, ets);
        }
      }
    }
    if (e.event === 'Docked') lastDock = { marketId: e.MarketID, stationType: e.StationType || '', stationName: e.StationName || '' };
    else if (e.event === 'Undocked') lastDock = null;
    else if (e.event === 'Music' && typeof e.MusicTrack === 'string') {
      if (mcMusicTrack === 'DockingComputer' && e.MusicTrack !== 'DockingComputer') leftDocking = true;
      mcMusicTrack = e.MusicTrack;
    }
  }
  return leftDocking;
}

// LIVE carrier free space: CarrierStats' freeSpace is a SNAPSHOT (fires only when the commander
// opens carrier management) while carrierCargo is kept live per CargoTransfer — after a stretch of
// depositing, the snapshot overstates free space by thousands of tonnes (said 18,257t when the
// real figure was 7,890). Adjust the snapshot by the cargo delta since it was taken.
export function liveCarrierFreeSpace(state, callsign) {
  const s = state || {};
  const u = callsign && s.fleetCarrierSpaceUsage ? s.fleetCarrierSpaceUsage[callsign] : null;
  if (!u || !Number.isFinite(u.freeSpace)) return null;
  const cargo = callsign && s.carrierCargo ? s.carrierCargo[callsign] : null;
  if (!cargo || !Array.isArray(cargo.items)) return u.freeSpace;
  const live = cargo.items.reduce((t, i) => t + (i && i.count > 0 ? i.count : 0), 0);
  // Preferred: delta vs the TRACKER's own reading anchored at snapshot time — the tracker's
  // absolute error cancels. (Comparing to the snapshot's cargo figure instead inflated free
  // space by whatever the tracker had never seen: reported 18,835t free when 18,250 was the max.)
  if (Number.isFinite(u.trackerCargoAtStats)) {
    const free = u.freeSpace - (live - u.trackerCargoAtStats);
    const cap = Number.isFinite(u.totalCapacity) ? u.totalCapacity : Infinity;
    return Math.max(0, Math.min(free, cap));
  }
  // Old snapshot without a baseline: adjust only DOWNWARD (deposits shrink space) — never report
  // more than the snapshot itself said. Understates briefly after withdrawals; self-heals on the
  // next CarrierStats, and understating is the safe direction.
  if (Number.isFinite(u.cargo)) {
    return Math.max(0, Math.min(u.freeSpace + (u.cargo - live), u.freeSpace));
  }
  return u.freeSpace;
}

// The actionable next move at the station we're docked at: load-off-carrier or
// buy-here for the active build. Returns string[] of facts, or null when there's
// nothing to do here OR we already called this same action recently. NEVER the total.
function haulActions(state, marketId, stationName) {
  const s = state || {};
  const project = getActiveProject(s);
  if (!project || !Array.isArray(project.commodities)) return null;
  const now = Date.now();
  const cargoCap = (s.settings && s.settings.cargoCapacity) || 0;
  // A single run only carries ~cargoCap — NEVER quote the build's whole remaining
  // tonnage (the commander can't grab 35,000t in a ~1,300t hold). When the need
  // overflows a hold, say "fill the hold" instead of an absurd number.
  const overflows = (arr, qty) => cargoCap > 0 && arr.some((x) => qty(x) > cargoCap);
  const fc = s.settings || {}; // myFleetCarrier / myFleetCarrierMarketId live in settings, not top-level
  const facts = [];
  let actionFp = '';
  // marketId OR callsign-in-station-name — the marketId may be unset, but the callsign
  // always identifies the carrier (same robust test overlay.js uses).
  const isMyCarrier = (fc.myFleetCarrierMarketId != null && marketId === fc.myFleetCarrierMarketId)
    || (!!fc.myFleetCarrier && !!stationName && stationName === fc.myFleetCarrier);
  if (isMyCarrier) {
    // STOCKPILING phase (most recent flow = buying / depositing to the carrier) → the commander is
    // filling the carrier, not pulling from it. A "load X off the carrier" call here is backwards
    // and obviously so — stay quiet; the activity speaks for itself.
    const inbound = Math.max(lastBuyTs, lastToCarrierTs);
    if (inbound > 0 && inbound > lastToShipTs) return null;
    const callsign = fc.myFleetCarrier;
    const cargo = callsign && s.carrierCargo ? s.carrierCargo[callsign] : null;
    // What's ON the carrier that the build still needs, LOWEST-remaining FIRST
    // (findCarrierLoadMatches sorts that way) — the goal is to clear items off the
    // list. Flag the ones the carrier holds enough of to FINISH in a single run.
    const load = findCarrierLoadMatches((cargo && cargo.items) || [], project).slice(0, 3);
    if (load.length) {
      const parts = load.map((m) => {
        const canFinish = m.loadQty >= m.remaining && (cargoCap <= 0 || m.remaining <= cargoCap);
        // Name + closeness only — handing the model the raw build-remaining tonnage made it recite
        // confusing numbers ("Eighteen-two-five-seven tonnes") the commander can't act on anyway.
        return `${m.name}${canFinish ? ' (one hold-load finishes it)' : ''}`;
      });
      facts.push(`closest to done — worth loading off the carrier: ${parts.join(', ')}`);
      actionFp = `load|${load.map((m) => m.name).join(',')}`;
    }
    const freeLive = liveCarrierFreeSpace(s, callsign);
    if (actionFp && freeLive != null) facts.push(`${freeLive.toLocaleString()}t free in the hold`);
  } else {
    const snap = (s.marketSnapshots || {})[marketId];
    const buy = snap && Array.isArray(snap.commodities) ? findMarketMatches(snap.commodities, project, s).slice(0, 2) : [];
    if (buy.length) {
      facts.push(overflows(buy, (m) => m.needToBuy)
        ? `buy here for the build — they sell the ${buy.map((m) => m.name).join(' and ')} it's burning through; fill the hold`
        : `buy here for the build: ${buy.map((m) => `${m.needToBuy.toLocaleString()}t ${m.name}`).join(', ')}`);
      actionFp = `buy|${marketId}|${buy.map((m) => m.name).join(',')}`;
    }
  }
  if (!actionFp) return null;
  const last = haulSaid.get(actionFp);
  if (last && now - last < HAUL_REPEAT_MS) return null; // already called this; silence beats nagging
  haulSaid.set(actionFp, now);
  return facts;
}

function haulBeat(facts, key, justLanded) {
  if (!facts || !facts.length) return null;
  const lead = justLanded
    ? "The auto-dock just FINISHED — we're settled on the pad, clamps on, ready to work. "
    : 'Just docked, mid-haul. ';
  return {
    key, priority: 62, interrupt: false, live: true, model: 'haiku', mood: 'calm',
    inputs: { facts },
    intent: `${lead}The commander has been grinding this haul a long time and KNOWS the overall totals — do NOT recite the remaining total or "X tons across Y commodities," EVER. Offer the concrete next move here as a RECOMMENDATION, like a co-pilot who's been running this loop with them — suggest, never order (they're the captain: "Steel looks closest to done" not "grab the Steel"): ${facts.join('; ')}. One natural, in-character line.`,
    detail: `Detail: ${facts.join('. ')}.`,
  };
}

// Auto-dock finished (docking music stopped) → "we're down — here's the load/unload".
// Fires only when there's a fresh action; the landing itself is self-evident. Runs
// the tick's music tracker, so it MUST be called before detectDockInfo each tick.
export function detectDockComplete(parsed, state) {
  const leftDocking = trackDockMusic(parsed);
  if (!leftDocking) return null;
  // lastDock set → an auto-DOCK just finished (we're on the pad): "we're down + the job".
  if (lastDock) return haulBeat(haulActions(state, lastDock.marketId, lastDock.stationName), 'dock-complete', true);
  // lastDock cleared (Undocked already fired) → an auto-LAUNCH just finished: the stick is
  // the commander's again. Canned handoff ("she's yours, we're clear").
  return { key: 'launch-complete', priority: 48, interrupt: false, mood: 'calm' };
}

// A pirate / interdictor / cargo-demander just hailed us on comms (ReceiveText,
// channel 'npc'). The interdicted/damage beats only cover the ACTUAL interdiction or
// hits — but the THREAT message comes first and deserves a heads-up. Same regex
// processNpcThreat uses for the overlay. Live + interrupt so it lands now; a 45s
// module guard means we react ONCE per encounter, not on every taunt.
let lastNpcThreatAt = 0;
let lastLoiterAt = 0;
export function detectNpcThreat(parsed) {
  const events = (parsed && parsed.receiveTextEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  for (const ev of events) {
    if (!ev || ev.Channel !== 'npc' || !isRecent(ev.timestamp)) continue;
    const msg = ev.Message || '';
    const loc = ev.Message_Localised || '';
    // Station loitering / pad-block warning — they threaten a LETHAL response.
    if (/DockingPadBlock/i.test(msg) || /loiter/i.test(loc)) {
      if (now - lastLoiterAt < 30000) return null;
      lastLoiterAt = now;
      return {
        key: 'loitering', priority: 90, interrupt: true, live: true, model: 'haiku', mood: 'brace',
        intent: "The station just issued a LOITERING / pad-block warning and threatened a LETHAL response if we don't clear the pad approach NOW. React FAST and in character — we need to MOVE, urgent, with a little black comedy that they will genuinely open fire on us over what amounts to a parking violation.",
        detail: 'Detail: station loitering warning — blocking the pad, lethal response threatened.',
      };
    }
    const isPirate = /^\$Pirate_/i.test(msg);
    const isInterdictor = /^\$InterdictorNPC_/i.test(msg) || /^\$NPC_.*Interdict/i.test(msg);
    const isDemand = /^\$.*_OnStartScanCargo|^\$.*_Stop_|^\$.*_Attack_/i.test(msg);
    if (!isPirate && !isInterdictor && !isDemand) continue;
    if (now - lastNpcThreatAt < 45000) return null; // same encounter's taunts — react once
    lastNpcThreatAt = now;
    const from = ev.From_Localised || ev.From || 'a hostile';
    const text = ev.Message_Localised || ev.Message || '';
    return {
      key: 'npc-threat', priority: 96, interrupt: true, live: true, model: 'haiku', mood: 'brace',
      inputs: { from, message: text, kind: isPirate ? 'pirate' : isInterdictor ? 'interdictor' : 'demand' },
      intent: `A hostile just hailed us on comms with a THREAT — ${from}: "${text}". They want our cargo or our ship. React FAST and in character — name the threat, and the play: we're a heavy HAULER, almost certainly UNARMED, so it's RUN / boost / evade (or hand over cargo if truly cornered), NOT "weapons hot" and NOT defending some location. Never invent a fight we can win or a place to protect.`,
      detail: `Detail: NPC threat on comms from ${from} — "${text}".`,
    };
  }
  return null;
}

// Manual dock (no docking computer) → the same haul-action call at the Docked event.
// If an auto-dock is in progress (docking music still playing), suppress here and let
// detectDockComplete deliver it once the ship has actually settled.
export function detectDockInfo(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const dock = events.find((e) => e && e.event === 'Docked' && isRecent(e.timestamp));
  if (!dock) return null;
  if (mcMusicTrack === 'DockingComputer') return null; // auto-docking → dock-complete owns it
  return haulBeat(haulActions(state, dock.MarketID, dock.StationName), 'dock-info', false);
}

// Dropping into / flying through a notable atmosphere (we know its type from an
// earlier Scan). The sky is striking and the co-pilot never remarks on it — fix
// that. Live; rare (once per atmo TYPE per ~30 min, so the haul loop's repeated
// trips through the same oxygen sky don't nag).
const atmoSeen = new Map();
const ATMO_REACT_MS = 30 * 60 * 1000;
export function detectAtmo(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const drop = events.find((e) => e && /^(Touchdown|ApproachBody|SupercruiseExit)$/.test(e.event) && isRecent(e.timestamp));
  if (!drop) return null;
  const body = world.body;
  const atmo = body && world.bodyAtmo[body];
  if (!atmo) return null;
  const look = atmoLook(atmo);
  if (!look || /no atmosphere/i.test(look)) return null;
  const key = String(atmo).toLowerCase().replace(/[^a-z]/g, '');
  const last = atmoSeen.get(key);
  if (last && now - last < ATMO_REACT_MS) return null; // reacted to this atmo recently — stay quiet
  atmoSeen.set(key, now);
  return {
    key: 'atmo', priority: 47, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    inputs: { atmo, look },
    intent: `We're dropping into / flying through an atmosphere — ${look}. React to the striking sky and light in character (Wash marvels at it, TARS notes the chemistry precisely, K2 unbothered but clocks it). They MAY be on the night side — do NOT assert the colour is visible right now. One natural line.`,
    detail: `Detail: in a ${atmo} atmosphere — ${look}.`,
  };
}

// NPC crew names, for the crew dock-banter beat + the {crew} slot fill.
export function getCrewNames() {
  return Object.values(getMemory().crew);
}

// Occasional crew banter on a quiet CARRIER dock (after the loading's handled) — a
// little in-character story about a hired crew member, coloured by their combat RANK
// (cocky veteran vs green rookie) and the eye-watering total wages they've cost. LIVE,
// to weave the dynamic data. Rare (~once per 10 min); carrier-only; needs a known name.
const COMBAT_RANKS = ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite'];
let lastCrewAt = 0;
export function detectCrew(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const dock = events.find((e) => e && e.event === 'Docked' && isRecent(e.timestamp));
  if (!dock) return null;
  const fc = (state && state.settings) || {};
  const onMyCarrier = (fc.myFleetCarrierMarketId != null && dock.MarketID === fc.myFleetCarrierMarketId)
    || (!!fc.myFleetCarrier && dock.StationName === fc.myFleetCarrier);
  if (!onMyCarrier) return null; // crew live on the carrier
  const mem = getMemory();
  const ids = Object.keys(mem.crew);
  if (!ids.length) return null;
  if (now - lastCrewAt < 10 * 60 * 1000) return null;
  lastCrewAt = now;
  const id = ids[Math.floor(Math.random() * ids.length)];
  const name = mem.crew[id];
  const rank = (typeof mem.crewRank[id] === 'number' && COMBAT_RANKS[mem.crewRank[id]]) || '';
  const wages = mem.crewWages > 0 ? `${(mem.crewWages / 1e9).toFixed(1)} billion` : '';
  const rankBit = !rank ? '' : /Elite|Deadly|Dangerous|Master/.test(rank)
    ? ` They are ${rank}-rank and KNOW it — cocky, certain they're the best aboard, and they bill like it (a cut of everything).`
    : ` They are only ${rank} rank — green, still finding their feet, keen but not there yet.`;
  const wagesBit = wages ? ` COMEDY GOLD — the crew have pulled about ${wages} credits in wages all told: that is MORE than the co-pilot is paid (the co-pilot is paid nothing), and it is past HALFWAY to the ~5 billion a FLEET CARRIER costs, so give it a few more runs and ${name} buys their own and retires on you. Land ONE of those angles; do not list them.` : '';
  return {
    key: 'crew', priority: 50, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    inputs: { name, rank, wages },
    intent: `Docked at the carrier, a quiet beat after the loading's handled. Tell a SHORT, funny, lived-in bit about the hired crew member ${name} — some hijinks they probably got into while you were out: a mess they left, money they owe, a bottle emptier than it was, a feud with the other crew, something they broke and won't admit to.${rankBit}${wagesBit} In character — Wash exasperated-but-fond (Firefly-crew energy), K2 logging it as evidence, TARS flagging the expense. NAME them. Never mean-spirited, never a status report.`,
    detail: `Detail: crew ${name}${rank ? ` (${rank})` : ''}${wages ? `; ~${wages} total crew wages` : ''}.`,
  };
}

// Inside-joke banter (7-second rule / o7) on entering supercruise. Off the raw
// matchBeat (SupercruiseEntry fires constantly) → a synthetic detect with a long
// guard: a RARE easter-egg (~once per 30 min), since the joke gets old fast.
let lastPilotBanterAt = 0;
export function detectPilotBanter(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  if (!events.some((e) => e && e.event === 'SupercruiseEntry' && isRecent(e.timestamp))) return null;
  // Skip the post-LAUNCH entry — firing the o7 / 7-second bit "just after lifting off" was the 👎.
  // The joke wants a settled cruise, not the moment we leave the pad.
  if (events.some((e) => e && /^(Undocked|Liftoff)$/.test(e.event) && isRecent(e.timestamp))) return null;
  if (now - lastPilotBanterAt < 90 * 60 * 1000) return null; // genuinely rare easter-egg
  lastPilotBanterAt = now;
  return { key: 'pilot-banter', priority: 28, interrupt: false, mood: 'calm', character: true };
}

// Relationship tenure → a tone hint folded into every live line's context + the session
// greeting. Early = formal/new; later = familiar, inside-jokes, shorthand.
export function relationshipTone(n) {
  if (n <= 1) return 'still new to each other — a touch more formal, still earning trust';
  if (n <= 5) return 'getting familiar — finding a rhythm, learning each other\'s signals';
  if (n <= 10) return 'an established rapport — easy banter, shared callbacks to earlier sessions';
  if (n <= 20) return 'comfortable partners — shorthand, running jokes about the ship and the work, you read each other';
  if (n <= 40) return 'old hands — deep familiarity, inside-jokes, you finish each other\'s thoughts';
  return 'veteran crew — silence is as comfortable as talking; the bond is earned, not performed';
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Session greeting on game load — "welcome back, that's our Nth run", tone scaled by how
// long you've flown together (the relationship deepening). The count is bumped in
// ingestWorld(LoadGame); this just delivers the line, once per load.
let lastSessionGreetAt = 0;
export function detectSessionStart(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  if (!events.some((e) => e && e.event === 'LoadGame' && isRecent(e.timestamp))) return null;
  if (now - lastSessionGreetAt < 60000) return null; // one greeting per load
  lastSessionGreetAt = now;
  const n = getMemory().sessions.count || 1;
  return {
    key: 'session-start', priority: 58, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    inputs: { sessions: n },
    intent: `The commander just loaded in — about your ${n}${ordinal(n)} run flying together. Greet them getting back in the seat, in character. ${n <= 1 ? 'This may be the FIRST time out — a touch more formal / introductory, still earning trust.' : `You KNOW each other now (${relationshipTone(n)}) — lean on the shared history, warm/dry/blunt per persona.`} Short; NOT a status report, do not list tasks.`,
    detail: `Detail: session ~#${n} together.`,
  };
}

// Earned damage-memory: returning to a place that clipped us on a prior approach. The
// grudge is created in ingestWorld(Docked) when hull damage preceded the dock; this fires
// only for an OLD grudge (a real prior visit), not the approach that just made it.
export function detectGrudge(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const dock = events.find((e) => e && e.event === 'Docked' && isRecent(e.timestamp));
  if (!dock || dock.MarketID == null) return null;
  const g = getMemory().grudges[dock.MarketID];
  if (!g) return null;
  const dts = Date.parse(dock.timestamp), gts = Date.parse(g.at);
  if (!(Number.isFinite(dts) && Number.isFinite(gts) && dts - gts > 2 * 60 * 1000)) return null; // old grudge, not this approach
  return {
    key: 'grudge', priority: 45, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    inputs: { station: g.stationName || 'this place' },
    intent: `Back docked at ${g.stationName || 'this place'} — and LAST time the co-pilot flew us in here, the approach clipped us and we took hull damage (a tight, awkward, probably half-built berth). React with wary, EARNED memory: you remember this place burned you both, you don't forget a grudge — even against scaffolding. In character, a little gallows humour; reference the shared history, keep it short.`,
    detail: `Detail: return to ${g.stationName || 'a place'} that damaged us on a prior approach.`,
  };
}

// Change-awareness: remember each system's last-known controlling-faction state +
// population, and on jump-in fire on the DELTA — a system newly at war, or a colony
// whose population has clearly grown — weighted harder for the commander's OWN colonies.
// Live (dynamic comparison); feeds the capture flywheel.
let lastSysChangeTs = '';
export function detectSystemChange(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const jump = events.find((e) => e && /^(FSDJump|Location)$/.test(e.event) && e.StarSystem && isRecent(e.timestamp));
  if (!jump) return null;
  if (jump.timestamp === lastSysChangeTs) return null; // process each jump once, not every tick
  lastSysChangeTs = jump.timestamp;
  const name = jump.StarSystem;
  const cur = {
    factionState: (jump.SystemFaction && jump.SystemFaction.FactionState) || '',
    population: jump.Population || 0,
    at: jump.timestamp || '',
  };
  const mem = getMemory();
  if (!mem.systems || typeof mem.systems !== 'object') mem.systems = {};
  const prev = mem.systems[name];
  mem.systems[name] = cur; // refresh to latest even when nothing notable changed
  saveMemory();
  if (!prev) return null; // first time we've seen this system — nothing to compare
  const isOwn = isUserColony(state || {}, name);

  // 1. Controlling faction shifted INTO a notable state — news because it changed.
  if (prev.factionState !== cur.factionState && /War|CivilWar|Boom|Famine|Outbreak|Lockdown/i.test(cur.factionState)) {
    return {
      key: 'system-change', priority: isOwn ? 56 : 52, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
      inputs: { system: name, state: cur.factionState, own: isOwn },
      intent: `Since the LAST time through ${name}, its controlling faction has shifted into ${cur.factionState}${isOwn ? " — and this is one of the commander's OWN colonies, so it lands harder" : ''}. Fire on the CHANGE (it is NEWS because it is different from what we knew, not a status readout): the new edge / risk / opportunity, in character — a tactical read, the changed atmosphere of the place, or a threat-posture assessment. ${isOwn ? 'Invested — this is yours.' : 'A passing note; we are just passing through.'} Short.`,
      detail: `Detail: ${name} faction state ${prev.factionState || 'stable'} -> ${cur.factionState}${isOwn ? ' (own colony)' : ''}.`,
    };
  }

  // 2. Population grew clearly vs this system's OWN prior figure (a data-relative signal,
  //    not a flat guess) with a small floor to mute noise. Own colonies trip far easier.
  const inc = cur.population - prev.population;
  const pct = prev.population > 0 ? inc / prev.population : 0;
  const notable = inc > 0 && ((isOwn && (pct >= 0.05 || inc >= 500)) || (!isOwn && pct >= 0.15 && inc >= 2000));
  if (notable) {
    return {
      key: 'pop-growth', priority: isOwn ? 54 : 47, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
      inputs: { system: name, from: prev.population, to: cur.population, own: isOwn },
      intent: `Since we last passed through ${name}, its population has clearly grown — ${prev.population.toLocaleString()} to ${cur.population.toLocaleString()}${isOwn ? " — and this is one of the commander's OWN colonies: your work is taking root, people are moving in" : ''}. React to the GROWTH (the place filling up / a build coming alive) in character. ${isOwn ? 'Proud, invested — we helped build this.' : 'A passing observation.'} Short, not a stat dump.`,
      detail: `Detail: ${name} pop ${prev.population.toLocaleString()} -> ${cur.population.toLocaleString()}${isOwn ? ' (own colony)' : ''}.`,
    };
  }
  return null;
}

// Q&A — the co-pilot occasionally asks the commander a tappable question and stores the
// answer (memory.qa), building a model of them for later callbacks. RARE (20-min guard),
// arbiter-gated, on an earned moment (fresh session / quiet cruise). The question text is
// the line; the tappable options ride in beat.question for the cockpit UI. The question
// SET is placeholder pending the TARS rewrite — the pipeline is content-agnostic.
let lastQuestionAt = 0;
const QUESTION_GAP_MS = 20 * 60 * 1000;
export function detectQuestion(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  if (now - lastQuestionAt < QUESTION_GAP_MS) return null;
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  let trigger = null;
  if (events.some((e) => e && e.event === 'LoadGame' && isRecent(e.timestamp))) trigger = 'session-start';
  else if (events.some((e) => e && e.event === 'SupercruiseEntry' && isRecent(e.timestamp))) trigger = 'quiet-cruise';
  if (!trigger) return null;
  const persona = (state && state.settings && state.settings.copilotPersonality) || 'wash';
  const mem = getMemory();
  const q = pickQuestion({ persona, trigger, answeredDurable: (mem.qa && mem.qa.durable) || {}, answeredSession: (mem.qa && mem.qa.session) || {}, hauling: !!getActiveProject(state) });
  if (!q) return null;
  lastQuestionAt = now;
  return {
    key: 'question', priority: 44, interrupt: false, mood: 'calm', character: true,
    line: q.text,
    question: { id: q.id, layer: q.layer, learnKey: q.learnKey, options: q.options },
  };
}

// The known-station record for a marketId (matched on marketId to be key-agnostic).
function stationByMarket(state, marketId) {
  const ks = state && state.knownStations;
  if (!ks || typeof ks !== 'object') return null;
  return Object.values(ks).find((s) => s && s.marketId === marketId) || null;
}

// Rich dock welcome — the SAME data the in-game overlay shows (visit count, who-built-it,
// black market, live faction) but in the persona's voice. Surfaces ONE angle, never a list.
// Fires even MID-HAUL (unlike the muted economy/service affinity), once per place per
// session. Carrier docks are owned by the crew / carrier-home beats, so skip those.
const dockFlavorSaid = new Map();
const DOCK_FLAVOR_MS = 3 * 60 * 60 * 1000;
export function detectDockFlavor(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const dock = events.find((e) => e && e.event === 'Docked' && isRecent(e.timestamp));
  if (!dock || dock.MarketID == null) return null;
  const fc = (state && state.settings) || {};
  if ((fc.myFleetCarrierMarketId != null && dock.MarketID === fc.myFleetCarrierMarketId) || (!!fc.myFleetCarrier && dock.StationName === fc.myFleetCarrier)) return null;
  const last = dockFlavorSaid.get(dock.MarketID);
  if (last && now - last < DOCK_FLAVOR_MS) return null;
  const s = state || {};
  const station = stationByMarket(s, dock.MarketID);
  const facts = [];
  const vc = station ? (station.visitCount || station.dockedCount || 0) : 0;
  if (vc >= 5) facts.push(`this is roughly your ${vc}${ordinal(vc)} time docking at ${dock.StationName} — a well-worn haunt by now`);
  const proj = (Array.isArray(s.projects) ? s.projects : []).find((p) => p && (p.marketId === dock.MarketID || p.completedStationName === dock.StationName));
  if (proj) facts.push('the commander BUILT this place — one of their own colony stations');
  const svcs = (dock.StationServices || (station && station.services) || []).map((x) => String(x).toLowerCase());
  if (svcs.some((x) => x.includes('blackmarket'))) facts.push('there is a BLACK MARKET here — clock it in character (some are amused, some twitchy, some purely factual; never encourage crime)');
  const fst = dock.StationFaction && dock.StationFaction.FactionState;
  if (fst && /War|CivilWar|Boom|Famine|Outbreak|Lockdown/i.test(fst)) facts.push(`the controlling faction reads ${fst} on the docking board (say it as the board's read — it can lag the real state)`);
  if (!facts.length) return null;
  dockFlavorSaid.set(dock.MarketID, now);
  return {
    key: 'dock-flavor', priority: 45, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    inputs: { station: dock.StationName },
    intent: `Just docked at ${dock.StationName}. Pick the SINGLE most interesting thing about this place and land it in character — choose ONE of: ${facts.join(' / ')}. Lead with character; one natural line; NEVER a list, never recite all of them.`,
    detail: `Detail: dock flavour — ${facts.join('; ')}.`,
  };
}

// ── Body dossier ────────────────────────────────────────────────────────────
// The app already STORES rich scan/scout data per body + the visit history. Pull ONLY the things
// you'd actually FEEL/SEE on approach — never orbital params, masses, or material percentages.
export function bodyDossier(state, systemAddress, systemName, bodyName) {
  if (!state || !bodyName) return null;
  const addr = String(systemAddress || '');
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const cached = (((state.scoutedSystems || {})[addr] || {}).cachedBodies || []).find((b) => eq(b.name, bodyName));
  const scanned = (((state.journalExplorationCache || {})[addr] || {}).scannedBodies || []).find((b) => eq(b.bodyName, bodyName));
  if (!cached && !scanned) return null;
  // Atmosphere: the TYPE is the descriptor — Spansh keeps the "Thin" qualifier the journal drops.
  // The composition is the gas MIX of that (thin) atmosphere, NOT its thickness — never quote a %.
  const atmoType = (cached && cached.atmosphereType) || (scanned && scanned.atmosphereType) || '';
  const comp = (cached && cached.atmosphereComposition) || {};
  const traces = Object.keys(comp).filter((g) => comp[g] > 0 && !/^(oxygen|nitrogen|carbon dioxide|argon|water|ammonia|methane|helium|neon|iron)$/i.test(g));
  const gravityG = (cached && Number.isFinite(cached.gravity)) ? cached.gravity
    : (scanned && Number.isFinite(scanned.gravity)) ? scanned.gravity / 9.81 : null; // journal gravity is m/s²
  const tempK = (scanned && scanned.surfaceTemperature) || (cached && cached.surfaceTemperature) || null;
  const volc = (scanned && scanned.volcanism) || (cached && cached.volcanismType) || '';
  const bf = state.bodyFlags || {};
  const brainTrees = Object.keys(bf).some((k) => eq(k, `${systemName || ''}|${bodyName}`) && bf[k] && bf[k].brainTrees);
  const landings = (((state.bodyVisits || {})[`${addr}|${bodyName}`]) || {}).landingCount || 0;
  const dockings = Object.values(state.knownStations || {}).filter((s) => s && eq(s.body, bodyName)).reduce((a, s) => a + (s.dockedCount || s.visitCount || 0), 0);
  return { atmoType, traces, gravityG, tempK, volc, brainTrees, landings, dockings, timesHere: landings + dockings };
}

// Turn the dossier into the handful of EXPERIENTIAL facts the model may react to (persona-agnostic).
export function dossierFlavour(d, opts = {}) {
  if (!d) return [];
  const f = [];
  // Visit history is ARRIVAL-only (opts.visits) — folding it into every line made the model fixate
  // on the same datum across beats. And when landings===0, skip the set-down breakdown: docking at a
  // SURFACE outpost is standing on the ground; "never set foot here" read absurd to the commander.
  if (opts.visits && d.timesHere >= 5) {
    // High counts: hand over the SCALE, not a figure to recite — a human alludes ("more times than
    // you'd bother counting"); only a precise-machine character would quote the number, sparingly.
    f.push(d.timesHere >= 20
      ? `you have been to THIS world a great MANY times (${d.timesHere} on the books — allude to the scale, do NOT quote the figure unless your character is the precise-machine type, and even then rarely)`
      : `roughly your ${d.timesHere}${ordinal(d.timesHere)} time at THIS world${d.landings > 0 ? ` (${d.landings} surface set-downs + ${d.dockings} dockings at sites on it)` : ''}`);
  }
  if (d.atmoType) {
    const thin = /thin/i.test(d.atmoType);
    const sulphur = d.traces.some((g) => /sulph|sulf/i.test(g));
    f.push(`a ${d.atmoType.toLowerCase()} atmosphere${d.traces.length ? ` (trace ${d.traces.join(', ').toLowerCase()})` : ''} — it tints the sky${thin ? ', and thin air means less bite on the controls on the way down' : ''}${sulphur ? '; sulphurous and acrid — not air you would want to crack the canopy in' : ''}`);
  }
  if (Number.isFinite(d.gravityG)) {
    f.push(d.gravityG < 0.5 ? `low gravity, about ${d.gravityG.toFixed(2)}g — she will feel floaty and lift off easy`
      : d.gravityG > 2 ? `heavy gravity, ${d.gravityG.toFixed(2)}g — she will fly like a brick, mind the descent`
      : `gravity around ${d.gravityG.toFixed(2)}g`);
  }
  if (Number.isFinite(d.tempK)) {
    if (d.tempK < 150) f.push(`a frigid surface, about ${Math.round(d.tempK)}K`);
    else if (d.tempK < 255) f.push(`a cold surface, about ${Math.round(d.tempK)}K`);
    else if (d.tempK > 600) f.push(`a scorching surface, about ${Math.round(d.tempK)}K`);
    else if (d.tempK > 350) f.push(`a hot surface, about ${Math.round(d.tempK)}K`);
  }
  if (/geyser/i.test(d.volc)) f.push('silicate vapour geysers venting on the surface — visible from up here');
  if (d.brainTrees) f.push('brain trees somewhere down on the surface');
  return f;
}

// Rich "here we are" on dropping out of supercruise — reacts to the actual view using the body's
// OWN stored dossier (atmosphere / gravity / temp / geysers / brain trees / how often we've been).
let lastArrivalAt = 0;
let lastStationDropTs = 0; // ts of the last SupercruiseDestinationDrop AT a station/carrier — survives tick boundaries
const ARRIVAL_GAP_MS = 8 * 60 * 1000;
export function detectArrival(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  // Track station/carrier destination drops BEFORE any early return: a drop AT a station/carrier
  // writes SupercruiseDestinationDrop (with a MarketID) ~2s before the SupercruiseExit — and the
  // exit's Body is just whatever the station ORBITS (journal-verified: an FC drop reports
  // Body="…1 a", BodyType="Planet"). The two events can land in DIFFERENT poll ticks, so a
  // same-batch check misses — the marker must persist across ticks.
  for (const e of events) {
    if (e && e.event === 'SupercruiseDestinationDrop' && e.MarketID != null && isRecent(e.timestamp)) {
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t) && t > lastStationDropTs) lastStationDropTs = t;
    }
  }
  if (now - lastArrivalAt < ARRIVAL_GAP_MS) return null;
  const drop = events.find((e) => e && e.event === 'SupercruiseExit' && isRecent(e.timestamp));
  if (!drop) return null;
  // Exit within a minute of a station/carrier destination drop = a PARKING move, not a body
  // arrival — the dock beats own it. Skip, or we narrate the body the commander just left.
  const dropTs = Date.parse(drop.timestamp);
  if (Number.isFinite(dropTs) && Math.abs(dropTs - lastStationDropTs) < 60000) return null;
  const body = drop.Body || drop.BodyName || world.body;
  if (!body) return null;
  // Nav-locked to our OWN fleet carrier → this is a carrier drop, not a body arrival; the
  // carrier-home / fc-dock-request beats own it (a "rock" comment here was a real 👎).
  const fcs = (state && state.settings) || {};
  if (navDestination && fcs.myFleetCarrier && navDestination.name === fcs.myFleetCarrier) return null;
  lastArrivalAt = now;
  const facts = dossierFlavour(bodyDossier(state, drop.SystemAddress, drop.StarSystem || world.system, body), { visits: true });
  if (facts.length) {
    return {
      key: 'arrival', priority: 47, interrupt: false, live: true, model: 'sonnet', mood: 'awe', character: true,
      inputs: { body },
      intent: `Just dropped out of supercruise on the approach to ${body}. React IN CHARACTER to the view and the approach, using ONLY these real stored facts (never invent beyond them) — lead with the ONE or two most striking, NEVER a list: ${facts.join(' / ')}. One or two natural sentences.`,
      detail: `Detail: arrival — ${facts.join('; ')}.`,
    };
  }
  return {
    key: 'arrival', priority: 43, interrupt: false, live: true, model: 'sonnet', mood: 'calm', character: true,
    inputs: { body },
    intent: `Just dropped out of supercruise at ${body}. A brief, in-character "here we are / made it" — note WHERE we've arrived. Do NOT invent details about the body beyond what's named. One natural line.`,
    detail: `Detail: arrived at ${body}.`,
  };
}

// ── Damage severity ladder ─────────────────────────────────────────────────
// Four-tier synthetic detector replacing the old two-entry matchBeat damage/damage-critical.
// Context inference (combat / shields-down / environmental). Cleanly skips HullDamage ticks
// owned by detectInferredDamage (emergency-drop / hard-landing) — no double-fire.
let lastDamageBeatAt = 0;
let lastDamageRank = 0; // 0 none / 1 scratched / 2 hit / 3 serious / 4 critical — lets a WORSENING hull escalate through the cooldown
const DAMAGE_COOLDOWN_MS = 30000;

export function detectDamageSeverity(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  const recent = events.filter((e) => e && isRecent(e.timestamp));

  const hasHullDmg = recent.some((e) => e.event === 'HullDamage');
  if (hasHullDmg && recent.some((e) => e.event === 'SupercruiseExit' || e.event === 'Touchdown')) return null;

  const hullDmg = recent.find((e) => e.event === 'HullDamage' && typeof e.Health === 'number');
  const underAttack = recent.some((e) => e.event === 'UnderAttack');
  const shieldsDown = recent.some((e) => e.event === 'ShieldState' && e.ShieldsUp === false);

  if (!hullDmg && !underAttack && !shieldsDown) return null;

  const hull = hullDmg ? hullDmg.Health : null;
  const pct = hull != null ? Math.round(hull * 100) : null;

  let severity, prio, mood, interrupt, rank;
  if (hull != null && hull < 0.40) { severity = 'critical'; prio = 105; mood = 'panic'; interrupt = true; rank = 4; }
  else if (hull != null && hull < 0.65) { severity = 'serious'; prio = 95; mood = 'brace'; interrupt = true; rank = 3; }
  else if (hull != null && hull < 0.85) { severity = 'hit'; prio = 75; mood = 'brace'; interrupt = true; rank = 2; }
  else if (shieldsDown && !hullDmg) { severity = 'hit'; prio = 70; mood = 'brace'; interrupt = true; rank = 2; }
  else { severity = 'scratched'; prio = 55; mood = 'calm'; interrupt = false; rank = 1; }

  // Cooldown gate — but a WORSENING hull escalates THROUGH it, so the ladder can jump hit→critical
  // inside the 30s window. Same-or-lower severity waits the cooldown out (no downgrade-spam). Once the
  // window lapses the rank resets to whatever fires next, so a fresh encounter starts clean.
  const cooling = now - lastDamageBeatAt < DAMAGE_COOLDOWN_MS;
  if (cooling && rank <= lastDamageRank) return null;
  lastDamageBeatAt = now;
  lastDamageRank = cooling ? Math.max(lastDamageRank, rank) : rank;

  const interdicted = recent.some((e) => e.event === 'Interdicted');
  let context = 'unknown';
  if (interdicted || underAttack) context = 'combat';
  else if (shieldsDown && !hullDmg) context = 'shields-down';

  const persona = (state && state.settings && state.settings.copilotPersonality) || 'wash';
  const personaAngle = persona === 'wash'
    ? 'Wash feels it HARD — escalates fast, human fear, wants to run'
    : persona === 'k2'
    ? 'K2 stays tactical — clinical damage assessment, only breaks composure at critical'
    : 'TARS tracks the math precisely — hull percentage, rate of damage, factual concern that builds';

  const contextDesc = context === 'combat'
    ? 'under fire from a hostile — combat damage'
    : context === 'shields-down'
    ? 'shields just went down — exposed now'
    : 'taking damage from an unknown source';

  const hullInfo = pct != null ? `Hull at ${pct}%` : 'Hull intact but exposed';

  return {
    key: `dmg-${severity}`, priority: prio, interrupt, live: true, model: severity === 'critical' ? 'sonnet' : 'haiku',
    mood,
    intent: `${hullInfo} — ${severity} damage. ${contextDesc}. ${personaAngle}. React at the ${severity} level: ${
      severity === 'scratched' ? 'minor, felt that one, a wry note — no alarm'
      : severity === 'hit' ? 'real concern now, this is adding up, urge caution'
      : severity === 'serious' ? 'genuine urgency, get clear or get safe, this is bad'
      : 'full alarm, near-death, retreat NOW or we die here'
    }. Scale the reaction to the SEVERITY, not just the event.`,
    detail: `Detail: ${hullInfo}, ${contextDesc}.`,
  };
}

// ── Carrier tritium watch (state-driven) ────────────────────────────────────
// Reads the PERSISTED fuel level (fleetCarrierSpaceUsage) instead of waiting on a live
// CarrierStats event — the old event-edge version required opening carrier management AND
// consumed its one-shot edge even when another beat won the tick (carrier sat at 193t for
// days with no line). Re-offers hourly while low, so losing arbitration once isn't fatal;
// resets when refuelled above the threshold.
const FUEL_LOW_T = 300;
const FUEL_CRIT_T = 50;
const FUEL_OFFER_GAP_MS = 60 * 60 * 1000;
let lastFuelOfferAt = 0;
let prevFuelLevel = null;

export function detectCarrierFuel(state) {
  const s = state || {};
  const fc = s.settings || {};
  const callsign = fc.myFleetCarrier;
  if (!callsign) return null;
  const u = s.fleetCarrierSpaceUsage && s.fleetCarrierSpaceUsage[callsign];
  const fuel = u && typeof u.fuelLevel === 'number' ? u.fuelLevel : null;
  if (fuel == null) return null;
  const prev = prevFuelLevel;
  prevFuelLevel = fuel;
  if (fuel >= FUEL_LOW_T) return null; // healthy — the next drop below re-arms via `prev`
  const crit = fuel < FUEL_CRIT_T;
  const crossed = prev == null || (crit ? prev >= FUEL_CRIT_T : prev >= FUEL_LOW_T);
  const now = Date.now();
  if (!crossed && now - lastFuelOfferAt < FUEL_OFFER_GAP_MS) return null;
  lastFuelOfferAt = now;
  const nm = (u.name && u.name.trim()) || ((s.fleetCarrierSpaceUsage || {})[callsign] || {}).name || 'the carrier';
  return {
    key: crit ? 'carrier-fuel-crit' : 'carrier-fuel-low',
    priority: crit ? 62 : 54, interrupt: false, live: true, model: 'haiku', mood: crit ? 'brace' : 'calm',
    inputs: { fuel, carrier: nm },
    intent: crit
      ? `The ${nm} is CRITICALLY low on tritium — about ${fuel}t in the reserve, not enough for a full jump; she risks being stranded. A pointed, practical heads-up: refuel her before moving her. Refer to her by NAME, never the callsign.`
      : `The ${nm} is getting low on tritium — about ${fuel}t in the reserve. A brief, practical heads-up to top her up before her next jump. Refer to her by NAME, never the callsign.`,
    detail: `Detail: carrier tritium ~${fuel}t${crit ? ' (critical)' : ' (low)'}.`,
  };
}

// ── Load-rate "running behind average" nudge ───────────────────────────────
// Session-only, non-persisted tracking. Silent until ≥5 deliveries (baseline).
// 30-min cooldown. Active-haul only.
const paceDeliveries = [];
let lastPaceNudgeAt = 0;
const PACE_NUDGE_GAP_MS = 30 * 60 * 1000;
const PACE_MIN_DELIVERIES = 5;

export function detectPaceNudge(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };

  // New session → drop the prior session's cadence so the average never blends across sessions.
  if (events.some((e) => e && e.event === 'LoadGame' && isRecent(e.timestamp))) {
    paceDeliveries.length = 0;
    lastPaceNudgeAt = 0;
  }

  if (!getActiveProject(state)) return null;

  for (const ev of events) {
    if (!ev || !isRecent(ev.timestamp)) continue;
    if (ev.event === 'MarketBuy' && ev.Count) {
      paceDeliveries.push({ at: Date.parse(ev.timestamp), tons: ev.Count });
    } else if (ev.event === 'CargoTransfer' && Array.isArray(ev.Transfers)) {
      const tons = ev.Transfers.filter((t) => t && t.Direction === 'toship').reduce((a, t) => a + (t.Count || 0), 0);
      if (tons > 0) paceDeliveries.push({ at: Date.parse(ev.timestamp), tons });
    }
  }

  if (paceDeliveries.length < PACE_MIN_DELIVERIES) return null;
  if (now - lastPaceNudgeAt < PACE_NUDGE_GAP_MS) return null;

  const gaps = [];
  for (let i = 1; i < paceDeliveries.length; i++) {
    const gap = paceDeliveries[i].at - paceDeliveries[i - 1].at;
    if (gap > 0 && gap < 3600000) gaps.push(gap);
  }
  if (gaps.length < 3) return null;

  const avgGap = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  const currentGap = now - paceDeliveries[paceDeliveries.length - 1].at;

  if (currentGap < avgGap * 1.5 || currentGap < 300000) return null;

  lastPaceNudgeAt = now;
  const avgMins = Math.round(avgGap / 60000);
  const curMins = Math.round(currentGap / 60000);

  return {
    key: 'pace-nudge', priority: 38, interrupt: false, live: true, model: 'haiku', mood: 'calm', character: true,
    intent: `The haul's rhythm has slowed — the commander was averaging about ${avgMins} minutes between loads, but it's been ${curMins} minutes since the last one. A light, in-character nudge: Wash notices the rhythm breaking ("we were cranking earlier"); TARS gives the precise pace comparison; K2 is blunt ("you are slower than you were"). NOT a nag, NOT a status report — a co-pilot who notices you've lost the groove. One line.`,
    detail: `Detail: avg cycle ${avgMins}min, current gap ${curMins}min.`,
  };
}

function fmtCr(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} billion credits`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} million credits`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k credits`;
  return `${v} credits`;
}
