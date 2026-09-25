/**
 * Type declarations for the canonical scan-completeness implementation
 * (scanCompleteness.js) — consumed by the server (overlay.js), the browser UI
 * (via the src/lib/scanCompleteness.ts re-export shim) and the tools.
 */
import type { ScoutedSystemData } from '../../src/store/types';

export type ScanState = 'none' | 'partial' | 'unknown' | 'complete';

export interface ScanCompleteness {
  records: number;      // bodies we actually have data for (stars + planets)
  total: number;        // true FSS total (honk / Spansh bodyCount); 0 if unknown
  known: boolean;       // do we know the true total?
  isPartial: boolean;   // known AND total > records
  state: ScanState;
  hasBodyData: boolean; // records > 0 — false means unclassified, never "empty"
}

/** Stars and planets only — barycentre records never count toward the honk. */
export function countScanRecords(
  bodies: ReadonlyArray<{ type?: string } | null | undefined> | null | undefined,
): number;

export function scanCompleteness(
  s: Pick<ScoutedSystemData, 'spanshBodyCount' | 'journalScannedCount' | 'journalBodyCount' | 'totalBodyCount' | 'fromJournal'> | null | undefined,
): ScanCompleteness;
