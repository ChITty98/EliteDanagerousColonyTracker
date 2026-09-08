// 📖 Commander's Log — a log of EVENTS, not a narrative.
//
// Every line comes from a journal field or an app record (server/journal/commanderLog.js), so a
// line is either right or a bug; nothing here is generated. Weight carries the meaning — a claim
// is huge, a death is major, a landing on an ordinary rock is routine — and the RESOLUTION is what
// decays with age: the last 30 days read sitting by sitting, a year reads by week, the whole
// history reads by month, while anything major or above always keeps its own line. Photos are
// linked from the gallery, never copied; the sighting they belong to is one click away.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStationTypeInfo } from '@/data/stationTypes';
import { DEFAULT_HIGHLIGHT_STATIONS } from '@/features/domain/domainHelpers';
import { useAppStore } from '@/store';

interface LogEvent {
  at: string; weight: 'routine' | 'notable' | 'major' | 'huge'; kind: string; line: string;
  system?: string | null; body?: string | null; photos?: number; stationType?: string | null;
  photoItems?: { id: string; url: string; caption: string | null; addedAt: string | null }[];
}
interface Sitting {
  startedAt: string; endedAt: string | null; endReason: string | null; hours: number;
  ship: string | null; jumps: number; ly: number; systems: number; landings: number;
  bodiesScanned: number; firstDiscoveries: number; tonnesMined: number; bounties: number;
  firstSystem: string | null; lastSystem: string | null; lyFromHome: number | null;
  wing: string[]; events: LogEvent[];
}
/** Where a sitting happened: one system, or the run it covered. */
const whereOf = (s: Sitting) => (!s.firstSystem && !s.lastSystem ? null
  : !s.firstSystem || s.firstSystem === s.lastSystem ? (s.lastSystem || s.firstSystem)
    : `${s.firstSystem} → ${s.lastSystem}`);
interface Ship {
  id: number; type: string; name: string | null; where: string | null; system: string | null;
  here: boolean; inTransit: boolean; value: number | null; flying?: boolean; boughtAt: string | null;
}
interface RankBlock { at: string; ranks: Record<string, number | undefined>; progress: Record<string, number | undefined> | null }

// The game's ladders. A rank you reached before the journals begin has no promotion to log, which
// is why the standing line matters: the commander's combat rank predates every journal they have.
const LADDERS: Record<string, string[]> = {
  Combat: ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Trade: ['Penniless', 'Mostly Penniless', 'Peddler', 'Dealer', 'Merchant', 'Broker', 'Entrepreneur', 'Tycoon', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Explore: ['Aimless', 'Mostly Aimless', 'Scout', 'Surveyor', 'Trailblazer', 'Pathfinder', 'Ranger', 'Pioneer', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Exobiologist: ['Directionless', 'Mostly Directionless', 'Compiler', 'Collector', 'Cataloguer', 'Taxonomist', 'Ecologist', 'Geneticist', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Soldier: ['Defenceless', 'Mostly Defenceless', 'Rookie', 'Soldier', 'Gunslinger', 'Warrior', 'Gladiator', 'Deadeye', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'],
  Federation: ['None', 'Recruit', 'Cadet', 'Midshipman', 'Petty Officer', 'Chief Petty Officer', 'Warrant Officer', 'Ensign', 'Lieutenant', 'Lieutenant Commander', 'Post Commander', 'Post Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral'],
  Empire: ['None', 'Outsider', 'Serf', 'Master', 'Squire', 'Knight', 'Lord', 'Baron', 'Viscount', 'Count', 'Earl', 'Marquis', 'Duke', 'Prince', 'King'],
};

interface LogPayload {
  generatedAt: string; days: number; home: string; sittings: Sitting[]; milestones: LogEvent[];
  fleet?: Ship[]; fleetAt?: string | null; rank?: RankBlock | null;
  totals: { sittings: number; events: number; byKind: Record<string, number>; byWeight: Record<string, number>; first: string | null; last: string | null };
  error?: string;
}

const WEIGHTS = ['routine', 'notable', 'major', 'huge'] as const;
type Weight = typeof WEIGHTS[number];
const rank = (w: string) => Math.max(0, WEIGHTS.indexOf(w as Weight));

const SPANS = [
  { days: 30, label: '30 days', grain: 'sitting' as const },
  { days: 365, label: '1 year', grain: 'week' as const },
  { days: 0, label: 'All time', grain: 'month' as const },
];

interface SearchResult {
  query: string;
  systems: { name: string; first: string; last: string; visits: number }[];
  bodies: { name: string; system: string | null; first: string; last: string; landings: number }[];
  stations?: { marketId: number; name: string; system: string | null; first: string; last: string; docks: number }[];
  events: LogEvent[];
  sittings: Sitting[];
}

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q_ = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };
const q = q_;

// The game runs 1286 years ahead of us: 2026 here is 3312 there. Every date is shown BOTH ways,
// the in-game one leading, because a log that switches era between one heading and the next is
// unreadable — and the real date is how you actually remember when something happened.
const ELITE_OFFSET = 1286;
const eliteYear = (d: Date) => d.getFullYear() + ELITE_OFFSET;
/** "4 September 3312" with the real date beside it. */
const eliteDay = (iso: string) => {
  const d = new Date(iso);
  return { game: `${d.getDate()} ${d.toLocaleString(undefined, { month: 'long' })} ${eliteYear(d)}`, real: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) };
};
const eliteShort = (iso: string) => {
  const d = new Date(iso);
  return { game: `${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })} ${eliteYear(d)}`, real: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) };
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => iso.slice(0, 10);
const dur = (h: number) => (h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(h * 60)} min`);
const num = (n: number) => Math.round(n).toLocaleString();

/** The week a date falls in, Monday-anchored, as a sortable key plus both readings of the date. */
function weekOf(iso: string) {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  const s = eliteShort(d.toISOString());
  return { key: d.toISOString().slice(0, 10), label: `Week of ${s.game}`, real: `week of ${s.real}` };
}
function monthOf(iso: string) {
  const d = new Date(iso);
  return {
    key: iso.slice(0, 7),
    label: `${d.toLocaleString(undefined, { month: 'long' })} ${eliteYear(d)}`,
    real: `${d.toLocaleString(undefined, { month: 'short' })} ${d.getFullYear()}`,
  };
}

const WEIGHT_STYLE: Record<Weight, string> = {
  huge: 'border-amber-400/60 bg-amber-500/10 text-amber-100',
  major: 'border-sky-400/40 bg-sky-500/10 text-sky-100',
  notable: 'border-border bg-muted/20 text-foreground/90',
  routine: 'border-transparent text-muted-foreground',
};
const KIND_ICON: Record<string, string> = {
  claim: '🏛️', built: '🏗️', carrier_bought: '⚓', death: '💀', ship_new: '🚀', promotion: '🎖️',
  discovery: '🔭', touchdown: '🛬', codex_first: '📔', engineer: '🔧',
  long_haul: '🌌', bounty_night: '🎯', carrier_move: '⚓', scouted: '⭐',
  surface_mining: '🚜', ring_mining: '⛏️', missions: '📋', vehicle_first: '🛻', exobiology: '🧬', bio_sale: '🧫', community_goal: '🎪',
};
const KIND_LABEL: Record<string, string> = {
  claim: 'claims', built: 'builds', carrier_bought: 'carrier', death: 'deaths', ship_new: 'ships',
  promotion: 'ranks', discovery: 'discoveries', touchdown: 'landings', codex_first: 'codex',
  engineer: 'engineers', long_haul: 'hauls', bounty_night: 'bounties', carrier_move: 'carrier moves',
  scouted: 'scouted', surface_mining: 'surface mining', ring_mining: 'ring mining', missions: 'missions', vehicle_first: 'vehicles', exobiology: 'exobiology', bio_sale: 'bio sales', community_goal: 'community goals',
};

/** One event line. Touchdowns carry their photos; the body links to its sighting wall. */
function EventRow({ e }: { e: LogEvent }) {
  const [shot, setShot] = useState<string | null>(null);
  return (
    <div className={`rounded border px-2.5 py-1.5 text-sm ${WEIGHT_STYLE[e.weight]}`}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{hm(e.at)}</span>
        <span className="shrink-0" aria-hidden="true">{KIND_ICON[e.kind] ?? '·'}</span>
        <span className="leading-snug">{e.line}</span>
        {e.system && (
          <Link to={`/systems/${encodeURIComponent(e.system)}`} className="ml-auto shrink-0 text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground" title="Open the system">
            {e.system}
          </Link>
        )}
      </div>
      {e.photoItems && e.photoItems.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {e.photoItems.map((p) => (
            <button key={p.id} type="button" onClick={() => setShot(p.url)} className="block" title={p.caption || 'Photo'}>
              <img src={q(p.url)} alt={p.caption || ''} loading="lazy" className="h-14 w-20 rounded border border-border object-cover hover:border-sky-400/60" />
            </button>
          ))}
          {e.kind === 'touchdown' && (
            <Link to="/sights" className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground">on the Sights wall</Link>
          )}
        </div>
      )}
      {shot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setShot(null)} role="presentation">
          <img src={q(shot)} alt="" className="max-h-full max-w-full rounded" />
        </div>
      )}
    </div>
  );
}

export function CommanderLogPage() {
  const [data, setData] = useState<LogPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [span, setSpan] = useState(SPANS[0]);
  const [min, setMin] = useState<Weight>('notable');
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showFleet, setShowFleet] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const keep = useCallback((e: LogEvent) => rank(e.weight) >= rank(min) && (kinds.size === 0 || kinds.has(e.kind)), [min, kinds]);

  // A build is HUGE when its type is one the commander picked in Settings → Domain Highlights.
  // Same call, same table, same setting the Architect's Domain page showcases from — the server
  // does not get a second opinion; it sends the raw station type and this decides.
  const highlightStations = useAppStore((s) => s.settings.domainHighlightStations);
  const weigh = useCallback((e: LogEvent): LogEvent => {
    if (e.kind !== 'built' || !e.stationType) return e;
    const showpiece = new Set(highlightStations ?? DEFAULT_HIGHLIGHT_STATIONS);
    return showpiece.has(getStationTypeInfo(e.stationType).label) ? { ...e, weight: 'huge' } : e;
  }, [highlightStations]);
  const promote = useCallback((d: LogPayload): LogPayload => ({
    ...d,
    milestones: (d.milestones || []).map(weigh),
    sittings: (d.sittings || []).map((s) => ({ ...s, events: (s.events || []).map(weigh) })),
  }), [weigh]);

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setSearch(null); return; }
    setSearching(true);
    fetch(q_(`/api/commander-log?q=${encodeURIComponent(q)}`))
      .then((r) => r.json())
      .then((d) => setSearch(d?.search ? { ...d.search, events: (d.search.events || []).map(weigh) } : null))
      .catch(() => setSearch(null))
      .finally(() => setSearching(false));
  }, [weigh]);

  const load = useCallback((days: number) => {
    setLoading(true); setError(null);
    fetch(q(`/api/commander-log?days=${days}`))
      .then((r) => r.json())
      .then((d: LogPayload) => { if (d && !d.error) setData(promote(d)); else setError(d?.error || 'failed'); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [promote]);
  useEffect(() => { load(span.days); }, [span, load]);

  // Sittings that have something to say at the current weight, grouped by the span's grain.
  const groups = useMemo(() => {
    if (!data) return [];
    const out = new Map<string, { label: string; real: string; sittings: Sitting[]; events: LogEvent[] }>();
    for (const s of data.sittings) {
      const shown = s.events.filter(keep);
      // A month or week view keeps only the sittings that earned a line; the day view keeps all.
      if (span.grain !== 'sitting' && shown.length === 0) continue;
      const d = eliteDay(s.startedAt);
      const g = span.grain === 'sitting' ? { key: dayKey(s.startedAt), label: d.game, real: d.real }
        : span.grain === 'week' ? weekOf(s.startedAt) : monthOf(s.startedAt);
      if (!out.has(g.key)) out.set(g.key, { label: g.label, real: g.real, sittings: [], events: [] });
      const bucket = out.get(g.key)!;
      bucket.sittings.push(s);
      bucket.events.push(...shown);
    }
    return [...out.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, v]) => ({ key, ...v }));
  }, [data, keep, span.grain]);

  /** What a sitting did that earned no entry of its own. */
  const sittingLine = (s: Sitting) => {
    const bits: string[] = [];
    if (s.jumps) bits.push(`${num(s.jumps)} jump${s.jumps === 1 ? '' : 's'}${s.ly ? `, ${num(s.ly)} ly` : ''}`);
    if (s.landings) bits.push(`${num(s.landings)} landing${s.landings === 1 ? '' : 's'}`);
    if (s.bodiesScanned) bits.push(`${num(s.bodiesScanned)} scanned${s.firstDiscoveries ? ` (${num(s.firstDiscoveries)} first)` : ''}`);
    if (s.tonnesMined) bits.push(`${num(s.tonnesMined)} t mined`);
    if (s.bounties) bits.push(`${num(s.bounties)} bounties`);
    return bits.join(' · ') || 'quiet';
  };

  const rolled = (list: Sitting[]) => {
    const t = list.reduce((a, s) => ({
      hours: a.hours + s.hours, jumps: a.jumps + s.jumps, ly: a.ly + s.ly, landings: a.landings + s.landings,
      scanned: a.scanned + s.bodiesScanned, first: a.first + s.firstDiscoveries, mined: a.mined + s.tonnesMined,
    }), { hours: 0, jumps: 0, ly: 0, landings: 0, scanned: 0, first: 0, mined: 0 });
    const bits = [`${list.length} sitting${list.length === 1 ? '' : 's'}`, `${dur(t.hours)} flown`];
    if (t.jumps) bits.push(`${num(t.jumps)} jumps, ${num(t.ly)} ly`);
    if (t.landings) bits.push(`${num(t.landings)} landings`);
    if (t.scanned) bits.push(`${num(t.scanned)} bodies scanned${t.first ? ` (${num(t.first)} first)` : ''}`);
    if (t.mined) bits.push(`${num(t.mined)} t mined`);
    return bits.join(' · ');
  };

  const totals = data?.totals;

  return (
    <div className="space-y-4 p-4">
      {/* ---- hero ---- */}
      <div className="edc-chamfer edc-grid-bg relative border border-border bg-card/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-wide">{'📖'} COMMANDER&apos;S LOG</h1>
            {loading ? <span className="text-[10px] tracking-widest text-amber-300">READING THE JOURNALS…</span> : null}
          </div>
          <div className="text-[11px] text-muted-foreground">every line from the journal — nothing written for you</div>
        </div>
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
        {totals && (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              { label: 'Sittings on file', v: num(totals.sittings), sub: totals.first ? `since ${eliteShort(totals.first).game} · ${eliteShort(totals.first).real}` : '' },
              { label: 'Logged events', v: num(totals.events), sub: `${totals.byWeight.huge ?? 0} huge · ${totals.byWeight.major ?? 0} major` },
              { label: 'Claims', v: num(totals.byKind.claim ?? 0), sub: `${totals.byKind.death ?? 0} deaths` },
              { label: 'Landings', v: num(totals.byKind.touchdown ?? 0), sub: `${totals.byKind.discovery ?? 0} discovery entries` },
            ].map((c) => (
              <div key={c.label} className="rounded border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{c.v}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{c.sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- where you stand, and what you fly ---- */}
      {data?.rank && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-border bg-card/50 px-4 py-2 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Standing</span>
          {Object.entries(LADDERS).map(([ladder, names]) => {
            const v = data.rank!.ranks[ladder];
            if (v == null) return null;
            const pct = data.rank!.progress?.[ladder];
            return (
              <span key={ladder} title={`${ladder}${pct != null ? ` · ${pct}% toward ${names[v + 1] ?? 'the top'}` : ''}`}>
                <span className="text-muted-foreground">{ladder}</span>{' '}
                <span className="text-foreground">{names[v] ?? `rank ${v}`}</span>
                {pct != null && pct > 0 && <span className="text-muted-foreground/60"> {pct}%</span>}
              </span>
            );
          })}
          <span className="ml-auto text-[10px] text-muted-foreground/60">a rank earned before your journals begin has no entry to show — this is the game&rsquo;s own tally</span>
        </div>
      )}

      {data?.fleet && data.fleet.length > 0 && (
        <section className="rounded border border-border bg-card/50">
          <button type="button" onClick={() => setShowFleet((v) => !v)} className="flex w-full items-baseline gap-2 px-4 py-2 text-left hover:bg-muted/20">
            <span className="w-3 text-[10px] text-muted-foreground">{showFleet ? '▼' : '▶'}</span>
            <span className="text-sm font-semibold">{'🚀'} Fleet</span>
            <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums">{data.fleet.length}</span>
            <span className="text-[11px] text-muted-foreground">
              {data.fleet.filter((s) => s.here).length} on the carrier · {data.fleet.filter((s) => s.boughtAt).length} bought since your journals begin
            </span>
            {data.fleetAt && <span className="ml-auto text-[10px] text-muted-foreground/60">as of {eliteShort(data.fleetAt).real}</span>}
          </button>
          {showFleet && (
            <div className="overflow-x-auto px-4 pb-3">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1 pr-3">Ship</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Where</th><th className="py-1">Bought</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fleet.map((s) => (
                    <tr key={s.id} className={`border-t border-border/40 ${s.flying ? 'text-amber-200' : ''}`}>
                      <td className="py-1 pr-3">{s.type}{s.flying && <span className="ml-1.5 text-[10px] uppercase tracking-wider">flying</span>}</td>
                      <td className="py-1 pr-3">{s.name || <span className="text-muted-foreground/50">unnamed</span>}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{s.inTransit ? 'in transit' : (s.where || s.system || '—')}</td>
                      <td className="py-1 text-muted-foreground">{s.boughtAt ? `${eliteShort(s.boughtAt).game} · ${eliteShort(s.boughtAt).real}` : <span className="text-muted-foreground/50">older than your journals</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---- controls: the span sets the resolution, the weight sets the floor ---- */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Span</span>
        {SPANS.map((s) => (
          <button key={s.label} type="button" onClick={() => setSpan(s)}
            title={`Grouped by ${s.grain}`}
            className={`rounded border px-2 py-0.5 ${span.label === s.label ? 'border-amber-500/50 text-amber-300' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {s.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Show</span>
        {(['routine', 'notable', 'major', 'huge'] as Weight[]).map((w) => (
          <button key={w} type="button" onClick={() => setMin(w)}
            title={w === 'routine' ? 'Everything, including the ordinary' : `${w} and above`}
            className={`rounded border px-2 py-0.5 ${min === w ? 'border-sky-400/70 bg-sky-500/20 text-sky-100' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {w === 'routine' ? 'everything' : `${w}+`}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {span.grain === 'sitting' ? 'one block per sitting' : `folded by ${span.grain} — majors keep their own line`}
        </span>
      </div>

      {/* Search — the whole history, not the span: "when did I first see this system", "what did
          I do in that ship". Systems and bodies answer even when no entry was written there. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
          placeholder="Search all time — a system, a body, a ship, someone you flew with"
          className="w-96 max-w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60"
        />
        <button type="button" onClick={() => runSearch(query)} disabled={searching} className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-sky-300 hover:bg-muted/50 disabled:opacity-40">
          {searching ? 'Searching…' : 'Search'}
        </button>
        {search && <button type="button" onClick={() => { setSearch(null); setQuery(''); }} className="text-muted-foreground hover:text-foreground">clear</button>}
      </div>

      {/* Kind filter — "show me every ship I bought" is one tap, at any span */}
      {totals && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Kinds</span>
          {Object.entries(totals.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
            const on = kinds.has(k);
            return (
              <button key={k} type="button"
                onClick={() => setKinds((s) => { const next = new Set(s); if (next.has(k)) next.delete(k); else next.add(k); return next; })}
                className={`rounded border px-2 py-0.5 ${on ? 'border-sky-400/70 bg-sky-500/20 text-sky-100' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                {KIND_ICON[k] ?? '·'} {KIND_LABEL[k] ?? k} <span className="tabular-nums opacity-60">{n}</span>
              </button>
            );
          })}
          {kinds.size > 0 && <button type="button" onClick={() => setKinds(new Set())} className="px-1 text-slate-400 hover:text-foreground">all kinds</button>}
        </div>
      )}

      {/* Search results — replaces the timeline while a search is open */}
      {search && (
        <section className="space-y-2 rounded border border-sky-500/30 bg-sky-500/5 p-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-sky-300">“{search.query}”</h2>
            <span className="text-xs text-muted-foreground">across your whole history</span>
          </div>
          {search.systems.map((s) => (
            <div key={s.name} className="text-sm">
              <span className="text-sky-200">{s.name}</span>
              <span className="text-muted-foreground"> — first seen {eliteDay(s.first).game} ({eliteDay(s.first).real}), last {eliteShort(s.last).real}, {num(s.visits)} arrival{s.visits === 1 ? '' : 's'}</span>
            </div>
          ))}
          {search.bodies.map((b) => (
            <div key={b.name} className="text-sm">
              <span className="text-sky-200">{b.name}</span>
              <span className="text-muted-foreground"> — first landed {eliteDay(b.first).game} ({eliteDay(b.first).real}), {num(b.landings)} landing{b.landings === 1 ? '' : 's'}</span>
            </div>
          ))}
          {(search.stations ?? []).map((st) => (
            <div key={st.marketId} className="text-sm">
              <span className="text-sky-200">{st.name}</span>
              {st.system && <span className="text-muted-foreground"> · {st.system}</span>}
              <span className="text-muted-foreground"> — first docked {eliteDay(st.first).game} ({eliteDay(st.first).real}), last {eliteShort(st.last).real}, {num(st.docks)} dock{st.docks === 1 ? '' : 's'}</span>
            </div>
          ))}
          {search.sittings.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {num(search.sittings.length)} sitting{search.sittings.length === 1 ? '' : 's'} match —
              {' '}{eliteShort(search.sittings[search.sittings.length - 1].startedAt).real} to {eliteShort(search.sittings[0].startedAt).real}
            </div>
          )}
          {search.events.length > 0 && (
            <div className="mt-2 space-y-1">
              {search.events.filter(keep).slice(0, 60).map((e, i) => (
                <div key={`${e.at}|${i}`} className="flex items-baseline gap-2 text-sm">
                  <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{eliteShort(e.at).game}</span>
                  <span className="w-24 shrink-0 text-[11px] text-muted-foreground/60">{eliteShort(e.at).real}</span>
                  <span aria-hidden="true">{KIND_ICON[e.kind] ?? '·'}</span>
                  <span className={e.weight === 'huge' ? 'text-amber-200' : 'text-foreground/85'}>{e.line}</span>
                </div>
              ))}
            </div>
          )}
          {search.systems.length === 0 && search.bodies.length === 0 && (search.stations ?? []).length === 0 && search.events.length === 0 && search.sittings.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing in the log mentions that.</p>
          )}
        </section>
      )}

      {/* ---- the log ---- */}
      {search ? null : !data && !error ? (
        <p className="text-sm text-muted-foreground">Reading the journals…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing at this weight in this span.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isOpen = open[g.key] ?? span.grain === 'sitting';
            return (
              <section key={g.key} className="edc-chamfer border border-border bg-card/60">
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-muted/20">
                  <span className="w-3 text-[10px] text-muted-foreground">{isOpen ? '▼' : '▶'}</span>
                  <span className="text-sm font-semibold">{g.label}</span>
                  <span className="text-[11px] text-muted-foreground/70" title="the real-world date">{g.real}</span>
                  <span className="text-[11px] text-muted-foreground">{rolled(g.sittings)}</span>
                  {g.events.length > 0 && (
                    <span className="ml-auto rounded bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums">{g.events.length}</span>
                  )}
                </button>
                {isOpen && (
                  <div className="space-y-2 px-4 pb-3">
                    {span.grain === 'sitting' ? (
                      g.sittings.map((s) => {
                        const shown = s.events.filter(keep);
                        return (
                          <div key={s.startedAt} className="rounded border border-border/60 bg-background/30 px-3 py-2">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span className="tabular-nums text-foreground/80">{hm(s.startedAt)}</span>
                              <span>{dur(s.hours)}</span>
                              {s.ship && <span className="text-foreground/70">{s.ship}</span>}
                              {whereOf(s) && (
                                <span className="text-sky-300/80">
                                  {whereOf(s)}
                                  {s.lyFromHome != null && <span className="text-muted-foreground/70"> · {num(s.lyFromHome)} ly from {data?.home ?? 'home'}</span>}
                                </span>
                              )}
                              <span>{sittingLine(s)}</span>
                              {s.wing.length > 0 && <span>with {s.wing.join(', ')}</span>}
                              <span className="ml-auto">{s.endReason === 'silence' ? 'ended by silence' : s.endReason === 'relog' ? 'relogged' : ''}</span>
                            </div>
                            {shown.length > 0 && <div className="mt-1.5 space-y-1">{shown.map((e, i) => <EventRow key={`${e.at}|${e.kind}|${i}`} e={e} />)}</div>}
                          </div>
                        );
                      })
                    ) : (
                      <div className="space-y-1">
                        {g.events.sort((a, b) => (a.at < b.at ? 1 : -1)).map((e, i) => <EventRow key={`${e.at}|${e.kind}|${i}`} e={e} />)}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ---- what happened before the window: the milestones only ---- */}
      {!search && data && data.milestones.filter(keep).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Before this span</h2>
            <span className="text-xs text-muted-foreground">the moments that were called out, all the way back</span>
          </div>
          <div className="space-y-1">
            {data.milestones.filter(keep).map((e, i) => (
              <div key={`${e.at}|${i}`} className="flex items-baseline gap-2 text-sm">
                <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{eliteShort(e.at).game}</span>
                <span className="w-24 shrink-0 text-[11px] text-muted-foreground/60">{eliteShort(e.at).real}</span>
                <span aria-hidden="true">{KIND_ICON[e.kind] ?? '·'}</span>
                <span className={e.weight === 'huge' ? 'text-amber-200' : 'text-foreground/85'}>{e.line}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        Built from {data ? num(data.totals.events) : '—'} events across your whole journal history, rebuilt when the journals change.
        Photos are the ones already on the Sights wall and in the system galleries — the log points at them, it never copies them.
      </p>
    </div>
  );
}
