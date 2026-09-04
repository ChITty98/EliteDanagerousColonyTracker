// server/journal/sellPlan.js
//
// The Sell Cargo page: what the commander holds (ship hold from Cargo.json, carrier from the
// store), what it fetches HERE (the docked station's snapshot), LOCALLY (the best of the
// commander's own fresh snapshots and Ardent's buyers within the chosen range) and across the
// GALAXY (Ardent within one carrier jump, and the overall top of book) — with tonnes × price, so
// "sell it all locally or take one carrier jump" is one glance. Plus TRADE NEARBY: the lowest buy
// and the highest sell within range for every commodity Ardent or the commander's own records
// list there, ranked by profit per load of the current ship.
//
// Own records matter because the domain's stations (Atmo Sky Cairn …) are not reliably on EDDN;
// Ardent matters because the domain is not the galaxy. Ardent's live listings DO know the 2026
// commodities (its summary report does not). Every lookup goes through ardentJson — cached an
// hour, one in flight, fail-quiet — and is injectable for tests.
import { readShipCargo, friendlyShip } from './extractor.js';
import { ardentJson } from './livePrices.js';
import { canonicalCommodityName } from './commodityPricesMirror.js';
import { FRESH_MARKET_MS, MAX_REACH_LY } from './marketMeans.js';
import { keyOf, recordArdentSample, needsSample, seriesFor, track } from './marketHistory.js';

export const CARRIER_RANGE_LY = 500;   // one Fleet Carrier jump — the commander's selling radius
// "Galaxy" means the galaxy you are in: anything farther than MAX_REACH_LY (marketMeans.js) from
// the commander — Colonia, from the bubble — is ignored for the top of book, the history sample,
// and the commander's own snapshots alike.
export { MAX_REACH_LY };
const MAX_TRADE_SYSTEMS = 30;
const MAX_TRADE_ROWS = 15;
const MIN_TRADE_PROFIT = 1000;         // cr/t — under this it is noise, not a trade

const dist = (a, b) => (a && b && [a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite))
  ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
const isFC = (row) => !!row && row.stationType === 'FleetCarrier';
const enc = encodeURIComponent;

function coordsOf(state, systemName) {
  if (!systemName) return null;
  const me = state.commanderPosition;
  if (me && me.systemName && me.systemName.toLowerCase() === systemName.toLowerCase()) return me.coordinates || null;
  const ks = (state.knownSystems || {})[systemName.toLowerCase()];
  return ks && ks.coordinates ? ks.coordinates : null;
}

/** The commander's own fresh snapshots as Ardent-shaped rows, with distance from the commander. */
export function ownRows(state, now = Date.now()) {
  const me = state.commanderPosition && state.commanderPosition.coordinates;
  const out = [];
  for (const snap of Object.values(state.marketSnapshots || {})) {
    if (!snap || !Array.isArray(snap.commodities) || snap.stationType === 'FleetCarrier') continue;
    if (!(now - Date.parse(snap.updatedAt) <= FRESH_MARKET_MS)) continue;
    const coords = coordsOf(state, snap.systemName);
    const distance = dist(me, coords);
    if (distance != null && distance > MAX_REACH_LY) continue; // a Colonia-tour snapshot is not a buyer
    for (const c of snap.commodities) {
      if (!c) continue;
      out.push({
        own: true, commodityName: keyOf(c.name || c.commodityId), name: c.name,
        marketId: snap.marketId, stationName: snap.stationName, systemName: snap.systemName, stationType: snap.stationType || '',
        sellPrice: c.sellPrice > 0 ? c.sellPrice : 0, demand: c.demand || 0,
        buyPrice: c.buyPrice > 0 ? c.buyPrice : 0, stock: c.stock || 0,
        updatedAt: snap.updatedAt, distance, coords,
      });
    }
  }
  return out;
}

const pick = (r, kind) => (r ? {
  price: kind === 'buy' ? r.buyPrice : r.sellPrice,
  station: r.stationName || null, system: r.systemName || null, marketId: r.marketId || null,
  distance: r.distance != null ? Math.round(r.distance) : null, at: r.updatedAt || null,
  demand: r.demand ?? null, stock: r.stock ?? null, pad: r.maxLandingPadSize ?? null,
  source: r.own ? 'yours' : 'ardent',
  // A demand of 999,999 is how a Community Goal market reads on the board: real, generous, and
  // gone when the goal ends (Metz Enterprise in Ega, September 2026, at 8× the galactic average).
  cg: (r.demand ?? 0) >= 999999,
} : null);

/** Highest sell with demand covering `load`; at equal pay the nearer station (it is a haul). */
export function bestSell(rows, load) {
  let best = null;
  for (const r of rows || []) {
    if (!r || isFC(r) || !(r.sellPrice > 0) || (r.demand ?? 0) < load) continue;
    if (!best || r.sellPrice > best.sellPrice || (r.sellPrice === best.sellPrice && (r.distance ?? 1e9) < (best.distance ?? 1e9))) best = r;
  }
  return best;
}
/** Lowest buy with stock covering `load`; at equal price the nearer station. */
export function lowestBuy(rows, load) {
  let best = null;
  for (const r of rows || []) {
    if (!r || isFC(r) || !(r.buyPrice > 0) || (r.stock ?? 0) < load) continue;
    if (!best || r.buyPrice < best.buyPrice || (r.buyPrice === best.buyPrice && (r.distance ?? 1e9) < (best.distance ?? 1e9))) best = r;
  }
  return best;
}

const bestPrice = (r) => Math.max(r.here ? r.here.price : 0, r.local ? r.local.price : 0, r.galaxy ? r.galaxy.price : 0, r.top ? r.top.price : 0);

/**
 * @param {object} o
 * @param {object} o.state                          persisted state (readStateFile())
 * @param {string|null} o.journalDir
 * @param {number} [o.rangeLy]                      the "local" radius
 * @param {{name:string,tonnes:number}[]} [o.searched]
 * @param {(path:string)=>Promise<any>} [o.fetchJson] Ardent fetch — injected in tests
 * @param {number} [o.now]
 */
export async function buildSellPlan({ state, journalDir, rangeLy = 50, searched = [], fetchJson = ardentJson, now = Date.now() }) {
  const st = state || {};
  const settings = st.settings || {};
  const me = st.commanderPosition || null;
  const myCoords = (me && me.coordinates) || null;
  const dock = st.currentDock || null;
  const shipInfo = st.currentShip || null;
  const capacity = shipInfo && shipInfo.cargoCapacity > 0 ? shipInfo.cargoCapacity : null;

  let shipCargo = null;
  try { shipCargo = journalDir ? readShipCargo(journalDir) : null; } catch { shipCargo = null; }
  const fc = settings.myFleetCarrier || null;
  const carrier = fc && st.carrierCargo ? st.carrierCargo[fc] : null;

  // ---- rows: everything held, plus everything searched ----------------------------------------
  const rows = new Map();
  const rowFor = (label) => {
    const key = keyOf(label);
    let r = rows.get(key);
    if (!r) { r = { key, name: canonicalCommodityName(label), ship: 0, carrier: 0, searched: null }; rows.set(key, r); }
    return r;
  };
  for (const it of (shipCargo && shipCargo.items) || []) rowFor(it.name || it.commodityId).ship += it.count || 0;
  for (const it of (carrier && carrier.items) || []) rowFor(it.name || it.commodityId).carrier += it.count || 0;
  for (const s of searched || []) {
    if (!s || !s.name) continue;
    const r = rowFor(s.name);
    r.searched = Math.max(0, Number(s.tonnes) || 0);
  }
  track([...rows.keys()]);

  const own = ownRows(st, now);
  const hereSnap = dock ? (st.marketSnapshots || {})[dock.marketId] : null;
  const refSystem = me && me.systemName ? me.systemName : null;
  const withDist = (list) => (Array.isArray(list) ? list : []).map((x) => (
    x && x.distance == null && myCoords ? { ...x, distance: dist(myCoords, { x: x.systemX, y: x.systemY, z: x.systemZ }) } : x
  ));

  const out = [];
  for (const r of rows.values()) {
    const tonnes = r.searched != null ? r.searched : r.ship + r.carrier;
    const load = Math.max(1, tonnes || 0);
    const mine = own.filter((x) => x.commodityName === r.key);

    // HERE — the docked station's own snapshot, the freshest reading there is for it.
    let here = null;
    if (hereSnap) {
      const c = (hereSnap.commodities || []).find((x) => x && keyOf(x.name || x.commodityId) === r.key);
      if (c && c.sellPrice > 0) here = { price: c.sellPrice, demand: c.demand ?? null, station: hereSnap.stationName, system: hereSnap.systemName, distance: 0, at: hereSnap.updatedAt, source: 'yours' };
    }

    // LOCAL — own fresh rows within range, plus Ardent's buyers within range.
    const ardentLocal = refSystem ? await fetchJson(`/system/name/${enc(refSystem)}/commodity/name/${enc(r.key)}/nearby/imports?maxDistance=${rangeLy}&fleetCarriers=false`) : null;
    const localRows = [...mine.filter((x) => x.distance != null && x.distance <= rangeLy), ...withDist(ardentLocal)];
    const localBest = bestSell(localRows, load);
    const local = pick(localBest, 'sell');
    if (local && localBest.own) local.onlyYours = !(Array.isArray(ardentLocal) && ardentLocal.some((x) => x && x.marketId === localBest.marketId));

    // GALAXY — one carrier jump out, and the overall top of book (sampled into the history daily).
    const ardentCarrier = refSystem ? await fetchJson(`/system/name/${enc(refSystem)}/commodity/name/${enc(r.key)}/nearby/imports?maxDistance=${CARRIER_RANGE_LY}&fleetCarriers=false`) : null;
    const ardentAll = await fetchJson(`/commodity/name/${enc(r.key)}/imports?fleetCarriers=false`);
    // Unknown distance (no position yet) is allowed through; a known distance beyond reach is not.
    const reachable = withDist(ardentAll).filter((x) => x && (x.distance == null || x.distance <= MAX_REACH_LY));
    if (Array.isArray(ardentAll) && needsSample(r.key, now)) recordArdentSample(r.key, reachable, now);
    const carrierRows = [...mine.filter((x) => x.distance != null && x.distance <= CARRIER_RANGE_LY), ...withDist(ardentCarrier)];
    const galaxy = pick(bestSell(carrierRows, load), 'sell');
    const top = pick(bestSell(reachable, load), 'sell');
    const known = Array.isArray(ardentAll) || Array.isArray(ardentLocal) || Array.isArray(ardentCarrier);
    out.push({ ...r, tonnes, load, here, local, galaxy, top: top && (!galaxy || top.price > galaxy.price) ? top : null, unknownToArdent: !known && mine.length === 0 });
  }
  out.sort((a, b) => ((b.tonnes > 0 ? b.tonnes : 1) * bestPrice(b)) - ((a.tonnes > 0 ? a.tonnes : 1) * bestPrice(a)) || a.name.localeCompare(b.name));

  const totals = { tonnes: 0, here: 0, local: 0, galaxy: 0 };
  for (const r of out) {
    if (!(r.tonnes > 0)) continue;
    totals.tonnes += r.tonnes;
    if (r.here) totals.here += r.tonnes * r.here.price;
    if (r.local) totals.local += r.tonnes * r.local.price;
    const g = r.galaxy || r.top;
    if (g) totals.galaxy += r.tonnes * g.price;
  }

  const trade = await tradeNearby({ st, own, myCoords, refSystem, rangeLy, capacity, fetchJson });

  return {
    at: new Date(now).toISOString(),
    me: me ? { system: me.systemName, coords: myCoords } : null,
    dock: dock ? { marketId: dock.marketId, station: dock.stationName, system: dock.systemName, since: dock.dockedAt, snapshotAt: hereSnap ? hereSnap.updatedAt : null } : null,
    ship: {
      type: shipInfo ? shipInfo.type : null, name: shipInfo ? friendlyShip(shipInfo.type) : null,
      ident: shipInfo ? (shipInfo.name || shipInfo.ident || null) : null, capacity,
      items: (shipCargo && shipCargo.items) || [], at: shipCargo ? shipCargo.timestamp : null,
    },
    carrier: carrier
      ? { callsign: fc, items: carrier.items || [], isEstimate: !!carrier.isEstimate, at: carrier.updatedAt || null, ledger: carrier.ledger ? { statsTotal: carrier.ledger.statsTotal ?? null, statsAt: carrier.ledger.statsAt ?? null, itemised: carrier.ledger.itemised ?? 0, unaccounted: carrier.ledger.unaccounted ?? null } : null }
      : (fc ? { callsign: fc, items: [], isEstimate: false, at: null, ledger: null } : null),
    range: rangeLy, carrierRange: CARRIER_RANGE_LY,
    rows: out, totals, trade,
    history: seriesFor([...rows.keys()], now),
  };
}

/**
 * Lowest buy and highest sell within range, per commodity, from Ardent's per-system boards for
 * the populated systems the commander knows (plus the current one) and the commander's own fresh
 * records, which override Ardent when newer and add the stations Ardent lacks.
 */
export async function tradeNearby({ st, own, myCoords, refSystem, rangeLy, capacity, fetchJson }) {
  if (!refSystem) return { systems: 0, load: capacity, rows: [] };
  const systems = new Map();
  systems.set(refSystem.toLowerCase(), { name: refSystem, coords: myCoords || null, distance: 0 });
  for (const ks of Object.values(st.knownSystems || {})) {
    if (!ks || !ks.systemName || !(ks.population > 0) || !ks.coordinates) continue;
    const d = dist(myCoords, ks.coordinates);
    if (d == null || d > rangeLy) continue;
    const k = ks.systemName.toLowerCase();
    if (!systems.has(k)) systems.set(k, { name: ks.systemName, coords: ks.coordinates, distance: d });
  }
  for (const r of own) {
    if (r.distance == null || r.distance > rangeLy || !r.systemName) continue;
    const k = r.systemName.toLowerCase();
    if (!systems.has(k)) systems.set(k, { name: r.systemName, coords: r.coords, distance: r.distance });
  }
  const list = [...systems.values()].sort((a, b) => a.distance - b.distance).slice(0, MAX_TRADE_SYSTEMS);

  const byMarket = new Map(); // `${marketId}|${key}` -> row
  for (const s of list) {
    const rows = await fetchJson(`/system/name/${enc(s.name)}/commodities`);
    for (const x of Array.isArray(rows) ? rows : []) {
      if (!x || isFC(x) || !x.marketId) continue;
      const k = keyOf(x.commodityName);
      if (!k) continue;
      byMarket.set(`${x.marketId}|${k}`, { ...x, commodityName: k, distance: s.distance, coords: s.coords });
    }
  }
  for (const r of own) {
    if (r.distance == null || r.distance > rangeLy) continue;
    const id = `${r.marketId}|${r.commodityName}`;
    const prev = byMarket.get(id);
    if (!prev || Date.parse(r.updatedAt) >= Date.parse(prev.updatedAt || 0)) {
      byMarket.set(id, { ...(prev || {}), ...r, maxLandingPadSize: prev ? prev.maxLandingPadSize : null });
    }
  }

  const load = capacity && capacity > 0 ? capacity : 1;
  const perCommodity = new Map();
  for (const x of byMarket.values()) {
    const a = perCommodity.get(x.commodityName) || perCommodity.set(x.commodityName, []).get(x.commodityName);
    a.push(x);
  }
  const rows = [];
  for (const [k, xs] of perCommodity) {
    const buy = lowestBuy(xs, load);
    if (!buy) continue;
    const sell = bestSell(xs.filter((x) => x.marketId !== buy.marketId), load);
    if (!sell) continue;
    const perTonne = sell.sellPrice - buy.buyPrice;
    if (perTonne < MIN_TRADE_PROFIT) continue;
    const leg = dist(buy.coords, sell.coords);
    rows.push({
      key: k, name: canonicalCommodityName(buy.name || sell.name || k),
      buy: pick(buy, 'buy'), sell: pick(sell, 'sell'),
      perTonne, perLoad: capacity ? perTonne * capacity : null, leg: leg != null ? Math.round(leg) : null,
    });
  }
  rows.sort((a, b) => ((b.perLoad ?? b.perTonne) - (a.perLoad ?? a.perTonne)) || a.name.localeCompare(b.name));
  return { systems: list.length, load: capacity, rows: rows.slice(0, MAX_TRADE_ROWS) };
}
