/**
 * Engineer unlock progress.
 *
 * WHY: several mission-reward commodities exist for exactly one reason — they open an engineer
 * or a tech broker. Whether you want 25 Modular Terminals depends entirely on whether Marco Qwent
 * is still locked, and nothing in the app knew that. `EngineerProgress` carries it and was being
 * discarded.
 *
 * The journal writes the event in two shapes:
 *   - a FULL SNAPSHOT (`Engineers: [...]`) on every game load
 *   - a SINGLE update (flat `Engineer`/`Progress`/`Rank`) when one changes mid-session
 * Both are handled; the single update never clears the others.
 *
 * Progress values: 'Known' | 'Invited' | 'Unlocked' | 'Barred'.
 */

/** Normalise one engineer record from either event shape. */
function readOne(e) {
  if (!e || !e.Engineer) return null;
  return {
    name: String(e.Engineer),
    progress: e.Progress ? String(e.Progress) : 'Known',
    rank: Number.isFinite(e.Rank) ? e.Rank : null,
    rankProgress: Number.isFinite(e.RankProgress) ? e.RankProgress : null,
  };
}

/**
 * Fold every EngineerProgress event in this tick into the existing map.
 * Returns the updated map, or null when nothing changed (so the caller can skip the patch).
 */
export function applyEngineerEvents(events, existing) {
  const out = { ...(existing || {}) };
  let changed = false;

  for (const ev of events || []) {
    if (!ev || ev.event !== 'EngineerProgress') continue;

    // A snapshot replaces what it covers; a flat update touches one engineer.
    const records = Array.isArray(ev.Engineers)
      ? ev.Engineers.map(readOne)
      : [readOne(ev)];

    for (const r of records) {
      if (!r) continue;
      const prev = out[r.name];
      if (prev && prev.progress === r.progress && prev.rank === r.rank
        && prev.rankProgress === r.rankProgress) continue;
      out[r.name] = { progress: r.progress, rank: r.rank, rankProgress: r.rankProgress, updatedAt: ev.timestamp || null };
      changed = true;
    }
  }

  return changed ? out : null;
}

/** Convenience for the UI/tests: which engineers are still short of Unlocked. */
export function lockedEngineers(map) {
  return Object.entries(map || {})
    .filter(([, v]) => v && v.progress !== 'Unlocked')
    .map(([name, v]) => ({ name, progress: v.progress }));
}
