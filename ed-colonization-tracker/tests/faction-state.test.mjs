// The dock dossier's faction state (1.60.23): the game omits FactionState when a faction is in no state,
// so a Docked event that names the faction without a state clears the record instead of carrying the old
// state forward. Sequence from Deshpande Plant: War written 2026-06-26, no state on any dock since.
import { describe, it, expect } from 'vitest';
import { resolveDockFactionState } from '../server/journal/util.js';

const RING = 'HIP 104349 Ring';

describe('resolveDockFactionState', () => {
  it('the first observed state is recorded but not logged as a change', () => {
    expect(resolveDockFactionState(null, { faction: RING, factionState: 'War' })).toEqual({ state: 'War', changed: false });
    expect(resolveDockFactionState(undefined, { faction: RING })).toEqual({ state: null, changed: false });
  });
  it('a named faction with no state clears a recorded state — the Deshpande case', () => {
    expect(resolveDockFactionState('War', { faction: RING })).toEqual({ state: null, changed: true });
    expect(resolveDockFactionState('War', { faction: RING, factionState: undefined })).toEqual({ state: null, changed: true });
  });
  it('the same state again is no change; a different state is', () => {
    expect(resolveDockFactionState('War', { faction: RING, factionState: 'War' })).toEqual({ state: 'War', changed: false });
    expect(resolveDockFactionState('War', { faction: RING, factionState: 'Boom' })).toEqual({ state: 'Boom', changed: true });
  });
  it('an event with no faction block at all says nothing and carries the record forward', () => {
    expect(resolveDockFactionState('War', {})).toEqual({ state: 'War', changed: false });
    expect(resolveDockFactionState('War', { stationName: 'Deshpande Plant' })).toEqual({ state: 'War', changed: false });
    expect(resolveDockFactionState('War', null)).toEqual({ state: 'War', changed: false });
    expect(resolveDockFactionState(null, {})).toEqual({ state: null, changed: false });
  });
});
