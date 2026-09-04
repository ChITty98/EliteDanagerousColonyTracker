// The one price the surface-mining page shows is "what your best market pays" — but only a market
// you opened recently counts. This pins the freshness rule and the journal↔table spelling join.
// Pure in-memory state: nothing here touches colony-data.json or market-means.json.
import { describe, it, expect } from 'vitest';
import { bestSellFromSnapshots, FRESH_MARKET_MS } from '../server/journal/marketMeans.js';

const DAY = 24 * 3600e3;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const stale = { stationName: 'Janes Horizons', systemName: 'Far Away', updatedAt: ago(120 * DAY), commodities: [
  { name: 'Grandidierite', commodityId: 'grandidierite', sellPrice: 477188, demand: 100 },
] };
const fresh = { stationName: 'Atmo Sky Cairn Asc', systemName: 'Home', updatedAt: ago(1 * DAY), commodities: [
  { name: 'Grandidierite', commodityId: 'grandidierite', sellPrice: 240000, demand: 50 },
  { name: 'Thortveitite', commodityId: 'thortveitite', sellPrice: 240547, demand: 5 },
  { name: 'Low Temperature Diamonds', commodityId: 'lowtemperaturediamond', sellPrice: 150000, demand: 9 },
  { name: 'Ruby', commodityId: 'ruby', sellPrice: 0, buyPrice: 70000, stock: 12 }, // sold here, not bought
] };
const state = { marketSnapshots: { 1: stale, 2: fresh } };

describe('best sell among your own markets', () => {
  it('a stale high price does not shadow a fresh real one', () => {
    const b = bestSellFromSnapshots(state, 'Grandidierite');
    expect(b?.price).toBe(240000);
    expect(b?.station).toBe('Atmo Sky Cairn Asc');
    expect(FRESH_MARKET_MS).toBe(30 * DAY);
  });

  it('nothing fresh → null, so the page falls back to the galactic average', () => {
    expect(bestSellFromSnapshots({ marketSnapshots: { 1: stale } }, 'Grandidierite')).toBeNull();
    expect(bestSellFromSnapshots(state, 'Grandidierite', 0)?.price).toBe(477188); // 0 = no cutoff
  });

  it('a Colonia snapshot is not a buyer while you are in the bubble — and vice versa', () => {
    const jaques = { stationName: 'Jaques Station', systemName: 'Colonia', updatedAt: ago(3 * DAY), commodities: [
      { name: 'Bromellite', commodityId: 'bromellite', sellPrice: 116126, demand: 50000 },
    ] };
    const kalian = { stationName: 'Kalian Port', systemName: 'Kalian', updatedAt: ago(2 * DAY), commodities: [
      { name: 'Bromellite', commodityId: 'bromellite', sellPrice: 40004, demand: 9000 },
    ] };
    const known = { colonia: { systemName: 'Colonia', coordinates: { x: -9530, y: -910, z: 19808 } }, kalian: { systemName: 'Kalian', coordinates: { x: 60, y: -20, z: 30 } } };
    const inBubble = { commanderPosition: { systemName: 'Sol', coordinates: { x: 0, y: 0, z: 0 } }, knownSystems: known, marketSnapshots: { 1: jaques, 2: kalian } };
    expect(bestSellFromSnapshots(inBubble, 'Bromellite')?.station).toBe('Kalian Port');
    expect(bestSellFromSnapshots(inBubble, 'Bromellite', FRESH_MARKET_MS, 0)?.station).toBe('Jaques Station'); // 0 = no reach cutoff
    const inColonia = { ...inBubble, commanderPosition: { systemName: 'Colonia', coordinates: known.colonia.coordinates } };
    expect(bestSellFromSnapshots(inColonia, 'Bromellite')?.station).toBe('Jaques Station');
    const noPosition = { ...inBubble, commanderPosition: null };
    expect(bestSellFromSnapshots(noPosition, 'Bromellite')?.station).toBe('Jaques Station'); // unknown distance passes
  });

  it('only real sell prices count, and the journal spelling joins the table spelling', () => {
    expect(bestSellFromSnapshots(state, 'Ruby')).toBeNull();
    expect(bestSellFromSnapshots(state, 'Low Temp. Diamonds')?.price).toBe(150000);
    expect(bestSellFromSnapshots(state, 'thortveitite')?.demand).toBe(5);
    expect(bestSellFromSnapshots({}, 'Thortveitite')).toBeNull();
  });
});
