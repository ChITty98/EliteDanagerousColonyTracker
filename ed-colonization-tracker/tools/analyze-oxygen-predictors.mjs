#!/usr/bin/env node
/**
 * What predicts an OXYGEN non-icy world? (the colonization jackpot)
 *
 * Outcome (matches the app / analyze-masscode-colonization.mjs): a system has
 * >=1 body that is landable, has a colonisable atmosphere, is NOT an icy
 * subtype, and whose atmosphere contains oxygen.
 *
 * Ranks candidate predictors by correlation strength with that 0/1 outcome:
 *   numeric  (bodyCount, starCount, est. primary mass, est. total stellar mass)
 *            -> point-biserial r
 *   category (primary class, mass code) -> correlation ratio eta
 * Also shows P(oxygen) across each predictor's range (the concrete lift), and
 * re-ranks the numeric predictors on a WELL-SCANNED subset (bodyCount>=10) to
 * separate real signal from the "more recorded bodies = more chances / more
 * fully scanned" tautology.
 *
 * Mass is ZAMS-estimated from class (slim master has no solarMasses) — rough.
 * Usage: node tools/analyze-oxygen-predictors.mjs [E:/Spansh/region-ao-master.jsonl]
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
const codeRe = /[A-Za-z]{2}-[A-Za-z]\s([a-h])\d/;

const num = {};   // name -> {n,Sx,Sxx,Sx1}
const numW = {};  // same, well-scanned subset
const bins = {};  // name -> Map(bin -> {n,oxy})
const cats = {};  // name -> Map(cat -> {n,oxy})
function nacc(o, name, x, oxy) { let a = o[name]; if (!a) { a = o[name] = { n: 0, Sx: 0, Sxx: 0, Sx1: 0 }; } a.n++; a.Sx += x; a.Sxx += x * x; if (oxy) a.Sx1 += x; }
function bacc(name, bin, oxy) { let m = bins[name] || (bins[name] = new Map()); let b = m.get(bin); if (!b) m.set(bin, b = { n: 0, oxy: 0 }); b.n++; if (oxy) b.oxy++; }
function cacc(name, c, oxy) { let m = cats[name] || (cats[name] = new Map()); let b = m.get(c); if (!b) m.set(c, b = { n: 0, oxy: 0 }); b.n++; if (oxy) b.oxy++; }

const bcBin = (n) => n <= 3 ? '01-03' : n <= 6 ? '04-06' : n <= 10 ? '07-10' : n <= 15 ? '11-15' : n <= 25 ? '16-25' : '26+';
const tmBin = (m) => m < 0.1 ? '0 <0.1' : m < 0.5 ? '1 0.1-0.5' : m < 1 ? '2 0.5-1' : m < 2 ? '3 1-2' : m < 5 ? '4 2-5' : '5 5+';

let N = 0, NOXY = 0, Nw = 0, NOXYw = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  const bodies = sys.bodies || [];
  if (!bodies.length) return;
  const stars = bodies.filter((b) => b.type === 'Star');

  let oxy = false;
  for (const b of bodies) {
    if (b.type !== 'Planet' || !b.landable) continue;
    if (!isColonisableAtmosphere(b.atmo)) continue;
    if (ICY_SUBTYPES.has(b.subType || '')) continue;
    if (/oxygen/i.test(b.atmo || '')) { oxy = true; break; }
  }

  const bodyCount = bodies.length;
  const starCount = stars.length;
  const primary = stars.length ? stars.reduce((a, b) => ((b.distLs ?? 1e12) < (a.distLs ?? 1e12) ? b : a), stars[0]) : null;
  const pc = primary ? classify(sys.mainStar || primary.subType) : 'none';
  const primMass = primary ? massOf(pc) : 0;
  let totMass = 0; for (const st of stars) totMass += massOf(classify(st.subType));
  const code = (sys.name || '').match(codeRe)?.[1] || '?';

  N++; if (oxy) NOXY++;
  nacc(num, 'bodyCount', bodyCount, oxy);
  nacc(num, 'starCount', starCount, oxy);
  nacc(num, 'primMass', primMass, oxy);
  nacc(num, 'totalStellarMass', totMass, oxy);
  bacc('bodyCount', bcBin(bodyCount), oxy);
  bacc('starCount', starCount >= 4 ? '4+' : String(starCount), oxy);
  bacc('totalStellarMass', tmBin(totMass), oxy);
  cacc('primClass', pc, oxy);
  cacc('massCode', code, oxy);

  if (bodyCount >= 10) {
    Nw++; if (oxy) NOXYw++;
    nacc(numW, 'bodyCount', bodyCount, oxy);
    nacc(numW, 'starCount', starCount, oxy);
    nacc(numW, 'primMass', primMass, oxy);
    nacc(numW, 'totalStellarMass', totMass, oxy);
  }
}, );

function rpb(a, n1, n) {
  const p = n1 / n; if (p <= 0 || p >= 1) return 0;
  const mean = a.Sx / a.n; const sd = Math.sqrt(Math.max(0, a.Sxx / a.n - mean * mean)); if (!sd) return 0;
  const m1 = a.Sx1 / n1, m0 = (a.Sx - a.Sx1) / (n - n1);
  return (m1 - m0) / sd * Math.sqrt(p * (1 - p));
}
function eta(map, n, n1) {
  const p = n1 / n, denom = n * p * (1 - p); if (denom <= 0) return 0;
  let s = 0; for (const b of map.values()) { const pg = b.oxy / b.n; s += b.n * (pg - p) * (pg - p); } return Math.sqrt(s / denom);
}

console.log(`N=${N.toLocaleString()} systems with bodies | oxygen non-icy in ${NOXY.toLocaleString()} (${(100 * NOXY / N).toFixed(2)}%) base rate`);
console.log(`mass = ZAMS proxy by class (rough); oxygen = landable + colonisable atmo + non-icy + /oxygen/\n`);

console.log('=== PREDICTOR STRENGTH (ranked) ===');
const ranked = [
  ['bodyCount (numeric, point-biserial r)', Math.abs(rpb(num.bodyCount, NOXY, N))],
  ['totalStellarMass (numeric, r)', Math.abs(rpb(num.totalStellarMass, NOXY, N))],
  ['primMass (numeric, r)', Math.abs(rpb(num.primMass, NOXY, N))],
  ['starCount (numeric, r)', Math.abs(rpb(num.starCount, NOXY, N))],
  ['primClass (categorical, eta)', eta(cats.primClass, N, NOXY)],
  ['massCode (categorical, eta)', eta(cats.massCode, N, NOXY)],
].sort((a, b) => b[1] - a[1]);
for (const [name, v] of ranked) console.log(`  ${v.toFixed(3)}\t${name}`);

function printBin(name, label) {
  console.log(`\n--- P(oxygen) by ${label} ---`);
  const m = bins[name];
  for (const k of [...m.keys()].sort()) { const b = m.get(k); console.log(`  ${k}\tN=${b.n}\t${(100 * b.oxy / b.n).toFixed(2)}%`); }
}
printBin('bodyCount', 'number of bodies');
printBin('starCount', 'number of stars');
printBin('totalStellarMass', 'est. total stellar mass (Msun)');

function printCat(name, label) {
  console.log(`\n--- P(oxygen) by ${label} (n>=500) ---`);
  const m = cats[name];
  const rows = [...m.entries()].filter(([, b]) => b.n >= 500).map(([k, b]) => [k, b.n, 100 * b.oxy / b.n]).sort((a, b) => b[2] - a[2]);
  for (const [k, n, p] of rows) console.log(`  ${k}\tN=${n}\t${p.toFixed(2)}%`);
}
printCat('primClass', 'primary star class');
printCat('massCode', 'mass code');

console.log(`\n=== WELL-SCANNED subset (bodyCount>=10): re-rank numerics — what matters beyond scan depth? ===`);
console.log(`Nw=${Nw.toLocaleString()} | oxygen ${(100 * NOXYw / Nw).toFixed(2)}%`);
for (const name of ['totalStellarMass', 'primMass', 'starCount', 'bodyCount']) {
  console.log(`  ${Math.abs(rpb(numW[name], NOXYw, Nw)).toFixed(3)}\t${name}`);
}
