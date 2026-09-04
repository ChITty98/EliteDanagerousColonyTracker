// A login on the surface is a visit boundary. Without it, a signal worked across two evenings read
// as one 20-hour visit (1 b signal 7: 230 t at "2.5 M/h", ranked eighth on Where to go back).
// The journal's Location event at login carries the position and the body; the signal is
// inherited from the last drop on that body. Temp copy throughout — the live ledger is never touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSurfaceMining, getSurfaceSummary, backfillFromJournals } from '../server/journal/surfaceMining.js';

const BODY = 'Test Sector AA-A a0-0 1 b';
const SYS = 'Test Sector AA-A a0-0';
const ADDR = 123456789;
const line = (o) => JSON.stringify(o) + '\n';
const collect = (at, commodity, tonnes) => ({
  k: 'collect', at, endedAt: at.replace(/:00Z$/, ':59Z'), body: BODY, system: SYS, systemAddress: ADDR,
  lat: -36.1, lon: 143.1, radius: 2004994, commodity, commodities: { [commodity]: tonnes }, tonnes, materials: {},
});

let dir; let journalDir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-resume-'));
  journalDir = path.join(dir, 'journals');
  fs.mkdirSync(journalDir);
  const ledger = [
    { k: 'drop', at: '2026-09-03T06:14:17Z', body: BODY, system: SYS, systemAddress: ADDR, lat: -36.0, lon: 143.0, radius: 2004994,
      navName: '$SAA_Unknown_Signal:#type=$PlanetaryMiningLocation_Name;:#index=7;', navLabel: 'Planetary Mining Location Signal (7)', navBody: 15, siteIndex: 7, bodyId: 15 },
    collect('2026-09-03T06:27:00Z', 'Grandidierite', 8),
    collect('2026-09-03T06:47:00Z', 'Grandidierite', 17),
    // Logged out at 06:52, back the next day at 01:46 — nothing in the ledger marks it.
    collect('2026-09-04T02:01:00Z', 'Grandidierite', 21),
    collect('2026-09-04T02:28:00Z', 'Grandidierite', 23),
  ];
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), ledger.map(line).join(''), 'utf8');
  fs.writeFileSync(path.join(journalDir, 'Journal.2026-09-04T014528.01.log'), [
    { timestamp: '2026-09-04T01:45:28Z', event: 'LoadGame', Commander: 'Test', Ship: 'MEV_Rhino' },
    { timestamp: '2026-09-04T01:46:03Z', event: 'Location', Latitude: -36.114967, Longitude: 143.111023, Docked: false, InSRV: true, StarSystem: SYS, SystemAddress: ADDR, Body: BODY, BodyID: 15, BodyType: 'Planet' },
    { timestamp: '2026-09-04T02:32:43Z', event: 'LoadGame', Commander: 'Test', Ship: 'MEV_Rhino' },
    // A login docked at a station carries no Latitude — never a drop.
    { timestamp: '2026-09-04T09:00:00Z', event: 'Location', Docked: true, StarSystem: SYS, SystemAddress: ADDR, Body: 'Test Sector AA-A a0-0 A', BodyID: 1, BodyType: 'Star', StationName: 'Somewhere Hub' },
  ].map(line).join(''), 'utf8');
  initSurfaceMining(dir, journalDir);
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

const visits = () => getSurfaceSummary(() => 0, null).visits.filter((v) => v.body === BODY).sort((a, b) => (a.at < b.at ? -1 : 1));
const list = (d) => fs.readdirSync(d).map((name) => ({ name, fullPath: path.join(d, name) }));

describe('a surface login splits the visit', () => {
  it('before the backfill, both evenings are one visit and the clock runs across the night', () => {
    const v = visits();
    expect(v.length).toBe(1);
    expect(v[0].tonnes).toBe(69);
    expect(v[0].hours).toBeGreaterThan(19);
  });

  it('the login is restored as a resumed drop that inherits the signal, and each evening keeps its own clock', () => {
    const r = backfillFromJournals(journalDir, list);
    expect(r.added).toBe(1); // the surface login; the docked one is not a drop
    const v = visits();
    expect(v.map((x) => [x.at, x.siteIndex, x.tonnes])).toEqual([
      ['2026-09-03T06:14:17Z', 7, 25],
      ['2026-09-04T01:46:03Z', 7, 44],
    ]);
    expect(v[0].hours).toBeCloseTo(0.55, 1);   // 06:14 → 06:47:59
    expect(v[1].hours).toBeCloseTo(0.72, 1);   // 01:46 → 02:28:59
    expect(v[1].label).toBe('Signal 7 (resumed)');
    expect(v[1].lat).toBeCloseTo(-36.115, 2);
  });

  it('a second backfill adds nothing', () => {
    expect(backfillFromJournals(journalDir, list).added).toBe(0);
    expect(visits().length).toBe(2);
  });
});
