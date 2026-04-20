/**
 * Server-side live journal watcher.
 *
 * Phase B entry point. Poll the game's journal folder on two cadences:
 *   - Every 2s: new bytes in the active Journal.*.log, + file rotation detection
 *   - Every 5s: Cargo.json and Market.json mtime checks (companion files)
 *
 * New events go through processors.js → state patches applied via the injected
 * applyStatePatch dep → SSE broadcast. No browser-side polling required.
 *
 * On startup we backward-scan the active journal for the most recent Loadout
 * / ShipyardSwap (seeds currentShip) and the most recent position event
 * (seeds commanderPosition). byteOffset is set to EOF so historical events
 * aren't re-processed; they came in via Sync All if relevant.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseJournalLines } from './parser.js';
import {
  listJournalFiles,
  resolveJournalDir,
  journalDirExists,
} from './paths.js';
import { processNewEvents, pollCompanionFiles } from './processors.js';
import { fetchLatestPositionFromJournal } from './extractor.js';

const POLL_INTERVAL_MS = 2000;
const COMPANION_INTERVAL_MS = 5000;

/**
 * Singleton watcher state. Kept at module scope because the server instantiates
 * exactly one watcher and there's no reason to support multiple journal dirs
 * simultaneously.
 */
let wstate = null;

/**
 * Start the live watcher. Idempotent — calling while already running is a no-op.
 *
 * @param {{
 *   readState: () => object,
 *   applyStatePatch: (patch: object) => void,
 *   broadcastEvent: (event: object) => void,
 * }} deps
 */
export function startServerWatcher(deps) {
  if (wstate && wstate.running) return;

  const existing = deps.readState();
  const override = existing && existing.settings && existing.settings.journalDirOverride;
  const journalDir = resolveJournalDir(override);
  if (!journalDirExists(journalDir)) {
    console.log(`[Watcher] Journal dir not found: ${journalDir} — watcher not started`);
    return;
  }

  // Surface the journal directory to processors so handlers like
  // handleNavRoutePlottedOverlay can read NavRoute.json without re-resolving it.
  const extendedDeps = Object.assign({}, deps, { journalDir });

  wstate = {
    running: true,
    journalDir,
    deps: extendedDeps,
    activeFile: null, // { name, fullPath, mtimeMs, size }
    knownFileNames: [],
    byteOffset: 0,
    cargoMtimeMs: 0,
    marketMtimeMs: 0,
    journalTimer: null,
    companionTimer: null,
    lastEventAt: null,
  };

  try { initWatcher(); } catch (e) { console.error('[Watcher] init failed:', e && e.message); }

  wstate.journalTimer = setInterval(() => {
    try { pollJournal(); } catch (e) { console.error('[Watcher] poll error:', e && e.message); }
  }, POLL_INTERVAL_MS);
  wstate.companionTimer = setInterval(() => {
    try { pollCompanionTick(); } catch (e) { console.error('[Watcher] companion error:', e && e.message); }
  }, COMPANION_INTERVAL_MS);

  console.log(`[Watcher] Started — watching ${journalDir}`);
  if (wstate.activeFile) {
    console.log(`[Watcher] Active file: ${wstate.activeFile.name} (offset ${wstate.byteOffset})`);
  }
}

export function stopServerWatcher() {
  if (!wstate) return;
  wstate.running = false;
  if (wstate.journalTimer) clearInterval(wstate.journalTimer);
  if (wstate.companionTimer) clearInterval(wstate.companionTimer);
  wstate = null;
  console.log('[Watcher] Stopped');
}

export function isServerWatcherRunning() {
  return !!(wstate && wstate.running);
}

/** Snapshot of current watcher state for /api/watcher-status. */
export function getServerWatcherStatus() {
  if (!wstate) return { running: false };
  return {
    running: wstate.running,
    journalDir: wstate.journalDir,
    activeFile: wstate.activeFile ? wstate.activeFile.name : null,
    byteOffset: wstate.byteOffset,
    knownFileCount: wstate.knownFileNames.length,
    lastEventAt: wstate.lastEventAt,
  };
}

// ===== Initialization =====

function initWatcher() {
  const files = listJournalFiles(wstate.journalDir);
  wstate.knownFileNames = files.map((f) => f.name);
  if (files.length === 0) return;

  const latest = files[files.length - 1];
  wstate.activeFile = latest;
  wstate.byteOffset = latest.size; // Skip historical events — Sync All handles those

  // Seed currentShip — find most recent Loadout or ShipyardSwap in the active file
  try {
    const text = fs.readFileSync(latest.fullPath, 'utf-8');
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event === 'Loadout' && ev.ShipID != null) {
        wstate.deps.applyStatePatch({
          currentShip: {
            shipId: ev.ShipID,
            type: ev.Ship || '',
            name: ev.ShipName,
            ident: ev.ShipIdent,
            cargoCapacity: ev.CargoCapacity,
          },
        });
        break;
      }
      if (ev.event === 'ShipyardSwap' && ev.ShipID != null) {
        wstate.deps.applyStatePatch({
          currentShip: { shipId: ev.ShipID, type: ev.ShipType || '' },
        });
        break;
      }
    }
  } catch { /* best-effort */ }

  // Seed commanderPosition from the most recent position event across all journals
  try {
    const pos = fetchLatestPositionFromJournal(wstate.journalDir);
    if (pos) {
      const record = {
        systemName: pos.systemName,
        systemAddress: pos.systemAddress,
        coordinates: pos.coordinates,
        source: 'Server boot',
        updatedAt: new Date().toISOString(),
      };
      wstate.deps.applyStatePatch({ commanderPosition: record });
      wstate.deps.broadcastEvent({
        type: 'commander_position',
        position: record,
        timestamp: new Date().toISOString(),
      });
      console.log(`[Watcher] Backfilled position: ${pos.systemName}`);
    }
  } catch (e) {
    console.error('[Watcher] position backfill failed:', e && e.message);
  }

  // Initial companion-file mtimes so we don't fire a spurious event on first tick
  try {
    wstate.cargoMtimeMs = fs.statSync(path.join(wstate.journalDir, 'Cargo.json')).mtimeMs;
  } catch { /* no Cargo.json yet */ }
  try {
    wstate.marketMtimeMs = fs.statSync(path.join(wstate.journalDir, 'Market.json')).mtimeMs;
  } catch { /* no Market.json yet */ }
}

// ===== Journal polling =====

function pollJournal() {
  if (!wstate || !wstate.running) return;

  const files = listJournalFiles(wstate.journalDir);
  const fileNames = files.map((f) => f.name);

  // File rotation: ED starts a new Journal.*.log on each session
  const newFiles = fileNames.filter((n) => !wstate.knownFileNames.includes(n));
  if (newFiles.length > 0) {
    wstate.knownFileNames = fileNames;
    const latest = files[files.length - 1];
    if (!wstate.activeFile || latest.name !== wstate.activeFile.name) {
      console.log(`[Watcher] Rotating to new journal: ${latest.name}`);
      wstate.activeFile = latest;
      wstate.byteOffset = 0;
    }
  }

  if (!wstate.activeFile) return;

  // Refresh size — the mtime tracking via stat is cheaper than reading
  let size;
  try {
    size = fs.statSync(wstate.activeFile.fullPath).size;
  } catch {
    return;
  }
  if (size <= wstate.byteOffset) return;

  // Read only the new bytes
  let fd = null;
  try {
    fd = fs.openSync(wstate.activeFile.fullPath, 'r');
    const len = size - wstate.byteOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, wstate.byteOffset);
    wstate.byteOffset = size;
    const text = buf.toString('utf-8');
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return;

    const parsed = parseJournalLines(lines);
    wstate.lastEventAt = new Date().toISOString();

    processNewEvents(parsed, wstate.deps);
  } catch (e) {
    console.error('[Watcher] read error:', e && e.message);
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

// ===== Companion files (Cargo.json / Market.json) =====

function pollCompanionTick() {
  if (!wstate || !wstate.running) return;

  let anyChanged = false;

  try {
    const s = fs.statSync(path.join(wstate.journalDir, 'Cargo.json'));
    if (s.mtimeMs > wstate.cargoMtimeMs) {
      wstate.cargoMtimeMs = s.mtimeMs;
      anyChanged = true;
    }
  } catch { /* no Cargo.json */ }

  try {
    const s = fs.statSync(path.join(wstate.journalDir, 'Market.json'));
    if (s.mtimeMs > wstate.marketMtimeMs) {
      wstate.marketMtimeMs = s.mtimeMs;
      anyChanged = true;
    }
  } catch { /* no Market.json */ }

  if (anyChanged) {
    pollCompanionFiles(wstate.journalDir, wstate.deps);
    wstate.lastEventAt = new Date().toISOString();
  }
}
