/**
 * Re-export shim — the canonical scorer implementation lives in
 * server/journal/scorer.js (single source of truth for the app UI, the
 * server-side overlay, and the offline region tools under tools/).
 * Types come from the adjacent scorer.d.ts.
 *
 * Scoring changes are made ONCE in server/journal/scorer.js; this module
 * exists only so browser code keeps its `@/lib/scoutingScorer` import path.
 */
export * from '../../server/journal/scorer.js';
export type {
  QualifyingBody,
  StarInfo,
  BodySegment,
  ScoreBreakdown,
} from '../../server/journal/scorer.js';
