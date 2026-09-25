// The game names four colonisation goods by a symbol that is not their display name: Microbial Furnaces is
// heliostaticfurnaces, H.E. Suits hazardousenvironmentsuits, Land Enrichment Systems terrainenrichmentsystems,
// Muon Imager mutomimager (verified across every 2025–2026 journal). Until 1.60.15 the dictionaries carried
// made-up symbols, so 246 t of Microbial Furnaces in the hold never met the project need.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COMMODITIES, findCommodityByJournalName, commoditySymbol, canonicaliseCommodityKeys,
} from '../server/journal/commodities.js';
import {
  findCommodityByJournalName as clientFind, commoditySymbol as clientSymbol, canonicaliseCommodityKeys as clientCanonicalise,
} from '../src/data/commodities';
import { readShipCargo } from '../server/journal/extractor.js';

const FOUR = {
  microbialfurnaces: 'heliostaticfurnaces',
  hesuits: 'hazardousenvironmentsuits',
  landenrichmentsystems: 'terrainenrichmentsystems',
  muonimager: 'mutomimager',
};

describe('the game\'s commodity symbols', () => {
  it('resolve to the dictionary id on both sides, and the id maps back to the symbol', () => {
    for (const [id, sym] of Object.entries(FOUR)) {
      expect(findCommodityByJournalName(`$${sym}_name;`)?.id).toBe(id);
      expect(clientFind(`$${sym}_name;`)?.id).toBe(id);
      expect(findCommodityByJournalName(`$${id}_name;`)).toBeUndefined(); // the game never writes these
      expect(commoditySymbol(id)).toBe(sym);
      expect(clientSymbol(id)).toBe(sym);
    }
    expect(commoditySymbol('steel')).toBe('steel');
    expect(commoditySymbol('lowtemperaturediamond')).toBe('lowtemperaturediamond'); // not a colonisation good: passes through
  });

  it('every other entry keeps symbol and id equal', () => {
    for (const c of COMMODITIES) expect(commoditySymbol(c.id)).toBe(FOUR[c.id] || c.id);
  });

  it('Cargo.json resolves the hold by the symbols the game writes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-cargo-'));
    try {
      fs.writeFileSync(path.join(dir, 'Cargo.json'), JSON.stringify({
        timestamp: '2026-09-21T16:17:30Z', event: 'Cargo', Vessel: 'Ship', Count: 258, Inventory: [
          { Name: 'structuralregulators', Name_Localised: 'Structural Regulators', Count: 6, Stolen: 0 },
          { Name: 'heliostaticfurnaces', Name_Localised: 'Microbial Furnaces', Count: 246, Stolen: 0 },
          { Name: 'hazardousenvironmentsuits', Name_Localised: 'H.E. Suits', Count: 2, Stolen: 0 },
          { Name: 'terrainenrichmentsystems', Name_Localised: 'Land Enrichment Systems', Count: 3, Stolen: 0 },
          { Name: 'mutomimager', Name_Localised: 'Muon Imager', Count: 1, Stolen: 0 },
        ],
      }));
      const cargo = readShipCargo(dir);
      const byId = Object.fromEntries(cargo.items.map((i) => [i.commodityId, i.count]));
      expect(byId).toEqual({ structuralregulators: 6, microbialfurnaces: 246, hesuits: 2, landenrichmentsystems: 3, muonimager: 1 });
      expect(cargo.items.find((i) => i.commodityId === 'microbialfurnaces').name).toBe('Microbial Furnaces');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('session snapshot keys move to dictionary ids once, summing a clash, and a clean map is returned as-is', () => {
    const dirty = { heliostaticfurnaces: 246, steel: 10, '$mutomimager_name;': 3, muonimager: 2 };
    const fixed = canonicaliseCommodityKeys(dirty);
    expect(fixed).toEqual({ microbialfurnaces: 246, steel: 10, muonimager: 5 });
    expect(fixed).not.toBe(dirty);
    expect(canonicaliseCommodityKeys(fixed)).toBe(fixed);
    expect(clientCanonicalise({ ...dirty })).toEqual(fixed);
    expect(canonicaliseCommodityKeys(null)).toBeNull();
  });
});
