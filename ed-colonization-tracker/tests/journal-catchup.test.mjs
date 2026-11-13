// 1.62.4 — the journal reader carries on from where it stopped. The case that found it: the 2 Nov
// dock at Atmo Sky Cairn Asc, written in the minutes between closing one build and starting the next,
// was skipped (the tail started at the end of the file) and the station kept the faction that had just
// lost it. Temp files throughout — the real journals are never touched.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planCatchUp, readAligned, readJournalPosition, writeJournalPosition, catchUp, quietDeps } from '../server/journal/watcher.js';
import { listJournalFiles } from '../server/journal/paths.js';

const line = (o) => JSON.stringify(o) + '\n';
const dock = (ts, faction) => line({ timestamp: ts, event: 'Docked', StationName: 'Atmo Sky Cairn Asc', StationType: 'CraterPort', StarSystem: 'Col 173 Sector AX-J d9-52', SystemAddress: 1797401856371, MarketID: 4371599107, StationFaction: { Name: faction } });

let dir; let older; let newer; let olderCut;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-catchup-'));
  older = path.join(dir, 'Journal.2026-11-01T200719.01.log');
  newer = path.join(dir, 'Journal.2026-11-03T120000.01.log');
  const seen = line({ timestamp: '2026-11-02T03:42:20Z', event: 'Docked', StationName: "Thagard's Progress", MarketID: 4365774083, StarSystem: 'Col 173 Sector AX-J d9-52', StationFaction: { Name: 'Order of Copernicus' } });
  const missed = dock('2026-11-02T03:57:16Z', 'Order of Copernicus');
  fs.writeFileSync(older, seen + missed);
  olderCut = Buffer.byteLength(seen); // the reader had processed up to here when the exe closed
  fs.writeFileSync(newer, line({ timestamp: '2026-11-03T17:47:51Z', event: 'Docked', StationName: 'K8R-M2X', StationType: 'FleetCarrier', MarketID: 3700000101 }));
  const t1 = new Date('2026-11-01T20:07:19Z'); const t2 = new Date('2026-11-03T12:00:00Z');
  fs.utimesSync(older, t1, t1); fs.utimesSync(newer, t2, t2);
});

describe('carrying on from where the reader stopped', () => {
  it('plans the rest of the saved file, then every newer file from the start', () => {
    const files = listJournalFiles(dir);
    const plan = planCatchUp(files, { file: path.basename(older), offset: olderCut });
    expect(plan.map((s) => [s.file.name, s.from])).toEqual([[path.basename(older), olderCut], [path.basename(newer), 0]]);
    // nothing new in the saved file: only the newer one
    expect(planCatchUp(files, { file: path.basename(older), offset: files[0].size }).map((s) => s.file.name)).toEqual([path.basename(newer)]);
    // no position, a file that is gone, or an offset past the end of its file
    expect(planCatchUp(files, null)).toEqual([]);
    expect(planCatchUp(files, { file: 'Journal.gone.log', offset: 0 })).toEqual([]);
    expect(planCatchUp(files, { file: path.basename(older), offset: 10_000_000 }).map((s) => s.file.name)).toEqual([path.basename(newer)]);
  });

  it('reads whole lines only — a line the game is still writing waits for the next tick', () => {
    const f = path.join(dir, 'partial.log');
    fs.writeFileSync(f, 'one\ntwo\nthr');
    const r = readAligned(f, 0, fs.statSync(f).size);
    expect(r.text).toBe('one\ntwo\n');
    expect(r.consumed).toBe(8);
    expect(readAligned(f, 4, fs.statSync(f).size)).toEqual({ text: 'two\n', consumed: 4 });
    expect(readAligned(f, 8, fs.statSync(f).size)).toEqual({ text: '', consumed: 0 });
  });

  it('replays the missed dock through the pipeline, muted, and tells the tail where to resume', () => {
    const files = listJournalFiles(dir);
    const batches = [];
    const deps = { readState: () => ({}), applyStatePatch: () => {}, broadcastEvent: () => { throw new Error('must be muted'); }, sendOverlay: () => { throw new Error('must be muted'); } };
    const r = catchUp(files, { file: path.basename(older), offset: olderCut }, deps, (parsed, d) => {
      batches.push(parsed);
      expect(parsed.catchUp).toBe(true);
      d.broadcastEvent({ type: 'docked' }); // muted: must not throw
      d.sendOverlay({ id: 'x' });
      expect(d.readState).toBe(deps.readState); // the rest of the deps are the real ones
    });
    expect(r.replayed).toBe(2);
    expect(r.steps).toBe(2);
    expect(batches[0].dockedEvents.map((e) => [e.StationName, e.StationFaction.Name])).toEqual([['Atmo Sky Cairn Asc', 'Order of Copernicus']]);
    expect(batches[1].dockedEvents.map((e) => e.StationName)).toEqual(['K8R-M2X']);
    expect(r.resumeAt).toBe(fs.statSync(newer).size); // the live tail carries on at the end of the latest file
  });

  it('replays nothing without a position, and keeps the position file honest', () => {
    const files = listJournalFiles(dir);
    expect(catchUp(files, null, {}, () => { throw new Error('should not run'); })).toEqual({ replayed: 0, resumeAt: null, steps: 0 });
    const pf = path.join(dir, 'journal-position.json');
    expect(readJournalPosition(pf)).toBeNull();
    writeJournalPosition(pf, { file: path.basename(newer), offset: 42 });
    expect(readJournalPosition(pf)).toMatchObject({ file: path.basename(newer), offset: 42 });
    fs.writeFileSync(pf, '{not json');
    expect(readJournalPosition(pf)).toBeNull();
    fs.writeFileSync(pf, JSON.stringify({ file: 'x', offset: -1 }));
    expect(readJournalPosition(pf)).toBeNull();
    expect(quietDeps({ readState: 'r' }).readState).toBe('r');
  });
});
