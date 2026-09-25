// The ship's tracked position: deploy places it, the 2 km line marks it departed, a burst while it is
// within reach is a dismiss, a burst while it is gone is a recall (placed at the Rhino 35 s on, assumed),
// and a transfer or boarding confirms. Rigs sit at this visit's deposits until you board.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSurfaceMining, ingestSurfaceMining, getSurfaceSnapshot, setCurrentSite, tickCompass } from '../server/journal/surfaceMining.js';

const BODY = 'Test Sector AA-A a0-0 1 a';
const SYS = 'Test Sector AA-A a0-0';
const ADDR = 123456789;
const R = 2_000_000;                 // planet radius in metres: 1° of latitude ≈ 34.9 km
const F_IN_SRV = 1 << 26;
let dir; let journalDir;
const status = (lat, lon) => fs.writeFileSync(path.join(journalDir, 'Status.json'), JSON.stringify({ Flags: F_IN_SRV, Flags2: 0, Latitude: lat, Longitude: lon, BodyName: BODY, PlanetRadius: R, Altitude: 0, Heading: 90 }));
const now = () => new Date().toISOString();
const feed = (...events) => ingestSurfaceMining({ allEvents: events.map((e) => ({ timestamp: now(), ...e })) }, { system: SYS, systemAddress: ADDR }, null);
const kmNorth = (km) => (km * 1000) / (R * Math.PI / 180); // degrees of latitude

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-ship-'));
  journalDir = path.join(dir, 'journals');
  fs.mkdirSync(journalDir);
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), '', 'utf8');
  initSurfaceMining(dir, journalDir);
});
afterAll(() => { vi.useRealTimers(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

describe('the ship and the rigs', () => {
  it('deploying the Rhino places the ship where it hovers, and a manual drop opens the visit', () => {
    status(10, 20);
    setCurrentSite({ body: BODY, siteIndex: 3, system: SYS, systemAddress: ADDR });
    feed({ event: 'LaunchSRV', SRVType: 'rhino', PlayerControlled: true, ID: 45 });
    const s = getSurfaceSnapshot();
    expect(s.ship.status).toBe('here');
    expect(s.ship.spot).toMatchObject({ lat: 10, lon: 20 });
    expect(s.ship.departM).toBe(2000);
    expect(s.rigDestructM).toBe(4500);
    expect(s.rigs).toEqual([]);
  });

  it('a rig is assumed at the deposit being worked', () => {
    status(10.01, 20);                                  // ~350 m north
    feed({ event: 'Cargo', Vessel: 'SRV', Count: 1 }, { event: 'MiningRefined', Type: '$ruby_name;', Type_Localised: 'Ruby' });
    const s = getSurfaceSnapshot();
    expect(s.rigs.length).toBe(1);
    expect(s.rigs[0]).toMatchObject({ lat: 10.01, lon: 20, commodity: 'Ruby' });
  });

  it('crossing the 2 km line marks the ship departed; a burst then reads as a recall and places it at the Rhino 35 s on, assumed', () => {
    status(10 + kmNorth(2.5), 20);
    tickCompass();
    expect(getSurfaceSnapshot().ship.status).toBe('departed');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    feed({ event: 'SAASignalsFound', BodyName: BODY, BodyID: 14, SystemAddress: ADDR, Signals: [{ Type: '$SAA_SignalType_Geological;', Count: 3 }] });
    expect(getSurfaceSnapshot().ship.status).toBe('departed');   // nothing yet: the burst is a promise, not an arrival
    vi.advanceTimersByTime(36_000);
    const s = getSurfaceSnapshot();
    expect(s.ship.status).toBe('assumed');
    expect(s.ship.spot.lat).toBeCloseTo(10 + kmNorth(2.5), 6);
    vi.useRealTimers();
  });

  it('a transfer into the ship confirms the spot; a burst with the ship within reach is a dismiss', () => {
    feed({ event: 'CargoTransfer', Transfers: [{ Type: 'ruby', Type_Localised: 'Ruby', Count: 1, Direction: 'toship' }] });
    expect(getSurfaceSnapshot().ship.status).toBe('here');
    feed({ event: 'SAASignalsFound', BodyName: BODY, BodyID: 14, SystemAddress: ADDR, Signals: [{ Type: '$SAA_SignalType_Geological;', Count: 3 }] });
    expect(getSurfaceSnapshot().ship.status).toBe('departed');
  });

  it('boarding places the ship exactly here and counts as recovering the rigs', () => {
    feed({ event: 'DockSRV', SRVType: 'rhino', ID: 45 });
    const s = getSurfaceSnapshot();
    expect(s.ship.status).toBe('here');
    expect(s.rigs).toEqual([]);
  });
});
