/**
 * Type declarations for the proportional population estimate (populationEstimate.js) —
 * consumed by the server-side docking overlay and the browser UI through the
 * src/lib/populationEstimate.ts re-export shim.
 */
export type PopulationClass = 'planetary_port' | 'dodec' | 'orbis' | 'ocellus' | 'surface_outpost' | 'outpost_mil' | 'coriolis' | 'unit' | 'none' | 'unknown';

export interface PopulationAddition {
  value: number;
  low: number | null;
  high: number | null;
  days: number | null;
  n: number;
  basis: string;
}

export const POPULATION_ADDITIONS: Readonly<Record<PopulationClass, PopulationAddition>>;
export function populationAdditionFor(stationType: string | null | undefined): PopulationAddition;

export interface FacilityInput {
  key: string;
  stationType: string | null | undefined;
  /** ISO opening date (the project's completion); ramps a new facility's weight in over its class's measured window (1.60.29) */
  openedAt?: string | null;
}

export interface FacilityEstimate {
  estimate: number | null;
  share: number | null;
  cls: PopulationClass;
  units: number;
  /** the facility's measured addition — the weight of the split */
  addition: number;
  weight: number;
  /** how far into its opening window the facility is, 0..1 — 1 when fully grown or undated (1.60.29) */
  ramp: number;
  openedAt: string | null;
  basis: string;
  /** set when a remembered floor is carrying the figure (1.60.26) */
  held?: { population: number; at: string | null };
  /** the current share when a floor is carrying the figure */
  split?: number;
}

export interface PopulationEstimateResult {
  population: number;
  counted: number;
  /** the sum of the facilities' additions */
  baseline: number;
  totalWeight: number;
  byKey: Record<string, FacilityEstimate>;
}

export function populationClass(stationType: string | null | undefined): { cls: PopulationClass; units: number };
export function estimateFacilityPopulations(systemPopulation: number | null | undefined, facilities: ReadonlyArray<FacilityInput>, now?: number): PopulationEstimateResult;
export function rampFraction(cls: PopulationClass, openedAt: string | null | undefined, now?: number): number;
export function formatEstimatedPopulation(n: number | null | undefined): string;
export function describeFacilityEstimate(est: FacilityEstimate | null | undefined, now?: number): string | null;
export function effectiveSystemPopulation(
  known: { population?: number | null; lastSeen?: string | null } | null | undefined,
  override: { population?: number | null; updatedAt?: string | null } | null | undefined,
): number;
export function agoLabel(iso: string | null | undefined, now?: number): string | null;
export function describePopulationTrend(
  previous: { population?: number | null; at?: string | null } | null | undefined,
  current: number | null | undefined,
  now?: number,
): string | null;

export type PopulationFloors = Record<string, { population: number; at: string }>;
export function floorKey(systemName: string | null | undefined, facilityKey: string): string;
export function applyPopulationFloors(result: PopulationEstimateResult, systemName: string | null | undefined, floors: PopulationFloors | null | undefined, now?: string): { result: PopulationEstimateResult; raised: PopulationFloors };
