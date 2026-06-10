#!/usr/bin/env node
/**
 * Mass-code companion-star analysis.
 *
 * Goal: can (mass code from the name) + (primary star class, which FSDTarget
 * gives you even for never-visited systems) predict the REST of the system —
 * specifically whether there are good (non-brown-dwarf) companion stars, and
 * roughly how much non-primary stellar mass? This is for targeting systems
 * that AREN'T in Spansh; Spansh here is the training set, not a lookup.
 *
 * For each (mass code x primary class) bucket it reports:
 *   N, P(>=2 stars), P(>=1 good companion), mean companion count,
 *   median non-primary stellar mass, and the companion type mix.
 * Also a code->median-total-stellar-mass table to sanity-check the premise
 * (does the code actually track total mass?).
 *
 * Mass estimate caveat: the slim region schema has star SUBTYPES but not
 * solarMasses, so masses are mapped from class via representative ZAMS values
 * (rough). Planets are ignored (a big planet is ~0.0002 Msun — negligible vs
 * stars). Selection bias caveat: Spansh systems are explorer-scanned, which
 * may over-represent interesting companions vs the unexplored systems you target.
 *
 * Usage: node tools/analyze-masscode-stars.mjs [E:/Spansh/region-ao-master.jsonl]
 */
import { streamLines } from './lib/stream.mjs';

// Representative ZAMS masses (Msun) by class — rough, for estimation only.
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
  if (m) return m[1];
  return 'other';
}
const isGood = (cls) => cls !== 'BD' && cls !== 'other'; // real fusion star or remnant
const massOf = (cls) => MASS[cls] ?? MASS.other;
const median = (arr) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

const file = process.argv[2] || 'E:/Spansh/region-ao-master.jsonl';
const massCodeRe = /[A-Za-z]{2}-[A-Za-z]\s([a-h])\d/;

const buckets = new Map();      // "code|pc" -> stats
const codeTotals = new Map();   // code -> [totalStellarMass...]
function bk(code, pc) {
  const k = code + '|' + pc;
  let b = buckets.get(k);
  if (!b) { b = { code, pc, n: 0, multi: 0, good: 0, comp: 0, compMass: [], types: {} }; buckets.set(k, b); }
  return b;
}

let scanned = 0, withCode = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  scanned++;
  const m = (sys.name || '').match(massCodeRe);
  if (!m) return;
  const code = m[1];
  const stars = (sys.bodies || []).filter((b) => b.type === 'Star');
  if (stars.length === 0) return;
  withCode++;

  const primary = stars.reduce((a, b) => ((b.distLs ?? 1e12) < (a.distLs ?? 1e12) ? b : a), stars[0]);
  const pc = classify(sys.mainStar || primary.subType);
  const comps = stars.filter((st) => st !== primary);

  let totalMass = 0;
  for (const st of stars) totalMass += massOf(classify(st.subType));
  (codeTotals.get(code) || codeTotals.set(code, []).get(code)).push(totalMass);

  const b = bk(code, pc);
  b.n++;
  if (stars.length >= 2) b.multi++;
  let cm = 0, good = false;
  for (const c of comps) {
    const cc = classify(c.subType);
    b.types[cc] = (b.types[cc] || 0) + 1;
    cm += massOf(cc);
    if (isGood(cc)) good = true;
  }
  if (good) b.good++;
  b.comp += comps.length;
  b.compMass.push(cm);
});

console.log(`scanned ${scanned.toLocaleString()} systems, ${withCode.toLocaleString()} with a parseable mass code + >=1 star\n`);

console.log('=== code -> median TOTAL stellar mass (premise check: does code track mass?) ===');
console.log('code\tN\tmedMass(Msun)');
for (const code of [...codeTotals.keys()].sort()) {
  const arr = codeTotals.get(code);
  console.log(`${code}\t${arr.length}\t${median(arr).toFixed(2)}`);
}

console.log('\n=== (code x primary class): companion profile ===');
console.log('code\tprim\tN\t%multi\t%goodComp\tavgComp\tmedNonPrimMass\ttopCompanions');
const rows = [...buckets.values()].filter((b) => b.n >= 200).sort((a, b) => a.code.localeCompare(b.code) || b.n - a.n);
for (const b of rows) {
  const top = Object.entries(b.types).sort((x, y) => y[1] - x[1]).slice(0, 4)
    .map(([t, c]) => `${t}:${Math.round((100 * c) / Math.max(1, b.comp))}%`).join(' ');
  console.log([
    b.code, b.pc, b.n,
    Math.round((100 * b.multi) / b.n) + '%',
    Math.round((100 * b.good) / b.n) + '%',
    (b.comp / b.n).toFixed(2),
    median(b.compMass).toFixed(2),
    top || '-',
  ].join('\t'));
}
