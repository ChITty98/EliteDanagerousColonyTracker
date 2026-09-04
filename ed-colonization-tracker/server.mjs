#!/usr/bin/env node
/**
 * Standalone server for ED Colony Architect.
 * Serves the built static files and proxies API requests to external services.
 *
 * Usage:  node server.mjs
 *         (then open http://localhost:5173 in your browser)
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  resolveJournalDir,
  journalDirExists,
  listJournalFiles,
} from './server/journal/paths.js';
import { createCaptureStore } from './server/ai/copilotCapture.js';
import { initCopilotMemory, recordAnswer, recordQuiz, getQuizHistory } from './server/ai/copilotMemory.js';
import { startTickPoll, getTickInfo, getGalaxyTick } from './server/journal/tick.js';
import { runOnDemand, runNews } from './server/ai/copilot.js';
import { startNewsRefresh } from './server/ai/copilotNews.js';
import { buildTriviaRound } from './server/ai/copilotTrivia.js';
import { registerLine, lookupLine, synthesize, voiceAvailable, PROFILES, DEFAULT_PERSONA } from './server/ai/copilotVoice.js';
import {
  fetchLatestPositionFromJournal,
  extractLatestCargoCapacity,
  extractKnowledgeBase,
  extractDockHistory,
  extractStationTravelTimes,
  extractSquadronAndShips,
  extractExplorationData,
  scanForVisitedMarkets,
  scanJournalFiles,
  readMarketJson,
  readShipCargo,
  readNavRouteJson,
  readMarketSnapshot,
} from './server/journal/extractor.js';
import { friendlyShip, padSizeFor } from './server/journal/extractor.js';
import { initMarketMeans, bestSellFromSnapshots } from './server/journal/marketMeans.js';
import { initMarketHistory, backfillSales, sampleKeys, needsSample, recordArdentSample, historyStats } from './server/journal/marketHistory.js';
import { buildSellPlan, MAX_REACH_LY } from './server/journal/sellPlan.js';
import { initCarrierLedger, ensureCarrierLedger, reconcileCarrierMarket, carrierCargoRecord, setCarrierBaseline } from './server/journal/carrierLedger.js';
import {
  findCommodityByJournalName,
  findCommodityByDisplayName,
} from './server/journal/commodities.js';
import { isEphemeralStation } from './server/journal/util.js';
import { extractMaterialInventory, applyMaterialDeltaEvent } from './server/journal/materials.js';
import {
  startServerWatcher,
  stopServerWatcher,
  getServerWatcherStatus,
} from './server/journal/watcher.js';
import { pollCompanionFiles } from './server/journal/processors.js';
import {
  initMiningLog, readRocks, getRateHistory, measuredRateFor, flushNow as flushMiningLog,
  backfillFromJournals, getLocationTotals, getCatchStats, markHotspot, getAnnotations,
} from './server/journal/miningLog.js';
import {
  initRingIndex, buildRingIndex, findRingsForTargets, ringIndexStats, getMaterialCatalog, rankRings,
  getRingInfo, getUnmappedRings, getRingsInSystems,
} from './server/journal/miningIndex.js';
import {
  scanMiningMissions, getLiveMiningMissions, commodityKey, missionRateFor,
} from './server/journal/miningMissions.js';
import {
  initSurfaceMining, getSurfaceSummary, backfillFromJournals as backfillSurfaceMining, markDeposit,
  recordSighting, finalizeSurfaceMining, getSurfaceSnapshot, setCurrentSite, recordSiteCount, bodyNameFromLedger,
  isRecordedScreenshot, retractSighting, recordRating, setHullSize, hullSizeFor, setNavTarget, clearNavTarget,
  addPin, removePin,
} from './server/journal/surfaceMining.js';
// The nav lock names a body by BodyID only; this turns "Body": 14 into "1 a" for the hero band.
import { resolveBodyNameById } from './server/journal/processors.js';
import { getMiningSnapshot, commodityValueNow, rockValueNow, colonySystemsOf, setInHotspot, seedRingContext } from './server/journal/mining.js';
import { initTrophies, computeAggregates, evaluateBadges, badgeStates, getStreak } from './server/journal/miningTrophies.js';
import { refreshLivePrices, getLivePrice, ardentJson } from './server/journal/livePrices.js';
import { startEddnListener, stopEddnListener, recenterRadar } from './server/radar/eddnListener.js';
import { snapshot as radarSnapshot, setCenterTraffic } from './server/radar/radarState.js';
import { getEdsmTraffic } from './server/radar/traffic.js';
import { getJournalStats, refreshJournalStats } from './server/journal/history.js';
import { initChainWatch, seedChainWatch, snapshotChains, defaultRegions, resolvePendingRegions } from './server/chains/chainWatch.js';
import { assessThreats } from './server/chains/threatWatch.js';
import { buildDomainTasks } from './server/journal/domainTasks.js';
import { refreshLookback } from './server/radar/lookback.js';
import { searchRingsBySignals } from './server/journal/spansh.js';
import { initUpdater, getUpdateStatus, checkForUpdate } from './server/update/updater.js';
import { checklistSnapshot, checklistSetSkipped } from './server/journal/checklist.js';

// SEA detection: when bundled via build-exe.mjs and injected as a single executable,
// the node:sea API reports isSea() === true. In that case, runtime state (colony-data.json,
// colony-token.txt, gallery, backups) lives in the folder containing the .exe.
// In dev (node server.mjs) or .bat (node server-bundled.cjs), use the source/bundle folder.
const _require = createRequire(import.meta.url);
let IS_SEA = false;
try { IS_SEA = _require('node:sea').isSea(); } catch {}
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Data lives beside the .exe. A v1.33.0 build moved it to %LOCALAPPDATA% so the exe
// could be swapped in place; that migration was withdrawn after review found it could
// silently orphan an install (an empty folder containing only the auto-generated token
// read as "already migrated") and could not distinguish an interrupted copy from a
// finished one. Updating stays manual: replace the exe in this folder. See CHANGELOG
// 1.34.0. Any future attempt needs an atomic copy with a completion sentinel and
// payload-based install detection — not a file-presence check.
const APP_DIR = IS_SEA ? path.dirname(process.execPath) : SOURCE_DIR;

const __dirname = SOURCE_DIR; // preserved for any downstream references
const PORT = parseInt(process.env.PORT || '5173', 10);
const DIST = path.join(SOURCE_DIR, 'dist');
// Bundled exe: __APP_VERSION__ injected by build-exe.mjs (from package.json).
// Dev (node server.mjs): read package.json next to this file.
const APP_VERSION = /** @type {any} */ (globalThis).__APP_VERSION__ || (() => {
  try { return 'v' + JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8')).version + '-dev'; }
  catch { return 'v?-dev'; }
})();

// --- Token security ---
const TOKEN_FILE = path.join(APP_DIR, 'colony-token.txt');
let APP_TOKEN;
try {
  APP_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
} catch {
  APP_TOKEN = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_FILE, APP_TOKEN);
}

function isLocalhost(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function validateToken(req) {
  if (isLocalhost(req)) return true;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === APP_TOKEN) return true;
  const tokenHeader = req.headers['x-app-token'];
  if (tokenHeader === APP_TOKEN) return true;
  return false;
}

// --- Server-side JSON state storage ---
const STATE_FILE = path.join(APP_DIR, 'colony-data.json');
const JOURNAL_STATS_FILE = path.join(APP_DIR, 'journal-stats.json');
const CHAIN_WATCH_FILE = path.join(APP_DIR, 'chain-watch.json');
let journalStatsScanInFlight = false;
const GALLERY_DIR = path.join(APP_DIR, 'colony-images');
const GALLERY_META = path.join(APP_DIR, 'colony-gallery.json');

// Ensure gallery directory exists
try { fs.mkdirSync(GALLERY_DIR, { recursive: true }); } catch {}
const COPILOT_DIR = path.join(APP_DIR, 'copilot-characters');
try { fs.mkdirSync(COPILOT_DIR, { recursive: true }); } catch {}
// Corpus flywheel: append-only log of every shown line + ratings (copilotCapture.js).
const CAPTURE_FILE = path.join(APP_DIR, 'copilot-captures.jsonl');
const captureStore = createCaptureStore(CAPTURE_FILE);
// Co-pilot persistent memory (crew roster / session tenure / docking grudges) — its own
// server-owned file, kept OUT of the synced client state. See copilotMemory.js.
const MEMORY_FILE = path.join(APP_DIR, 'copilot-memory.json');
initCopilotMemory(MEMORY_FILE);
startNewsRefresh(); // keep the GalNet cache warm for TARS's news beat (real feed; best-effort)

// --- Automatic backup on startup ---
const BACKUP_DIR = path.join(APP_DIR, 'backups');
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
try {
  const stateSize = fs.statSync(STATE_FILE).size;
  if (stateSize > 100) { // only backup if file has real data
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `colony-data.${ts}.json`);
    fs.copyFileSync(STATE_FILE, backupPath);
    console.log(`[Backup] Created ${backupPath} (${(stateSize / 1024).toFixed(0)}KB)`);
    // Keep only last 5 backups
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('colony-data.')).sort();
    while (backups.length > 5) {
      const old = backups.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
    }
  }
} catch (e) { console.warn('[Backup] Failed:', e.message); }

function readGalleryMeta() {
  try { return JSON.parse(fs.readFileSync(GALLERY_META, 'utf-8')); } catch { return {}; }
}
function writeGalleryMeta(data) {
  try { fs.writeFileSync(GALLERY_META, JSON.stringify(data)); } catch (e) { console.error('[Gallery] Write error:', e.message); }
}

// --- Sightings (the postcard ledger) + F10 screenshot capture ---
// Gallery keys follow the EXISTING scheme ("system:x" / "system:x:body:y"), so photos
// recorded here show up on System Detail pages automatically — colonized or not.
// Tight on purpose: the real flow is tap-Record ↔ press-F10 within seconds of each
// other. A long window let unrelated same-system shots glom onto a sighting.
const SIGHTING_ATTACH_WINDOW_MS = 3 * 60 * 1000;
// F10 shots land here by default. The journal Filename is a token like
// "\ED_Pictures\Screenshot_0001.bmp", not an absolute path.
const ED_PICTURES_DIR = path.join(os.homedir(), 'Pictures', 'Frontier Developments', 'Elite Dangerous');
// Recent F10 shots, so Record→F10 and F10→Record both attach (same system, ±10 min).
const recentGameShots = []; // { ts, system, key, imageId, url, caption }

function galleryKeyFor(systemName, bodyName) {
  const sys = `system:${String(systemName).toLowerCase()}`;
  return bodyName ? `${sys}:body:${String(bodyName).toLowerCase()}` : sys;
}

function addImageToGalleryKey(key, entry) {
  const meta = readGalleryMeta();
  if (!Array.isArray(meta[key])) meta[key] = [];
  meta[key].push(entry);
  writeGalleryMeta(meta);
}

/**
 * Pull in F10 surface shots the gallery never saw. recordGameScreenshot only runs while the exe is
 * live, so a marker taken with it closed has coordinates (the journal keeps those) but no picture —
 * and the picture is the point, since the HUD panel in frame is the only record of a deposit's
 * commodity, mineral amount and density. Originals stay in ED_Pictures, so they are recoverable.
 *
 * Runs at boot as well as on demand: nobody should have to press a button to see their own history.
 * Idempotent — a shot already in the gallery is skipped by filename.
 */
function adoptOrphanSurfaceShots(journalDir) {
  let adopted = 0;
  try {
    const seen = new Set();
    for (const arr of Object.values(readGalleryMeta())) {
      for (const e of arr || []) if (e && e.caption) seen.add(e.caption);
    }
    for (const file of listJournalFiles(journalDir)) {
      const p = file.fullPath || file;
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (!text.includes('"Screenshot"')) continue;
      for (const line of text.split('\n')) {
        if (line.indexOf('"event":"Screenshot"') < 0) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        // Same test the marker list uses: Altitude is written only on/near a surface, so a docked
        // or in-space shot has none and is not a deposit photo.
        if (ev.Latitude == null || ev.Altitude == null || ev.Altitude >= 200) continue;
        const base = path.basename(String(ev.Filename || '').split('\\').pop() || '');
        if (!base || seen.has(base)) continue;
        seen.add(base);
        recordGameScreenshot(ev);
        adopted += 1;
      }
    }
  } catch (e) { console.error('[SurfaceMining] shot adoption:', e && e.message); }
  return adopted;
}

/**
 * Mark a gallery image as a UTILITY shot — taken to document something (a mining deposit's HUD
 * panel), not as a picture of the place. Representative thumbnails pick the first non-utility
 * image, so a photo of a rock face never becomes a system's hero shot. Set when an F10 marker is
 * promoted to a deposit, because that is the moment its purpose is known; at capture time the
 * same keypress might equally have been a Sights postcard.
 */
function flagGalleryUtility(imageId) {
  if (!imageId) return false;
  const meta = readGalleryMeta();
  let hit = false;
  for (const key of Object.keys(meta)) {
    const arr = meta[key];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (!e || e.id !== imageId) continue;
      if (!e.utility) { e.utility = true; hit = true; }
      // A deposit photo is documentation, not a postcard: re-encode the 32MB F10 BMP as JPEG.
      // Runs for entries flagged earlier but still on .bmp too, so nothing stays huge by accident.
      if (convertGalleryImageToJpeg(e)) hit = true;
    }
  }
  if (hit) writeGalleryMeta(meta);
  return hit;
}

/**
 * Re-encode a gallery BMP as JPEG (quality 90) in place. F10 always writes BMP — 31.6MB per shot at
 * 3440x1440 — and deposit-panel shots are taken by the dozen. The commander's decision: Sights
 * postcards stay BMP; a shot is converted ONLY once it is promoted to a deposit (this is called
 * from flagGalleryUtility and nowhere else). The original in ED_Pictures is never touched; only the
 * gallery's copy changes. Uses the same PowerShell/System.Drawing path the voice code already
 * spawns, so it needs no new dependency inside the SEA exe.
 */
function convertGalleryImageToJpeg(entry) {
  if (!entry || !entry.url || !/\.bmp$/i.test(entry.url)) return false;
  const base = path.basename(entry.url);
  const src = path.join(GALLERY_DIR, base);
  if (!fs.existsSync(src)) return false;
  const dstName = base.replace(/\.bmp$/i, '.jpg');
  const dst = path.join(GALLERY_DIR, dstName);
  const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    `$img=[System.Drawing.Image]::FromFile(${psq(src)});`,
    "$enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' };",
    '$p=New-Object System.Drawing.Imaging.EncoderParameters(1);',
    '$p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]90);',
    `$img.Save(${psq(dst)},$enc,$p); $img.Dispose();`,
  ].join(' ');
  let r;
  try {
    r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000, windowsHide: true });
  } catch (e) {
    console.warn('[Gallery] JPEG conversion failed to start:', e && e.message);
    return false;
  }
  if (r.status !== 0 || !fs.existsSync(dst) || fs.statSync(dst).size < 1024) {
    console.warn(`[Gallery] JPEG conversion failed for ${base}${r.stderr ? `: ${String(r.stderr).slice(0, 200)}` : ''}`);
    try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch { /* ignore */ }
    return false;
  }
  const before = fs.statSync(src).size;
  entry.url = `/gallery-images/${dstName}`;
  try { fs.unlinkSync(src); } catch { /* keep both if the delete fails; the meta already points at the jpg */ }
  console.log(`[Gallery] ${base} → ${dstName} (${(before / 1048576).toFixed(1)}MB → ${(fs.statSync(dst).size / 1024).toFixed(0)}KB)`);
  return true;
}

/** Move an image's meta entry between gallery keys (used when a buffered F10 shot
 *  gets adopted by a sighting recorded moments later). The file itself never moves. */
function moveGalleryImage(imageId, fromKey, toKey) {
  if (fromKey === toKey) return false;
  const meta = readGalleryMeta();
  const src = Array.isArray(meta[fromKey]) ? meta[fromKey] : [];
  const idx = src.findIndex((e) => e && e.id === imageId);
  if (idx === -1) return false;
  const [entry] = src.splice(idx, 1);
  if (!Array.isArray(meta[toKey])) meta[toKey] = [];
  meta[toKey].push(entry);
  writeGalleryMeta(meta);
  return true;
}

/**
 * In-game F10 Screenshot journal event → copy the BMP into the gallery and attach.
 * If a sighting from the same system was recorded within the window, the shot files
 * under the SIGHTING's gallery key; otherwise under the key derived from the event's
 * own System/Body (still findable on that system's page). BMPs are stored as-is —
 * browsers render them natively, and converting would drag an image library into
 * the SEA exe. (~10-30 MB each; noted in Settings copy.)
 */
function recordGameScreenshot(ev) {
  const basename = path.basename(String(ev.Filename || '').replace(/\\/g, '/'));
  if (!basename) return;
  const src = path.join(ED_PICTURES_DIR, basename);
  if (!fs.existsSync(src)) {
    console.warn(`[Sightings] F10 shot not found at ${src} — non-default screenshot folder?`);
    return;
  }
  // ALT+F10 hi-res captures run ~500 MB each ("I had no idea it was going to be
  // half a gig!") — don't silently balloon the gallery. Skip with a visible note;
  // the original stays in Pictures for manual attach if genuinely wanted.
  const MAX_ATTACH_BYTES = 100 * 1024 * 1024;
  const srcSize = fs.statSync(src).size;
  if (srcSize > MAX_ATTACH_BYTES) {
    const sizeMB = Math.round(srcSize / 1048576);
    console.warn(`[Sightings] Skipped ${basename} (${sizeMB} MB hi-res) — left in Pictures; attach manually if wanted.`);
    broadcastEvent({ type: 'screenshot_saved', skipped: true, sizeMB, system: ev.System, body: ev.Body || null, timestamp: ev.timestamp });
    return;
  }
  const ext = (path.extname(basename) || '.bmp').slice(1).toLowerCase();
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${id}.${ext}`;
  try {
    fs.copyFileSync(src, path.join(GALLERY_DIR, filename));
  } catch (e) {
    console.error('[Sightings] F10 copy failed:', e.message);
    return;
  }
  const url = `/gallery-images/${filename}`;
  const ts = Date.parse(ev.timestamp) || Date.now();

  // Newest sighting from the same system inside the window adopts the shot.
  const st = readStateFile();
  const match = Object.values(st.sightings || {})
    .filter((s) => s && s.systemName === ev.System && Math.abs(ts - Date.parse(s.recordedAt)) <= SIGHTING_ATTACH_WINDOW_MS)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))[0];
  const key = match ? match.galleryKey : galleryKeyFor(ev.System, ev.Body);
  addImageToGalleryKey(key, { id, url, caption: basename, addedAt: new Date().toISOString() });
  if (match) {
    applyStatePatch({ sightings: { __upsert: { [match.id]: { ...match, autoShots: (match.autoShots || 0) + 1 } } } });
  }
  recentGameShots.push({ ts, system: ev.System, key, imageId: id, url, caption: basename });
  while (recentGameShots.length > 20) recentGameShots.shift();
  console.log(`[Sightings] F10 shot ${basename} → ${key}${match ? ' (attached to sighting)' : ''}`);
  broadcastEvent({ type: 'screenshot_saved', system: ev.System, body: ev.Body || null, url, attached: !!match, timestamp: ev.timestamp });
}

let stateWriteTimer = null;
let pendingState = null;

// --- SSE (Server-Sent Events) for Companion page ---
const sseClients = [];

function broadcastEvent(event) {
  // Radar recenter rides the existing position broadcast — one hook, no new plumbing.
  if (event && event.type === 'commander_position' && event.position) {
    try {
      const p = event.position;
      const moved = recenterRadar(p.systemName, p.coordinates);
      if (moved && p.coordinates) {
        void refreshLookback(readStateFile(), p.systemName, [p.coordinates.x, p.coordinates.y, p.coordinates.z]);
      }
      if (moved) {
        // one EDSM call per jump (10-min cache inside) — feeds the CENTER TRAFFIC readout
        getEdsmTraffic(p.systemName).then((t) => setCenterTraffic(p.systemName, t)).catch(() => {});
      }
    } catch (e) { console.error('[Radar] recenter failed:', e && e.message); }
  }
  // Speech rides the existing line broadcast, same trick as the radar hook above — one place
  // instead of the five emit sites in copilot.js. The client then asks for audio by ID, so the
  // server only ever speaks words it wrote itself.
  if (event && event.type === 'copilot_line' && event.id && event.line) {
    try { registerLine(event.id, event.line, event.mood); }
    catch (e) { console.error('[CopilotVoice] register failed:', e && e.message); }
  }
  const data = `data: ${JSON.stringify(event)}\n\n`;
  let delivered = 0;
  let dropped = 0;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(data);
      delivered++;
    } catch {
      sseClients.splice(i, 1);
      dropped++;
    }
  }
  // Skip noisy heartbeats; log everything else so we can prove broadcasts are firing.
  if (event && event.type !== 'heartbeat' && !event.quiet) {
    const src = event.source ? ` source=${event.source}` : '';
    console.log(`[SSE] broadcast ${event.type}${src} → ${delivered} client(s)${dropped ? ` (dropped ${dropped} dead)` : ''}`);
  }
}

// Heartbeat to keep SSE connections alive
setInterval(() => {
  broadcastEvent({ type: 'heartbeat', timestamp: new Date().toISOString() });
}, 30000);

function readStateFile() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const txt = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(txt);
    }
  } catch (e) {
    console.error('[State] Read error:', e.message);
  }
  return {};
}

// Append-only state keys: sparse PATCHes from clients can ONLY upsert/add,
// never remove. Protects hard-won data (market captures requiring a flight to
// the station, dock dossier built up over months, scouted system info, etc.)
// from being silently wiped by stale-baseline diffs sent by misbehaving tabs.
//
// Removes here only happen via dedicated server-side endpoints if at all.
const APPEND_ONLY_KEYS = new Set([
  'marketSnapshots',          // require player flight + dock to capture
  'knownStations',            // dock dossier accumulating over time
  'knownSystems',             // system info from FSS/Spansh
  'systemAddressMap',         // name ↔ address mapping
  'bodyVisits',               // landings — exploration history
  'organicScans',             // exobiology catalogued per body — journal-derived
  'sightings',                // player-recorded "worth remembering" spots (postcard ledger)
  'bodyNotes',                // player-authored notes
  'fleetCarriers',            // FC dossier
  'fleetCarrierSpaceUsage',   // FC space tracking
  'visitedMarkets',           // journal extraction (expensive scan)
  'journalExplorationCache',  // exploration data per system
  'scoutedSystems',           // scouted system summaries
  'stationTravelTimes',       // travel-time matrix (per-ship-per-station)
  'scoutedConflicts',         // War & Peace scout reports — refresh by re-scout, not delete
  'stationBodyOverrides',     // user-set body for stations without marketId
  'materialInventory',        // ship engineering mats — derived from journals, hard to re-acquire
  'journalScan',              // squadron name/rank + ship usage (expensive journal scan)
  'dismissedTasks',           // "I am never doing that" — permanent by design, no un-dismiss path
  'populationOverrides',      // user-edited system populations
  'stationDistOverrides',     // user-edited station distances
]);

// Sparse per-key merge. Incoming values can be marker objects with:
//   { __upsert: {...}, __remove: [...], __idKey?: string } — map / array-by-id
//   { __add: [...], __remove: [...] }                       — primitive set
// Any other value is treated as a wholesale replace.
function mergeStatePatch(existing, incoming) {
  const out = { ...existing };
  for (const key of Object.keys(incoming)) {
    const val = incoming[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && ('__upsert' in val || '__remove' in val || '__add' in val)) {
      const hasUpsert = val.__upsert && typeof val.__upsert === 'object';
      const hasIdKey = typeof val.__idKey === 'string';
      let removeList = Array.isArray(val.__remove) ? val.__remove : [];
      const addList = Array.isArray(val.__add) ? val.__add : [];
      // Block client-initiated removes for append-only keys. Logs the attempt
      // so we can see when a misbehaving tab tried to wipe data.
      if (removeList.length > 0 && APPEND_ONLY_KEYS.has(key)) {
        console.warn(`[State] BLOCKED ${removeList.length} __remove op(s) on append-only key '${key}': ${removeList.slice(0, 5).join(', ')}${removeList.length > 5 ? '...' : ''}`);
        removeList = [];
      }
      if (hasIdKey) {
        // Array-by-id — convert existing to map, apply ops, convert back
        const idKey = val.__idKey;
        const curArr = Array.isArray(existing[key]) ? existing[key] : [];
        const map = {};
        for (const item of curArr) {
          if (item && item[idKey] != null) map[String(item[idKey])] = item;
        }
        if (hasUpsert) {
          for (const id of Object.keys(val.__upsert)) map[id] = val.__upsert[id];
        }
        for (const id of removeList) delete map[String(id)];
        out[key] = Object.values(map);
      } else if (addList.length > 0 || (removeList.length > 0 && !hasUpsert)) {
        // Primitive set
        const curArr = Array.isArray(existing[key]) ? existing[key] : [];
        const removeSet = new Set(removeList);
        const next = curArr.filter((x) => !removeSet.has(x));
        for (const x of addList) if (!next.includes(x)) next.push(x);
        out[key] = next;
      } else {
        // Map (Record<id, value>)
        const cur = (existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) ? existing[key] : {};
        const merged = { ...cur };
        if (hasUpsert) for (const k of Object.keys(val.__upsert)) merged[k] = val.__upsert[k];
        for (const k of removeList) delete merged[k];
        out[key] = merged;
      }
    } else if (key === 'settings' && val && typeof val === 'object' && !Array.isArray(val)) {
      // settings is an ACCUMULATING flat object — a partial or stale client sync must NEVER drop
      // keys the server already holds. A wholesale replace here wiped copilotPersonality on a
      // build (the fresh client came up without it and a Sound-toggle sync replaced the lot).
      // Shallow-merge: existing keys survive, incoming keys overlay.
      const curS = (existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)) ? existing.settings : {};
      out[key] = { ...curS, ...val };
    } else {
      // Wholesale replace (scalar, object, or legacy-format full value)
      out[key] = val;
    }
  }
  return out;
}

/**
 * Apply a sparse state patch: read existing, merge, write debounced, broadcast SSE.
 * Used by the live watcher + processors so state updates flow through one path.
 * The state_updated broadcast triggers persist rehydrate on every connected client.
 */
function applyStatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) return;
  // Critical: read pendingState first, fall back to disk. Otherwise patches
  // landing within the 500ms debounce window stomp each other — the second
  // patch reads stale disk data and overwrites the first patch's pendingState.
  // Same fix as GET /api/state. This was the Cavallo Nero "lost market" bug.
  const existing = pendingState ?? readStateFile();
  const merged = mergeStatePatch(existing, patch);
  writeStateDebounced(merged);
  broadcastEvent({
    type: 'state_updated',
    source: 'watcher',
    timestamp: new Date().toISOString(),
  });
}

function writeStateDebounced(data) {
  pendingState = data;
  if (stateWriteTimer) clearTimeout(stateWriteTimer);
  stateWriteTimer = setTimeout(() => {
    if (pendingState !== null) {
      try {
        const newJson = JSON.stringify(pendingState);
        // Size-check protection: refuse to overwrite with much smaller data
        try {
          const existingSize = fs.statSync(STATE_FILE).size;
          if (existingSize > 1000 && newJson.length < existingSize * 0.3) {
            console.error(`[State] BLOCKED write — new data (${(newJson.length/1024).toFixed(0)}KB) is <30% of existing (${(existingSize/1024).toFixed(0)}KB). Possible empty state overwrite.`);
            pendingState = null;
            return;
          }
        } catch { /* file doesn't exist yet, ok to write */ }
        fs.writeFileSync(STATE_FILE, newJson);
        console.log(`[State] Saved colony-data.json (${(newJson.length / 1024).toFixed(0)}KB)`);
      } catch (e) {
        console.error('[State] Write error:', e.message);
      }
      pendingState = null;
    }
  }, 500);
}


// MIME types for static file serving
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Proxy targets (same as vite.config.ts)
const PROXIES = {
  '/edsm-api': { host: 'www.edsm.net', prefix: '/edsm-api' },
  '/ardent-api': { host: 'api.ardent-insight.com', prefix: '/ardent-api' },
  '/spansh-api': { host: 'spansh.co.uk', prefix: '/spansh-api' },
};

// War & Peace cache — keyed by JSON.stringify({referenceSystem,radius,states,allegiances,size}).
// TTL = until next BGS tick (Thursday 07:00 UTC), since faction states only update weekly.
const warPeaceCache = new Map();

function nextBgsTick(now) {
  // Returns timestamp (ms) of the next Thursday 07:00 UTC after `now`.
  // Day-of-week: Sun=0 ... Thu=4. If today is Thursday before 07:00 UTC, return today's 07:00.
  // Otherwise advance to the next Thursday.
  const d = new Date(now);
  d.setUTCHours(7, 0, 0, 0);
  const dayUTC = d.getUTCDay();
  const targetDay = 4; // Thursday
  let daysUntil = (targetDay - dayUTC + 7) % 7;
  if (daysUntil === 0 && d.getTime() <= now) daysUntil = 7;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.getTime();
}

// Synthesize a ScoutReport from Spansh + EDSM data. Either source may be missing.
function buildScoutReport(systemName, spanshSys, edsmData) {
  const conflictStateSet = new Set(['War', 'Civil War', 'Election']);
  const sources = { spansh: !!spanshSys, edsm: !!edsmData };

  // Prefer Spansh's id64 → that's the authoritative systemAddress
  const systemAddress = (spanshSys && spanshSys.id64) || (edsmData && edsmData.id64) || 0;
  const population = spanshSys ? spanshSys.population : (edsmData && edsmData.population) || 0;
  const controllingFaction = spanshSys ? spanshSys.controlling_minor_faction
    : (edsmData && edsmData.controllingFaction && edsmData.controllingFaction.name) || undefined;
  const controllingFactionState = spanshSys ? spanshSys.controlling_minor_faction_state : undefined;
  const systemAllegiance = spanshSys ? spanshSys.allegiance : undefined;
  const power = spanshSys ? spanshSys.power : undefined;
  const powerState = spanshSys ? spanshSys.power_state : undefined;

  // Build merged faction list. Prefer EDSM (more current), fall back to Spansh.
  const factions = [];
  const seen = new Set();
  if (edsmData && Array.isArray(edsmData.factions)) {
    for (const f of edsmData.factions) {
      if (!f || !f.name || seen.has(f.name)) continue;
      seen.add(f.name);
      factions.push({
        name: f.name,
        allegiance: f.allegiance || '',
        government: f.government || '',
        influence: f.influence || 0,
        state: f.state || 'None',
        activeStates: (f.activeStates || []).map((s) => typeof s === 'string' ? s : s.state),
        pendingStates: (f.pendingStates || []).map((s) => typeof s === 'string' ? s : s.state),
        recoveringStates: (f.recoveringStates || []).map((s) => typeof s === 'string' ? s : s.state),
      });
    }
  }
  if (spanshSys && Array.isArray(spanshSys.minor_faction_presences)) {
    for (const f of spanshSys.minor_faction_presences) {
      if (!f || !f.name || seen.has(f.name)) continue;
      seen.add(f.name);
      factions.push({
        name: f.name,
        allegiance: f.allegiance || '',
        government: f.government || '',
        influence: f.influence || 0,
        state: f.state || 'None',
        activeStates: (f.active_states || []).map((s) => typeof s === 'string' ? s : s.state),
        pendingStates: (f.pending_states || []).map((s) => typeof s === 'string' ? s : s.state),
        recoveringStates: (f.recovering_states || []).map((s) => typeof s === 'string' ? s : s.state),
      });
    }
  }

  // Group conflict-state factions and infer pairs.
  // ED conflicts are 1-vs-1, so when 2 factions share the same state in a system,
  // they're almost always paired against each other. >2 same-state means multiple
  // simultaneous conflicts — flag as unpaired and let the user verify in-system.
  const byState = new Map();
  for (const f of factions) {
    if (!conflictStateSet.has(f.state)) continue;
    if (!byState.has(f.state)) byState.set(f.state, []);
    byState.get(f.state).push(f);
  }
  const conflictPairs = [];
  for (const [state, list] of byState) {
    if (list.length === 2) {
      conflictPairs.push({ state, factions: list, paired: true });
    } else if (list.length > 0) {
      // Multiple — emit one entry per faction so UI can list them, paired:false
      conflictPairs.push({ state, factions: list, paired: false });
    }
  }

  // Combat anchors: Spansh stations array, filtered to those owned by conflict factions.
  // Drop fleet carriers (transient).
  const NON_ANCHORS = new Set(['Drake-Class Carrier', 'FleetCarrier']);
  const conflictFactionNames = new Set(factions.filter((f) => conflictStateSet.has(f.state)).map((f) => f.name));
  const combatAnchors = [];
  const serviceStations = [];
  if (spanshSys && Array.isArray(spanshSys.stations)) {
    for (const st of spanshSys.stations) {
      if (!st || !st.name) continue;
      if (st.type && NON_ANCHORS.has(st.type)) continue;
      const services = Array.isArray(st.services) ? st.services.map((s) => s.toLowerCase()) : [];
      const hasRefuel = services.includes('refuel');
      const hasRepair = services.includes('repair');
      const hasRearm = services.includes('rearm') || services.includes('restock');
      const anchor = {
        name: st.name,
        type: st.type || '',
        distanceLs: st.distance_to_arrival,
        controllingFaction: st.controlling_minor_faction || '',
        hasRefuel,
        hasRepair,
        hasRearm,
      };
      if (st.controlling_minor_faction && conflictFactionNames.has(st.controlling_minor_faction)) {
        combatAnchors.push(anchor);
      }
      if (hasRefuel && hasRepair && hasRearm) {
        serviceStations.push(anchor);
      }
    }
  }
  combatAnchors.sort((a, b) => (a.distanceLs ?? Infinity) - (b.distanceLs ?? Infinity));
  serviceStations.sort((a, b) => (a.distanceLs ?? Infinity) - (b.distanceLs ?? Infinity));

  const notes = [];
  if (!sources.spansh) notes.push('Spansh data unavailable for this system — installations/services may be incomplete.');
  if (!sources.edsm) notes.push('EDSM data unavailable — using Spansh-only state info.');
  if (conflictPairs.some((p) => !p.paired)) {
    notes.push('Multiple simultaneous conflicts detected. In-game CZ list shows the actual pairings — verify before dropping in.');
  }

  const now = new Date();
  const expiresAt = new Date(nextBgsTick(now.getTime())).toISOString();

  return {
    systemName,
    systemAddress,
    scoutedAt: now.toISOString(),
    expiresAt,
    population,
    controllingFaction,
    controllingFactionState,
    systemAllegiance,
    power,
    powerState,
    conflictPairs,
    combatAnchors,
    serviceStations,
    notes,
    sources,
  };
}

// Resolve a system name to its canonical case via Spansh's name search (which IS case-insensitive
// unlike reference_system). Cached for the lifetime of the process — system names don't change.
const systemNameCache = new Map(); // lowercaseInput → canonicalName | null

async function resolveSystemName(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return null;
  if (systemNameCache.has(key)) return systemNameCache.get(key);
  try {
    const r = await fetch('https://spansh.co.uk/api/systems/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ed-colony-tracker/resolve' },
      body: JSON.stringify({ filters: { name: { value: key } }, size: 1 }),
    });
    if (!r.ok) { systemNameCache.set(key, null); return null; }
    const j = await r.json();
    const first = (j.results || [])[0];
    const canonical = first && first.name && first.name.toLowerCase() === key ? first.name : null;
    systemNameCache.set(key, canonical);
    return canonical;
  } catch {
    systemNameCache.set(key, null);
    return null;
  }
}

function filterWarPeaceResults(results, opts) {
  const out = [];
  const conflictStates = new Set(['War', 'Civil War', 'Election']);
  for (const s of results) {
    if (opts.minPopulation && (s.population || 0) < opts.minPopulation) continue;
    if (opts.combatantAllegiances) {
      const presences = Array.isArray(s.minor_faction_presences) ? s.minor_faction_presences : [];
      const hasMatch = presences.some((f) =>
        f && conflictStates.has(f.state) && opts.combatantAllegiances.has(f.allegiance));
      if (!hasMatch) continue;
    }
    out.push(s);
  }
  return out;
}

// --- EDMCModernOverlay TCP client ---
let overlaySocket = null;
let overlayConnected = false;
let overlayReconnectTimer = null;

function connectOverlay() {
  if (overlaySocket) {
    try { overlaySocket.destroy(); } catch {}
    overlaySocket = null;
  }
  overlayConnected = false;
  const sock = net.createConnection({ host: '127.0.0.1', port: 5010 }, () => {
    overlayConnected = true;
    console.log('[Overlay] Connected to EDMCModernOverlay');
  });
  sock.on('error', (err) => {
    console.log(`[Overlay] Connection error: ${err.message}`);
  });
  sock.on('close', () => {
    console.log('[Overlay] Connection closed, will reconnect in 60s');
    overlayConnected = false;
    overlaySocket = null;
    // Reconnect after 60 seconds
    if (overlayReconnectTimer) clearTimeout(overlayReconnectTimer);
    overlayReconnectTimer = setTimeout(connectOverlay, 60_000);
  });
  overlaySocket = sock;
}

function sendOverlayMessage(msg) {
  if (!overlayConnected || !overlaySocket) {
    console.log('[Overlay] Not connected, dropping message:', msg.id || '(no id)');
    return;
  }
  try {
    const payload = JSON.stringify(msg) + '\n';
    overlaySocket.write(payload);
    if (!msg.quiet) console.log('[Overlay] Sent:', msg.id, msg.text?.substring(0, 60) || '');
  } catch (err) {
    console.log(`[Overlay] Send error: ${err.message}`);
  }
}

// Initial connection attempt
connectOverlay();

/**
 * Proxy a request to an HTTPS backend.
 */
function proxyRequest(req, res, target, targetPath) {
  const options = {
    hostname: target.host,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
      // Remove browser origin headers that confuse APIs
      origin: undefined,
      referer: undefined,
    },
  };
  // Clean undefined headers
  Object.keys(options.headers).forEach((k) => {
    if (options.headers[k] === undefined) delete options.headers[k];
  });

  const proxyReq = https.request(options, (proxyRes) => {
    // Pass through status and headers (strip CORS — we're same-origin now)
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error -> ${target.host}${targetPath}:`, err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq, { end: true });
}

/**
 * Look up a dist file. In bundled mode (SEA / esbuild output), files are embedded
 * as base64 strings in `globalThis.__DIST_FILES__` (injected by build-exe.mjs via
 * esbuild's `define` option). In dev, reads from disk at `dist/`.
 *
 * Returns a Buffer or null.
 */
function getDistFile(relPath) {
  const bundled = /** @type {any} */ (globalThis).__DIST_FILES__;
  if (bundled && typeof bundled === 'object') {
    const entry = bundled[relPath];
    if (entry) return Buffer.from(entry, 'base64');
    return null;
  }
  try {
    return fs.readFileSync(path.join(DIST, relPath));
  } catch {
    return null;
  }
}

/**
 * Serve a static file from dist/ (or the embedded file map in bundled mode).
 * `reqPath` is the URL pathname (starts with '/').
 */
function serveStatic(res, reqPath) {
  let relPath = reqPath === '/' ? '/index.html' : reqPath;
  let buf = getDistFile(relPath);
  if (!buf) {
    // SPA fallback — serve index.html for client-side routes
    buf = getDistFile('/index.html');
    if (!buf) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    relPath = '/index.html';
  }
  const ext = path.extname(relPath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  // Cache assets (hashed filenames) for 1 year, everything else no-cache
  const cacheControl = relPath.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': cacheControl,
  });
  res.end(buf);
}

// Create server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Token validation — only for API/data routes, not static files.
  // Co-pilot ACTION endpoints (compute-triggering or state-writing) require the token like /api/ —
  // they were previously open to any LAN device. The static-like /copilot-art/ and /copilot-characters
  // (images + pack picker) stay open, same as gallery images.
  const isCopilotAction = pathname === '/copilot-ask' || pathname === '/copilot-news'
    || pathname === '/copilot-rate' || pathname === '/copilot-answer'
    || pathname === '/copilot-trivia' || pathname === '/copilot-trivia-result'
    || pathname === '/copilot-voice';
  const needsToken = pathname.startsWith('/api/') || pathname.startsWith('/overlay') || isCopilotAction;
  if (needsToken && !validateToken(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or missing token' }));
    return;
  }

  // State API: GET /api/state
  // Return in-memory pendingState when available so clients that fetch after an
  // SSE broadcast don't race against the 500ms debounced disk write.
  if (pathname === '/api/state' && req.method === 'GET') {
    const data = pendingState ?? readStateFile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // Token API: GET /api/network-url — returns network URL with token (localhost only)
  if (pathname === '/api/network-url' && req.method === 'GET') {
    if (!isLocalhost(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Localhost only' }));
      return;
    }
    const hostname = os.hostname();
    const networkUrl = `http://${hostname}:${PORT}?token=${APP_TOKEN}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: networkUrl, token: APP_TOKEN, hostname, port: PORT }));
    return;
  }

  // Galaxy BGS tick (runtime-only, from the tick.infomancer.uk poll) — lastGalaxyTick null until first fetch
  if (pathname === '/api/tick' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getTickInfo()));
    return;
  }

  // Exploration API: GET /api/exploration/:addr — single system's body data
  const exploMatch = pathname.match(/^\/api\/exploration\/(\d+)$/);
  if (exploMatch && req.method === 'GET') {
    const addr = exploMatch[1];
    const data = readStateFile();
    const cache = data.journalExplorationCache || {};
    const system = cache[addr] || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(system));
    return;
  }

  // Chain Watch — colonization frontier chains, region-filtered. GET renders the ledger;
  // POST /seed (re)runs the bounded Spansh is_being_colonised seed.
  // --- Update notice (read-only: reports what's published, never touches a file) ---
  if (pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getUpdateStatus()));
    return;
  }
  if (pathname === '/api/update/check' && req.method === 'POST') {
    checkForUpdate()
      .then((s) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)); })
      .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    return;
  }
  if (pathname === '/api/chains' && req.method === 'GET') {
    const st = readStateFile();
    const url = new URL(req.url, 'http://x');
    const qRegions = (url.searchParams.get('regions') || '').split('|').map((s) => s.trim()).filter(Boolean);
    const p = st.commanderPosition;
    const center = p && p.coordinates ? [p.coordinates.x, p.coordinates.y, p.coordinates.z] : null;
    const holdings = [];
    for (const pr of st.projects || []) {
      const kb = (st.knownSystems || {})[(pr.systemName || '').toLowerCase()];
      if (kb && kb.coordinates) holdings.push([kb.coordinates.x, kb.coordinates.y, kb.coordinates.z]);
    }
    const finish = (regions) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign(snapshotChains({ regions, center, holdings }), { regionsUsed: regions })));
    };
    if (qRegions.length) finish(qRegions);
    else if (Array.isArray(st.settings && st.settings.chainWatchRegions) && st.settings.chainWatchRegions.length) finish(st.settings.chainWatchRegions);
    else defaultRegions().then(finish).catch(() => finish(['Inner Orion Spur']));
    return;
  }
  if (pathname === '/api/chains/seed' && req.method === 'POST') {
    const st = readStateFile();
    const regionsP = Array.isArray(st.settings && st.settings.chainWatchRegions) && st.settings.chainWatchRegions.length
      ? Promise.resolve(st.settings.chainWatchRegions)
      : defaultRegions();
    regionsP.then((regions) => seedChainWatch(regions)
      .then((r) => console.log('[ChainWatch] seed:', JSON.stringify(r)))
      .catch((e) => console.error('[ChainWatch] seed failed:', e && e.message)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ started: true }));
    return;
  }

  // Journal lifetime stats — cached + incremental (no more full rescans per visit).
  // GET returns instantly from journal-stats.json; POST /refresh catches up on new
  // files in the background with progress over SSE.
  if (pathname === '/api/journal-stats' && req.method === 'GET') {
    const st = readStateFile();
    const dir = resolveJournalDir(st.settings && st.settings.journalDirOverride);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getJournalStats(dir, JOURNAL_STATS_FILE)));
    return;
  }
  if (pathname === '/api/journal-stats/refresh' && req.method === 'POST') {
    const st = readStateFile();
    const dir = resolveJournalDir(st.settings && st.settings.journalDirOverride);
    const kicked = !journalStatsScanInFlight;
    if (kicked) {
      journalStatsScanInFlight = true;
      refreshJournalStats(dir, JOURNAL_STATS_FILE, (pct, phase) => {
        broadcastEvent({ type: 'journal_stats_progress', pct, phase, timestamp: new Date().toISOString() });
      }).then((r) => {
        if (r && r.started) console.log(`[JournalStats] refresh done — ${r.processed} file(s) caught up`);
      }).catch((e) => console.error('[JournalStats] refresh failed:', e && e.message))
        .finally(() => { journalStatsScanInFlight = false; });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ started: kicked }));
    return;
  }

  // State API: PATCH /api/state — sparse diff merge (per-key strategy)
  if (pathname === '/api/state' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const merged = mergeStatePatch(readStateFile(), incoming);
        writeStateDebounced(merged);
        // Broadcast state_updated to all other devices so they re-fetch
        const sourceIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
        broadcastEvent({ type: 'state_updated', source: sourceIp, timestamp: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Sync-All API: POST /api/sync-all — runs extractors against all journal files,
  // merges results into colony-data.json, broadcasts `state_updated` to all clients.
  // This is what the Dashboard "Sync All" button hits so any device (including
  // iPad) can trigger a full journal rescan without the PC needing a Chrome tab.
  if (pathname === '/api/sync-all' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const existing = readStateFile();
          const settings = existing.settings || {};
          const journalDir = resolveJournalDir(settings.journalDirOverride);
          if (!journalDirExists(journalDir)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Journal directory not found', journalDir }));
            return;
          }
          const files = listJournalFiles(journalDir);
          console.log(`[SyncAll] Scanning ${files.length} journal files at ${journalDir}`);

          const t0 = Date.now();
          const kb = extractKnowledgeBase(journalDir, {
            myFleetCarrier: settings.myFleetCarrier || '',
            myFleetCarrierMarketId: settings.myFleetCarrierMarketId || null,
            squadronCarrierCallsigns: Array.isArray(settings.squadronCarriers)
              ? settings.squadronCarriers.map((c) => c.callsign).filter(Boolean)
              : [],
          });
          const dockHistory = extractDockHistory(journalDir); // Map<marketId, entry>
          const { stats: travelStats, latestShip } = extractStationTravelTimes(journalDir);
          const latestCargo = extractLatestCargoCapacity(journalDir);
          const exploration = extractExplorationData(journalDir); // Map<addr, system>
          const visitedMarkets = scanForVisitedMarkets(journalDir);
          const depots = scanJournalFiles(journalDir); // DiscoveredDepot[]
          const currentMarket = readMarketJson(journalDir);
          const currentCargo = readShipCargo(journalDir);
          const latestPosition = fetchLatestPositionFromJournal(journalDir);
          const materialInventory = extractMaterialInventory(journalDir);
          const journalScan = extractSquadronAndShips(journalDir); // squadron name/rank + ship usage
          const ms = Date.now() - t0;
          const matCounts = materialInventory
            ? `R${Object.keys(materialInventory.raw).length}/M${Object.keys(materialInventory.manufactured).length}/E${Object.keys(materialInventory.encoded).length}`
            : 'none';
          console.log(`[SyncAll] Extracted ${kb.systems.length} systems / ${kb.stations.length} stations / ${Object.keys(travelStats).length} travel-time pairs / ${exploration.size} explored systems / ${depots.length} depots / mats:${matCounts} in ${ms}ms`);

          // Merge knownStations with dock history. Three-way merge:
          //   1. Start with existing.knownStations[marketId] (keeps dossier if
          //      SyncAll was run before and we just had our dossier wiped by
          //      a stray KB event since)
          //   2. Spread kb.station on top (updates type/faction/services)
          //   3. Spread dh on top if present (authoritative dockedCount etc.)
          // Preserve station name if incoming is a construction placeholder.
          const existingStations = existing.knownStations || {};
          const stationMap = {};
          for (const st of kb.stations) {
            const key = String(st.marketId);
            const dh = dockHistory.get(st.marketId);
            const prior = existingStations[key];
            const merged = Object.assign({}, prior || {}, st);
            // Preserve user-set body / bodyType across journal sync. The journal's
            // Docked event may not include Body for some stations, and Object.assign
            // with an undefined-valued property still overwrites the prior value —
            // wiping the user's manual setting (set via Set Body in System Detail).
            // User edits always win for these fields; if the user wants journal data,
            // they can clear their setting first.
            if (prior && prior.body) merged.body = prior.body;
            if (prior && prior.bodyType) merged.bodyType = prior.bodyType;
            if (prior && prior.stationType) merged.stationType = prior.stationType;
            if (dh) {
              merged.firstDocked = dh.firstDocked;
              merged.lastDocked = dh.lastDocked;
              merged.dockedCount = dh.dockedCount;
              merged.currentFaction = dh.currentFaction;
              merged.currentFactionState = dh.currentFactionState;
              merged.factionHistory = dh.factionHistory;
              merged.stateHistory = dh.stateHistory;
              // Latest non-ephemeral name from dock history
              merged.stationName = dh.stationName;
            } else if (prior) {
              // No dock history entry (rare — e.g. this station's only docks
              // were permanent ephemerals). Keep prior dossier fields.
              merged.firstDocked = prior.firstDocked;
              merged.lastDocked = prior.lastDocked;
              merged.dockedCount = prior.dockedCount;
              merged.factionHistory = prior.factionHistory;
              merged.stateHistory = prior.stateHistory;
              merged.influenceHistory = prior.influenceHistory;
            }
            // Protect against a KB-sourced construction placeholder clobbering a
            // resolved name
            if (prior && prior.stationName && st.stationName
                && /\$EXT_PANEL_ColonisationShip|Construction Site/i.test(st.stationName)
                && !/\$EXT_PANEL_ColonisationShip|Construction Site/i.test(prior.stationName)) {
              merged.stationName = prior.stationName;
            }
            stationMap[key] = merged;
          }

          // Build sparse PATCH — shapes per MERGE_STRATEGIES in src/store/index.ts:
          //   knownSystems/knownStations/systemAddressMap/bodyVisits/organicScans/stationTravelTimes/journalExplorationCache = map
          //   fleetCarriers = arrayById (idKey: callsign)
          //   visitedMarkets = arrayById (idKey: marketId)
          //   fssSignals = replace (bare array — no canonical id)
          // claimedSystems is NOT a stored state key; Dashboard consumes it directly from sync-all result.
          const patch = {
            knownSystems: { __upsert: Object.fromEntries(kb.systems.map((s) => [s.systemName.toLowerCase(), s])) },
            knownStations: { __upsert: stationMap },
            systemAddressMap: { __upsert: kb.systemAddressMap },
            fssSignals: kb.fssSignals,
            fleetCarriers: {
              __idKey: 'callsign',
              __upsert: Object.fromEntries(kb.fleetCarriers.map((fc) => [fc.callsign, fc])),
            },
            bodyVisits: { __upsert: Object.fromEntries(kb.bodyVisits.map((b) => [`${b.systemAddress}|${b.bodyName}`, b])) },
            organicScans: { __upsert: Object.fromEntries((kb.organicScans || []).map((o) => [`${o.systemAddress}|${o.bodyId}`, o])) },
            stationTravelTimes: { __upsert: travelStats },
            journalExplorationCache: { __upsert: Object.fromEntries(Array.from(exploration.entries()).map(([addr, sys]) => [String(addr), sys])) },
            visitedMarkets: {
              __idKey: 'marketId',
              __upsert: Object.fromEntries(visitedMarkets.map((m) => [String(m.marketId), m])),
            },
            journalScan: { squadron: journalScan.squadron, shipUsage: journalScan.shipUsage, scannedAt: new Date().toISOString() },
          };

          // Auto-update populationOverrides when journal has fresher Population
          // than the existing user-edited override. Mirrors the client-side
          // upsertKnownSystems logic that only fires from legacy paths. Without
          // this, the override stays stale forever and the Dashboard shows old
          // population (since populationOverrides takes priority over
          // knownSystems.population in the UI).
          const existingPopOverrides = existing.populationOverrides || {};
          const popOverrideUpserts = {};
          for (const s of kb.systems) {
            if (!s.population || s.population <= 0) continue;
            const key = s.systemName.toLowerCase();
            const ov = existingPopOverrides[key];
            // Update if no override exists OR override is older than journal lastSeen.
            // Note: we update regardless of whether the new population is higher
            // or lower — Frontier's BGS tick can move populations either way and
            // the journal is authoritative.
            if (!ov || (s.lastSeen && (!ov.updatedAt || s.lastSeen > ov.updatedAt))) {
              popOverrideUpserts[key] = { population: s.population, updatedAt: s.lastSeen || new Date().toISOString() };
            }
          }
          if (Object.keys(popOverrideUpserts).length > 0) {
            patch.populationOverrides = { __upsert: popOverrideUpserts };
            console.log(`[SyncAll] Auto-updated populationOverrides for ${Object.keys(popOverrideUpserts).length} system(s) from fresher journal data`);
          }

          // Material inventory (replace strategy — server is sole writer, every
          // sync-all produces a complete snapshot).
          if (materialInventory) {
            patch.materialInventory = {
              raw: materialInventory.raw,
              manufactured: materialInventory.manufactured,
              encoded: materialInventory.encoded,
              updatedAt: materialInventory.updatedAt,
              baselineFrom: materialInventory.baselineFrom,
            };
          }

          // === Migration: visitedMarkets → marketSnapshots ===
          // Single source of truth at render time. For every visitedMarkets entry
          // without a live snapshot, fabricate a snapshot from the journal data
          // (buy prices known from MarketBuy events, stock unknown so set to null).
          // Live snapshots from the watcher will overwrite these later.
          {
            const existingSnapshots = (existing && existing.marketSnapshots) || {};
            const fabricated = {};
            let fabricatedCount = 0;
            for (const v of visitedMarkets) {
              const key = String(v.marketId);
              if (existingSnapshots[key]) continue; // live data wins
              if (isEphemeralStation(v.stationName, v.stationType, v.marketId)) continue;
              const commodities = (Array.isArray(v.commodities) ? v.commodities : []).map((id) => {
                const priceEntry = (v.commodityPrices && v.commodityPrices[id]) || null;
                return {
                  commodityId: id,
                  name: id, // best effort — UI looks up display name from COMMODITY_BY_ID
                  buyPrice: priceEntry ? priceEntry.buyPrice : 0,
                  stock: null, // journal has no stock figures, only what was bought
                };
              });
              if (commodities.length === 0) continue;
              fabricated[key] = {
                marketId: v.marketId,
                stationName: v.stationName,
                systemName: v.systemName,
                stationType: v.stationType || '',
                isPlanetary: !!v.isPlanetary,
                hasLargePads: !!v.hasLargePads,
                commodities,
                updatedAt: v.lastVisited || new Date().toISOString(),
              };
              fabricatedCount++;
            }
            if (fabricatedCount > 0) {
              patch.marketSnapshots = patch.marketSnapshots || { __upsert: {} };
              patch.marketSnapshots.__upsert = Object.assign({}, fabricated, patch.marketSnapshots.__upsert);
              console.log(`[SyncAll] Fabricated ${fabricatedCount} marketSnapshot(s) from visitedMarkets (no live snapshot existed)`);
            }
          }
          if (latestShip) patch.currentShip = latestShip;
          if (latestCargo && !settings.cargoCapacityManual) {
            // Write into settings; preserve other settings keys via patch.settings = {...existing, ...}
            const mergedSettings = Object.assign({}, settings, { cargoCapacity: latestCargo.cargoCapacity });
            patch.settings = mergedSettings;
          }

          // Commander position — latest FSDJump/Location/CarrierJump from journals.
          // Without this the UI stays stuck on whatever the browser watcher last wrote.
          let positionRecord = null;
          if (latestPosition) {
            positionRecord = {
              systemName: latestPosition.systemName,
              systemAddress: latestPosition.systemAddress,
              coordinates: latestPosition.coordinates,
              source: 'Sync All',
              updatedAt: new Date().toISOString(),
            };
            patch.commanderPosition = positionRecord;
          }

          // Current Market.json handling — delegate to pollCompanionFiles so we use the
          // SAME logic as the 5s watcher and Sync Market button. Previously this path
          // had its own (more restrictive) filter that overwrote comprehensive snapshots
          // with reduced ones — Cavallo Nero went from 141 items to 2.
          //
          // pollCompanionFiles handles:
          //   - FC carrierCargo upsert (when station is user's FC or squadron carrier)
          //   - station marketSnapshots upsert with full sell+buy capture and raw-name fallback
          //   - applyStatePatch + broadcast
          //
          // We have to first merge the SyncAll patch (kb / visitedMarkets / etc.) so that
          // pollCompanionFiles can read a consistent state when it computes its own diff.
          const merged = mergeStatePatch(existing, patch);
          writeStateDebounced(merged);

          // SERVER-SIDE depot auto-create — project creation must never depend on a browser
          // handler. The Dashboard's response loop was the ONLY creator; when it doesn't run
          // (any error, any other page), new construction sites stayed invisible no matter how
          // many times Sync All was pressed. The server now writes them itself; the client loop
          // then simply finds them as existing (no duplicates).
          try {
            const stNow = pendingState ?? readStateFile();
            const haveIds = new Set((Array.isArray(stNow.projects) ? stNow.projects : []).map((p) => p && p.marketId).filter(Boolean));
            const dismissedIds = new Set(Array.isArray(stNow.dismissedMarketIds) ? stNow.dismissedMarketIds : []);
            const freshProjects = {};
            for (const depot of depots) {
              if (!depot || depot.isComplete || depot.isFailed) continue;
              if (haveIds.has(depot.marketId) || dismissedIds.has(depot.marketId)) continue;
              const id = crypto.randomUUID();
              const nowIso = new Date().toISOString();
              const stationName = depot.stationName || '';
              freshProjects[id] = {
                id,
                name: depot.systemName ? `${depot.systemName}${stationName ? ` - ${stationName}` : ''}` : `Depot ${depot.marketId}`,
                systemName: depot.systemName || '',
                systemAddress: depot.systemAddress ?? null,
                stationType: depot.stationType || '',
                stationName,
                marketId: depot.marketId,
                commodities: depot.commodities || [],
                status: 'active',
                notes: '',
                createdAt: nowIso,
                lastUpdatedAt: nowIso,
              };
            }
            if (Object.keys(freshProjects).length) {
              applyStatePatch({ projects: { __idKey: 'id', __upsert: freshProjects } });
              console.log(`[SyncAll] AUTO-CREATED ${Object.keys(freshProjects).length} project(s) server-side: ${Object.values(freshProjects).map((p) => p.name).join('; ')}`);
            }
          } catch (e) {
            console.error('[SyncAll] server-side depot create failed:', e && e.message);
          }

          if (currentMarket && currentMarket.marketId) {
            try {
              pollCompanionFiles(journalDir, {
                readState: readStateFile,
                applyStatePatch,
                broadcastEvent,
                sendOverlay: sendOverlayMessage,
              });
            } catch (e) {
              console.error('[SyncAll] pollCompanionFiles error:', e && e.message);
            }
          }
          broadcastEvent({ type: 'state_updated', source: 'sync-all', timestamp: new Date().toISOString() });
          if (positionRecord) {
            // Dedicated SSE so the Companion banner re-renders with via-source tag
            // without waiting for the state_updated rehydrate round-trip.
            broadcastEvent({
              type: 'commander_position',
              position: positionRecord,
              timestamp: new Date().toISOString(),
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            elapsedMs: ms,
            journalDir,
            filesScanned: files.length,
            counts: {
              systems: kb.systems.length,
              stations: kb.stations.length,
              fleetCarriers: kb.fleetCarriers.length,
              bodyVisits: kb.bodyVisits.length,
              organicScans: (kb.organicScans || []).length,
              travelTimes: Object.keys(travelStats).length,
              exploration: exploration.size,
              visitedMarkets: visitedMarkets.length,
            },
            // claimedSystems isn't a stored state key — Dashboard consumes it from this
            // response to auto-add systems to its project list.
            claimedSystems: kb.claimedSystems,
            currentShip: latestShip,
            cargoCapacity: latestCargo ? latestCargo.cargoCapacity : null,
            // Non-state payloads — the browser uses these to drive project CRUD
            // (auto-create / update / auto-complete depots) and UI state that
            // isn't part of the persisted merge (latestMarket, liveShipCargo).
            depots,
            latestMarket: currentMarket,
            shipCargo: currentCargo,
          }));
        } catch (e) {
          console.error('[SyncAll] Failed:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || String(e) }));
        }
      })();
    });
    return;
  }

  // Companion-file refresh: POST /api/refresh-companion-files
  // Manual trigger for re-reading Cargo.json and Market.json. The live watcher
  // polls these on a 5s cadence when mtimes change — this endpoint forces a read
  // regardless. Needed for iPad "refresh FC cargo" where no FSA access exists.
  if (pathname === '/api/refresh-companion-files' && req.method === 'POST') {
    try {
      const existing = readStateFile();
      const settings = existing.settings || {};
      const journalDir = resolveJournalDir(settings.journalDirOverride);
      if (!journalDirExists(journalDir)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Journal directory not found', journalDir }));
        return;
      }

      const market = readMarketJson(journalDir);
      const shipCargo = readShipCargo(journalDir);
      const patch = {};
      let marketOutcome = { type: 'none' };

      if (market && market.marketId) {
        const myCallsign = settings.myFleetCarrier || '';
        const myFcMid = settings.myFleetCarrierMarketId || null;
        const squadronCallsigns = Array.isArray(settings.squadronCarriers)
          ? settings.squadronCarriers.map((c) => c.callsign).filter(Boolean)
          : [];
        let ownerCallsign = null;
        if (myFcMid && market.marketId === myFcMid) ownerCallsign = myCallsign;
        else if (myCallsign && market.stationName === myCallsign) ownerCallsign = myCallsign;
        else if (squadronCallsigns.includes(market.stationName)) ownerCallsign = market.stationName;

        if (ownerCallsign) {
          let record;
          if (ownerCallsign === myCallsign) {
            // Own carrier: through the ledger — the market read reconciles the sell orders, the
            // ledger keeps everything else (see carrierLedger.js).
            try { ensureCarrierLedger({ journalDir, carrierId: myFcMid, callsign: myCallsign }); } catch { /* best-effort */ }
            reconcileCarrierMarket(market.items || [], market.timestamp || new Date().toISOString());
            record = carrierCargoRecord();
          } else {
            const items = (market.items || [])
              .filter((it) => it.stock > 0)
              .map((it) => {
                const def = findCommodityByDisplayName(it.nameLocalised || it.name)
                  || findCommodityByDisplayName(it.name)
                  || findCommodityByJournalName(`$${String(it.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
                return {
                  commodityId: (def && def.id) || String(it.name || '').toLowerCase(),
                  name: it.nameLocalised || (def && def.name) || it.name,
                  count: it.stock,
                };
              });
            record = {
              items,
              earliestTransfer: market.timestamp,
              latestTransfer: market.timestamp,
              updatedAt: market.timestamp || new Date().toISOString(),
              isEstimate: false,
              carrierCallsign: ownerCallsign,
            };
          }
          patch.carrierCargo = { __upsert: { [ownerCallsign]: record } };
          marketOutcome = { type: 'fc_cargo', callsign: ownerCallsign, itemCount: record.items.length };
        } else if (!isEphemeralStation(market.stationName, market.stationType, market.marketId)) {
          const commodities = (market.items || [])
            .filter((it) => it.stock > 0 && it.buyPrice > 0)
            .map((it) => {
              const def = findCommodityByDisplayName(it.nameLocalised || it.name)
                || findCommodityByDisplayName(it.name)
                || findCommodityByJournalName(`$${String(it.name || '').replace(/\s+/g, '').toLowerCase()}_name;`);
              if (!def) return null;
              return { commodityId: def.id, name: def.name, buyPrice: it.buyPrice, stock: it.stock };
            })
            .filter(Boolean);
          if (commodities.length > 0) {
            patch.marketSnapshots = {
              __upsert: {
                [String(market.marketId)]: {
                  marketId: market.marketId,
                  stationName: market.stationName,
                  systemName: market.systemName || '',
                  stationType: '',
                  commodities,
                  updatedAt: market.timestamp || new Date().toISOString(),
                },
              },
            };
            marketOutcome = { type: 'snapshot', marketId: market.marketId, stationName: market.stationName, commodityCount: commodities.length };
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        const merged = mergeStatePatch(existing, patch);
        writeStateDebounced(merged);
        broadcastEvent({ type: 'state_updated', source: 'refresh-companion-files', timestamp: new Date().toISOString() });
      }
      if (shipCargo) {
        // Ship cargo is runtime-only in zustand (not partialized) — broadcast
        // as a targeted SSE so every connected tab can update its local state.
        broadcastEvent({ type: 'ship_cargo', cargo: shipCargo, timestamp: new Date().toISOString() });
      }

      console.log(`[Refresh] market=${marketOutcome.type} ship=${shipCargo ? shipCargo.items.length + ' items' : 'null'}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        journalDir,
        market: market ? { marketId: market.marketId, stationName: market.stationName, systemName: market.systemName, timestamp: market.timestamp, itemCount: (market.items || []).length } : null,
        marketOutcome,
        shipCargo,
      }));
    } catch (e) {
      console.error('[Refresh] Failed:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Sync Market: POST /api/sync-market
  // Explicit user-triggered read of Market.json. Routes through the same
  // pollCompanionFiles used by the 5s watcher so the storage behavior is
  // identical and overlay/SSE events fire the same way.
  if (pathname === '/api/sync-market' && req.method === 'POST') {
    try {
      const existing = readStateFile();
      const settings = existing.settings || {};
      const journalDir = resolveJournalDir(settings.journalDirOverride);
      if (!journalDirExists(journalDir)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Journal directory not found', journalDir }));
        return;
      }
      const market = readMarketJson(journalDir);
      if (!market || !market.marketId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'no-market-json' }));
        return;
      }
      pollCompanionFiles(journalDir, {
        readState: readStateFile,
        applyStatePatch,
        broadcastEvent,
        sendOverlay: sendOverlayMessage,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        stationName: market.stationName,
        systemName: market.systemName,
        itemCount: (market.items || []).length,
      }));
    } catch (e) {
      console.error('[SyncMarket] Failed:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Position API: GET /api/position — latest FSDJump/Location/CarrierJump
  // from the newest journal file. Used by System View "Check journal" button.
  if (pathname === '/api/position' && req.method === 'GET') {
    try {
      const existing = readStateFile();
      const journalDir = resolveJournalDir((existing.settings || {}).journalDirOverride);
      if (!journalDirExists(journalDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ position: null, journalDir, error: 'Journal directory not found' }));
        return;
      }
      const pos = fetchLatestPositionFromJournal(journalDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ position: pos, journalDir }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Watcher status — reports whether the live server watcher is running
  if (pathname === '/api/watcher-status' && req.method === 'GET') {
    const status = getServerWatcherStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // Mining summary — live missions (with their Cr/t, which overrides market pricing), the rock
  // currently under the lasers, measured extraction rate by ring over time, and index coverage.
  if (pathname === '/api/mining/summary' && req.method === 'GET') {
    try {
      const existing = readStateFile();
      const journalDir = resolveJournalDir((existing.settings || {}).journalDirOverride);
      scanMiningMissions(journalDir);
      buildRingIndex(journalDir); // cheap when fresh (10-min gate); needed for the DSS-gap list
      const mineSet = colonySystemsOf(existing);
      const unmappedMine = getUnmappedRings(mineSet);
      const unmappedTotal = getUnmappedRings().length;
      const missions = getLiveMiningMissions();

      // Completion estimate is deliberately worst-case: CargoDepot does not fire for Mission_Mining,
      // so wing-mate contributions are invisible. Reporting this as a forecast would be a number
      // built on tonnage the journal cannot see.
      const pacing = Object.entries(missions.byCommodity).map(([key, m]) => {
        const rate = measuredRateFor(key);
        const hoursSolo = rate && rate.tonnesPerHour > 0 ? m.tonnes / rate.tonnesPerHour : null;
        return {
          key, label: m.label, tonnes: m.tonnes, crPerTonne: m.crPerTonne, expiry: m.expiry,
          wing: m.wing, measuredTonnesPerHour: rate ? rate.tonnesPerHour : null,
          hoursSoloWorstCase: hoursSolo,
          basis: rate
            ? `median of ${rate.sessions} session(s) — ${rate.tonnes}t over ${rate.hours.toFixed(1)}h actually mining`
            : 'no measured rate yet',
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        missions: missions.byCommodity,
        pacing,
        wingCaveat: 'Estimates assume you mine every tonne yourself — wing contributions are not reported for mining missions.',
        snapshot: getMiningSnapshot(),
        rateHistory: getRateHistory((k) => commodityValueNow(k, existing)).slice(0, 60),
        locations: getLocationTotals((k) => commodityValueNow(k, existing), (rec) => rockValueNow(rec, existing)),
        unmapped: { mine: unmappedMine, counts: { mine: unmappedMine.length, total: unmappedTotal } },
        // Distribution board data — same stats the catch card ranks against, served standing.
        // Filtered to the current ring's CLASS when known: icy asteroids measure ~2x metallic
        // content in this log, so a pooled backdrop made every icy prospect look far-right.
        catchStats: (() => {
          const curClass = (getMiningSnapshot().ring || {}).ringClass || null;
          const st = getCatchStats((rec) => rockValueNow(rec, existing), curClass);
          return {
            value: { hist: st.value.hist, best: st.value.best }, count: st.count,
            classApplied: st.classApplied || 'all', classRequested: st.classRequested || null,
          };
        })(),
        trophies: (() => {
          // Records price REFINED TONNAGE at today's rates — what actually came out of the rock.
          // The prospect-estimate basis (rockValueNow) belongs to the distribution board, not the
          // trophy shelf: it let a 2t-mined rock claim its full 3.9M estimate and inflated the
          // best-session record past the known all-time day.
          const gotValue = (rec) => Object.entries(rec.got || {})
            .reduce((a, [k, t]) => a + commodityValueNow(k, existing) * t, 0);
          const agg = computeAggregates(readRocks(), gotValue);
          evaluateBadges(agg); // first pass marks history as legacy; steady-state is a cheap no-op
          return { records: agg, badges: badgeStates(), streak: getStreak() };
        })(),
        // Each material carries its current Cr/t so the picker can answer "what would this even
        // pay?" — mission rate while one is live, else the commander's own market average.
        materials: (() => {
          const cat = getMaterialCatalog();
          // Keep the live cache warm for everything the picker prices (hourly TTL inside).
          try { refreshLivePrices(cat.map((m) => m.key), existing.commanderPosition && existing.commanderPosition.systemName); } catch { /* best-effort */ }
          return cat.map((m) => {
            const live = getLivePrice(m.key);
            const mission = !!missionRateFor(m.key);
            return {
              ...m,
              crPerTonne: commodityValueNow(m.key, existing) || null,
              mission,
              basis: mission ? 'mission' : (live ? 'live' : 'market'),
              liveStation: !mission && live ? `${live.station} (${live.system})` : null,
            };
          });
        })(),
        index: ringIndexStats(),
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Proximity radar snapshot — every layer, aged and radius-filtered server-side.
  if (pathname === '/api/radar/state' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(radarSnapshot()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Hotspot ground truth — the journal records no in-ring position, so the commander supplies it.
  // {live:bool} toggles stamping for rocks logged from now on; {ring, day?, hotspot, material?}
  // marks a ring/session bucket retroactively via the annotations sidecar.
  if (pathname === '/api/mining/hotspot' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        let live = null;
        if (typeof input.live === 'boolean') live = setInHotspot(input.live);
        if (input.ring) markHotspot(String(input.ring), input.day ? String(input.day) : null, input.hotspot !== false, input.material ? String(input.material) : null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ inHotspot: live, marks: getAnnotations() }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Rings seen in a body Scan but never DSS-mapped. Default scope is the commander's colony
  // systems; scope=all widens to everywhere they've scanned. Served separately from the summary
  // so the 15s summary poll doesn't ship ~500 rows nobody is looking at.
  if (pathname === '/api/mining/unmapped' && req.method === 'GET') {
    try {
      const existing = readStateFile();
      const journalDir = resolveJournalDir((existing.settings || {}).journalDirOverride);
      buildRingIndex(journalDir);
      const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
      const rings = scope === 'all' ? getUnmappedRings() : getUnmappedRings(colonySystemsOf(existing));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ scope, count: rings.length, rings }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Prospected-rock log. Append-only and uncapped, so reads are explicitly paginated.
  // Carrier baseline — the commander's own count for one commodity, from the carrier's inventory
  // screen. Anchors what the journal cannot count; a dated transaction, never an overwrite.
  if (pathname === '/api/carrier/baseline' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const existing = readStateFile();
        const settings = existing.settings || {};
        if (!settings.myFleetCarrier) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'no carrier set in Settings' })); return; }
        try { ensureCarrierLedger({ journalDir: resolveJournalDir(settings.journalDirOverride), carrierId: settings.myFleetCarrierMarketId || null, callsign: settings.myFleetCarrier }); } catch { /* best-effort */ }
        const item = setCarrierBaseline(input.commodity, input.tonnes, new Date().toISOString(), input.name || null);
        if (!item) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'commodity and a whole number of tonnes (0–25000) required' })); return; }
        const record = carrierCargoRecord();
        const merged = mergeStatePatch(existing, { carrierCargo: { __upsert: { [settings.myFleetCarrier]: record } } });
        writeStateDebounced(merged);
        broadcastEvent({ type: 'state_updated', source: 'carrier-baseline', timestamp: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, item, ledger: record.ledger }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Sell Cargo — hold + carrier priced here / locally / across the galaxy, trade nearby, history.
  if (pathname === '/api/sell/plan' && req.method === 'GET') {
    (async () => {
      try {
        const existing = readStateFile();
        const journalDir = resolveJournalDir((existing.settings || {}).journalDirOverride);
        const params = new URL(req.url, 'http://localhost').searchParams;
        const range = Math.min(500, Math.max(5, Number(params.get('range')) || 50));
        let searched = [];
        try { searched = JSON.parse(params.get('searched') || '[]'); } catch { searched = []; }
        try { backfillSales(journalDir); } catch { /* best-effort */ }
        const plan = await buildSellPlan({
          state: existing, journalDir, rangeLy: range,
          searched: Array.isArray(searched) ? searched.slice(0, 20) : [],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(plan));
      } catch (e) {
        console.error('[Sell] plan failed:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    })();
    return;
  }

  // Surface (Rhino) mining — opportunities per body + measured results per deposit.
  if (pathname === '/api/surface-mining/summary' && req.method === 'GET') {
    try {
      const existing = readStateFile();
      // Same pricing path the rock log uses: the commander's own market snapshots. The 2026-09-02
      // commodities (Helium, Olivine, Ruby, …) are not in any price source yet, so priceFn returns
      // 0 and the UI shows tonnes without a credits column rather than a fabricated value.
      const summary = getSurfaceSummary(
        (key) => {
          const v = commodityValueNow(key, existing);
          return v && v.cr > 0 ? v.cr : 0;
        },
        // Nav locks name bodies by BodyID; scans made before the ledger stored ids resolve here.
        (systemAddress, bodyId) => resolveBodyNameById(existing, systemAddress, bodyId),
        // Best sell among the commander's own visited markets — where a station pays 185% of mean.
        (name) => bestSellFromSnapshots(existing, name),
      );

      // Attach each F10 marker to the shot that produced it. recordGameScreenshot already copied
      // the image into the gallery, so the picture of the deposit panel — the one thing that
      // actually states commodity / mineral amount / density — is on disk and addressable. The
      // commander tags from the photo instead of remembering.
      const meta = readGalleryMeta();
      const attachImage = (m) => {
        if (!m.body || !m.system) return m;
        const entries = meta[galleryKeyFor(m.system, m.body)];
        if (!Array.isArray(entries) || !entries.length) return m;
        // Filename first; it is exact. A deposit may carry several (every F10 taken inside its
        // cluster); a lone marker carries one. Time proximity is only a fallback, and only within
        // two minutes — and it compares against addedAt, which for a shot adopted at boot is the
        // adoption time, not the shot time, so it is deliberately the last resort.
        const files = Array.isArray(m.files) && m.files.length ? m.files : (m.file ? [m.file] : []);
        let hit = null;
        for (const f of files) {
          const base = path.basename(String(f || '').replace(/\\/g, '/'));
          hit = base ? entries.find((e) => e.caption === base) : null;
          if (hit) break;
        }
        if (!hit) {
          const at = Date.parse(m.at || m.firstAt);
          if (Number.isFinite(at)) hit = entries.find((e) => Math.abs(Date.parse(e.addedAt) - at) <= 120000) || null;
        }
        if (!hit) return m;
        // A photo inside a WORKED deposit is deposit documentation by construction — it sits within
        // 300m of a rig you emptied. Flag it utility so it stays out of the place galleries, the
        // same as a promoted marker. Idempotent, so repeating it on every read costs nothing.
        if ((m.tonnes || 0) > 0 && (!hit.utility || /\.bmp$/i.test(hit.url || ''))) flagGalleryUtility(hit.id);
        return { ...m, imageUrl: hit.url, imageId: hit.id };
      };
      summary.marks = (summary.marks || []).map(attachImage);
      summary.deposits = (summary.deposits || []).map(attachImage);

      // The hull you are flying, for the landing ratings: the journal's Loadout, named from the ship
      // table, pad size from the table or the commander's one-time answer. Never typed, never guessed.
      const cs = existing.currentShip || null;
      const csType = cs && cs.type ? String(cs.type).toLowerCase() : null;
      summary.ship = csType
        ? { type: csType, name: friendlyShip(csType), size: padSizeFor(csType) || hullSizeFor(csType) || null }
        : null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e && e.message }));
    }
    return;
  }

  // Deposit tagging — MINERAL AMOUNT / DENSITY exist only on the in-game HUD, so the commander
  // supplies them. Same ground-truth pattern as the ring hotspot marks.
  if (pathname === '/api/surface-mining/annotate' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        if (!input.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id required' }));
          return;
        }
        const marks = markDeposit(String(input.id), input);
        // Naming what a marker yields declares it a deposit photo, so it stops being a candidate
        // for the system's representative image.
        const flagged = input.commodity && input.imageId ? flagGalleryUtility(String(input.imageId)) : false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, marks, imageFlagged: flagged }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // "I targeted it, read Uranium, decided not to drive to it." The panel names the commodity at
  // targeting range (amount and density only up close), so a sighting is real information — and
  // without it the ledger records only what was mined, implying a body carries whatever you
  // happened to work first.
  // Live state for the hero band and the target strip — polled every few seconds, so it stays
  // cheap: no ledger read, just module state plus one Status.json read. The nav lock's BodyID is
  // resolved to a name here because the page needs "Site 4 of 9 · 1 a", not "Body 14".
  if (pathname === '/api/surface-mining/snapshot' && req.method === 'GET') {
    try {
      const snap = getSurfaceSnapshot();
      if (snap.lock && snap.lock.bodyId != null) {
        const existing = readStateFile();
        // A copy — snap.lock IS the module's live lock object. Writing the name into it made it
        // "stick" only until the next site replaced the object, and the summary's own snapshot
        // never had it, so the page flipped between "1 a" and "Body 14".
        snap.lock = {
          ...snap.lock,
          body: bodyNameFromLedger(snap.lock.systemAddress, snap.lock.bodyId)
            || resolveBodyNameById(existing, snap.lock.systemAddress, snap.lock.bodyId) || null,
        };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snap));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // "I know where I am." Sets the current site by hand when the game did not say — a drop without
  // a nav lock, or made while the exe was closed. Writes a manual drop record, so tonnage already
  // pulled this visit re-files under the site as well as everything that follows.
  if (pathname === '/api/surface-mining/site' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const rec = setCurrentSite(input);
        if (!rec) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'siteIndex (a number) and a body are required — the body comes from Status.json if you are on one' }));
          return;
        }
        broadcastEvent({ type: 'surface_drop', timestamp: rec.at, body: rec.body, bodyId: rec.bodyId, siteIndex: rec.siteIndex, label: rec.navLabel, lat: rec.lat, lon: rec.lon, manual: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, drop: rec }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  if (pathname === '/api/surface-mining/sight' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const ok = recordSighting(input);
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        // exists: already tagged or already pulled at that site — nothing written, and the page says so.
        res.end(JSON.stringify(ok ? { ok: true, exists: ok === 'exists' } : { error: 'body and commodity required' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Site count typed from the system map — the number the journal withholds until a DSS.
  if (pathname === '/api/surface-mining/site-count' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const ok = recordSiteCount(input);
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true } : { error: 'body and a site count required' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Remove a deposit photo once its information has been logged. The gallery copy always goes; the
  // original F10 screenshot in the game's folder only when asked, and only a file a marker record
  // named (the gallery caption is that filename) — never an arbitrary path. The ledger keeps the
  // position, site, commodity, amount, density and the marker's filename as provenance.
  if (pathname === '/api/surface-mining/photo/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const imageId = String(input.imageId || '');
        if (!imageId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'imageId required' }));
          return;
        }
        const meta = readGalleryMeta();
        let entry = null;
        for (const key of Object.keys(meta)) {
          const arr = meta[key];
          if (!Array.isArray(arr)) continue;
          const i = arr.findIndex((e) => e && e.id === imageId);
          if (i >= 0) { entry = arr[i]; arr.splice(i, 1); if (!arr.length) delete meta[key]; }
        }
        const removed = { gallery: false, original: false };
        if (entry) {
          writeGalleryMeta(meta);
          const file = entry.url ? path.basename(String(entry.url)) : null;
          if (file) { try { fs.unlinkSync(path.join(GALLERY_DIR, file)); removed.gallery = true; } catch { /* already gone */ } }
          if (input.original) {
            const base = entry.caption ? path.basename(String(entry.caption).replace(/\\/g, '/')) : '';
            if (base && isRecordedScreenshot(base)) {
              try { fs.unlinkSync(path.join(ED_PICTURES_DIR, base)); removed.original = true; } catch { /* already gone */ }
            }
          }
        }
        res.writeHead(entry ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entry ? { ok: true, removed } : { error: 'no such photo' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // The compass target: a deposit, the ship, a recall spot — or clear it. Steering happens on the
  // watcher tick (tickCompass) and reaches the overlay, the page and the Companion.
  if (pathname === '/api/surface-mining/target' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        if (input.clear) {
          clearNavTarget();
          broadcastEvent({ type: 'surface_compass', timestamp: new Date().toISOString(), cleared: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, cleared: true }));
          return;
        }
        const t = setNavTarget(input);
        res.writeHead(t ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(t ? { ok: true, target: t } : { error: 'lat and lon (numbers) required' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // A named point at the commander's own position (a brain-tree grove, a hazard, anything the game
  // never writes) — or remove one.
  if (pathname === '/api/surface-mining/pin' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        if (input.remove) {
          removePin(String(input.remove));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        const pin = addPin(input);
        res.writeHead(pin ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pin ? { ok: true, pin } : { error: 'lat, lon and body required — stand on the surface first' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Pad size for a hull the ship table does not know — the commander's one-time answer.
  if (pathname === '/api/surface-mining/hull-size' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const ok = setHullSize(input.shipType, input.size);
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true } : { error: 'shipType and size S/M/L required' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // Take a tag back (append-only retraction) / rate a signal (landing in a hull, driving).
  if ((pathname === '/api/surface-mining/unsight' || pathname === '/api/surface-mining/rate') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {};
        if (pathname.endsWith('/rate')) {
          // The hull is the journal's, never typed: name from the ship table, pad size from the
          // table or the commander's one-time answer for hulls the table does not know.
          const shipType = input.shipType ? String(input.shipType).toLowerCase() : null;
          input.ship = shipType ? friendlyShip(shipType) : null;
          input.size = shipType ? (padSizeFor(shipType) || hullSizeFor(shipType) || null) : null;
        }
        const ok = pathname.endsWith('/rate') ? recordRating(input) : retractSighting(input);
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ok ? { ok: true } : { error: pathname.endsWith('/rate') ? 'body, siteIndex and a landing or driving score 1-5 required' : 'body, siteIndex and commodity required' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  if (pathname === '/api/surface-mining/backfill' && req.method === 'POST') {
    try {
      const st = readStateFile();
      const jd = resolveJournalDir((st.settings || {}).journalDirOverride);
      const out = backfillSurfaceMining(jd, listJournalFiles);
      const adopted = adoptOrphanSurfaceShots(jd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...out, adopted }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e && e.message }));
    }
    return;
  }

  if (pathname === '/api/mining-log' && req.method === 'GET') {
    try {
      flushMiningLog();
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 2000);
      const ring = url.searchParams.get('ring');
      const existing = readStateFile();
      let rows = readRocks();
      if (ring) rows = rows.filter((r) => r.ring === ring);
      const total = rows.length;
      // Re-price both columns at today's market before serving. estValue and gotValue were written
      // at prospect/refine time, and rows logged before 2026-08-28 have a live MISSION rate baked
      // in (~136k/t Bromellite against ~36k at market) — so serving them raw puts two currencies in
      // one table and makes the history incomparable. Purely a currency conversion: the stored
      // tonnes are untouched, only the price applied to them changes. Copied, never mutated in
      // place, because readRocks() hands back its own cache.
      const priced = rows.slice(-limit).reverse().map((r) => ({
        ...r,
        estValue: (r.mats || []).reduce((a, m) => a + (m.est || 0) * commodityValueNow(m.k, existing), 0),
        gotValue: Object.entries(r.got || {}).reduce((a, [k, t]) => a + commodityValueNow(k, existing) * t, 0),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total, returned: priced.length, rocks: priced }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Ring finder. Two sources with different strengths, merged and labelled:
  //   journal — only rings this commander has DSS-mapped, but joinable to what they actually
  //             extracted there, which is the only non-speculative quality signal available.
  //   spansh  — galaxy-wide discovery for rings never visited.
  if (pathname === '/api/mining/rings' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const targets = Array.isArray(input.targets) ? input.targets : [];
        if (!targets.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ rings: [], note: 'No targets set.' }));
          return;
        }
        const existing = readStateFile();
        const journalDir = resolveJournalDir((existing.settings || {}).journalDirOverride);
        const pos = existing.commanderPosition || {};
        const origin = pos.coordinates || null;

        buildRingIndex(journalDir);

        // Measured tonnes/hour per ring — outranks every inferred signal in the ranking.
        const measuredByRing = {};
        for (const h of getRateHistory()) {
          if (!h.tonnesPerHour) continue;
          const cur = measuredByRing[h.ring];
          if (!cur || h.tonnesPerHour > cur.tonnesPerHour) measuredByRing[h.ring] = h;
        }

        const journalRings = findRingsForTargets(targets, origin, { measuredByRing });

        let spanshRings = [];
        if (input.includeSpansh !== false && origin) {
          // Spansh uses full internal names; the journal abbreviates ("Low Temp. Diamonds").
          const spanshNames = targets.map((t) => (commodityKey(t) === 'lowtemperaturediamond' ? 'Low Temperature Diamonds' : t));
          const seen = new Set(journalRings.map((r) => r.ring));
          const wantKeys = new Set(targets.map(commodityKey));

          // ONE QUERY PER TARGET, merged. Spansh's ring_signals filter is AND across entries —
          // verified 2026-07-22: [Bromellite] returns 10,000 rings, [Bromellite, Osmium] returns 0,
          // because Osmium is not a ring-hotspot type at all. A combined query therefore silently
          // returned nothing whenever a target wasn't a hotspot commodity, while the journal side
          // (which ORs) still produced hits — so the finder looked like it worked and quietly hid
          // every Spansh result. Querying separately matches the journal's OR semantics.
          const raw = [];
          for (const name of spanshNames) {
            const hits = await searchRingsBySignals([name], origin, { size: 25 });
            raw.push(...hits);
          }
          for (const b of raw) {
            for (const ring of (b.rings || [])) {
              if (!ring.signals || seen.has(ring.name)) continue;
              const hits = ring.signals
                .filter((s) => wantKeys.has(commodityKey(s.name)))
                .map((s) => ({ key: commodityKey(s.name), label: s.name, count: s.count }));
              if (!hits.length) continue;
              seen.add(ring.name);
              spanshRings.push({
                source: 'spansh',
                ring: ring.name,
                system: b.system_name || '',
                ringClass: ring.type || '',
                reserve: b.reserve_level || '',
                depthLs: b.distance_to_arrival != null ? Math.round(b.distance_to_arrival) : null,
                distanceLy: b.distance != null ? b.distance : null,
                hits,
                hitCount: hits.reduce((a, h) => a + h.count, 0),
                other: ring.signals.filter((s) => !wantKeys.has(commodityKey(s.name))).map((s) => s.name),
              });
            }
          }
        }

        // Rank the COMBINED list — journal and Spansh rows must compete on one scale, otherwise a
        // distant journal ring would always outrank a closer Spansh one purely by source order.
        const ranked = rankRings(journalRings.concat(spanshRings), { measuredByRing });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          rings: ranked,
          origin: pos.systemName || null,
          counts: { journal: journalRings.length, spansh: spanshRings.length },
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    });
    return;
  }

  // War & Peace API: POST /api/war-peace/search
  // Proxy a Spansh systems-search query for systems in conflict (War / Civil War / Election)
  // near a reference system. Caches per filter-hash until the next BGS tick (Thursday 07:00 UTC)
  // since faction states only change weekly. Optional minor-faction-allegiance post-filter for
  // catching conflicts where the controlling faction isn't aligned with the desired power.
  if (pathname === '/api/war-peace/search' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body || '{}');
        const referenceSystem = String(params.referenceSystem || '').trim();
        const radius = Number(params.radius) || 100;
        const states = Array.isArray(params.states) && params.states.length > 0
          ? params.states
          : ['War', 'Civil War'];
        const allegiances = Array.isArray(params.allegiances) && params.allegiances.length > 0
          ? params.allegiances
          : null;
        // Optional post-filter: keep only systems where ≥1 conflict-state faction has matching allegiance
        const combatantAllegiances = Array.isArray(params.combatantAllegiances) && params.combatantAllegiances.length > 0
          ? new Set(params.combatantAllegiances)
          : null;
        const minPopulation = Number(params.minPopulation) || 0;
        const size = Math.min(Number(params.size) || 100, 200);
        if (!referenceSystem) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'referenceSystem required' }));
          return;
        }

        // Spansh's reference_system field is case-sensitive — "aleumoxii" returns 400 but
        // "Aleumoxii" works. Resolve to canonical case via a name-search first (which IS
        // case-insensitive). Cached server-side so repeat lookups are cheap.
        const canonicalRef = await resolveSystemName(referenceSystem);
        if (!canonicalRef) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Reference system "${referenceSystem}" not found in Spansh` }));
          return;
        }

        const cacheKey = JSON.stringify({ referenceSystem: canonicalRef, radius, states, allegiances, size });
        const cached = warPeaceCache.get(cacheKey);
        const now = Date.now();
        // Tick-based validity: an entry is fresh while the galaxy tick hasn't moved since it was
        // fetched — faction states only change on the tick. Falls back to the time-based expiry
        // when the tick service is unavailable (or for entries cached before it answered).
        const nowTick = getGalaxyTick();
        const cacheValid = cached && ((nowTick && cached.tick) ? cached.tick === nowTick : cached.expiresAt > now);
        if (cacheValid) {
          // Even on cache hit, post-filter (combatantAllegiances/minPopulation) at request time
          // — these don't affect the upstream query, just trim the cached response.
          const filtered = filterWarPeaceResults(cached.results, { combatantAllegiances, minPopulation });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            count: filtered.length,
            cached: true,
            cachedAt: cached.cachedAt,
            expiresAt: cached.expiresAt,
            results: filtered,
          }));
          return;
        }

        const spanshFilters = {
          controlling_minor_faction_state: { value: states },
          distance: { min: '0', max: String(radius) },
        };
        if (allegiances) spanshFilters.allegiance = { value: allegiances };

        const spanshBody = {
          filters: spanshFilters,
          sort: [{ distance: { direction: 'asc' } }],
          size,
          page: 0,
          reference_system: canonicalRef,
        };

        const spanshRes = await fetch('https://spansh.co.uk/api/systems/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'ed-colony-tracker/war-peace' },
          body: JSON.stringify(spanshBody),
        });

        if (!spanshRes.ok) {
          const text = await spanshRes.text().catch(() => '');
          res.writeHead(spanshRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `spansh ${spanshRes.status}: ${text.slice(0, 200)}` }));
          return;
        }

        const spanshJson = await spanshRes.json();
        const allResults = Array.isArray(spanshJson.results) ? spanshJson.results : [];
        // Cache the full result set (without combatant/population post-filter — those vary per request)
        const expiresAt = nextBgsTick(now);
        warPeaceCache.set(cacheKey, { results: allResults, cachedAt: now, expiresAt, tick: getGalaxyTick() });
        const filtered = filterWarPeaceResults(allResults, { combatantAllegiances, minPopulation });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          count: filtered.length,
          cached: false,
          cachedAt: now,
          expiresAt,
          totalUpstream: spanshJson.count,
          results: filtered,
        }));
      } catch (e) {
        console.error('[WarPeace] error:', e && e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e && e.message }));
      }
    });
    return;
  }

  // War & Peace scout: POST /api/war-peace/scout
  // Per-system enriched conflict report. Fetches Spansh dump (full station/body detail)
  // and EDSM factions (live state), synthesizes into a ScoutReport, persists into
  // state.scoutedConflicts (keyed by systemAddress). Cache TTL = next BGS tick.
  if (pathname === '/api/war-peace/scout' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body || '{}');
        const systemName = String(params.systemName || '').trim();
        if (!systemName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'systemName required' }));
          return;
        }

        // Fetch in parallel: Spansh search (1 system) + EDSM factions
        const [spanshRes, edsmRes] = await Promise.allSettled([
          fetch('https://spansh.co.uk/api/systems/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'ed-colony-tracker/scout' },
            body: JSON.stringify({
              filters: { name: { value: systemName } },
              size: 1,
              page: 0,
            }),
          }).then((r) => r.json()),
          fetch(`https://www.edsm.net/api-system-v1/factions?systemName=${encodeURIComponent(systemName)}&showHistory=0`, {
            headers: { 'User-Agent': 'ed-colony-tracker/scout' },
          }).then((r) => r.json()),
        ]);

        const spanshSys = spanshRes.status === 'fulfilled' && spanshRes.value && Array.isArray(spanshRes.value.results) && spanshRes.value.results[0]
          ? spanshRes.value.results[0]
          : null;
        const edsmData = edsmRes.status === 'fulfilled' && edsmRes.value && edsmRes.value.factions
          ? edsmRes.value
          : null;

        if (!spanshSys && !edsmData) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'system not found in Spansh or EDSM' }));
          return;
        }

        const report = buildScoutReport(systemName, spanshSys, edsmData);

        // Persist into state.scoutedConflicts (append-only keyed map)
        if (report.systemAddress) {
          const patch = {
            scoutedConflicts: { __upsert: { [String(report.systemAddress)]: report } },
          };
          applyStatePatch(patch);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, report }));
      } catch (e) {
        console.error('[WarPeaceScout] error:', e && e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e && e.message }));
      }
    });
    return;
  }

  // Log API: POST /api/log — print client log messages to the server terminal
  if (pathname === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { tag, message } = JSON.parse(body);
        const t = new Date().toISOString().substring(11, 19);
        console.log(`[${t}] [${tag || 'Client'}] ${message}`);
      } catch { /* ignore bad payloads */ }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  // Exploration checklist: current-system snapshot + manual skip toggle
  if (pathname === '/api/checklist' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checklistSnapshot()));
    return;
  }
  if (pathname === '/api/checklist/skip' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { bodyId, skipped } = JSON.parse(body || '{}');
        if (!checklistSetSkipped(bodyId, skipped)) throw new Error('No such target');
        broadcastEvent({ type: 'checklist_update', ...checklistSnapshot() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Worth doing HERE — scoped to the system the commander is standing in, ordered by distance from
  // the arrival star. Domain-wide this list is 60+ entries and unreadable on a second screen.
  if (pathname === '/api/domain/tasks' && req.method === 'GET') {
    try {
      const st = readStateFile();
      const system = url.searchParams.get('system') || st.commanderPosition?.systemName || '';
      const rings = getUnmappedRings(colonySystemsOf(st));
      const out = buildDomainTasks(st, rings, readGalleryMeta(), { system });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // Dismissal is PERMANENT and one-way. There is no un-dismiss endpoint by design: "I may never do
  // them" was the requirement, so a dismissed task must never resurface on a rescan or a rebuild.
  if (pathname === '/api/domain/tasks/dismiss' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        const clean = String(id || '').trim();
        if (!clean) throw new Error('Task id required');
        applyStatePatch({ dismissedTasks: { __upsert: { [clean]: { at: new Date().toISOString() } } } });
        console.log(`[DomainTasks] Dismissed ${clean}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ dismissed: clean }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // What the ground you hold actually yields. Domain systems only — galaxy-wide ring hunting is
  // the mining page's ring finder, and a better ring elsewhere is not an answer to this question.
  if (pathname === '/api/domain/rings' && req.method === 'GET') {
    try {
      const st = readStateFile();
      const rings = getRingsInSystems(colonySystemsOf(st));
      const stats = ringIndexStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        rings,
        // Stated, not hidden: a thin sample is a fact about the survey, not about the ground.
        mappedInDomain: rings.length,
        mappedTotal: stats.rings,
        unmappedInDomain: getUnmappedRings(colonySystemsOf(st)).length,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
    return;
  }

  // ---- Colonization Threats -------------------------------------------------------------
  // Systems the commander flagged as theirs to lose, and what is being colonised within 50 ly of
  // each. Flags are cheap to recreate (a name), so watchedSystems is deliberately NOT append-only:
  // unflagging has to actually work.

  if (pathname === '/api/threats' && req.method === 'GET') {
    const st = readStateFile();
    const watched = Object.values(st.watchedSystems || {})
      .filter(Boolean)
      // Worst first: taken, then closest threat, then everything quiet.
      .sort((a, b) => {
        const rank = (w) => (w.status === 'taken' ? 0 : w.status === 'threatened' ? 1 : 2);
        return rank(a) - rank(b) || (a.nearestLy ?? 1e9) - (b.nearestLy ?? 1e9);
      });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ watched, radiusLy: 50 }));
    return;
  }

  // Flag a system. Carries the commander's own score across from scoutedSystems when they have
  // one, so the list reads in their terms rather than as bare names.
  if (pathname === '/api/threats' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { name, note } = JSON.parse(body || '{}');
        const clean = String(name || '').trim();
        if (!clean) throw new Error('System name required');
        const st = readStateFile();
        const already = Object.values(st.watchedSystems || {})
          .find((w) => w && String(w.name).toLowerCase() === clean.toLowerCase());
        if (already) throw new Error(`${clean} is already flagged`);

        const scouted = Object.values(st.scoutedSystems || {})
          .find((s) => s && String(s.name).toLowerCase() === clean.toLowerCase());
        const rec = {
          id: `watch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: scouted ? scouted.name : clean, // prefer the canonical casing on file
          score: scouted?.score?.total ?? null,
          coordinates: scouted?.coordinates ?? null,
          note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : undefined,
          addedAt: new Date().toISOString(),
          status: 'unchecked',
          nearestLy: null,
          nearestName: null,
          threatCount: 0,
        };
        applyStatePatch({ watchedSystems: { __upsert: { [rec.id]: rec } } });
        console.log(`[Threats] Flagged ${rec.name}${rec.score != null ? ` (score ${rec.score})` : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rec));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/threats' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id required' }));
      return;
    }
    applyStatePatch({ watchedSystems: { __remove: [id] } });
    console.log(`[Threats] Unflagged ${id}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ removed: id }));
    return;
  }

  // Re-check every flag against Spansh. Alerts describe what CHANGED, so a quiet galaxy is silent.
  if (pathname === '/api/threats/refresh' && req.method === 'POST') {
    (async () => {
      try {
        const st = readStateFile();
        // Backfill coordinates from the scouted pool. A flag may predate scouting the system, or
        // have been typed in by hand — and coordinates are what let the check work at all for
        // systems Spansh's search index does not carry.
        const scoutedByName = new Map();
        for (const s of Object.values(st.scoutedSystems || {})) {
          if (s && s.name) scoutedByName.set(String(s.name).toLowerCase(), s);
        }
        const watched = Object.values(st.watchedSystems || {}).filter(Boolean).map((w) => {
          if (w.coordinates || !w.name) return w;
          const s = scoutedByName.get(String(w.name).toLowerCase());
          if (!s || !s.coordinates) return w;
          return { ...w, coordinates: s.coordinates, score: w.score ?? s.score?.total ?? null };
        });
        if (!watched.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ watched: [], alerts: [], checked: 0 }));
          return;
        }
        const { report, alerts } = await assessThreats(watched, colonySystemsOf(st));
        const upsert = {};
        for (const r of report) if (r && r.id) upsert[r.id] = r;
        if (Object.keys(upsert).length) applyStatePatch({ watchedSystems: { __upsert: upsert } });

        for (const a of alerts) {
          broadcastEvent({ type: 'colonization_threat', ...a, timestamp: new Date().toISOString() });
          const where = a.nearest ? ` — ${a.nearest} at ${a.distanceLy?.toFixed(1)} ly (~${a.hops} hop${a.hops === 1 ? '' : 's'})` : '';
          console.log(`[Threats] ${a.kind.toUpperCase()} ${a.system}${where}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ watched: report, alerts, checked: report.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
    })();
    return;
  }

  // Sightings: GET list (newest first)
  if (pathname === '/api/sightings' && req.method === 'GET') {
    const st = readStateFile();
    const list = Object.values(st.sightings || {})
      .filter(Boolean)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sightings: list }));
    return;
  }
  // Sightings: POST { tags, note? } — location is snapshotted SERVER-side, so the
  // 2nd-screen button needs to know nothing. Adopts recent F10 shots from the same
  // system (±10 min) recorded before the button press.
  if (pathname === '/api/sightings' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { tags, note } = JSON.parse(body || '{}');
        if (!Array.isArray(tags) || tags.length === 0) throw new Error('Pick at least one tag');
        const st = readStateFile();
        const pos = st.commanderPosition;
        if (!pos || !pos.systemName) throw new Error('Commander position unknown — jump or relog first');
        // Trust currentBody only when it belongs to the system we're actually in.
        const cb = st.currentBody && st.currentBody.systemAddress === pos.systemAddress ? st.currentBody : null;
        const rec = {
          id: `sight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          systemName: pos.systemName,
          systemAddress: pos.systemAddress ?? null,
          bodyName: cb ? cb.bodyName : null,
          coordinates: pos.coordinates || null,
          tags: tags.map(String).slice(0, 12),
          note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : undefined,
          galleryKey: galleryKeyFor(pos.systemName, cb ? cb.bodyName : null),
          recordedAt: new Date().toISOString(),
          autoShots: 0,
        };
        // Adopt F10 shots taken just before the button press (same system, in window).
        const now = Date.now();
        for (const shot of recentGameShots) {
          if (shot.system !== pos.systemName) continue;
          if (now - shot.ts > SIGHTING_ATTACH_WINDOW_MS) continue;
          if (moveGalleryImage(shot.imageId, shot.key, rec.galleryKey) || shot.key === rec.galleryKey) {
            shot.key = rec.galleryKey;
            rec.autoShots++;
          }
        }
        applyStatePatch({ sightings: { __upsert: { [rec.id]: rec } } });
        broadcastEvent({ type: 'sighting_recorded', id: rec.id, system: rec.systemName, body: rec.bodyName, tags: rec.tags, autoShots: rec.autoShots, timestamp: rec.recordedAt });
        console.log(`[Sightings] Recorded ${rec.bodyName || rec.systemName} [${rec.tags.join(', ')}]${rec.autoShots ? ` +${rec.autoShots} F10 shot(s)` : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rec));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Sightings: PATCH { id, tags?, note? } — edit a card from the wall. Tags replace
  // (the UI sends the full chip set), note replaces ('' clears it). Photos are not
  // touched — they belong to the location, not the sighting.
  if (pathname === '/api/sightings' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { id, tags, note } = JSON.parse(body || '{}');
        const st = readStateFile();
        const existing = (st.sightings || {})[id];
        if (!existing) throw new Error('Sighting not found');
        const rec = { ...existing };
        if (tags !== undefined) {
          if (!Array.isArray(tags) || tags.length === 0) throw new Error('Pick at least one tag');
          rec.tags = tags.map(String).slice(0, 12);
        }
        if (note !== undefined) {
          const trimmed = String(note).trim();
          if (trimmed) rec.note = trimmed.slice(0, 500); else delete rec.note;
        }
        applyStatePatch({ sightings: { __upsert: { [id]: rec } } });
        broadcastEvent({ type: 'sighting_updated', id, tags: rec.tags, timestamp: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rec));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  // Sightings: DELETE /api/sightings/:id — remove a card. sightings is append-only
  // for state PATCHes (stale-baseline protection), so deletion goes through this
  // dedicated endpoint with a direct mutation. Photos stay — they belong to the place.
  if (pathname.startsWith('/api/sightings/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.slice('/api/sightings/'.length));
    // pendingState-aware read, same rule as applyStatePatch — otherwise a delete
    // racing a debounced write would resurrect from stale disk data.
    const st = pendingState ?? readStateFile();
    if (st.sightings && st.sightings[id]) {
      delete st.sightings[id];
      writeStateDebounced(st);
      broadcastEvent({ type: 'sighting_deleted', id, timestamp: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: id }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sighting not found' }));
    }
    return;
  }

  // Gallery API: GET /api/gallery — returns metadata
  if (pathname === '/api/gallery' && req.method === 'GET') {
    const meta = readGalleryMeta();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(meta));
    return;
  }

  // Gallery API: PATCH /api/gallery — save metadata
  if (pathname === '/api/gallery' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        writeGalleryMeta(incoming);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gallery API: POST /api/gallery/upload — upload image (base64 body)
  if (pathname === '/api/gallery/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { dataUrl } = JSON.parse(body);
        // Extract base64 data from data URL
        const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) throw new Error('Invalid data URL');
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const buf = Buffer.from(match[2], 'base64');
        const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const filename = `${id}.${ext}`;
        fs.writeFileSync(path.join(GALLERY_DIR, filename), buf);
        console.log(`[Gallery] Saved ${filename} (${(buf.length / 1024).toFixed(0)}KB)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, filename, url: `/gallery-images/${filename}` }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gallery API: DELETE /api/gallery/:filename — delete image file
  if (pathname.startsWith('/api/gallery/') && req.method === 'DELETE') {
    const filename = pathname.slice('/api/gallery/'.length);
    const filePath = path.join(GALLERY_DIR, path.basename(filename));
    try { fs.unlinkSync(filePath); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve gallery images (no token needed — like static files)
  if (pathname.startsWith('/gallery-images/')) {
    const filename = path.basename(pathname.slice('/gallery-images/'.length));
    const filePath = path.join(GALLERY_DIR, filename);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.png' ? 'image/png'
        : ext === '.bmp' ? 'image/bmp' // F10 in-game screenshots are uncompressed BMPs
        : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }

  // Serve co-pilot character art (no token — like gallery images). Files live
  // under copilot-characters/<packId>/<mood>.png (+ cockpit.png, pack.json).
  if (pathname.startsWith('/copilot-art/')) {
    const rel = pathname.slice('/copilot-art/'.length).split('/').filter(Boolean).map((s) => path.basename(s));
    const filePath = path.join(COPILOT_DIR, ...rel);
    // Portraits get REPLACED in place (a new mood, a recast character), and a plain max-age meant
    // a device kept serving the old face for an hour — closing the browser does not help, which is
    // how a replaced Wren stayed male on the iPad. Revalidate instead: the ETag is mtime+size, so
    // an unchanged file still costs one 304 and no download, and a changed one appears at once.
    let st = null;
    try { st = fs.statSync(filePath); } catch { res.writeHead(404); res.end('Not found'); return; }
    const etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      // 'no-cache' means revalidate before reuse — NOT "do not store".
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', ETag: etag });
      res.end(data);
    });
    return;
  }

  // List installed co-pilot character packs (no token — populates the picker).
  if (pathname === '/copilot-characters' && req.method === 'GET') {
    let packs = [];
    try {
      packs = fs.readdirSync(COPILOT_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          let name = d.name;
          try {
            const mf = JSON.parse(fs.readFileSync(path.join(COPILOT_DIR, d.name, 'pack.json'), 'utf8'));
            if (mf && mf.name) name = String(mf.name);
          } catch { /* no manifest — use folder name */ }
          return { id: d.name, name };
        });
    } catch { /* dir missing — empty list */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(packs));
    return;
  }

  // Rate a co-pilot line (👍 +1 / 👎 -1) — feeds the corpus promote/prune engine. No token.
  if (pathname === '/copilot-rate' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let ok = false;
      try { const { id, rating, reason, comment } = JSON.parse(body || '{}'); ok = captureStore.rate(id, rating, reason, comment); } catch { /* bad body */ }
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    });
    return;
  }

  // Store a Q&A answer (durable/session/goal) — builds the co-pilot's model of the commander
  // for callbacks. "not now" sends nothing; "it's complicated" sends value 'complicated'. No token.
  if (pathname === '/copilot-answer' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let ok = false;
      try { const { layer, learnKey, value, label, question } = JSON.parse(body || '{}'); ok = recordAnswer(layer, learnKey, { value, label, question }); } catch { /* bad body */ }
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
    });
    return;
  }

  // "What's on your mind?" — fire an on-demand live line; it returns via SSE. No token.
  if (pathname === '/copilot-ask' && req.method === 'POST') {
    runOnDemand(readStateFile(), { broadcastEvent, captureLine: captureStore.capture })
      .catch((e) => console.error('[Copilot] on-demand failed:', e && e.message));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // "What's the news?" — fetch a real GalNet headline + the co-pilot's take; returns via SSE.
  if (pathname === '/copilot-news' && req.method === 'POST') {
    runNews(readStateFile(), { broadcastEvent, captureLine: captureStore.capture })
      .catch((e) => console.error('[Copilot] news failed:', e && e.message));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // TARS trivia — a round of multiple-choice questions (personal-data + astronomy). No token.
  if (pathname === '/copilot-trivia' && req.method === 'GET') {
    let round = [];
    try { round = buildTriviaRound(readStateFile(), 6); } catch (e) { console.error('[Copilot] trivia:', e && e.message); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ questions: round, history: getQuizHistory() }));
    return;
  }

  // Speak a line the co-pilot already said. Addressed by ID — never by text — so a LAN device
  // cannot hand the synthesiser arbitrary words. 404 when the line has aged out of the register
  // or speech isn't available on this machine; the client just stays quiet either way.
  if (pathname === '/copilot-voice' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    const asked = url.searchParams.get('persona');
    const persona = Object.prototype.hasOwnProperty.call(PROFILES, asked) ? asked : DEFAULT_PERSONA;
    const entry = id ? lookupLine(id) : null;
    if (!voiceAvailable() || !entry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no audio for that line' }));
      return;
    }
    synthesize(entry.line, persona, entry.mood).then((out) => {
      if (!out) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'synthesis unavailable' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': out.wav.length,
        'Cache-Control': 'no-store',
        // How to play it: the tape-speed shift, and whether this persona is on a mic.
        'X-Voice-Playback-Rate': String(out.playbackRate),
        'X-Voice-Filter': out.filter ? '1' : '0',
      });
      res.end(out.wav);
    }).catch((e) => {
      console.error('[CopilotVoice] synthesis error:', e && e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'synthesis failed' }));
    });
    return;
  }

  // Record a finished trivia round (score/total) into copilot-memory for the history. No token.
  if (pathname === '/copilot-trivia-result' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let ok = false;
      try { const { score, total } = JSON.parse(body || '{}'); ok = recordQuiz(score, total); } catch { /* bad body */ }
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok, history: getQuizHistory() }));
    });
    return;
  }

  // SSE: GET /api/events — live event stream for Companion page
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
    sseClients.push(res);
    const remoteAddr = req.socket.remoteAddress || 'unknown';
    console.log(`[SSE] client connected from ${remoteAddr} → ${sseClients.length} total`);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx >= 0) sseClients.splice(idx, 1);
      console.log(`[SSE] client disconnected from ${remoteAddr} → ${sseClients.length} total`);
    });
    return;
  }

  // Events ingress: POST /api/events — journal watcher pushes events here
  if (pathname === '/api/events' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        event.timestamp = event.timestamp || new Date().toISOString();
        broadcastEvent(event);
        // If event has overlay data, also send to in-game overlay
        if (event.overlay) {
          sendOverlayMessage(event.overlay);
        }
      } catch (e) {
        console.error('[Events] Parse error:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Overlay endpoint
  if (pathname === '/overlay' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const preview = msg.text ? msg.text.substring(0, 80) : JSON.stringify(msg).substring(0, 80);
        console.log(`[Overlay] Received: ${preview}`);
        sendOverlayMessage(msg);
        console.log(`[Overlay] Forwarded to EDMC (connected: ${overlayConnected})`);
      } catch (e) {
        console.log(`[Overlay] Parse error: ${e.message}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connected: overlayConnected }));
    });
    return;
  }

  // Overlay status endpoint
  if (pathname === '/overlay/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: overlayConnected }));
    return;
  }

  // Check proxy routes
  for (const [prefix, target] of Object.entries(PROXIES)) {
    if (pathname.startsWith(prefix)) {
      const targetPath = pathname.slice(prefix.length) + url.search;
      proxyRequest(req, res, target, targetPath || '/');
      return;
    }
  }

  // Static file serving — pathname is already normalized to begin with '/'
  // Prevent directory traversal attempts before lookup
  if (pathname.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveStatic(res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  startTickPoll(broadcastEvent); // galaxy BGS tick awareness (optional; fail-silent)
  const hostname = os.hostname().toLowerCase();
  const localUrl = `http://localhost:${PORT}`;
  const networkUrl = `http://${hostname}:${PORT}`;
  const networkTokenUrl = `${networkUrl}?token=${APP_TOKEN}`;

  const C = '\x1b[1m\x1b[36m';
  const R = '\x1b[0m';
  const U = '\x1b[4m';
  const V = '║';
  const W = 42;
  const pad = (s) => s + ' '.repeat(Math.max(0, W - s.length));
  console.log('');
  console.log(`  ${C}╔${'═'.repeat(W)}╗${R}`);
  console.log(`  ${C}${V}${R}${pad(`   ED Colony Architect ${APP_VERSION}`)}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${' '.repeat(W)}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}   Local:   ${U}${localUrl}${R}${' '.repeat(Math.max(0, W - 12 - localUrl.length))}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}   Network: ${U}${networkUrl}${R}${' '.repeat(Math.max(0, W - 12 - networkUrl.length))}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${' '.repeat(W)}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${pad('   Press Ctrl+C to stop')}${C}${V}${R}`);
  console.log(`  ${C}╚${'═'.repeat(W)}╝${R}`);
  console.log('');
  console.log(`  Network URL (for other devices):`);
  console.log(`  ${U}${networkTokenUrl}${R}`);
  console.log('');
  // Where the data lives — replace the .exe in THIS folder when updating.
  console.log(`  Data folder: ${APP_DIR}`);
  console.log('');

  // Auto-open Chrome specifically (required for File System Access API — Firefox doesn't support it)
  const cmd = process.platform === 'win32' ? `start chrome "${localUrl}"`
    : process.platform === 'darwin' ? `open -a "Google Chrome" "${localUrl}"`
    : `google-chrome "${localUrl}"`;
  exec(cmd, (err) => {
    // Fallback to default browser if Chrome not found
    if (err) {
      const fallback = process.platform === 'win32' ? `start "" "${localUrl}"`
        : process.platform === 'darwin' ? `open "${localUrl}"`
        : `xdg-open "${localUrl}"`;
      exec(fallback, () => {});
    }
  });

  // Start the live journal watcher. Reads new Journal.*.log bytes every 2s
  // and Cargo.json / Market.json every 5s. Writes go through applyStatePatch
  // → state_updated SSE → all connected clients rehydrate. Overlay messages
  // go through sendOverlayMessage → EDMC TCP 127.0.0.1:5010.
  // Mining side-stores. The rock log lives outside colony-data.json on purpose — it is append-only
  // and uncapped, and colony-data.json is already ~21.5MB and hydrated to every connected device.
  try {
    initMiningLog(APP_DIR);
    initRingIndex(APP_DIR);
    initTrophies(APP_DIR);
    const st = readStateFile();
    const jd = resolveJournalDir((st.settings || {}).journalDirOverride);
    // Surface mining needs the journal dir too: lat/lon comes from Status.json, which is the only
    // place a surface position exists (never archived, so it must be sampled live).
    initSurfaceMining(APP_DIR, jd);
    initMarketMeans(APP_DIR);
// Carrier cargo ledger beside the exe: balances rebuilt from the file now, journals replayed on the
// first companion-file tick (that is where the journal dir and the carrier's identity are known).
{
  const c = initCarrierLedger(APP_DIR);
  console.log(`[CarrierLedger] ${c.records} records on file`);
}
// Price history beside the exe: every market read, a daily Ardent sample, the commander's own
// sales. The journal backfill runs on the first Sell-page request (it needs the journal dir).
{
  const h = initMarketHistory(APP_DIR);
  console.log(`[MarketHistory] ${h.records} records on file${h.pruned ? `, ${h.pruned} older than a year pruned` : ''}`);
}
async function sampleMarketHistory() {
  // Colonia's boards are not the commander's galaxy: sample only within reach of where they are.
  let reach = null;
  try {
    const pos = (readStateFile() || {}).commanderPosition;
    if (pos && pos.coordinates) reach = { origin: pos.coordinates, maxLy: MAX_REACH_LY };
  } catch { reach = null; }
  for (const k of sampleKeys()) {
    if (!needsSample(k)) continue;
    const rows = await ardentJson(`/commodity/name/${encodeURIComponent(k)}/imports?fleetCarriers=false`, 6 * 3600e3);
    if (Array.isArray(rows)) recordArdentSample(k, rows, Date.now(), reach);
  }
  const s = historyStats();
  console.log(`[MarketHistory] sampled — ${s.a} Ardent samples, ${s.m} market rows, ${s.s} own sales across ${s.keys} commodities`);
}
setTimeout(() => { sampleMarketHistory().catch(() => {}); }, 90_000).unref();
setInterval(() => { sampleMarketHistory().catch(() => {}); }, 6 * 3600e3).unref(); // galactic averages from Market.json, kept beside the exe
    // Deferred: the first ring-index build sweeps every journal, so keep it off the boot path.
    setTimeout(() => {
      try {
        buildRingIndex(jd);
        scanMiningMissions(jd);
        const s = ringIndexStats();
        const gapMine = getUnmappedRings(colonySystemsOf(st)).length;
        console.log(`[Mining] Ring index ready: ${s.rings} mapped, ${s.ringsSeen - s.rings} seen-unmapped (${gapMine} in your systems)`);
        const bf = backfillFromJournals(jd, listJournalFiles, getRingInfo);
        if (bf.backfilled) console.log(`[Mining] Backfilled ${bf.backfilled} historical rock(s) — yield table seeded`);
        // Restarting the exe while parked in a ring used to orphan every subsequent rock (45 of
        // them historically). Runs after the index so the ring's class and reserve resolve.
        seedRingContext(jd);
      } catch (e) { console.error('[Mining] index build failed:', e && e.message); }

      // Surface mining rebuilds itself the same way ring mining does — the commander should never
      // have to press a button to see their own history. Idempotent (records dedupe by kind), and
      // ~1s for 221 journals, so it runs every boot and simply finds nothing new when there is
      // nothing new. The manual button stays for forcing a re-read after an import.
      try {
        const sm = backfillSurfaceMining(jd, listJournalFiles);
        if (sm.added) console.log(`[SurfaceMining] Backfilled ${sm.added} record(s) from ${sm.files} journal(s)`);
        const shots = adoptOrphanSurfaceShots(jd);
        if (shots) console.log(`[SurfaceMining] Adopted ${shots} F10 surface shot(s) the gallery had never seen`);
      } catch (e) { console.error('[SurfaceMining] boot rebuild failed:', e && e.message); }
    }, 4000).unref?.();
  } catch (e) {
    console.error('[Mining] init failed:', e && e.message);
  }

  // Proximity radar — EDDN firehose listener (hand-rolled ZMTP; SEA-safe, zero deps).
  try {
    const st0 = readStateFile();
    const p0 = st0.commanderPosition;
    if (p0 && p0.coordinates) {
      recenterRadar(p0.systemName, p0.coordinates);
      getEdsmTraffic(p0.systemName).then((tr) => setCenterTraffic(p0.systemName, tr)).catch(() => {});
      void refreshLookback(st0, p0.systemName, [p0.coordinates.x, p0.coordinates.y, p0.coordinates.z]);
    }
    // The EDDN firehose is the exe's one greedy feed — measured 2026-09-04 at 23 msg/s, 21.6 KB/s,
    // about 1.8 GB a day inbound, whether or not the Radar page is ever opened. Settings →
    // radarEnabled (default on) gates it, and the setting is re-read every minute so a flip takes
    // effect without a restart. Chain Watch rides the same socket, so it follows the same switch.
    const radarOn = () => ((readStateFile() || {}).settings || {}).radarEnabled !== false;
    if (radarOn()) startEddnListener({ broadcastEvent });
    else console.log('[Radar] off in Settings — EDDN listener and chain watch not started');
    setInterval(() => {
      try { if (radarOn()) startEddnListener({ broadcastEvent }); else stopEddnListener(); } catch { /* best-effort */ }
    }, 60_000).unref?.();
    // Chain Watch — persistent frontier ledger; first run seeds from Spansh (bounded),
    // then EDDN keeps it live. Region drip-resolver runs quietly for live-found anchors.
    const cw = initChainWatch(CHAIN_WATCH_FILE);
    if (radarOn() && !Object.keys(cw.seedInfo || {}).filter((k) => k !== 'coloniaRegion').length) {
      defaultRegions().then((regions) => {
        console.log('[ChainWatch] first run — seeding regions:', regions.join(', '));
        return seedChainWatch(regions);
      }).catch((e) => console.error('[ChainWatch] seed failed:', e && e.message));
    }
    setInterval(() => { if (radarOn()) resolvePendingRegions().catch(() => {}); }, 60_000);
  } catch (e) { console.error('[Radar] start failed:', e && e.message); }

  // Self-update — checks GitHub Releases on boot and every 6h. Best-effort: a
  // failed check is silent and never affects anything else.
  try {
    initUpdater({ currentVersion: APP_VERSION, isSea: IS_SEA, broadcast: broadcastEvent });
  } catch (e) { console.error('[Update] init failed:', e && e.message); }

  try {
    startServerWatcher({
      readState: readStateFile,
      applyStatePatch,
      broadcastEvent,
      sendOverlay: sendOverlayMessage,
      captureLine: captureStore.capture,
      recordGameScreenshot,
    });
  } catch (e) {
    console.error('[Watcher] Failed to start:', e && e.message);
  }
});

// Graceful shutdown on Ctrl+C so the watcher's intervals and file handles close cleanly
// A surface-mining collection commits 60s after its last refine, so a burst can still be open when
// the exe closes — without this, the tonnes from the last rig you emptied are simply lost.
function flushOnExit() {
  try { stopServerWatcher(); } catch { /* ignore */ }
  try { finalizeSurfaceMining(); } catch { /* ignore */ }
  try { flushMiningLog(); } catch { /* ignore */ }
}
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  flushOnExit();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushOnExit();
  process.exit(0);
});
process.on('beforeExit', flushOnExit);
