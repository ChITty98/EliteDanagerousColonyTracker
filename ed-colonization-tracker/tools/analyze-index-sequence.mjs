#!/usr/bin/env node
/**
 * Boxel SEQUENCE-INDEX analysis.
 *
 * Question: does the trailing system number (n2 in "... AX-J d9-52") correlate
 * with anything — is a LOWER number a bigger/smaller system? In ED's stellar
 * forge the index is the generation order within a boxel, so there may be a
 * systematic gradient (e.g. massive primaries first, brown dwarfs last).
 *
 * The slim master schema has star SUBTYPES but not solarMasses, so primary mass
 * is estimated from class via representative ZAMS values (rough) — same approach
 * as analyze-masscode-stars.mjs. We:
 *   A) bin by absolute index (overall) — class mix, est. primary mass, bodies;
 *   B) repeat WITHIN a single mass code (removes the code's mass-scale effect);
 *   C) run a confound-free WITHIN-BOXEL correlation (per-boxel Pearson r between
 *      index and primary mass / body count) so the big-boxel selection effect
 *      can't fake a trend.
 *
 * Usage: node tools/analyze-index-sequence.mjs [E:/Spansh/region-ao-master.jsonl] [code=d]
 */
import { streamLines } from './lib/stream.mjs';

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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const file = process.argv[2] || 'E:/Spansh/region-ao-master.jsonl';
const focusCode = (process.argv[3] || 'd').toLowerCase();
const re = /[A-Za-z]{2}-[A-Za-z]\s([a-h])(\d+)-(\d+)$/;

function idxBin(i) {
  if (i <= 9) return String(i).padStart(2, '0');
  if (i <= 19) return '10-19';
  if (i <= 39) return '20-39';
  if (i <= 79) return '40-79';
  return '80+';
}
function newBin() { return { n: 0, primMass: 0, bodies: 0, hot: 0, fgk: 0, m: 0, bd: 0, rem: 0 }; }
function addBin(b, pc, pm, bodies) {
  b.n++; b.primMass += pm; b.bodies += bodies;
  if (pc === 'O' || pc === 'B' || pc === 'A') b.hot++;
  else if (pc === 'F' || pc === 'G' || pc === 'K') b.fgk++;
  else if (pc === 'M') b.m++;
  else if (pc === 'BD') b.bd++;
  else if (pc === 'WD' || pc === 'NS' || pc === 'BH') b.rem++;
}

const overall = new Map();   // bin -> stats
const focus = new Map();     // bin -> stats (focusCode only)
// per-boxel accumulators for Pearson r (index vs primMass and index vs bodies)
const box = new Map();       // boxelKey -> {n, Si, Sm, Sim, Sii, Smm, Sb, Sib, Sbb}

let scanned = 0, parsed = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  scanned++;
  const nm = sys.name || '';
  const mm = nm.match(re);
  if (!mm) return;
  const code = mm[1], n1 = mm[2], index = parseInt(mm[3], 10);
  const stars = (sys.bodies || []).filter((b) => b.type === 'Star');
  if (!stars.length) return;
  parsed++;
  const primary = stars.reduce((a, b) => ((b.distLs ?? 1e12) < (a.distLs ?? 1e12) ? b : a), stars[0]);
  const pc = classify(sys.mainStar || primary.subType);
  const pm = massOf(pc);
  const bodies = (sys.bodies || []).length;
  const bin = idxBin(index);

  addBin(overall.get(bin) || overall.set(bin, newBin()).get(bin), pc, pm, bodies);
  if (code === focusCode) addBin(focus.get(bin) || focus.set(bin, newBin()).get(bin), pc, pm, bodies);

  const key = nm.slice(0, nm.length - mm[3].length - 1); // strip "-n2" -> boxel
  let a = box.get(key);
  if (!a) { a = { n: 0, Si: 0, Sm: 0, Sim: 0, Sii: 0, Sb: 0, Sib: 0 }; box.set(key, a); }
  a.n++; a.Si += index; a.Sm += pm; a.Sim += index * pm; a.Sii += index * index;
  a.Sb += bodies; a.Sib += index * bodies;
});

function printBins(map, title) {
  console.log('\n=== ' + title + ' ===');
  console.log('idx\tN\testPrimMass\tmeanBodies\t%hotOBA\t%FGK\t%M\t%BD\t%remnant');
  const order = (k) => (k.includes('-') || k.includes('+') ? 1000 + parseInt(k) : parseInt(k));
  for (const bin of [...map.keys()].sort((x, y) => order(x) - order(y))) {
    const b = map.get(bin);
    const pct = (x) => Math.round((100 * x) / b.n) + '%';
    console.log([
      bin, b.n, (b.primMass / b.n).toFixed(2), (b.bodies / b.n).toFixed(1),
      pct(b.hot), pct(b.fgk), pct(b.m), pct(b.bd), pct(b.rem),
    ].join('\t'));
  }
}

console.log(`scanned ${scanned.toLocaleString()}, ${parsed.toLocaleString()} with index + >=1 star`);
console.log(`est. primary mass = ZAMS proxy by class (O30 B8 A1.7 F1.2 G0.95 K0.6 M0.25 BD0.05 Msun) — rough`);
printBins(overall, 'A. OVERALL by index (n2) — all mass codes');
printBins(focus, `B. WITHIN mass code "${focusCode}" by index (controls for the code's mass scale)`);

// C. within-boxel Pearson r (confound-free)
let nbox = 0;
let sumRm = 0, negRm = 0, sumRb = 0, negRb = 0, valid = 0;
for (const a of box.values()) {
  if (a.n < 8) continue;
  nbox++;
  const varI = a.n * a.Sii - a.Si * a.Si;
  if (varI <= 0) continue;
  // r(index, primMass)
  const covIm = a.n * a.Sim - a.Si * a.Sm;
  // we only need the SIGN reliably; normalize by sqrt(varI) and spread of m
  // use covariance sign + a coarse r using varI for index and approximate via covIm
  const rm = covIm / Math.sqrt(varI); // proportional to r (mass spread folded in); sign is exact
  const covIb = a.n * a.Sib - a.Si * a.Sb;
  const rb = covIb / Math.sqrt(varI);
  valid++;
  sumRm += Math.sign(covIm); if (covIm < 0) negRm++;
  sumRb += Math.sign(covIb); if (covIb < 0) negRb++;
}
console.log('\n=== C. WITHIN-BOXEL trend (boxels with >=8 systems) — confound-free ===');
console.log(`boxels tested: ${nbox.toLocaleString()}`);
console.log(`index vs primary mass: ${Math.round((100 * negRm) / Math.max(1, valid))}% of boxels have mass FALLING as index rises (cov<0); net sign sum ${sumRm}`);
console.log(`index vs body count : ${Math.round((100 * negRb) / Math.max(1, valid))}% of boxels have bodies FALLING as index rises (cov<0); net sign sum ${sumRb}`);
console.log(`(>50% falling = lower number tends BIGGER; <50% = lower number tends smaller)`);
