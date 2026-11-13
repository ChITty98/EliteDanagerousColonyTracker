/**
 * Which market to name as a commodity's source on a project's needs table.
 *
 * Sufficiency first: a station whose stock covers what is still needed outranks any that cannot,
 * whatever the system — a same-system outpost holding 39 t is not a source for 684 t. Among the
 * stations that cover it: the project's own system first, then nearest, then large pads. Among the
 * ones that fall short: the largest stock first, then nearest. No score floor and no distance cap:
 * every stocked snapshot is a candidate. (A −100/ly penalty against a −1 floor used to hide every
 * out-of-system station beyond about ten light-years, which is how Medical Diagnostic Equipment
 * had no source with 1,262 t on file 14 ly away, 1.60.18.)
 *
 * Starred factions (1.60.32): when the project's system has prioritised factions, an in-system
 * station of a starred faction that stocks the item is the pick even when it cannot cover the need
 * — the point is who gets the purchase credit — and the ranking above supplies the fallback shown
 * beneath it. The first starred faction with a stocked station wins; among its stations, most stock
 * first. No stars: nothing changes.
 */
export interface SourceCandidate {
  stationName: string;
  systemName: string;
  hasLargePads: boolean;
  isPlanetary: boolean;
  stock: number;
  buyPrice: number;
  lastSeen: string;
  distanceLy: number | null; // from the project's system; null when unknown
  sameSystem: boolean;
  /** controlling faction from the dock dossier, when known */
  faction?: string | null;
  marketId?: number;
}

export interface SourcePick {
  best: SourceCandidate;
  covers: boolean;                 // best.stock >= remaining
  local: SourceCandidate | null;   // the best-stocked station in the project's own system when the pick is elsewhere
  /** true when a starred faction's station was chosen over the plain ranking */
  preferred: boolean;
  /** the plain ranking's pick when a starred station took its place */
  fallback: SourceCandidate | null;
}

export interface RankOptions {
  preferredFactions?: string[];
}

function plainRank(stocked: SourceCandidate[], remaining: number): SourceCandidate {
  const dist = (c: SourceCandidate) => (c.distanceLy == null ? Number.POSITIVE_INFINITY : c.distanceLy);
  const nearest = (a: SourceCandidate, b: SourceCandidate) =>
    (a.sameSystem === b.sameSystem ? 0 : a.sameSystem ? -1 : 1)
    || dist(a) - dist(b)
    || (a.hasLargePads === b.hasLargePads ? 0 : a.hasLargePads ? -1 : 1)
    || b.stock - a.stock;
  const enough = stocked.filter((c) => c.stock >= remaining).sort(nearest);
  return enough[0] ?? stocked.slice().sort((a, b) => b.stock - a.stock || nearest(a, b))[0];
}

export function rankSources(candidates: SourceCandidate[], remaining: number, opts: RankOptions = {}): SourcePick | null {
  if (!(remaining > 0)) return null;
  const stocked = candidates.filter((c) => c.stock > 0 && c.buyPrice > 0);
  if (!stocked.length) return null;
  const plain = plainRank(stocked, remaining);
  const local = (best: SourceCandidate) => (best.sameSystem ? null : (stocked.filter((c) => c.sameSystem).sort((a, b) => b.stock - a.stock)[0] ?? null));

  const preferred = (opts.preferredFactions ?? []).map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (preferred.length) {
    for (const want of preferred) {
      const mine = stocked.filter((c) => c.sameSystem && (c.faction ?? '').trim().toLowerCase() === want).sort((a, b) => b.stock - a.stock);
      if (mine.length) {
        const best = mine[0];
        const same = best.stationName === plain.stationName && best.systemName === plain.systemName;
        return { best, covers: best.stock >= remaining, local: null, preferred: !same, fallback: same ? null : plain };
      }
    }
  }
  return { best: plain, covers: plain.stock >= remaining, local: local(plain), preferred: false, fallback: null };
}
