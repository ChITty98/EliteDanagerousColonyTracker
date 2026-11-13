// server/ai/copilotShots.js
//
// The co-pilot looks at your F10 screenshots (1.62.0, Anthropic API only).
//
// Every F10 writes a journal Screenshot event; the server copies the shot into the gallery and hands a
// scaled-down copy here. ONE vision call per shot does three jobs:
//   1. READS it — what kind of shot (a vista, the station's services screen, some other screen), a short
//      factual description and Sights tags. Stored on the photo's gallery entry, so every shot is described.
//   2. On the station's services screen ("Connected to …"), reads the station representative — title,
//      name, greeting — and what the screen states about the owner. Stored on the station's own record in
//      the app (knownStations), shown on the station, and used by opinions and docking lines.
//   3. SPEAKS the line it wrote — every time, unless the commander is fighting or out of the game. A paid
//      line is never thrown away (the commander's rule, 1.62.3: "if I'm spending agent credits I want the
//      line"); the rules live in the prompt, and the only post-processing fixes text (polishShotLine).
// Never kept or spoken: the commander's name, their credits, or other players and squadrons on screen.

import { apiComplete, apiReady, modelOf } from './copilotApi.js';
import { COPILOT_RULES, buildPersonalityPreamble } from './copilotRules.js';

import { bodyDossier, dossierFlavour } from './copilotContext.js';
import { friendlyShip } from '../journal/extractor.js';

export const SHOT_KINDS = ['vista', 'station_screen', 'other_screen'];
// The Sights tag list (src/features/companion/SightingCard.tsx TAGS) — one shared list, never new tags.
export const SHOT_TAGS = ['closebodies', 'rings', 'terrain', 'sky', 'life', 'braintrees', 'geology', 'home', 'landmark', 'cool'];
const MOODS = ['calm', 'hyped', 'awe', 'proud', 'wave', 'brace', 'panic', 'relief', 'somber'];
const S = { type: ['string', 'null'] };

// Constant: part of the cached prompt prefix.
export const SHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'description', 'tags', 'line', 'mood', 'station'],
  properties: {
    kind: { type: 'string', enum: SHOT_KINDS },
    description: { type: 'string', description: 'One or two plain factual sentences: what is visible.' },
    tags: { type: 'array', items: { type: 'string', enum: SHOT_TAGS } },
    line: { type: 'string', description: 'What you say aloud about the shot, in character; empty for nothing.' },
    mood: { type: 'string', enum: MOODS },
    station: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['stationName', 'representativeTitle', 'representativeName', 'greeting', 'factionName', 'factionState', 'influencePct', 'operationalStatus', 'architectIsCommander'],
          properties: {
            stationName: S, representativeTitle: S, representativeName: S, greeting: S,
            factionName: S, factionState: S, influencePct: { type: ['number', 'null'] }, operationalStatus: S,
            architectIsCommander: { type: ['boolean', 'null'] },
          },
        },
      ],
    },
  },
};

const SHOT_RULES = [
  'SCREENSHOTS — the commander just pressed F10. You see the picture they took.',
  '- "kind": "vista" for scenery (space or surface), "station_screen" for the station services screen that says CONNECTED TO <station>, "other_screen" for any other menu or HUD screen.',
  '- "description": one or two plain factual sentences of what is visible — bodies, rings, stars, terrain, the ship or vehicle, light. Name places only from WHERE below or from text printed on screen. No guessed names, no numbers that are not printed on screen or given below.',
  '- "tags": for a vista only — tags that are clearly visible, from the allowed list. Empty for any screen.',
  '- "station": only for a station_screen, read EXACTLY as printed: the station name, the representative\'s title and name (the person in the portrait), their greeting word for word, the faction name, its state, its influence as a number, the operational status, and architectIsCommander = whether the System Architect shown is the same name as CONNECTED AS on the same screen. Never output either commander name. Null for any other kind.',
  '- "line": one to three short sentences, in character, about what the commander just captured — numbers printed on the shot are fair game. On a station_screen you may greet or react to the representative by name, unless WHERE says you already know them. Never say the commander\'s name, their credits, or any other player or squadron shown on screen. Never call a ship "she" or "her". Use an empty line for an other_screen unless something on it is genuinely worth a remark.',
  '- Nothing you return — description, line or station fields — may contain a commander\'s name (including anything after "CMDR"), a credit balance, or any other player or squadron shown on screen.',
  '- Never write a fleet carrier\'s callsign (like "ABC-1D2") anywhere — call a carrier by its name; the commander\'s own carrier is named under WHERE.',
  '- The line never mentions speed or angles (degrees) — the commander\'s rule.',
  '- Return only the JSON object.',
].join('\n');

let shotSeq = 0;

/** Is screenshot reading on? API picked + usable, co-pilot on, live lines on, the switch not off. */
export function shotReadingOn(settings) {
  const s = settings || {};
  return !!s.copilotEnabled && s.copilotLiveEnabled !== false && s.copilotScreenshots !== false && apiReady(s);
}

/**
 * A deposit shot (1.62.1): taken on the ground — under 200 m, the surface page's own marker line
 * (isSurfaceMark) — while surface mining is under way, so the HUD panel is the record, not the place.
 * Decided from THIS shot's event and the live mining state, never by file name: every F10 near a
 * planet writes a marker, docked at a surface outpost included, and the game reuses names (two
 * Screenshot_0041s — a 3 Sep deposit and the 2 Nov Thagard's station screen, which 1.62.0 skipped).
 */
export function isDepositShot(ev, miningActive) {
  if (!ev || !miningActive || ev.Latitude == null || ev.Altitude == null) return false;
  const alt = Number(ev.Altitude);
  return Number.isFinite(alt) && alt < 200;
}

/** A new F10 shot was taken: returns its place in the burst (only the latest of a burst speaks). */
export function noteShotTaken() { shotSeq += 1; return shotSeq; }

const lc = (x) => String(x || '').toLowerCase();
const squash = (x) => lc(x).replace(/[^a-z0-9]/g, '');
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A fleet carrier's callsign: three and three, with at least one digit (K8R-M2X, V3C-1LK). "TIN-CAN" in
// "OLD TIN-CAN" has no digit and is the carrier's name, so it stays.
const CALLSIGN = /\b[A-Z0-9]{3}-[A-Z0-9]{3}\b/g;
const callsignsIn = (t) => (String(t || '').match(CALLSIGN) || []).filter((x) => /\d/.test(x));

// Two callsigns are the same carrier when four of their six characters agree in place — the model reads
// them off a HUD, and "KBR-M2X" for K8R-M2X was a real misread (2 Nov).
function callsignLike(a, b) {
  const x = String(a || '').toUpperCase().replace(/-/g, '');
  const y = String(b || '').toUpperCase().replace(/-/g, '');
  if (x.length !== 6 || y.length !== 6) return false;
  let n = 0;
  for (let i = 0; i < 6; i++) if (x[i] === y[i]) n += 1;
  return n >= 4;
}

/** What the co-pilot knows about the moment of the shot, from the journal (never from the picture). */
export function buildShotContext(ev, state, { inSrv = false } = {}) {
  const s = state || {};
  const lines = [];
  const names = [];
  const numbers = [];
  const system = ev && (ev.System || ev.StarSystem);
  if (system) { lines.push(`System: ${system}`); names.push(system); }
  const body = ev && ev.Body;
  const dock = s.currentDock && s.currentDock.stationName ? s.currentDock : null;
  if (dock) {
    lines.push(`Docked at: ${dock.stationName}`); names.push(dock.stationName);
    // A representative already on the station's record (1.62.3) is told to the model, so a second shot of
    // the same screen is not a second greeting — and whatever it says instead is spoken, never dropped.
    const rec = Object.values(s.knownStations || {}).find((k) => k && k.marketId === dock.marketId);
    const rep = rec && rec.representative;
    if (rep && rep.name) lines.push(`You already know this station's representative, ${rep.title ? `${rep.title} ` : ''}${rep.name} — on a station_screen do not greet or introduce them again; remark on something else if anything, or give an empty line.`);
  }
  if (body && (!dock || lc(body) !== lc(dock.stationName))) {
    lines.push(`Near / on body: ${body}`); names.push(body);
    const addr = (s.commanderPosition && s.commanderPosition.systemAddress) || null;
    const d = bodyDossier(s, addr, system, body);
    for (const f of dossierFlavour(d)) {
      lines.push(`About ${body}: ${f}`);
      for (const m of String(f).match(/\d+(?:\.\d+)?/g) || []) numbers.push(Number(m));
    }
  }
  if (ev && ev.Latitude != null && ev.Altitude != null) lines.push(ev.Altitude < 200 ? `On or just above the surface${inSrv ? ', in the SRV' : ''}` : 'Flying low over the surface');
  // The commander's own carrier, by NAME (1.62.2): the model read "KBR-M2X" off the HUD for K8R-M2X and
  // wrote it into a stored description. Background — named only when the carrier is in the picture.
  const callsign = s.settings && s.settings.myFleetCarrier;
  const usage = callsign && s.fleetCarrierSpaceUsage ? s.fleetCarrierSpaceUsage[callsign] : null;
  if (callsign && usage && usage.name) {
    lines.push(`The commander's own fleet carrier is the ${usage.name} (background — if it is in the picture, call it by that name; never write its callsign)`);
    names.push(usage.name);
  }
  const shipType = s.currentShip && typeof s.currentShip === 'object' ? s.currentShip.type : s.currentShip;
  if (shipType && !inSrv) {
    const named = friendlyShip(String(shipType).toLowerCase());
    lines.push(`Ship: ${named && named !== lc(shipType) ? named : 'the ship'}`);
  }
  return { lines, names, numbers, dock, carrier: callsign && usage && usage.name ? { callsign, name: usage.name } : null };
}

/**
 * A spoken line is never thrown away (the commander's rule, 1.62.3). The 1.62.1–1.62.2 checks dropped four
 * paid vista lines in one evening — for a distance printed on the HUD, for the humour dial, for 50 words.
 * The rules are in the prompt; this only FIXES text when one slips: the commander's name (the voice reads a
 * gamer tag badly) and "CMDR" become "Commander", a carrier callsign becomes the carrier's name (or goes),
 * a ship called "she" on a vista becomes "it", markdown characters are stripped. Returns the line and what
 * changed, so the photo can say what was fixed.
 */
export function polishShotLine(line, { kind = 'vista', commanderName = '', carrier = null } = {}) {
  let l = String(line || '').trim();
  const fixes = [];
  const unmarked = l.replace(/[*_#`]/g, '');
  if (unmarked !== l) { l = unmarked; fixes.push('markdown stripped'); }
  const name = String(commanderName || '').trim();
  if (name && new RegExp(escRe(name), 'i').test(l)) { l = l.replace(new RegExp(escRe(name), 'gi'), 'Commander'); fixes.push('commander name → Commander'); }
  if (/\bcmdr\b/i.test(l)) { l = l.replace(/\bcmdr\s+commander\b/gi, 'Commander').replace(/\bcmdr\b/gi, 'Commander'); fixes.push('CMDR → Commander'); }
  const signs = callsignsIn(l);
  if (signs.length) {
    const own = carrier && carrier.callsign && carrier.name && signs.some((x) => callsignLike(x, carrier.callsign)) ? carrier.name : '';
    l = l.replace(CALLSIGN, (m) => (/\d/.test(m) ? (own && callsignLike(m, carrier.callsign) ? own : '') : m))
      .replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();
    fixes.push(`callsign → ${own || 'removed'}`);
  }
  if (kind === 'vista' && /\b(she|her|hers|herself)\b/i.test(l)) {
    l = l.replace(/\bshe\b/gi, 'it').replace(/\bherself\b/gi, 'itself').replace(/\bhers\b/gi, 'its')
      .replace(/\bher\b(?=\s+[a-z])/gi, 'its').replace(/\bher\b/gi, 'it')
      .replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    fixes.push('ship pronoun → it');
  }
  return { line: l.trim(), fixes };
}

/**
 * The description is KEPT on the photo, so it never holds a commander's name, a credit balance or
 * "CMDR …" — even when the prompt's rule is missed. A sentence that does is dropped whole.
 */
export function scrubDescription(text, commanderName = '') {
  const name = lc(commanderName).trim();
  return String(text || '').trim()
    // A carrier is its name, never a callsign — and a misread one ("KBR-M2X" for K8R-M2X) is wrong twice (1.62.2).
    .replace(/\s*\b[A-Z0-9]{3}-[A-Z0-9]{3}\b/g, (m) => (/\d/.test(m) ? '' : m))
    .split(/(?<=[.!?])\s+/)
    .filter((x) => x && !/\bcmdr\b|\bcredits?\b|\bcredit balance\b/i.test(x) && !(name && lc(x).includes(name)))
    .join(' ')
    .trim();
}

/** The representative read off a station screen, if it really is the station we are docked at. */
export function acceptStation(read, dock, ev) {
  if (!read || !dock || !read.representativeName) return null;
  const a = squash(read.stationName);
  const b = squash(dock.stationName);
  if (!a || !b || !(a.includes(b) || b.includes(a))) return null;
  const clean = (x) => (x == null ? null : String(x).trim() || null);
  return {
    title: clean(read.representativeTitle),
    name: clean(read.representativeName),
    greeting: clean(read.greeting),
    faction: clean(read.factionName),
    factionState: clean(read.factionState),
    influencePct: Number.isFinite(read.influencePct) ? read.influencePct : null,
    operationalStatus: clean(read.operationalStatus),
    architectIsYou: read.architectIsCommander === true,
    seenAt: (ev && ev.timestamp) || new Date().toISOString(),
  };
}

/**
 * Read one shot. `image` is { mediaType, data (base64) }, already scaled down by the server.
 * Returns { kind, description, tags, line|null, mood, station|null, stationIsNew } or null.
 */
export async function readScreenshot({ ev, image, state, settings, seq, inSrv = false, deps = {} }) {
  const s = settings || {};
  if (!shotReadingOn(s) || !image || !image.data) return null;
  const persona = s.copilotPersonality || 'wash';
  const ctx = buildShotContext(ev, state, { inSrv });
  const dial = { humor: s.copilotTarsHumor ?? 60, honesty: s.copilotTarsHonesty ?? 80 };
  const system = [COPILOT_RULES, buildPersonalityPreamble(persona, dial), SHOT_RULES].join('\n\n');
  const user = [
    `WHERE (from the journal at the moment of the shot):\n${ctx.lines.map((l) => `- ${l}`).join('\n') || '- unknown'}`,
    `Allowed tags: ${SHOT_TAGS.join(', ')}.`,
  ].join('\n\n');
  let res;
  try {
    // 3000 like the opinions: the model always thinks, and thinking counts against max_tokens.
    res = await apiComplete({ system, userMessage: user, images: [image], settings: s, effort: 'low', schema: SHOT_SCHEMA, maxTokens: 3000, timeoutMs: 45_000, purpose: 'screenshot' });
  } catch (e) {
    console.error('[CopilotShots] read failed:', e && e.message);
    return null;
  }
  const out = res && res.json;
  if (!out || !SHOT_KINDS.includes(out.kind)) return null;
  // Sights tags describe a PLACE: a menu screen gets none (the first real read tagged the station screen "home").
  const tags = out.kind === 'vista' ? (Array.isArray(out.tags) ? out.tags : []).filter((t) => SHOT_TAGS.includes(t)) : [];
  const description = scrubDescription(out.description, s.commanderName).slice(0, 600);

  // Station screens: the representative goes on the station's record — only if the screen names the
  // station we are docked at. Whether it is NEW decides if the co-pilot remarks on it.
  let station = null;
  let stationIsNew = false;
  if (out.kind === 'station_screen') {
    station = acceptStation(out.station, ctx.dock, ev);
    // Same rule as the description: no commander's name is ever kept, whatever field it landed in.
    const me = lc(s.commanderName).trim();
    if (station) for (const k of ['title', 'name', 'greeting', 'faction']) {
      if (station[k] && (/\bcmdr\b/i.test(station[k]) || (me && lc(station[k]).includes(me)))) station[k] = null;
    }
    if (station && !station.name) station = null;
    if (station) {
      const rec = Object.values((state && state.knownStations) || {}).find((k) => k && k.marketId === ctx.dock.marketId);
      const prev = rec && rec.representative;
      stationIsNew = !prev || prev.name !== station.name || prev.title !== station.title;
    }
  }

  // Spoken as written (1.62.3). A paid line is never thrown away — the rules live in the prompt, and the
  // only post-processing fixes text. What remains are not checks: the model gave no line, or the commander
  // is fighting / out of the game. Why a shot stayed quiet goes on the photo record. (`seq` is kept for the
  // caller; a burst no longer silences its earlier shots.)
  let line = String(out.line || '').trim().replace(/^["'“]+|["'”]+$/g, '');
  const canSpeak = typeof deps.canSpeak === 'function' ? deps.canSpeak() : true;
  let silent = null;
  if (!line) silent = out.kind === 'vista' ? 'the model gave no line' : 'nothing worth a remark on this screen';
  else if (!canSpeak) silent = 'out of the game or in combat';
  if (silent) line = '';
  let fixes = [];
  if (line) {
    const polished = polishShotLine(line, { kind: out.kind, commanderName: s.commanderName || '', carrier: ctx.carrier });
    line = polished.line;
    fixes = polished.fixes;
    if (fixes.length) console.log(`[CopilotShots] line fixed (${fixes.join('; ')})`);
    if (!line) silent = 'nothing left after fixes';
  }
  const mood = MOODS.includes(out.mood) ? out.mood : 'calm';
  if (line) {
    const id = deps.captureLine ? deps.captureLine({ source: 'live', persona, beat: 'screenshot', mood, prose: line, inputs: { kind: out.kind, system: (ev && ev.System) || null, body: (ev && ev.Body) || null }, trigger: 'Screenshot' }) : undefined;
    if (deps.broadcastEvent) deps.broadcastEvent({ type: 'copilot_line', id, line, beat: 'screenshot', mood, timestamp: new Date().toISOString(), usage: { in: res.inTokens, out: res.outTokens, costUsd: res.costUsd, ms: res.durationMs } });
    if (typeof deps.noteLine === 'function') deps.noteLine(line);
  }
  console.log(`[CopilotShots] ${out.kind}${station ? ` · ${station.title || ''} ${station.name}`.replace(/\s+/g, ' ') : ''}${line ? ` · "${line}"` : ''} · $${(res.costUsd || 0).toFixed(4)} · ${modelOf(s)}`);
  return { kind: out.kind, description, tags, line: line || null, silent, fixes, persona, mood, station, stationIsNew, model: modelOf(s), costUsd: res.costUsd || 0 };
}

/** Test seam. */
export function _resetShots() { shotSeq = 0; }
