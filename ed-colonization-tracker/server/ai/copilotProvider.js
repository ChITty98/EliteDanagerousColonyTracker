// server/ai/copilotProvider.js
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Co-pilot generation backend — runs `claude -p` as a subprocess against the
 * local Max subscription (no separate API billing). Uses --output-format json
 * so we get EXACT token usage + a metered cost-equivalent back per call.
 *
 * Requires the `claude` CLI installed + logged in on the HOST. On a machine
 * without it the spawn fails and the caller gets nothing — the co-pilot just
 * stays silent rather than erroring.
 *
 * Note: each call carries Claude Code's own (large) system prompt as overhead,
 * which the CLI prompt-caches within ~5 min — so the first line of a burst is
 * pricier and the rest are cheap. The usage figures reflect that.
 */

// `claude --model` accepts these tier aliases and resolves each to the CURRENT
// model of that tier itself — so we never hardcode (or go stale on) a model ID.
const MODEL_ALIASES = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' };

// ---------------------------------------------------------------------------
// argv guard
// ---------------------------------------------------------------------------
//
// spawn() below MUST use shell:true — `claude` is a .cmd shim on Windows, and Node has refused
// to spawn .cmd/.bat without a shell since the CVE-2024-27980 fix. The cost is that argv is
// concatenated RAW onto a cmd.exe command line with no escaping (Node flags this as DEP0190).
//
// That is safe today only because of an invariant that lives nowhere but a comment: none of the
// dangerous text goes through argv. The persona travels by FILE, the prompt by STDIN, and every
// argument is either a literal or a bounded lookup. The risk is a future edit — adding something
// like `--append-system-prompt <text>` would quietly put station names, carrier names and NPC
// chat onto a command line, and it would look harmless in review.
//
// So the invariant is enforced here instead of remembered. Anything that isn't a plain flag, a
// known keyword, or a quoted metacharacter-free path stops the spawn loudly.
const SAFE_FLAG = /^--?[a-z][a-z0-9-]*$/;
const SAFE_KEYWORD = /^(?:haiku|sonnet|opus|json|text|stream-json)$/;
const SAFE_QUOTED_PATH = /^"[^"'`$&|;<>()\r\n]+"$/;

function assertSafeArgs(args) {
  for (const a of args) {
    if (typeof a !== 'string'
      || !(SAFE_FLAG.test(a) || SAFE_KEYWORD.test(a) || SAFE_QUOTED_PATH.test(a))) {
      throw new Error(
        `[Copilot] refusing to spawn: argument ${JSON.stringify(a)} is not a literal flag, a known `
        + 'keyword, or a quoted safe path. shell:true concatenates argv unescaped — dynamic text '
        + 'must travel by stdin or by file, never as an argument.',
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------
//
// A wedged CLI is far worse than a slow one. `inFlight` in copilot.js gates ALL speaking, so a
// hung `claude -p` blocks the entire co-pilot for the full timeout — every beat, forever, while
// the pools sit right there able to answer instantly. Observed live: a blocked credential read
// makes the CLI hang with zero output on both streams, so every line cost a minute of silence
// before falling back.
//
// So: after a couple of consecutive timeouts, stop asking for a while. Canned takes over with no
// stall, and the breaker re-arms on its own — the moment `claude` starts working again the
// co-pilot goes live without anyone touching a toggle.
const LIVE_TIMEOUT_MS = 20_000;           // a working `claude -p` answers in seconds
const BREAKER_TRIP_AFTER = 2;             // consecutive failures before we stop asking
const BREAKER_COOLDOWN_MS = 10 * 60_000;  // then re-probe, so recovery is automatic
let consecutiveFailures = 0;
let breakerUntil = 0;

function noteLiveFailure(reason) {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_TRIP_AFTER && Date.now() >= breakerUntil) {
    breakerUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.log(`[Copilot] live generation failing (${reason}) — falling back to canned for ${BREAKER_COOLDOWN_MS / 60000} min, will retry automatically`);
  }
}

function noteLiveSuccess() {
  if (consecutiveFailures > 0 || breakerUntil) console.log('[Copilot] live generation recovered');
  consecutiveFailures = 0;
  breakerUntil = 0;
}

/** True while the breaker is open — callers should not pay for a call they expect to hang. */
export function liveGenTripped() {
  return Date.now() < breakerUntil;
}

// Live generation is usable only if a `claude` CLI is present AND canned-only isn't forced.
// Probed once + cached. THIS is what lets the repo be committed + shared: a friend who clones it
// with no `claude` login (or anyone who sets COPILOT_CANNED_ONLY=1) gets the CANNED co-pilot
// cleanly — no live calls, no failed spawns, no credits — while your machine keeps full live gen.
let _liveAvail = null;
export async function liveGenAvailable() {
  if (process.env.COPILOT_CANNED_ONLY === '1') return false;
  if (liveGenTripped()) return false;
  if (_liveAvail !== null) return _liveAvail;
  _liveAvail = await new Promise((resolve) => {
    try {
      const c = spawn('claude', assertSafeArgs(['--version']), { stdio: 'ignore', shell: true, windowsHide: true, timeout: 8000 });
      c.on('error', () => resolve(false));
      c.on('close', (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
  console.log(_liveAvail
    ? '[Copilot] `claude` CLI found — live generation ON'
    : '[Copilot] no `claude` CLI (or COPILOT_CANNED_ONLY=1) — CANNED-ONLY, no live generation');
  return _liveAvail;
}

/**
 * Run one `claude -p` completion. Returns an empty result (no spawn) in canned-only mode.
 * @param {{ model?: 'haiku'|'sonnet'|'opus', system: string, userMessage: string, timeoutMs?: number }} opts
 * @returns {Promise<{ text: string, inTokens: number, outTokens: number, costUsd: number, durationMs: number }>}
 */
export async function copilotComplete(opts) {
  if (!(await liveGenAvailable())) return { text: '', inTokens: 0, outTokens: 0, costUsd: 0, durationMs: 0 };
  // hasOwnProperty, not a bare index — `opts.model === 'constructor'` would otherwise hand a
  // function to spawn() instead of falling back to haiku.
  const model = Object.prototype.hasOwnProperty.call(MODEL_ALIASES, opts.model)
    ? MODEL_ALIASES[opts.model]
    : 'haiku';
  // Persona → --system-prompt: it REPLACES Claude Code's default system block (incl. the global
  // dev CLAUDE.md) instead of layering on top — ~4k fewer tokens/call AND a cleaner voice.
  // shell:true only CONCATENATES args (no escaping), so the system MUST be one line with no
  // double-quotes or it gets mangled and silently ignored (measured). userMessage goes via stdin.
  const system = String(opts.system || '').replace(/\s*\n\s*/g, ' ').replace(/"/g, "'").trim();
  return runClaude(model, system, opts.userMessage || '', opts.timeoutMs ?? LIVE_TIMEOUT_MS);
}

// System prompt travels via FILE, not argv (2026-08-04). With shell:true on Windows the args
// are concatenated raw onto a cmd.exe command line — a multi-KB persona preamble full of
// newlines mangles the invocation (cmd treats the first newline as end-of-command), the CLI
// hangs on the malformed call, the 60 s timeout SIGTERMs it, and every generation dies with
// "exited null". The user prompt already went via stdin for the same reason; this closes the
// remaining hole. One file per process, overwritten per call — nothing to clean up.
const SYSTEM_PROMPT_FILE = join(tmpdir(), `edcolony-copilot-system-${process.pid}.txt`);

function runClaude(model, system, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      writeFileSync(SYSTEM_PROMPT_FILE, system, 'utf8');
    } catch (err) {
      reject(new Error(`Failed to write system prompt file: ${err.message}`));
      return;
    }
    let args;
    try {
      args = assertSafeArgs(['-p', '--model', model, '--system-prompt-file', `"${SYSTEM_PROMPT_FILE}"`, '--no-session-persistence', '--output-format', 'json']);
    } catch (err) {
      reject(err);
      return;
    }
    // Subscription-only: strip any ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN so the CLI can NEVER
    // bill credits — the co-pilot runs purely on the local `claude` login (Max subscription).
    // Lets the app be shared without a friend's stray key burning your or their credits.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    let child;
    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,            // `claude` is a shim on Windows; resolve via shell
        env,
        timeout: timeoutMs,
        windowsHide: true,
      });
    } catch (err) {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => { noteLiveFailure('spawn failed'); reject(new Error(`Failed to spawn Claude CLI: ${err.message}`)); });
    child.on('close', (code) => {
      if (code === null) { noteLiveFailure(`no response in ${Math.round(timeoutMs / 1000)}s`); reject(new Error(`Claude CLI killed after ${timeoutMs}ms (timeout/signal): ${stderr.slice(0, 300)}`)); return; }
      if (code !== 0) { noteLiveFailure(`exit ${code}`); reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 300)}`)); return; }
      noteLiveSuccess();
      resolve(parseResult(stdout, prompt));
    });

    // Prompt goes via stdin (not as a shell arg) — no injection surface.
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (err) {
      reject(new Error(`Failed to write prompt to Claude CLI: ${err.message}`));
    }
  });
}

function parseResult(stdout, prompt) {
  let j = null;
  try { j = JSON.parse(stdout); } catch { /* not JSON — raw-text path below */ }
  if (j) {
    // The CLI reports failures (401 auth, overloaded, …) as a success-SHAPED payload with
    // is_error:true and the error text in `result`. Without this guard the co-pilot would
    // SPEAK the error message as dialogue ("Failed to authenticate. API Error: 401…").
    // NOTE: thrown OUTSIDE any local try/catch so it reaches the caller (speak → canned fallback).
    if (j.is_error) throw new Error(`Claude CLI error result: ${String(j.result || '').slice(0, 200)}`);
    const u = j.usage || {};
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    return {
      text: String(j.result || '').trim(),
      inTokens: inTok,
      outTokens: u.output_tokens || 0,
      costUsd: j.total_cost_usd || 0,
      durationMs: j.duration_ms || 0,
    };
  }
  // Output wasn't JSON — treat as raw text and estimate at ~4 chars/token.
  const text = stdout.trim();
  return { text, inTokens: Math.ceil(prompt.length / 4), outTokens: Math.ceil(text.length / 4), costUsd: 0, durationMs: 0 };
}
