/**
 * Procedural-name + star-class helpers for the target alert.
 *
 * At target time (FSDTarget) the only knowns for a system you haven't visited
 * are its NAME (→ mass code) and the PRIMARY star class. From those two we
 * give a friendly star name and a colonization outlook, using the baked
 * (mass code × primary class) table generated from the Spansh master.
 * No runtime Spansh — works on systems Spansh has never seen.
 */
import {
  COLONIZATION_BY_CODE,
  COLONIZATION_BY_CODE_PRIMARY,
  COLONIZATION_BASELINE,
  type MassCodeStat,
} from '@/data/massCodeColonization';

// FSDTarget StarClass code → bucket primary class (matches the analysis tool's
// classify()). Order matters: white dwarfs (D*) before the leading-letter case.
export function classifyStarCode(code?: string | null): string {
  const c = (code || '').trim();
  if (!c) return 'other';
  if (/^D/.test(c)) return 'WD';                 // DA, DB, DC, D...
  if (c === 'N') return 'NS';
  if (c === 'H' || /supermassive/i.test(c)) return 'BH';
  if (/^W/.test(c)) return 'WR';                 // W, WN, WC, WO...
  if (/^[LTY]$/.test(c) || /brown/i.test(c)) return 'BD';
  if (/^C/.test(c)) return 'C';                  // carbon: C, CN, CJ, CS...
  const lead = c[0].toUpperCase();
  if ('OBAFGKM'.includes(lead)) return lead;     // incl. giants like "M_RedGiant"
  return 'other';
}

const FRIENDLY: Record<string, string> = {
  O: 'Blue Giant (O)', B: 'Blue-White (B)', A: 'White (A)', F: 'Yellow-White (F)',
  G: 'Yellow Dwarf (G, Sol-like)', K: 'Orange Dwarf (K)', M: 'Red Dwarf (M)',
  BD: 'Brown Dwarf', WD: 'White Dwarf', NS: 'Neutron Star', BH: 'Black Hole',
  WR: 'Wolf-Rayet', C: 'Carbon Star',
};

/** "M" → "Red Dwarf (M)". Falls back to the raw code for unmapped/young classes. */
export function friendlyStarName(code?: string | null): string {
  const c = (code || '').trim();
  if (!c) return '';
  if (/supergiant/i.test(c)) return 'Supergiant';
  if (/giant/i.test(c)) return 'Giant';
  const pc = classifyStarCode(c);
  return FRIENDLY[pc] || c;
}

/** Extract the lowercase mass code (a–h) from a procedural name; null for catalog names. */
export function parseMassCode(systemName?: string | null): string | null {
  const m = (systemName || '').trim().match(/[A-Za-z]{2}-[A-Za-z]\s+([a-h])\d/);
  return m ? m[1] : null;
}

/**
 * Split a procedural name into its boxel (e.g. "Col 173 Sector AX-J d9") and the
 * index within it. The boxel is the named cube; the index is the trailing number.
 * Returns null for catalog names (HIP/Sol) that have no boxel.
 */
export function parseBoxel(systemName?: string | null): { boxel: string; prefix: string; index: number; massCode: string } | null {
  const m = (systemName || '').trim().match(/^(.*\s[A-Za-z]{2}-[A-Za-z]\s([a-h])\d+)-(\d+)$/);
  if (!m) return null;
  return { boxel: m[1], prefix: m[1] + '-', massCode: m[2], index: parseInt(m[3], 10) };
}

export type ColonizationRating = 'worthwhile' | 'decent' | 'marginal' | 'skip' | 'unknown';

export interface ColonizationOutlook {
  code: string | null;        // mass code a–h, or null for catalog names
  primaryClass: string;       // classified primary (M, K, …, BD, WD, …)
  rating: ColonizationRating;
  label: string;              // short human verdict
  bodies?: number;            // mean body count for this bucket
  goodAtmo?: number;          // mean non-icy landable-atmosphere bodies
  score?: number;             // mean app score for this bucket
  // Name-derived odds (% of systems in this bucket with >=1 of each):
  pInteresting?: number;      // a non-icy atmosphere body
  pRingedBD?: number;         // a ringed brown dwarf
  pOxygen?: number;           // a non-icy oxygen body (the jackpot)
  oxygenLift?: number;        // pOxygen relative to the galaxy baseline (×)
  basis: 'primary' | 'code' | 'none'; // which table row backed the verdict
}

/**
 * Colonization outlook from (system name → mass code) + (FSDTarget primary class).
 * Prefers the (code|primary) bucket; falls back to the code-only row when the
 * primary is unrecognized or the bucket is too sparse to have been baked.
 */
export function colonizationOutlook(systemName?: string | null, starClass?: string | null): ColonizationOutlook {
  const code = parseMassCode(systemName);
  const pc = classifyStarCode(starClass);
  if (!code) {
    return { code: null, primaryClass: pc, rating: 'unknown', label: 'Named system (no mass code)', basis: 'none' };
  }
  // "other" primary buckets are data-poor (null/unscanned primaries), not real
  // "other" stars — fall back to the code row for those.
  let stat: MassCodeStat | undefined =
    pc !== 'other' ? COLONIZATION_BY_CODE_PRIMARY[`${code}|${pc}`] : undefined;
  let basis: ColonizationOutlook['basis'] = 'primary';
  if (!stat) { stat = COLONIZATION_BY_CODE[code]; basis = stat ? 'code' : 'none'; }
  if (!stat) return { code, primaryClass: pc, rating: 'unknown', label: `Mass code ${code}`, basis: 'none' };

  const odds = {
    pInteresting: stat.pInteresting,
    pRingedBD: stat.pRingedBD,
    pOxygen: stat.pOxygen,
    oxygenLift: COLONIZATION_BASELINE.pOxygen > 0 ? stat.pOxygen / COLONIZATION_BASELINE.pOxygen : 0,
  };

  const score = stat.score;
  let rating: ColonizationRating;
  let label: string;
  if (pc === 'BD') {
    // The leftover unscanned pool. Honest: rarely worth it; the code only tells
    // you whether it's a lone brown dwarf or has (usually more-brown-dwarf) mass.
    rating = code === 'a' ? 'skip' : 'marginal';
    label = code === 'a' ? 'Likely lone brown dwarf — skip' : 'Brown-dwarf primary — usually low yield';
  } else if (score >= 15) { rating = 'worthwhile'; label = 'Body-rich — good colony odds'; }
  else if (score >= 10) { rating = 'decent'; label = 'Decent colony potential'; }
  else if (score >= 6) { rating = 'marginal'; label = 'Thin — marginal'; }
  else { rating = 'skip'; label = 'Sparse — skip'; }

  return { code, primaryClass: pc, rating, label, bodies: stat.bodies, goodAtmo: stat.goodAtmo, score, ...odds, basis };
}
