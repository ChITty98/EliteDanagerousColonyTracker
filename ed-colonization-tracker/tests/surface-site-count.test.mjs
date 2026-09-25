// The site count reaches the summary from the FSS as well as the DSS (1.60.14): FSSBodySignals has carried
// Planetary Mining Location since the journals of 6 September 2026. A DSS count outranks an FSS count, an
// FSS count outranks one typed from the system map, and the backfill replays the FSS history too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSurfaceMining, ingestSurfaceMining, getSurfaceSummary, recordSiteCount, backfillFromJournals } from '../server/journal/surfaceMining.js';

const SYS = 'Test Sector AA-A a0-0';
const ADDR = 123456789;
const A = `${SYS} 1 a`;
const B = `${SYS} 2 b`;
const C = `${SYS} 3 c`;
let dir; let journalDir;
const at = (s) => `2026-09-18T05:00:${String(s).padStart(2, '0')}Z`;
const mining = (n) => [{ Type: '$PlanetaryMiningLocation_Name;', Type_Localised: 'Planetary Mining Location', Count: n }];
const feed = (...events) => ingestSurfaceMining({ allEvents: events }, { system: SYS, systemAddress: ADDR }, null);
const row = (name) => getSurfaceSummary(() => 0, null).bodies.find((b) => b.body === name);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-sites-'));
  journalDir = path.join(dir, 'journals');
  fs.mkdirSync(journalDir);
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), '', 'utf8');
  initSurfaceMining(dir, journalDir);
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

describe('the site count from the FSS', () => {
  it('an FSS resolve counts the body, and a count typed afterwards never outranks it', () => {
    feed({ timestamp: at(1), event: 'FSSBodySignals', BodyName: A, BodyID: 2, SystemAddress: ADDR, Signals: mining(18) });
    expect(row(A)).toMatchObject({ sitesKnown: 18, sitesSource: 'fss', sitesManual: false });
    recordSiteCount({ body: A, system: SYS, systemAddress: ADDR, bodyId: 2, count: 25 });
    expect(row(A)).toMatchObject({ sitesKnown: 18, sitesSource: 'fss' });
  });

  it('a DSS outranks the FSS, and a later FSS resolve does not demote it', () => {
    feed({ timestamp: at(2), event: 'SAASignalsFound', BodyName: A, BodyID: 2, SystemAddress: ADDR, Signals: mining(19) });
    expect(row(A)).toMatchObject({ sitesKnown: 19, sitesSource: 'dss' });
    feed({ timestamp: at(3), event: 'FSSBodySignals', BodyName: A, BodyID: 2, SystemAddress: ADDR, Signals: mining(18) });
    expect(row(A)).toMatchObject({ sitesKnown: 19, sitesSource: 'dss' });
  });

  it('a typed count fills the gap until the FSS resolves the body', () => {
    recordSiteCount({ body: B, system: SYS, systemAddress: ADDR, bodyId: 5, count: 7 });
    expect(row(B)).toMatchObject({ sitesKnown: 7, sitesSource: 'manual', sitesManual: true });
    feed({ timestamp: at(4), event: 'FSSBodySignals', BodyName: B, BodyID: 5, SystemAddress: ADDR, Signals: mining(9) });
    expect(row(B)).toMatchObject({ sitesKnown: 9, sitesSource: 'fss', sitesManual: false });
  });

  it('the backfill replays FSS counts out of journal history', () => {
    const name = 'Journal.2026-09-06T020000.01.log';
    const fullPath = path.join(journalDir, name);
    fs.writeFileSync(fullPath, [
      JSON.stringify({ timestamp: '2026-09-06T07:05:00Z', event: 'FSDJump', StarSystem: SYS, SystemAddress: ADDR, StarPos: [0, 0, 0] }),
      JSON.stringify({ timestamp: '2026-09-06T07:06:15Z', event: 'FSSBodySignals', BodyName: C, BodyID: 8, SystemAddress: ADDR, Signals: mining(4) }),
      '',
    ].join('\n'));
    const st = fs.statSync(fullPath);
    const r = backfillFromJournals(journalDir, () => [{ name, fullPath, mtimeMs: st.mtimeMs, size: st.size }]);
    expect(r.added).toBeGreaterThanOrEqual(1);
    expect(row(C)).toMatchObject({ sitesKnown: 4, sitesSource: 'fss' });
  });
});
