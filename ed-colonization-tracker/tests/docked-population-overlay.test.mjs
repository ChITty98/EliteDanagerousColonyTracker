// The dock banner's population line: slot 9, fires at DockingGranted from the dossier's system,
// refreshes at Docked, says only the location's figure, blanks when nothing applies. Figures follow the
// measured-additions split (1.60.27): port 58.4M, civilian surface outpost 11M, small facilities 0.2M.
import { describe, it, expect } from 'vitest';
import { renderDockPopulationLine, renderDockPopulationTrendLine, collectSystemFacilities } from '../server/journal/overlay.js';
import { POPULATION_ADDITIONS as A } from '../server/journal/populationEstimate.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const ADDR = 1797401856371;
const P = 196_044_357;
const Y_SLOT9 = 240 + 9 * 26;
const PLACE = { y: Y_SLOT9, ttl: 12 };
// local inventory: Chiang (unit) + Deshpande (civ surface outpost) + Sky Cairn (port) + Thagard (unit) + Hawkins (unit) + Rankin (unit)
const BASE_LOCAL = A.planetary_port.value + A.surface_outpost.value + 4 * A.unit.value; // 70.2M
// Spansh adds a second planetary port the app has never docked at
const BASE_SPANSH = BASE_LOCAL + A.planetary_port.value; // 128.6M
const fmt = (n) => (n >= 10e6 ? `${Math.round(n / 1e6)}M` : `${(n / 1e6).toFixed(1)}M`);
const line = (n) => `\u{1F465} Population ~${fmt(n)} (est.)`;

describe('renderDockPopulationTrendLine — slot 10', () => {
  const NOW = Date.parse('2026-10-05T03:00:00Z');
  const Y_SLOT10 = 240 + 10 * 26;
  it('compares the current reading with the figure stored at the last dock here', () => {
    const { deps, existing, overlays } = harness();
    const station = { ...existing.knownStations[4355862019], lastVisitPopulation: { population: 190_951_733, at: '2026-10-01T22:00:00Z' } };
    const text = renderDockPopulationTrendLine(station, existing, deps, { y: Y_SLOT10, ttl: 12, now: NOW });
    expect(text).toBe('\u{1F4C8} The system has grown by 5.1M since your last visit (3 days ago)');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ id: 'edcolony_dock_pop_trend', y: Y_SLOT10, ttl: 12, x: 40 });
  });
  it('blanks the slot without a previous figure, without movement, or without a station', () => {
    const h = harness();
    expect(renderDockPopulationTrendLine(h.existing.knownStations[4355862019], h.existing, h.deps, { y: Y_SLOT10, now: NOW })).toBeNull();
    const same = { ...h.existing.knownStations[4355862019], lastVisitPopulation: { population: P, at: '2026-10-01T22:00:00Z' } };
    expect(renderDockPopulationTrendLine(same, h.existing, h.deps, { y: Y_SLOT10, now: NOW })).toBeNull();
    expect(renderDockPopulationTrendLine(undefined, h.existing, h.deps, { y: Y_SLOT10, now: NOW })).toBeNull();
    expect(h.overlays).toHaveLength(3);
    for (const m of h.overlays) expect(m).toMatchObject({ id: 'edcolony_dock_pop_trend', text: '', ttl: 1 });
  });
  it('overlay disabled: nothing at all', () => {
    const off = harness({ existing: { settings: { overlayEnabled: false } } });
    const station = { ...off.existing.knownStations[4355862019], lastVisitPopulation: { population: 1, at: '2026-10-01T22:00:00Z' } };
    expect(renderDockPopulationTrendLine(station, off.existing, off.deps, { y: Y_SLOT10, now: NOW })).toBeNull();
    expect(off.overlays).toHaveLength(0);
  });
});

function harness(overrides = {}) {
  const overlays = []; const patches = [];
  const deps = {
    sendOverlay: (m) => overlays.push(m),
    applyStatePatch: (p) => patches.push(p),
    broadcastEvent: () => {},
    fetchSystemDump: async () => ({
      stations: [{ name: "Thagard's Progress", type: 'Outpost' }, { name: 'Rankin Legacy', type: 'Outpost' }],
      bodies: [
        { name: `${SYS} 1 a`, stations: [{ name: 'Deshpande Plant', type: 'Planetary Outpost' }] },
        { name: `${SYS} 2 f`, stations: [{ name: 'Hawkins Foods', type: 'Settlement' }, { name: 'Spansh-Only Port', type: 'Planetary Port' }] },
      ],
    }),
    ...overrides.deps,
  };
  const existing = {
    settings: {},
    knownSystems: { [SYS.toLowerCase()]: { systemName: SYS, population: P, lastSeen: '2026-10-03T15:35:20Z' } },
    populationOverrides: {},
    facilityPopulationFloor: {},
    knownStations: {
      4355571459: { stationName: 'Chiang Bastion', stationType: 'Outpost', systemName: SYS, systemAddress: ADDR, marketId: 4355571459 },
      4355862019: { stationName: 'Deshpande Plant', stationType: 'civilian_surface_outpost', systemName: SYS, systemAddress: ADDR, marketId: 4355862019 },
      4371599107: { stationName: 'Atmo Sky Cairn Asc', stationType: 'large_planetary_port', systemName: SYS, systemAddress: ADDR, marketId: 4371599107, nameHistory: [{ name: 'Bawa Station', changedAt: '2026-07-08T00:00:00Z' }] },
      4365774083: { stationName: "Thagard's Progress", stationType: 'civilian_outpost', systemName: SYS, systemAddress: ADDR, marketId: 4365774083 },
      3700000101: { stationName: 'K8R-M2X', stationType: 'FleetCarrier', systemName: SYS, systemAddress: ADDR, marketId: 3700000101 },
      9999: { stationName: 'Elsewhere Port', stationType: 'CraterPort', systemName: 'HIP 52629', marketId: 9999 },
    },
    projects: [
      { systemName: SYS, status: 'completed', stationName: 'Planetary Construction Site: Hawkins Foods', completedStationName: 'Hawkins Foods', completedStationType: 'agriculture_settlement_large' },
      { systemName: SYS, status: 'completed', stationName: 'Orbital Construction Site: Ehlinger Depot', completedStationType: 'security_installation' },
      { systemName: SYS, status: 'active', stationName: 'Planetary Construction Site: Espinoza Obligation', stationType: 'PlanetaryConstructionDepot' },
    ],
    fssSignals: [
      { signalName: 'Rankin Legacy', signalType: 'Outpost', isStation: false, systemAddress: ADDR, timestamp: '2026-06-06T00:00:00Z' },
      { signalName: 'Rothman Gateway', signalType: 'Installation', isStation: false, systemAddress: ADDR, timestamp: '2026-07-21T00:00:00Z' },
      { signalName: 'Planetary Construction Site: Kabbah’s Castings', signalType: 'Installation', isStation: false, systemAddress: ADDR, timestamp: '2026-06-01T00:00:00Z' },
      { signalName: 'OLD TIN-CAN K8R-M2X', signalType: 'FleetCarrier', isStation: true, systemAddress: ADDR, timestamp: '2026-06-01T00:00:00Z' },
      { signalName: 'Bawa Station', signalType: 'Installation', isStation: false, systemAddress: ADDR, timestamp: '2026-06-18T00:00:00Z' },
      { signalName: 'Far Away Outpost', signalType: 'Outpost', isStation: false, systemAddress: 1, timestamp: '2026-06-01T00:00:00Z' },
    ],
    ...overrides.existing,
  };
  return { deps, existing, overlays, patches };
}

const granted = (over = {}) => ({ event: 'DockingGranted', LandingPad: 12, MarketID: 4371599107, StationName: 'Atmo Sky Cairn Asc', StationType: 'CraterPort', ...over });
const docked = (over = {}) => ({ event: 'Docked', StationName: 'Atmo Sky Cairn Asc', StationType: 'CraterPort', MarketID: 4371599107, StarSystem: SYS, SystemAddress: ADDR, ...over });

describe('collectSystemFacilities — one inventory from four sources', () => {
  it('unions the docked station, knownStations, completed projects, FSS signals and Spansh, deduped by name and shed names', async () => {
    const { deps, existing } = harness();
    const dump = await deps.fetchSystemDump(ADDR);
    const got = collectSystemFacilities(docked(), existing, dump);
    const keys = got.map((f) => f.key).sort();
    expect(keys).toEqual([
      'atmo sky cairn asc', 'chiang bastion', 'deshpande plant', 'ehlinger depot', 'hawkins foods',
      'rankin legacy', 'rothman gateway', 'spansh-only port', "thagard's progress",
    ]);
    expect(got.find((f) => f.key === 'deshpande plant').stationType).toBe('civilian_surface_outpost');
    expect(keys).not.toContain('bawa station');
    expect(keys).not.toContain('k8r-m2x');
    expect(keys).not.toContain('elsewhere port');
    expect(keys.some((k) => k.includes('construction'))).toBe(false);
    expect(keys).not.toContain('espinoza obligation');
    expect(keys).not.toContain('far away outpost');
  });
});

describe('renderDockPopulationLine — at DockingGranted, from the dossier', () => {
  it('goes up at once with the local figure in slot 9; Spansh adding a port would lower it, and the floor holds', async () => {
    const { deps, existing, overlays } = harness();
    const station = existing.knownStations[4371599107];
    const text = await renderDockPopulationLine(granted(), existing, deps, { ...PLACE, systemName: station.systemName, systemAddress: station.systemAddress });
    expect(overlays).toHaveLength(1);
    expect(overlays[0].text).toBe(line(P * A.planetary_port.value / BASE_LOCAL));
    expect(overlays[0].text).toBe('\u{1F465} Population ~164M (est.)');
    expect(text).toBe(overlays[0].text);
    expect(line(P * A.planetary_port.value / BASE_SPANSH)).toBe('\u{1F465} Population ~89M (est.)'); // what Spansh alone would say
    expect(overlays[0]).toMatchObject({ id: 'edcolony_dock_pop', y: Y_SLOT9, ttl: 12, x: 40 });
  });
  it('a civilian surface outpost: 11M of the baseline, held against the Spansh pass', async () => {
    const { deps, existing, overlays } = harness();
    const text = await renderDockPopulationLine(granted({ StationName: 'Deshpande Plant', StationType: 'CraterOutpost', MarketID: 4355862019 }), existing, deps, { ...PLACE, systemName: SYS, systemAddress: ADDR });
    expect(text).toBe('\u{1F465} Population ~31M (est.)');
    expect(overlays).toHaveLength(1);
  });
  it('without a system (no dossier and no event field) it blanks the slot', async () => {
    const { deps, existing, overlays } = harness();
    expect(await renderDockPopulationLine(granted(), existing, deps, PLACE)).toBeNull();
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ id: 'edcolony_dock_pop', text: '', y: Y_SLOT9, ttl: 1 });
  });
});

describe('renderDockPopulationLine — at Docked, from the event', () => {
  it('reads the system off the Docked event; offline, the local line stands alone', async () => {
    const { deps, existing, overlays } = harness({ deps: { fetchSystemDump: async () => { throw new Error('offline'); } } });
    const text = await renderDockPopulationLine(docked(), existing, deps, PLACE);
    expect(text).toBe('\u{1F465} Population ~164M (est.)');
    expect(overlays).toHaveLength(1);
  });
  it('a stale override loses to the newer journal reading; a newer override wins', async () => {
    const stale = harness({ existing: { populationOverrides: { [SYS.toLowerCase()]: { population: 154_659_936, updatedAt: '2026-09-14T03:05:11Z' } } } });
    expect(await renderDockPopulationLine(docked(), stale.existing, stale.deps, PLACE)).toBe('\u{1F465} Population ~164M (est.)');
    const fresh = harness({ existing: { populationOverrides: { [SYS.toLowerCase()]: { population: 300_000_000, updatedAt: '2026-10-04T00:00:00Z' } } } });
    expect(await renderDockPopulationLine(docked(), fresh.existing, fresh.deps, PLACE)).toBe(line(300_000_000 * A.planetary_port.value / BASE_LOCAL));
  });
  it('a floor already on record carries the line above the split', async () => {
    const held = harness({ existing: { facilityPopulationFloor: { [`${SYS.toLowerCase()}|atmo sky cairn asc`]: { population: 170_000_000, at: '2026-10-01T00:00:00Z' } } } });
    expect(await renderDockPopulationLine(docked(), held.existing, held.deps, PLACE)).toBe('\u{1F465} Population ~170M (est.)');
    expect(held.overlays).toHaveLength(1);
  });
  it('Spansh that adds nothing new does not re-send the line', async () => {
    const { deps, existing, overlays } = harness({ deps: { fetchSystemDump: async () => ({ stations: [{ name: 'Chiang Bastion', type: 'Outpost' }], bodies: [] }) } });
    await renderDockPopulationLine(docked(), existing, deps, PLACE);
    expect(overlays).toHaveLength(1);
  });
  it('writes the floors the split climbed past, once, after the refinement', async () => {
    const { deps, existing, patches } = harness();
    await renderDockPopulationLine(docked(), existing, deps, PLACE);
    expect(patches).toHaveLength(1);
    const up = patches[0].facilityPopulationFloor.__upsert;
    expect(Object.keys(up).length).toBeGreaterThan(0);
    // the local pass raised Sky Cairn to its local figure; the Spansh pass found a lower split and raised nothing higher
    expect(up[`${SYS.toLowerCase()}|atmo sky cairn asc`].population).toBe(Math.round(P * A.planetary_port.value / BASE_LOCAL));
  });
});

describe('renderDockPopulationLine — blanks and silences', () => {
  it('a carrier, a construction site, a megaship: blank line, null', async () => {
    const h = harness();
    expect(await renderDockPopulationLine(docked({ StationName: 'K8R-M2X', StationType: 'FleetCarrier', MarketID: 3700000101 }), h.existing, h.deps, PLACE)).toBeNull();
    expect(await renderDockPopulationLine(docked({ StationName: 'Planetary Construction Site: Espinoza Obligation', StationType: 'PlanetaryConstructionDepot', MarketID: 4391682051 }), h.existing, h.deps, PLACE)).toBeNull();
    expect(await renderDockPopulationLine(docked({ StationName: 'The Harmony', StationType: 'MegaShip', MarketID: 128000001 }), h.existing, h.deps, PLACE)).toBeNull();
    expect(h.overlays).toHaveLength(3);
    for (const m of h.overlays) expect(m).toMatchObject({ id: 'edcolony_dock_pop', text: '', ttl: 1 });
  });
  it('no population reading: blank line, null', async () => {
    const h = harness({ existing: { knownSystems: {} } });
    expect(await renderDockPopulationLine(docked(), h.existing, h.deps, PLACE)).toBeNull();
    expect(h.overlays).toHaveLength(1);
    expect(h.overlays[0].text).toBe('');
  });
  it('overlay disabled or no transport: nothing at all', async () => {
    const off = harness({ existing: { settings: { overlayEnabled: false } } });
    expect(await renderDockPopulationLine(docked(), off.existing, off.deps, PLACE)).toBeNull();
    expect(off.overlays).toHaveLength(0);
    const none = harness();
    expect(await renderDockPopulationLine(docked(), none.existing, { fetchSystemDump: none.deps.fetchSystemDump }, PLACE)).toBeNull();
  });
});

describe('renderDockPopulationLine — a port on its opening day (1.60.29)', () => {
  const OPEN = '2026-10-07T04:24:13Z';
  const CBC_ID = 4391682051;
  it('weighs nothing yet: the line says ~0 and when it opened, nobody else moves, and no floor is written for it', async () => {
    const base = harness();
    const { deps, existing, overlays, patches } = harness({
      deps: { fetchSystemDump: async () => { throw new Error('offline'); } },
      existing: {
        knownStations: { ...base.existing.knownStations, [CBC_ID]: { stationName: 'Core Boson Complex Cbc', stationType: 'CraterPort', systemName: SYS, systemAddress: ADDR, marketId: CBC_ID } },
        projects: [...base.existing.projects, { id: 'cbc', systemName: SYS, status: 'completed', marketId: CBC_ID, stationName: 'Planetary Construction Site: Core Boson Complex Cbc', completedStationName: 'Core Boson Complex Cbc', completedStationType: 'CraterPort', completedAt: OPEN }],
      },
    });
    const text = await renderDockPopulationLine(docked({ StationName: 'Core Boson Complex Cbc', StationType: 'CraterPort', MarketID: CBC_ID }), existing, deps, { ...PLACE, now: Date.parse(OPEN) });
    expect(text).toBe('\u{1F465} Population ~0 (est.) \u00B7 opened earlier today');
    expect(overlays).toHaveLength(1);
    expect(await renderDockPopulationLine(docked(), existing, deps, { ...PLACE, now: Date.parse(OPEN) })).toBe('\u{1F465} Population ~164M (est.)');
    const up = patches[0].facilityPopulationFloor.__upsert;
    expect(up[`${SYS.toLowerCase()}|core boson complex cbc`]).toBeUndefined();
    expect(up[`${SYS.toLowerCase()}|atmo sky cairn asc`].population).toBe(Math.round(P * A.planetary_port.value / BASE_LOCAL));
  });
});
