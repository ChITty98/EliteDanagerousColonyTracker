// server/journal/factionGuide.js
//
// The faction guide's journal-side facts for one system (1.60.32):
//   - mined-goods sales: every MarketSell with no purchase price (AvgPricePaid 0 — mined or salvaged)
//     at a station in the system, with the faction that held the station WHEN the sale was made
//     (the Docked event's StationFaction, not today's dossier). These are the evidence rows for the
//     open question "do mined sales move influence?": the client pairs each with the faction's next
//     reading.
//   - surface yields: what the commander's own rigs have pulled from each body in the system, from
//     the surface ledger's 'collect' records (surfaceMining.js), so "mine body X for faction Y" is a
//     measured line, never a guess.
// Pure where it can be; the journal scan takes an injectable io and caches per journal signature.
import fs from 'node:fs';
import path from 'node:path';
import { listJournalFiles } from './paths.js';

const DAY_MS = 86_400_000;
const cache = new Map(); // key -> { sig, rows }

function fileDate(name) {
  // Journal.2026-10-23T223815.01.log → 2026-10-23 ; legacy Journal.231023223815.01.log → 2023-10-23
  const m = /Journal\.(\d{4}-\d{2}-\d{2})T/.exec(name) || /Journal\.(\d{2})(\d{2})(\d{2})\d{6}\./.exec(name);
  if (!m) return null;
  return m.length === 2 ? m[1] : `20${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Mined/salvaged sales (no purchase price) at stations in `systemName`, oldest first.
 * opts.sinceDays bounds the scan (default 120). io = { listFiles(dir), readFile(path) } for tests.
 */
export function extractMinedSales(journalDir, opts = {}, io = {}) {
  const systemName = String(opts.systemName || '').trim();
  if (!systemName) return [];
  const sinceDays = Number.isFinite(opts.sinceDays) ? opts.sinceDays : 120;
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  const since = new Date(now - sinceDays * DAY_MS).toISOString().slice(0, 10);
  const listFiles = io.listFiles || ((dir) => listJournalFiles(dir).map((f) => (typeof f === 'string' ? f : f.fullPath)));  // listJournalFiles returns { name, fullPath, ... }
  const readFile = io.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const files = listFiles(journalDir).filter((f) => { const d = fileDate(path.basename(f)); return !d || d >= since; }).sort();
  let sig;
  try { sig = files.map((f) => `${f}:${io.readFile ? 0 : fs.statSync(f).size}`).join('|'); } catch { sig = files.join('|'); }
  const key = `${journalDir}|${systemName.toLowerCase()}|${since}`;
  const hit = cache.get(key);
  if (hit && hit.sig === sig) return hit.rows;

  const want = systemName.toLowerCase();
  const rows = [];
  let dock = null;
  for (const f of files) {
    let txt; try { txt = readFile(f); } catch { continue; }
    for (const line of txt.split('\n')) {
      if (!line.includes('"MarketSell"') && !line.includes('"Docked"')) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event === 'Docked') {
        dock = { station: ev.StationName, marketId: ev.MarketID, faction: (ev.StationFaction && ev.StationFaction.Name) || null, system: String(ev.StarSystem || '').toLowerCase(), type: ev.StationType || '' };
        continue;
      }
      if (ev.event !== 'MarketSell' || !dock || dock.system !== want) continue;
      if (ev.AvgPricePaid !== 0 || !(ev.Count > 0)) continue;
      if (/FleetCarrier/i.test(dock.type)) continue;
      rows.push({
        at: ev.timestamp,
        station: dock.station,
        marketId: dock.marketId,
        faction: dock.faction,
        commodity: ev.Type_Localised || ev.Type,
        tonnes: ev.Count,
        price: ev.SellPrice,
        value: ev.TotalSale,
      });
    }
  }
  cache.set(key, { sig, rows });
  return rows;
}

/** Per-body yields in `systemName` from the surface ledger's 'collect' records. Pure. */
export function surfaceYieldsFor(records, systemName) {
  const want = String(systemName || '').toLowerCase();
  const byBody = new Map();
  for (const r of records || []) {
    if (!r || r.k !== 'collect' || String(r.system || '').toLowerCase() !== want || !r.body) continue;
    const b = byBody.get(r.body) || { body: r.body, collects: 0, tonnes: 0, lastAt: null, commodities: {} };
    b.collects += 1;
    const comms = r.commodities && typeof r.commodities === 'object' ? r.commodities : (r.commodity ? { [r.commodity]: r.tonnes || 0 } : {});
    for (const [name, t] of Object.entries(comms)) { const n = Number(t) || 0; b.commodities[name] = (b.commodities[name] || 0) + n; b.tonnes += n; }
    if (!b.lastAt || (r.at && r.at > b.lastAt)) b.lastAt = r.at || b.lastAt;
    byBody.set(r.body, b);
  }
  return [...byBody.values()].sort((a, b) => b.tonnes - a.tonnes);
}

export function _resetFactionGuideCache() { cache.clear(); }
