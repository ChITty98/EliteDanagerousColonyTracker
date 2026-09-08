// server/journal/commanderLog.js
//
// The Commander's Log — a log of EVENTS, not a narrative. Every line is built from journal
// fields and the app's own records, so a line is either right or a bug; nothing is generated.
// Settled 2026-09-04: weights carry meaning, resolution decays with age (a view concern, not a
// data one), touchdowns matter, photos are linked never copied, and the journey map reads the
// same weighted list. This module is the extractor; the page and the map come after the dry run
// (tools/commander-log-dry-run.mjs) has been tuned against the commander's real history.
//
// Weights (the commander's ranking):
//   huge     colony claimed · fleet carrier bought
//   major    death and rebuy · new ship · rank promotion · high-value first discovery
//            (terraformable / water / ammonia / Earth-like) · a run of first discoveries in one
//            system · a scouted system scoring high on the app's own scale · first landing on a
//            body that is "cool" (oxygen/ammonia atmosphere, rings, gravity at the extremes,
//            first discovered by the commander, brain trees, a recorded sighting)
//   notable  a long-haul day (80+ jumps) · a wing sitting · a bounty night · a Codex first ·
//            an engineer unlocked · a big carrier move · first landing on an ordinary body
//   routine  everything else, folded into the sitting's summary line
// Deliberately absent: Community Goal rewards, exploration sales (the find is the event, the
// sale is the receipt), construction timing, damage, mission receipts, first footfall (no flag
// exists in the journals).
import fs from 'node:fs';
import path from 'node:path';
import { friendlyShip } from './extractor.js';
import { canonicalCommodityName } from './commodityPricesMirror.js';

export const WEIGHTS = ['routine', 'notable', 'major', 'huge'];
export const weightRank = (w) => Math.max(0, WEIGHTS.indexOf(w));

export const DEFAULTS = {
  longHaulJumps: 20,        // this many jumps in one run is a haul — a long evening of jump screens
  haulGapMs: 30 * 60e3,     // a run survives a relog (the game hangs on jumps) but not a real break
  bountyCount: 10,          // bounties in a sitting → a bounty night
  bountyTotal: 1_000_000,   // or this much in one sitting
  missionBig: 25_000_000,   // a single payout this size is the headline of its night (111 of 999)
  missionMajorCr: 100_000_000, // a night worth this much is major, not notable (19 of 61 nights)
  scoutedScore: 120,        // the app's own scouting scale — a find worth logging
  carrierMoveLy: 400,       // one carrier jump that actually went somewhere
  sittingGapMs: 6 * 3600e3, // no Shutdown and this much silence → the sitting ended
  hiGravity: 2.0, loGravity: 0.05,
};

// The game's rank ladders — Promotion carries the type as the field name and the tier as its value.
export const RANKS = {
  Combat: ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Trade: ['Penniless', 'Mostly Penniless', 'Peddler', 'Dealer', 'Merchant', 'Broker', 'Entrepreneur', 'Tycoon', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Explore: ['Aimless', 'Mostly Aimless', 'Scout', 'Surveyor', 'Trailblazer', 'Pathfinder', 'Ranger', 'Pioneer', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Exobiologist: ['Directionless', 'Mostly Directionless', 'Compiler', 'Collector', 'Cataloguer', 'Taxonomist', 'Ecologist', 'Geneticist', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Soldier: ['Defenceless', 'Mostly Defenceless', 'Rookie', 'Soldier', 'Gunslinger', 'Warrior', 'Gladiator', 'Deadeye', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  CQC: ['Helpless', 'Mostly Helpless', 'Amateur', 'Semi Professional', 'Professional', 'Champion', 'Hero', 'Legend', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Federation: ['None', 'Recruit', 'Cadet', 'Midshipman', 'Petty Officer', 'Chief Petty Officer', 'Warrant Officer', 'Ensign', 'Lieutenant', 'Lieutenant Commander', 'Post Commander', 'Post Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral'],
  Empire: ['None', 'Outsider', 'Serf', 'Master', 'Squire', 'Knight', 'Lord', 'Baron', 'Viscount', 'Count', 'Earl', 'Marquis', 'Duke', 'Prince', 'King'],
};

const HIGH_VALUE_CLASSES = new Set(['Earthlike body', 'Water world', 'Ammonia world']);
// The builds that change a system's character — the same list the commander flagged as Domain
// highlights. Everything else you finish is major; these are huge.
/** How the commander says a kind out loud — searching any of these words returns all of them. */
const KIND_WORDS = {
  built: ['build', 'builds', 'built', 'construction', 'colony', 'station'],
  claim: ['claim', 'claims', 'claimed'],
  carrier_bought: ['carrier'], carrier_move: ['carrier', 'carrier move', 'carrier jump'],
  death: ['death', 'deaths', 'died', 'destroyed'],
  ship_new: ['ship', 'ships', 'bought', 'new ship'],
  promotion: ['rank', 'ranks', 'promotion', 'promoted'],
  discovery: ['discovery', 'discoveries', 'first discovery'],
  touchdown: ['landing', 'landings', 'landed', 'touchdown', 'touchdowns'],
  codex_first: ['codex'], engineer: ['engineer', 'engineers'],
  long_haul: ['haul', 'hauls', 'jumps', 'trip'],
  bounty_night: ['bounty', 'bounties', 'combat'],
  missions: ['mission', 'missions', 'job', 'jobs', 'courier', 'massacre', 'donation', 'donations'],
  scouted: ['scouted', 'scouting'],
  vehicle_first: ['srv', 'srvs', 'buggy', 'vehicle', 'vehicles', 'scarab', 'scorpion', 'nomad', 'rhino', 'fighter'],
  exobiology: ['bio', 'biology', 'exobiology', 'organic', 'species', 'sampled', 'genus'],
  bio_sale: ['bio', 'biology', 'exobiology', 'organic', 'sale', 'sold'],
  community_goal: ['cg', 'community goal', 'community goals', 'goal', 'goals'],
  surface_mining: ['surface mining', 'mining', 'deposit', 'deposits'],
  ring_mining: ['ring mining', 'mining', 'asteroid', 'asteroids'],
};
/** "mining_industrial_installation" → "Mining Industrial Installation"; CamelCase left alone. */
const prettyType = (t) => (!t ? null : /_/.test(t) ? t.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : t.replace(/([a-z])([A-Z])/g, '$1 $2'));
const CLASS_SHORT = {
  'Earthlike body': 'Earth-like', 'Water world': 'water world', 'Ammonia world': 'ammonia world',
  'High metal content body': 'HMC', 'Rocky body': 'rocky', 'Metal rich body': 'metal-rich', 'Rocky ice body': 'rocky ice', 'Icy body': 'icy',
  'Sudarsky class I gas giant': 'class I gas giant', 'Sudarsky class II gas giant': 'class II gas giant', 'Sudarsky class III gas giant': 'class III gas giant',
  'Sudarsky class IV gas giant': 'class IV gas giant', 'Sudarsky class V gas giant': 'class V gas giant',
  'Gas giant with water based life': 'gas giant, water-based life', 'Gas giant with ammonia based life': 'gas giant, ammonia-based life',
  'Helium rich gas giant': 'helium-rich gas giant', 'Water giant': 'water giant',
};
const classShort = (c) => CLASS_SHORT[c] || c;
const atmoShort = (a) => (a ? String(a).replace(/\s*atmosphere\s*$/i, '') : null);
/** "Mission_Massacre_Wing_name" → "Massacre Wing" — the fallback when the game sent no localised name. */
const prettyMission = (n) => (!n ? null : String(n).replace(/^Mission_/, '').replace(/_name;?$/i, '').replace(/_\d+$/, '').replace(/_/g, ' ').trim() || null);
/** "Eol Prou UN-T d3-843 A 3 e" → "A 3 e" when the system name leads. */
const shortBody = (body, system) => (system && body && body.toLowerCase().startsWith(system.toLowerCase()) ? body.slice(system.length).trim() || body : body);
const KEEP = new Set([
  'LoadGame', 'Shutdown', 'FSDJump', 'Location', 'CarrierJump', 'Docked', 'Undocked', 'Touchdown', 'Liftoff', 'SupercruiseEntry', 'Died', 'Resurrect',
  'ShipyardNew', 'ShipyardSwap', 'Loadout', 'Promotion', 'ColonisationSystemClaim', 'CarrierBuy', 'Scan',
  'ColonisationConstructionDepot',
  'CodexEntry', 'EngineerProgress', 'WingAdd', 'WingJoin', 'Bounty', 'MiningRefined',
  'StoredShips', 'Rank', 'Progress', 'MissionCompleted', 'MissionFailed',
  'LaunchSRV', 'DockSRV', 'LaunchFighter', 'ScanOrganic', 'SellOrganicData',
  'CommunityGoal', 'CommunityGoalJoin', 'CommunityGoalReward',
]);
const DEATH_FOLD_MS = 24 * 3600e3; // a second death the same day is noise, not a second event

const lower = (s) => String(s || '').toLowerCase();
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null);
const fmtCr = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const CARRIER_FIX_FRESH_MS = 24 * 3600e3; // a carrier position older than this is not "where it jumped from"

/** "explorer_nx" → "Caspian Explorer"; a suit id → "on foot"; blank names dropped. */
function shipLabel(id, localised, name) {
  if (!id && !localised) return null;
  if (/suit/i.test(String(id || ''))) return 'on foot';
  const base = (localised && !/^\$/.test(localised)) ? localised : friendlyShip(lower(id)) || id;
  const nm = name && String(name).trim();
  return nm ? `${base} "${nm}"` : base;
}

/** Read every kept event from the journal folder, in time order. */
export function readJournalEvents(journalDir, { sinceMs = 0 } = {}) {
  let files;
  try { files = fs.readdirSync(journalDir).filter((f) => /^Journal.*\.log$/i.test(f)).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const p = path.join(journalDir, f);
    let text;
    try { if (sinceMs && fs.statSync(p).mtimeMs < sinceMs) continue; text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const l of text.split('\n')) {
      if (!l || !l.includes('"event":"')) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (!e || !KEEP.has(e.event) || typeof e.timestamp !== 'string') continue;
      out.push(e);
    }
  }
  out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return out;
}

/**
 * Body facts from the journal's own Scan events (first sighting of each body wins), so a
 * touchdown can say what it landed on without any external service.
 */
function bodyFactsFrom(scan) {
  const rings = Array.isArray(scan.Rings) ? scan.Rings.filter((r) => /Ring$/i.test(r.Name || '') || true).length : 0;
  return {
    body: scan.BodyName, system: scan.StarSystem || null,
    planetClass: scan.PlanetClass || null,
    atmosphere: scan.Atmosphere && !/^none$/i.test(scan.Atmosphere) ? scan.Atmosphere : null,
    terraformable: /terraformable/i.test(scan.TerraformState || ''),
    gravityG: typeof scan.SurfaceGravity === 'number' ? scan.SurfaceGravity / 9.80665 : null,
    rings, landable: !!scan.Landable,
    firstDiscovered: scan.WasDiscovered === false,
  };
}

/**
 * Why a body is worth landing on. `strong` reasons make a first landing MAJOR; a first discovery
 * alone is named but does not — the commander first-discovered 1,841 bodies this year, and a
 * rocky CO2 world is not cool for being one of them.
 */
function coolReasons(facts, extras, o) {
  const strong = []; const weak = [];
  if (!facts && !extras) return { strong, weak };
  const atmo = lower(facts && facts.atmosphere);
  if (/oxygen/.test(atmo)) strong.push('oxygen atmosphere');
  else if (/ammonia/.test(atmo)) strong.push('ammonia atmosphere');
  if (facts && facts.rings > 0) strong.push('rings');
  if (facts && facts.gravityG != null && facts.gravityG >= o.hiGravity) strong.push(`${facts.gravityG.toFixed(1)} g`);
  if (facts && facts.gravityG != null && facts.gravityG > 0 && facts.gravityG <= o.loGravity) strong.push(`${facts.gravityG.toFixed(2)} g`);
  if (extras && extras.brainTrees) strong.push('brain trees');
  if (extras && extras.sighting) strong.push(`a sighting${extras.sighting.tags && extras.sighting.tags.length ? ` (${extras.sighting.tags.join(', ')})` : ''}`);
  if (facts && facts.firstDiscovered) weak.push('first discovered by you');
  return { strong, weak };
}

function scoutedTotal(s) {
  const sc = s && s.score;
  if (typeof sc === 'number') return sc;
  if (!sc || typeof sc !== 'object') return null;
  if (typeof sc.total === 'number') return sc.total;
  if (typeof sc.totalPoints === 'number') return sc.totalPoints;
  let sum = 0; let n = 0;
  for (const [k, v] of Object.entries(sc)) if (/Points$/.test(k) && typeof v === 'number') { sum += v; n += 1; }
  return n ? sum : null;
}

/**
 * Build the log.
 * @param {object} o
 * @param {object[]} o.events            journal events in time order (readJournalEvents)
 * @param {object} [o.state]             colony-data.json (scoutedSystems, sightings, bodyFlags)
 * @param {object} [o.gallery]           colony-gallery.json (photos keyed system:<sys>:body:<body>)
 * @param {object[]} [o.surfaceVisits]   getSurfaceSummary().visits — what the Rhino actually did
 * @param {object[]} [o.rocks]           the asteroid rock log — what ring mining actually did
 * @param {Set<string>} [o.depotShots]   lowercased F10 filenames the mining log claims as deposit
 *                                       documentation — kept out of the log's photo strips
 * @param {object} [o.options]           thresholds (DEFAULTS)
 * @returns {{ sittings: object[], events: object[] }}  both newest first
 */
export function buildCommanderLog({ events, state = {}, gallery = {}, surfaceVisits = [], rocks = [], depotShots = null, options = {} } = {}) {
  const o = { ...DEFAULTS, ...options };
  const out = [];
  const sittings = [];
  const bodyFacts = new Map();  // lower body name -> facts
  const seenSystems = new Map();  // lower system -> { name, first, last, visits }
  // A build, by market id: when it completed, and what the station was called AFTER it did. A
  // station keeps its market id through a rename — Bawa Station became Atmo Sky Cairn Asc on the
  // same id — so the id is the only durable identity a build has.
  const builds = new Map();       // marketId -> { at, system, name, type }
  // Every name a market id has carried, in order. A PLANETARY site keeps its id through completion
  // and rename (Bawa Station → Atmo Sky Cairn Asc, id 4371599107); an ORBITAL one is issued a NEW
  // id when it finishes (depot 3955674882 → station 4319002883), and the only thing joining the
  // two is that the finished station's FIRST name is the site's name. Both cases resolve here.
  const names = new Map();        // marketId -> { system, seen: [{ name, type, at }] }
  // The fleet: StoredShips lists everything you are NOT flying, so the hull you are in has to be
  // added back from Loadout. ShipyardNew carries the new ship's id, which is what lets a hull be
  // matched to the day you bought it — ships older than the journals simply have no date.
  let stored = null;              // the newest StoredShips event
  let flying = null;              // { id, type, name } from the latest Loadout
  const boughtShip = new Map();   // shipId -> timestamp
  let rank = null; let progress = null;
  const landedBodies = new Map(); // lower body -> { name, system, first, last, landings }
  // Where you have docked, by MARKET ID — a rename is the same station. First/last dock and count,
  // so "when did I first dock at Cavallo Nero" is answerable the way "first landed on 2 a" is.
  const stations = new Map();     // marketId -> { marketId, name, system, first, last, docks }
  const noteDock = (e, at) => {
    if (e.MarketID == null || !e.StationName) return;
    const placeholder = /\$EXT_PANEL_ColonisationShip|Construction Site/i.test(e.StationName);
    const st = stations.get(e.MarketID);
    if (!st) stations.set(e.MarketID, { marketId: e.MarketID, name: e.StationName, system: e.StarSystem || cur.system || null, first: at, last: at, docks: 1 });
    else { st.last = at; st.docks += 1; if (!placeholder) st.name = e.StationName; if (e.StarSystem) st.system = e.StarSystem; }
  };
  const landedBefore = new Set();
  const discovered = new Set();  // bodies already logged as a first discovery (the game scans twice)
  const unlockedEngineers = new Set(); let engineerBaseline = false;
  const drivenVehicles = new Set(); // surface vehicle types already logged as a first drive
  // Community goals, by the game's own id. CommunityGoal fires constantly with a running total, so
  // the snapshots are folded to ONE entry per goal rather than thousands of progress lines.
  const goals = new Map();  // CGID -> { title, system, market, at, contrib, tier }
  let cur = { system: null, body: null, station: null, ship: null, shipName: null };
  let lastDeathAt = null;
  let carrierFix = null;         // { pos, at, system } — the carrier's last known position
  let sitting = null;
  let lastAt = null;
  // A haul is a RUN of jumps, not a sitting: the game hangs on jumps and the commander relogs, so
  // the run carries across sittings as long as the next jump comes within haulGapMs.
  let run = null;                // { at, from, count, ly, lastAt, to, pos0, far }
  const posOf = new Map();       // lower system -> StarPos, so a loop can say how far out it went
  const late = [];               // events decided after their sitting closed — attached by time at the end

  const sightings = new Map(); // lower body -> sighting
  for (const s of Object.values((state && state.sightings) || {})) if (s && s.bodyName) sightings.set(lower(s.bodyName), s);
  const flags = (state && state.bodyFlags) || {};
  // A picture of a deposit's HUD panel is documentation, not a picture of the place: it belongs on
  // the mining page and nowhere else. Two ways one is known — the utility flag set when a marker is
  // attached, and the mining log's own filenames, which catch shots the flag never reached.
  const isDocumentation = (p) => !!(p && (p.utility || (depotShots && depotShots.has(lower(p.caption)))));
  const galleryAt = (key) => {
    const list = gallery[key];
    return Array.isArray(list) ? list.filter((p) => !isDocumentation(p)) : [];
  };
  const photosFor = (system, body) => galleryAt(`system:${lower(system)}:body:${lower(body)}`).length;
  // Linked, never copied: the gallery entries for that place, newest first, for the page to show.
  const photoItemsAt = (key) => galleryAt(key)
    .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
    .slice(0, 8)
    .map((p) => ({ id: p.id, url: p.url, caption: p.caption || null, addedAt: p.addedAt || null }));
  const photoItemsFor = (system, body) => photoItemsAt(`system:${lower(system)}:body:${lower(body)}`);
  const push = (ev) => { out.push(ev); if (sitting) sitting.events.push(ev); else late.push(ev); };
  /** Touchdown, or a Location that puts you on a surface (on foot / in the SRV after a relog). */
  const onSurface = (e) => !!e.Body && (
    (e.event === 'Touchdown' && e.PlayerControlled !== false && !e.OnStation)
    || (e.event === 'Location' && e.Latitude != null && !e.Docked && !e.OnStation));
  const noteOnSurface = (e, at, via) => {
        cur = { ...cur, body: e.Body, system: e.StarSystem || cur.system };
        if (sitting && via === 'Touchdown') sitting.landings += 1;
        const key = lower(e.Body);
        // Setting down on the same body again minutes later is repositioning, not an event: the
        // commander saw one rock reported five times in six minutes. One entry per body per sitting.
        if (sitting && sitting.landedHere.has(key)) return;
        if (sitting) sitting.landedHere.add(key);
        const first = !landedBefore.has(key);
        landedBefore.add(key);
        const facts = bodyFacts.get(key) || null;
        const extras = { sighting: sightings.get(key) || null, brainTrees: !!(flags[`${cur.system}|${e.Body}`] && flags[`${cur.system}|${e.Body}`].brainTrees) };
        const { strong, weak } = coolReasons(facts, extras, o);
        const reasons = [...strong, ...weak];
        const photos = photosFor(cur.system, e.Body);
        const desc = [facts && facts.planetClass, facts && facts.atmosphere, facts && facts.gravityG != null ? `${facts.gravityG.toFixed(2)} g` : null].filter(Boolean).join(', ');
        const weight = first && strong.length ? 'major' : first ? 'notable' : 'routine';
        push({ at, weight, kind: 'touchdown', system: cur.system, body: e.Body, lat: e.Latitude, lon: e.Longitude, photos, photoItems: photos ? photoItemsFor(cur.system, e.Body) : [], first,
          line: `${via === 'Location' ? (first ? 'On' : 'Back on') : (first ? 'Landed on' : 'Landed again on')} ${e.Body}${desc ? ` · ${desc}` : ''}${reasons.length ? ` · ${reasons.join(', ')}` : ''}${photos ? ` · ${photos} photo${photos === 1 ? '' : 's'}` : ''}${via === 'Location' ? ' · resumed on the surface' : ''}`,
          refs: [{ event: via, at }] });
        return;
  };

  const closeRun = () => {
    if (run && run.count >= o.longHaulJumps) {
      const ly = Math.round(run.ly).toLocaleString();
      // A run that ends where it started is a loop, not a crossing: "X → X" is literally true and
      // tells you nothing. Say what it was — jumping around home — and name how far out it got.
      const loop = run.from && lower(run.from) === lower(run.to);
      const far = loop && run.far && run.far.ly >= 20 ? `, out to ${run.far.sys} (${Math.round(run.far.ly)} ly)` : '';
      const line = loop
        ? `${run.count} jumps, ${ly} ly around ${run.to}${far}`
        : `${run.count} jumps, ${ly} ly: ${run.from || '?'} → ${run.to}`;
      const ev = { at: run.at, weight: 'notable', kind: 'long_haul', system: run.to, line,
        refs: [{ event: 'FSDJump', count: run.count, from: run.at, to: run.lastAt }] };
      out.push(ev); late.push(ev);
    }
    run = null;
  };

  const endSitting = (at, reason) => {
    if (!sitting) return;
    sitting.endedAt = at; sitting.endReason = reason;
    sitting.hours = Math.max(0, (Date.parse(at) - Date.parse(sitting.startedAt)) / 3600e3);
    // Sitting-level events — decided once the sitting is complete.
    // Who you flew with is on the sitting's own line — it does not need an entry of its own.
    if (sitting.bounties >= o.bountyCount || sitting.bountyTotal >= o.bountyTotal) {
      const where = [...sitting.bountySystems].slice(0, 2).join(', ');
      push({ at: sitting.bountyAt || sitting.startedAt, weight: 'notable', kind: 'bounty_night', system: where,
        line: `Bounty night at ${where || 'unknown'}: ${sitting.bounties} bounties, ${fmtCr(sitting.bountyTotal)} cr, largest ${fmtCr(sitting.bountyMax)}`, refs: [{ event: 'Bounty', count: sitting.bounties }] });
    }
    // Missions: 1,310 completions is not 1,310 entries. One line per sitting — what you ran and
    // what it paid — with the biggest single payout named, because that is the one you remember.
    // Donations pay nothing and cost credits: they bought rank, and the line says that instead.
    if (sitting.missions.length) {
      const paid = sitting.missions.filter((m) => m.reward > 0);
      const cr = paid.reduce((a, m) => a + m.reward, 0);
      const top = paid.reduce((a, m) => (!a || m.reward > a.reward ? m : a), null);
      const n = sitting.missions.length;
      const where = [...sitting.systems].slice(0, 1)[0] || sitting.lastSystem || null;
      const bits = [`${n} mission${n === 1 ? '' : 's'}`];
      if (cr) bits.push(`${fmtCr(cr)} cr`);
      if (sitting.donated) bits.push(`${fmtCr(sitting.donated)} cr donated`);
      if (top && paid.length > 1 && top.reward >= o.missionBig) bits.push(`biggest ${fmtCr(top.reward)}: ${top.name}`);
      else if (top && paid.length === 1) bits.push(top.name);
      if (sitting.missionsFailed) bits.push(`${sitting.missionsFailed} failed`);
      const weight = cr >= o.missionMajorCr || (top && top.reward >= o.missionBig) ? 'major' : cr >= 1e6 || sitting.donated >= 1e6 ? 'notable' : 'routine';
      push({ at: sitting.missions[0].at, weight, kind: 'missions', system: where,
        line: `Missions${where ? ` at ${where}` : ''}: ${bits.join(', ')}`, cr, count: n,
        refs: [{ event: 'MissionCompleted', count: n, from: sitting.missions[0].at, to: sitting.missions[n - 1].at }] });
    }
    // Exobiology. Most landings are not sightseeing — they are a sampling run, and the promotions
    // come out of these. One line per sitting naming the genera, because a hundred separate
    // "sampled a Bacterium" entries would bury everything else in the log.
    if (sitting.organic.length) {
      const n = sitting.organic.length;
      const genera = [...new Set(sitting.organic.map((o) => o.genus).filter(Boolean))];
      const bodies = [...new Set(sitting.organic.map((o) => o.body).filter(Boolean))];
      const where = bodies.length === 1 ? bodies[0] : `${bodies.length} bodies`;
      push({
        at: sitting.organic[0].at,
        weight: n >= 10 ? 'major' : 'notable',
        kind: 'exobiology',
        system: sitting.organic[0].system || null,
        body: bodies.length === 1 ? bodies[0] : null,
        line: `Sampled ${n} species${bodies.length ? ` on ${where}` : ''}${genera.length ? ` — ${genera.slice(0, 6).join(', ')}${genera.length > 6 ? `, +${genera.length - 6} more` : ''}` : ''}`,
        refs: [{ event: 'ScanOrganic', count: n, from: sitting.organic[0].at, to: sitting.organic[n - 1].at }],
      });
    }
    // First discoveries: every one named, one entry per system per sitting, ice balls folded to a
    // count (the commander's standing rule), MAJOR when a high-value body is among them.
    for (const [sys, list] of sitting.disc) {
      const named = list.filter((d) => d.planetClass !== 'Icy body');
      const icy = list.length - named.length;
      const hv = list.some((d) => d.hv);
      const parts = named.map((d) => `${shortBody(d.body, sys)} ${classShort(d.planetClass)}${d.tf ? ', terraformable' : ''}${d.atmo ? `, ${atmoShort(d.atmo)}` : ''}`);
      const line = parts.length
        ? `First discoveries in ${sys}: ${parts.join('; ')}${icy ? ` · +${icy} icy` : ''}`
        : `First discoveries in ${sys}: ${icy} icy ${icy === 1 ? 'body' : 'bodies'}`;
      push({ at: list[0].at, weight: hv ? 'major' : 'notable', kind: 'discovery', system: sys, bodies: list.map((d) => d.body), line, refs: list.map((d) => ({ event: 'Scan', at: d.at })) });
    }
    // Codex firsts: one line each up to two, folded into one line beyond that.
    if (sitting.codex.length >= 3) {
      const systems = [...new Set(sitting.codex.map((c) => c.system).filter(Boolean))];
      push({ at: sitting.codex[0].at, weight: 'notable', kind: 'codex_first', system: systems[0] || null,
        line: `Codex firsts: ${sitting.codex.map((c) => c.name).join(', ')}${systems.length ? ` (${systems.join(', ')})` : ''}`, refs: sitting.codex.map((c) => ({ event: 'CodexEntry', at: c.at })) });
    } else {
      for (const c of sitting.codex) push({ at: c.at, weight: 'notable', kind: 'codex_first', system: c.system, line: `Codex first: ${c.name}${c.system ? ` (${c.system})` : ''}`, refs: [{ event: 'CodexEntry', at: c.at }] });
    }
    // Carrier travel: a run of jumps in one sitting is one entry; a lone real jump stands alone.
    if (sitting.carrier.length) {
      const legs = sitting.carrier;
      const ly = legs.reduce((a, l) => a + (l.ly || 0), 0);
      const from = legs[0].from; const to = legs[legs.length - 1].to;
      if (legs.length >= 2) push({ at: legs[0].at, weight: 'notable', kind: 'carrier_move', system: to, line: `Carrier: ${legs.length} jumps${ly ? `, ${Math.round(ly).toLocaleString()} ly` : ''}${from ? `: ${from} → ${to}` : ` to ${to}`}`, refs: legs.map((l) => ({ event: 'CarrierJump', at: l.at })) });
      else if (legs[0].ly != null && legs[0].ly >= o.carrierMoveLy) push({ at: legs[0].at, weight: 'notable', kind: 'carrier_move', system: to, line: `Carrier jumped ${Math.round(legs[0].ly)} ly to ${to}`, refs: [{ event: 'CarrierJump', at: legs[0].at }] });
      else push({ at: legs[0].at, weight: 'routine', kind: 'carrier_move', system: to, line: `Carrier jumped to ${to}`, refs: [{ event: 'CarrierJump', at: legs[0].at }] });
    }
    sitting.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    sittings.push(sitting);
    sitting = null;
  };
  const startSitting = (e) => {
    endSitting(e.timestamp, 'relog');
    const label = shipLabel(e.Ship, e.Ship_Localised, e.ShipName) || cur.ship || null;
    sitting = {
      startedAt: e.timestamp, endedAt: null, endReason: null, hours: 0,
      ship: label,
      jumps: 0, ly: 0, firstSystem: cur.system, lastSystem: cur.system, systems: new Set(),
      landings: 0, tonnesMined: 0, scanned: new Set(), firstScanned: new Set(),
      disc: new Map(),          // system -> [{ body, planetClass, tf, atmo, hv, at }]
      landedHere: new Set(),   // one landing entry per body per sitting; the rest is manoeuvring
      wing: new Set(), wingAt: null, wingSystem: null,
      bounties: 0, bountyTotal: 0, bountyMax: 0, bountyAt: null, bountySystems: new Set(),
      missions: [], missionsFailed: 0, donated: 0,
      organic: [],   // completed specimens this sitting — the reason most landings happen
      codex: [], carrier: [],
      events: [],
    };
    if (label) cur.ship = label;
  };

  for (const e of events) {
    const at = e.timestamp;
    if (sitting && lastAt && Date.parse(at) - Date.parse(lastAt) > o.sittingGapMs && e.event !== 'LoadGame') endSitting(lastAt, 'silence');
    lastAt = at;
    // When you first laid eyes on a system, and first set down on a body — the two questions the
    // log gets asked most and cannot answer from entries alone, since arriving somewhere writes
    // nothing worth an entry until something happens there.
    if ((e.event === 'FSDJump' || e.event === 'Location' || e.event === 'CarrierJump') && e.StarSystem) {
      const k = lower(e.StarSystem);
      const s0 = seenSystems.get(k);
      if (!s0) seenSystems.set(k, { name: e.StarSystem, first: at, last: at, visits: 1 });
      else { s0.last = at; if (e.event === 'FSDJump') s0.visits += 1; }
    }
    // Being on a body counts whether the journal saw you land or you logged in already standing
    // there: a relog on the surface writes Location with a latitude, on foot or in the SRV, and no
    // Touchdown ever follows. Seventeen of those in two months were reading as nowhere at all.
    if (onSurface(e)) {
      const k = lower(e.Body);
      const b0 = landedBodies.get(k);
      if (!b0) landedBodies.set(k, { name: e.Body, system: e.StarSystem || cur.system || null, first: at, last: at, landings: 1 });
      else { b0.last = at; b0.landings += 1; }
    }
    switch (e.event) {
      case 'LoadGame': startSitting(e); break;
      case 'Shutdown': endSitting(at, 'shutdown'); break;
      case 'Loadout':
        cur.ship = shipLabel(e.Ship, e.Ship_Localised, e.ShipName) || cur.ship;
        if (sitting) sitting.ship = cur.ship;
        if (e.ShipID != null) flying = { id: e.ShipID, type: e.Ship_Localised || e.Ship, name: e.ShipName || null, at };
        break;
      case 'StoredShips': if (!stored || at > stored.timestamp) stored = e; break;
      case 'Rank': if (!rank || at > rank.at) rank = { at, ...e }; break;
      case 'Progress': if (!progress || at > progress.at) progress = { at, ...e }; break;
      case 'ShipyardSwap': cur.ship = shipLabel(e.ShipType, e.ShipType_Localised, null) || cur.ship; if (sitting) sitting.ship = cur.ship; break;
      case 'FSDJump': {
        if (run && Date.parse(at) - Date.parse(run.lastAt) > o.haulGapMs) closeRun();
        if (Array.isArray(e.StarPos) && e.StarPos.length === 3) posOf.set(lower(e.StarSystem), e.StarPos);
        if (!run) run = { at, from: cur.system, count: 0, ly: 0, lastAt: at, to: e.StarSystem, pos0: posOf.get(lower(cur.system)) || null, far: null };
        run.count += 1; run.ly += e.JumpDist || 0; run.lastAt = at; run.to = e.StarSystem;
        // How far the loop actually got from where it started — the one fact "X → X" throws away.
        const here = posOf.get(lower(e.StarSystem)) || null;
        if (!run.pos0) run.pos0 = here;
        if (run.pos0 && here) {
          const d = Math.hypot(here[0] - run.pos0[0], here[1] - run.pos0[1], here[2] - run.pos0[2]);
          if (!run.far || d > run.far.ly) run.far = { sys: e.StarSystem, ly: d };
        }
        cur = { ...cur, system: e.StarSystem, body: null, station: null };
        if (sitting) { sitting.jumps += 1; sitting.ly += e.JumpDist || 0; if (!sitting.firstSystem) sitting.firstSystem = e.StarSystem; sitting.lastSystem = e.StarSystem; sitting.systems.add(e.StarSystem); }
        break;
      }
      case 'Location': {
        cur = { ...cur, system: e.StarSystem || cur.system, body: e.Body && e.BodyType === 'Planet' ? e.Body : null, station: e.Docked ? e.StationName || null : null };
        if (sitting && !sitting.firstSystem) sitting.firstSystem = cur.system;
        if (sitting) sitting.lastSystem = cur.system;
        // Logging in docked is a dock; logging in on a surface is being there. Neither writes a
        // Docked or Touchdown of its own, so without this both read as nowhere.
        if (e.Docked) noteDock(e, at);
        else if (onSurface(e)) noteOnSurface(e, at, 'Location');
        break;
      }
      case 'CarrierJump': {
        // The journal only sees the carrier jump while you are aboard; a fix from days ago is
        // not where this jump started, so the distance is only stated when the last fix is fresh.
        const pos = Array.isArray(e.StarPos) ? e.StarPos : null;
        const fresh = carrierFix && Date.parse(at) - Date.parse(carrierFix.at) <= CARRIER_FIX_FRESH_MS;
        const ly = fresh ? dist(carrierFix.pos, pos) : null;
        if (e.Docked) { cur = { ...cur, system: e.StarSystem || cur.system, body: null, station: e.StationName || null }; if (sitting) sitting.lastSystem = cur.system; }
        if (sitting) sitting.carrier.push({ at, from: fresh ? carrierFix.system : null, to: e.StarSystem, ly });
        if (pos) carrierFix = { pos, at, system: e.StarSystem };
        break;
      }
      case 'ColonisationConstructionDepot':
        // The one clean, discrete completion signal the game gives. Checked against the app's own
        // project records on the commander's 15 home-system builds: 13 agree to the day.
        if (e.ConstructionComplete === true && e.MarketID) {
          const b = builds.get(e.MarketID);
          if (!b) builds.set(e.MarketID, { at, system: cur.system || null, name: null, type: null });
          else if (at < b.at) b.at = at;
        }
        break;
      case 'Docked': {
        cur = { ...cur, station: e.StationName || null, system: e.StarSystem || cur.system };
        noteDock(e, at);
        // The market id is the identity. Every name it has ever carried, in order, so a build
        // logged under a dead name can be shown under the one the station has now.
        if (e.MarketID != null && e.StationName) {
          let h = names.get(e.MarketID);
          if (!h) { h = { system: e.StarSystem || null, seen: [] }; names.set(e.MarketID, h); }
          const prev = h.seen[h.seen.length - 1];
          if (!prev || prev.name !== e.StationName || prev.type !== e.StationType) h.seen.push({ name: e.StationName, type: e.StationType || null, at });
        }
        // The name a finished build carries. Docking at it after completion is what tells us the
        // station's real name; the construction site's name is not it.
        const b = e.MarketID != null ? builds.get(e.MarketID) : null;
        if (b && at >= b.at && e.StationName && !/Construction Site|ColonisationShip/i.test(e.StationName)) {
          b.name = e.StationName; b.type = e.StationType || b.type; b.system = e.StarSystem || b.system;
        }
        break;
      }
      // Where you are stops being the station or the body the moment you leave it — otherwise a
      // death in open space reads as a death at the last place you docked.
      case 'Undocked': cur = { ...cur, station: null }; break;
      case 'Liftoff': if (e.PlayerControlled !== false) cur = { ...cur, body: null }; break;
      case 'SupercruiseEntry': cur = { ...cur, body: null, station: null }; break;
      case 'Scan': {
        if (!e.BodyName) break;
        const key = lower(e.BodyName);
        if (!bodyFacts.has(key)) bodyFacts.set(key, bodyFactsFrom(e));
        // Distinct bodies: the game scans a body twice (auto, then detailed).
        const seenThisSitting = sitting ? sitting.scanned.has(key) : true;
        if (sitting) sitting.scanned.add(key);
        // WasMapped means somebody already surveyed it, which they could only do after discovering
        // it — so WasDiscovered:false alongside it is contradictory, and the journal does emit that
        // pair (every body of Aleumoxii, Nov 2024). Believe the mapping and drop the claim.
        if (e.WasDiscovered === false && e.WasMapped !== true && e.PlanetClass && !discovered.has(key)) {
          discovered.add(key); // the game scans a body twice (auto, then detailed) — one record
          const tf = /terraformable/i.test(e.TerraformState || '');
          const rec = { body: e.BodyName, planetClass: e.PlanetClass, tf, atmo: e.Atmosphere && !/^none$/i.test(e.Atmosphere) ? e.Atmosphere : null, hv: HIGH_VALUE_CLASSES.has(e.PlanetClass) || tf, at };
          const sys = e.StarSystem || cur.system || '?';
          if (sitting) {
            if (!seenThisSitting) sitting.firstScanned.add(key);
            if (!sitting.disc.has(sys)) sitting.disc.set(sys, []);
            sitting.disc.get(sys).push(rec);
          } else {
            push({ at, weight: rec.hv ? 'major' : 'notable', kind: 'discovery', system: sys, bodies: [e.BodyName],
              line: `First discovery in ${sys}: ${shortBody(e.BodyName, sys)} ${classShort(e.PlanetClass)}${tf ? ', terraformable' : ''}`, refs: [{ event: 'Scan', at }] });
          }
        }
        break;
      }
      case 'Touchdown': noteOnSurface(e, at, 'Touchdown'); break;
      case 'Died': {
        // One death a day is the event; a second Died line the same day is noise. What it cost is
        // deliberately not listed — the commander does not want the manifest.
        if (lastDeathAt && Date.parse(at) - Date.parse(lastDeathAt) < DEATH_FOLD_MS) break;
        lastDeathAt = at;
        const where = [cur.system, cur.body || cur.station].filter(Boolean).join(' · ');
        push({ at, weight: 'major', kind: 'death', system: cur.system, body: cur.body, rebuy: null,
          line: `Died${where ? ` at ${where}` : ''}${cur.ship ? (cur.ship === 'on foot' ? ' on foot' : ` in the ${cur.ship}`) : ''}`, refs: [{ event: 'Died', at }] });
        break;
      }
      case 'Resurrect': {
        const last = [...out].reverse().find((x) => x.kind === 'death' && x.rebuy == null && Date.parse(at) - Date.parse(x.at) < 30 * 60e3);
        if (last) { last.rebuy = e.Cost || 0; last.line += e.Cost > 0 ? ` · rebuy ${fmtCr(e.Cost)} cr` : e.Option ? ` · ${e.Option}` : ''; last.refs.push({ event: 'Resurrect', at }); }
        break;
      }
      case 'ShipyardNew':
        if (e.NewShipID != null) boughtShip.set(e.NewShipID, at);
        push({ at, weight: 'major', kind: 'ship_new', system: cur.system, line: `New ship: ${shipLabel(e.ShipType, e.ShipType_Localised, null) || e.ShipType}${cur.station ? ` at ${cur.station}` : ''}`, refs: [{ event: 'ShipyardNew', at }] });
        break;
      case 'Promotion': {
        for (const [k, v] of Object.entries(e)) {
          if (k === 'timestamp' || k === 'event' || typeof v !== 'number') continue;
          const name = RANKS[k] ? RANKS[k][v] || `rank ${v}` : `rank ${v}`;
          push({ at, weight: 'major', kind: 'promotion', system: cur.system, line: `Promoted: ${k} ${name}`, refs: [{ event: 'Promotion', at }] });
        }
        break;
      }
      case 'ColonisationSystemClaim': push({ at, weight: 'huge', kind: 'claim', system: e.StarSystem, line: `Claimed ${e.StarSystem}`, refs: [{ event: 'ColonisationSystemClaim', at }] }); break;
      case 'CarrierBuy': push({ at, weight: 'huge', kind: 'carrier_bought', system: e.Location || cur.system, line: `Bought a fleet carrier${e.Location ? ` at ${e.Location}` : ''}${e.Price ? ` · ${fmtCr(e.Price)} cr` : ''}`, refs: [{ event: 'CarrierBuy', at }] }); break;
      case 'CodexEntry':
        if (e.IsNewEntry) {
          const c = { at, name: e.Name_Localised || e.Name, system: e.System || cur.system || null };
          if (sitting) sitting.codex.push(c);
          else push({ at, weight: 'notable', kind: 'codex_first', system: c.system, line: `Codex first: ${c.name}${c.system ? ` (${c.system})` : ''}`, refs: [{ event: 'CodexEntry', at }] });
        }
        break;
      case 'EngineerProgress': {
        const list = Array.isArray(e.Engineers) ? e.Engineers : (e.Engineer ? [e] : []);
        const isSnapshot = Array.isArray(e.Engineers);
        for (const g of list) {
          if (!g || g.Progress !== 'Unlocked' || !g.Engineer) continue;
          const had = unlockedEngineers.has(g.Engineer);
          unlockedEngineers.add(g.Engineer);
          // The login snapshot lists every engineer every time; only a change since the last
          // snapshot is an event, and the very first snapshot is the baseline, not news.
          if (had || (isSnapshot && !engineerBaseline)) continue;
          push({ at, weight: 'notable', kind: 'engineer', system: cur.system, line: `Unlocked ${g.Engineer}`, refs: [{ event: 'EngineerProgress', at }] });
        }
        if (isSnapshot) engineerBaseline = true;
        break;
      }
      case 'WingAdd': case 'WingJoin': {
        if (!sitting) break;
        const names = e.event === 'WingAdd' ? [e.Name] : (Array.isArray(e.Others) ? e.Others.map((x) => (typeof x === 'string' ? x : x && x.Name)) : []);
        for (const n of names) if (n) sitting.wing.add(n);
        if (!sitting.wingAt) { sitting.wingAt = at; sitting.wingSystem = cur.system; }
        break;
      }
      case 'Bounty': {
        if (!sitting) break;
        const total = typeof e.TotalReward === 'number' ? e.TotalReward : (Array.isArray(e.Rewards) ? e.Rewards.reduce((a, r) => a + (r.Reward || 0), 0) : (e.Reward || 0));
        sitting.bounties += 1; sitting.bountyTotal += total; sitting.bountyMax = Math.max(sitting.bountyMax, total);
        if (!sitting.bountyAt) sitting.bountyAt = at;
        if (cur.system) sitting.bountySystems.add(cur.system);
        break;
      }
      case 'MissionCompleted': {
        if (!sitting) break;
        // A donation mission pays nothing and COSTS the credits — it buys rank, and the log should
        // say so rather than record it as a job worth zero.
        sitting.missions.push({ at, name: e.LocalisedName || prettyMission(e.Name), reward: e.Reward || 0, system: cur.system || null });
        sitting.donated += e.Donated || e.Donation || 0;
        break;
      }
      case 'ScanOrganic': {
        // Three events make one specimen — Log, then two Samples, then Analyse. Only the Analyse
        // completes it, so counting that alone gives species scanned rather than keypresses.
        if (!sitting || e.ScanType !== 'Analyse') break;
        sitting.organic.push({
          at,
          genus: e.Genus_Localised || e.Genus || null,
          species: e.Species_Localised || e.Species || null,
          body: cur.body || null,
          system: cur.system || null,
        });
        break;
      }
      case 'SellOrganicData': {
        const rows = Array.isArray(e.BioData) ? e.BioData : [];
        const cr = rows.reduce((a, b) => a + (b.Value || 0) + (b.Bonus || 0), 0);
        if (!cr) break;
        const names = [...new Set(rows.map((b) => b.Species_Localised || b.Genus_Localised).filter(Boolean))];
        push({
          at, weight: cr >= 100e6 ? 'huge' : 'major', kind: 'bio_sale', system: cur.system || null, cr,
          line: `Sold bio data: ${fmtCr(cr)} cr — ${rows.length} sample${rows.length === 1 ? '' : 's'}${names.length ? ` (${names.slice(0, 4).join(', ')}${names.length > 4 ? `, +${names.length - 4} more` : ''})` : ''}${cur.station ? ` · ${cur.station}` : ''}`,
          refs: [{ event: 'SellOrganicData', at }],
        });
        break;
      }
      case 'CommunityGoalJoin': {
        if (e.CGID == null) break;
        const g = goals.get(e.CGID) || { contrib: 0, tier: null };
        goals.set(e.CGID, { ...g, title: e.Name || g.title, system: e.System || g.system, at: g.at || at, joined: true, joinedAt: at });
        push({
          at, weight: 'notable', kind: 'community_goal', system: e.System || null,
          line: `Signed on to community goal: ${e.Name || 'unnamed goal'}${e.System ? ` · ${e.System}` : ''}`,
          refs: [{ event: 'CommunityGoalJoin', at, cgid: e.CGID }],
        });
        break;
      }
      case 'CommunityGoal': {
        for (const c of e.CurrentGoals || []) {
          if (c.CGID == null) continue;
          const g = goals.get(c.CGID) || {};
          goals.set(c.CGID, {
            ...g,
            title: c.Title || g.title,
            system: c.SystemName || g.system,
            market: c.MarketName || g.market,
            at: g.at || at,
            contrib: Math.max(g.contrib || 0, c.PlayerContribution || 0),
            tier: c.TierReached || g.tier || null,
            contributors: Math.max(g.contributors || 0, c.NumContributors || 0),
          });
        }
        break;
      }
      case 'CommunityGoalReward': {
        if (!e.Reward) break;
        push({
          at, weight: e.Reward >= 100e6 ? 'huge' : 'major', kind: 'community_goal', system: e.System || null, cr: e.Reward,
          line: `Community goal paid: ${fmtCr(e.Reward)} cr — ${e.Name || 'unnamed goal'}${e.System ? ` · ${e.System}` : ''}`,
          refs: [{ event: 'CommunityGoalReward', at }],
        });
        break;
      }
      case 'LaunchFighter': {
        // A fighter is bought as a hangar MODULE, so there is no purchase event naming the hull and
        // no type on the launch either — the journal only ever says a fighter went out. First time
        // one did is still the milestone, so that is what gets logged.
        if (drivenVehicles.has('fighter')) break;
        drivenVehicles.add('fighter');
        const where = [cur.body, cur.system].filter(Boolean).join(' · ');
        push({
          at, weight: 'major', kind: 'vehicle_first', system: cur.system || null,
          line: `First ship-launched fighter deployed${where ? ` · ${where}` : ''}`,
          refs: [{ event: 'LaunchFighter', at }],
        });
        break;
      }
      case 'LaunchSRV':
      case 'DockSRV': {
        // The first time a surface vehicle is actually taken out. The Nomad never fires LaunchSRV
        // — it is deployed as a ship — so DockSRV is what catches it, and both events name the
        // type the same way. Old journals carry no type at all, and that is not ambiguity: the
        // Scarab was the only SRV in the game until there was a second one to tell it apart from,
        // which is exactly when the field appeared. A typeless launch is a Scarab.
        const kind = e.SRVType_Localised || e.SRVType || 'SRV Scarab';
        const key = lower(kind);
        if (drivenVehicles.has(key)) break;
        drivenVehicles.add(key);
        const where = [cur.body, cur.system].filter(Boolean).join(' · ');
        push({
          at, weight: 'major', kind: 'vehicle_first', system: cur.system || null, body: cur.body || null,
          line: `First drive: ${kind}${where ? ` · ${where}` : ''}`,
          refs: [{ event: e.event, at }],
        });
        break;
      }
      case 'MissionFailed': {
        if (sitting) sitting.missionsFailed += 1;
        break;
      }
      case 'MiningRefined': if (sitting) sitting.tonnesMined += 1; break;
      default: break;
    }
  }
  if (sitting) endSitting(lastAt || sitting.startedAt, 'open');
  closeRun();
  // Events decided after their sitting closed (a haul that outlived a relog) join the sitting they started in.
  for (const ev of late) {
    const s = sittings.find((x) => x.startedAt <= ev.at && (!x.endedAt || ev.at <= x.endedAt));
    if (s && !s.events.includes(ev)) { s.events.push(ev); s.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); }
  }

  // Surface mining — what the Rhino actually did. The journal alone cannot say it: MiningRefined
  // carries no position and no signal, so this comes from the app's own surface ledger, one entry
  // per visit that produced anything. Without it a night of mining reads as an empty sitting.
  const workedBodies = new Set();
  for (const v of [...surfaceVisits].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (!v || !(v.tonnes > 0) || !v.at) continue;
    const firstOnBody = !workedBodies.has(lower(v.body));
    workedBodies.add(lower(v.body));
    const what = Object.entries(v.commodities || {}).sort((a, b) => b[1] - a[1]).map(([c, t]) => `${c} ${t}`).join(', ');
    const where = v.siteIndex != null ? `Signal ${v.siteIndex} on ${shortBody(v.body, v.system)}` : shortBody(v.body, v.system);
    const rate = v.tph ? ` · ${v.tph} t/h` : '';
    out.push({
      at: v.at, weight: firstOnBody ? 'major' : 'notable', kind: 'surface_mining',
      system: v.system, body: v.body,
      line: `Mined ${where}: ${v.tonnes} t${what ? ` — ${what}` : ''}${rate}`,
      refs: [{ record: 'surface-mining-log', at: v.at }],
    });
  }

  // Ring mining — the same problem as the Rhino's: MiningRefined says what, never where. The rock
  // log knows the ring, so a night in the rings reads as a place and a haul instead of a tonnage.
  // Rocks in the same ring less than the gap apart are one session.
  const workedRings = new Set();
  const sorted = [...rocks].filter((r) => r && r.t && r.ring).sort((a, b) => (a.t < b.t ? -1 : 1));
  let ring = null;
  const closeRing = () => {
    if (!ring || !(ring.tonnes > 0)) { ring = null; return; }
    const firstHere = !workedRings.has(ring.name);
    workedRings.add(ring.name);
    const what = Object.entries(ring.got).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([m, v]) => `${canonicalCommodityName(m)} ${v}`).join(', ');
    out.push({
      at: ring.at, weight: firstHere ? 'major' : 'notable', kind: 'ring_mining', system: ring.sys || null, body: ring.name,
      line: `Mined ${ring.name}: ${ring.tonnes} t${what ? ` — ${what}` : ''} · ${ring.rocks} rocks`,
      refs: [{ record: 'mining-log', from: ring.at, to: ring.lastAt }],
    });
    ring = null;
  };
  for (const r of sorted) {
    if (ring && (ring.name !== r.ring || Date.parse(r.t) - Date.parse(ring.lastAt) > o.sittingGapMs)) closeRing();
    if (!ring) ring = { name: r.ring, sys: r.sys, at: r.t, lastAt: r.t, tonnes: 0, rocks: 0, got: {} };
    ring.lastAt = r.lastT || r.t; ring.rocks += 1; ring.tonnes += r.gotTotal || 0;
    for (const [m, v] of Object.entries(r.got || {})) ring.got[m] = (ring.got[m] || 0) + v;
  }
  closeRing();

  // Community goals: one line each, not one per status snapshot. A goal you merely saw advertised
  // is not an event — only one you actually put cargo into, which is what PlayerContribution counts.
  for (const [cgid, g] of goals) {
    if (!g || !(g.contrib > 0)) continue;
    const where = [g.market, g.system].filter(Boolean).join(', ');
    out.push({
      at: g.at, weight: g.contrib >= 100000 ? 'major' : 'notable', kind: 'community_goal',
      system: g.system || null, contribution: g.contrib,
      line: `${g.joined ? 'Community goal delivered' : 'Community goal'}: ${g.title || 'unnamed'}${where ? ` · ${where}` : ''} — contributed ${g.contrib.toLocaleString()}${g.tier ? `, reached ${g.tier}` : ''}`,
      refs: [{ event: 'CommunityGoal', cgid }],
    });
  }

  // Finished builds. The journal's own ConstructionComplete is the source — one line per market
  // id, dated when the game said it was done, named by what you docked at afterwards, so a rename
  // reads as the station's real name. The app's project record fills in any build the journal
  // never recorded a completion for, and is skipped when the journal already has that market id:
  // the same build must not appear twice under two names.
  const projects = ((state && state.projects) || []).filter((p) => p && p.status === 'completed' && p.completedAt);
  // What counts as a SHOWPIECE build is the commander's own call, made once in Settings → Domain
  // Highlights, and the table that turns a raw station type into a label lives in the client. So
  // the raw type rides along and the page decides: one classification, not a second one here.
  const emit = (at, system, name, type, refs, was) => {
    const label = prettyType(type);
    const photoItems = name ? photoItemsAt(`system:${lower(system)}:station:${lower(name)}`) : [];
    out.push({
      at, weight: 'major', kind: 'built', system: system || null, stationType: type || null,
      station: name || null, formerNames: was && was.length ? was : undefined, photos: photoItems.length, photoItems,
      line: `Built ${name || label}${name && label ? ` · ${label}` : ''}${system ? ` · ${system}` : ''}${was && was.length ? ` (was ${was.join(', ')})` : ''}`,
      refs,
    });
  };
  // The station dossier holds the CURRENT name and type for a market id, which is the truest
  // answer after a rename or a type change (Bawa Station → Atmo Sky Cairn Asc, depot → port).
  const dossier = new Map(Object.values((state && state.knownStations) || {}).filter((s) => s && s.marketId).map((s) => [s.marketId, s]));
  // ...but an ORBITAL site is issued a NEW market id when it finishes (depot 3961987842 became
  // station 4360475651), so the id alone loses the dodec. The finished name is the other key.
  const dossierByName = new Map(Object.values((state && state.knownStations) || {})
    .filter((s) => s && s.stationName).map((s) => [`${lower(s.systemName)}|${lower(s.stationName)}`, s]));
  const buildName = (p) => bare(p.completedStationName || p.stationName) || null;
  /** The app's own build-order type ("dodec_starport") beats Frontier's station type; a depot type
   *  is not an answer at all, and sends the lookup to the finished station's dossier entry. */
  const orderType = (t) => (t && /_/.test(t) && !/construction_?depot/i.test(t) ? t : null);
  const settleType = (system, name, ...candidates) => {
    for (const c of candidates) if (orderType(c)) return c;
    const d = name ? dossierByName.get(`${lower(system)}|${lower(name)}`) : null;
    if (d && orderType(d.stationType)) return d.stationType;
    return candidates.find((c) => c && !/ConstructionDepot/i.test(c)) || candidates.find(Boolean) || null;
  };
  /** Strip the game's prefixes — "Orbital Construction Site: X" and the untranslated
   *  "$EXT_PANEL_ColonisationShip; X" are both just X, which is what the station ends up called. */
  const bare = (n) => String(n || '').replace(/^.*Construction Site:\s*/i, '')
    .replace(/^\$EXT_PANEL_ColonisationShip;\s*/i, '').replace(/^Colonisation Ship\s+/i, '').trim();
  /**
   * What a build's market id is called NOW, and everything it used to be called. The id is the
   * identity and is tried first; only when the id itself was replaced at completion — the orbital
   * case — is the shared name used to find the id that took over.
   */
  const resolveStation = (mid, fallbackName, system) => {
    const h = names.get(mid);
    const chain = h ? h.seen.map((x) => x.name) : [];
    let seen = chain.length ? chain : (fallbackName ? [fallbackName] : []);
    let id = mid;
    const key = lower(bare(seen[seen.length - 1] || fallbackName));
    // The id never got a post-completion name of its own: the finished station is a different id
    // in the same system whose FIRST name is this one. Nothing else joins them.
    if (key && seen.every((n) => /Construction Site/i.test(n))) {
      for (const [m2, h2] of names) {
        if (m2 === mid || !h2.seen.length) continue;
        if (h && h2.system && h.system && lower(h2.system) !== lower(h.system)) continue;
        if (/Construction Site/i.test(h2.seen[0].name) || lower(bare(h2.seen[0].name)) !== key) continue;
        seen = [...seen, ...h2.seen.map((x) => x.name)]; id = m2; break;
      }
    }
    const uniq = [];
    for (const n of seen.map(bare)) if (n && !uniq.some((u) => lower(u) === lower(n))) uniq.push(n);
    const now = uniq[uniq.length - 1] || fallbackName || null;
    // The type the station actually reported on the last dock at whichever id ended up holding it.
    const held = names.get(id);
    const lastType = held && held.seen.length ? held.seen[held.seen.length - 1].type : null;
    return { id, now, was: uniq.slice(0, -1), system: (h && h.system) || system || null, type: lastType };
  };
  for (const [mid, b] of builds) {
    const p = projects.find((x) => x.marketId === mid);
    const r = resolveStation(mid, b.name || (p && buildName(p)), b.system || (p && p.systemName));
    // The dossier for the id that actually ended up carrying the station — the type and photos
    // belong to that one, not to the depot it grew out of.
    const d = dossier.get(r.id) || dossier.get(mid);
    const dName = d && !/Construction Site|ColonisationShip/i.test(d.stationName || '') ? d.stationName : null;
    const dType = d && !/ConstructionDepot/i.test(d.stationType || '') ? d.stationType : null;
    const name = r.now || dName || b.name || (p && buildName(p)) || null;
    const system = r.system || b.system || (p && p.systemName);
    const rType = r.type && !/ConstructionDepot/i.test(r.type) ? r.type : null;
    const type = settleType(system, name, dType, b.type, rType, p && (p.completedStationType || p.stationType));
    if (!name && !type) continue;
    emit(b.at, system, name, type, [{ event: 'ColonisationConstructionDepot', at: b.at, marketId: mid, stationMarketId: r.id }], r.was);
  }
  for (const p of projects) {
    if (p.marketId && builds.has(p.marketId)) continue; // the journal already dated this one
    const name = buildName(p);
    const type = settleType(p.systemName, name, p.completedStationType, p.stationType);
    if (!name && !type) continue;
    emit(p.completedAt, p.systemName, name, type, [{ record: 'projects', id: p.id }]);
  }

  // Scouted systems that scored high on the app's own scale — an app record, not a journal event.
  const scouted = state && state.scoutedSystems;
  for (const s of Array.isArray(scouted) ? scouted : Object.values(scouted || {})) {
    const total = scoutedTotal(s);
    if (!s || !s.name || total == null || total < o.scoutedScore || !s.scoutedAt) continue;
    out.push({ at: s.scoutedAt, weight: 'major', kind: 'scouted', system: s.name, line: `Scouted ${s.name}: ${Math.round(total)} on your scale${s.isColonised ? ' · now a colony' : ''}`, refs: [{ record: 'scoutedSystems', name: s.name }] });
  }

  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  sittings.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  // App records (surface visits, scouted systems) join the sitting they happened in.
  for (const ev of out) {
    if (!['surface_mining', 'ring_mining', 'scouted', 'built'].includes(ev.kind)) continue;
    const s = sittings.find((x) => x.startedAt <= ev.at && (!x.endedAt || ev.at <= x.endedAt));
    if (s && !s.events.includes(ev)) s.events.push(ev);
  }
  for (const s of sittings) s.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // How far from home the sitting was — the one number that turns a system name into a place you
  // can situate. Home is the commander's own setting; a system with no coordinates gets null,
  // never a guess.
  const known = (state && state.knownSystems) || {};
  const coordsOf = (name) => { const k = known[lower(name)]; return k && k.coordinates ? [k.coordinates.x, k.coordinates.y, k.coordinates.z] : null; };
  const setHome = (state && state.settings && state.settings.homeSystem) || null;
  const setHomeCoords = setHome ? coordsOf(setHome) : null;
  // Sol when no home is set: every commander shares that origin, and "1,022 ly from Sol" situates
  // a system where a bare name does not.
  const homeName = setHomeCoords ? setHome : 'Sol';
  const home = setHomeCoords || [0, 0, 0];
  for (const s of sittings) {
    const there = coordsOf(s.lastSystem);
    s.lyFromHome = there ? Math.round(dist(home, there)) : null;
    s.systems = s.systems.size; s.bodiesScanned = s.scanned.size; s.firstDiscoveries = s.firstScanned.size;
    s.wing = [...s.wing]; s.bountySystems = [...s.bountySystems];
    delete s.scanned; delete s.firstScanned; delete s.disc; delete s.codex; delete s.carrier; delete s.landedHere;
  }
  // The fleet as it stands: every stored hull plus the one you are flying, each with the day it
  // was bought when the journals saw the purchase. Ships older than the journals have no date —
  // said plainly rather than guessed.
  const fleet = [];
  if (stored) {
    for (const s of stored.ShipsHere || []) fleet.push({ id: s.ShipID, type: s.ShipType_Localised || s.ShipType, name: s.Name || null, where: stored.StationName || null, system: stored.StarSystem || null, here: true, inTransit: false, value: s.Value ?? null });
    for (const s of stored.ShipsRemote || []) fleet.push({ id: s.ShipID, type: s.ShipType_Localised || s.ShipType, name: s.Name || null, where: s.InTransit ? null : (s.StarSystem || null), system: s.StarSystem || null, here: false, inTransit: !!s.InTransit, value: s.Value ?? null });
  }
  if (flying && !fleet.some((f) => f.id === flying.id)) {
    fleet.push({ id: flying.id, type: flying.type, name: flying.name, where: cur.station || cur.system || null, system: cur.system || null, here: false, inTransit: false, value: null, flying: true });
  } else if (flying) {
    const f = fleet.find((x) => x.id === flying.id);
    if (f) f.flying = true;
  }
  for (const f of fleet) {
    f.boughtAt = boughtShip.get(f.id) || null;
    // StoredShips gives ShipType_Localised for most hulls but the bare internal id for the newer
    // ones — "explorer_nx" is the Caspian Explorer. Take the shared table's answer when it has one
    // and leave the string alone when it does not, so an already-friendly name is never lowercased.
    if (f.type) { const pretty = friendlyShip(lower(f.type)); if (pretty !== lower(f.type)) f.type = pretty; }
  }
  fleet.sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.name || '').localeCompare(String(b.name || '')));

  return {
    sittings, events: out, home: homeName,
    fleet, fleetAt: stored ? stored.timestamp : null,
    rank: rank ? { at: rank.at, ranks: { Combat: rank.Combat, Trade: rank.Trade, Explore: rank.Explore, Exobiologist: rank.Exobiologist, Soldier: rank.Soldier, Empire: rank.Empire, Federation: rank.Federation, CQC: rank.CQC }, progress: progress ? { Combat: progress.Combat, Trade: progress.Trade, Explore: progress.Explore, Exobiologist: progress.Exobiologist, Soldier: progress.Soldier, Empire: progress.Empire, Federation: progress.Federation, CQC: progress.CQC } : null } : null,
    systems: [...seenSystems.values()].sort((a, b) => (a.first < b.first ? -1 : 1)),
    stations: [...stations.values()].sort((a, b) => (a.first < b.first ? -1 : 1)),
    bodies: [...landedBodies.values()].sort((a, b) => (a.first < b.first ? -1 : 1)),
  };
}

/**
 * Search the whole log, not the window: every entry whose text mentions the term, plus the two
 * answers entries cannot give — when a system was first seen, and when a body was first landed on.
 */
export function searchCommanderLog(log, query, { limit = 200 } = {}) {
  const q = lower(query).trim();
  if (!q) return null;
  const hit = (s) => lower(s).includes(q);
  // Searching the word for a KIND finds every one of them — "builds" is how the commander thinks
  // of them, and it is not a word any of those lines contain.
  const kinds = new Set(Object.entries(KIND_WORDS).filter(([, words]) => words.some((w) => w.includes(q))).map(([k]) => k));
  const systems = (log.systems || []).filter((s) => hit(s.name)).slice(0, 20);
  const bodies = (log.bodies || []).filter((b) => hit(b.name)).slice(0, 20);
  const stations = (log.stations || []).filter((st) => hit(st.name) || hit(st.system || '')).slice(0, 20);
  const events = (log.events || []).filter((e) => kinds.has(e.kind) || hit(e.line) || hit(e.system || '') || hit(e.body || '')).slice(0, limit);
  const sittings = (log.sittings || [])
    .filter((s) => hit(s.ship || '') || hit(s.firstSystem || '') || hit(s.lastSystem || '') || (s.wing || []).some(hit))
    .map((s) => ({ startedAt: s.startedAt, hours: s.hours, ship: s.ship, firstSystem: s.firstSystem, lastSystem: s.lastSystem, lyFromHome: s.lyFromHome, jumps: s.jumps, landings: s.landings, tonnesMined: s.tonnesMined, bodiesScanned: s.bodiesScanned, wing: s.wing, events: s.events }))
    .slice(0, limit);
  return { query, systems, bodies, stations, events, sittings };
}

/**
 * The journey: every jump's position in order, plus pins for the events that matter, so the map
 * can draw the path and mark what happened along it. Positions come from FSDJump.StarPos; an
 * event in a system the commander only ever docked in (no jump) gets no pin rather than a guess.
 */
export function buildJourney(events, log, { minWeight = 'major', sinceMs = 0 } = {}) {
  const posOf = new Map(); // lower system -> [x,y,z]
  const path = [];
  for (const e of events) {
    if (e.event !== 'FSDJump' && e.event !== 'CarrierJump' && e.event !== 'Location') continue;
    if (!e.StarSystem || !Array.isArray(e.StarPos) || e.StarPos.length !== 3) continue;
    posOf.set(lower(e.StarSystem), e.StarPos);
    if (e.event === 'Location' && !e.Docked) continue; // the login position only counts when it moved us
    if (sinceMs && Date.parse(e.timestamp) < sinceMs) continue;
    const last = path[path.length - 1];
    if (last && last.system === e.StarSystem) continue;
    path.push({ at: e.timestamp, system: e.StarSystem, pos: e.StarPos, carrier: e.event === 'CarrierJump' });
  }
  const pins = [];
  for (const ev of log.events) {
    if (weightRank(ev.weight) < weightRank(minWeight) || !ev.system) continue;
    if (sinceMs && Date.parse(ev.at) < sinceMs) continue;
    const pos = posOf.get(lower(ev.system));
    if (!pos) continue;
    pins.push({ at: ev.at, weight: ev.weight, kind: ev.kind, system: ev.system, pos, line: ev.line });
  }
  return { path, pins, systemsWithPosition: posOf.size };
}

/** Where a sitting happened: one system, or the run it covered. */
export function sittingWhere(s) {
  if (!s.firstSystem && !s.lastSystem) return null;
  if (!s.firstSystem || s.firstSystem === s.lastSystem) return s.lastSystem || s.firstSystem;
  return `${s.firstSystem} → ${s.lastSystem}`;
}

/** One folded line for a sitting's routine: what happened that did not earn an entry of its own. */
export function sittingSummary(s) {
  const bits = [];
  if (s.jumps) bits.push(`${s.jumps} jump${s.jumps === 1 ? '' : 's'}${s.ly ? `, ${Math.round(s.ly).toLocaleString()} ly` : ''}`);
  if (s.systems) bits.push(`${s.systems} system${s.systems === 1 ? '' : 's'}`);
  if (s.landings) bits.push(`${s.landings} landing${s.landings === 1 ? '' : 's'}`);
  if (s.bodiesScanned) bits.push(`${s.bodiesScanned} bodies scanned${s.firstDiscoveries ? ` (${s.firstDiscoveries} first)` : ''}`);
  if (s.tonnesMined) bits.push(`${s.tonnesMined} t mined`);
  if (s.bounties && !(s.events || []).some((e) => e.kind === 'bounty_night')) bits.push(`${s.bounties} bounties`);
  return bits.join(' · ') || 'quiet';
}
