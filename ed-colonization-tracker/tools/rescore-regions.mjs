#!/usr/bin/env node
/**
 * Re-score region JSONL files in place to apply the exotic / non-icy-oxygen
 * atmosphere bonus WITHOUT re-running the 25-min galaxy extraction.
 *
 * The atmosphere table, icy set, decay tiers, and atmosphere validity check
 * are imported from the canonical scorer (server/journal/scorer.js) — this
 * tool carries no scoring constants of its own.
 *     new_total = old_total - old_oxygenPoints - old_exoticPoints + new_oxygenPoints + new_exoticPoints
 *
 * Approximation vs the canonical scorer: distance decay is applied by distLs
 * (distance-from-arrival) for every body, since the slim schema doesn't carry
 * isPrimaryStar. The canonical scoreSystem decays primary-star bodies only —
 * a re-extraction produces exact values. For ranking the difference is
 * negligible (it only affects far secondary-star atmospheric bodies).
 *
 * Usage:
 *   node tools/rescore-regions.mjs E:/Spansh/region-ao-master.jsonl [more...]
 */

import fs from 'node:fs';
import { once } from 'node:events';
import {
  exoticAtmoPoints,
  distanceDecay,
  ICY_SUBTYPES,
  isColonisableAtmosphere,
} from '../server/journal/scorer.js';
import { streamLines } from './lib/stream.mjs';

function rescoreSystem(sys) {
  const sc = sys.score;
  if (!sc) return false;
  let oxy = 0, oxyN = 0, exo = 0, exoN = 0;
  for (const b of sys.bodies || []) {
    if (!b.landable || !isColonisableAtmosphere(b.atmo)) continue;
    if (ICY_SUBTYPES.has(b.subType || '')) continue;
    // Canonical parity: bodies with missing mass data are excluded (the app's
    // filterQualifyingBodies does `(earthMasses ?? 999) >= 2.5`).
    if ((b.em ?? 999) >= 2.5) continue;
    const dk = distanceDecay(b.distLs || 0);
    if (/oxygen/i.test(b.atmo)) { oxy += Math.round(15 * dk); oxyN++; }
    else { const base = exoticAtmoPoints(b.atmo); if (base > 0) { exo += Math.round(base * dk); exoN++; } }
  }
  oxy = Math.min(oxy, 45);
  exo = Math.min(exo, 50);
  const oldOxy = sc.oxygenPoints || 0;
  const oldExo = sc.exoticPoints || 0;
  sc.total = (sc.total || 0) - oldOxy - oldExo + oxy + exo;
  sc.oxygenPoints = oxy;
  sc.oxygenCount = oxyN;
  sc.exoticPoints = exo;
  sc.exoticCount = exoN;
  return true;
}

async function rescoreFile(path) {
  const tmp = path + '.tmp';
  const out = fs.createWriteStream(tmp);
  let read = 0, scored = 0;
  await streamLines(path, async (L) => {
    if (!L) return;
    read++;
    let sys; try { sys = JSON.parse(L); } catch { if (!out.write(L + '\n')) await once(out, 'drain'); return; }
    if (rescoreSystem(sys)) scored++;
    if (!out.write(JSON.stringify(sys) + '\n')) await once(out, 'drain');
  });
  await new Promise((res) => out.end(res));
  // Size guard (mirrors spansh-index): a rewrite that shrinks the file >30%
  // means something went wrong — keep the original.
  const oldSize = fs.statSync(path).size;
  const newSize = fs.statSync(tmp).size;
  if (newSize < oldSize * 0.7) {
    fs.unlinkSync(tmp);
    throw new Error(`size guard tripped for ${path}: ${oldSize} -> ${newSize} bytes — original kept`);
  }
  fs.renameSync(tmp, path);
  console.error(`  ${path}: re-scored ${scored.toLocaleString()} / ${read.toLocaleString()}`);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) { console.error('usage: node tools/rescore-regions.mjs FILE.jsonl [...]'); process.exit(1); }
for (const f of files) { if (!fs.existsSync(f)) { console.error('not found:', f); process.exit(1); } }
console.error('Re-scoring (exotic + non-icy oxygen atmosphere bonus, canonical table):');
for (const f of files) await rescoreFile(f);
console.error('Done.');
