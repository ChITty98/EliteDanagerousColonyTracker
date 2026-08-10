#!/usr/bin/env node
/**
 * Reprice ALL scouted systems in colony-data.json to formula v2 — offline, exe CLOSED,
 * zero network. ("can the systems be rescored in the background? I can't imagine
 * rescoring all of them via the UI.")
 *
 * Body-data priority per entry (best data wins, matching the app):
 *   1. cachedBodies (full dump-shape bodies stored on the entry)      → exact scoreSystem v2
 *   2. journalExplorationCache scanned bodies (via the journal shim)  → exact scoreSystem v2
 *   3. bodies found in a local region .jsonl (slim schema)            → patchScoreV2 approx
 *      (epic derived from stored reasons re-validated against current bars)
 *   4. nothing on disk → score left at v1, counted honestly, listed at the end
 *
 * Usage:
 *   node tools/rescore-scouted.mjs [colonyData] [regionFile ...]
 * Defaults: ./colony-data.json + G:/Spansh/region-colonia-500-fresh.jsonl +
 *           E:/Spansh/region-ao-master.jsonl
 * A timestamped backup of colony-data.json is written to backups/ first.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { scoreSystem, SCORE_FORMULA_VERSION } from '../server/journal/scorer.js';
import { journalBodiesToSpanshFormat } from '../server/journal/overlay.js';
import { patchScoreV2 } from './lib/rescoreV2.mjs';

const dataFile = process.argv[2] || 'colony-data.json';
const regionFiles = process.argv.slice(3);
if (!regionFiles.length) {
  regionFiles.push('G:/Spansh/region-colonia-500-fresh.jsonl', 'E:/Spansh/region-ao-master.jsonl');
}

const raw = fs.readFileSync(dataFile, 'utf8');
const state = JSON.parse(raw);
const scouted = state.scoutedSystems || {};
const explo = state.journalExplorationCache || {};

// Backup before touching anything.
const backupDir = path.join(path.dirname(path.resolve(dataFile)), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `colony-data.pre-v2.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(backup, raw);
console.log('backup:', backup);

const entries = Object.entries(scouted).filter(([, v]) => v && v.name);
console.log('scouted entries:', entries.length, '| region files:', regionFiles.join(', '));

let exactCached = 0, exactJournal = 0, approxRegion = 0;
const done = new Set();

// Pass 1: exact rescores from full bodies already on hand.
for (const [id64, v] of entries) {
  if (Array.isArray(v.cachedBodies) && v.cachedBodies.length > 0) {
    v.score = scoreSystem(v.cachedBodies);
    v.scoreVersion = SCORE_FORMULA_VERSION;
    done.add(id64);
    exactCached++;
    continue;
  }
  const cache = explo[id64];
  if (cache && Array.isArray(cache.scannedBodies) && cache.scannedBodies.length > 0) {
    try {
      const bodies = journalBodiesToSpanshFormat(cache.scannedBodies, cache.systemName || v.name);
      v.score = scoreSystem(bodies);
      v.scoreVersion = SCORE_FORMULA_VERSION;
      done.add(id64);
      exactJournal++;
    } catch { /* falls through to region pass */ }
  }
}

// Pass 2: region-file streaming for the rest (slim-schema patch).
const wantByName = new Map();
for (const [id64, v] of entries) {
  if (!done.has(id64)) wantByName.set(v.name.toLowerCase(), { id64, v });
}
for (const rf of regionFiles) {
  if (!wantByName.size) break;
  if (!fs.existsSync(rf)) { console.log('region file missing, skipping:', rf); continue; }
  console.log('streaming', rf, '— looking for', wantByName.size, 'systems…');
  const rl = readline.createInterface({ input: fs.createReadStream(rf) });
  // Cheap prefilter: the slim schema writes the SYSTEM name as the first "name" field,
  // so regex it out and only JSON.parse lines whose name is actually wanted.
  const nameRe = /"name":"((?:[^"\\]|\\.)*)"/;
  for await (const line of rl) {
    if (!line || !wantByName.size) continue;
    const m = nameRe.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const hit = wantByName.get(key);
    if (!hit) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const sys = { score: hit.v.score, bodies: j.bodies || [] };
    if (patchScoreV2(sys)) {
      hit.v.score = sys.score;
      hit.v.scoreVersion = SCORE_FORMULA_VERSION;
      done.add(hit.id64);
      approxRegion++;
    }
    wantByName.delete(key);
  }
  rl.close();
}

const untouched = entries.length - done.size;
fs.writeFileSync(dataFile, JSON.stringify(state));
console.log('');
console.log('=== rescore-scouted v2 complete ===');
console.log('exact (cachedBodies):   ', exactCached);
console.log('exact (journal bodies): ', exactJournal);
console.log('approx (region slim):   ', approxRegion);
console.log('left at v1 (no data):   ', untouched);
if (untouched > 0 && untouched <= 40) {
  for (const [id64, v] of entries) if (!done.has(id64)) console.log('   v1:', v.name);
}
