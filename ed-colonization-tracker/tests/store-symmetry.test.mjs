/**
 * MERGE_STRATEGIES ↔ partialize symmetry check.
 *
 * Recurring bug class (see dev memory / v1.4.4, v1.5.1 changelogs): a key
 * present in MERGE_STRATEGIES but missing from partialize causes phantom
 * __remove diffs that wipe data; a persisted key without an explicit strategy
 * silently falls back to whole-value replace and reintroduces the cross-tab
 * clobber race for map-shaped state.
 *
 * Parses the store source as text (importing the store would drag in zustand
 * persistence + browser APIs into the node test env).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '../src/store/index.ts'), 'utf8');

function mergeStrategyKeys() {
  const m = src.match(/const MERGE_STRATEGIES[\s\S]*?\n\};/);
  if (!m) throw new Error('MERGE_STRATEGIES block not found — update the parser in this test');
  return [...m[0].matchAll(/^\s{2}(\w+):\s*\{\s*kind:/gm)].map((x) => x[1]);
}

function partializeKeys() {
  const m = src.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/);
  if (!m) throw new Error('partialize block not found — update the parser in this test');
  return [...m[1].matchAll(/(\w+):\s*state\.(\w+)/g)].map((x) => x[1]);
}

describe('store persistence symmetry', () => {
  const strategies = mergeStrategyKeys();
  const persisted = partializeKeys();

  it('parses both blocks', () => {
    expect(strategies.length).toBeGreaterThan(20);
    expect(persisted.length).toBeGreaterThan(20);
  });

  it('every MERGE_STRATEGIES key is persisted (else: phantom __remove diffs)', () => {
    const persistedSet = new Set(persisted);
    const missing = strategies.filter((k) => !persistedSet.has(k));
    expect(missing).toEqual([]);
  });

  it('every persisted key has an explicit merge strategy (no silent replace fallback)', () => {
    const strategySet = new Set(strategies);
    const missing = persisted.filter((k) => !strategySet.has(k));
    expect(missing).toEqual([]);
  });
});
