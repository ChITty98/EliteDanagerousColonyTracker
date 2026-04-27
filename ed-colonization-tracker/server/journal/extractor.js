/**
 * Server-side port of the extractor functions from src/services/journalReader.ts.
 *
 * All of these replace the browser's File System Access API path. Instead of
 * dirHandle / getFile() they take a journal directory as a string and use
 * Node fs. Output shapes MUST match the browser versions — the Zustand state
 * they feed is the same either way.
 *
 * The heavy browser versions call parseJournalLines once per file. We do the
 * same here via `parseJournalFile`. `scanAllJournalsParsed` is a memory-naive
 * accumulator that merges every file's events into one bundle; it's only
 * called by Sync All and on server startup, not on the hot watcher path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseJournalLines } from './parser.js';
import {
  isFleetCarrier,
  isFleetCarrierCallsign,
  isEphemeralStation,
  isPermanentlyEphemeral,
  classifyFleetCarrier,
} from './util.js';
import {
  findCommodityByJournalName,
  findCommodityByDisplayName,
} from './commodities.js';
import { listJournalFiles } from './paths.js';

// Station types known to have large pads. Used to infer pad availability when
// journal LandingPads data is missing.
export const LARGE_PAD_TYPES = new Set([
  'Coriolis', 'Orbis', 'Ocellus', 'StationDodec', 'AsteroidBase',
  'CraterPort', 'PlanetaryPort', 'SurfaceStation',
  'FleetCarrier', 'MegaShip',
]);

export const PLANETARY_STATION_TYPES = new Set([
  'CraterOutpost', 'CraterPort', 'OnFootSettlement', 'SurfaceStation',
  'PlanetaryOutpost', 'PlanetaryPort', 'SurfaceOutpost',
  'PlanetaryConstructionDepot', 'SurfaceConstructionDepot',
]);

export function inferHasLargePads(stationType) {
  return LARGE_PAD_TYPES.has(stationType);
}

const STAR_TYPE_MAP = {
  O: 'O (Blue-White) Star', B: 'B (Blue-White) Star', A: 'A (Blue-White) Star',
  F: 'F (White) Star', G: 'G (White-Yellow) Star', K: 'K (Yellow-Orange) Star',
  M: 'M (Red dwarf) Star', L: 'L (Brown dwarf) Star', T: 'T (Brown dwarf) Star',
  Y: 'Y (Brown dwarf) Star',
  TTS: 'T Tauri Star', AeBe: 'Herbig Ae/Be Star',
  W: 'Wolf-Rayet Star', WN: 'Wolf-Rayet N Star', WNC: 'Wolf-Rayet NC Star',
  WC: 'Wolf-Rayet C Star', WO: 'Wolf-Rayet O Star',
  CS: 'CS Star', C: 'C Star', CN: 'CN Star', CJ: 'CJ Star', CH: 'CH Star',
  CHd: 'CHd Star', MS: 'MS-type Star', S: 'S-type Star',
  D: 'D (White Dwarf) Star', DA: 'DA (White Dwarf) Star', DAB: 'DAB (White Dwarf) Star',
  DAO: 'DAO (White Dwarf) Star', DAZ: 'DAZ (White Dwarf) Star', DAV: 'DAV (White Dwarf) Star',
  DB: 'DB (White Dwarf) Star', DBZ: 'DBZ (White Dwarf) Star', DBV: 'DBV (White Dwarf) Star',
  DO: 'DO (White Dwarf) Star', DOV: 'DOV (White Dwarf) Star', DQ: 'DQ (White Dwarf) Star',
  DC: 'DC (White Dwarf) Star', DCV: 'DCV (White Dwarf) Star', DX: 'DX (White Dwarf) Star',
  N: 'Neutron Star', H: 'Black Hole', SupermassiveBlackHole: 'Supermassive Black Hole',
  A_BlueWhiteSuperGiant: 'A (Blue-White super giant) Star',
  F_WhiteSuperGiant: 'F (White super giant) Star',
  M_RedSuperGiant: 'M (Red super giant) Star',
  M_RedGiant: 'M (Red giant) Star',
  K_OrangeGiant: 'K (Orange giant) Star',
  X: 'Exotic Star', RoguePlanet: 'Rogue Planet',
  Nebula: 'Nebula', StellarRemnantNebula: 'Stellar Remnant Nebula',
};
export function mapStarType(code) {
  return STAR_TYPE_MAP[code] || code;
}

// ===== Core file helpers =====

export function parseJournalFile(fullPath) {
  try {
    const text = fs.readFileSync(fullPath, 'utf-8');
    return parseJournalLines(text.split('\n'));
  } catch {
    return null;
  }
}

/**
 * Read every Journal.*.log in the directory and return a single parsed
 * result with events from all files concatenated.
 * Memory-heavy for huge collections — callers should treat this as a
 * Sync-All-only operation, not something to run on the hot watcher path.
 */
export function scanAllJournalsParsed(journalDir) {
  const files = listJournalFiles(journalDir);
  const combined = parseJournalLines([]); // seed with empty arrays of every key
  for (const jf of files) {
    const parsed = parseJournalFile(jf.fullPath);
    if (!parsed) continue;
    for (const key of Object.keys(combined)) {
      if (Array.isArray(parsed[key])) combined[key].push(...parsed[key]);
    }
  }
  return combined;
}

// ===== Companion file readers =====

function _readJsonSafely(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Read Market.json → normalized MarketSnapshot or null. */
export function readMarketJson(journalDir) {
  const data = _readJsonSafely(path.join(journalDir, 'Market.json'));
  if (!data || !Array.isArray(data.Items) || data.Items.length === 0) return null;
  const items = data.Items.filter((item) => item && item.Name).map((item) => ({
    name: item.Name,
    nameLocalised: item.Name_Localised,
    buyPrice: item.BuyPrice,
    sellPrice: item.SellPrice,
    stock: item.Stock,
    demand: item.Demand,
    category: item.Category_Localised || item.Category || '',
  }));
  return {
    marketId: data.MarketID,
    stationName: data.StationName,
    stationType: data.StationType || '',
    systemName: data.StarSystem,
    items,
    timestamp: data.timestamp,
  };
}

/** Read Cargo.json (Vessel=Ship) → ShipCargo or null. */
export function readShipCargo(journalDir) {
  const data = _readJsonSafely(path.join(journalDir, 'Cargo.json'));
  if (!data || data.Vessel !== 'Ship' || !Array.isArray(data.Inventory)) return null;
  return {
    timestamp: data.timestamp,
    items: data.Inventory.map((item) => {
      const known = findCommodityByJournalName(`$${String(item.Name || '').toLowerCase()}_name;`);
      return {
        commodityId: (known && known.id) || String(item.Name || '').toLowerCase(),
        name: item.Name_Localised || (known && known.name) || item.Name,
        count: item.Count,
      };
    }),
  };
}

/** Read NavRoute.json → {timestamp, route[]} or null. */
export function readNavRouteJson(journalDir) {
  const data = _readJsonSafely(path.join(journalDir, 'NavRoute.json'));
  if (!data || !Array.isArray(data.Route) || data.Route.length === 0) return null;
  return { timestamp: data.timestamp, route: data.Route };
}

/** Build a PersistedMarketSnapshot (colonisation-commodities subset + station meta). */
export function readMarketSnapshot(journalDir) {
  const market = readMarketJson(journalDir);
  if (!market || !market.items || market.items.length === 0) return null;

  // Capture every item (sell-side + buy-side). Raw-name fallback when not in colonisation dict.
  const commodities = [];
  for (const item of market.items) {
    const hasSale = item.stock > 0 && item.buyPrice > 0;
    const hasDemand = item.demand > 0 && item.sellPrice > 0;
    if (!hasSale && !hasDemand) continue;
    const def =
      findCommodityByDisplayName(item.nameLocalised || item.name) ||
      findCommodityByDisplayName(item.name) ||
      findCommodityByJournalName(`$${String(item.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
    const rawName = item.nameLocalised || item.name || 'unknown';
    commodities.push({
      commodityId: (def && def.id) || String(item.name || rawName).toLowerCase().replace(/\s+/g, ''),
      name: (def && def.name) || rawName,
      buyPrice: item.buyPrice,
      stock: item.stock,
      sellPrice: item.sellPrice,
      demand: item.demand,
      category: item.category || '',
    });
  }

  // Pull station metadata from the most recent matching Docked event across the last 3 journal files
  let stationType = '';
  let isPlanetary = false;
  let hasLargePads = false;
  const systemName = market.systemName || '';
  try {
    const files = listJournalFiles(journalDir);
    const recent = files.slice(-3);
    for (const jf of recent) {
      const parsed = parseJournalFile(jf.fullPath);
      if (!parsed) continue;
      for (const ev of parsed.dockedEvents) {
        if (ev.MarketID === market.marketId) {
          stationType = ev.StationType || '';
          isPlanetary = PLANETARY_STATION_TYPES.has(stationType);
          hasLargePads = ev.LandingPads
            ? (ev.LandingPads.Large || 0) > 0
            : inferHasLargePads(stationType);
        }
      }
    }
  } catch { /* best-effort */ }

  if (!hasLargePads && stationType) {
    hasLargePads = inferHasLargePads(stationType);
  }

  return {
    marketId: market.marketId,
    stationName: market.stationName,
    systemName,
    stationType,
    isPlanetary,
    hasLargePads,
    commodities,
    updatedAt: market.timestamp || new Date().toISOString(),
  };
}

// ===== Depot / station-info helpers =====

/** Convert a ColonisationConstructionDepot ResourcesRequired entry → ProjectCommodity. */
export function resourceToCommodity(r) {
  const known = findCommodityByJournalName(r.Name);
  const rawName = r.Name || 'unknown';
  // Slug for unknown commodities: strip `$` prefix and `_name;` suffix (was previously
  // a broken character class that removed every n/a/m/e letter from the id).
  const fallbackId = rawName.replace(/^\$|_name;?$/gi, '').toLowerCase();
  const fallbackName = rawName.replace(/^\$/, '').replace(/_name;?$/i, '').replace(/_/g, ' ');
  return {
    commodityId: (known && known.id) || fallbackId,
    name: r.Name_Localised || fallbackName,
    requiredQuantity: r.RequiredAmount,
    providedQuantity: r.ProvidedAmount,
  };
}

/** Build a marketId → {systemName, stationName, stationType, timestamp} map from Docked + Location events. */
function buildStationInfoMap(dockedEvents, locationEvents) {
  const map = new Map();
  for (const ev of locationEvents) {
    if (ev.MarketID && ev.Docked && ev.StationName) {
      const existing = map.get(ev.MarketID);
      if (!existing || ev.timestamp > existing.timestamp) {
        map.set(ev.MarketID, {
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          stationName: ev.StationName,
          stationType: ev.StationType || '',
          timestamp: ev.timestamp,
        });
      }
    }
  }
  for (const ev of dockedEvents) {
    const existing = map.get(ev.MarketID);
    if (!existing || ev.timestamp > existing.timestamp) {
      map.set(ev.MarketID, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        stationName: ev.StationName,
        stationType: ev.StationType,
        timestamp: ev.timestamp,
      });
    }
  }
  return map;
}

/**
 * Scan all journal files for ColonisationConstructionDepot events.
 * Returns one DiscoveredDepot per MarketID (the latest snapshot), enriched
 * with system/station metadata from Docked/Location events.
 */
export function scanJournalFiles(journalDir) {
  const files = listJournalFiles(journalDir);
  const allDepot = [];
  const allDocked = [];
  const allLocation = [];
  for (const jf of files) {
    const parsed = parseJournalFile(jf.fullPath);
    if (!parsed) continue;
    allDepot.push(...parsed.depotEvents);
    allDocked.push(...parsed.dockedEvents);
    allLocation.push(...parsed.locationEvents);
  }
  const stationMap = buildStationInfoMap(allDocked, allLocation);
  const latestByMarketId = new Map();
  for (const depot of allDepot) {
    const existing = latestByMarketId.get(depot.MarketID);
    if (!existing || depot.timestamp > existing.timestamp) {
      latestByMarketId.set(depot.MarketID, depot);
    }
  }
  return Array.from(latestByMarketId.values()).map((depot) => {
    const info = stationMap.get(depot.MarketID);
    return {
      marketId: depot.MarketID,
      timestamp: depot.timestamp,
      constructionProgress: depot.ConstructionProgress,
      isComplete: depot.ConstructionComplete,
      isFailed: depot.ConstructionFailed,
      commodities: (depot.ResourcesRequired || []).map(resourceToCommodity),
      systemName: info && info.systemName,
      systemAddress: info && info.systemAddress,
      stationName: info && info.stationName,
      stationType: info && info.stationType,
    };
  });
}

// ===== Position + Ship (startup backfill) =====

/**
 * Walk journals newest→oldest, return the latest FSDJump / Location /
 * CarrierJump position event. Used for startup backfill so connected
 * clients see the right system on reconnect, and for the System View
 * "Check journal" button.
 */
export function fetchLatestPositionFromJournal(journalDir) {
  const files = listJournalFiles(journalDir);
  if (files.length === 0) return null;
  for (let i = files.length - 1; i >= 0; i--) {
    const parsed = parseJournalFile(files[i].fullPath);
    if (!parsed) continue;
    const candidates = [];
    for (const ev of parsed.fsdJumpEvents) {
      candidates.push({
        ts: ev.timestamp,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        coords: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      });
    }
    for (const ev of parsed.locationEvents) {
      if (!ev.StarSystem || !ev.SystemAddress) continue;
      candidates.push({
        ts: ev.timestamp,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        coords: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : null,
      });
    }
    for (const ev of parsed.carrierJumpEvents) {
      if (!ev.StarSystem || !ev.SystemAddress) continue;
      candidates.push({
        ts: ev.timestamp,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        coords: null,
      });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.ts.localeCompare(a.ts));
      const latest = candidates[0];
      return {
        systemName: latest.systemName,
        systemAddress: latest.systemAddress,
        coordinates: latest.coords,
      };
    }
  }
  return null;
}

/** Latest Loadout event's cargo capacity + ship name. Walks newest-first; stops at first file with a Loadout. */
export function extractLatestCargoCapacity(journalDir) {
  const files = listJournalFiles(journalDir);
  for (let i = files.length - 1; i >= 0; i--) {
    const parsed = parseJournalFile(files[i].fullPath);
    if (!parsed) continue;
    let latest = null;
    for (const ev of parsed.loadoutEvents) {
      if (ev.CargoCapacity != null && (!latest || ev.timestamp > latest.timestamp)) {
        latest = {
          cargoCapacity: ev.CargoCapacity,
          shipName: ev.ShipName || ev.Ship || 'Unknown',
          timestamp: ev.timestamp,
        };
      }
    }
    if (latest) return latest;
  }
  return null;
}

// ===== Knowledge base =====

/**
 * Build a knowledge-base result (systems / stations / FC map / body visits /
 * FSS signals / systemAddress map / claimed systems) from already-parsed events.
 * Direct port of extractKnowledgeBaseFromEvents.
 *
 * `settings` must supply { myFleetCarrier, myFleetCarrierMarketId, squadronCarrierCallsigns }.
 */
export function extractKnowledgeBaseFromEvents(parsed, settings) {
  const systemsMap = new Map(); // key: lowercase name
  const stationsMap = new Map(); // key: marketId
  const addressMap = {}; // systemAddress -> systemName
  const fssSignals = [];
  const fcMap = new Map(); // callsign -> info

  const fsdJumpEvents = parsed.fsdJumpEvents || [];
  const locationEvents = parsed.locationEvents || [];
  const dockedEvents = parsed.dockedEvents || [];
  const fssSignalEvents = parsed.fssSignalEvents || [];
  const supercruiseEntryEvents = parsed.supercruiseEntryEvents || [];
  const systemClaimEvents = parsed.systemClaimEvents || [];
  const touchdownEvents = parsed.touchdownEvents || [];

  // Visit counts
  const systemVisitCounts = new Map();
  for (const ev of fsdJumpEvents) {
    const key = ev.StarSystem.toLowerCase();
    systemVisitCounts.set(key, (systemVisitCounts.get(key) || 0) + 1);
  }
  const stationVisitCounts = new Map();
  for (const ev of dockedEvents) {
    stationVisitCounts.set(ev.MarketID, (stationVisitCounts.get(ev.MarketID) || 0) + 1);
  }

  const _sCallsigns = Array.isArray(settings && settings.squadronCarrierCallsigns)
    ? settings.squadronCarrierCallsigns : [];
  const _myCallsign = (settings && settings.myFleetCarrier) || '';
  const _myFcMid = (settings && settings.myFleetCarrierMarketId) || null;

  // FSDJump → system info + coords
  for (const ev of fsdJumpEvents) {
    const key = ev.StarSystem.toLowerCase();
    addressMap[ev.SystemAddress] = ev.StarSystem;
    const existing = systemsMap.get(key);
    if (!existing || ev.timestamp > existing.lastSeen) {
      systemsMap.set(key, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        population: ev.Population != null ? ev.Population : (existing ? existing.population : 0),
        economy: ev.SystemEconomy_Localised || ev.SystemEconomy || (existing && existing.economy) || 'Unknown',
        economyLocalised: ev.SystemEconomy_Localised || ev.SystemEconomy || (existing && existing.economyLocalised) || 'Unknown',
        secondEconomy: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || (existing && existing.secondEconomy),
        secondEconomyLocalised: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || (existing && existing.secondEconomyLocalised),
        coordinates: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : (existing && existing.coordinates),
        visitCount: systemVisitCounts.get(key),
        lastSeen: ev.timestamp,
      });
    }
  }

  // Location → may include station metadata if Docked
  for (const ev of locationEvents) {
    const key = ev.StarSystem.toLowerCase();
    addressMap[ev.SystemAddress] = ev.StarSystem;
    const existing = systemsMap.get(key);
    if (!existing || ev.timestamp > existing.lastSeen) {
      systemsMap.set(key, {
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        population: ev.Population != null ? ev.Population : (existing ? existing.population : 0),
        economy: ev.SystemEconomy_Localised || ev.SystemEconomy || (existing && existing.economy) || 'Unknown',
        economyLocalised: ev.SystemEconomy_Localised || ev.SystemEconomy || (existing && existing.economyLocalised) || 'Unknown',
        secondEconomy: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || (existing && existing.secondEconomy),
        secondEconomyLocalised: ev.SystemSecondEconomy_Localised || ev.SystemSecondEconomy || (existing && existing.secondEconomyLocalised),
        coordinates: ev.StarPos ? { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] } : (existing && existing.coordinates),
        visitCount: (existing && existing.visitCount) != null ? existing.visitCount : systemVisitCounts.get(key),
        lastSeen: ev.timestamp,
      });
    }
    if (ev.Docked && ev.MarketID && ev.StationName && ev.StationType) {
      const economies = (ev.StationEconomies || []).map((e) => ({
        name: e.Name,
        nameLocalised: e.Name_Localised || e.Name,
        proportion: e.Proportion,
      }));
      const existingSt = stationsMap.get(ev.MarketID);
      if (!existingSt || ev.timestamp > existingSt.lastSeen) {
        stationsMap.set(ev.MarketID, {
          stationName: ev.StationName,
          stationType: ev.StationType,
          marketId: ev.MarketID,
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          body: ev.Body,
          bodyType: ev.BodyType,
          distFromStarLS: ev.DistFromStarLS != null ? ev.DistFromStarLS : null,
          landingPads: ev.LandingPads
            ? { small: ev.LandingPads.Small, medium: ev.LandingPads.Medium, large: ev.LandingPads.Large }
            : null,
          economies,
          services: ev.StationServices || [],
          faction: ev.StationFaction && ev.StationFaction.Name,
          visitCount: (existingSt && existingSt.visitCount) != null ? existingSt.visitCount : stationVisitCounts.get(ev.MarketID),
          lastSeen: ev.timestamp,
        });
      }
      if (isFleetCarrier(ev.StationType, ev.MarketID) && isFleetCarrierCallsign(ev.StationName)) {
        const ownership = classifyFleetCarrier(ev.StationName, ev.MarketID, _myCallsign, _myFcMid, _sCallsigns);
        fcMap.set(ev.StationName, { callsign: ev.StationName, marketId: ev.MarketID, ownership });
      }
    }
  }

  // Docked → station metadata
  for (const ev of dockedEvents) {
    addressMap[ev.SystemAddress] = ev.StarSystem;
    const economies = (ev.StationEconomies || []).map((e) => ({
      name: e.Name,
      nameLocalised: e.Name_Localised || e.Name,
      proportion: e.Proportion,
    }));
    const existingSt = stationsMap.get(ev.MarketID);
    if (!existingSt || ev.timestamp > existingSt.lastSeen) {
      stationsMap.set(ev.MarketID, {
        stationName: ev.StationName,
        stationType: ev.StationType,
        marketId: ev.MarketID,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        body: ev.Body,
        bodyType: ev.BodyType,
        distFromStarLS: ev.DistFromStarLS != null ? ev.DistFromStarLS : null,
        landingPads: ev.LandingPads
          ? { small: ev.LandingPads.Small, medium: ev.LandingPads.Medium, large: ev.LandingPads.Large }
          : null,
        economies,
        services: ev.StationServices || [],
        faction: ev.StationFaction && ev.StationFaction.Name,
        visitCount: stationVisitCounts.get(ev.MarketID),
        lastSeen: ev.timestamp,
      });
    }
    if (isFleetCarrier(ev.StationType, ev.MarketID) && isFleetCarrierCallsign(ev.StationName)) {
      const ownership = classifyFleetCarrier(ev.StationName, ev.MarketID, _myCallsign, _myFcMid, _sCallsigns);
      fcMap.set(ev.StationName, { callsign: ev.StationName, marketId: ev.MarketID, ownership });
    }
  }

  // SupercruiseEntry → address map only
  for (const ev of supercruiseEntryEvents) {
    addressMap[ev.SystemAddress] = ev.StarSystem;
  }

  // FSSSignalDiscovered
  for (const ev of fssSignalEvents) {
    fssSignals.push({
      signalName: ev.SignalName_Localised || ev.SignalName,
      signalType: ev.SignalType || '',
      isStation: ev.IsStation != null ? ev.IsStation : false,
      systemAddress: ev.SystemAddress,
      timestamp: ev.timestamp,
    });
  }

  // Touchdown → body visits
  const bodyVisitsMap = new Map();
  for (const ev of touchdownEvents) {
    if (ev.PlayerControlled === false) continue;
    const k = `${ev.SystemAddress}|${ev.Body}`;
    const existing = bodyVisitsMap.get(k);
    if (existing) {
      existing.landingCount += 1;
      if (ev.timestamp > existing.lastLanded) {
        existing.lastLanded = ev.timestamp;
        existing.lastCoords = { lat: ev.Latitude, lon: ev.Longitude };
      }
    } else {
      bodyVisitsMap.set(k, {
        bodyName: ev.Body,
        systemName: ev.StarSystem,
        systemAddress: ev.SystemAddress,
        landingCount: 1,
        lastLanded: ev.timestamp,
        lastCoords: { lat: ev.Latitude, lon: ev.Longitude },
      });
    }
  }

  return {
    systems: Array.from(systemsMap.values()),
    stations: Array.from(stationsMap.values()),
    systemAddressMap: addressMap,
    fssSignals,
    fleetCarriers: Array.from(fcMap.values()),
    claimedSystems: Array.from(new Set(systemClaimEvents.map((e) => e.StarSystem))),
    bodyVisits: Array.from(bodyVisitsMap.values()),
  };
}

export function extractKnowledgeBase(journalDir, settings) {
  const parsed = scanAllJournalsParsed(journalDir);
  return extractKnowledgeBaseFromEvents(parsed, settings || {});
}

// ===== Dock history (dossier backfill) =====

export function extractDockHistory(journalDir) {
  const out = new Map();
  const files = listJournalFiles(journalDir);
  for (const jf of files) {
    const parsed = parseJournalFile(jf.fullPath);
    if (!parsed) continue;
    for (const ev of parsed.dockedEvents) {
      if (!ev.MarketID) continue;
      // Count by MarketID across the station's full lifecycle — only skip
      // truly permanent ephemerals (Fleet Carriers, Trailblazer NPCs).
      // Construction Site / Colonisation Ship docks ARE counted because the
      // MarketID becomes a real station later (Frontier reuses the MID).
      if (isPermanentlyEphemeral(ev.StationName, ev.StationType, ev.MarketID)) continue;
      const faction = ev.StationFaction && ev.StationFaction.Name;
      const state = ev.StationFaction && ev.StationFaction.FactionState;
      const existing = out.get(ev.MarketID);
      const isPlaceholder = typeof ev.StationName === 'string'
        && /\$EXT_PANEL_ColonisationShip|Construction Site/i.test(ev.StationName);
      if (!existing) {
        out.set(ev.MarketID, {
          marketId: ev.MarketID,
          // Seed with whatever name we have; later non-placeholder docks overwrite it
          stationName: ev.StationName,
          systemName: ev.StarSystem,
          systemAddress: ev.SystemAddress,
          firstDocked: ev.timestamp,
          lastDocked: ev.timestamp,
          dockedCount: 1,
          currentFaction: faction != null ? faction : null,
          currentFactionState: state != null ? state : null,
          factionHistory: [],
          stateHistory: [],
        });
        continue;
      }
      existing.dockedCount += 1;
      if (ev.timestamp > existing.lastDocked) {
        existing.lastDocked = ev.timestamp;
        // Only update stationName with non-placeholder names — once "Ma Gateway"
        // is known we don't want a later re-read of an old Construction Site
        // dock to revert the label.
        if (ev.StationName && !isPlaceholder) {
          existing.stationName = ev.StationName;
        }
      }
      if (ev.timestamp < existing.firstDocked) existing.firstDocked = ev.timestamp;
      if (faction && existing.currentFaction && faction !== existing.currentFaction) {
        existing.factionHistory.push({ name: existing.currentFaction, changedAt: ev.timestamp });
        if (existing.factionHistory.length > 5) existing.factionHistory.shift();
      }
      if (faction) existing.currentFaction = faction;
      if (state && existing.currentFactionState && state !== existing.currentFactionState) {
        existing.stateHistory.push({ state, changedAt: ev.timestamp });
        if (existing.stateHistory.length > 10) existing.stateHistory.shift();
      }
      if (state) existing.currentFactionState = state;
    }
  }
  return out;
}

// ===== Travel-time matrix =====

/**
 * Build a matrix of station-pair travel times keyed by
 * `${fromMarketId}:${toMarketId}:${shipId}`. Only counts sourcing-relevant
 * trips (MarketBuy / CargoTransfer / ColonisationContribution during the
 * dock window at the from-station). Outlier-trimmed at 2× median.
 *
 * Returns `{ stats, latestShip }`. latestShip is useful for startup to
 * seed the commander's current ship when no Loadout has fired yet this session.
 */
export function extractStationTravelTimes(journalDir) {
  const files = listJournalFiles(journalDir);
  const trips = new Map();
  let activeShipId = null;
  let latestShip = null;
  let currentDock = null;
  let pendingUndock = null;

  for (const jf of files) {
    let text;
    try { text = fs.readFileSync(jf.fullPath, 'utf-8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      switch (ev.event) {
        case 'Loadout':
          if (ev.ShipID != null) {
            activeShipId = ev.ShipID;
            latestShip = {
              shipId: ev.ShipID,
              type: ev.Ship || '',
              name: ev.ShipName,
              ident: ev.ShipIdent,
              cargoCapacity: ev.CargoCapacity,
            };
          }
          break;
        case 'ShipyardSwap':
          if (ev.ShipID != null) {
            activeShipId = ev.ShipID;
            latestShip = { shipId: ev.ShipID, type: ev.ShipType || '' };
          }
          break;
        case 'Docked':
          currentDock = {
            stationName: ev.StationName,
            marketId: ev.MarketID,
            dockedAt: ev.timestamp,
            sourcingSeen: false,
          };
          break;
        case 'MarketBuy':
        case 'CargoTransfer':
        case 'ColonisationContribution':
        case 'ColonisationFactionContribution':
          if (currentDock) currentDock.sourcingSeen = true;
          break;
        case 'Undocked':
          if (currentDock) {
            pendingUndock = Object.assign({}, currentDock, {
              shipId: activeShipId,
              undockedAt: ev.timestamp,
            });
            currentDock = null;
          }
          break;
        case 'FSDJump':
        case 'CarrierJump':
          pendingUndock = null;
          break;
        default:
          break;
      }
      // When the NEXT Docked lands, pair it with the pendingUndock
      if (ev.event === 'Docked' && currentDock && pendingUndock) {
        const h = pendingUndock;
        if (h.shipId != null && h.sourcingSeen && currentDock.marketId && h.marketId) {
          const dt = (new Date(ev.timestamp).getTime() - new Date(h.undockedAt).getTime()) / 1000;
          if (dt > 0 && dt < 3 * 3600) {
            const key = `${h.marketId}:${currentDock.marketId}:${h.shipId}`;
            const existing = trips.get(key) || { durations: [], lastTripAt: ev.timestamp, pair: key };
            existing.durations.push(dt);
            if (ev.timestamp > existing.lastTripAt) existing.lastTripAt = ev.timestamp;
            trips.set(key, existing);
          }
        }
        pendingUndock = null;
      }
    }
  }

  const stats = {};
  for (const [key, list] of trips) {
    if (list.durations.length === 0) continue;
    const sorted = list.durations.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const cap = median * 2;
    const trimmed = list.durations.filter((d) => d <= cap);
    if (trimmed.length === 0) continue;
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    const recent = trimmed.slice(-10);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    stats[key] = {
      avgSeconds: avg,
      recentAvgSeconds: recentAvg,
      tripCount: trimmed.length,
      lastTripAt: list.lastTripAt,
    };
  }
  return { stats, latestShip };
}

// ===== Exploration data =====

export function extractExplorationData(journalDir) {
  const files = listJournalFiles(journalDir);
  const systemMap = new Map();
  const addressToName = new Map();
  const addressToCoords = new Map();

  for (const jf of files) {
    const parsed = parseJournalFile(jf.fullPath);
    if (!parsed) continue;
    for (const ev of parsed.fsdJumpEvents) {
      addressToName.set(ev.SystemAddress, ev.StarSystem);
      if (ev.StarPos) addressToCoords.set(ev.SystemAddress, { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] });
    }
    for (const ev of parsed.locationEvents) {
      addressToName.set(ev.SystemAddress, ev.StarSystem);
      if (ev.StarPos) addressToCoords.set(ev.SystemAddress, { x: ev.StarPos[0], y: ev.StarPos[1], z: ev.StarPos[2] });
    }
    for (const ev of parsed.fssDiscoveryScanEvents) {
      const name = ev.SystemName || addressToName.get(ev.SystemAddress) || `Unknown (${ev.SystemAddress})`;
      const existing = systemMap.get(ev.SystemAddress);
      if (!existing) {
        systemMap.set(ev.SystemAddress, {
          systemAddress: ev.SystemAddress,
          systemName: name,
          coordinates: addressToCoords.get(ev.SystemAddress) || null,
          bodyCount: ev.BodyCount,
          fssAllBodiesFound: false,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      } else {
        existing.bodyCount = ev.BodyCount;
        if (ev.timestamp > existing.lastSeen) existing.lastSeen = ev.timestamp;
        if (!existing.systemName.startsWith('Unknown')) existing.systemName = name;
      }
    }
    for (const ev of parsed.fssAllBodiesFoundEvents) {
      const existing = systemMap.get(ev.SystemAddress);
      if (existing) {
        existing.fssAllBodiesFound = true;
        if (ev.timestamp > existing.lastSeen) existing.lastSeen = ev.timestamp;
      } else {
        const name = ev.SystemName || addressToName.get(ev.SystemAddress) || `Unknown (${ev.SystemAddress})`;
        systemMap.set(ev.SystemAddress, {
          systemAddress: ev.SystemAddress,
          systemName: name,
          coordinates: addressToCoords.get(ev.SystemAddress) || null,
          bodyCount: ev.Count || 0,
          fssAllBodiesFound: true,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      }
    }
    for (const ev of parsed.scanEvents) {
      const addr = ev.SystemAddress;
      if (!addr) continue;
      const name = ev.StarSystem || addressToName.get(addr) || `Unknown (${addr})`;
      if (!systemMap.has(addr)) {
        systemMap.set(addr, {
          systemAddress: addr,
          systemName: name,
          coordinates: addressToCoords.get(addr) || null,
          bodyCount: 0,
          fssAllBodiesFound: false,
          scannedBodies: [],
          lastSeen: ev.timestamp,
        });
      }
      const sys = systemMap.get(addr);
      if (ev.timestamp > sys.lastSeen) sys.lastSeen = ev.timestamp;
      if (ev.PlanetClass === 'Belt Cluster') continue;
      if (!ev.PlanetClass && !ev.StarType) continue;

      const body = {
        bodyId: ev.BodyID,
        bodyName: ev.BodyName,
        type: ev.StarType ? 'Star' : 'Planet',
        subType: ev.PlanetClass || (ev.StarType ? mapStarType(ev.StarType) : 'Unknown'),
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
        rings: ev.Rings ? ev.Rings.map((r) => ({
          name: r.Name, ringClass: r.RingClass, outerRad: r.OuterRad, massKG: r.MassMT,
        })) : undefined,
        parents: ev.Parents,
        wasDiscovered: ev.WasDiscovered,
        wasMapped: ev.WasMapped,
      };
      const existingIdx = sys.scannedBodies.findIndex((b) => b.bodyId === ev.BodyID || b.bodyName === ev.BodyName);
      if (existingIdx >= 0) {
        sys.scannedBodies[existingIdx] = body;
      } else {
        sys.scannedBodies.push(body);
      }
    }
  }

  for (const [addr, sys] of systemMap) {
    if (!sys.coordinates) sys.coordinates = addressToCoords.get(addr) || null;
    if (sys.systemName.startsWith('Unknown')) {
      const name = addressToName.get(addr);
      if (name) sys.systemName = name;
    }
  }
  return systemMap;
}

// ===== Visited markets =====

export function scanForVisitedMarkets(journalDir) {
  const allDocked = [];
  const allMarketBuy = [];
  const files = listJournalFiles(journalDir);
  for (const jf of files) {
    const parsed = parseJournalFile(jf.fullPath);
    if (!parsed) continue;
    allDocked.push(...parsed.dockedEvents);
    allMarketBuy.push(...parsed.marketBuyEvents);
  }

  const stationMap = new Map();
  for (const ev of allDocked) {
    const existing = stationMap.get(ev.MarketID);
    if (!existing || ev.timestamp > existing.timestamp) stationMap.set(ev.MarketID, ev);
  }

  const commodityMap = new Map();
  for (const buy of allMarketBuy) {
    const journalName = buy.Type.startsWith('$')
      ? buy.Type.toLowerCase()
      : `$${buy.Type.replace(/\s+/g, '').toLowerCase()}_name;`;
    const def = findCommodityByJournalName(journalName) || findCommodityByDisplayName(buy.Type);
    if (!def) continue;
    let entry = commodityMap.get(buy.MarketID);
    if (!entry) {
      entry = { commodities: new Set(), lastBuy: buy.timestamp, prices: {} };
      commodityMap.set(buy.MarketID, entry);
    }
    entry.commodities.add(def.id);
    if (buy.timestamp > entry.lastBuy) entry.lastBuy = buy.timestamp;
    const existing = entry.prices[def.id];
    if (!existing || buy.timestamp > existing.lastSeen) {
      entry.prices[def.id] = { buyPrice: buy.BuyPrice, lastSeen: buy.timestamp };
    }
  }

  // Also fold in current Market.json (colonisation commodities actually for sale)
  try {
    const market = readMarketJson(journalDir);
    if (market && market.items) {
      for (const item of market.items) {
        if (item.stock <= 0 || item.buyPrice <= 0) continue;
        const def = findCommodityByDisplayName(item.nameLocalised || item.name)
          || findCommodityByDisplayName(item.name)
          || findCommodityByJournalName(`$${String(item.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
        if (!def) continue;
        let entry = commodityMap.get(market.marketId);
        if (!entry) {
          entry = { commodities: new Set(), lastBuy: market.timestamp, prices: {} };
          commodityMap.set(market.marketId, entry);
        }
        entry.commodities.add(def.id);
        if (!entry.prices[def.id]) {
          entry.prices[def.id] = { buyPrice: item.buyPrice, lastSeen: market.timestamp };
        }
      }
      if (!stationMap.has(market.marketId) && market.stationName && market.systemName) {
        stationMap.set(market.marketId, {
          timestamp: market.timestamp,
          event: 'Docked',
          StationName: market.stationName,
          StarSystem: market.systemName,
          StationType: '',
          MarketID: market.marketId,
          Docked: true,
        });
      }
    }
  } catch { /* optional */ }

  const results = [];
  for (const [marketId, buyData] of commodityMap) {
    const station = stationMap.get(marketId);
    if (!station) continue;
    results.push({
      marketId,
      stationName: station.StationName,
      systemName: station.StarSystem,
      stationType: station.StationType,
      isPlanetary: PLANETARY_STATION_TYPES.has(station.StationType),
      hasLargePads: station.LandingPads
        ? (station.LandingPads.Large || 0) > 0
        : inferHasLargePads(station.StationType),
      commodities: Array.from(buyData.commodities),
      commodityPrices: buyData.prices,
      lastVisited: buyData.lastBuy,
    });
  }
  return results.sort((a, b) => b.lastVisited.localeCompare(a.lastVisited));
}

