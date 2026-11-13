// The API tally (1.61.3): each priced call lands in the month, the purpose, the model and the UTC day;
// failures are counted but never priced; the status carries all of it plus the last call. A fake client
// stands in for the network.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCopilotApi, apiComplete, apiStatus } from '../server/ai/copilotApi.js';

const settings = { copilotBackend: 'api', copilotApiModel: 'claude-sonnet-5-5', copilotApiCapUsd: 100 };

describe('API tally', () => {
  let dir; let fail;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-tally-'));
    fs.writeFileSync(path.join(dir, 'anthropic-key.txt'), 'sk-ant-test-0000000000');
    fail = false;
    initCopilotApi({
      keyFile: path.join(dir, 'anthropic-key.txt'),
      spendFile: path.join(dir, 'copilot-spend.json'),
      clientFactory: () => ({ messages: { create: async () => {
        if (fail) throw new Error('529 overloaded');
        return { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
      } } }),
    });
  });

  it('splits spend by purpose, model and day, and remembers the last call', async () => {
    await apiComplete({ system: 'S', userMessage: 'U', settings, purpose: 'line' });
    await apiComplete({ system: 'S', userMessage: 'U', settings, purpose: 'line' });
    await apiComplete({ system: 'S', userMessage: 'U', settings, purpose: 'opinion' });
    // Sonnet 5.5: 1,000 in × $2 + 4,000 cache read × $0.10 + 100 out × $10, per million = $0.0034 a call
    const st = apiStatus(settings);
    expect(st.calls).toBe(3);
    expect(st.spentUsd).toBeCloseTo(0.0102, 6);
    expect(st.byPurpose).toEqual({ line: { usd: 0.0068, calls: 2 }, opinion: { usd: 0.0034, calls: 1 } });
    expect(st.byModel).toEqual({ 'claude-sonnet-5-5': { usd: 0.0102, calls: 3 } });
    expect(st.today).toEqual({ usd: 0.0102, calls: 3 });
    expect(st.tokens).toEqual({ in: 3000, out: 300, cacheRead: 12000, cacheWrite: 0 });
    expect(st.last).toMatchObject({ purpose: 'opinion', model: 'claude-sonnet-5-5', usd: 0.0034, inTokens: 5000, outTokens: 100 });
    expect(JSON.stringify(st)).not.toContain('sk-ant');
  });

  it('counts a failed call without pricing it', async () => {
    fail = true;
    await expect(apiComplete({ system: 'S', userMessage: 'U', settings })).rejects.toThrow(/529/);
    const st = apiStatus(settings);
    expect(st.errors).toBe(1);
    expect(st.calls).toBe(0);
    expect(st.spentUsd).toBe(0);
  });

  it('lists earlier months from the ledger', async () => {
    fs.writeFileSync(path.join(dir, 'copilot-spend.json'), JSON.stringify({ version: 1, months: { '2026-09': { usd: 4.1, calls: 120 } } }));
    initCopilotApi({ keyFile: path.join(dir, 'anthropic-key.txt'), spendFile: path.join(dir, 'copilot-spend.json'), clientFactory: () => ({ messages: { create: async () => ({ content: [], usage: {}, stop_reason: 'end_turn' }) } }) });
    const st = apiStatus(settings);
    if (st.month !== '2026-09') expect(st.history).toEqual([{ month: '2026-09', usd: 4.1, calls: 120 }]);
  });
});
