// Sell Cargo — what you hold, what it fetches here / locally / across the galaxy, trade nearby,
// and a year of price history per commodity. Server does the work (/api/sell/plan): Cargo.json,
// the carrier record, your own fresh market snapshots (the private markets nobody uploads) and
// Ardent's live listings (EDDN) — cached an hour per lookup. This page shows the plan, edits the
// searched list, and draws the sparklines. Built iPad-first: one table, one range, one refresh.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMMODITY_PRICES } from '@/data/commodityPrices';
import { COMMODITIES } from '@/data/commodities';
import { sseSubscribe } from '@/services/sseBus';

interface Offer {
  price: number; station: string | null; system: string | null; marketId?: number | null;
  distance: number | null; at: string | null; demand?: number | null; stock?: number | null; pad?: number | null;
  source: 'yours' | 'ardent'; onlyYours?: boolean; cg?: boolean;
}
interface PlanRow {
  key: string; name: string; ship: number; carrier: number; searched: number | null; tonnes: number; load: number;
  here: Offer | null; local: Offer | null; galaxy: Offer | null; top: Offer | null; unknownToArdent: boolean;
}
interface TradeRow { key: string; name: string; buy: Offer; sell: Offer; perTonne: number; perLoad: number | null; leg: number | null }
interface DayPoint { d: number; mean: number; best: number; bestSt: string | null; galaxy: number; galaxySt: string | null; med: number; sale: number; buy: number }
interface Plan {
  at: string;
  me: { system: string; coords: unknown } | null;
  dock: { marketId: number; station: string; system: string; since: string; snapshotAt: string | null } | null;
  ship: { type: string | null; name: string | null; ident: string | null; capacity: number | null; items: { name: string; count: number }[]; at: string | null };
  carrier: { callsign: string; items: { name: string; count: number }[]; isEstimate: boolean; at: string | null; ledger?: { statsTotal: number | null; statsAt: string | null; itemised: number; unaccounted: number | null } | null } | null;
  range: number; carrierRange: number;
  rows: PlanRow[];
  totals: { tonnes: number; here: number; local: number; galaxy: number };
  trade: { systems: number; load: number | null; rows: TradeRow[] };
  history: Record<string, { today: number; days: DayPoint[] }>;
  /** Fast first paint: built from cache alone; `pending` lookups are filling in behind it. */
  partial?: boolean; pending?: number;
  error?: string;
}
interface Searched { name: string; tonnes: number }
interface SellAtRow {
  key: string; name: string; ship: number; carrier: number; tonnes: number;
  offer: Offer | null; mean: number; vsMean: number | null; demandShort: boolean; value: number; elsewhere: Offer | null; listedHere: boolean;
}
interface SellAt { at: string; system: string | null; distance: number | null; known: boolean; stations: string[]; rows: SellAtRow[]; total: number; error?: string }

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };
const RANGES = [20, 50, 100, 500];
const LS_SEARCH = 'edca-sell-searched';
const LS_RANGE = 'edca-sell-range';

const cr = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);
const fmt = (n: number) => Math.round(n).toLocaleString();
const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
};
const ly = (d: number | null | undefined) => (d == null ? '' : d < 1 ? 'here' : `${Math.round(d)} ly`);
const padLabel = (p: number | null | undefined) => (p === 3 ? 'L' : p === 2 ? 'M' : p === 1 ? 'S' : null);

/** Every name the page can autocomplete: the full price table plus the colonisation dictionary. */
const ALL_NAMES: string[] = Array.from(new Set([...COMMODITY_PRICES.map((r) => r.name), ...COMMODITIES.map((c) => c.name)])).sort((a, b) => a.localeCompare(b));

function loadSearched(): Searched[] {
  try { const v = JSON.parse(localStorage.getItem(LS_SEARCH) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string').slice(0, 20) : []; } catch { return []; }
}
function loadRange(): number { try { const n = Number(localStorage.getItem(LS_RANGE)); return RANGES.includes(n) ? n : 50; } catch { return 50; } }

// ---- sparkline ------------------------------------------------------------------------------------
const SERIES: { k: keyof DayPoint; label: string; color: string; dots?: boolean }[] = [
  { k: 'mean', label: 'galactic average', color: '#94a3b8' },
  { k: 'best', label: 'your best market', color: '#38bdf8' },
  { k: 'galaxy', label: 'galaxy top (Ardent)', color: '#34d399' },
  { k: 'med', label: 'galaxy median of top 100', color: '#a78bfa' },
  { k: 'sale', label: 'you sold at', color: '#fbbf24', dots: true },
];

function Sparkline({ h, days, today, big }: { h: number; days: DayPoint[]; today: number; big?: boolean }) {
  const W = big ? 640 : 120;
  const H = h;
  const span = 365;
  const x0 = today - span;
  const pts = days.filter((p) => p.d >= x0);
  const values = pts.flatMap((p) => SERIES.map((s) => Number(p[s.k]) || 0)).filter((v) => v > 0);
  if (!values.length) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const sx = (d: number) => ((d - x0) / span) * W;
  const sy = (v: number) => (hi === lo ? H / 2 : H - 3 - ((v - lo) / (hi - lo)) * (H - 6));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" aria-hidden="true">
      {SERIES.map((s) => {
        const ps = pts.filter((p) => (Number(p[s.k]) || 0) > 0);
        if (!ps.length) return null;
        if (s.dots || ps.length === 1) return ps.map((p) => <circle key={`${s.k}-${p.d}`} cx={sx(p.d)} cy={sy(Number(p[s.k]))} r={big ? 3 : 1.6} fill={s.color} />);
        return <polyline key={s.k} fill="none" stroke={s.color} strokeWidth={big ? 1.6 : 1} points={ps.map((p) => `${sx(p.d).toFixed(1)},${sy(Number(p[s.k])).toFixed(1)}`).join(' ')} />;
      })}
      {big && (
        <>
          <text x={2} y={10} fontSize={10} fill="#94a3b8">{fmt(hi)}</text>
          <text x={2} y={H - 2} fontSize={10} fill="#94a3b8">{fmt(lo)}</text>
          <text x={W - 2} y={H - 2} fontSize={10} fill="#94a3b8" textAnchor="end">today</text>
          <text x={W - 2} y={10} fontSize={10} fill="#94a3b8" textAnchor="end">last 12 months</text>
        </>
      )}
    </svg>
  );
}

function History({ series }: { series: { today: number; days: DayPoint[] } }) {
  const latest = [...series.days].reverse();
  const last = (k: keyof DayPoint) => latest.find((p) => (Number(p[k]) || 0) > 0);
  return (
    <div className="space-y-2">
      <Sparkline h={120} days={series.days} today={series.today} big />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {SERIES.map((s) => {
          const p = last(s.k);
          if (!p) return null;
          const v = Number(p[s.k]);
          const where = s.k === 'best' ? p.bestSt : s.k === 'galaxy' ? p.galaxySt : null;
          return (
            <span key={s.k} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="tabular-nums text-foreground">{fmt(v)}</span>
              {where ? <span className="text-muted-foreground">at {where}</span> : null}
              <span className="text-muted-foreground">({Math.max(0, series.today - p.d)}d ago)</span>
            </span>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        Recording began 2026-09-04: every market you open, a daily galaxy sample from Ardent, and your own sales from the last year of journals. The line gets its meaning with weeks on it.
      </p>
    </div>
  );
}

// ---- offer cell -------------------------------------------------------------------------------------
function OfferCell({ o, best, tonnes, note }: { o: Offer | null; best: boolean; tonnes: number; note?: string }) {
  if (!o) return <td className="px-2 py-2 align-top text-muted-foreground"><span>—</span>{note ? <div className="mt-0.5 text-[10px] text-muted-foreground/70">{note}</div> : null}</td>;
  const place = [o.station, o.system && o.system !== o.station ? o.system : null].filter(Boolean).join(' · ');
  const pad = padLabel(o.pad);
  return (
    <td className="px-2 py-2 align-top">
      <span className={`inline-block rounded px-1.5 py-0.5 tabular-nums ${best ? 'bg-emerald-500/20 text-emerald-200' : 'text-foreground'}`} title={`${fmt(o.price)} cr/t · ${o.source === 'yours' ? 'from your own market record' : 'Ardent (EDDN)'}${o.demand != null ? ` · demand ${fmt(o.demand)}` : ''}${o.stock != null && o.stock > 0 ? ` · stock ${fmt(o.stock)}` : ''}`}>
        {fmt(o.price)}
      </span>
      {tonnes > 0 ? <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">{cr(o.price * tonnes)}</span> : null}
      <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
        {place}
        {o.distance != null ? <> · {ly(o.distance)}</> : null}
        {pad ? <> · {pad} pad</> : null}
        {o.at ? <> · {when(o.at)}</> : null}
        {o.cg ? <span className="ml-1 text-amber-300" title="Demand of 999,999 is how a Community Goal market reads: real, generous, and gone when the goal ends">community goal · limited time</span> : o.demand != null && o.demand > 0 ? <> · demand {cr(o.demand)}</> : null}
        {o.onlyYours ? <span className="ml-1 text-sky-300">only in your records</span> : null}
      </div>
    </td>
  );
}

// ---- page ---------------------------------------------------------------------------------------------
export function SellPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRangeState] = useState<number>(loadRange);
  const [searched, setSearchedState] = useState<Searched[]>(loadSearched);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null); // expanded history row
  const [tonnesDraft, setTonnesDraft] = useState<Record<string, string>>({});
  const reqSeq = useRef(0);

  const setRange = (n: number) => { setRangeState(n); try { localStorage.setItem(LS_RANGE, String(n)); } catch { /* ignore */ } };
  const setSearched = (next: Searched[]) => { setSearchedState(next); try { localStorage.setItem(LS_SEARCH, JSON.stringify(next)); } catch { /* ignore */ } };

  // Fast first paint: the server answers from your own snapshots and whatever Ardent already told
  // it, marks the plan partial, and fills the rest in behind; sell_plan_updated says when to refetch.
  const load = useCallback(async (r: number, s: Searched[]) => {
    const seq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(q(`/api/sell/plan?range=${r}&searched=${encodeURIComponent(JSON.stringify(s))}&fast=1`));
      const d = (await res.json()) as Plan;
      if (seq !== reqSeq.current) return;
      if (d && !d.error) setPlan(d); else setError(d?.error || `HTTP ${res.status}`);
    } catch (e) {
      if (seq === reqSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range, searched); }, [range, searched, load]);
  useEffect(() => sseSubscribe('sell_plan_updated', () => { void load(range, searched); }), [range, searched, load]);

  // ---- sell at one system ----
  const [atQuery, setAtQuery] = useState('');
  const [at, setAt] = useState<SellAt | null>(null);
  const [atLoading, setAtLoading] = useState(false);
  const atSeq = useRef(0);
  const loadAt = useCallback(async (system: string) => {
    const name = system.trim();
    if (!name) { setAt(null); return; }
    const seq = ++atSeq.current;
    setAtLoading(true);
    try {
      const res = await fetch(q(`/api/sell/at?system=${encodeURIComponent(name)}`));
      const d = (await res.json()) as SellAt;
      if (seq === atSeq.current) setAt(d);
    } catch (e) {
      if (seq === atSeq.current) setAt({ at: new Date().toISOString(), system: name, distance: null, known: false, stations: [], rows: [], total: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === atSeq.current) setAtLoading(false);
    }
  }, []);
  useEffect(() => sseSubscribe('sell_plan_updated', () => { if (at?.system) void loadAt(at.system); }), [at?.system, loadAt]);
  // Systems already on the page — the buyers the plan found, where you are, where you docked.
  const atSuggestions = useMemo(() => {
    const s = atQuery.trim().toLowerCase();
    const names = new Set<string>();
    if (plan?.dock?.system) names.add(plan.dock.system);
    if (plan?.me?.system) names.add(plan.me.system);
    for (const r of plan?.rows ?? []) for (const o of [r.here, r.local, r.galaxy, r.top]) if (o?.system) names.add(o.system);
    for (const t of plan?.trade.rows ?? []) if (t.sell?.system) names.add(t.sell.system);
    return [...names].filter((n) => !s || n.toLowerCase().includes(s)).filter((n) => n.toLowerCase() !== s).slice(0, 8);
  }, [atQuery, plan]);

  const suggestions = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    const have = new Set(searched.map((x) => x.name.toLowerCase()));
    return ALL_NAMES.filter((n) => n.toLowerCase().includes(s) && !have.has(n.toLowerCase())).slice(0, 8);
  }, [query, searched]);

  const addSearched = (name: string) => {
    if (!name.trim()) return;
    const exact = ALL_NAMES.find((n) => n.toLowerCase() === name.trim().toLowerCase()) || suggestions[0] || name.trim();
    if (searched.some((x) => x.name.toLowerCase() === exact.toLowerCase())) { setQuery(''); return; }
    setSearched([...searched, { name: exact, tonnes: plan?.ship.capacity || 0 }]);
    setQuery('');
  };
  const removeSearched = (name: string) => setSearched(searched.filter((x) => x.name.toLowerCase() !== name.toLowerCase()));
  const commitTonnes = (row: PlanRow) => {
    const raw = tonnesDraft[row.key];
    if (raw == null) return;
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setTonnesDraft((d) => { const c = { ...d }; delete c[row.key]; return c; });
    setSearched(searched.map((x) => (x.name.toLowerCase() === row.name.toLowerCase() ? { ...x, tonnes: n } : x)));
  };

  const shipTonnes = plan ? plan.ship.items.reduce((a, i) => a + (i.count || 0), 0) : 0;
  const carrierTonnes = plan?.carrier ? plan.carrier.items.reduce((a, i) => a + (i.count || 0), 0) : 0;
  const topItems = (items: { name: string; count: number }[]) => [...items].sort((a, b) => b.count - a.count).slice(0, 4).map((i) => `${i.name} ${i.count}`).join(' · ');
  const bestCol = (r: PlanRow): 'here' | 'local' | 'galaxy' | null => {
    const g = r.galaxy || r.top;
    const c = [['here', r.here?.price || 0], ['local', r.local?.price || 0], ['galaxy', g?.price || 0]] as const;
    const m = Math.max(...c.map((x) => x[1]));
    if (m <= 0) return null;
    return (c.find((x) => x[1] === m)?.[0] as 'here' | 'local' | 'galaxy') || null;
  };

  return (
    <div className="space-y-4 p-4">
      {/* ---- hero ---- */}
      <div className="edc-chamfer edc-grid-bg relative border border-border bg-card/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-wide">{'💰'} SELL CARGO</h1>
            {plan?.partial ? <span className="text-[10px] tracking-widest text-amber-300" title="Shown from your own markets and what Ardent already answered; the rest is filling in">CHECKING ARDENT · {plan.pending} PENDING</span> : loading ? <span className="text-[10px] tracking-widest text-amber-300">LOOKING UP…</span> : plan ? <span className="text-[10px] tracking-widest text-muted-foreground">PRICED {when(plan.at).toUpperCase()}</span> : null}
          </div>
          <div className="text-[11px] text-muted-foreground">your markets (30 days) · Ardent live listings (EDDN) · carriers excluded</div>
        </div>
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        {/* ---- inventory ---- */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-border bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ship hold{plan?.ship.name ? ` · ${plan.ship.name}` : ''}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{shipTonnes}{plan?.ship.capacity ? <span className="text-base text-muted-foreground"> / {plan.ship.capacity} t</span> : <span className="text-base text-muted-foreground"> t</span>}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{plan?.ship.items.length ? topItems(plan.ship.items) : 'empty'}{plan?.ship.at ? ` · ${when(plan.ship.at)}` : ''}</div>
          </div>
          <div className="rounded border border-border bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Carrier{plan?.carrier ? ` · ${plan.carrier.callsign}` : ''}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{carrierTonnes}<span className="text-base text-muted-foreground"> t</span></div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {plan?.carrier ? (plan.carrier.items.length ? topItems(plan.carrier.items) : (plan.carrier.ledger ? 'nothing itemised yet' : 'no goods with sell orders')) : 'no carrier set in Settings'}
              {plan?.carrier?.at ? ` · ${when(plan.carrier.at)}` : ''}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">
              {plan?.carrier?.ledger
                ? <>{plan.carrier.ledger.statsTotal != null ? `${plan.carrier.ledger.statsTotal.toLocaleString()} t aboard per the game · ` : ''}{plan.carrier.ledger.itemised.toLocaleString()} t itemised from the transaction ledger{plan.carrier.ledger.unaccounted ? ` · ${Math.abs(plan.carrier.ledger.unaccounted).toLocaleString()} t ${plan.carrier.ledger.unaccounted > 0 ? 'not itemised' : 'over the game\'s last total'}` : ''}</>
                : 'The transaction ledger builds on the first journal pass after launch; until then only goods with a sell order are visible.'}
            </div>
          </div>
          <div className="rounded border border-border bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">You are at</div>
            <div className="mt-1 text-base font-semibold">{plan?.dock ? plan.dock.station : plan?.me ? plan.me.system : 'position unknown'}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {plan?.dock ? `${plan.dock.system} · docked${plan.dock.snapshotAt ? ` · market read ${when(plan.dock.snapshotAt)}` : ' · market not read yet'}` : plan?.me ? 'in space — no "here" price' : 'no journal position yet'}
            </div>
          </div>
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="relative">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSearched(query); } }}
            placeholder="Search any commodity"
            className="w-64 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60"
          />
          {suggestions.length > 0 && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-border bg-card shadow-lg">
              {suggestions.map((n) => (
                <button key={n} type="button" onClick={() => addSearched(n)} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-muted/40">{n}</button>
              ))}
            </div>
          )}
        </div>
        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">Local within</span>
        {RANGES.map((n) => (
          <button key={n} type="button" onClick={() => setRange(n)} className={`rounded border px-2 py-0.5 ${range === n ? 'border-amber-500/50 text-amber-300' : 'border-border text-muted-foreground hover:text-foreground'}`}>{n} ly</button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <button type="button" onClick={() => void load(range, searched)} disabled={loading} className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-xs text-sky-300 hover:bg-muted/50 disabled:opacity-40">Refresh</button>
        {searched.length > 0 && <button type="button" onClick={() => setSearched([])} className="px-1 text-slate-400 hover:text-foreground">clear searched</button>}
      </div>

      {/* ---- rows ---- */}
      <section className="overflow-x-auto rounded border border-border">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-2">Commodity</th>
              <th className="px-2 py-2">Tonnes</th>
              <th className="px-2 py-2">Here</th>
              <th className="px-2 py-2">Local best · {range} ly</th>
              <th className="px-2 py-2">Galaxy best · {plan?.carrierRange ?? 500} ly</th>
            </tr>
          </thead>
          <tbody>
            {plan && plan.rows.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Nothing in the hold or on the carrier. Search a commodity to price it.</td></tr>
            )}
            {!plan && !error && (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Reading the hold and asking the markets…</td></tr>
            )}
            {plan?.rows.map((r) => {
              const best = bestCol(r);
              const hist = plan.history[r.key];
              const hasHist = !!hist && hist.days.length > 0;
              const isSearched = r.searched != null;
              const draft = tonnesDraft[r.key];
              const g = r.galaxy || r.top;
              return (
                <RowGroup key={r.key} open={open === r.key} history={hasHist ? <History series={hist} /> : null}>
                  <td className="px-2 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} className="text-left font-medium text-foreground hover:text-sky-200" title={hasHist ? 'Tap for the price history' : 'No history recorded yet'}>{r.name}</button>
                      {isSearched && <span className="rounded bg-sky-500/15 px-1 text-[10px] text-sky-200">searched</span>}
                      {isSearched && <button type="button" onClick={() => removeSearched(r.name)} className="text-slate-400 hover:text-red-300" title="Remove">×</button>}
                    </div>
                    {hasHist ? <div className="mt-1"><Sparkline h={26} days={hist.days} today={hist.today} /></div> : null}
                    {r.unknownToArdent ? <div className="mt-0.5 text-[10px] text-amber-300/80">no buyer anywhere in your records or Ardent</div> : null}
                  </td>
                  <td className="px-2 py-2 align-top text-muted-foreground">
                    {isSearched ? (
                      <input
                        value={draft ?? String(r.searched ?? 0)} inputMode="numeric"
                        onChange={(e) => setTonnesDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                        onBlur={() => commitTonnes(r)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right tabular-nums text-foreground"
                        title="Tonnes to value this at"
                      />
                    ) : (
                      <div className="tabular-nums">
                        {r.ship > 0 ? <div>{r.ship} ship</div> : null}
                        {r.carrier > 0 ? <div>{r.carrier} carrier</div> : null}
                      </div>
                    )}
                  </td>
                  <OfferCell o={r.here} best={best === 'here'} tonnes={r.tonnes} note={plan.dock ? 'not bought here' : 'not docked'} />
                  <OfferCell o={r.local} best={best === 'local'} tonnes={r.tonnes} note={`none within ${range} ly with demand for ${r.load} t`} />
                  <OfferCell o={g} best={best === 'galaxy'} tonnes={r.tonnes} note={`no buyer within ${plan.carrierRange} ly with demand for ${r.load} t`} />
                </RowGroup>
              );
            })}
          </tbody>
          {plan && plan.totals.tonnes > 0 && (
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-2 py-2">Sell everything</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{fmt(plan.totals.tonnes)} t</td>
                <td className="px-2 py-2 tabular-nums">{plan.totals.here > 0 ? cr(plan.totals.here) : '—'}</td>
                <td className="px-2 py-2 tabular-nums">{plan.totals.local > 0 ? cr(plan.totals.local) : '—'}</td>
                <td className="px-2 py-2 tabular-nums">{plan.totals.galaxy > 0 ? cr(plan.totals.galaxy) : '—'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      <p className="text-[11px] text-muted-foreground/70">
        Green is the best of the three for that line. Totals price the tonnes you hold at each column's best; searched rows count only with a tonnage. Demand must cover your load, or the buyer is skipped. "Galaxy" is one carrier jump; when the overall top of book beats it, that is shown instead, with its distance.
      </p>

      {/* ---- trade nearby ---- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide">TRADE NEARBY</h2>
          <span className="text-xs text-muted-foreground">
            lowest buy → highest sell within {range} ly · {plan ? `${plan.trade.systems} system${plan.trade.systems === 1 ? '' : 's'} checked` : ''}{plan?.trade.load ? ` · per load of ${plan.trade.load} t` : ' · per tonne (ship capacity unknown)'}
          </span>
        </div>
        {plan && plan.trade.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pair within {range} ly clears 1,000 cr/t with stock and demand for a load. Widen the range, or open more markets so your records have both sides.</p>
        ) : plan ? (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2">Commodity</th>
                  <th className="px-2 py-2">Buy at</th>
                  <th className="px-2 py-2">Sell at</th>
                  <th className="px-2 py-2">Profit / t</th>
                  <th className="px-2 py-2">Per load</th>
                  <th className="px-2 py-2">Leg</th>
                </tr>
              </thead>
              <tbody>
                {plan.trade.rows.map((t) => (
                  <tr key={t.key} className="border-t border-border/60">
                    <td className="px-2 py-2 align-top font-medium">{t.name}</td>
                    <OfferCell o={t.buy} best={false} tonnes={0} />
                    <OfferCell o={t.sell} best={false} tonnes={0} />
                    <td className="px-2 py-2 align-top tabular-nums text-emerald-200">{fmt(t.perTonne)}</td>
                    <td className="px-2 py-2 align-top tabular-nums">{t.perLoad != null ? cr(t.perLoad) : '—'}</td>
                    <td className="px-2 py-2 align-top tabular-nums text-muted-foreground">{t.leg != null ? `${t.leg} ly` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground/70">
          Stock must cover a load at the buy side and demand at the sell side. Your own records win over Ardent when they are newer, and add the stations Ardent has never heard of. Read the freshness on each leg before you fly it.
        </p>
      </section>

      {/* ---- sell at one system ---- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide">SELL AT…</h2>
          <span className="text-xs text-muted-foreground">everything you hold, priced at one system — what else should ride along</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <input
              value={atQuery} onChange={(e) => setAtQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void loadAt(atQuery); } }}
              placeholder="System, e.g. LFT 65"
              className="w-64 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60"
            />
            {atQuery.trim() && atSuggestions.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-border bg-card shadow-lg">
                {atSuggestions.map((n) => (
                  <button key={n} type="button" onClick={() => { setAtQuery(n); void loadAt(n); }} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-muted/40">{n}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => void loadAt(atQuery)} disabled={atLoading || !atQuery.trim()} className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-xs text-sky-300 hover:bg-muted/50 disabled:opacity-50">
            {atLoading ? 'Pricing…' : 'Price it'}
          </button>
          {!atQuery.trim() && atSuggestions.length > 0 && (
            <span className="text-[11px] text-muted-foreground">try: {atSuggestions.slice(0, 5).map((n) => <button key={n} type="button" onClick={() => { setAtQuery(n); void loadAt(n); }} className="ml-1 text-sky-300 hover:underline">{n}</button>)}</span>
          )}
        </div>
        {at && at.error ? <p className="text-xs text-red-300">{at.error}</p> : null}
        {at && !at.error && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{at.system}</span>
              {at.distance != null ? <> · {ly(at.distance)}</> : null}
              {at.stations.length ? <> · {at.stations.length} station{at.stations.length === 1 ? '' : 's'} with prices: {at.stations.slice(0, 4).join(', ')}{at.stations.length > 4 ? '…' : ''}</> : null}
              {!at.known ? <span className="ml-1 text-amber-300/80">no market data for this system in Ardent or your records</span> : null}
            </div>
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2">Commodity</th>
                    <th className="px-2 py-2">You hold</th>
                    <th className="px-2 py-2">Best there</th>
                    <th className="px-2 py-2">vs mean</th>
                    <th className="px-2 py-2">Value</th>
                    <th className="px-2 py-2">Best elsewhere</th>
                  </tr>
                </thead>
                <tbody>
                  {at.rows.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">Nothing held.</td></tr>}
                  {at.rows.map((r) => {
                    const dim = !r.offer || (r.vsMean != null && r.vsMean < 1);
                    return (
                      <tr key={r.key} className={`border-t border-border/60 ${dim ? 'text-muted-foreground/70' : ''}`}>
                        <td className="px-2 py-2 align-top font-medium">{r.name}</td>
                        <td className="px-2 py-2 align-top tabular-nums text-muted-foreground">
                          {r.ship > 0 ? <div>{r.ship} ship</div> : null}
                          {r.carrier > 0 ? <div>{r.carrier} carrier</div> : null}
                        </td>
                        <OfferCell o={r.offer} best={!!r.offer && r.vsMean != null && r.vsMean >= 1.2} tonnes={0} note={r.listedHere ? 'no demand there' : 'not traded there'} />
                        <td className="px-2 py-2 align-top tabular-nums">
                          {r.vsMean != null ? <span className={r.vsMean >= 1.2 ? 'text-emerald-200' : r.vsMean < 1 ? 'text-red-300/80' : ''}>×{r.vsMean.toFixed(2)}</span> : '—'}
                          {r.mean > 0 ? <div className="text-[10px] text-muted-foreground">mean {fmt(r.mean)}</div> : null}
                          {r.demandShort && r.offer ? <div className="text-[10px] text-amber-300/80">demand {fmt(r.offer.demand || 0)} t &lt; {fmt(r.tonnes)} t held</div> : null}
                        </td>
                        <td className="px-2 py-2 align-top tabular-nums">{r.value > 0 ? cr(r.value) : '—'}</td>
                        <OfferCell o={r.elsewhere} best={!!r.elsewhere && !!r.offer && r.elsewhere.price > r.offer.price * 1.1} tonnes={0} note="not looked up yet" />
                      </tr>
                    );
                  })}
                </tbody>
                {at.total > 0 && (
                  <tfoot>
                    <tr className="border-t border-border font-medium">
                      <td className="px-2 py-2" colSpan={4}>Sell everything it wants</td>
                      <td className="px-2 py-2 tabular-nums">{cr(at.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Green is 1.2× the galactic mean or better; red is under it. "Best elsewhere" is the plan's galaxy-wide buyer when it has been looked up, so you can see what selling here gives up. Demand is checked against everything you hold.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/** A table row plus, when open, a full-width history row under it. */
function RowGroup({ children, open, history }: { children: React.ReactNode; open: boolean; history: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-border/60">{children}</tr>
      {open && (
        <tr className="border-t border-border/40 bg-muted/10">
          <td colSpan={5} className="px-3 py-3">{history ?? <span className="text-xs text-muted-foreground">No history for this commodity yet. It starts with the next market you open.</span>}</td>
        </tr>
      )}
    </>
  );
}
