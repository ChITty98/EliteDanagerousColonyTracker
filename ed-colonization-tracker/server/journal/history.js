/**
 * Lifetime journal history stats — server-side, persistent, INCREMENTAL.
 *
 * Port of the client's scanJournalHistory (journalReader.ts) minus its two structural
 * problems: it needed the Chrome folder handle (dead post-watcher-cutover, impossible on
 * iPad) and it rescanned all ~555 files into component state on every visit ("annoying
 * to have to rerun to see information").
 *
 * Design: a SERIALIZABLE aggregate + per-file byte ledger cached in journal-stats.json.
 * Journals are append-only — completed files never reparse; only new files and the tail
 * of the active file (from its stored offset, advanced only to the last complete line)
 * are read. First scan is the only long one; every later refresh is seconds. Rankings
 * and top-lists are derived at read time in finalize().
 *
 * Files process in filename order — chronological for both journal naming eras — so the
 * cross-file jump-distance chain (prevJumpPos) and latest-station-name logic stay exact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isEphemeralStation } from './util.js';
import { findCommodityByJournalName, findCommodityByDisplayName } from './commodities.js';

// Bumped to 2 (2026-08-28) for msys — mission earnings per system. Existing caches predate the
// field, so they are discarded and rescanned rather than served with it silently empty.
const CACHE_VERSION = 2;

let agg = null;          // in-memory aggregate (single journal dir per process)
let cachePath = null;
let scanning = false;
let progress = { pct: 0, phase: 'idle' };

function freshAgg() {
  return {
    version: CACHE_VERSION,
    files: {},            // fname -> bytes fully processed
    sys: {},              // system -> { v, f, l }
    st: {},               // marketId -> { v, sys, name, ts, prev: {name:1}, f, l }
    cb: {}, cs: {},       // commodity display name -> tons bought / sold
    fff: [],              // { body, system, timestamp }
    claimed: {},          // system -> 1
    // Mission rewards per system. missionEarnings below is the galaxy-wide total and throws the
    // location away, which hid the fact that a single system had paid this commander 1.91bn.
    // Keyed on DestinationSystem — where the mission was DELIVERED. For the mining and collection
    // contracts that dominate here, that is the same station it was accepted at, so it reads as
    // "what this system paid me". It is a proxy, not the literal origin: MissionAccepted carries
    // no system of its own, so true origin would need correlating against the preceding Docked.
    msys: {},             // system -> { cr, n }
    n: {
      totalJumps: 0, totalDistanceLY: 0, bodiesScanned: 0, bodiesDiscovered: 0,
      surfaceMapped: 0, efficientMaps: 0, systemsHonked: 0,
      earthlikes: 0, earthlikesDiscovered: 0, waterWorlds: 0, waterWorldsDiscovered: 0,
      ammoniaWorlds: 0, ammoniaWorldsDiscovered: 0, landables: 0,
      explorationEarnings: 0, totalLandings: 0, firstFootfalls: 0,
      bountiesCollected: 0, bountyEarnings: 0, combatBonds: 0, combatBondEarnings: 0,
      deaths: 0, interdictions: 0, interdictionEscapes: 0,
      tonsBought: 0, tonsSold: 0, creditsSpent: 0, creditsEarned: 0,
      missionsCompleted: 0, missionEarnings: 0, contributionsMade: 0,
    },
    firstTs: null, lastTs: null,
    prevJumpPos: null,
    farthest: { d: 0, name: null },
    gameStats: null, gameStatsTs: null,
  };
}

function loadCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.version === CACHE_VERSION) return j;
  } catch { /* absent or corrupt — full scan rebuilds it */ }
  return freshAgg();
}

function saveCache() {
  if (!agg || !cachePath) return;
  try {
    fs.writeFileSync(cachePath, JSON.stringify(agg));
  } catch (e) { console.error('[JournalStats] cache save failed:', e && e.message); }
}

function ensureLoaded(cacheFile) {
  if (!agg || cachePath !== cacheFile) {
    cachePath = cacheFile;
    agg = loadCache(cacheFile);
  }
}

// Same resolution ladder as the client had — server commodity dictionaries.
function resolveCommodityDisplayName(localised, raw) {
  if (localised) {
    const byDisplay = findCommodityByDisplayName(localised);
    if (byDisplay) return byDisplay.name;
    return localised;
  }
  const byJournal = findCommodityByJournalName(raw);
  if (byJournal) return byJournal.name;
  const asToken = `$${String(raw || '').toLowerCase()}_name;`;
  const byToken = findCommodityByJournalName(asToken);
  if (byToken) return byToken.name;
  const byRawDisplay = findCommodityByDisplayName(raw);
  if (byRawDisplay) return byRawDisplay.name;
  return String(raw || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
}

function span(ts) {
  if (!ts) return;
  if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
  if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
}

function processEvent(e) {
  const n = agg.n;
  switch (e.event) {
    case 'FSDJump': {
      span(e.timestamp);
      n.totalJumps++;
      const sys = e.StarSystem;
      if (sys) {
        const s = agg.sys[sys] || (agg.sys[sys] = { v: 0, f: e.timestamp, l: e.timestamp });
        s.v++;
        if (e.timestamp < s.f) s.f = e.timestamp;
        if (e.timestamp > s.l) s.l = e.timestamp;
      }
      if (Array.isArray(e.StarPos) && e.StarPos.length === 3) {
        const pos = e.StarPos;
        const p = agg.prevJumpPos;
        if (p) n.totalDistanceLY += Math.hypot(pos[0] - p[0], pos[1] - p[1], pos[2] - p[2]);
        agg.prevJumpPos = pos;
        const dSol = Math.hypot(pos[0], pos[1], pos[2]);
        if (dSol > agg.farthest.d) agg.farthest = { d: dSol, name: sys || null };
      }
      break;
    }
    case 'Docked': {
      span(e.timestamp);
      if (isEphemeralStation(e.StationName, e.StationType, e.MarketID)) break;
      if (!e.MarketID) break; // very old journals — can't disambiguate without it
      const mid = String(e.MarketID);
      const st = agg.st[mid] || (agg.st[mid] = { v: 0, sys: '', name: '', ts: '', prev: {}, f: e.timestamp, l: e.timestamp });
      st.v++;
      st.sys = e.StarSystem || st.sys;
      // Most-recent-name-wins; older/other names accumulate for "(formerly …)".
      if (!st.ts || e.timestamp > st.ts) {
        if (st.name && st.name !== e.StationName) st.prev[st.name] = 1;
        st.name = e.StationName;
        st.ts = e.timestamp;
      } else if (e.StationName && e.StationName !== st.name) {
        st.prev[e.StationName] = 1;
      }
      if (e.timestamp < st.f) st.f = e.timestamp;
      if (e.timestamp > st.l) st.l = e.timestamp;
      break;
    }
    case 'Scan': {
      n.bodiesScanned++;
      if (e.WasDiscovered === false) n.bodiesDiscovered++;
      if (e.PlanetClass === 'Earthlike body') { n.earthlikes++; if (e.WasDiscovered === false) n.earthlikesDiscovered++; }
      if (e.PlanetClass === 'Water world') { n.waterWorlds++; if (e.WasDiscovered === false) n.waterWorldsDiscovered++; }
      if (e.PlanetClass === 'Ammonia world') { n.ammoniaWorlds++; if (e.WasDiscovered === false) n.ammoniaWorldsDiscovered++; }
      if (e.Landable) n.landables++;
      break;
    }
    case 'SAAScanComplete':
      n.surfaceMapped++;
      if (e.ProbesUsed <= e.EfficiencyTarget) n.efficientMaps++;
      break;
    case 'FSSDiscoveryScan': n.systemsHonked++; break;
    case 'Touchdown':
      if (e.PlayerControlled !== false) {
        n.totalLandings++;
        if (e.FirstFootFall === true) {
          n.firstFootfalls++;
          agg.fff.push({ body: e.Body, system: e.StarSystem, timestamp: e.timestamp });
        }
      }
      break;
    case 'SellExplorationData':
    case 'MultiSellExplorationData':
      n.explorationEarnings += e.TotalEarnings || 0;
      break;
    case 'Bounty':
      n.bountiesCollected++;
      n.bountyEarnings += e.TotalReward || 0;
      break;
    case 'FactionKillBond':
      n.combatBonds++;
      n.combatBondEarnings += e.Reward || 0;
      break;
    case 'Died': n.deaths++; break;
    case 'Interdicted':
      n.interdictions++;
      if (!e.Submitted) n.interdictionEscapes++;
      break;
    case 'MarketBuy': {
      n.tonsBought += e.Count || 0;
      n.creditsSpent += e.TotalCost || 0;
      const name = resolveCommodityDisplayName(e.Type_Localised, e.Type);
      agg.cb[name] = (agg.cb[name] || 0) + (e.Count || 0);
      break;
    }
    case 'MarketSell': {
      n.tonsSold += e.Count || 0;
      n.creditsEarned += e.TotalSale || 0;
      const name = resolveCommodityDisplayName(e.Type_Localised, e.Type);
      agg.cs[name] = (agg.cs[name] || 0) + (e.Count || 0);
      break;
    }
    case 'MissionCompleted': {
      n.missionsCompleted++;
      n.missionEarnings += e.Reward || 0;
      const msys = e.DestinationSystem;
      if (msys) {
        const b = agg.msys[msys] || (agg.msys[msys] = { cr: 0, n: 0 });
        b.cr += e.Reward || 0;
        b.n += 1;
      }
      break;
    }
    case 'ColonisationContribution': n.contributionsMade++; break;
    case 'ColonisationSystemClaim':
    case 'ColonisationBeaconPlaced':
    case 'ColonisationBeaconDeployed':
      if (e.StarSystem) agg.claimed[e.StarSystem] = 1;
      break;
    case 'Statistics':
      if (!agg.gameStatsTs || e.timestamp > agg.gameStatsTs) {
        agg.gameStatsTs = e.timestamp;
        agg.gameStats = {
          timePlayed: e.Exploration?.Time_Played,
          currentWealth: e.Bank_Account?.Current_Wealth,
          greatestDistance: e.Exploration?.Greatest_Distance_From_Start,
          enginesUsed: e.Crafting?.Count_Of_Used_Engineers,
        };
      }
      break;
    default: break;
  }
}

function processText(text) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let e;
    try { e = JSON.parse(t); } catch { continue; }
    if (e && e.event) processEvent(e);
  }
}

function listJournalFiles(journalDir) {
  let names;
  try { names = fs.readdirSync(journalDir); } catch { return []; }
  return names.filter((f) => /^Journal\..*\.log$/i.test(f)).sort();
}

// Read [from → last complete line] of a file; returns bytes consumed (newline-aligned)
// so the active file's tail resumes exactly, never splitting a JSON line.
function readNewBytes(file, from, size) {
  const len = size - from;
  if (len <= 0) return { text: '', consumed: 0 };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, from);
    const chunk = buf.subarray(0, read);
    const lastNL = chunk.lastIndexOf(0x0a);
    if (lastNL < 0) return { text: '', consumed: 0 }; // no complete line yet
    return { text: chunk.subarray(0, lastNL + 1).toString('utf8'), consumed: lastNL + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

export function pendingJournalFiles(journalDir, cacheFile) {
  ensureLoaded(cacheFile);
  let pending = 0;
  for (const f of listJournalFiles(journalDir)) {
    let size = 0;
    try { size = fs.statSync(path.join(journalDir, f)).size; } catch { continue; }
    if (size > (agg.files[f] || 0)) pending++;
  }
  return pending;
}

export async function refreshJournalStats(journalDir, cacheFile, onProgress) {
  ensureLoaded(cacheFile);
  if (scanning) return { started: false, reason: 'already scanning' };
  scanning = true;
  progress = { pct: 0, phase: 'Listing journals…' };
  try {
    const files = listJournalFiles(journalDir);
    const targets = [];
    for (const f of files) {
      let size = 0;
      try { size = fs.statSync(path.join(journalDir, f)).size; } catch { continue; }
      if (size > (agg.files[f] || 0)) targets.push({ f, size });
    }
    for (let i = 0; i < targets.length; i++) {
      const { f, size } = targets[i];
      const from = agg.files[f] || 0;
      try {
        const { text, consumed } = readNewBytes(path.join(journalDir, f), from, size);
        if (consumed > 0) {
          processText(text);
          agg.files[f] = from + consumed;
        } else if (from === 0) {
          agg.files[f] = 0; // empty/unfinished first line — ledger the file anyway
        }
      } catch (e) { console.error(`[JournalStats] ${f}:`, e && e.message); }
      progress = { pct: Math.round(((i + 1) / targets.length) * 100), phase: `Reading journal ${i + 1} of ${targets.length}…` };
      if (onProgress && (i % 5 === 0 || i === targets.length - 1)) onProgress(progress.pct, progress.phase);
      if (i % 50 === 49) saveCache(); // checkpoint the long first scan
      if (i % 10 === 9) await new Promise((r) => setImmediate(r)); // don't starve the event loop
    }
    saveCache();
    progress = { pct: 100, phase: 'done' };
    if (onProgress) onProgress(100, 'done');
    return { started: true, processed: targets.length };
  } finally {
    scanning = false;
  }
}

function finalize() {
  if (!agg.firstTs && agg.n.totalJumps === 0 && agg.n.bodiesScanned === 0) return null;
  const allSystemVisits = Object.entries(agg.sys)
    .map(([name, s]) => ({ name, visits: s.v, firstVisited: s.f || '', lastVisited: s.l || '' }))
    .sort((a, b) => b.visits - a.visits);
  const allStationVisits = Object.entries(agg.st)
    .map(([mid, st]) => {
      const previousNames = Object.keys(st.prev || {});
      return {
        name: st.name || `MarketID ${mid}`,
        systemName: st.sys || '',
        visits: st.v,
        firstVisited: st.f || '',
        lastVisited: st.l || '',
        previousNames: previousNames.length ? previousNames : undefined,
      };
    })
    .sort((a, b) => b.visits - a.visits);
  const top10 = (rec) => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, tons]) => ({ name, tons }));
  const n = agg.n;
  return {
    firstEventDate: agg.firstTs,
    lastEventDate: agg.lastTs,
    journalFileCount: Object.keys(agg.files).length,
    // Ranked by CREDITS, never by mission count — 364 missions in one system were worth a
    // fiftieth of 43 in another, so count actively misleads here.
    missionEarningsBySystem: Object.entries(agg.msys || {})
      .map(([name, b]) => ({ name, credits: b.cr, missions: b.n }))
      .sort((a, b) => b.credits - a.credits),
    totalJumps: n.totalJumps,
    totalDistanceLY: Math.round(n.totalDistanceLY),
    uniqueSystemsVisited: allSystemVisits.length,
    uniqueStationsDocked: allStationVisits.length,
    topSystems: allSystemVisits.slice(0, 20),
    allSystemVisits,
    topStations: allStationVisits.slice(0, 20),
    allStationVisits,
    bodiesScanned: n.bodiesScanned,
    bodiesDiscovered: n.bodiesDiscovered,
    surfaceMapped: n.surfaceMapped,
    efficientMaps: n.efficientMaps,
    systemsHonked: n.systemsHonked,
    earthlikesFound: n.earthlikes,
    earthlikesDiscovered: n.earthlikesDiscovered,
    waterWorldsFound: n.waterWorlds,
    waterWorldsDiscovered: n.waterWorldsDiscovered,
    ammoniaWorldsFound: n.ammoniaWorlds,
    ammoniaWorldsDiscovered: n.ammoniaWorldsDiscovered,
    landablesFound: n.landables,
    explorationEarnings: n.explorationEarnings,
    totalLandings: n.totalLandings,
    firstFootfalls: n.firstFootfalls,
    firstFootfallLocations: [...agg.fff].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))),
    bountiesCollected: n.bountiesCollected,
    bountyEarnings: n.bountyEarnings,
    combatBonds: n.combatBonds,
    combatBondEarnings: n.combatBondEarnings,
    deaths: n.deaths,
    interdictions: n.interdictions,
    interdictionEscapes: n.interdictionEscapes,
    tonsBought: n.tonsBought,
    tonsSold: n.tonsSold,
    creditsSpent: n.creditsSpent,
    creditsEarned: n.creditsEarned,
    topCommoditiesBought: top10(agg.cb),
    topCommoditiesSold: top10(agg.cs),
    missionsCompleted: n.missionsCompleted,
    missionEarnings: n.missionEarnings,
    contributionsMade: n.contributionsMade,
    systemsClaimed: Object.keys(agg.claimed).length,
    farthestFromSolLY: Math.round(agg.farthest.d),
    farthestSystemName: agg.farthest.name,
    gameStats: agg.gameStats,
  };
}

export function getJournalStats(journalDir, cacheFile) {
  ensureLoaded(cacheFile);
  return {
    stats: finalize(),
    meta: {
      scanning,
      progress,
      pendingFiles: pendingJournalFiles(journalDir, cacheFile),
      processedFiles: Object.keys(agg.files).length,
    },
  };
}
