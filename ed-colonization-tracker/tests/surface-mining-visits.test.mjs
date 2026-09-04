// Visits are windows between drops, computed at read time — nothing stores a site on a
// collection. That is what lets a drop the exe missed be restored from the journal afterwards and
// re-partition the tonnage correctly, and what makes "fix this visit" and "moved here" two
// different records. Everything here runs on a temp copy; the live ledger is never touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initSurfaceMining, getSurfaceSummary, getSurfaceSnapshot, setCurrentSite,
  backfillFromJournals, seedLiveStateFromLedger, recordSighting, noteMiningLock, bodyNameFromLedger,
} from '../server/journal/surfaceMining.js';

const BODY = 'Test Sector AA-A a0-0 1 a';
const OTHER = 'Test Sector AA-A a0-0 1 b';
const SYS = 'Test Sector AA-A a0-0';
const ADDR = 123456789;
const line = (o) => JSON.stringify(o) + '\n';
const collect = (at, commodity, tonnes, lat, lon) => ({
  k: 'collect', at, endedAt: at.replace(/:00Z$/, ':59Z'), body: BODY, system: SYS, systemAddress: ADDR,
  lat, lon, radius: 2004994, commodity, commodities: { [commodity]: tonnes }, tonnes, materials: {},
});

let dir; let journalDir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-surface-'));
  journalDir = path.join(dir, 'journals');
  fs.mkdirSync(journalDir);
  const ledger = [
    {
      k: 'drop', at: '2026-09-02T01:11:41Z', body: BODY, system: SYS, systemAddress: ADDR,
      lat: -30.7, lon: 128.9, radius: 2004994,
      navName: '$SAA_Unknown_Signal:#type=$PlanetaryMiningLocation_Name;:#index=2;',
      navLabel: 'Planetary Mining Location Signal (2)', navBody: 14, siteIndex: 2, bodyId: 14,
    },
    collect('2026-09-02T01:30:00Z', 'Ruby', 10, -30.2, 128.7),
    collect('2026-09-02T02:00:00Z', 'Ruby', 5, -30.2, 128.7),
    // One rig emptying sliced in two by a summary read mid-collection — must read back as ONE.
    collect('2026-09-02T02:05:00Z', 'Ruby', 2, -30.2, 128.7),
    collect('2026-09-02T02:05:30Z', 'Ruby', 3, -30.2, 128.7),
    // The exe was down for the move: this one happened at the new site with no drop before it.
    collect('2026-09-02T02:50:00Z', 'Thortveitite', 7, -30.25, 127.24),
  ];
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), ledger.map(line).join(''), 'utf8');
  // The journal the exe missed: the move at 02:34:12, plus a drop on a body that was never mined.
  fs.writeFileSync(path.join(journalDir, 'Journal.2026-09-02T185715.01.log'), [
    { timestamp: '2026-09-02T02:33:41Z', event: 'SupercruiseEntry', StarSystem: SYS, SystemAddress: ADDR },
    { timestamp: '2026-09-02T02:34:12Z', event: 'SupercruiseExit', StarSystem: SYS, SystemAddress: ADDR, Body: BODY, BodyID: 14, BodyType: 'Planet' },
    { timestamp: '2026-09-02T03:10:00Z', event: 'SupercruiseExit', StarSystem: SYS, SystemAddress: ADDR, Body: OTHER, BodyID: 15, BodyType: 'Planet' },
  ].map(line).join(''), 'utf8');
  initSurfaceMining(dir, journalDir);
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

const summary = () => getSurfaceSummary(() => 0, null);
const visitsOn = (body) => summary().visits.filter((v) => v.body === body).sort((a, b) => (a.at < b.at ? -1 : 1));
const siteRow = (body, index) => summary().bodies.find((b) => b.body === body)?.siteRows.find((r) => r.index === index);

describe('surface mining visits', () => {
  it('without the missed drop, everything after the move is still charged to Site 2', () => {
    const v = visitsOn(BODY);
    expect(v.length).toBe(1);
    expect(v[0].siteIndex).toBe(2);
    expect(v[0].tonnes).toBe(27);
  });

  it('backfill restores the missed drop — mined bodies only — and re-partitions the tonnage', () => {
    const r = backfillFromJournals(journalDir, (d) => fs.readdirSync(d).map((name) => ({ name, fullPath: path.join(d, name) })));
    expect(r.added).toBe(1); // 1 a restored; the drop on the never-mined 1 b is not a visit
    expect(visitsOn(BODY).map((x) => [x.siteIndex, x.tonnes])).toEqual([[2, 20], [null, 7]]);
    expect(visitsOn(OTHER).length).toBe(0);
    // ...and it became the current visit without a restart.
    const snap = getSurfaceSnapshot();
    expect(snap.drop.at).toBe('2026-09-02T02:34:12Z');
    expect(snap.session.startedAt).toBe('2026-09-02T02:34:12Z');
    expect(snap.session.tonnes).toBe(7);
  });

  it('a second backfill adds nothing', () => {
    const r = backfillFromJournals(journalDir, (d) => fs.readdirSync(d).map((name) => ({ name, fullPath: path.join(d, name) })));
    expect(r.added).toBe(0);
    expect(visitsOn(BODY).length).toBe(2);
  });

  it('"fix this visit" names the restored drop and leaves Site 2 alone', () => {
    const rec = setCurrentSite({ body: BODY, siteIndex: 1 });
    expect(rec.at).toBe('2026-09-02T02:34:12Z'); // dated to the visit it corrects
    const v = visitsOn(BODY);
    expect(v.length).toBe(2); // merged with the journal drop, not a third visit
    expect(v.map((x) => [x.siteIndex, x.tonnes])).toEqual([[2, 20], [1, 7]]);
    expect(siteRow(BODY, 2).tonnes).toBe(20);
    expect(siteRow(BODY, 2).collections).toBe(3); // 10t, 5t, and the sliced 2t+3t read back as one
    expect(siteRow(BODY, 1).tonnes).toBe(7);
  });

  it('"moved here" opens a new visit from now and leaves the previous one closed', () => {
    const before = Date.now() - 1000;
    const rec = setCurrentSite({ body: BODY, siteIndex: 3, moved: true });
    expect(Date.parse(rec.at)).toBeGreaterThanOrEqual(before);
    const v = visitsOn(BODY);
    expect(v.length).toBe(3);
    expect(v[1]).toMatchObject({ siteIndex: 1, tonnes: 7 });
    expect(v[2]).toMatchObject({ siteIndex: 3, tonnes: 0 });
    const snap = getSurfaceSnapshot();
    expect(snap.drop.siteIndex).toBe(3);
    expect(snap.session.tonnes).toBe(0);
  });

  it('re-seeding picks the latest drop by time, not by file order', () => {
    seedLiveStateFromLedger();
    expect(getSurfaceSnapshot().drop.siteIndex).toBe(3);
  });

  it('a commodity already pulled at a site shows as expected there and cannot be tagged onto it again', () => {
    expect(siteRow(BODY, 2).expected).toEqual(['Ruby']); // pulled, never tagged
    expect(recordSighting({ body: BODY, siteIndex: 2, commodity: 'ruby' })).toBe('exists');
    expect(recordSighting({ body: BODY, siteIndex: 2, commodity: 'Copper' })).toBe(true);
    expect(recordSighting({ body: BODY, siteIndex: 2, commodity: 'copper' })).toBe('exists');
    expect(siteRow(BODY, 2).expected).toEqual(['Copper', 'Ruby']); // tagged first, then pulled
    expect(siteRow(BODY, 2).tonnes).toBe(20);
    expect(siteRow(BODY, 2).collections).toBe(3); // 10t, 5t, and the sliced 2t+3t read back as one // a sighting never carries tonnage
  });

  it('the summary snapshot names the locked body, same as the snapshot endpoint, without touching the live lock', () => {
    noteMiningLock({
      name: '$SAA_Unknown_Signal:#type=$PlanetaryMiningLocation_Name;:#index=4;',
      nameLocalised: 'Planetary Mining Location Signal (4)', body: 14, system: ADDR,
    });
    expect(bodyNameFromLedger(ADDR, 14)).toBe(BODY);
    expect(bodyNameFromLedger(ADDR, 99)).toBeNull();
    const s = summary().snapshot;
    expect(s.lock).toMatchObject({ index: 4, bodyId: 14, body: BODY });
    expect(getSurfaceSnapshot().lock.body).toBeUndefined(); // the module's own lock stays raw
  });
});
