/**
 * scanCompleteness — guards the "in Spansh ≠ fully scanned" logic so a partial
 * scan (e.g. Col 173 AX-J d9-53: 3 of 13 bodies) is flagged, not trusted as final,
 * and a system Spansh only knows the position of is unclassified, never a 0.
 */
import { describe, it, expect } from 'vitest';
import { scanCompleteness, countScanRecords } from '../src/lib/scanCompleteness';

describe('scanCompleteness', () => {
  it('Spansh partial — 3 of 13 (the d9-53 case)', () => {
    expect(scanCompleteness({ spanshBodyCount: 3, totalBodyCount: 13 }))
      .toEqual({ records: 3, total: 13, known: true, isPartial: true, state: 'partial', hasBodyData: true });
  });

  it('Spansh complete — 13 of 13', () => {
    const c = scanCompleteness({ spanshBodyCount: 13, totalBodyCount: 13 });
    expect(c.isPartial).toBe(false);
    expect(c.state).toBe('complete');
  });

  it('journal uses scanned-vs-honk', () => {
    expect(scanCompleteness({ fromJournal: true, journalScannedCount: 5, journalBodyCount: 8 }))
      .toEqual({ records: 5, total: 8, known: true, isPartial: true, state: 'partial', hasBodyData: true });
  });

  it('unknown total → not flagged partial, but not complete either (the March–June records: 1,645 near home)', () => {
    expect(scanCompleteness({ spanshBodyCount: 3 }))
      .toEqual({ records: 3, total: 0, known: false, isPartial: false, state: 'unknown', hasBodyData: true });
  });

  it('position-only: Spansh answered with no bodies → none, never a 0 (Wregoe PD-Z c27-22)', () => {
    const c = scanCompleteness({ spanshBodyCount: 0, fromJournal: false });
    expect(c.state).toBe('none');
    expect(c.hasBodyData).toBe(false);
    expect(c.isPartial).toBe(false);
  });

  it('a favourite stub that was never queried is none too', () => {
    expect(scanCompleteness({}).state).toBe('none');
    expect(scanCompleteness(undefined).state).toBe('none');
  });

  it('honked but nothing scanned is partial, 0 of N (Wregoe PD-Z c27-18: honk 2, no records)', () => {
    expect(scanCompleteness({ spanshBodyCount: 0, totalBodyCount: 2 }))
      .toMatchObject({ records: 0, total: 2, isPartial: true, state: 'partial', hasBodyData: false });
  });

  it('the arrival star alone with the honk on file reads partial (Wregoe PD-Z c27-0: 1 of 19)', () => {
    expect(scanCompleteness({ spanshBodyCount: 1, totalBodyCount: 19 }).state).toBe('partial');
  });

  it('records past the total (barycentre-inflated older records) still read complete', () => {
    expect(scanCompleteness({ fromJournal: true, journalScannedCount: 26, journalBodyCount: 13 }).state).toBe('complete');
  });
});

describe('countScanRecords', () => {
  it('counts stars and planets only — the honk never counts barycentres (Wregoe PD-Z c27-10: 6 records, 4 bodies, honk 21)', () => {
    const bodies = [
      { type: 'Barycentre' }, { type: 'Star' }, { type: 'Star' }, { type: 'Barycentre' }, { type: 'Star' }, { type: 'Star' },
    ];
    expect(countScanRecords(bodies)).toBe(4);
    expect(countScanRecords([{ type: 'Star' }, { type: 'Planet' }, { type: 'Planet' }])).toBe(3);
  });

  it('tolerates junk', () => {
    expect(countScanRecords(null)).toBe(0);
    expect(countScanRecords(undefined)).toBe(0);
    expect(countScanRecords([null, {}, { type: 'Planet' }])).toBe(1);
  });
});
