// Raven Colonial's build table by any station-type string the app meets (1.60.28): app installation
// ids, journal StationTypes (and the generic "Outpost" / "SurfaceStation" every colony primary is
// written as, told apart by the market's economy), FSS signal types. Figures are Raven's own
// (src/data/ravenBuildTypes.json).
import { describe, it, expect } from 'vitest';
import { ravenFor, economyKind, resolveGenericOutpost, RAVEN_BUILD_TYPES } from '../src/lib/ravenTypes.ts';

const APP_IDS = [
  'agriculture_settlement_large', 'agriculture_settlement_medium', 'agriculture_settlement_small', 'asteroid_starport',
  'bio_settlement_large', 'bio_settlement_medium', 'bio_settlement_small', 'civilian_hub', 'civilian_outpost',
  'civilian_surface_outpost', 'commercial_outpost', 'communication_installation', 'coriolis_starport', 'dodec_starport',
  'exploration_hub', 'extraction_hub', 'government_installation', 'high_tech_hub', 'industrial_hub', 'industrial_outpost',
  'industrial_settlement_large', 'industrial_settlement_medium', 'industrial_settlement_small', 'industrial_surface_outpost',
  'large_planetary_port', 'medical_installation', 'military_hub', 'military_installation', 'military_outpost',
  'military_settlement_large', 'military_settlement_medium', 'military_settlement_small', 'mining_industrial_installation',
  'mining_settlement_large', 'mining_settlement_medium', 'mining_settlement_small', 'ocellus_starport', 'orbis_starport',
  'outpost_hub', 'pirate_base_installation', 'pirate_outpost', 'refinery_hub', 'relay_installation', 'research_installation',
  'satellite_installation', 'scientific_hub', 'scientific_outpost', 'scientific_surface_outpost', 'security_installation',
  'space_bar_installation', 'space_farm', 'tourist_installation', 'tourist_settlement_large', 'tourist_settlement_medium',
  'tourist_settlement_small',
];

describe('the table', () => {
  it('holds the 55 real builds and none of the placeholders', () => {
    expect(RAVEN_BUILD_TYPES).toHaveLength(55);
    expect(RAVEN_BUILD_TYPES.every((e) => e.tier > 0)).toBe(true);
  });
  it('every app installation id resolves to a build', () => {
    for (const id of APP_IDS) expect(ravenFor(id)?.displayName2, id).toBeTruthy();
    // the app's id names the build exactly where the names differ most
    expect(ravenFor('mining_industrial_installation').displayName2).toBe('Mining/Industrial Installation');
    expect(ravenFor('space_bar_installation').displayName2).toBe('Space Bar Installation');
    expect(ravenFor('outpost_hub').displayName2).toBe('Outpost Hub');
    expect(ravenFor('high_tech_hub').displayName2).toBe('High Tech Hub');
    expect(ravenFor('pirate_base_installation').displayName2).toBe('Pirate Base Installation');
    expect(ravenFor('pirate_outpost').displayName2).toBe('Pirate Outpost');
  });
});

describe('ravenFor — starports and ports', () => {
  it('journal and app vocabularies land on the same entries', () => {
    expect(ravenFor('CraterPort').displayName2).toBe('Large Planetary Port');
    expect(ravenFor('large_planetary_port').haul).toBe(215597);
    expect(ravenFor('StationDodec').effects.tech).toBe(8);
    expect(ravenFor('dodec_starport').haul).toBe(236000);
    expect(ravenFor('Coriolis').haul).toBe(63001);
    expect(ravenFor('StationCoriolis').displayName2).toBe('Coriolis Starport');
    expect(ravenFor('AsteroidBase').displayName2).toBe('Asteroid Starport');
    expect(ravenFor('StationAsteroid').haul).toBe(53546);
    expect(ravenFor('Orbis').effects.tech).toBe(7);
    expect(ravenFor('Ocellus').haul).toBe(219135);
  });
});

describe('ravenFor — outposts', () => {
  it("the journal's generic outpost is named by the market's economy", () => {
    expect(ravenFor('Outpost', '$economy_Military;').displayName2).toBe('Military Outpost');
    expect(ravenFor('Outpost', 'High Tech').displayName2).toBe('Scientific Outpost');
    expect(ravenFor('SurfaceStation', '$economy_Industrial;').displayName2).toBe('Industrial Outpost');
    expect(ravenFor('Outpost', 'Colony').displayName2).toBe('Civilian Outpost');
    expect(ravenFor('Outpost', 'Extraction Refinery').displayName2).toBe('Commercial Outpost');
    expect(ravenFor('Outpost').displayName2).toBe('Commercial Outpost');
    expect(ravenFor('StationOutpost', 'Military').displayName2).toBe('Military Outpost');
  });
  it('surface outposts: the app ids directly, the journal CraterOutpost by economy', () => {
    expect(ravenFor('civilian_surface_outpost').displayName2).toBe('Civilian Surface Outpost');
    expect(ravenFor('civilian_surface_outpost').haul).toBe(35950);
    expect(ravenFor('industrial_surface_outpost').displayName2).toBe('Industrial Surface Outpost');
    expect(ravenFor('scientific_surface_outpost').effects.tech).toBe(5);
    expect(ravenFor('CraterOutpost', 'High Tech').displayName2).toBe('Scientific Surface Outpost');
    expect(ravenFor('CraterOutpost', 'Industrial').displayName2).toBe('Industrial Surface Outpost');
    expect(ravenFor('CraterOutpost').displayName2).toBe('Civilian Surface Outpost');
    expect(ravenFor('military_outpost').haul).toBe(20952);
    expect(ravenFor('scientific_outpost').effects.tech).toBe(3);
  });
});

describe('ravenFor — settlements, hubs, installations', () => {
  it('settlements by size and kind', () => {
    expect(ravenFor('agriculture_settlement_large').displayName2).toBe('Agriculture Settlement: Large');
    expect(ravenFor('agriculture_settlement_large').haul).toBe(8517);
    expect(ravenFor('bio_settlement_large').effects.tech).toBe(10);
    expect(ravenFor('mining_settlement_small').haul).toBe(2837);
    expect(ravenFor('tourist_settlement_medium').displayName2).toBe('Tourist Settlement: Medium');
    expect(ravenFor('military_settlement_small').haul).toBe(3553);
  });
  it('hubs and installations', () => {
    expect(ravenFor('refinery_hub').displayName2).toBe('Refinery Hub');
    expect(ravenFor('industrial_hub').displayName2).toBe('Industrial Hub');
    expect(ravenFor('civilian_hub').displayName2).toBe('Civilian Hub');
    expect(ravenFor('scientific_hub').effects.tech).toBe(10);
    expect(ravenFor('military_hub').displayName2).toBe('Military Hub');
    expect(ravenFor('security_installation').haul).toBe(10089);
    expect(ravenFor('military_installation').displayName2).toBe('Military Installation');
    expect(ravenFor('relay_installation').haul).toBe(6855);
    expect(ravenFor('space_farm').displayName2).toBe('Space Farm');
    expect(ravenFor('research_installation').effects.tech).toBe(8);
    expect(ravenFor('medical_installation').displayName2).toBe('Medical Installation');
    expect(ravenFor('communication_installation').effects.tech).toBe(3);
  });
  it('nothing for carriers, depots, ships, blanks and the generic FSS types', () => {
    for (const t of ['FleetCarrier', 'SquadronCarrier', 'SpaceConstructionDepot', 'PlanetaryConstructionDepot', 'ColonisationShip', 'MegaShip', '', null, undefined, 'Unknown', 'Installation', 'OnFootSettlement']) {
      expect(ravenFor(t), String(t)).toBeNull();
    }
  });
});

describe('economyKind / resolveGenericOutpost', () => {
  it('reads the dossier strings', () => {
    expect(economyKind('$economy_HighTech;')).toBe('hightech');
    expect(economyKind('High Tech')).toBe('hightech');
    expect(economyKind('$economy_Military; Extraction')).toBe('military');
    expect(economyKind('Agri')).toBe('agriculture');
    expect(economyKind('Terraforming')).toBeNull();
    expect(economyKind('')).toBeNull();
    expect(economyKind(undefined)).toBeNull();
  });
  it('names the generic outposts and leaves everything else alone', () => {
    expect(resolveGenericOutpost('Outpost', 'Military')).toBe('military_outpost');
    expect(resolveGenericOutpost('SurfaceStation', '$economy_HighTech;')).toBe('scientific_outpost');
    expect(resolveGenericOutpost('Outpost', 'Industrial')).toBe('industrial_outpost');
    expect(resolveGenericOutpost('Outpost', 'Colony')).toBe('civilian_outpost');
    expect(resolveGenericOutpost('Outpost', 'Extraction Refinery')).toBe('commercial_outpost');
    expect(resolveGenericOutpost('CraterOutpost', 'Military')).toBe('CraterOutpost');
    expect(resolveGenericOutpost('military_outpost', 'High Tech')).toBe('military_outpost');
    expect(resolveGenericOutpost('', 'Military')).toBe('');
  });
});
