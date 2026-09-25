/**
 * Port of the self-contained classification / identification helpers
 * originally in src/services/journalReader.ts.
 *
 * ESM so server.mjs can `import` named helpers directly. esbuild bundles
 * this into server-bundled.cjs for the SEA exe; Node resolves it natively
 * in dev mode via `node server.mjs`.
 */

/**
 * Module-scope registry of MarketIDs known to be Fleet Carriers, populated
 * from the persisted dossier (knownStations) at server startup and updated
 * on every Docked event with StationType === 'FleetCarrier'. Replaces the
 * old marketId-range guess (>= 3.7B) which false-positived every player-built
 * station that lives in the same range.
 */
const KNOWN_FC_MARKET_IDS = new Set();

/** Seed the FC registry from a knownStations dossier (call at server boot). */
export function seedFcRegistryFromKnownStations(knownStations) {
  if (!knownStations || typeof knownStations !== 'object') return;
  for (const k of Object.keys(knownStations)) {
    const s = knownStations[k];
    if (s && s.stationType === 'FleetCarrier') {
      const id = Number(k);
      if (!Number.isNaN(id)) KNOWN_FC_MARKET_IDS.add(id);
    }
  }
}

/** Register a MarketID as a known FC (call when StationType is confirmed FleetCarrier). */
export function registerFcMarketId(marketId) {
  if (typeof marketId === 'number') KNOWN_FC_MARKET_IDS.add(marketId);
}

/** True only if we've seen this MarketID confirmed as an FC via journal data. */
export function isKnownFcMarketId(marketId) {
  return typeof marketId === 'number' && KNOWN_FC_MARKET_IDS.has(marketId);
}

/**
 * Legacy export — kept so call sites don't break. Now backed by the FC registry
 * instead of the broken marketId-range guess. Returns true ONLY for confirmed FCs.
 */
export function isFleetCarrierMarketId(marketId) {
  return isKnownFcMarketId(marketId);
}

/** Fleet Carrier callsigns match pattern XXX-XXX (letters/digits). */
const FC_CALLSIGN_REGEX = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
export function isFleetCarrierCallsign(name) {
  return typeof name === 'string' && FC_CALLSIGN_REGEX.test(name);
}

/**
 * Robust FC detection. Order matters:
 *   1. StationType === 'FleetCarrier'  → trusted, return true
 *   2. StationType is known but NOT 'FleetCarrier' → trust the type, return false
 *   3. Fall back to FC registry lookup (populated from prior journal evidence)
 *
 * No more marketId-range guess. If we haven't seen this marketId before AND
 * stationType is missing, return false. False negative (treating an FC as a
 * generic station once) is fixable on the next Docked event when StationType
 * arrives; false positive (treating Cavallo Nero / Ma Gateway as an FC) is
 * what caused the snapshot drop bug.
 */
export function isFleetCarrier(stationType, marketId) {
  if (stationType === 'FleetCarrier') return true;
  if (stationType && stationType !== 'FleetCarrier') return false;
  if (marketId != null && isKnownFcMarketId(marketId)) return true;
  return false;
}

/**
 * Markets that are not buyers, whatever their listing says. Ardent carries every market the game
 * uploads, and some kinds list every commodity at the price cap with 999,999 demand: on 2026-09-11,
 * within 500 ly of HIP 52629, every construction depot (49 orbital, 13 planetary), 22 of 23 on-foot
 * settlements and all 4 stronghold carriers "paid" 1,038,104 for Thortveitite, against 15% of Coriolis
 * stations and 29% of outposts. A galaxy-best built on those is a schema artifact, not a price
 * ("I have a hard time believing orbital construction sites pay"). Fleet carriers are the older
 * exclusion: a carrier's price is one commander's order, not a market.
 */
export const NON_BUYER_STATION_TYPES = new Set(['FleetCarrier', 'SpaceConstructionDepot', 'PlanetaryConstructionDepot', 'OnFootSettlement', 'StrongholdCarrier']);
export function isNonBuyerMarket(stationType) {
  if (!stationType) return false;
  return NON_BUYER_STATION_TYPES.has(stationType) || /ConstructionDepot$/i.test(stationType);
}

/**
 * Landing pads on an Ardent listing: 1 small, 2 medium, 3 large. When the listing does not say, the
 * station type settles it for the kinds that always carry a large pad (journal and Ardent spellings
 * both); an outpost never does, so it stays unknown and fails a large-pad requirement.
 */
const LARGE_PAD_STATION_TYPES = new Set(['Coriolis', 'Orbis', 'Ocellus', 'Bernal', 'Dodec', 'StationDodec', 'AsteroidBase', 'CraterPort', 'PlanetaryPort', 'SurfaceStation', 'MegaShip']);
export function padOfListing(row) {
  const p = row ? Number(row.maxLandingPadSize) : NaN;
  if (p >= 1 && p <= 3) return p;
  return row && LARGE_PAD_STATION_TYPES.has(row.stationType) ? 3 : null;
}
/**
 * A buyer the ship can actually dock at. "It's got to be a large landing pad" (2026-09-11): the price
 * ladder and the daily sample require a large pad outright; the Sell page passes the pad the hull in
 * use needs. An unknown pad fails when large is required — a haul cannot be planned on a guess.
 */
export function padFits(row, need = 3) {
  const p = padOfListing(row);
  return p != null && p >= need;
}

/**
 * Permanently ephemeral = never becomes a real station at the same MarketID.
 * These MarketIDs should NEVER be tracked for visit counts:
 *  - Fleet carriers (mobile — the MarketID stays an FC forever)
 *  - Trailblazer ships (NPC colonization helpers — transient NPCs)
 *
 * Contrast with Construction Site / Colonisation Ship names, which are
 * lifecycle phases of a MarketID that WILL become a real station. Those
 * docks should count toward the eventual station's visit total. Use
 * `isPermanentlyEphemeral` for visit counting; use `isEphemeralStation`
 * for dock-welcome suppression during the construction phase.
 */
export function isPermanentlyEphemeral(stationName, stationType, marketId) {
  if (isFleetCarrier(stationType, marketId)) return true;
  if (typeof stationName === 'string' && /^Trailblazer /i.test(stationName)) return true;
  return false;
}

/**
 * Ephemeral dock = not a "place you visit" in the narrative sense RIGHT NOW:
 *  - Fleet carriers (mobile)
 *  - Trailblazer ships (NPC colonization helpers)
 *  - Colonisation ships ($EXT_PANEL_ColonisationShip; prefix or "Colonisation Ship" in name)
 *  - Construction sites (replaced by the finished station once built)
 * Used by dock-welcome suppression. For visit-count tracking use
 * `isPermanentlyEphemeral` so construction-phase docks are still tallied
 * against the eventual MarketID.
 */
export function isEphemeralStation(stationName, stationType, marketId) {
  if (isFleetCarrier(stationType, marketId)) return true;
  if (!stationName) return false;
  if (/^Trailblazer /i.test(stationName)) return true;
  if (/Colonisation Ship/i.test(stationName)) return true;
  if (/\$EXT_PANEL_ColonisationShip/i.test(stationName)) return true;
  if (/Construction Site/i.test(stationName)) return true;
  return false;
}

/** Classify a fleet carrier as 'mine', 'squadron', or 'other'. */
export function classifyFleetCarrier(stationName, marketId, myCallsign, myMarketId, squadronCallsigns) {
  if (myCallsign && stationName === myCallsign) return 'mine';
  if (myMarketId && marketId === myMarketId) return 'mine';
  if (Array.isArray(squadronCallsigns) && squadronCallsigns.some((cs) => cs === stationName)) return 'squadron';
  return 'other';
}

/** Station name indicates it's still under construction. */
export function isConstructionStationName(stationName) {
  return typeof stationName === 'string' && /construction/i.test(stationName);
}

/** Station name/type is a colonisation ship (temporary during colonization). */
export function isColonisationShip(stationName, stationType) {
  if (stationType === 'ColonisationShip') return true;
  if (typeof stationName !== 'string') return false;
  return /\$EXT_PANEL_ColonisationShip/i.test(stationName) || /colonisation\s*ship/i.test(stationName);
}

/**
 * A construction project's identity for a market id — station and system names, address, type —
 * from whatever has seen the depot: the Docked event in this batch, the persisted current dock, or
 * the station dossier. The watcher starts at the end of the journal on boot, so a project
 * auto-created from a depot event alone can carry blank names ("Depot 4389829123 ()" at Kewell
 * Range, 2026-09-14); this fills them in, at creation and on every later depot tick.
 * @param {number} marketId
 * @param {{ dockedEvents?: any[], currentDock?: any, knownStations?: Record<string, any> }} sources
 * @returns {{ stationName: string, systemName: string, systemAddress: number|null, stationType: string }}
 */
export function depotIdentity(marketId, sources = {}) {
  const dockEv = (sources.dockedEvents || []).find((d) => d && d.MarketID === marketId) || null;
  const dock = sources.currentDock && sources.currentDock.marketId === marketId ? sources.currentDock : null;
  const ks = sources.knownStations || {};
  const known = ks[String(marketId)] || Object.values(ks).find((st) => st && st.marketId === marketId) || null;
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) || '';
  const addr = [dockEv && dockEv.SystemAddress, known && known.systemAddress].find((v) => typeof v === 'number');
  return {
    stationName: pick(dockEv && dockEv.StationName, dock && dock.stationName, known && known.stationName),
    systemName: pick(dockEv && dockEv.StarSystem, dock && dock.systemName, known && known.systemName),
    systemAddress: typeof addr === 'number' ? addr : null,
    stationType: pick(dockEv && dockEv.StationType, known && known.stationType),
  };
}

/** The project name the app builds from an identity: "System - Station", or "Depot <marketId>" when nothing is known. */
export function depotProjectName(identity, marketId) {
  const sys = identity && identity.systemName;
  const st = identity && identity.stationName;
  return sys ? `${sys}${st ? ` - ${st}` : ''}` : `Depot ${marketId}`;
}

/**
 * A construction site can be renamed while it is still under construction (Espinoza Obligation →
 * Core Boson Complex Cbc, 2026-09-22, same market id). The depot handler heals only blank names, so
 * the project kept the old one. This says what to change on a project for the identity now seen:
 * the station name when both are construction-site names and differ, and the display name only if
 * it is still the auto-built "System - Station" for the old names — a name the commander typed is
 * never touched. Returns null when there is nothing to follow.
 */
export function depotRename(project, ident, marketId) {
  const next = ident && ident.stationName;
  const prev = project && project.stationName;
  if (!next || !prev || next === prev) return null;
  if (!isConstructionStationName(next) || !isConstructionStationName(prev)) return null;
  const out = { stationName: next };
  const auto = depotProjectName({ systemName: project.systemName, stationName: prev }, marketId);
  if (!project.name || project.name === auto) {
    out.name = depotProjectName({ systemName: project.systemName || ident.systemName, stationName: next }, marketId);
  }
  return out;
}
