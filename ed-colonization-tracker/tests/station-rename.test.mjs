// A finished station renamed in the game: its completed project follows, from a dock or an approach (1.60.39).
// The case: Ngidi Biological Enterprise (completed 2026-10-09) renamed Hibberd Astrophysics Laboratory.
import { describe, it, expect } from 'vitest';
import { applyDockToStationPatch, processSettlementApproaches } from '../server/journal/processors.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const MID = 4395261699;
const existing = (projectName = 'Ngidi Biological Enterprise') => ({
  knownStations: { [MID]: { stationName: 'Ngidi Biological Enterprise', stationType: 'bio_settlement_large', marketId: MID, systemName: SYS, systemAddress: 1797401856371, dockedCount: 3, lastDocked: '2026-10-09T04:46:39Z', nameHistory: [{ name: 'Planetary Construction Site: Ngidi Biological Enterprise', changedAt: '2026-10-09T04:46:59Z' }] } },
  projects: [{ id: 'p1', status: 'completed', marketId: MID, systemName: SYS, stationName: 'Planetary Construction Site: Ngidi Biological Enterprise', completedStationName: projectName, completedStationType: 'bio_settlement_large' }],
});

describe('a renamed finished station', () => {
  it('a dock under the new name renames the completed project and keeps the old name in the history', () => {
    const patch = {};
    applyDockToStationPatch(patch, existing(), MID, { stationName: 'Hibberd Astrophysics Laboratory', stationType: 'OnFootSettlement', systemName: SYS, systemAddress: 1797401856371, timestamp: '2026-10-27T01:00:00Z' });
    expect(patch.projects.__upsert.p1).toMatchObject({ completedStationName: 'Hibberd Astrophysics Laboratory', completedStationType: 'bio_settlement_large' });
    const st = patch.knownStations.__upsert[String(MID)];
    expect(st.stationName).toBe('Hibberd Astrophysics Laboratory');
    expect(st.nameHistory.map((h) => h.name)).toContain('Ngidi Biological Enterprise');
  });
  it('a name the commander typed that the game never used is left alone', () => {
    const patch = {};
    applyDockToStationPatch(patch, existing('My Bio Lab'), MID, { stationName: 'Hibberd Astrophysics Laboratory', stationType: 'OnFootSettlement', systemName: SYS, systemAddress: 1797401856371, timestamp: '2026-10-27T01:00:00Z' });
    expect(patch.projects).toBeUndefined();
  });
  it('an approach is enough: the station and its project take the name the journal gives the market id', () => {
    const patch = {};
    processSettlementApproaches({ approachSettlementEvents: [{ event: 'ApproachSettlement', timestamp: '2026-10-27T00:50:00Z', Name: 'Hibberd Astrophysics Laboratory', MarketID: MID }] }, existing(), patch);
    expect(patch.knownStations.__upsert[String(MID)].stationName).toBe('Hibberd Astrophysics Laboratory');
    expect(patch.knownStations.__upsert[String(MID)].nameHistory.at(-1)).toEqual({ name: 'Ngidi Biological Enterprise', changedAt: '2026-10-27T00:50:00Z' });
    expect(patch.projects.__upsert.p1.completedStationName).toBe('Hibberd Astrophysics Laboratory');
  });
  it('a construction-site name never replaces a finished name, and an unknown market id is ignored', () => {
    const patch = {};
    processSettlementApproaches({ approachSettlementEvents: [
      { event: 'ApproachSettlement', timestamp: '2026-10-27T00:50:00Z', Name: 'Planetary Construction Site: Something', MarketID: MID },
      { event: 'ApproachSettlement', timestamp: '2026-10-27T00:51:00Z', Name: 'Elsewhere', MarketID: 1 },
    ] }, existing(), patch);
    expect(patch).toEqual({});
  });
});
