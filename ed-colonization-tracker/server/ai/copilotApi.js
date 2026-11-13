// server/ai/copilotApi.js
//
// The Anthropic API backend for the co-pilot — the commander's own API credits, as an OPTION beside
// the `claude -p` subscription path in copilotProvider.js. Nothing here runs unless Settings picks
// "Anthropic API" AND a key file exists, so a shared copy of the app can never spend anyone's credits.
//
// THE KEY: one line in `anthropic-key.txt` beside the exe. Read here, on the server, only. It is never
// put in colony-data.json (that file syncs to every LAN device), never logged, never echoed back —
// the status endpoint says only whether a key is present. Error text is scrubbed of it before logging.
//
// SPEND: every call's usage is priced from the table below and added to `copilot-spend.json` beside the
// exe (per UTC month). A monthly cap from Settings stops calls once reached — the co-pilot then falls
// back to its canned lines. The figures are computed from the API's own usage counts, not estimated.
//
// MODEL FACTS (Anthropic docs, read 2026-10-28): the 5.5 models always think before answering (Opus
// 5.5 cannot turn it off) and thinking is billed as output; `output_config.effort` is the only depth
// control; temperature/top_p/top_k are rejected with a 400; assistant prefill is rejected; a refusal
// is HTTP 200 with stop_reason "refusal" and possibly empty content. So: no sampling params, no
// prefill, effort set per job, and max_tokens leaves room for the thinking.

import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

export const API_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const DEFAULT_API_MODEL = 'claude-opus-5-5';
export const DEFAULT_CAP_USD = 100;

// USD per million tokens — Anthropic pricing page, read 2026-10-28. `write` = 5-minute cache write.
// Haiku 5.5 has a second tier for prompts over 100,000 tokens (cache reads and writes count toward it).
const PRICES = {
  'claude-opus-5-5': { in: 4, write: 5, read: 0.2, out: 20 },
  'claude-sonnet-5-5': { in: 2, write: 2.5, read: 0.1, out: 10 },
  'claude-haiku-5-5': { in: 0.1, write: 0.125, read: 0.01, out: 0.5,
    over100k: { in: 0.5, write: 0.625, read: 0.05, out: 2.5 } },
};

let cfg = { keyFile: null, spendFile: null, clientFactory: null };
let keyCache = { mtimeMs: -1, size: -1, key: null };
let client = null;
let clientKey = null;
let spend = null; // { version, months: { 'YYYY-MM': { usd, calls, inTokens, outTokens, cacheRead, cacheWrite } } }

/**
 * Bind the key + spend files (server.mjs, once at startup). `clientFactory(apiKey)` is a test seam —
 * tests hand in a fake `{ messages: { create } }` so nothing ever reaches the network.
 */
export function initCopilotApi({ keyFile = null, spendFile = null, clientFactory = null } = {}) {
  cfg = { keyFile, spendFile, clientFactory };
  keyCache = { mtimeMs: -1, size: -1, key: null };
  client = null;
  clientKey = null;
  spend = null;
}

/** The key from the key file, re-read whenever the file changes. Null when absent or empty. */
function readApiKey() {
  if (!cfg.keyFile) return null;
  let st;
  try { st = fs.statSync(cfg.keyFile); } catch { keyCache = { mtimeMs: -1, size: -1, key: null }; return null; }
  if (st.mtimeMs === keyCache.mtimeMs && st.size === keyCache.size) return keyCache.key;
  let key = null;
  try {
    const line = fs.readFileSync(cfg.keyFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    key = line && !/\s/.test(line) ? line : null;
  } catch { key = null; }
  keyCache = { mtimeMs: st.mtimeMs, size: st.size, key };
  return key;
}

export function apiKeyPresent() { return !!readApiKey(); }

function scrub(text) {
  const k = keyCache.key;
  let s = String(text || '');
  if (k) s = s.split(k).join('[key]');
  return s.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[key]');
}

function getClient() {
  const key = readApiKey();
  if (!key) return null;
  if (client && clientKey === key) return client;
  client = cfg.clientFactory ? cfg.clientFactory(key) : new Anthropic({ apiKey: key, maxRetries: 1 });
  clientKey = key;
  return client;
}

// ── Spend ledger ─────────────────────────────────────────────────────────────────────────────────

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const emptyMonth = () => ({
  usd: 0, calls: 0, inTokens: 0, outTokens: 0, cacheRead: 0, cacheWrite: 0,
  errors: 0, refusals: 0,
  byPurpose: {}, // { line | opinion: { usd, calls } }
  byModel: {},   // { model id: { usd, calls } }
  days: {},      // { 'YYYY-MM-DD' (UTC): { usd, calls } }
});
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const roundMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, b]) => [k, { usd: round4(b.usd), calls: b.calls || 0 }]));

function loadSpend() {
  if (spend) return spend;
  spend = { version: 1, months: {} };
  if (!cfg.spendFile) return spend;
  try {
    const j = JSON.parse(fs.readFileSync(cfg.spendFile, 'utf8'));
    if (j && typeof j === 'object' && j.months && typeof j.months === 'object') spend = { version: 1, months: j.months, last: j.last || null };
  } catch { /* no ledger yet */ }
  return spend;
}

function saveSpend() {
  if (!cfg.spendFile || !spend) return;
  try { fs.writeFileSync(cfg.spendFile, JSON.stringify(spend, null, 2), 'utf8'); } catch (e) { console.error('[CopilotAPI] spend ledger write failed:', e && e.message); }
}

/** This UTC month's running totals. */
export function spendThisMonth(now = new Date()) {
  const m = loadSpend().months[monthKey(now)];
  return Object.assign(emptyMonth(), m || {});
}

const capOf = (settings) => {
  const c = Number(settings && settings.copilotApiCapUsd);
  return Number.isFinite(c) && c >= 0 ? c : DEFAULT_CAP_USD;
};
export const modelOf = (settings) => {
  const m = settings && settings.copilotApiModel;
  return API_MODELS.includes(m) ? m : DEFAULT_API_MODEL;
};

/** What Settings shows: never the key itself. */
export function apiStatus(settings) {
  const s = settings || {};
  const m = spendThisMonth();
  const capUsd = capOf(s);
  const month = monthKey();
  const day = (m.days || {})[new Date().toISOString().slice(0, 10)] || { usd: 0, calls: 0 };
  const ledger = loadSpend();
  const history = Object.entries(ledger.months || {})
    .filter(([k]) => k !== month)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([k, v]) => ({ month: k, usd: round4(v && v.usd), calls: (v && v.calls) || 0 }));
  return {
    backend: s.copilotBackend === 'api' ? 'api' : 'cli',
    keyPresent: apiKeyPresent(),
    model: modelOf(s),
    capUsd,
    month,
    spentUsd: round4(m.usd),
    calls: m.calls,
    overCap: m.usd >= capUsd,
    today: { usd: round4(day.usd), calls: day.calls || 0 },
    byPurpose: roundMap(m.byPurpose),
    byModel: roundMap(m.byModel),
    tokens: { in: m.inTokens, out: m.outTokens, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite },
    errors: m.errors || 0,
    refusals: m.refusals || 0,
    last: ledger.last || null,
    history,
  };
}

/** True when an API call may be made right now: API picked, key present, under the cap. */
export function apiReady(settings) {
  const s = settings || {};
  if (s.copilotBackend !== 'api') return false;
  if (!apiKeyPresent()) return false;
  return spendThisMonth().usd < capOf(s);
}

/** The user turn: plain text, or images (screenshots, 1.62.0) followed by the text. */
function userContent(o) {
  const text = String(o.userMessage || '');
  const imgs = Array.isArray(o.images) ? o.images.filter((i) => i && i.data) : [];
  if (!imgs.length) return text;
  return [
    ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType || 'image/jpeg', data: i.data } })),
    { type: 'text', text },
  ];
}

/** USD for one response's usage, from the price table. */
export function costOf(model, usage) {
  const p0 = PRICES[model] || PRICES[DEFAULT_API_MODEL];
  const u = usage || {};
  const input = u.input_tokens || 0;
  const write = u.cache_creation_input_tokens || 0;
  const read = u.cache_read_input_tokens || 0;
  const out = u.output_tokens || 0;
  const p = p0.over100k && input + write + read > 100_000 ? p0.over100k : p0;
  return (input * p.in + write * p.write + read * p.read + out * p.out) / 1e6;
}

function bump(map, key, usd) {
  const b = map[key] || { usd: 0, calls: 0 };
  b.usd += usd;
  b.calls += 1;
  map[key] = b;
}

function monthBucket(s, k) {
  const m = Object.assign(emptyMonth(), s.months[k] || {});
  for (const f of ['byPurpose', 'byModel', 'days']) if (!m[f] || typeof m[f] !== 'object') m[f] = {};
  return m;
}

/** One priced call: the month's totals, the split by purpose / model / UTC day, and the last call. */
function recordSpend(usd, usage, meta = {}) {
  const s = loadSpend();
  const now = new Date();
  const k = monthKey(now);
  const m = monthBucket(s, k);
  const u = usage || {};
  m.usd += usd;
  m.calls += 1;
  m.inTokens += u.input_tokens || 0;
  m.outTokens += u.output_tokens || 0;
  m.cacheRead += u.cache_read_input_tokens || 0;
  m.cacheWrite += u.cache_creation_input_tokens || 0;
  if (meta.refusal) m.refusals = (m.refusals || 0) + 1;
  bump(m.byPurpose, meta.purpose || 'line', usd);
  bump(m.byModel, meta.model || 'unknown', usd);
  bump(m.days, now.toISOString().slice(0, 10), usd);
  s.months[k] = m;
  s.last = {
    at: now.toISOString(), purpose: meta.purpose || 'line', model: meta.model || null, usd: round4(usd),
    inTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    outTokens: u.output_tokens || 0, ms: meta.ms || 0,
  };
  saveSpend();
}

/** A call that failed before any usage came back — counted, never priced. */
function recordError() {
  const s = loadSpend();
  const k = monthKey();
  const m = monthBucket(s, k);
  m.errors = (m.errors || 0) + 1;
  s.months[k] = m;
  saveSpend();
}

// ── The call ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One Messages API call. The system prompt is marked cacheable (it is the stable persona + rules, well
 * over the 512-token minimum), so a burst of lines pays the full input price once.
 *
 * @param {object} o
 * @param {string} o.system        stable persona/rules text (cached)
 * @param {string} o.userMessage   this moment
 * @param {object} [o.settings]    state.settings — model + cap
 * @param {'low'|'medium'|'high'} [o.effort]
 * @param {object} [o.schema]      JSON schema → structured output; the parsed object comes back as `json`
 * @param {number} [o.maxTokens]   thinking + answer together
 * @param {number} [o.timeoutMs]
 * @param {'line'|'opinion'|'screenshot'} [o.purpose]  what the call was for — the tally splits by it
 * @param {{ mediaType: string, data: string }[]} [o.images]  base64 images sent before the text (screenshots)
 * @returns {Promise<{ text: string, json: any, inTokens: number, outTokens: number, costUsd: number, durationMs: number, stopReason: string|null }>}
 */
export async function apiComplete(o) {
  const settings = o.settings || {};
  if (!apiReady(settings)) throw new Error('API not ready (backend off, no key, or monthly cap reached)');
  const c = getClient();
  if (!c) throw new Error('API key file missing or empty');
  const model = modelOf(settings);
  const outputConfig = {};
  if (o.effort) outputConfig.effort = o.effort;
  if (o.schema) outputConfig.format = { type: 'json_schema', schema: o.schema };
  const params = {
    model,
    max_tokens: o.maxTokens || 1500,
    system: [{ type: 'text', text: String(o.system || ''), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent(o) }],
  };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;
  const started = Date.now();
  let res;
  try {
    res = await c.messages.create(params, { timeout: o.timeoutMs || 20_000 });
  } catch (e) {
    recordError();
    throw new Error(`Anthropic API: ${scrub(e && (e.message || e))}`.slice(0, 400));
  }
  const usage = (res && res.usage) || {};
  const costUsd = costOf(model, usage);
  const stopReason = (res && res.stop_reason) || null;
  recordSpend(costUsd, usage, { purpose: o.purpose || 'line', model, ms: Date.now() - started, refusal: stopReason === 'refusal' });
  const text = stopReason === 'refusal'
    ? ''
    : ((res && Array.isArray(res.content)) ? res.content : []).filter((b) => b && b.type === 'text').map((b) => b.text || '').join('').trim();
  let json = null;
  if (o.schema && text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return {
    text,
    json,
    inTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
    outTokens: usage.output_tokens || 0,
    costUsd,
    durationMs: Date.now() - started,
    stopReason,
  };
}
