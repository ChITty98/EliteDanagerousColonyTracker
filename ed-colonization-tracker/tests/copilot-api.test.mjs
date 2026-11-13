// The Anthropic API backend: off unless picked AND keyed, the key never leaves the server, every call is
// priced into the monthly ledger, the cap stops calls, refusals say nothing. A fake client stands in for
// the network — nothing here reaches Anthropic.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCopilotApi, apiComplete, apiReady, apiStatus, costOf, spendThisMonth, apiKeyPresent } from '../server/ai/copilotApi.js';

const settings = (o = {}) => ({ copilotBackend: 'api', copilotApiModel: 'claude-opus-5-5', copilotApiCapUsd: 100, ...o });
const KEY = 'sk-ant-api03-TESTKEY-not-real-0123456789';

describe('copilot API backend', () => {
  let dir; let calls; let reply;
  const keyFile = () => path.join(dir, 'anthropic-key.txt');
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-api-'));
    calls = [];
    reply = { content: [{ type: 'text', text: 'Hello.' }], usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 }, stop_reason: 'end_turn' };
    initCopilotApi({
      keyFile: keyFile(),
      spendFile: path.join(dir, 'copilot-spend.json'),
      clientFactory: (key) => ({ messages: { create: async (params, opts) => { calls.push({ params, opts, key }); if (reply instanceof Error) throw reply; return reply; } } }),
    });
  });

  it('is off unless the API is picked AND a key file exists', () => {
    expect(apiReady(settings({ copilotBackend: 'cli' }))).toBe(false);
    expect(apiReady(settings())).toBe(false); // no key file yet
    fs.writeFileSync(keyFile(), `\n  ${KEY}  \n`);
    expect(apiKeyPresent()).toBe(true);
    expect(apiReady(settings())).toBe(true);
    expect(apiReady(settings({ copilotBackend: 'cli' }))).toBe(false);
  });

  it('never puts the key in the status it reports', () => {
    fs.writeFileSync(keyFile(), KEY);
    const st = apiStatus(settings());
    expect(st.keyPresent).toBe(true);
    expect(JSON.stringify(st)).not.toContain('sk-ant');
  });

  it('sends a cacheable system prompt, no sampling parameters, effort and schema in output_config', async () => {
    fs.writeFileSync(keyFile(), KEY);
    const schema = { type: 'object', properties: { line: { type: 'string' } }, required: ['line'], additionalProperties: false };
    reply = { ...reply, content: [{ type: 'text', text: '{"line":"hi"}' }] };
    const r = await apiComplete({ system: 'SYSTEM', userMessage: 'USER', settings: settings(), effort: 'medium', schema, maxTokens: 3000 });
    expect(r.json).toEqual({ line: 'hi' });
    const p = calls[0].params;
    expect(calls[0].key).toBe(KEY);
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(3000);
    expect(p.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(p.messages).toEqual([{ role: 'user', content: 'USER' }]);
    expect(p.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema } });
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) expect(p).not.toHaveProperty(k);
  });

  it('prices each call from the table and keeps a monthly ledger', async () => {
    fs.writeFileSync(keyFile(), KEY);
    // Opus 5.5: 1,000 in × $4 + 2,000 cache-write × $5 + 200 out × $20, per million
    expect(costOf('claude-opus-5-5', reply.usage)).toBeCloseTo(0.018, 9);
    const r = await apiComplete({ system: 'S', userMessage: 'U', settings: settings() });
    expect(r.costUsd).toBeCloseTo(0.018, 9);
    expect(r.inTokens).toBe(3000);
    const m = spendThisMonth();
    expect(m.calls).toBe(1);
    expect(m.usd).toBeCloseTo(0.018, 9);
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'copilot-spend.json'), 'utf8'));
    expect(Object.keys(ledger.months)).toHaveLength(1);
  });

  it('uses the higher Haiku 5.5 tier once the prompt passes 100,000 tokens', () => {
    expect(costOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 })).toBeCloseTo((1000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    expect(costOf('claude-haiku-5-5', { input_tokens: 60_000, cache_read_input_tokens: 50_000, output_tokens: 1000 })).toBeCloseTo((60_000 * 0.5 + 50_000 * 0.05 + 1000 * 2.5) / 1e6, 12);
  });

  it('stops calling once the monthly cap is reached', async () => {
    fs.writeFileSync(keyFile(), KEY);
    await apiComplete({ system: 'S', userMessage: 'U', settings: settings({ copilotApiCapUsd: 0.01 }) });
    expect(apiReady(settings({ copilotApiCapUsd: 0.01 }))).toBe(false);
    expect(apiStatus(settings({ copilotApiCapUsd: 0.01 })).overCap).toBe(true);
    await expect(apiComplete({ system: 'S', userMessage: 'U', settings: settings({ copilotApiCapUsd: 0.01 }) })).rejects.toThrow(/not ready/);
    expect(calls).toHaveLength(1);
  });

  it('a refusal comes back as no line', async () => {
    fs.writeFileSync(keyFile(), KEY);
    reply = { content: [], usage: { input_tokens: 10, output_tokens: 0 }, stop_reason: 'refusal' };
    const r = await apiComplete({ system: 'S', userMessage: 'U', settings: settings() });
    expect(r.text).toBe('');
    expect(r.stopReason).toBe('refusal');
  });

  it('scrubs the key out of any error text', async () => {
    fs.writeFileSync(keyFile(), KEY);
    reply = new Error(`401 invalid x-api-key ${KEY}`);
    await expect(apiComplete({ system: 'S', userMessage: 'U', settings: settings() })).rejects.toThrow(/\[key\]/);
    try { await apiComplete({ system: 'S', userMessage: 'U', settings: settings() }); } catch (e) { expect(String(e.message)).not.toContain(KEY); }
  });
});
