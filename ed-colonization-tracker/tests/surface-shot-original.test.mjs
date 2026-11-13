// 1.62.1 — "also delete the original" deletes only the very shot a photo came from. The game reuses
// screenshot names: Screenshot_0041.bmp was a deposit marker on 3 Sep and a station screen on 2 Nov, and
// deleting the September photo by name would have deleted the November picture. Temp copies throughout —
// the live ledger and the real Pictures folder are never touched.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSurfaceMining, isRecordedScreenshotFile } from '../server/journal/surfaceMining.js';

const SYS = 'Test Sector AA-A a0-0';
const mark = (at, body, file, extra = {}) => ({
  k: 'mark', at, body, system: SYS, systemAddress: 1, lat: -36.2, lon: 143.2, heading: 0, altitude: 0.3, file: `\\ED_Pictures\\${file}`, ...extra,
});

let pics;
beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-shot-original-'));
  pics = path.join(dir, 'pictures');
  fs.mkdirSync(pics);
  const ledger = [
    mark('2026-09-03T06:23:41Z', `${SYS} 1 b`, 'Screenshot_0041.bmp'),
    mark('2026-11-02T02:28:08Z', "Thagard's Progress", 'Screenshot_0041.bmp', { altitude: null }),
  ];
  fs.writeFileSync(path.join(dir, 'surface-mining-log.jsonl'), ledger.map((r) => JSON.stringify(r)).join('\n') + '\n');
  initSurfaceMining(dir, null);
  // The file in Pictures now is the NEWER shot of that name, written 2 Nov 02:28:07.6Z.
  const f = path.join(pics, 'Screenshot_0041.bmp');
  fs.writeFileSync(f, 'bmp');
  const t = new Date('2026-11-02T02:28:07.647Z');
  fs.utimesSync(f, t, t);
  fs.writeFileSync(path.join(pics, 'Screenshot_0099.bmp'), 'bmp');
});

describe('deleting an original screenshot', () => {
  it('never deletes a newer picture that reuses the photo\'s name', () => {
    // The 3 Sep deposit photo: its marker is two months older than the file now in Pictures.
    expect(isRecordedScreenshotFile(path.join(pics, 'Screenshot_0041.bmp'), '2026-09-03T06:23:41.309Z')).toBe(false);
  });
  it('recognises the very shot a photo came from', () => {
    expect(isRecordedScreenshotFile(path.join(pics, 'Screenshot_0041.bmp'), '2026-11-02T02:28:09.105Z')).toBe(true);
  });
  it('leaves alone files no marker names, missing files, and photos without a time', () => {
    expect(isRecordedScreenshotFile(path.join(pics, 'Screenshot_0099.bmp'), '2026-11-02T02:28:09Z')).toBe(false);
    expect(isRecordedScreenshotFile(path.join(pics, 'Screenshot_0042.bmp'), '2026-11-02T02:28:09Z')).toBe(false);
    expect(isRecordedScreenshotFile(path.join(pics, 'Screenshot_0041.bmp'), null)).toBe(false);
  });
});
