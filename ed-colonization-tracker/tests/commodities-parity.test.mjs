/**
 * Server ↔ client commodity dictionary parity.
 *
 * src/data/commodities.ts (browser) and server/journal/commodities.js (server
 * journal reader) are hand-mirrored. Drift between them is a recurring bug
 * class — a commodity known to one side but not the other silently drops
 * journal events or UI rows.
 */
import { describe, it, expect } from 'vitest';
import { COMMODITIES as clientCommodities } from '../src/data/commodities';
import { COMMODITIES as serverCommodities } from '../server/journal/commodities.js';

describe('commodity dictionary parity', () => {
  it('both sides define the same commodity ids', () => {
    const clientIds = clientCommodities.map((c) => c.id).sort();
    const serverIds = serverCommodities.map((c) => c.id).sort();
    expect(serverIds).toEqual(clientIds);
  });

  it('every commodity has identical fields on both sides', () => {
    const serverById = new Map(serverCommodities.map((c) => [c.id, c]));
    const mismatches = [];
    for (const c of clientCommodities) {
      const s = serverById.get(c.id);
      if (!s) continue; // covered by the id test
      for (const field of ['journalName', 'name', 'category', 'planetaryOnly']) {
        if (c[field] !== s[field]) {
          mismatches.push(`${c.id}.${field}: client=${JSON.stringify(c[field])} server=${JSON.stringify(s[field])}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
