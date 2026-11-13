// Sync All's FSS signal list keeps one row per system + signal (the latest sighting), not every sighting since 2018 —
// 107,627 rows were 16 MB of the 30 MB state every browser fetched on every change (1.60.36).
import { describe, it, expect } from 'vitest';
import { dedupeFssSignals } from '../server/journal/extractor.js';

const sig = (systemAddress, signalName, timestamp, extra = {}) => ({ signalName, signalType: '', isStation: false, systemAddress, timestamp, ...extra });

describe('dedupeFssSignals', () => {
  it('keeps the latest sighting per system and signal, and the station flag once any sighting had it', () => {
    const rows = [
      sig(1, 'Nav Beacon', '2018-12-12T03:03:26Z'),
      sig(1, 'Nav Beacon', '2026-10-23T04:25:04Z'),
      sig(1, 'Nav Beacon', '2024-11-10T06:12:15Z'),
      sig(1, "Thagard's Progress", '2026-05-30T06:12:03Z', { isStation: true, signalType: 'StationCoriolis' }),
      sig(1, "Thagard's Progress", '2026-09-23T04:01:16Z', { isStation: false, signalType: 'StationCoriolis' }),
      sig(2, 'Nav Beacon', '2025-07-01T00:00:00Z'),
      sig(1, 'nav beacon', '2019-01-01T00:00:00Z', { signalType: 'Other' }), // different type: its own row
    ];
    const out = dedupeFssSignals(rows);
    expect(out).toHaveLength(4);
    const nav1 = out.find((s) => s.systemAddress === 1 && s.signalName === 'Nav Beacon' && s.signalType === '');
    expect(nav1.timestamp).toBe('2026-10-23T04:25:04Z');
    const thag = out.find((s) => s.signalName === "Thagard's Progress");
    expect(thag.timestamp).toBe('2026-09-23T04:01:16Z');
    expect(thag.isStation).toBe(true);
    expect(out.find((s) => s.systemAddress === 2).timestamp).toBe('2025-07-01T00:00:00Z');
  });
  it('is stable on an empty or already-unique list and drops rows without a system', () => {
    expect(dedupeFssSignals([])).toEqual([]);
    expect(dedupeFssSignals([sig(5, 'X', '2026-01-01T00:00:00Z')])).toHaveLength(1);
    expect(dedupeFssSignals([{ signalName: 'orphan', timestamp: '2026-01-01T00:00:00Z' }])).toEqual([]);
  });
});
