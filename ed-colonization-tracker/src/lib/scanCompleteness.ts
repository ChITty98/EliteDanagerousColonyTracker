/**
 * Scan completeness for a scouted system.
 *
 * "In Spansh" does NOT mean "fully scanned" — Spansh reports a system's true
 * FSS body count (the honk total) even when it only holds detailed data on a
 * few bodies. A score computed on a partial scan is provisional: the gems may
 * be in the unrecorded bodies. This derives records-vs-total so the UI can warn
 * instead of letting a partial low score read as "known, skip".
 */
import type { ScoutedSystemData } from '@/store/types';

export interface ScanCompleteness {
  records: number;   // bodies we actually have data for
  total: number;     // true FSS total (honk / Spansh bodyCount); 0 if unknown
  known: boolean;    // do we know the true total?
  isPartial: boolean; // known AND total > records
}

export function scanCompleteness(
  s: Pick<ScoutedSystemData, 'spanshBodyCount' | 'journalScannedCount' | 'journalBodyCount' | 'totalBodyCount' | 'fromJournal'>,
): ScanCompleteness {
  const records = s.fromJournal
    ? (s.journalScannedCount ?? 0)
    : (s.spanshBodyCount ?? 0);
  const total = s.totalBodyCount ?? s.journalBodyCount ?? 0;
  const known = total > 0;
  return { records, total, known, isPartial: known && total > records };
}
