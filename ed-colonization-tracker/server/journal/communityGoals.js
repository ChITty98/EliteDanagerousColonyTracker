// server/journal/communityGoals.js
//
// The one source of truth for "is this station a community-goal market". The journal writes a
// CommunityGoal event (all current goals, with SystemName, MarketName and Expiry) whenever the
// commander opens the goal panel or docks at a goal market; the latest event wins, and a goal past
// its expiry is gone. Before this, a demand of 999,999 stood in for "goal market" — and big stations
// post demand far above that for ordinary goods (Beryllium at The Gatehouse: 2,725,657), so every
// column on the Sell page grew false "community goal" tags, and every valuation that reads "your
// best market" or "the galaxy's best buyer" priced rigs and rocks at Metz's 8× (2026-09-07).
//
// Consumers: sellPlan.pick (the tag), marketMeans.bestSellFromSnapshots, mining.getPriceMap,
// livePrices.fetchOne and marketHistory.recordArdentSample (all skip goal markets when valuing).
import fs from 'node:fs';
import path from 'node:path';

const RESCAN_MS = 60_000;

let JOURNAL_DIR = null;
let goals = [];            // [{ cgid, title, system, market, expiry, contribution }]
let eventAt = '';          // timestamp of the CommunityGoal event the list came from
let lastScanMs = 0;
let scannedNewest = '';    // name+mtime of the newest journal file at the last scan

export function initCommunityGoals(journalDir) {
  JOURNAL_DIR = journalDir || null;
  goals = []; eventAt = ''; lastScanMs = 0; scannedNewest = '';
  scan(true);
  return { goals: goals.length, eventAt };
}

function fromEvent(ev) {
  if (!ev || ev.event !== 'CommunityGoal') return null;
  const list = Array.isArray(ev.CurrentGoals) ? ev.CurrentGoals : [];
  return list.filter((g) => g && g.SystemName && g.MarketName).map((g) => ({
    cgid: g.CGID ?? null, title: g.Title || '', system: String(g.SystemName), market: String(g.MarketName),
    expiry: g.Expiry || null, contribution: g.PlayerContribution ?? null, complete: !!g.IsComplete,
  }));
}

/** A live CommunityGoal event from the watcher — the list is whatever it says now. */
export function noteCommunityGoalEvent(ev) {
  const list = fromEvent(ev);
  if (!list) return false;
  if (ev.timestamp && eventAt && ev.timestamp < eventAt) return false; // an older replay never regresses the list
  goals = list; eventAt = ev.timestamp || new Date().toISOString();
  return true;
}

/** Newest journal files first; the last CommunityGoal event in the newest file that has one. */
function scan(force = false) {
  if (!JOURNAL_DIR) return;
  const now = Date.now();
  if (!force && now - lastScanMs < RESCAN_MS) return;
  lastScanMs = now;
  let files;
  try {
    files = fs.readdirSync(JOURNAL_DIR).filter((f) => /^Journal.*\.log$/i.test(f))
      .map((f) => { const p = path.join(JOURNAL_DIR, f); let m = 0; try { m = fs.statSync(p).mtimeMs; } catch { /* skip */ } return { f, p, m }; })
      .sort((a, b) => b.m - a.m);
  } catch { return; }
  if (!files.length) return;
  const newest = `${files[0].f}|${files[0].m}`;
  if (!force && newest === scannedNewest) return;
  scannedNewest = newest;
  for (const { p } of files.slice(0, 12)) {
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (!text.includes('"CommunityGoal"')) continue;
    let last = null;
    for (const line of text.split('\n')) {
      if (!line.includes('"CommunityGoal"')) continue;
      try { const e = JSON.parse(line); if (e.event === 'CommunityGoal') last = e; } catch { /* partial line */ }
    }
    if (last) { noteCommunityGoalEvent(last); return; }
  }
}

/** Goals whose expiry is still ahead (or has no expiry on file). */
export function activeCommunityGoals(now = Date.now()) {
  scan(false);
  return goals.filter((g) => !g.expiry || Date.parse(g.expiry) > now);
}

const norm = (s) => String(s || '').trim().toLowerCase();

/** Is this station, in this system, a goal market right now? Station alone matches when no system is given. */
export function isCommunityGoalMarket(station, system, now = Date.now()) {
  const st = norm(station);
  if (!st) return false;
  const sys = norm(system);
  return activeCommunityGoals(now).some((g) => norm(g.market) === st && (!sys || norm(g.system) === sys));
}

/** Test hook: set the list directly, no journal. */
export function _setCommunityGoals(list, at = new Date().toISOString()) {
  JOURNAL_DIR = null;
  goals = (list || []).map((g) => ({ cgid: g.cgid ?? null, title: g.title || '', system: g.system, market: g.market, expiry: g.expiry || null, contribution: g.contribution ?? null, complete: !!g.complete }));
  eventAt = at;
}
