// Turns the community galactic-region grid into boundary polylines and label points for the Map.
//
// Source: github.com/klightspeed/EliteDangerousRegionMap (MIT, © 2020 Ben Peddell) — a 2048x2048
// grid of 4096/83 ≈ 49.35 ly cells with each row run-length encoded as [length, regionId]. It is
// the same map EDSM, Spansh and edastro derive their regions from, and it agrees with every Spansh
// region name in the commander's own data. The raw grid and licence are vendored beside this script.
//
// Boundaries are the grid edges where two regions meet, chained into polylines between junctions
// and simplified (Douglas–Peucker, 100 ly) — the 49 ly staircase is half a pixel at galaxy scale.
//
//   node scripts/gen-galactic-regions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'vendor', 'EliteDangerousRegionMap');
const OUT = path.join(HERE, '..', 'src', 'data', 'galacticRegions.ts');
const d = JSON.parse(fs.readFileSync(path.join(SRC, 'RegionMapData.json'), 'utf8'));
const NAMES = d.regions, MAP = d.regionmap;
const X0 = -49985, Z0 = -24105, CELL = 4096 / 83, N = 2048, TOL = 100;

const rows = MAP.map((row) => { const out = new Uint8Array(N); let x = 0; for (const [rl, pv] of row) { out.fill(pv, x, x + rl); x += rl; } return out; });
export const findRegion = (x, z) => {
  const px = Math.floor((x - X0) * 83 / 4096), pz = Math.floor((z - Z0) * 83 / 4096);
  return px < 0 || pz < 0 || px >= N || pz >= N ? null : (NAMES[rows[pz][px]] || null);
};

// ---- unit edges keyed by the unordered pair of regions they separate ----
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const edges = []; // { p: [px,pz], q: [px,pz], pair }
for (let pz = 0; pz < N; pz++) {
  const row = rows[pz];
  for (let px = 0; px < N - 1; px++) if (row[px] !== row[px + 1]) edges.push({ p: [px + 1, pz], q: [px + 1, pz + 1], pair: pairKey(row[px], row[px + 1]) });
  if (pz < N - 1) { const nxt = rows[pz + 1]; for (let px = 0; px < N; px++) if (row[px] !== nxt[px]) edges.push({ p: [px, pz + 1], q: [px + 1, pz + 1], pair: pairKey(row[px], nxt[px]) }); }
}

// ---- chain edges of the same pair into polylines that stop at junctions ----
const byEnd = new Map(); // "px,pz|pair" -> edge indices
const k = (pt, pair) => `${pt[0]},${pt[1]}|${pair}`;
edges.forEach((e, i) => { for (const pt of [e.p, e.q]) { const kk = k(pt, e.pair); (byEnd.get(kk) || byEnd.set(kk, []).get(kk)).push(i); } });
const used = new Uint8Array(edges.length);
const chains = [];
const walk = (start, from) => {
  const pts = [from];
  let e = start, at = from;
  for (;;) {
    used[e] = 1;
    const ed = edges[e];
    at = (ed.p[0] === at[0] && ed.p[1] === at[1]) ? ed.q : ed.p;
    pts.push(at);
    const nbrs = (byEnd.get(k(at, ed.pair)) || []).filter((i) => !used[i]);
    const deg = (byEnd.get(k(at, ed.pair)) || []).length;
    if (deg !== 2 || nbrs.length !== 1) break;
    e = nbrs[0];
  }
  return pts;
};
for (let i = 0; i < edges.length; i++) {
  if (used[i]) continue;
  const e = edges[i];
  // start from an end that is a junction if either is, so chains run junction to junction
  const degP = (byEnd.get(k(e.p, e.pair)) || []).length, degQ = (byEnd.get(k(e.q, e.pair)) || []).length;
  const from = degP !== 2 ? e.p : degQ !== 2 ? e.q : e.p;
  chains.push({ pair: e.pair, pts: walk(i, from) });
}
// second pass joins chain fragments that meet end-to-end with degree 2 (closed loops start mid-way)
// (walk() already stops only at junctions or when the loop closes, so this is the final set)

// ---- simplify in light years ----
const toLy = ([px, pz]) => [X0 + px * CELL, Z0 + pz * CELL];
const dp = (pts, tol) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dist = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD <= tol) return [a, b];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
};
const lines = chains.map((c) => {
  const pts = dp(c.pts.map(toLy), TOL).map(([x, z]) => [Math.round(x), Math.round(z)]);
  const rim = c.pair.startsWith('0|') ? 1 : 0;
  return [rim, ...pts.flat()];
});
const rawVerts = chains.reduce((a, c) => a + c.pts.length, 0), verts = lines.reduce((a, l) => a + (l.length - 1) / 2, 0);

// ---- labels at each region's centroid ----
const acc = Array.from({ length: NAMES.length }, () => ({ x: 0, z: 0, n: 0 }));
for (let pz = 0; pz < N; pz++) { let x = 0; for (const [rl, pv] of MAP[pz]) { if (pv) { acc[pv].x += (x + rl / 2) * rl; acc[pv].z += (pz + 0.5) * rl; acc[pv].n += rl; } x += rl; } }
const labels = NAMES.map((name, i) => (name && acc[i].n ? [name, Math.round(X0 + (acc[i].x / acc[i].n) * CELL), Math.round(Z0 + (acc[i].z / acc[i].n) * CELL)] : null)).filter(Boolean);

const lic = fs.readFileSync(path.join(SRC, 'LICENSE'), 'utf8').trim().split('\n').map((l) => ' * ' + l).join('\n');
const out = `// GENERATED by scripts/gen-galactic-regions.mjs — do not edit.
//
// The 42 galactic regions of Elite Dangerous as boundary polylines and label points, in the game's
// own coordinates (Sol at the origin, +z toward the core). Derived from the community region map
// by Ben Peddell — github.com/klightspeed/EliteDangerousRegionMap — the same 2048x2048 grid EDSM,
// Spansh and edastro draw their regions from. Simplified to ${TOL} ly; ${rawVerts.toLocaleString()} grid vertices → ${verts.toLocaleString()}.
//
/*
${lic}
 */

/** Each line: [rim, x1, z1, x2, z2, ...]. rim = 1 where one side is outside the galaxy. */
export const GALACTIC_REGION_LINES: number[][] = ${JSON.stringify(lines)};

/** [name, x, z] — where to write each region's name. */
export const GALACTIC_REGION_LABELS: [string, number, number][] = ${JSON.stringify(labels)};

export const GALACTIC_REGION_SOURCE = "Regions after Ben Peddell's community region map (MIT) — github.com/klightspeed/EliteDangerousRegionMap";
`;
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.writeFileSync(OUT, out);
  console.log(`edges ${edges.length.toLocaleString()} → chains ${chains.length.toLocaleString()} → ${verts.toLocaleString()} vertices after ${TOL} ly simplification`);
  console.log(`labels ${labels.length} · wrote ${path.relative(path.join(HERE, '..'), OUT)} (${(out.length / 1024).toFixed(0)} KB)`);
}
