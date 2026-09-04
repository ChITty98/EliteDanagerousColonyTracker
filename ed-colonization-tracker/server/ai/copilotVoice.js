// server/ai/copilotVoice.js
//
// Speech for the co-pilot. Windows SAPI renders a line to WAV; the browser plays it.
//
// WHY SERVER-SIDE: the browser's own speechSynthesis cannot be captured or routed through
// Web Audio, so its output can't be filtered — and Wren's whole voice is the filter. Rendering
// to WAV here gives the client real audio data to process. It also means the iPad hears the same
// voice as the PC instead of whatever Apple voices happen to be installed.
//
// WHAT SHAPES A LINE (all settled by the commander in the voice bench, do not re-derive):
//   - each persona has a fixed voice, pitch and rate
//   - each persona has a CONTOUR, derived from its STRUCTURAL RULE in copilotRules.js:
//       Wren buries the number  -> payoff last  -> rise into the final sentence
//       Tycho leads with it      -> lifts on the opening AND the warm closer
//       K2 leads with a verdict -> lift the verdict, fall away through the evidence
//     The corpus needs no annotation for this: the persona already decides the shape.
//   - a heated mood replaces the contour with a whole-line lift (panic +10, hyped +25)
//   - "..." in the line text IS the pause notation; the dot count sets its length
//
// FICTION DECIDES THE SIGNAL PATH: Wren is a person on a mic, so she goes through the comms
// filter (applied client-side). Tycho and K2 are plugged into the ship — no mic, no channel —
// so they play dry.
//
// Windows-only by nature. Everywhere else voiceAvailable() is false and the app is silent,
// exactly as it is today.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

// SAPI reaches exactly two voices on Windows: David and Zira. Mark is OneCore-only and
// System.Speech cannot see it. Everything below is built from those two.
//
// playbackRate is a TAPE-SPEED shift applied in the browser: it scales pitch and duration
// together, so a clip synthesised slow and played fast climbs past SAPI's pitch ceiling
// (a hard +50% — anything above returns byte-identical audio) while the speed lands back
// near 1.0. That is the only way Tycho gets to +75%.
export const PROFILES = {
  wash: {
    voice: 'Microsoft Zira Desktop',
    pitch: 38, rate: -10, playbackRate: 1,
    filter: true,          // human, on a mic
    contour: 'rise',       // buries the number -> payoff last
  },
  tars: {
    voice: 'Microsoft David Desktop',
    pitch: 50, rate: -15, playbackRate: 1.1667,  // 1.50 * 1.1667 = 1.75 -> effective +75%
    filter: false,         // machine, plugged in
    contour: 'lifts',      // leads with the number, warm closer
  },
  k2: {
    voice: 'Microsoft David Desktop',
    pitch: -25, rate: -15, playbackRate: 1,
    filter: false,         // machine, plugged in
    contour: 'fall',       // leads with the verdict, evidence falls away
  },
};

export const DEFAULT_PERSONA = 'wash';

// A heated mood overrides the contour entirely: no setup dip, the whole line lifts.
const MOOD_LIFT = { panic: 10, hyped: 25 };

const SENTENCE_GAP_MS = 600;
const BEAT_MS = 900;
const ELLIPSIS_MIN_MS = 350;
const ELLIPSIS_STEP_MS = 100;
const ELLIPSIS_MAX_MS = 800;
const DASH_MS = 300;   // an aside, shorter than a sentence end

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

/**
 * Catalogue designations are read as QUANTITIES by the synthesiser — "HIP 52629" comes out
 * "fifty-two thousand six hundred and twenty-nine". Commanders say it in groups instead.
 * The rule (the commander's pick of four candidates): first two digits as a number, the rest
 * spoken individually, comma between. It's a rule rather than a lookup, so it covers every
 * HIP/HD system in the galaxy with no curation.
 */
export function speakCatalogueNumbers(text) {
  return String(text).replace(/\b(HIP|HD|LTT|LHS|LP)\s+(\d{3,})\b/g, (_m, prefix, digits) => {
    const head = twoDigitWords(parseInt(digits.slice(0, 2), 10));
    const tail = digits.slice(2).split('').map((d) => ONES[Number(d)]).join(' ');
    return `${prefix} ${head}, ${tail}`;
  });
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * "..." in the corpus IS the pause — the writer marks hesitation by typing it, and the dot
 * count sets the length. This is why no per-beat profile system is needed for hesitation:
 * every line already written keeps working, and any line that wants a beat gets one.
 */
function ellipsisToBreaks(text) {
  return text.replace(/\.{3,}/g, (dots) => {
    const ms = Math.min(ELLIPSIS_MAX_MS, ELLIPSIS_MIN_MS + (dots.length - 3) * ELLIPSIS_STEP_MS);
    return `<break time="${ms}ms"/>`;
  });
}

/**
 * A dash is a PAUSE when a person reads it aloud; SAPI runs straight through. 20% of the corpus
 * uses one ("They don't build them like this any more — and I'm a little sad about that"), so
 * ignoring it flattens a fifth of everything she says.
 *
 * ONLY em and en dashes, never the hyphen: 117 lines carry in-word hyphens ("twenty-nine",
 * "mail-slot", and every number the catalogue rule spells out) where a pause would be wrong.
 * Em/en dashes never appear inside a word, so they can be converted unconditionally.
 *
 * Shorter than a sentence gap — an aside, not a full stop.
 */
function dashesToBreaks(text) {
  return text
    .replace(/\s*[—–]\s*/g, `<break time="${DASH_MS}ms"/> `)
    .replace(/\s+-{2,}\s+/g, `<break time="${DASH_MS}ms"/> `);
}

/**
 * Split on sentence enders only when the NEXT thing starts a sentence. The lookahead is what
 * keeps "2.4 tons" and "8.5 light years" in one piece — a bare split on "." mangles every
 * decimal the co-pilot ever speaks.
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘&])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const pitchTag = (pct, inner) => `<prosody pitch="${pct > 0 ? '+' : ''}${pct}%">${inner}</prosody>`;
const gap = `<break time="${SENTENCE_GAP_MS}ms"/>`;
const beat = `<break time="${BEAT_MS}ms"/>`;

/**
 * Apply the persona's contour (or the mood's whole-line lift) to already-escaped sentences.
 */
function applyContour(sentences, contour, moodLift) {
  if (!sentences.length) return '';

  // A heated line has no setup to dip: everything rides up together.
  if (moodLift != null) return pitchTag(moodLift, sentences.join(` ${gap} `));

  // One sentence has no setup either — it is all payoff, whichever persona says it.
  if (sentences.length === 1) return pitchTag(10, sentences[0]);

  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  const middle = sentences.slice(1, -1);

  if (contour === 'fall') {
    // Verdict up front, evidence falling away behind it.
    const rest = sentences.slice(1).join(` ${gap} `);
    return `${pitchTag(10, first)}${beat}${pitchTag(-10, rest)}`;
  }

  if (contour === 'lifts') {
    // The number leads, the warm offer closes, the working-out sits level between them.
    const parts = [pitchTag(10, first)];
    if (middle.length) parts.push(middle.join(` ${gap} `));
    parts.push(pitchTag(6, last));
    return parts.join(` ${gap} `);
  }

  // 'rise' — the setup sits down so the buried payoff can come up out of it.
  const setup = sentences.slice(0, -1).join(` ${gap} `);
  return `${pitchTag(-10, setup)}${beat}${pitchTag(10, last)}`;
}

/**
 * Turn a spoken line into the SSML document SAPI will render.
 * Order matters: numbers before escaping (the rule reads digits), ellipsis before splitting
 * (so "..." is never mistaken for a sentence end), splitting before the contour.
 */
export function toSsml(line, persona = DEFAULT_PERSONA, mood = 'calm') {
  const p = PROFILES[persona] || PROFILES[DEFAULT_PERSONA];
  const spoken = speakCatalogueNumbers(String(line || '').trim());
  const prepared = dashesToBreaks(ellipsisToBreaks(escapeXml(spoken)));
  const body = applyContour(splitSentences(prepared), p.contour, MOOD_LIFT[mood]);
  const rate = `${p.rate > 0 ? '+' : ''}${p.rate}%`;
  const pitch = `${p.pitch > 0 ? '+' : ''}${p.pitch}%`;
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">'
    + `<prosody pitch="${pitch}" rate="${rate}">${body}</prosody></speak>`;
}

// ---------------------------------------------------------------------------
// The spoken-line register
// ---------------------------------------------------------------------------

// The client asks for audio by line id, never by text. That way the server only ever
// synthesises words it wrote itself — a LAN device cannot post arbitrary text in.
const REGISTER_MAX = 120;
const register = new Map();

export function registerLine(id, line, mood) {
  if (!id || !line) return;
  register.set(String(id), { line: String(line), mood: mood || 'calm' });
  while (register.size > REGISTER_MAX) register.delete(register.keys().next().value);
}

export function lookupLine(id) {
  return register.get(String(id)) || null;
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

const CACHE_MAX = 200;
const cache = new Map();

let available = null;
let scriptPath = null;
let seq = 0;

/** Windows only. Checked once; everywhere else the co-pilot simply stays silent. */
export function voiceAvailable() {
  if (available === null) available = process.platform === 'win32';
  return available;
}

// Written once, then reused. The SSML is handed over as a FILE rather than an argument
// because it is full of quotes and angle brackets — the surest way to mangle it is to let
// it anywhere near a command line.
const PS_SCRIPT = `param([string]$SsmlPath, [string]$WavPath, [string]$VoiceName)
Add-Type -AssemblyName System.Speech
$ssml = [IO.File]::ReadAllText($SsmlPath, [Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice($VoiceName) } catch { }
$synth.SetOutputToWaveFile($WavPath)
$synth.SpeakSsml($ssml)
$synth.SetOutputToNull()
$synth.Dispose()
`;

function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  scriptPath = path.join(os.tmpdir(), 'edc-copilot-voice.ps1');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  return scriptPath;
}

function runSapi(ssml, voiceName) {
  return new Promise((resolve) => {
    // Own filenames per call — two beats firing together must not land on the same temp file.
    const tag = `${process.pid}-${Date.now().toString(36)}-${seq++}`;
    const ssmlPath = path.join(os.tmpdir(), `edc-voice-${tag}.ssml`);
    const wavPath = path.join(os.tmpdir(), `edc-voice-${tag}.wav`);
    const cleanup = () => {
      try { fs.unlinkSync(ssmlPath); } catch { /* already gone */ }
      try { fs.unlinkSync(wavPath); } catch { /* already gone */ }
    };

    try {
      fs.writeFileSync(ssmlPath, ssml, 'utf8');
    } catch (e) {
      console.error('[CopilotVoice] could not stage SSML:', e && e.message);
      return resolve(null);
    }

    // NOT shell:true — powershell.exe is a real executable, so Node passes these arguments
    // through untouched. A shell would re-parse them, and APP paths here contain spaces.
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ensureScript(), ssmlPath, wavPath, voiceName],
      { stdio: 'ignore', windowsHide: true, timeout: 15000 });

    child.on('error', (err) => {
      console.error('[CopilotVoice] synthesis failed to start:', err && err.message);
      cleanup();
      resolve(null);
    });
    child.on('close', () => {
      let wav = null;
      try {
        if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 0) wav = fs.readFileSync(wavPath);
      } catch (e) {
        console.error('[CopilotVoice] could not read rendered audio:', e && e.message);
      }
      cleanup();
      resolve(wav);
    });
  });
}

/**
 * Render one line. Returns { wav, playbackRate, filter } or null when speech is unavailable.
 * Canned lines repeat heavily, so the cache earns its keep — most plays never spawn anything.
 */
export async function synthesize(line, persona = DEFAULT_PERSONA, mood = 'calm') {
  if (!voiceAvailable() || !line) return null;
  const key = `${persona}|${mood}|${line}`;
  const p = PROFILES[persona] || PROFILES[DEFAULT_PERSONA];

  let wav = cache.get(key);
  if (!wav) {
    wav = await runSapi(toSsml(line, persona, mood), p.voice);
    if (!wav) return null;
    cache.set(key, wav);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return { wav, playbackRate: p.playbackRate, filter: p.filter };
}
