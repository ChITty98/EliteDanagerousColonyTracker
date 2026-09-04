// server/journal/rawMaterials.js mirrors the raw slice of src/data/engineeringMaterials.ts,
// because the server cannot import a .ts module. A mirror is only safe while something proves
// it still matches — that is this test's whole job. If a material's grade or cap changes on
// either side, or one gains an entry the other lacks, the suite fails here rather than shipping
// an overlay that tells the commander a G4 is a G2.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RAW_MATERIALS } from '../server/journal/rawMaterials.js';

/** Re-derive the raw materials straight from the TypeScript catalog's line4('raw', …) calls. */
function rawFromCatalog() {
  const src = readFileSync(new URL('../src/data/engineeringMaterials.ts', import.meta.url), 'utf8');
  const caps = { 1: 300, 2: 250, 3: 200, 4: 150 }; // capFor('raw', g)
  const out = {};
  for (const block of src.matchAll(/\.\.\.line4\('raw',\s*'(\w+)',([\s\S]*?)\),\n/g)) {
    const pairs = [...block[2].matchAll(/\['([a-z0-9]+)',\s*'([^']+)'\]/g)];
    pairs.forEach((p, i) => {
      out[p[1]] = { name: p[2], grade: i + 1, cap: caps[i + 1] };
    });
  }
  return out;
}

describe('raw material mirror', () => {
  const catalog = rawFromCatalog();

  it('the catalog still parses (guards against a refactor silently emptying this test)', () => {
    expect(Object.keys(catalog).length).toBe(28); // 7 lines x 4 grades
  });

  it('has exactly the same ids as the catalog', () => {
    expect(Object.keys(RAW_MATERIALS).sort()).toEqual(Object.keys(catalog).sort());
  });

  it('agrees on name, grade and cap for every material', () => {
    for (const [id, want] of Object.entries(catalog)) {
      expect(RAW_MATERIALS[id], `missing ${id}`).toBeDefined();
      expect(RAW_MATERIALS[id].name, `${id} name`).toBe(want.name);
      expect(RAW_MATERIALS[id].grade, `${id} grade`).toBe(want.grade);
      expect(RAW_MATERIALS[id].cap, `${id} cap`).toBe(want.cap);
    }
  });

  it('caps follow ED grade rules', () => {
    for (const [id, m] of Object.entries(RAW_MATERIALS)) {
      expect({ 1: 300, 2: 250, 3: 200, 4: 150 }[m.grade], `${id}`).toBe(m.cap);
    }
  });
});
