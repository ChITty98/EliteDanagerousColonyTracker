// Fleet carrier max cargo capacity is fixed by Frontier at 25,000t.
// (Squadron carriers have a different capacity — revisit if we add support.)
export const FC_MAX_CAPACITY = 25000;

export interface ProjectCommodity {
  commodityId: string;
  name: string;
  requiredQuantity: number;
  providedQuantity: number;
}

export type ProjectStatus = 'active' | 'completed' | 'abandoned';

// --- System & Station Knowledge Base ---

export interface KnownSystem {
  systemName: string;
  systemAddress: number;
  population: number;
  economy: string;
  economyLocalised: string;
  secondEconomy?: string;
  secondEconomyLocalised?: string;
  coordinates?: { x: number; y: number; z: number };
  bodyCount?: number;
  visitCount?: number; // how many times commander has jumped into this system
  lastSeen: string; // ISO timestamp
}

export interface StationEconomy {
  name: string;           // e.g. "$economy_Refinery;"
  nameLocalised: string;  // e.g. "Refinery"
  proportion: number;
}

export interface KnownStation {
  stationName: string;
  stationType: string;       // raw journal type: "Coriolis", "CraterOutpost", etc.
  marketId: number;
  systemName: string;
  systemAddress: number;
  body?: string;             // e.g. "HIP 47126 A 1" — which body the station orbits
  bodyType?: string;         // e.g. "Planet", "Star", "Station"
  distFromStarLS: number | null;
  landingPads: { small: number; medium: number; large: number } | null;
  economies: StationEconomy[];
  services: string[];
  faction?: string;
  visitCount?: number; // how many times commander has docked at this station
  lastSeen: string; // ISO timestamp
}

export interface MarketItem {
  name: string;
  nameLocalised?: string;
  buyPrice: number;
  sellPrice: number;
  stock: number;
  demand: number;
  category: string;
}

export interface MarketSnapshot {
  marketId: number;
  stationName: string;
  systemName?: string;
  items: MarketItem[];
  timestamp: string;
}

export type FleetCarrierOwnership = 'mine' | 'squadron' | 'other';

export interface FleetCarrierInfo {
  callsign: string;
  marketId: number;
  ownership: FleetCarrierOwnership;
}

// --- Existing project/session/source types ---

export interface SystemInfo {
  economy: string;
  secondEconomy?: string;
  population: number;
  coordinates?: { x: number; y: number; z: number };
  distanceFromHome?: number;
  lastFetched: string;
}

export interface ColonizationProject {
  id: string;
  name: string;
  systemName: string;
  systemAddress: number | null;
  stationType: string;
  stationName: string;
  marketId: number | null;
  commodities: ProjectCommodity[];
  status: ProjectStatus;
  notes: string;
  createdAt: string;
  lastUpdatedAt: string;
  lastJournalSync: string | null;
  completedAt: string | null;
  systemInfo: SystemInfo | null;
  // What was actually built (filled on completion — colonisation ships leave, the real station stays)
  completedStationName: string | null;
  completedStationType: string | null;
}

export interface CustomSource {
  id: string;
  systemName: string;
  stationName: string;
  isPlanetary: boolean;
  hasLargePads: boolean;
  commodities: string[];
  priority: number;
  notes: string;
}

export interface SessionSnapshot {
  [commodityId: string]: number;
}

export interface PlaySession {
  id: string;
  projectId: string;
  startTime: string;
  endTime: string | null;
  startSnapshot: SessionSnapshot;
  endSnapshot: SessionSnapshot | null;
  notes: string;
}

export interface AppSettings {
  commanderName: string;
  cargoCapacity: number;
  cargoCapacityManual: boolean; // true = user manually set this, don't auto-update from journal
  homeSystem: string;
  theme: 'dark';
  myFleetCarrier: string;
  myFleetCarrierMarketId: number | null;
  squadronCarrierCallsigns: string[];
  fcModulesCapacity: number; // Tons of capacity consumed by installed services/modules (user-entered from Carrier Management)
  overlayEnabled: boolean;
  // Domain Highlights — configurable lists of which types show as showpieces on the Architect's Domain page
  domainHighlightStars: string[];
  domainHighlightAtmos: string[];
  domainHighlightStations: string[];
}

// --- Scouting data (persisted scoring results) ---

export interface ScoutedSystemData {
  id64: number;
  name: string;
  score: import('@/lib/scoutingScorer').ScoreBreakdown;
  bodyString: string;
  coordinates?: { x: number; y: number; z: number }; // galactic coordinates for distance calculations
  isColonised?: boolean; // true if system was colonised at time of scouting
  isFavorite?: boolean; // user-flagged as interesting
  notes?: string; // user notes about the system
  fromJournal?: boolean; // true if scored from journal data (not in Spansh)
  journalBodyCount?: number; // total bodies from FSSDiscoveryScan (honk)
  journalScannedCount?: number; // how many bodies have detailed scan data
  fssAllBodiesFound?: boolean; // true if FSSAllBodiesFound confirmed all bodies detected — journal data is complete
  spanshUpdatedAt?: string; // when Spansh data was last submitted (from dump updateTime)
  spanshBodyCount?: number; // how many bodies Spansh returned (0 = empty response, undefined = never queried)
  cachedBodies?: import('@/services/spanshApi').SpanshDumpBody[]; // full body data cached locally (for colony detail pages)
  scoutedAt: string; // ISO timestamp
}

// --- Persisted market commodity data (from Market.json reads) ---

export interface PersistedMarketCommodity {
  commodityId: string; // matches CommodityDefinition.id
  name: string;
  buyPrice: number;
  stock: number;
}

export interface PersistedMarketSnapshot {
  marketId: number;
  stationName: string;
  systemName: string;
  stationType: string;
  isPlanetary: boolean;
  hasLargePads: boolean;
  commodities: PersistedMarketCommodity[];
  updatedAt: string; // ISO timestamp of Market.json read
}

// --- Persisted fleet carrier cargo ---

export interface PersistedCarrierCargo {
  callsign: string;
  items: { commodityId: string; name: string; count: number }[];
  isEstimate: boolean;
  updatedAt: string; // ISO timestamp
}

// --- Phase 2 placeholder ---

export interface TravelLeg {
  fromStation: string;
  fromSystem: string;
  toStation: string;
  toSystem: string;
  departureTime: string;
  arrivalTime: string;
  durationSeconds: number;
}

// FSS signal data for constructions/installations in a system
export interface FSSSignal {
  signalName: string;
  signalType: string;
  isStation: boolean;
  systemAddress: number;
  timestamp: string;
}

// Per-body landing visit data (from Touchdown journal events)
export interface BodyVisit {
  bodyName: string;
  systemName: string;
  systemAddress: number;
  landingCount: number;
  lastLanded: string; // ISO timestamp
  lastCoords?: { lat: number; lon: number };
}

// User-created installation from a construction signal or manual entry
export interface ManualInstallation {
  id: string;
  stationName: string;
  systemName: string;
  systemAddress: number;
  stationType: string;
  sourceSignalName: string | null;
  createdAt: string;
}

// Fleet carrier space usage — captured from journal CarrierStats events.
// Frontier already computes free space as (total capacity - installed services - cargo).
export interface FleetCarrierSpaceUsage {
  totalCapacity: number;
  cargo: number;
  freeSpace: number;
  updatedAt: string; // ISO timestamp
}
