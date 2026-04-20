/**
 * Server-side overlay message builders.
 *
 * Ports the non-chat handlers from src/services/overlayService.ts:
 *   - handleFSDJumpOverlay — score tag + distances + market needs for active project
 *   - handleDockedOverlay  — FC load list / buy-here suggestion
 *   - handleScanEventOverlay — ringed landables, oxygen/nitrogen atmosphere pops
 *                              + accumulated first-footfall list
 *
 * Pending full port (needs Spansh + scoutingScorer ports to land first):
 *   - scoreUnknownSystem (Spansh dump → scorer → overlay)
 *   - handleFSSAllBodiesFound full scoring
 *   - handleTargetSelected (FSDTarget companion alert)
 *   - handleNavRoutePlotted
 *   - checkMissingImages / checkInstallationImage (gallery integration)
 *
 * All functions accept `(event, existing, deps)` where:
 *   - `event` is the raw journal event
 *   - `existing` is the current colony-data.json (from deps.readState())
 *   - `deps` = { readState, broadcastEvent, sendOverlay, applyStatePatch }
 */

import { isFleetCarrier, isEphemeralStation } from './util.js';
import { fetchSystemDump, resolveSystemName } from './spansh.js';
import { readNavRouteJson } from './extractor.js';
import {
  scoreSystem,
  buildBodyString,
  filterQualifyingBodies,
  classifyStars,
} from './scorer.js';
import { mapStarType } from './extractor.js';

// Module state: last target dedupe (so repeated FSDTarget for same system
// doesn't re-broadcast every tick)
let lastTargetAddress = null;

// ===== Layout =====
const X_LEFT = 40;
const Y_SCORE = 40;
const Y_MARKET = 80;
const Y_SCAN = 120;
const Y_IMAGE = 160;
const Y_DISTANCE = 200;

const MAX_OVERLAY_ITEMS = 6;

function formatCommodityList(items) {
  const shown = items.slice(0, MAX_OVERLAY_ITEMS);
  const rest = items.length - shown.length;
  const parts = shown.map((i) => `${i.name} ${i.count.toLocaleString()}`);
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join(' | ');
}

// Shared pending-scan state per tick. Cleared on FSDJump so every system
// starts fresh. Keeps track of which system we're currently "in" so
// Scan events from the PREVIOUS system (same batch) don't pollute.
const scanState = {
  pendingSystemAddress: null,
  pendingSystemName: null,
  pendingFootfallBodies: [],
  // Accumulated body scans in this system — used by handleFSSAllBodiesFound
  // when Spansh doesn't have the system yet.
  pendingScanBodies: [],
};

export function resetScanState(systemAddress, systemName) {
  scanState.pendingSystemAddress = systemAddress;
  scanState.pendingSystemName = systemName;
  scanState.pendingFootfallBodies = [];
  scanState.pendingScanBodies = [];
}

// ===== Helpers (project + cargo context) =====

/** Find the currently active session's project (if the project is still active). */
export function getActiveProject(state) {
  if (!state) return null;
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId) return null;
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session) return null;
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const project = projects.find((p) => p.id === session.projectId);
  return project && project.status === 'active' ? project : null;
}

/**
 * Find commodities at this market that the active project still needs to BUY.
 * Subtracts myFC stock + ship stock from required - provided.
 */
function findMarketMatches(commodities, project, state) {
  const settings = state.settings || {};
  const myFcCallsign = settings.myFleetCarrier;
  const myFcCargo = myFcCallsign ? (state.carrierCargo || {})[myFcCallsign] : null;
  const myFcItems = (myFcCargo && myFcCargo.items) || [];
  const shipItems = (state.liveShipCargo && state.liveShipCargo.items) || [];

  const matches = [];
  for (const pc of project.commodities) {
    const remaining = pc.requiredQuantity - pc.providedQuantity;
    if (remaining <= 0) continue;
    const fcStock = (myFcItems.find((i) => i.commodityId.toLowerCase() === pc.commodityId.toLowerCase()) || {}).count || 0;
    const shipStock = (shipItems.find((i) => i.commodityId.toLowerCase() === pc.commodityId.toLowerCase()) || {}).count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);
    if (needToBuy <= 0) continue;
    const marketItem = commodities.find(
      (c) => c.commodityId.toLowerCase() === pc.commodityId.toLowerCase() && c.stock > 0 && c.buyPrice > 0,
    );
    if (marketItem) {
      matches.push({ name: pc.name, available: marketItem.stock, needToBuy });
    }
  }
  return matches.sort((a, b) => a.needToBuy - b.needToBuy);
}

/** Find commodities on FC that an active project needs (for load suggestions). */
function findCarrierLoadMatches(carrierItems, project) {
  const matches = [];
  for (const pc of project.commodities) {
    const remaining = pc.requiredQuantity - pc.providedQuantity;
    if (remaining <= 0) continue;
    const fcItem = carrierItems.find((c) => c.commodityId.toLowerCase() === pc.commodityId.toLowerCase());
    if (fcItem && fcItem.count > 0) {
      matches.push({ name: pc.name, loadQty: Math.min(fcItem.count, remaining), remaining });
    }
  }
  return matches.sort((a, b) => a.remaining - b.remaining);
}

function buildSourceTag(scouted) {
  if (!scouted) return 'unknown';
  if (scouted.fromJournal && scouted.fssAllBodiesFound) return 'Journal · full';
  if (scouted.fromJournal) return 'Journal';
  if (scouted.spanshBodyCount) return 'Spansh';
  return 'cached';
}

// ===== FSDJump =====

/**
 * Show the scouting-score overlay + distance summary + active-project market needs.
 *
 * Skips the "score unknown system via Spansh" path — that ships in the next
 * pass once the Spansh client is ported. Systems already in scoutedSystems
 * render their cached score here.
 */
export function handleFSDJumpOverlay(ev, existing, deps) {
  const settings = existing.settings || {};
  if (settings.overlayEnabled === false) return;

  resetScanState(ev.SystemAddress, ev.StarSystem);

  const scoutedSystems = existing.scoutedSystems || {};
  const projects = Array.isArray(existing.projects) ? existing.projects : [];
  const manualColonized = Array.isArray(existing.manualColonizedSystems) ? existing.manualColonizedSystems : [];
  const knownStations = existing.knownStations || {};
  const marketSnapshots = existing.marketSnapshots || {};

  const sysLower = ev.StarSystem.toLowerCase();
  const isColonized =
    projects.some((p) => p.systemName && p.systemName.toLowerCase() === sysLower) ||
    manualColonized.some((s) => s.toLowerCase() === sysLower);

  const scouted = scoutedSystems[ev.SystemAddress];

  // 1. Score tag
  if (isColonized) {
    deps.sendOverlay({
      id: `edcolony_score_${ev.SystemAddress}`,
      text: `${ev.StarSystem} — Your Colony`,
      color: '#c084fc',
      x: X_LEFT, y: Y_SCORE, ttl: 10,
    });
  } else if (scouted && scouted.score && scouted.score.total > 0) {
    const source = buildSourceTag(scouted);
    const needsScan = !scouted.fssAllBodiesFound;
    const total = scouted.score.total;
    const color = total >= 100 ? '#fcd34d' : total >= 60 ? '#4ade80' : '#38bdf8';
    let text = `${ev.StarSystem} — Score: ${total} [${source}] | ${scouted.bodyString || ''}`;
    if (needsScan) text += ' — FSS scan incomplete';
    deps.sendOverlay({ id: `edcolony_score_${ev.SystemAddress}`, text, color, x: X_LEFT, y: Y_SCORE, ttl: 12 });
    if (needsScan) {
      deps.sendOverlay({
        id: 'edcolony_scan_prompt',
        text: '🔍 FSS scan all bodies for accurate scoring',
        color: '#22d3ee', x: X_LEFT, y: Y_SCAN, ttl: 10,
      });
    }
  } else if (scouted) {
    const source = buildSourceTag(scouted);
    deps.sendOverlay({
      id: `edcolony_score_${ev.SystemAddress}`,
      text: `${ev.StarSystem} — Known [${source}]`,
      color: '#38bdf8', x: X_LEFT, y: Y_SCORE, ttl: 8,
    });
    if (!scouted.fssAllBodiesFound) {
      deps.sendOverlay({
        id: 'edcolony_scan_prompt',
        text: '🔍 FSS scan all bodies for accurate scoring',
        color: '#22d3ee', x: X_LEFT, y: Y_SCAN, ttl: 10,
      });
    }
  } else {
    deps.sendOverlay({
      id: `edcolony_score_${ev.SystemAddress}`,
      text: `${ev.StarSystem} — Checking Spansh...`,
      color: '#e2e8f0', x: X_LEFT, y: Y_SCORE, ttl: 8,
    });
    deps.sendOverlay({
      id: 'edcolony_scan_prompt',
      text: '🔍 FSS scan all bodies to score this system',
      color: '#22d3ee', x: X_LEFT, y: Y_SCAN, ttl: 10,
    });
    // Fire-and-forget — Spansh fetch is async, we don't want to block the
    // processor tick. If Spansh has data, it'll update the score overlay + state.
    scoreUnknownSystem(ev.SystemAddress, ev.StarSystem, deps).catch((e) => {
      console.warn('[Overlay] scoreUnknownSystem (FSDJump) failed:', e && e.message);
    });
  }

  // 2. Distance summary
  if (ev.StarPos) {
    const [x, y, z] = ev.StarPos;
    const dist3d = (ox, oy, oz) => Math.sqrt((x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2);
    const solDist = dist3d(0, 0, 0);
    const parts = [`Sol: ${solDist.toFixed(1)} ly`];

    const homeSystemName = settings.homeSystem;
    if (homeSystemName) {
      const homeKey = homeSystemName.toLowerCase();
      const knownSystems = existing.knownSystems || {};
      const homeSys = knownSystems[homeKey];
      if (homeSys && homeSys.coordinates) {
        const homeDist = dist3d(homeSys.coordinates.x, homeSys.coordinates.y, homeSys.coordinates.z);
        parts.push(`Home: ${homeDist.toFixed(1)} ly`);
      }
    }

    let nearestDist = Infinity;
    let nearestName = '';
    for (const p of projects) {
      const pKey = (p.systemName || '').toLowerCase();
      const pSys = (existing.knownSystems || {})[pKey];
      if (pSys && pSys.coordinates) {
        const d = dist3d(pSys.coordinates.x, pSys.coordinates.y, pSys.coordinates.z);
        if (d < nearestDist) {
          nearestDist = d;
          nearestName = pSys.systemName || p.systemName || '';
        }
      }
    }
    if (nearestDist < Infinity) parts.push(`${nearestName}: ${nearestDist.toFixed(1)} ly`);

    deps.sendOverlay({
      id: 'edcolony_distance',
      text: `📍 ${parts.join(' | ')}`,
      color: '#94a3b8',
      x: X_LEFT, y: Y_DISTANCE, ttl: 10,
    });
    deps.broadcastEvent({
      type: 'distance_info',
      system: ev.StarSystem,
      distances: parts,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Active project — needs at any known station in this system
  const activeProject = getActiveProject(existing);
  if (activeProject) {
    const systemStations = Object.values(knownStations).filter(
      (st) => st && st.systemName && st.systemName.toLowerCase() === sysLower,
    );
    for (const station of systemStations) {
      if (isFleetCarrier(station.stationType, station.marketId)) continue;
      const snapshot = marketSnapshots[station.marketId];
      if (!snapshot) continue;
      const matches = findMarketMatches(snapshot.commodities, activeProject, existing);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.needToBuy })));
        deps.sendOverlay({
          id: `edcolony_market_${ev.SystemAddress}`,
          text: `${station.stationName} — Need: ${list}`,
          color: '#22d3ee',
          x: X_LEFT, y: Y_MARKET, ttl: 10,
        });
        break; // best station only
      }
    }
  }
}

// ===== Docked =====

export function handleDockedOverlay(ev, existing, deps) {
  const settings = existing.settings || {};
  if (settings.overlayEnabled === false) return;

  const activeProject = getActiveProject(existing);

  // 1. Docked at own FC with active project — show needs summary + load suggestions
  if (activeProject && isFleetCarrier(ev.StationType, ev.MarketID)) {
    const isMyFC =
      settings.myFleetCarrierMarketId === ev.MarketID ||
      (settings.myFleetCarrier && (ev.StationName || '').toUpperCase().includes(settings.myFleetCarrier.toUpperCase()));
    if (isMyFC) {
      const fcCallsign = settings.myFleetCarrier;
      const cargo = fcCallsign ? (existing.carrierCargo || {})[fcCallsign] : null;
      if (cargo && cargo.items && cargo.items.length > 0) {
        const matches = findCarrierLoadMatches(cargo.items, activeProject);
        if (matches.length > 0) {
          const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.loadQty })));
          deps.sendOverlay({
            id: 'edcolony_fc_load',
            text: `Load from FC: ${list}`,
            color: '#38bdf8',
            x: X_LEFT, y: Y_SCAN, ttl: 20,
          });
        }
      }
      deps.sendOverlay({
        id: 'edcolony_fc_reminder',
        text: 'Remember: open Carrier Market tab to sync cargo before leaving',
        color: '#fcd34d',
        x: X_LEFT, y: Y_IMAGE, ttl: 15,
      });
    }
  }

  // 2. Non-FC station — buy-here suggestions or prompt to sync
  if (!isFleetCarrier(ev.StationType, ev.MarketID)) {
    const snapshot = (existing.marketSnapshots || {})[ev.MarketID];
    if (snapshot && activeProject) {
      const matches = findMarketMatches(snapshot.commodities, activeProject, existing);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.needToBuy })));
        deps.sendOverlay({
          id: 'edcolony_station_needs',
          text: `Buy here: ${list}`,
          color: '#4ade80',
          x: X_LEFT, y: Y_MARKET, ttl: 10,
        });
      }
    } else if (!snapshot && !isEphemeralStation(ev.StationName, ev.StationType, ev.MarketID)) {
      deps.sendOverlay({
        id: 'edcolony_station_needs',
        text: `No market data for ${ev.StationName} — open Commodities market to capture`,
        color: '#e2e8f0',
        x: X_LEFT, y: Y_MARKET, ttl: 8,
      });
    }
  }
}

// ===== Scan =====

/**
 * Pop overlay for ringed landables / oxygen atmospheres / nitrogen atmospheres.
 * First-footfall accumulation handled per-system; rendered as consolidated list.
 */
export function handleScanEventOverlay(ev, existing, deps) {
  const settings = existing.settings || {};
  if (settings.overlayEnabled === false) return;
  if (!scanState.pendingSystemAddress) return;
  if (ev.SystemAddress && ev.SystemAddress !== scanState.pendingSystemAddress) return;

  // Accumulate for journal-based scoring fallback (used by handleFSSAllBodiesFound
  // when Spansh doesn't have the system or returns nothing useful).
  const isStar = !!ev.StarType;
  scanState.pendingScanBodies.push({
    bodyId: ev.BodyID,
    bodyName: ev.BodyName,
    type: isStar ? 'Star' : 'Planet',
    subType: isStar ? (ev.StarType ? mapStarType(ev.StarType) : 'Unknown Star') : (ev.PlanetClass || 'Unknown Planet'),
    distanceToArrival: ev.DistanceFromArrivalLS,
    starType: ev.StarType,
    stellarMass: ev.StellarMass,
    isLandable: ev.Landable,
    earthMasses: ev.MassEM,
    gravity: ev.SurfaceGravity,
    atmosphereType: ev.AtmosphereType || ev.Atmosphere,
    volcanism: ev.Volcanism,
    surfaceTemperature: ev.SurfaceTemperature,
    terraformState: ev.TerraformState,
    rings: ev.Rings ? ev.Rings.map((r) => ({ name: r.Name, ringClass: r.RingClass })) : undefined,
    parents: ev.Parents,
    wasDiscovered: ev.WasDiscovered,
    wasMapped: ev.WasMapped,
  });

  if (ev.Landable && ev.Rings && ev.Rings.length > 0) {
    deps.sendOverlay({
      id: `edcolony_scan_ring_${ev.BodyName}`,
      text: `💍 Ringed landable — ${ev.BodyName}`,
      color: '#fcd34d',
      x: X_LEFT, y: Y_SCAN, ttl: 15,
    });
  }

  const atmo = (ev.AtmosphereType || ev.Atmosphere || '').toLowerCase();
  if (atmo.includes('oxygen')) {
    deps.sendOverlay({
      id: `edcolony_scan_oxy_${ev.BodyName}`,
      text: `🟢 Oxygen atmosphere — ${ev.BodyName}`,
      color: '#4ade80',
      x: X_LEFT, y: Y_SCAN, ttl: 15,
    });
  }
  if (atmo.includes('nitrogen')) {
    deps.sendOverlay({
      id: `edcolony_scan_n2_${ev.BodyName}`,
      text: `🔵 Nitrogen atmosphere — ${ev.BodyName}`,
      color: '#22d3ee',
      x: X_LEFT, y: Y_SCAN, ttl: 15,
    });
  }

  if (ev.Landable && ev.WasDiscovered === true && ev.WasFootfalled === false
      && typeof ev.DistanceFromArrivalLS === 'number' && ev.DistanceFromArrivalLS < 60000) {
    if (!scanState.pendingFootfallBodies.some((b) => b.bodyName === ev.BodyName)) {
      scanState.pendingFootfallBodies.push({ bodyName: ev.BodyName, distance: ev.DistanceFromArrivalLS });
    }
    emitFootfallOverlay(deps);
  }
}

const FOOTFALL_MAX_VISIBLE = 5;
const FOOTFALL_LINE_HEIGHT = 28;

function emitFootfallOverlay(deps) {
  const sysPrefix = scanState.pendingSystemName ? scanState.pendingSystemName + ' ' : '';
  const sorted = [...scanState.pendingFootfallBodies].sort((a, b) => a.distance - b.distance);
  const visible = sorted.slice(0, FOOTFALL_MAX_VISIBLE);

  deps.sendOverlay({
    id: 'edcolony_footfall_header',
    text: `🦶 First footfall (${sorted.length}):`,
    color: '#c084fc',
    x: X_LEFT, y: Y_IMAGE, ttl: 25,
  });

  for (let i = 0; i < FOOTFALL_MAX_VISIBLE; i++) {
    const id = `edcolony_footfall_${i}`;
    if (i < visible.length) {
      const { bodyName, distance } = visible[i];
      const short = sysPrefix && bodyName.startsWith(sysPrefix) ? bodyName.slice(sysPrefix.length) : bodyName;
      const d = distance < 10 ? `${distance.toFixed(1)} Ls` : `${Math.round(distance).toLocaleString()} Ls`;
      deps.sendOverlay({
        id, text: `   ${short} (${d})`, color: '#c084fc',
        x: X_LEFT, y: Y_IMAGE + (i + 1) * FOOTFALL_LINE_HEIGHT, ttl: 25,
      });
    } else {
      deps.sendOverlay({
        id, text: '', color: '#c084fc',
        x: X_LEFT, y: Y_IMAGE + (i + 1) * FOOTFALL_LINE_HEIGHT, ttl: 1,
      });
    }
  }

  const overflowId = 'edcolony_footfall_more';
  if (sorted.length > FOOTFALL_MAX_VISIBLE) {
    deps.sendOverlay({
      id: overflowId,
      text: `   …and ${sorted.length - FOOTFALL_MAX_VISIBLE} more`,
      color: '#c084fc',
      x: X_LEFT, y: Y_IMAGE + (FOOTFALL_MAX_VISIBLE + 1) * FOOTFALL_LINE_HEIGHT, ttl: 25,
    });
  } else {
    deps.sendOverlay({
      id: overflowId, text: '', color: '#c084fc',
      x: X_LEFT, y: Y_IMAGE + (FOOTFALL_MAX_VISIBLE + 1) * FOOTFALL_LINE_HEIGHT, ttl: 1,
    });
  }
}

// ===== Spansh-dependent scoring =====

/**
 * Convert journal-scanned bodies into Spansh dump body shape for the scorer.
 * Port of journalBodiesToSpanshFormat from journalReader.ts.
 *
 * Key gotcha: journal surface gravity is m/s², scorer expects g. Divide by 9.81.
 */
function journalBodiesToSpanshFormat(bodies, systemName) {
  void systemName; // kept for parity with browser signature
  return bodies.map((b) => ({
    bodyId: b.bodyId,
    id64: 0,
    name: b.bodyName,
    type: b.type,
    subType: b.subType || (b.type === 'Star' ? (b.starType ? mapStarType(b.starType) : 'Unknown Star') : 'Unknown Planet'),
    distanceToArrival: b.distanceToArrival,
    mainStar: b.type === 'Star' && b.distanceToArrival === 0,
    spectralClass: b.starType,
    solarMasses: b.stellarMass,
    isLandable: b.isLandable,
    earthMasses: b.earthMasses,
    gravity: b.gravity != null ? b.gravity / 9.81 : undefined,
    atmosphereType: b.atmosphereType || null,
    volcanismType: b.volcanism,
    terraformingState: b.terraformState,
    surfaceTemperature: b.surfaceTemperature,
    rings: b.rings ? b.rings.map((r) => ({ name: r.name, type: r.ringClass })) : undefined,
    parents: b.parents,
  }));
}

/** Collapse accumulated scan highlights into a short chip string. */
function buildScanHighlights(bodies) {
  const highlights = [];
  let ringedLandables = 0;
  let oxygenWorlds = 0;
  let nitrogenWorlds = 0;
  let terraformCandidates = 0;
  let elws = 0;

  for (const b of bodies) {
    if (b.type !== 'Planet') continue;
    const atmo = (b.atmosphereType || '').toLowerCase();
    if (b.isLandable && b.rings && b.rings.length > 0) ringedLandables++;
    if (atmo.includes('oxygen')) oxygenWorlds++;
    if (atmo.includes('nitrogen')) nitrogenWorlds++;
    if (b.terraformState && b.terraformState !== 'None' && b.terraformState !== '') terraformCandidates++;
    const sub = (b.subType || '').toLowerCase();
    if (sub.includes('earth-like') || sub.includes('earthlike')) elws++;
  }

  if (elws > 0) highlights.push(`${elws} ELW`);
  if (oxygenWorlds > 0) highlights.push(`${oxygenWorlds} O2`);
  if (nitrogenWorlds > 0) highlights.push(`${nitrogenWorlds} N2`);
  if (ringedLandables > 0) highlights.push(`${ringedLandables} ringed landable`);
  if (terraformCandidates > 0) highlights.push(`${terraformCandidates} terraform`);
  return highlights.join(', ');
}

/**
 * Score a system that isn't already in scoutedSystems. Async — fetches
 * Spansh, scores, writes the scoutedSystem, shows overlay + Companion event.
 * On Spansh failure, shows a soft fallback overlay.
 *
 * deps: { applyStatePatch, sendOverlay, broadcastEvent }
 */
export async function scoreUnknownSystem(systemAddress, systemName, deps) {
  try {
    const dump = await fetchSystemDump(systemAddress);
    if (!dump || !dump.bodies || dump.bodies.length === 0) {
      deps.sendOverlay({
        id: `edcolony_score_${systemAddress}`,
        text: `${systemName} — Not in Spansh — scan to score`,
        color: '#e2e8f0', x: X_LEFT, y: Y_SCORE, ttl: 10,
      });
      return;
    }

    const score = scoreSystem(dump.bodies);
    const bodyString = buildBodyString(filterQualifyingBodies(dump.bodies), classifyStars(dump.bodies));
    const record = {
      id64: systemAddress,
      name: systemName,
      score,
      bodyString,
      scoutedAt: new Date().toISOString(),
      spanshBodyCount: dump.bodies.length,
    };
    // scoutedSystems is a map keyed by id64 (systemAddress)
    deps.applyStatePatch({
      scoutedSystems: { __upsert: { [String(systemAddress)]: record } },
    });
    const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
    deps.sendOverlay({
      id: `edcolony_score_${systemAddress}`,
      text: `${systemName} — Score: ${score.total} | ${bodyString}`,
      color, x: X_LEFT, y: Y_SCORE, ttl: 12,
    });
    deps.broadcastEvent({
      type: 'score_update',
      system: systemName,
      score: score.total,
      source: 'Spansh',
      bodyString,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    deps.sendOverlay({
      id: `edcolony_score_${systemAddress}`,
      text: `${systemName} — Spansh lookup failed`,
      color: '#ef4444', x: X_LEFT, y: Y_SCORE, ttl: 8,
    });
    console.warn('[Overlay] scoreUnknownSystem failed:', e && e.message);
  }
}

/**
 * Handle FSSAllBodiesFound: score from Spansh first, fall back to accumulated
 * journal scans if Spansh has no data. Writes scoutedSystem + highlights.
 *
 * deps: { applyStatePatch, sendOverlay, broadcastEvent, readState }
 */
export async function handleFSSAllBodiesFoundOverlay(ev, existing, deps) {
  const settings = existing.settings || {};
  if (settings.overlayEnabled === false) return;
  if (scanState.pendingSystemAddress !== ev.SystemAddress) return;

  const systemName = ev.StarSystem || ev.SystemName || scanState.pendingSystemName || 'Unknown';

  deps.sendOverlay({
    id: `edcolony_score_${ev.SystemAddress}`,
    text: `${systemName} — All ${ev.Count} bodies found, scoring...`,
    color: '#38bdf8', x: X_LEFT, y: Y_SCORE, ttl: 8,
  });

  // 1. Try Spansh
  try {
    const dump = await fetchSystemDump(ev.SystemAddress);
    if (dump && dump.bodies && dump.bodies.length > 0) {
      const score = scoreSystem(dump.bodies);
      const bodyString = buildBodyString(filterQualifyingBodies(dump.bodies), classifyStars(dump.bodies));
      const record = {
        id64: ev.SystemAddress,
        name: systemName,
        score,
        bodyString,
        scoutedAt: new Date().toISOString(),
        spanshBodyCount: dump.bodies.length,
        fssAllBodiesFound: true,
        journalBodyCount: ev.Count,
      };
      deps.applyStatePatch({
        scoutedSystems: { __upsert: { [String(ev.SystemAddress)]: record } },
      });
      const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
      deps.sendOverlay({
        id: `edcolony_score_${ev.SystemAddress}`,
        text: `${systemName} — Score: ${score.total} [Spansh] | ${bodyString}`,
        color, x: X_LEFT, y: Y_SCORE, ttl: 12,
      });
      deps.broadcastEvent({
        type: 'score_update',
        system: systemName,
        score: score.total,
        source: 'Spansh',
        bodyString,
        timestamp: new Date().toISOString(),
      });
      if (scanState.pendingScanBodies.length > 0) {
        const highlights = buildScanHighlights(scanState.pendingScanBodies);
        if (highlights) {
          deps.sendOverlay({
            id: 'edcolony_highlights',
            text: `✨ ${highlights}`,
            color: '#fcd34d', x: X_LEFT, y: Y_SCAN, ttl: 12,
          });
        }
      }
      scanState.pendingScanBodies = [];
      return;
    }
  } catch {
    // Fall through to journal-based scoring
  }

  // 2. Fall back to accumulated journal scans. If watcher missed some, also
  // consult journalExplorationCache (Sync All populates it).
  let scanBodies = scanState.pendingScanBodies;
  if (scanBodies.length === 0) {
    const cached = (existing.journalExplorationCache || {})[ev.SystemAddress];
    if (cached && cached.scannedBodies && cached.scannedBodies.length > 0) {
      scanBodies = cached.scannedBodies;
    }
  }

  if (scanBodies.length > 0 && scanState.pendingSystemName) {
    try {
      const spanshBodies = journalBodiesToSpanshFormat(scanBodies, scanState.pendingSystemName);
      const score = scoreSystem(spanshBodies);
      const bodyString = buildBodyString(filterQualifyingBodies(spanshBodies), classifyStars(spanshBodies));
      const record = {
        id64: ev.SystemAddress,
        name: systemName,
        score,
        bodyString,
        scoutedAt: new Date().toISOString(),
        fromJournal: true,
        spanshBodyCount: 0,
        fssAllBodiesFound: true,
        journalBodyCount: ev.Count,
        journalScannedCount: scanBodies.length,
      };
      deps.applyStatePatch({
        scoutedSystems: { __upsert: { [String(ev.SystemAddress)]: record } },
      });
      const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
      deps.sendOverlay({
        id: `edcolony_score_${ev.SystemAddress}`,
        text: `${systemName} — Score: ${score.total} [Journal] | ${bodyString}`,
        color, x: X_LEFT, y: Y_SCORE, ttl: 12,
      });
      deps.broadcastEvent({
        type: 'score_update',
        system: systemName,
        score: score.total,
        source: 'Journal',
        bodyString,
        timestamp: new Date().toISOString(),
      });
      const highlights = buildScanHighlights(scanBodies);
      if (highlights) {
        deps.sendOverlay({
          id: 'edcolony_highlights',
          text: `✨ ${highlights}`,
          color: '#fcd34d', x: X_LEFT, y: Y_SCAN, ttl: 12,
        });
      }
    } catch (e) {
      console.warn('[Overlay] Journal scoring failed:', e && e.message);
      deps.sendOverlay({
        id: `edcolony_score_${ev.SystemAddress}`,
        text: `${systemName} — Journal scoring failed`,
        color: '#ef4444', x: X_LEFT, y: Y_SCORE, ttl: 10,
      });
    }
  } else {
    deps.sendOverlay({
      id: `edcolony_score_${ev.SystemAddress}`,
      text: `${systemName} — ${ev.Count} bodies, no scan data to score`,
      color: '#e2e8f0', x: X_LEFT, y: Y_SCORE, ttl: 10,
    });
  }

  scanState.pendingScanBodies = [];
}

// ===== FSDTarget companion alert =====

/**
 * On FSDTarget event (commander picked a new target in the galaxy map),
 * broadcast a Companion SSE event with visited / Spansh / cached-score info
 * so the iPad banner can show "You've been there, score 87, has market data".
 *
 * Async — may do a live Spansh name lookup if we don't have the system cached.
 *
 * deps: { readState, broadcastEvent }
 */
export async function handleTargetSelectedOverlay(ev, existing, deps) {
  if (!ev || !ev.SystemAddress || !ev.Name) return;
  if (ev.SystemAddress === lastTargetAddress) return;
  lastTargetAddress = ev.SystemAddress;

  const knownSystems = existing.knownSystems || {};
  const scoutedSystems = existing.scoutedSystems || {};
  const nameKey = ev.Name.toLowerCase();
  const byName = knownSystems[nameKey];
  const byAddr = byName ? null : Object.values(knownSystems).find((s) => s && s.systemAddress === ev.SystemAddress);
  const visited = !!(byName || byAddr);
  const scouted = scoutedSystems[ev.SystemAddress];

  let spansh = 'unknown';
  let bodyCount;

  if (scouted) {
    if (typeof scouted.spanshBodyCount === 'number') {
      if (scouted.spanshBodyCount > 0) {
        spansh = 'yes';
        bodyCount = scouted.spanshBodyCount;
      } else {
        spansh = 'empty';
      }
    }
  }

  if (spansh === 'unknown') {
    try {
      const result = await resolveSystemName(ev.Name);
      spansh = result ? 'yes' : 'no';
    } catch (e) {
      console.warn('[Overlay] Spansh target lookup failed for', ev.Name, '—', e && e.message);
      spansh = 'unknown';
    }
  }

  deps.broadcastEvent({
    type: 'target_selected',
    system: ev.Name,
    systemAddress: ev.SystemAddress,
    starClass: ev.StarClass || '',
    remainingJumps: ev.RemainingJumpsInRoute || 0,
    visited,
    spansh,
    bodyCount,
    wasColonised: (scouted && scouted.isColonised) || false,
    score: (scouted && scouted.score && scouted.score.total) || null,
    bodyString: (scouted && scouted.bodyString) || null,
    scoreSource: scouted ? (scouted.fromJournal ? 'Journal' : 'Spansh') : null,
    timestamp: new Date().toISOString(),
  });
}

// ===== NavRoute companion summary =====

/**
 * On NavRoute event, read NavRoute.json, count visited stops and cached
 * Spansh coverage, broadcast a summary Companion event.
 *
 * deps: { broadcastEvent }
 */
export function handleNavRoutePlottedOverlay(journalDir, existing, deps) {
  const nav = readNavRouteJson(journalDir);
  if (!nav || !nav.route || nav.route.length === 0) return;

  const knownSystems = existing.knownSystems || {};
  const scoutedSystems = existing.scoutedSystems || {};
  const addrVisited = new Set();
  for (const ks of Object.values(knownSystems)) {
    if (ks && ks.systemAddress) addrVisited.add(ks.systemAddress);
  }

  let visitedCount = 0;
  let spanshCached = 0;
  for (const stop of nav.route) {
    if (addrVisited.has(stop.SystemAddress) || knownSystems[stop.StarSystem.toLowerCase()]) visitedCount++;
    const sc = scoutedSystems[stop.SystemAddress];
    if (sc && typeof sc.spanshBodyCount === 'number' && sc.spanshBodyCount > 0) spanshCached++;
  }

  const last = nav.route[nav.route.length - 1];
  deps.broadcastEvent({
    type: 'nav_route_plotted',
    hops: nav.route.length,
    destination: (last && last.StarSystem) || '',
    destinationAddress: (last && last.SystemAddress) || null,
    visitedCount,
    spanshCached,
    systems: nav.route.map((s) => ({
      name: s.StarSystem,
      systemAddress: s.SystemAddress,
      starClass: s.StarClass,
    })),
    timestamp: new Date().toISOString(),
  });
}

