#!/usr/bin/env node
/**
 * Do OXYGEN non-icy landables sit in the Goldilocks zone their star predicts?
 *
 * Orvidius's HZ chart plots habitable-zone DISTANCE (light-seconds) per star
 * class — close for M dwarfs, far for hot stars. We don't have surface temp in
 * the slim master, but we have distLs (Ls from the arrival star), the same axis.
 * So for each oxygen world we record its distLs and its primary star class, and
 * ask: does the band shift outward for hotter primaries (the HZ signature)? And
 * is "distance, given the class" a sharper oxygen signal than class alone?
 *
 * distLs = distance from the ARRIVAL (main) star. For single-star systems that's
 * the body's orbital distance; for multi-star it can reflect a companion's
 * separation, so the per-class medians below are computed on SINGLE-star systems
 * (clean), with an all-systems P(oxygen)-by-distance band for shape.
 *
 * Usage: node tools/analyze-oxygen-goldilocks.mjs [E:/Spansh/region-ao-master.jsonl]
 */
import { streamLines } from './lib/stream.mjs';
import { ICY_SUBTYPES, isColonisableAtmosphere } from '../server/journal/scorer.js';

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
const isOxy = (b) => b.type === 'Planet' && b.landable && isColonisableAtmosphere(b.atmo)
  && !ICY_SUBTYPES.has(b.subType || '') && /oxygen/i.test(b.atmo || '');

const EDGES = [0, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, Infinity];
function distBin(d) { for (let i = EDGES.length - 2; i >= 0; i--) if (d >= EDGES[i]) return i; return 0; }
const binLabel = (i) => EDGES[i] >= 1000 ? (EDGES[i] / 1000) + 'k' : String(EDGES[i]);
const q = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

const file = process.argv[2] || 'E:/Spansh/region-ao-master.jsonl';

const oxyDistByClass = new Map();   // class -> [distLs...] (single-star systems)
const band = new Map();             // class -> Map(binIdx -> {planets, oxy})  (all systems)
const allOxyDist = [], allAtmoDist = [];

let N = 0, oxyN = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  const bodies = sys.bodies || [];
  if (!bodies.length) return;
  const stars = bodies.filter((b) => b.type === 'Star');
  if (!stars.length) return;
  const primary = stars.reduce((a, b) => ((b.distLs ?? 1e12) < (a.distLs ?? 1e12) ? b : a), stars[0]);
  const pc = classify(sys.mainStar || primary.subType);
  const singleStar = stars.length === 1;
  N++;

  let cm = band.get(pc); if (!cm) band.set(pc, cm = new Map());
  for (const b of bodies) {
    if (b.type !== 'Planet') continue;
    const d = b.distLs;
    if (typeof d !== 'number' || d <= 0) continue;
    const bi = distBin(d);
    let cell = cm.get(bi); if (!cell) cm.set(bi, cell = { planets: 0, oxy: 0 });
    cell.planets++;
    const landAtmo = b.landable && isColonisableAtmosphere(b.atmo) && !ICY_SUBTYPES.has(b.subType || '');
    if (landAtmo) allAtmoDist.push(d);
    if (isOxy(b)) {
      cell.oxy++; oxyN++; allOxyDist.push(d);
      if (singleStar) { let a = oxyDistByClass.get(pc) || oxyDistByClass.set(pc, []).get(pc); a.push(d); }
    }
  }
});

console.log(`N=${N.toLocaleString()} systems with stars+bodies | ${oxyN} oxygen non-icy landables found\n`);

console.log('=== A. Where oxygen worlds actually sit, by primary class (SINGLE-star systems, clean distance) ===');
console.log('class\tN_oxy\tmedian Ls\tp25\tp75\t(Orvidius ~HZ for reference)');
const HZ = { O: '>100k', B: '10k-100k', A: '1k-25k', F: '250-2.5k', G: '500-5k', K: '250-2.5k', M: '20-250', BD: 'none' };
for (const pc of ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'BD', 'WD', 'NS', 'other']) {
  const a = oxyDistByClass.get(pc); if (!a || !a.length) continue;
  console.log(`${pc}\t${a.length}\t${Math.round(q(a, 0.5))}\t${Math.round(q(a, 0.25))}\t${Math.round(q(a, 0.75))}\t${HZ[pc] || '?'}`);
}
console.log(`\noverall oxygen median distLs: ${Math.round(q(allOxyDist, 0.5))} Ls (p25 ${Math.round(q(allOxyDist, 0.25))}, p75 ${Math.round(q(allOxyDist, 0.75))})`);
console.log(`all non-icy landable-atmo median distLs: ${Math.round(q(allAtmoDist, 0.5))} Ls (p25 ${Math.round(q(allAtmoDist, 0.25))}, p75 ${Math.round(q(allAtmoDist, 0.75))})`);

console.log('\n=== B. P(oxygen | planet) by distance band, within the high-N classes (per 100k planets) ===');
for (const pc of ['M', 'K', 'G', 'F', 'A']) {
  const cm = band.get(pc); if (!cm) continue;
  const rows = [...cm.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => c.planets >= 2000);
  const peak = rows.reduce((m, [bi, c]) => (c.oxy / c.planets > (m ? m.r : -1) ? { bi, r: c.oxy / c.planets } : m), null);
  console.log(`\n  ${pc}: peak band ${peak ? binLabel(peak.bi) + '-' + binLabel(peak.bi + 1) + ' Ls (' + (1e5 * peak.r).toFixed(1) + ' per 100k)' : 'n/a'}`);
  for (const [bi, c] of rows) {
    const rate = 1e5 * c.oxy / c.planets;
    const bar = '#'.repeat(Math.min(40, Math.round(rate)));
    console.log(`    ${(binLabel(bi) + '-' + binLabel(bi + 1)).padEnd(12)} planets=${String(c.planets).padStart(7)}  oxy=${String(c.oxy).padStart(3)}  ${rate.toFixed(1)}/100k ${bar}`);
  }
}
