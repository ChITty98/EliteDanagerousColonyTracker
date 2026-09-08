// Driving order for the rig points at a signal — the ONE place that rule lives.
//
// It is an OPEN tour, not a loop: the commander works deposit to deposit and only sprints back to
// the ship when the Rhino fills, so forcing the route to return would optimise for a trip that is
// not the one being made. The ship is offered as a waypoint with its own cost from each stop
// instead, which is the question actually being asked — "if I dump now, what does it cost me".
//
// Cost is TIME, not distance. Measured across the commander's own track, a signal rated 4 for
// driving moves at 12.3 m/s median where a flat one does 23.6 — nearly 2x. A route picked on
// distance alone would be wrong by more than any tightening of the path could win back.

export interface RoutePoint { id: string; lat: number; lon: number; label?: string; tonnes?: number }
export interface RouteLeg { from: RoutePoint | null; to: RoutePoint; metres: number; seconds: number; measured?: boolean }
export interface Route { order: RoutePoint[]; legs: RouteLeg[]; metres: number; seconds: number }

/** Great-circle-ish distance on a small sphere — flat enough at these ranges to use the plane. */
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }, radiusM: number): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon) * radiusM;
}

export interface RouteOptions {
  radiusM: number;
  /** Fallback pace when nothing better is known, in m/s. */
  speedMps: number;
  /** Measured seconds for a stretch you have already driven, by point id — beats any estimate. */
  secondsFor?: (fromId: string | null, toId: string) => number | null;
}

const legCost = (a: { lat: number; lon: number }, b: RoutePoint, o: RouteOptions, fromId: string | null = null): RouteLeg => {
  const metres = metresBetween(a, b, o.radiusM);
  const seen = o.secondsFor?.(fromId, b.id) ?? null;
  const seconds = seen != null && seen > 0 ? seen : metres / Math.max(o.speedMps, 0.5);
  return { from: null, to: b, metres, seconds, measured: seen != null && seen > 0 };
};

/**
 * Nearest-neighbour seed, then 2-opt on the OPEN path (the last point is free to be anywhere).
 * At the sizes this sees — 22 rig points is the biggest signal on record — 2-opt lands within a
 * few percent of optimal and finishes instantly, which matters because it reruns as you drive.
 */
export function planRoute(start: { lat: number; lon: number }, points: RoutePoint[], o: RouteOptions): Route {
  const left = points.slice();
  const order: RoutePoint[] = [];
  let here: { lat: number; lon: number } = start;
  let hereId: string | null = null;
  while (left.length) {
    let bi = 0; let best = Infinity;
    for (let i = 0; i < left.length; i++) {
      const c = legCost(here, left[i], o, hereId).seconds;
      if (c < best) { best = c; bi = i; }
    }
    here = left[bi]; hereId = left[bi].id;
    order.push(left.splice(bi, 1)[0]);
  }
  const cost = (seq: RoutePoint[]): number => {
    let t = 0; let prev: { lat: number; lon: number } = start; let prevId: string | null = null;
    for (const p of seq) { t += legCost(prev, p, o, prevId).seconds; prev = p; prevId = p.id; }
    return t;
  };
  // 2-opt: reversing an interior stretch can undo the crossings nearest-neighbour leaves behind.
  let improved = true;
  let bestCost = cost(order);
  let guard = 0;
  while (improved && guard++ < 40) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const trial = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        const c = cost(trial);
        if (c < bestCost - 1e-6) { order.splice(0, order.length, ...trial); bestCost = c; improved = true; }
      }
    }
  }
  const legs: RouteLeg[] = [];
  let prev: { lat: number; lon: number } = start; let prevId: string | null = null;
  let metres = 0; let seconds = 0;
  for (const p of order) {
    const leg = legCost(prev, p, o, prevId);
    legs.push({ ...leg, from: legs.length ? order[legs.length - 1] : null });
    metres += leg.metres; seconds += leg.seconds;
    prev = p; prevId = p.id;
  }
  return { order, legs, metres, seconds };
}

/** What a dump run costs from each stop on the route — the "should I go now" number. */
export function shipDetours(route: Route, ship: { lat: number; lon: number } | null, o: RouteOptions) {
  if (!ship) return [];
  return route.order.map((p) => ({ point: p, ...legCost(p, { id: 'ship', ...ship }, o) }));
}

/**
 * The pace to route at, in m/s, taken from the drive already recorded here — the median of
 * consecutive samples, which is what "how fast can I actually move on this ground" means.
 *
 * Filters match the ones the correlation was measured with: samples more than a minute apart are
 * two different drives, hops over 2 km are the game repositioning you, and anything over 120 m/s
 * is not an SRV. The median (not the mean) so the time parked at a rock does not drag it down.
 */
export function paceFrom(
  track: { lat: number; lon: number; at: string }[],
  radiusM: number | null,
): number | null {
  if (!radiusM || !track || track.length < 8) return null;
  const v: number[] = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]; const b = track[i];
    const dt = (Date.parse(b.at) - Date.parse(a.at)) / 1000;
    if (!(dt > 0) || dt > 60) continue;
    const d = metresBetween(a, b, radiusM);
    if (d < 1 || d > 2000) continue;
    const s = d / dt;
    if (s > 120) continue;
    v.push(s);
  }
  if (v.length < 8) return null;
  v.sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
}

/**
 * Leg times taken from the drive you actually made, keyed "fromId|toId", in seconds.
 *
 * A straight line between two rig points is a claim about ground nobody has seen. There may be a
 * boulder, a ridge, a crevasse — and the only evidence of that is how long it really took you to
 * get from one to the other. Where the track has made a crossing, that time replaces the estimate;
 * where it has not, the straight line stands in and is drawn as a guess.
 *
 * The track is reduced to the order it came within `nearM` of each point; consecutive arrivals at
 * two different points are one observed leg. Repeats keep the FASTEST run, since a slow one may
 * just be an evening where you stopped to look at something.
 */
export function observedLegTimes(
  track: { lat: number; lon: number; at: string }[],
  points: RoutePoint[],
  radiusM: number,
  nearM = 120,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!track?.length || points.length < 2) return out;
  let at: { id: string; t: number } | null = null;
  for (const s of track) {
    let hit: RoutePoint | null = null;
    let bestD = nearM;
    for (const p of points) {
      const d = metresBetween(s, p, radiusM);
      if (d < bestD) { bestD = d; hit = p; }
    }
    if (!hit) continue;
    const t = Date.parse(s.at);
    if (at && at.id !== hit.id) {
      const secs = (t - at.t) / 1000;
      // A leg that took a whole evening is not a leg — you went away and came back.
      if (secs > 0 && secs < 45 * 60) {
        const k = `${at.id}|${hit.id}`;
        const prev = out.get(k);
        if (prev == null || secs < prev) { out.set(k, secs); out.set(`${hit.id}|${at.id}`, secs); }
      }
    }
    if (!at || at.id !== hit.id) at = { id: hit.id, t };
    else at.t = t;   // still standing at the same deposit — the clock starts when you leave
  }
  return out;
}

/**
 * Point to point, with no position to start from.
 *
 * Asked from the sofa there is no "you" and no ship on the body — only the rig points. Starting at
 * whichever one happens to be first in the array is arbitrary and can be badly wrong, so every one
 * is tried as the opening stop and the cheapest tour wins. At the sizes this sees (22 rig points on
 * the largest signal on record) that is 22 cheap solves, done before the frame lands.
 */
export function planRouteAnywhere(points: RoutePoint[], o: RouteOptions): Route | null {
  if (points.length < 2) return null;
  let best: Route | null = null;
  for (const first of points) {
    const rest = points.filter((q) => q.id !== first.id);
    const tail = planRoute(first, rest, o);
    const lead: RouteLeg = { from: null, to: first, metres: 0, seconds: 0, measured: false };
    const whole: Route = {
      order: [first, ...tail.order],
      legs: [lead, ...tail.legs],
      metres: tail.metres,
      seconds: tail.seconds,
    };
    if (!best || whole.seconds < best.seconds) best = whole;
  }
  return best;
}

// ---- Routing over the ground you have actually crossed --------------------------------------
//
// A straight line between two rig points is a claim about terrain nobody has driven. On a body of
// ridges, boulders and rough ground that claim is usually wrong, and a "route" made of straight
// lines only ever tells you what you can already see on the map.
//
// The breadcrumb track is the one real record of what the SRV can cross. Every stretch you drove
// is a proven edge with a measured time on it. Treating the track as a graph and finding the
// quickest path THROUGH it gives a route that goes round the boulder, because you went round the
// boulder. Rig points join the network at the nearest place you drove past them.

export interface TerrainGraph {
  nodes: { lat: number; lon: number }[];
  adj: Map<number, { to: number; seconds: number }[]>;
  radiusM: number;
}

/**
 * Build the driveable network from a breadcrumb track.
 *
 * Consecutive samples are an edge with the time it really took. Samples from different passes that
 * sit within `weldM` of each other are welded together, so an evening spent criss-crossing becomes
 * one connected network rather than a handful of parallel scratches.
 */
export function buildTerrainGraph(
  track: { lat: number; lon: number; at: string }[],
  radiusM: number,
  weldM = 45,
): TerrainGraph {
  const nodes = track.map((p) => ({ lat: p.lat, lon: p.lon }));
  const adj = new Map<number, { to: number; seconds: number }[]>();
  const link = (a: number, b: number, seconds: number) => {
    if (a === b || !(seconds >= 0)) return;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const list = adj.get(x) || [];
      const prev = list.find((e) => e.to === y);
      if (prev) { if (seconds < prev.seconds) prev.seconds = seconds; }
      else { list.push({ to: y, seconds }); adj.set(x, list); }
    }
  };
  for (let i = 1; i < track.length; i++) {
    const dt = (Date.parse(track[i].at) - Date.parse(track[i - 1].at)) / 1000;
    const d = metresBetween(track[i - 1], track[i], radiusM);
    // A gap of minutes is not a drive, and a kilometre between samples is the game moving you.
    if (dt > 0 && dt <= 60 && d <= 800) link(i - 1, i, dt);
  }
  // Weld passes that touch. Grid the nodes so this stays linear rather than comparing every pair.
  const cell = new Map<string, number[]>();
  const key = (p: { lat: number; lon: number }) => {
    const s = weldM / radiusM * (180 / Math.PI);
    return `${Math.round(p.lat / s)}|${Math.round(p.lon / s)}`;
  };
  nodes.forEach((p, i) => { const k = key(p); const list = cell.get(k) || []; list.push(i); cell.set(k, list); });
  for (const list of cell.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const d = metresBetween(nodes[list[a]], nodes[list[b]], radiusM);
        if (d <= weldM) link(list[a], list[b], 0.001);   // same place, no travel
      }
    }
  }
  return { nodes, adj, radiusM };
}

/** The node nearest a point, within `maxM`, or null when the track never went near it. */
function nearestNode(g: TerrainGraph, p: { lat: number; lon: number }, maxM: number): number | null {
  let best: number | null = null; let bestD = maxM;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = metresBetween(g.nodes[i], p, g.radiusM);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Quickest path through the driven network between two points, with the shape of it — so the route
 * can be drawn along the ground you took rather than through whatever is in between.
 * Returns null when either end is nowhere near anything you have driven.
 */
export function pathThrough(
  g: TerrainGraph,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  attachM = 250,
  minM = 250,
): { seconds: number; shape: { lat: number; lon: number }[] } | null {
  // Below a couple of sample spacings the graph says more about where the breadcrumbs fell than
  // about the ground. A 80 m hop routed through nodes 200 m apart reads three times too slow, which
  // would push the route away from short legs for no reason at all. Straight line wins down there.
  if (metresBetween(from, to, g.radiusM) < minM) return null;
  const a = nearestNode(g, from, attachM);
  const b = nearestNode(g, to, attachM);
  if (a == null || b == null) return null;
  const dist = new Map<number, number>([[a, 0]]);
  const prev = new Map<number, number>();
  const seen = new Set<number>();
  // Small graphs; a linear scan for the next node is faster than maintaining a heap.
  for (;;) {
    let u: number | null = null; let best = Infinity;
    for (const [n, d] of dist) if (!seen.has(n) && d < best) { best = d; u = n; }
    if (u == null) break;
    if (u === b) break;
    seen.add(u);
    for (const e of g.adj.get(u) || []) {
      const nd = best + e.seconds;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); }
    }
  }
  if (!dist.has(b)) return null;
  const shape: { lat: number; lon: number }[] = [];
  for (let n: number | undefined = b; n != null; n = prev.get(n)) shape.unshift(g.nodes[n]);
  return { seconds: dist.get(b)!, shape };
}

/**
 * Split a time-ordered track into runs of continuous driving: consecutive samples no more than
 * `gapMs` apart. The coverage corridor is drawn per run — a jump between two evenings, or across
 * a stretch where the exe was down, is not ground the scanner swept.
 */
export function splitRuns<T extends { at: string }>(points: T[], gapMs = 120_000): T[][] {
  const runs: T[][] = [];
  for (const p of points) {
    const r = runs[runs.length - 1];
    const t = Date.parse(p.at);
    if (r && Number.isFinite(t) && t - Date.parse(r[r.length - 1].at) <= gapMs && t >= Date.parse(r[r.length - 1].at)) r.push(p);
    else runs.push([p]);
  }
  return runs;
}
