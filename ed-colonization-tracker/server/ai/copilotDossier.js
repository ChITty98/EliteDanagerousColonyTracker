// server/ai/copilotDossier.js
//
// The station FACT SHEET a co-pilot opinion is built from — every fact the app actually holds about the
// place the commander was just cleared to dock at, each with a stable id, the numbers it may be quoted
// with, how it pulls each persona (copilotTastes.js) and how notable it is (salience).
//
// The opinion model sees ONLY these facts and must cite the ids it leans on; copilotOpinions checks
// every cited id and every number against this sheet. So anything not built here cannot be said.
//
// Pure: reads the state, the co-pilot memory and the nearby-now window handed in; writes nothing.
// Sources, all already on disk: knownStations (pads, services, economy mix, owner, body, docks),
// knownSystems (population, economies), systemFactions (owner's influence/state/reputation, conflicts),
// scoutedSystems cachedBodies (the world under the station, the system's stars), marketSnapshots
// (prices vs the galactic mean), projects + manualColonizedSystems (own colonies), copilot memory
// (grudges, turn-aways).

import { normaliseStationType } from './copilotStations.js';
import { influenceTrend, reputationBand } from '../journal/factions.js';
import { padNeedFor, friendlyShip } from '../journal/extractor.js';
import * as T from './copilotTastes.js';

const ZERO = { wash: 0, tars: 0, k2: 0 };
const lc = (s) => String(s || '').trim().toLowerCase();
const pct = (x) => Math.round(Number(x) * 100);
const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');
const aOrAn = (w) => (/^[aeiou]/i.test(String(w || '')) ? 'an' : 'a');

const ARCH_LABEL = {
  coriolis: 'Coriolis starport', orbis: 'Orbis starport', ocellus: 'Ocellus starport', asteroid: 'asteroid base',
  dodec: 'Dodec starport', megaship: 'megaship', outpost: 'outpost', 'planetary-port': 'planetary port',
  'surface-outpost': 'surface outpost', settlement: 'settlement', construction: 'construction site',
};
const SURFACE_ARCH = new Set(['planetary-port', 'surface-outpost', 'settlement']);

// Journal economy ids ($economy_Agri;) → the names the taste tables use.
const ECON_IDS = {
  agri: 'Agriculture', agriculture: 'Agriculture', extraction: 'Extraction', refinery: 'Refinery',
  industrial: 'Industrial', hightech: 'High Tech', military: 'Military', tourism: 'Tourism',
  service: 'Service', colony: 'Colony', terraforming: 'Terraforming', prison: 'Prison',
  damaged: 'Damaged', rescue: 'Rescue', repair: 'Repair', carrier: 'Private Enterprise',
};
export function economyName(localised, raw) {
  const loc = String(localised || '').trim();
  if (/^high\s*tech$/i.test(loc)) return 'High Tech';
  if (loc) return loc;
  const m = String(raw || '').match(/\$economy_([a-z]+);?/i);
  return m ? (ECON_IDS[m[1].toLowerCase()] || m[1]) : null;
}

/**
 * [{ name, weight, rel }] strongest first, from either the journal's StationEconomies or a knownStations
 * record. The journal's Proportion is a WEIGHT, not a share — a single-economy station can read 1.4, a
 * three-way mix 0.6 / 0.55 / 0.4 — so it is never quoted as a percentage. `rel` = weight ÷ the main
 * economy's weight: 1 for the main one, ≥ 0.5 a strong secondary side, ≥ 0.25 some of it.
 */
export function economyMix(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e) continue;
    const name = economyName(e.Name_Localised || e.nameLocalised, e.Name || e.name);
    const weight = Number(e.Proportion ?? e.proportion);
    if (name && Number.isFinite(weight) && weight > 0) out.push({ name, weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  const top = out.length ? out[0].weight : 1;
  return out.map((e) => ({ ...e, rel: e.weight / top }));
}

function securityBand(text) {
  const t = lc(text);
  if (!t) return null;
  if (t.includes('anarchy') || t.includes('lawless')) return 'Anarchy';
  if (t.includes('high')) return 'High';
  if (t.includes('medium')) return 'Medium';
  if (t.includes('low')) return 'Low';
  return null;
}

function stationRecord(state, marketId) {
  const ks = (state && state.knownStations) || {};
  return Object.values(ks).find((s) => s && s.marketId === marketId) || null;
}
function systemRecord(state, name) {
  const ks = (state && state.knownSystems) || {};
  return ks[name] || Object.values(ks).find((s) => s && lc(s.systemName) === lc(name)) || null;
}
function cachedBodiesFor(state, systemAddress) {
  const sc = ((state && state.scoutedSystems) || {})[String(systemAddress || '')];
  return (sc && Array.isArray(sc.cachedBodies)) ? sc.cachedBodies : [];
}
function bodyOfStation(bodies, stationName) {
  const n = lc(stationName);
  return bodies.find((b) => Array.isArray(b.stations) && b.stations.some((s) => lc(s && typeof s === 'object' ? s.name : s) === n)) || null;
}
function ownColonySystems(state) {
  const s = state || {};
  const set = new Set();
  for (const p of Array.isArray(s.projects) ? s.projects : []) if (p && p.systemName) set.add(lc(p.systemName));
  for (const m of Array.isArray(s.manualColonizedSystems) ? s.manualColonizedSystems : []) {
    const n = typeof m === 'string' ? m : (m && (m.systemName || m.name));
    if (n) set.add(lc(n));
  }
  return set;
}

/**
 * Build the fact sheet.
 * @param {object} o
 * @param {object} o.ev        the DockingGranted event ({ StationName, StationType, MarketID, timestamp })
 * @param {object} o.state     colony-data state
 * @param {string} o.persona   'wash' | 'tars' | 'k2'
 * @param {object} [o.memory]  co-pilot memory (grudges, dockDenials)
 * @param {object} [o.nearby]  nearbyNow(marketId) result — other pilots at this station, last 30 min
 * @param {number} [o.now]
 * @returns {{ identity: object, facts: Array<{id:string, group:string, text:string, numbers:number[], pull:object, value:any, salience:number}> }}
 */
export function buildStationDossier({ ev, state, persona, memory = {}, nearby = null, now = Date.now() }) {
  const s = state || {};
  const marketId = ev && ev.MarketID;
  const rec = stationRecord(s, marketId);
  const stationName = (ev && ev.StationName) || (rec && rec.stationName) || 'this station';
  // commanderPosition carries `systemName` — on a FIRST visit (no station record yet) that is the only
  // way to know the system, and reading the wrong field left every system fact off the sheet.
  const systemName = (rec && rec.systemName) || (s.commanderPosition && (s.commanderPosition.systemName || s.commanderPosition.name || s.commanderPosition.system)) || s.currentSystem || '';
  const systemAddress = (rec && rec.systemAddress) || null;
  const archKey = normaliseStationType((ev && ev.StationType) || (rec && rec.stationType));
  const isConstruction = archKey === 'construction' || /construction site|colonisationship/i.test(stationName);
  const facts = [];
  const add = (id, group, text, o = {}) => {
    const pull = o.pull || ZERO;
    const base = Number.isFinite(o.salience) ? o.salience : 20;
    facts.push({
      id, group, text,
      numbers: (o.numbers || []).map(Number).filter(Number.isFinite),
      pull: { wash: pull.wash || 0, tars: pull.tars || 0, k2: pull.k2 || 0 },
      value: o.value !== undefined ? o.value : text,
      salience: Math.min(100, base + Math.abs(pull[persona] || 0) * 10),
    });
  };

  // ── The building ──
  const typeLabel = (archKey && ARCH_LABEL[archKey]) || String((ev && ev.StationType) || (rec && rec.stationType) || 'station');
  add('type', 'architecture', `${stationName} is ${aOrAn(typeLabel)} ${typeLabel}`, { value: archKey || typeLabel, salience: 25 });
  if (isConstruction) add('lifecycle.construction', 'lifecycle', 'An unfinished construction site — a delivery point, not yet a working station', { pull: T.CONSTRUCTION_PULL, value: 'construction', salience: 45 });

  const pads = rec && rec.landingPads;
  const shipType = s.currentShip && typeof s.currentShip === 'object' ? s.currentShip.type : s.currentShip;
  if (pads && typeof pads === 'object' && !isConstruction) {
    const sm = Number(pads.small ?? pads.Small) || 0;
    const md = Number(pads.medium ?? pads.Medium) || 0;
    const lg = Number(pads.large ?? pads.Large) || 0;
    const need = shipType ? padNeedFor(shipType) : null;
    const fit = need === 3 ? lg : need === 2 ? md + lg : need === 1 ? sm + md + lg : null;
    // friendlyShip() hands back the raw journal id for hulls it doesn't know yet (anacondamkii) — say "your ship" then.
    const named = shipType ? friendlyShip(String(shipType).toLowerCase()) : null;
    const ship = named && named !== String(shipType).toLowerCase() ? `the ${named}` : 'your ship';
    const band = fit === 1 ? 'tight' : fit != null && fit >= 8 ? 'roomy' : null;
    add('pads', 'pads', `Landing pads: ${sm} small, ${md} medium, ${lg} large${fit ? ` — ${fit} of them fit ${ship}` : ''}`,
      { pull: band ? T.PADS_PULL[band] : ZERO, numbers: [sm, md, lg, fit], value: `${sm}/${md}/${lg}`, salience: band === 'tight' ? 55 : band === 'roomy' ? 25 : 12 });
  }

  const ls = Number(rec && rec.distFromStarLS);
  if (Number.isFinite(ls) && ls > 0) {
    const band = ls >= 50_000 ? 'far' : ls <= 100 ? 'close' : null;
    add('distance', 'distance', `${fmt(ls)} light-seconds from the arrival star${band === 'far' ? ' — a long supercruise out' : band === 'close' ? ' — barely a hop from the star' : ''}`,
      { pull: band ? T.DISTANCE_PULL[band] : ZERO, numbers: [Math.round(ls)], value: band || 'mid', salience: band === 'far' ? (ls >= 150_000 ? 60 : 50) : band === 'close' ? 25 : 8 });
  }

  const services = ((rec && rec.services) || []).map((x) => lc(x));
  for (const [k, def] of Object.entries(T.SERVICE_PULL)) {
    if (services.some((x) => x === k || x.includes(k))) add(`svc.${k}`, 'services', `Has ${def.label}`, { pull: def.pull, value: true, salience: k === 'blackmarket' ? 40 : 28 });
  }

  // ── Economy (by share — the commander's spec), skipped entirely when the main economy is a rare one ──
  const mix = economyMix(rec && rec.economies);
  if (mix.length && !T.RARE_ECONOMIES.has(mix[0].name) && !isConstruction) {
    for (const e of mix.filter((x) => x.rel >= 0.25).slice(0, 3)) {
      const text = e.rel >= 0.999 ? `${aOrAn(e.name) === 'an' ? 'An' : 'A'} ${e.name} economy station${mix.length > 1 ? ' at heart' : ''}`
        : e.rel >= 0.5 ? `A strong ${e.name} side to its economy` : `Some ${e.name} in its economy`;
      const band = e.rel >= 0.999 ? 'main' : e.rel >= 0.5 ? 'strong' : 'some';
      add(`econ.${e.name}`, 'economy', text, { pull: T.ECONOMY_PULL[e.name] || ZERO, value: band, salience: band === 'main' ? 45 : band === 'strong' ? 35 : 22 });
    }
  }
  const sys = systemName ? systemRecord(s, systemName) : null;
  const sysEcon = sys && (sys.economyLocalised || sys.economy);
  if (sysEcon && mix.length && !T.RARE_ECONOMIES.has(mix[0].name) && lc(sysEcon) !== lc(mix[0].name) && !/^none$/i.test(sysEcon)) {
    add('econ.system', 'economy', `${aOrAn(mix[0].name).replace(/^a/, 'A')} ${mix[0].name} station in ${aOrAn(sysEcon)} ${sysEcon} system`, { value: sysEcon, salience: 30 });
  }

  // ── The system ──
  const pop = Number(sys && sys.population);
  if (Number.isFinite(pop) && pop > 0) {
    const band = pop >= 1e9 ? 'crowded' : pop < 100_000 ? 'sparse' : null;
    add('pop', 'population', `System population about ${fmt(pop)}`, { pull: band ? T.POPULATION_PULL[band] : ZERO, numbers: [pop], value: band || 'normal', salience: band ? 40 : 10 });
  }
  const fx = systemName ? ((s.systemFactions || {})[lc(systemName)] || null) : null;
  const sec = securityBand(fx && fx.security);
  if (sec) add('security', 'security', `${sec === 'Anarchy' ? 'An anarchy — no law here' : `${sec} security system`}`, { pull: T.SECURITY_PULL[sec], value: sec, salience: { Anarchy: 50, Low: 35, High: 15, Medium: 5 }[sec] });
  const alleg = (fx && fx.allegiance) || (rec && rec.allegiance) || null;
  if (alleg && T.SUPERPOWER_PULL[alleg]) add('allegiance', 'politics', `${alleg} space`, { pull: T.SUPERPOWER_PULL[alleg], value: alleg, salience: 22 });

  // ── Who runs the station ──
  const ownerName = (rec && (rec.currentFaction || rec.faction)) || null;
  const owner = fx && ownerName ? (fx.factions || []).find((f) => f && f.name === ownerName) : null;
  const readingAge = fx && fx.updatedAt ? (now - Date.parse(fx.updatedAt)) / 86400e3 : null;
  const asOf = readingAge != null && readingAge > 1 ? ` (reading from ${String(fx.updatedAt).slice(0, 10)})` : '';
  if (ownerName) {
    const gov = (owner && owner.government) || (rec && rec.government) || null;
    const ownAlleg = (owner && owner.allegiance) || null;
    const auth = gov && T.AUTHORITARIAN.has(gov) ? ' — authoritarian rule' : '';
    add('owner', 'faction', `Run by ${ownerName}${gov || ownAlleg ? ` (${[gov, ownAlleg].filter(Boolean).join(', ')})` : ''}${auth}`, { pull: (gov && T.GOVERNMENT_PULL[gov]) || ZERO, value: `${ownerName}|${gov || ''}`, salience: 28 });
    if (owner) {
      const states = [...new Set([...(owner.active || []), owner.state].filter(Boolean))];
      for (const st of states) {
        if (!(st in T.STATE_PULL)) continue;
        add(`owner.state.${st}`, 'faction', `${ownerName} is in ${st}${asOf}`, { pull: T.STATE_PULL[st], value: st, salience: /war/i.test(st) ? 60 : 35 });
      }
      const inf = pct(owner.influence || 0);
      const tr = influenceTrend(fx, ownerName);
      const arrow = tr && tr.arrow ? (tr.arrow === '▲' ? ', rising' : tr.arrow === '▼' ? ', falling' : '') : '';
      add('owner.influence', 'faction', `${ownerName} holds ${inf}% influence in the system${arrow}${asOf}`, { numbers: [inf], value: inf, salience: inf >= 60 || inf < 15 ? 30 : 15 });
      const band = reputationBand(owner.reputation);
      if (band && T.REPUTATION_PULL[band]) add('owner.rep', 'faction', `The commander is ${band} with ${ownerName}`, { pull: T.REPUTATION_PULL[band], value: band, salience: 32 });
    }
    // Wars the owner is fighting (journal Conflicts, kept by factions.js since 1.61.0).
    for (const c of Array.isArray(fx && fx.conflicts) ? fx.conflicts : []) {
      const side = (c.factions || []).find((f) => f && f.name === ownerName);
      const other = (c.factions || []).find((f) => f && f.name !== ownerName);
      if (!side || !other || !c.status || /^none$/i.test(c.status)) continue;
      const kind = /^civilwar$/i.test(c.warType) ? 'civil war' : /^election$/i.test(c.warType) ? 'election' : 'war';
      const days = `${side.wonDays ?? 0}–${other.wonDays ?? 0}`;
      const staked = lc(side.stake) && lc(stationName).includes(lc(side.stake));
      if (staked) {
        add('war.stake', 'war', `This station is ${ownerName}'s stake in its ${kind} with ${other.name} — days won ${days}${c.status === 'pending' ? ' (not started yet)' : ''}${asOf}`,
          { pull: T.WAR_STAKE_PULL, numbers: [side.wonDays ?? 0, other.wonDays ?? 0], value: `${c.status}|${days}`, salience: 80 });
      } else {
        add(`war.${other.name}`, 'war', `${ownerName} is in a ${kind} with ${other.name} — days won ${days}${c.status === 'pending' ? ' (not started yet)' : ''}${asOf}`,
          { pull: kind === 'election' ? ZERO : T.STATE_PULL.War, numbers: [side.wonDays ?? 0, other.wonDays ?? 0], value: `${c.status}|${days}`, salience: kind === 'election' ? 35 : 55 });
      }
    }
  }

  // ── The world it sits on or over, and the system's stars ──
  const bodies = cachedBodiesFor(s, systemAddress);
  const bodyName = (rec && rec.body) || (bodyOfStation(bodies, stationName) || {}).name || null;
  const body = bodyName ? bodies.find((b) => lc(b.name) === lc(bodyName)) : null;
  if (bodyName) {
    const where = archKey && SURFACE_ARCH.has(archKey) ? 'On' : 'Over';
    const short = systemName && lc(bodyName).startsWith(lc(systemName)) ? bodyName.slice(systemName.length).trim() || bodyName : bodyName;
    const cls = body && body.subType ? String(body.subType) : '';
    const clsKey = /metal-rich|metal rich/i.test(cls) ? 'metalRich' : /icy/i.test(cls) ? 'icy' : /water world/i.test(cls) ? 'waterWorld' : /earth-like|earthlike/i.test(cls) ? 'earthLike' : null;
    add('planet', 'planet', `${where} ${short}${cls ? `, a ${cls.toLowerCase()}` : ''}`, { pull: clsKey ? T.BODY_PULL[clsKey] : ZERO, value: cls || bodyName, salience: clsKey ? 40 : 22 });
    const atmo = lc(body && body.atmosphereType);
    if (atmo && !/no atmosphere/.test(atmo)) {
      const rare = /oxygen|nitrogen|ammonia|helium/.test(atmo);
      const so2 = /sulphur|sulfur/.test(atmo);
      add('planet.atmo', 'planet', `${body.atmosphereType} atmosphere`, { pull: rare ? T.BODY_PULL.rareAtmosphere : so2 ? T.BODY_PULL.sulphurDioxide : ZERO, value: atmo, salience: rare || so2 ? 45 : 15 });
    }
    const volc = lc(body && body.volcanismType);
    if (volc && !/no volcanism/.test(volc)) {
      const gey = /geyser/.test(volc);
      add('planet.volc', 'planet', `${body.volcanismType}`, { pull: gey ? T.BODY_PULL.geysers : T.BODY_PULL.volcanism, value: volc, salience: gey ? 45 : 40 });
    }
    const g = Number(body && body.gravity);
    if (Number.isFinite(g) && g >= 2.5) add('planet.grav', 'planet', `Heavy gravity, ${g.toFixed(1)}g`, { pull: T.BODY_PULL.highGravity, numbers: [Number(g.toFixed(1))], value: 'heavy', salience: 40 });
  }
  const stars = bodies.filter((b) => b && /star/i.test(b.type || ''));
  // The scout's score keeps the star finds even when Spansh's body list is thin ("⚫★ Black Hole: +20").
  const starNotes = (((((s.scoutedSystems || {})[String(systemAddress || '')] || {}).score) || {}).starDetails || []).join(' ');
  if (stars.some((b) => /black hole/i.test(b.subType || '')) || /black hole/i.test(starNotes)) add('star.blackhole', 'stars', 'The system has a black hole', { pull: T.STAR_PULL.blackHole, value: true, salience: 55 });
  else if (stars.some((b) => /neutron/i.test(b.subType || '')) || /neutron/i.test(starNotes)) add('star.neutron', 'stars', 'The system has a neutron star', { pull: T.STAR_PULL.neutron, value: true, salience: 45 });
  const bright = stars.find((b) => /^(O|B) /.test(String(b.subType || '')) && b.mainStar);
  if (bright) add('star.bright', 'stars', `The arrival star is a ${String(bright.subType).replace(/ Star$/, '').toLowerCase()} — very bright`, { pull: T.STAR_PULL.brightStar, value: bright.subType, salience: 30 });

  // ── Who greets you here — read off the station services screen in one of your screenshots (1.62.0) ──
  const rep = rec && rec.representative;
  if (rep && rep.name) {
    const who = `${rep.title ? `${rep.title} ` : ''}${rep.name}`;
    add('people.rep', 'people', `${who} is the station's representative${rep.greeting ? ` — their greeting: "${rep.greeting}"` : ''} (read off the commander's screenshot)`, { value: who, salience: 38 });
  }

  // ── The commander's history here ──
  const docks = Number(rec && (rec.dockedCount ?? rec.visitCount)) || 0;
  const projects = Array.isArray(s.projects) ? s.projects : [];
  const ownSystem = !!systemName && ownColonySystems(s).has(lc(systemName));
  // Only a system's architect can lay construction sites in it, so a site in one of the commander's own
  // colony systems is theirs — even on the first clearance, before the app has made its project (the
  // project is created at Docked, after this). Commander: "It's MY construction site."
  const ownSite = isConstruction && ownSystem;
  const built = ownSite || projects.some((p) => p && (p.marketId === marketId || (p.completedStationName && lc(p.completedStationName) === lc(stationName))));
  if (!rec || docks === 0) add('history.first', 'history', 'The commander has never docked here before', { value: true, salience: 40 });
  else if ([100, 250, 500, 1000].includes(docks + 1)) add('history.milestone', 'history', `This will be the commander's ${docks + 1}th docking here`, { numbers: [docks + 1], value: docks + 1, salience: 70 });
  else if (docks >= 20) add('history.regular', 'history', 'A regular stop — the commander comes here a lot (never quote a count)', { pull: T.HISTORY_PULL.regular, value: 'regular', salience: 18 });
  if (built) add('history.built', 'history', isConstruction ? "The commander's own construction site — one of their builds, still going up" : 'The commander built this station', { pull: T.HISTORY_PULL.builtByYou, value: true, salience: 60 });
  else if (ownSystem) add('colony.own', 'history', `${systemName} is one of the commander's own colony systems`, { pull: T.HISTORY_PULL.ownColony, value: true, salience: 35 });
  const grudge = memory && memory.grudges && memory.grudges[marketId];
  if (grudge) add('history.grudge', 'history', `This place clipped the ship on the way in before${grudge.at ? ` (${String(new Date(grudge.at).toISOString()).slice(0, 10)})` : ''}`, { pull: T.HISTORY_PULL.grudge, value: true, salience: 50 });
  const denied = memory && memory.dockDenials && memory.dockDenials[String(marketId)];
  if (denied && denied.count > 0) {
    const top = Object.entries(denied.reasons || {}).sort((a, b) => b[1] - a[1])[0];
    const why = top ? ({ NoSpace: 'no free pad', TooLarge: 'ship too large', Hostile: 'hostile', Offences: 'offences', Distance: 'too far out' }[top[0]] || top[0]) : null;
    add('history.denied', 'history', `Has turned the commander away ${denied.count} times${why ? ` (mostly ${why})` : ''}`, { pull: T.HISTORY_PULL.turnedAway, numbers: [denied.count], value: denied.count, salience: Math.min(60, 30 + denied.count * 3) });
  }

  // ── Right now (EDDN: other pilots at this station in the last 30 minutes) ──
  if (nearby) {
    const cleared = (nearby.granted || 0) + (nearby.docked || 0);
    if (cleared > 0) add('traffic', 'traffic', `In the last ${nearby.windowMin} minutes, ${cleared} other pilot${cleared === 1 ? ' was' : 's were'} cleared to dock here`, { numbers: [cleared, nearby.windowMin], value: cleared >= 5 ? 'busy' : 'some', salience: Math.min(50, 18 + cleared * 5) });
    if (nearby.denied > 0) add('traffic.denied', 'traffic', `In the last ${nearby.windowMin} minutes, ${nearby.denied} other pilot${nearby.denied === 1 ? ' was' : 's were'} turned away here`, { numbers: [nearby.denied, nearby.windowMin], value: nearby.denied, salience: 40 });
  }

  // ── The market (last stored snapshot) ──
  const snap = marketId != null ? ((s.marketSnapshots || {})[String(marketId)] || null) : null;
  if (snap && Array.isArray(snap.commodities) && snap.commodities.length) {
    const seen = snap.updatedAt && (now - Date.parse(snap.updatedAt)) / 86400e3 > 7 ? ` (market seen ${String(snap.updatedAt).slice(0, 10)})` : '';
    const rows = snap.commodities.filter((c) => c && c.name);
    const cheap = rows.filter((c) => c.meanPrice > 0 && c.stock > 0 && c.buyPrice > 0 && c.buyPrice <= 0.7 * c.meanPrice)
      .sort((a, b) => a.buyPrice / a.meanPrice - b.buyPrice / b.meanPrice).slice(0, 2);
    for (const c of cheap) {
      const under = 100 - pct(c.buyPrice / c.meanPrice);
      add(`market.cheap.${c.name}`, 'market', `Sells ${c.name} ${under}% under the galactic mean (${fmt(c.buyPrice)} cr vs ${fmt(c.meanPrice)})${seen}`, { numbers: [under, c.buyPrice, c.meanPrice], value: under, salience: 30 });
    }
    const pays = rows.filter((c) => c.meanPrice > 0 && c.demand > 0 && c.sellPrice >= 1.3 * c.meanPrice)
      .sort((a, b) => b.sellPrice / b.meanPrice - a.sellPrice / a.meanPrice).slice(0, 2);
    for (const c of pays) {
      const over = pct(c.sellPrice / c.meanPrice) - 100;
      add(`market.pays.${c.name}`, 'market', `Pays ${over}% over the galactic mean for ${c.name} (${fmt(c.sellPrice)} cr)${seen}`, { numbers: [over, c.sellPrice, c.meanPrice], value: over, salience: 30 });
    }
    const gar = rows.find((c) => c.stock > 0 && T.GARNISH[persona] && T.GARNISH[persona].test(String(c.category || '')));
    if (gar) add('market.garnish', 'market', `Stocks ${gar.name}${seen}`, { pull: { wash: 0, tars: 0, k2: 0, [persona]: 1 }, value: gar.name, salience: 22 });
    if (rows.some((c) => /slav/i.test(`${c.name} ${c.category || ''} ${c.commodityId || ''}`))) add('market.slaves', 'market', 'Its market trades in slaves', { pull: T.SLAVES_PULL, value: true, salience: 60 });
    const needs = new Set();
    for (const p of projects) {
      if (!p || p.status === 'completed' || !Array.isArray(p.commodities)) continue;
      for (const c of p.commodities) if (c && (c.requiredQuantity || 0) > (c.providedQuantity || 0)) needs.add(lc(c.name || c.commodityId));
    }
    const need = rows.find((c) => c.stock > 0 && (needs.has(lc(c.name)) || needs.has(lc(c.commodityId))));
    if (need) add('market.need', 'market', `Stocks ${need.name}, which one of the commander's builds still needs${seen}`, { value: need.name, salience: 35 });
  }

  return {
    identity: {
      marketId, stationName, systemName, typeLabel, archKey: archKey || null, isConstruction,
      builtByYou: built, firstVisit: !rec || docks === 0, docks,
    },
    facts,
  };
}
