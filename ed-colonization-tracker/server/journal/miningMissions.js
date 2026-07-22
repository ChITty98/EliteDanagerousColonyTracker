// server/journal/miningMissions.js
//
// Live Mission_Mining tracking.
//
// WHY THIS EXISTS: mining value cannot be priced off market data alone. Verified against this
// commander's journals on 2026-07-21 — 5 live Bromellite wing missions paying 136,198 Cr/t against a
// 36,693 Cr/t market average (3.7x), and an Osmium mission at 196,362 Cr/t against 61,622 (3.2x).
// Pricing a Bromellite rock at market would understate it by nearly 4x. While a mission for a
// commodity is live and unfulfilled, the mission rate IS the value of that commodity.
//
// Mining missions also drive the target list: you mine for a reason, and the reason is already in
// the journal. No manual picking required for the mission case.
//
// HONEST LIMIT — wing missions: CargoDepot (which reports wing-wide collection totals) does NOT
// fire for Mission_Mining; verified zero depot records across all 6 live missions. So only THIS
// commander's own MiningRefined tonnage is observable. Any completion estimate is therefore a
// worst case that assumes they mine every tonne themselves, and is labelled as such. Never present
// it as a forecast of when the mission will actually complete.

import fs from 'node:fs';
import path from 'node:path';
import { listJournalFiles } from './paths.js';

// Missions run days, not months. Journals older than this cannot hold a live one, so the boot
// scan skips them — the alternative (reading all 527 files) costs seconds for nothing.
const SCAN_WINDOW_DAYS = 45;
const RESCAN_MS = 5 * 60_000;

let missions = new Map(); // MissionID (string) → accepted event
let finished = new Set(); // MissionID (string) — completed / abandoned / failed
let lastScanAt = 0;
let scannedDir = null;

const cleanName = (s) => String(s || '').toLowerCase().replace(/^\$/, '').replace(/_name;?$/, '').replace(/[\s.]/g, '').trim();

/** "Low Temp. Diamonds" and "LowTemperatureDiamond" must collapse to one key. */
export function commodityKey(s) {
  const c = cleanName(s);
  if (c.startsWith('lowtemp')) return 'lowtemperaturediamond';
  return c.replace(/s$/, '');
}

/**
 * Full scan of recent journals for mining-mission lifecycle events. Cached — the live event path
 * (ingestMissionEvent) keeps it current between scans.
 */
export function scanMiningMissions(journalDir, force = false) {
  const now = Date.now();
  if (!force && scannedDir === journalDir && now - lastScanAt < RESCAN_MS) return;

  const cutoff = now - SCAN_WINDOW_DAYS * 86400_000;
  let files;
  try { files = listJournalFiles(journalDir); } catch { return; }

  const m = new Map();
  const f = new Set();
  for (const file of files) {
    let mtime = 0;
    try { mtime = fs.statSync(file.fullPath).mtimeMs; } catch { continue; }
    if (mtime < cutoff) continue;
    let text;
    try { text = fs.readFileSync(file.fullPath, 'utf8'); } catch { continue; }
    if (text.indexOf('Mission') < 0) continue;
    for (const line of text.split('\n')) {
      if (!line.trim() || line.indexOf('Mission') < 0) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event === 'MissionAccepted' && ev.Name === 'Mission_Mining') m.set(String(ev.MissionID), ev);
      else if (ev.event === 'MissionCompleted' || ev.event === 'MissionAbandoned' || ev.event === 'MissionFailed') f.add(String(ev.MissionID));
    }
  }
  missions = m;
  finished = f;
  lastScanAt = now;
  scannedDir = journalDir;
}

/** Live event hook — keeps mission state current without a rescan. */
export function ingestMissionEvent(ev) {
  if (!ev) return;
  if (ev.event === 'MissionAccepted' && ev.Name === 'Mission_Mining') missions.set(String(ev.MissionID), ev);
  else if (ev.event === 'MissionCompleted' || ev.event === 'MissionAbandoned' || ev.event === 'MissionFailed') finished.add(String(ev.MissionID));
}

/**
 * Live mining missions aggregated per commodity.
 * @returns {{ list: Array, byCommodity: Record<string, {label:string, tonnes:number, reward:number, crPerTonne:number, count:number, expiry:string, wing:boolean}> }}
 */
export function getLiveMiningMissions(nowMs = Date.now()) {
  const list = [];
  for (const [id, ev] of missions) {
    if (finished.has(id)) continue;
    // Expired missions are dead weight — an earlier version of this scan reported 2025 missions as
    // outstanding because it only checked completion, not expiry.
    const exp = Date.parse(ev.Expiry);
    if (Number.isFinite(exp) && exp <= nowMs) continue;
    list.push(ev);
  }

  const byCommodity = {};
  for (const ev of list) {
    const label = ev.Commodity_Localised || ev.Commodity || '';
    const key = commodityKey(label);
    if (!key) continue;
    const b = byCommodity[key] || (byCommodity[key] = {
      label: label.replace(/^\$/, '').replace(/_name;?$/i, ''),
      tonnes: 0, reward: 0, crPerTonne: 0, count: 0, expiry: ev.Expiry, wing: false,
    });
    b.tonnes += ev.Count || 0;
    b.reward += ev.Reward || 0;
    b.count += 1;
    if (ev.Wing) b.wing = true;
    // Soonest deadline governs.
    if (ev.Expiry && (!b.expiry || Date.parse(ev.Expiry) < Date.parse(b.expiry))) b.expiry = ev.Expiry;
  }
  for (const b of Object.values(byCommodity)) {
    b.crPerTonne = b.tonnes > 0 ? Math.round(b.reward / b.tonnes) : 0;
  }
  return { list, byCommodity };
}

/**
 * Mission Cr/t for a commodity, or null when no live mission covers it.
 * This is what overrides market pricing in the prospect verdict.
 */
export function missionRateFor(commodity, nowMs = Date.now()) {
  const { byCommodity } = getLiveMiningMissions(nowMs);
  const b = byCommodity[commodityKey(commodity)];
  return b && b.crPerTonne > 0 ? b : null;
}

/** Commodity keys that live missions want — used to auto-populate mining targets. */
export function missionTargetKeys(nowMs = Date.now()) {
  return Object.keys(getLiveMiningMissions(nowMs).byCommodity);
}
