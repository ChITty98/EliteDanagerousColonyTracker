/**
 * The approach coach's three rules from the 2026-11-10 replay of every run on file: a broken glide is judged against
 * where glides end at that site; a crossing at 0:06 or under is a hot entry, said at the line and enough to switch the
 * speed words on; a descent from the line with the pad under 35° below the ship is dropping short. Scripted Status and
 * journal, temp dir throughout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initApproach, noteApproachEvent, ingestApproachEvents, sampleOnce, idleTick, _setStatusReader, _setClock,
  getApproachRuns, getLiveApproach, summarizeTarget, usualGlideEnd, valueAtDistance, bodyEntryTarget, SECTOR_COLOURS,
  GLIDE_END_NOMINAL_M, GLIDE_BROKEN_OVER_M, HOT_CD, SHORT_DEG, SHORT_CLEAR_DEG, TARGET_CD, ENTRY_TARGET_STEP_M,
} from '../server/journal/approach.js';

const R = 1_000_000;                         // body radius, m
const PAD = { lat: 10, lon: 20 };
const BODY = 'Test Sector AA-A a1 1 a';
const BASE = Date.parse('2026-11-10T03:00:00Z');
const iso = (t) => new Date(BASE + t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const latAt = (distM) => PAD.lat + (distM / R) * 180 / Math.PI; // straight down the meridian from the north
const lerp = (a, b, u) => a + (b - a) * u;

let app; const events = []; const overlays = [];
const deps = { broadcastEvent: (e) => events.push(e), sendOverlay: (m) => overlays.push(m), readState: () => ({ knownStations: {}, currentShip: { type: 'panthermkii', ident: 'CH-1', shipId: 1 } }), applyStatePatch: () => {} };
let statusNow = null;
let clockBase = 0;                            // every flight gets its own stretch of the clock
beforeAll(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-coach-'));
  initApproach(app, null, deps);
  _setStatusReader(() => statusNow);
});
afterAll(() => { try { fs.rmSync(app, { recursive: true, force: true }); } catch { /* temp */ } });

/**
 * One flight. anchors: piecewise-linear { t, dist, alt }. glide: [from, to) seconds the Glide flag is set. journal:
 * [second, event]. open 'event' sends ApproachBody and the settlement at second 0; 'position' lets the idle watch take
 * the first fixes (the port has to be on file) and sends ApproachBody at lineT, if given.
 */
function fly({ mid, name, anchors, glide = null, journal = [], open = 'event', lineT = null, until = null, body = BODY }) {
  const t0 = clockBase; clockBase += 5000;
  const end = until ?? anchors[anchors.length - 1].t;
  const at = (t) => { let i = 0; while (i < anchors.length - 2 && t > anchors[i + 1].t) i++; const a = anchors[i], b = anchors[i + 1], u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1))); return { dist: lerp(a.dist, b.dist, u), alt: lerp(a.alt, b.alt, u) }; };
  const status = (t) => { const p = at(t); const gliding = !!glide && t >= glide[0] && t < glide[1]; const sc = !glide || t < glide[0]; return { at: iso(t0 + t), flags: (sc ? 1 << 4 : 0) | (1 << 21), flags2: gliding ? 1 << 12 : 0, lat: latAt(p.dist), lon: PAD.lon, alt: p.alt, hdg: 180, radius: R, body, destination: { System: 1, Body: 7, Name: name } }; };
  const ev = (t, e) => noteApproachEvent({ timestamp: iso(t0 + t), ...e }, { ship: { type: 'panthermkii', ident: 'CH-1', shipId: 1 } });
  const first = events.length;
  for (let t = 0; t <= end; t++) {
    _setClock(() => BASE + (t0 + t) * 1000);
    statusNow = null; // events first, then the fix for this second
    if (open === 'event' && t === 0) {
      ev(0, { event: 'ApproachBody', Body: body, BodyID: 7, StarSystem: 'Test Sector AA-A a1', SystemAddress: 1 });
      ev(0, { event: 'ApproachSettlement', Name: name, MarketID: mid, BodyID: 7, BodyName: body, Latitude: PAD.lat, Longitude: PAD.lon });
    }
    if (open === 'position' && lineT != null && t === lineT) ev(t, { event: 'ApproachBody', Body: body, BodyID: 7, StarSystem: 'Test Sector AA-A a1', SystemAddress: 1 });
    for (const [jt, e] of journal) if (jt === t) ev(t, e);
    statusNow = status(t);
    if (open === 'position' && !getLiveApproach().live) idleTick(); else sampleOnce();
  }
  return events.slice(first).filter((e) => e.type === 'approach_sample');
}
const landing = (glideEndAlt = 3000, glide = [18, 31]) => ({
  anchors: [{ t: 0, dist: 118000, alt: 58000 }, { t: 18, dist: 41000, alt: 24000 }, { t: 31, dist: 8900, alt: glideEndAlt }, { t: 43, dist: 6200, alt: 1400 }, { t: 102, dist: 0, alt: 0 }],
  glide,
  journal: [[18, { event: 'SupercruiseExit', BodyType: 'Planet' }], [43, { event: 'DockingRequested' }], [43, { event: 'DockingGranted', LandingPad: 2 }], [56, { event: 'Music', MusicTrack: 'DockingComputer' }], [102, { event: 'Docked' }]],
});
const leave = (t) => [t, { event: 'LeaveBody', Body: BODY, BodyID: 7 }];

describe('a broken glide is judged against where glides end at that site', () => {
  const MID = 4400000001; const key = `port:${MID}`; const name = 'Highland Works';

  it('a site where glides end 5.6 km up: clean from the first run, where one fixed 5 km called every one of them broken', () => {
    expect(usualGlideEnd(key)).toEqual({ usualAltM: GLIDE_END_NOMINAL_M, brokenAboveM: GLIDE_END_NOMINAL_M + GLIDE_BROKEN_OVER_M, fromRuns: 0, nominal: true });
    for (let i = 0; i < 3; i++) fly({ mid: MID, name, ...landing(5600) });
    const { runs, summary } = getApproachRuns(key);
    expect(runs).toHaveLength(3);
    for (const r of runs) { expect(r.glide.endAltM).toBe(5600); expect(r.glide.broken).toBe(false); expect(r.clean).toBe(true); }
    expect(summary.cleanRuns).toBe(3);
    // three glide ends of its own: the site sets its usual height, and broken starts 5 km above that
    expect(summary.glideEnd).toEqual({ usualAltM: 5600, brokenAboveM: 5600 + GLIDE_BROKEN_OVER_M, fromRuns: 3, nominal: false });
  });

  it('the flag clearing 14 km up there is still a broken glide, out of the reference, and does not move the usual height', () => {
    fly({ mid: MID, name, ...landing(5600, [18, 25]) }); // the flag clears seven seconds into a thirteen-second glide
    const { runs, summary } = getApproachRuns(key);
    const r = runs[runs.length - 1];
    expect(r.glide.endAltM).toBeGreaterThan(14000);
    expect(r.glide.broken).toBe(true);
    expect(r.clean).toBe(false);
    expect(r.marks.find((m) => m.kind === 'glide_end').broken).toBe(true);
    expect(summary.runs).toBe(4);
    expect(summary.cleanRuns).toBe(3);
    expect(summary.glideEnd).toMatchObject({ usualAltM: 5600, fromRuns: 4, nominal: false });
  });

  it('what the file says is read again on load: a run written as broken under the old rule counts, and the file is not rewritten', () => {
    const file = path.join(app, 'approach-runs.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const stored = lines.filter((l) => l.k === 'run' && l.target && l.target.key === key);
    // the first run as the old rule wrote it (5.6 km is over 5 km), and the 14 km break as if it had been written clean
    stored[0].glide.broken = true; stored[0].clean = false; stored[0].marks.find((m) => m.kind === 'glide_end').broken = true;
    stored[3].glide.broken = false; stored[3].clean = true; stored[3].marks.find((m) => m.kind === 'glide_end').broken = false;
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    fs.writeFileSync(file, text, 'utf8');
    initApproach(app, null, deps);
    const { runs, summary } = getApproachRuns(key);
    expect(runs.map((r) => r.glide.broken)).toEqual([false, false, false, true]);
    expect(runs.map((r) => r.clean)).toEqual([true, true, true, false]);
    expect(runs[0].marks.find((m) => m.kind === 'glide_end').broken).toBe(false);
    expect(summary.cleanRuns).toBe(3);
    expect(fs.readFileSync(file, 'utf8')).toBe(text); // read, never rewritten
  });

  it('a site with fewer than three glide ends uses the nominal 3 km, so a first run that breaks high is not taken as normal', () => {
    const MID2 = 4400000009; const k2 = `port:${MID2}`;
    fly({ mid: MID2, name: 'First Visit', ...landing(3000, [18, 25]) }); // the only glide on file here ends about 12.7 km up
    const { runs, summary } = getApproachRuns(k2);
    expect(runs[0].glide.endAltM).toBeGreaterThan(GLIDE_END_NOMINAL_M + GLIDE_BROKEN_OVER_M);
    expect(runs[0].glide.broken).toBe(true);
    expect(runs[0].clean).toBe(false);
    expect(summary.glideEnd).toEqual({ usualAltM: GLIDE_END_NOMINAL_M, brokenAboveM: GLIDE_END_NOMINAL_M + GLIDE_BROKEN_OVER_M, fromRuns: 1, nominal: true });
    expect(summarizeTarget(k2).shortest).toBeNull();
  });
});

describe('the entry by the countdown at the line', () => {
  const MID = 4400000002; const name = 'Hot Springs';

  it('a reference run crossing at a long countdown is on track, and never hears a hot or a speed word', () => {
    const figs = fly({ mid: MID, name, anchors: [{ t: 0, dist: 600000, alt: 600000 }, { t: 30, dist: 41000, alt: 24000 }, { t: 43, dist: 8900, alt: 3000 }, { t: 55, dist: 6200, alt: 1400 }, { t: 110, dist: 0, alt: 0 }], glide: [30, 43], journal: [[30, { event: 'SupercruiseExit', BodyType: 'Planet' }], [55, { event: 'DockingRequested' }], [55, { event: 'DockingGranted', LandingPad: 2 }], [68, { event: 'Music', MusicTrack: 'DockingComputer' }], [110, { event: 'Docked' }]] });
    expect(getApproachRuns(`port:${MID}`).runs[0].clean).toBe(true);
    expect(figs.every((e) => !/ENTRY HOT|DECREASE SPEED|CURL ROUTE|DROPPING SHORT/.test(e.word || ''))).toBe(true);
    expect(figs.every((e) => !/hot entry/.test(e.coach || ''))).toBe(true);
  });

  it('hot before the line and at it: ENTRY HOT in the well, ENTRY HOT for three seconds past the line, and the speed words are live though the angle is on track', () => {
    overlays.length = 0;
    // 1.06 Mm out with the countdown already at 0:04; the line (600 km up, where the reference crossed) is passed between the second and third fix
    const figs = fly({ mid: MID, name, open: 'position', lineT: 2, anchors: [{ t: 0, dist: 520000, alt: 800000 }, { t: 4, dist: 120000, alt: 200000 }, { t: 5, dist: 70000, alt: 120000 }, { t: 6, dist: 45000, alt: 60000 }], journal: [leave(6)], until: 6 });
    const well = figs.filter((e) => e.phase === 'Gravity well');
    expect(well.length).toBeGreaterThan(0);
    expect(well.every((e) => Math.round(e.countdownS) <= HOT_CD)).toBe(true);
    expect(well[well.length - 1].word).toBe('ENTRY HOT');             // firm: the line is under five seconds off
    expect(well[well.length - 1].coach).toMatch(/needs \d+° to the glide point/); // the angle is still read, for the page
    const oc = figs.filter((e) => e.phase === 'Orbital cruise');
    const atLine = oc.filter((e) => e.alt > 150000);
    expect(atLine.length).toBeGreaterThanOrEqual(2);
    expect(atLine.every((e) => e.word === 'ENTRY HOT' && e.brief === 'ENTRY HOT')).toBe(true);
    expect(atLine.every((e) => /hot entry/.test(e.coach) && !/sharp entry|too sharp/.test(e.coach))).toBe(true); // on track by the angle
    const low = oc.filter((e) => e.alt < 150000);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((e) => e.word === 'DECREASE SPEED')).toBe(true); // 0:05 or under below 150 km after a hot entry
    expect(overlays.some((m) => /Orbital cruise · ENTRY HOT$/.test(m.text))).toBe(true);
    expect(oc.every((e) => !/°/.test(e.brief) && !/km\/s/.test(e.coach))).toBe(true); // no angles on the HUD, no speeds anywhere
    expect(getLiveApproach().live).toBeNull();
  });

  it('the same line flown slower: 0:05 below 150 km after an entry that was neither hot nor sharp hears no speed word', () => {
    const figs = fly({ mid: MID, name, anchors: [{ t: 0, dist: 320000, alt: 500000 }, { t: 20, dist: 41000, alt: 24000 }], journal: [leave(19)], until: 19 });
    const oc = figs.filter((e) => e.phase === 'Orbital cruise');
    expect(oc.some((e) => e.alt < 150000 && e.countdownS != null && Math.round(e.countdownS) <= 5)).toBe(true);
    expect(oc.every((e) => !/ENTRY HOT|DECREASE SPEED|CURL ROUTE/.test(e.word || ''))).toBe(true);
    expect(oc.every((e) => !/hot entry/.test(e.coach || ''))).toBe(true);
  });

  it('a run opened on the line gets its only read from the crossing: hot from the first fix that has a countdown', () => {
    const figs = fly({ mid: 4400000003, name: 'No Reference Yet', anchors: [{ t: 0, dist: 400000, alt: 600000 }, { t: 6, dist: 41000, alt: 24000 }], journal: [leave(6)], until: 6 });
    const oc = figs.filter((e) => e.phase === 'Orbital cruise');
    expect(oc[0].countdownS).toBeNull();                                // the first fix has nothing to measure a closing rate from
    expect(oc[1].word).toBe('ENTRY HOT');
    expect(oc.filter((e) => e.t <= 3 && e.countdownS != null).every((e) => e.word === 'ENTRY HOT')).toBe(true);
    expect(oc.filter((e) => e.t > 3).every((e) => e.word !== 'ENTRY HOT')).toBe(true); // three seconds, then the descent's own words
    expect(oc.some((e) => e.alt < 150000 && e.word === 'DECREASE SPEED')).toBe(true);
    expect(oc.every((e) => !/CURL/.test(`${e.word} ${e.brief} ${e.coach}`))).toBe(true);
  });
});

describe('dropping short', () => {
  const MID = 4400000004; const name = 'Long Reach';

  it('from the line, under 200 km with the pad under 35° below: DROPPING SHORT until the pad is 38° down, with no reference needed', () => {
    overlays.length = 0;
    // 300 km out at 180 km up is 31° to the pad; shallower than the sight line all the way, the pad is 38° down nine seconds on
    const figs = fly({ mid: MID, name, anchors: [{ t: 0, dist: 300000, alt: 180000 }, { t: 12, dist: 108000, alt: 108000 }], journal: [leave(12)], until: 12 });
    const deg = (e) => Math.atan2(e.alt, e.dist) * 180 / Math.PI;
    expect(figs.length).toBe(12);
    const showing = figs.filter((e) => e.word === 'DROPPING SHORT');
    expect(showing.map((e) => e.t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(deg(showing[0])).toBeLessThan(SHORT_DEG);
    expect(deg(showing[showing.length - 1])).toBeLessThan(SHORT_CLEAR_DEG);   // held past 35° until 38°
    expect(deg(showing[showing.length - 1])).toBeGreaterThan(SHORT_DEG);
    expect(figs.filter((e) => e.t >= 9).every((e) => deg(e) >= SHORT_CLEAR_DEG && e.word !== 'DROPPING SHORT')).toBe(true);
    expect(showing.every((e) => e.brief === 'DROPPING SHORT' && /range \d\.\d× the altitude/.test(e.coach))).toBe(true);
    expect(overlays.some((m) => /Orbital cruise · DROPPING SHORT$/.test(m.text))).toBe(true);
  });

  it('never above 200 km, however far out', () => {
    const figs = fly({ mid: MID, name, anchors: [{ t: 0, dist: 500000, alt: 260000 }, { t: 4, dist: 420000, alt: 220000 }], journal: [leave(5)], until: 4 });
    expect(figs.length).toBeGreaterThan(3);
    expect(figs.every((e) => Math.atan2(e.alt, e.dist) * 180 / Math.PI < SHORT_DEG && e.word !== 'DROPPING SHORT')).toBe(true);
  });

  it('a hop between two ports on one body never crossed a line and never hears it, low and far out as it is', () => {
    const figs = fly({ mid: MID, name, open: 'position', anchors: [{ t: 0, dist: 400000, alt: 60000 }, { t: 8, dist: 320000, alt: 52000 }], journal: [leave(8)], until: 8 });
    expect(figs.length).toBeGreaterThan(4);
    expect(figs.every((e) => e.phase === 'Orbital cruise')).toBe(true);
    expect(figs.every((e) => e.alt <= 200000 && e.alt >= 40000 && Math.atan2(e.alt, e.dist) * 180 / Math.PI < SHORT_DEG)).toBe(true);
    expect(figs.every((e) => e.word !== 'DROPPING SHORT')).toBe(true);
    expect(getLiveApproach().live).toBeNull();
  });
});

describe('the entry as a target: the Mm to cross the line at and the countdown to show there', () => {
  const MID = 4400000005; const key = `port:${MID}`; const name = 'Target Practice';
  const B2 = 'Test Sector AA-A a1 2 b'; // a body of its own, so nothing is borrowed from the other test sites
  // a landing from a line 600 km up: the crossing d0 metres out, the glide begun tG seconds later
  const fromLine = (d0, tG = 30) => ({
    anchors: [{ t: 0, dist: d0, alt: 600000 }, { t: tG, dist: 41000, alt: 24000 }, { t: tG + 13, dist: 8900, alt: 3000 }, { t: tG + 25, dist: 6200, alt: 1400 }, { t: tG + 84, dist: 0, alt: 0 }],
    glide: [tG, tG + 13],
    journal: [[tG, { event: 'SupercruiseExit', BodyType: 'Planet' }], [tG + 25, { event: 'DockingRequested' }], [tG + 25, { event: 'DockingGranted', LandingPad: 2 }], [tG + 38, { event: 'Music', MusicTrack: 'DockingComputer' }], [tG + 84, { event: 'Docked' }]],
  });

  it('no target until three crossings on track and over 0:06 have landed; then the middle of them, to the nearest 0.05 Mm', () => {
    fly({ mid: MID, name, body: B2, ...fromLine(600000) });
    fly({ mid: MID, name, body: B2, ...fromLine(500000) });
    let t = summarizeTarget(key, null, 'panthermkii').entryTarget;
    expect(t).toEqual({ rangeM: null, countdownS: TARGET_CD, from: null, crossings: 2, landed: 2, thrownOut: 0, bodyLanded: 2 });
    fly({ mid: MID, name, body: B2, ...fromLine(650000) });
    const { runs, summary } = getApproachRuns(key, 'panthermkii');
    expect(runs.every((r) => r.clean && r.cruise.entryCountdownS > HOT_CD)).toBe(true);
    const ranges = runs.map((r) => r.cruise.entryHudRangeM).sort((a, b) => a - b);
    t = summary.entryTarget;
    expect(t).toEqual({ rangeM: Math.round(ranges[1] / ENTRY_TARGET_STEP_M) * ENTRY_TARGET_STEP_M, countdownS: 7, from: 'site', crossings: 3, landed: 3, thrownOut: 0, bodyLanded: null });
    expect(t.rangeM % 50000).toBe(0);
    expect(t.rangeM).toBeGreaterThan(ranges[0] - 50000);
    expect(t.rangeM).toBeLessThan(ranges[2] + 50000);
  });

  it('a hot crossing, a sharp one and an early one do not move it, landed or not', () => {
    const before = summarizeTarget(key, null, 'panthermkii').entryTarget;
    fly({ mid: MID, name, body: B2, ...fromLine(600000, 5) });   // the line to the glide in five seconds: the countdown reads 0:04 at the crossing
    fly({ mid: MID, name, body: B2, ...fromLine(300000) });      // 300 km out at the line needs 54° to the glide point: sharp
    fly({ mid: MID, name, body: B2, ...fromLine(760000) });      // 760 km out needs 27°: early
    const { runs, summary } = getApproachRuns(key, 'panthermkii');
    expect(runs).toHaveLength(6);
    expect(runs.every((r) => r.clean)).toBe(true);
    expect(runs[3].cruise.entryCountdownS).toBeLessThanOrEqual(HOT_CD);
    expect(summary.entryTarget).toEqual(before);
  });

  it('before the line the overlay shows the target and nothing else; the verdict on the entry comes at the crossing, for three seconds', () => {
    overlays.length = 0;
    const tg = summarizeTarget(key, null, 'panthermkii').entryTarget;
    const mm = (tg.rangeM / 1e6).toFixed(2);
    // down the well to a crossing 700 km out: far out and low for this site (under 30° to the glide point)
    const figs = fly({ mid: MID, name, body: B2, open: 'position', lineT: 10, anchors: [{ t: 0, dist: 860000, alt: 800000 }, { t: 10, dist: 700000, alt: 600000 }, { t: 40, dist: 41000, alt: 24000 }], journal: [leave(17)], until: 17 });
    const well = figs.filter((e) => e.phase === 'Gravity well');
    expect(well.length).toBeGreaterThan(5);
    expect(well.every((e) => e.brief === `${mm} Mm · 0:07` && e.word === null)).toBe(true);
    expect(well.every((e) => e.coach.startsWith(`cross the line at ${mm} Mm showing 0:07`))).toBe(true);
    expect(well.every((e) => e.target && e.target.rangeM === tg.rangeM && e.target.countdownS === 7)).toBe(true);
    expect(overlays.some((m) => m.text === `🛬 Gravity well · ${mm} Mm · 0:07`)).toBe(true);
    expect(overlays.every((m) => !/Gravity well · (ON TRACK|ENTRY)/.test(m.text))).toBe(true); // no verdict before the line here
    const oc = figs.filter((e) => e.phase === 'Orbital cruise');
    const atLine = oc.filter((e) => e.t - 10 <= 3);
    expect(atLine.length).toBeGreaterThanOrEqual(3);
    expect(atLine.every((e) => e.word === 'ENTRY TOO EARLY' && e.brief === 'ENTRY TOO EARLY')).toBe(true);
    expect(oc.filter((e) => e.t - 10 > 3).length).toBeGreaterThan(0);
    expect(oc.filter((e) => e.t - 10 > 3).every((e) => !/^ENTRY/.test(e.word || ''))).toBe(true);
    expect(getLiveApproach().live).toBeNull();
  });

  it('a site without three such crossings keeps the verdict words before the line', () => {
    // Hot Springs has one crossing on file that counts: no target of its own yet
    const t = summarizeTarget('port:4400000002', null, 'panthermkii').entryTarget;
    expect(t.rangeM).toBeNull();
    const figs = fly({ mid: 4400000002, name: 'Hot Springs', open: 'position', lineT: 10, anchors: [{ t: 0, dist: 760000, alt: 800000 }, { t: 10, dist: 600000, alt: 600000 }, { t: 40, dist: 41000, alt: 24000 }], journal: [leave(12)], until: 12 });
    const well = figs.filter((e) => e.phase === 'Gravity well' && e.word);
    expect(well.length).toBeGreaterThan(3);
    expect(well.every((e) => /^ON TRACK( \(early\))?$/.test(e.word) && e.brief === e.word && e.target === null)).toBe(true);
  });
});

describe('the reference lookup keeps up', () => {
  const MID = 4400000005; const key = `port:${MID}`;

  it('is built once and kept until a run is added; the run being flown shares it', () => {
    const a = summarizeTarget(key, null, 'panthermkii');
    expect(summarizeTarget(key, null, 'panthermkii')).toBe(a);
    expect(summarizeTarget(key, 'a-run-being-flown', 'panthermkii')).toBe(a); // not on file, so leaving it out changes nothing
    fly({ mid: MID, name: 'Target Practice', body: 'Test Sector AA-A a1 2 b', ...landing() });
    const b = summarizeTarget(key, null, 'panthermkii');
    expect(b).not.toBe(a);
    expect(b.runs).toBe(a.runs + 1);
    // a run that IS on file is left out for real
    const one = getApproachRuns(key).runs[0];
    expect(summarizeTarget(key, one.id, 'panthermkii').runs).toBe(b.runs - 1);
  });

  it('the envelope reads each distance the way valueAtDistance does', () => {
    const { runs, summary } = getApproachRuns(key);
    const clean = runs.filter((r) => r.clean);
    expect(clean.length).toBeGreaterThan(3);
    const maxD = Math.max(...clean.flatMap((r) => r.samples.filter((s) => s.dist != null).map((s) => s.dist)));
    const expected = [];
    for (let d = 0; d <= maxD; d += 250) {
      const alts = clean.map((r) => valueAtDistance(r.samples, d, 'alt')).filter((v) => v != null);
      if (alts.length >= 2) expected.push({ dist: d, min: Math.round(Math.min(...alts)), max: Math.round(Math.max(...alts)) });
    }
    expect(summary.envelope.length).toBeGreaterThan(100);
    expect(summary.envelope).toEqual(expected);
  });
});

describe('a site short of three crossings borrows every such crossing on its body', () => {
  const B2 = 'Test Sector AA-A a1 2 b'; const HOME = 'port:4400000005';   // Target Practice: three crossings that count, on B2
  const NEXT = 4400000006; const nk = `port:${NEXT}`;
  const fromLine = (d0, tG = 30) => ({
    anchors: [{ t: 0, dist: d0, alt: 600000 }, { t: tG, dist: 41000, alt: 24000 }, { t: tG + 13, dist: 8900, alt: 3000 }, { t: tG + 25, dist: 6200, alt: 1400 }, { t: tG + 84, dist: 0, alt: 0 }],
    glide: [tG, tG + 13],
    journal: [[tG, { event: 'SupercruiseExit', BodyType: 'Planet' }], [tG + 25, { event: 'DockingRequested' }], [tG + 25, { event: 'DockingGranted', LandingPad: 2 }], [tG + 38, { event: 'Music', MusicTrack: 'DockingComputer' }], [tG + 84, { event: 'Docked' }]],
  });

  it('a site on file with no run of its own shows the body target from its first fix', () => {
    // the first approach only puts the port on file: it is abandoned, so Next Door has no run
    fly({ mid: NEXT, name: 'Next Door', body: B2, anchors: [{ t: 0, dist: 600000, alt: 600000 }, { t: 30, dist: 41000, alt: 24000 }], journal: [leave(3)], until: 3 });
    const home = summarizeTarget(HOME, null, 'panthermkii').entryTarget;
    expect(home.from).toBe('site');
    const s = summarizeTarget(nk, null, 'panthermkii');
    expect(s.recommendation).toBeNull();                       // no clean run here: nothing but the target
    expect(s.entryTarget).toEqual({ rangeM: home.rangeM, countdownS: 7, from: 'body', crossings: 0, landed: 0, thrownOut: 0, bodyLanded: 3 });
    overlays.length = 0;
    const figs = fly({ mid: NEXT, name: 'Next Door', body: B2, open: 'position', lineT: 10, anchors: [{ t: 0, dist: 760000, alt: 800000 }, { t: 10, dist: 600000, alt: 600000 }, { t: 40, dist: 41000, alt: 24000 }], journal: [leave(12)], until: 12 });
    const well = figs.filter((e) => e.phase === 'Gravity well');
    const mm = (home.rangeM / 1e6).toFixed(2);
    expect(well.length).toBeGreaterThan(5);
    expect(well[0].t).toBe(1);                                 // from the first fix the run has figures for
    expect(well.every((e) => e.brief === `${mm} Mm · 0:07` && e.word === null)).toBe(true);
    expect(overlays.some((m) => m.text === `🛬 Gravity well · ${mm} Mm · 0:07`)).toBe(true);
    expect(getLiveApproach().live).toBeNull();
  });

  it('its own crossings join the pool, and at three of its own the site takes over', () => {
    fly({ mid: NEXT, name: 'Next Door', body: B2, ...fromLine(560000) });
    expect(summarizeTarget(nk, null, 'panthermkii').entryTarget).toMatchObject({ from: 'body', crossings: 1, landed: 1, thrownOut: 0, bodyLanded: 4 });
    fly({ mid: NEXT, name: 'Next Door', body: B2, ...fromLine(540000) });
    fly({ mid: NEXT, name: 'Next Door', body: B2, ...fromLine(520000) });
    const { runs, summary } = getApproachRuns(nk, 'panthermkii');
    expect(runs).toHaveLength(3);
    const own = runs.map((r) => r.cruise.entryHudRangeM).sort((a, b) => a - b);
    expect(summary.entryTarget).toEqual({ rangeM: Math.round(own[1] / ENTRY_TARGET_STEP_M) * ENTRY_TARGET_STEP_M, countdownS: 7, from: 'site', crossings: 3, landed: 3, thrownOut: 0, bodyLanded: null });
  });

  it('a body lends only to its own sites', () => {
    fly({ mid: 4400000007, name: 'Far Side', body: 'Test Sector AA-A a1 3 c', anchors: [{ t: 0, dist: 600000, alt: 600000 }, { t: 30, dist: 41000, alt: 24000 }], journal: [leave(3)], until: 3 });
    expect(summarizeTarget('port:4400000007', null, 'panthermkii').entryTarget).toEqual({ rangeM: null, countdownS: 7, from: null, crossings: 0, landed: 0, thrownOut: 0, bodyLanded: 0 });
  });
});

describe('how the crossing went, said at the pad and kept on the run', () => {
  const B2 = 'Test Sector AA-A a1 2 b'; const MID = 4400000005; const key = `port:${MID}`; const name = 'Target Practice';
  const fromLine = (d0, tG = 30) => ({
    anchors: [{ t: 0, dist: d0, alt: 600000 }, { t: tG, dist: 41000, alt: 24000 }, { t: tG + 13, dist: 8900, alt: 3000 }, { t: tG + 25, dist: 6200, alt: 1400 }, { t: tG + 84, dist: 0, alt: 0 }],
    glide: [tG, tG + 13],
    journal: [[tG, { event: 'SupercruiseExit', BodyType: 'Planet' }], [tG + 25, { event: 'DockingRequested' }], [tG + 25, { event: 'DockingGranted', LandingPad: 2 }], [tG + 38, { event: 'Music', MusicTrack: 'DockingComputer' }], [tG + 84, { event: 'Docked' }]],
  });
  const mm = (m) => (m / 1e6).toFixed(2);
  const cd = (s) => `0:${String(s).padStart(2, '0')}`;

  it('an on-track crossing: the pad line gives it against the target as it stood, in green, under the four sector lines', () => {
    overlays.length = 0;
    const tg = summarizeTarget(key, null, 'panthermkii').entryTarget;
    fly({ mid: MID, name, body: B2, ...fromLine(600000) });
    const r = getApproachRuns(key).runs.slice(-1)[0];
    expect(r.entry).toEqual({ verdict: 'ON TRACK', targetRangeM: tg.rangeM, targetCountdownS: 7, targetFrom: 'site' });
    const line = overlays.find((m) => m.id === 'edcolony_approach_entry');
    expect(line.text).toBe(`Crossed ${mm(r.cruise.entryHudRangeM)} Mm · ${cd(r.cruise.entryCountdownS)} · target ${mm(tg.rangeM)} Mm · 0:07`);
    expect(line.color).toBe(SECTOR_COLOURS.green);
    expect(line.y).toBe(402);
    expect(overlays.filter((m) => /^edcolony_approach_s[1-4]$/.test(m.id)).map((m) => m.y)).toEqual([322, 342, 362, 382]);
  });

  it('a hot crossing says so, in yellow, and the file keeps it on the run', () => {
    overlays.length = 0;
    fly({ mid: MID, name, body: B2, ...fromLine(600000, 5) });
    const r = getApproachRuns(key).runs.slice(-1)[0];
    expect(r.cruise.entryCountdownS).toBeLessThanOrEqual(HOT_CD);
    expect(r.entry.verdict).toBe('ENTRY HOT');
    const line = overlays.find((m) => m.id === 'edcolony_approach_entry');
    expect(line.text).toMatch(/^Crossed \d\.\d\d Mm · 0:0[1-6] · target \d\.\d\d Mm · 0:07 · ENTRY HOT$/);
    expect(line.color).toBe(SECTOR_COLOURS.yellow);
    const stored = fs.readFileSync(path.join(app, 'approach-runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.k === 'run' && l.target && l.target.key === key);
    expect(stored[stored.length - 1].entry).toEqual(r.entry);
  });

  it('a red-zone entry is said once, as ENTRY TOO SHARP at the line, and nothing advises a curl', () => {
    const figs = fly({ mid: MID, name, body: B2, anchors: [{ t: 0, dist: 200000, alt: 600000 }, { t: 30, dist: 41000, alt: 24000 }], journal: [leave(8)], until: 8 });
    expect(figs.length).toBe(8);
    expect(figs.filter((e) => e.t <= 3).every((e) => e.word === 'ENTRY TOO SHARP' && e.brief === 'ENTRY TOO SHARP')).toBe(true);
    expect(figs.filter((e) => e.t > 3).every((e) => e.word === 'ON TRACK')).toBe(true);
    expect(figs.every((e) => !/CURL/.test(`${e.word} ${e.brief} ${e.coach}`))).toBe(true);
  });
});

describe('a place on a known body that is not on file: the body target before the line', () => {
  const B2 = 'Test Sector AA-A a1 2 b';
  const fix = (t, alt, destination, body = B2) => { _setClock(() => BASE + t * 1000); statusNow = { at: iso(t), flags: (1 << 4) | (1 << 21), flags2: 0, lat: PAD.lat + 5, lon: PAD.lon, alt, hdg: 180, radius: R, body, destination }; idleTick(); };
  const outOfTheWell = (t) => { _setClock(() => BASE + t * 1000); statusNow = { at: iso(t), flags: 1 << 4, flags2: 0, lat: null, lon: null, alt: null, hdg: null, radius: null, body: null, destination: null }; idleTick(); };
  const stretch = () => { const t0 = clockBase; clockBase += 5000; overlays.length = 0; outOfTheWell(t0); return t0 + 1; };
  const NEW = { System: 1, Body: 7, Name: 'Brand New Works' };

  it('coming down above the line toward it shows the body target from the second fix, and opens no run', () => {
    const e = bodyEntryTarget(B2, 'panthermkii');
    expect(e.rangeM % 50000).toBe(0);
    expect(e.bodyLanded).toBeGreaterThanOrEqual(3);
    expect(e.lineAltM).toBe(600000);
    const t = stretch();
    fix(t, 900000, NEW);
    expect(overlays).toHaveLength(0);                          // one fix is not a descent
    fix(t + 1, 880000, NEW);
    fix(t + 2, 860000, NEW);
    expect(overlays.map((m) => m.text)).toEqual(Array(2).fill(`🛬 Gravity well · ${(e.rangeM / 1e6).toFixed(2)} Mm · 0:07`));
    expect(overlays.every((m) => m.id === 'edcolony_approach' && m.quiet === true)).toBe(true);
    expect(getLiveApproach().live).toBeNull();
  });

  it('not while climbing, not under the line, not for the body itself, another body, or a body with no target', () => {
    let t = stretch();
    fix(t, 860000, NEW); fix(t + 1, 880000, NEW); fix(t + 2, 900000, NEW);                       // climbing away
    expect(overlays).toHaveLength(0);
    t = stretch();
    fix(t, 500000, NEW); fix(t + 1, 480000, NEW); fix(t + 2, 460000, NEW);                       // under the line: a hop between sites
    expect(overlays).toHaveLength(0);
    t = stretch();
    const itself = { System: 1, Body: 7, Name: B2 };
    fix(t, 900000, itself); fix(t + 1, 880000, itself);                                           // the destination is the body, not a place on it
    expect(overlays).toHaveLength(0);
    t = stretch();
    const elsewhere = { System: 1, Body: 9, Name: 'Orbital Something' };
    fix(t, 900000, elsewhere); fix(t + 1, 880000, elsewhere);                                     // not on this body
    expect(overlays).toHaveLength(0);
    t = stretch();
    fix(t, 900000, NEW, 'Test Sector AA-A a1 3 c'); fix(t + 1, 880000, NEW, 'Test Sector AA-A a1 3 c'); // Far Side is on file there, with no crossing that counts
    expect(overlays).toHaveLength(0);
    expect(bodyEntryTarget('Test Sector AA-A a1 3 c', 'panthermkii')).toBeNull();
    expect(getLiveApproach().live).toBeNull();
  });
});

describe('a journal replay is not a recording', () => {
  const B2 = 'Test Sector AA-A a1 2 b'; const MID = 4400000005; const key = `port:${MID}`;
  const file = () => path.join(app, 'approach-runs.jsonl');
  const journalOnly = (t0) => [
    { timestamp: iso(t0), event: 'ApproachBody', Body: B2, BodyID: 7, StarSystem: 'Test Sector AA-A a1', SystemAddress: 1 },
    { timestamp: iso(t0 + 33), event: 'ApproachSettlement', Name: 'Target Practice', MarketID: MID, BodyID: 7, BodyName: B2, Latitude: PAD.lat, Longitude: PAD.lon },
    { timestamp: iso(t0 + 35), event: 'SupercruiseExit', BodyType: 'Planet' },
    { timestamp: iso(t0 + 50), event: 'DockingGranted', LandingPad: 2 },
    { timestamp: iso(t0 + 126), event: 'Docked' },
  ];

  it('events replayed at start-up never open or close a run, and the overlay stays wired to the real sender', () => {
    const t0 = clockBase; clockBase += 5000;
    const before = getApproachRuns(key).runs.length; const size = fs.statSync(file()).size;
    _setClock(() => BASE + (t0 + 200) * 1000);
    ingestApproachEvents({ catchUp: true, allEvents: journalOnly(t0) }, {}, { sendOverlay: () => { throw new Error('the replay sender was taken'); }, broadcastEvent: () => { throw new Error('the replay sender was taken'); } });
    expect(getLiveApproach().live).toBeNull();
    expect(getApproachRuns(key).runs.length).toBe(before);
    expect(fs.statSync(file()).size).toBe(size);
    overlays.length = 0;
    fly({ mid: MID, name: 'Target Practice', body: B2, anchors: [{ t: 0, dist: 600000, alt: 600000 }, { t: 30, dist: 41000, alt: 24000 }], journal: [leave(4)], until: 4 });
    expect(overlays.length).toBeGreaterThan(0);                 // a live flight after it still reaches the overlay
  });

  it('a run that closes without a single fix is dropped, not written', () => {
    const t0 = clockBase; clockBase += 5000;
    const before = getApproachRuns(key).runs.length; const size = fs.statSync(file()).size;
    statusNow = null;                                           // Status.json unreadable for the whole approach
    for (const ev of journalOnly(t0)) { _setClock(() => Date.parse(ev.timestamp)); noteApproachEvent(ev, { ship: { type: 'panthermkii', ident: 'CH-1', shipId: 1 } }); }
    expect(getLiveApproach().live).toBeNull();
    expect(getApproachRuns(key).runs.length).toBe(before);
    expect(fs.statSync(file()).size).toBe(size);
  });

  it('a run already in the file with no samples is left out on load, and stays in the file', () => {
    const { runs } = getApproachRuns(key);
    const ghost = { k: 'run', id: 'ghost-no-samples', startedAt: iso(1), endedAt: iso(127), endKind: 'docked', body: B2, bodyId: 7, target: runs[0].target, ship: runs[0].ship, totalS: 126, clean: false, oc: { startDistM: null, startAltM: null, durationS: null }, glide: null, docking: null, marks: [{ kind: 'approach_body', t: 0, at: iso(1) }, { kind: 'docked', t: 126, at: iso(127) }], samples: [] };
    fs.appendFileSync(file(), JSON.stringify(ghost) + '\n', 'utf8');
    const text = fs.readFileSync(file(), 'utf8');
    const loaded = initApproach(app, null, deps);
    const after = getApproachRuns(key).runs;
    expect(after.map((r) => r.id)).toEqual(runs.map((r) => r.id));
    expect(after.some((r) => r.id === 'ghost-no-samples')).toBe(false);
    expect(loaded.runs).toBeGreaterThan(0);
    expect(fs.readFileSync(file(), 'utf8')).toBe(text);         // the file keeps it
  });
});
