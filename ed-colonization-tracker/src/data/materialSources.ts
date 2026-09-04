/**
 * "Is it rare, and where do I get more?"
 *
 * Grade alone does not answer that. G4 sounds mid-tier until you learn Polonium is a Rare that
 * only drops from crystalline shards on specific bodies, at which point a mission handing you 12
 * is worth taking regardless of anything else.
 *
 * Three layers, deliberately, so every material gets a real answer with nothing invented:
 *   1. RARITY   — from grade. These are the game's own labels, not our opinion.
 *   2. METHOD   — from category. Where that whole class of material comes from.
 *   3. HOTSPOT  — a specific, verified location. Curated, and thin on purpose: only entries
 *                 confirmed from a source go in. Absent is fine; wrong sends you 200 ly for nothing.
 */
import type { MaterialCategory, MaterialDefinition } from './engineeringMaterials';

/** ED's own rarity names for the five grades. */
export const GRADE_RARITY: Record<number, string> = {
  1: 'Very Common',
  2: 'Common',
  3: 'Standard',
  4: 'Rare',
  5: 'Very Rare',
};

/** Where a whole category comes from — true for every member of it. */
export const CATEGORY_METHOD: Record<MaterialCategory, string> = {
  raw: 'Planet surfaces — SRV prospecting, and crystalline shards for the high grades. Metallic meteorites and mesosiderites carry the better ones. Cannot be bought.',
  manufactured: 'Signal sources (High Grade Emissions), combat salvage, and settlement raids. Also common as mission rewards. Cannot be bought.',
  encoded: 'Data points at settlements, ship and wake scans, and signal sources. Also common as mission rewards. Cannot be bought.',
};

export interface MaterialHotspot {
  /** Material id, matching engineeringMaterials.ts. */
  id: string;
  body: string;
  lat?: number;
  lon?: number;
  note?: string;
}

/**
 * Verified farming locations. ONLY add an entry you have a source for — an absent hotspot
 * renders as "no known spot recorded", which costs nothing; a wrong one costs a trip.
 */
export const MATERIAL_HOTSPOTS: MaterialHotspot[] = [
  {
    id: 'polonium',
    body: 'HIP 36601 C 1 a',
    lat: -31.034637,
    lon: 14.85098,
    note: 'Crystalline shards. Pick a body with no competing G4/G5 (arsenic and friends) or the drops dilute.',
  },
];

const HOTSPOT_BY_ID = new Map(MATERIAL_HOTSPOTS.map((h) => [h.id, h]));

export function hotspotFor(id: string | undefined): MaterialHotspot | undefined {
  return id ? HOTSPOT_BY_ID.get(id) : undefined;
}

/** Everything the Reward page needs to answer "is it rare, and where do I get more?". */
export function acquisitionFor(mat: MaterialDefinition) {
  return {
    rarity: GRADE_RARITY[mat.grade] || 'Unknown',
    method: CATEGORY_METHOD[mat.category],
    hotspot: hotspotFor(mat.id),
  };
}
