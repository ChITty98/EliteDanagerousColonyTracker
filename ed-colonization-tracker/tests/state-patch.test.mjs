// The server's sparse state merge (server/journal/statePatch.js, out of server.mjs since 1.60.28).
// The case that mattered: a remove-only op on a map key must stay a map removal — on 2026-10-05 it
// came back as an empty array and took every manual population with it.
import { describe, it, expect, vi } from 'vitest';
import { mergeStatePatch, APPEND_ONLY_KEYS, FRESHNESS_STAMPS, isStaleUpsert } from '../server/journal/statePatch.js';

const OV = {
  'hip 52629': { population: 372_193_858, updatedAt: '2026-10-04T10:41:19Z' },
  'wregoe qi-b d13-43': { population: 5066, updatedAt: '2026-03-16T01:00:49Z' },
  'col 173 sector ax-j d9-52': { population: 154_659_936, updatedAt: '2026-09-14T03:05:11Z' },
};
const base = () => ({
  populationOverrides: { ...OV },
  watchedSystems: { a: { id: 'a' }, b: { id: 'b' } },
  manualColonizedSystems: ['HIP 52629', 'Sol'],
  fleetCarriers: [{ callsign: 'Q2Z-9XT', ownership: 'mine' }, { callsign: 'ABC-123', ownership: 'other' }],
  settings: { overlayEnabled: true, copilotPersonality: 'tars' },
  counter: 3,
});

describe('a remove-only op on a map (the 2026-10-05 wipe)', () => {
  it('removes just the named keys and keeps the map a map', () => {
    const out = mergeStatePatch(base(), { populationOverrides: { __remove: ['wregoe qi-b d13-43', 'col 173 sector ax-j d9-52'] } }, { trusted: true });
    expect(Array.isArray(out.populationOverrides)).toBe(false);
    expect(out.populationOverrides).toEqual({ 'hip 52629': OV['hip 52629'] });
  });
  it('the same for the watched-systems map (Threats unflag)', () => {
    const out = mergeStatePatch(base(), { watchedSystems: { __remove: ['b'] } });
    expect(out.watchedSystems).toEqual({ a: { id: 'a' } });
  });
  it('the client shape — an empty upsert beside the removes — behaves the same', () => {
    const out = mergeStatePatch(base(), { watchedSystems: { __upsert: {}, __remove: ['a'] } });
    expect(out.watchedSystems).toEqual({ b: { id: 'b' } });
  });
  it('upsert and remove together', () => {
    const out = mergeStatePatch(base(), { populationOverrides: { __upsert: { sol: { population: 22_780_919_531, updatedAt: '2026-10-05T00:00:00Z' } }, __remove: ['hip 52629'] } }, { trusted: true });
    expect(Object.keys(out.populationOverrides).sort()).toEqual(['col 173 sector ax-j d9-52', 'sol', 'wregoe qi-b d13-43']);
  });
});

describe('append-only keys', () => {
  it('manual populations are append-only: a client remove is blocked and logged, a trusted one passes', () => {
    expect(APPEND_ONLY_KEYS.has('populationOverrides')).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = mergeStatePatch(base(), { populationOverrides: { __upsert: {}, __remove: ['hip 52629'] } });
    expect(blocked.populationOverrides).toEqual(OV);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/BLOCKED 1 __remove op\(s\) on append-only key 'populationOverrides'/));
    warn.mockRestore();
    const trusted = mergeStatePatch(base(), { populationOverrides: { __remove: ['hip 52629'] } }, { trusted: true });
    expect(Object.keys(trusted.populationOverrides)).toHaveLength(2);
  });
  it('a blocked remove still applies the upsert beside it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mergeStatePatch(base(), { populationOverrides: { __upsert: { sol: { population: 1, updatedAt: 'x' } }, __remove: ['hip 52629'] } });
    expect(Object.keys(out.populationOverrides)).toHaveLength(4);
    vi.restoreAllMocks();
  });
});

describe('the other shapes are unchanged', () => {
  it('primitive sets add and remove, and a remove-only op on an array stays a set', () => {
    expect(mergeStatePatch(base(), { manualColonizedSystems: { __add: ['Sol', 'Achenar'] } }).manualColonizedSystems).toEqual(['HIP 52629', 'Sol', 'Achenar']);
    expect(mergeStatePatch(base(), { manualColonizedSystems: { __remove: ['Sol'] } }).manualColonizedSystems).toEqual(['HIP 52629']);
  });
  it('array-by-id with an idKey', () => {
    const out = mergeStatePatch(base(), { fleetCarriers: { __upsert: { 'ABC-123': { callsign: 'ABC-123', ownership: 'squadron' } }, __remove: ['Q2Z-9XT'], __idKey: 'callsign' } }, { trusted: true });
    expect(out.fleetCarriers).toEqual([{ callsign: 'ABC-123', ownership: 'squadron' }]);
  });
  it('settings shallow-merge; everything else replaces wholesale', () => {
    const out = mergeStatePatch(base(), { settings: { overlayEnabled: false }, counter: 4 });
    expect(out.settings).toEqual({ overlayEnabled: false, copilotPersonality: 'tars' });
    expect(out.counter).toBe(4);
  });
  it('does not touch keys the patch leaves out', () => {
    const b = base();
    const out = mergeStatePatch(b, { counter: 9 });
    expect(out.populationOverrides).toBe(b.populationOverrides);
    expect(out.watchedSystems).toBe(b.watchedSystems);
  });
});

describe("stale upserts on dated maps (the 2026-10-25 Thagard's revert)", () => {
  const fresh = { stationName: "Thagard's Progress", updatedAt: '2026-10-23T06:11:02Z', commodities: [{ commodityId: 'indite', sellPrice: 13129 }] };
  const stale = { stationName: "Thagard's Progress", updatedAt: '2026-09-23T04:01:30Z', commodities: [{ commodityId: 'indite', sellPrice: 13114 }] };
  const newer = { ...fresh, updatedAt: '2026-10-25T21:59:02Z' };
  const st = () => ({ marketSnapshots: { '4365774083': fresh }, knownSystems: { sol: { lastSeen: '2026-10-20T00:00:00Z', population: 1 } }, watchedSystems: { a: { id: 'a', updatedAt: '2026-10-20T00:00:00Z' } } });
  it('names the dated maps', () => {
    expect(FRESHNESS_STAMPS.marketSnapshots).toBe('updatedAt');
    expect(isStaleUpsert('marketSnapshots', stale, fresh)).toBe(true);
    expect(isStaleUpsert('marketSnapshots', fresh, stale)).toBe(false);
  });
  it("drops a client's older copy and keeps the stored record", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mergeStatePatch(st(), { marketSnapshots: { __upsert: { '4365774083': stale } } }, { source: '192.168.1.20' });
    expect(out.marketSnapshots['4365774083']).toEqual(fresh);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("Dropped 1 stale upsert(s) on 'marketSnapshots' from 192.168.1.20");
    expect(String(warn.mock.calls[0][0])).toContain('2026-09-23 < 2026-10-23');
    warn.mockRestore();
  });
  it('applies a newer copy and an equal-stamped edit', () => {
    expect(mergeStatePatch(st(), { marketSnapshots: { __upsert: { '4365774083': newer } } }).marketSnapshots['4365774083']).toEqual(newer);
    const edited = { ...fresh, note: 'edited' };
    expect(mergeStatePatch(st(), { marketSnapshots: { __upsert: { '4365774083': edited } } }).marketSnapshots['4365774083']).toEqual(edited);
  });
  it('a server patch is never filtered', () => {
    expect(mergeStatePatch(st(), { marketSnapshots: { __upsert: { '4365774083': stale } } }, { trusted: true }).marketSnapshots['4365774083']).toEqual(stale);
  });
  it('a record without a stamp, a new key, and an undated map all apply', () => {
    const out = mergeStatePatch(st(), {
      marketSnapshots: { __upsert: { '4365774083': { stationName: 'no stamp' }, '999': stale } },
      knownSystems: { __upsert: { sol: { lastSeen: '2026-10-19T00:00:00Z', population: 2 } } },
      watchedSystems: { __upsert: { a: { id: 'a', updatedAt: '2026-01-01T00:00:00Z' } } },
    });
    expect(out.marketSnapshots['4365774083']).toEqual({ stationName: 'no stamp' });
    expect(out.marketSnapshots['999']).toEqual(stale);
    expect(out.knownSystems.sol.population).toBe(1); // older lastSeen dropped
    expect(out.watchedSystems.a.updatedAt).toBe('2026-01-01T00:00:00Z'); // not a dated map
  });
});
