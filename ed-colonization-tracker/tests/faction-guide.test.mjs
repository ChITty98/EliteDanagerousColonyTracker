// The faction guide (src/lib/factionGuide.ts) and its server feeds (server/journal/factionGuide.js), 1.60.32.
// Cases from the home system on 2026-10-25: the Order of Copernicus holds Thagard's Progress; the Legion
// holds Rankin Legacy and CBC; Pavlov Point is the active project.
import { describe, it, expect } from 'vitest';
import { buildFactionGuide, isLockedInConflict, bestKnownSell, normCommodity } from '../src/lib/factionGuide';
import { extractMinedSales, surfaceYieldsFor, _resetFactionGuideCache } from '../server/journal/factionGuide.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const reading = (name, influence, extra = {}) => ({ name, influence, state: null, government: 'Confederacy', allegiance: null, happiness: null, reputation: null, squadron: false, active: [], pending: [], recovering: [], ...extra });
const entry = {
  systemName: SYS, systemAddress: 1, updatedAt: '2026-10-25T21:11:00Z', controlling: { name: 'The 9th Legion', state: 'War' }, allegiance: null, government: null, security: null,
  factions: [
    reading('Pro-JDP League', 0.162, { government: 'Patronage' }),
    reading('HIP 104349 Ring', 0.373, { state: 'War', active: ['War'], government: 'Anarchy' }),
    reading('Order of Copernicus', 0.093),
    reading('The 9th Legion', 0.373, { state: 'War', active: ['War'], government: 'Patronage' }),
  ],
  history: [
    { at: '2026-10-23T04:25:04Z', influence: { 'Pro-JDP League': 0.178, 'HIP 104349 Ring': 0.373, 'Order of Copernicus': 0.077, 'The 9th Legion': 0.373 }, states: {} },
    { at: '2026-10-25T21:11:00Z', influence: { 'Pro-JDP League': 0.162, 'HIP 104349 Ring': 0.373, 'Order of Copernicus': 0.093, 'The 9th Legion': 0.373 }, states: {} },
  ],
};
const station = (marketId, stationName, faction, stationType, pads) => ({ marketId, stationName, systemName: SYS, stationType, faction, landingPads: pads, lastDocked: '2026-10-23T06:11:02Z' });
const stations = [
  station(4365774083, "Thagard's Progress", 'Order of Copernicus', 'civilian_outpost', { small: 4, medium: 1, large: 0 }),
  station(4367617795, 'Rankin Legacy', 'The 9th Legion', 'industrial_outpost', { small: 2, medium: 1, large: 0 }),
  station(4391682051, 'Core Boson Complex Cbc', 'The 9th Legion', 'large_planetary_port', { small: 8, medium: 8, large: 8 }),
  station(3952631042, "Orbital Construction Site: Thagard's Progress", 'Brewer Corporation', 'SpaceConstructionDepot', null),
];
const snap = (marketId, stationName, updatedAt, commodities) => ({ marketId, stationName, systemName: SYS, stationType: 'Outpost', isPlanetary: false, hasLargePads: false, updatedAt, commodities });
const c = (commodityId, name, o) => ({ commodityId, name, buyPrice: 0, stock: 0, sellPrice: 0, demand: 0, category: '', ...o });
const snapshots = {
  '4365774083': snap(4365774083, "Thagard's Progress", '2026-10-25T21:59:02Z', [
    c('indite', 'Indite', { sellPrice: 13129, demand: 954655 }),
    c('silver', 'Silver', { buyPrice: 34017, stock: 24735 }),
    c('alexandrite', 'Alexandrite', { sellPrice: 218930, demand: 2463 }),
    c('thortveitite', 'Thortveitite', { sellPrice: 154887, demand: 35786 }),
    c('steel', 'Steel', { buyPrice: 4145, stock: 63892 }),
    c('aluminium', 'Aluminium', { buyPrice: 2470, stock: 187546 }),
  ]),
  '4367617795': snap(4367617795, 'Rankin Legacy', '2026-10-23T06:05:44Z', [
    c('silver', 'Silver', { sellPrice: 40742, demand: 26439 }),
    c('indite', 'Indite', { buyPrice: 9736, stock: 4109 }),
  ]),
  '4391682051': snap(4391682051, 'Core Boson Complex Cbc', '2026-10-23T05:31:59Z', [
    c('bertrandite', 'Bertrandite', { buyPrice: 16557, stock: 3402771 }),
    c('alexandrite', 'Alexandrite', { sellPrice: 150000, demand: 100 }),
    c('medicaldiagnosticequipment', 'Medical Diagnostic Equipment', { buyPrice: 2449, stock: 234475 }),
  ]),
  '9999': snap(9999, 'Far Away Market', '2026-10-01T00:00:00Z', [c('alexandrite', 'Alexandrite', { sellPrice: 230000, demand: 500 })]),
};
snapshots['9999'].systemName = 'Somewhere Else';
const project = { id: 'p1', name: 'Pavlov Point', systemName: SYS, status: 'active', commodities: [
  { commodityId: 'steel', name: 'Steel', requiredQuantity: 3084, providedQuantity: 0 },
  { commodityId: 'aluminium', name: 'Aluminium', requiredQuantity: 1357, providedQuantity: 0 },
  { commodityId: 'medicaldiagnosticequipment', name: 'Medical Diagnostic Equipment', requiredQuantity: 99, providedQuantity: 0 },
  { commodityId: 'water', name: 'Water', requiredQuantity: 278, providedQuantity: 278 },
] };
const carrier = { items: [{ commodityId: 'alexandrite', name: 'Alexandrite', count: 213 }, { commodityId: 'indite', name: 'Indite', count: 138 }] };
const ship = { items: [{ commodityId: 'silver', name: 'Silver', count: 384 }] };
const base = (over = {}) => ({ systemName: SYS, entry, stations, snapshots, projects: [project], shipCargo: ship, carrierCargo: carrier, priorities: [], holdCapacity: 384, now: Date.parse('2026-10-25T22:00:00Z'), ...over });

describe('faction guide — blocks', () => {
  it('orders starred factions first, then by influence; marks the combatants locked', () => {
    const g = buildFactionGuide(base({ priorities: ['Order of Copernicus'] }));
    expect(g.map((b) => b.name)).toEqual(['Order of Copernicus', 'HIP 104349 Ring', 'The 9th Legion', 'Pro-JDP League']);
    expect(g[0].starred).toBe(true);
    expect(g[0].influence).toBe(9.3);
    expect(g[0].previous).toBe(7.7);
    expect(g[0].delta).toBe(1.6);
    expect(g[0].locked).toBe(false);
    expect(g.find((b) => b.name === 'The 9th Legion').locked).toBe(true);
    expect(isLockedInConflict(reading('x', 0.1, { active: ['Election'] }))).toBe(true);
  });
  it("lists the faction's stations without construction sites", () => {
    const order = buildFactionGuide(base()).find((b) => b.name === 'Order of Copernicus');
    expect(order.stations.map((s) => s.name)).toEqual(["Thagard's Progress"]);
    expect(order.stations[0].pads.large).toBe(0);
    expect(order.stations[0].snapshotAt).toBe('2026-10-25T21:59:02Z');
  });
  it('sell here: held stock first, one line per commodity, with the best price known anywhere', () => {
    const order = buildFactionGuide(base()).find((b) => b.name === 'Order of Copernicus');
    expect(order.sellHere.map((l) => l.name)).toEqual(['Alexandrite', 'Indite', 'Thortveitite']);
    const alex = order.sellHere[0];
    expect(alex.held).toEqual({ ship: 0, carrier: 213 });
    expect(alex.price).toBe(218930);
    expect(alex.bestKnown).toEqual({ price: 230000, station: 'Far Away Market', system: 'Somewhere Else' });
    expect(bestKnownSell(snapshots, 'thortveitite', 'Thortveitite').station).toBe("Thagard's Progress");
  });
  it("buy here: the project's open needs against the faction's stock, missing items named", () => {
    const order = buildFactionGuide(base()).find((b) => b.name === 'Order of Copernicus');
    expect(order.buyHere).toHaveLength(1);
    const cov = order.buyHere[0];
    expect(cov.total).toBe(3084 + 1357 + 99);
    expect(cov.covered).toBe(3084 + 1357);
    expect(cov.lines.map((l) => l.name)).toEqual(['Steel', 'Aluminium']);
    expect(cov.missing).toEqual(['Medical Diagnostic Equipment']);
    const legion = buildFactionGuide(base()).find((b) => b.name === 'The 9th Legion');
    expect(legion.buyHere[0].lines.map((l) => l.name)).toEqual(['Medical Diagnostic Equipment']);
  });
  it('loops: buy elsewhere in the system, sell at the faction, sized to the hold, stalest snapshot dated', () => {
    const order = buildFactionGuide(base()).find((b) => b.name === 'Order of Copernicus');
    const indite = order.loops.find((l) => l.name === 'Indite');
    expect(indite.buyStation).toBe('Rankin Legacy');
    expect(indite.buyFaction).toBe('The 9th Legion');
    expect(indite.profitPerT).toBe(13129 - 9736);
    expect(indite.load).toBe(384);
    expect(indite.profitPerLoad).toBe((13129 - 9736) * 384);
    expect(indite.staleDays).toBe(3); // Rankin's 23 Oct snapshot against 25 Oct 22:00
    const legion = buildFactionGuide(base()).find((b) => b.name === 'The 9th Legion');
    const silver = legion.loops.find((l) => l.name === 'Silver');
    expect(silver.buyStation).toBe("Thagard's Progress");
    expect(silver.sellStation).toBe('Rankin Legacy');
    expect(silver.profitPerT).toBe(40742 - 34017);
  });
  it('yields and evidence come from the server feeds and pair with the readings', () => {
    const g = buildFactionGuide(base({
      yields: [{ body: `${SYS} 1 a`, collects: 12, tonnes: 90, lastAt: '2026-10-20T00:00:00Z', commodities: { Thortveitite: 60, Helium: 30 } }],
      minedSales: [{ at: '2026-10-23T06:11:02Z', station: "Thagard's Progress", marketId: 4365774083, faction: 'Order of Copernicus', commodity: 'Indite', tonnes: 384, price: 13129, value: 5041536 }],
    }));
    const order = g.find((b) => b.name === 'Order of Copernicus');
    expect(order.yields).toEqual([{ body: `${SYS} 1 a`, commodity: 'Thortveitite', tonnes: 60, collects: 12, price: 154887, demand: 35786, station: "Thagard's Progress" }]);
    expect(order.evidence).toHaveLength(1);
    expect(order.evidence[0]).toMatchObject({ commodity: 'Indite', tonnes: 384, before: 7.7, after: 9.3, delta: 1.6, readingAt: '2026-10-25T21:11:00Z' });
  });
  it('no readings, no guide', () => {
    expect(buildFactionGuide(base({ entry: null }))).toEqual([]);
  });
  it('normalises ids and names the same way', () => {
    expect(normCommodity('$Alexandrite_name;')).toBe('alexandrite');
    expect(normCommodity('Low Temp. Diamonds')).toBe('lowtempdiamonds');
  });
});

describe('server feeds', () => {
  const J = (o) => JSON.stringify(o);
  const files = {
    'J:/j/Journal.2026-10-22T223815.01.log': [
      J({ timestamp: '2026-10-23T05:55:58Z', event: 'Docked', StationName: "Thagard's Progress", StationType: 'Outpost', MarketID: 4365774083, StarSystem: SYS, StationFaction: { Name: 'Order of Copernicus' } }),
      J({ timestamp: '2026-10-23T05:57:29Z', event: 'MarketSell', MarketID: 4365774083, Type: 'coffee', Count: 112, SellPrice: 1268, TotalSale: 142016, AvgPricePaid: 1091 }),
      J({ timestamp: '2026-10-23T06:11:02Z', event: 'MarketSell', MarketID: 4365774083, Type: 'indite', Count: 384, SellPrice: 13129, TotalSale: 5041536, AvgPricePaid: 0 }),
      J({ timestamp: '2026-10-23T06:20:00Z', event: 'Docked', StationName: 'K8R-M2X', StationType: 'FleetCarrier', MarketID: 3700000101, StarSystem: SYS, StationFaction: { Name: 'FleetCarrier' } }),
      J({ timestamp: '2026-10-23T06:21:00Z', event: 'MarketSell', MarketID: 3700000101, Type: 'gold', Count: 10, SellPrice: 50000, TotalSale: 500000, AvgPricePaid: 0 }),
      J({ timestamp: '2026-10-23T07:00:00Z', event: 'Docked', StationName: 'Elsewhere Port', StationType: 'Coriolis', MarketID: 1, StarSystem: 'Other System', StationFaction: { Name: 'Nobody' } }),
      J({ timestamp: '2026-10-23T07:01:00Z', event: 'MarketSell', MarketID: 1, Type: 'alexandrite', Count: 5, SellPrice: 1, TotalSale: 5, AvgPricePaid: 0 }),
    ].join('\n'),
    'J:/j/Journal.2026-01-01T000000.01.log': J({ timestamp: '2026-01-01T00:00:00Z', event: 'Docked', StationName: 'Old', MarketID: 2, StarSystem: SYS, StationFaction: { Name: 'Old Faction' } }) + '\n' + J({ timestamp: '2026-01-01T00:01:00Z', event: 'MarketSell', MarketID: 2, Type: 'gold', Count: 1, SellPrice: 1, TotalSale: 1, AvgPricePaid: 0 }),
  };
  const io = { listFiles: () => Object.keys(files), readFile: (p) => files[p] };
  it('keeps only zero-cost sales at stations in the system, tagged with the faction at the time, inside the window', () => {
    _resetFactionGuideCache();
    const rows = extractMinedSales('J:/j', { systemName: SYS, now: '2026-10-25T22:00:00Z' }, io);
    expect(rows).toEqual([{ at: '2026-10-23T06:11:02Z', station: "Thagard's Progress", marketId: 4365774083, faction: 'Order of Copernicus', commodity: 'indite', tonnes: 384, price: 13129, value: 5041536 }]);
    expect(extractMinedSales('J:/j', { systemName: SYS, now: '2026-10-25T22:00:00Z', sinceDays: 400 }, io).map((r) => r.station)).toEqual(['Old', "Thagard's Progress"]);
  });
  it('surface yields: per body, summed by commodity, this system only', () => {
    const recs = [
      { k: 'collect', at: '2026-09-02T17:02:55Z', body: `${SYS} 2 a`, system: SYS, commodities: { Helium: 8 }, tonnes: 8 },
      { k: 'collect', at: '2026-09-03T01:11:41Z', body: `${SYS} 1 a`, system: SYS, commodities: { Thortveitite: 12, Ruby: 2 }, tonnes: 14 },
      { k: 'collect', at: '2026-09-04T01:11:41Z', body: `${SYS} 1 a`, system: SYS, commodity: 'Thortveitite', tonnes: 6 },
      { k: 'collect', at: '2026-09-04T02:00:00Z', body: 'HIP 52629 A 2 a', system: 'HIP 52629', commodities: { Diamond: 9 }, tonnes: 9 },
      { k: 'drop', at: '2026-09-03T01:11:41Z', body: `${SYS} 1 a`, system: SYS },
    ];
    const y = surfaceYieldsFor(recs, SYS);
    expect(y).toEqual([
      { body: `${SYS} 1 a`, collects: 2, tonnes: 20, lastAt: '2026-09-04T01:11:41Z', commodities: { Thortveitite: 18, Ruby: 2 } },
      { body: `${SYS} 2 a`, collects: 1, tonnes: 8, lastAt: '2026-09-02T17:02:55Z', commodities: { Helium: 8 } },
    ]);
  });
});
