/**
 * Re-export shim — the canonical implementation lives in
 * server/journal/populationEstimate.js (one split for the docking overlay and the
 * system page). Types come from the adjacent populationEstimate.d.ts.
 */
export * from '../../server/journal/populationEstimate.js';
export type { FacilityInput, FacilityEstimate, PopulationEstimateResult, PopulationClass, PopulationFloors, PopulationAddition } from '../../server/journal/populationEstimate.js';
