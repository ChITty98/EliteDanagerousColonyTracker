// tools/gen-copilot-canned.mjs
//
// One-time (re-runnable) generator: uses `claude -p` (sonnet) to write a library
// of canned co-pilot lines and emits server/ai/copilotCannedData.js. The runtime
// cycles those lines for FREE; live generation is reserved for meaningful beats.
//
//   node tools/gen-copilot-canned.mjs
//
// Scenarios are generated in small CHUNKS (a big single call times out), and the
// four personalities run concurrently. Requires the `claude` CLI on this host.
// Safe to re-run to refresh.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CANNED_SCENARIOS } from '../server/ai/copilotScenarios.js';
import { PERSONALITIES } from '../server/ai/copilotRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'server', 'ai', 'copilotCannedData.js');
const LINES_PER = 22;
const CHUNK = 4;
// Optional scenario-key args → generate ONLY those and MERGE into the existing
// pools (fast incremental add). No args → regenerate everything from scratch.
const only = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
const SCENARIOS = only.length ? CANNED_SCENARIOS.filter((s) => only.includes(s.key)) : CANNED_SCENARIOS;
// Optional --persona=<key> → regenerate only that persona's lines, merge-preserving the rest.
const personaArg = process.argv.slice(2).find((a) => a.startsWith('--persona='));
const onlyPersona = personaArg ? personaArg.split('=')[1] : null;

function runClaude(prompt, timeoutMs = 360000) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'sonnet', '--no-session-persistence', '--output-format', 'json'];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true, timeout: timeoutMs });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 160)}`));
      try { resolve(String(JSON.parse(out).result || '')); }
      catch { reject(new Error(`unparseable output: ${out.slice(0, 160)}`)); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJson(text) {
  const f = text.replace(/```json/gi, '').replace(/```/g, '');
  const a = f.indexOf('{'), b = f.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('no JSON object in output');
  return JSON.parse(f.slice(a, b + 1));
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildPrompt(flavor, group) {
  const list = group
    .map((s) => `- "${s.key}": ${s.desc}${s.slots.length ? `  [may use: ${s.slots.map((x) => `{${x}}`).join(', ')}]` : ''}`)
    .join('\n');
  return [
    'You are writing a library of CANNED spoken lines for an AI co-pilot character riding shotgun in the game Elite Dangerous. These are cycled at runtime, so VARIETY within each scenario is the whole point.',
    '',
    `The voice for THIS batch: ${flavor}`,
    '',
    'Rules for every single line:',
    '- In character as the co-pilot, spoken dialogue ONLY. No meta, no narration, no markdown, no surrounding quotes.',
    '- Honour the STRUCTURAL RULE stated in the voice profile above (where a number sits in the sentence) on any line that involves a number or logistics.',
    '- One to THREE short sentences. Give it room to breathe — but never a paragraph, never a list.',
    '- Placeholders {system} {station} {body} {commodity} {tons} {amount} may be used ONLY where that scenario lists them, and only in SOME lines — leave plenty of lines fully generic so they work with no data.',
    '- Never invent specific numbers, place names, factions, or events beyond the listed placeholders.',
    '- Sound like TALK, not writing: no aphorisms, no polished kicker lines ("the routine is the job"), no narration ABOUT the commander (what they are, what their choices reveal). Plain words a working pilot would actually say out loud.',
    '- The commander is the captain and your employer. Never give orders, never flatter ("excellent choice"), never cheerlead the work. You inform, or you crack something wry — an employee with a dry sense of humour, not a fan.',
    `- Within each scenario the ${LINES_PER} lines must be genuinely different from one another in wording AND angle. No near-duplicates.`,
    '',
    `Write ${LINES_PER} lines for EACH of these ${group.length} scenarios:`,
    list,
    '',
    `Output ONLY a JSON object: each key is a scenario id above, each value is an array of exactly ${LINES_PER} strings. No prose before or after, no code fence.`,
  ].join('\n');
}

async function genPersonality(key, flavor) {
  const result = {};
  for (const group of chunk(SCENARIOS, CHUNK)) {
    let obj = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { obj = extractJson(await runClaude(buildPrompt(flavor, group))); break; }
      catch (e) {
        process.stderr.write(`  [${key}] chunk attempt ${attempt} failed: ${e.message}\n`);
        if (attempt === 3) throw e;
      }
    }
    for (const s of group) {
      const arr = Array.isArray(obj[s.key])
        ? obj[s.key].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
        : [];
      result[s.key] = arr;
      process.stderr.write(`  [${key}] ${s.key.padEnd(18)} ${arr.length} lines\n`);
    }
  }
  return [key, result];
}

const entries = await Promise.all(
  Object.entries(PERSONALITIES).filter(([k]) => !onlyPersona || k === onlyPersona).map(([k, f]) => genPersonality(k, f)),
);
const generated = Object.fromEntries(entries);

let data = generated;
if (only.length || onlyPersona) {
  const existing = (await import('../server/ai/copilotCannedData.js')).default;
  const valid = new Set(CANNED_SCENARIOS.map((s) => s.key));
  data = {};
  for (const persona of Object.keys(existing)) {
    data[persona] = { ...existing[persona], ...(generated[persona] || {}) };
    for (const k of Object.keys(data[persona])) if (!valid.has(k)) delete data[persona][k];
  }
  process.stderr.write(`\nMerged [${only.join(', ')}] into existing pools (stale keys pruned).\n`);
}

const header = '// AUTO-GENERATED by tools/gen-copilot-canned.mjs — do not edit by hand.\n'
  + '// Canned co-pilot lines, cycled at runtime (free; no live generation).\n\n';
writeFileSync(OUT, `${header}export default ${JSON.stringify(data, null, 1)};\n`);
process.stderr.write(`\nWrote ${OUT}\n`);
