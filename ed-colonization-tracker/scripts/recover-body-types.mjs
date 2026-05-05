#!/usr/bin/env node
/**
 * Recovery script: restore body + stationType assignments from a backup
 * into the current colony-data.json, ONLY where current is missing them.
 * Never overwrites anything currently set. Touches no other field.
 *
 * Run with the exe closed. Writes a `.before-recovery.json` snapshot of the
 * current file alongside, in case anything goes wrong.
 *
 * Usage: node scripts/recover-body-types.mjs [<backup-path>]
 *   default backup = backups - Copy/colony-data.2026-04-15T04-20-53.json
 *   (highest body-count backup found in the archive)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CURRENT = path.join(ROOT, 'colony-data.json');
const DEFAULT_BACKUP = path.join(ROOT, 'backups - Copy', 'colony-data.2026-04-15T04-20-53.json');

const backupPath = process.argv[2] || DEFAULT_BACKUP;
if (!fs.existsSync(backupPath)) {
  console.error(`Backup not found: ${backupPath}`);
  process.exit(1);
}

const cur = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));
const bk = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

// Snapshot before mutating.
const snapPath = path.join(ROOT, `colony-data.before-recovery.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(snapPath, JSON.stringify(cur));
console.log(`Pre-recovery snapshot: ${path.basename(snapPath)}`);

let bodyRestored = 0;
let typeRestored = 0;
let overrideRestored = 0;

// 1. knownStations — restore body and refined stationType where missing
cur.knownStations = cur.knownStations || {};
for (const [mid, bs] of Object.entries(bk.knownStations || {})) {
  if (!bs) continue;
  const cs = cur.knownStations[mid];
  if (!cs) continue; // station not in current — don't fabricate, only restore fields on existing entries

  // Body — restore only if current is missing
  if (bs.body && !cs.body) {
    cs.body = bs.body;
    bodyRestored++;
  }

  // bodyType — same rule
  if (bs.bodyType && !cs.bodyType) {
    cs.bodyType = bs.bodyType;
  }

  // stationType — only restore if backup has a "refined" type (contains _,
  // i.e. an installation_id from INSTALLATION_TYPES) and current has the raw
  // journal type. Don't downgrade an already-refined type.
  if (bs.stationType && bs.stationType.includes('_')
      && (!cs.stationType || !cs.stationType.includes('_'))) {
    cs.stationType = bs.stationType;
    typeRestored++;
  }
}

// 2. stationBodyOverrides — restore missing keys (replaceonly if current absent)
cur.stationBodyOverrides = cur.stationBodyOverrides || {};
for (const [k, v] of Object.entries(bk.stationBodyOverrides || {})) {
  if (!(k in cur.stationBodyOverrides)) {
    cur.stationBodyOverrides[k] = v;
    overrideRestored++;
  }
}

// Write back atomically: temp file then rename.
const tmpPath = CURRENT + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(cur));
fs.renameSync(tmpPath, CURRENT);

console.log(`Recovered:`);
console.log(`  bodies (knownStations.body):        ${bodyRestored}`);
console.log(`  stationTypes (refined):             ${typeRestored}`);
console.log(`  stationBodyOverrides:               ${overrideRestored}`);
console.log(`Backup source: ${path.basename(backupPath)}`);
console.log(`Pre-recovery snapshot: ${path.basename(snapPath)}`);
console.log(`Done. Restart the exe — server will broadcast state_updated on the next tick and connected tabs will rehydrate.`);
