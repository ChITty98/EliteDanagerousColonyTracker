/**
 * scanCompleteness — guards the "in Spansh ≠ fully scanned" logic so a partial
 * scan (e.g. Col 173 AX-J d9-53: 3 of 13 bodies) is flagged, not trusted as final.
 */
import { describe, it, expect } from 'vitest';
import { scanCompleteness } from '../src/lib/scanCompleteness';

describe('scanCompleteness', () => {
  it('Spansh partial — 3 of 13 (the d9-53 case)', () => {
    expect(scanCompleteness({ spanshBodyCount: 3, totalBodyCount: 13 }))
      .toEqual({ records: 3, total: 13, known: true, isPartial: true });
  });

  it('Spansh complete — 13 of 13', () => {
    expect(scanCompleteness({ spanshBodyCount: 13, totalBodyCount: 13 }).isPartial).toBe(false);
  });

  it('journal uses scanned-vs-honk', () => {
    expect(scanCompleteness({ fromJournal: true, journalScannedCount: 5, journalBodyCount: 8 }))
      .toEqual({ records: 5, total: 8, known: true, isPartial: true });
  });

  it('unknown total → not flagged partial', () => {
    expect(scanCompleteness({ spanshBodyCount: 3 }))
      .toEqual({ records: 3, total: 0, known: false, isPartial: false });
  });
});
