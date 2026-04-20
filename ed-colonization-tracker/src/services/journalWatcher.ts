/**
 * Live journal file watcher using File System Access API polling.
 *
 * After initial journal sync, polls the journal directory every 2 seconds.
 * When the active journal file grows (new events appended by the game),
 * reads only the new bytes, parses the new lines, and dispatches updates
 * to the app store.
 *
 * When a new journal file appears (ED rotates files each session),
 * automatically switches to watching the new file.
 */

import { useAppStore } from '@/store';
import {
  getJournalFolderHandle,
  parseJournalLines,
  extractKnowledgeBaseFromEvents,
  extractExplorationData,
  readShipCargo,
  readMarketJson,
  readMarketSnapshot,
  readNavRouteJson,
  isFleetCarrier,
  isFleetCarrierMarketId,
  isEphemeralStation,
  isColonisationShip,
  isConstructionStationName,
  resourceToCommodity,
} from './journalReader';
import { resolveSystemName } from './spanshApi';
import { findCommodityByJournalName } from '@/data/commodities';
import { handleFSDJump, handleDocked, handleScanEvent, handleFSSAllBodiesFound, handleChatCommand, handleConstructionComplete, handleStationDockSummary, emitNpcThreatOverlay, postCompanionEvent } from './overlayService';

const POLL_INTERVAL_MS = 2000;
const DEBOUNCE_MS = 500;

interface WatchState {
  /** Currently watched file name */
  activeFileName: string | null;
  /** File handle for the active journal */
  activeFileHandle: FileSystemFileHandle | null;
  /** Byte offset — how far we've read into the active file */
  byteOffset: number;
  /** All known journal file names (sorted) */
  knownFiles: string[];
  /** Polling interval ID */
  intervalId: ReturnType<typeof setInterval> | null;
  /** Debounce timer */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Whether currently processing */
  processing: boolean;
  /** Running flag */
  running: boolean;
  /** Last known Cargo.json modification time */
  cargoLastModified: number;
  /** Last known Market.json modification time */
  marketLastModified: number;
  /** Timestamp of last companion file poll */
  companionLastPoll: number;
}

const state: WatchState = {
  activeFileName: null,
  activeFileHandle: null,
  byteOffset: 0,
  knownFiles: [],
  intervalId: null,
  debounceTimer: null,
  processing: false,
  running: false,
  cargoLastModified: 0,
  marketLastModified: 0,
  companionLastPoll: 0,
};

// Accumulated events from incremental reads (used to build KB context)
let accDockedEvents: ReturnType<typeof parseJournalLines>['dockedEvents'] = [];
let accLocationEvents: ReturnType<typeof parseJournalLines>['locationEvents'] = [];

/**
 * Start the journal watcher. Call after initial sync completes.
 * Idempotent — calling when already running is a no-op.
 */
export function startJournalWatcher(): void {
  // Phase B cutover: journal polling is now server-side (server/journal/watcher.js).
  // The server reads new events and broadcasts state_updated SSE + targeted events
  // (commander_position, carrier_cargo_updated, ship_cargo, etc.) to every client.
  // This function is kept as a no-op so existing callers don't break — they all
  // expect it to be idempotent and side-effect-free if there's no folder handle.
  //
  // To roll back: restore the original body (initWatcher + setInterval) and the
  // browser will poll alongside the server. Both writers merge through sparse
  // PATCH, so there's no state corruption, just duplicate work.
  return;
}

/**
 * Stop the journal watcher.
 */
export function stopJournalWatcher(): void {
  state.running = false;
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  state.activeFileName = null;
  state.activeFileHandle = null;
  state.byteOffset = 0;
  state.knownFiles = [];
  state.cargoLastModified = 0;
  state.marketLastModified = 0;
  accDockedEvents = [];
  accLocationEvents = [];
}

/**
 * Whether the watcher is currently running.
 */
export function isWatcherRunning(): boolean {
  return state.running;
}

/**
 * Initialize watcher: find the latest journal file and set byte offset to end of file.
 */
async function initWatcher(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  const files = await getJournalFiles(dirHandle);
  state.knownFiles = files.map((f) => f.name);

  if (files.length === 0) return;

  // Start watching the latest file from its current end
  const latest = files[files.length - 1];
  state.activeFileName = latest.name;
  state.activeFileHandle = latest.handle;

  const file = await latest.handle.getFile();
  state.byteOffset = file.size;

  // Scan the current journal file for the most recent Loadout / ShipyardSwap
  // so `currentShip` is populated at startup. Otherwise the watcher starts
  // from file-end and never sees the Loadout that fires at game login.
  try {
    const text = await file.text();
    const lines = text.split('\n');
    // Walk backwards — stop at first Loadout or ShipyardSwap found
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'Loadout' && ev.ShipID != null) {
          useAppStore.getState().setCurrentShip({
            shipId: ev.ShipID,
            type: ev.Ship,
            name: ev.ShipName,
            ident: ev.ShipIdent,
            cargoCapacity: ev.CargoCapacity,
          });
          break;
        }
        if (ev.event === 'ShipyardSwap' && ev.ShipID != null) {
          useAppStore.getState().setCurrentShip({
            shipId: ev.ShipID,
            type: ev.ShipType,
          });
          break;
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* journal read failed — currentShip stays whatever it was */ }

  // Capture initial timestamps for companion files
  try {
    const cargoHandle = await dirHandle.getFileHandle('Cargo.json');
    const cargoFile = await cargoHandle.getFile();
    state.cargoLastModified = cargoFile.lastModified;
  } catch { /* may not exist yet */ }
  try {
    const marketHandle = await dirHandle.getFileHandle('Market.json');
    const marketFile = await marketHandle.getFile();
    state.marketLastModified = marketFile.lastModified;
  } catch { /* may not exist yet */ }
}

/**
 * Poll: check for new files and new content in the active file.
 */
async function pollJournal(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  if (!state.running || state.processing) return;

  try {
    // Check for new journal files
    const files = await getJournalFiles(dirHandle);
    const fileNames = files.map((f) => f.name);

    // Detect new file (ED started a new session)
    const newFiles = fileNames.filter((n) => !state.knownFiles.includes(n));
    if (newFiles.length > 0) {
      state.knownFiles = fileNames;
      // Switch to the newest file, read from beginning
      const latest = files[files.length - 1];
      if (latest.name !== state.activeFileName) {
        state.activeFileName = latest.name;
        state.activeFileHandle = latest.handle;
        state.byteOffset = 0;
        accDockedEvents = [];
        accLocationEvents = [];
      }
    }

    // Poll companion files (Cargo.json, Market.json) independently of journal changes
    // so ship cargo and market data stay current even when no journal events are written.
    // Throttled to every 5 seconds to avoid excessive filesystem reads.
    const now = Date.now();
    if (now - state.companionLastPoll >= 5000) {
      state.companionLastPoll = now;
      pollCompanionFiles(dirHandle);
    }

    if (!state.activeFileHandle) return;

    // Check if file has grown
    const file = await state.activeFileHandle.getFile();
    if (file.size <= state.byteOffset) return;

    // Debounce: ED writes bursts of events
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => processNewContent(file), DEBOUNCE_MS);
  } catch {
    // Permission revoked or file access error — stop gracefully
  }
}

/**
 * Read and process new bytes from the active journal file.
 */
async function processNewContent(file: File): Promise<void> {
  if (state.processing) return;
  state.processing = true;

  try {
    // Read only the new bytes
    const newBlob = file.slice(state.byteOffset);
    const newText = await newBlob.text();
    state.byteOffset = file.size;

    if (!newText.trim()) return;

    const newLines = newText.split('\n').filter((l) => l.trim());
    if (newLines.length === 0) return;

    // Parse the new lines
    const parsed = parseJournalLines(newLines);

    // Accumulate context events for station resolution
    accDockedEvents.push(...parsed.dockedEvents);
    accLocationEvents.push(...parsed.locationEvents);

    // Process each event type
    try { processKnowledgeUpdates(parsed); } catch (e) { console.error('[Watcher] KB error:', e); }
    try { processDepotUpdates(parsed); } catch (e) { console.error('[Watcher] Depot error:', e); }
    try { processCargoUpdates(parsed); } catch (e) { console.error('[Watcher] Cargo error:', e); }
    try { processExplorationUpdates(parsed); } catch (e) { console.error('[Watcher] Exploration error:', e); }
    try { processOverlayUpdates(parsed); } catch (e) { console.error('[Watcher] Overlay error:', e); }
  } catch (e) {
    console.error('[Watcher] Parse error:', e);
  } finally {
    state.processing = false;
  }
}

/**
 * Update knowledge base (systems, stations) from new events.
 */
function processKnowledgeUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  const store = useAppStore.getState();
  const settings = store.settings;

  // Only process if we have relevant events
  const hasKBEvents =
    parsed.dockedEvents.length > 0 ||
    parsed.locationEvents.length > 0 ||
    parsed.fsdJumpEvents.length > 0 ||
    parsed.fssSignalEvents.length > 0 ||
    parsed.touchdownEvents.length > 0;

  if (!hasKBEvents) return;

  try {
    const kb = extractKnowledgeBaseFromEvents(parsed, {
      myFleetCarrier: settings.myFleetCarrier,
      myFleetCarrierMarketId: settings.myFleetCarrierMarketId,
      squadronCarrierCallsigns: settings.squadronCarrierCallsigns,
    });

    if (kb.systems.length > 0) store.upsertKnownSystems(kb.systems);
    if (kb.stations.length > 0) store.upsertKnownStations(kb.stations);
    if (Object.keys(kb.systemAddressMap).length > 0) store.mapSystemAddresses(kb.systemAddressMap);
    if (kb.fssSignals.length > 0) store.setFSSSignals(kb.fssSignals);
    if (kb.bodyVisits.length > 0) store.upsertBodyVisits(kb.bodyVisits);
    for (const fc of kb.fleetCarriers) {
      store.addFleetCarrier(fc);
    }
  } catch (err) {
    console.error('[JournalWatcher] KB extraction failed:', err);
  }
}

/**
 * Update project progress from new depot/contribution events.
 */
function processDepotUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  if (parsed.depotEvents.length === 0 && parsed.contributionEvents.length === 0) return;

  const store = useAppStore.getState();
  const projects = store.projects;

  // Process depot events (full commodity snapshots)
  for (const depot of parsed.depotEvents) {
    const project = projects.find((p) => p.marketId === depot.MarketID);
    if (!project || project.status !== 'active') continue;

    // Update commodities (use same mapping as full sync to preserve proper IDs)
    const commodities = depot.ResourcesRequired.map(resourceToCommodity);
    store.updateAllCommodities(project.id, commodities);

    // Check for completion
    if (depot.ConstructionComplete) {
      // Try to resolve the real station name from knownStations
      const resolved = store.knownStations[depot.MarketID];
      const stationInfo = resolved && !isConstructionStationName(resolved.stationName) && !isColonisationShip(resolved.stationName, resolved.stationType)
        ? { name: resolved.stationName, type: resolved.stationType || project.stationType || 'Outpost' }
        : undefined;
      store.completeProject(project.id, stationInfo);
      handleConstructionComplete(project.stationName || project.name);
    }
  }

  // Note: ColonisationContribution events only contain what was delivered, not the full
  // resource snapshot. The ConstructionDepot event that follows a contribution contains
  // the full updated snapshot, which is handled above.
}

/**
 * Update cargo/loadout data from new events.
 */
function processCargoUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  // Update cargo capacity from Loadout events (unless user manually set it)
  if (parsed.loadoutEvents.length > 0) {
    const latest = parsed.loadoutEvents[parsed.loadoutEvents.length - 1];
    if (latest.CargoCapacity && latest.CargoCapacity > 0) {
      const store = useAppStore.getState();
      if (!store.settings.cargoCapacityManual && latest.CargoCapacity !== store.settings.cargoCapacity) {
        store.updateSettings({ cargoCapacity: latest.CargoCapacity });
      }
    }
    // Track the active ship so Sources page can show travel-time stats for it.
    if (latest.ShipID != null && latest.Ship) {
      useAppStore.getState().setCurrentShip({
        shipId: latest.ShipID,
        type: latest.Ship,
        name: latest.ShipName,
        ident: latest.ShipIdent,
        cargoCapacity: latest.CargoCapacity,
      });
    }
  }
  // ShipyardSwap also switches the active ship
  if (parsed.shipyardSwapEvents.length > 0) {
    const sw = parsed.shipyardSwapEvents[parsed.shipyardSwapEvents.length - 1];
    if (sw.ShipID != null && sw.ShipType) {
      useAppStore.getState().setCurrentShip({
        shipId: sw.ShipID,
        type: sw.ShipType,
      });
    }
  }
}

/**
 * Update scouting data from new exploration events.
 */
function processExplorationUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  const store = useAppStore.getState();
  const cache = { ...store.journalExplorationCache };
  let cacheChanged = false;

  // FSSDiscoveryScan (honk) — create/update system entry with body count
  for (const ev of parsed.fssDiscoveryScanEvents) {
    const addr = ev.SystemAddress;
    if (!addr) continue;
    if (!cache[addr]) {
      cache[addr] = {
        systemAddress: addr,
        systemName: ev.SystemName || store.systemAddressMap[addr] || `Unknown (${addr})`,
        coordinates: null,
        bodyCount: ev.BodyCount || 0,
        fssAllBodiesFound: false,
        scannedBodies: [],
        lastSeen: ev.timestamp,
      };
      cacheChanged = true;
    } else if (ev.BodyCount && ev.BodyCount > (cache[addr].bodyCount || 0)) {
      cache[addr] = { ...cache[addr], bodyCount: ev.BodyCount, lastSeen: ev.timestamp };
      cacheChanged = true;
    }
  }
  // Honk — schedule a full journal re-parse so we catch the main star AutoScan
  // (and any FSS-scanned bodies) that may have been missed by the incremental poller.
  if (parsed.fssDiscoveryScanEvents.length > 0) {
    scheduleExplorationBackfill();
  }

  // Scan events — add body data to cache in real-time
  for (const ev of parsed.scanEvents) {
    const addr = ev.SystemAddress;
    if (!addr) continue;
    if (ev.PlanetClass === 'Belt Cluster') continue;
    if (!ev.PlanetClass && !ev.StarType) continue;

    if (!cache[addr]) {
      cache[addr] = {
        systemAddress: addr,
        systemName: ev.StarSystem || store.systemAddressMap[addr] || `Unknown (${addr})`,
        coordinates: null,
        bodyCount: 0,
        fssAllBodiesFound: false,
        scannedBodies: [],
        lastSeen: ev.timestamp,
      };
    }

    const sys = cache[addr];
    const existingIdx = sys.scannedBodies.findIndex((b) => b.bodyId === ev.BodyID || b.bodyName === ev.BodyName);
    const body = {
      bodyId: ev.BodyID,
      bodyName: ev.BodyName,
      type: (ev.StarType ? 'Star' : 'Planet') as 'Star' | 'Planet',
      subType: ev.PlanetClass || (ev.StarType ? ev.StarType : 'Unknown'),
      distanceToArrival: ev.DistanceFromArrivalLS,
      starType: ev.StarType,
      stellarMass: ev.StellarMass,
      absoluteMagnitude: ev.AbsoluteMagnitude,
      luminosityClass: ev.Luminosity,
      ageMy: ev.Age_MY,
      isLandable: ev.Landable,
      earthMasses: ev.MassEM,
      gravity: ev.SurfaceGravity,
      atmosphereType: ev.AtmosphereType || ev.Atmosphere,
      volcanism: ev.Volcanism,
      surfaceTemperature: ev.SurfaceTemperature,
      surfacePressure: ev.SurfacePressure,
      radius: ev.Radius,
      semiMajorAxis: ev.SemiMajorAxis,
      terraformState: ev.TerraformState,
      rings: ev.Rings?.map((r: { Name: string; RingClass: string; OuterRad?: number; MassMT?: number }) => ({ name: r.Name, ringClass: r.RingClass, outerRad: r.OuterRad, massKG: r.MassMT })),
      parents: ev.Parents,
      wasDiscovered: ev.WasDiscovered,
      wasMapped: ev.WasMapped,
    };

    const newBodies = [...sys.scannedBodies];
    if (existingIdx >= 0) {
      newBodies[existingIdx] = body;
    } else {
      newBodies.push(body);
    }
    cache[addr] = { ...sys, scannedBodies: newBodies, lastSeen: ev.timestamp };
    cacheChanged = true;
  }

  // FSSBodySignals — attach bio/geo signal counts to bodies
  for (const ev of parsed.fssBodySignalsEvents) {
    const addr = ev.SystemAddress;
    if (!cache[addr]) continue;
    const body = cache[addr].scannedBodies.find(b => b.bodyId === ev.BodyID || b.bodyName === ev.BodyName);
    if (body) {
      for (const sig of ev.Signals) {
        if (sig.Type.includes('Biological')) body.bioSignals = sig.Count;
        else if (sig.Type.includes('Geological')) body.geoSignals = sig.Count;
      }
      cacheChanged = true;
    } else {
      // Body not scanned yet — store signals on a placeholder
      const newBody = {
        bodyId: ev.BodyID,
        bodyName: ev.BodyName,
        type: 'Planet' as const,
        subType: '',
        distanceToArrival: 0,
        bioSignals: 0,
        geoSignals: 0,
      };
      for (const sig of ev.Signals) {
        if (sig.Type.includes('Biological')) newBody.bioSignals = sig.Count;
        else if (sig.Type.includes('Geological')) newBody.geoSignals = sig.Count;
      }
      cache[addr].scannedBodies.push(newBody);
      cacheChanged = true;
    }
  }

  // FSSAllBodiesFound — mark systems as complete
  for (const ev of parsed.fssAllBodiesFoundEvents) {
    const addr = ev.SystemAddress;
    if (cache[addr]) {
      cache[addr] = { ...cache[addr], fssAllBodiesFound: true, bodyCount: ev.Count || cache[addr].bodyCount };
      cacheChanged = true;
    }
    const existing = store.scoutedSystems[addr];
    if (existing) {
      store.upsertScoutedSystem({
        ...existing,
        fssAllBodiesFound: true,
        journalBodyCount: ev.Count,
      });
    }
  }

  if (cacheChanged) {
    // Track the last scanned body name for system view pop notification
    const lastScanned = parsed.scanEvents.length > 0
      ? parsed.scanEvents[parsed.scanEvents.length - 1].BodyName
      : undefined;
    store.setJournalExplorationCache(cache);
    // Include systemAddress + systemName so remote system view can fetch without local lookup
    const lastAddr = parsed.scanEvents.length > 0 ? parsed.scanEvents[parsed.scanEvents.length - 1].SystemAddress
      : parsed.fssDiscoveryScanEvents.length > 0 ? parsed.fssDiscoveryScanEvents[parsed.fssDiscoveryScanEvents.length - 1].SystemAddress
      : undefined;
    const lastSysName = parsed.scanEvents.length > 0 ? parsed.scanEvents[parsed.scanEvents.length - 1].StarSystem
      : parsed.fssDiscoveryScanEvents.length > 0 ? parsed.fssDiscoveryScanEvents[parsed.fssDiscoveryScanEvents.length - 1].SystemName
      : undefined;
    const lastAddrNum = lastAddr;
    const sysData = lastAddrNum ? cache[lastAddrNum] : undefined;
    broadcastCompanionEvent({
      type: 'exploration_update',
      body: lastScanned,
      systemAddress: lastAddr,
      system: lastSysName,
      explorationData: sysData,
    });
  }
}

/**
 * Send overlay notifications for relevant journal events.
 */
function processOverlayUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  // Location — update commander position on game load / after death
  for (const ev of parsed.locationEvents) {
    if (ev.StarSystem && ev.SystemAddress) {
      syncCommanderPosition(
        'Location',
        ev.StarSystem,
        ev.SystemAddress,
        ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      );
    }
  }

  // FSDJump — score overlay, market relevance, missing images
  for (const ev of parsed.fsdJumpEvents) {
    handleFSDJump(ev);
    if (ev.StarSystem && ev.SystemAddress) {
      syncCommanderPosition(
        'FSDJump',
        ev.StarSystem,
        ev.SystemAddress,
        ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      );
    }
    broadcastCompanionEvent({
      type: 'fsd_jump',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      population: ev.Population,
      starPos: ev.StarPos,
    });
    // Safety net: schedule a full journal re-parse to backfill exploration data
    // if the incremental poller misses scan events (Chrome FSA stale file.size).
    scheduleExplorationBackfill();
  }

  // CarrierJump — treat like FSDJump for system view updates
  for (const ev of parsed.carrierJumpEvents) {
    if (ev.StarSystem) {
      syncCommanderPosition('CarrierJump', ev.StarSystem, ev.SystemAddress);
      broadcastCompanionEvent({
        type: 'fsd_jump',
        system: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        population: 0,
      });
      // Clear the countdown — jump completed
      useAppStore.getState().setCarrierJumpCountdown(null);
    }
  }

  // CarrierJumpRequest — start countdown
  for (const ev of parsed.carrierJumpRequestEvents) {
    useAppStore.getState().setCarrierJumpCountdown({
      destination: ev.SystemName,
      departureTime: ev.DepartureTime,
      systemAddress: ev.SystemAddress,
    });
    broadcastCompanionEvent({
      type: 'fc_jump_scheduled',
      destination: ev.SystemName,
      departureTime: ev.DepartureTime,
    });
  }

  // CarrierJumpCancelled — clear countdown
  for (const ev of parsed.carrierJumpCancelledEvents) {
    void ev;
    useAppStore.getState().setCarrierJumpCountdown(null);
    broadcastCompanionEvent({ type: 'fc_jump_cancelled' });
  }

  // CarrierStats — FC free cargo sync (fires on opening Carrier Management)
  for (const ev of parsed.carrierStatsEvents) {
    if (!ev.Callsign) continue;
    // Some journal variants nest differently; guard each field.
    const spaceUsage = ev.SpaceUsage;
    if (!spaceUsage || typeof spaceUsage.FreeSpace !== 'number') continue;
    useAppStore.getState().setFleetCarrierSpaceUsage(ev.Callsign, {
      totalCapacity: spaceUsage.TotalCapacity,
      cargo: spaceUsage.Cargo,
      freeSpace: spaceUsage.FreeSpace,
    });
    broadcastCompanionEvent({
      type: 'fc_space_update',
      callsign: ev.Callsign,
      totalCapacity: spaceUsage.TotalCapacity,
      cargo: spaceUsage.Cargo,
      freeSpace: spaceUsage.FreeSpace,
    });
  }

  // DockingGranted — fire welcome overlay EARLY (must run BEFORE Docked loop
  // so the suppression flag is set before Docked's welcome check).
  for (const ev of parsed.dockingGrantedEvents) {
    if (!ev.MarketID) continue;
    if (isEphemeralStation(ev.StationName, ev.StationType, ev.MarketID)) continue;
    handleDockingGranted(ev);
  }

  // Docked — FC load, station needs, missing image prompt
  for (const ev of parsed.dockedEvents) {
    if (ev.StarSystem && ev.SystemAddress) {
      syncCommanderPosition('Docked', ev.StarSystem, ev.SystemAddress);
    }
    handleDocked(ev);

    // Station dossier: record the dock, compute deltas, build welcome overlay
    // Skip fleet carriers — they aren't "places" in the narrative sense.
    // Use isFleetCarrier (stationType + marketId) rather than marketId alone —
    // colonized stations share the FC MarketID range, so the numeric check
    // alone over-rejects.
    if (!isEphemeralStation(ev.StationName, ev.StationType, ev.MarketID)) {
      // Record the dock (increments count, tracks faction/state history).
      // We deliberately do NOT fire the welcome overlay or summary broadcast
      // from Docked — that's DockingGranted's job (happens at approach).
      // Ephemeral stations (FCs, Trailblazers, construction sites) skipped.
      useAppStore.getState().recordStationDock(ev.MarketID, {
        stationName: ev.StationName,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        timestamp: ev.timestamp,
        faction: ev.StationFaction?.Name,
        factionState: ev.StationFaction?.FactionState,
      });
    }

    broadcastCompanionEvent({
      type: 'docked',
      station: ev.StationName,
      system: ev.StarSystem,
      stationType: ev.StationType,
      marketId: ev.MarketID,
    });
  }

  // Scan — per-body callouts in unknown systems
  for (const ev of parsed.scanEvents) {
    handleScanEvent(ev);
    // Broadcast notable scans (landable with atmosphere or rings)
    if (ev.Landable && (ev.Atmosphere || ev.Rings?.length)) {
      broadcastCompanionEvent({
        type: 'scan_highlight',
        body: ev.BodyName,
        hasRings: !!(ev.Rings?.length),
        atmosphere: ev.Atmosphere || '',
      });
    }
    // Broadcast first footfall opportunities so iPad/companion can see them
    if (ev.Landable && ev.WasDiscovered === true && ev.WasFootfalled === false && ev.DistanceFromArrivalLS < 60000) {
      const distLabel = ev.DistanceFromArrivalLS < 10
        ? `${ev.DistanceFromArrivalLS.toFixed(1)} Ls`
        : `${Math.round(ev.DistanceFromArrivalLS).toLocaleString()} Ls`;
      broadcastCompanionEvent({
        type: 'first_footfall',
        body: ev.BodyName,
        distance: distLabel,
      });
    }
  }

  // FSSAllBodiesFound — trigger full scoring
  for (const ev of parsed.fssAllBodiesFoundEvents) {
    handleFSSAllBodiesFound(ev);
    broadcastCompanionEvent({
      type: 'fss_complete',
      system: ev.SystemName,
      bodyCount: ev.Count,
    });
    // Safety net: re-parse journals so SystemView picks up any scan events
    // the incremental poller may have missed between the jump and the honk.
    scheduleExplorationBackfill();
  }

  // ColonisationContribution — broadcast progress updates
  for (const ev of parsed.contributionEvents) {
    const contributions = ev.Contributions || [];
    const legacyItems = ev.Commodities || [];
    const items = contributions.length > 0
      ? contributions.map((c) => ({ name: c.Name_Localised || c.Name, count: c.Amount }))
      : legacyItems.map((c) => ({ name: c.Name_Localised || c.Name, count: c.Count }));
    const summary = items.map((c) => `${c.name} x${c.count}`).join(', ');
    const totalCount = items.reduce((sum, c) => sum + c.count, 0);
    broadcastCompanionEvent({
      type: 'contribution',
      commodity: summary || 'commodities',
      amount: totalCount || ev.Contribution || 0,
      system: ev.StarSystem,
    });
  }

  // SupercruiseDestinationDrop — broadcast arrival at body/station
  for (const ev of parsed.supercruiseDestDropEvents) {
    broadcastCompanionEvent({
      type: 'sc_drop',
      station: ev.Type_Localised || ev.Type,
      marketId: ev.MarketID,
    });
  }

  // SendText — chat commands (!colony needs, !colony score, etc.)
  for (const ev of parsed.sendTextEvents) {
    handleChatCommand(ev);
  }

  // FSDTarget — galaxy-map target alerts (visited? spansh?)
  if (parsed.fsdTargetEvents.length > 0) {
    // Only process the most recent; stale targets don't matter
    const latest = parsed.fsdTargetEvents[parsed.fsdTargetEvents.length - 1];
    void handleTargetSelected(latest);
  }

  // NavRoute — fires when player plots a multi-jump route
  if (parsed.navRouteEvents.length > 0) {
    void handleNavRoutePlotted();
  }

  // NavRouteClear — route was cleared
  if (parsed.navRouteClearEvents.length > 0) {
    broadcastCompanionEvent({ type: 'nav_route_cleared' });
  }

  // SupercruiseExit — track current body for "you are here" marker on system view.
  // If we dropped at a station, resolve to the body it orbits (System View renders
  // bodies, not stations, so the marker needs to attach to the orbit body).
  for (const ev of parsed.supercruiseExitEvents) {
    if (!ev.SystemAddress) continue;
    if (ev.StarSystem) {
      syncCommanderPosition('SupercruiseExit', ev.StarSystem, ev.SystemAddress);
    }
    let bodyName = ev.Body;
    let bodyId = ev.BodyID;
    if (ev.BodyType === 'Station') {
      // Find the station by name in this system, read its orbit body
      const stations = useAppStore.getState().knownStations;
      const match = Object.values(stations).find(
        (s) => s.stationName === ev.Body && s.systemAddress === ev.SystemAddress,
      );
      if (match?.body) {
        bodyName = match.body; // e.g. "HIP 47126 ABCD 1 f"
        bodyId = -1; // unknown — we'll match by name on the canvas
      }
    }
    useAppStore.getState().setCurrentBody({
      systemAddress: ev.SystemAddress,
      bodyId,
      bodyName,
      bodyType: ev.BodyType,
      at: ev.timestamp,
    });
    broadcastCompanionEvent({
      type: 'supercruise_exit',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      body: ev.Body,
      bodyResolved: bodyName,
      bodyId,
      bodyType: ev.BodyType,
    });
  }

  // SupercruiseEntry — back in supercruise, clear "you are here"
  if (parsed.supercruiseEntryEvents.length > 0) {
    useAppStore.getState().setCurrentBody(null);
  }

  // Undocked / FSDJump — left the body / system, clear "you are here"
  if (parsed.undockedEvents.length > 0 || parsed.fsdJumpEvents.length > 0) {
    if (useAppStore.getState().currentBody) {
      useAppStore.getState().setCurrentBody(null);
    }
  }

  // ReceiveText — detect criminal threats / NPC interdiction demands
  for (const ev of parsed.receiveTextEvents) {
    handleReceiveText(ev);
  }
}

// ─── DockingGranted: welcome overlay (before touchdown) ──────────
// Suppress duplicate renders per marketId within this window
const DOCK_GRANT_SUPPRESSION_MS = 60_000;
const lastDockGrantAt = new Map<number, number>();

function handleDockingGranted(ev: { MarketID: number; StationName: string; LandingPad: number; timestamp: string }): void {
  const now = Date.now();
  const last = lastDockGrantAt.get(ev.MarketID);
  if (last && now - last < DOCK_GRANT_SUPPRESSION_MS) return;
  lastDockGrantAt.set(ev.MarketID, now);

  const store = useAppStore.getState();
  const station = store.knownStations[ev.MarketID];
  if (!station) return; // No history yet — let Docked handle first-time welcome

  // Display the visit-number we're about to complete (pre-increment + 1).
  const aboutToBe = (station.dockedCount ?? 0) + 1;
  // Compute rank for what it'll become: how many stations have >= aboutToBe
  const counts = Object.values(store.knownStations)
    .map((s) => s.dockedCount ?? 0)
    .filter((c) => c > 0);
  const higherOrEqual = counts.filter((c) => c >= aboutToBe).length;
  // This station counted at its CURRENT count (pre-increment), so bump by 1
  const rankRaw = higherOrEqual + 1;
  const rank = rankRaw <= 20 ? rankRaw : null;

  const summary = {
    marketId: ev.MarketID,
    stationName: ev.StationName,
    systemName: station.systemName,
    isFirstVisit: !station.firstDocked,
    dockedCount: aboutToBe,
    milestone: null,
    anniversary: null,
    factionChanged: false,
    previousFaction: null,
    currentFaction: station.faction ?? null,
    stateChanged: false,
    previousState: null,
    currentState: station.factionState ?? null,
    influenceDelta: null,
    currentInfluence: null,
    rank,
  };
  handleStationDockSummary(summary);
  broadcastCompanionEvent({
    type: 'station_dock_summary',
    marketId: summary.marketId,
    station: summary.stationName,
    system: summary.systemName,
    dockedCount: summary.dockedCount,
    isFirstVisit: summary.isFirstVisit,
    milestone: null,
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
  });
}

// ─── ReceiveText: NPC threat detection ──────────
function handleReceiveText(ev: { From: string; From_Localised?: string; Message: string; Message_Localised?: string; Channel: string; timestamp: string }): void {
  if (ev.Channel !== 'npc') return;
  const msg = ev.Message || '';
  // Threat indicators — message identifiers for pirate/interdictor NPC lines
  const isPirate = /^\$Pirate_/i.test(msg);
  const isInterdictor = /^\$InterdictorNPC_/i.test(msg) || /^\$NPC_.*Interdict/i.test(msg);
  const isDemand = /^\$.*_OnStartScanCargo|^\$.*_Stop_|^\$.*_Attack_/i.test(msg);
  if (!isPirate && !isInterdictor && !isDemand) return;

  const fromName = ev.From_Localised || ev.From;
  const messageText = ev.Message_Localised || ev.Message;
  emitNpcThreatOverlay(fromName, messageText);
  broadcastCompanionEvent({
    type: 'npc_threat',
    from: fromName,
    message: messageText,
    channel: ev.Channel,
    threatClass: isPirate ? 'pirate' : isInterdictor ? 'interdictor' : 'demand',
  });
}

/**
 * SINGLE ENTRY POINT for updating commanderPosition. Every event that reveals
 * location (FSDJump, Location, CarrierJump, Docked, SupercruiseExit, manual
 * Journal Read) goes through here. Stamps source + updatedAt. Broadcasts an
 * SSE `commander_position` event so every connected client refreshes.
 *
 * Coordinates are optional — if not provided (Docked/SupercruiseExit have no
 * StarPos), we look them up in knownSystems so Colony Map distances stay correct.
 */
function syncCommanderPosition(
  source: import('@/store').PositionSource,
  systemName: string,
  systemAddress: number,
  coords?: { x: number; y: number; z: number } | null,
): void {
  if (!systemName || !systemAddress) return;
  const store = useAppStore.getState();
  const current = store.commanderPosition;
  const sameSystem = current && current.systemAddress === systemAddress && current.systemName === systemName;
  // Resolve coordinates
  let nextCoords = coords ?? current?.coordinates;
  if (!nextCoords) {
    const ks = store.knownSystems[systemName.toLowerCase()];
    if (ks?.coordinates) nextCoords = ks.coordinates;
  }
  if (!nextCoords) {
    const found = Object.values(store.knownSystems).find((s) => s.systemAddress === systemAddress);
    if (found?.coordinates) nextCoords = found.coordinates;
  }
  const updatedAt = new Date().toISOString();
  store.setCommanderPosition({
    systemName,
    systemAddress,
    coordinates: nextCoords ?? { x: 0, y: 0, z: 0 },
    source,
    updatedAt,
  });
  const line = `[Position] ${source}: ${systemName}${sameSystem ? ' (unchanged)' : ''}`;
  console.log(line);
  // Mirror to server terminal
  try {
    const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    const url = token ? `/api/log?token=${token}` : '/api/log';
    fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'Position', message: `${source}: ${systemName}${sameSystem ? ' (unchanged)' : ''}` }),
    }).catch(() => {});
  } catch { /* ignore */ }
  // Broadcast to Companion (and all other listeners) so UIs update everywhere.
  broadcastCompanionEvent({
    type: 'commander_position',
    systemName,
    systemAddress,
    coordinates: nextCoords ?? { x: 0, y: 0, z: 0 },
    source,
    updatedAt,
  });
}

// De-dupe: don't re-alert the same target we just alerted on
let lastTargetAddress: number | null = null;

// Debounced backfill: re-read full journal exploration data after jumps.
// The incremental poller sometimes misses scan events when the FSA file.size
// reports stale values. This acts as a safety net — 5s after the last FSDJump
// (or CarrierJump), do a full re-parse and merge any new body data into the cache.
let pendingBackfillTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleExplorationBackfill(): void {
  if (pendingBackfillTimer) clearTimeout(pendingBackfillTimer);
  pendingBackfillTimer = setTimeout(async () => {
    pendingBackfillTimer = null;
    try {
      const dirHandle = await getJournalFolderHandle();
      if (!dirHandle) return;
      const data = await extractExplorationData(dirHandle);
      const store = useAppStore.getState();
      const cache = { ...store.journalExplorationCache };
      let changed = false;
      // Also build KnownSystem entries so the SystemView name→address lookup works
      // even if the live incremental watcher missed the FSDJump due to NotReadableError.
      const knownSystemUpserts: {
        systemName: string;
        systemAddress: number;
        coordinates?: { x: number; y: number; z: number };
        bodyCount?: number;
        population: number;
        economy: string;
        economyLocalised: string;
        lastSeen: string;
      }[] = [];
      for (const [addr, sys] of data) {
        const existing = cache[addr];
        const newCount = sys.scannedBodies?.length || 0;
        const existingCount = existing?.scannedBodies?.length || 0;
        // Only overwrite if new data has more bodies OR marks fssAllBodiesFound
        if (!existing || newCount > existingCount || (sys.fssAllBodiesFound && !existing.fssAllBodiesFound)) {
          cache[addr] = sys;
          changed = true;
        }
        // Contribute a minimal KnownSystem entry (upsert merges, preserves richer fields)
        if (sys.systemName && !sys.systemName.startsWith('Unknown')) {
          knownSystemUpserts.push({
            systemName: sys.systemName,
            systemAddress: addr,
            coordinates: sys.coordinates || undefined,
            bodyCount: sys.bodyCount,
            population: 0,
            economy: 'Unknown',
            economyLocalised: 'Unknown',
            lastSeen: sys.lastSeen,
          });
        }
      }
      if (changed) {
        store.setJournalExplorationCache(cache);
        console.log('[Watcher] Exploration backfill merged new system data into cache');
      }
      if (knownSystemUpserts.length > 0) {
        store.upsertKnownSystems(knownSystemUpserts);
      }
    } catch (e) {
      console.warn('[Watcher] Exploration backfill failed:', e);
    }
  }, 5000);
}

/**
 * FSDTarget handler — checks whether the targeted system was previously
 * visited (knownSystems) and whether Spansh has it (cached or live lookup).
 */
async function handleTargetSelected(ev: {
  Name: string;
  SystemAddress: number;
  StarClass?: string;
  RemainingJumpsInRoute?: number;
}): Promise<void> {
  if (!ev.SystemAddress || !ev.Name) return;
  if (ev.SystemAddress === lastTargetAddress) return; // same target, skip
  lastTargetAddress = ev.SystemAddress;

  const store = useAppStore.getState();
  // knownSystems is keyed by systemName.toLowerCase(), not by systemAddress.
  // Fall back to scanning for matching systemAddress in case the target name
  // differs slightly from the stored one.
  const nameKey = ev.Name.toLowerCase();
  const byName = store.knownSystems[nameKey];
  const byAddr = byName
    ? null
    : Object.values(store.knownSystems).find((s) => s.systemAddress === ev.SystemAddress);
  const visited = !!(byName || byAddr);
  const scouted = store.scoutedSystems?.[ev.SystemAddress];

  // Spansh state: 'cached' (in scoutedSystems with bodies), 'cached-empty' (0 bodies),
  //               'unknown' (not cached yet — we'll try a live lookup),
  //               'yes' / 'no' (after live lookup)
  let spansh: 'yes' | 'no' | 'empty' | 'unknown' = 'unknown';
  let bodyCount: number | undefined;

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

  // If not cached, do a live Spansh name lookup
  if (spansh === 'unknown') {
    try {
      const result = await resolveSystemName(ev.Name);
      spansh = result ? 'yes' : 'no';
    } catch (e) {
      console.warn('[Watcher] Spansh lookup failed for', ev.Name, e);
      spansh = 'unknown';
    }
  }

  broadcastCompanionEvent({
    type: 'target_selected',
    system: ev.Name,
    systemAddress: ev.SystemAddress,
    starClass: ev.StarClass || '',
    remainingJumps: ev.RemainingJumpsInRoute || 0,
    visited,
    spansh,
    bodyCount,
    wasColonised: scouted?.isColonised || false,
    // Surface the stored score (if any) so Companion target alert can show it
    score: scouted?.score?.total ?? null,
    bodyString: scouted?.bodyString ?? null,
    scoreSource: scouted ? (scouted.fromJournal ? 'Journal' : 'Spansh') : null,
  });
}

/**
 * NavRoute handler — reads NavRoute.json and broadcasts a summary
 * of the plotted route (visited + Spansh-cached counts).
 */
async function handleNavRoutePlotted(): Promise<void> {
  const dirHandle = await getJournalFolderHandle();
  if (!dirHandle) return;
  const nav = await readNavRouteJson(dirHandle);
  if (!nav || nav.route.length === 0) return;

  const store = useAppStore.getState();
  // Build a systemAddress → true map once for O(1) visited lookups
  const addrVisited = new Set<number>();
  for (const ks of Object.values(store.knownSystems)) {
    if (ks.systemAddress) addrVisited.add(ks.systemAddress);
  }
  let visitedCount = 0;
  let spanshCached = 0;
  for (const stop of nav.route) {
    if (addrVisited.has(stop.SystemAddress) || store.knownSystems[stop.StarSystem.toLowerCase()]) visitedCount++;
    const sc = store.scoutedSystems?.[stop.SystemAddress];
    if (sc && typeof sc.spanshBodyCount === 'number' && sc.spanshBodyCount > 0) spanshCached++;
  }

  broadcastCompanionEvent({
    type: 'nav_route_plotted',
    hops: nav.route.length,
    destination: nav.route[nav.route.length - 1]?.StarSystem || '',
    destinationAddress: nav.route[nav.route.length - 1]?.SystemAddress || null,
    visitedCount,
    spanshCached,
    systems: nav.route.map((s) => ({
      name: s.StarSystem,
      systemAddress: s.SystemAddress,
      starClass: s.StarClass,
    })),
  });
}

/** Broadcast an event to all Companion page clients via SSE */
function broadcastCompanionEvent(event: Record<string, unknown>): void {
  postCompanionEvent({ ...event, timestamp: new Date().toISOString() });
}

/**
 * Poll companion files (Cargo.json, Market.json) for changes.
 * These are written by the game alongside journal logs but are separate files.
 */
async function pollCompanionFiles(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  // Check Cargo.json
  try {
    const cargoHandle = await dirHandle.getFileHandle('Cargo.json');
    const cargoFile = await cargoHandle.getFile();
    if (cargoFile.lastModified > state.cargoLastModified) {
      state.cargoLastModified = cargoFile.lastModified;
      // Re-read ship cargo and update store
      const cargo = await readShipCargo(dirHandle);
      useAppStore.getState().setLiveShipCargo(cargo);
    }
  } catch { /* Cargo.json may not exist */ }

  // Check Market.json
  try {
    const marketHandle = await dirHandle.getFileHandle('Market.json');
    const marketFile = await marketHandle.getFile();
    if (marketFile.lastModified > state.marketLastModified) {
      state.marketLastModified = marketFile.lastModified;
      // Re-read market data and update store
      const market = await readMarketJson(dirHandle);
      if (market) {
        const store = useAppStore.getState();
        store.setLatestMarket(market);

        // Auto-persist a PersistedMarketSnapshot so the Sources page + Browse
        // Market Data always have fresh stock/price data. Skip FCs and
        // ephemeral stations (construction sites, colonisation ships).
        if (!isFleetCarrierMarketId(market.marketId)) {
          try {
            const snap = await readMarketSnapshot(dirHandle);
            if (snap && !isEphemeralStation(snap.stationName, snap.stationType, snap.marketId)) {
              store.upsertMarketSnapshot(snap);
              console.log(`[JournalWatcher] Auto-persisted market snapshot for ${snap.stationName} (${snap.commodities.length} items)`);
            }
          } catch (e) {
            console.warn('[JournalWatcher] Market snapshot persist failed:', e);
          }
        }

        // Auto-update carrierCargo when Market.json is from the user's FC
        if (isFleetCarrierMarketId(market.marketId)) {
          const settings = store.settings;
          const isMyFC =
            (settings.myFleetCarrierMarketId && market.marketId === settings.myFleetCarrierMarketId) ||
            (settings.myFleetCarrier && market.stationName.toUpperCase() === settings.myFleetCarrier.toUpperCase());

          if (isMyFC && settings.myFleetCarrier && market.items.length > 0) {
            const items = market.items
              .filter((item) => item.stock > 0 && item.name)
              .map((item) => {
                const known = findCommodityByJournalName(item.name) || findCommodityByJournalName(`$${(item.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
                return {
                  commodityId: known?.id || item.name.toLowerCase(),
                  name: item.nameLocalised || known?.name || item.name,
                  count: item.stock,
                };
              });
            console.log('[JournalWatcher] Auto-updating FC cargo from Market.json:', items.length, 'items for', settings.myFleetCarrier);
            store.setCarrierCargo(settings.myFleetCarrier, {
              callsign: settings.myFleetCarrier,
              items,
              isEstimate: false,
              updatedAt: market.timestamp || new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch { /* Market.json may not exist */ }
}

/**
 * Get journal files sorted chronologically.
 */
async function getJournalFiles(
  handle: FileSystemDirectoryHandle,
): Promise<{ name: string; handle: FileSystemFileHandle }[]> {
  const files: { name: string; handle: FileSystemFileHandle; lastModified: number }[] = [];
  for await (const [name, entryHandle] of handle.entries()) {
    if (entryHandle.kind === 'file' && name.startsWith('Journal.') && name.endsWith('.log')) {
      const fh = entryHandle as FileSystemFileHandle;
      const f = await fh.getFile();
      files.push({ name, handle: fh, lastModified: f.lastModified });
    }
  }
  // Sort by modification time so the most recently written file is last
  files.sort((a, b) => a.lastModified - b.lastModified);
  return files;
}
