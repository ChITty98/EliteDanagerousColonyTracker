// server/ai/copilotProvider.js
import { spawn } from 'node:child_process';

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

// Live generation is usable only if a `claude` CLI is present AND canned-only isn't forced.
// Probed once + cached. THIS is what lets the repo be committed + shared: a friend who clones it
// with no `claude` login (or anyone who sets COPILOT_CANNED_ONLY=1) gets the CANNED co-pilot
// cleanly — no live calls, no failed spawns, no credits — while your machine keeps full live gen.
let _liveAvail = null;
export async function liveGenAvailable() {
  if (process.env.COPILOT_CANNED_ONLY === '1') return false;
  if (_liveAvail !== null) return _liveAvail;
  _liveAvail = await new Promise((resolve) => {
    try {
      const c = spawn('claude', ['--version'], { stdio: 'ignore', shell: true, windowsHide: true, timeout: 8000 });
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
  const model = MODEL_ALIASES[opts.model] || 'haiku';
  // Persona → --system-prompt: it REPLACES Claude Code's default system block (incl. the global
  // dev CLAUDE.md) instead of layering on top — ~4k fewer tokens/call AND a cleaner voice.
  // shell:true only CONCATENATES args (no escaping), so the system MUST be one line with no
  // double-quotes or it gets mangled and silently ignored (measured). userMessage goes via stdin.
  const system = String(opts.system || '').replace(/\s*\n\s*/g, ' ').replace(/"/g, "'").trim();
  return runClaude(model, system, opts.userMessage || '', opts.timeoutMs ?? 60000);
}

function runClaude(model, system, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--system-prompt', system, '--no-session-persistence', '--output-format', 'json'];
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

    child.on('error', (err) => reject(new Error(`Failed to spawn Claude CLI: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 300)}`)); return; }
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
  try {
    const j = JSON.parse(stdout);
    const u = j.usage || {};
    const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    return {
      text: String(j.result || '').trim(),
      inTokens: inTok,
      outTokens: u.output_tokens || 0,
      costUsd: j.total_cost_usd || 0,
      durationMs: j.duration_ms || 0,
    };
  } catch {
    // Output wasn't JSON — treat as raw text and estimate at ~4 chars/token.
    const text = stdout.trim();
    return { text, inTokens: Math.ceil(prompt.length / 4), outTokens: Math.ceil(text.length / 4), costUsd: 0, durationMs: 0 };
  }
}
