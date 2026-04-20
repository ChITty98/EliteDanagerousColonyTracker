/**
 * Port of the self-contained classification / identification helpers
 * originally in src/services/journalReader.ts.
 *
 * ESM so server.mjs can `import` named helpers directly. esbuild bundles
 * this into server-bundled.cjs for the SEA exe; Node resolves it natively
 * in dev mode via `node server.mjs`.
 */

/**
 * Fleet Carrier MarketIDs live in the 3,700,000,000+ range.
 *
 * NOTE: player-colonized stations share this range, so this check ALONE
 * false-positives real stations (e.g. Ma Gateway). Prefer isFleetCarrier().
 */
export function isFleetCarrierMarketId(marketId) {
  return typeof marketId === 'number' && marketId >= 3700000000;
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
 *   3. Fall back to MarketID range only when StationType is unknown
 */
export function isFleetCarrier(stationType, marketId) {
  if (stationType === 'FleetCarrier') return true;
  if (stationType && stationType !== 'FleetCarrier') return false;
  if (marketId != null && isFleetCarrierMarketId(marketId)) return true;
  return false;
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
