// The carrier ledger: journal transactions replayed from CarrierBuy, the docked-at-carrier bracket
// (a transfer anywhere else is the SRV's business), your own buys/sells against the carrier market,
// tritium to the tank, CarrierStats as the total, and the market read reconciling sell orders.
// Temp dirs throughout — the live ledger and journals are never touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initCarrierLedger, ensureCarrierLedger, noteCarrierEvent, reconcileCarrierMarket, getCarrierInventory, carrierCargoRecord, keyOf, setCarrierBaseline,
} from '../server/journal/carrierLedger.js';

const CID = 555;
const CS = 'TST-1';
const line = (o) => JSON.stringify(o) + '\n';
let app; let jd;

beforeAll(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-cl-'));
  jd = path.join(app, 'journals');
  fs.mkdirSync(jd);
  fs.writeFileSync(path.join(jd, 'Journal.2025-07-28T060000.01.log'), [
    { timestamp: '2025-07-28T06:38:02Z', event: 'CarrierBuy', CarrierID: CID, Location: 'L 190-21', Price: 5e9 },
    { timestamp: '2025-07-28T06:43:35Z', event: 'CarrierStats', CarrierID: CID, Callsign: CS, SpaceUsage: { TotalCapacity: 25000, Cargo: 0, FreeSpace: 21000 } },
    // Docked at the carrier: transfers count.
    { timestamp: '2025-07-28T07:00:00Z', event: 'Docked', StationName: CS, StationType: 'FleetCarrier', MarketID: CID },
    { timestamp: '2025-07-28T07:01:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'steel', Count: 100, Direction: 'tocarrier' }, { Type: 'thortveitite', Count: 50, Direction: 'tocarrier' }] },
    { timestamp: '2025-07-28T07:05:00Z', event: 'Undocked', StationName: CS, MarketID: CID },
    // Elsewhere: a transfer to the ship is the SRV's, a sale is to a station — neither is the carrier's.
    { timestamp: '2025-07-28T08:00:00Z', event: 'Docked', StationName: 'Some Port', StationType: 'Coriolis', MarketID: 999 },
    { timestamp: '2025-07-28T08:01:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'gold', Count: 5, Direction: 'toship' }] },
    { timestamp: '2025-07-28T08:02:00Z', event: 'MarketSell', MarketID: 999, Type: 'steel', Count: 10, SellPrice: 3000 },
    { timestamp: '2025-07-28T08:10:00Z', event: 'Undocked', StationName: 'Some Port', MarketID: 999 },
    // Back at the carrier, on a relog (Location, docked): buy from your own order, move ore off, fuel.
    { timestamp: '2025-07-29T01:00:00Z', event: 'LoadGame', Commander: 'Test' },
    { timestamp: '2025-07-29T01:00:05Z', event: 'Location', Docked: true, StationName: CS, StationType: 'FleetCarrier', MarketID: CID },
    { timestamp: '2025-07-29T01:01:00Z', event: 'MarketBuy', MarketID: CID, Type: 'steel', Count: 30, BuyPrice: 2000 },
    { timestamp: '2025-07-29T01:02:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'thortveitite', Count: 20, Direction: 'toship' }] },
    { timestamp: '2025-07-29T01:03:00Z', event: 'CarrierDepositFuel', CarrierID: CID, Amount: 10, Total: 500 },
    { timestamp: '2025-07-29T01:04:00Z', event: 'CarrierTradeOrder', CarrierID: CID, Commodity: 'steel', SaleOrder: 70, Price: 2500 },
    { timestamp: '2025-07-29T01:05:00Z', event: 'CarrierStats', CarrierID: CID, Callsign: CS, SpaceUsage: { TotalCapacity: 25000, Cargo: 100, FreeSpace: 20900 } },
  ].map(line).join(''));
  initCarrierLedger(app);
});
afterAll(() => { try { fs.rmSync(app, { recursive: true, force: true }); } catch { /* temp */ } });

describe('carrier ledger', () => {
  it('replays the journals into exact balances, bracketed by being docked at the carrier', () => {
    const r = ensureCarrierLedger({ journalDir: jd, carrierId: CID, callsign: CS });
    expect(r.ready).toBe(true);
    const inv = getCarrierInventory();
    const by = Object.fromEntries(inv.items.map((i) => [i.commodityId, i]));
    expect(by.thortveitite.count).toBe(30);     // 50 − 20 moved to the ship — ore, exact
    expect(by.thortveitite.basis).toBe('ledger');
    expect(by.thortveitite.atLeast).toBe(false);
    expect(by.gold).toBeUndefined();            // the transfer at Some Port was not the carrier's
    // Steel went on a SELL order and no market read has anchored it: 70 on the ledger, but visitors
    // could have bought any of it without a journal line — so it is named, not counted.
    expect(by.steel).toBeUndefined();
    expect(inv.unknown).toEqual([{ commodityId: 'steel', name: 'Steel', qty: 70, ordered: 'sell' }]);
    expect(inv.negatives).toEqual([{ commodityId: 'tritium', name: 'Tritium', qty: -10 }]); // fuel from cargo it never saw arrive
    expect(inv.stats.total).toBe(100);
    expect(inv.itemised).toBe(30);
    expect(inv.unaccounted).toBe(70);
    expect(inv.since).toBe('2025-07-28T07:01:00Z');
  });

  it('a second pass and a live repeat of the same event add nothing', () => {
    expect(ensureCarrierLedger({ journalDir: jd, carrierId: CID, callsign: CS }).txs).toBe(getCarrierInventory().txCount);
    const before = getCarrierInventory().txCount;
    noteCarrierEvent({ timestamp: '2025-07-29T01:00:05Z', event: 'Location', Docked: true, MarketID: CID });
    expect(noteCarrierEvent({ timestamp: '2025-07-29T01:02:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'thortveitite', Count: 20, Direction: 'toship' }] })).toBe(false);
    expect(getCarrierInventory().txCount).toBe(before);
  });

  it('the market read reconciles a sell order and notes a buy order; the remainder is stated, not hidden', () => {
    const changed = reconcileCarrierMarket([
      { name: '$steel_name;', nameLocalised: 'Steel', stock: 65, demand: 0, buyPrice: 2500 },     // a visitor bought 5 t — the journal never saw it
      { name: '$gold_name;', nameLocalised: 'Gold', stock: 0, demand: 200, sellPrice: 40000 },    // a buy order; fills are invisible
    ], '2025-07-29T02:00:00Z');
    expect(changed).toBe(true);
    const inv = getCarrierInventory();
    const by = Object.fromEntries(inv.items.map((i) => [i.commodityId, i]));
    expect(by.steel.count).toBe(65);            // anchored by the read: counted again
    expect(by.steel.basis).toBe('market');
    expect(inv.unknown).toEqual([]);
    expect(by.gold).toBeUndefined();
    expect(inv.recent[0]).toMatchObject({ kind: 'reconcile', c: 'steel', d: -5 });
    expect(inv.unaccounted).toBe(5);            // 100 aboard per the game, 95 itemised
    expect(reconcileCarrierMarket([{ name: '$steel_name;', nameLocalised: 'Steel', stock: 65, demand: 0 }], '2025-07-29T02:00:00Z')).toBe(false);
  });

  it('a live transfer moves the balance at once, and the record carries the ledger', () => {
    expect(noteCarrierEvent({ timestamp: '2025-07-29T03:00:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'gold', Type_Localised: 'Gold', Count: 40, Direction: 'tocarrier' }] })).toBe(true);
    const rec = carrierCargoRecord();
    const gold = rec.items.find((i) => i.commodityId === 'gold');
    expect(gold.count).toBe(40);
    expect(gold.ordered).toBe('buy');
    expect(gold.atLeast).toBe(true);            // a buy order: visitors may have added more
    expect(rec.ledger.itemised).toBe(135);
    expect(rec.ledger.unaccounted).toBe(-35);   // ahead of the game's last total until the next CarrierStats
    expect(rec.isEstimate).toBe(true);
    expect(noteCarrierEvent({ timestamp: '2025-07-29T03:05:00Z', event: 'CarrierStats', CarrierID: CID, Callsign: CS, SpaceUsage: { TotalCapacity: 25000, Cargo: 135, FreeSpace: 20865 } })).toBe(true);
    expect(carrierCargoRecord().ledger.unaccounted).toBe(0);
  });

  it('rebuilds the same balances from the file alone, and keys journal names like the rest of the app', () => {
    const before = getCarrierInventory();
    initCarrierLedger(app);
    const after = getCarrierInventory();
    expect(after.items).toEqual(before.items);
    expect(after.stats.total).toBe(135);
    expect(after.txCount).toBe(before.txCount);
    expect(keyOf('$lowtemperaturediamond_name;')).toBe('lowtemperaturediamond');
    expect(keyOf('CMMComposite')).toBe('cmmcomposite');
  });

  it('a baseline typed by the commander anchors what the journal cannot count, and survives a restart', () => {
    // Titanium: sold once (a sell order), never anchored — named, not counted.
    noteCarrierEvent({ timestamp: '2025-07-30T01:00:00Z', event: 'CarrierTradeOrder', CarrierID: CID, Commodity: 'titanium', Commodity_Localised: 'Titanium', SaleOrder: 200, Price: 900 });
    expect(getCarrierInventory().unknown.map((u) => u.commodityId)).toEqual(['titanium']);
    expect(setCarrierBaseline('Titanium', 120, '2025-07-30T02:00:00Z', 'Titanium')).toMatchObject({ commodityId: 'titanium', count: 120, basis: 'you' });
    let inv = getCarrierInventory();
    expect(inv.unknown).toEqual([]);
    expect(inv.items.find((i) => i.commodityId === 'titanium')).toMatchObject({ count: 120, basis: 'you' });
    expect(inv.recent[0]).toMatchObject({ kind: 'baseline', c: 'titanium', d: 120 });
    // A correction to something already counted, and "none aboard".
    expect(setCarrierBaseline('steel', 60, '2025-07-30T02:01:00Z')).toMatchObject({ count: 60 });
    expect(setCarrierBaseline('gold', 0, '2025-07-30T02:02:00Z')).toMatchObject({ count: 0 });
    inv = getCarrierInventory();
    expect(inv.items.find((i) => i.commodityId === 'steel')).toMatchObject({ count: 60, basis: 'you' });
    expect(inv.items.find((i) => i.commodityId === 'gold')).toBeUndefined();
    expect(setCarrierBaseline('steel', -1)).toBeNull();
    expect(setCarrierBaseline('', 5)).toBeNull();
    // Everything moved afterwards applies on top; a restart rebuilds it all from the file.
    noteCarrierEvent({ timestamp: '2025-07-30T03:00:00Z', event: 'Docked', MarketID: CID });
    noteCarrierEvent({ timestamp: '2025-07-30T03:01:00Z', event: 'CargoTransfer', Transfers: [{ Type: 'titanium', Count: 20, Direction: 'toship' }] });
    const before = getCarrierInventory();
    expect(before.items.find((i) => i.commodityId === 'titanium').count).toBe(100);
    initCarrierLedger(app);
    const after = getCarrierInventory();
    expect(after.items).toEqual(before.items);
    expect(after.unknown).toEqual([]);
  });
});
