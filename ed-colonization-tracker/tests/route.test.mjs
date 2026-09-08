// The rig-point route: an OPEN tour costed in TIME, not distance.
import { describe, it, expect } from 'vitest';
import { planRoute, metresBetween, shipDetours } from '../src/features/surface-mining/route.ts';

const R = 2.0e6;                       // a small rocky body
const o = { radiusM: R, speedMps: 20 };
const P = (id, lat, lon) => ({ id, lat, lon });

describe('rig point routing', () => {
  it('visits every point exactly once, starting from where you are', () => {
    const pts = [P('a', 0, 0.1), P('b', 0, 0.3), P('c', 0, 0.2)];
    const r = planRoute({ lat: 0, lon: 0 }, pts, o);
    expect(r.order.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(r.legs.length).toBe(3);
    expect(new Set(r.order.map((p) => p.id)).size).toBe(3);
  });

  it('does not return to the start — the last stop is wherever the work ends', () => {
    const pts = [P('near', 0, 0.05), P('far', 0, 0.5)];
    const r = planRoute({ lat: 0, lon: 0 }, pts, o);
    expect(r.order[r.order.length - 1].id).toBe('far');
    // a closed loop would have to pay the trip home; an open one does not
    const home = metresBetween({ lat: 0, lon: 0.5 }, { lat: 0, lon: 0 }, R);
    expect(r.metres).toBeLessThan(home * 2);
  });

  it('costs in time, so a slow signal is not routed like a fast one', () => {
    const pts = [P('a', 0, 0.1), P('b', 0, 0.2)];
    const fast = planRoute({ lat: 0, lon: 0 }, pts, { radiusM: R, speedMps: 24 });
    const slow = planRoute({ lat: 0, lon: 0 }, pts, { radiusM: R, speedMps: 12 });
    expect(fast.metres).toBeCloseTo(slow.metres, 3);           // same path
    expect(slow.seconds).toBeCloseTo(fast.seconds * 2, 1);     // twice the evening
  });

  it('goes to the further point first when the nearer one is a known crawl', () => {
    const pts = [P('rough', 0, 0.10), P('paved', 0, 0.12)];
    // You have driven out to 'rough' before and it took twenty minutes; 'paved' is untested.
    const secondsFor = (from, to) => (from === null && to === 'rough' ? 1200 : null);
    const r = planRoute({ lat: 0, lon: 0 }, pts, { radiusM: R, speedMps: 20, secondsFor });
    expect(r.order[0].id).toBe('paved');
  });

  it('untangles a crossing that nearest-neighbour leaves behind', () => {
    // A square: greedy hops the diagonal and has to come back across it.
    const pts = [P('nw', 0.1, 0), P('ne', 0.1, 0.1), P('se', 0, 0.1), P('sw', 0.001, 0.001)];
    const r = planRoute({ lat: 0, lon: 0 }, pts, o);
    const greedy = [P('sw', 0.001, 0.001), P('se', 0, 0.1), P('ne', 0.1, 0.1), P('nw', 0.1, 0)];
    const costOf = (seq) => { let t = 0; let prev = { lat: 0, lon: 0 };
      for (const p of seq) { t += metresBetween(prev, p, R); prev = p; } return t; };
    expect(r.metres).toBeLessThanOrEqual(costOf(greedy) + 1);
  });

  it('says what a dump run costs from each stop, and nothing when the ship is unknown', () => {
    const pts = [P('a', 0, 0.1), P('b', 0, 0.2)];
    const r = planRoute({ lat: 0, lon: 0 }, pts, o);
    const d = shipDetours(r, { lat: 0, lon: 0 }, o);
    expect(d.map((x) => x.point.id)).toEqual(['a', 'b']);
    expect(d[1].seconds).toBeGreaterThan(d[0].seconds);   // further out, longer sprint home
    expect(shipDetours(r, null, o)).toEqual([]);
  });

  it('handles the empty and single-point cases without inventing work', () => {
    expect(planRoute({ lat: 0, lon: 0 }, [], o).order).toEqual([]);
    expect(planRoute({ lat: 0, lon: 0 }, [], o).seconds).toBe(0);
    const one = planRoute({ lat: 0, lon: 0 }, [P('only', 0, 0.1)], o);
    expect(one.order.map((p) => p.id)).toEqual(['only']);
    expect(one.legs.length).toBe(1);
  });
});

import { observedLegTimes } from '../src/features/surface-mining/route.ts';

describe('routing on ground you have actually driven', () => {
  const R = 2.0e6;
  const P = (id, lat, lon) => ({ id, lat, lon });
  const t = (s) => new Date(Date.UTC(2026, 8, 4, 0, 0, s)).toISOString();

  it('reads a leg time out of the track and prefers the fastest crossing of it', () => {
    const pts = [P('a', 0, 0), P('b', 0, 0.01)];
    const track = [
      { lat: 0, lon: 0, at: t(0) },            // at a
      { lat: 0, lon: 0.01, at: t(600) },       // reached b — a slow 10 minutes
      { lat: 0, lon: 0, at: t(1200) },         // back at a
      { lat: 0, lon: 0.01, at: t(1320) },      // and across again in 2 minutes
    ];
    const obs = observedLegTimes(track, pts, R);
    expect(obs.get('a|b')).toBe(120);          // the fastest run, not the first
    expect(obs.get('b|a')).toBe(120);          // symmetric
  });

  it('ignores a "leg" that was really you going away and coming back', () => {
    const pts = [P('a', 0, 0), P('b', 0, 0.01)];
    const track = [{ lat: 0, lon: 0, at: t(0) }, { lat: 0, lon: 0.01, at: t(4 * 3600) }];
    expect(observedLegTimes(track, pts, R).size).toBe(0);
  });

  it('routes the long way round when the straight line is known to be slow', () => {
    // c is furthest by distance, but the a->b crossing turned out to be a crawl.
    const pts = [P('b', 0, 0.02), P('c', 0, 0.05)];
    const straight = planRoute({ lat: 0, lon: 0 }, pts, { radiusM: R, speedMps: 20 });
    expect(straight.order[0].id).toBe('b');
    const withBoulder = planRoute({ lat: 0, lon: 0 }, pts, {
      radiusM: R, speedMps: 20,
      secondsFor: (from, to) => (from === null && to === 'b' ? 9999 : null),
    });
    expect(withBoulder.order[0].id).toBe('c');
  });

  it('marks which legs are measured, and takes a measured leg that beats the guess', () => {
    const pts = [P('a', 0, 0.01), P('b', 0, 0.02)];
    // a -> b really took 5 seconds, far quicker than the 17 s the straight line assumes.
    const r = planRoute({ lat: 0, lon: 0 }, pts, {
      radiusM: R, speedMps: 20,
      secondsFor: (from, to) => (from === 'a' && to === 'b' ? 5 : null),
    });
    expect(r.order.map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.legs[0].measured).toBe(false);   // start -> a has never been driven
    expect(r.legs[1].measured).toBe(true);    // a -> b has
    expect(r.legs[1].seconds).toBe(5);
  });

  it('avoids a leg the track proves is slow, even though it looks short', () => {
    const pts = [P('a', 0, 0.01), P('b', 0, 0.02)];
    // Something is in the way between a and b: 60 s for ground a straight line calls 17 s.
    const r = planRoute({ lat: 0, lon: 0 }, pts, {
      radiusM: R, speedMps: 20,
      secondsFor: (from, to) => (from === 'a' && to === 'b' ? 60 : null),
    });
    expect(r.order.map((p) => p.id)).toEqual(['b', 'a']);   // go long first, come back the easy way
  });
});

describe('planning a signal you are not standing on', () => {
  const R = 2.0e6;
  const P = (id, lat, lon) => ({ id, lat, lon });

  it('routes from any anchor, so a signal can be planned before flying back to it', () => {
    const pts = [P('a', 0, 0.02), P('b', 0, 0.01), P('c', 0, 0.03)];
    // Anchored on the recall spot rather than a live position — the from-the-sofa case.
    const r = planRoute({ lat: 0, lon: 0.015 }, pts, { radiusM: R, speedMps: 20 });
    expect(r.order.length).toBe(3);
    expect(r.seconds).toBeGreaterThan(0);
    // nearest to 0.015 is b(0.01)? no — a(0.02) is 0.005 away, b is 0.005 away; either is fine,
    // what matters is that every point is visited exactly once from an arbitrary start.
    expect(new Set(r.order.map((p) => p.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('is unaffected by which anchor is chosen beyond the first hop', () => {
    const pts = [P('a', 0, 0.01), P('b', 0, 0.02), P('c', 0, 0.03)];
    const fromShip = planRoute({ lat: 0, lon: 0 }, pts, { radiusM: R, speedMps: 20 });
    const fromFirst = planRoute(pts[0], pts, { radiusM: R, speedMps: 20 });
    expect(fromShip.order.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(fromFirst.order.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

import { planRouteAnywhere } from '../src/features/surface-mining/route.ts';

describe('point to point with no position to start from', () => {
  const R = 2.0e6;
  const P = (id, lat, lon) => ({ id, lat, lon });

  it('starts at an end of a line of rig points, not in the middle', () => {
    // Given in a deliberately unhelpful order — the middle one first.
    const pts = [P('mid', 0, 0.02), P('west', 0, 0.01), P('east', 0, 0.03)];
    const r = planRouteAnywhere(pts, { radiusM: R, speedMps: 20 });
    expect(['west', 'east']).toContain(r.order[0].id);
    expect(r.order[1].id).toBe('mid');
    expect(new Set(r.order.map((q) => q.id)).size).toBe(3);
  });

  it('beats arbitrarily starting at the first point in the array', () => {
    const pts = [P('mid', 0, 0.02), P('west', 0, 0.01), P('east', 0, 0.03)];
    const anywhere = planRouteAnywhere(pts, { radiusM: R, speedMps: 20 });
    const fromFirst = planRoute(pts[0], pts.slice(1), { radiusM: R, speedMps: 20 });
    expect(anywhere.seconds).toBeLessThan(fromFirst.seconds);
  });

  it('needs two rig points to have anything to say', () => {
    expect(planRouteAnywhere([P('a', 0, 0)], { radiusM: R, speedMps: 20 })).toBeNull();
    expect(planRouteAnywhere([], { radiusM: R, speedMps: 20 })).toBeNull();
  });

  it('counts the opening stop as a stop, with no travel to reach it', () => {
    const pts = [P('a', 0, 0.01), P('b', 0, 0.02)];
    const r = planRouteAnywhere(pts, { radiusM: R, speedMps: 20 });
    expect(r.order.length).toBe(2);
    expect(r.legs[0].metres).toBe(0);
    expect(r.legs[0].seconds).toBe(0);
    expect(r.metres).toBeGreaterThan(0);
  });
});

import { buildTerrainGraph, pathThrough } from '../src/features/surface-mining/route.ts';

describe('routing over ground the SRV has actually crossed', () => {
  const R = 2.0e6;
  const t = (s) => new Date(Date.UTC(2026, 8, 4, 0, 0, s)).toISOString();

  // A drive that goes AROUND an obstacle: south, east, then north back up.
  const detour = [];
  for (let i = 0; i <= 10; i++) detour.push({ lat: -0.02 * (i / 10), lon: 0, at: t(i * 5) });
  for (let i = 1; i <= 10; i++) detour.push({ lat: -0.02, lon: 0.02 * (i / 10), at: t(50 + i * 5) });
  for (let i = 1; i <= 10; i++) detour.push({ lat: -0.02 * (1 - i / 10), lon: 0.02, at: t(100 + i * 5) });

  it('builds a connected network out of the breadcrumbs', () => {
    const g = buildTerrainGraph(detour, R);
    expect(g.nodes.length).toBe(detour.length);
    const edges = [...g.adj.values()].reduce((a, l) => a + l.length, 0) / 2;
    expect(edges).toBeGreaterThan(detour.length - 2);
  });

  it('costs the way round, not the way through', () => {
    const g = buildTerrainGraph(detour, R);
    const a = { lat: 0, lon: 0 }; const b = { lat: 0, lon: 0.02 };
    const via = pathThrough(g, a, b);
    expect(via).not.toBeNull();
    // Straight across is ~700 m; the drive round it is three sides of a square, ~2.1 km and 150 s.
    expect(via.seconds).toBeGreaterThan(100);
    expect(via.shape.length).toBeGreaterThan(10);      // it carries the shape, for drawing
  });

  it('leaves short hops to the straight line, where breadcrumb spacing would lie', () => {
    const g = buildTerrainGraph(detour, R);
    const a = { lat: 0, lon: 0 }; const b = { lat: -0.002, lon: 0 };   // ~70 m apart
    expect(pathThrough(g, a, b)).toBeNull();
  });

  it('says nothing about ground it has never been near', () => {
    const g = buildTerrainGraph(detour, R);
    expect(pathThrough(g, { lat: 0, lon: 0 }, { lat: 5, lon: 5 })).toBeNull();
  });
});

import { splitRuns } from '../src/features/surface-mining/route.ts';

describe('coverage runs', () => {
  it('splits a track into continuous drives — a gap is never shaded as ground driven', () => {
    const at = (s) => new Date(Date.UTC(2026, 8, 6, 7, 0, s)).toISOString();
    const pts = [0, 5, 10, 15, 400, 405, 410, 900].map((s, i) => ({ at: at(s), i }));
    const runs = splitRuns(pts);
    expect(runs.map((r) => r.map((p) => p.i))).toEqual([[0, 1, 2, 3], [4, 5, 6], [7]]);
    expect(splitRuns([])).toEqual([]);
    expect(splitRuns(pts, 1_000_000).length).toBe(1);
  });
});
