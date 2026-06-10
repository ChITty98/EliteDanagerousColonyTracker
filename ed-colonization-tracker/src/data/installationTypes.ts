/**
 * Complete installation type dataset for ED colonization.
 *
 * Sources:
 * - Raven Colonial's verified type list (canonical id/name/tier/T2-T3 points)
 * - CMDR Mechan's Elite Dangerous Colonization Mega Guide v2.3.0
 *   (https://docs.google.com/document/with-the-guide — Appendix C for systemScore,
 *   strong-link mechanics for economyBonuses, "How Colony-Type Ports Gain Economies"
 *   for body-modifier semantics)
 * - User's own build-plan reference (memory: reference_colony_building.md) for
 *   commodity buildRequirements on 8 types (Military Outpost, Civilian Surface
 *   Outpost, Relay Installation, Security Installation, Large Settlements,
 *   Planetary Port, Dodec, Asteroid Starport).
 *
 * Optional fields (buildRequirements, economyBonuses, commodityProduction,
 * notes, systemScore) populate gradually — sparse data is fine, the optimizer
 * gracefully degrades when a type is missing data.
 */

export interface BuildRequirement {
  /** Commodity id matching src/data/commodities.ts */
  commodityId: string;
  /** Tonnage required (canonical observed median across user's completed builds) */
  quantity: number;
}

export interface EconomyBonus {
  /**
   * Economy name as Frontier writes it: 'Agriculture' | 'Extraction' | 'Refinery'
   * | 'Industrial' | 'HighTech' | 'Military' | 'Tourism' | 'Contraband' | 'Terraforming'
   */
  economy: string;
  /**
   * Decimal contribution before modifiers, per the Mega Guide's strong-link
   * strength values: 0.4 (T1), 0.8 (T2), 1.2 (T3) for strong links;
   * 0.05 for weak links. Modifier multipliers handled by the optimizer.
   */
  strength: number;
}

export interface InstallationType {
  /** Unique identifier, e.g. "coriolis_starport" */
  id: string;
  /** Display name, e.g. "Coriolis Starport" */
  name: string;
  /** Location category */
  location: 'Orbital' | 'Surface';
  /** Landing pad size, null = no pads */
  padSize: 'L' | 'M' | 'S' | null;
  /** Tier of this installation (1/2/3) */
  tier: 1 | 2 | 3;
  /** Points contributed toward Tier 2 (Settlement) */
  t2Points: number;
  /** Points contributed toward Tier 3 (Colony) */
  t3Points: number;
  /** Raw journal StationType values that may map to this type */
  journalTypes?: string[];
  /**
   * Per-build commodity tonnage required. Sourced from user's reference build
   * plan + backfilled from observed completed projects (tools/backfill-installation-builds.mjs).
   * Optional — when absent, the optimizer falls back to typical tier totals.
   */
  buildRequirements?: BuildRequirement[];
  /**
   * Sum of commodity quantities in buildRequirements — convenience field for
   * sorting/comparison. Populated lazily; null/undefined means "compute from
   * buildRequirements if needed".
   */
  totalTonnage?: number;
  /**
   * Economies this installation type contributes to via strong links when
   * placed in the same local body as a port, or via weak links to other
   * ports in the system. Strength values are raw (pre-modifier).
   */
  economyBonuses?: EconomyBonus[];
  /**
   * Commodity ids this installation type generates / produces (e.g. surface
   * Refinery → 'cmmcomposite'). Used to identify local-sourcing opportunities.
   */
  commodityProduction?: string[];
  /**
   * Appendix C system score value from the Mega Guide. Tier 1 typically 3,
   * Tier 2 small settlements 1-2, Tier 2 hubs 4-5, T3 starports 15, etc.
   */
  systemScore?: number;
  /** Freeform notes for special cases / known bugs / build-order tips. */
  notes?: string;
}

export const INSTALLATION_TYPES: InstallationType[] = [
  // === ORBITAL ===

  // Orbital Starports (Large pad, Tier 2-3)
  { id: 'coriolis_starport', name: 'Coriolis Starport', location: 'Orbital', padSize: 'L', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Coriolis'] },
  { id: 'asteroid_starport', name: 'Asteroid Starport', location: 'Orbital', padSize: 'L', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['AsteroidBase'] },
  { id: 'dodec_starport', name: 'Dodec Spaceport', location: 'Orbital', padSize: 'L', tier: 3, t2Points: 0, t3Points: 0, journalTypes: ['StationDodec'] },
  { id: 'ocellus_starport', name: 'Ocellus Starport', location: 'Orbital', padSize: 'L', tier: 3, t2Points: 0, t3Points: 0, journalTypes: ['Ocellus'] },
  { id: 'orbis_starport', name: 'Orbis Starport', location: 'Orbital', padSize: 'L', tier: 3, t2Points: 0, t3Points: 0, journalTypes: ['Orbis'] },

  // Orbital Outposts (Medium pad, Tier 1)
  { id: 'commercial_outpost', name: 'Commercial Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },
  { id: 'industrial_outpost', name: 'Industrial Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },
  { id: 'pirate_outpost', name: 'Pirate Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },
  { id: 'civilian_outpost', name: 'Civilian Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },
  { id: 'scientific_outpost', name: 'Scientific Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },
  { id: 'military_outpost', name: 'Military Outpost', location: 'Orbital', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Outpost'] },

  // Orbital Installations (No pads, Tier 1-2)
  { id: 'satellite_installation', name: 'Satellite Installation', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'communication_installation', name: 'Communication Installation', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'space_farm', name: 'Space Farm', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'pirate_base_installation', name: 'Pirate Base Installation', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'mining_industrial_installation', name: 'Mining/Industrial Installation', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'relay_installation', name: 'Relay Installation', location: 'Orbital', padSize: null, tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['Installation'] },
  { id: 'military_installation', name: 'Military Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'security_installation', name: 'Security Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'government_installation', name: 'Government Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'medical_installation', name: 'Medical Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'research_installation', name: 'Research Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'tourist_installation', name: 'Tourist Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },
  { id: 'space_bar_installation', name: 'Space Bar Installation', location: 'Orbital', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['Installation'] },

  // === SURFACE ===

  // Surface Outposts (Large pad, Tier 1)
  { id: 'civilian_surface_outpost', name: 'Civilian Surface Outpost', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['CraterOutpost', 'PlanetaryOutpost', 'SurfaceOutpost'] },
  { id: 'industrial_surface_outpost', name: 'Industrial Surface Outpost', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['CraterOutpost', 'PlanetaryOutpost', 'SurfaceOutpost'] },
  { id: 'scientific_surface_outpost', name: 'Scientific Surface Outpost', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['CraterOutpost', 'PlanetaryOutpost', 'SurfaceOutpost'] },

  // Large Planetary Port (Tier 3)
  { id: 'large_planetary_port', name: 'Large Planetary Port', location: 'Surface', padSize: 'L', tier: 3, t2Points: 0, t3Points: 0, journalTypes: ['CraterPort', 'PlanetaryPort', 'SurfaceStation'] },

  // Agriculture Settlements
  { id: 'agriculture_settlement_small', name: 'Agriculture Settlement: Small', location: 'Surface', padSize: 'S', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'agriculture_settlement_medium', name: 'Agriculture Settlement: Medium', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'agriculture_settlement_large', name: 'Agriculture Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 1, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Mining Settlements
  { id: 'mining_settlement_small', name: 'Mining Settlement: Small', location: 'Surface', padSize: 'S', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'mining_settlement_medium', name: 'Mining Settlement: Medium', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'mining_settlement_large', name: 'Mining Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 1, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Industrial Settlements
  { id: 'industrial_settlement_small', name: 'Industrial Settlement: Small', location: 'Surface', padSize: 'S', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'industrial_settlement_medium', name: 'Industrial Settlement: Medium', location: 'Surface', padSize: 'L', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'industrial_settlement_large', name: 'Industrial Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 1, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Military Settlements
  { id: 'military_settlement_small', name: 'Military Settlement: Small', location: 'Surface', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'military_settlement_medium', name: 'Military Settlement: Medium', location: 'Surface', padSize: 'M', tier: 1, t2Points: 1, t3Points: 0, journalTypes: ['OnFootSettlement'] },
  { id: 'military_settlement_large', name: 'Military Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 1, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Bio Settlements (T3 only)
  { id: 'bio_settlement_small', name: 'Bio Settlement: Small', location: 'Surface', padSize: 'S', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'bio_settlement_medium', name: 'Bio Settlement: Medium', location: 'Surface', padSize: 'S', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'bio_settlement_large', name: 'Bio Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 0, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Tourist Settlements
  { id: 'tourist_settlement_small', name: 'Tourist Settlement: Small', location: 'Surface', padSize: 'M', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'tourist_settlement_medium', name: 'Tourist Settlement: Medium', location: 'Surface', padSize: 'L', tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'tourist_settlement_large', name: 'Tourist Settlement: Large', location: 'Surface', padSize: 'L', tier: 2, t2Points: 0, t3Points: 2, journalTypes: ['OnFootSettlement'] },

  // Surface Hubs (No pads, Tier 2)
  { id: 'extraction_hub', name: 'Extraction Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'civilian_hub', name: 'Civilian Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'exploration_hub', name: 'Exploration Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'outpost_hub', name: 'Outpost Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'scientific_hub', name: 'Scientific Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'military_hub', name: 'Military Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'refinery_hub', name: 'Refinery Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'high_tech_hub', name: 'High Tech Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
  { id: 'industrial_hub', name: 'Industrial Hub', location: 'Surface', padSize: null, tier: 2, t2Points: 0, t3Points: 1, journalTypes: ['OnFootSettlement'] },
];

// =============================================================================
// systemScore values per Appendix C of the Colonization Mega Guide v2.3.0
// by CMDR Mechan. Single-system contribution to the system score metric.
// =============================================================================
const SYSTEM_SCORES: Record<string, number> = {
  coriolis_starport: 8,
  asteroid_starport: 8,
  dodec_starport: 15,
  ocellus_starport: 15,
  orbis_starport: 15,
  commercial_outpost: 3,
  industrial_outpost: 3,
  pirate_outpost: 3,
  civilian_outpost: 3,
  scientific_outpost: 3,
  military_outpost: 3,
  satellite_installation: 3,
  communication_installation: 3,
  space_farm: 2,
  pirate_base_installation: 3,
  mining_industrial_installation: 2,
  relay_installation: 3,
  military_installation: 4,
  security_installation: 3,
  government_installation: 3,
  medical_installation: 4,
  research_installation: 4,
  tourist_installation: 3,
  space_bar_installation: 4,
  civilian_surface_outpost: 4,
  industrial_surface_outpost: 4,
  scientific_surface_outpost: 4,
  large_planetary_port: 15,
  agriculture_settlement_small: 1,
  agriculture_settlement_medium: 2,
  agriculture_settlement_large: 4,
  mining_settlement_small: 1,
  mining_settlement_medium: 2,
  mining_settlement_large: 4,
  industrial_settlement_small: 1,
  industrial_settlement_medium: 2,
  industrial_settlement_large: 4,
  military_settlement_small: 1,
  military_settlement_medium: 2,
  military_settlement_large: 4,
  bio_settlement_small: 2,
  bio_settlement_medium: 2,
  bio_settlement_large: 4,
  tourist_settlement_small: 1,
  tourist_settlement_medium: 2,
  tourist_settlement_large: 4,
  extraction_hub: 5,
  civilian_hub: 5,
  exploration_hub: 5,
  outpost_hub: 5,
  scientific_hub: 5,
  military_hub: 5,
  refinery_hub: 5,
  high_tech_hub: 5,
  industrial_hub: 5,
};

// =============================================================================
// buildRequirements — observed median commodity tonnage per build.
// Source: user's `reference_colony_building.md` build-plan reference (8 types).
// Remaining types populated lazily via tools/backfill-installation-builds.mjs
// which derives medians from completed-project depot data.
// =============================================================================
const BUILD_REQUIREMENTS: Record<string, BuildRequirement[]> = {
  // Military Outpost (T1 orbital) — 18,988t
  military_outpost: [
    { commodityId: 'steel', quantity: 5588 },
    { commodityId: 'cmmcomposite', quantity: 3912 },
    { commodityId: 'titanium', quantity: 4843 },
    { commodityId: 'aluminium', quantity: 515 },
    { commodityId: 'water', quantity: 1553 },
    { commodityId: 'ceramiccomposites', quantity: 497 },
    { commodityId: 'polymers', quantity: 497 },
    { commodityId: 'semiconductors', quantity: 56 },
    { commodityId: 'superconductors', quantity: 100 },
    { commodityId: 'copper', quantity: 217 },
    { commodityId: 'liquidoxygen', quantity: 1553 },
    { commodityId: 'insulatingmembrane', quantity: 311 },
    { commodityId: 'computercomponents', quantity: 50 },
    { commodityId: 'foodcartridges', quantity: 94 },
  ],
  // Civilian Surface Outpost (T1 surface) — 36,829t
  civilian_surface_outpost: [
    { commodityId: 'steel', quantity: 10164 },
    { commodityId: 'cmmcomposite', quantity: 6776 },
    { commodityId: 'titanium', quantity: 5760 },
    { commodityId: 'aluminium', quantity: 7047 },
    { commodityId: 'water', quantity: 2372 },
    { commodityId: 'ceramiccomposites', quantity: 814 },
    { commodityId: 'polymers', quantity: 678 },
    { commodityId: 'copper', quantity: 407 },
    { commodityId: 'buildingfabricators', quantity: 678 },
    { commodityId: 'surfacestabilisers', quantity: 610 },
    { commodityId: 'structuralregulators', quantity: 204 },
    { commodityId: 'landenrichmentsystems', quantity: 68 },
    { commodityId: 'evacuationshelter', quantity: 68 },
    { commodityId: 'emergencypowercells', quantity: 55 },
    { commodityId: 'semiconductors', quantity: 102 },
    { commodityId: 'superconductors', quantity: 136 },
    { commodityId: 'computercomponents', quantity: 102 },
    { commodityId: 'foodcartridges', quantity: 136 },
  ],
  // Relay Installation (T1 orbital) — 6,721t
  relay_installation: [
    { commodityId: 'steel', quantity: 2437 },
    { commodityId: 'titanium', quantity: 1755 },
    { commodityId: 'aluminium', quantity: 1033 },
    { commodityId: 'water', quantity: 780 },
    { commodityId: 'ceramiccomposites', quantity: 98 },
    { commodityId: 'polymers', quantity: 195 },
    { commodityId: 'semiconductors', quantity: 39 },
    { commodityId: 'superconductors', quantity: 59 },
    { commodityId: 'insulatingmembrane', quantity: 122 },
    { commodityId: 'copper', quantity: 88 },
    { commodityId: 'computercomponents', quantity: 25 },
    { commodityId: 'foodcartridges', quantity: 30 },
  ],
  // Security Installation (T2 orbital) — 10,082t
  security_installation: [
    { commodityId: 'steel', quantity: 3645 },
    { commodityId: 'titanium', quantity: 2309 },
    { commodityId: 'aluminium', quantity: 1774 },
    { commodityId: 'water', quantity: 1458 },
    { commodityId: 'polymers', quantity: 243 },
    { commodityId: 'insulatingmembrane', quantity: 183 },
    { commodityId: 'ceramiccomposites', quantity: 122 },
    { commodityId: 'copper', quantity: 122 },
    { commodityId: 'semiconductors', quantity: 13 },
    { commodityId: 'battleweapons', quantity: 25 },
    { commodityId: 'microcontrollers', quantity: 19 },
    { commodityId: 'structuralregulators', quantity: 13 },
  ],
  // Planetary Port (T3 surface) — 216,030t
  large_planetary_port: [
    { commodityId: 'steel', quantity: 60984 },
    { commodityId: 'cmmcomposite', quantity: 40656 },
    { commodityId: 'titanium', quantity: 34560 },
    { commodityId: 'aluminium', quantity: 42282 },
    { commodityId: 'water', quantity: 14232 },
    { commodityId: 'ceramiccomposites', quantity: 4884 },
    { commodityId: 'polymers', quantity: 2712 },
    { commodityId: 'buildingfabricators', quantity: 2712 },
    { commodityId: 'surfacestabilisers', quantity: 3660 },
    { commodityId: 'landenrichmentsystems', quantity: 272 },
    { commodityId: 'copper', quantity: 2442 },
    { commodityId: 'semiconductors', quantity: 408 },
    { commodityId: 'superconductors', quantity: 544 },
    { commodityId: 'computercomponents', quantity: 408 },
    { commodityId: 'emergencypowercells', quantity: 220 },
    { commodityId: 'evacuationshelter', quantity: 272 },
    { commodityId: 'structuralregulators', quantity: 816 },
    { commodityId: 'foodcartridges', quantity: 544 },
    { commodityId: 'liquidoxygen', quantity: 14232 },
  ],
  // Dodec Starport (T3 orbital) — ~210,000t (estimate; user reference notes Dodec not in DaftMav CSV)
  dodec_starport: [
    { commodityId: 'steel', quantity: 56304 },
    { commodityId: 'cmmcomposite', quantity: 45044 },
    { commodityId: 'titanium', quantity: 32820 },
    { commodityId: 'aluminium', quantity: 40220 },
    { commodityId: 'water', quantity: 6436 },
    { commodityId: 'liquidoxygen', quantity: 15124 },
  ],
  // Asteroid Starport (T2 orbital) — 53,723t
  asteroid_starport: [
    { commodityId: 'steel', quantity: 14076 },
    { commodityId: 'cmmcomposite', quantity: 11261 },
    { commodityId: 'titanium', quantity: 8205 },
    { commodityId: 'aluminium', quantity: 10055 },
    { commodityId: 'water', quantity: 1609 },
    { commodityId: 'liquidoxygen', quantity: 3781 },
    { commodityId: 'ceramiccomposites', quantity: 1207 },
    { commodityId: 'polymers', quantity: 1046 },
    { commodityId: 'insulatingmembrane', quantity: 644 },
    { commodityId: 'copper', quantity: 644 },
    { commodityId: 'powergenerators', quantity: 65 },
    { commodityId: 'waterpurifiers', quantity: 105 },
    { commodityId: 'computercomponents', quantity: 145 },
    { commodityId: 'semiconductors', quantity: 161 },
    { commodityId: 'superconductors', quantity: 282 },
  ],
};

// Apply systemScore and buildRequirements to INSTALLATION_TYPES entries.
// Mutation is fine here — these are tagged data sources applied once at module load.
for (const t of INSTALLATION_TYPES) {
  if (SYSTEM_SCORES[t.id] !== undefined) t.systemScore = SYSTEM_SCORES[t.id];
  const reqs = BUILD_REQUIREMENTS[t.id];
  if (reqs) {
    t.buildRequirements = reqs;
    t.totalTonnage = reqs.reduce((sum, r) => sum + r.quantity, 0);
  }
}

/** Lookup by id */
export const INSTALLATION_TYPE_MAP: Record<string, InstallationType> = {};
for (const t of INSTALLATION_TYPES) {
  INSTALLATION_TYPE_MAP[t.id] = t;
}

/**
 * Colony-type ports: their economy is inherited from the host body's base
 * economies. Specialized ports (Industrial Outpost, Scientific Outpost,
 * Military Outpost, Pirate Outpost, Asteroid Starport, etc.) have fixed
 * economy types and ignore body inheritance.
 *
 * Source: CMDR Mechan's Colonization Mega Guide v2.3.0 — "How Colony-Type
 * Ports Gain Economies".
 */
export const COLONY_PORT_IDS = new Set<string>([
  'civilian_outpost',
  'commercial_outpost',
  'coriolis_starport',
  'orbis_starport',
  'ocellus_starport',
  'dodec_starport',
  'civilian_surface_outpost',
  'large_planetary_port',
]);

/**
 * Specialized installations whose economy is fixed by their type (not inherited).
 * Used when a station's journal-reported `economies` array is empty and we need
 * to infer what economy it provides.
 */
export const SPECIALIZED_TYPE_ECONOMY: Record<string, string> = {
  industrial_outpost: 'Industrial',
  scientific_outpost: 'HighTech',
  military_outpost: 'Military',
  asteroid_starport: 'Extraction',
  industrial_surface_outpost: 'Industrial',
  scientific_surface_outpost: 'HighTech',
  // Hubs
  extraction_hub: 'Extraction',
  refinery_hub: 'Refinery',
  industrial_hub: 'Industrial',
  high_tech_hub: 'HighTech',
  military_hub: 'Military',
  scientific_hub: 'HighTech',
  exploration_hub: 'HighTech',
  // Settlements (large/medium/small share economy by family)
  agriculture_settlement_small: 'Agriculture',
  agriculture_settlement_medium: 'Agriculture',
  agriculture_settlement_large: 'Agriculture',
  mining_settlement_small: 'Extraction',
  mining_settlement_medium: 'Extraction',
  mining_settlement_large: 'Extraction',
  industrial_settlement_small: 'Industrial',
  industrial_settlement_medium: 'Industrial',
  industrial_settlement_large: 'Industrial',
  military_settlement_small: 'Military',
  military_settlement_medium: 'Military',
  military_settlement_large: 'Military',
  bio_settlement_small: 'HighTech',
  bio_settlement_medium: 'HighTech',
  bio_settlement_large: 'HighTech',
  tourist_settlement_small: 'Tourism',
  tourist_settlement_medium: 'Tourism',
  tourist_settlement_large: 'Tourism',
  // Other named installations
  space_farm: 'Agriculture',
  military_installation: 'Military',
  security_installation: 'Military',
  medical_installation: 'HighTech',
  research_installation: 'HighTech',
  tourist_installation: 'Tourism',
  space_bar_installation: 'Tourism',
  mining_industrial_installation: 'Extraction',
};

/** Get installation type by id */
export function getInstallationTypeById(id: string): InstallationType | undefined {
  return INSTALLATION_TYPE_MAP[id];
}

/** Get all possible installation types for a raw journal StationType */
export function getInstallationTypesForJournalType(journalType: string): InstallationType[] {
  return INSTALLATION_TYPES.filter((t) => t.journalTypes?.includes(journalType));
}

/** Grouped list for dropdowns: Orbital first, then Surface */
export const INSTALLATION_TYPE_OPTIONS: { value: string; label: string; group: string }[] =
  INSTALLATION_TYPES.map((t) => ({
    value: t.id,
    label: t.name,
    group: t.location,
  }));

/**
 * Compute T2/T3 point totals from a list of installation type IDs and/or raw journal types.
 * For installations without a specific installationTypeId, falls back to the first matching
 * journal type entry (conservative — uses lowest tier match).
 */
export function computeTierPoints(
  installations: Array<{ installationTypeId?: string; stationType?: string }>
): { t2Total: number; t3Total: number } {
  let t2Total = 0;
  let t3Total = 0;
  for (const inst of installations) {
    let iType: InstallationType | undefined;
    if (inst.installationTypeId) {
      iType = INSTALLATION_TYPE_MAP[inst.installationTypeId];
    }
    // stationType is dual-purpose: dropdowns write installation-type IDs directly into it
    if (!iType && inst.stationType && INSTALLATION_TYPE_MAP[inst.stationType]) {
      iType = INSTALLATION_TYPE_MAP[inst.stationType];
    }
    if (!iType && inst.stationType) {
      // Fall back to first match for journal type (conservative default)
      const matches = getInstallationTypesForJournalType(inst.stationType);
      if (matches.length === 1) {
        iType = matches[0];
      }
      // If multiple matches, we can't determine the exact type — skip point counting
    }
    if (iType) {
      t2Total += iType.t2Points;
      t3Total += iType.t3Points;
    }
  }
  return { t2Total, t3Total };
}
