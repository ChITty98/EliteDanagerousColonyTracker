/**
 * Live scan scoring: the FSSAllBodiesFound handler with the journal's own scans against Spansh, the
 * Location arming, and the one-system journal refresh. YI-V c17-36 (1.60.13): three stars auto-scanned
 * one day, a relog two days on, seven planets scanned, Spansh holding the one star — and no score.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resetScanState, resetScanStateIfElsewhere, handleScanEventOverlay, handleFSSAllBodiesFoundOverlay, mergeScannedBodies,
} from '../server/journal/overlay.js';
import { extractExplorationData } from '../server/journal/extractor.js';

const ADDR = 9981134836450;
const NAME = 'Col 173 Sector YI-V c17-36';
const OTHER = 111222333444;
const POS = [1014.5, -83.5, 74.6875];

const star = (id, letter, ls) => ({ timestamp: '2026-09-16T18:21:12Z', event: 'Scan', ScanType: 'AutoScan', BodyName: `${NAME} ${letter}`, BodyID: id, StarSystem: NAME, SystemAddress: ADDR, DistanceFromArrivalLS: ls, StarType: 'TTS', StellarMass: 0.5, WasDiscovered: true, WasMapped: false });
const giant = (id, n, cls) => ({ timestamp: '2026-09-18T04:41:40Z', event: 'Scan', ScanType: 'Detailed', BodyName: `${NAME} BC ${n}`, BodyID: id, StarSystem: NAME, SystemAddress: ADDR, DistanceFromArrivalLS: 21000, PlanetClass: `Sudarsky class ${cls} gas giant`, Landable: false, MassEM: 300, SurfaceGravity: 40, WasDiscovered: true, WasMapped: false });
const icy = (id) => ({ timestamp: '2026-09-18T04:42:20Z', event: 'Scan', ScanType: 'Detailed', BodyName: `${NAME} BC 1 a`, BodyID: id, StarSystem: NAME, SystemAddress: ADDR, DistanceFromArrivalLS: 21100, PlanetClass: 'Icy body', Landable: true, MassEM: 0.01, SurfaceGravity: 1.2, Atmosphere: '', WasDiscovered: true, WasMapped: false });

const stars = [star(1, 'A', 0), star(2, 'B', 21336), star(3, 'C', 21340)];
const planets = [giant(6, 5, 'I'), giant(5, 4, 'I'), giant(4, 2, 'I'), giant(7, 1, 'III'), giant(9, 6, 'I'), giant(8, 3, 'II'), icy(10)];
const allFound = { timestamp: '2026-09-18T04:42:20Z', event: 'FSSAllBodiesFound', SystemName: NAME, SystemAddress: ADDR, Count: 10 };

// The cache as an earlier session (or Sync All) leaves it: the three stars in the extractor's shape.
const cachedStars = stars.map((ev) => ({ bodyId: ev.BodyID, bodyName: ev.BodyName, type: 'Star', subType: 'T Tauri Star', distanceToArrival: ev.DistanceFromArrivalLS, starType: 'TTS', stellarMass: 0.5 }));
const cacheWithStars = { [ADDR]: { systemAddress: ADDR, systemName: NAME, coordinates: null, bodyCount: 10, fssAllBodiesFound: false, scannedBodies: cachedStars, lastSeen: '2026-09-16T18:21:23Z' } };

// Spansh as it holds the system: the arrival star and nothing else.
const spanshStarOnly = { name: NAME, bodies: [{ bodyId: 1, name: `${NAME} A`, type: 'Star', subType: 'T Tauri Star', distanceToArrival: 0 }] };
// Spansh with more than the journal: twelve records, none of them landable, plus the honk total.
const spanshTwelve = { name: NAME, bodyCount: 12, bodies: [
  { bodyId: 1, name: `${NAME} A`, type: 'Star', subType: 'T Tauri Star', distanceToArrival: 0 },
  ...Array.from({ length: 11 }, (_, i) => ({ bodyId: 20 + i, name: `${NAME} ${i + 1}`, type: 'Planet', subType: 'Class I gas giant', isLandable: false, earthMasses: 300, distanceToArrival: 100 + i })),
] };

function harness(dump, cache) {
  const patches = [], overlays = [], events = [];
  const deps = {
    sendOverlay: (m) => overlays.push(m),
    applyStatePatch: (p) => patches.push(p),
    broadcastEvent: (e) => events.push(e),
    fetchSystemDump: async () => dump,
  };
  const existing = {
    settings: { overlayMapAlerts: false },
    journalExplorationCache: cache || {},
    scoutedSystems: { [ADDR]: { id64: ADDR, name: NAME, isFavorite: true, notes: 'keep me', region: 'Inner Orion Spur', coordinates: { x: POS[0], y: POS[1], z: POS[2] } } },
    commanderPosition: { systemAddress: ADDR, coordinates: { x: POS[0], y: POS[1], z: POS[2] } },
  };
  const record = () => { const p = patches.find((x) => x.scoutedSystems); return p && p.scoutedSystems.__upsert[String(ADDR)]; };
  const cacheEntry = () => { const p = patches.find((x) => x.journalExplorationCache); return p && p.journalExplorationCache.__upsert[String(ADDR)]; };
  return { deps, existing, patches, overlays, events, record, cacheEntry };
}

describe('live scan scoring', () => {
  it('a Location arms the recorder; scans before it are dropped, scans after it score the system from the journal', async () => {
    resetScanState(null, null);
    const h = harness(spanshStarOnly);
    handleScanEventOverlay(planets[0], h.existing, h.deps); // nothing armed: dropped, as every scan after a relog was
    expect(resetScanStateIfElsewhere(ADDR, NAME)).toBe(true);
    for (const ev of planets) handleScanEventOverlay(ev, h.existing, h.deps);
    await handleFSSAllBodiesFoundOverlay(allFound, h.existing, h.deps);
    const r = h.record();
    expect(r.fromJournal).toBe(true);
    expect(r.journalScannedCount).toBe(7);
    expect(r.totalBodyCount).toBe(10);
    expect(r.spanshBodyCount).toBe(1);
    expect(r.score.total).toBe(0); // six gas giants and an airless icy moon score nothing — but the system is classified
    expect(r.isFavorite).toBe(true); // the prior record's own fields survive a live rescore
    expect(r.notes).toBe('keep me');
    expect(r.coordinates).toEqual({ x: POS[0], y: POS[1], z: POS[2] });
    expect(h.cacheEntry().scannedBodies.length).toBe(7);
    expect(h.cacheEntry().fssAllBodiesFound).toBe(true);
    expect(h.events.find((e) => e.type === 'score_update').source).toBe('Journal');
  });

  it('the cache from an earlier session merges with the live buffer, and a relog into the same system keeps the buffer', async () => {
    resetScanState(ADDR, NAME);
    const h = harness(spanshStarOnly, cacheWithStars);
    for (const ev of planets.slice(0, 3)) handleScanEventOverlay(ev, h.existing, h.deps);
    expect(resetScanStateIfElsewhere(ADDR, NAME)).toBe(false); // same system: nothing reset
    for (const ev of planets.slice(3)) handleScanEventOverlay(ev, h.existing, h.deps);
    await handleFSSAllBodiesFoundOverlay(allFound, h.existing, h.deps);
    const r = h.record();
    expect(r.fromJournal).toBe(true);
    expect(r.journalScannedCount).toBe(10);
    expect(r.totalBodyCount).toBe(10);
    const c = h.cacheEntry();
    expect(c.scannedBodies.length).toBe(10);
    expect(c.scannedBodies.filter((b) => b.type === 'Star').length).toBe(3);
  });

  it('Spansh scores the system only when it holds strictly more records, and the journal scans are kept either way', async () => {
    resetScanState(ADDR, NAME);
    const h = harness(spanshTwelve);
    for (const ev of planets) handleScanEventOverlay(ev, h.existing, h.deps);
    await handleFSSAllBodiesFoundOverlay(allFound, h.existing, h.deps);
    const r = h.record();
    expect(r.fromJournal).toBe(false);
    expect(r.spanshBodyCount).toBe(12);
    expect(r.journalScannedCount).toBe(7);
    expect(r.totalBodyCount).toBe(12);
    expect(r.fssAllBodiesFound).toBe(true);
    expect(r.notes).toBe('keep me');
    expect(h.cacheEntry().scannedBodies.length).toBe(7); // kept for the next Rescore to compare
    expect(h.events.find((e) => e.type === 'score_update').source).toBe('Spansh');

    // A tie goes to the journal: seven on Spansh against seven scanned.
    resetScanState(ADDR, NAME);
    const tie = harness({ name: NAME, bodies: spanshTwelve.bodies.slice(0, 7) });
    for (const ev of planets) handleScanEventOverlay(ev, tie.existing, tie.deps);
    await handleFSSAllBodiesFoundOverlay(allFound, tie.existing, tie.deps);
    expect(tie.record().fromJournal).toBe(true);
    expect(tie.record().spanshBodyCount).toBe(7);
  });

  it('mergeScannedBodies lays the live buffer over the cache by body id, carrying signal counts', () => {
    const cached = [{ bodyId: 1, bodyName: 'X A', type: 'Star' }, { bodyId: 5, bodyName: 'X 1', type: 'Planet', bioSignals: 3 }];
    const live = [{ bodyId: 5, bodyName: 'X 1', type: 'Planet', subType: 'Rocky body' }, { bodyId: 6, bodyName: 'X 2', type: 'Planet' }];
    const m = mergeScannedBodies(cached, live);
    expect(m.map((b) => b.bodyId)).toEqual([1, 5, 6]);
    expect(m[1].subType).toBe('Rocky body');
    expect(m[1].bioSignals).toBe(3);
    expect(mergeScannedBodies(undefined, live).length).toBe(2);
  });
});

describe('one-system journal refresh', () => {
  it('parses only the journal files that mention the address, and builds the system across sessions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-refresh-'));
    const line = (o) => JSON.stringify(o) + '\n';
    try {
      fs.writeFileSync(path.join(dir, 'Journal.2026-09-10T000000.01.log'),
        line({ timestamp: '2026-09-10T00:00:10Z', event: 'FSDJump', StarSystem: 'Elsewhere', SystemAddress: OTHER, StarPos: [1, 2, 3] })
        + line({ timestamp: '2026-09-10T00:00:20Z', event: 'Scan', ScanType: 'AutoScan', BodyName: 'Elsewhere A', BodyID: 1, StarSystem: 'Elsewhere', SystemAddress: OTHER, DistanceFromArrivalLS: 0, StarType: 'K', StellarMass: 0.8 }));
      fs.writeFileSync(path.join(dir, 'Journal.2026-09-16T120129.01.log'),
        line({ timestamp: '2026-09-16T18:21:06Z', event: 'FSDJump', StarSystem: NAME, SystemAddress: ADDR, StarPos: POS })
        + stars.map(line).join('')
        + line({ timestamp: '2026-09-16T18:21:22Z', event: 'FSSDiscoveryScan', Progress: 0.39, BodyCount: 10, NonBodyCount: 0, SystemName: NAME, SystemAddress: ADDR }));
      fs.writeFileSync(path.join(dir, 'Journal.2026-09-17T232843.01.log'),
        line({ timestamp: '2026-09-18T04:36:05Z', event: 'Location', StarSystem: NAME, SystemAddress: ADDR, StarPos: POS })
        + line({ timestamp: '2026-09-18T04:38:30Z', event: 'FSSDiscoveryScan', Progress: 0.39, BodyCount: 10, NonBodyCount: 0, SystemName: NAME, SystemAddress: ADDR })
        + planets.map(line).join('')
        + line(allFound));

      const one = extractExplorationData(dir, { address: ADDR });
      expect(one.has(OTHER)).toBe(false); // that file never mentions the address and was not parsed
      const sys = one.get(ADDR);
      expect(sys.systemName).toBe(NAME);
      expect(sys.bodyCount).toBe(10);
      expect(sys.fssAllBodiesFound).toBe(true);
      expect(sys.scannedBodies.length).toBe(10);
      expect(sys.coordinates).toEqual({ x: POS[0], y: POS[1], z: POS[2] });

      const all = extractExplorationData(dir);
      expect(all.has(OTHER)).toBe(true);
      expect(all.get(ADDR).scannedBodies.length).toBe(10);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
