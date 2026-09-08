// What a surface signal is worth to run — the ONE place that rule lives.
//
// The Rhino carries four rigs, and a rig works one deposit of one commodity. So the value of a
// signal is not "its best three commodities": it is the best FOUR RIGS you could have running at
// once, with no more than three of them on any single commodity. Two iridium deposits with two
// rigs and one rig are three rigs of iridium — the cap — and the fourth rig goes to whatever pays
// next, which is why a grandidierite-and-LTD signal leaves no room to weave helium in.
//
// A deposit with no confirmed rig count is assumed to run one rig. A commodity tagged from orbit
// but never worked is also one rig; the orbital ESTIMATE is deliberately not trusted here.
export const MAX_RIGS_PER_COMMODITY = 3;
export const MAX_RIGS_TOTAL = 4;

export interface RigSlot { commodity: string; rigs: number; each: number; value: number }

/**
 * Allocate the four rigs across a signal's commodities, richest first, and return what each one
 * won. The caller sums `value` for a score or renders the slots for a tooltip — same allocation
 * either way, so the number and its explanation can never disagree.
 */
export function allocateRigs(
  commodities: Iterable<string>,
  priceOf: (c: string) => number | null | undefined,
  rigsOf?: (c: string) => number | null | undefined,
): RigSlot[] {
  const candidates = [...commodities]
    .map((commodity) => ({
      commodity,
      each: priceOf(commodity) ?? 0,
      available: Math.min(Math.max(rigsOf?.(commodity) ?? 1, 1), MAX_RIGS_PER_COMMODITY),
    }))
    .filter((c) => c.each > 0)
    .sort((a, b) => b.each - a.each || a.commodity.localeCompare(b.commodity));

  const out: RigSlot[] = [];
  let left = MAX_RIGS_TOTAL;
  for (const c of candidates) {
    if (left <= 0) break;
    const rigs = Math.min(c.available, left);
    left -= rigs;
    out.push({ commodity: c.commodity, rigs, each: c.each, value: rigs * c.each });
  }
  return out;
}

/** The signal's expected value: what those four rigs are worth together. */
export function rigValue(
  commodities: Iterable<string>,
  priceOf: (c: string) => number | null | undefined,
  rigsOf?: (c: string) => number | null | undefined,
): number {
  return allocateRigs(commodities, priceOf, rigsOf).reduce((t, s) => t + s.value, 0);
}
