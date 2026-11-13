// Where to trade a material: the trader kind follows the station's economy; the nearest stations come
// from Spansh (three per kind, cached) with the stations you have docked at as the offline answer.
// A fake fetch stands in for Spansh.
import { describe, it, expect, beforeEach } from 'vitest';
import { traderTypeForEconomy, spanshNearestTraders, knownNearestTraders, _clearTraderCache } from '../server/journal/materialTraders.js';

const row = (name, system, ly, econ, ls = 100) => ({ name, system_name: system, distance: ly, distance_to_arrival: ls, primary_economy: econ, type: 'Coriolis Starport', large_pads: 6, medium_pads: 11 });

describe('material traders', () => {
  beforeEach(() => _clearTraderCache());

  it('types a trader by the station economy', () => {
    expect(traderTypeForEconomy('Extraction')).toBe('raw');
    expect(traderTypeForEconomy('Refinery')).toBe('raw');
    expect(traderTypeForEconomy('Industrial')).toBe('manufactured');
    expect(traderTypeForEconomy('High Tech')).toBe('encoded');
    expect(traderTypeForEconomy('Military')).toBe('encoded');
    expect(traderTypeForEconomy('Colony')).toBeNull();
  });

  it('keeps the three nearest of each kind, in order, and caches the answer', async () => {
    let calls = 0;
    let sent = null;
    const fetchImpl = async (url, init) => {
      calls++; sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ results: [
        row('Betancourt Base', 'Musca Dark Region PJ-P b6-1', 634.44, 'Extraction', 172),
        row('Cole Point', 'Coalsack Sector VU-O b6-6', 656.1, 'Extraction'),
        row('Bering port', 'Coalsack Sector KN-S b4-9', 657.8, 'Extraction'),
        row('Shunkai Orbital', 'HIP 31666', 815.3, 'Extraction'),
        row('Salam Orbital', 'Nijolam', 823.2, 'Industrial', 234),
        row('Somewhere', 'X', 830, 'Colony'),
        row('Greenstein Vision', 'HIP 23046', 848.2, 'High Tech', 3331),
      ] }) };
    };
    const r = await spanshNearestTraders('Col 173 Sector AX-J d9-52', { fetchImpl, now: 1000 });
    expect(sent.services || sent.filters.services).toEqual([{ name: 'Material Trader' }]);
    expect(sent.reference_system).toBe('Col 173 Sector AX-J d9-52');
    expect(r.traders.raw.map((t) => t.station)).toEqual(['Betancourt Base', 'Cole Point', 'Bering port']);
    expect(r.traders.raw[0]).toMatchObject({ system: 'Musca Dark Region PJ-P b6-1', ly: 634.4, ls: 172 });
    expect(r.traders.manufactured.map((t) => t.station)).toEqual(['Salam Orbital']);
    expect(r.traders.encoded.map((t) => t.station)).toEqual(['Greenstein Vision']);
    const again = await spanshNearestTraders('col 173 sector ax-j d9-52', { fetchImpl, now: 2000 });
    expect(again.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it('a Spansh failure is an error, not an empty answer', async () => {
    await expect(spanshNearestTraders('X', { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow(/503/);
  });

  it('offline: the nearest stations you have docked at, typed by their main economy', () => {
    const state = {
      knownSystems: { A: { systemName: 'A', coordinates: { x: 10, y: 0, z: 0 } }, B: { systemName: 'B', coordinates: { x: 100, y: 0, z: 0 } } },
      knownStations: {
        a: { stationName: 'Near Works', systemName: 'A', stationType: 'Coriolis', services: ['dock', 'materialtrader'], economies: [{ nameLocalised: 'Industrial', proportion: 1.2 }, { nameLocalised: 'Extraction', proportion: 0.3 }], distFromStarLS: 50 },
        b: { stationName: 'Far Works', systemName: 'B', stationType: 'Coriolis', services: ['materialtrader'], economies: [{ nameLocalised: 'Industrial', proportion: 1 }], distFromStarLS: 9 },
        c: { stationName: 'No Trader', systemName: 'A', stationType: 'Coriolis', services: ['dock'], economies: [{ nameLocalised: 'Refinery', proportion: 1 }] },
        d: { stationName: 'XYZ-123', systemName: 'A', stationType: 'FleetCarrier', services: ['materialtrader'], economies: [{ nameLocalised: 'Refinery', proportion: 1 }] },
      },
    };
    const k = knownNearestTraders(state, { x: 0, y: 0, z: 0 });
    expect(k.manufactured).toMatchObject({ station: 'Near Works', system: 'A', ly: 10, ls: 50 });
    expect(k.raw).toBeNull();
    expect(k.encoded).toBeNull();
  });
});
