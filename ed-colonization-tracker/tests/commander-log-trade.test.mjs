// Trading and hauling on a sitting's line (1.61.1): tonnes delivered to builds, moved to the carrier,
// bought and sold with the profit — and trades at your OWN carrier are stock moves, not trade.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJournalEvents, buildCommanderLog, sittingSummary } from '../server/journal/commanderLog.js';

const T = (h, m = 0) => `2026-10-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const MY_FC = 3700000101;
let log;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-trade-'));
  const ev = [
    { timestamp: T(1, 0), event: 'LoadGame', Ship: 'type8' },
    { timestamp: T(1, 1), event: 'Location', StarSystem: 'Home', Docked: true, StationName: "Thagard's Progress" },
    { timestamp: T(1, 5), event: 'MarketBuy', MarketID: 11, Type: 'silver', Count: 384, BuyPrice: 34017, TotalCost: 13062528 },
    { timestamp: T(1, 20), event: 'MarketSell', MarketID: 12, Type: 'silver', Count: 384, SellPrice: 40742, TotalSale: 15644928, AvgPricePaid: 34017 },
    { timestamp: T(1, 30), event: 'MarketSell', MarketID: 12, Type: 'bromellite', Count: 10, SellPrice: 100000, TotalSale: 1000000, AvgPricePaid: 0 }, // mined
    { timestamp: T(1, 40), event: 'MarketBuy', MarketID: MY_FC, Type: 'steel', Count: 500, BuyPrice: 1, TotalCost: 500 }, // own carrier: a stock move
    { timestamp: T(1, 50), event: 'CargoTransfer', Transfers: [{ Type: 'steel', Count: 700, Direction: 'tocarrier' }, { Type: 'cmm', Count: 100, Direction: 'toship' }] },
    { timestamp: T(2, 0), event: 'ColonisationContribution', MarketID: 13, Contributions: [{ Name: '$Aluminium_name;', Amount: 533 }, { Name: '$Steel_name;', Amount: 200 }] },
    { timestamp: T(2, 30), event: 'Shutdown' },
  ];
  fs.writeFileSync(path.join(dir, 'Journal.2026-10-20T010000.01.log'), ev.map((o) => JSON.stringify(o)).join('\n') + '\n');
  log = buildCommanderLog({ events: readJournalEvents(dir), state: { settings: { myFleetCarrierMarketId: MY_FC } } });
});

describe('trading and hauling on the sitting line', () => {
  it('counts deliveries, carrier loads, buys and sells with the profit — own-carrier trades left out', () => {
    const s = log.sittings[0];
    expect(s).toMatchObject({ bought: 384, sold: 394, delivered: 733, toCarrier: 700 });
    expect(s.profit).toBe((15644928 - 34017 * 384) + 1000000);
    expect(sittingSummary(s)).toBe('733 t delivered to builds · 700 t to the carrier · 384 t bought · 394 t sold, +3.6M cr');
  });
});
