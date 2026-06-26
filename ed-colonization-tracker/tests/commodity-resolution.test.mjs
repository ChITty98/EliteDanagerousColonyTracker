/**
 * Commodity-ID resolution across the depot-vs-market internal-name drift.
 *
 * Elite's ColonisationConstructionDepot event names a few goods by a different
 * internal symbol than the commodity market does. The journal-name lookup misses
 * those (regression: project "need to buy" ignored carrier stock held under the
 * market symbol — e.g. "need 272" with 412 on the carrier). resourceToCommodity
 * now falls back to the localised display name, which resolves to the canonical
 * market ID. This pins both halves: the miss that necessitates the fallback, and
 * the display-name lookup that fixes it.
 */
import { describe, it, expect } from 'vitest';
import { findCommodityByJournalName, findCommodityByDisplayName } from '../server/journal/commodities.js';

const DRIFT = [
  { depot: '$terrainenrichmentsystems_name;', display: 'Land Enrichment Systems', canonical: 'landenrichmentsystems' },
  { depot: '$hazardousenvironmentsuits_name;', display: 'H.E. Suits', canonical: 'hesuits' },
  { depot: '$heliostaticfurnaces_name;', display: 'Microbial Furnaces', canonical: 'microbialfurnaces' },
];

describe('commodity resolution — depot vs market name drift', () => {
  it('depot internal symbols miss the journal-name lookup (why the fallback exists)', () => {
    for (const c of DRIFT) {
      expect(findCommodityByJournalName(c.depot), c.depot).toBeUndefined();
    }
  });

  it('localised display names resolve to the canonical market ID', () => {
    for (const c of DRIFT) {
      expect(findCommodityByDisplayName(c.display)?.id, c.display).toBe(c.canonical);
    }
  });
});
