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
// SPEED (2026-09-06, "the sell cargo page is very slow"): with 43 commodities aboard the carrier
// the plan made three serial Ardent calls per commodity through a one-lane queue — four minutes.
// Now ONE nearby call per commodity (a carrier jump out; "within your range" is the same rows cut
// at rangeLy, so the range buttons cost nothing), the galaxy-wide call, three fetch lanes in
// livePrices, and the assembled plan cached ten minutes against where you are and what you hold.
//
// FAST FIRST PAINT (2026-09-07, "start the load with markets that have been previously loaded"):
// `fast: true` builds the plan from your own snapshots and whatever Ardent answers are already in
// the hour cache, marks it partial, and queues the misses in the background. The route broadcasts
// sell_plan_updated when the full build lands; the page refetches the fast plan, now complete.
//
// Own records matter because the domain's stations (Atmo Sky Cairn …) are not reliably on EDDN;
// Ardent matters because the domain is not the galaxy. Ardent's live listings DO know the 2026
// commodities (its summary report does not). Every lookup goes through ardentJson — cached an
// hour, one in flight, fail-quiet — and is injectable for tests.
import { readShipCargo, friendlyShip } from './extractor.js';
import { ardentJson, ardentPeek } from './livePrices.js';
import { canonicalCommodityName, galacticAvgSell } from './commodityPricesMirror.js';
import { FRESH_MARKET_MS, MAX_REACH_LY } from './marketMeans.js';
import { keyOf, recordArdentSample, needsSample, seriesFor, track } from './marketHistory.js';
import { isCommunityGoalMarket } from './communityGoals.js';

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
  // A goal market by the journal's own list — never by its demand figure: big stations post
  // millions of demand for ordinary goods, and that tag was on half the Sell page (2026-09-07).
  cg: isCommunityGoalMarket(r.stationName, r.systemName),
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
const PLAN_TTL_MS = 10 * 60_000;
const planCache = new Map(); // key -> { at, plan }
export function _clearPlanCache() { planCache.clear(); }

export function sellPlanKey(opts) {
  const { state, journalDir, rangeLy = 50, searched = [] } = opts || {};
  const st = state || {};
  const me = st.commanderPosition || null;
  const dock = st.currentDock || null;
  const fc = (st.settings || {}).myFleetCarrier || null;
  const carrier = fc && st.carrierCargo ? st.carrierCargo[fc] : null;
  let shipSig = '';
  try { const sc = journalDir ? readShipCargo(journalDir) : null; shipSig = ((sc && sc.items) || []).map((i) => `${i.name || i.commodityId}:${i.count}`).sort().join(','); } catch { shipSig = '?'; }
  const carrierSig = ((carrier && carrier.items) || []).map((i) => `${i.name || i.commodityId}:${i.count}`).sort().join(',');
  const hereAt = dock && st.marketSnapshots && st.marketSnapshots[dock.marketId] ? st.marketSnapshots[dock.marketId].updatedAt || '' : '';
  return [me && me.systemName, rangeLy, dock && dock.marketId, hereAt, JSON.stringify(searched || []), shipSig, carrierSig].join('|');
}

export async function buildSellPlan(opts) {
  const { fetchJson = ardentJson, fast = false, peek = ardentPeek } = opts || {};
  // FAST: a complete cached plan wins; otherwise build from the cache alone and say what is missing.
  if (fast) {
    const key = sellPlanKey(opts);
    const hit = planCache.get(key);
    if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
    const missing = new Set();
    const cachedOnly = async (p) => {
      const c = peek(p);
      if (c.cached) return c.data;
      missing.add(p);
      if (fetchJson === ardentJson) ardentJson(p).catch(() => {}); // queue the real fetch; nobody waits on it
      return null;
    };
    const plan = await buildSellPlanUncached({ ...opts, fetchJson: cachedOnly });
    plan.partial = missing.size > 0;
    plan.pending = missing.size;
    if (!plan.partial && fetchJson === ardentJson) planCache.set(key, { at: Date.now(), plan });
    return plan;
  }
  // Cached only on the real fetcher — an injected one is a test, and tests want every call made.
  if (fetchJson !== ardentJson) return buildSellPlanUncached(opts);
  const key = sellPlanKey(opts);
  const hit = planCache.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;
  const plan = await buildSellPlanUncached(opts);
  planCache.set(key, { at: Date.now(), plan });
  if (planCache.size > 20) planCache.delete(planCache.keys().next().value);
  return plan;
}

async function buildSellPlanUncached({ state, journalDir, rangeLy = 50, searched = [], fetchJson = ardentJson, now = Date.now() }) {
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
  // ARDENT'S NEARBY LISTS NEVER INCLUDE THE SYSTEM YOU ARE IN (verified 2026-09-07: 1,000 rows at
  // 50 ly from ICZ GR-V b2-5, none at distance zero; The Gatehouse's 781k for Grandidierite missing
  // while the Sell-at table, which asks for the system's own listing, showed it). That listing —
  // one cached call, the same one Trade Nearby makes — fills the hole at distance zero.
  const hereListing = refSystem ? await fetchJson(`/system/name/${enc(refSystem)}/commodities`) : null;
  const hereRowsByKey = new Map();
  for (const x of Array.isArray(hereListing) ? hereListing : []) {
    if (!x || isFC(x) || !x.marketId || !(x.sellPrice > 0)) continue;
    const k = keyOf(x.commodityName);
    if (!hereRowsByKey.has(k)) hereRowsByKey.set(k, []);
    hereRowsByKey.get(k).push({ ...x, commodityName: k, distance: 0 });
  }
  /** Union by market id, the newer reading winning — the nearby list, the home listing, the galaxy list within range. */
  const unionByMarket = (...lists) => {
    const m = new Map();
    for (const list of lists) for (const x of list || []) {
      if (!x || !x.marketId) continue;
      const prev = m.get(x.marketId);
      if (!prev || Date.parse(x.updatedAt || 0) >= Date.parse(prev.updatedAt || 0)) m.set(x.marketId, x);
    }
    return [...m.values()];
  };
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
      if (c && c.sellPrice > 0) here = { price: c.sellPrice, demand: c.demand ?? null, station: hereSnap.stationName, system: hereSnap.systemName, distance: 0, at: hereSnap.updatedAt, source: 'yours', cg: isCommunityGoalMarket(hereSnap.stationName, hereSnap.systemName) };
    }

    // NEARBY — one call, one carrier jump out, joined by the system you are in and by any galaxy-list
    // buyer inside the range. "Within your range" is the same rows cut at rangeLy.
    const ardentCarrier = refSystem ? await fetchJson(`/system/name/${enc(refSystem)}/commodity/name/${enc(r.key)}/nearby/imports?maxDistance=${CARRIER_RANGE_LY}&fleetCarriers=false`) : null;
    const ardentAll = await fetchJson(`/commodity/name/${enc(r.key)}/imports?fleetCarriers=false`);
    const allWithDist = withDist(ardentAll);
    const nearRows = unionByMarket(withDist(ardentCarrier), hereRowsByKey.get(r.key) || [], allWithDist.filter((x) => x && x.distance != null && x.distance <= CARRIER_RANGE_LY));
    const nearKnown = Array.isArray(ardentCarrier) || hereRowsByKey.has(r.key) || Array.isArray(ardentAll);
    const ardentLocal = nearKnown ? nearRows.filter((x) => x && x.distance != null && x.distance <= rangeLy) : null;
    // LOCAL — own fresh rows within range, plus Ardent's buyers within range.
    const localRows = [...mine.filter((x) => x.distance != null && x.distance <= rangeLy), ...(ardentLocal || [])];
    const localBest = bestSell(localRows, load);
    const local = pick(localBest, 'sell');
    if (local && localBest.own) local.onlyYours = !(Array.isArray(ardentLocal) && ardentLocal.some((x) => x && x.marketId === localBest.marketId));

    // GALAXY — the carrier-jump rows above, and the overall top of book (sampled into the history daily).
    // Unknown distance (no position yet) is allowed through; a known distance beyond reach is not.
    const reachable = allWithDist.filter((x) => x && (x.distance == null || x.distance <= MAX_REACH_LY));
    if (Array.isArray(ardentAll) && needsSample(r.key, now)) recordArdentSample(r.key, reachable, now);
    const carrierRows = [...mine.filter((x) => x.distance != null && x.distance <= CARRIER_RANGE_LY), ...nearRows];
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
    const g = r.top || r.galaxy; // top is only set when it beats the carrier-range buyer
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
/**
 * SELL AT — everything you hold, priced at ONE chosen system: the best-paying station there for
 * each commodity (Ardent's full listing for the system plus your own snapshot if you docked), the
 * price against the galactic mean, demand against your tonnes, and what the best buyer elsewhere
 * pays (the cached galaxy-wide list, when the plan has fetched it). "I'm going to LFT 65 for the
 * Rhodplumsite — what else should ride along?" One Ardent call, cached an hour.
 */
export async function buildSellAt({ state, journalDir, system, fetchJson = ardentJson, peek = ardentPeek, now = Date.now() }) {
  const st = state || {};
  const name = String(system || '').trim();
  if (!name) return { system: null, error: 'system required', rows: [], stations: [] };
  const me = st.commanderPosition || null;
  const myCoords = (me && me.coordinates) || null;
  const fc = (st.settings || {}).myFleetCarrier || null;
  const carrier = fc && st.carrierCargo ? st.carrierCargo[fc] : null;
  let shipCargo = null;
  try { shipCargo = journalDir ? readShipCargo(journalDir) : null; } catch { shipCargo = null; }
  const held = new Map();
  const rowFor = (label) => {
    const key = keyOf(label);
    let r = held.get(key);
    if (!r) { r = { key, name: canonicalCommodityName(label), ship: 0, carrier: 0 }; held.set(key, r); }
    return r;
  };
  for (const it of (shipCargo && shipCargo.items) || []) rowFor(it.name || it.commodityId).ship += it.count || 0;
  for (const it of (carrier && carrier.items) || []) rowFor(it.name || it.commodityId).carrier += it.count || 0;

  const listing = await fetchJson(`/system/name/${enc(name)}/commodities`);
  const info = await fetchJson(`/system/name/${enc(name)}`);
  const coords = info && Number.isFinite(info.systemX) ? { x: info.systemX, y: info.systemY, z: info.systemZ } : coordsOf(st, name);
  const distance = dist(myCoords, coords);
  const sysName = (info && info.systemName) || (Array.isArray(listing) && listing[0] && listing[0].systemName) || name;
  const ardentRows = (Array.isArray(listing) ? listing : []).filter((x) => x && !isFC(x) && x.marketId).map((x) => ({ ...x, commodityName: keyOf(x.commodityName), distance }));
  const own = ownRows(st, now).filter((r) => r.systemName && r.systemName.toLowerCase() === sysName.toLowerCase());
  const stations = [...new Set([...ardentRows, ...own].map((r) => r.stationName).filter(Boolean))];

  const rows = [];
  for (const r of held.values()) {
    const tonnes = r.ship + r.carrier;
    if (!(tonnes > 0)) continue;
    const candidates = [...own.filter((x) => x.commodityName === r.key), ...ardentRows.filter((x) => x.commodityName === r.key)];
    // Own reading beats Ardent's for the same station when it is newer.
    const byStation = new Map();
    for (const c of candidates) {
      const k = c.marketId || c.stationName;
      const prev = byStation.get(k);
      if (!prev || Date.parse(c.updatedAt || 0) >= Date.parse(prev.updatedAt || 0)) byStation.set(k, c);
    }
    const best = bestSell([...byStation.values()], 1);
    const offer = pick(best, 'sell');
    const mean = galacticAvgSell(r.name) || 0;
    // The best buyer anywhere, from the plan's cached galaxy-wide list — only when it is on hand.
    const all = peek(`/commodity/name/${enc(r.key)}/imports?fleetCarriers=false`);
    const elsewhereBest = all.cached && Array.isArray(all.data) ? bestSell(all.data.filter((x) => x && !isFC(x)).map((x) => ({ ...x, distance: myCoords ? dist(myCoords, { x: x.systemX, y: x.systemY, z: x.systemZ }) : null })), 1) : null;
    const elsewhere = elsewhereBest ? pick(elsewhereBest, 'sell') : null;
    const vsMean = offer && mean > 0 ? offer.price / mean : null;
    const bestKnown = Math.max(offer ? offer.price : 0, elsewhere ? elsewhere.price : 0);
    const pctOfBest = offer && bestKnown > 0 ? offer.price / bestKnown : null;
    rows.push({
      key: r.key, name: r.name, ship: r.ship, carrier: r.carrier, tonnes,
      offer, mean, vsMean,
      demandShort: !!(offer && offer.demand != null && offer.demand < tonnes),
      value: offer ? offer.price * tonnes : 0,
      elsewhere, pctOfBest,
      // The one-glance answer per line, against the best buyer known and nothing else (the
      // commander's rule, 2026-09-07): 'sell' at SELL_PCT or better of it, 'loss' under LOSS_PCT,
      // 'close' between. The mean stays on the row as a fact; it colours nothing.
      verdict: !offer ? 'none' : pctOfBest == null || pctOfBest >= SELL_PCT ? 'sell' : pctOfBest < LOSS_PCT ? 'loss' : 'close',
      worthHere: !!(offer && (pctOfBest == null || pctOfBest >= SELL_PCT)),
      bestValue: bestKnown * tonnes,
      listedHere: byStation.size > 0,
    });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const total = rows.reduce((t, r) => t + r.value, 0);
  const totalBest = rows.reduce((t, r) => t + r.bestValue, 0);
  return {
    at: new Date(now).toISOString(), system: sysName, coords, distance: distance != null ? Math.round(distance) : null,
    known: Array.isArray(listing) || own.length > 0, stations, rows, total, totalBest,
    worth: rows.filter((r) => r.verdict === 'sell').map((r) => r.name),
    close: rows.filter((r) => r.verdict === 'close').map((r) => ({ name: r.name, pct: Math.round((r.pctOfBest || 0) * 100), at: r.elsewhere ? r.elsewhere.station : null, system: r.elsewhere ? r.elsewhere.system : null })),
    better: rows.filter((r) => r.verdict === 'loss').map((r) => ({ name: r.name, pct: Math.round((r.pctOfBest || 0) * 100), at: r.elsewhere ? r.elsewhere.station : null, system: r.elsewhere ? r.elsewhere.system : null, price: r.elsewhere ? r.elsewhere.price : null })),
  };
}
export const SELL_PCT = 0.85;   // of the best known buyer: sell here
export const LOSS_PCT = 0.70;   // under this: take it elsewhere

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
