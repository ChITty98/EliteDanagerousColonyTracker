#!/usr/bin/env node
/**
 * Project recovery: restore lost projects from the 2026-05-13T05-54-01 backup.
 *
 * Disaster: Sync All ran with a stale `allProjects` closure (the React state
 * variable captured at button-click time). Every depot in the journal failed
 * the `allProjects.find(p => p.marketId === depot.marketId)` check, triggering
 * `addProject` with a fresh UUID for each. The 29 backup projects got either
 * duplicated (with new UUIDs, lost completed status) or removed entirely
 * (the ones whose marketIds the journal didn't replay).
 *
 * Strategy:
 *   1. Use backup as canonical (29 projects with proper UUIDs, completed
 *      status, completedAt, completedStationName preserved).
 *   2. For each current project: if its marketId is in the backup, DROP it
 *      (the backup version wins).
 *   3. For each current project with a marketId NOT in backup, KEEP it
 *      (these are genuinely new since the backup).
 *
 * Final: 29 backup + N genuinely new = recovered projects array.
 *
 * Pre-recovery snapshot saved alongside.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CURRENT = path.join(ROOT, 'colony-data.json');
const BACKUP = path.join(ROOT, 'backups', 'colony-data.2026-05-13T05-54-01.json');

if (!fs.existsSync(BACKUP)) {
  console.error(`Backup not found: ${BACKUP}`);
  process.exit(1);
}

const cur = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));
const bk = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));

const snapPath = path.join(ROOT, `colony-data.before-project-recovery.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(snapPath, JSON.stringify(cur));
console.log(`Pre-recovery snapshot: ${path.basename(snapPath)}`);

const backupProjects = bk.projects || [];
const currentProjects = cur.projects || [];

const backupMids = new Set(backupProjects.map((p) => p.marketId));

// Keep all backup projects (they're canonical).
const recovered = [...backupProjects];
let keptFromCurrent = 0;
const keptDetail = [];

// For each current project, keep only if its marketId is NOT in backup (genuinely new).
for (const cp of currentProjects) {
  if (!backupMids.has(cp.marketId)) {
    recovered.push(cp);
    keptFromCurrent++;
    keptDetail.push(`  ${cp.name} (mid=${cp.marketId})`);
  }
}

cur.projects = recovered;

// Write atomically.
const tmpPath = CURRENT + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(cur));
fs.renameSync(tmpPath, CURRENT);

const completedCount = recovered.filter((p) => p.status === 'completed').length;
const activeCount = recovered.filter((p) => p.status === 'active').length;

console.log(`Recovered: ${recovered.length} projects total (${completedCount} completed, ${activeCount} active)`);
console.log(`  - ${backupProjects.length} restored from backup`);
console.log(`  - ${keptFromCurrent} kept from current (genuinely new since backup):`);
for (const line of keptDetail) console.log(line);
console.log('');
console.log('Restart the exe — connected clients will rehydrate on the next state_updated SSE.');
