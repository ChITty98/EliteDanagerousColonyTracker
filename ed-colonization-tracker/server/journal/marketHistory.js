// server/journal/marketHistory.js
//
// Price history — the one thing no source keeps. Ardent has no time series (its summary report
// is 16 months stale and blind to the 2026 commodities), the app kept one snapshot per market and
// overwrote it on every visit, and the journals record only what the commander actually sold.
// So from 2026-09-04 this records three things, append-only, in market-history.jsonl beside the
// exe (gitignored, pruned to a year on load):
//   m  every Market.json read — per station, per commodity, only when the price moved or the day
//      changed, so a station opened five times an evening costs one line per commodity
//   a  a daily galaxy-wide sample from Ardent's live buyer list (top of book, median of the top
//      100, the game's mean when the rows carry it) for the surface commodities and anything the
//      commander holds or searched
//   s  the commander's own MarketSell / MarketBuy from the last twelve months of journals
// "Is 240k an aberration?" is answerable only after weeks of these; the file starts today.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalCommodityName } from './commodityPricesMirror.js';

export const HISTORY_DAYS = 365;
const DAY_MS = 86400e3;

// Journal-style ids — the same key the price mirror and the surface ledger use.
const flatten = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const keyOf = (name) => { const k = flatten(name); return k.startsWith('lowtemp') ? 'lowtemperaturediamond' : k; };

/** The 2026 surface commodities — sampled daily whether or not they are in the hold. */
export const SURFACE_KEYS = [
  'thortveitite', 'periclasedunite', 'grandidierite', 'rhodplumsite', 'iridium', 'lowtemperaturediamond',
  'diamond', 'sapphire', 'ruby', 'helium', 'helium3', 'bastnasite', 'quartzpyroxenite', 'deuterium', 'magnesite', 'olivine',
];

let FILE = null;
let lines = [];             // every kept record, oldest first
let lastRead = new Map();   // `${marketId}|${key}` -> { sell, buy, day }
let sampledDay = new Map(); // key -> day of the last Ardent sample
let salesSeen = new Set();  // dedupe for 's' lines
let meta = { salesScannedThrough: null };
let tracked = new Set();    // keys searched this run — sampled with the rest

const dayOf = (iso) => Math.floor(Date.parse(iso) / DAY_MS);
const fresh = (iso, now) => Number.isFinite(Date.parse(iso)) && now - Date.parse(iso) <= HISTORY_DAYS * DAY_MS;

export function initMarketHistory(appDir, opts = {}) {
  FILE = path.join(appDir, 'market-history.jsonl');
  lines = []; lastRead = new Map(); sampledDay = new Map(); salesSeen = new Set(); meta = { salesScannedThrough: null }; tracked = new Set();
  const now = opts.now || Date.now();
  let raw = '';
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { raw = ''; }
  let dropped = 0;
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.k === 'meta') { meta = { salesScannedThrough: r.salesScannedThrough || null }; continue; }
    if (!r.at || !fresh(r.at, now)) { dropped += 1; continue; }
    index(r);
    lines.push(r);
  }
  if (dropped > 0) rewrite();
  let salesAdded = 0;
  if (opts.journalDir) {
    try { salesAdded = backfillSales(opts.journalDir, now); } catch (e) { console.error('[MarketHistory] sales backfill:', e && e.message); }
  }
  return { records: lines.length, pruned: dropped, salesAdded };
}

function index(r) {
  if (r.k === 'm') lastRead.set(`${r.mid}|${r.c}`, { sell: r.sell, buy: r.buy, day: dayOf(r.at) });
  else if (r.k === 'a') sampledDay.set(r.c, Math.max(sampledDay.get(r.c) || 0, dayOf(r.at)));
  else if (r.k === 's') salesSeen.add(`${r.at}|${r.mid}|${r.c}|${r.side}`);
}

function append(r) {
  index(r);
  lines.push(r);
  if (!FILE) return;
  try { fs.appendFileSync(FILE, JSON.stringify(r) + '\n', 'utf8'); } catch { /* non-fatal */ }
}

// The meta line lives at the top, so changing it is a rewrite; it changes once per boot at most.
function rewrite() {
  if (!FILE) return;
  try {
    fs.writeFileSync(FILE, [JSON.stringify({ k: 'meta', ...meta }), ...lines.map((r) => JSON.stringify(r))].join('\n') + '\n', 'utf8');
  } catch { /* non-fatal */ }
}

/** One Market.json read (extractor.readMarketJson shape). Writes movers and first-of-day rows only. */
export function recordMarketRead(market, now = Date.now()) {
  if (!market || !Array.isArray(market.items) || !market.marketId) return 0;
  if (market.stationType === 'FleetCarrier') return 0;
  const at = market.timestamp || new Date(now).toISOString();
  const day = dayOf(at);
  let n = 0;
  for (const it of market.items) {
    if (!it) continue;
    const sell = it.sellPrice > 0 && it.demand > 0 ? it.sellPrice : 0;
    const buy = it.buyPrice > 0 && it.stock > 0 ? it.buyPrice : 0;
    if (!sell && !buy) continue;
    const label = it.nameLocalised || String(it.name || '').replace(/^\$/, '').replace(/_name;$/i, '');
    const c = keyOf(label);
    if (!c) continue;
    const prev = lastRead.get(`${market.marketId}|${c}`);
    if (prev && prev.day === day && prev.sell === sell && prev.buy === buy) continue;
    append({
      k: 'm', at, mid: market.marketId, st: market.stationName || null, sys: market.systemName || null,
      c, n: canonicalCommodityName(label), sell, dem: sell ? it.demand : 0, buy, stk: buy ? it.stock : 0,
      mean: it.meanPrice > 0 ? it.meanPrice : 0,
    });
    n += 1;
  }
  return n;
}

/**
 * Galaxy-wide buyer board from Ardent (rows of /commodity/name/{c}/imports): one sample per day.
 * With an origin, rows farther than maxLy are dropped first — Colonia posts the top price on
 * every board and is not a place a hold of ore goes.
 */
export function recordArdentSample(key, rows, now = Date.now(), reach = null) {
  const c = keyOf(key);
  const day = Math.floor(now / DAY_MS);
  if ((sampledDay.get(c) || 0) >= day) return false;
  const o = reach && reach.origin;
  const within = (x) => {
    if (!o || !(reach.maxLy > 0)) return true;
    if (![x.systemX, x.systemY, x.systemZ].every(Number.isFinite)) return true;
    return Math.hypot(x.systemX - o.x, x.systemY - o.y, x.systemZ - o.z) <= reach.maxLy;
  };
  const good = (Array.isArray(rows) ? rows : [])
    .filter((x) => x && x.stationType !== 'FleetCarrier' && x.sellPrice > 0 && x.demand > 0 && within(x))
    .sort((a, b) => b.sellPrice - a.sellPrice);
  if (!good.length) return false;
  const top = good[0];
  const med = good[Math.floor(good.length / 2)].sellPrice;
  const withMean = good.find((x) => x.meanPrice > 0);
  append({
    k: 'a', at: new Date(now).toISOString(), c, n: canonicalCommodityName(top.commodityName || key),
    top: top.sellPrice, topSt: top.stationName || null, topSys: top.systemName || null, topDem: top.demand,
    med, n100: good.length, mean: withMean ? withMean.meanPrice : 0,
  });
  return true;
}

export function needsSample(key, now = Date.now()) { return (sampledDay.get(keyOf(key)) || 0) < Math.floor(now / DAY_MS); }
export function track(keys) { for (const k of keys || []) if (k) tracked.add(keyOf(k)); }
/** Keys worth a daily sample: the surface set, anything searched this run, anything ever sampled. */
export function sampleKeys(extra = []) {
  const s = new Set([...SURFACE_KEYS, ...tracked, ...sampledDay.keys()]);
  for (const k of extra || []) if (k) s.add(keyOf(k));
  return [...s];
}

/** Journal MarketSell / MarketBuy from the last year — the commander's real price points. Idempotent. */
export function backfillSales(journalDir, now = Date.now()) {
  let files;
  try { files = fs.readdirSync(journalDir).filter((f) => /^Journal.*\.log$/i.test(f)); } catch { return 0; }
  const since = meta.salesScannedThrough ? Date.parse(meta.salesScannedThrough) - DAY_MS : now - HISTORY_DAYS * DAY_MS;
  let added = 0;
  let newest = meta.salesScannedThrough ? Date.parse(meta.salesScannedThrough) : 0;
  for (const f of files) {
    const p = path.join(journalDir, f);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.mtimeMs < since) continue;
    let text; try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const l of text.split('\n')) {
      if (!l.includes('"MarketSell"') && !l.includes('"MarketBuy"')) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.event !== 'MarketSell' && e.event !== 'MarketBuy') continue;
      if (!fresh(e.timestamp, now)) continue;
      const side = e.event === 'MarketSell' ? 'sell' : 'buy';
      const label = e.Type_Localised || String(e.Type || '').replace(/^\$/, '').replace(/_name;$/i, '');
      const c = keyOf(label);
      const dk = `${e.timestamp}|${e.MarketID}|${c}|${side}`;
      if (!c || salesSeen.has(dk)) continue;
      const price = side === 'sell' ? e.SellPrice : e.BuyPrice;
      if (!(price > 0)) continue;
      append({ k: 's', at: e.timestamp, mid: e.MarketID, c, n: canonicalCommodityName(label), side, price, t: e.Count || 0 });
      added += 1;
      newest = Math.max(newest, Date.parse(e.timestamp));
    }
  }
  meta.salesScannedThrough = new Date(Math.max(newest, now - DAY_MS)).toISOString();
  rewrite();
  return added;
}

/**
 * Daily series for the page: per commodity, one bucket per day that has anything — the game's
 * mean, the best of the commander's own markets, Ardent's top of book and median, and the
 * commander's own sale / purchase prices. `d` is days since the epoch (UTC).
 */
export function seriesFor(keys, now = Date.now()) {
  const want = new Set((keys || []).map(keyOf));
  const out = {};
  const bucket = (c, d) => {
    const s = out[c] || (out[c] = {});
    return s[d] || (s[d] = { d, mean: 0, best: 0, bestSt: null, galaxy: 0, galaxySt: null, med: 0, sale: 0, buy: 0 });
  };
  for (const r of lines) {
    if (!want.has(r.c)) continue;
    const d = dayOf(r.at);
    if (!Number.isFinite(d)) continue;
    if (r.k === 'm') {
      const b = bucket(r.c, d);
      if (r.mean > b.mean) b.mean = r.mean;
      if (r.sell > b.best) { b.best = r.sell; b.bestSt = r.st; }
    } else if (r.k === 'a') {
      const b = bucket(r.c, d);
      if (r.top > b.galaxy) { b.galaxy = r.top; b.galaxySt = r.topSt; }
      if (r.med > b.med) b.med = r.med;
      if (r.mean > b.mean) b.mean = r.mean;
    } else if (r.k === 's') {
      const b = bucket(r.c, d);
      if (r.side === 'sell' && r.price > b.sale) b.sale = r.price;
      if (r.side === 'buy' && r.price > b.buy) b.buy = r.price;
    }
  }
  const today = Math.floor(now / DAY_MS);
  const result = {};
  for (const [c, days] of Object.entries(out)) result[c] = { today, days: Object.values(days).sort((a, b) => a.d - b.d) };
  return result;
}

export function historyStats() {
  const k = { m: 0, a: 0, s: 0 };
  for (const r of lines) if (k[r.k] != null) k[r.k] += 1;
  return { ...k, keys: new Set(lines.map((r) => r.c)).size, salesScannedThrough: meta.salesScannedThrough };
}
