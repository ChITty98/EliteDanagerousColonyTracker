// Goal markets come from the journal's CommunityGoal event, never from a demand figure.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initCommunityGoals, activeCommunityGoals, isCommunityGoalMarket, noteCommunityGoalEvent, _setCommunityGoals } from '../server/journal/communityGoals.js';
import { bestSellFromSnapshots } from '../server/journal/marketMeans.js';

const line = (o) => JSON.stringify(o) + '\n';
const future = new Date(Date.now() + 2 * 86400e3).toISOString();
const past = new Date(Date.now() - 2 * 86400e3).toISOString();

describe('community goals', () => {
  beforeEach(() => _setCommunityGoals([]));

  it('reads the latest CommunityGoal event from the newest journal and drops expired goals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-cg-'));
    fs.writeFileSync(path.join(dir, 'Journal.2026-09-01T000000.01.log'), line({ timestamp: '2026-09-01T00:00:00Z', event: 'CommunityGoal', CurrentGoals: [{ CGID: 1, Title: 'Old goal', SystemName: 'Somewhere', MarketName: 'Old Port', Expiry: past }] }));
    fs.writeFileSync(path.join(dir, 'Journal.2026-09-07T000000.01.log'), [
      line({ timestamp: '2026-09-07T00:00:00Z', event: 'Fileheader' }),
      line({ timestamp: '2026-09-07T01:00:00Z', event: 'CommunityGoal', CurrentGoals: [
        { CGID: 856, Title: 'Wreaken Calls for Surface Mining Support', SystemName: 'Ega', MarketName: 'Metz Enterprise', Expiry: future, PlayerContribution: 1120 },
        { CGID: 900, Title: 'Finished one', SystemName: 'Elsewhere', MarketName: 'Done Dock', Expiry: past },
      ] }),
    ].join(''));
    const later = Date.now() + 1000;
    fs.utimesSync(path.join(dir, 'Journal.2026-09-07T000000.01.log'), later / 1000, later / 1000);
    const r = initCommunityGoals(dir);
    expect(r.goals).toBe(2);
    const active = activeCommunityGoals();
    expect(active.map((g) => g.market)).toEqual(['Metz Enterprise']);          // the expired one is gone
    expect(isCommunityGoalMarket('Metz Enterprise', 'Ega')).toBe(true);
    expect(isCommunityGoalMarket('metz enterprise', 'EGA')).toBe(true);        // any case
    expect(isCommunityGoalMarket('Metz Enterprise', 'Sol')).toBe(false);       // same name, wrong system
    expect(isCommunityGoalMarket('The Gatehouse', 'ICZ GR-V b2-5')).toBe(false); // demand 2.7 M is not a goal
    expect(isCommunityGoalMarket('Done Dock', 'Elsewhere')).toBe(false);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  });

  it('a live event replaces the list, and an older replay never regresses it', () => {
    _setCommunityGoals([{ market: 'Metz Enterprise', system: 'Ega', expiry: future }], '2026-09-07T01:00:00Z');
    expect(noteCommunityGoalEvent({ timestamp: '2026-09-06T00:00:00Z', event: 'CommunityGoal', CurrentGoals: [] })).toBe(false);
    expect(isCommunityGoalMarket('Metz Enterprise', 'Ega')).toBe(true);
    expect(noteCommunityGoalEvent({ timestamp: '2026-09-08T00:00:00Z', event: 'CommunityGoal', CurrentGoals: [{ CGID: 1, SystemName: 'Ega', MarketName: 'Other Hub', Expiry: future }] })).toBe(true);
    expect(isCommunityGoalMarket('Metz Enterprise', 'Ega')).toBe(false);
    expect(isCommunityGoalMarket('Other Hub', 'Ega')).toBe(true);
  });

  it('your best market skips a goal market, so rigs and rocks are never priced at the goal', () => {
    _setCommunityGoals([{ market: 'Metz Enterprise', system: 'Ega', expiry: future }]);
    const now = new Date().toISOString();
    const state = {
      commanderPosition: { systemName: 'Ega', coordinates: { x: 0, y: 0, z: 0 } },
      knownSystems: { ega: { systemName: 'Ega', coordinates: { x: 0, y: 0, z: 0 } }, home: { systemName: 'Home', coordinates: { x: 10, y: 0, z: 0 } } },
      marketSnapshots: {
        1: { marketId: 1, stationName: 'Metz Enterprise', systemName: 'Ega', updatedAt: now, commodities: [{ name: 'Iridium', sellPrice: 1038104, demand: 999999 }] },
        2: { marketId: 2, stationName: 'Home Port', systemName: 'Home', updatedAt: now, commodities: [{ name: 'Iridium', sellPrice: 140000, demand: 500 }] },
      },
    };
    const best = bestSellFromSnapshots(state, 'Iridium');
    expect(best.station).toBe('Home Port');
    expect(best.price).toBe(140000);
    _setCommunityGoals([]);
    expect(bestSellFromSnapshots(state, 'Iridium').station).toBe('Metz Enterprise'); // no goal → it is just the best market
  });
});
