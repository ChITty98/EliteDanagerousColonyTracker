// The Sell Cargo plan: hold + carrier rows, here / local / galaxy offers with the demand floor,
// your own records beating Ardent, totals, and trade-nearby pairs. Ardent is a stub keyed by
// path; the journal dir is a temp Cargo.json; the state is in memory. Nothing live is touched.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initMarketHistory } from '../server/journal/marketHistory.js';
import { buildSellPlan, bestSell, lowestBuy } from '../server/journal/sellPlan.js';

const NOW = Date.parse('2026-09-04T12:00:00Z');
const DAY = 86400e3;
const iso = (ms) => new Date(ms).toISOString();
const ME = 'Col 173 Sector AX-J d9-52';

const state = {
  settings: { myFleetCarrier: 'TST-9ZZ' },
  commanderPosition: { systemName: ME, systemAddress: 1, coordinates: { x: 0, y: 0, z: 0 } },
  currentDock: { marketId: 100, stationName: 'Atmo Sky Cairn Asc', systemName: ME, dockedAt: iso(NOW - 3600e3) },
  currentShip: { shipId: 1, type: 'explorer_nx', cargoCapacity: 322 },
  knownSystems: {
    [ME.toLowerCase()]: { systemName: ME, population: 5000, coordinates: { x: 0, y: 0, z: 0 } },
    'near': { systemName: 'Near', population: 100, coordinates: { x: 10, y: 0, z: 0 } },
    'far': { systemName: 'Far', population: 100, coordinates: { x: 400, y: 0, z: 0 } },
    'empty': { systemName: 'Empty', population: 0, coordinates: { x: 5, y: 0, z: 0 } },
  },
  marketSnapshots: {
    100: { marketId: 100, stationName: 'Atmo Sky Cairn Asc', systemName: ME, stationType: 'CraterOutpost', updatedAt: iso(NOW - 2 * 3600e3), commodities: [
      { commodityId: 'thortveitite', name: 'Thortveitite', sellPrice: 240547, demand: 23859, buyPrice: 0, stock: 0 },
      { commodityId: 'iridium', name: 'Iridium', sellPrice: 240542, demand: 639023, buyPrice: 0, stock: 0 },
      { commodityId: 'steel', name: 'Steel', sellPrice: 0, demand: 0, buyPrice: 2000, stock: 5000 },
    ] },
    200: { marketId: 200, stationName: 'Stale Port', systemName: 'Near', stationType: 'Outpost', updatedAt: iso(NOW - 90 * DAY), commodities: [
      { commodityId: 'thortveitite', name: 'Thortveitite', sellPrice: 999999, demand: 99999, buyPrice: 0, stock: 0 },
    ] },
  },
  carrierCargo: { 'TST-9ZZ': { callsign: 'TST-9ZZ', isEstimate: true, updatedAt: iso(NOW - DAY), items: [{ commodityId: 'grandidierite', name: 'Grandidierite', count: 180 }] } },
};

const ardent = {
  [`/system/name/${encodeURIComponent(ME)}/commodity/name/thortveitite/nearby/imports?maxDistance=50&fleetCarriers=false`]: [],
  [`/system/name/${encodeURIComponent(ME)}/commodity/name/thortveitite/nearby/imports?maxDistance=500&fleetCarriers=false`]: [
    { commodityName: 'thortveitite', marketId: 300, stationName: 'Borel Vista', systemName: 'Synuefe YL-J d10-60', stationType: 'Orbis', maxLandingPadSize: 3, sellPrice: 327007, demand: 254520, updatedAt: iso(NOW - DAY), distance: 303, systemX: 303, systemY: 0, systemZ: 0 },
    { commodityName: 'thortveitite', marketId: 301, stationName: 'Tiny Demand', systemName: 'Nearby', stationType: 'Outpost', maxLandingPadSize: 2, sellPrice: 500000, demand: 5, updatedAt: iso(NOW), distance: 40, systemX: 40, systemY: 0, systemZ: 0 },
  ],
  '/commodity/name/thortveitite/imports?fleetCarriers=false': [
    { commodityName: 'thortveitite', marketId: 400, stationName: "TolaGarf's Junkyard", systemName: 'Kojeara', stationType: 'Outpost', maxLandingPadSize: 3, sellPrice: 894814, demand: 18576, updatedAt: iso(NOW), systemX: 22000, systemY: 0, systemZ: 0 },
    { commodityName: 'thortveitite', marketId: 401, stationName: 'Carrier X', systemName: 'Kojeara', stationType: 'FleetCarrier', sellPrice: 2000000, demand: 500, updatedAt: iso(NOW), systemX: 22000, systemY: 0, systemZ: 0 },
  ],
  [`/system/name/${encodeURIComponent(ME)}/commodities`]: [
    { commodityName: 'steel', marketId: 100, stationName: 'Atmo Sky Cairn Asc', systemName: ME, stationType: 'CraterOutpost', maxLandingPadSize: 3, buyPrice: 2200, stock: 9000, sellPrice: 0, demand: 0, updatedAt: iso(NOW - 30 * DAY) },
    { commodityName: 'gold', marketId: 100, stationName: 'Atmo Sky Cairn Asc', systemName: ME, stationType: 'CraterOutpost', maxLandingPadSize: 3, buyPrice: 40000, stock: 10, sellPrice: 0, demand: 0, updatedAt: iso(NOW) }, // stock < load
  ],
  '/system/name/Near/commodities': [
    { commodityName: 'steel', marketId: 500, stationName: 'Near Port', systemName: 'Near', stationType: 'Coriolis', maxLandingPadSize: 3, buyPrice: 0, stock: 0, sellPrice: 5000, demand: 10000, updatedAt: iso(NOW - 2 * DAY) },
    { commodityName: 'gold', marketId: 500, stationName: 'Near Port', systemName: 'Near', stationType: 'Coriolis', maxLandingPadSize: 3, buyPrice: 0, stock: 0, sellPrice: 60000, demand: 10000, updatedAt: iso(NOW - 2 * DAY) },
    { commodityName: 'water', marketId: 500, stationName: 'Near Port', systemName: 'Near', stationType: 'Coriolis', maxLandingPadSize: 3, buyPrice: 300, stock: 50000, sellPrice: 0, demand: 0, updatedAt: iso(NOW - 2 * DAY) },
  ],
};
const calls = [];
const fetchJson = async (p) => { calls.push(p); return Object.prototype.hasOwnProperty.call(ardent, p) ? ardent[p] : null; };

let journalDir;
beforeAll(() => {
  journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-sell-'));
  fs.writeFileSync(path.join(journalDir, 'Cargo.json'), JSON.stringify({ timestamp: iso(NOW - 600e3), event: 'Cargo', Vessel: 'Ship', Count: 64, Inventory: [
    { Name: 'thortveitite', Count: 20, Stolen: 0 }, { Name: 'iridium', Count: 44, Stolen: 0 },
  ] }));
  initMarketHistory(fs.mkdtempSync(path.join(os.tmpdir(), 'edca-sell-hist-')), { now: NOW });
});

describe('sell plan', () => {
  it('prices the hold and the carrier here, locally and across the galaxy, with the demand floor', async () => {
    const plan = await buildSellPlan({ state, journalDir, rangeLy: 50, searched: [{ name: 'Low Temp. Diamonds', tonnes: 72 }], fetchJson, now: NOW });
    expect(plan.ship.capacity).toBe(322);
    expect(plan.ship.items.map((i) => i.count)).toEqual([20, 44]);
    expect(plan.carrier.callsign).toBe('TST-9ZZ');
    expect(plan.dock.station).toBe('Atmo Sky Cairn Asc');

    const t = plan.rows.find((r) => r.key === 'thortveitite');
    expect(t.name).toBe('Thortveitite');
    expect(t.ship).toBe(20);
    expect(t.tonnes).toBe(20);
    expect(t.here.price).toBe(240547);
    expect(t.here.source).toBe('yours');
    expect(t.local.price).toBe(240547);          // the stale 999,999 record is ignored
    expect(t.local.onlyYours).toBe(true);        // Ardent's local list did not have ASC
    expect(t.galaxy.price).toBe(327007);         // Tiny Demand (5 t) cannot take 20 t
    expect(t.galaxy.station).toBe('Borel Vista');
    expect(t.galaxy.distance).toBe(303);
    expect(t.top).toBeNull();                    // Kojeara is 22,000 ly out — Colonia is not your galaxy; the carrier at 2M is out too
    expect(plan.history.thortveitite).toBeUndefined(); // and nothing reachable was worth sampling

    const g = plan.rows.find((r) => r.key === 'grandidierite');
    expect(g.carrier).toBe(180);
    expect(g.here).toBeNull();                   // ASC does not list it
    expect(g.unknownToArdent).toBe(true);        // stub returns null for it everywhere

    const ltd = plan.rows.find((r) => r.key === 'lowtemperaturediamond');
    expect(ltd.name).toBe('Low Temperature Diamonds');
    expect(ltd.searched).toBe(72);
    expect(ltd.tonnes).toBe(72);

    // Totals: here = 20×240547 + 44×240542; local the same; galaxy = Borel Vista for thortveitite and
    // ASC itself for iridium (your own markets within a carrier jump are buyers too); nothing for grandidierite.
    expect(plan.totals.tonnes).toBe(20 + 44 + 180 + 72);
    expect(plan.totals.here).toBe(20 * 240547 + 44 * 240542);
    expect(plan.totals.local).toBe(20 * 240547 + 44 * 240542);
    expect(plan.totals.galaxy).toBe(20 * 327007 + 44 * 240542);
  });

  it('a top-of-book buyer within reach shows as the top and is sampled into the history', async () => {
    const near = {
      ...ardent,
      '/commodity/name/thortveitite/imports?fleetCarriers=false': [
        { commodityName: 'thortveitite', marketId: 402, stationName: 'Asimov Landing', systemName: 'LHS 2441', stationType: 'Outpost', maxLandingPadSize: 3, sellPrice: 600104, demand: 2517, updatedAt: iso(NOW), systemX: 991, systemY: 0, systemZ: 0 },
        { commodityName: 'thortveitite', marketId: 400, stationName: "TolaGarf's Junkyard", systemName: 'Kojeara', stationType: 'Outpost', maxLandingPadSize: 3, sellPrice: 894814, demand: 18576, updatedAt: iso(NOW), systemX: 22000, systemY: 0, systemZ: 0 },
      ],
    };
    const plan = await buildSellPlan({ state, journalDir, rangeLy: 50, fetchJson: async (p) => near[p] ?? null, now: NOW });
    const t = plan.rows.find((r) => r.key === 'thortveitite');
    expect(t.top.price).toBe(600104);
    expect(t.top.distance).toBe(991);
    expect(plan.history.thortveitite.days[0].galaxy).toBe(600104); // sampled without Colonia
  });

  it('finds the lowest buy → highest sell pair within range, own records winning when newer', async () => {
    const plan = await buildSellPlan({ state, journalDir, rangeLy: 50, fetchJson, now: NOW });
    expect(plan.trade.systems).toBe(2);           // me + Near; Far is out of range, Empty is unpopulated
    expect(calls).toContain('/system/name/Near/commodities');
    expect(calls.some((p) => p.includes('/system/name/Far/'))).toBe(false);
    const steel = plan.trade.rows.find((r) => r.key === 'steel');
    expect(steel.buy.price).toBe(2000);           // your own ASC record (2 h old) beats Ardent's 2,200 (30 d old)
    expect(steel.buy.source).toBe('yours');
    expect(steel.sell.station).toBe('Near Port');
    expect(steel.perTonne).toBe(3000);
    expect(steel.perLoad).toBe(3000 * 322);
    expect(steel.leg).toBe(10);
    expect(plan.trade.rows.find((r) => r.key === 'gold')).toBeUndefined();  // 10 t in stock cannot fill a 322 t load
    expect(plan.trade.rows.find((r) => r.key === 'water')).toBeUndefined(); // no buyer
  });

  it('without a position, prices only the galaxy and skips trade', async () => {
    const plan = await buildSellPlan({ state: { ...state, commanderPosition: null, currentDock: null }, journalDir, rangeLy: 50, fetchJson, now: NOW });
    const t = plan.rows.find((r) => r.key === 'thortveitite');
    expect(t.here).toBeNull();
    expect(t.local).toBeNull();
    expect(t.galaxy).toBeNull();
    expect(t.top.price).toBe(894814);            // no position → no distance → nothing can be ruled out of reach
    expect(plan.trade.rows).toEqual([]);
  });

  it('bestSell / lowestBuy honour the floor and prefer the nearer station on a tie', () => {
    const rows = [
      { sellPrice: 100, demand: 10, distance: 50, buyPrice: 5, stock: 10 },
      { sellPrice: 100, demand: 10, distance: 5, buyPrice: 5, stock: 10 },
      { sellPrice: 200, demand: 1, distance: 1, buyPrice: 1, stock: 1 },
      { sellPrice: 300, demand: 10, distance: 1, stationType: 'FleetCarrier', buyPrice: 1, stock: 100 },
    ];
    expect(bestSell(rows, 10).distance).toBe(5);
    expect(lowestBuy(rows, 10).distance).toBe(5);
    expect(bestSell(rows, 1).sellPrice).toBe(200);
    expect(bestSell([], 1)).toBeNull();
  });
});
