// server/ai/copilotMute.js
//
// The commander's rule (2026-09-05): "if I'm in combat I really don't want to be hearing the
// copilot at that moment." The journal announces a fight the same way it announces an auto-dock:
// through the Music event. Combat_SRV (in the Rhino, 100 on file), Combat_Dogfight (977) and
// Combat_LargeDogFight (98) are the tracks seen; anything the game files under Combat_ counts.
// The next non-combat track is the all-clear. copilot.js holds EVERY line while this is true.

export function isCombatTrack(track) {
  return /^Combat_/i.test(String(track || ''));
}

/** Fold one journal event into the combat flag; non-Music events leave it alone. */
export function nextCombatState(prev, ev) {
  if (!ev || ev.event !== 'Music' || typeof ev.MusicTrack !== 'string') return !!prev;
  return isCombatTrack(ev.MusicTrack);
}
