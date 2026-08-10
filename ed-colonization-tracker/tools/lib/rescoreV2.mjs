/**
 * v2 formula patch for SLIM-schema records (region .jsonl files + scouted entries whose
 * bodies come from them). Shared by tools/rescore-regions.mjs and tools/rescore-scouted.mjs
 * so both reprice identically.
 *
 * What it recomputes from slim bodies: atmosphere points (v2 per-class ladder — first of
 * each distinct class earns the ladder, clones earn flat +3), diversity bonus, oxygen and
 * exotic bonuses (canonical tables). What it CANNOT recompute (slim schema has no parents):
 * epic geometry. Epic points are derived from the record's STORED epicView reasons, crediting
 * only what the strings prove against the CURRENT bars:
 *   - "tight binary N AU"  → credited when N ≤ 0.1 (bar unchanged since calibration)
 *   - "parent fills N° of sky" → credited when N ≥ 45 (old 20°-era flags are re-validated)
 *   - "skims the ring edge of…" / "orbits INSIDE the rings of…" → credited (new-format
 *     strings only exist where the ratio test already passed)
 *   - "twin worlds, N°" → credited when N ≥ 20
 *   - OLD-format "skims rings of…" (span-only era) → NOT credited: the ratio is unprovable
 * Full-precision epic arrives whenever a system is scored from complete bodies (journal /
 * dump). Approximation honesty: sc.epicCriteriaApprox lists what was credited.
 */
import {
  exoticAtmoPoints,
  distanceDecay,
  ICY_SUBTYPES,
  isColonisableAtmosphere,
  SCORE_FORMULA_VERSION,
} from '../../server/journal/scorer.js';

export { SCORE_FORMULA_VERSION };

const atmoClassOf = (t) => String(t || '').toLowerCase()
  .replace(/^hot /, '').replace(/^thin /, '').replace(/-rich/, '').trim();

export function deriveEpicCriteriaFromReasons(reasons) {
  const criteria = new Set();
  for (const r of reasons || []) {
    let m;
    if ((m = /tight binary ([\d.]+) AU/.exec(r)) && parseFloat(m[1]) <= 0.1) criteria.add('binary');
    else if ((m = /parent fills (\d+)°/.exec(r)) && parseInt(m[1], 10) >= 45) criteria.add('bigSky');
    else if (/skims the ring edge of|orbits INSIDE the rings of/.test(r)) criteria.add('ringEdge');
    else if ((m = /twin worlds, (\d+)°/.exec(r)) && parseInt(m[1], 10) >= 20) criteria.add('twins');
    // old-format "skims rings of" deliberately falls through — unverifiable ratio
  }
  return [...criteria];
}

export function patchScoreV2(sys) {
  const sc = sys.score;
  if (!sc) return false;

  // Atmosphere v2 + diversity + oxygen + exotic, from slim bodies.
  // Approximation (documented in rescore-regions): decay by distLs for every body,
  // since slim lacks isPrimaryStar. Atmospheric icy bodies half-count for the ladder
  // (canonical) but never for oxygen/exotic (also canonical).
  const atmos = (sys.bodies || [])
    .filter((b) => b.landable && isColonisableAtmosphere(b.atmo) && (b.em ?? 999) < 2.5)
    .sort((a, b) => (a.distLs || 0) - (b.distLs || 0));

  let atmospherePoints = 0, oxy = 0, oxyN = 0, exo = 0, exoN = 0;
  const seen = new Set();
  for (const b of atmos) {
    const cls = atmoClassOf(b.atmo);
    const first = !seen.has(cls);
    if (first) seen.add(cls);
    const idx = seen.size;
    const base = first ? (idx === 1 ? 15 : idx === 2 ? 12 : idx === 3 ? 9 : 5) : 3;
    const dk = distanceDecay(b.distLs || 0);
    const icy = ICY_SUBTYPES.has(b.subType || '');
    atmospherePoints += Math.round(base * dk * (icy ? 0.5 : 1));
    if (!icy) {
      if (/oxygen/i.test(b.atmo)) { oxy += Math.round(15 * dk); oxyN++; }
      else { const eb = exoticAtmoPoints(b.atmo); if (eb > 0) { exo += Math.round(eb * dk); exoN++; } }
    }
  }
  oxy = Math.min(oxy, 45);
  exo = Math.min(exo, 50);
  const diversityPoints = Math.min(Math.max(0, seen.size - 1) * 5, 20);

  const criteria = deriveEpicCriteriaFromReasons(sc.epicView && sc.epicView.reasons);
  const epicPoints = Math.min(criteria.length * 10, 30);

  sc.atmospherePoints = atmospherePoints;
  sc.atmosphereCount = atmos.length;
  sc.diversityPoints = diversityPoints;
  sc.distinctAtmoClasses = seen.size;
  sc.oxygenPoints = oxy;
  sc.oxygenCount = oxyN;
  sc.exoticPoints = exo;
  sc.exoticCount = exoN;
  sc.epicPoints = epicPoints;
  if (sc.epicView) sc.epicView.criteriaApprox = criteria;
  sc.total =
    (sc.starPoints || 0) + atmospherePoints + diversityPoints + oxy + exo +
    (sc.ringPoints || 0) + (sc.proximityPoints || 0) + (sc.economyPoints || 0) +
    (sc.bodyCountPoints || 0) + epicPoints;
  sc.formulaVersion = SCORE_FORMULA_VERSION;
  return true;
}
