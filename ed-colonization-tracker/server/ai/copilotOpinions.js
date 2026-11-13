// server/ai/copilotOpinions.js
//
// STATION OPINIONS (1.61.0) — the active persona's own take on the station the commander was just cleared
// to dock at, formed from the fact sheet (copilotDossier.js), remembered per persona per station, and
// referenced on later visits. Anthropic API only (structured output); with the CLI or canned-only the
// co-pilot keeps its existing station lines.
//
// The commander's five requirements, and where each is enforced IN CODE (not just asked of the model):
//   LOGICAL      every cited fact id must exist on the sheet; every number in the line must come from a
//                cited fact; the verdict must follow from the cited facts' pulls for this persona
//                (copilotTastes); a changed mind must cite a fact that actually changed.
//   IN CHARACTER persona rules + the persona's own thumbs-up lines as voice examples (thumbs-down /
//                off-character lines as counter-examples); hard checks: first person, no persona names,
//                never "she/her", Wren never leads with a number.
//   RELEVANT     facts ranked by how unusual they are here and now (dossier salience + what changed);
//                mid-haul it gets one short sentence or nothing.
//   RETAINED     the take, verdict, cited facts and every fact's value at the time are stored in
//                copilot-memory.json; the next visit sees the old take plus a computed diff.
//   VARIED       angles and forms rotate per persona; a line whose opening or wording is too close to
//                a recent one is rejected.
// A line that fails any check gets ONE rewrite with the reasons; then silence. A wrong line is never said.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getMemory, saveMemory } from './copilotMemory.js';
import { buildStationDossier } from './copilotDossier.js';
import { apiComplete, apiReady, modelOf } from './copilotApi.js';
import { COPILOT_RULES, buildPersonalityPreamble } from './copilotRules.js';
import { nearbyNow, noteOwnNearby } from '../radar/nearbyNow.js';
import { markOpined } from './copilotOpinionMarks.js';

export const ANGLES = ['architecture', 'lifecycle', 'pads', 'distance', 'services', 'economy', 'population', 'security',
  'politics', 'faction', 'war', 'planet', 'stars', 'history', 'traffic', 'market', 'people'];
export const MOODS = ['calm', 'hyped', 'awe', 'proud', 'wave', 'brace', 'panic', 'relief', 'somber'];

// Constant on purpose: the schema is part of the cached prompt prefix, so it must not change per call.
export const OPINION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['line', 'stance', 'mood', 'used', 'angle'],
  properties: {
    line: { type: 'string', description: 'What you say aloud, 1-3 short sentences.' },
    stance: { type: 'integer', enum: [-2, -1, 0, 1, 2], description: '-2 hate it ... +2 love it' },
    mood: { type: 'string', enum: MOODS },
    used: { type: 'array', items: { type: 'string' }, description: 'ids of the facts the line leans on' },
    angle: { type: 'string', enum: ANGLES, description: 'group of the fact you lead with' },
  },
};

const RECENT_MS = 120_000;
const OPINION_GAP_MS = 10 * 60_000;     // at most one opinion per ten minutes, however many stations
const REVISIT_MS = 21 * 86400e3;        // an unchanged opinion is re-formed after three weeks…
const REVISIT_DOCKS = 5;                // …and only if the commander has been back a few times since
const CHANGE_SALIENCE = 35;             // a change this notable earns a fresh take on any visit
const MAX_FACTS = 12;
const MAX_STORED = 400;                 // per persona; oldest dropped beyond this
const LINES_KEPT = 30;
const ANGLES_KEPT = 12;
const FORMS = ['verdict', 'detail', 'compare', 'question', 'callback'];
const FORM_TEXT = {
  verdict: 'a quick verdict on the place',
  detail: 'one telling detail, then your verdict',
  compare: 'a comparison with one of the stations you already have a view on (by name, as listed)',
  question: 'a dry question to the commander about the place (not a request, never an order)',
  callback: 'a callback to your previous take on this place',
};

let lastOpinionAt = 0;
let captureFile = null;
let voiceCache = { at: 0, byPersona: {} };

/** server.mjs, once: where the rated line captures live (voice examples are read from them). */
export function initCopilotOpinions({ captureFile: f = null } = {}) { captureFile = f; voiceCache = { at: 0, byPersona: {} }; }

// ── Memory helpers ──────────────────────────────────────────────────────────────────────────────

function bucket(key, persona, fallback) {
  const m = getMemory();
  if (!m[key] || typeof m[key] !== 'object') m[key] = {};
  if (m[key][persona] == null) m[key][persona] = fallback;
  return m[key][persona];
}
const opinionsOf = (persona) => bucket('opinions', persona, {});
const anglesOf = (persona) => { const a = bucket('opinionAngles', persona, []); return Array.isArray(a) ? a : []; };
const linesOf = (persona) => { const a = bucket('opinionLines', persona, []); return Array.isArray(a) ? a : []; };

/** The stored opinion, if this persona has one of this station. */
export function opinionFor(persona, marketId) {
  const o = (getMemory().opinions || {})[persona];
  return (o && marketId != null && o[String(marketId)]) || null;
}

// ── Own-journal bookkeeping: turn-away counter + own fingerprints for the nearby-now window ─────────

/** Every tick (copilot.js): count the commander's own docking denials and mark their own docking events. */
export function noteOwnStationEvents(parsed) {
  const events = (parsed && parsed.allEvents) || [];
  let dirty = false;
  for (const e of events) {
    if (!e || e.MarketID == null) continue;
    if (e.event === 'DockingGranted') noteOwnNearby('granted', e.MarketID, e.timestamp);
    else if (e.event === 'Docked') noteOwnNearby('docked', e.MarketID, e.timestamp);
    else if (e.event === 'DockingDenied') {
      noteOwnNearby('denied', e.MarketID, e.timestamp);
      if (countDenial(e)) dirty = true;
    }
  }
  if (dirty) saveMemory();
}

function countDenial(e) {
  const m = getMemory();
  if (!m.dockDenials || typeof m.dockDenials !== 'object') m.dockDenials = {};
  const k = String(e.MarketID);
  const d = m.dockDenials[k] || { count: 0, reasons: {}, lastTs: null, stationName: e.StationName || null };
  if (d.lastTs && String(e.timestamp) <= d.lastTs) return false; // journal re-read — already counted
  d.count += 1;
  const r = e.Reason || 'Unknown';
  d.reasons[r] = (d.reasons[r] || 0) + 1;
  d.lastTs = String(e.timestamp || '');
  if (e.StationName) d.stationName = e.StationName;
  m.dockDenials[k] = d;
  return true;
}

/**
 * One background pass over the journals for past DockingDenied events, so "turned us away" knows
 * history from day one. Streams line by line (never blocks the server); runs once, ever.
 */
export async function backfillDockDenials(journalDir) {
  const m = getMemory();
  if (m.dockDenialsBackfilled || !journalDir) return;
  let files = [];
  try { files = fs.readdirSync(journalDir).filter((f) => /^Journal\..+\.log$/.test(f)).sort(); } catch { return; }
  const found = {};
  for (const f of files) {
    try {
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(journalDir, f), { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('"DockingDenied"')) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (!e || e.event !== 'DockingDenied' || e.MarketID == null) continue;
        const k = String(e.MarketID);
        const d = found[k] || { count: 0, reasons: {}, lastTs: null, stationName: e.StationName || null };
        d.count += 1;
        const r = e.Reason || 'Unknown';
        d.reasons[r] = (d.reasons[r] || 0) + 1;
        if (!d.lastTs || String(e.timestamp) > d.lastTs) d.lastTs = String(e.timestamp || '');
        found[k] = d;
      }
    } catch { /* unreadable file — skip */ }
  }
  const cur = m.dockDenials && typeof m.dockDenials === 'object' ? m.dockDenials : {};
  // Live counting may already have started this session; the backfill is the authority for history.
  for (const [k, d] of Object.entries(found)) {
    const live = cur[k];
    cur[k] = (live && live.lastTs && d.lastTs && live.lastTs > d.lastTs) ? live : d;
  }
  m.dockDenials = cur;
  m.dockDenialsBackfilled = new Date().toISOString();
  saveMemory();
  console.log(`[Copilot] docking turn-aways backfilled: ${Object.keys(found).length} stations from ${files.length} journals`);
}

// ── Voice examples (the persona's own rated lines) ──────────────────────────────────────────────

function loadVoiceExamples(persona, now = Date.now()) {
  if (now - voiceCache.at < 3600e3 && voiceCache.byPersona[persona]) return voiceCache.byPersona[persona];
  const out = { good: [], bad: [] };
  if (!captureFile) return out;
  let text = '';
  try { text = fs.readFileSync(captureFile, 'utf8'); } catch { return out; }
  const lines = new Map();
  const net = new Map();
  const why = new Map();
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let e; try { e = JSON.parse(raw); } catch { continue; }
    if (e.kind === 'line' && e.prose) lines.set(e.id, e);
    else if (e.kind === 'rating' && e.id) {
      net.set(e.id, (net.get(e.id) || 0) + (Number(e.rating) || 0));
      if (e.reason || e.comment) why.set(e.id, `${e.reason || ''} ${e.comment || ''}`);
    }
  }
  const seen = new Set();
  const all = [...lines.values()].filter((l) => l.persona === persona).reverse(); // newest first
  for (const l of all) {
    const n = net.get(l.id) || 0;
    const key = String(l.prose).trim();
    if (seen.has(key)) continue;
    if (n > 0 && out.good.length < 12) { out.good.push(key); seen.add(key); }
    else if (n < 0 && out.bad.length < 5 && /off-character|human|character|bootlick|suck|wouldn.?t say|robot/i.test(why.get(l.id) || '')) { out.bad.push(key); seen.add(key); }
  }
  voiceCache.at = now;
  voiceCache.byPersona[persona] = out;
  return out;
}

// ── Change detection against the stored take ────────────────────────────────────────────────────

/** Facts whose value moved since the stored opinion, plus notable facts that appeared or vanished. */
export function changedFacts(stored, dossier) {
  if (!stored || !stored.factValues) return [];
  const was = stored.factValues;
  const out = [];
  const now = new Map(dossier.facts.map((f) => [f.id, f]));
  for (const f of dossier.facts) {
    if (f.group === 'traffic' || f.group === 'history') continue; // moment-to-moment, not a change of place
    if (!(f.id in was)) { if (f.salience >= CHANGE_SALIENCE) out.push({ id: f.id, was: null, now: f.value, salience: f.salience, text: `NEW: ${f.text}` }); }
    else if (JSON.stringify(was[f.id]) !== JSON.stringify(f.value)) out.push({ id: f.id, was: was[f.id], now: f.value, salience: f.salience, text: `${f.text} (was: ${was[f.id]})` });
  }
  for (const id of Object.keys(was)) {
    if (now.has(id) || /^(traffic|history)/.test(id)) continue;
    if (/^(war|owner\.state|svc|econ|lifecycle)/.test(id)) out.push({ id, was: was[id], now: null, salience: 40, text: `GONE since last time: ${id} (was ${was[id]})` });
  }
  return out;
}

// ── The beat ────────────────────────────────────────────────────────────────────────────────────

/**
 * A candidate beat on a fresh DockingGranted — or null when there is nothing new to say about this
 * station, or the API path is not in use. Cheap: no network here.
 */
export function detectOpinion(parsed, state, persona, { hauling = false, now = Date.now() } = {}) {
  const settings = (state && state.settings) || {};
  if (settings.copilotOpinions === false || settings.copilotLiveEnabled === false) return null;
  if (!apiReady(settings)) return null;
  const events = (parsed && parsed.allEvents) || [];
  const ev = events.find((e) => e && e.event === 'DockingGranted' && e.MarketID != null && now - Date.parse(e.timestamp) < RECENT_MS);
  if (!ev) return null;
  if (/fleetcarrier/i.test(String(ev.StationType || ''))) return null;
  if (now - lastOpinionAt < OPINION_GAP_MS) return null;
  const stored = opinionFor(persona, ev.MarketID);
  if (stored && hauling) return null; // mid-haul only a FIRST take, and a short one
  const dossier = buildStationDossier({ ev, state, persona, memory: getMemory(), nearby: nearbyNow(ev.MarketID, now), now });
  const changed = stored ? changedFacts(stored, dossier) : [];
  const docksSince = stored ? dossier.identity.docks - (stored.docks || 0) : 0;
  const eligible = !stored
    || changed.some((c) => c.salience >= CHANGE_SALIENCE)
    || (now - Date.parse(stored.at) > REVISIT_MS && docksSince >= REVISIT_DOCKS);
  if (!eligible) return null;
  return {
    key: 'station-opinion', priority: 47, interrupt: false, live: true, mood: 'calm', character: true,
    inputs: { station: ev.StationName || null, marketId: ev.MarketID },
    opinion: { ev, dossier, stored, changed, hauling },
  };
}

// ── Prompt ──────────────────────────────────────────────────────────────────────────────────────

const OPINION_RULES = [
  'STATION OPINIONS — you give YOUR OWN take on the station the commander has just been cleared to dock at.',
  '- Use ONLY the facts listed under FACTS. Put the id of every fact you lean on in "used". Never state anything about the station, its system, faction, market, or the commander that is not in those facts.',
  '- Write every number as digits, and only numbers that appear in the facts you cite. Never say how many times the commander has docked anywhere.',
  '- Your "stance" (-2 hate it ... +2 love it) must follow from the facts you cite and the way each pulls YOU (shown per fact). Going against a fact\'s pull needs another cited fact that outweighs it.',
  '- If you have a previous take, stay consistent with it unless something under CHANGED explains a change of mind — and then say what changed.',
  '- Faction readings are snapshots from the last jump in, never live news.',
  '- The commander is the captain: never tell them what to do, never flatter them. Never call a ship or a station "she" or "her".',
  '- Speak in the first person, one to three short sentences said aloud. Follow your structural rule for where a number goes.',
  '- "angle" is the group of the fact you LEAD with; "mood" is how you feel saying it.',
  '- Return only the JSON object.',
].join('\n');

function systemPrompt(persona, settings) {
  const dial = { humor: settings.copilotTarsHumor ?? 60, honesty: settings.copilotTarsHonesty ?? 80 };
  const voice = loadVoiceExamples(persona);
  const good = voice.good.length ? `LINES OF YOURS THE COMMANDER LIKED — this is how you sound (do not reuse them):\n${voice.good.map((l) => `- ${l}`).join('\n')}` : '';
  const bad = voice.bad.length ? `LINES THE COMMANDER REJECTED AS OFF-CHARACTER — never sound like this:\n${voice.bad.map((l) => `- ${l}`).join('\n')}` : '';
  return [COPILOT_RULES, buildPersonalityPreamble(persona, dial), OPINION_RULES, good, bad].filter(Boolean).join('\n\n');
}

const pullWord = (p) => (p >= 2 ? 'you love this' : p === 1 ? 'you like this' : p === -1 ? 'you dislike this' : p <= -2 ? 'you hate this' : 'neutral to you');

/** Facts the model sees: ranked by salience, recent angles pushed down, changed facts pushed up. */
export function pickFacts(dossier, persona, { changed = [], recentAngles = [] } = {}) {
  const changedIds = new Set(changed.map((c) => c.id));
  const recent = recentAngles.slice(-3);
  const scored = dossier.facts.map((f) => ({
    f,
    score: f.salience + (changedIds.has(f.id) ? 30 : 0) - (recent.includes(f.group) ? 25 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_FACTS).map((x) => x.f);
  if (!top.some((f) => f.id === 'type')) {
    const t = dossier.facts.find((f) => f.id === 'type');
    if (t) top.push(t);
  }
  return top;
}

function chooseForm(persona, stored, others) {
  const m = getMemory();
  if (!m.opinionForm || typeof m.opinionForm !== 'object') m.opinionForm = {};
  const n = Number(m.opinionForm[persona]) || 0;
  m.opinionForm[persona] = n + 1;
  const ok = FORMS.filter((f) => (f === 'callback' ? !!stored : f === 'compare' ? others.length > 0 : true));
  return ok[n % ok.length];
}

function otherViews(persona, marketId) {
  const all = opinionsOf(persona);
  return Object.entries(all)
    .filter(([k]) => k !== String(marketId))
    .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))
    .slice(0, 5)
    .map(([, o]) => ({ name: o.stationName, stance: o.stance }));
}

export function buildUserMessage({ dossier, persona, facts, stored, changed, recentAngles, form, others, hauling, recentLines }) {
  const id = dossier.identity;
  const fl = facts.map((f) => `- ${f.id} · ${f.text} · ${pullWord(f.pull[persona] || 0)}`).join('\n');
  const sum = facts.reduce((t, f) => t + (f.pull[persona] || 0), 0);
  const leaning = sum > 1 ? 'positive' : sum < -1 ? 'negative' : 'mixed or neutral';
  const parts = [
    `STATION: ${id.stationName} — ${id.typeLabel}${id.systemName ? `, ${id.systemName}` : ''}.`,
    `MOMENT: docking clearance was just granted${hauling ? '. The commander is mid-haul and working — ONE short sentence, 20 words at most' : ''}.`,
    `FACTS (id · fact · how it pulls you):\n${fl}`,
    `YOUR LEANING from these facts, by your tastes: ${leaning}.`,
  ];
  if (stored) {
    parts.push(`YOUR PREVIOUS TAKE (${String(stored.at).slice(0, 10)}, stance ${stored.stance > 0 ? '+' : ''}${stored.stance}): "${stored.line}" — it rested on: ${(stored.used || []).map((u) => u.id).join(', ')}`);
    parts.push(changed.length ? `CHANGED SINCE THEN:\n${changed.map((c) => `- ${c.id}: ${c.text}`).join('\n')}` : 'CHANGED SINCE THEN: nothing notable — stay consistent with your previous take.');
  } else {
    parts.push('This is your FIRST take on this station.');
  }
  if (recentAngles.length) parts.push(`ANGLES YOU LED WITH RECENTLY (lead with something else): ${recentAngles.slice(-3).join(', ')}`);
  if (form === 'compare' && others.length) parts.push(`STATIONS YOU ALREADY HAVE A VIEW ON (compare only by name and your stance): ${others.map((o) => `${o.name} (${o.stance > 0 ? '+' : ''}${o.stance})`).join(', ')}`);
  parts.push(`FORM THIS TIME: ${FORM_TEXT[form]}.`);
  if (recentLines.length) parts.push(`YOUR RECENT LINES — do not reuse their openings, jokes or structure:\n${recentLines.slice(-12).map((l) => `- ${l}`).join('\n')}`);
  return parts.join('\n\n');
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────

const lc = (s) => String(s || '').toLowerCase();
const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const QUANTITY = /^(pads?|light-?seconds?|ls|percent|%|tons?|tonnes?|million|billion|thousand|hundred|credits?|cr|times|pilots?|ships?|days?|minutes?|hours?|people)$/i;
const SCALE = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9 };

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Numbers a line asserts, after removing names (which often carry digits: systems, stations, hulls). */
export function numbersIn(line, names = []) {
  let s = ` ${String(line || '')} `;
  for (const n of [...names].filter(Boolean).sort((a, b) => String(b).length - String(a).length)) {
    s = s.replace(new RegExp(escRe(n), 'gi'), ' ');
  }
  s = s.replace(/\b[a-z]+-?\d+[a-z0-9-]*\b/gi, ' ').replace(/\b\d+[a-z]+[a-z0-9-]*\b/gi, (m) => (/^\d+(st|nd|rd|th|g|ls)$/i.test(m) ? m.replace(/[a-z]+$/i, '') : ' '));
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|bn|k\b|m\b)?/gi;
  let m;
  while ((m = re.exec(s))) {
    const v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    out.push(m[2] ? v * (SCALE[lc(m[2])] || 1) : v);
  }
  const words = lc(s).replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const parts = words[i].split('-');
    if (!parts.every((p) => p in NUMBER_WORDS)) continue;
    const v = parts.reduce((t, p) => t + NUMBER_WORDS[p], 0);
    const next = words[i + 1] || '';
    if (QUANTITY.test(next)) out.push(next in SCALE ? v * SCALE[next] : v);
  }
  return out;
}

function numberAllowed(x, allowed) {
  for (const v of allowed) {
    const tol = Math.max(0.5, Math.abs(v) * 0.03);
    if (Math.abs(x - v) <= tol) return true;
    for (const k of [1e3, 1e6, 1e9]) if (Math.abs(x * k - v) <= Math.abs(v) * 0.05) return true;
    if (v >= 1000 && Math.abs(x - v) <= Math.abs(v) * 0.05) return true; // "about 17 million" style rounding
  }
  return false;
}

const norm = (s) => lc(s).replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
const opening = (s) => norm(s).split(' ').slice(0, 3).join(' ');
function trigrams(s) {
  const w = norm(s).split(' ').filter(Boolean);
  const set = new Set();
  for (let i = 0; i + 2 < w.length; i++) set.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Every check a take must pass. Returns the list of reasons it failed — empty means say it.
 * Pure, so tests can feed it planted failures.
 */
export function validateOpinion(out, { dossier, persona, stored = null, changed = [], recentLines = [], maxWords = 60, extraNames = [] }) {
  const why = [];
  if (!out || typeof out !== 'object') return ['no JSON object came back'];
  const line = String(out.line || '').trim().replace(/^["'“]+|["'”]+$/g, '');
  if (!line) return ['empty line'];
  if (![-2, -1, 0, 1, 2].includes(out.stance)) why.push('stance must be an integer from -2 to 2');
  if (!ANGLES.includes(out.angle)) why.push(`angle must be one of: ${ANGLES.join(', ')}`);
  const byId = new Map(dossier.facts.map((f) => [f.id, f]));
  const used = Array.isArray(out.used) ? out.used.map(String) : [];
  if (!used.length) why.push('cite at least one fact id in "used"');
  const unknown = used.filter((id) => !byId.has(id));
  if (unknown.length) why.push(`cited ids that are not on the sheet: ${unknown.join(', ')}`);
  const cited = used.filter((id) => byId.has(id)).map((id) => byId.get(id));

  // Numbers — only from cited facts.
  const names = [dossier.identity.stationName, dossier.identity.systemName, ...extraNames];
  for (const f of dossier.facts) {
    const m = f.text.match(/^(?:Run by|On|Over) ([^,(—]+)/);
    if (m) names.push(m[1].trim());
    for (const n of f.text.match(/\b(?:with|in a [a-z ]+ with) ([A-Z][^—(]+?)(?= —|$)/g) || []) names.push(n.replace(/^.*with /, '').trim());
    const c = f.id.match(/^market\.(?:cheap|pays)\.(.+)$/);
    if (c) names.push(c[1]);
    if (f.id === 'market.garnish' || f.id === 'market.need') names.push(String(f.value));
  }
  const allowed = cited.flatMap((f) => f.numbers);
  const bad = numbersIn(line, names).filter((x) => !numberAllowed(x, allowed));
  if (bad.length) why.push(`numbers not backed by a cited fact: ${[...new Set(bad)].join(', ')}`);

  // Logic — the verdict follows from the cited facts' pulls for this persona.
  const pulls = cited.map((f) => f.pull[persona] || 0);
  const pos = pulls.some((p) => p > 0);
  const neg = pulls.some((p) => p < 0);
  if (out.stance >= 1 && !pos && neg) why.push('a positive stance needs at least one cited fact that pulls you positive');
  if (out.stance <= -1 && !neg && pos) why.push('a negative stance needs at least one cited fact that pulls you negative');
  if (!pos && !neg && Math.abs(out.stance) > 1) why.push('only neutral facts cited — stance can be at most ±1');
  if (stored && sign(stored.stance) && sign(out.stance) && sign(stored.stance) !== sign(out.stance)) {
    const ch = new Set(changed.map((c) => c.id));
    if (!used.some((id) => ch.has(id))) why.push('you changed your mind without citing a fact that changed');
  }

  // Character.
  if (/\b(she|her|hers|herself)\b/i.test(line)) why.push('never "she" or "her"');
  if (/\b(wren|tycho|tars|k-?2)\b/i.test(line)) why.push('never name yourself or another co-pilot');
  if (/[*_#`]/.test(line)) why.push('no markdown');
  if (persona === 'wash' && /^\W*\d/.test(line)) why.push('Wren never leads with a number');
  const words = line.split(/\s+/).filter(Boolean).length;
  if (words > maxWords) why.push(`too long (${words} words, max ${maxWords})`);
  const sentences = line.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
  if (sentences > 3) why.push('at most three sentences');

  // Variety.
  const tg = trigrams(line);
  const op = opening(line);
  for (const r of recentLines) {
    if (op.split(' ').length >= 3 && op === opening(r)) { why.push(`opens the same way as a recent line ("${op}")`); break; }
    if (jaccard(tg, trigrams(r)) >= 0.35) { why.push('too close to a recent line'); break; }
  }
  return why;
}

// ── Generate, check, speak, remember ────────────────────────────────────────────────────────────

/**
 * Run the opinion beat that won the arbiter. Returns the spoken line, or null (failed checks twice,
 * API error, refusal) — silence rather than a wrong line.
 */
export async function runOpinion(beat, state, settings, deps, { recentLines = [] } = {}) {
  const persona = settings.copilotPersonality || 'wash';
  const { ev, dossier, stored, changed, hauling } = beat.opinion;
  lastOpinionAt = Date.now();
  const angles = anglesOf(persona);
  const others = otherViews(persona, ev.MarketID);
  const form = chooseForm(persona, stored, others);
  const facts = pickFacts(dossier, persona, { changed, recentAngles: angles });
  const shown = { identity: dossier.identity, facts };
  const memLines = linesOf(persona);
  const recent = [...memLines, ...recentLines].slice(-LINES_KEPT);
  const maxWords = hauling ? 20 : 60;
  const system = systemPrompt(persona, settings);
  let user = buildUserMessage({ dossier, persona, facts, stored, changed, recentAngles: angles, form, others, hauling, recentLines: recent });
  const extraNames = others.map((o) => o.name);

  let out = null;
  let spentUsd = 0;
  let lastWhy = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await apiComplete({ system, userMessage: user, settings, effort: 'medium', schema: OPINION_SCHEMA, maxTokens: 3000, timeoutMs: 45_000, purpose: 'opinion' });
    } catch (e) {
      console.error('[Copilot] opinion generation failed:', e && e.message);
      return null;
    }
    spentUsd += res.costUsd || 0;
    if (res.stopReason === 'refusal' || !res.json) { lastWhy = [res.stopReason === 'refusal' ? 'refused' : 'no JSON']; break; }
    const why = validateOpinion(res.json, { dossier: shown, persona, stored, changed, recentLines: recent, maxWords, extraNames });
    if (!why.length) { out = res.json; break; }
    lastWhy = why;
    console.log(`[Copilot] opinion rejected (${why.join('; ')}) — ${attempt === 0 ? 'one rewrite' : 'staying quiet'}`);
    user = `${user}\n\nYOUR LAST ATTEMPT WAS REJECTED: ${why.join('; ')}. Write a new take that fixes every point.`;
  }
  if (!out) {
    if (lastWhy.length) console.log(`[Copilot] no opinion of ${dossier.identity.stationName} (${lastWhy.join('; ')}) · $${spentUsd.toFixed(4)}`);
    return null;
  }

  const line = String(out.line).trim().replace(/^["'“]+|["'”]+$/g, '');
  const mood = MOODS.includes(out.mood) ? out.mood : 'calm';
  const byId = new Map(dossier.facts.map((f) => [f.id, f]));
  const used = out.used.filter((id) => byId.has(id));
  const id = deps.captureLine
    ? deps.captureLine({ source: 'live', persona, beat: 'station-opinion', mood, prose: line, inputs: { station: dossier.identity.stationName, marketId: ev.MarketID, stance: out.stance, used }, trigger: `DockingGranted: ${ev.StationName || ''}` })
    : undefined;
  deps.broadcastEvent({
    type: 'copilot_line', id, line, beat: 'station-opinion', mood, timestamp: new Date().toISOString(),
    usage: { in: 0, out: 0, costUsd: spentUsd, ms: 0 },
  });
  console.log(`[Copilot] opinion of ${dossier.identity.stationName} (${out.stance > 0 ? '+' : ''}${out.stance}, ${out.angle}): "${line}" · $${spentUsd.toFixed(4)} · ${modelOf(settings)}`);
  markOpined(ev.MarketID);

  // Remember: the take, the verdict, what it rested on, and every fact's value now (for next time's diff).
  const all = opinionsOf(persona);
  all[String(ev.MarketID)] = {
    stationName: dossier.identity.stationName,
    systemName: dossier.identity.systemName,
    line, stance: out.stance, mood, angle: out.angle, form,
    used: used.map((u) => ({ id: u, value: byId.get(u).value })),
    factValues: Object.fromEntries(dossier.facts.map((f) => [f.id, f.value])),
    docks: dossier.identity.docks,
    at: new Date().toISOString(),
    captureId: id || null,
  };
  const keys = Object.keys(all);
  if (keys.length > MAX_STORED) {
    keys.sort((a, b) => String(all[a].at).localeCompare(String(all[b].at)));
    for (const k of keys.slice(0, keys.length - MAX_STORED)) delete all[k];
  }
  angles.push(out.angle);
  while (angles.length > ANGLES_KEPT) angles.shift();
  memLines.push(line);
  while (memLines.length > LINES_KEPT) memLines.shift();
  saveMemory();
  return line;
}

/** /copilot-rate: a thumbs-down on an opinion drops it, so the next visit forms a fresh one. */
export function onOpinionRated(captureId, rating) {
  if (!captureId) return false;
  const ops = getMemory().opinions || {};
  for (const persona of Object.keys(ops)) {
    for (const [k, o] of Object.entries(ops[persona] || {})) {
      if (!o || o.captureId !== captureId) continue;
      if (Number(rating) < 0) {
        delete ops[persona][k];
        console.log(`[Copilot] opinion of ${o.stationName} dropped (thumbs down) — a fresh take next visit`);
      } else {
        o.rating = Number(rating) || 0;
      }
      saveMemory();
      return true;
    }
  }
  return false;
}

/** Test seam. */
export function _resetOpinionTimers() { lastOpinionAt = 0; voiceCache = { at: 0, byPersona: {} }; }
