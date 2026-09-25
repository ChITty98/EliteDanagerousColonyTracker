/**
 * The approach recorder: a descent from ApproachBody to Docked, sampled once a second from a
 * scripted Status.json, with the journal's own marks — the port from ApproachSettlement, the
 * glide from Flags2 bit 12, the hand-off from Music "DockingComputer" — and the reference a
 * target keeps (shortest clean run, envelope, recommendations). Temp dir throughout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initApproach, noteApproachEvent, sampleOnce, _setStatusReader, _setClock,
  getApproachTargets, getApproachRuns, getLiveApproach, summarizeTarget, phaseAt, NOMINAL_CORRIDOR, gateTimeOf, GATE_M, idleTick,
} from '../server/journal/approach.js';

const R = 1_000_000;                          // body radius, m
const PAD = { lat: -49.4987, lon: 89.0623 };  // Kewell Range
const MID = 4389829123;
const BASE = Date.parse('2026-09-15T02:14:54Z');
const iso = (t) => new Date(BASE + t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
// The ship comes straight down the meridian from the north: distance north of the pad → latitude.
const latAt = (distM) => PAD.lat + (distM / R) * 180 / Math.PI;
const lerp = (a, b, u) => a + (b - a) * u;

/** A descent profile: piecewise linear in (dist, alt) between anchors, glide flag between two times. */
function profile({ scale = 1, glideEndAlt = 2100, glideClearT = null, anchors } = {}) {
  const A = anchors || [
    { t: 0, dist: 118000, alt: 58000 }, { t: 18, dist: 41000, alt: 24000 }, { t: 31, dist: 8900, alt: glideEndAlt },
    { t: 43, dist: 6200, alt: 1400 }, { t: 102, dist: 0, alt: 0 },
  ].map((a) => ({ ...a, t: Math.round(a.t * scale) }));
  const glideStart = A[1].t, glideEnd = glideClearT ?? A[2].t;
  return {
    end: A[A.length - 1].t, glideStart, glideEnd,
    at(t) {
      let i = 0; while (i < A.length - 2 && t > A[i + 1].t) i++;
      const a = A[i], b = A[i + 1], u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
      const dist = lerp(a.dist, b.dist, u), alt = lerp(a.alt, b.alt, u);
      const glide = t >= glideStart && t < glideEnd;
      return { timestamp: iso(t), Flags: glide || t >= glideStart ? 0 : (1 << 4), Flags2: glide ? (1 << 12) : 0, Latitude: latAt(dist), Longitude: PAD.lon, Altitude: alt, Heading: 180, PlanetRadius: R, BodyName: 'Col 173 Sector AX-J d9-52 1 c', Destination: { System: 1797401856371, Body: 16, Name: 'Planetary Construction Site: Kewell Range' } };
    },
  };
}

let app; const events = []; const overlays = [];
const deps = { broadcastEvent: (e) => events.push(e), sendOverlay: (m) => overlays.push(m), readState: () => ({ knownStations: {} }), applyStatePatch: () => {} };
let statusNow = null;
beforeAll(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-ap-'));
  initApproach(app, null, deps);
  _setStatusReader(() => statusNow);
});
afterAll(() => { try { fs.rmSync(app, { recursive: true, force: true }); } catch { /* temp */ } });

/** Drive one run: journal events at their second, a Status sample every second. */
function drive(p, journal, { ctx = {}, settlement = true } = {}) {
  const fullCtx = { ship: { type: 'panthermkii', name: '', ident: 'CH-1', shipId: 1 }, ...ctx };
  const ev = (t, e) => noteApproachEvent({ timestamp: iso(t), ...e }, fullCtx);
  for (let t = 0; t <= p.end; t++) {
    _setClock(() => BASE + t * 1000);
    statusNow = null; // events first, then the sample for this second
    if (t === 0) ev(0, { event: 'ApproachBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16, StarSystem: 'Col 173 Sector AX-J d9-52', SystemAddress: 1797401856371 });
    if (t === 16 && settlement) ev(16, { event: 'ApproachSettlement', Name: 'Planetary Construction Site: Kewell Range', MarketID: MID, BodyID: 16, BodyName: 'Col 173 Sector AX-J d9-52 1 c', Latitude: PAD.lat, Longitude: PAD.lon });
    for (const [jt, e] of journal) if (jt === t) ev(t, e);
    const s = normalize(p.at(t)); statusNow = s;
    sampleOnce();
  }
}
const normalize = (raw) => ({ at: raw.timestamp, flags: raw.Flags, flags2: raw.Flags2, lat: raw.Latitude, lon: raw.Longitude, alt: raw.Altitude, hdg: raw.Heading, radius: raw.PlanetRadius, body: raw.BodyName, destination: raw.Destination });

const kewellJournal = (scale = 1) => [
  [Math.round(18 * scale), { event: 'SupercruiseExit', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16, BodyType: 'Planet' }],
  [Math.round(43 * scale), { event: 'DockingRequested', MarketID: MID, StationName: 'Planetary Construction Site: Kewell Range' }],
  [Math.round(43 * scale), { event: 'DockingGranted', MarketID: MID, LandingPad: 2 }],
  [Math.round(56 * scale), { event: 'Music', MusicTrack: 'DockingComputer' }],
  [Math.round(102 * scale), { event: 'Docked', StationName: 'Planetary Construction Site: Kewell Range', MarketID: MID }],
  [Math.round(102 * scale), { event: 'Music', MusicTrack: 'Exploration' }],
];

describe('approach recorder', () => {
  it('records a full descent: port from ApproachSettlement, glide from the flag, hand-off from the music, Docked closes it', () => {
    drive(profile(), kewellJournal());
    expect(getLiveApproach().live).toBeNull();
    const { runs, summary, target } = getApproachRuns(`port:${MID}`);
    expect(target).toMatchObject({ kind: 'port', marketId: MID, lat: PAD.lat, lon: PAD.lon });
    expect(runs).toHaveLength(1);
    const r = runs[0];
    expect(r.endKind).toBe('docked');
    expect(r.ship).toMatchObject({ type: 'panthermkii' });
    expect(r.totalS).toBe(102);
    // the clock starts at the 100 km gate: 118 → 41 km over 18 s crosses it 4 s in
    expect(r.gateT).toBe(4);
    expect(r.runS).toBe(98);
    expect(r.runupS).toBe(4);
    expect(gateTimeOf(r.samples, GATE_M)).toBe(4);
    expect(r.clean).toBe(true);
    expect(r.samples.length).toBeGreaterThan(90);
    // the glide bracket, with the distances from the pad's own coordinates
    expect(r.glide.startT).toBe(18);
    expect(Math.abs(r.glide.startDistM - 41000)).toBeLessThan(700);
    expect(r.glide.startAltM).toBe(24000);
    expect(r.glide.endT).toBe(31);
    expect(r.glide.broken).toBe(false);
    expect(r.glide.slopeDeg).toBeGreaterThanOrEqual(33);
    expect(r.glide.slopeDeg).toBeLessThanOrEqual(35);
    expect(r.glide.secondsToTargetAtStart).toBeGreaterThan(0);
    // docking: cleared at 43, computer at 56, pad at 102 — and the Music line at the pad is not a retake
    expect(r.docking).toMatchObject({ requestedT: 43, grantedT: 43, pad: 2, handoffT: 56, computerS: 46, clearanceToPadS: 59, retakes: 0 });
    expect(r.oc.durationS).toBe(18);
    // sectors: the line at 0 to the glide at 18, the glide to 31, the glide's end to the hand-off at 56, the computer to the pad at 102
    expect(r.sectors).toEqual({ s1: 18, s2: 13, s3: 25, s4: 46 });
    expect(summary.sectorBest).toEqual({ s1: 18, s2: 13, s3: 25, s4: 46 });
    // phases along the run
    expect(phaseAt(r, 5)).toBe('Orbital cruise');
    expect(phaseAt(r, 20)).toBe('Glide');
    expect(phaseAt(r, 35)).toBe('Normal flight');
    expect(phaseAt(r, 60)).toBe('Docking');
    // the reference a single run makes
    expect(summary.cleanRuns).toBe(1);
    expect(summary.shortest.totalS).toBe(102);
    expect(summary.shortest.runS).toBe(98);
    expect(summary.corridor).toEqual(NOMINAL_CORRIDOR);
    expect(summary.recommendation.glideStart.distM).toBeGreaterThan(40000);
    expect(summary.recommendation.handoff.computerS).toBe(46);
    // the cruise: entered 118 km out, crossed the gate 4 s later, then closed to the glide at 41 km by +18 s
    expect(r.cruise.entryDistM).toBeGreaterThan(117000);
    expect(r.cruise.entryHudRangeM).toBeGreaterThan(100000);   // the crossing as the HUD showed it: range through space
    expect(r.cruise.entryCountdownS).toBeGreaterThan(0);
    expect(r.oc.durationS).toBe(18);
    expect(summary.recommendation.cruise.entryDistM).toBeGreaterThan(117000);
    expect(summary.recommendation.cruise.entryHudRangeM).toBe(r.cruise.entryHudRangeM);
    expect(summary.recommendation.cruise.entryCountdownS).toBe(r.cruise.entryCountdownS);
    expect(summary.recommendation.cruise.fromRuns).toBe(1);
    // live figures went out every second, with the coach line for the phase
    const samples = events.filter((e) => e.type === 'approach_sample');
    expect(samples.length).toBeGreaterThan(90);
    expect(samples.find((e) => e.t === 20).phase).toBe('Glide');
    expect(samples.find((e) => e.t === 50).coach).toMatch(/hand off/);
    expect(events.filter((e) => e.type === 'approach_complete')).toHaveLength(1);
    expect(overlays.some((m) => /new shortest|1:42/.test(m.text))).toBe(true);
  });

  it('a shorter clean run becomes the shortest, and two clean runs make an envelope and a live comparison', () => {
    events.length = 0;
    drive(profile({ scale: 0.9 }), kewellJournal(0.9));
    const done = events.find((e) => e.type === 'approach_complete');
    expect(done.newShortest).toBe(true);
    const s = summarizeTarget(`port:${MID}`);
    expect(s.cleanRuns).toBe(2);
    expect(s.shortest.totalS).toBe(92);
    expect(s.shortest.runS).toBe(88);
    expect(s.envelope.length).toBeGreaterThan(10);
    // the second run was measured against the first while it flew: ahead at the same distance
    const mid = events.filter((e) => e.type === 'approach_sample').find((e) => e.t === 30);
    expect(mid.vsShortestS).toBeGreaterThan(0);
    // with the pad on file from the first second, the run-up is coached before the gate and the cruise speed after it
    const early = events.filter((e) => e.type === 'approach_sample').find((e) => e.t === 2);
    expect(early.coach).toMatch(/run-up/);
    expect(early.coach).toMatch(/countdown 0:\d\d/);
    // a run flown at a sane countdown never hears SLOW or LEVEL, and in orbital cruise the HUD carries the ladder pitch to the glide point
    const samples = events.filter((e) => e.type === 'approach_sample');
    expect(samples.some((e) => e.phase === 'Orbital cruise' && e.brief === 'ON TRACK')).toBe(true);
    expect(samples.every((e) => !/DECREASE SPEED|CURL ROUTE|INCREASE SPEED|TOO SHARP|TOO EARLY/.test(e.brief || ''))).toBe(true);
  });

  it('a glide that clears the flag while high is broken and stays out of the reference', () => {
    drive(profile({ glideClearT: 25 }), kewellJournal());
    const { runs, summary } = getApproachRuns(`port:${MID}`);
    const r = runs[runs.length - 1];
    expect(r.glide.endT).toBe(25);
    expect(r.glide.broken).toBe(true);
    expect(r.clean).toBe(false);
    expect(summary.cleanRuns).toBe(2);
    expect(summary.runs).toBe(3);
  });

  it('a retake is bracketed by the music: computer, another track, computer again', () => {
    const journal = kewellJournal().filter(([, e]) => e.event !== 'Music' || e.MusicTrack !== 'DockingComputer');
    journal.push([50, { event: 'Music', MusicTrack: 'DockingComputer' }], [60, { event: 'Music', MusicTrack: 'Exploration' }], [70, { event: 'Music', MusicTrack: 'DockingComputer' }]);
    drive(profile(), journal);
    const { runs } = getApproachRuns(`port:${MID}`);
    const r = runs[runs.length - 1];
    expect(r.docking.handoffT).toBe(50);
    expect(r.docking.retakes).toBe(1);
    expect(r.marks.filter((m) => m.kind === 'retake')).toHaveLength(1);
    expect(r.marks.filter((m) => m.kind === 'handoff')).toHaveLength(2);
  });

  it('a second visit knows the pad from Status.json Destination before any settlement event', () => {
    drive(profile(), kewellJournal(), { settlement: false });
    const { runs } = getApproachRuns(`port:${MID}`);
    const r = runs[runs.length - 1];
    expect(r.target.key).toBe(`port:${MID}`);
    expect(r.samples[0].dist).not.toBeNull();
  });

  it('leaving the body abandons the run without a record', () => {
    const before = getApproachRuns(`port:${MID}`).runs.length;
    noteApproachEvent({ timestamp: iso(0), event: 'ApproachBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
    expect(getLiveApproach().live).not.toBeNull();
    noteApproachEvent({ timestamp: iso(20), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
    expect(getLiveApproach().live).toBeNull();
    expect(getApproachRuns(`port:${MID}`).runs.length).toBe(before);
  });

  it('a surface-mining nav lock is the target for a drop that ends on Touchdown', () => {
    const site = { lat: latAt(0), lon: PAD.lon, label: 'Signal 11', kind: 'site', body: 'Col 173 Sector AX-J d9-52 1 c', setAt: iso(-600) };
    const journal = [[18, { event: 'SupercruiseExit', BodyType: 'Planet' }], [80, { event: 'Touchdown', Latitude: site.lat, Longitude: site.lon, OnPlanet: true }]];
    const p = profile({ anchors: [{ t: 0, dist: 118000, alt: 58000 }, { t: 18, dist: 41000, alt: 24000 }, { t: 31, dist: 8900, alt: 2100 }, { t: 80, dist: 0, alt: 0 }] });
    drive(p, journal, { ctx: { navTarget: site }, settlement: false });
    const key = `site:${site.body}:Signal 11`;
    const { runs, target } = getApproachRuns(key);
    expect(target).toMatchObject({ kind: 'site', name: 'Signal 11' });
    expect(runs).toHaveLength(1);
    expect(runs[0].endKind).toBe('touchdown');
    expect(runs[0].clean).toBe(true);
    expect(runs[0].docking).toBeNull();
  });

  it('opens at the first position fix in the gravity well when the destination is a port on file, and ApproachBody just marks the run', () => {
    const before = getApproachRuns(`port:${MID}`).runs.length;
    // in supercruise, 1.7 Mm out with a fix, Destination = Kewell Range: the idle watch opens a run
    _setClock(() => BASE);
    statusNow = { at: iso(0), flags: (1 << 4) | (1 << 21), flags2: 0, lat: latAt(1_700_000), lon: PAD.lon, alt: 1_250_000, hdg: 180, radius: R, body: 'Col 173 Sector AX-J d9-52 1 c', destination: { System: 1797401856371, Body: 16, Name: 'Planetary Construction Site: Kewell Range' } };
    statusNow = { ...statusNow, lat: latAt(1_740_000), alt: 1_270_000 };
    idleTick();
    expect(getLiveApproach().live).toBeNull(); // one fix is not a heading
    for (const [t, d, a] of [[1, 1_720_000, 1_260_000], [2, 1_700_000, 1_250_000]]) { _setClock(() => BASE + t * 1000); statusNow = { ...statusNow, at: iso(t), lat: latAt(d), alt: a }; idleTick(); }
    const live = getLiveApproach().live;
    expect(live).not.toBeNull();
    expect(live.target.key).toBe(`port:${MID}`);
    expect(live.marks[0].kind).toBe('position_fix');
    expect(live.samples.length).toBe(2);                                   // the two fixes the watch collected are the run's first samples
    expect(Math.abs(live.samples[0].dist - 1_740_000)).toBeLessThan(5000);
    expect(Math.abs(live.samples[1].dist - 1_720_000)).toBeLessThan(5000);
    expect(live.marks[0].t).toBe(0); // the clock of a run opened on fixes starts at the first fix
    // a few seconds later orbital cruise begins: same run, new mark
    events.length = 0;
    for (let t = 3; t <= 14; t++) { _setClock(() => BASE + t * 1000); statusNow = { ...statusNow, at: iso(t), lat: latAt(1_700_000 - (t - 2) * 60_000), alt: 1_250_000 - (t - 2) * 50_000 }; if (t === 8) noteApproachEvent({ timestamp: iso(8), event: 'ApproachBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 }); sampleOnce(); }
    const l2 = getLiveApproach().live;
    expect(l2.runId).toBe(live.runId);
    expect(l2.marks.map((m) => m.kind)).toContain('approach_body');
    expect(phaseAt({ marks: l2.marks }, 4)).toBe('Gravity well');
    expect(phaseAt({ marks: l2.marks }, 9)).toBe('Orbital cruise');
    // before the line the entry is read from the first fix that can be projected — an early read, marked so, until the
    // projection firms inside five seconds; the early word never stands for the descent
    const well = events.filter((e) => e.type === 'approach_sample' && e.phase === 'Gravity well' && e.word);
    expect(well.length).toBeGreaterThan(0);
    expect(well.every((e) => /^(ON TRACK|ENTRY SHARP|ENTRY TOO SHARP|ENTRY TOO EARLY)( \(early\))?$/.test(e.word))).toBe(true);
    expect(well.some((e) => /\(early\)$/.test(e.word))).toBe(true);
    // the run is coached against the line: high/low and the angle
    const last = events.filter((e) => e.type === 'approach_sample').pop();
    expect(last.phase).toBe('Orbital cruise');
    expect(typeof last.coach).toBe('string');
    // once orbital cruise has begun, only the journal closes or abandons the run
    noteApproachEvent({ timestamp: iso(15), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
    expect(getLiveApproach().live).toBeNull();
    expect(getApproachRuns(`port:${MID}`).runs.length).toBe(before);
    // a fly-by: a fix opens a run, then the fix is gone for ten samples before orbital cruise — dropped, nothing written
    _setClock(() => BASE + 100_000);
    statusNow = { at: iso(100), flags: (1 << 4) | (1 << 21), flags2: 0, lat: latAt(1_500_000), lon: PAD.lon, alt: 1_100_000, hdg: 180, radius: R, body: 'Col 173 Sector AX-J d9-52 1 c', destination: { System: 1797401856371, Body: 16, Name: 'Planetary Construction Site: Kewell Range' } };
    for (const [t, d] of [[100, 1_500_000], [101, 1_480_000], [102, 1_460_000]]) { _setClock(() => BASE + t * 1000); statusNow = { ...statusNow, at: iso(t), lat: latAt(d) }; idleTick(); }
    expect(getLiveApproach().live).not.toBeNull();
    for (let t = 103; t <= 114; t++) { _setClock(() => BASE + t * 1000); statusNow = { at: iso(t), flags: 1 << 4, flags2: 0, lat: null, lon: null, alt: null, hdg: null, radius: null, body: null, destination: null }; sampleOnce(); }
    expect(getLiveApproach().live).toBeNull();
    expect(getApproachRuns(`port:${MID}`).runs.length).toBe(before);
  });

  it('a departing ship never opens a run, and a stale nav lock is not a target', () => {
    if (getLiveApproach().live) noteApproachEvent({ timestamp: iso(199), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
    // climbing away from the pad in supercruise: fixes get farther and higher
    for (const [t, d, a] of [[200, 200_000, 60_000], [201, 240_000, 80_000], [202, 290_000, 100_000], [203, 340_000, 120_000]]) {
      _setClock(() => BASE + t * 1000);
      statusNow = { at: iso(t), flags: (1 << 4) | (1 << 21), flags2: 0, lat: latAt(d), lon: PAD.lon, alt: a, hdg: 0, radius: R, body: 'Col 173 Sector AX-J d9-52 1 c', destination: { System: 1797401856371, Body: 16, Name: 'Planetary Construction Site: Kewell Range' } };
      idleTick();
    }
    expect(getLiveApproach().live).toBeNull();
    // a six-day-old lock names nothing
    const stale = { lat: latAt(0), lon: PAD.lon, label: 'Old deposit', kind: 'deposit', body: 'Col 173 Sector AX-J d9-52 1 c', setAt: iso(-6 * 86400) };
    noteApproachEvent({ timestamp: iso(300), event: 'ApproachBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 }, { navTarget: stale });
    expect(getLiveApproach().live.target).toBeNull();
    noteApproachEvent({ timestamp: iso(301), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
  });

  it('coming in too fast: no glide within five seconds of leaving supercruise closes the run as dropped, out of every reference', () => {
    const before = summarizeTarget(`port:${MID}`);
    const p = profile({ glideClearT: 18 }); // the flag never sets: glideStart === glideEnd
    drive(p, [[18, { event: 'SupercruiseExit', BodyType: 'Planet' }]]);
    const { runs } = getApproachRuns(`port:${MID}`);
    const r = runs[runs.length - 1];
    expect(r.endKind).toBe('dropped');
    expect(r.clean).toBe(false);
    expect(r.totalS).toBeLessThan(30);
    expect(getLiveApproach().live).toBeNull();
    expect(summarizeTarget(`port:${MID}`).shortest.id).toBe(before.shortest.id);
    expect(overlays.some((m) => /Dropped out of supercruise/.test(m.text))).toBe(true);
  });

  it('the reference is per ship: a Type-8 run is measured against Type-8 runs, and against another hull only until one exists', () => {
    const panther = summarizeTarget(`port:${MID}`, null, 'panthermkii');
    expect(panther.sameShip).toBe(true);
    const t8Before = summarizeTarget(`port:${MID}`, null, 'type8');
    expect(t8Before.sameShip).toBe(false);           // no Type-8 run yet: the Panther's shortest stands in
    expect(t8Before.shortest.ship.type).toBe('panthermkii');
    events.length = 0;
    drive(profile({ scale: 1.1 }), kewellJournal(1.1), { ctx: { ship: { type: 'type8', name: '', ident: 'CH-29T', shipId: 28 } } });
    const done = events.find((e) => e.type === 'approach_complete');
    expect(done.newShortest).toBe(true);                 // first clean run in this hull is its shortest, slower than the Panther or not
    const t8 = summarizeTarget(`port:${MID}`, null, 'type8');
    expect(t8.sameShip).toBe(true);
    expect(t8.shortest.ship.type).toBe('type8');
    expect(t8.recommendation.handoff.ship.type).toBe('type8');
    expect(t8.recommendation.cruise.fromRuns).toBeGreaterThan(1); // cruise stays pooled across hulls
    expect(getApproachRuns(`port:${MID}`).ships.map((x) => x.type).sort()).toEqual(['panthermkii', 'type8']);
  });

  it("the recommendation is the shortest run's own crossing in the HUD's terms, and the crossing is on its mark", () => {
    const s = summarizeTarget(`port:${MID}`);
    const c = s.recommendation.cruise;
    const shortest = getApproachRuns(`port:${MID}`).runs.find((r) => r.id === s.shortest.id);
    expect(c.entryHudRangeM).toBe(shortest.cruise.entryHudRangeM);      // the run's own figure, never a blend
    expect(c.entryCountdownS).toBe(shortest.cruise.entryCountdownS);
    expect(c.entryHudRangeM).toBeGreaterThan(shortest.cruise.entryDistM); // through space is longer than over the ground
    const ab = shortest.marks.find((m) => m.kind === 'approach_body');
    expect(ab.rangeM).toBeGreaterThan(100000);
  });

  it('a sharp entry is coached: the geometry curl above 200 km, then the countdown curl below 150 km; an on-track entry never hears a speed word', () => {
    events.length = 0;
    // a sharp, fast entry: 150 km out at 400 km up, closed to the glide point in three seconds — the pitch needed is about 70°, the countdown 0:02 — abandoned before the glide
    drive(profile({ anchors: [{ t: 0, dist: 150000, alt: 400000 }, { t: 3, dist: 41000, alt: 24000 }, { t: 6, dist: 8900, alt: 2100 }, { t: 20, dist: 0, alt: 0 }] }), [[3, { event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 }]]);
    const oc = events.filter((e) => e.type === 'approach_sample' && e.phase === 'Orbital cruise' && e.countdownS != null);
    expect(oc.length).toBe(2);
    expect(oc[0].countdownS).toBeLessThan(5.5);
    expect(oc[0].word).toBe('CURL ROUTE ADVISED');            // above 200 km: the geometry, 70° to the glide point
    expect(oc[0].coach).toMatch(/too sharp|sharp entry/);
    expect(oc[1].alt).toBeLessThan(150000);
    expect(oc[1].word).toBe('CURL ROUTE ADVISED');            // below 150 km: two seconds at 0:05 or under after a sharp entry
    expect(oc[1].brief).toBe('CURL ROUTE ADVISED');
    expect(oc.every((e) => !/km\/s/.test(e.coach) && !/steepen|level off|maintain/.test(e.coach) && !/°/.test(e.brief))).toBe(true);
    expect(getLiveApproach().live).toBeNull();
  });

  it('rebuilds runs and targets from the file alone', () => {
    const before = getApproachTargets();
    const r = initApproach(app, null, deps);
    expect(r.runs).toBe(before.targets.reduce((a, t) => a + t.runs, 0));
    const after = getApproachTargets();
    expect(after.targets.map((t) => [t.key, t.runs, t.shortestS])).toEqual(before.targets.map((t) => [t.key, t.runs, t.shortestS]));
    expect(after.targets.find((t) => t.key === `port:${MID}`).shortestS).toBe(88); // the shortest across hulls, on the picker
    expect(summarizeTarget(`port:${MID}`).shortest.runS).toBe(88);
  });

  it('a run opened by a position fix below the line is orbital cruise from its first sample — a hop between ports on one body never crosses a line', () => {
    events.length = 0;
    const base = { flags: (1 << 4) | (1 << 21), flags2: 0, lon: PAD.lon, hdg: 180, radius: R, body: 'Col 173 Sector AX-J d9-52 1 c', destination: { System: 1797401856371, Body: 16, Name: 'Planetary Construction Site: Kewell Range' } };
    // the test world's line is the profile's 58 km: two fixes below it, closing — a minute after the departing test's fixes, so the watch's buffer is clear
    for (const [t, d, a] of [[300, 236_000, 40_000], [301, 226_000, 38_000]]) { _setClock(() => BASE + t * 1000); statusNow = { ...base, at: iso(t), lat: latAt(d), alt: a }; idleTick(); }
    const live = getLiveApproach().live;
    expect(live).not.toBeNull();
    expect(live.openedInCruise).toBe(true);
    expect(phaseAt(live, 1)).toBe('Orbital cruise');
    for (let t = 302; t <= 305; t++) { _setClock(() => BASE + t * 1000); statusNow = { ...base, at: iso(t), lat: latAt(236_000 - (t - 300) * 10_000), alt: 40_000 - (t - 300) * 2_000 }; sampleOnce(); }
    const last = events.filter((e) => e.type === 'approach_sample').pop();
    expect(last.phase).toBe('Orbital cruise');
    expect(typeof last.word).toBe('string');                 // the cruise words, not a well that never ends
    noteApproachEvent({ timestamp: iso(306), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 });
    expect(getLiveApproach().live).toBeNull();
  });

  it('"request docking" waits for the 7.5 km the game takes it at, with a count-in — not from the glide\'s end', () => {
    events.length = 0;
    if (getLiveApproach().live) noteApproachEvent({ timestamp: iso(199), event: 'LeaveBody', Body: 'Col 173 Sector AX-J d9-52 1 c', BodyID: 16 }); // never inherit a run
    // a glide that ends 19 km out, as at Deshpande: the word used to sit on the HUD for the whole run-in
    drive(profile({ anchors: [{ t: 0, dist: 118000, alt: 58000 }, { t: 18, dist: 41000, alt: 24000 }, { t: 31, dist: 19000, alt: 3000 }, { t: 43, dist: 6200, alt: 1400 }, { t: 102, dist: 0, alt: 0 }] }), kewellJournal());
    const flight = events.filter((e) => e.type === 'approach_sample' && e.phase === 'Normal flight');
    expect(flight.length).toBeGreaterThan(5);
    const early = flight.filter((e) => e.rangeM > 7500), late = flight.filter((e) => e.rangeM <= 7500);
    expect(early.length).toBeGreaterThan(0);
    expect(early.every((e) => /^request docking in /.test(e.brief))).toBe(true);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((e) => e.brief === 'request docking')).toBe(true);
    const glide = events.filter((e) => e.type === 'approach_sample' && e.phase === 'Glide');
    expect(glide.every((e) => !/request docking/.test(e.brief) || e.rangeM <= 12500)).toBe(true);
  });
});
