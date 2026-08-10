/**
 * Chain Watch (/chains) — the colonization frontier as a browsable ledger: chains of new
 * colonies assembled from live EDDN events + a bounded Spansh seed, filtered to the
 * commander's operational regions, each reported as NAMED systems with coordinates.
 *
 * Deliberately NOT a recommender and NOT an alert stream: no scores, no rankings, no
 * pushes. It answers exactly one question — "where has the frontier opened new reachable
 * space?" — so the commander knows where to aim their own Spansh/boxel tools.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';

interface ChainAnchor {
  name: string; pos: number[]; region: string | null; pop: number | null;
  firstSeen: number; lastSeen: number; live: boolean; seeded: boolean;
}
interface Chain {
  id: string; count: number;
  start: { name: string; pos: number[] };
  tip: { name: string; pos: number[] };
  extentLy: number; reachBandLy: number;
  status: 'active' | 'stalled';
  lastGrowthAt: number; recentWeek: number; recentWeekLive: number;
  sectors: string[]; regions: string[];
  anchors: ChainAnchor[];
  distFromYou: number | null; distFromHoldings: number | null;
}
interface ChainsResponse {
  chains: Chain[];
  regionsUsed: string[];
  meta: {
    watchingSince: string;
    seedInfo: Record<string, { count: number | null; fetched: number; truncated: boolean; seededAt: string } | string>;
    anchorTotal: number; unresolvedRegions: number; seeding: boolean; linkLy: number; activeDays: number;
  };
}

const ago = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const fmtPop = (n: number | null) => n == null ? '—' : n === 0 ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

function sysHref(path: string): string {
  try {
    const t = sessionStorage.getItem('colony-token');
    return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
  } catch { return path; }
}

export function ChainWatchPage() {
  const chainWatchRegions = useAppStore((s) => s.settings.chainWatchRegions);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [data, setData] = useState<ChainsResponse | null>(null);
  const [error, setError] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const load = useCallback(() => {
    fetch(sysHref('/api/chains'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : 'load failed'));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Region whitelist chips: union of what the server used and what chains actually carry
  const allRegions = useMemo(() => {
    const s = new Set<string>(data?.regionsUsed || []);
    for (const c of data?.chains || []) for (const r of c.regions) s.add(r);
    return [...s].sort();
  }, [data]);

  const toggleRegion = (r: string) => {
    const cur = new Set(chainWatchRegions?.length ? chainWatchRegions : data?.regionsUsed || []);
    if (cur.has(r)) cur.delete(r); else cur.add(r);
    updateSettings({ chainWatchRegions: [...cur] });
    setTimeout(load, 300);
  };

  const shown = useMemo(() => {
    let list = data?.chains || [];
    if (activeOnly) list = list.filter((c) => c.status === 'active');
    const q = sectorFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.sectors.some((s) => s.toLowerCase().includes(q)) ||
        c.anchors.some((a) => a.name.toLowerCase().includes(q)));
    }
    return list;
  }, [data, sectorFilter, activeOnly]);

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold">{'⛓️'} Chain Watch</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Where the colonization frontier has opened new reachable space — named systems, not green tendrils.
            Awareness only: no scores, no recommendations.
          </p>
        </div>
        <button onClick={() => { fetch(sysHref('/api/chains/seed'), { method: 'POST' }).catch(() => {}); setTimeout(load, 2000); }}
          className="px-3 py-1.5 bg-muted/50 border border-border rounded text-xs hover:bg-muted transition-colors"
          title="Re-run the bounded Spansh seed for your regions (newest-updated first)">
          {'⟳'} Re-seed
        </button>
      </div>

      {meta && (
        <div className="text-xs text-muted-foreground border border-amber-500/20 bg-amber-500/5 rounded-lg px-3 py-2 leading-relaxed">
          Watching since {new Date(meta.watchingSince).toLocaleDateString()} · {meta.anchorTotal.toLocaleString()} anchors on ledger
          {meta.seeding && <span className="text-amber-300"> · seeding…</span>}
          {meta.unresolvedRegions > 0 && <span> · {meta.unresolvedRegions} region-unresolved</span>}
          {Object.entries(meta.seedInfo).filter(([k]) => k !== 'coloniaRegion').map(([region, info]) =>
            typeof info === 'object' && info ? (
              <span key={region}> · {region}: seeded {info.fetched}{info.truncated ? ` of ${info.count} (newest first — truncated)` : ''}</span>
            ) : null)}
          <span> · links {'≤'}{meta.linkLy} ly · active = growth within {meta.activeDays} d</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {allRegions.map((r) => {
          const on = (data?.regionsUsed || []).includes(r);
          return (
            <button key={r} onClick={() => toggleRegion(r)}
              className={`px-2 py-1 rounded border text-xs transition-colors ${on ? 'border-amber-500/60 text-amber-300' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              {r}
            </button>
          );
        })}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none ml-2">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-amber-500" />
          growing only
        </label>
        <input value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} placeholder="filter by sector / system…"
          className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-amber-500 ml-auto w-56" />
      </div>

      {error && <div className="text-sm text-red-400">Couldn&rsquo;t load chains: {error}</div>}
      {data && shown.length === 0 && (
        <div className="text-sm text-muted-foreground italic py-8 text-center">
          No chains on the ledger for these filters{meta?.seeding ? ' — seed still running' : ''}.
          Chains appear from the seed and as live colonization events arrive.
        </div>
      )}

      <div className="space-y-2">
        {shown.slice(0, 60).map((c) => {
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className={`bg-card border rounded-lg overflow-hidden ${c.status === 'active' ? 'border-amber-500/40' : 'border-border'}`}>
              <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors flex-wrap"
                onClick={() => setExpanded(isOpen ? null : c.id)}>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.status === 'active' ? 'bg-amber-500/20 text-amber-300' : 'bg-muted/40 text-muted-foreground'}`}>
                  {c.status === 'active' ? `▲ ACTIVE` : 'stalled'}
                </span>
                <span className="font-medium text-foreground">{c.start.name}</span>
                {c.count > 1 && <span className="text-xs text-muted-foreground">{'→'} {c.tip.name}</span>}
                <span className="text-xs text-muted-foreground">{c.count} anchor{c.count !== 1 ? 's' : ''} · {c.extentLy} ly extent · {'±'}{c.reachBandLy} ly reach band</span>
                {c.recentWeek > 0 && <span className="text-xs text-amber-300">{c.recentWeek} updated this wk{c.recentWeekLive ? ` (${c.recentWeekLive} live)` : ''}</span>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {c.distFromYou != null && <>you: {c.distFromYou} ly</>}
                  {c.distFromHoldings != null && <> · holdings: {c.distFromHoldings} ly</>}
                  <> · grew {ago(c.lastGrowthAt)}</>
                </span>
              </div>
              {(c.sectors.length > 0 || c.regions.length > 0) && (
                <div className="px-4 pb-1 -mt-1 text-[11px] text-muted-foreground">
                  {c.regions.join(' · ')}{c.sectors.length ? ` — sectors: ${c.sectors.join(', ')}` : ''}
                </div>
              )}
              {isOpen && (
                <div className="border-t border-border/50 px-4 py-2 bg-muted/10">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/50">
                        <th className="text-left py-1">System</th>
                        <th className="text-left">Region</th>
                        <th className="text-right">Pop</th>
                        <th className="text-right">Last activity</th>
                        <th className="text-right">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.anchors.map((a) => (
                        <tr key={a.name} className="border-b border-border/30">
                          <td className="py-1">
                            <a href={sysHref(`/system-view?system=${encodeURIComponent(a.name)}`)} target="_blank" rel="noreferrer"
                              className="text-foreground hover:text-amber-300">{a.name}</a>
                          </td>
                          <td className="text-muted-foreground">{a.region || <span className="italic">unresolved</span>}</td>
                          <td className="text-right text-muted-foreground">{fmtPop(a.pop)}</td>
                          <td className="text-right text-muted-foreground">{ago(a.lastSeen)}</td>
                          <td className="text-right text-muted-foreground">{a.live ? <span className="text-amber-300">LIVE</span> : 'seed'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    Reach band: ~{c.reachBandLy} ly around this chain&rsquo;s length is chainable-if-worth-it — point the
                    Expansion search or boxel scout anywhere inside it. Whether it&rsquo;s worth the hops is your call.
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {shown.length > 60 && <div className="text-xs text-muted-foreground text-center py-2">showing 60 of {shown.length} — narrow with filters</div>}
      </div>
    </div>
  );
}
