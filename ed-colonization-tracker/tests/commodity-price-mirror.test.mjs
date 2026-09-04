// server/journal/commodityPricesMirror.js mirrors src/data/commodityPrices.ts, because the server
// cannot import a .ts module and the surface-mining overlay must price a tonne with the number the
// page shows. A mirror is only safe while something proves it still matches — that is this test.
// Regenerate with: node scripts/gen-commodity-price-mirror.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRows, TABLE } from '../scripts/gen-commodity-price-mirror.mjs';
import { COMMODITY_PRICE_MIRROR, galacticAvgSell, canonicalCommodityName, setLiveMeans } from '../server/journal/commodityPricesMirror.js';

describe('commodity price mirror', () => {
  const rows = parseRows(readFileSync(TABLE, 'utf8'));

  it('the table still parses (guards against a refactor silently emptying this test)', () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it('mirror and table carry the same ids, names and galactic averages', () => {
    expect(Object.keys(COMMODITY_PRICE_MIRROR).length).toBe(rows.length);
    for (const r of rows) {
      expect(COMMODITY_PRICE_MIRROR[r.id], r.id).toBeDefined();
      expect(COMMODITY_PRICE_MIRROR[r.id].name, r.id).toBe(r.name);
      expect(COMMODITY_PRICE_MIRROR[r.id].avgSell, r.id).toBe(r.avgSell);
    }
  });

  it('looks up the way the page does — case, spacing and a stray plural do not matter', () => {
    // Galactic averages are the game's own MeanPrice (Market.json, Atmo Sky Cairn, 2026-09-04).
    expect(galacticAvgSell('Ruby')).toBe(73655);
    expect(galacticAvgSell('rubies')).toBe(0); // "rubie" is not a row; the page misses this one too
    expect(galacticAvgSell('Periclase dunite')).toBe(129763);
    // The journal's own label for LTDs is abbreviated — the one label that does not flatten onto the table.
    expect(galacticAvgSell('Low Temp. Diamonds')).toBe(96438);
    expect(canonicalCommodityName('Low Temp. Diamonds')).toBe('Low Temperature Diamonds');
    expect(canonicalCommodityName('periclase dunite')).toBe('Periclase Dunite');
    expect(galacticAvgSell('Quartz Pyroxenite')).toBe(39009);
  });

  it('a live mean from Market.json outranks the table, and clears back to it', () => {
    setLiveMeans([['Thortveitite', 131000], ['Low Temp. Diamonds', 97000]]);
    expect(galacticAvgSell('Thortveitite')).toBe(131000);
    expect(galacticAvgSell('Low Temperature Diamonds')).toBe(97000); // alias joins the two spellings
    expect(galacticAvgSell('Ruby')).toBe(73655); // untouched
    setLiveMeans([]);
    expect(galacticAvgSell('Thortveitite')).toBe(129763);
    expect(galacticAvgSell('not a commodity')).toBe(0);
    expect(canonicalCommodityName('not a commodity')).toBe('not a commodity');
  });
});
