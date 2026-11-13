/**
 * The faction guide (1.60.32): for one system, what each faction holds and what the commander can do
 * for it with the data already in the app — the last jump's faction readings, the dock dossier's
 * station ownership, the commander's own market snapshots, the active projects, the ship and
 * carrier holds — plus two journal-side feeds from the server (/api/faction-guide): mined-goods
 * sales and surface yields. Facts, no verdicts: it says who gets credited and what it pays.
 */
import type { SystemFactionsEntry, SystemFactionReading } from '@/lib/factions';
import type { KnownStation, PersistedMarketSnapshot, PersistedMarketCommodity, ColonizationProject } from '@/store/types';

export interface CargoLike { items: { commodityId: string; name: string; count: number }[] }
export interface MinedSale { at: string; station: string; marketId: number; faction: string | null; commodity: string; tonnes: number; price: number; value: number }
export interface SurfaceYield { body: string; collects: number; tonnes: number; lastAt: string | null; commodities: Record<string, number> }

export interface GuideStation { marketId: number; name: string; stationType: string; pads: KnownStation['landingPads'] | null; snapshotAt: string | null; lastDocked: string | null }
export interface Held { ship: number; carrier: number }
export interface SellLine { commodityId: string; name: string; station: string; price: number; demand: number; held: Held; bestKnown: { price: number; station: string; system: string } | null; snapshotAt: string }
export interface BuyLine { commodityId: string; name: string; need: number; stock: number; price: number; station: string }
export interface BuyCoverage { projectId: string; projectName: string; total: number; covered: number; lines: BuyLine[]; missing: string[] }
export interface LoopLine { commodityId: string; name: string; buyStation: string; buyFaction: string | null; buyPrice: number; sellStation: string; sellPrice: number; profitPerT: number; load: number; profitPerLoad: number; staleDays: number }
export interface YieldLine { body: string; commodity: string; tonnes: number; collects: number; price: number; demand: number; station: string }
export interface EvidenceRow { at: string; station: string; commodity: string; tonnes: number; value: number; before: number | null; after: number | null; delta: number | null; readingAt: string | null }

export interface FactionBlock {
  name: string;
  influence: number;            // percent
  previous: number | null;      // percent, from the reading before
  delta: number | null;
  government: string | null;
  starred: boolean;
  priorityIndex: number;        // -1 when not starred
  locked: boolean;              // in a War / Civil War / Election
  stations: GuideStation[];
  sellHere: SellLine[];
  buyHere: BuyCoverage[];
  loops: LoopLine[];
  yields: YieldLine[];
  evidence: EvidenceRow[];
}

export interface GuideInput {
  systemName: string;
  entry: SystemFactionsEntry | null | undefined;
  stations: KnownStation[];                              // the system's stations
  snapshots: Record<string, PersistedMarketSnapshot>;    // all snapshots (best-known prices look everywhere)
  projects: ColonizationProject[];                       // active projects in the system
  shipCargo: CargoLike | null;
  carrierCargo: CargoLike | null;
  priorities: string[];
  holdCapacity: number;
  minedSales?: MinedSale[];
  yields?: SurfaceYield[];
  now?: number;
}

const CONFLICT_STATES = new Set(['War', 'CivilWar', 'Election']);
const DAY = 86_400_000;

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sells = (c: PersistedMarketCommodity) => num(c.demand) > 0 && num(c.sellPrice) > 0;   // the station buys it
const stocks = (c: PersistedMarketCommodity) => num(c.stock) > 0 && num(c.buyPrice) > 0;    // the station sells it

const normCache = new Map<string, string>();
export function normCommodity(s: string | null | undefined): string {
  const raw = String(s ?? '');
  const hit = normCache.get(raw);
  if (hit !== undefined) return hit;
  const out = raw.toLowerCase().replace(/^\$/, '').replace(/_name;$/, '').replace(/[^a-z0-9]/g, '');
  if (normCache.size < 20000) normCache.set(raw, out);
  return out;
}

type BestKnown = { price: number; station: string; system: string };
/** One pass over every snapshot: the best price paid anywhere, by normalised id and by normalised name. */
export function buildBestKnownIndex(snapshots: Record<string, PersistedMarketSnapshot>): Map<string, BestKnown> {
  const idx = new Map<string, BestKnown>();
  const put = (k: string, v: BestKnown) => { if (!k) return; const cur = idx.get(k); if (!cur || v.price > cur.price) idx.set(k, v); };
  for (const snap of Object.values(snapshots)) {
    for (const c of snap.commodities) {
      if (!sells(c)) continue;
      const v = { price: num(c.sellPrice), station: snap.stationName, system: snap.systemName };
      put(normCommodity(c.commodityId), v); put(normCommodity(c.name), v);
    }
  }
  return idx;
}
function lookupBestKnown(idx: Map<string, BestKnown>, id: string, name: string): BestKnown | null {
  const a = idx.get(normCommodity(id)), b = idx.get(normCommodity(name));
  if (a && b) return a.price >= b.price ? a : b;
  return a ?? b ?? null;
}

export function isLockedInConflict(f: SystemFactionReading | null | undefined): boolean {
  if (!f) return false;
  if (f.state && CONFLICT_STATES.has(f.state)) return true;
  return (f.active ?? []).some((s) => CONFLICT_STATES.has(s));
}

function heldOf(cargo: CargoLike | null, id: string, name: string): number {
  if (!cargo) return 0;
  const a = normCommodity(id), b = normCommodity(name);
  let n = 0;
  for (const it of cargo.items) {
    const x = normCommodity(it.commodityId), y = normCommodity(it.name);
    if (x === a || x === b || y === a || y === b) n += it.count;
  }
  return n;
}

function staleDays(iso: string | null | undefined, now: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / DAY)) : 9999;
}

function sameCommodity(c: PersistedMarketCommodity, id: string, name: string): boolean {
  const a = normCommodity(id), b = normCommodity(name);
  const x = normCommodity(c.commodityId), y = normCommodity(c.name);
  return x === a || x === b || y === a || y === b;
}

/** Highest price any snapshot (anywhere, with demand) pays for a commodity. */
export function bestKnownSell(snapshots: Record<string, PersistedMarketSnapshot>, commodityId: string, name: string): BestKnown | null {
  return lookupBestKnown(buildBestKnownIndex(snapshots), commodityId, name);
}

export function buildFactionGuide(input: GuideInput): FactionBlock[] {
  const now = input.now ?? Date.now();
  const entry = input.entry;
  if (!entry || !entry.factions.length) return [];
  const sysLower = input.systemName.toLowerCase();
  const priorities = input.priorities.map((p) => p.trim().toLowerCase());
  const prev = entry.history.length >= 2 ? entry.history[entry.history.length - 2] : null;
  const snapOf = (marketId: number) => input.snapshots[String(marketId)] ?? null;
  const stationsHere = input.stations.filter((s) => String(s.systemName ?? '').toLowerCase() === sysLower && !/Construction Site|Carrier/i.test(`${s.stationName} ${s.stationType}`));
  const factionOf = (marketId: number): string | null => stationsHere.find((s) => s.marketId === marketId)?.faction ?? null;
  // Indexes built once per guide, not once per line: the first build scanned every snapshot row for every sell
  // line (5,871 rows × hundreds of lines, four regexes a comparison) and hung the system page (1.60.34).
  const bestKnownIdx = buildBestKnownIndex(input.snapshots);
  const sellIndexOf = new Map<number, Map<string, PersistedMarketCommodity>>();
  const sellIndex = (snap: PersistedMarketSnapshot) => {
    let m = sellIndexOf.get(snap.marketId);
    if (!m) { m = new Map(); for (const c of snap.commodities) if (sells(c)) m.set(normCommodity(c.commodityId), c); sellIndexOf.set(snap.marketId, m); }
    return m;
  };

  const blocks: FactionBlock[] = entry.factions.map((f) => {
    const mine = stationsHere.filter((s) => (s.faction ?? '').toLowerCase() === f.name.toLowerCase());
    const stations: GuideStation[] = mine.map((s) => ({ marketId: s.marketId, name: s.stationName, stationType: s.stationType, pads: s.landingPads ?? null, snapshotAt: snapOf(s.marketId)?.updatedAt ?? null, lastDocked: s.lastDocked ?? null }));
    const mySnaps = mine.map((s) => snapOf(s.marketId)).filter((x): x is PersistedMarketSnapshot => !!x);

    // Sell here: what the faction's markets pay for, held stock first, then price.
    const sellHere: SellLine[] = [];
    for (const snap of mySnaps) {
      for (const c of snap.commodities) {
        if (!sells(c)) continue;
        sellHere.push({
          commodityId: c.commodityId, name: c.name, station: snap.stationName, price: num(c.sellPrice), demand: num(c.demand),
          held: { ship: heldOf(input.shipCargo, c.commodityId, c.name), carrier: heldOf(input.carrierCargo, c.commodityId, c.name) },
          bestKnown: lookupBestKnown(bestKnownIdx, c.commodityId, c.name), snapshotAt: snap.updatedAt,
        });
      }
    }
    // one line per commodity: the faction's best price for it
    const bestPerCommodity = new Map<string, SellLine>();
    for (const l of sellHere) { const k = normCommodity(l.commodityId) || normCommodity(l.name); const cur = bestPerCommodity.get(k); if (!cur || l.price > cur.price) bestPerCommodity.set(k, l); }
    const sellLines = [...bestPerCommodity.values()].sort((a, b) => {
      const ha = a.held.ship + a.held.carrier, hb = b.held.ship + b.held.carrier;
      if ((ha > 0) !== (hb > 0)) return ha > 0 ? -1 : 1;
      return b.price - a.price;
    });

    // Buy here: the system's active projects against the faction's stock.
    const buyHere: BuyCoverage[] = input.projects.map((p) => {
      const lines: BuyLine[] = []; const missing: string[] = []; let total = 0, covered = 0;
      for (const c of p.commodities) {
        const need = c.requiredQuantity - c.providedQuantity;
        if (need <= 0) continue;
        total += need;
        let best: BuyLine | null = null;
        for (const snap of mySnaps) {
          const it = snap.commodities.find((m) => stocks(m) && sameCommodity(m, c.commodityId, c.name));
          if (!it) continue;
          const stock = num(it.stock);
          if (!best || stock > best.stock) best = { commodityId: c.commodityId, name: c.name, need, stock, price: it.buyPrice, station: snap.stationName };
        }
        if (best) { lines.push(best); covered += Math.min(best.stock, need); } else missing.push(c.name);
      }
      lines.sort((a, b) => b.need - a.need);
      return { projectId: p.id, projectName: p.name, total, covered, lines, missing };
    }).filter((b) => b.total > 0);

    // Loops: buy anywhere in the system, sell at this faction's station, sized to the hold.
    const loops: LoopLine[] = [];
    for (const sellSnap of mySnaps) {
      for (const buyStation of stationsHere) {
        if (buyStation.marketId === sellSnap.marketId) continue;
        const buySnap = snapOf(buyStation.marketId); if (!buySnap) continue;
        const sellBy = sellIndex(sellSnap);
        for (const b of buySnap.commodities) {
          if (!stocks(b)) continue;
          const s = sellBy.get(normCommodity(b.commodityId));
          if (!s) continue;
          const sellPrice = num(s.sellPrice), demand = num(s.demand), stock = num(b.stock);
          const profitPerT = sellPrice - b.buyPrice; if (profitPerT <= 0) continue;
          const load = Math.max(0, Math.min(input.holdCapacity || 0, stock, demand));
          loops.push({ commodityId: b.commodityId, name: b.name, buyStation: buySnap.stationName, buyFaction: factionOf(buyStation.marketId), buyPrice: b.buyPrice, sellStation: sellSnap.stationName, sellPrice, profitPerT, load, profitPerLoad: profitPerT * load, staleDays: Math.max(staleDays(buySnap.updatedAt, now), staleDays(sellSnap.updatedAt, now)) });
        }
      }
    }
    loops.sort((a, b) => b.profitPerLoad - a.profitPerLoad);

    // Yields: what the commander's rigs pulled from the system's bodies that this faction pays for.
    const yields: YieldLine[] = [];
    for (const y of input.yields ?? []) {
      for (const [commodity, tonnes] of Object.entries(y.commodities)) {
        const line = bestPerCommodity.get(normCommodity(commodity));
        if (!line) continue;
        yields.push({ body: y.body, commodity, tonnes, collects: y.collects, price: line.price, demand: line.demand, station: line.station });
      }
    }
    yields.sort((a, b) => b.price * b.tonnes - a.price * a.tonnes);

    // Evidence: mined sales to this faction, each with the faction's reading before and after.
    const hist = entry.history.slice().sort((a, b) => a.at.localeCompare(b.at));
    const evidence: EvidenceRow[] = (input.minedSales ?? []).filter((m) => (m.faction ?? '').toLowerCase() === f.name.toLowerCase()).map((m) => {
      const beforePt = [...hist].reverse().find((h) => h.at <= m.at && h.influence[f.name] != null) ?? null;
      const afterPt = hist.find((h) => h.at > m.at && h.influence[f.name] != null) ?? null;
      const before = beforePt ? +(beforePt.influence[f.name] * 100).toFixed(1) : null;
      const after = afterPt ? +(afterPt.influence[f.name] * 100).toFixed(1) : null;
      return { at: m.at, station: m.station, commodity: m.commodity, tonnes: m.tonnes, value: m.value, before, after, delta: before != null && after != null ? +(after - before).toFixed(1) : null, readingAt: afterPt?.at ?? null };
    }).sort((a, b) => b.at.localeCompare(a.at));

    const pi = priorities.indexOf(f.name.toLowerCase());
    const influence = +(f.influence * 100).toFixed(1);
    const previous = prev && prev.influence[f.name] != null ? +(prev.influence[f.name] * 100).toFixed(1) : null;
    return {
      name: f.name, influence, previous, delta: previous != null ? +(influence - previous).toFixed(1) : null, government: f.government,
      starred: pi >= 0, priorityIndex: pi, locked: isLockedInConflict(f),
      stations, sellHere: sellLines, buyHere, loops: loops.slice(0, 8), yields, evidence,
    };
  });

  return blocks.sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    if (a.starred && b.starred) return a.priorityIndex - b.priorityIndex;
    return b.influence - a.influence;
  });
}
