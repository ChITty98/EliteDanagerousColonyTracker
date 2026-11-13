/**
 * System factions from the journal (1.60.24).
 *
 * Every FSDJump, Location and CarrierJump carries the game's System Factions panel: each faction's
 * influence, state (active, pending, recovering), government, allegiance, happiness and the
 * commander's reputation with it, plus the controlling faction. The app used to keep population
 * and economy from that event and drop the rest. This module keeps one entry per system — the
 * latest reading plus a bounded history of earlier readings kept only when something moved — so the
 * dock banner can say who runs a place and which way they are heading, and the system page can show
 * the panel as it stood on the last jump in.
 *
 * Not in the journal: the panel's economy and security bars. Trend arrows are derived from history.
 * Pure helpers; the extractor reads journal files through injected or default fs.
 */
import fs from 'fs';
import path from 'path';

export const FACTION_HISTORY_CAP = 40;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const states = (arr) => (Array.isArray(arr) ? arr.map((s) => s && s.State).filter(Boolean) : []);

/** Reputation bands as the game labels them (−100..100): Allied ≥ 90, Friendly ≥ 35, Cordial ≥ 4, Neutral > −4, Unfriendly > −35, Hostile. */
export function reputationBand(rep) {
  const r = num(rep);
  if (r == null) return null;
  if (r >= 90) return 'Allied';
  if (r >= 35) return 'Friendly';
  if (r >= 4) return 'Cordial';
  if (r > -4) return 'Neutral';
  if (r > -35) return 'Unfriendly';
  return 'Hostile';
}

/** The reading one jump event carries, or null when the event has no faction list. */
export function factionSnapshotFromEvent(ev) {
  if (!ev || !ev.StarSystem || !Array.isArray(ev.Factions) || ev.Factions.length === 0) return null;
  const factions = ev.Factions.filter((f) => f && f.Name).map((f) => ({
    name: f.Name,
    influence: num(f.Influence) ?? 0,
    state: f.FactionState && f.FactionState !== 'None' ? f.FactionState : null,
    government: f.Government || null,
    allegiance: f.Allegiance || null,
    happiness: f.Happiness_Localised || null,
    reputation: num(f.MyReputation),
    squadron: !!f.SquadronFaction,
    active: states(f.ActiveStates),
    pending: states(f.PendingStates),
    recovering: states(f.RecoveringStates),
  }));
  factions.sort((a, b) => b.influence - a.influence);
  return {
    systemName: ev.StarSystem,
    systemAddress: ev.SystemAddress || null,
    updatedAt: ev.timestamp || new Date().toISOString(),
    controlling: ev.SystemFaction && ev.SystemFaction.Name
      ? { name: ev.SystemFaction.Name, state: ev.SystemFaction.FactionState && ev.SystemFaction.FactionState !== 'None' ? ev.SystemFaction.FactionState : null }
      : null,
    allegiance: ev.SystemAllegiance || null,
    government: ev.SystemGovernment_Localised || null,
    security: ev.SystemSecurity_Localised || null,
    factions,
    conflicts: conflictsFromEvent(ev),
    history: [],
  };
}

/**
 * The journal's Conflicts table (1.61.0) — wars, civil wars and elections in the system, each side's
 * stake and days won. An event without the table means no conflicts in that reading.
 */
export function conflictsFromEvent(ev) {
  const list = ev && Array.isArray(ev.Conflicts) ? ev.Conflicts : [];
  return list.filter((c) => c && c.Faction1 && c.Faction2).map((c) => ({
    warType: c.WarType || null,
    status: c.Status || null,
    factions: [c.Faction1, c.Faction2].map((f) => ({ name: f.Name || null, stake: f.Stake || null, wonDays: num(f.WonDays) ?? 0 })),
  }));
}

function readingOf(entry) {
  const influence = {};
  const st = {};
  for (const f of entry.factions || []) { influence[f.name] = f.influence; st[f.name] = f.state || (f.active && f.active[0]) || null; }
  return { at: entry.updatedAt, influence, states: st };
}

function sameReading(a, b) {
  const ka = Object.keys(a.influence), kb = Object.keys(b.influence);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!(k in b.influence)) return false;
    if (Math.abs(a.influence[k] - b.influence[k]) > 1e-9) return false;
    if ((a.states[k] || null) !== (b.states[k] || null)) return false;
  }
  return true;
}

/**
 * Fold a new reading into a system's entry. Out-of-order or repeated readings change nothing. When
 * the new reading differs from the current one in any influence or state, the current reading is
 * pushed into history (oldest first, capped) before the new one takes its place — so history holds
 * only the moments something moved, which is what a trend needs.
 */
export function mergeSystemFactions(existing, snap) {
  if (!snap) return existing || null;
  if (!existing || !existing.updatedAt) return { ...snap, history: [] };
  if (snap.updatedAt <= existing.updatedAt) return existing;
  const prev = readingOf(existing);
  const next = readingOf(snap);
  let history = Array.isArray(existing.history) ? existing.history : [];
  if (!sameReading(prev, next)) {
    history = [...history, prev];
    if (history.length > FACTION_HISTORY_CAP) history = history.slice(history.length - FACTION_HISTORY_CAP);
  }
  return { ...snap, history };
}

/**
 * Where a faction's influence is heading: the current value against the most recent earlier reading
 * in which it was different. `arrow` is ▲, ▼ or '' when there is nothing to compare with.
 */
export function influenceTrend(entry, factionName) {
  const f = entry && (entry.factions || []).find((x) => x.name === factionName);
  if (!f) return null;
  const current = f.influence;
  let previous = null, previousAt = null;
  for (let i = (entry.history || []).length - 1; i >= 0; i--) {
    const h = entry.history[i];
    const v = h && h.influence ? h.influence[factionName] : undefined;
    if (typeof v === 'number' && Math.abs(v - current) > 1e-9) { previous = v; previousAt = h.at; break; }
  }
  const delta = previous == null ? null : current - previous;
  return { current, previous, previousAt, delta, arrow: delta == null ? '' : (delta > 0 ? '▲' : '▼') };
}

export function formatInfluence(v) {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '';
}

/** "Expansion", "Boom · Civil liberty", or '' — the states worth a word, active first. */
export function factionStatesLabel(f) {
  if (!f) return '';
  const list = (f.active && f.active.length) ? f.active : (f.state ? [f.state] : []);
  return list.join(' · ');
}

/**
 * The dock banner's faction line: "🏴 HIP 104349 Ring runs this place · 33.6% ▲ · Friendly · Expansion".
 * Built from the freshest reading only, so it never asserts a state the journal has stopped writing.
 * With no reading for the system the name alone stands; with no name, null.
 */
export function describeStationFactionLine(entry, factionName) {
  if (!factionName) return null;
  const parts = [`\u{1F3F4} ${factionName} runs this place`];
  const f = entry && (entry.factions || []).find((x) => x.name === factionName);
  if (f) {
    const t = influenceTrend(entry, factionName);
    parts.push(`${formatInfluence(f.influence)}${t && t.arrow ? ` ${t.arrow}` : ''}`);
    const band = reputationBand(f.reputation);
    if (band) parts.push(band);
    const st = factionStatesLabel(f);
    if (st) parts.push(st);
  }
  return parts.join(' · ');
}

/**
 * Every system's faction history from the journals on disk, in timestamp order — the Sync All
 * backfill. Only lines that carry a faction list are parsed. Returns a map keyed by the lower-case
 * system name, the same shape the live processor writes.
 */
export function extractSystemFactions(journalDir, io = {}) {
  const listFiles = io.listFiles || ((dir) => fs.readdirSync(dir).filter((f) => /^Journal.*\.log$/i.test(f)).sort().map((f) => path.join(dir, f)));
  const readFile = io.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const out = {};
  let files = [];
  try { files = listFiles(journalDir); } catch { return out; }
  for (const file of files) {
    let text;
    try { text = readFile(file); } catch { continue; }
    for (const line of text.split('\n')) {
      if (line.indexOf('"Factions"') < 0) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!ev || (ev.event !== 'FSDJump' && ev.event !== 'Location' && ev.event !== 'CarrierJump')) continue;
      const snap = factionSnapshotFromEvent(ev);
      if (!snap) continue;
      const key = snap.systemName.toLowerCase();
      out[key] = mergeSystemFactions(out[key], snap);
    }
  }
  return out;
}
