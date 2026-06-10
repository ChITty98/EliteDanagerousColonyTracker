#!/usr/bin/env node
/**
 * Mass-code COLONIZATION analysis.
 *
 * Tests the hypothesis: higher mass code -> more bodies -> more
 * colonization-relevant bodies (landable, non-icy, interesting atmospheres) ->
 * higher app score. Uses the canonical scorer's own atmosphere logic so
 * "interesting" matches what the app actually rewards.
 *
 * For targeting non-Spansh systems, the only knowns at target time are the
 * mass code (from the name) and the primary star class (FSDTarget). So we
 * bucket outcomes by (code) and by (code x primary class) and report the
 * colonization-relevant averages — including the app score already stored
 * on each system.
 *
 * Usage: node tools/analyze-masscode-colonization.mjs [E:/Spansh/region-ao-master.jsonl]
 */
import fs from 'node:fs';
import { streamLines } from './lib/stream.mjs';
import { ICY_SUBTYPES, exoticAtmoPoints, isColonisableAtmosphere } from '../server/journal/scorer.js';

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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const argv = process.argv.slice(2);
const emitIdx = argv.indexOf('--emit');
const emitPath = emitIdx >= 0 ? argv[emitIdx + 1] : null;
const file = argv.find((a) => !a.startsWith('--') && a !== emitPath) || 'E:/Spansh/region-ao-master.jsonl';
const massCodeRe = /[A-Za-z]{2}-[A-Za-z]\s([a-h])\d/;

const byCode = new Map();          // code -> stats
const byCodePrim = new Map();      // "code|pc" -> stats
function rec(map, key, extra) {
  let b = map.get(key);
  if (!b) { b = { n: 0, bodies: [], landable: [], good: [], premium: [], score: [], premHit: 0, planetMass: [], ...extra }; map.set(key, b); }
  return b;
}

let scanned = 0, coded = 0;
await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  scanned++;
  const m = (sys.name || '').match(massCodeRe);
  if (!m) return;
  const code = m[1];
  coded++;
  const bodies = sys.bodies || [];
  const pc = classify(sys.mainStar || (bodies.find((b) => b.type === 'Star') || {}).subType);

  let landable = 0, good = 0, premium = 0, planetMass = 0;
  for (const b of bodies) {
    if (b.type !== 'Planet') continue;
    if (typeof b.em === 'number') planetMass += b.em;
    if (!b.landable) continue;
    landable++;
    if (!isColonisableAtmosphere(b.atmo)) continue;
    if (ICY_SUBTYPES.has(b.subType || '')) continue;
    good++;                                                  // non-icy landable w/ real atmosphere
    if (/oxygen/i.test(b.atmo) || exoticAtmoPoints(b.atmo) > 0) premium++; // the rares the scorer rewards
  }
  const score = (sys.score && typeof sys.score.total === 'number') ? sys.score.total : null;

  for (const [map, key] of [[byCode, code], [byCodePrim, code + '|' + pc]]) {
    const b = rec(map, key);
    b.n++;
    b.bodies.push(bodies.length);
    b.landable.push(landable);
    b.good.push(good);
    b.premium.push(premium);
    b.planetMass.push(planetMass);
    if (premium > 0) b.premHit++;
    if (score != null) b.score.push(score);
  }
});

console.log(`scanned ${scanned.toLocaleString()}, ${coded.toLocaleString()} with mass code\n`);

console.log('=== BY CODE: does higher code -> more bodies / interesting atmos / score? ===');
console.log('code\tN\tmeanBodies\tmeanLandable\tmeanGoodAtmo\tmeanPremium\t%premium>=1\tmeanScore\tmedScore\tmeanPlanetMass(Me)');
for (const code of [...byCode.keys()].sort()) {
  const b = byCode.get(code);
  console.log([
    code, b.n,
    mean(b.bodies).toFixed(1), mean(b.landable).toFixed(1), mean(b.good).toFixed(2), mean(b.premium).toFixed(3),
    Math.round((100 * b.premHit) / b.n) + '%',
    mean(b.score).toFixed(1), median(b.score).toFixed(0), mean(b.planetMass).toFixed(1),
  ].join('\t'));
}

console.log('\n=== BY (code x primary class), n>=200, sorted by meanScore ===');
console.log('code\tprim\tN\tmeanBodies\tmeanGoodAtmo\tmeanPremium\t%prem>=1\tmeanScore\tmedScore');
const rows = [...byCodePrim.entries()].filter(([, b]) => b.n >= 200)
  .map(([k, b]) => ({ k, b, ms: mean(b.score) }))
  .sort((x, y) => y.ms - x.ms);
for (const { k, b, ms } of rows) {
  const [code, pc] = k.split('|');
  console.log([
    code, pc, b.n,
    mean(b.bodies).toFixed(1), mean(b.good).toFixed(2), mean(b.premium).toFixed(3),
    Math.round((100 * b.premHit) / b.n) + '%',
    ms.toFixed(1), median(b.score).toFixed(0),
  ].join('\t'));
}

if (emitPath) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const codeOut = {};
  for (const code of [...byCode.keys()].sort()) {
    const b = byCode.get(code);
    codeOut[code] = { n: b.n, bodies: r2(mean(b.bodies)), landable: r2(mean(b.landable)), goodAtmo: r2(mean(b.good)), score: r2(mean(b.score)), medScore: median(b.score), planetMass: r2(mean(b.planetMass)) };
  }
  const primOut = {};
  for (const [k, b] of byCodePrim.entries()) {
    if (b.n < 100) continue;
    primOut[k] = { n: b.n, bodies: r2(mean(b.bodies)), goodAtmo: r2(mean(b.good)), premium: r2(mean(b.premium)), pInteresting: Math.round((100 * b.premHit) / b.n), score: r2(mean(b.score)), medScore: median(b.score) };
  }
  const header = `// GENERATED by tools/analyze-masscode-colonization.mjs — do not edit by hand.\n`
    + `// Source: ${file} | ${coded.toLocaleString()} systems with a parseable mass code | generated ${new Date().toISOString().slice(0, 10)}.\n`
    + `// Colonization expectation per mass code and per (mass code | primary star class).\n`
    + `// "goodAtmo" = mean count of non-icy landable bodies with a real atmosphere; "score" = mean app scoreSystem total.\n`;
  const out = header
    + `\nexport interface MassCodeStat { n: number; bodies: number; goodAtmo: number; score: number; medScore: number; }\n`
    + `\nexport const COLONIZATION_BY_CODE: Record<string, MassCodeStat & { landable: number; planetMass: number }> = ${JSON.stringify(codeOut, null, 2)};\n`
    + `\n// Keyed "code|primaryClass" (primaryClass: O B A F G K M, BD, WD, NS, BH, WR, C, other).\n`
    + `export const COLONIZATION_BY_CODE_PRIMARY: Record<string, MassCodeStat & { premium: number; pInteresting: number }> = ${JSON.stringify(primOut, null, 2)};\n`;
  fs.writeFileSync(emitPath, out);
  console.log(`\nemitted ${Object.keys(codeOut).length} code buckets + ${Object.keys(primOut).length} (code|primary) buckets -> ${emitPath}`);
}
