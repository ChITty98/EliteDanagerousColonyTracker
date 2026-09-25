#!/usr/bin/env node
/**
 * Commander's Log — dry run. Reads the journals and the app's records, ranks what happened,
 * and prints the last N days the way the timeline would show them: one block per sitting,
 * newest first, entries at or above the chosen weight, the rest folded into one line.
 * Read-only: touches nothing.
 *
 * Usage: node tools/commander-log-dry-run.mjs [--days 90] [--min notable|major|huge] [--all]
 *        [--journals <dir>] [--app <dir with colony-data.json / colony-gallery.json>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournalEvents, buildCommanderLog, sittingSummary, sittingWhere, weightRank, DEFAULTS } from '../server/journal/commanderLog.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const days = Number(opt('--days', 90));
const min = opt('--min', 'notable');
const showAll = args.includes('--all');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appDir = opt('--app', ROOT);
const journalDir = opt('--journals', path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous'));

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const state = readJson(path.join(appDir, 'colony-data.json'));
const gallery = readJson(path.join(appDir, 'colony-gallery.json'));

const t0 = Date.now();
const events = readJournalEvents(journalDir);
const log = buildCommanderLog({ events, state, gallery });
const since = Date.now() - days * 86400e3;
const tag = { huge: 'HUGE ', major: 'MAJOR', notable: 'note ', routine: '     ' };
const day = (iso) => iso.slice(0, 10);
const hm = (iso) => iso.slice(11, 16);

const counts = { huge: 0, major: 0, notable: 0, routine: 0 };
for (const e of log.events) counts[e.weight] += 1;
console.log(`Commander's Log dry run — ${events.length.toLocaleString()} journal events, ${log.sittings.length} sittings, ${log.events.length} log events (${counts.huge} huge · ${counts.major} major · ${counts.notable} notable · ${counts.routine} routine) in ${Date.now() - t0} ms`);
console.log(`Thresholds: ${JSON.stringify(DEFAULTS)}`);
console.log(`\n=== Last ${days} days, entries at or above "${min}" ===\n`);

const recent = log.sittings.filter((s) => Date.parse(s.startedAt) >= since);
for (const s of recent) {
  const shown = s.events.filter((e) => showAll || weightRank(e.weight) >= weightRank(min));
  const dur = s.hours >= 1 ? `${s.hours.toFixed(1)} h` : `${Math.round(s.hours * 60)} min`;
  const where = sittingWhere(s);
  console.log(`${day(s.startedAt)} ${hm(s.startedAt)}  ${dur.padStart(7)}  ${s.ship || '?'}  ·  ${where ? `${where}  ·  ` : ''}${sittingSummary(s)}${s.wing.length ? `  ·  with ${s.wing.join(', ')}` : ''}${s.endReason === 'silence' ? '  (ended by silence)' : s.endReason === 'open' ? '  (still open)' : ''}`);
  for (const e of shown) console.log(`    ${tag[e.weight]}  ${hm(e.at)}  ${e.line}`);
}
const orphans = log.events.filter((e) => Date.parse(e.at) >= since && e.kind === 'scouted' && weightRank(e.weight) >= weightRank(min));
if (orphans.length) { console.log(`\n--- app records in the window (not tied to a sitting) ---`); for (const e of orphans.slice(0, 20)) console.log(`    ${tag[e.weight]}  ${day(e.at)}  ${e.line}`); }

console.log(`\n=== Everything HUGE, all time ===\n`);
for (const e of log.events.filter((x) => x.weight === 'huge')) console.log(`    ${day(e.at)}  ${e.line}`);
console.log(`\n=== Deaths, all time ===\n`);
for (const e of log.events.filter((x) => x.kind === 'death')) console.log(`    ${day(e.at)}  ${e.line}`);
