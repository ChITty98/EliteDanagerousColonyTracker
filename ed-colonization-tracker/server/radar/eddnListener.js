// server/radar/eddnListener.js
//
// The EDDN firehose, filtered to the commander's neighborhood.
//
// Every message: inflate → parse → does it carry a position (journal StarPos)? → within 200 ly of
// the commander? → route into radarState by what it is. Coordless messages (commodity etc.) are
// only used when their system is already in the local coords cache — positions are never invented.
//
// Own-presence: the commander's own EDMC submits to this same stream, so events matching a recent
// own-journal fingerprint (event type + system within 2 min) are dropped before counting — without
// this, the radar mostly detects its own pilot, especially at their colony.
//
// Density honesty: uploaderID (an obfuscated per-uploader constant in the EDDN header) dedupes
// event volume into "distinct uploaders heard recently" — an activity level of tool-running
// commanders, never a census, always phrased "…that I've heard of".

import zlib from 'node:zlib';
import { connectSub } from './zmtp.js';
import {
  setCenter, getCenter, inRadius, distLyFrom, isOwnEvent, markUploader, noteEddn, setEddnConnected,
  addBuild, addAtmoLead, addScannedBody, addConflict, addPower, isNewToYou, isKnownPopulated,
  noteSystemVisitor,
} from './radarState.js';
import { isColonisableAtmosphere, ICY_SUBTYPES } from '../journal/scorer.js';
import { pushRadarBeat } from '../ai/copilotRadar.js';
import { noteColonisationEvent } from '../chains/chainWatch.js';

const EDDN_HOST = 'eddn.edcd.io';
const EDDN_PORT = 9500;

// Colonisation-related journal events — THE HEADLINE signal (rival builds / frontier expansion).
const BUILD_EVENTS = new Set([
  'ColonisationBeaconDeployed', 'ColonisationConstructionDepot', 'ColonisationContribution',
  'ColonisationSystemClaim', 'ColonisationSystemClaimRelease', 'ColonisationFactionContribution',
]);
const CONFLICT_STATES = new Set(['War', 'CivilWar', 'Civil war', 'Election']);

// What the commander actually flies to see. `isColonisableAtmosphere` answers a DIFFERENT
// question — whether a body can be built on — and says yes to carbon dioxide and methane, which
// is right for the scorer and useless as an alert. These two are the ones worth an interrupt,
// ammonia ranking above water, and ice balls are out even when they carry an atmosphere.
const NOTABLE_ATMOS = ['oxygen', 'ammonia'];

// How far out the VOICE is allowed to care. The screen is a 200 ly ambient scope
// (RADAR_RANGE_LY) and that is right for a scope — but the co-pilot inherited it, so a rival
// build 165 ly away got spoken aloud as a warning. Nothing at that range is actionable:
// colonisation spreads by ~15 ly claim hops, making 50 ly about three hops of runway. That
// figure is not new here — threatWatch.js already records it as the commander's stated
// warning radius. Screen keeps everything; only the interrupt narrows.
const VOICE_MAX_LY = 50;
const withinVoiceRange = (distLy) => typeof distLy === 'number' && Number.isFinite(distLy) && distLy <= VOICE_MAX_LY;

function isInterestingLead(atmo, planetClass) {
  if (ICY_SUBTYPES.has(planetClass)) return false;
  const a = String(atmo).toLowerCase();
  return NOTABLE_ATMOS.some((n) => a.includes(n));
}

/** "Thin Oxygen" / "Hot thick Ammonia" -> "oxygen" — the type, never the composition. */
function shortAtmo(atmo) {
  const a = String(atmo).toLowerCase();
  const hit = NOTABLE_ATMOS.find((n) => a.includes(n));
  return hit || a.replace(/\s*atmosphere\s*/g, '').trim();
}

let client = null;
let deps = null;

// What the firehose costs, stated hourly so a metered connection is never a surprise: measured
// 2026-09-04 at 23 msg/s and 21.6 KB/s compressed — about 1.8 GB a day.
const volume = { msgs: 0, bytes: 0, hourMsgs: 0, hourBytes: 0, since: 0 };
let volumeTimer = null;
const mb = (b) => (b / 1048576).toFixed(1);
function reportVolume() {
  if (!volume.hourMsgs) return;
  const hours = Math.max(1 / 60, (Date.now() - volume.since) / 3600e3);
  console.log(`[Radar] EDDN this hour: ${volume.hourMsgs} msgs, ${mb(volume.hourBytes)} MB · since start ${mb(volume.bytes)} MB over ${hours.toFixed(1)} h (${mb(volume.bytes / hours * 24)} MB/day pace)`);
  volume.hourMsgs = 0; volume.hourBytes = 0;
}
export function eddnVolume() { return { ...volume }; }

export function startEddnListener(injected) {
  if (client) return;
  deps = injected || {};
  if (!volume.since) volume.since = Date.now();
  client = connectSub(EDDN_HOST, EDDN_PORT, onRaw, (s) => {
    setEddnConnected(s === 'subscribed' ? true : (s === 'closed' || s.startsWith('error') ? false : undefined));
    if (s === 'subscribed' || s === 'closed' || s.startsWith('silence')) console.log(`[Radar] EDDN ${s}`);
  });
  if (!volumeTimer) { volumeTimer = setInterval(reportVolume, 3600e3); if (volumeTimer.unref) volumeTimer.unref(); }
  console.log('[Radar] EDDN listener starting');
}

export function stopEddnListener() {
  if (client) {
    client.stop(); client = null;
    setEddnConnected(false);
    reportVolume();
    console.log(`[Radar] EDDN listener stopped (Settings) — ${mb(volume.bytes)} MB received this run`);
  }
}

function onRaw(body) {
  volume.msgs += 1; volume.bytes += body.length; volume.hourMsgs += 1; volume.hourBytes += body.length;
  let j;
  try {
    j = JSON.parse(zlib.inflateSync(body).toString('utf8'));
  } catch { return; }
  const schema = String(j.$schemaRef || '');
  const m = j.message || {};
  const header = j.header || {};

  const isJournal = schema.includes('/journal/');
  const sys = m.StarSystem || m.SystemName || null;
  const pos = Array.isArray(m.StarPos) ? m.StarPos : null;
  const inRad = !!(pos && inRadius(pos));
  noteEddn(inRad);

  // Chain Watch feeds GALAXY-WIDE — colonization events are rare and precious, and the
  // 200-ly gate below is a radar concern, not a frontier-tracking one. Own events still
  // excluded (your own builds are not "someone else's chain").
  if (isJournal && sys && (BUILD_EVENTS.has(m.event) || (m.event === 'Docked' && /ColonisationShip|Construction/i.test(m.StationName || '')))
      && !isOwnEvent(m.event || '', sys)) {
    const grewChain = noteColonisationEvent(sys, pos, m.event);
    if (grewChain) pushRadarBeat('chain', { sys });
  }

  if (!inRad) return;                    // positionless or out of range — not this scope's business
  if (!isJournal) {                      // commodity/outfitting etc. inside radius still = presence
    if (!isOwnEvent('market', sys || '')) { markUploader(header.uploaderID, pos); noteSystemVisitor(sys, header.uploaderID); }
    return;
  }

  const ev = m.event || '';
  if (sys && isOwnEvent(ev, sys)) return; // that's us — never count yourself

  markUploader(header.uploaderID, pos);
  noteSystemVisitor(sys, header.uploaderID);

  // --- THE HEADLINE: colonisation/construction activity ---
  if (BUILD_EVENTS.has(ev) || (ev === 'Docked' && /ColonisationShip|Construction/i.test(m.StationName || ''))) {
    const rec = {
      sys, pos, ev: BUILD_EVENTS.has(ev) ? ev : 'ConstructionDock',
      stationName: m.StationName || null,
      at: Date.now(), live: true,
      distLy: Math.round(distLyFrom(pos) ?? 0),
    };
    addBuild(rec);
    emitPing('build', rec); // the screen shows every build in the 200 ly scope
    if (withinVoiceRange(rec.distLy)) pushRadarBeat('build', { distLy: rec.distLy, sys });
    return;
  }

  // --- prospect layers: live Scan accumulation + atmosphere leads ---
  if (ev === 'Scan' && m.BodyName) {
    // Populated systems are not colonizable — never prospects, never leads (commander's rule).
    if (isKnownPopulated(sys)) { emitPing('traffic', { sys, pos, at: Date.now() }); return; }
    const entry = addScannedBody(sys, pos, m, false);
    const atmo = m.AtmosphereType || m.Atmosphere || '';
    if (atmo && isColonisableAtmosphere(atmo) && m.Landable) {
      const planetClass = m.PlanetClass || '';
      const lead = {
        sys, body: m.BodyName, atmo, planetClass, pos, at: Date.now(),
        icy: ICY_SUBTYPES.has(planetClass),
        interesting: isInterestingLead(atmo, planetClass),
        newToYou: isNewToYou(sys), live: true,
        distLy: Math.round(distLyFrom(pos) ?? 0),
      };
      addAtmoLead(lead);
      emitPing('lead', lead);
      // The SCREEN keeps every atmospheric lead; the VOICE only interrupts for oxygen or ammonia
      // on a non-icy body. Before this it spoke for any atmosphere at all — a methane ice ball
      // 152 ly out read identically to the thing actually worth flying to.
      if (lead.newToYou && lead.interesting && withinVoiceRange(lead.distLy)) {
        pushRadarBeat('lead', {
          distLy: lead.distLy, sys, body: m.BodyName,
          atmo: shortAtmo(atmo), planetClass,
        });
      }
    } else if (entry && entry.score && (entry.score.total ?? 0) > 0) {
      emitPing('scan', { sys, pos, at: Date.now() });
    }
    return;
  }
  if (ev === 'FSSAllBodiesFound') {
    addScannedBody(sys, pos, null, true);
    return;
  }

  // --- conflicts + power/faction/population (FSDJump & Location carry the arrays) ---
  if (ev === 'FSDJump' || ev === 'Location') {
    const factions = Array.isArray(m.Factions) ? m.Factions : [];
    const inConflict = factions
      .filter((f) => f && (CONFLICT_STATES.has(f.FactionState) ||
        (Array.isArray(f.ActiveStates) && f.ActiveStates.some((s) => CONFLICT_STATES.has(s.State)))))
      .map((f) => ({ name: f.Name, state: f.FactionState }));
    if (inConflict.length >= 2) addConflict(sys, pos, inConflict);

    const power = m.ControllingPower || (Array.isArray(m.Powers) ? m.Powers[0] : null);
    const faction = (m.SystemFaction && m.SystemFaction.Name) || null;
    if (power || faction || m.Population) {
      addPower(sys, pos, {
        power: power || null,
        powerState: m.PowerplayState || null,
        faction,
        allegiance: m.SystemAllegiance || null,
        population: m.Population || 0,
      });
    }
    emitPing('traffic', { sys, pos, at: Date.now() });
    return;
  }

  // Everything else journal-side inside the radius (Docked, honks, settlements…) counts as traffic.
  emitPing('traffic', { sys, pos, at: Date.now() });
}

function emitPing(kind, data) {
  if (!deps || typeof deps.broadcastEvent !== 'function') return;
  try {
    deps.broadcastEvent(Object.assign({ type: 'radar_ping', kind, timestamp: new Date().toISOString() }, data));
  } catch { /* SSE best-effort */ }
}

/** Recenter — called when the commander's position changes. */
export function recenterRadar(systemName, coords) {
  const pos = coords && typeof coords === 'object' && !Array.isArray(coords)
    ? [coords.x, coords.y, coords.z]
    : coords;
  return setCenter(systemName, pos);
}

export function radarCenter() { return getCenter(); }
