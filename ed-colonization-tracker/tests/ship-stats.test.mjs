// The ship stable's figures (src/lib/shipStats.ts) against the commander's own ships (tests/fixtures/loadouts-2026-10.json)
// and the journal capture (server/journal/ships.js), 1.60.33.
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/loadouts-2026-10.json';
import { shipRecordFromLoadout, storedShipsFromEvent, craftFromLaunch, recordCraft, extractShipInventory } from '../server/journal/ships.js';
import { speedAndBoost, jumpRanges, shieldStrength, craftFigures, massCurveMultiplier, engineeredThrusterCurve, moduleLabel } from '../src/lib/shipStats';
import { hullFor, thrusterCurve, FSDS } from '../src/data/ships';

const records = fixture.loadouts.map((l) => shipRecordFromLoadout({ ...l, event: 'Loadout' }));
const byType = (t) => records.find((r) => r.type === t);
const type8 = records.find((r) => r.shipId === 28);

describe('capture', () => {
  it('reads the Panther: masses, values, engineered thrusters and FSD, racks ignored', () => {
    const p = byType('panthermkii');
    expect(p.cargoCapacity).toBe(1304);
    expect(p.unladenMass).toBeCloseTo(1525.3, 1);
    expect(p.maxJumpRange).toBeCloseTo(38.86, 2);
    expect(p.fuelMain).toBe(128);
    expect(p.thrusters).toMatchObject({ size: 8, rating: 'A' });
    expect(p.thrusters.engineering).toMatchObject({ blueprint: 'Engine_Dirty', grade: 5, experimental: 'Drag Drives' });
    expect(p.thrusters.engineering.modifiers.EngineOptimalMass).toEqual({ value: 2940, original: 3360 });
    expect(p.fsd).toMatchObject({ size: 7, rating: 'A', overcharge: true });
    expect(p.fsd.engineering.modifiers.FSDOptimalMass.value).toBe(4836);
    expect(p.planetaryApproach).toBe(true);
    expect(p.shieldGenerator).toBeNull();
  });
  it('reads bays: the Caspian has the Rhino-capable large bay and the built-in vessel bay', () => {
    const c = byType('explorer_nx');
    expect(c.srvBays).toHaveLength(1);
    expect(c.srvBays[0].large).toBe(true);
    expect(c.fighterBays.some((b) => b.vessel)).toBe(true);
    const corvette = byType('federation_corvette');
    expect(craftFigures(corvette, null)).toMatchObject({ srvBays: 1, srvCount: 2, rhinoCapable: false, vesselHangars: 1, vesselCapacity: 2, builtInVesselBay: false });
    expect(craftFigures(c, null)).toMatchObject({ vesselHangars: 1, builtInVesselBay: true });
    expect(craftFigures(c, { srv: { type: 'SRV Rhino', at: '2026-10-01T00:00:00Z' } }).last.srv.type).toBe('SRV Rhino');
  });
  it('reads StoredShips and keeps the latest craft of each kind per ship', () => {
    const s = storedShipsFromEvent({ event: 'StoredShips', ...fixture.storedShips });
    expect(s.system).toBe('Col 173 Sector AX-J d9-52');
    expect(s.ships.filter((x) => x.station).length).toBe(fixture.storedShips.ShipsHere.length);
    const remote = s.ships.find((x) => x.name === 'Fixture Ship 03');
    expect(remote).toMatchObject({ type: 'ferdelance', system: 'Aleumoxii', hot: false });
    expect(remote.transferPrice).toBeGreaterThan(0);
    expect(remote.transferTime).toBeGreaterThan(0);
    let craft = {};
    craft = recordCraft(craft, 36, craftFromLaunch({ event: 'LaunchSRV', SRVType: 'combat_multicrew_srv_01', SRVType_Localised: 'SRV Scorpion', timestamp: '2026-09-01T00:00:00Z' }));
    craft = recordCraft(craft, 36, craftFromLaunch({ event: 'LaunchSRV', SRVType_Localised: 'SRV Rhino', timestamp: '2026-10-01T00:00:00Z' }));
    craft = recordCraft(craft, 36, craftFromLaunch({ event: 'LaunchVessel', VesselType_Localised: 'Nomad', timestamp: '2026-10-02T00:00:00Z' }));
    craft = recordCraft(craft, 36, craftFromLaunch({ event: 'LaunchSRV', SRVType_Localised: 'SRV Scarab', timestamp: '2026-09-15T00:00:00Z' })); // older: ignored
    expect(craft['36']).toEqual({ srv: { type: 'SRV Rhino', at: '2026-10-01T00:00:00Z' }, vessel: { type: 'Nomad', at: '2026-10-02T00:00:00Z' } });
    expect(craftFromLaunch({ event: 'Docked' })).toBeNull();
  });
  it('backfills from journal text: latest Loadout per ship, latest StoredShips, craft attributed to the ship flying', () => {
    const J = (o) => JSON.stringify(o);
    const l1 = fixture.loadouts.find((l) => l.ShipID === 28);
    const files = { a: [J({ ...l1, event: 'Loadout', timestamp: '2026-10-01T00:00:00Z', CargoCapacity: 100 }), J({ event: 'LaunchSRV', SRVType_Localised: 'SRV Scarab', timestamp: '2026-10-01T01:00:00Z' }), J({ event: 'StoredShips', ...fixture.storedShips, timestamp: '2026-10-01T02:00:00Z' })].join('\n'),
      b: [J({ ...l1, event: 'Loadout', timestamp: '2026-10-02T00:00:00Z' }), J({ event: 'ShipyardSwap', ShipID: 36, ShipType: 'explorer_nx', timestamp: '2026-10-02T01:00:00Z' }), J({ event: 'LaunchVessel', VesselType_Localised: 'Nomad', timestamp: '2026-10-02T02:00:00Z' })].join('\n') };
    const out = extractShipInventory('J:/j', { listFiles: () => ['a', 'b'], readFile: (p) => files[p] });
    expect(out.inventory['28'].cargoCapacity).toBe(384); // the later Loadout wins
    expect(out.storedShips.at).toBe('2026-10-01T02:00:00Z');
    expect(out.craft['28'].srv.type).toBe('SRV Scarab');
    expect(out.craft['36'].vessel.type).toBe('Nomad');
  });
});

describe('speed and boost', () => {
  it('the mass curve hits its three anchors', () => {
    const c = thrusterCurve(5, 'A');
    expect(c).toEqual({ minmass: 420, optmass: 840, maxmass: 1260, minmul: 0.96, optmul: 1, maxmul: 1.16 });
    expect(massCurveMultiplier(420, c)).toBe(1.16);
    expect(massCurveMultiplier(840, c)).toBeCloseTo(1, 6);
    expect(massCurveMultiplier(1260, c)).toBe(0.96);
    expect(massCurveMultiplier(2000, c)).toBe(0.96);
  });
  it("reproduces the Type-8's in-game boost of 538 with an empty hold and a full tank (user datapoint, 2026-10-25)", () => {
    const curve = engineeredThrusterCurve(type8);
    expect(curve.optmass).toBe(735);
    expect(curve.optmul).toBeCloseTo(1.456, 3);
    const f = speedAndBoost(type8, 0);
    expect(f.mass).toBeCloseTo(463.3 + 32.52, 1);
    expect(f.boost).toBeCloseTo(538.7, 0);
    expect(speedAndBoost(type8, 384).boost).toBeCloseTo(481.4, 0);
  });
  it('a hull without base figures gives null, not a number', () => {
    expect(hullFor('anacondamkii').source).toBe('missing');
    expect(speedAndBoost(byType('anacondamkii'), 0)).toBeNull();
  });
});

describe('jump range', () => {
  it("reproduces the journal's MaxJumpRange for every ship with a known drive (mass = unladen + one jump's fuel)", () => {
    let checked = 0;
    for (const r of records) {
      if (!r.fsd || !r.maxJumpRange || r.maxJumpRange < 1 || !r.unladenMass) continue;
      if (!FSDS[r.fsd.item]) continue;
      const j = jumpRanges(r);
      expect(j.unladen, `${r.type} #${r.shipId} ${r.fsd.item}`).toBeCloseTo(r.maxJumpRange, 0);
      expect(Math.abs(j.unladen - r.maxJumpRange) / r.maxJumpRange, `${r.type} #${r.shipId}`).toBeLessThan(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });
  it('the Panther: 38.9 unladen, far less with 1,304 t aboard; the Mandalay carries a Guardian booster', () => {
    const p = jumpRanges(byType('panthermkii'));
    expect(p.unladen).toBeCloseTo(38.86, 1);
    expect(p.laden).toBeLessThan(p.unladen * 0.6);
    const m = jumpRanges(records.find((r) => r.shipId === 26));
    expect(m.boosterLy).toBe(10.5);
    expect(m.unladen).toBeCloseTo(80.2, 0);
  });
});

describe('shields (model, unvalidated)', () => {
  it('runs on the Type-8: a 4D generator engineered to 108% on a 400 t hull, no boosters', () => {
    const s = shieldStrength(type8);
    expect(s.model).toBe(true);
    expect(s.boosters).toBe(0);
    expect(s.generatorMultiplier).toBeGreaterThan(0.5);
    expect(s.generatorMultiplier).toBeLessThan(1.2);
    expect(s.mj).toBeGreaterThan(100);
    expect(s.mj).toBeLessThan(300);
  });
  it('boosters add their rating bonus; a hull without figures gives null', () => {
    const corvette = byType('federation_corvette');
    const s = shieldStrength(corvette);
    expect(s.boosters).toBe(4);
    expect(s.boosterBonus).toBeCloseTo(0.8, 6); // four 0A boosters at 20% each
    expect(s.generatorMultiplier).toBeGreaterThan(0); // 7C bi-weave on a 900 t hull
    expect(shieldStrength(byType('anacondamkii'))).toBeNull();
  });
  it('labels modules for the table', () => {
    expect(moduleLabel(byType('panthermkii').thrusters)).toBe('8A Dirty G5 + Drag Drives');
    expect(moduleLabel(type8.fsd)).toMatch(/^5A/);
  });
});

describe('against the shipyard screen (user screenshots, 2026-10-25)', () => {
  it('Corsair #34: 325 / 412, 296 MJ, 44.94 unladen, 26.86 laden — stock 7A thrusters, 4A generator, no boosters', () => {
    const r = records.find((x) => x.shipId === 34);
    const sb = speedAndBoost(r, 0);
    expect(sb.speed).toBeCloseTo(325, 0);
    expect(sb.boost).toBeCloseTo(412, 0);
    const sh = shieldStrength(r);
    expect(sh.boosters).toBe(0);
    expect(sh.mj).toBeCloseTo(296, 0);
    const j = jumpRanges(r);
    expect(j.unladen).toBeCloseTo(44.94, 1);
    expect(j.laden).toBeCloseTo(26.86, 1); // full tank and full hold is what the screen calls laden
  });
  it('Kestrel Mk II #38: 434 / 579, 556 MJ, 23.26 unladen — Dirty G5 agile thrusters, bi-weave 5C reinforced G3, two 0C and two 0D boosters', () => {
    const r = records.find((x) => x.shipId === 38);
    const sb = speedAndBoost(r, 0);
    expect(Math.abs(sb.speed - 434) / 434).toBeLessThan(0.006);
    expect(sb.boost).toBeCloseTo(579, 0);
    const sh = shieldStrength(r);
    expect(sh.boosters).toBe(4);
    expect(sh.boosterBonus).toBeCloseTo(0.4, 6);
    expect(sh.mj).toBeCloseTo(556, 0);
    expect(jumpRanges(r).unladen).toBeCloseTo(23.26, 1);
  });
  it('Panther Clipper Mk II #31: 412 boost, 38.86 unladen, 20.2 laden with 1,304 t aboard', () => {
    const r = records.find((x) => x.shipId === 31);
    const sb = speedAndBoost(r, 0);
    expect(sb.boost).toBeCloseTo(412, 0);
    expect(Math.abs(sb.speed - 297) / 297).toBeLessThan(0.006);
    const j = jumpRanges(r);
    expect(j.unladen).toBeCloseTo(38.86, 1);
    expect(j.laden).toBeCloseTo(20.2, 1);
    expect(shieldStrength(r)).toBeNull(); // no generator fitted: the screen shows 0
  });
  it('Caspian Explorer #36: within 3% of 283 / 390 — its Loadout on file predates the current fit (the screen jumps 80.82, the Loadout 74.8)', () => {
    const r = records.find((x) => x.shipId === 36);
    const sb = speedAndBoost(r, 0);
    expect(Math.abs(sb.speed - 283) / 283).toBeLessThan(0.03);
    expect(Math.abs(sb.boost - 390) / 390).toBeLessThan(0.03);
  });
  it('Type-11 Prospector #40: 486 MJ from a 4A reinforced G1 generator and two 0A boosters; 396 / 536 within 1%', () => {
    const r = records.find((x) => x.shipId === 40);
    const sh = shieldStrength(r);
    expect(sh.boosters).toBe(2);
    expect(sh.mj).toBeCloseTo(486, 0);
    const sb = speedAndBoost(r, 0);
    expect(Math.abs(sb.speed - 396) / 396).toBeLessThan(0.01);
    expect(Math.abs(sb.boost - 536) / 536).toBeLessThan(0.01);
  });
  it('Mandalay #26: 364 / 455 and 283 MJ — the 283 only comes back with the screen\'s 190 t hull, not coriolis-data\'s 230', () => {
    const r = records.find((x) => x.shipId === 26);
    const sb = speedAndBoost(r, 0);
    expect(sb.speed).toBeCloseTo(364, 0);
    expect(sb.boost).toBeCloseTo(455, 0);
    expect(Math.abs(shieldStrength(r).mj - 283) / 283).toBeLessThan(0.005);
  });
  it('Lynx Highliner #39: the back-solved hull figures give the screen back (481 / 591, 306 MJ)', () => {
    const r = records.find((x) => x.shipId === 39);
    const sb = speedAndBoost(r, 0);
    expect(sb.speed).toBeCloseTo(481, 0);
    expect(sb.boost).toBeCloseTo(591, 0);
    expect(shieldStrength(r).mj).toBeCloseTo(306, 0);
  });
});
