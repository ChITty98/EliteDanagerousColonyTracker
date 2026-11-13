// Ship Stable lifetime (server/journal/ships.js extractShipLifetime) and the engineering chips (src/lib/shipStats.ts), 1.60.38.
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/loadouts-2026-10.json';
import { extractShipLifetime, summarizeLifetimeText, shipRecordFromLoadout } from '../server/journal/ships.js';
import { engineeringSummary } from '../src/lib/shipStats';

const J = (o) => JSON.stringify(o);
const A = [
  J({ timestamp: '2026-10-01T00:00:00Z', event: 'LoadGame', ShipID: 31, Ship: 'PantherMkII' }),
  J({ timestamp: '2026-10-01T00:01:00Z', event: 'FSDJump', JumpDist: 30, FuelUsed: 5 }),
  J({ timestamp: '2026-10-01T00:02:00Z', event: 'JetConeBoost', BoostValue: 4 }),
  J({ timestamp: '2026-10-01T00:03:00Z', event: 'FSDJump', JumpDist: 50, FuelUsed: 6 }),
  J({ timestamp: '2026-10-01T00:04:00Z', event: 'MarketBuy', Type: 'steel', Count: 1304, BuyPrice: 3000, TotalCost: 3912000 }),
  J({ timestamp: '2026-10-01T00:05:00Z', event: 'ColonisationContribution', Contributions: [{ Name: '$Steel_name;', Amount: 1000 }, { Name: '$Aluminium_name;', Amount: 304 }] }),
  J({ timestamp: '2026-10-01T00:06:00Z', event: 'Scan', ScanType: 'AutoScan', SystemAddress: 1, BodyID: 2, BodyName: 'X 1', WasDiscovered: false }),
  J({ timestamp: '2026-10-01T00:07:00Z', event: 'Scan', ScanType: 'Detailed', SystemAddress: 1, BodyID: 2, BodyName: 'X 1', WasDiscovered: false }),
  J({ timestamp: '2026-10-01T00:08:00Z', event: 'Scan', ScanType: 'AutoScan', SystemAddress: 1, BodyID: 3, BodyName: 'X A Belt Cluster 1', WasDiscovered: false }),
  J({ timestamp: '2026-10-01T00:09:00Z', event: 'Scan', ScanType: 'NavBeaconDetail', SystemAddress: 9, BodyID: 4, BodyName: 'Y 4', WasDiscovered: true }),
  J({ timestamp: '2026-10-01T00:10:00Z', event: 'ShipyardSwap', ShipID: 36, ShipType: 'explorer_nx' }),
  J({ timestamp: '2026-10-01T00:11:00Z', event: 'MiningRefined', Type: 'Thortveitite' }),
  J({ timestamp: '2026-10-01T00:12:00Z', event: 'MiningRefined', Type: 'Thortveitite' }),
  J({ timestamp: '2026-10-01T00:13:00Z', event: 'EngineerCraft', Engineer: 'Felicity Farseer', BlueprintName: 'FSD_LongRange', Level: 5 }),
].join('\n');
const B = [ // a continuation file: no LoadGame, so the first jump is the Caspian's
  J({ timestamp: '2026-10-02T00:00:00Z', event: 'FSDJump', JumpDist: 10 }),
  J({ timestamp: '2026-10-02T00:01:00Z', event: 'EngineerCraft', Engineer: 'Felicity Farseer', BlueprintName: 'FSD_LongRange', Level: 5 }),
  J({ timestamp: '2026-10-02T00:02:00Z', event: 'Loadout', ShipID: 31, Ship: 'panthermkii' }),
  J({ timestamp: '2026-10-02T00:03:00Z', event: 'FSDJump', JumpDist: 20 }),
].join('\n');

describe('lifetime per ship', () => {
  it('credits each event to the ship being flown, carrying the ship across files', async () => {
    const files = { a: A, b: B };
    const out = await extractShipLifetime('J:/j', { listFiles: () => [{ fullPath: 'a', size: 1, mtimeMs: 1 }, { fullPath: 'b', size: 1, mtimeMs: 2 }], readFile: (p) => files[p], cache: new Map() });
    expect(out.ships['31']).toMatchObject({ jumps: 3, ly: 100, longest: 50, neutron: 1, boughtT: 1304, delivered: 1304, refined: 0, scans: 1, firstDiscoveries: 1 });
    expect(out.ships['36']).toMatchObject({ jumps: 1, ly: 10, refined: 2 });
    expect(out.ships['36'].engineers).toEqual([{ name: 'Felicity Farseer', crafts: 2, first: '2026-10-01T00:13:00Z', last: '2026-10-02T00:01:00Z' }]);
  });
  it('reads a file again only when its size or modification time changed', async () => {
    const reads = []; const files = { a: A, b: B }; const cache = new Map();
    const io = (bSize) => ({ listFiles: () => [{ fullPath: 'a', size: 1, mtimeMs: 1 }, { fullPath: 'b', size: bSize, mtimeMs: 2 }], readFile: (p) => { reads.push(p); return files[p]; }, cache });
    expect((await extractShipLifetime('J:/j', io(1))).reread).toBe(2);
    expect((await extractShipLifetime('J:/j', io(1))).reread).toBe(0);
    const third = await extractShipLifetime('J:/j', io(2));
    expect(third.reread).toBe(1);
    expect(reads).toEqual(['a', 'b', 'b']);
    expect(third.ships['31'].jumps).toBe(3);
  });
  it('a file with no ship events at all keeps everything in its prefix', () => {
    const s = summarizeLifetimeText(J({ timestamp: '2026-10-03T00:00:00Z', event: 'FSDJump', JumpDist: 7 }));
    expect([...s.parts.keys()]).toEqual(['prefix']);
    expect(s.endShip).toBeNull();
  });
});

describe('engineering chips', () => {
  const rec = (id) => shipRecordFromLoadout({ ...fixture.loadouts.find((l) => l.ShipID === id), event: 'Loadout' });
  it('the Panther: thrusters G5 with Drag Drives, FSD G5, no shield generator, five engineered cargo racks', () => {
    const s = engineeringSummary(rec(31));
    const by = Object.fromEntries(s.core.map((c) => [c.key, c]));
    expect(by.MainEngines).toMatchObject({ state: 'engineered', grade: 5, experimental: 'Drag Drives' });
    expect(by.MainEngines.title).toBe('Thrusters 8A: Dirty G5 + Drag Drives');
    expect(by.FrameShiftDrive).toMatchObject({ state: 'engineered', grade: 5 });
    expect(by.ShieldGenerator.state).toBe('none');
    expect(s.others).toEqual([expect.objectContaining({ label: 'cargo rack', count: 5, grade: 5, experimental: false })]);
    expect(s.any).toBe(true);
  });
  it("the Type-8's shield generator is engineered; a stock ship's thrusters read stock", () => {
    expect(engineeringSummary(rec(28)).core.find((c) => c.key === 'ShieldGenerator').state).toBe('engineered');
    const stock = engineeringSummary(rec(44)); // the second Type-8, stock thrusters
    expect(stock.core.find((c) => c.key === 'MainEngines').state).toBe('stock');
  });
  it('a record written before 1.60.38 still shows what it knows and marks the rest unread', () => {
    const r = rec(31); delete r.engineered; delete r.coreItems;
    const s = engineeringSummary(r);
    expect(s.core.find((c) => c.key === 'MainEngines').state).toBe('engineered');
    expect(s.core.find((c) => c.key === 'PowerPlant').state).toBe('unknown');
  });
});

describe('combat, distance and earnings (1.60.40)', () => {
  const C = [
    J({ timestamp: '2026-10-01T00:00:00Z', event: 'LoadGame', ShipID: 6, Ship: 'Anaconda' }),
    J({ timestamp: '2026-10-01T00:00:10Z', event: 'Location', StarSystem: 'Home', StarPos: [0, 0, 100], Docked: false }),
    J({ timestamp: '2026-10-01T00:01:00Z', event: 'Bounty', Target: 'python', TotalReward: 100000 }),
    J({ timestamp: '2026-10-01T00:02:00Z', event: 'Loadout', ShipID: 15, Ship: 'empire_fighter' }), // flying the fighter: still the Anaconda's kill
    J({ timestamp: '2026-10-01T00:03:00Z', event: 'Bounty', Target: 'viper', TotalReward: 50000 }),
    J({ timestamp: '2026-10-01T00:04:00Z', event: 'LaunchSRV', SRVType: 'testbuggy' }),
    J({ timestamp: '2026-10-01T00:05:00Z', event: 'Bounty', Target: 'skimmerdrone', TotalReward: 1000 }),
    J({ timestamp: '2026-10-01T00:06:00Z', event: 'DockSRV' }),
    J({ timestamp: '2026-10-01T00:07:00Z', event: 'Disembark', SRV: false, OnPlanet: true }),
    J({ timestamp: '2026-10-01T00:08:00Z', event: 'Bounty', Target: 'suitai_soldier', TotalReward: 2000 }),
    J({ timestamp: '2026-10-01T00:09:00Z', event: 'FactionKillBond', Reward: 3000 }),
    J({ timestamp: '2026-10-01T00:10:00Z', event: 'Embark', SRV: false }),
    J({ timestamp: '2026-10-01T00:11:00Z', event: 'FactionKillBond', Reward: 20000 }),
    J({ timestamp: '2026-10-01T00:12:00Z', event: 'PVPKill', Victim: 'someone', CombatRank: 3 }),
    J({ timestamp: '2026-10-01T00:13:00Z', event: 'CommunityGoal', CurrentGoals: [{ CGID: 1, Title: 'Resupply', SystemName: 'Minerva', MarketName: 'Starlace Station', Expiry: '2026-12-01T00:00:00Z' }] }),
    J({ timestamp: '2026-10-01T00:14:00Z', event: 'Docked', StationName: 'Starlace Station', StarSystem: 'Minerva', StationType: 'Coriolis' }),
    J({ timestamp: '2026-10-01T00:15:00Z', event: 'MarketSell', Type: 'cmmcomposite', Count: 10, SellPrice: 60000, AvgPricePaid: 6000 }),
    J({ timestamp: '2026-10-01T00:16:00Z', event: 'Undocked', StationName: 'Starlace Station' }),
    J({ timestamp: '2026-10-01T00:17:00Z', event: 'Docked', StationName: 'Other Port', StarSystem: 'Elsewhere', StationType: 'Coriolis' }),
    J({ timestamp: '2026-10-01T00:18:00Z', event: 'MarketSell', Type: 'cmmcomposite', Count: 10, SellPrice: 7000, AvgPricePaid: 6000 }),
    J({ timestamp: '2026-10-01T00:19:00Z', event: 'CommunityGoalReward', Name: 'Resupply', System: 'Minerva', Reward: 275000000 }),
    J({ timestamp: '2026-10-01T00:20:00Z', event: 'MissionCompleted', Name: 'Mission_Mining_name', Reward: 50000000 }),
    J({ timestamp: '2026-10-01T00:21:00Z', event: 'MultiSellExplorationData', TotalEarnings: 1000000 }),
    J({ timestamp: '2026-10-01T00:22:00Z', event: 'Undocked', StationName: 'Other Port' }),
    J({ timestamp: '2026-10-01T00:30:00Z', event: 'FSDJump', StarSystem: 'Far', StarPos: [3000, 0, 4000], JumpDist: 40 }),
    J({ timestamp: '2026-10-01T00:40:00Z', event: 'Docked', StationName: 'K8R-M2X', StarSystem: 'Far', StationType: 'FleetCarrier' }),
    J({ timestamp: '2026-10-01T01:00:00Z', event: 'CarrierJump', StarSystem: 'Farther', StarPos: [3000, 0, 4500], Docked: true }),
  ].join('\n');
  it('counts ship kills, bonds and player kills, not SRV or on-foot kills; a fighter you fly is the carrying ship', async () => {
    const out = await extractShipLifetime('J:/j', { listFiles: () => [{ fullPath: 'c', size: 1, mtimeMs: 1 }], readFile: () => C, cache: new Map() });
    const s = out.ships['6'];
    expect(out.ships['15']).toBeUndefined();
    expect(s).toMatchObject({ kills: 2, bountyCr: 150000, bonds: 1, bondCr: 20000, playerKills: 1 });
    expect(s.victims).toEqual([{ name: 'python', count: 1 }, { name: 'viper', count: 1 }]);
  });
  it('separates community-goal sales from trade and counts CG rewards, missions, exploration and combat claims', async () => {
    const out = await extractShipLifetime('J:/j', { listFiles: () => [{ fullPath: 'c', size: 1, mtimeMs: 1 }], readFile: () => C, cache: new Map() });
    const e = out.ships['6'].earned;
    expect(e).toMatchObject({ trade: 10000, cgSales: 540000, cgRewards: 275000000, missions: 50000000, exploration: 1000000, combat: 170000 });
    expect(e.total).toBe(10000 + 540000 + 275000000 + 50000000 + 1000000 + 170000);
  });
  it('distance: systems visited, carried while docked on the carrier, farthest from Sol', async () => {
    const out = await extractShipLifetime('J:/j', { listFiles: () => [{ fullPath: 'c', size: 1, mtimeMs: 1 }], readFile: () => C, cache: new Map() });
    const s = out.ships['6'];
    expect(s).toMatchObject({ jumps: 1, ly: 40, carriedLy: 500, systems: 2 });
    expect(s.farthest).toEqual({ ly: Math.round(Math.hypot(3000, 0, 4500)), system: 'Farther' });
  });
  it('a login on foot is not a ship, and its kills are not counted', () => {
    const s = summarizeLifetimeText([
      J({ timestamp: '2026-10-02T00:00:00Z', event: 'LoadGame', ShipID: 1700, Ship: 'TacticalSuit_Class1' }),
      J({ timestamp: '2026-10-02T00:01:00Z', event: 'Bounty', Target: 'suitai_scout', TotalReward: 5000 }),
    ].join('\n'));
    expect(s.endShip).toBeNull();
    expect(s.parts.get('prefix').kills).toBe(0);
  });
});
