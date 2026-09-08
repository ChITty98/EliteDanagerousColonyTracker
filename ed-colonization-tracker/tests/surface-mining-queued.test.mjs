// Two things the surface ledger must read back honestly:
//   1. Queued refinery output. A full hold cannot take finished bins; the transfer empties it and
//      they drop in a second later with the Rhino parked at the ship. Those tonnes belong to the
//      rig just worked, not to a new deposit at the ship — and the ledger is append-only, so the
//      correction is made at read time and repairs what is already on file.
//   2. The breadcrumb track is the DRIVE. Ship samples in the file (older builds sampled every low
//      pass) never reach the map, the route planner or the pace.
// Everything here runs on a temp copy; the live ledger is never touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSurfaceMining, getSurfaceSummary, readTrack } from '../server/journal/surfaceMining.js';

const BODY = 'Test Sector AA-A a0-0 1 a';
const SYS = 'Test Sector AA-A a0-0';
const ADDR = 123456789;
const R = 2004994;
const line = (o) => JSON.stringify(o) + '\n';
const collect = (at, endedAt, commodity, tonnes, lat, lon) => ({
  k: 'collect', at, endedAt, body: BODY, system: SYS, systemAddress: ADDR, siteIndex: 4, bodyId: 14,
  lat, lon, radius: R, commodity, commodities: { [commodity]: tonnes }, tonnes, materials: {},
});

// The rig 1.4 km from where the ship was recalled to; the ship's spot; a rig placed by the ship.
const RIG = { lat: -31.0484, lon: 127.4092 };
const SHIP = { lat: -31.0128, lon: 127.4342 };
const BY_SHIP = { lat: -31.0100, lon: 127.4300 };

let dir; let journalDir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-queued-'));
  journalDir = path.join(dir, 'journals');
  fs.mkdirSync(journalDir);
  const ledger = [
    {
      k: 'drop', at: '2026-09-06T07:13:52Z', body: BODY, system: SYS, systemAddress: ADDR,
      lat: -31.3644, lon: 126.7983, radius: R,
      navName: '$SAA_Unknown_Signal:#type=$PlanetaryMiningLocation_Name;:#index=4;',
      navLabel: 'Planetary Mining Location Signal (4)', navBody: 14, siteIndex: 4, bodyId: 14,
    },
    collect('2026-09-06T07:45:43Z', '2026-09-06T07:47:22Z', 'Thortveitite', 9, RIG.lat, RIG.lon),
    {
      k: 'trip', at: '2026-09-06T07:48:17Z', startedAt: '2026-09-06T07:23:57Z', body: BODY, system: SYS, systemAddress: ADDR,
      siteIndex: 4, bodyId: 14, tonnes: 75, commodities: { Thortveitite: 75 }, reason: 'transfer',
      transferred: [{ commodity: 'thortveitite', count: 72 }],
    },
    // Two seconds after the transfer, same commodity as the rig just left, parked at the ship: queued output.
    collect('2026-09-06T07:48:19Z', '2026-09-06T07:49:21Z', 'Thortveitite', 2, SHIP.lat, SHIP.lon),
    // Twenty seconds after, a different commodity: a real rig placed beside the ship. Stays put.
    collect('2026-09-06T07:48:37Z', '2026-09-06T07:51:00Z', 'Platinum', 12, BY_SHIP.lat, BY_SHIP.lon),
  ];
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), ledger.map(line).join(''), 'utf8');
  // The breadcrumb file with an approach glide (ship), a drive (SRV) and a walk (on foot).
  const now = Date.now();
  const at = (secAgo) => new Date(now - secAgo * 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'surface-track.jsonl'), [
    { at: at(400), body: BODY, lat: -31.20, lon: 127.30, heading: 45, alt: 2400, srv: false, foot: false, landed: false },
    { at: at(390), body: BODY, lat: -31.10, lon: 127.35, heading: 45, alt: 900, srv: false, foot: false, landed: false },
    { at: at(300), body: BODY, lat: -31.00, lon: 127.41, heading: 90, alt: 0, srv: true, foot: false, landed: false },
    { at: at(290), body: BODY, lat: -31.01, lon: 127.42, heading: 90, alt: 1, srv: true, foot: false, landed: false },
    { at: at(200), body: BODY, lat: -31.02, lon: 127.43, heading: 90, alt: 0, srv: false, foot: true, landed: false },
    { at: at(100), body: BODY, lat: -31.02, lon: 127.44, heading: 270, alt: 30, srv: false, foot: false, landed: false },
    // Five days old: one within the rig's site span (kept for coverage), one 20 km away (not).
    { at: at(5 * 86400), body: BODY, lat: RIG.lat + 0.02, lon: RIG.lon, heading: 0, alt: 0, srv: true, foot: false, landed: false },
    { at: at(5 * 86400 + 30), body: BODY, lat: RIG.lat + 0.6, lon: RIG.lon, heading: 0, alt: 0, srv: true, foot: false, landed: false },
  ].map(line).join(''), 'utf8');
  initSurfaceMining(dir, journalDir);
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

const depositsOn = (body) => getSurfaceSummary(() => 0, null).deposits.filter((d) => d.body === body);
const metres = (a, b) => {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R;
};

describe('queued refinery output', () => {
  it('credits the tonnes that drop in right after a transfer to the rig they came from', () => {
    const thort = depositsOn(BODY).filter((d) => (d.commodities || {}).Thortveitite > 0);
    expect(thort.length).toBe(1);                              // no second Thortveitite deposit at the ship
    expect(thort[0].commodities.Thortveitite).toBe(11);        // 9 from the rig + the 2 queued
    expect(metres(thort[0], RIG)).toBeLessThan(50);            // and it sits on the rig
  });

  it('leaves a different commodity where it was recorded — a rig beside the ship is real', () => {
    const plat = depositsOn(BODY).filter((d) => (d.commodities || {}).Platinum > 0);
    expect(plat.length).toBe(1);
    expect(plat[0].commodities.Platinum).toBe(12);
    expect(metres(plat[0], BY_SHIP)).toBeLessThan(50);
  });
});

describe('the breadcrumb track is the drive', () => {
  it('reads back SRV and on-foot samples only — never the ship', () => {
    const pts = readTrack(null)[BODY] || [];
    expect(pts.length).toBe(3);                                // the two old samples are outside 48 h
    expect(pts.every((p) => p.srv || p.foot)).toBe(true);
    expect(pts.some((p) => p.alt >= 900)).toBe(false);         // the approach glide is gone
  });

  it('keeps old samples near a signal\'s deposits, whatever their age, so gaps read across evenings', () => {
    const pts = getSurfaceSummary(() => 0, null).track[BODY] || [];
    expect(pts.length).toBe(4);                                // 48 h window + the one within 3 km of the rig
    expect(pts.some((p) => Math.abs(p.lat - (RIG.lat + 0.02)) < 1e-6)).toBe(true);
    expect(pts.some((p) => Math.abs(p.lat - (RIG.lat + 0.6)) < 1e-6)).toBe(false);
  });
});
