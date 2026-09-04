// server/ai/copilotMemory.js
//
// The co-pilot's PERSISTENT memory — the half that must survive a restart. The crew
// it knows, how many sessions you've flown together, and the places that clipped you
// on the way in all carry over now. Deliberately its OWN file (copilot-memory.json,
// beside colony-data.json), NOT part of the synced client state — that keeps it clear
// of the client sync/merge (partialize / MERGE_STRATEGIES) layer entirely. Server-
// owned, single instance, debounced writes.

import { readFileSync, writeFileSync } from 'node:fs';

function defaults() {
  return {
    version: 1,
    crew: {},      // { [crewId]: name }
    crewRank: {},  // { [crewId]: combatRankInt }
    crewWages: 0,  // lifetime NpcCrew_TotalWages
    sessions: { count: 0, firstSeenAt: null, lastSeenAt: null, lastLoadAt: null },
    grudges: {},   // { [marketId]: { stationName, at } } — places that clipped us on the approach
    systems: {},   // { [systemName]: { factionState, population, at } } — last-known, for change-awareness
    qa: { durable: {}, session: {}, goal: {} }, // Q&A answers by memory layer (durable = forever, asked once)
    quizHistory: [], // [{ at, score, total }] — finished Tycho trivia rounds (newest last), for comparison
    ships: {},      // { [type]: { name, firstSeenAt } } — named ships for callback on return
    milestones: {}, // { [key]: { firstAt, count, lastAt, lastSystem } } — notable firsts
    colonyWatch: {},// { [colonySystem]: { snapshotAt, coords, colonyName, systems } } — area snapshot for the session diff
  };
}

let file = null;
let mem = defaults();
let timer = null;
let dirty = false;

/** Bind to the memory file and load any prior state. Call once at startup. */
export function initCopilotMemory(filePath) {
  file = filePath;
  try {
    const loaded = JSON.parse(readFileSync(file, 'utf8'));
    if (loaded && typeof loaded === 'object') {
      mem = Object.assign(defaults(), loaded);
      mem.sessions = Object.assign(defaults().sessions, loaded.sessions || {});
      for (const k of ['crew', 'crewRank', 'grudges', 'systems', 'ships', 'milestones', 'colonyWatch']) {
        if (!mem[k] || typeof mem[k] !== 'object') mem[k] = {};
      }
      if (!mem.qa || typeof mem.qa !== 'object') mem.qa = { durable: {}, session: {}, goal: {} };
      for (const L of ['durable', 'session', 'goal']) if (!mem.qa[L] || typeof mem.qa[L] !== 'object') mem.qa[L] = {};
      if (!Array.isArray(mem.quizHistory)) mem.quizHistory = [];
    }
  } catch { /* no file yet / unreadable — start fresh */ }
  return mem;
}

export function getMemory() { return mem; }

/** Store a Q&A answer in the given memory layer. Returns true on success. */
export function recordAnswer(layer, key, payload) {
  if (!['durable', 'session', 'goal'].includes(layer) || !key) return false;
  if (!mem.qa) mem.qa = { durable: {}, session: {}, goal: {} };
  if (!mem.qa[layer]) mem.qa[layer] = {};
  const p = payload || {};
  mem.qa[layer][key] = { value: p.value, label: p.label, question: p.question, at: new Date().toISOString() };
  saveMemory();
  return true;
}

/** Append a finished trivia round; keep the most recent 50. */
export function recordQuiz(score, total) {
  if (!Array.isArray(mem.quizHistory)) mem.quizHistory = [];
  mem.quizHistory.push({ at: new Date().toISOString(), score: Number(score) || 0, total: Number(total) || 0 });
  if (mem.quizHistory.length > 50) mem.quizHistory = mem.quizHistory.slice(-50);
  saveMemory();
  return true;
}

/** The most recent finished quizzes (newest last) for the done-screen comparison. */
export function getQuizHistory(limit = 8) {
  const h = Array.isArray(mem.quizHistory) ? mem.quizHistory : [];
  return h.slice(-limit);
}

/** Track a notable first (or Nth occurrence) for shared-history callbacks. */
export function trackMilestone(key, system) {
  if (!mem.milestones || typeof mem.milestones !== 'object') mem.milestones = {};
  const entry = mem.milestones[key];
  if (entry) {
    entry.prevSystem = entry.lastSystem || null; // where the PRIOR sighting was — captured before we overwrite lastSystem with the current one
    entry.count = (entry.count || 1) + 1;
    entry.lastAt = new Date().toISOString();
    if (system) entry.lastSystem = system;
  } else {
    mem.milestones[key] = { firstAt: new Date().toISOString(), count: 1, lastAt: new Date().toISOString(), lastSystem: system || null, prevSystem: null };
  }
  saveMemory();
  return mem.milestones[key];
}

/** Shared-history context for a milestone — empty string on first occurrence. Cites the PREVIOUS
 *  sighting's system (not the current one, which trackMilestone just wrote to lastSystem). */
export function milestoneContext(key) {
  const m = mem.milestones && mem.milestones[key];
  if (!m || m.count <= 1) return '';
  return `You've seen ${m.count} of these together now${m.prevSystem ? ` — the last one was in ${m.prevSystem}` : ''}.`;
}

/** Mark dirty + schedule a debounced write (updates are frequent; disk isn't). */
export function saveMemory() {
  dirty = true;
  if (timer || !file) return;
  timer = setTimeout(() => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try { writeFileSync(file, JSON.stringify(mem)); }
    catch (e) { console.error('[Copilot] memory write failed:', e && e.message); }
  }, 2000);
}
