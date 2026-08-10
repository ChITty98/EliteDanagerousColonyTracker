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
import { patchScoreV2 } from './lib/rescoreV2.mjs';
import { streamLines } from './lib/stream.mjs';

function rescoreSystem(sys) {
  // v2 (2026-08-05): full formula repatch via the shared lib - per-class atmosphere
  // ladder, diversity bonus, oxygen/exotic recompute, and epic points derived from
  // stored reasons re-validated against the CURRENT bars. See tools/lib/rescoreV2.mjs.
  return patchScoreV2(sys);
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
console.error('Re-scoring to formula v2 (per-class ladder + diversity + validated epic points):');
for (const f of files) await rescoreFile(f);
console.error('Done.');
