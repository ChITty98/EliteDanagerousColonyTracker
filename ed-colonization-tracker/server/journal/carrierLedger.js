// server/journal/carrierLedger.js
//
// Carrier cargo, transactionally. The journal records every move the COMMANDER makes at their own
// carrier — CargoTransfer while docked at it, buys and sells against its market, tritium into the
// tank — so a replay from CarrierBuy is exact for anything nobody else can touch: mined ore, goods
// with no trade order. It is blind to other players trading against the carrier's orders; nothing
// is written when a visitor fills a buy order or buys from a sell order. Verified 2026-09-04 on
// the commander's own carrier: ore balances match to the tonne (Rhodplumsite 159 = 203 mined − 44
// on the ship); order-traded goods drift by tens of thousands of tonnes.
//
// Hence the hybrid: the ledger for everything; the carrier's own market read as the truth for what
// is on a sell order (stock = the order quantity — a reconcile line records the correction);
// CarrierStats, written at every dock and jump, as the total everything must add up to — and the
// remainder shown as "not itemised" rather than hidden. Append-only carrier-ledger.jsonl beside the
// exe, gitignored; the balances are rebuilt from it at boot and topped up from the journals.
import fs from 'node:fs';
import path from 'node:path';
import { findCommodityByJournalName, findCommodityByDisplayName } from './commodities.js';
import { canonicalCommodityName } from './commodityPricesMirror.js';

let FILE = null;
let ready = false;              // replay done for the current carrier
let carrierId = null;
let callsign = null;
let txs = [];
const seen = new Set();
let bal = new Map();            // key -> { qty, name, ordered: null|'buy'|'sell', basis: 'ledger'|'market', basisAt }
let atCarrier = false;
let stats = { total: null, free: null, capacity: null, at: null };
let meta = { carrierId: null, scannedThrough: null, since: null };
let lastEventAt = null;

const DAY_MS = 86400e3;
const EVENTS = /"event":"(CargoTransfer|CarrierStats|CarrierDepositFuel|CarrierBuy|CarrierTradeOrder|MarketBuy|MarketSell|Docked|Undocked|Location)"/;

// One key for a commodity however it is written: the journal's `$microcontrollers_name;`, its bare
// `microcontrollers`, and the display name "Micro Controllers" all land on the same entry — which
// is what lets a baseline typed from the carrier's own screen meet the transfers the journal saw.
//
// For eight commodities the game's internal id is simply a different word from the one on screen,
// so no amount of normalising joins them. Found by listing every id in the commander's own ledger
// that matches no known display name (2026-09-04); the game is the authority, not a guess.
const ID_ALIAS = {
  drones: 'limpet',
  coolinghoses: 'microweavecoolinghoses',
  terrainenrichmentsystems: 'landenrichmentsystems',
  mutomimager: 'muonimager',
  hazardousenvironmentsuits: 'hesuits',
  watersofshintara: 'thewatersofshintara',
  bluemilk: 'lavianbrandy',
  heliostaticfurnaces: 'microbialfurnaces',
  marinesupplies: 'marineequipment',
  atmosphericextractors: 'atmosphericprocessors',
  basicnarcotics: 'narcotics',
  hydrogenfuels: 'hydrogenfuel',
};
export const keyOf = (t) => {
  const k = String(t || '')
    .toLowerCase()
    .replace(/^\$/, '')
    .replace(/_name;$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (/^lowtemp.*diamonds?$/.test(k)) return 'lowtemperaturediamond';
  return ID_ALIAS[k] || k;
};
const nameOf = (k, localised) => localised || (findCommodityByJournalName(`$${k}_name;`) || {}).name || canonicalCommodityName(k);

function reset() {
  ready = false; txs = []; seen.clear(); bal = new Map(); atCarrier = false;
  stats = { total: null, free: null, capacity: null, at: null };
  meta = { carrierId: null, scannedThrough: null, since: null };
  lastEventAt = null;
}

/** Point the ledger at its file and rebuild the balances from it. Cheap; the replay comes later. */
export function initCarrierLedger(appDir) {
  FILE = path.join(appDir, 'carrier-ledger.jsonl');
  reset();
  let raw = '';
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { return { records: 0 }; }
  let n = 0;
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    n += 1;
    if (r.k === 'meta') { meta = { carrierId: r.carrierId ?? null, scannedThrough: r.scannedThrough ?? null, since: r.since ?? null }; carrierId = meta.carrierId; continue; }
    if (r.k === 'stats') { stats = { total: r.total ?? null, free: r.free ?? null, capacity: r.capacity ?? null, at: r.at }; continue; }
    if (r.k === 'order') { noteOrder(r.at, keyOf(r.c), r.side, r.n, false); continue; }
    if (r.k === 'anchor') { const b = entry(keyOf(r.c), r.n || null); b.basis = r.basis || 'you'; b.basisAt = r.at; continue; }
    if (r.k === 'tx') applyTx(r, false);
  }
  return { records: n };
}

function append(r) {
  if (!FILE) return;
  try { fs.appendFileSync(FILE, JSON.stringify(r) + '\n', 'utf8'); } catch { /* non-fatal */ }
}
function rewrite() {
  if (!FILE) return;
  const lines = [JSON.stringify({ k: 'meta', ...meta })];
  // Order history matters as flags (ever sold / ever bought), not just the current side.
  const orders = [];
  for (const [c, b] of bal.entries()) {
    if (b.soldEver) orders.push(JSON.stringify({ k: 'order', at: b.orderedAt || meta.scannedThrough, c, side: 'sell', n: b.name }));
    if (b.boughtEver) orders.push(JSON.stringify({ k: 'order', at: b.orderedAt || meta.scannedThrough, c, side: 'buy', n: b.name }));
    if (b.ordered !== 'sell' && b.ordered !== 'buy' && (b.soldEver || b.boughtEver)) orders.push(JSON.stringify({ k: 'order', at: b.orderedAt || meta.scannedThrough, c, side: 'cancel', n: b.name }));
    else if (b.ordered && (b.ordered === 'buy' ? b.soldEver : b.boughtEver)) orders.push(JSON.stringify({ k: 'order', at: b.orderedAt || meta.scannedThrough, c, side: b.ordered, n: b.name }));
    if (b.basis === 'you') orders.push(JSON.stringify({ k: 'anchor', at: b.basisAt, c, basis: 'you', n: b.name }));
  }
  for (const t of txs) lines.push(JSON.stringify(t));
  lines.push(...orders);
  if (stats.at) lines.push(JSON.stringify({ k: 'stats', ...stats }));
  try { fs.writeFileSync(FILE, lines.join('\n') + '\n', 'utf8'); } catch { /* non-fatal */ }
}

// soldEver / boughtEver: whether the commodity has EVER been on a sell / buy order. A sell order
// lets visitors take cargo the journal never sees leave, so the ledger overstates it — only a
// market read (stock on the order) can anchor it. A buy order lets visitors add cargo the journal
// never sees arrive, so the ledger understates it — a lower bound. Neither ever happens to ore.
function entry(c, localised) {
  let b = bal.get(c);
  if (!b) { b = { qty: 0, name: nameOf(c, localised), ordered: null, orderedAt: null, soldEver: false, boughtEver: false, basis: 'ledger', basisAt: null }; bal.set(c, b); }
  else if (localised && !b.name) b.name = localised;
  return b;
}

function applyTx(r, write = true) {
  if (!r || !r.c || !Number.isFinite(r.d) || r.d === 0) return false;
  // Records written before the aliases were known carry the game's raw id (`drones`,
  // `mutomimager`); normalise on the way in so old and new land on the same balance.
  r.c = keyOf(r.c);
  const id = `${r.at}|${r.kind}|${r.c}|${r.d}`;
  if (seen.has(id)) return false;
  seen.add(id);
  txs.push(r);
  const b = entry(r.c, r.n);
  b.qty += r.d;
  if (r.kind === 'reconcile') { b.basis = 'market'; b.basisAt = r.at; }
  if (r.kind === 'baseline') { b.basis = 'you'; b.basisAt = r.at; }
  if (!meta.since || r.at < meta.since) meta.since = r.at;
  if (write) append(r);
  return true;
}

function noteOrder(at, key, side, localised, write = true) {
  const c = keyOf(key);
  const b = entry(c, localised);
  b.ordered = side === 'cancel' ? null : side;
  b.orderedAt = at;
  if (side === 'sell') b.soldEver = true;
  if (side === 'buy') b.boughtEver = true;
  if (write) append({ k: 'order', at, c, side, n: b.name });
}

const isMine = (e) => (carrierId != null && e.CarrierID === carrierId) || (callsign && e.Callsign === callsign);

/**
 * One journal event. Returns true when a balance, an order or the game's total changed. Safe to
 * call with everything the parser saw — it picks the events that move cargo at YOUR carrier —
 * and safe to call twice with the same event: a transaction is keyed by time, kind, commodity
 * and amount, so replay and live feed cannot double-count each other.
 */
export function noteCarrierEvent(e) {
  if (!e || !e.event) return false;
  let changed = false;
  switch (e.event) {
    case 'CarrierBuy':
      if (e.CarrierID && !carrierId) carrierId = e.CarrierID;
      break;
    case 'CarrierStats':
      if (isMine(e)) {
        if (!carrierId && e.CarrierID) carrierId = e.CarrierID;
        if (!callsign && e.Callsign) callsign = e.Callsign;
        const s = e.SpaceUsage || {};
        if (stats.at !== e.timestamp) {
          stats = { total: s.Cargo ?? null, free: s.FreeSpace ?? null, capacity: s.TotalCapacity ?? null, at: e.timestamp };
          append({ k: 'stats', ...stats });
          changed = true;
        }
      }
      break;
    case 'Docked': atCarrier = carrierId != null && e.MarketID === carrierId; break;
    case 'Location': atCarrier = !!e.Docked && carrierId != null && e.MarketID === carrierId; break;
    case 'Undocked': atCarrier = false; break;
    case 'CargoTransfer':
      if (atCarrier) {
        for (const t of e.Transfers || []) {
          const d = t.Direction === 'tocarrier' ? (t.Count || 0) : t.Direction === 'toship' ? -(t.Count || 0) : 0;
          if (d && applyTx({ k: 'tx', at: e.timestamp, kind: 'transfer', c: keyOf(t.Type), n: t.Type_Localised || null, d })) changed = true;
        }
      }
      break;
    case 'MarketBuy':
      if (carrierId != null && e.MarketID === carrierId && applyTx({ k: 'tx', at: e.timestamp, kind: 'buy', c: keyOf(e.Type), n: e.Type_Localised || null, d: -(e.Count || 0) })) changed = true;
      break;
    case 'MarketSell':
      if (carrierId != null && e.MarketID === carrierId && applyTx({ k: 'tx', at: e.timestamp, kind: 'sell', c: keyOf(e.Type), n: e.Type_Localised || null, d: e.Count || 0 })) changed = true;
      break;
    case 'CarrierDepositFuel':
      // NOT a cargo movement. Tritium leaves the carrier as an ordinary transfer to the ship and
      // goes in the tank from there, so those tonnes are already accounted for; subtracting the
      // deposit as well counted them twice. Measured on the commander's own carrier: 5,766 t
      // transferred aboard, 4,220 t back to the ship = 1,546, against 1,456 really there — while
      // subtracting the 5,566 t of deposits drove the ledger to −4,020. Kept in the event set
      // only so the carrier's id can be learned from it.
      if (isMine(e) && !carrierId && e.CarrierID) carrierId = e.CarrierID;
      break;
    case 'CarrierTradeOrder':
      if (isMine(e) && e.Commodity) {
        noteOrder(e.timestamp, keyOf(e.Commodity), e.CancelTrade ? 'cancel' : (e.PurchaseOrder > 0 ? 'buy' : 'sell'), e.Commodity_Localised || null);
        changed = true;
      }
      break;
    default: break;
  }
  if (typeof e.timestamp === 'string' && (!lastEventAt || e.timestamp > lastEventAt)) lastEventAt = e.timestamp;
  return changed;
}

/**
 * Replay the journals — everything since the carrier was bought the first time, then only the files
 * newer than the last pass (re-read whole, so the docked bracket is always established from the
 * file's own login). Idempotent. No-op once done for the current carrier.
 */
export function ensureCarrierLedger({ journalDir, carrierId: id, callsign: cs } = {}) {
  if (cs) callsign = cs;
  if (id && !carrierId) carrierId = id;
  if (ready) return { ready: true, txs: txs.length };
  if (!journalDir || (!carrierId && !callsign)) return { ready: false, txs: txs.length };
  if (meta.carrierId && id && meta.carrierId !== id) { // a different carrier: this ledger is not its history
    try { fs.unlinkSync(FILE); } catch { /* none yet */ }
    reset(); carrierId = id; callsign = cs || null;
  }
  const sinceMs = meta.scannedThrough ? Date.parse(meta.scannedThrough) - DAY_MS : 0;
  let files;
  try { files = fs.readdirSync(journalDir).filter((f) => /^Journal.*\.log$/i.test(f)).sort(); } catch { files = []; }
  let scanned = 0;
  for (const f of files) {
    const p = path.join(journalDir, f);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.mtimeMs < sinceMs) continue;
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (!EVENTS.test(text)) continue;
    scanned += 1;
    for (const l of text.split('\n')) {
      if (!l || !EVENTS.test(l)) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      noteCarrierEvent(e);
    }
  }
  meta.carrierId = carrierId;
  if (lastEventAt) meta.scannedThrough = lastEventAt;
  rewrite();
  ready = true;
  return { ready: true, txs: txs.length, files: scanned };
}

/**
 * The carrier's own market read (Market.json at the carrier). Stock on a sell order is the game
 * stating what is on that order; the ledger takes it as truth and writes the correction as a
 * reconcile line — the thing that absorbs visitors' trades the journal never saw. A buy order is
 * noted (its fills are invisible until the goods are moved or listed). Returns true on change.
 */
export function reconcileCarrierMarket(items, at) {
  let changed = false;
  const when = at || new Date().toISOString();
  for (const it of items || []) {
    if (!it) continue;
    const c = keyOf(it.name);
    if (!c) continue;
    if (it.stock > 0) {
      const b = entry(c, it.nameLocalised || null);
      if (b.qty !== it.stock) { if (applyTx({ k: 'tx', at: when, kind: 'reconcile', c, n: b.name, d: it.stock - b.qty })) changed = true; }
      if (b.basis !== 'market') { b.basis = 'market'; b.basisAt = when; changed = true; }
      if (b.ordered !== 'sell') { noteOrder(when, c, 'sell', b.name); changed = true; }
    } else if (it.demand > 0) {
      const b = entry(c, it.nameLocalised || null);
      if (b.ordered !== 'buy') { noteOrder(when, c, 'buy', b.name); changed = true; }
    }
  }
  return changed;
}

/**
 * What can honestly be itemised:
 *   - never on any order → the ledger, exact;
 *   - ever on a SELL order → only from a market read that anchored it (stock on the order), plus
 *     your own moves since; never anchored → unknown, listed by name, not counted;
 *   - on BUY orders only → the ledger as a lower bound ("at least"), since fills are invisible.
 * The game's CarrierStats total minus the itemised tonnes is what none of that accounts for.
 */
export function getCarrierInventory() {
  const items = []; const unknown = []; const negatives = [];
  for (const [c, b] of bal.entries()) {
    const name = b.name || nameOf(c);
    if (b.soldEver && b.basis === 'ledger') { if (b.qty !== 0 || b.ordered) unknown.push({ commodityId: c, name, qty: Math.round(b.qty), ordered: b.ordered }); continue; }
    if (b.qty < 0) { negatives.push({ commodityId: c, name, qty: Math.round(b.qty) }); continue; }
    if (b.qty <= 0) continue;
    // Projects and the Fleet Carrier page key on the colonisation dictionary's id, which for a few
    // commodities is not the journal's (the game says terrainenrichmentsystems; the dictionary says
    // landenrichmentsystems). Resolve by journal name, then by display name; the journal key otherwise.
    const def = findCommodityByJournalName(`$${c}_name;`) || findCommodityByDisplayName(name);
    items.push({ commodityId: def ? def.id : c, name, count: Math.round(b.qty), ordered: b.ordered, basis: b.basis, basisAt: b.basisAt, atLeast: !!b.boughtEver && !b.soldEver });
  }
  items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  unknown.sort((a, b) => a.name.localeCompare(b.name));
  const itemised = items.reduce((a, i) => a + i.count, 0);
  return {
    callsign, carrierId, ready, stats, items, itemised,
    unaccounted: stats.total != null ? stats.total - itemised : null,
    unknown, negatives, since: meta.since, txCount: txs.length,
    recent: txs.slice(-40).reverse(),
  };
}

/** The state record every existing consumer reads (items with commodityId / name / count). */
export function carrierCargoRecord() {
  const inv = getCarrierInventory();
  return {
    callsign: inv.callsign, carrierCallsign: inv.callsign,
    items: inv.items.map(({ commodityId, name, count, basis, ordered, atLeast }) => ({ commodityId, name, count, basis, ordered, atLeast })),
    isEstimate: inv.unaccounted == null || inv.unaccounted !== 0,
    updatedAt: new Date().toISOString(),
    ledger: {
      statsTotal: inv.stats.total, statsAt: inv.stats.at, free: inv.stats.free, capacity: inv.stats.capacity,
      itemised: inv.itemised, unaccounted: inv.unaccounted, since: inv.since, txCount: inv.txCount,
      unknown: inv.unknown.map(({ commodityId, name, ordered }) => ({ commodityId, name, ordered })),
      negatives: inv.negatives, recent: inv.recent.slice(0, 30),
    },
  };
}

/**
 * The commander's own count, typed from the carrier's inventory screen: the base truth for a
 * commodity the journal cannot count (ever on a sell order, never anchored) or a correction to
 * one it can. Dated now; everything moved afterwards applies on top; a later market read still
 * re-anchors anything on a sell order. Returns the resulting item, or null for bad input.
 */
export function setCarrierBaseline(commodity, tonnes, at = new Date().toISOString(), localised = null) {
  const c = keyOf(commodity);
  const n = Number(tonnes);
  if (!c || !Number.isInteger(n) || n < 0 || n > 25000) return null;
  const b = entry(c, localised);
  const d = n - b.qty;
  if (d !== 0) applyTx({ k: 'tx', at, kind: 'baseline', c, n: b.name, d });
  b.basis = 'you'; b.basisAt = at;
  append({ k: 'anchor', at, c, basis: 'you', n: b.name });
  return { commodityId: c, name: b.name, count: n, basis: 'you', basisAt: at };
}

/**
 * A whole reconcile in one pass: what the carrier's own inventory screen says, commodity by
 * commodity. Anything the ledger lists that is not in `counts` is set to zero when `zeroRest` is
 * on — that is what clears goods the ledger thinks are aboard and are not.
 */
export function setCarrierBaselines(counts, { zeroRest = false, at = new Date().toISOString() } = {}) {
  const applied = []; const failed = [];
  const named = new Set();
  for (const [name, tonnes] of Object.entries(counts || {})) {
    const r = setCarrierBaseline(name, tonnes, at, name);
    if (r) { applied.push(r); named.add(r.commodityId); } else failed.push(name);
  }
  const zeroed = [];
  if (zeroRest) {
    // Everything the page would still show — listed, uncounted (an old sell order with nothing
    // behind it) or below zero — is stated as none aboard. A full walk of the carrier's own screen
    // is the one moment "not in the list" honestly means "not there".
    // Snapshot the quantity BEFORE zeroing: the balance object is mutated in place.
    const stale = [...bal.entries()]
      .filter(([c, b]) => !named.has(c) && (b.qty !== 0 || (b.soldEver && b.basis === 'ledger') || b.ordered))
      .map(([c, b]) => ({ c, name: b.name, was: Math.round(b.qty) }));
    for (const s of stale) if (setCarrierBaseline(s.c, 0, at, s.name)) zeroed.push({ commodityId: s.c, name: s.name, was: s.was });
  }
  return { applied: applied.length, zeroed, failed };
}

export function carrierLedgerReady() { return ready; }
