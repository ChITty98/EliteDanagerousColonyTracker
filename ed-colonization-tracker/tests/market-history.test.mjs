// market-history.jsonl: movers-only market rows, one Ardent sample a day, a year of retention,
// and the commander's own sales from the journals. Everything runs in a temp dir — never the
// live file beside the exe.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initMarketHistory, recordMarketRead, recordArdentSample, needsSample, seriesFor, backfillSales, historyStats, sampleKeys, keyOf } from '../server/journal/marketHistory.js';

const DAY = 86400e3;
const NOW = Date.parse('2026-09-04T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
let dir;

const market = (at, sell = 240547, extra = {}) => ({
  marketId: 4365774083, stationName: 'Atmo Sky Cairn Asc', systemName: 'Col 173 Sector AX-J d9-52', stationType: 'CraterOutpost', timestamp: at,
  items: [
    { name: '$thortveitite_name;', nameLocalised: 'Thortveitite', sellPrice: sell, demand: 23859, buyPrice: 0, stock: 0, meanPrice: 129763 },
    { name: '$steel_name;', nameLocalised: 'Steel', sellPrice: 0, demand: 0, buyPrice: 2100, stock: 5000, meanPrice: 2400 },
    { name: '$gold_name;', nameLocalised: 'Gold', sellPrice: 0, demand: 0, buyPrice: 0, stock: 0, meanPrice: 45000 }, // neither side — skipped
    ...(extra.items || []),
  ],
});

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-hist-')); initMarketHistory(dir, { now: NOW }); });

describe('market history', () => {
  it('writes movers and first-of-day rows only, and the journal spelling joins the table spelling', () => {
    expect(recordMarketRead(market(iso(NOW)), NOW)).toBe(2);              // thortveitite sell + steel buy
    expect(recordMarketRead(market(iso(NOW + 3600e3)), NOW)).toBe(0);     // same day, same prices
    expect(recordMarketRead(market(iso(NOW + 7200e3), 250000), NOW)).toBe(1); // thortveitite moved
    expect(recordMarketRead(market(iso(NOW + DAY)), NOW)).toBe(2);        // new day, both again
    const s = seriesFor(['Thortveitite'], NOW + DAY);
    expect(Object.keys(s)).toEqual(['thortveitite']);
    expect(s.thortveitite.days.length).toBe(2);
    expect(s.thortveitite.days[0].best).toBe(250000); // the day's high
    expect(s.thortveitite.days[0].mean).toBe(129763);
    expect(s.thortveitite.days[0].bestSt).toBe('Atmo Sky Cairn Asc');
    expect(keyOf('Low Temp. Diamonds')).toBe('lowtemperaturediamond');
  });

  it('samples Ardent once a day, carrier rows excluded, and the daily set carries the surface commodities', () => {
    const rows = [
      { commodityName: 'thortveitite', stationName: 'Fat Carrier', stationType: 'FleetCarrier', sellPrice: 2000000, demand: 500 },
      { commodityName: 'thortveitite', stationName: "TolaGarf's Junkyard", systemName: 'Kojeara', stationType: 'Outpost', sellPrice: 894814, demand: 18576, meanPrice: 129763 },
      { commodityName: 'thortveitite', stationName: 'Borel Vista', systemName: 'Synuefe YL-J d10-60', stationType: 'Orbis', sellPrice: 327007, demand: 254520 },
      { commodityName: 'thortveitite', stationName: 'Nowhere', stationType: 'Outpost', sellPrice: 300000, demand: 0 }, // no demand
    ];
    expect(needsSample('thortveitite', NOW)).toBe(true);
    expect(recordArdentSample('thortveitite', rows, NOW)).toBe(true);
    expect(recordArdentSample('thortveitite', rows, NOW + 3600e3)).toBe(false);
    expect(needsSample('thortveitite', NOW + 3600e3)).toBe(false);
    expect(recordArdentSample('thortveitite', rows, NOW + DAY)).toBe(true);
    const day = seriesFor(['thortveitite'], NOW).thortveitite.days[0];
    expect(day.galaxy).toBe(894814);
    expect(day.galaxySt).toBe("TolaGarf's Junkyard");
    expect(day.med).toBe(327007);
    expect(day.mean).toBe(129763);
    expect(sampleKeys()).toContain('periclasedunite');
    expect(sampleKeys(['Low Temp. Diamonds'])).toContain('lowtemperaturediamond');
  });

  it('survives a restart, prunes anything older than a year, and keeps the meta line', () => {
    recordMarketRead(market(iso(NOW)), NOW);
    fs.appendFileSync(path.join(dir, 'market-history.jsonl'), JSON.stringify({ k: 'm', at: iso(NOW - 400 * DAY), mid: 1, st: 'Old', sys: 'Old', c: 'gold', n: 'Gold', sell: 1, dem: 1, buy: 0, stk: 0, mean: 0 }) + '\n');
    const h = initMarketHistory(dir, { now: NOW });
    expect(h.records).toBe(2);
    expect(h.pruned).toBe(1);
    expect(recordMarketRead(market(iso(NOW)), NOW)).toBe(0); // the reloaded index still knows today's rows
    const text = fs.readFileSync(path.join(dir, 'market-history.jsonl'), 'utf8');
    expect(text.split('\n')[0]).toContain('"k":"meta"');
    expect(text).not.toContain('"Old"');
  });

  it('backfills the commander\'s own sales from the last year of journals, idempotently', () => {
    const jd = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-journal-'));
    const lines = [
      { timestamp: iso(NOW - 10 * DAY), event: 'MarketSell', MarketID: 1, Type: 'palladium', Count: 18, SellPrice: 58411, TotalSale: 1051398 },
      { timestamp: iso(NOW - 20 * DAY), event: 'MarketBuy', MarketID: 2, Type: 'steel', Count: 100, BuyPrice: 2100, TotalCost: 210000 },
      { timestamp: iso(NOW - 700 * DAY), event: 'MarketSell', MarketID: 1, Type: 'gold', Count: 1, SellPrice: 40000 }, // too old
      { timestamp: iso(NOW - 5 * DAY), event: 'Docked', StationName: 'x' },
    ];
    fs.writeFileSync(path.join(jd, 'Journal.2026-08-25T120000.01.log'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(backfillSales(jd, NOW)).toBe(2);
    expect(backfillSales(jd, NOW)).toBe(0);
    const s = seriesFor(['palladium', 'steel'], NOW);
    expect(s.palladium.days[0].sale).toBe(58411);
    expect(s.steel.days[0].buy).toBe(2100);
    const st = historyStats();
    expect(st.s).toBe(2);
    expect(st.salesScannedThrough).toBeTruthy();
    // A restart re-reads the meta line and does not re-add.
    initMarketHistory(dir, { now: NOW, journalDir: jd });
    expect(historyStats().s).toBe(2);
  });
});
