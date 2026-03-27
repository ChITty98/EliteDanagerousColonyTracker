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
  readShipCargo,
  readMarketJson,
  isFleetCarrierMarketId,
  isColonisationShip,
  isConstructionStationName,
  resourceToCommodity,
} from './journalReader';
import { findCommodityByJournalName } from '@/data/commodities';
import { handleFSDJump, handleDocked, handleScanEvent, handleFSSAllBodiesFound, handleChatCommand, handleConstructionComplete, postCompanionEvent } from './overlayService';

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
  if (state.running) return;
  const handle = getJournalFolderHandle();
  if (!handle) return;

  state.running = true;

  // Do an initial scan to set up state without re-processing
  initWatcher(handle).then(() => {
    state.intervalId = setInterval(() => pollJournal(handle), POLL_INTERVAL_MS);
  });
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
    processKnowledgeUpdates(parsed);
    processDepotUpdates(parsed);
    processCargoUpdates(parsed);
    processExplorationUpdates(parsed);
    processOverlayUpdates(parsed);
  } catch {
    // Parsing error — skip this batch
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
  }
}

/**
 * Update scouting data from new exploration events.
 */
function processExplorationUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  // FSSAllBodiesFound — mark systems as complete
  if (parsed.fssAllBodiesFoundEvents.length > 0) {
    const store = useAppStore.getState();
    for (const ev of parsed.fssAllBodiesFoundEvents) {
      const existing = store.scoutedSystems[ev.SystemAddress];
      if (existing) {
        store.upsertScoutedSystem({
          ...existing,
          fssAllBodiesFound: true,
          journalBodyCount: ev.Count,
        });
      }
    }
  }
}

/**
 * Send overlay notifications for relevant journal events.
 */
function processOverlayUpdates(parsed: ReturnType<typeof parseJournalLines>): void {
  // Location — update commander position on game load / after death
  for (const ev of parsed.locationEvents) {
    if (ev.StarPos) {
      useAppStore.getState().setCommanderPosition({
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        coordinates: { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] },
      });
    }
  }

  // FSDJump — score overlay, market relevance, missing images
  for (const ev of parsed.fsdJumpEvents) {
    handleFSDJump(ev);
    // Update commander position in store
    if (ev.StarPos) {
      useAppStore.getState().setCommanderPosition({
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        coordinates: { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] },
      });
    }
    broadcastCompanionEvent({
      type: 'fsd_jump',
      system: ev.StarSystem,
      systemAddress: ev.SystemAddress,
      population: ev.Population,
      starPos: ev.StarPos,
    });
  }

  // Docked — FC load, station needs, missing image prompt
  for (const ev of parsed.dockedEvents) {
    handleDocked(ev);
    broadcastCompanionEvent({
      type: 'docked',
      station: ev.StationName,
      system: ev.StarSystem,
      stationType: ev.StationType,
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
  }

  // ColonisationContribution — broadcast progress updates
  for (const ev of parsed.contributionEvents) {
    broadcastCompanionEvent({
      type: 'contribution',
      commodity: ev.CommodityName || ev.Commodity,
      amount: ev.Amount || ev.Quantity,
      system: ev.StarSystem,
    });
  }

  // SendText — chat commands (!colony needs, !colony score, etc.)
  if (parsed.sendTextEvents.length > 0) {
    console.log('[JournalWatcher] SendText events:', parsed.sendTextEvents.length);
  }
  for (const ev of parsed.sendTextEvents) {
    handleChatCommand(ev);
  }
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
