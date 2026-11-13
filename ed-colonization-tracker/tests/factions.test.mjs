// System factions from the journal (1.60.24): the reading one jump carries, history kept only when
// something moved, trends, reputation bands, the dock-banner line, and the Sync All backfill.
// The reading is the real Location event of 2026-10-05 00:54Z in the home system.
import { describe, it, expect } from 'vitest';
import {
  factionSnapshotFromEvent, mergeSystemFactions, influenceTrend, reputationBand, formatInfluence,
  factionStatesLabel, describeStationFactionLine, extractSystemFactions, FACTION_HISTORY_CAP,
} from '../server/journal/factions.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const ADDR = 1797401856371;
const LOCATION = {
  timestamp: '2026-10-05T00:54:09Z', event: 'Location', StarSystem: SYS, SystemAddress: ADDR, Population: 196_044_357,
  SystemAllegiance: 'Empire', SystemGovernment_Localised: 'Patronage', SystemSecurity_Localised: 'Low Security',
  SystemFaction: { Name: 'The 9th Legion', FactionState: 'Expansion' },
  Factions: [
    { Name: 'Pro-JDP League', FactionState: 'None', Government: 'Patronage', Influence: 0.194, Allegiance: 'Independent', Happiness_Localised: 'Happy', MyReputation: 100 },
    { Name: 'HIP 104349 Ring', FactionState: 'None', Government: 'Anarchy', Influence: 0.336, Allegiance: 'Independent', Happiness_Localised: 'Happy', MyReputation: 46.496601 },
    { Name: 'Order of Copernicus', FactionState: 'None', Government: 'Confederacy', Influence: 0.084, Allegiance: 'Independent', Happiness_Localised: 'Happy', SquadronFaction: true, MyReputation: 100, RecoveringStates: [{ State: 'Expansion', Trend: 0 }] },
    { Name: 'The 9th Legion', FactionState: 'Expansion', Government: 'Patronage', Influence: 0.386, Allegiance: 'Empire', Happiness_Localised: 'Happy', MyReputation: 100, ActiveStates: [{ State: 'Expansion' }] },
  ],
};
const jump = (at, ring, legion, over = {}) => ({
  ...LOCATION, event: 'FSDJump', timestamp: at,
  Factions: LOCATION.Factions.map((f) => f.Name === 'HIP 104349 Ring' ? { ...f, Influence: ring } : f.Name === 'The 9th Legion' ? { ...f, Influence: legion } : f),
  ...over,
});

describe('factionSnapshotFromEvent', () => {
  const s = factionSnapshotFromEvent(LOCATION);
  it('keeps every field the panel shows, sorted by influence', () => {
    expect(s.factions.map((f) => f.name)).toEqual(['The 9th Legion', 'HIP 104349 Ring', 'Pro-JDP League', 'Order of Copernicus']);
    expect(s.controlling).toEqual({ name: 'The 9th Legion', state: 'Expansion' });
    expect(s.security).toBe('Low Security');
    const ring = s.factions[1];
    expect(ring).toMatchObject({ influence: 0.336, state: null, government: 'Anarchy', allegiance: 'Independent', happiness: 'Happy', squadron: false, active: [], pending: [], recovering: [] });
    expect(ring.reputation).toBeCloseTo(46.4966, 3);
    expect(s.factions[3]).toMatchObject({ squadron: true, recovering: ['Expansion'] });
    expect(s.factions[0]).toMatchObject({ state: 'Expansion', active: ['Expansion'] });
    expect(s.history).toEqual([]);
  });
  it('an event without a faction list is not a reading', () => {
    expect(factionSnapshotFromEvent({ event: 'FSDJump', StarSystem: SYS })).toBeNull();
    expect(factionSnapshotFromEvent({ event: 'FSDJump', StarSystem: SYS, Factions: [] })).toBeNull();
    expect(factionSnapshotFromEvent(null)).toBeNull();
  });
});

describe('mergeSystemFactions — history only when something moved', () => {
  it('a repeated reading, or an older one, changes nothing', () => {
    const a = mergeSystemFactions(null, factionSnapshotFromEvent(LOCATION));
    const b = mergeSystemFactions(a, factionSnapshotFromEvent(jump('2026-10-05T02:00:00Z', 0.336, 0.386)));
    expect(b.history).toEqual([]);
    expect(b.updatedAt).toBe('2026-10-05T02:00:00Z');
    const c = mergeSystemFactions(b, factionSnapshotFromEvent(jump('2026-10-04T00:00:00Z', 0.5, 0.2)));
    expect(c).toBe(b);
  });
  it('a moved influence pushes the previous reading into history and feeds the trend', () => {
    const a = mergeSystemFactions(null, factionSnapshotFromEvent(LOCATION));
    const b = mergeSystemFactions(a, factionSnapshotFromEvent(jump('2026-10-06T03:00:00Z', 0.341, 0.381)));
    expect(b.history).toHaveLength(1);
    expect(b.history[0].at).toBe('2026-10-05T00:54:09Z');
    expect(b.history[0].influence['HIP 104349 Ring']).toBe(0.336);
    expect(b.history[0].states['The 9th Legion']).toBe('Expansion');
    const t = influenceTrend(b, 'HIP 104349 Ring');
    expect(t).toMatchObject({ current: 0.341, previous: 0.336, previousAt: '2026-10-05T00:54:09Z', arrow: '▲' });
    expect(t.delta).toBeCloseTo(0.005, 9);
    expect(influenceTrend(b, 'The 9th Legion').arrow).toBe('▼');
    expect(influenceTrend(b, 'Pro-JDP League').arrow).toBe('');     // unchanged: nothing to compare with
    expect(influenceTrend(b, 'Nobody')).toBeNull();
  });
  it('a state change alone is a move too', () => {
    const a = mergeSystemFactions(null, factionSnapshotFromEvent(LOCATION));
    const ev = jump('2026-10-07T03:00:00Z', 0.336, 0.386);
    ev.Factions = ev.Factions.map((f) => f.Name === 'The 9th Legion' ? { ...f, FactionState: 'None', ActiveStates: undefined } : f);
    const b = mergeSystemFactions(a, factionSnapshotFromEvent(ev));
    expect(b.history).toHaveLength(1);
    expect(b.factions[0].state).toBeNull();
  });
  it('history is capped', () => {
    let e = mergeSystemFactions(null, factionSnapshotFromEvent(LOCATION));
    const t0 = Date.parse('2026-11-01T00:00:00Z');
    for (let i = 1; i <= FACTION_HISTORY_CAP + 5; i++) {
      e = mergeSystemFactions(e, factionSnapshotFromEvent(jump(new Date(t0 + i * 3600_000).toISOString(), 0.3 + i * 0.001, 0.4 - i * 0.001)));
    }
    expect(e.history).toHaveLength(FACTION_HISTORY_CAP);
    expect(e.history[e.history.length - 1].influence['HIP 104349 Ring']).toBeCloseTo(0.3 + (FACTION_HISTORY_CAP + 4) * 0.001, 9);
  });
});

describe('labels and the dock-banner line', () => {
  it('reputation bands as the panel labels them', () => {
    expect(reputationBand(100)).toBe('Allied');
    expect(reputationBand(90)).toBe('Allied');
    expect(reputationBand(46.5)).toBe('Friendly');
    expect(reputationBand(10)).toBe('Cordial');
    expect(reputationBand(0)).toBe('Neutral');
    expect(reputationBand(-10)).toBe('Unfriendly');
    expect(reputationBand(-50)).toBe('Hostile');
    expect(reputationBand(null)).toBeNull();
  });
  it('influence and states', () => {
    expect(formatInfluence(0.336)).toBe('33.6%');
    expect(formatInfluence(0.3864)).toBe('38.6%');
    expect(factionStatesLabel({ active: ['Boom', 'Civil liberty'], state: 'Boom' })).toBe('Boom · Civil liberty');
    expect(factionStatesLabel({ active: [], state: 'War' })).toBe('War');
    expect(factionStatesLabel({ active: [], state: null })).toBe('');
  });
  it('the line, with and without a reading', () => {
    const a = mergeSystemFactions(null, factionSnapshotFromEvent(LOCATION));
    expect(describeStationFactionLine(a, 'HIP 104349 Ring')).toBe('\u{1F3F4} HIP 104349 Ring runs this place · 33.6% · Friendly');
    expect(describeStationFactionLine(a, 'The 9th Legion')).toBe('\u{1F3F4} The 9th Legion runs this place · 38.6% · Allied · Expansion');
    const b = mergeSystemFactions(a, factionSnapshotFromEvent(jump('2026-10-06T03:00:00Z', 0.341, 0.381)));
    expect(describeStationFactionLine(b, 'HIP 104349 Ring')).toBe('\u{1F3F4} HIP 104349 Ring runs this place · 34.1% ▲ · Friendly');
    expect(describeStationFactionLine(null, 'Brewer Corporation')).toBe('\u{1F3F4} Brewer Corporation runs this place');
    expect(describeStationFactionLine(a, 'Somebody Else')).toBe('\u{1F3F4} Somebody Else runs this place');
    expect(describeStationFactionLine(a, null)).toBeNull();
  });
});

describe('extractSystemFactions — the Sync All backfill', () => {
  it('reads only the lines that carry a faction list, in file order, and folds them per system', () => {
    const files = {
      'J1.log': [JSON.stringify(LOCATION), '{ "timestamp":"2026-10-05T01:00:00Z", "event":"Docked", "StarSystem":"x" }', 'not json'].join('\n'),
      'J2.log': [JSON.stringify(jump('2026-10-06T03:00:00Z', 0.341, 0.381)), JSON.stringify({ ...jump('2026-10-06T04:00:00Z', 0.5, 0.5), StarSystem: 'HIP 52629', SystemAddress: 1 })].join('\n'),
    };
    const out = extractSystemFactions('/nowhere', { listFiles: () => Object.keys(files), readFile: (p) => files[p] });
    expect(Object.keys(out).sort()).toEqual(['col 173 sector ax-j d9-52', 'hip 52629']);
    const home = out['col 173 sector ax-j d9-52'];
    expect(home.updatedAt).toBe('2026-10-06T03:00:00Z');
    expect(home.history).toHaveLength(1);
    expect(influenceTrend(home, 'HIP 104349 Ring').arrow).toBe('▲');
  });
  it('a missing journal folder yields an empty map', () => {
    expect(extractSystemFactions('/definitely/not/here')).toEqual({});
  });
});
