#!/usr/bin/env node
/**
 * General "what predicts a landable <ATMO> world?" analysis — predictor strength
 * + Goldilocks distance band, in one stream pass. Mirrors the oxygen scripts so
 * results are directly comparable across atmosphere types.
 *
 * Hit = a body that is landable, has a colonisable atmosphere, is NOT an icy
 * subtype, and whose atmosphere string matches the keyword regex.
 *
 * Usage: node tools/analyze-atmo-predictors.mjs [file] [atmoKeyword=water]
 *   e.g. node tools/analyze-atmo-predictors.mjs E:/Spansh/region-ao-master.jsonl water
 */
import { streamLines } from './lib/stream.mjs';
import { ICY_SUBTYPES, isColonisableAtmosphere } from '../server/journal/scorer.js';

const MASS = { O: 30, B: 8, A: 1.7, F: 1.2, G: 0.95, K: 0.6, M: 0.25, BD: 0.05, WD: 0.6, NS: 1.4, BH: 8, WR: 15, C: 1.5, other: 1.0 };
function classify(subType) {
  const s = (subType || '').toLowerCase();
  if (/brown dwarf/.test(s)) return 'BD';
  if (/white dwarf/.test(s)) return 'WD';
  if (/neutron/.test(s)) return 'NS';
  if (/black hole/.test(s)) return 'BH';
  if (/wolf.?rayet/.test(s)) return 'WR';
  if (/carbon/.test(s)) return 'C';
  const m = (subType || '').match(/^([OBAFGKM])[\s(]/);
  return m ? m[1] : 'other';
}
const massOf = (cls) => MASS[cls] ?? MASS.other;

const file = process.argv[2] || 'E:/Spansh/region-ao-master.jsonl';
const keyword = (process.argv[3] || 'water').toLowerCase();
const ATMO = new RegExp(keyword, 'i');
const codeRe = /[A-Za-z]{2}-[A-Za-z]\s([a-h])\d/;
const isHit = (b) => b.type === 'Planet' && b.landable && isColonisableAtmosphere(b.atmo)
  && !ICY_SUBTYPES.has(b.subType || '') && ATMO.test(b.atmo || '');

const EDGES = [0, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, Infinity];
function distBin(d) { for (let i = EDGES.length - 2; i >= 0; i--) if (d >= EDGES[i]) return i; return 0; }
const binLabel = (i) => EDGES[i] >= 1000 ? (EDGES[i] / 1000) + 'k' : String(EDGES[i]);
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * a.length))]; };

const num = {}; function nacc(name, x, hit) { let a = num[name] || (num[name] = { n: 0, Sx: 0, Sxx: 0, Sx1: 0 }); a.n++; a.Sx += x; a.Sxx += x * x; if (hit) a.Sx1 += x; }
const cats = {}; function cacc(name, c, hit) { let m = cats[name] || (cats[name] = new Map()); let b = m.get(c) || m.set(c, { n: 0, hit: 0 }).get(c); b.n++; if (hit) b.hit++; }
const band = new Map();           // class -> Map(bin -> {planets, hit})
const hitDistByClass = new Map(); // class -> [distLs] single-star

let N = 0, HIT = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  const bodies = sys.bodies || [];
  if (!bodies.length) return;
  const stars = bodies.filter((b) => b.type === 'Star');
  const primary = stars.length ? stars.reduce((a, b) => ((b.distLs ?? 1e12) < (a.distLs ?? 1e12) ? b : a), stars[0]) : null;
  const pc = primary ? classify(sys.mainStar || primary.subType) : 'none';
  const single = stars.length === 1;
  let hit = false; for (const b of bodies) if (isHit(b)) { hit = true; break; }

  N++; if (hit) HIT++;
  let tot = 0; for (const st of stars) tot += massOf(classify(st.subType));
  nacc('bodyCount', bodies.length, hit);
  nacc('starCount', stars.length, hit);
  nacc('primMass', primary ? massOf(pc) : 0, hit);
  nacc('totalStellarMass', tot, hit);
  cacc('primClass', pc, hit);
  cacc('massCode', (sys.name || '').match(codeRe)?.[1] || '?', hit);

  let cm = band.get(pc) || band.set(pc, new Map()).get(pc);
  for (const b of bodies) {
    if (b.type !== 'Planet' || typeof b.distLs !== 'number' || b.distLs <= 0) continue;
    const bi = distBin(b.distLs);
    let cell = cm.get(bi) || cm.set(bi, { planets: 0, hit: 0 }).get(bi);
    cell.planets++;
    if (isHit(b)) { cell.hit++; if (single) { let a = hitDistByClass.get(pc) || hitDistByClass.set(pc, []).get(pc); a.push(b.distLs); } }
  }
});

function rpb(a, n1, n) { const p = n1 / n; if (p <= 0 || p >= 1) return 0; const mu = a.Sx / a.n, sd = Math.sqrt(Math.max(0, a.Sxx / a.n - mu * mu)); if (!sd) return 0; return ((a.Sx1 / n1) - ((a.Sx - a.Sx1) / (n - n1))) / sd * Math.sqrt(p * (1 - p)); }
function eta(m, n, n1) { const p = n1 / n, d = n * p * (1 - p); if (d <= 0) return 0; let s = 0; for (const b of m.values()) { const pg = b.hit / b.n; s += b.n * (pg - p) * (pg - p); } return Math.sqrt(s / d); }

console.log(`ATMO="${keyword}" | N=${N.toLocaleString()} systems | hit in ${HIT.toLocaleString()} (${(100 * HIT / N).toFixed(2)}%)\n`);
console.log('=== predictor strength (|point-biserial r| / eta) ===');
[['bodyCount', Math.abs(rpb(num.bodyCount, HIT, N))], ['totalStellarMass', Math.abs(rpb(num.totalStellarMass, HIT, N))],
 ['primMass', Math.abs(rpb(num.primMass, HIT, N))], ['starCount', Math.abs(rpb(num.starCount, HIT, N))],
 ['primClass (eta)', eta(cats.primClass, N, HIT)], ['massCode (eta)', eta(cats.massCode, N, HIT)]]
  .sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toFixed(3)}\t${k}`));

console.log('\n=== P(hit) by primary class (n>=500) ===');
[...cats.primClass.entries()].filter(([, b]) => b.n >= 500).map(([k, b]) => [k, b.n, 100 * b.hit / b.n])
  .sort((a, b) => b[2] - a[2]).forEach(([k, n, p]) => console.log(`  ${k}\tN=${n}\t${p.toFixed(2)}%`));

console.log('\n=== Goldilocks: median hit distance by class (single-star, clean) ===');
console.log('class\tN_hit\tmedian Ls\tp25\tp75');
for (const pc of ['O', 'B', 'A', 'F', 'G', 'K', 'M']) { const a = hitDistByClass.get(pc); if (a && a.length) console.log(`${pc}\t${a.length}\t${Math.round(q(a, 0.5))}\t${Math.round(q(a, 0.25))}\t${Math.round(q(a, 0.75))}`); }

console.log('\n=== band shape: P(hit|planet) per 100k by distance, M/K/G/F ===');
for (const pc of ['M', 'K', 'G', 'F']) {
  const cm = band.get(pc); if (!cm) continue;
  const rows = [...cm.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => c.planets >= 5000);
  const peak = rows.reduce((m, [bi, c]) => (c.hit / c.planets > (m ? m.r : -1) ? { bi, r: c.hit / c.planets } : m), null);
  console.log(`\n  ${pc}: peak ${peak ? binLabel(peak.bi) + '-' + binLabel(peak.bi + 1) + ' Ls (' + (1e5 * peak.r).toFixed(0) + '/100k)' : 'n/a'}`);
  for (const [bi, c] of rows) { const r = 1e5 * c.hit / c.planets; console.log(`    ${(binLabel(bi) + '-' + binLabel(bi + 1)).padEnd(12)} planets=${String(c.planets).padStart(8)} hit=${String(c.hit).padStart(5)} ${r.toFixed(1)}/100k ${'#'.repeat(Math.min(40, Math.round(r / 5)))}`); }
}
