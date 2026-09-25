/**
 * Re-export shim — the canonical implementation lives in
 * server/journal/scanCompleteness.js (single source of truth for the app UI,
 * the server-side overlay and the offline tools). Types come from the
 * adjacent scanCompleteness.d.ts.
 *
 * Completeness rules are changed ONCE in server/journal/scanCompleteness.js;
 * this module exists only so browser code keeps its `@/lib/scanCompleteness`
 * import path.
 */
export * from '../../server/journal/scanCompleteness.js';
export type { ScanCompleteness, ScanState } from '../../server/journal/scanCompleteness.js';
