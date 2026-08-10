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
import { exec } from 'node:child_process';
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
  getRingInfo, getUnmappedRings,
} from './server/journal/miningIndex.js';
import {
  scanMiningMissions, getLiveMiningMissions, commodityKey, missionRateFor,
} from './server/journal/miningMissions.js';
import { getMiningSnapshot, commodityValueNow, rockValueNow, colonySystemsOf, setInHotspot } from './server/journal/mining.js';
import { initTrophies, computeAggregates, evaluateBadges, badgeStates, getStreak } from './server/journal/miningTrophies.js';
import { refreshLivePrices, getLivePrice } from './server/journal/livePrices.js';
import { startEddnListener, recenterRadar } from './server/radar/eddnListener.js';
import { snapshot as radarSnapshot, setCenterTraffic } from './server/radar/radarState.js';
import { getEdsmTraffic } from './server/radar/traffic.js';
import { getJournalStats, refreshJournalStats } from './server/journal/history.js';
import { initChainWatch, seedChainWatch, snapshotChains, defaultRegions, resolvePendingRegions } from './server/chains/chainWatch.js';
import { refreshLookback } from './server/radar/lookback.js';
import { searchRingsBySignals } from './server/journal/spansh.js';
import { initUpdater, getUpdateStatus, checkForUpdate } from './server/update/updater.js';

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
  if (event && event.type !== 'heartbeat') {
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
    console.log('[Overlay] Sent:', msg.id, msg.text?.substring(0, 60) || '');
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
    || pathname === '/copilot-trivia' || pathname === '/copilot-trivia-result';
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
          patch.carrierCargo = {
            __upsert: {
              [ownerCallsign]: {
                items,
                earliestTransfer: market.timestamp,
                latestTransfer: market.timestamp,
                updatedAt: market.timestamp || new Date().toISOString(),
                isEstimate: false,
                carrierCallsign: ownerCallsign,
              },
            },
          };
          marketOutcome = { type: 'fc_cargo', callsign: ownerCallsign, itemCount: items.length };
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
        rateHistory: getRateHistory().slice(0, 60),
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
  if (pathname === '/api/mining-log' && req.method === 'GET') {
    try {
      flushMiningLog();
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 2000);
      const ring = url.searchParams.get('ring');
      let rows = readRocks();
      if (ring) rows = rows.filter((r) => r.ring === ring);
      const total = rows.length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total, returned: Math.min(limit, total), rocks: rows.slice(-limit).reverse() }));
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
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'image/jpeg';
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
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
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
      } catch (e) { console.error('[Mining] index build failed:', e && e.message); }
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
    startEddnListener({ broadcastEvent });
    // Chain Watch — persistent frontier ledger; first run seeds from Spansh (bounded),
    // then EDDN keeps it live. Region drip-resolver runs quietly for live-found anchors.
    const cw = initChainWatch(CHAIN_WATCH_FILE);
    if (!Object.keys(cw.seedInfo || {}).filter((k) => k !== 'coloniaRegion').length) {
      defaultRegions().then((regions) => {
        console.log('[ChainWatch] first run — seeding regions:', regions.join(', '));
        return seedChainWatch(regions);
      }).catch((e) => console.error('[ChainWatch] seed failed:', e && e.message));
    }
    setInterval(() => { resolvePendingRegions().catch(() => {}); }, 60_000);
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
    });
  } catch (e) {
    console.error('[Watcher] Failed to start:', e && e.message);
  }
});

// Graceful shutdown on Ctrl+C so the watcher's intervals and file handles close cleanly
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  try { stopServerWatcher(); } catch { /* ignore */ }
  process.exit(0);
});
process.on('SIGTERM', () => {
  try { stopServerWatcher(); } catch { /* ignore */ }
  process.exit(0);
});
