// The surface-mining co-pilot bridge: the driving rating becomes a band, never a number; the hold
// beat picks near/far by whether the ship is landed alongside; the target beat only names what the
// ledger recorded; stale moments are dropped rather than delivered late.
import { describe, it, expect, beforeEach } from 'vitest';
import { pushSurfaceBeat, detectSurfaceBeat, bandFor, pickTargetCommodity, TARGET_MIN_CR, _resetSurfaceQueue, setSurfaceKick, shipMoveKind, tempBand, surfaceTempFromState, BURST_DEPARTURE_WINDOW_MS, RECALL_ARRIVAL_MS } from '../server/ai/copilotSurface.js';
import LINES from '../server/ai/copilotSurfaceLines.js';

describe('surface co-pilot bridge', () => {
  beforeEach(() => _resetSurfaceQueue());

  it("turns the commander's 1–5 driving scale into bands, and anything else into unrated", () => {
    expect([1, 2, 3, 4, 5].map(bandFor)).toEqual(['flat', 'bumpy', 'broken', 'valleys', 'brutal']);
    expect(bandFor(null)).toBe('unrated');
    expect(bandFor(undefined)).toBe('unrated');
    expect(bandFor(0)).toBe('unrated');
    expect(bandFor('4')).toBe('valleys');
  });

  it('keys an arrival by band and carries only the signal and body', () => {
    pushSurfaceBeat('arrive', { body: 'Rock 1 a', siteIndex: 7, driving: 4 });
    const b = detectSurfaceBeat();
    expect(b.key).toBe('surface-arrive-valleys');
    expect(b.live).toBe(false);                       // canned-only, always
    expect(b.inputs).toEqual({ site: '7', body: 'Rock 1 a' });
    expect(Object.keys(b.inputs)).not.toContain('driving'); // the number never reaches a line
  });

  it('has two hold states: proven-beside-you, and everything the app cannot prove', () => {
    pushSurfaceBeat('hold', { ship: 'near' });
    expect(detectSurfaceBeat().key).toBe('surface-hold-near');
    pushSurfaceBeat('hold', { ship: 'far' });
    expect(detectSurfaceBeat().key).toBe('surface-hold-far');
    pushSurfaceBeat('hold', { ship: 'air' });               // no such state
    expect(detectSurfaceBeat().key).toBe('surface-hold-far');
  });

  it('far lines never say where she is or that she will move — they prompt a recall or a drive back', () => {
    const promise = /i'll bring|i'll come|i can come|i'll fly|bring her (over|across|down|in)|close the (gap|distance)|i can be alongside|taxi her|i'll land her|i'll set her down|i could come down|i could drive her|call me down|i'll land|set down|land beside/;
    const position = /where you left me|i'm parked|i'm landed|i'm overhead|i'm exactly|station-keeping where|on the ground a/;
    for (const persona of ['wash', 'tars', 'k2']) {
      for (const line of LINES[persona]['surface-hold-far']) {
        expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(promise);
        expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(position);
      }
      expect(LINES[persona]['surface-hold-far'].some((l) => /recall|call me|bring it|drive it|walk/i.test(l)), persona).toBe(true);
      expect(LINES[persona]['surface-hold-air']).toBeUndefined();
    }
  });

  it('names the target commodity only when one was recorded at that signal', () => {
    pushSurfaceBeat('target', { commodity: 'iridium', siteIndex: 7 });
    const b = detectSurfaceBeat();
    expect(b.key).toBe('surface-target');
    expect(b.inputs).toEqual({ commodity: 'iridium', site: '7' });
    pushSurfaceBeat('target', { siteIndex: 7 });       // nothing on file for the site
    expect(detectSurfaceBeat()).toBeNull();
  });

  it("nudges about the most VALUABLE thing on file, never the copper, and nothing under the floor", () => {
    const price = (c) => ({ Copper: 1000, Iridium: 129763, Grandidierite: 185000, Haematite: 3000 })[c] ?? 0;
    expect(TARGET_MIN_CR).toBe(90000);
    expect(pickTargetCommodity(['Copper', 'Iridium', 'Haematite'], price)).toBe('Iridium');
    expect(pickTargetCommodity(['Iridium', 'Grandidierite'], price)).toBe('Grandidierite');   // the best, not the first
    expect(pickTargetCommodity(['Copper', 'Haematite'], price)).toBeNull();                  // worth nothing: silence
    expect(pickTargetCommodity([], price)).toBeNull();
    expect(pickTargetCommodity(['Iridium'], price, 200000)).toBeNull();                       // floor is a floor
    expect(pickTargetCommodity(['Copper', 'Copper', 'Iridium'], price)).toBe('Iridium');     // duplicates are harmless
  });

  it('tells a recall from a departure the way the journal does: an unmanned Liftoff inside the window, or nothing', () => {
    const t = 1_000_000;
    expect(shipMoveKind(t, t + 3_000)).toBe('departure');            // the 3 s the journal shows, five times
    expect(shipMoveKind(t, t + BURST_DEPARTURE_WINDOW_MS)).toBe('departure');
    expect(shipMoveKind(t, null)).toBe('recall');                    // nothing followed: she is coming
    expect(shipMoveKind(t, t + 68_000)).toBe('recall');              // a liftoff a minute on is a later event
    expect(shipMoveKind(t, t - 30_000)).toBe('recall');              // an OLD liftoff is not this burst's
    expect(RECALL_ARRIVAL_MS).toBe(30_000);                          // she lands 26–33 s after the burst on foot
  });

  it('keys the recall beat below the hold and above the arrival, and the foot beat by the temperature ON FILE', () => {
    pushSurfaceBeat('recall', {});
    const r = detectSurfaceBeat();
    expect(r.key).toBe('surface-recall');
    expect(r.priority).toBeLessThan(56);
    expect(r.priority).toBeGreaterThan(44);
    expect(r.live).toBe(false);
    pushSurfaceBeat('foot', { body: 'Rock 2 b', tempK: 180 });
    expect(detectSurfaceBeat().key).toBe('surface-foot-cold');
    pushSurfaceBeat('foot', { body: 'Rock 2 b', tempK: 700 });
    expect(detectSurfaceBeat().key).toBe('surface-foot-hot');
    pushSurfaceBeat('foot', { body: 'Rock 2 b', tempK: 290 });
    expect(detectSurfaceBeat().key).toBe('surface-foot-mild');
    pushSurfaceBeat('foot', { body: 'Rock 2 b' });
    const f = detectSurfaceBeat();
    expect(f.key).toBe('surface-foot-unknown');
    expect(f.inputs).toEqual({ body: 'Rock 2 b' });                  // the temperature never reaches a line
  });

  it('bands temperature exactly as the live dossier does, and calls everything else unknown', () => {
    expect([100, 254, 255, 350, 351, 900].map(tempBand)).toEqual(['cold', 'cold', 'mild', 'mild', 'hot', 'hot']);
    expect([null, undefined, 0, -5, NaN, 'x'].map(tempBand)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  });

  it('reads the surface temperature from the commander\'s own scan first, then the scouted cache, else nothing', () => {
    const state = {
      journalExplorationCache: { '111': { scannedBodies: [{ bodyName: 'Sys A 2 b', surfaceTemperature: 181.5 }] } },
      scoutedSystems: { '222': { cachedBodies: [{ name: 'Sys B 1 a', surfaceTemperature: 412 }] } },
    };
    expect(surfaceTempFromState(state, '111', 'Sys A 2 b')).toBe(181.5);
    expect(surfaceTempFromState(state, 111, 'sys a 2 B')).toBe(181.5);          // number address, any case
    expect(surfaceTempFromState(state, null, 'Sys A 2 b')).toBe(181.5);         // no address: body names are unique
    expect(surfaceTempFromState(state, '222', 'Sys B 1 a')).toBe(412);
    expect(surfaceTempFromState(state, '999', 'Sys B 1 a')).toBe(412);          // wrong address still resolves
    expect(surfaceTempFromState(state, '111', 'Sys A 2 c')).toBeNull();
    expect(surfaceTempFromState(null, '111', 'Sys A 2 b')).toBeNull();
    expect(surfaceTempFromState({}, '111', '')).toBeNull();
  });

  it('kicks the co-pilot only when asked to — a timer-born beat cannot wait for the next journal line', () => {
    const kicks = [];
    setSurfaceKick((k) => kicks.push(k));
    pushSurfaceBeat('recall', {}, { kick: true });
    pushSurfaceBeat('hold', { ship: 'near' });                       // event-born: the tick is already running
    expect(kicks).toEqual(['recall']);
    setSurfaceKick(null);
    pushSurfaceBeat('recall', {}, { kick: true });                   // nothing registered: harmless
    expect(kicks).toEqual(['recall']);
  });

  it('recall lines say she is coming and never how she arrives; foot lines claim only the band they are keyed by', () => {
    const arrives = /\bland|set (her )?down|touch(ing)? down|hover|come down|coming down/;
    const cold = /cold|freez|frigid|chill/;
    const hot = /\bhot\b|heat|bak(ing|ed)|scorch|boil/;
    for (const persona of ['wash', 'tars', 'k2']) {
      for (const line of LINES[persona]['surface-recall']) {
        expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(arrives);
        expect(line.toLowerCase(), `${persona}: "${line}"`).toMatch(/on my way|coming|inbound|heard|received|acknowledged/);
      }
      expect(LINES[persona]['surface-foot-cold'].every((l) => cold.test(l.toLowerCase())), persona + ' cold').toBe(true);
      expect(LINES[persona]['surface-foot-hot'].every((l) => hot.test(l.toLowerCase())), persona + ' hot').toBe(true);
      for (const line of [...LINES[persona]['surface-foot-mild'], ...LINES[persona]['surface-foot-unknown']]) {
        expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(cold);
        expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(hot);
      }
      for (const line of LINES[persona]['surface-foot-unknown']) expect(line.toLowerCase(), `${persona}: "${line}"`).not.toMatch(/mild|temperate|warm|fair|tolerable|acceptable/);
    }
  });

  it('has a line for the ship leaving while the commander is on the ground', () => {
    pushSurfaceBeat('ship-away', {});
    expect(detectSurfaceBeat().key).toBe('surface-ship-away');
  });

  it('delivers one moment per tick and drops anything older than a minute', () => {
    pushSurfaceBeat('arrive', { driving: 1 });
    pushSurfaceBeat('hold', { ship: 'near' });
    expect(detectSurfaceBeat().key).toBe('surface-hold-near'); // freshest wins
    expect(detectSurfaceBeat()).toBeNull();                    // and the rest were cleared
  });

  it('ships pools for every key, for every persona, with no number and no memory claims in them', () => {
    const keys = ['surface-arrive-flat', 'surface-arrive-bumpy', 'surface-arrive-broken', 'surface-arrive-valleys',
      'surface-arrive-brutal', 'surface-arrive-unrated', 'surface-hold-near', 'surface-hold-far', 'surface-target', 'surface-ship-away',
      'surface-recall', 'surface-foot-cold', 'surface-foot-hot', 'surface-foot-mild', 'surface-foot-unknown'];
    for (const persona of ['wash', 'tars', 'k2']) {
      for (const k of keys) {
        const pool = LINES[persona][k];
        expect(Array.isArray(pool) && pool.length >= 3, `${persona}/${k}`).toBe(true);
        for (const line of pool) {
          expect(line, `${persona}/${k}: "${line}"`).not.toMatch(/\d/);                 // never a number read back
          expect(line.toLowerCase(), `${persona}/${k}: "${line}"`).not.toMatch(/last time|you rated|your note|you said|you called/);
          expect(line.toLowerCase(), `${persona}/${k}: "${line}"`).not.toMatch(/\b(north|south|east|west)\b/); // no invented bearings
        }
      }
      for (const line of LINES[persona]['surface-target']) expect(line).toContain('{commodity}');
    }
  });
});
