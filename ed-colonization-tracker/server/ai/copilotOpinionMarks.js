// server/ai/copilotOpinionMarks.js
//
// Which stations just got a co-pilot OPINION — so the other dock-time remarks (the station-type line,
// dock flavour, the economy/service affinity) hold off instead of talking over it. No imports, so
// copilotOpinions, copilotAffinity and copilotContext can all share it without an import cycle.

const spokenAt = new Map(); // marketId (string) -> ms
export const SUPPRESS_MS = 15 * 60_000;

export function markOpined(marketId, now = Date.now()) {
  if (marketId == null) return;
  spokenAt.set(String(marketId), now);
  if (spokenAt.size > 500) {
    const cutoff = now - SUPPRESS_MS;
    for (const [k, t] of spokenAt) if (t < cutoff) spokenAt.delete(k);
  }
}

export function recentlyOpined(marketId, ms = SUPPRESS_MS, now = Date.now()) {
  if (marketId == null) return false;
  const t = spokenAt.get(String(marketId));
  return t != null && now - t < ms;
}

/** Test seam. */
export function _resetOpinionMarks() { spokenAt.clear(); }
