// The Installations page's rows (1.60.28): every site of every colony from the dossier, completed
// projects, manual installations and FSS signals; carriers, construction sites and colonisation ships
// never count; the population split and floors are the ones the system page and the dock banner use.
// The fixture is the home system's shape (names and figures as the journals recorded them).
import { describe, it, expect } from 'vitest';
import { buildInstallationRows, summarizeInstallationRows, colonySystemNames, groupOf } from '../src/lib/installationRows.ts';
import { POPULATION_ADDITIONS as A, floorKey } from '../server/journal/populationEstimate.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const ADDR = 1797401856371;
const KEY = SYS.toLowerCase();
const P = 196_044_357;
const HIP = 'HIP 52629';
const HIP_ADDR = 1733187048154;
const P_HIP = 372_193_858;

const eco = (...pairs) => pairs.map(([n, p]) => ({ name: `$economy_${n.replace(/\s/g, '')};`, nameLocalised: n, proportion: p }));

function input(over = {}) {
  return {
    knownStations: {
      4355571459: { stationName: 'Chiang Bastion', stationType: 'Outpost', marketId: 4355571459, systemName: SYS, systemAddress: ADDR, body: `${SYS} 2`, primaryEconomy: '$economy_Military;', economies: eco(['Military', 1.0], ['Extraction', 0.3]), firstDocked: '2026-04-21T02:10:00Z', lastDocked: '2026-10-03T15:35:20Z', dockedCount: 41 },
      4355862019: { stationName: 'Deshpande Plant', stationType: 'civilian_surface_outpost', marketId: 4355862019, systemName: SYS, systemAddress: ADDR, body: `${SYS} 2 a`, economies: eco(['Industrial', 1.45], ['Extraction', 0.8]), firstDocked: '2026-05-16T01:00:00Z', lastDocked: '2026-10-05T03:12:00Z', dockedCount: 212 },
      4371599107: { stationName: 'Atmo Sky Cairn Asc', stationType: 'large_planetary_port', marketId: 4371599107, systemName: SYS, systemAddress: ADDR, body: `${SYS} 2 a`, economies: eco(['Industrial', 1.1], ['High Tech', 0.05]), firstDocked: '2026-08-02T00:00:00Z', lastDocked: '2026-09-30T00:00:00Z', dockedCount: 9 },
      3700000001: { stationName: 'Planetary Construction Site: Core Boson Complex', stationType: 'PlanetaryConstructionDepot', marketId: 3700000001, systemName: SYS, systemAddress: ADDR, economies: [], dockedCount: 30 },
      3700000002: { stationName: '$EXT_PANEL_ColonisationShip; Chiang Bastion', stationType: 'SurfaceStation', marketId: 3700000002, systemName: SYS, systemAddress: ADDR, economies: [] },
      3700000003: { stationName: 'Q2Z-9XT', stationType: 'FleetCarrier', marketId: 3700000003, systemName: SYS, systemAddress: ADDR, economies: eco(['Private Enterprise', 1]) },
      4200000001: { stationName: 'Chitty City', stationType: 'CraterPort', marketId: 4200000001, systemName: HIP, systemAddress: HIP_ADDR, economies: eco(['High Tech', 1.2]), firstDocked: '2026-02-01T00:00:00Z', lastDocked: '2026-09-01T00:00:00Z', dockedCount: 4 },
      4200000002: { stationName: 'Kalian Port', stationType: 'Coriolis', marketId: 4200000002, systemName: HIP, systemAddress: HIP_ADDR, economies: eco(['Refinery', 1.0]), nameHistory: [{ name: 'Sassoon Vision', changedAt: '2025-06-01T00:00:00Z' }, { name: 'Rao Refinery', changedAt: '2025-09-01T00:00:00Z' }], firstDocked: '2025-05-16T04:20:00Z', lastDocked: '2026-08-01T00:00:00Z', dockedCount: 12 },
    },
    projects: [
      { id: 'p1', name: 'AX-J d9-52 - Hawkins Foods', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: 'Planetary Construction Site: Hawkins Foods', marketId: 3700000011, status: 'completed', completedAt: '2026-06-10T00:00:00Z', completedStationName: 'Hawkins Foods', completedStationType: 'agriculture_settlement_large', commodities: [{ commodityId: 'steel', name: 'Steel', requiredQuantity: 5000, providedQuantity: 5000 }, { commodityId: 'cmm', name: 'CMM Composite', requiredQuantity: 3517, providedQuantity: 3517 }] },
      { id: 'p2', name: 'AX-J d9-52 - Ehlinger Depot', systemName: SYS, systemAddress: ADDR, stationType: 'SpaceConstructionDepot', stationName: 'Orbital Construction Site: Ehlinger Depot', marketId: 3700000012, status: 'completed', completedAt: '2026-07-01T00:00:00Z', completedStationName: 'Ehlinger Depot', completedStationType: 'security_installation', commodities: [{ commodityId: 'steel', name: 'Steel', requiredQuantity: 6721, providedQuantity: 6721 }] },
      { id: 'p3', name: 'AX-J d9-52 - Deshpande Plant', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: 'Planetary Construction Site: Deshpande Plant', marketId: 3700000013, status: 'completed', completedAt: '2026-05-15T00:00:00Z', completedStationName: 'Deshpande Plant', completedStationType: 'civilian_surface_outpost', commodities: [{ commodityId: 'steel', name: 'Steel', requiredQuantity: 36000, providedQuantity: 36000 }] },
      { id: 'p4', name: 'AX-J d9-52 - Core Boson Complex', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: 'Planetary Construction Site: Core Boson Complex', marketId: 3700000001, status: 'active', completedAt: null, completedStationName: null, completedStationType: null, commodities: [] },
      { id: 'p5', name: 'AX-J d9-52 - ', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: '', marketId: null, status: 'completed', completedAt: '2026-09-14T00:00:00Z', completedStationName: null, completedStationType: null, commodities: [] },
      { id: 'p6', name: 'AX-J d9-52 - Bawa Station', systemName: SYS, systemAddress: ADDR, stationType: 'SpaceConstructionDepot', stationName: 'Orbital Construction Site: Bawa Station', marketId: 3700000016, status: 'completed', completedAt: '2026-09-20T00:00:00Z', completedStationName: null, completedStationType: null, commodities: [{ commodityId: 'steel', name: 'Steel', requiredQuantity: 10089, providedQuantity: 10089 }] },
    ],
    manualColonizedSystems: [HIP, 'Wregoe QI-B d13-43'],
    knownSystems: {
      [KEY]: { systemName: SYS, systemAddress: ADDR, population: P, lastSeen: '2026-10-03T15:35:20Z' },
      'hip 52629': { systemName: HIP, systemAddress: HIP_ADDR, population: 360_000_000, lastSeen: '2026-09-01T00:00:00Z' },
    },
    populationOverrides: { 'hip 52629': { population: P_HIP, updatedAt: '2026-10-04T00:00:00Z' } },
    fssSignals: [
      { signalName: 'Kewell Relay', signalType: 'Installation', isStation: false, systemAddress: ADDR, timestamp: '2026-09-01T00:00:00Z' },
      { signalName: 'Chiang Bastion', signalType: 'Outpost', isStation: false, systemAddress: ADDR, timestamp: '2026-09-01T00:00:00Z' },
      { signalName: 'Q2Z-9XT', signalType: 'FleetCarrier', isStation: true, systemAddress: ADDR, timestamp: '2026-09-01T00:00:00Z' },
      { signalName: 'Hidden Thing', signalType: 'Installation', isStation: false, systemAddress: ADDR, timestamp: '2026-09-01T00:00:00Z' },
      { signalName: 'Sassoon Vision', signalType: 'StationCoriolis', isStation: true, systemAddress: HIP_ADDR, timestamp: '2025-06-01T00:00:00Z' },
      { signalName: 'Elsewhere', signalType: 'Installation', isStation: false, systemAddress: 99, timestamp: '2026-09-01T00:00:00Z' },
    ],
    floors: { [floorKey(SYS, 'deshpande plant')]: { population: 40_000_000, at: '2026-10-01T00:00:00Z' } },
    manualInstallations: [{ id: 'm1', stationName: 'Kabbah Castings', systemName: SYS, systemAddress: ADDR, stationType: 'industrial_settlement_large', sourceSignalName: null, createdAt: '2026-09-01T00:00:00Z' }],
    hiddenInstallations: [`${KEY}|hidden thing`],
    ...over,
  };
}

const by = (rows, name) => rows.find((r) => r.siteName === name);

describe('colonySystemNames', () => {
  it('project systems and the manually marked ones, once each, project spelling first', () => {
    expect(colonySystemNames([{ systemName: SYS }, { systemName: SYS.toUpperCase() }], ['hip 52629', HIP, 'Sol'])).toEqual([SYS, 'hip 52629', 'Sol']);
  });
});

describe('buildInstallationRows — inventory', () => {
  const rows = buildInstallationRows(input());
  it('every site once; carriers, construction sites, colonisation ships, hidden signals and other systems never', () => {
    expect(rows.map((r) => r.siteName).sort()).toEqual([
      'Atmo Sky Cairn Asc', 'Bawa Station', 'Chiang Bastion', 'Chitty City', 'Deshpande Plant', 'Ehlinger Depot', 'Hawkins Foods', 'Kabbah Castings', 'Kalian Port', 'Kewell Relay',
    ]);
    expect(rows.filter((r) => r.systemName === SYS)).toHaveLength(8);
    expect(rows.filter((r) => r.systemName === HIP)).toHaveLength(2);
    // Wregoe QI-B d13-43 is a colony with no recorded site — no rows, no crash
  });
  it('sources and dedupe: the dossier first, projects fill in, a shed name is not a second station', () => {
    expect(by(rows, 'Chiang Bastion').source).toBe('dossier');      // also an FSS Outpost signal — one row
    expect(by(rows, 'Deshpande Plant').source).toBe('dossier');     // also a completed project — the dossier row carries the project's bill
    expect(by(rows, 'Deshpande Plant').bill).toBe(36000);
    expect(by(rows, 'Hawkins Foods').source).toBe('project');
    expect(by(rows, 'Kabbah Castings').source).toBe('manual');
    expect(by(rows, 'Kewell Relay').source).toBe('signal');
    expect(by(rows, 'Kalian Port').source).toBe('dossier');         // the Sassoon Vision signal resolves to it
    expect(rows.some((r) => /sassoon/i.test(r.siteName))).toBe(false);
  });
  it("the journal's generic Outpost is named by its economy and flagged; a depot-typed completion is unknown, never a guessed port", () => {
    const chiang = by(rows, 'Chiang Bastion');
    expect(chiang.stationType).toBe('military_outpost');
    expect(chiang.typeLabel).toMatch(/Military Outpost/);
    expect(chiang.typeInferred).toBe(true);
    expect(chiang.ravenName).toBe('Military Outpost');
    expect(chiang.haul).toBe(20952);
    const bawa = by(rows, 'Bawa Station');
    expect(bawa.typeUnknown).toBe(true);
    expect(bawa.group).toBe('unknown');
    expect(bawa.estimate).toBeNull();
    expect(bawa.bill).toBe(10089);
    expect(by(rows, 'Deshpande Plant').typeInferred).toBe(false);
  });
  it('the market, dates and docks come from the dossier; the bill from the project', () => {
    const d = by(rows, 'Deshpande Plant');
    expect(d.economies).toEqual([{ name: 'Industrial', proportion: 1.45 }, { name: 'Extraction', proportion: 0.8 }]);
    expect(d.topEconomy).toBe('Industrial');
    expect(d.hasMarket).toBe(true);
    expect(d.openedAt).toBe('2026-05-15T00:00:00Z');
    expect(d.openedSource).toBe('project');
    expect(d.lastDocked).toBe('2026-10-05T03:12:00Z');
    expect(d.dockedCount).toBe(212);
    expect(d.body).toBe(`${SYS} 2 a`);
    const chiang = by(rows, 'Chiang Bastion');
    expect(chiang.openedSource).toBe('dock');
    expect(chiang.openedAt).toBe('2026-04-21T02:10:00Z');
    const h = by(rows, 'Hawkins Foods');
    expect(h.bill).toBe(8517);
    expect(h.haul).toBe(8517);
    expect(h.hasMarket).toBe(false);
    expect(h.economies).toEqual([]);
    expect(h.tech).toBe(0);
    expect(h.dockedCount).toBe(0);
  });
});

describe('buildInstallationRows — population', () => {
  const rows = buildInstallationRows(input());
  // the home system's baseline: port + civilian surface outpost + 3 small sites (Chiang, Hawkins, Kabbah); Ehlinger, Kewell Relay and the unknown Bawa add nothing
  const BASE = A.planetary_port.value + A.surface_outpost.value + 3 * A.unit.value;
  const split = (pop, add, base) => Math.round(pop * add / base);
  it('the same split as the system page and the dock banner, floors included', () => {
    // Deshpande is held at its floor; the rest share what is left of the reading (1.60.39)
    const LEFT = P - 40_000_000, REST = BASE - A.surface_outpost.value;
    expect(by(rows, 'Atmo Sky Cairn Asc').estimate).toBe(split(LEFT, A.planetary_port.value, REST));
    expect(by(rows, 'Atmo Sky Cairn Asc').held).toBe(false);
    expect(by(rows, 'Chiang Bastion').estimate).toBe(split(LEFT, A.unit.value, REST));
    expect(by(rows, 'Kabbah Castings').estimate).toBe(split(LEFT, A.unit.value, REST));
    const d = by(rows, 'Deshpande Plant');
    expect(d.estimate).toBe(40_000_000);                       // the floor carries it
    expect(d.held).toBe(true);
    expect(d.heldAt).toBe('2026-10-01T00:00:00Z');
    expect(d.share).toBeCloseTo(40_000_000 / P, 9);
    expect(d.basis).toMatch(/adds 11M/);
    expect(by(rows, 'Ehlinger Depot').estimate).toBeNull();
    expect(by(rows, 'Ehlinger Depot').cls).toBe('none');
    expect(by(rows, 'Kewell Relay').estimate).toBeNull();
    expect(rows.every((r) => r.systemName !== SYS || r.systemPopulation === P)).toBe(true);
    const total = rows.filter((r) => r.systemName === SYS).reduce((a, r) => a + (r.estimate || 0), 0);
    expect(Math.abs(total - P)).toBeLessThanOrEqual(3); // the split adds up to the reading
  });
  it('a manual entry newer than the journal reading is the population; a lone port carries all of it', () => {
    const c = by(rows, 'Chitty City');
    const k = by(rows, 'Kalian Port');
    expect(c.systemPopulation).toBe(P_HIP);
    expect(c.estimate + k.estimate).toBe(P_HIP);
    expect(c.estimate).toBe(Math.round(P_HIP * A.planetary_port.value / (A.planetary_port.value + A.coriolis.value)));
    expect(k.cls).toBe('coriolis');
  });
  it('default order: estimate descending, missing figures last, names tie-break', () => {
    expect(rows[0].siteName).toBe('Chitty City');
    expect(rows[1].siteName).toBe('Atmo Sky Cairn Asc');
    expect(rows[2].siteName).toBe('Deshpande Plant');
    const tail = rows.filter((r) => r.estimate == null).map((r) => r.siteName);
    expect(rows.slice(-tail.length).map((r) => r.siteName)).toEqual(tail);
    expect(tail).toEqual(['Bawa Station', 'Ehlinger Depot', 'Kewell Relay']);
  });
  it('no reading at all: rows exist, figures do not', () => {
    const rows2 = buildInstallationRows(input({ knownSystems: {}, populationOverrides: {} }));
    expect(rows2.filter((r) => r.systemName === SYS).length).toBeGreaterThan(0);
    expect(rows2.every((r) => r.estimate == null)).toBe(true);
  });
});

describe('groups and summary', () => {
  it('groupOf files by population class, settlements by their type', () => {
    expect(groupOf('CraterPort', 'planetary_port')).toBe('port');
    expect(groupOf('Coriolis', 'coriolis')).toBe('port');
    expect(groupOf('military_outpost', 'outpost_mil')).toBe('outpost');
    expect(groupOf('civilian_surface_outpost', 'surface_outpost')).toBe('outpost');
    expect(groupOf('commercial_outpost', 'unit')).toBe('outpost');
    expect(groupOf('agriculture_settlement_large', 'unit')).toBe('settlement');
    expect(groupOf('OnFootSettlement', 'unit')).toBe('settlement');
    expect(groupOf('security_installation', 'none')).toBe('installation');
    expect(groupOf('refinery_hub', 'none')).toBe('installation');
    expect(groupOf('Installation', 'none')).toBe('installation');
    expect(groupOf('', 'unknown')).toBe('unknown');
  });
  it('summarizeInstallationRows counts sites, colonies, the population sum and the kinds', () => {
    const rows = buildInstallationRows(input());
    const s = summarizeInstallationRows(rows);
    expect(s.sites).toBe(10);
    expect(s.systems).toBe(2);
    expect(s.population).toBe(rows.reduce((a, r) => a + (r.estimate ?? 0), 0));
    expect(s.byGroup).toEqual({ port: 3, outpost: 2, settlement: 2, installation: 2, unknown: 1 });
    expect(s.withMarket).toBe(5);
  });
});

describe('a site inside its opening window (1.60.29)', () => {
  it('a port completed this morning carries nothing yet; the row says how far it has grown', () => {
    const OPEN = '2026-10-07T04:24:13Z';
    const base = input();
    const rows = buildInstallationRows(input({
      knownStations: { ...base.knownStations, 4391682051: { stationName: 'Core Boson Complex Cbc', stationType: 'CraterPort', marketId: 4391682051, systemName: SYS, systemAddress: ADDR, economies: [], firstDocked: '2026-09-22T03:59:24Z', lastDocked: OPEN, dockedCount: 31 } },
      projects: [...base.projects, { id: 'cbc', name: 'AX-J d9-52 - Core Boson Complex Cbc', systemName: SYS, systemAddress: ADDR, stationType: 'PlanetaryConstructionDepot', stationName: 'Planetary Construction Site: Core Boson Complex Cbc', marketId: 4391682051, status: 'completed', completedAt: OPEN, completedStationName: 'Core Boson Complex Cbc', completedStationType: 'CraterPort', commodities: [{ commodityId: 'aluminium', name: 'Aluminium', requiredQuantity: 42282, providedQuantity: 42282 }] }],
      now: Date.parse(OPEN),
    }));
    const cbc = by(rows, 'Core Boson Complex Cbc');
    expect(cbc).toMatchObject({ ramp: 0, estimate: 0, openedAt: OPEN, openedSource: 'project', bill: 42282, group: 'port' });
    expect(cbc.basis).toMatch(/opened earlier today \(0% grown\)/);
    expect(by(rows, 'Atmo Sky Cairn Asc').estimate).toBe(by(buildInstallationRows(input({ now: Date.parse(OPEN) })), 'Atmo Sky Cairn Asc').estimate);
    expect(rows.every((r) => r.siteName === 'Core Boson Complex Cbc' || r.ramp === 1)).toBe(true);
  });
});
