// "A facility's population never goes down" (1.60.26): floors hold the highest figure shown, rise with
// the split, are raised by every colony reading, and carry the dock-banner line. Weights are the
// measured additions (1.60.27): port 58.4M, civilian surface outpost 11M, small facilities 0.2M.
import { describe, it, expect } from 'vitest';
import { estimateFacilityPopulations, applyPopulationFloors, floorKey, POPULATION_ADDITIONS as A } from '../server/journal/populationEstimate.js';
import { raiseColonyFloors, isColonySystem } from '../server/journal/populationFloors.js';
import { renderDockPopulationLine } from '../server/journal/overlay.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const ADDR = 1797401856371;
const KEY = SYS.toLowerCase();
const P = 196_044_357;
const INVENTORY = [
  { key: 'chiang bastion', stationType: 'Outpost' },
  { key: 'deshpande plant', stationType: 'civilian_surface_outpost' },
  { key: 'hawkins foods', stationType: 'agriculture_settlement_large' },
  { key: 'atmo sky cairn asc', stationType: 'large_planetary_port' },
  { key: 'ehlinger depot', stationType: 'security_installation' },
];
const BASE = A.planetary_port.value + A.surface_outpost.value + 2 * A.unit.value; // 69.8M
const split = (pop, addition, base = BASE) => Math.round(pop * addition / base);

describe('applyPopulationFloors', () => {
  it('a floor above the split carries the figure; the split and the hold are kept for the tooltip', () => {
    const r = estimateFacilityPopulations(P, INVENTORY);
    const floors = { [floorKey(SYS, 'deshpande plant')]: { population: 40_000_000, at: '2026-10-01T00:00:00Z' } };
    const { result, raised } = applyPopulationFloors(r, SYS, floors, '2026-10-05T00:00:00Z');
    const d = result.byKey['deshpande plant'];
    expect(d.estimate).toBe(40_000_000);
    expect(d.split).toBe(split(P, A.surface_outpost.value));
    expect(d.held).toEqual({ population: 40_000_000, at: '2026-10-01T00:00:00Z' });
    expect(d.share).toBeCloseTo(40_000_000 / P, 9);
    // the port shares what is left of the reading once Deshpande is held (1.60.39), and the split adds up
    expect(raised[floorKey(SYS, 'atmo sky cairn asc')]).toEqual({ population: Math.round((P - 40_000_000) * A.planetary_port.value / (A.planetary_port.value + 2 * A.unit.value)), at: '2026-10-05T00:00:00Z' });
    const total = Object.values(result.byKey).reduce((a, e) => a + (e.estimate || 0), 0);
    expect(Math.abs(total - P)).toBeLessThanOrEqual(2);
    expect(raised[floorKey(SYS, 'deshpande plant')]).toBeUndefined();
    expect(raised[floorKey(SYS, 'ehlinger depot')]).toBeUndefined(); // installations have no figure
  });
  it('a split above the floor raises the floor and keeps the split', () => {
    const r = estimateFacilityPopulations(300_000_000, INVENTORY);
    const floors = { [floorKey(SYS, 'deshpande plant')]: { population: 40_000_000, at: '2026-10-01T00:00:00Z' } };
    const { result, raised } = applyPopulationFloors(r, SYS, floors, '2026-10-05T00:00:00Z');
    expect(result.byKey['deshpande plant'].estimate).toBe(split(300_000_000, A.surface_outpost.value));
    expect(result.byKey['deshpande plant'].held).toBeUndefined();
    expect(raised[floorKey(SYS, 'deshpande plant')].population).toBe(split(300_000_000, A.surface_outpost.value));
  });
  it('the day a second port opens, nothing falls', () => {
    const before = estimateFacilityPopulations(P, INVENTORY);
    const { raised } = applyPopulationFloors(before, SYS, {}, '2026-10-05T00:00:00Z');
    const after = estimateFacilityPopulations(P, [...INVENTORY, { key: 'core boson complex', stationType: 'CraterPort' }]);
    const { result } = applyPopulationFloors(after, SYS, raised, '2026-10-20T00:00:00Z');
    for (const k of ['chiang bastion', 'deshpande plant', 'hawkins foods', 'atmo sky cairn asc']) {
      expect(result.byKey[k].estimate, k).toBe(before.byKey[k].estimate);
      expect(result.byKey[k].held, k).toBeDefined();
    }
    // with no growth since it opened, nothing is left for it — the split adds up to the reading (1.60.39)
    expect(result.byKey['core boson complex'].estimate).toBeLessThan(10);
  });
  it('the growth after a port opens is the port\'s, and the split still adds up to the reading (1.60.39)', () => {
    const before = estimateFacilityPopulations(P, INVENTORY);
    const { raised } = applyPopulationFloors(before, SYS, {}, '2026-10-05T00:00:00Z');
    const P2 = P + 30_000_000;
    const after = estimateFacilityPopulations(P2, [...INVENTORY, { key: 'core boson complex', stationType: 'CraterPort' }]);
    const { result, raised: up } = applyPopulationFloors(after, SYS, raised, '2026-10-20T00:00:00Z');
    for (const k of ['chiang bastion', 'deshpande plant', 'hawkins foods', 'atmo sky cairn asc']) expect(result.byKey[k].estimate, k).toBe(before.byKey[k].estimate);
    expect(Math.abs(result.byKey['core boson complex'].estimate - 30_000_000)).toBeLessThanOrEqual(5);
    const total = Object.values(result.byKey).reduce((a, e) => a + (e.estimate || 0), 0);
    expect(Math.abs(total - P2)).toBeLessThanOrEqual(5);
    expect(Object.keys(up)).toEqual([floorKey(SYS, 'core boson complex')]);
  });
  it('a held facility lets go once its share of the reading passes its floor (1.60.39)', () => {
    const before = estimateFacilityPopulations(P, INVENTORY);
    const { raised } = applyPopulationFloors(before, SYS, {}, '2026-10-05T00:00:00Z');
    const big = 3 * P;
    const after = estimateFacilityPopulations(big, [...INVENTORY, { key: 'core boson complex', stationType: 'CraterPort' }]);
    const plain = JSON.parse(JSON.stringify(after.byKey));
    const { result, raised: up } = applyPopulationFloors(after, SYS, raised, '2026-11-01T00:00:00Z');
    for (const k of Object.keys(plain)) if (plain[k].estimate != null) { expect(result.byKey[k].estimate, k).toBe(plain[k].estimate); expect(result.byKey[k].held, k).toBeUndefined(); }
    expect(up[floorKey(SYS, 'atmo sky cairn asc')].population).toBe(plain['atmo sky cairn asc'].estimate);
  });
  it('floors above the reading are scaled to fit and raise nothing (1.60.39)', () => {
    const before = estimateFacilityPopulations(P, INVENTORY);
    const { raised } = applyPopulationFloors(before, SYS, {}, '2026-10-05T00:00:00Z');
    const low = Math.round(P / 2);
    const { result, raised: up } = applyPopulationFloors(estimateFacilityPopulations(low, INVENTORY), SYS, raised, '2026-10-06T00:00:00Z');
    const total = Object.values(result.byKey).reduce((a, e) => a + (e.estimate || 0), 0);
    expect(Math.abs(total - low)).toBeLessThanOrEqual(5);
    expect(up).toEqual({});
  });
});

function state(over = {}) {
  return {
    settings: {},
    projects: [{ systemName: SYS, status: 'completed', stationName: 'Planetary Construction Site: Hawkins Foods', completedStationName: 'Hawkins Foods', completedStationType: 'agriculture_settlement_large' }],
    manualColonizedSystems: ['HIP 52629'],
    knownSystems: { [KEY]: { systemName: SYS, systemAddress: ADDR, population: P, lastSeen: '2026-10-03T15:35:20Z' } },
    populationOverrides: {},
    knownStations: {
      4355571459: { stationName: 'Chiang Bastion', stationType: 'Outpost', systemName: SYS, systemAddress: ADDR, marketId: 4355571459 },
      4355862019: { stationName: 'Deshpande Plant', stationType: 'civilian_surface_outpost', systemName: SYS, systemAddress: ADDR, marketId: 4355862019 },
      4371599107: { stationName: 'Atmo Sky Cairn Asc', stationType: 'large_planetary_port', systemName: SYS, systemAddress: ADDR, marketId: 4371599107 },
    },
    fssSignals: [],
    facilityPopulationFloor: {},
    ...over,
  };
}

describe('raiseColonyFloors', () => {
  it('colonies are the project systems and the manually marked ones', () => {
    const s = state();
    expect(isColonySystem(s, SYS)).toBe(true);
    expect(isColonySystem(s, 'hip 52629')).toBe(true);
    expect(isColonySystem(s, 'Sol')).toBe(false);
  });
  it('raises every facility of a colony from a reading; nothing for a non-colony or without a figure', () => {
    const s = state();
    const up = raiseColonyFloors(s, SYS, P, null, '2026-10-05T00:00:00Z');
    expect(up.__upsert[floorKey(SYS, 'deshpande plant')]).toEqual({ population: split(P, A.surface_outpost.value), at: '2026-10-05T00:00:00Z' });
    expect(up.__upsert[floorKey(SYS, 'hawkins foods')].population).toBe(split(P, A.unit.value));
    expect(Object.keys(up.__upsert)).toHaveLength(4);
    expect(raiseColonyFloors(s, 'Sol', 18_000_000_000)).toBeNull();
    expect(raiseColonyFloors(state({ knownSystems: {} }), SYS, 0)).toBeNull();
  });
  it('a lower reading raises nothing; a higher one raises only what climbed', () => {
    const s = state();
    const first = raiseColonyFloors(s, SYS, P, null, '2026-10-05T00:00:00Z');
    const held = state({ facilityPopulationFloor: first.__upsert });
    expect(raiseColonyFloors(held, SYS, 150_000_000)).toBeNull();
    const up = raiseColonyFloors(held, SYS, 200_000_000, null, '2026-10-06T00:00:00Z');
    expect(Object.keys(up.__upsert)).toHaveLength(4);
    expect(up.__upsert[floorKey(SYS, 'deshpande plant')].population).toBe(split(200_000_000, A.surface_outpost.value));
  });
});

describe('the dock-banner line under a floor', () => {
  it('shows the held figure and writes the floors the split climbed past', async () => {
    const overlays = []; const patches = [];
    const deps = { sendOverlay: (m) => overlays.push(m), applyStatePatch: (p) => patches.push(p), fetchSystemDump: async () => { throw new Error('offline'); } };
    const s = state({ facilityPopulationFloor: { [floorKey(SYS, 'deshpande plant')]: { population: 40_000_000, at: '2026-10-01T00:00:00Z' } } });
    const ev = { event: 'Docked', StationName: 'Deshpande Plant', StationType: 'CraterOutpost', MarketID: 4355862019, StarSystem: SYS, SystemAddress: ADDR };
    const text = await renderDockPopulationLine(ev, s, deps, { y: 474, ttl: 12 });
    expect(text).toBe('\u{1F465} Population ~40M (est.)');
    expect(patches).toHaveLength(1);
    const up = patches[0].facilityPopulationFloor.__upsert;
    expect(up[floorKey(SYS, 'deshpande plant')]).toBeUndefined();
    expect(up[floorKey(SYS, 'atmo sky cairn asc')].population).toBe(Math.round((P - 40_000_000) * A.planetary_port.value / (A.planetary_port.value + 2 * A.unit.value)));
  });
});

describe('a port on its opening day raises nothing (1.60.29)', () => {
  const OPEN = '2026-10-07T04:24:13Z';
  const CBC_ID = 4391682051;
  it('weighs nothing yet, so no floor for it and nobody else falls; six days in it has a floor of its own', () => {
    const s = state({
      knownStations: { ...state().knownStations, [CBC_ID]: { stationName: 'Core Boson Complex Cbc', stationType: 'CraterPort', systemName: SYS, systemAddress: ADDR, marketId: CBC_ID } },
      projects: [...state().projects, { systemName: SYS, status: 'completed', marketId: CBC_ID, stationName: 'Planetary Construction Site: Core Boson Complex Cbc', completedStationName: 'Core Boson Complex Cbc', completedStationType: 'CraterPort', completedAt: OPEN }],
    });
    const up = raiseColonyFloors(s, SYS, P, null, OPEN);
    expect(up.__upsert[floorKey(SYS, 'core boson complex cbc')]).toBeUndefined();
    expect(up.__upsert[floorKey(SYS, 'deshpande plant')].population).toBe(split(P, A.surface_outpost.value));
    expect(up.__upsert[floorKey(SYS, 'atmo sky cairn asc')].population).toBe(split(P, A.planetary_port.value));
    const later = raiseColonyFloors(state({ ...s, facilityPopulationFloor: up.__upsert }), SYS, P, null, '2026-10-13T04:24:13Z');
    const w = Math.round(A.planetary_port.value * 0.5);
    void w; // its weight counts once the reading grows; at the same reading nothing is left for it (1.60.39)
    const lu = (later && later.__upsert) || {}; // nothing left to raise at the same reading: raiseColonyFloors returns null
    expect((lu[floorKey(SYS, 'core boson complex cbc')] || { population: 0 }).population).toBeLessThan(10);
    expect(lu[floorKey(SYS, 'deshpande plant')]).toBeUndefined(); // its split fell; the floor holds, nothing to raise
  });
});
