/**
 * Server-side event processors.
 *
 * Takes already-parsed journal events and applies domain logic:
 *   - Position tracking (FSDJump / Location / CarrierJump / SupercruiseExit / Docked)
 *   - Current ship tracking (Loadout / ShipyardSwap)
 *   - Cargo capacity auto-detect (Loadout)
 *   - Knowledge-base upserts (known systems / stations / fleet carriers / FSS signals)
 *   - Active construction project progression (ColonisationConstructionDepot)
 *   - Companion-file reads: Cargo.json, Market.json
 *   - Station dossier tracking (recordStationDock equivalent)
 *   - NPC threat detection (pirate/interdictor regex on ReceiveText)
 *   - Dock welcome overlay on DockingGranted (personalised multi-line banner)
 *   - Companion SSE feed: fsd_jump / carrier_jump / docked / contribution /
 *     fc_jump_scheduled / fc_jump_cancelled / fc_space_update / sc_drop /
 *     supercruise_exit / scan_highlight / first_footfall / fss_complete /
 *     nav_route_cleared
 *   - currentBody tracking (SupercruiseExit→set, Entry/Undock/Jump→clear)
 *   - Carrier jump countdown (Request→set, Cancelled/Jump→clear)
 *   - FC space usage (CarrierStats)
 *
 * State writes go through deps.applyStatePatch (merges via mergeStatePatch,
 * writes debounced, broadcasts state_updated). Overlay messages go through
 * deps.sendOverlay (TCP to EDMCModernOverlay). SSE events through
 * deps.broadcastEvent.
 *
 * NOT yet ported (next turn):
 *   - handleFSDJump overlay (scoring, needs summary, missing images)
 *   - handleDocked overlay (FC load list, buy-here suggestions)
 *   - handleScanEvent overlay (ringed/atmospheric highlights)
 *   - handleFSSAllBodiesFound auto-scoring (Spansh-dependent)
 *   - FSDTarget companion alert (Spansh-dependent)
 *   - NavRoute plotted-route summary (Spansh-dependent)
 *   - !colony chat commands (project + cargo context)
 */

import {
  extractKnowledgeBaseFromEvents,
  readMarketJson,
  readShipCargo,
  resourceToCommodity,
} from './extractor.js';
import {
  isFleetCarrier,
  isFleetCarrierCallsign,
  isEphemeralStation,
  isPermanentlyEphemeral,
  isColonisationShip,
  isConstructionStationName,
  registerFcMarketId,
} from './util.js';
import { findCommodityByJournalName, findCommodityByDisplayName } from './commodities.js';
import {
  handleFSDJumpOverlay,
  handleDockedOverlay,
  handleScanEventOverlay,
  handleFSSAllBodiesFoundOverlay,
  handleTargetSelectedOverlay,
  handleNavRoutePlottedOverlay,
  resetScanState,
} from './overlay.js';
import { processChatCommands } from './chat.js';

// ===== Overlay layout (must match src/services/overlayService.ts) =====
const X_LEFT = 40;
const Y_DOCK = 240;
const Y_THREAT = 280;

// ===== Dock dossier constants (must match src/store/index.ts) =====
const DOCK_MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000];
const DOCK_HISTORY_CAP = 10;
const DOCK_GRANT_SUPPRESSION_MS = 60_000;
/** Per-marketId timestamps to suppress DockingGranted re-fires (game re-requests on pad change). */
const lastDockGrantAt = new Map();

const STATE_STYLES = {
  Boom: { emoji: '📈', color: '#4ade80', label: 'Booming' },
  Bust: { emoji: '📉', color: '#f87171', label: 'In Bust' },
  War: { emoji: '⚔️', color: '#f87171', label: 'At War' },
  CivilWar: { emoji: '⚔️', color: '#f87171', label: 'Civil War' },
  Election: { emoji: '🗳️', color: '#60a5fa', label: 'Election' },
  Expansion: { emoji: '🚀', color: '#fcd34d', label: 'Expanding' },
  Lockdown: { emoji: '🔒', color: '#f87171', label: 'Lockdown' },
  Famine: { emoji: '🍚', color: '#fbbf24', label: 'Famine' },
  Outbreak: { emoji: '🦠', color: '#fbbf24', label: 'Outbreak' },
  Investment: { emoji: '💰', color: '#fcd34d', label: 'Investment' },
  Retreat: { emoji: '🏳️', color: '#f87171', label: 'In Retreat' },
};

// ===== Top-level dispatch =====

/**
 * Apply any new events from a poll tick. Deps:
 *   - readState()            : () => current colony-data.json
 *   - applyStatePatch(patch) : merges + writes + broadcasts state_updated
 *   - broadcastEvent(event)  : pushes SSE
 *   - sendOverlay(msg)       : pushes to EDMC TCP overlay (optional; skipped if null)
 */
export function processNewEvents(parsed, deps) {
  if (!parsed) return;

  // Single state read at top — accumulate a patch, single write at the end
  const existing = deps.readState();
  const settings = existing.settings || {};

  const patch = {};
  const extraEvents = [];

  processPositionEvents(parsed, existing, patch, extraEvents);
  processShipEvents(parsed, existing, patch);
  processKBEvents(parsed, existing, settings, patch);
  processDepotEvents(parsed, existing, patch);
  processCompanionFeedEvents(parsed, existing, settings, patch, extraEvents, deps);
  processDockEvents(parsed, existing, patch, extraEvents, deps);
  processNpcThreat(parsed, extraEvents, deps);

  // Overlay message builders (run AFTER other processors so they see a
  // consistent view of the state — e.g. handleDockedOverlay checks
  // existing.marketSnapshots which may have been updated this tick)
  if (deps.sendOverlay) {
    // FSDJump — show score + distance + active-project market needs
    for (const ev of parsed.fsdJumpEvents) {
      try { handleFSDJumpOverlay(ev, existing, deps); } catch (e) { console.error('[Overlay] FSDJump error:', e && e.message); }
    }
    // CarrierJump resets the scan-state buffer the same way
    for (const ev of parsed.carrierJumpEvents) {
      try { resetScanState(ev.SystemAddress, ev.StarSystem); } catch { /* ignore */ }
    }
    // Docked — FC load / buy-here suggestions for active project
    for (const ev of parsed.dockedEvents) {
      try { handleDockedOverlay(ev, existing, deps); } catch (e) { console.error('[Overlay] Docked error:', e && e.message); }
    }
    // Scan — ringed landable / oxygen / nitrogen / first-footfall pops
    for (const ev of parsed.scanEvents) {
      try { handleScanEventOverlay(ev, existing, deps); } catch (e) { console.error('[Overlay] Scan error:', e && e.message); }
    }
    // FSSAllBodiesFound — async Spansh/journal scoring
    for (const ev of parsed.fssAllBodiesFoundEvents) {
      handleFSSAllBodiesFoundOverlay(ev, existing, deps).catch((e) => {
        console.error('[Overlay] FSSAllBodiesFound error:', e && e.message);
      });
    }
  }

  // FSDTarget (galaxy-map target alert) — async Spansh name check if uncached.
  // Always fires regardless of overlay enable (this is a Companion-only event).
  if (parsed.fsdTargetEvents.length > 0) {
    const latest = parsed.fsdTargetEvents[parsed.fsdTargetEvents.length - 1];
    handleTargetSelectedOverlay(latest, existing, deps).catch((e) => {
      console.error('[Overlay] FSDTarget error:', e && e.message);
    });
  }

  // NavRoute plotted — read NavRoute.json for route stops, broadcast summary
  if (parsed.navRouteEvents.length > 0 && deps.journalDir) {
    try {
      handleNavRoutePlottedOverlay(deps.journalDir, existing, deps);
    } catch (e) {
      console.error('[Overlay] NavRoute error:', e && e.message);
    }
  }

  // !colony chat commands (SendText with `!colony` prefix). Works even when
  // sendOverlay is null — the response may also be broadcast as a Companion
  // SSE event for iPad.
  try {
    processChatCommands(parsed, {
      readState: () => existing,
      sendOverlay: deps.sendOverlay,
      broadcastEvent: deps.broadcastEvent,
    });
  } catch (e) {
    console.error('[Chat] processChatCommands error:', e && e.message);
  }

  if (Object.keys(patch).length > 0) {
    deps.applyStatePatch(patch);
  }
  for (const evt of extraEvents) deps.broadcastEvent(evt);
}

// ===== Position =====

function resolveCoords(ev, existing) {
  if (ev.StarPos) return { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] };
  const sysName = ev.StarSystem || '';
  const known = existing.knownSystems && existing.knownSystems[sysName.toLowerCase()];
  if (known && known.coordinates) return known.coordinates;
  return null;
}

function processPositionEvents(parsed, existing, patch, extraEvents) {
  const updates = [];
  for (const ev of parsed.fsdJumpEvents) {
    updates.push({ source: 'FSDJump', systemName: ev.StarSystem, systemAddress: ev.SystemAddress, coordinates: resolveCoords(ev, existing), timestamp: ev.timestamp });
  }
  for (const ev of parsed.locationEvents) {
    if (!ev.StarSystem || !ev.SystemAddress) continue;
    updates.push({ source: 'Location', systemName: ev.StarSystem, systemAddress: ev.SystemAddress, coordinates: resolveCoords(ev, existing), timestamp: ev.timestamp });
  }
  for (const ev of parsed.carrierJumpEvents) {
    if (!ev.StarSystem || !ev.SystemAddress) continue;
    updates.push({ source: 'CarrierJump', systemName: ev.StarSystem, systemAddress: ev.SystemAddress, coordinates: resolveCoords(ev, existing), timestamp: ev.timestamp });
  }
  for (const ev of parsed.supercruiseExitEvents) {
    if (!ev.StarSystem || !ev.SystemAddress) continue;
    updates.push({ source: 'SupercruiseExit', systemName: ev.StarSystem, systemAddress: ev.SystemAddress, coordinates: resolveCoords(ev, existing), timestamp: ev.timestamp });
  }
  for (const ev of parsed.dockedEvents) {
    if (!ev.StarSystem || !ev.SystemAddress) continue;
    updates.push({ source: 'Docked', systemName: ev.StarSystem, systemAddress: ev.SystemAddress, coordinates: resolveCoords({ StarSystem: ev.StarSystem }, existing), timestamp: ev.timestamp });
  }
  // FSSDiscoveryScan (honk) — you must be in-system to trigger it, so it's a reliable position signal.
  // The event uses SystemName (vs StarSystem on other events).
  for (const ev of parsed.fssDiscoveryScanEvents || []) {
    if (!ev.SystemName || !ev.SystemAddress) continue;
    updates.push({ source: 'FSSDiscoveryScan', systemName: ev.SystemName, systemAddress: ev.SystemAddress, coordinates: resolveCoords({ StarSystem: ev.SystemName }, existing), timestamp: ev.timestamp });
  }

  if (updates.length === 0) return;
  updates.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = updates[updates.length - 1];
  const current = existing.commanderPosition || {};
  if (current.systemAddress === latest.systemAddress && current.source === latest.source && current.updatedAt === latest.timestamp) return;
  const positionRecord = {
    systemName: latest.systemName,
    systemAddress: latest.systemAddress,
    coordinates: latest.coordinates,
    source: latest.source,
    updatedAt: latest.timestamp,
  };
  patch.commanderPosition = positionRecord;
  extraEvents.push({ type: 'commander_position', position: positionRecord, timestamp: new Date().toISOString() });
}

// ===== Ship + cargo capacity =====

function processShipEvents(parsed, existing, patch) {
  const settings = existing.settings || {};
  if (parsed.loadoutEvents.length > 0) {
    const latest = parsed.loadoutEvents[parsed.loadoutEvents.length - 1];
    if (latest.ShipID != null) {
      patch.currentShip = {
        shipId: latest.ShipID,
        type: latest.Ship || '',
        name: latest.ShipName,
        ident: latest.ShipIdent,
        cargoCapacity: latest.CargoCapacity,
      };
    }
    if (latest.CargoCapacity && latest.CargoCapacity > 0 && !settings.cargoCapacityManual) {
      if (latest.CargoCapacity !== settings.cargoCapacity) {
        patch.settings = Object.assign({}, settings, { cargoCapacity: latest.CargoCapacity });
      }
    }
  }
  if (parsed.shipyardSwapEvents.length > 0) {
    const sw = parsed.shipyardSwapEvents[parsed.shipyardSwapEvents.length - 1];
    if (sw.ShipID != null && sw.ShipType) {
      patch.currentShip = { shipId: sw.ShipID, type: sw.ShipType };
    }
  }
}

// ===== Knowledge base =====

function processKBEvents(parsed, existing, settings, patch) {
  const hasKB =
    parsed.dockedEvents.length > 0 ||
    parsed.locationEvents.length > 0 ||
    parsed.fsdJumpEvents.length > 0 ||
    parsed.fssSignalEvents.length > 0 ||
    parsed.touchdownEvents.length > 0 ||
    parsed.supercruiseEntryEvents.length > 0;
  if (!hasKB) return;

  const kb = extractKnowledgeBaseFromEvents(parsed, {
    myFleetCarrier: settings.myFleetCarrier || '',
    myFleetCarrierMarketId: settings.myFleetCarrierMarketId || null,
    squadronCarrierCallsigns: Array.isArray(settings.squadronCarriers)
      ? settings.squadronCarriers.map((c) => c.callsign).filter(Boolean)
      : [],
  });

  if (kb.systems.length > 0) {
    patch.knownSystems = { __upsert: Object.fromEntries(kb.systems.map((s) => [s.systemName.toLowerCase(), s])) };
  }
  if (kb.stations.length > 0) {
    // CRITICAL: the KB extractor doesn't populate dossier fields (firstDocked,
    // lastDocked, dockedCount, factionHistory, stateHistory, influenceHistory).
    // A bare __upsert here replaces the existing entry and WIPES that history.
    // Merge each kb.station onto the existing entry so dossier fields survive.
    // Any kb fields (name/type/faction/etc.) overwrite existing — only dossier
    // fields are preserved.
    const existingStations = (patch.knownStations && patch.knownStations.__upsert) || {};
    const prior = existing.knownStations || {};
    const upsert = Object.assign({}, existingStations);
    for (const s of kb.stations) {
      const key = String(s.marketId);
      const priorEntry = prior[key];
      if (priorEntry) {
        upsert[key] = Object.assign({}, priorEntry, s, {
          // Preserve dossier explicitly (they'd be undefined on kb entry, but
          // Object.assign would keep priorEntry's values anyway — belt + braces)
          firstDocked: priorEntry.firstDocked,
          lastDocked: priorEntry.lastDocked,
          dockedCount: priorEntry.dockedCount,
          factionHistory: priorEntry.factionHistory,
          stateHistory: priorEntry.stateHistory,
          influenceHistory: priorEntry.influenceHistory,
          // Preserve prior name if the incoming one is a construction placeholder
          stationName: (s.stationName && !/\$EXT_PANEL_ColonisationShip|Construction Site/i.test(s.stationName))
            ? s.stationName
            : (priorEntry.stationName || s.stationName),
        });
      } else {
        upsert[key] = s;
      }
    }
    patch.knownStations = { __upsert: upsert };
  }
  if (Object.keys(kb.systemAddressMap).length > 0) {
    patch.systemAddressMap = { __upsert: kb.systemAddressMap };
  }
  if (kb.fleetCarriers.length > 0) {
    patch.fleetCarriers = {
      __idKey: 'callsign',
      __upsert: Object.fromEntries(kb.fleetCarriers.map((fc) => [fc.callsign, fc])),
    };
  }
  if (kb.bodyVisits.length > 0) {
    patch.bodyVisits = { __upsert: Object.fromEntries(kb.bodyVisits.map((b) => [`${b.systemAddress}|${b.bodyName}`, b])) };
  }
  // fssSignals intentionally skipped here — Sync All rebuilds the authoritative
  // set; incremental appending without a canonical id explodes the array.
}

// ===== Depot progression (active project commodities + auto-complete) =====

function processDepotEvents(parsed, existing, patch) {
  if (parsed.depotEvents.length === 0) return;
  const projects = Array.isArray(existing.projects) ? existing.projects : [];
  if (projects.length === 0) {
    console.log(`[Depot] ${parsed.depotEvents.length} depot event(s) but no projects exist — ignored`);
    return;
  }

  const touched = [];
  const skipped = [];
  for (const depot of parsed.depotEvents) {
    const project = projects.find((p) => p.marketId === depot.MarketID);
    if (!project) {
      skipped.push(`marketId=${depot.MarketID} (no matching project)`);
      continue;
    }
    if (project.status !== 'active') {
      skipped.push(`marketId=${depot.MarketID} project=${project.id} status=${project.status}`);
      continue;
    }

    const commodities = (depot.ResourcesRequired || []).map(resourceToCommodity);
    const next = Object.assign({}, project, { commodities, lastUpdatedAt: new Date().toISOString() });

    if (depot.ConstructionComplete) {
      next.status = 'completed';
      next.completedAt = depot.timestamp || new Date().toISOString();
      const resolved = existing.knownStations && existing.knownStations[depot.MarketID];
      if (resolved && !isConstructionStationName(resolved.stationName)
          && !isColonisationShip(resolved.stationName, resolved.stationType)) {
        next.completedStationName = resolved.stationName;
        next.completedStationType = resolved.stationType || project.stationType || 'Outpost';
      }
    }
    touched.push(next);
  }

  if (touched.length > 0) {
    console.log(`[Depot] Updated ${touched.length} project(s) from journal: ${touched.map((p) => `${p.id}(${p.commodities.length}commodities)`).join(', ')}`);
  }
  if (skipped.length > 0) {
    console.log(`[Depot] Skipped ${skipped.length}: ${skipped.join('; ')}`);
  }

  if (touched.length === 0) return;
  patch.projects = {
    __idKey: 'id',
    __upsert: Object.fromEntries(touched.map((p) => [p.id, p])),
  };
}

// ===== Carrier-cargo backfill — fix broken $xxx_name; commodity IDs =====
//
// Server-side commodity dictionary was missing 27 entries until 2026-04-27, which
// meant any FC items captured during that window stored the raw journal name
// ($emergencypowercells_name;) as the commodityId instead of the canonical id
// (emergencypowercells). Project tracker matches by canonical id so those items
// appeared as "need to buy" even though the FC had stock.
//
// This walks every carrierCargo entry on each pollCompanionFiles tick (cheap —
// ~10 carriers × ~30 items each) and rewrites broken IDs using the now-complete
// dictionary. Idempotent: items already on canonical IDs pass through unchanged.

function backfillCarrierCargoIds(carrierCargo) {
  const upserts = {};
  let itemsFixed = 0;
  for (const callsign of Object.keys(carrierCargo)) {
    const entry = carrierCargo[callsign];
    if (!entry || !Array.isArray(entry.items)) continue;
    let changed = false;
    const items = entry.items.map((it) => {
      const id = String(it.commodityId || '');
      // Match raw journal format like '$emergencypowercells_name;'
      if (!/^\$[a-z0-9]+_name;$/i.test(id)) return it;
      const def = findCommodityByJournalName(id);
      if (!def) return it; // still unknown — leave as-is
      changed = true;
      itemsFixed++;
      return { ...it, commodityId: def.id, name: def.name };
    });
    if (changed) {
      upserts[callsign] = { ...entry, items };
    }
  }
  return { changed: Object.keys(upserts).length > 0, upserts, itemsFixed };
}

// ===== Companion feed SSE + state writes (non-overlay) =====

function processCompanionFeedEvents(parsed, existing, settings, patch, extraEvents, deps) {
  // FSD jump broadcast (separate from the `commander_position` event which has
  // different payload shape — the Companion feed listens for `fsd_jump` for the
  // "Jumped to X" list item).
  for (const ev of parsed.fsdJumpEvents) {
    extraEvents.push({
      type: 'fsd_jump',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      population: ev.Population,
      starPos: ev.StarPos,
      timestamp: new Date().toISOString(),
    });
  }

  // Carrier jump (completed) — same event shape, plus clear any pending countdown
  for (const ev of parsed.carrierJumpEvents) {
    if (!ev.StarSystem) continue;
    extraEvents.push({
      type: 'fsd_jump',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      population: 0,
      timestamp: new Date().toISOString(),
    });
    patch.carrierJumpCountdown = null;
  }

  // CarrierJumpRequest — start countdown
  for (const ev of parsed.carrierJumpRequestEvents) {
    patch.carrierJumpCountdown = {
      destination: ev.SystemName,
      departureTime: ev.DepartureTime,
      systemAddress: ev.SystemAddress,
    };
    extraEvents.push({
      type: 'fc_jump_scheduled',
      destination: ev.SystemName,
      departureTime: ev.DepartureTime,
      timestamp: new Date().toISOString(),
    });
  }

  // CarrierJumpCancelled — clear countdown
  if (parsed.carrierJumpCancelledEvents.length > 0) {
    patch.carrierJumpCountdown = null;
    extraEvents.push({ type: 'fc_jump_cancelled', timestamp: new Date().toISOString() });
  }

  // CarrierStats — FC space usage
  for (const ev of parsed.carrierStatsEvents) {
    if (!ev.Callsign) continue;
    const usage = ev.SpaceUsage;
    if (!usage || typeof usage.FreeSpace !== 'number') continue;
    const entry = {
      totalCapacity: usage.TotalCapacity,
      cargo: usage.Cargo,
      freeSpace: usage.FreeSpace,
      updatedAt: new Date().toISOString(),
    };
    // fleetCarrierSpaceUsage is a map keyed by callsign (merge strategy: 'map')
    if (!patch.fleetCarrierSpaceUsage) patch.fleetCarrierSpaceUsage = { __upsert: {} };
    patch.fleetCarrierSpaceUsage.__upsert[ev.Callsign] = entry;
    extraEvents.push({
      type: 'fc_space_update',
      callsign: ev.Callsign,
      totalCapacity: usage.TotalCapacity,
      cargo: usage.Cargo,
      freeSpace: usage.FreeSpace,
      timestamp: new Date().toISOString(),
    });
  }

  // ColonisationContribution — broadcast progress for Companion feed
  for (const ev of parsed.contributionEvents) {
    const contributions = ev.Contributions || [];
    const legacyItems = ev.Commodities || [];
    const items = contributions.length > 0
      ? contributions.map((c) => ({ name: c.Name_Localised || c.Name, count: c.Amount }))
      : legacyItems.map((c) => ({ name: c.Name_Localised || c.Name, count: c.Count }));
    const summary = items.map((c) => `${c.name} x${c.count}`).join(', ');
    const totalCount = items.reduce((sum, c) => sum + c.count, 0);
    extraEvents.push({
      type: 'contribution',
      commodity: summary || 'commodities',
      amount: totalCount || ev.Contribution || 0,
      system: ev.StarSystem,
      timestamp: new Date().toISOString(),
    });
  }

  // SupercruiseDestinationDrop — companion "arrived at X" note
  for (const ev of parsed.supercruiseDestDropEvents) {
    extraEvents.push({
      type: 'sc_drop',
      station: ev.Type_Localised || ev.Type,
      marketId: ev.MarketID,
      timestamp: new Date().toISOString(),
    });
  }

  // SupercruiseExit — set currentBody (for System View "you are here"), broadcast
  for (const ev of parsed.supercruiseExitEvents) {
    if (!ev.SystemAddress) continue;
    let bodyName = ev.Body;
    let bodyId = ev.BodyID;
    if (ev.BodyType === 'Station') {
      // Resolve station → its orbit body for System View marker positioning
      const stations = existing.knownStations || {};
      const match = Object.values(stations).find(
        (s) => s && s.stationName === ev.Body && s.systemAddress === ev.SystemAddress,
      );
      if (match && match.body) {
        bodyName = match.body;
        bodyId = -1;
      }
    }
    patch.currentBody = {
      systemAddress: ev.SystemAddress,
      bodyId,
      bodyName,
      bodyType: ev.BodyType,
      at: ev.timestamp,
    };
    extraEvents.push({
      type: 'supercruise_exit',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      body: ev.Body,
      bodyResolved: bodyName,
      bodyId,
      bodyType: ev.BodyType,
      timestamp: new Date().toISOString(),
    });
  }

  // SupercruiseEntry / Undocked / FSDJump — clear currentBody
  if (parsed.supercruiseEntryEvents.length > 0 || parsed.undockedEvents.length > 0 || parsed.fsdJumpEvents.length > 0) {
    // Only emit the clear if we have one to clear. Avoid noisy writes.
    if (existing.currentBody && patch.currentBody === undefined) {
      patch.currentBody = null;
    } else if (patch.currentBody !== undefined && parsed.fsdJumpEvents.length > 0) {
      // FSDJump during the same tick — clear regardless of anything we just set
      patch.currentBody = null;
    }
  }

  // Scan events — Companion highlights (rings, atmosphere) + first-footfall ops
  for (const ev of parsed.scanEvents) {
    if (ev.Landable && (ev.Atmosphere || (ev.Rings && ev.Rings.length))) {
      extraEvents.push({
        type: 'scan_highlight',
        body: ev.BodyName,
        hasRings: !!(ev.Rings && ev.Rings.length),
        atmosphere: ev.Atmosphere || '',
        timestamp: new Date().toISOString(),
      });
    }
    if (ev.Landable && ev.WasDiscovered === true && ev.WasFootfalled === false && ev.DistanceFromArrivalLS != null && ev.DistanceFromArrivalLS < 60000) {
      const distLabel = ev.DistanceFromArrivalLS < 10
        ? `${ev.DistanceFromArrivalLS.toFixed(1)} Ls`
        : `${Math.round(ev.DistanceFromArrivalLS).toLocaleString()} Ls`;
      extraEvents.push({
        type: 'first_footfall',
        body: ev.BodyName,
        distance: distLabel,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // FSSAllBodiesFound — Companion "system complete" note
  for (const ev of parsed.fssAllBodiesFoundEvents) {
    extraEvents.push({
      type: 'fss_complete',
      system: ev.SystemName,
      bodyCount: ev.Count,
      timestamp: new Date().toISOString(),
    });
  }

  // NavRouteClear
  if (parsed.navRouteClearEvents.length > 0) {
    extraEvents.push({ type: 'nav_route_cleared', timestamp: new Date().toISOString() });
  }
}

// ===== Dock events (Docked / DockingGranted) — dossier tracking + welcome overlay =====

function processDockEvents(parsed, existing, patch, extraEvents, deps) {
  // DockingGranted → welcome overlay BEFORE Docked (fires at approach)
  for (const ev of parsed.dockingGrantedEvents) {
    if (!ev.MarketID) continue;
    if (isEphemeralStation(ev.StationName, ev.StationType, ev.MarketID)) continue;
    handleDockingGranted(ev, existing, extraEvents, deps);
  }

  // Docked — update commanderPosition already handled in processPositionEvents.
  // Here we persist the dock to the dossier (recordStationDock equivalent),
  // broadcast a `docked` Companion event.
  for (const ev of parsed.dockedEvents) {
    // Register Fleet Carriers in the runtime FC registry so isFleetCarrier()
    // can identify them by MarketID without the broken 3.7B threshold guess.
    // StationType from Docked is authoritative.
    if (ev.StationType === 'FleetCarrier' && typeof ev.MarketID === 'number') {
      registerFcMarketId(ev.MarketID);
    }
    extraEvents.push({
      type: 'docked',
      station: ev.StationName,
      system: ev.StarSystem,
      stationType: ev.StationType,
      marketId: ev.MarketID,
      timestamp: new Date().toISOString(),
    });
    // Count docks by MarketID across the full lifecycle — construction-site
    // and colonisation-ship phases accumulate against the eventual station's
    // MarketID. Only skip permanent ephemerals (FCs, Trailblazer NPCs).
    if (!isPermanentlyEphemeral(ev.StationName, ev.StationType, ev.MarketID)) {
      applyDockToStationPatch(patch, existing, ev.MarketID, {
        stationName: ev.StationName,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        timestamp: ev.timestamp,
        faction: ev.StationFaction && ev.StationFaction.Name,
        factionState: ev.StationFaction && ev.StationFaction.FactionState,
        services: Array.isArray(ev.StationServices) ? ev.StationServices.slice() : null,
        economies: Array.isArray(ev.StationEconomies) ? ev.StationEconomies.map((e) => ({
          name: e.Name_Localised || e.Name || '',
          proportion: typeof e.Proportion === 'number' ? e.Proportion : 0,
        })) : null,
        primaryEconomy: ev.StationEconomy_Localised || null,
        government: ev.StationGovernment_Localised || null,
        allegiance: ev.StationAllegiance || null,
      });
      // Bottom-stack overlay banner (services / economy / established-by-you)
      // fires AFTER welcome (DockingGranted) so we have ev.StationServices etc.
      try { renderDockInfoBanner(ev, existing, deps); } catch (e) { console.error('[Overlay] DockInfoBanner error:', e && e.message); }
    }
  }
}

// ===== Dock info banner (services / economy / established-by-you) =====
//
// Fires on Docked, BELOW the DockingGranted welcome stack. Welcome owns slots 0-5
// at Y_DOCK..Y_DOCK+5*LINE_HEIGHT; this banner uses slots 6/7/8.
// Three lines, all conditional:
//   slot 6: Economy — "🏭 High Tech / Tourism (mixed)"
//   slot 7: Services — "🗺 Cartographics · 💸 Factors · 🔧 Tech Broker · ⚫ Black Market"
//   slot 8: Established — "🛠 You established this on 2026-03-15 (42 days ago)"

const NOTEWORTHY_SERVICES = [
  // Order = display order. Values that are ubiquitous (dock, refuel, commodities,
  // contacts, repair, missions, outfitting, shipyard, engineer, registeringcolonisation,
  // stationoperations, flightcontroller, crewlounge, socialspace, etc.) are NOT here.
  // Search & Rescue dropped per user — not used. Colonisation contact dropped — too common.
  // Vista Genomics dropped — most major stations have it, not a useful guide.
  { key: 'exploration',      label: '🗺 Cartographics' },
  { key: 'facilitator',      label: '💸 Factors' },
  { key: 'techBroker',       label: '🔧 Tech Broker' },
  { key: 'materialtrader',   label: '🧪 Material Trader' }, // type filled in dynamically from economy
  { key: 'blackmarket',      label: '⚫ Black Market' },
];

// Heuristic: ED's Material Trader specialisation is keyed off the system's primary economy.
// Mapping per the community-documented ruleset (approximate — FDev occasionally tweaks).
function materialTraderType(primaryEconomy) {
  const e = (primaryEconomy || '').toLowerCase();
  if (e === 'industrial') return 'Manufactured';
  if (e === 'extraction' || e === 'refinery') return 'Raw';
  if (e === 'high tech' || e === 'military') return 'Encoded';
  return null; // unknown — fall back to generic label
}

const ECONOMY_EMOJI = {
  'Agriculture': '🌾',
  'Extraction':  '⛏',
  'Industrial':  '🏭',
  'High Tech':   '💻',
  'Refinery':    '🔥',
  'Service':     '🛠',
  'Tourism':     '🎢',
  'Military':    '⚔',
  'Colony':      '🏗',
  'Terraforming':'🌍',
  'Damaged':     '🛡',
  'Rescue':      '🆘',
  'Repair':      '🔧',
  'Prison':      '⛓',
  'Private Enterprise': '', // FC — skip below
};

/**
 * DockingGranted variant — uses cached dossier data (services/economies persisted
 * from previous Docked visit) since DockingGranted itself only carries name/type/marketId.
 * First-visit stations have nothing to show here; the Docked-time refresh fills it in.
 */
function renderDockInfoBannerFromDossier(station, ev, existing, deps) {
  if (!deps.sendOverlay) return;
  const settings = (existing && existing.settings) || {};
  if (settings.overlayEnabled === false) return;
  if (!station) return; // first visit — wait for Docked

  const LINE_HEIGHT = 26;
  const slotY = (i) => Y_DOCK + i * LINE_HEIGHT;
  const TTL = 12;

  // Reconstruct ev-shape data from dossier so existing format helpers work
  const cachedEcons = Array.isArray(station.economies)
    ? station.economies.map((e) => ({ Name_Localised: e.name, Proportion: e.proportion }))
    : [];
  const econLine = formatEconomyLine(station.primaryEconomy || (cachedEcons[0] && cachedEcons[0].Name_Localised) || null, cachedEcons);
  const services = Array.isArray(station.services) ? station.services : [];
  const serviceLine = formatServicesLine(services, station.primaryEconomy);
  const establishedLine = formatEstablishedLine({ MarketID: ev.MarketID, StationName: ev.StationName }, existing);

  if (econLine) {
    deps.sendOverlay({ id: 'edcolony_dock_econ', text: econLine, color: '#fbbf24', x: X_LEFT, y: slotY(6), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_econ', text: '', color: '#ffffff', x: X_LEFT, y: slotY(6), ttl: 1 });
  }
  if (serviceLine) {
    deps.sendOverlay({ id: 'edcolony_dock_svc', text: serviceLine, color: '#7fd7ff', x: X_LEFT, y: slotY(7), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_svc', text: '', color: '#ffffff', x: X_LEFT, y: slotY(7), ttl: 1 });
  }
  if (establishedLine) {
    deps.sendOverlay({ id: 'edcolony_dock_built', text: establishedLine, color: '#86efac', x: X_LEFT, y: slotY(8), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_built', text: '', color: '#ffffff', x: X_LEFT, y: slotY(8), ttl: 1 });
  }
}

function renderDockInfoBanner(ev, existing, deps) {
  if (!deps.sendOverlay) return;
  const settings = (existing && existing.settings) || {};
  if (settings.overlayEnabled === false) return;

  const LINE_HEIGHT = 26;
  const slotY = (i) => Y_DOCK + i * LINE_HEIGHT;
  const TTL = 12;

  // --- slot 6: Economy ---
  const econs = Array.isArray(ev.StationEconomies) ? ev.StationEconomies : [];
  const econLine = formatEconomyLine(ev.StationEconomy_Localised, econs);
  if (econLine) {
    deps.sendOverlay({ id: 'edcolony_dock_econ', text: econLine, color: '#fbbf24', x: X_LEFT, y: slotY(6), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_econ', text: '', color: '#ffffff', x: X_LEFT, y: slotY(6), ttl: 1 });
  }

  // --- slot 7: Noteworthy services ---
  const services = Array.isArray(ev.StationServices) ? ev.StationServices : [];
  const serviceLine = formatServicesLine(services, ev.StationEconomy_Localised);
  if (serviceLine) {
    deps.sendOverlay({ id: 'edcolony_dock_svc', text: serviceLine, color: '#7fd7ff', x: X_LEFT, y: slotY(7), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_svc', text: '', color: '#ffffff', x: X_LEFT, y: slotY(7), ttl: 1 });
  }

  // --- slot 8: Established by you (if a completed project matches this MarketID) ---
  const establishedLine = formatEstablishedLine(ev, existing);
  if (establishedLine) {
    deps.sendOverlay({ id: 'edcolony_dock_built', text: establishedLine, color: '#86efac', x: X_LEFT, y: slotY(8), ttl: TTL });
  } else {
    deps.sendOverlay({ id: 'edcolony_dock_built', text: '', color: '#ffffff', x: X_LEFT, y: slotY(8), ttl: 1 });
  }
}

function formatEconomyLine(primaryLocalised, economies) {
  if (!primaryLocalised) return '';
  // FC/Carrier — "Private Enterprise" — always the same, useless. Skip.
  if (primaryLocalised === 'Private Enterprise') return '';
  // Sort by proportion desc, take top 2 if both >= 0.3
  const sorted = (economies || []).slice().sort((a, b) => (b.Proportion || 0) - (a.Proportion || 0));
  const top = sorted[0];
  const second = sorted[1];
  const topName = (top && (top.Name_Localised || top.Name)) || primaryLocalised;
  const topEmoji = ECONOMY_EMOJI[topName] || '';
  if (second && (second.Proportion || 0) >= 0.3) {
    const secName = second.Name_Localised || second.Name || '';
    const secEmoji = ECONOMY_EMOJI[secName] || '';
    return `${topEmoji ? topEmoji + ' ' : ''}${topName} · ${secEmoji ? secEmoji + ' ' : ''}${secName} (mixed)`;
  }
  return `${topEmoji ? topEmoji + ' ' : ''}${topName}`;
}

function formatServicesLine(services, primaryEconomy) {
  if (!services || services.length === 0) return '';
  const present = NOTEWORTHY_SERVICES.filter((s) => services.includes(s.key));
  if (present.length === 0) return '';
  return present.map((s) => {
    if (s.key === 'materialtrader') {
      const type = materialTraderType(primaryEconomy);
      return type ? `🧪 ${type} Materials` : s.label;
    }
    return s.label;
  }).join(' · ');
}

function formatEstablishedLine(ev, existing) {
  const projects = Array.isArray(existing && existing.projects) ? existing.projects : [];
  // Match either by current MarketID (preserved across construction → finished station)
  // or by station name on completed-station fields.
  const match = projects.find((p) =>
    p && p.status === 'completed' && (
      p.marketId === ev.MarketID ||
      (p.completedStationName && ev.StationName && p.completedStationName === ev.StationName)
    ));
  if (!match || !match.completedAt) return '';
  const completedAt = new Date(match.completedAt);
  if (isNaN(completedAt.getTime())) return '';
  const days = Math.max(0, Math.floor((Date.now() - completedAt.getTime()) / 86400000));
  const dateStr = completedAt.toISOString().slice(0, 10);
  let ago;
  if (days === 0) ago = 'today';
  else if (days === 1) ago = 'yesterday';
  else if (days < 30) ago = `${days} days ago`;
  else if (days < 365) ago = `${Math.floor(days / 30)} months ago`;
  else ago = `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}mo ago`;
  return `🛠 You established this on ${dateStr} (${ago})`;
}

/**
 * Server-side port of src/store/index.ts recordStationDock. Mutates `patch`
 * in-place to include a knownStations upsert for the dock. No summary returned
 * — DockingGranted handles the welcome overlay separately (and fires earlier).
 */
function applyDockToStationPatch(patch, existing, marketId, payload) {
  const knownStations = existing.knownStations || {};
  const existingSt = knownStations[marketId];
  const now = payload.timestamp;

  // De-dupe guard: same exact timestamp already recorded = same event re-processed.
  if (existingSt && existingSt.lastDocked === now && (existingSt.dockedCount || 0) > 0) return;

  const prevDockedCount = (existingSt && existingSt.dockedCount) || 0;
  const newDockedCount = prevDockedCount + 1;

  const prevFaction = (existingSt && existingSt.faction) || null;
  const currentFaction = payload.faction != null ? payload.faction : prevFaction;
  const factionChanged = !!(prevFaction && payload.faction && prevFaction !== payload.faction);

  const prevState = (existingSt && existingSt.factionState) || null;
  const currentState = payload.factionState != null ? payload.factionState : prevState;
  const stateChanged = !!(prevState && payload.factionState && prevState !== payload.factionState);

  const newFactionHistory = [...((existingSt && existingSt.factionHistory) || [])];
  if (factionChanged && prevFaction) {
    newFactionHistory.push({ name: prevFaction, changedAt: now });
    if (newFactionHistory.length > 5) newFactionHistory.shift();
  }
  const newStateHistory = [...((existingSt && existingSt.stateHistory) || [])];
  if (stateChanged && payload.factionState) {
    newStateHistory.push({ state: payload.factionState, changedAt: now });
    if (newStateHistory.length > DOCK_HISTORY_CAP) newStateHistory.shift();
  }

  const base = existingSt || {
    stationName: payload.stationName,
    stationType: '',
    marketId,
    systemName: payload.systemName,
    systemAddress: payload.systemAddress,
    distFromStarLS: null,
    landingPads: null,
    economies: [],
    services: [],
    lastSeen: now,
  };
  const updated = Object.assign({}, base, {
    stationName: (payload.stationName && !/\$EXT_PANEL_ColonisationShip|Construction Site/i.test(payload.stationName))
      ? payload.stationName
      : base.stationName,
    systemName: payload.systemName || base.systemName,
    systemAddress: payload.systemAddress || base.systemAddress,
    firstDocked: base.firstDocked || now,
    lastDocked: now,
    dockedCount: newDockedCount,
    faction: currentFaction,
    factionState: currentState,
    factionHistory: newFactionHistory,
    stateHistory: newStateHistory,
    // Always overwrite services/economies with the latest dock — game state wins
    // over any stale cached value. Only overwrite when payload supplied them
    // (Docked has them, FSS-only KB events do not).
    services: Array.isArray(payload.services) ? payload.services : base.services,
    economies: Array.isArray(payload.economies) ? payload.economies : base.economies,
    primaryEconomy: payload.primaryEconomy != null ? payload.primaryEconomy : (base.primaryEconomy || null),
    government: payload.government != null ? payload.government : (base.government || null),
    allegiance: payload.allegiance != null ? payload.allegiance : (base.allegiance || null),
    lastSeen: now,
  });

  // Merge into any knownStations upsert already in patch (processKBEvents may have
  // created one earlier this tick)
  const currentUpsert = (patch.knownStations && patch.knownStations.__upsert) || {};
  patch.knownStations = {
    __upsert: Object.assign({}, currentUpsert, { [String(marketId)]: updated }),
  };
}

/**
 * DockingGranted welcome: compute the pre-increment summary (dockedCount+1)
 * and render it as a stacked overlay + companion SSE banner.
 */
function handleDockingGranted(ev, existing, extraEvents, deps) {
  const now = Date.now();
  const last = lastDockGrantAt.get(ev.MarketID);
  if (last && now - last < DOCK_GRANT_SUPPRESSION_MS) return;
  lastDockGrantAt.set(ev.MarketID, now);

  const station = (existing.knownStations || {})[ev.MarketID];
  if (!station) return; // No dossier yet — Docked will create one; Welcome skipped

  const aboutToBe = (station.dockedCount || 0) + 1;
  const counts = Object.values(existing.knownStations || {})
    .map((s) => (s && s.dockedCount) || 0)
    .filter((c) => c > 0);
  const higherOrEqual = counts.filter((c) => c >= aboutToBe).length;
  const rankRaw = higherOrEqual + 1;
  const rank = rankRaw <= 20 ? rankRaw : null;
  const milestone = DOCK_MILESTONES.includes(aboutToBe) ? aboutToBe : null;

  const summary = {
    marketId: ev.MarketID,
    stationName: ev.StationName || station.stationName,
    systemName: station.systemName,
    isFirstVisit: !station.firstDocked,
    dockedCount: aboutToBe,
    milestone,
    anniversary: null,
    factionChanged: false,
    previousFaction: null,
    currentFaction: station.faction || null,
    stateChanged: false,
    previousState: null,
    currentState: station.factionState || null,
    influenceDelta: null,
    currentInfluence: null,
    rank,
  };

  renderDockWelcomeOverlay(summary, station, deps);
  // Bottom-stack info banner from CACHED dossier — fires on DockingGranted so
  // the player sees economy/services/established info before they've actually
  // landed. Refreshed on Docked with live ev data in case anything changed.
  try {
    renderDockInfoBannerFromDossier(station, ev, existing, deps);
  } catch (e) {
    console.error('[Overlay] DockInfoBanner (DockingGranted) error:', e && e.message);
  }
  extraEvents.push({
    type: 'station_dock_summary',
    marketId: summary.marketId,
    station: summary.stationName,
    system: summary.systemName,
    dockedCount: summary.dockedCount,
    isFirstVisit: summary.isFirstVisit,
    milestone,
    anniversary: null,
    factionChanged: false,
    previousFaction: null,
    currentFaction: summary.currentFaction,
    stateChanged: false,
    previousState: null,
    currentState: summary.currentState,
    landingPad: ev.LandingPad,
    trigger: 'docking_granted',
    rank,
    timestamp: new Date().toISOString(),
  });
}

function ord(n) {
  if (n >= 11 && n <= 13) return `${n}th`;
  const s = n % 10;
  return s === 1 ? `${n}st` : s === 2 ? `${n}nd` : s === 3 ? `${n}rd` : `${n}th`;
}

/** Port of handleStationDockSummary from overlayService.ts — line-stacked welcome. */
function renderDockWelcomeOverlay(summary, station, deps) {
  if (!deps.sendOverlay) return;
  const firstDocked = station && station.firstDocked;

  let historyLabel = '';
  if (firstDocked) {
    const days = Math.floor((Date.now() - new Date(firstDocked).getTime()) / 86400000);
    if (days >= 365) historyLabel = `${Math.floor(days / 365)}y of history`;
    else if (days >= 60) historyLabel = `${Math.floor(days / 30)} months of history`;
    else if (days >= 14) historyLabel = `${Math.floor(days / 7)} weeks of history`;
    else if (days >= 1) historyLabel = `${days}d of history`;
  }

  const lines = [];
  if (summary.isFirstVisit) {
    lines.push({ text: `✨ First time at ${summary.stationName} — welcome!`, color: '#fcd34d' });
  } else if (summary.milestone && summary.milestone >= 10) {
    lines.push({ text: `🏆 ${summary.milestone}-VISIT MILESTONE — ${summary.stationName}`, color: '#fcd34d' });
  } else {
    const rankBadge = summary.rank ? ` · #${summary.rank} most-visited` : '';
    lines.push({
      text: `🏛 Welcome back to ${summary.stationName} — ${ord(summary.dockedCount)} visit${rankBadge}`,
      color: summary.rank && summary.rank <= 3 ? '#fcd34d' : '#93c5fd',
    });
  }

  if (historyLabel && !summary.isFirstVisit) {
    lines.push({ text: `📅 ${historyLabel}`, color: '#94a3b8' });
  }

  if (summary.factionChanged && summary.previousFaction && summary.currentFaction) {
    lines.push({ text: `⚠ Power shift: ${summary.currentFaction} has taken control`, color: '#f87171' });
    lines.push({ text: `   (${summary.previousFaction} ran this place during your last visit)`, color: '#94a3b8' });
  }

  const state = summary.currentState;
  if (state && state !== 'None') {
    const style = STATE_STYLES[state] || { emoji: '⚡', color: '#94a3b8', label: state };
    if (summary.stateChanged && summary.previousState) {
      lines.push({ text: `${style.emoji} Now ${style.label} — was ${summary.previousState} last visit`, color: style.color });
    } else if (!summary.factionChanged) {
      lines.push({
        text: `${style.emoji} ${style.label}${summary.currentFaction ? ` — ${summary.currentFaction}` : ''}`,
        color: style.color,
      });
    }
  }

  const LINE_HEIGHT = 26;
  const MAX_LINES = 6;
  for (let i = 0; i < MAX_LINES; i++) {
    const id = `edcolony_dock_welcome_${i}`;
    if (i < lines.length) {
      deps.sendOverlay({ id, text: lines[i].text, color: lines[i].color, x: X_LEFT, y: Y_DOCK + i * LINE_HEIGHT, ttl: 12 });
    } else {
      // Clear stale slots from a previous dock that had more lines
      deps.sendOverlay({ id, text: '', color: '#ffffff', x: X_LEFT, y: Y_DOCK + i * LINE_HEIGHT, ttl: 1 });
    }
  }
}

// ===== NPC threat =====

function processNpcThreat(parsed, extraEvents, deps) {
  for (const ev of parsed.receiveTextEvents) {
    if (ev.Channel !== 'npc') continue;
    const msg = ev.Message || '';
    const isPirate = /^\$Pirate_/i.test(msg);
    const isInterdictor = /^\$InterdictorNPC_/i.test(msg) || /^\$NPC_.*Interdict/i.test(msg);
    const isDemand = /^\$.*_OnStartScanCargo|^\$.*_Stop_|^\$.*_Attack_/i.test(msg);
    if (!isPirate && !isInterdictor && !isDemand) continue;

    const fromName = ev.From_Localised || ev.From;
    const messageText = ev.Message_Localised || ev.Message;

    if (deps.sendOverlay) {
      deps.sendOverlay({
        id: 'edcolony_npc_threat',
        text: `🚨 ${fromName}: "${messageText}"`,
        color: '#f87171',
        x: X_LEFT,
        y: Y_THREAT,
        ttl: 10,
      });
    }
    extraEvents.push({
      type: 'npc_threat',
      from: fromName,
      message: messageText,
      channel: ev.Channel,
      threatClass: isPirate ? 'pirate' : isInterdictor ? 'interdictor' : 'demand',
      timestamp: new Date().toISOString(),
    });
  }
}

// ===== Companion files (Cargo.json / Market.json) =====
// (Unchanged — runs on the watcher's 5s companion cadence.)

export function pollCompanionFiles(journalDir, deps) {
  const { readState, applyStatePatch, broadcastEvent } = deps;
  const patch = {};
  const extra = [];

  const existing = readState();
  const settings = existing.settings || {};

  // Backfill: walk all existing carrierCargo entries and rewrite any broken
  // commodityIds in raw journal format ($xxx_name;) to canonical IDs. Required
  // because the server-side commodities dictionary was missing 27 entries until
  // now — items captured during that window stored the raw name as the ID.
  const carrierCargoFix = backfillCarrierCargoIds(existing.carrierCargo || {});
  if (carrierCargoFix.changed) {
    patch.carrierCargo = { __upsert: carrierCargoFix.upserts };
    console.log(`[CarrierCargo] Backfill normalised IDs for ${Object.keys(carrierCargoFix.upserts).length} carrier(s) (${carrierCargoFix.itemsFixed} items)`);
  }

  const shipCargo = readShipCargo(journalDir);
  if (shipCargo) {
    extra.push({ type: 'ship_cargo', cargo: shipCargo, timestamp: new Date().toISOString() });
  }

  const market = readMarketJson(journalDir);
  if (market && market.marketId) {
    const myCallsign = settings.myFleetCarrier || '';
    const myFcMid = settings.myFleetCarrierMarketId || null;
    const squadronCallsigns = Array.isArray(settings.squadronCarriers)
      ? settings.squadronCarriers.map((c) => c.callsign).filter(Boolean)
      : [];

    let ownerCallsign = null;
    if (myFcMid && market.marketId === myFcMid) ownerCallsign = myCallsign;
    else if (myCallsign && market.stationName === myCallsign) ownerCallsign = myCallsign;
    else if (squadronCallsigns.includes(market.stationName)) ownerCallsign = market.stationName;

    if (ownerCallsign) {
      const items = market.items
        .filter((it) => it.stock > 0)
        .map((it) => {
          const def = findCommodityByDisplayName(it.nameLocalised || it.name)
            || findCommodityByDisplayName(it.name)
            || findCommodityByJournalName(`$${String(it.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
          return {
            commodityId: (def && def.id) || String(it.name || '').toLowerCase(),
            name: it.nameLocalised || (def && def.name) || it.name,
            count: it.stock,
          };
        });
      patch.carrierCargo = {
        __upsert: {
          [ownerCallsign]: {
            items,
            earliestTransfer: market.timestamp,
            latestTransfer: market.timestamp,
            updatedAt: market.timestamp || new Date().toISOString(),
            isEstimate: false,
            carrierCallsign: ownerCallsign,
          },
        },
      };
      outcome = {
        kind: 'fc_cargo',
        callsign: ownerCallsign,
        marketId: market.marketId,
        savedCount: items.length,
        rawItemCount: market.items.length,
      };
      extra.push({
        type: 'carrier_cargo_updated',
        callsign: ownerCallsign,
        marketId: market.marketId,
        itemCount: items.length,
        timestamp: new Date().toISOString(),
      });
      if (deps.sendOverlay) {
        deps.sendOverlay({
          id: 'edcolony_carrier_update',
          text: `FC cargo updated: ${ownerCallsign} — ${items.length} items`,
          color: '#7fd7ff',
          x: 40,
          y: 280,
          ttl: 6,
        });
      }
    } else if (!isEphemeralStation(market.stationName, market.stationType, market.marketId)) {
      // Capture every item Market.json lists (sell-side + buy-side). Fall back to raw
      // Spansh name when commodity isn't in the colonisation dictionary so data isn't lost.
      // Always save the snapshot — even a zero-commodity one preserves station metadata.
      const allCommodities = market.items
        .filter((it) => (it.stock > 0 && it.buyPrice > 0) || (it.demand > 0 && it.sellPrice > 0))
        .map((it) => {
          const def = findCommodityByDisplayName(it.nameLocalised || it.name)
            || findCommodityByDisplayName(it.name)
            || findCommodityByJournalName(`$${String(it.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
          const rawName = it.nameLocalised || it.name || 'unknown';
          return {
            commodityId: (def && def.id) || String(it.name || rawName).toLowerCase().replace(/\s+/g, ''),
            name: (def && def.name) || rawName,
            buyPrice: it.buyPrice,
            stock: it.stock,
            sellPrice: it.sellPrice,
            demand: it.demand,
            category: it.category || '',
          };
        });
      const snapshot = {
        marketId: market.marketId,
        stationName: market.stationName,
        systemName: market.systemName,
        stationType: market.stationType || '',
        isPlanetary: false,
        hasLargePads: false,
        commodities: allCommodities,
        updatedAt: market.timestamp || new Date().toISOString(),
      };
      patch.marketSnapshots = { __upsert: { [String(market.marketId)]: snapshot } };
      extra.push({
        type: 'market_snapshot_updated',
        marketId: market.marketId,
        stationName: market.stationName,
        systemName: market.systemName,
        itemCount: allCommodities.length,
        timestamp: new Date().toISOString(),
      });
      if (deps.sendOverlay) {
        deps.sendOverlay({
          id: 'edcolony_market_update',
          text: `Market captured: ${market.stationName} — ${allCommodities.length} items`,
          color: '#7fff7f',
          x: 40,
          y: 280,
          ttl: 6,
        });
      }
    }
  }

  if (Object.keys(patch).length > 0) applyStatePatch(patch);
  for (const evt of extra) broadcastEvent(evt);
}
