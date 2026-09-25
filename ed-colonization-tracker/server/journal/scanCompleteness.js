/**
 * Scan completeness — how much of a system a score actually saw.
 *
 * "In Spansh" does NOT mean "fully scanned". Spansh keeps a system's true FSS body
 * count (the honk total) separately from the bodies it holds records for, and it
 * keeps position-only entries with no bodies at all. A score computed on a partial
 * or empty body list is not a verdict — 44 near-home systems wore a 0 for being
 * position-only, and a live sample of 24 zero-score records without a total on file
 * found 10 partial scans (Wregoe PD-Z c27-0: the arrival star on file, 19 in the honk).
 *
 * This module is the single source of truth for that judgement. The server overlay,
 * the browser UI (via the src/lib/scanCompleteness.ts re-export shim) and the offline
 * tools all read it; types live in the adjacent scanCompleteness.d.ts.
 *
 * States:
 *   none      — nothing on file: no body records and no total. A Spansh position-only
 *               entry, or a favourite stub that was never queried. Unclassified, not empty.
 *   partial   — the total is known and exceeds the records ("0 of 28" counts).
 *   unknown   — records on file but no total: complete or partial, no way to tell.
 *   complete  — the records reach the known total.
 */

/**
 * Body records that count toward the honk total: stars and planets. Spansh lists
 * barycentres as records too (type 'Barycentre'); the FSS honk never counts them, so
 * "6 records of 21" at Wregoe PD-Z c27-10 was really 4 of 21.
 * @param {ReadonlyArray<{ type?: string } | null | undefined> | null | undefined} bodies
 * @returns {number}
 */
export function countScanRecords(bodies) {
  if (!Array.isArray(bodies)) return 0;
  let n = 0;
  for (const b of bodies) if (b && (b.type === 'Star' || b.type === 'Planet')) n++;
  return n;
}

/**
 * @param {{ spanshBodyCount?: number, journalScannedCount?: number, journalBodyCount?: number,
 *           totalBodyCount?: number, fromJournal?: boolean } | null | undefined} s
 * @returns {{ records: number, total: number, known: boolean, isPartial: boolean,
 *             state: 'none' | 'partial' | 'unknown' | 'complete', hasBodyData: boolean }}
 */
export function scanCompleteness(s) {
  const rec = s || {};
  const records = rec.fromJournal ? (rec.journalScannedCount ?? 0) : (rec.spanshBodyCount ?? 0);
  const total = rec.totalBodyCount ?? rec.journalBodyCount ?? 0;
  const known = total > 0;
  const isPartial = known && total > records;
  const state = !known ? (records > 0 ? 'unknown' : 'none') : isPartial ? 'partial' : 'complete';
  return { records, total, known, isPartial, state, hasBodyData: records > 0 };
}
