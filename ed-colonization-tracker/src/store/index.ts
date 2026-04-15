import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { VisitedMarket, ShipCargo, JournalExplorationSystem } from '@/services/journalReader';

// --- Server-side storage adapter ---
// Stores state in colony-data.json on the server instead of browser IndexedDB.
// This allows multiple devices on the network to share the same data.

// Extract token from URL for network access (localhost doesn't need it)
function getToken(): string | null {
  try {
    // Check sessionStorage first (persists across page navigations within tab)
    const cached = sessionStorage.getItem('colony-token');
    if (cached) return cached;
    // Extract from URL on first load
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      sessionStorage.setItem('colony-token', token);
      // Clean token from URL bar (cosmetic)
      const clean = new URL(window.location.href);
      clean.searchParams.delete('token');
      window.history.replaceState({}, '', clean.toString());
    }
    return token;
  } catch {
    return null;
  }
}

function apiUrl(path: string): string {
  const token = getToken();
  return token ? `${path}?token=${token}` : path;
}

// --- IndexedDB → Server migration (one-time on first load after update) ---
async function migrateFromIndexedDB() {
  try {
    const available = await checkServerStorage();
    if (!available) return; // Dev mode — no migration needed

    // Check if server already has data
    const res = await fetch(apiUrl('/api/state'));
    if (!res.ok) return;
    const serverData = await res.json();
    if (serverData && Object.keys(serverData).length > 0) {
      // Server already has data — no migration needed
      return;
    }

    // Check if localStorage has old Zustand data
    const oldData = localStorage.getItem('ed-colonization-tracker');
    if (!oldData) return; // Nothing to migrate

    console.log('[Migration] Found localStorage data, migrating to server...');
    const parsed = JSON.parse(oldData);
    const state = parsed.state || parsed;

    // Send to server
    const patchRes = await fetch(apiUrl('/api/state'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });

    if (patchRes.ok) {
      // Clear old localStorage entry
      localStorage.removeItem('ed-colonization-tracker');
      console.log('[Migration] Successfully migrated data to server storage');
      // Reload to hydrate from server
      window.location.reload();
    }
  } catch (e) {
    console.error('[Migration] Error during migration:', e);
  }
}

let setItemDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Detect if /api/state endpoint is available (production server vs Vite dev server)
let serverStorageAvailable: boolean | null = null;

async function checkServerStorage(): Promise<boolean> {
  if (serverStorageAvailable !== null) return serverStorageAvailable;
  try {
    const res = await fetch(apiUrl('/api/state'), { method: 'HEAD' });
    // If we get JSON or 200, server storage is available
    // Vite dev server returns 200 with HTML for unknown routes
    const ct = res.headers.get('content-type') || '';
    serverStorageAvailable = ct.includes('application/json') || res.status === 404;
    // Try a GET to be sure
    if (!serverStorageAvailable) {
      const getRes = await fetch(apiUrl('/api/state'));
      const text = await getRes.text();
      try { JSON.parse(text); serverStorageAvailable = true; } catch { serverStorageAvailable = false; }
    }
  } catch {
    serverStorageAvailable = false;
  }
  if (!serverStorageAvailable) {
    console.log('[Store] Server storage not available — using localStorage fallback (dev mode)');
  }
  return serverStorageAvailable;
}

let hydrationComplete = false;

const serverStorage: StateStorage = {
  getItem: async (name: string) => {
    const available = await checkServerStorage();
    if (!available) { hydrationComplete = true; return localStorage.getItem(name); }
    try {
      const res = await fetch(apiUrl('/api/state'));
      if (!res.ok) { hydrationComplete = true; return null; }
      const data = await res.json();
      hydrationComplete = true;
      if (!data || Object.keys(data).length === 0) return null;
      return JSON.stringify({ state: data, version: 20 });
    } catch {
      hydrationComplete = true;
      return null;
    }
  },
  setItem: async (name: string, value: string) => {
    const available = await checkServerStorage();
    if (!available) { localStorage.setItem(name, value); return; }
    // Don't PATCH empty/default state to server before hydration completes
    if (!hydrationComplete) return;
    if (setItemDebounceTimer) clearTimeout(setItemDebounceTimer);
    setItemDebounceTimer = setTimeout(async () => {
      try {
        markOwnPatch();
        const parsed = JSON.parse(value);
        await fetch(apiUrl('/api/state'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.state),
        });
      } catch (e) {
        console.error('[Store] Failed to save state to server:', e);
      }
    }, 300);
  },
  removeItem: async (name: string) => {
    const available = await checkServerStorage();
    if (!available) localStorage.removeItem(name);
  },
};

// --- SSE state sync: re-fetch state when another device changes it ---
let lastOwnPatchTime = 0;
const PATCH_IGNORE_WINDOW = 2000; // ignore state_updated for 2s after our own PATCH

function markOwnPatch() {
  lastOwnPatchTime = Date.now();
}

function startStateSyncListener() {
  try {
    const url = apiUrl('/api/events');
    const es = new EventSource(url);
    // Track exploration updates to avoid rehydration conflicts
    let lastExplorationUpdate = 0;
    es.onmessage = async (e) => {
      try {
        const ev = JSON.parse(e.data);
        // Track exploration updates — system view handles these via inline SSE data
        if (ev.type === 'exploration_update') {
          lastExplorationUpdate = Date.now();
          return;
        }
        if (ev.type !== 'state_updated') return;
        // Skip if this was likely our own PATCH
        if (Date.now() - lastOwnPatchTime < PATCH_IGNORE_WINDOW) return;
        // Skip if a recent exploration update caused this — system view handles it directly
        if (Date.now() - lastExplorationUpdate < 5000) return;
        // Re-fetch state from server and merge into store
        const res = await fetch(apiUrl('/api/state'));
        if (!res.ok) return;
        const data = await res.json();
        if (!data || Object.keys(data).length === 0) return;
        // Rehydrate the store with server state
        useAppStore.persist.rehydrate();
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      // SSE will auto-reconnect
    };
  } catch { /* SSE not available */ }
}

// Start SSE sync after a short delay to let the store initialize
setTimeout(() => {
  checkServerStorage().then((available) => {
    if (available) startStateSyncListener();
  });
}, 1000);

import type {
  ColonizationProject,
  CustomSource,
  PlaySession,
  AppSettings,
  ProjectCommodity,
  SystemInfo,
  KnownSystem,
  KnownStation,
  MarketSnapshot,
  FleetCarrierInfo,
  FleetCarrierSpaceUsage,
  FSSSignal,
  ManualInstallation,
  ScoutedSystemData,
  PersistedMarketSnapshot,
  PersistedCarrierCargo,
  BodyVisit,
} from './types';
import { generateId } from '@/lib/utils';

interface AppState {
  // Projects
  projects: ColonizationProject[];
  addProject: (project: Omit<ColonizationProject, 'id' | 'createdAt' | 'lastUpdatedAt' | 'lastJournalSync' | 'completedAt' | 'systemInfo' | 'completedStationName' | 'completedStationType'>) => string;
  updateProject: (id: string, updates: Partial<ColonizationProject>) => void;
  completeProject: (id: string, completedStation?: { name: string; type: string }) => void;
  reactivateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  updateCommodity: (projectId: string, commodityId: string, updates: Partial<ProjectCommodity>) => void;
  updateAllCommodities: (projectId: string, commodities: ProjectCommodity[]) => void;
  updateSystemInfo: (projectId: string, info: SystemInfo) => void;

  // Knowledge Base — Systems
  knownSystems: Record<string, KnownSystem>;
  upsertKnownSystem: (system: KnownSystem) => void;
  upsertKnownSystems: (systems: KnownSystem[]) => void;

  // Knowledge Base — Stations
  knownStations: Record<number, KnownStation>;
  upsertKnownStation: (station: KnownStation) => void;
  upsertKnownStations: (stations: KnownStation[]) => void;
  updateStationBody: (marketId: number, body: string) => void;
  updateStationType: (marketId: number, stationType: string, fallback?: { stationName: string; systemName: string; systemAddress: number }) => void;
  // Body overrides for stations without marketId (keyed by "systemName|stationName" lowercase)
  stationBodyOverrides: Record<string, string>;
  setStationBodyOverride: (systemName: string, stationName: string, body: string) => void;

  // System Address mapping
  systemAddressMap: Record<number, string>;
  mapSystemAddress: (address: number, name: string) => void;
  mapSystemAddresses: (mappings: Record<number, string>) => void;

  // Market data
  latestMarket: MarketSnapshot | null;
  setLatestMarket: (market: MarketSnapshot) => void;

  // Commander position (live-updated by journal watcher on FSDJump)
  commanderPosition: { systemName: string; systemAddress: number; coordinates: { x: number; y: number; z: number } } | null;
  carrierJumpCountdown: { destination: string; departureTime: string; systemAddress: number } | null;
  setCarrierJumpCountdown: (countdown: { destination: string; departureTime: string; systemAddress: number } | null) => void;
  setCommanderPosition: (pos: { systemName: string; systemAddress: number; coordinates: { x: number; y: number; z: number } }) => void;

  // Ship cargo (live-updated by journal watcher)
  liveShipCargo: ShipCargo | null;
  setLiveShipCargo: (cargo: ShipCargo | null) => void;

  // Fleet Carriers
  fleetCarriers: FleetCarrierInfo[];
  addFleetCarrier: (fc: FleetCarrierInfo) => void;
  updateFleetCarrier: (callsign: string, updates: Partial<FleetCarrierInfo>) => void;
  // FC space usage — keyed by callsign; populated from CarrierStats journal events
  fleetCarrierSpaceUsage: Record<string, FleetCarrierSpaceUsage>;
  setFleetCarrierSpaceUsage: (callsign: string, usage: Omit<FleetCarrierSpaceUsage, 'updatedAt'>) => void;

  // FSS Signals
  fssSignals: FSSSignal[];
  setFSSSignals: (signals: FSSSignal[]) => void;

  // Custom Sources
  customSources: CustomSource[];
  addCustomSource: (source: Omit<CustomSource, 'id'>) => string;
  updateCustomSource: (id: string, updates: Partial<CustomSource>) => void;
  deleteCustomSource: (id: string) => void;

  // Sessions
  sessions: PlaySession[];
  activeSessionId: string | null;
  addSession: (session: Omit<PlaySession, 'id'>) => string;
  updateSession: (id: string, updates: Partial<PlaySession>) => void;
  deleteSession: (id: string) => void;
  startSession: (projectId: string) => string;
  stopSession: () => void;

  // Manual colonized systems (added by user, not from projects)
  manualColonizedSystems: string[];
  addManualColonizedSystem: (systemName: string) => void;
  removeManualColonizedSystem: (systemName: string) => void;

  // Manual installations (from signal mapping or user-added)
  manualInstallations: ManualInstallation[];
  addManualInstallation: (installation: Omit<ManualInstallation, 'id' | 'createdAt'>) => string;
  updateManualInstallation: (id: string, updates: Partial<ManualInstallation>) => void;
  removeManualInstallation: (id: string) => void;

  // Hidden installations (FSS-discovered entries the user dismissed, stored as "system|name" keys)
  hiddenInstallations: string[];
  hideInstallation: (systemName: string, signalName: string) => void;
  unhideInstallation: (systemName: string, signalName: string) => void;

  // Dismissed market IDs — depots the user deleted that should not be re-created by journal sync
  dismissedMarketIds: number[];

  // Visited markets — stations where user bought colonisation commodities (auto-discovered from journals)
  visitedMarkets: VisitedMarket[];
  setVisitedMarkets: (markets: VisitedMarket[]) => void;

  // Persisted market snapshots — full commodity lists from Market.json reads (survives restarts)
  marketSnapshots: Record<number, PersistedMarketSnapshot>; // keyed by marketId
  upsertMarketSnapshot: (snapshot: PersistedMarketSnapshot) => void;

  // Persisted fleet carrier cargo — survives page navigation and restarts
  carrierCargo: Record<string, PersistedCarrierCargo>; // keyed by callsign
  setCarrierCargo: (callsign: string, cargo: PersistedCarrierCargo) => void;

  // Body visits — per-body landing data from Touchdown events
  bodyVisits: Record<string, BodyVisit>; // keyed by "systemAddress|bodyName"
  upsertBodyVisits: (visits: BodyVisit[]) => void;

  // Body notes — user notes per body, keyed by "systemName|bodyName"
  bodyNotes: Record<string, string>;
  setBodyNote: (systemName: string, bodyName: string, note: string) => void;

  // Journal exploration cache — raw journal data extracted but NOT scored
  // Populated by "Process Journals" on expansion tab, used when scouting
  journalExplorationCache: Record<number, JournalExplorationSystem>; // keyed by systemAddress
  setJournalExplorationCache: (cache: Record<number, JournalExplorationSystem>) => void;
  clearJournalExplorationCache: () => void;

  // Scouted systems — persisted scoring results from expansion scouting
  scoutedSystems: Record<number, ScoutedSystemData>; // keyed by id64
  upsertScoutedSystem: (data: ScoutedSystemData) => void;
  clearScoutedSystems: (preserveFavorites?: boolean) => void;

  // Manual population overrides (keyed by lowercase system name)
  populationOverrides: Record<string, { population: number; updatedAt: string }>;
  setPopulationOverride: (systemName: string, population: number) => void;

  // Manual distance overrides for stations (keyed by "systemName|stationName" lowercase)
  stationDistOverrides: Record<string, number>;
  setStationDistOverride: (systemName: string, stationName: string, distLs: number | null) => void;

  // Session summary — tracks when the launch summary was last shown
  lastSessionSummaryShown: string | null;
  setLastSessionSummaryShown: (ts: string | null) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  commanderName: '',
  cargoCapacity: 794, // Type-9 default
  cargoCapacityManual: false,
  homeSystem: '',
  theme: 'dark',
  myFleetCarrier: '',
  myFleetCarrierMarketId: null,
  squadronCarrierCallsigns: [],
  fcModulesCapacity: 0,
  overlayEnabled: true,
  domainHighlightStars: ['Black Hole', 'Neutron Star', 'Wolf-Rayet', 'White Dwarf', 'O-class', 'Carbon Star'],
  domainHighlightAtmos: ['Oxygen'],
  domainHighlightStations: ['Dodec Spaceport', 'Coriolis Station', 'Orbis Station', 'Ocellus Station', 'Asteroid Base', 'Planetary Port'],
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Projects
      projects: [],
      addProject: (project) => {
        const id = generateId();
        const now = new Date().toISOString();
        set((state) => ({
          projects: [...state.projects, {
            ...project,
            id,
            createdAt: now,
            lastUpdatedAt: now,
            lastJournalSync: null,
            completedAt: null,
            systemInfo: null,
            completedStationName: null,
            completedStationType: null,
          }],
        }));
        return id;
      },
      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, lastUpdatedAt: new Date().toISOString() } : p
          ),
        })),
      completeProject: (id, completedStation) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'completed' as const,
                  completedAt: new Date().toISOString(),
                  lastUpdatedAt: new Date().toISOString(),
                  completedStationName: completedStation?.name || null,
                  completedStationType: completedStation?.type || null,
                  // Set all commodities to fully provided
                  commodities: p.commodities.map((c) => ({
                    ...c,
                    providedQuantity: c.requiredQuantity,
                  })),
                }
              : p
          ),
        })),
      reactivateProject: (id) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id
              ? { ...p, status: 'active' as const, completedAt: null, lastUpdatedAt: new Date().toISOString() }
              : p
          ),
        })),
      deleteProject: (id) =>
        set((state) => {
          const project = state.projects.find((p) => p.id === id);
          const marketId = project?.marketId;
          // Clear active session if it belongs to this project
          const activeSession = state.activeSessionId
            ? state.sessions.find((s) => s.id === state.activeSessionId)
            : null;
          const clearActive = activeSession?.projectId === id;
          return {
            projects: state.projects.filter((p) => p.id !== id),
            sessions: state.sessions.filter((s) => s.projectId !== id),
            activeSessionId: clearActive ? null : state.activeSessionId,
            // Remember the marketId so journal sync doesn't re-create this project
            dismissedMarketIds: marketId && !state.dismissedMarketIds.includes(marketId)
              ? [...state.dismissedMarketIds, marketId]
              : state.dismissedMarketIds,
          };
        }),
      updateCommodity: (projectId, commodityId, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  lastUpdatedAt: new Date().toISOString(),
                  commodities: p.commodities.map((c) =>
                    c.commodityId === commodityId ? { ...c, ...updates } : c
                  ),
                }
              : p
          ),
        })),
      updateAllCommodities: (projectId, commodities) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...p, commodities, lastUpdatedAt: new Date().toISOString(), lastJournalSync: new Date().toISOString() }
              : p
          ),
        })),
      updateSystemInfo: (projectId, info) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, systemInfo: info, lastUpdatedAt: new Date().toISOString() } : p
          ),
        })),

      // Knowledge Base — Systems
      knownSystems: {},
      upsertKnownSystem: (system) =>
        set((state) => {
          const key = system.systemName.toLowerCase();
          const existing = state.knownSystems[key];
          const isNewer = !existing || system.lastSeen >= existing.lastSeen;
          return { knownSystems: { ...state.knownSystems, [key]: {
            systemName: isNewer ? system.systemName : existing!.systemName,
            systemAddress: system.systemAddress || existing?.systemAddress || 0,
            coordinates: system.coordinates ?? existing?.coordinates,
            bodyCount: system.bodyCount ?? existing?.bodyCount,
            visitCount: Math.max(system.visitCount ?? 0, existing?.visitCount ?? 0),
            population: Math.max(system.population ?? 0, existing?.population ?? 0),
            economy: (system.economy && system.economy !== 'Unknown') ? system.economy : (existing?.economy ?? 'Unknown'),
            economyLocalised: (system.economyLocalised && system.economyLocalised !== 'Unknown') ? system.economyLocalised : (existing?.economyLocalised ?? 'Unknown'),
            secondEconomy: system.secondEconomy ?? existing?.secondEconomy,
            secondEconomyLocalised: system.secondEconomyLocalised ?? existing?.secondEconomyLocalised,
            lastSeen: isNewer ? system.lastSeen : existing!.lastSeen,
          } } };
        }),
      upsertKnownSystems: (systems) =>
        set((state) => {
          const updated = { ...state.knownSystems };
          const updatedPopOverrides = { ...state.populationOverrides };
          for (const system of systems) {
            const key = system.systemName.toLowerCase();
            const existing = updated[key];
            const isNewer = !existing || system.lastSeen >= existing.lastSeen;
            // Always merge — pick the best value for each field regardless of timestamp
            updated[key] = {
              systemName: isNewer ? system.systemName : existing!.systemName,
              systemAddress: system.systemAddress || existing?.systemAddress || 0,
              coordinates: system.coordinates ?? existing?.coordinates,
              bodyCount: system.bodyCount ?? existing?.bodyCount,
              visitCount: Math.max(system.visitCount ?? 0, existing?.visitCount ?? 0),
              population: Math.max(system.population ?? 0, existing?.population ?? 0),
              economy: (system.economy && system.economy !== 'Unknown') ? system.economy : (existing?.economy ?? 'Unknown'),
              economyLocalised: (system.economyLocalised && system.economyLocalised !== 'Unknown') ? system.economyLocalised : (existing?.economyLocalised ?? 'Unknown'),
              secondEconomy: system.secondEconomy ?? existing?.secondEconomy,
              secondEconomyLocalised: system.secondEconomyLocalised ?? existing?.secondEconomyLocalised,
              lastSeen: isNewer ? system.lastSeen : existing!.lastSeen,
            };
            // Auto-update manual population override if journal has newer data
            if (system.population && system.population > 0) {
              const override = updatedPopOverrides[key];
              if (override && system.lastSeen > override.updatedAt) {
                updatedPopOverrides[key] = { population: system.population, updatedAt: system.lastSeen };
              }
            }
          }
          return { knownSystems: updated, populationOverrides: updatedPopOverrides };
        }),

      // Knowledge Base — Stations
      knownStations: {},
      upsertKnownStation: (station) =>
        set((state) => {
          const existing = state.knownStations[station.marketId];
          if (!existing || station.lastSeen >= existing.lastSeen) {
            // Preserve manually-set body if new data doesn't have one
            const body = station.body || existing?.body;
            // Preserve user-set installation type (contains '_') when journal provides a generic type
            const stationType = (existing?.stationType?.includes('_') && !station.stationType?.includes('_'))
              ? existing.stationType
              : station.stationType;
            return { knownStations: { ...state.knownStations, [station.marketId]: { ...station, body, stationType } } };
          }
          return {};
        }),
      upsertKnownStations: (stations) =>
        set((state) => {
          const updated = { ...state.knownStations };
          for (const station of stations) {
            const existing = updated[station.marketId];
            if (!existing || station.lastSeen >= existing.lastSeen) {
              // Preserve manually-set body if new data doesn't have one
              const body = station.body || existing?.body;
              // Preserve user-set installation type (contains '_') when journal provides a generic type
              const stationType = (existing?.stationType?.includes('_') && !station.stationType?.includes('_'))
                ? existing.stationType
                : station.stationType;
              updated[station.marketId] = { ...station, body, stationType };
            }
          }
          return { knownStations: updated };
        }),

      updateStationBody: (marketId, body) =>
        set((state) => {
          const existing = state.knownStations[marketId];
          if (!existing) return {};
          return { knownStations: { ...state.knownStations, [marketId]: { ...existing, body } } };
        }),

      updateStationType: (marketId, stationType, fallback) =>
        set((state) => {
          const existing = state.knownStations[marketId];
          if (existing) {
            return { knownStations: { ...state.knownStations, [marketId]: { ...existing, stationType } } };
          }
          // Upsert: station wasn't in KB (e.g. came from visitedMarkets/FSS/manual).
          if (!fallback || !marketId) return {};
          const minimal: KnownStation = {
            stationName: fallback.stationName,
            stationType,
            marketId,
            systemName: fallback.systemName,
            systemAddress: fallback.systemAddress,
            distFromStarLS: null,
            landingPads: null,
            economies: [],
            services: [],
            lastSeen: new Date().toISOString(),
          };
          return { knownStations: { ...state.knownStations, [marketId]: minimal } };
        }),

      stationBodyOverrides: {},
      setStationBodyOverride: (systemName, stationName, body) =>
        set((state) => {
          const key = `${systemName.toLowerCase()}|${stationName.toLowerCase()}`;
          return { stationBodyOverrides: { ...state.stationBodyOverrides, [key]: body } };
        }),

      // System Address mapping
      systemAddressMap: {},
      mapSystemAddress: (address, name) =>
        set((state) => ({
          systemAddressMap: { ...state.systemAddressMap, [address]: name },
        })),
      mapSystemAddresses: (mappings) =>
        set((state) => ({
          systemAddressMap: { ...state.systemAddressMap, ...mappings },
        })),

      // Market data
      latestMarket: null,
      setLatestMarket: (market) => set({ latestMarket: market }),

      // Ship cargo (live-updated by journal watcher — not persisted)
      liveShipCargo: null,
      setLiveShipCargo: (cargo) => set({ liveShipCargo: cargo }),

      // Commander position
      commanderPosition: null,
      setCommanderPosition: (pos) => set({ commanderPosition: pos }),
      carrierJumpCountdown: null,
      setCarrierJumpCountdown: (countdown) => set({ carrierJumpCountdown: countdown }),

      // Fleet Carriers
      fleetCarriers: [],
      addFleetCarrier: (fc) =>
        set((state) => {
          const existing = state.fleetCarriers.find((f) => f.callsign === fc.callsign);
          if (existing) {
            return {
              fleetCarriers: state.fleetCarriers.map((f) =>
                f.callsign === fc.callsign ? { ...f, ...fc } : f
              ),
            };
          }
          return { fleetCarriers: [...state.fleetCarriers, fc] };
        }),
      updateFleetCarrier: (callsign, updates) =>
        set((state) => ({
          fleetCarriers: state.fleetCarriers.map((f) =>
            f.callsign === callsign ? { ...f, ...updates } : f
          ),
        })),

      fleetCarrierSpaceUsage: {},
      setFleetCarrierSpaceUsage: (callsign, usage) =>
        set((state) => ({
          fleetCarrierSpaceUsage: {
            ...state.fleetCarrierSpaceUsage,
            [callsign]: { ...usage, updatedAt: new Date().toISOString() },
          },
        })),

      // FSS Signals
      fssSignals: [],
      setFSSSignals: (signals) =>
        set((state) => {
          // Merge: keep existing signals, update/add new ones by systemAddress+signalName
          const merged = new Map<string, typeof signals[0]>();
          for (const s of state.fssSignals) merged.set(`${s.systemAddress}|${s.signalName}`, s);
          for (const s of signals) merged.set(`${s.systemAddress}|${s.signalName}`, s);
          return { fssSignals: Array.from(merged.values()) };
        }),

      // Custom Sources
      customSources: [],
      addCustomSource: (source) => {
        const id = generateId();
        set((state) => ({ customSources: [...state.customSources, { ...source, id }] }));
        return id;
      },
      updateCustomSource: (id, updates) =>
        set((state) => ({
          customSources: state.customSources.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        })),
      deleteCustomSource: (id) =>
        set((state) => ({ customSources: state.customSources.filter((s) => s.id !== id) })),

      // Sessions
      sessions: [],
      activeSessionId: null,
      addSession: (session) => {
        const id = generateId();
        set((state) => ({ sessions: [...state.sessions, { ...session, id }] }));
        return id;
      },
      updateSession: (id, updates) =>
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        })),
      deleteSession: (id) =>
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        })),
      startSession: (projectId) => {
        const state = useAppStore.getState();
        if (state.activeSessionId) return state.activeSessionId; // already active
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return '';
        const startSnapshot: Record<string, number> = {};
        for (const c of project.commodities) {
          startSnapshot[c.commodityId] = c.providedQuantity;
        }
        const id = generateId();
        set((s) => ({
          sessions: [...s.sessions, {
            id,
            projectId,
            startTime: new Date().toISOString(),
            endTime: null,
            startSnapshot,
            endSnapshot: null,
            notes: '',
          }],
          activeSessionId: id,
        }));
        return id;
      },
      stopSession: () => {
        const state = useAppStore.getState();
        if (!state.activeSessionId) return;
        const session = state.sessions.find((s) => s.id === state.activeSessionId);
        if (!session) { set({ activeSessionId: null }); return; }
        const project = state.projects.find((p) => p.id === session.projectId);
        const endSnapshot: Record<string, number> = {};
        if (project) {
          for (const c of project.commodities) {
            endSnapshot[c.commodityId] = c.providedQuantity;
          }
        }
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === state.activeSessionId
              ? { ...sess, endTime: new Date().toISOString(), endSnapshot }
              : sess
          ),
          activeSessionId: null,
        }));
      },

      // Manual colonized systems
      manualColonizedSystems: [],
      addManualColonizedSystem: (systemName) =>
        set((state) => {
          const lower = systemName.trim().toLowerCase();
          if (state.manualColonizedSystems.some((s) => s.toLowerCase() === lower)) return {};
          return { manualColonizedSystems: [...state.manualColonizedSystems, systemName.trim()] };
        }),
      removeManualColonizedSystem: (systemName) =>
        set((state) => ({
          manualColonizedSystems: state.manualColonizedSystems.filter(
            (s) => s.toLowerCase() !== systemName.toLowerCase()
          ),
        })),

      // Manual installations
      manualInstallations: [],
      addManualInstallation: (installation) => {
        const id = generateId();
        set((state) => ({
          manualInstallations: [...state.manualInstallations, { ...installation, id, createdAt: new Date().toISOString() }],
        }));
        return id;
      },
      updateManualInstallation: (id, updates) =>
        set((state) => ({
          manualInstallations: state.manualInstallations.map((i) =>
            i.id === id ? { ...i, ...updates } : i
          ),
        })),
      removeManualInstallation: (id) =>
        set((state) => ({
          manualInstallations: state.manualInstallations.filter((i) => i.id !== id),
        })),

      // Hidden installations
      hiddenInstallations: [],
      hideInstallation: (systemName, signalName) =>
        set((state) => {
          const key = `${systemName.toLowerCase()}|${signalName.toLowerCase()}`;
          if (state.hiddenInstallations.includes(key)) return {};
          return { hiddenInstallations: [...state.hiddenInstallations, key] };
        }),
      unhideInstallation: (systemName, signalName) =>
        set((state) => {
          const key = `${systemName.toLowerCase()}|${signalName.toLowerCase()}`;
          return { hiddenInstallations: state.hiddenInstallations.filter((k) => k !== key) };
        }),

      // Dismissed market IDs
      dismissedMarketIds: [],

      // Visited markets
      visitedMarkets: [],
      setVisitedMarkets: (markets) => set({ visitedMarkets: markets }),

      // Persisted market snapshots
      marketSnapshots: {},
      upsertMarketSnapshot: (snapshot) =>
        set((state) => ({
          marketSnapshots: { ...state.marketSnapshots, [snapshot.marketId]: snapshot },
        })),

      // Persisted fleet carrier cargo
      carrierCargo: {},
      setCarrierCargo: (callsign, cargo) =>
        set((state) => ({
          carrierCargo: { ...state.carrierCargo, [callsign]: cargo },
        })),

      // Body visits
      bodyVisits: {},
      upsertBodyVisits: (visits) =>
        set((state) => {
          const updated = { ...state.bodyVisits };
          for (const v of visits) {
            const key = `${v.systemAddress}|${v.bodyName}`;
            const existing = updated[key];
            if (existing) {
              updated[key] = {
                ...existing,
                landingCount: Math.max(existing.landingCount, v.landingCount),
                lastLanded: v.lastLanded > existing.lastLanded ? v.lastLanded : existing.lastLanded,
                lastCoords: v.lastLanded > existing.lastLanded ? v.lastCoords : existing.lastCoords,
              };
            } else {
              updated[key] = v;
            }
          }
          return { bodyVisits: updated };
        }),

      // Manual population overrides
      populationOverrides: {},
      setPopulationOverride: (systemName, population) =>
        set((state) => ({
          populationOverrides: { ...state.populationOverrides, [systemName.toLowerCase()]: { population, updatedAt: new Date().toISOString() } },
        })),

      // Station distance overrides
      stationDistOverrides: {},
      setStationDistOverride: (systemName, stationName, distLs) =>
        set((state) => {
          const key = `${systemName.toLowerCase()}|${stationName.toLowerCase()}`;
          const updated = { ...state.stationDistOverrides };
          if (distLs !== null && distLs >= 0) {
            updated[key] = distLs;
          } else {
            delete updated[key];
          }
          return { stationDistOverrides: updated };
        }),

      // Body notes
      bodyNotes: {},
      setBodyNote: (systemName, bodyName, note) =>
        set((state) => {
          const key = `${systemName}|${bodyName}`;
          const updated = { ...state.bodyNotes };
          if (note.trim()) {
            updated[key] = note;
          } else {
            delete updated[key];
          }
          return { bodyNotes: updated };
        }),

      // Journal exploration cache
      journalExplorationCache: {},
      setJournalExplorationCache: (cache) => set({ journalExplorationCache: cache }),
      clearJournalExplorationCache: () => set({ journalExplorationCache: {} }),

      // Scouted systems
      scoutedSystems: {},
      upsertScoutedSystem: (data) =>
        set((state) => ({
          scoutedSystems: { ...state.scoutedSystems, [data.id64]: data },
        })),
      clearScoutedSystems: (preserveFavorites) =>
        set((state) => {
          if (!preserveFavorites) return { scoutedSystems: {} };
          const kept: Record<number, ScoutedSystemData> = {};
          for (const [key, val] of Object.entries(state.scoutedSystems)) {
            if (val.isFavorite || val.notes) kept[Number(key)] = val;
          }
          return { scoutedSystems: kept };
        }),

      // Session summary
      lastSessionSummaryShown: null,
      setLastSessionSummaryShown: (ts) => set({ lastSessionSummaryShown: ts }),

      // Settings
      settings: DEFAULT_SETTINGS,
      updateSettings: (updates) =>
        set((state) => ({ settings: { ...state.settings, ...updates } })),
    }),
    {
      name: 'ed-colonization-tracker',
      version: 20,
      storage: createJSONStorage(() => serverStorage),
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('[Store] Rehydration error:', error);
            return;
          }
          // Check if we need to migrate from IndexedDB (first launch after storage migration)
          migrateFromIndexedDB();
          // Also migrate gallery images from IndexedDB to server
          import('@/store/galleryStore').then(({ migrateGalleryToServer }) => migrateGalleryToServer());
        };
      },
      partialize: (state) => ({
        projects: state.projects,
        settings: state.settings,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        customSources: state.customSources,
        knownSystems: state.knownSystems,
        knownStations: state.knownStations,
        systemAddressMap: state.systemAddressMap, // Needed for FSS signal → system mapping
        fssSignals: state.fssSignals, // FSS-discovered stations survive page reload
        manualColonizedSystems: state.manualColonizedSystems,
        manualInstallations: state.manualInstallations,
        hiddenInstallations: state.hiddenInstallations,
        dismissedMarketIds: state.dismissedMarketIds,
        visitedMarkets: state.visitedMarkets,
        marketSnapshots: state.marketSnapshots,
        carrierCargo: state.carrierCargo,
        journalExplorationCache: state.journalExplorationCache,
        scoutedSystems: state.scoutedSystems,
        bodyVisits: state.bodyVisits,
        bodyNotes: state.bodyNotes,
        populationOverrides: state.populationOverrides,
        stationDistOverrides: state.stationDistOverrides,
        lastSessionSummaryShown: state.lastSessionSummaryShown,
        stationBodyOverrides: state.stationBodyOverrides,
        commanderPosition: state.commanderPosition,
        fleetCarrierSpaceUsage: state.fleetCarrierSpaceUsage,
      }),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Record<string, unknown>;

        if (version < 2) {
          // v1 → v2: Add completedAt and systemInfo to projects
          const projects = (state.projects as ColonizationProject[]) || [];
          state.projects = projects.map((p) => ({
            ...p,
            completedAt: p.completedAt ?? (p.status === 'completed' ? p.lastUpdatedAt : null),
            systemInfo: p.systemInfo ?? null,
          }));
        }

        if (version < 3) {
          // v2 → v3: Add knowledge base slices and expand projects/settings
          state.knownSystems = state.knownSystems ?? {};
          state.knownStations = state.knownStations ?? {};
          state.systemAddressMap = state.systemAddressMap ?? {};
          state.latestMarket = state.latestMarket ?? null;
          state.fleetCarriers = state.fleetCarriers ?? [];
          state.fssSignals = state.fssSignals ?? [];

          // Expand projects with new fields
          const projects = (state.projects as ColonizationProject[]) || [];
          state.projects = projects.map((p) => ({
            ...p,
            systemAddress: p.systemAddress ?? null,
            stationName: p.stationName ?? '',
          }));

          // Expand settings with new fields
          const settings = (state.settings as AppSettings) || {};
          state.settings = {
            ...DEFAULT_SETTINGS,
            ...settings,
            myFleetCarrier: (settings as Record<string, unknown>).myFleetCarrier as string ?? '',
            myFleetCarrierMarketId: (settings as Record<string, unknown>).myFleetCarrierMarketId as number ?? null,
            squadronCarrierCallsigns: (settings as Record<string, unknown>).squadronCarrierCallsigns as string[] ?? [],
          };
        }

        if (version < 4) {
          // v3 → v4: Remove heavy KB data from persistence, add manual colonized systems
          // These are now ephemeral — rebuilt on each sync
          delete state.knownStations;
          delete state.systemAddressMap;
          delete state.latestMarket;
          delete state.fleetCarriers;
          delete state.fssSignals;
          state.manualColonizedSystems = state.manualColonizedSystems ?? [];
        }

        if (version < 5) {
          // v4 → v5: Add manual installations for signal mapping
          state.manualInstallations = state.manualInstallations ?? [];
        }

        if (version < 6) {
          // v5 → v6: Add hidden installations for dismissing FSS entries
          state.hiddenInstallations = state.hiddenInstallations ?? [];
        }

        if (version < 7) {
          // v6 → v7: Add completedStationName/Type to projects
          const projects = (state.projects as ColonizationProject[]) || [];
          state.projects = projects.map((p) => ({
            ...p,
            completedStationName: p.completedStationName ?? null,
            completedStationType: p.completedStationType ?? null,
          }));
        }

        if (version < 8) {
          // v7 → v8: Add dismissedMarketIds to prevent deleted projects from re-appearing
          state.dismissedMarketIds = state.dismissedMarketIds ?? [];
        }

        if (version < 9) {
          // v8 → v9: Add persisted scouting results
          state.scoutedSystems = state.scoutedSystems ?? {};
        }

        if (version < 10) {
          // v9 → v10: Add persisted market snapshots
          state.marketSnapshots = state.marketSnapshots ?? {};
        }

        if (version < 11) {
          // v10 → v11: Add persisted fleet carrier cargo
          state.carrierCargo = state.carrierCargo ?? {};
        }

        if (version < 12) {
          // v11 → v12: Add active session tracking
          state.activeSessionId = state.activeSessionId ?? null;
          // Recover orphaned open sessions
          const sessions = (state.sessions as PlaySession[]) || [];
          const openSession = sessions.find((s) => s.endTime === null);
          if (openSession) {
            state.activeSessionId = openSession.id;
          }
        }

        if (version < 13) {
          // v12 → v13: Add session summary tracking
          state.lastSessionSummaryShown = state.lastSessionSummaryShown ?? null;
        }

        if (version < 14) {
          // v13 → v14: Persist knownStations (was previously rebuilt on each sync)
          state.knownStations = state.knownStations ?? {};
        }

        if (version < 15) {
          // v14 → v15: Persist fssSignals and systemAddressMap so FSS-scanned stations survive reload
          state.fssSignals = state.fssSignals ?? [];
          state.systemAddressMap = state.systemAddressMap ?? {};
        }

        if (version < 16) {
          // v15 → v16: populationOverrides from Record<string, number> to Record<string, {population, updatedAt}>
          const old = (state.populationOverrides ?? {}) as Record<string, unknown>;
          const migrated: Record<string, { population: number; updatedAt: string }> = {};
          for (const [key, val] of Object.entries(old)) {
            if (typeof val === 'number') {
              migrated[key] = { population: val, updatedAt: new Date().toISOString() };
            } else if (val && typeof val === 'object' && 'population' in val) {
              migrated[key] = val as { population: number; updatedAt: string };
            }
          }
          state.populationOverrides = migrated;
        }

        if (version < 17) {
          // v16 → v17: Add overlayEnabled setting
          const settings = (state.settings ?? {}) as Record<string, unknown>;
          if (settings.overlayEnabled === undefined) {
            settings.overlayEnabled = true;
          }
          state.settings = settings;
        }

        if (version < 18) {
          // v17 → v18: Add stationDistOverrides + journalExplorationCache
          state.stationDistOverrides = state.stationDistOverrides ?? {};
          state.journalExplorationCache = state.journalExplorationCache ?? {};
        }

        if (version < 19) {
          // v18 → v19: Rename "Dodecahedron Station" → "Dodec Spaceport" in highlight settings,
          //            remove "Surface Station" from highlights, add domain highlight defaults
          const settings = state.settings as AppSettings;
          if (settings.domainHighlightStations) {
            settings.domainHighlightStations = settings.domainHighlightStations
              .map((s: string) => s === 'Dodecahedron Station' ? 'Dodec Spaceport' : s)
              .filter((s: string) => s !== 'Surface Station');
          }
          // Ensure highlight arrays exist
          settings.domainHighlightStars = settings.domainHighlightStars ?? DEFAULT_SETTINGS.domainHighlightStars;
          settings.domainHighlightAtmos = settings.domainHighlightAtmos ?? DEFAULT_SETTINGS.domainHighlightAtmos;
          settings.domainHighlightStations = settings.domainHighlightStations ?? DEFAULT_SETTINGS.domainHighlightStations;
        }

        if (version < 20) {
          // v19 → v20: Add fleetCarrierSpaceUsage map (CarrierStats journal tracking, legacy)
          //            and fcModulesCapacity setting (FC free-space = 25k − modules − cargo)
          state.fleetCarrierSpaceUsage = (state.fleetCarrierSpaceUsage as Record<string, unknown>) ?? {};
          const settings = state.settings as AppSettings;
          if (settings) {
            settings.fcModulesCapacity = settings.fcModulesCapacity ?? 0;
          }
        }

        return state as AppState;
      },
    }
  )
);
