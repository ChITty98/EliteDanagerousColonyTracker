// server/ai/copilot.js
//
// The co-pilot orchestrator. Called once per journal poll tick with the parsed
// events + current state. It either reacts to the highest-priority beat this
// tick, or — when nothing notable is happening but the journal is live — fills
// the quiet with ambient chatter. One line at a time; the anti-repeat memory and
// timing live here in process memory (not the persisted store).

import { copilotComplete } from './copilotProvider.js';
import { COPILOT_RULES, buildPersonalityPreamble, matchBeat, IDLE_INTENTS } from './copilotRules.js';
import { awayProcess, awayContextFact, awayState, isSrvType } from './copilotAway.js';
import { friendlyShip } from '../journal/extractor.js';
import { buildSnapshot, eventDetail, decorateScan, detectCompletion, detectBuildComplete, detectInferredDamage, detectAutopilot, detectDockComplete, detectDockInfo, detectNpcThreat, detectAtmo, detectCrew, detectPilotBanter, detectSessionStart, detectGrudge, detectSystemChange, detectQuestion, detectDockFlavor, detectArrival, detectCargoBayGripe, detectSrvReturn, detectDamageSeverity, detectPaceNudge, detectCarrierFuel, getCrewNames, ingestWorld , isHaulSessionActive } from './copilotContext.js';
import { isCannedScenario, pickCanned } from './copilotCanned.js';
import { detectTarsLore } from './copilotTars.js';
import { detectMiningBeat } from './copilotMining.js';
import { detectRadarBeat } from './copilotRadar.js';
import { fetchGalNet, getLatestNews } from './copilotNews.js';
import { arbitrate, recordSpoken } from './copilotArbiter.js';
import { detectAffinityBeat } from './copilotAffinity.js';

import { detectQuirk } from './copilotQuirks.js';
import { onSessionAndPresence, onDock, detectColonyWatch, detectAreaActivity } from './copilotColonyWatch.js';

const RECENT_MAX = 8;
const RECENCY_MS = 120000; // events older than this are a re-sync replay, not live play
// Ambient chatter pauses after this many idle lines with no real activity between them (don't
// blather to an absent commander); a real beat re-arms it. SCALED BY THE CHATTINESS SLIDER —
// as a flat 2 it was the one thing the slider didn't touch, so Chatty and Quiet both went silent
// after two lines and Chatty never felt chatty on a long quiet cruise leg.
//   Chatty (60s) -> 5   ·   Normal (120s) -> 3   ·   Quiet (240s) -> 2
//
// TUNED DOWN from 480 after measuring the result: at a cap of 8, ambient chatter was 60% of
// everything said (idle-joke 27 / idle-observe 24 / idle-fact 21 out of 120 lines). There are only
// three idle scenarios and ~22 lines each per persona, so a Chatty session ran the whole ambient
// corpus and started to feel repetitive even though few lines literally repeated. The cap governs
// how many idle lines may run BACK TO BACK before she waits for something real to happen, so it is
// the lever that controls how much of her talking is filler.
const maxIdleStreakFor = (idleGapSec) => Math.max(2, Math.round(300 / idleGapSec));

const recentLines = []; // rolling anti-repeat memory (fed back into each prompt)
let offeredHeadline = ''; // a GalNet headline is OFFERED to idle exactly once ("5TH MESSAGE ON THAT ITEM" 👎)
let spokenNewsTitle = ''; // the news beat speaks each article once, ever
let lastSpokeAt = 0;
let lastIdleKey = '';
let idleStreak = 0; // consecutive ambient lines since the last real beat
let inFlight = false; // one line at a time — never stack `claude -p` subprocesses
let _enabledLogged = false; // log enable-state changes once (terminal diagnostics)
let _idleQuietLogged = false; // log the "paused ambient" message once per quiet stretch
// Commander-presence gate. The launcher/main menu still writes journal lines (Fileheader,
// Music: MainMenu) and game exit writes trailing events — each one ticks runCopilot, and idle
// beats happily fired into an empty cockpit (invisible until the global pop-up made every line
// visible). True between LoadGame and Shutdown/MainMenu; seeded from the journal tail at boot.
// The Cockpit buttons (runOnDemand/runNews) bypass this deliberately — pressing a button IS presence.
let inGame = false;
let _inGameLogged = null;
export function setInGame(v, why) {
  inGame = !!v;
  if (_inGameLogged !== inGame) {
    console.log('[Copilot] commander ' + (inGame ? 'in-game' : 'not in-game') + (why ? ' (' + why + ')' : ''));
    _inGameLogged = inGame;
  }
}

/**
 * React to this tick's events (or fill the quiet) in character. Fire-and-forget.
 * @param {{ allEvents?: any[] }} parsed
 * @param {any} state  current colony-data.json (deps.readState() result)
 * @param {{ broadcastEvent: (e:any)=>void }} deps
 */
export async function runCopilot(parsed, state, deps) {
  const settings = (state && state.settings) || {};
  const enabled = !!settings.copilotEnabled;
  if (enabled && !_enabledLogged) { console.log('[Copilot] enabled — watching for moments'); _enabledLogged = true; }
  else if (!enabled && _enabledLogged) { console.log('[Copilot] disabled'); _enabledLogged = false; }
  if (!enabled) return;

  const events = (parsed && parsed.allEvents) || [];
  if (events.length === 0) return;

  // STATE INGESTION RUNS UNCONDITIONALLY — before the inFlight gate. Gating it behind inFlight
  // dropped every tick that arrived while a live line was generating: a RepairAll landed in one
  // of those windows and world.hull sat at 63% for a quarter hour after the commander repaired.
  // Only SPEAKING waits on inFlight; awareness never does.
  ingestWorld(parsed); // keep world awareness (security / body / atmosphere / hull) current
  // Away-team state: is the commander out in the Nomad / on foot? The big ship (with
  // the co-pilot aboard) follows the deployed vehicle, so every line while away must
  // read as 'I'm up here watching you down there'. See copilotAway.js.
  try { awayProcess(parsed, state); } catch (e) { console.error('[Copilot] away state:', e && e.message); }
  onSessionAndPresence(parsed, state); // track own-presence + kick the session-start colony-watch snapshot
  onDock(parsed, state);               // kick the post-dock area ping (both write results read by their detectors)

  // Presence transitions ride the same events we just ingested.
  for (const e of events) {
    if (!e) continue;
    if (e.event === 'LoadGame') setInGame(true, 'LoadGame');
    else if (e.event === 'Shutdown') setInGame(false, 'Shutdown');
    else if (e.event === 'Music' && e.MusicTrack === 'MainMenu') setInGame(false, 'main menu');
  }
  // No commander in the seat → no beats of any kind. Awareness above stays current regardless.
  if (!inGame) return;

  if (inFlight) return;

  const now = Date.now();
  const isRecent = (ts) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) && now - t < RECENCY_MS;
  };
  // A "live" tick has at least one recent event — the game is actively writing
  // the journal right now (not a historical re-sync). Never react to a stale tick.
  if (!events.some((e) => e && isRecent(e.timestamp))) return;

  // Gather EVERY eligible beat this tick: the synthetic completion beat, each
  // matched event beat, and — unless we're AFK-capped — an idle candidate. The
  // arbiter scores them all and returns at most one winner (or null = stay quiet).
  const persona = settings.copilotPersonality || 'wash';
  const hauling = isHaulSessionActive(state); // declared run (Start Session) → mute station flavour, focus the job
  const candidates = [];
  const completion = detectCompletion(parsed, state);
  if (completion) candidates.push({ beat: completion, ev: null, synthetic: true, place: placeFor(state, null) });
  const buildDone = detectBuildComplete(parsed, state);
  if (buildDone) candidates.push({ beat: buildDone, ev: null, synthetic: true, place: placeFor(state, null) });
  const inferred = detectInferredDamage(parsed);
  if (inferred) candidates.push({ beat: inferred, ev: null, synthetic: true, place: placeFor(state, null) });
  const npcThreat = detectNpcThreat(parsed);
  if (npcThreat) candidates.push({ beat: npcThreat, ev: null, synthetic: true, place: placeFor(state, null) });
  const autopilot = detectAutopilot(parsed, state);
  if (autopilot) candidates.push({ beat: autopilot, ev: null, synthetic: true, place: placeFor(state, null) });
  // Suppressed while away: its premise (crammed in THIS ship's hold) is wrong when the
  // commander is out in the Nomad / on foot and the co-pilot is the one flying the ship.
  const cargoGripe = awayState().away ? null : detectCargoBayGripe(parsed, state, persona);
  const srvReturn = detectSrvReturn(parsed, state); // back aboard from the Nomad — welcome-back flavour
  if (cargoGripe) candidates.push({ beat: cargoGripe, ev: null, synthetic: true, place: placeFor(state, null) });
  if (srvReturn) candidates.push({ beat: srvReturn, ev: null, synthetic: true, place: placeFor(state, null) });
  const dockComplete = detectDockComplete(parsed, state); // also advances the music tracker — keep before dockInfo
  if (dockComplete) candidates.push({ beat: dockComplete, ev: null, synthetic: true, place: placeFor(state, null) });
  const dockInfo = detectDockInfo(parsed, state);
  if (dockInfo) candidates.push({ beat: dockInfo, ev: null, synthetic: true, place: placeFor(state, null) });
  const quirk = detectQuirk(parsed, state, persona);
  if (quirk) candidates.push({ beat: quirk, ev: null, synthetic: true, place: placeFor(state, null) });
  const miningBeat = detectMiningBeat(); // catches, records, streaks — pushed by the mining assist
  if (miningBeat) candidates.push({ beat: miningBeat, ev: null, synthetic: true, place: placeFor(state, null) });
  const radarBeat = detectRadarBeat(); // rival builds / fresh site leads / frontier quiet
  if (radarBeat) candidates.push({ beat: radarBeat, ev: null, synthetic: true, place: placeFor(state, null) });
  const atmo = detectAtmo(parsed);
  if (atmo) candidates.push({ beat: atmo, ev: null, synthetic: true, place: placeFor(state, null) });
  const crew = detectCrew(parsed, state);
  if (crew) candidates.push({ beat: crew, ev: null, synthetic: true, place: placeFor(state, null) });
  const pilotBanter = detectPilotBanter(parsed);
  if (pilotBanter) candidates.push({ beat: pilotBanter, ev: null, synthetic: true, place: placeFor(state, null) });
  const sessionStart = detectSessionStart(parsed);
  if (sessionStart) candidates.push({ beat: sessionStart, ev: null, synthetic: true, place: placeFor(state, null) });
  const grudge = detectGrudge(parsed);
  if (grudge) candidates.push({ beat: grudge, ev: null, synthetic: true, place: placeFor(state, null) });
  const sysChange = detectSystemChange(parsed, state);
  if (sysChange) candidates.push({ beat: sysChange, ev: null, synthetic: true, place: placeFor(state, null) });
  const question = detectQuestion(parsed, state);
  if (question) candidates.push({ beat: question, ev: null, synthetic: true, place: placeFor(state, null) });
  const tarsLore = detectTarsLore(parsed, state);
  if (tarsLore) candidates.push({ beat: tarsLore, ev: null, synthetic: true, place: placeFor(state, null) });
  const news = detectNews(parsed, state);
  if (news) candidates.push({ beat: news, ev: null, synthetic: true, place: placeFor(state, null) });
  const dockFlavor = detectDockFlavor(parsed, state);
  if (dockFlavor) candidates.push({ beat: dockFlavor, ev: null, synthetic: true, place: placeFor(state, null) });
  const arrival = detectArrival(parsed, state);
  if (arrival) candidates.push({ beat: arrival, ev: null, synthetic: true, place: placeFor(state, null) });
  const damageSeverity = detectDamageSeverity(parsed, state);
  if (damageSeverity) candidates.push({ beat: damageSeverity, ev: null, synthetic: true, place: placeFor(state, null) });
  const paceNudge = detectPaceNudge(parsed, state);
  if (paceNudge) candidates.push({ beat: paceNudge, ev: null, synthetic: true, place: placeFor(state, null) });
  const colonyWatch = detectColonyWatch(parsed, state); // "while you were away" area diff (session start)
  if (colonyWatch) candidates.push({ beat: colonyWatch, ev: null, synthetic: true, place: placeFor(state, null) });
  const areaActivity = detectAreaActivity(parsed, state); // post-dock "word from local contacts" ping
  if (areaActivity) candidates.push({ beat: areaActivity, ev: null, synthetic: true, place: placeFor(state, null) });
  const carrierFuel = detectCarrierFuel(state); // state-driven tritium watch — no CarrierStats event needed
  if (carrierFuel) candidates.push({ beat: carrierFuel, ev: null, synthetic: true, place: placeFor(state, null) });
  for (const ev of events) {
    if (!ev || !isRecent(ev.timestamp)) continue;
    if (ev.event === 'Scan') decorateScan(ev);
    const beat = matchBeat(ev);
    if (beat) candidates.push({ beat, ev, place: placeFor(state, ev) });
    // Persona affinity (economy / superpower / body / services / ship) — LIVE,
    // arbiter-gated so it's rare, never every dock.
    const aff = detectAffinityBeat(ev, persona, hauling, state);
    if (aff) candidates.push({ beat: aff, ev, place: placeFor(state, ev) });
  }
  const hasRealBeat = candidates.length > 0;

  // The chattiness slider scales everything: at Chatty we react to ~every event
  // (tiny spacing, no repeat-suppression); at Quiet it's sparse. Read BEFORE the idle
  // candidate below, which now scales its own cap off the same figure.
  const idleGapSec = Math.max(30, settings.copilotIdleGapSec ?? 120);
  const chattyFactor = Math.max(0.15, Math.min(1, (idleGapSec - 60) / 180)); // 0.15 floor trims Chatty's lowest-value chatter ~15%; full at Quiet
  const maxIdleStreak = maxIdleStreakFor(idleGapSec);

  // Idle is a low-priority candidate — the arbiter only lets it win during a
  // genuine lull (staleness lifts it over the decaying threshold). Capped so it
  // doesn't chatter into the void while you're AFK.
  if (idleStreak < maxIdleStreak) {
    const idle = peekIdle();
    candidates.push({ beat: { key: idle.key, priority: 16, interrupt: false, mood: idle.mood, _idle: true, intent: idle.intent, model: idle.model }, ev: null, place: null });
  }

  const winner = arbitrate(candidates, {
    now,
    lastSpokeAt,
    minSpacingMs: Math.max(2000, (idleGapSec - 50) * 250), // ~3s Chatty · ~18s Normal · ~48s Quiet
    chattinessMs: idleGapSec * 1000,
    chattyFactor,
  });

  if (!winner) {
    if (!hasRealBeat && idleStreak >= maxIdleStreak && !_idleQuietLogged) {
      console.log(`[Copilot] no recent activity — ambient chatter paused after ${idleStreak} idle lines (cap ${maxIdleStreak})`); _idleQuietLogged = true;
    }
    return;
  }

  const beat = winner.beat;
  _lastTrigger = captureTrigger(winner, state);
  recordSpoken(beat.key, winner.place, now);

  // A Q&A question — broadcast the question + its tappable options; the answer returns
  // via /copilot-answer. Not a normal line, so it short-circuits the canned/live path.
  if (beat.question) { idleStreak = 0; _idleQuietLogged = false; emitQuestion(settings, deps, beat); return; }

  if (beat._idle) {
    idleStreak++;
    lastIdleKey = beat.key;
    // CANNED-FIRST for idle: live idle chatter kept "saying something to say something" (the
    // commander's words) — the curated pool speaks now; live is only the fallback when the pool
    // has nothing usable for this persona/scenario.
    if (emitCanned(settings, deps, beat, buildCannedContext(state, null))) return;
    // Offer a headline to idle chatter ONCE per article — offering it every idle line had the
    // model bringing up the same announcement five times a session.
    const news = getLatestNews();
    const freshNews = news && news.title && news.title !== offeredHeadline ? news : null;
    if (freshNews) offeredHeadline = freshNews.title;
    const awayFact = awayContextFact(motherShipLabel(state));
    const detail0 = freshNews ? `A recent GalNet headline you MAY mention if it fits: "${freshNews.title}". If you mention it, stick to the headline itself — NEVER invent gameplay mechanics, capabilities, or implications beyond its text, and never tie it to the commander's own work.` : '';
    const detail = [detail0, awayFact].filter(Boolean).join(' ');
    await speak(state, settings, deps, { key: beat.key, intent: beat.intent, model: 'sonnet', mood: beat.mood, detail });
    return;
  }

  // A real beat won — re-arm ambient chatter.
  idleStreak = 0;
  _idleQuietLogged = false;
  // A beat carrying a ready-made literal line (e.g. Colony Watch's "all quiet" lines) — broadcast it
  // as-is, instant and free. No canned pool, no live generation.
  if (beat.line) { emitLiteral(settings, deps, beat); return; }
  if (isCannedScenario(beat.key)) {
    emitCanned(settings, deps, beat, Object.assign(buildCannedContext(state, winner.ev), beat.inputs || {}));
  } else {
    const awayFact = awayContextFact(motherShipLabel(state));
    const detail = [winner.synthetic ? beat.detail : eventDetail(winner.ev), awayFact].filter(Boolean).join(' ');
    const inputs = winner.synthetic ? (beat.inputs || null) : captureInputsForEvent(winner.ev);
    // Flywheel: try a PROMOTED template (free) before paying for live generation. The
    // promoted pool is grown offline by tools/promote-copilot-captures.mjs from high-
    // rated captures, templatized from their logged inputs (slot keys = input keys).
    const promotedCtx = { ...buildCannedContext(state, winner.ev), ...(inputs || {}) };
    if (emitCanned(settings, deps, beat, promotedCtx, 'promoted')) return;
    await speak(state, settings, deps, {
      key: beat.key, intent: beat.intent, model: beat.model, mood: beat.mood, detail, inputs,
      fallback: () => emitCanned(settings, deps, beat, promotedCtx, 'canned'),
    });
  }
}

/**
 * The "What's on your mind?" button — an on-demand, always-paid live line about
 * the current moment. The player explicitly asked, so it bypasses the arbiter; it
 * still respects the one-at-a-time guard, and is captured + ratable like any live
 * line. Exported so the server's /copilot-ask endpoint can call it.
 */
export async function runOnDemand(state, deps) {
  if (inFlight) return;
  const settings = (state && state.settings) || {};
  if (!settings.copilotEnabled) return;
  const intent = "The commander just asked what's on your mind. React to the CURRENT moment — where you are, what you're doing, the build progress, the view, whatever is most worth saying right now. If it's genuinely quiet, a short honest 'all quiet' in character is fine.";
  _lastTrigger = 'on-demand';
  await speak(state, settings, deps, {
    key: 'whats-on-your-mind', intent, model: 'sonnet', mood: 'calm', detail: '', inputs: null,
  });
}

// GalNet news — the co-pilot leads with their TAKE on a REAL current headline. Real data
// only (anti-invention): if the feed is empty/down, say nothing rather than invent.
function newsIntent(a) {
  return `The commander wants the news. REAL current GalNet headline: "${a.title}". Lead with YOUR TAKE — your read, what it means, whether it matters to us — NOT a re-read of the article. Curate and contextualise; this is your domain. Far-off galactic politics → a lighter "someone else's problem" read; anything that could touch our region or our work → more engaged. Short, in character. Use ONLY the headline/snippet — never invent details, numbers, outcomes, or how announced ships/tech/features WORK (no invented gameplay mechanics or capabilities) beyond it.`;
}

/** The "What's the news?" button — fetch a real GalNet headline + a live take. No token cost
 *  beyond the take; returns via SSE. Exported for the /copilot-news endpoint. */
export async function runNews(state, deps) {
  if (inFlight) return;
  const settings = (state && state.settings) || {};
  if (!settings.copilotEnabled) return;
  const article = await fetchGalNet();
  if (!article) {
    if (deps.broadcastEvent) deps.broadcastEvent({ type: 'copilot_line', line: 'Nothing worth your time on the feeds right now.', beat: 'news', mood: 'calm', timestamp: new Date().toISOString(), usage: { in: 0, out: 0, costUsd: 0, ms: 0, canned: true } });
    return;
  }
  _lastTrigger = 'news-button';
  await speak(state, settings, deps, { key: 'news', intent: newsIntent(article), model: 'sonnet', mood: 'calm', detail: `Snippet: ${article.snippet}`, inputs: null });
}

// Organic news beat — occasionally (rare, on a quiet cruise) surface the cached latest item.
let lastNewsAt = 0;
const NEWS_GAP_MS = 30 * 60 * 1000;
function detectNews(parsed, state) {
  const events = (parsed && parsed.allEvents) || [];
  const now = Date.now();
  if (now - lastNewsAt < NEWS_GAP_MS) return null;
  const isRecent = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && now - t < 120000; };
  if (!events.some((e) => e && e.event === 'SupercruiseEntry' && isRecent(e.timestamp))) return null;
  const a = getLatestNews();
  if (!a) return null;
  if (a.title === spokenNewsTitle) return null; // each article gets ONE take, ever
  spokenNewsTitle = a.title;
  lastNewsAt = now;
  return { key: 'news', priority: 42, interrupt: false, live: true, model: 'haiku', mood: 'calm', intent: newsIntent(a), detail: `Snippet: ${a.snippet}`, inputs: null };
}

function peekIdle() {
  // Choose a flavour WITHOUT committing — lastIdleKey is set only if idle actually
  // wins the tick, so the don't-repeat guard reflects what was really said.
  const pool = IDLE_INTENTS.filter((i) => i.key !== lastIdleKey);
  return pool[Math.floor(Math.random() * pool.length)] || IDLE_INTENTS[0];
}

// A stable label for "where we are" so the arbiter can penalise repeat comments
// about the same station / system / body — this is what kills dock-spam.
function placeFor(state, ev) {
  if (ev) {
    if (ev.StationName) return `station:${ev.StationName}`;
    if (ev.StarSystem) return `system:${ev.StarSystem}`;
    if (ev.BodyName || ev.Body) return `body:${ev.BodyName || ev.Body}`;
  }
  const pos = (state && state.commanderPosition) || {};
  const sys = pos.name || pos.system || pos.systemName;
  return sys ? `system:${sys}` : null;
}

let _lastTrigger = null; // "what fired the current line + situation", logged with each capture
// Compact trigger tag so a later 👎+comment has context (which event, docked, mid-haul) on review.
function captureTrigger(winner, state) {
  const ev = winner && winner.ev;
  let t;
  if (ev && ev.event) {
    const id = ev.StationName || ev.BodyName || ev.StarSystem || ev.MusicTrack || ev.Body || '';
    t = id ? `${ev.event}: ${id}` : ev.event;
  } else if (winner && winner.beat && winner.beat._idle) t = 'idle-timer';
  else t = winner && winner.synthetic ? `synthetic:${winner.beat.key}` : 'event';
  const s = state || {};
  const tags = [(s.currentDock && s.currentDock.stationName) ? 'docked' : '', isHaulSessionActive(s) ? 'mid-haul' : ''].filter(Boolean);
  return tags.length ? `${t} | ${tags.join(' ')}` : t;
}

// --- Canned emission (free; no `claude -p`) --------------------------------
// Routine + idle beats resolve to a pre-generated line, slot-filled from live
// context, and broadcast straight to the cockpit. Zero token cost.
function emitCanned(settings, deps, beat, ctx, source = 'canned') {
  const personality = settings.copilotPersonality || 'wash';
  const line = pickCanned(personality, beat.key, ctx);
  // 'promoted' is a best-effort try BEFORE live — no usable line just means fall through.
  if (!line) { if (source === 'canned') console.log(`[Copilot] canned ${beat.key}: no usable line, staying quiet`); return false; }
  lastSpokeAt = Date.now();
  recentLines.push(line);
  while (recentLines.length > RECENT_MAX) recentLines.shift();
  console.log(`[Copilot] ${source}: ${beat.key} → "${line}"`);
  // Canned/promoted lines are logged too — so a 👎 can prune a weak one from rotation.
  const id = deps.captureLine
    ? deps.captureLine({ source, persona: personality, beat: beat.key, mood: beat.mood, prose: line, inputs: null, trigger: _lastTrigger || null })
    : undefined;
  deps.broadcastEvent({
    type: 'copilot_line', id, line, beat: beat.key, mood: beat.mood, timestamp: new Date().toISOString(),
    usage: { in: 0, out: 0, costUsd: 0, ms: 0, canned: true },
  });
  return true;
}

// A beat that already carries its finished text in `beat.line` — broadcast it directly, the same
// free path as a canned line but with a caller-supplied string (Colony Watch "quiet" reports).
function emitLiteral(settings, deps, beat) {
  const personality = settings.copilotPersonality || 'wash';
  if (!beat.line) return;
  lastSpokeAt = Date.now();
  recentLines.push(beat.line);
  while (recentLines.length > RECENT_MAX) recentLines.shift();
  console.log(`[Copilot] ${beat.source || 'literal'}: ${beat.key} → "${beat.line}"`);
  const id = deps.captureLine
    ? deps.captureLine({ source: beat.source || 'literal', persona: personality, beat: beat.key, mood: beat.mood, prose: beat.line, inputs: null, trigger: _lastTrigger || null })
    : undefined;
  deps.broadcastEvent({
    type: 'copilot_line', id, line: beat.line, beat: beat.key, mood: beat.mood,
    timestamp: new Date().toISOString(),
    usage: { in: 0, out: 0, costUsd: 0, ms: 0, canned: true },
  });
}

// A Q&A question — the line IS the question; the tappable options ride in `question` so
// the cockpit UI renders answer buttons. Free; the answer comes back via /copilot-answer.
function emitQuestion(settings, deps, beat) {
  const personality = settings.copilotPersonality || 'wash';
  lastSpokeAt = Date.now();
  recentLines.push(beat.line);
  while (recentLines.length > RECENT_MAX) recentLines.shift();
  console.log(`[Copilot] question: "${beat.line}"`);
  const id = deps.captureLine
    ? deps.captureLine({ source: 'question', persona: personality, beat: 'question', mood: beat.mood, prose: beat.line, inputs: null, trigger: _lastTrigger || null })
    : undefined;
  deps.broadcastEvent({
    type: 'copilot_line', id, line: beat.line, beat: 'question', mood: beat.mood,
    question: beat.question, timestamp: new Date().toISOString(),
    usage: { in: 0, out: 0, costUsd: 0, ms: 0, canned: true },
  });
}

// Pull the {slot} fillers a canned line might want out of state + the event.
function buildCannedContext(state, ev) {
  const s = state || {};
  const pos = s.commanderPosition || {};
  const ctx = {
    system: pos.name || pos.system || pos.systemName || s.currentSystem || '',
    station: (s.currentDock && s.currentDock.stationName) || '',
    ship: (s.currentShip && typeof s.currentShip === 'object' ? (s.currentShip.name || s.currentShip.type) : s.currentShip) || s.shipName || '',
    body: '', commodity: '', tons: '', amount: '', crew: '',
  };
  if (ev) {
    if (ev.StarSystem) ctx.system = ev.StarSystem;
    if (ev.StationName) ctx.station = ev.StationName;
    if (ev.Body || ev.BodyName) ctx.body = ev.Body || ev.BodyName;
    if (ev.event === 'MarketBuy') {
      ctx.commodity = ev.Type_Localised || ev.Type || '';
      if (ev.Count) ctx.tons = String(ev.Count);
    } else if (ev.event === 'CargoTransfer') {
      const toShip = (ev.Transfers || []).filter((t) => t && t.Direction === 'toship');
      const tons = toShip.reduce((a, t) => a + (t.Count || 0), 0);
      if (tons) ctx.tons = String(tons);
      const first = toShip[0];
      if (first) ctx.commodity = first.Type_Localised || first.Type || '';
    } else if (ev.event === 'MultiSellExplorationData' || ev.event === 'SellExplorationData') {
      ctx.amount = fmtCredits(ev.TotalEarnings ?? ev.BaseValue ?? 0);
    }
  }
  // Use the carrier's NAME, not its callsign, when docked at the commander's own carrier.
  const fc = s.settings || {};
  if (fc.myFleetCarrier && ctx.station === fc.myFleetCarrier) {
    const u = (s.fleetCarrierSpaceUsage || {})[fc.myFleetCarrier];
    ctx.station = (u && u.name) || 'the carrier';
  }
  const crewNames = getCrewNames();
  if (crewNames.length) ctx.crew = String(crewNames[Math.floor(Math.random() * crewNames.length)]).split(' ')[0];
  return ctx;
}

function fmtCredits(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} billion credits`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} million credits`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k credits`;
  return `${v} credits`;
}

// Structured inputs for the corpus flywheel — promote/templatize from THESE, never
// by parsing the generated prose. Only the live beats need them.
function captureInputsForEvent(ev) {
  if (!ev) return null;
  if (ev.event === 'Scan') return { body: ev.BodyName || null, why: ev.__why || null };
  return null;
}

async function speak(state, settings, deps, { key, intent, model, mood, detail, inputs, fallback }) {
  // Live generation switched off in Settings — take the canned pool instead of the CLI. This is
  // the same route a CLI failure takes below, minus the 60s wait: when the `claude` credential
  // read blocks, it hangs silently rather than erroring, so every beat stalls out its timeout and
  // the co-pilot reads as dead. This is the way back without an env var or a rebuild.
  if (settings.copilotLiveEnabled === false) {
    if (fallback) {
      try { fallback(); } catch { /* best-effort, same as the failure path */ }
    }
    return;
  }
  inFlight = true;
  // Default sonnet for voice quality — haiku reads flat for character work. settings.copilotModel
  // still overrides (per-beat `model` is intentionally bypassed: the commander wants sonnet everywhere).
  const chosenModel = settings.copilotModel || 'sonnet';
  console.log(`[Copilot] reacting: ${key} (${chosenModel}) — generating...`);
  try {
    const dial = { humor: settings.copilotTarsHumor ?? 60, honesty: settings.copilotTarsHonesty ?? 80 };
    const system = `${COPILOT_RULES}\n\n${buildPersonalityPreamble(settings.copilotPersonality, dial)}`;
    const recent = recentLines.length
      ? `Your recent lines — HISTORY, not facts. Do NOT echo their wording or theme, and do NOT treat anything in them as true right now: the station, body, ship and numbers they mention are where the commander WAS, not where they are. Only the Situation block above is current:\n${recentLines.map((l) => `- ${l}`).join('\n')}`
      : '';
    // The situation lives in the USER message; the persona is the (stable, cacheable) system prompt.
    // The guard is REQUIRED: moving the persona to --system-prompt drops Claude Code's default
    // "answer directly" framing, so without it sonnet roleplays (emits "Tycho:" labels + meta +
    // markdown). As the LAST line, this keeps the output to one clean spoken line (verified).
    const OUTPUT_GUARD = 'Output ONLY the spoken dialogue itself (your 1–3 short sentences) — no speaker name or label, no asterisks or markdown, no surrounding quotation marks, no notes or meta-commentary. Just the words said aloud. Speak as YOURSELF, in the first person: "I", never your own name and never he/she/they about yourself.';
    const userMessage = [`This moment: ${intent}`, buildSnapshot(state), detail, recent, OUTPUT_GUARD].filter(Boolean).join('\n\n');

    const result = await copilotComplete({ model: chosenModel, system, userMessage });
    const line = (result.text || '').trim();
    if (!line) { console.log('[Copilot] empty response from claude'); return; }

    lastSpokeAt = Date.now();
    recentLines.push(line);
    while (recentLines.length > RECENT_MAX) recentLines.shift();

    console.log(`[Copilot] "${line}"  (${result.durationMs}ms · $${result.costUsd.toFixed(4)} · ${result.inTokens}+${result.outTokens} tok)`);
    // Capture the live line + its structured inputs for the promote/templatize flywheel.
    const id = deps.captureLine
      ? deps.captureLine({ source: 'live', persona: settings.copilotPersonality || 'wash', beat: key, mood, prose: line, inputs: inputs || null, trigger: _lastTrigger || null })
      : undefined;
    deps.broadcastEvent({
      type: 'copilot_line', id, line, beat: key, mood, timestamp: new Date().toISOString(),
      usage: { in: result.inTokens, out: result.outTokens, costUsd: result.costUsd, ms: result.durationMs },
    });
  } catch (err) {
    // No claude CLI on this host, or a model error — surfaced so it's not silent.
    console.error('[Copilot] generation FAILED:', err && err.message);
    // Last resort: the canned pool speaks so a CLI failure never means dead air
    // ("I enabled Tycho and he's not saying anything"). False when the pool has
    // nothing for this beat — then quiet is honest.
    if (fallback) {
      try {
        if (fallback()) console.log('[Copilot] live failed — canned fallback spoke');
      } catch { /* fallback is best-effort */ }
    }
  } finally {
    inFlight = false;
  }
}

/** Friendly name of the hull the co-pilot is sitting in (never an SRV). */
function motherShipLabel(state) {
  const a = awayState();
  let hull = a.motherShip;
  if (!hull && state && state.currentShip) {
    const cs = state.currentShip;
    const t = typeof cs === 'object' ? cs.type : cs;
    if (t && !isSrvType(t)) hull = t;
  }
  return hull ? friendlyShip(String(hull).toLowerCase()) : null;
}
