/**
 * Commodity-ID resolution for the goods the game names by a symbol that is not their display name.
 *
 * Elite's ColonisationConstructionDepot, Cargo, MarketBuy/Sell and CargoTransfer all name Land
 * Enrichment Systems `terrainenrichmentsystems`, H.E. Suits `hazardousenvironmentsuits`, Microbial
 * Furnaces `heliostaticfurnaces` and Muon Imager `mutomimager` (verified across every 2025–2026
 * journal). Until 1.60.15 the dictionary carried display-derived symbols for them, so the journal-name
 * lookup missed and only the display-name fallback saved a project need — while the hold, resolved by
 * symbol alone, never matched. Both routes now land on the canonical id; this pins them.
 */
import { describe, it, expect } from 'vitest';
import { findCommodityByJournalName, findCommodityByDisplayName } from '../server/journal/commodities.js';

const DRIFT = [
  { depot: '$terrainenrichmentsystems_name;', display: 'Land Enrichment Systems', canonical: 'landenrichmentsystems' },
  { depot: '$hazardousenvironmentsuits_name;', display: 'H.E. Suits', canonical: 'hesuits' },
  { depot: '$heliostaticfurnaces_name;', display: 'Microbial Furnaces', canonical: 'microbialfurnaces' },
  { depot: '$mutomimager_name;', display: 'Muon Imager', canonical: 'muonimager' },
];

describe('commodity resolution — the goods whose symbol is not their name', () => {
  it("the game's symbols resolve straight to the canonical id", () => {
    for (const c of DRIFT) {
      expect(findCommodityByJournalName(c.depot)?.id, c.depot).toBe(c.canonical);
    }
  });

  it('localised display names resolve to the same id (the fallback still holds)', () => {
    for (const c of DRIFT) {
      expect(findCommodityByDisplayName(c.display)?.id, c.display).toBe(c.canonical);
    }
  });
});
