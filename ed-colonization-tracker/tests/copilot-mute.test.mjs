// The combat gate: Music → Combat_* holds every co-pilot line; the next non-combat track clears it.
import { describe, it, expect } from 'vitest';
import { isCombatTrack, nextCombatState } from '../server/ai/copilotMute.js';

describe('co-pilot combat mute', () => {
  it('recognises every combat track the journal has ever written, and nothing else', () => {
    for (const t of ['Combat_SRV', 'Combat_Dogfight', 'Combat_LargeDogFight', 'Combat_Unknown', 'combat_capitalship']) expect(isCombatTrack(t), t).toBe(true);
    for (const t of ['NoTrack', 'OnFoot', 'Exploration', 'DockingComputer', 'Supercruise', 'Interdiction', '', null, undefined]) expect(isCombatTrack(t), String(t)).toBe(false);
  });

  it('raises on combat music, holds through non-music events, and clears on the next track', () => {
    let c = false;
    c = nextCombatState(c, { event: 'Music', MusicTrack: 'Combat_SRV' }); expect(c).toBe(true);
    c = nextCombatState(c, { event: 'UnderAttack', Target: 'You' });       expect(c).toBe(true);   // not music: unchanged
    c = nextCombatState(c, { event: 'ShipLocker' });                        expect(c).toBe(true);
    c = nextCombatState(c, { event: 'Music', MusicTrack: 'NoTrack' });      expect(c).toBe(false);  // the all-clear
    c = nextCombatState(c, null);                                           expect(c).toBe(false);
  });
});
