/**
 * Complete installation type dataset for ED colonization.
 * Sourced from Raven Colonial's verified type list.
 *
 * Each type has fixed properties: pad size, tier, T2/T3 point generation.
 */

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

/** Lookup by id */
export const INSTALLATION_TYPE_MAP: Record<string, InstallationType> = {};
for (const t of INSTALLATION_TYPES) {
  INSTALLATION_TYPE_MAP[t.id] = t;
}

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
