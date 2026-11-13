// A dock at a finished station completes its project and retypes the dossier (1.60.29). The case:
// Core Boson Complex crossed 100% between the last depot reading (99.5%) and the next dock, at the
// port itself typed CraterPort, so no depot event ever carried ConstructionComplete.
import { describe, it, expect, vi } from 'vitest';
import { applyDockToStationPatch, processDepotEvents } from '../server/journal/processors.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const ADDR = 1797401856371;
const CBC = 4391682051;
const AT = '2026-10-07T04:24:13Z';

function existing(over = {}) {
  return {
    settings: {},
    knownStations: {
      [CBC]: { stationName: 'Core Boson Complex Cbc', stationType: 'PlanetaryConstructionDepot', marketId: CBC, systemName: SYS, systemAddress: ADDR, firstDocked: '2026-09-22T03:59:24Z', lastDocked: '2026-10-07T04:11:19Z', dockedCount: 30, economies: [], services: [] },
      4355571459: { stationName: 'Chiang Bastion', stationType: 'military_outpost', marketId: 4355571459, systemName: SYS, systemAddress: ADDR, firstDocked: '2026-04-21T02:10:00Z', lastDocked: '2026-10-03T15:35:20Z', dockedCount: 41, economies: [], services: [] },
    },
    projects: [
      { id: 'cbc', name: 'AX-J d9-52 - Planetary Construction Site: Core Boson Complex Cbc', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: 'Planetary Construction Site: Core Boson Complex Cbc', marketId: CBC, status: 'active', completedAt: null, completedStationName: null, completedStationType: null, commodities: [] },
    ],
    ...over,
  };
}
const payload = (over = {}) => ({ stationName: 'Core Boson Complex Cbc', stationType: 'CraterPort', systemName: SYS, systemAddress: ADDR, timestamp: AT, faction: 'HIP 104349 Ring', factionState: undefined, services: ['dock'], economies: [{ name: 'Industrial', proportion: 1 }], primaryEconomy: 'Industrial', ...over });

describe('applyDockToStationPatch — completion by dock', () => {
  it('a dock at an active project\'s market id as a finished station completes the project and retypes the dossier', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const patch = {};
    applyDockToStationPatch(patch, existing(), CBC, payload());
    const p = patch.projects.__upsert.cbc;
    expect(patch.projects.__idKey).toBe('id');
    expect(p).toMatchObject({ status: 'completed', completedAt: AT, completedStationName: 'Core Boson Complex Cbc', completedStationType: 'CraterPort', lastUpdatedAt: AT });
    const st = patch.knownStations.__upsert[String(CBC)];
    expect(st.stationType).toBe('CraterPort');
    expect(st.stationName).toBe('Core Boson Complex Cbc');
    expect(st.dockedCount).toBe(31);
    expect(st.firstDocked).toBe('2026-09-22T03:59:24Z');
    vi.restoreAllMocks();
  });
  it('a dock at the construction site completes nothing and keeps the depot type', () => {
    const patch = {};
    applyDockToStationPatch(patch, existing(), CBC, payload({ stationName: 'Planetary Construction Site: Core Boson Complex Cbc', stationType: 'PlanetaryConstructionDepot', timestamp: '2026-10-07T04:11:19.500Z' }));
    expect(patch.projects).toBeUndefined();
    expect(patch.knownStations.__upsert[String(CBC)].stationType).toBe('PlanetaryConstructionDepot');
  });
  it('a type the commander set stands against the journal\'s generic one; a blank dossier type takes the dock\'s', () => {
    const patch = {};
    applyDockToStationPatch(patch, existing(), 4355571459, payload({ stationName: 'Chiang Bastion', stationType: 'Outpost' }));
    expect(patch.knownStations.__upsert['4355571459'].stationType).toBe('military_outpost');
    expect(patch.projects).toBeUndefined();
    const fresh = {};
    applyDockToStationPatch(fresh, existing({ knownStations: {} }), 777, payload({ stationName: 'New Place', stationType: 'Outpost' }));
    expect(fresh.knownStations.__upsert['777'].stationType).toBe('Outpost');
  });
  it('an already completed project without a name still gets the dock\'s name (the old path), and is not completed twice', () => {
    const patch = {};
    const ex = existing({ projects: [{ ...existing().projects[0], status: 'completed', completedAt: '2026-10-07T04:20:00Z' }] });
    applyDockToStationPatch(patch, ex, CBC, payload());
    const p = patch.projects.__upsert.cbc;
    expect(p.completedAt).toBe('2026-10-07T04:20:00Z');
    expect(p.completedStationName).toBe('Core Boson Complex Cbc');
    expect(p.completedStationType).toBe('CraterPort');
  });
});

describe('processDepotEvents — completion and healing (1.60.30)', () => {
  const MID = 3964283138;
  const depot = (over = {}) => ({ timestamp: '2026-10-07T05:49:29Z', event: 'ColonisationConstructionDepot', MarketID: MID, ConstructionProgress: 1, ConstructionComplete: true, ConstructionFailed: false, ResourcesRequired: [{ Name: '$steel_name;', Name_Localised: 'Steel', RequiredAmount: 2285, ProvidedAmount: 2285, Payment: 1 }], ...over });
  const project = (over = {}) => ({ id: 'pr', name: 'Depot 3964283138', systemName: SYS, systemAddress: ADDR, stationType: 'SpaceConstructionDepot', stationName: 'Orbital Construction Site: Plait Reach', marketId: MID, status: 'active', completedAt: null, completedStationName: null, completedStationType: null, commodities: [], ...over });
  const site = { stationName: 'Orbital Construction Site: Plait Reach', stationType: 'SpaceConstructionDepot', marketId: MID, systemName: SYS, systemAddress: ADDR };
  it("an installation completes with the site's own name — nothing will ever dock there — and the placeholder name goes", () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const patch = {};
    processDepotEvents({ depotEvents: [depot()], dockedEvents: [] }, { projects: [project()], knownStations: { [MID]: site } }, patch);
    const p = patch.projects.__upsert.pr;
    expect(p.status).toBe('completed');
    expect(p.completedAt).toBe('2026-10-07T05:49:29Z');
    expect(p.completedStationName).toBe('Plait Reach');
    expect(p.name).toBe(`${SYS} - Orbital Construction Site: Plait Reach`);
    expect(patch.knownStations.__upsert[String(MID)].stationName).toBe('Plait Reach');
    vi.restoreAllMocks();
  });
  it('a blind-created project heals on an ordinary depot tick once the dossier knows the station', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const patch = {};
    processDepotEvents({ depotEvents: [depot({ ConstructionComplete: false, ConstructionProgress: 0.5 })], dockedEvents: [] }, { projects: [project({ systemName: '', stationName: '', systemAddress: null, stationType: '' })], knownStations: { [MID]: site } }, patch);
    expect(patch.projects.__upsert.pr).toMatchObject({ status: 'active', systemName: SYS, stationName: 'Orbital Construction Site: Plait Reach', systemAddress: ADDR, name: `${SYS} - Orbital Construction Site: Plait Reach` });
    vi.restoreAllMocks();
  });
  it('a typed name survives every tick', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const patch = {};
    processDepotEvents({ depotEvents: [depot({ ConstructionComplete: false, ConstructionProgress: 0.5 })], dockedEvents: [] }, { projects: [project({ name: 'The relay I always wanted' })], knownStations: { [MID]: site } }, patch);
    expect(patch.projects.__upsert.pr.name).toBe('The relay I always wanted');
    vi.restoreAllMocks();
  });
});
