#!/usr/bin/env node
/**
 * Re-score region JSONL files in place to apply the exotic / non-icy-oxygen
 * atmosphere bonus WITHOUT re-running the 25-min galaxy extraction.
 *
 * The bonus only needs fields already in the slim body schema (subType, atmo,
 * distLs), so we recompute it per system and adjust score.total:
 *     new_total = old_total - old_oxygenPoints + new_oxygenPoints + new_exoticPoints
 *
 * Approximation vs the canonical scorer: distance decay is applied by distLs
 * (distance-from-arrival) for every body, since the slim schema doesn't carry
 * isPrimaryStar. The canonical server/journal/scorer.js decays primary-star
 * bodies only — a re-extraction will produce the exact values. For ranking
 * purposes the difference is negligible (it only affects far secondary-star
 * atmospheric bodies, which are rare).
 *
 * Usage:
 *   node tools/rescore-regions.mjs E:/Spansh/region-ao-master.jsonl [more...]
 */

import fs from 'node:fs';
import { once } from 'node:events';

const ICY = /icy body|rocky ice/i;
function decay(d) {
  if (d < 4000) return 1.0;
  if (d < 10000) return 0.7;
  if (d < 20000) return 0.4;
  return 0.15;
}
function exoticBase(atmo) {
  const a = (atmo || '').toLowerCase();
  if (a.includes('silicate vapour')) return 25;
  if (a.includes('neon')) return a.includes('neon-rich') ? 0 : 25;
  if (a.includes('argon-rich')) return 12;
  if (a.includes('argon')) return 4;
  if (a.includes('methane-rich')) return 8;
  if (a.includes('methane')) return 4;
  if (a.includes('water-rich')) return 0;
  if (a.includes('water')) return 8;
  return 0;
}

function rescoreSystem(sys) {
  const sc = sys.score;
  if (!sc) return false;
  let oxy = 0, oxyN = 0, exo = 0, exoN = 0;
  for (const b of sys.bodies || []) {
    if (!b.landable || !b.atmo || /no atmosphere|^none$/i.test(b.atmo)) continue;
    if (ICY.test(b.subType || '')) continue;
    if (b.em != null && b.em >= 2.5) continue;
    const dk = decay(b.distLs || 0);
    if (/oxygen/i.test(b.atmo)) { oxy += Math.round(15 * dk); oxyN++; }
    else { const base = exoticBase(b.atmo); if (base > 0) { exo += Math.round(base * dk); exoN++; } }
  }
  oxy = Math.min(oxy, 45);
  exo = Math.min(exo, 50);
  const oldOxy = sc.oxygenPoints || 0;
  sc.total = (sc.total || 0) - oldOxy + oxy + exo;
  sc.oxygenPoints = oxy;
  sc.oxygenCount = oxyN;
  sc.exoticPoints = exo;
  sc.exoticCount = exoN;
  return true;
}

async function rescoreFile(path) {
  const tmp = path + '.tmp';
  const out = fs.createWriteStream(tmp);
  let read = 0, scored = 0, tail = '';
  async function line(L) {
    if (!L) return;
    read++;
    let sys; try { sys = JSON.parse(L); } catch { if (!out.write(L + '\n')) await once(out, 'drain'); return; }
    if (rescoreSystem(sys)) scored++;
    if (!out.write(JSON.stringify(sys) + '\n')) await once(out, 'drain');
  }
  for await (const chunk of fs.createReadStream(path, { encoding: 'utf8' })) {
    const text = tail + chunk;
    let s = 0, nl;
    while ((nl = text.indexOf('\n', s)) !== -1) { await line(text.slice(s, nl)); s = nl + 1; }
    tail = text.slice(s);
  }
  if (tail) await line(tail);
  await new Promise((res) => out.end(res));
  fs.renameSync(tmp, path);
  console.error(`  ${path}: re-scored ${scored.toLocaleString()} / ${read.toLocaleString()}`);
}

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) { console.error('usage: node tools/rescore-regions.mjs FILE.jsonl [...]'); process.exit(1); }
for (const f of files) { if (!fs.existsSync(f)) { console.error('not found:', f); process.exit(1); } }
console.error('Re-scoring (exotic + non-icy oxygen atmosphere bonus):');
for (const f of files) await rescoreFile(f);
console.error('Done.');
