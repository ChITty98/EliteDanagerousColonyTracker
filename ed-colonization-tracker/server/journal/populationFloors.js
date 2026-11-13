/**
 * "A facility's population never goes down" (1.60.26, the commander's rule) — server side.
 *
 * The proportional split re-divides the system total whenever the facility mix changes, so the day
 * a second planetary port opens every other figure would drop (Deshpande Plant 5.6M → 3.1M at the
 * same 196M). The floor remembers the highest figure each facility has shown and holds it until the
 * split climbs past it again. Floors live in state (`facilityPopulationFloor`, keyed
 * "<system lower>|<facility key>"), written only by the server: at every jump/login reading for a
 * colony, at every dock, and by Sync All. The page and the overlay display max(split, floor); the
 * pure pieces (floorKey, applyPopulationFloors) live in populationEstimate.js so the browser can
 * share them without this module's server-only imports.
 */
import { collectSystemFacilities } from './overlay.js';
import { estimateFacilityPopulations, effectiveSystemPopulation, applyPopulationFloors } from './populationEstimate.js';

/** Is this one of the commander's colonies (a project system or a manually marked one)? */
export function isColonySystem(existing, systemName) {
  const lower = String(systemName || '').toLowerCase();
  if (!lower) return false;
  const projects = Array.isArray(existing.projects) ? existing.projects : [];
  if (projects.some((p) => p && p.systemName && p.systemName.toLowerCase() === lower)) return true;
  const manual = Array.isArray(existing.manualColonizedSystems) ? existing.manualColonizedSystems : [];
  return manual.some((s) => String(s).toLowerCase() === lower);
}

/**
 * Raise the floors of every facility in a colony from its current population reading. Returns the
 * `{ __upsert }` patch value for facilityPopulationFloor, or null when nothing rises.
 * @param existing   full state
 * @param systemName the colony
 * @param population the system's population to split (omit to use the state's effective figure)
 * @param ev         optional dock event so the station being docked at is in the inventory
 */
export function raiseColonyFloors(existing, systemName, population, ev, now) {
  if (!isColonySystem(existing, systemName)) return null;
  const lower = String(systemName).toLowerCase();
  const P = population > 0 ? population
    : effectiveSystemPopulation((existing.knownSystems || {})[lower], (existing.populationOverrides || {})[lower]);
  if (!(P > 0)) return null;
  const known = (existing.knownSystems || {})[lower] || {};
  const scope = ev && ev.StationName
    ? { StationName: ev.StationName, StationType: ev.StationType, MarketID: ev.MarketID, StarSystem: systemName, SystemAddress: ev.SystemAddress || known.systemAddress }
    : { StationName: '', StationType: '', StarSystem: systemName, SystemAddress: known.systemAddress };
  const facilities = collectSystemFacilities(scope, existing, null);
  if (facilities.length === 0) return null;
  const result = estimateFacilityPopulations(P, facilities, now ? Date.parse(now) : undefined);
  const { raised } = applyPopulationFloors(result, systemName, existing.facilityPopulationFloor || {}, now);
  return Object.keys(raised).length ? { __upsert: raised } : null;
}
