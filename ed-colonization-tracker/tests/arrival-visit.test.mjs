// 1.60.30: the arrival line's "last here" part, the dock seed at boot, the live known-system merge,
// and the depot-project heal that also fixes a placeholder name. Cases are the real ones:
// HIP 47126 on 2026-10-07 (76 jumps on file, record reset to 1 by the live path), Plait Reach
// ("Depot 3964283138" after a dock the watcher never saw), Cavallo Nero Corona (last docked 2 Sep).
import { describe, it, expect } from 'vitest';
import {
  describeLastVisit, lastVisitLabel, shortDate, ordinal, mergeKnownSystem, latestDockFromLines,
  healDepotProject, finishedNameFromSite,
} from '../server/journal/util.js';

const NOW = Date.parse('2026-10-07T05:35:25Z');

describe('describeLastVisit — the arrival line', () => {
  it('names the previous visit and this visit\'s number', () => {
    expect(describeLastVisit({ lastSeen: '2026-09-02T12:00:00Z', visitCount: 76 }, NOW)).toBe('Last here 2 Sep (4 weeks ago) · 77th visit');
  });
  it('no count, no suffix; no record, first time', () => {
    expect(describeLastVisit({ lastSeen: '2026-10-06T12:00:00Z' }, NOW)).toBe('Last here 6 Oct (earlier today)');
    expect(describeLastVisit({ lastSeen: '2026-10-05T12:00:00Z', visitCount: 0 }, NOW)).toBe('Last here 5 Oct (yesterday)');
    expect(describeLastVisit(undefined, NOW)).toBe('✨ First time in this system');
    expect(describeLastVisit({ visitCount: 3 }, NOW)).toBe('✨ First time in this system');
  });
  it('a date in another year carries the year', () => {
    expect(lastVisitLabel('2025-09-11T12:00:00Z', NOW)).toBe('11 Sep 2025 (over a year ago)');
    expect(shortDate('2026-07-20T12:00:00Z', NOW)).toBe('20 Jul');
    expect(shortDate('garbage', NOW)).toBeNull();
    expect(lastVisitLabel('garbage', NOW)).toBeNull();
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 77, 101, 111, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '77th', '101st', '111th', '112th']);
  });
});

describe('mergeKnownSystem — a live jump adds to the record instead of replacing it', () => {
  const prior = { systemName: 'HIP 47126', systemAddress: 1, population: 312_243_355, economy: 'High Tech', economyLocalised: 'High Tech', secondEconomy: 'Tourism', secondEconomyLocalised: 'Tourism', coordinates: { x: 1, y: 2, z: 3 }, bodyCount: 14, visitCount: 76, lastSeen: '2026-09-02T05:50:03Z' };
  const jump = { systemName: 'HIP 47126', systemAddress: 1, population: 339_900_000, economy: 'High Tech', economyLocalised: 'High Tech', coordinates: { x: 1, y: 2, z: 3 }, visitCount: 1, lastSeen: '2026-10-07T05:35:25Z' };
  it('visits accumulate; fields the jump carries win; fields it lacks survive', () => {
    const m = mergeKnownSystem(prior, jump);
    expect(m.visitCount).toBe(77);
    expect(m.population).toBe(339_900_000);
    expect(m.lastSeen).toBe('2026-10-07T05:35:25Z');
    expect(m.bodyCount).toBe(14);
    expect(m.secondEconomy).toBe('Tourism');
  });
  it('an Unknown economy, a zero population or missing coordinates never overwrite known ones', () => {
    const m = mergeKnownSystem(prior, { ...jump, economy: 'Unknown', economyLocalised: 'Unknown', population: 0, coordinates: undefined });
    expect(m.economy).toBe('High Tech');
    expect(m.population).toBe(312_243_355);
    expect(m.coordinates).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('an older event never moves lastSeen back; without a prior record the jump stands alone', () => {
    expect(mergeKnownSystem(prior, { ...jump, lastSeen: '2026-01-01T00:00:00Z' }).lastSeen).toBe('2026-09-02T05:50:03Z');
    expect(mergeKnownSystem(undefined, jump)).toBe(jump);
    expect(mergeKnownSystem(prior, undefined)).toBe(prior);
  });
});

describe('latestDockFromLines — the dock seed at boot', () => {
  const docked = '{ "timestamp":"2026-10-07T04:49:36Z", "event":"Docked", "StationName":"Orbital Construction Site: Plait Reach", "StationType":"SpaceConstructionDepot", "MarketID":3964283138, "StarSystem":"Col 173 Sector AX-J d9-52", "SystemAddress":1797401856371 }';
  const music = '{ "timestamp":"2026-10-07T04:49:40Z", "event":"Music", "MusicTrack":"DockingComputer" }';
  it('the latest Docked with nothing undocking after it', () => {
    expect(latestDockFromLines([docked, music, 'not json', ''])).toEqual({ marketId: 3964283138, stationName: 'Orbital Construction Site: Plait Reach', systemName: 'Col 173 Sector AX-J d9-52', dockedAt: '2026-10-07T04:49:36Z' });
  });
  it('an Undocked, FSDJump or CarrierJump after it means no dock', () => {
    expect(latestDockFromLines([docked, '{ "timestamp":"2026-10-07T05:49:41Z", "event":"Undocked", "MarketID":3964283138 }'])).toBeNull();
    expect(latestDockFromLines([docked, '{ "timestamp":"2026-10-07T05:50:00Z", "event":"FSDJump", "StarSystem":"HIP 47126" }'])).toBeNull();
    expect(latestDockFromLines([docked, '{ "timestamp":"2026-10-07T05:50:00Z", "event":"CarrierJump", "StarSystem":"HIP 47126" }'])).toBeNull();
    expect(latestDockFromLines([])).toBeNull();
  });
  it('a login while docked counts', () => {
    const loc = '{ "timestamp":"2026-10-07T01:47:18Z", "event":"Location", "Docked":true, "StationName":"Core Boson Complex Cbc", "MarketID":4391682051, "StarSystem":"Col 173 Sector AX-J d9-52" }';
    expect(latestDockFromLines([loc, music]).stationName).toBe('Core Boson Complex Cbc');
    expect(latestDockFromLines(['{ "timestamp":"2026-10-07T01:47:18Z", "event":"Location", "Docked":false, "StarSystem":"X" }'])).toBeNull();
  });
});

describe('healDepotProject — the placeholder name goes once the identity is known', () => {
  const MID = 3964283138;
  const ident = { stationName: 'Orbital Construction Site: Plait Reach', systemName: 'Col 173 Sector AX-J d9-52', systemAddress: 1797401856371, stationType: 'SpaceConstructionDepot' };
  it('a project created blind gets everything, name included', () => {
    expect(healDepotProject({ name: 'Depot 3964283138', systemName: '', stationName: '', systemAddress: null, stationType: '' }, ident, MID)).toEqual({
      systemName: 'Col 173 Sector AX-J d9-52', stationName: 'Orbital Construction Site: Plait Reach', systemAddress: 1797401856371, stationType: 'SpaceConstructionDepot',
      name: 'Col 173 Sector AX-J d9-52 - Orbital Construction Site: Plait Reach',
    });
  });
  it('identity already filled by another path, name still the placeholder: only the name moves (the Plait Reach case)', () => {
    expect(healDepotProject({ name: 'Depot 3964283138', systemName: 'Col 173 Sector AX-J d9-52', stationName: 'Orbital Construction Site: Plait Reach', systemAddress: 1797401856371, stationType: 'SpaceConstructionDepot' }, { stationName: '', systemName: '', systemAddress: null, stationType: '' }, MID))
      .toEqual({ name: 'Col 173 Sector AX-J d9-52 - Orbital Construction Site: Plait Reach' });
    expect(healDepotProject({ name: 'Depot 4389829123 ()', systemName: 'Col 173 Sector AX-J d9-52', stationName: 'Planetary Construction Site: Kewell Range' }, {}, 4389829123))
      .toEqual({ name: 'Col 173 Sector AX-J d9-52 - Planetary Construction Site: Kewell Range' });
  });
  it('a typed name is never touched; nothing to heal is null; no system known keeps the placeholder', () => {
    expect(healDepotProject({ name: 'My relay', systemName: 'Sol', stationName: 'Orbital Construction Site: X', systemAddress: 1, stationType: 'SpaceConstructionDepot' }, ident, MID)).toBeNull();
    expect(healDepotProject({ name: 'Depot 1', systemName: '', stationName: '' }, { stationName: '', systemName: '' }, 1)).toBeNull();
    expect(healDepotProject(null, ident, MID)).toBeNull();
  });
});

describe('finishedNameFromSite — an installation never takes a dock, so its name comes from the site', () => {
  it('strips the construction-site prefix, keeps a plain name, refuses a colonisation ship', () => {
    expect(finishedNameFromSite('Orbital Construction Site: Plait Reach')).toBe('Plait Reach');
    expect(finishedNameFromSite('Planetary Construction Site: Kewell Range')).toBe('Kewell Range');
    expect(finishedNameFromSite('Plait Reach')).toBe('Plait Reach');
    expect(finishedNameFromSite('$EXT_PANEL_ColonisationShip; Chiang Bastion')).toBe('');
    expect(finishedNameFromSite('')).toBe('');
    expect(finishedNameFromSite(undefined)).toBe('');
  });
});
