import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';

/**
 * Colonization Threats — encroachment watch on systems the commander flagged as theirs to lose.
 *
 * Watches a RADIUS, not the system. Colonization spreads by claim hops of ~15 ly, so 50 ly is
 * roughly three hops of warning — enough to act. Watching the target itself only reports the loss.
 */

interface Threat {
  name: string;
  distanceLy: number;
  population: number;
}

interface Watched {
  id: string;
  name: string;
  score: number | null;
  note?: string;
  addedAt: string;
  status: 'unchecked' | 'clear' | 'threatened' | 'taken' | 'unknown';
  nearestLy: number | null;
  nearestName: string | null;
  hops?: number | null;
  /** true = Spansh knows the name · false = never indexed · null = could not ask */
  registered?: boolean | null;
  closing?: boolean;
  threats?: Threat[];
  threatCount: number;
  lastCheckedAt?: string;
  checkFailed?: boolean;
}

const token = () => {
  try { return sessionStorage.getItem('colony-token') || localStorage.getItem('colony-token'); } catch { return null; }
};
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };

const STATUS: Record<Watched['status'], { label: string; cls: string; dot: string }> = {
  taken:      { label: 'TAKEN',      cls: 'text-red-400 border-red-500/40 bg-red-500/10',        dot: 'bg-red-400' },
  threatened: { label: 'THREATENED', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10',  dot: 'bg-amber-400' },
  clear:      { label: 'CLEAR',      cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', dot: 'bg-emerald-400' },
  unknown:    { label: 'UNKNOWN',    cls: 'text-muted-foreground border-border bg-muted/20',     dot: 'bg-muted-foreground' },
  unchecked:  { label: 'NOT CHECKED', cls: 'text-muted-foreground border-border bg-muted/20',    dot: 'bg-muted-foreground/50' },
};

export function ThreatsPage() {
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const [watched, setWatched] = useState<Watched[] | null>(null);
  const [radius, setRadius] = useState(50);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetch(q('/api/threats'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setWatched(d.watched || []); if (d.radiusLy) setRadius(d.radiusLy); })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Suggestions from the commander's own scouted pool, so a flag inherits their score.
  const suggestions = useMemo(() => {
    const term = entry.trim().toLowerCase();
    if (term.length < 3) return [];
    const flagged = new Set((watched || []).map((w) => w.name.toLowerCase()));
    const out: { name: string; score: number | null }[] = [];
    for (const s of Object.values(scoutedSystems || {})) {
      const n = (s as { name?: string })?.name;
      if (!n || !n.toLowerCase().includes(term) || flagged.has(n.toLowerCase())) continue;
      out.push({ name: n, score: (s as { score?: { total?: number } })?.score?.total ?? null });
      if (out.length > 40) break;
    }
    return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 8);
  }, [entry, scoutedSystems, watched]);

  const flag = async (name: string) => {
    setError('');
    try {
      const r = await fetch(q('/api/threats'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setEntry('');
      load();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  };

  const unflag = async (id: string) => {
    await fetch(q(`/api/threats?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).catch(() => {});
    load();
  };

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(q('/api/threats/refresh'), { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setWatched(d.watched || []);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const w = watched || [];
    return {
      taken: w.filter((x) => x.status === 'taken').length,
      threatened: w.filter((x) => x.status === 'threatened').length,
      clear: w.filter((x) => x.status === 'clear').length,
    };
  }, [watched]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">{'\u{1F6E1}\u{FE0F}'} Colonization Threats</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        Watches <strong>{radius} ly around</strong> each flagged system — not the system itself. Colonization
        spreads in claim hops of roughly 15 ly, so this is about three hops of warning: enough to see someone
        bridging toward your ground while you can still take it. Your own systems are excluded, since your builds
        show as colonisation too.
      </p>

      {/* Add a flag */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && entry.trim()) flag(entry.trim()); }}
            placeholder="Flag a system by name…"
            className="flex-1 min-w-[240px] bg-muted/50 border border-border/50 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => entry.trim() && flag(entry.trim())}
            disabled={!entry.trim()}
            className="px-3 py-2 text-sm rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-40"
          >
            Flag
          </button>
          <button
            onClick={refresh}
            disabled={busy || !(watched && watched.length)}
            className="px-3 py-2 text-sm rounded bg-muted/50 border border-border hover:bg-muted disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Check now'}
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.name}
                onClick={() => flag(s.name)}
                className="text-xs px-2 py-1 rounded border border-border/60 bg-background/50 hover:border-primary/50 hover:text-primary"
              >
                {s.name}
                {s.score != null && <span className="ml-1.5 text-muted-foreground/70 tabular-nums">{s.score}</span>}
              </button>
            ))}
          </div>
        )}

        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      </div>

      {watched && watched.length > 0 && (
        <div className="flex gap-4 mb-4 text-xs font-mono text-muted-foreground">
          {counts.taken > 0 && <span className="text-red-400">{counts.taken} taken</span>}
          {counts.threatened > 0 && <span className="text-amber-400">{counts.threatened} threatened</span>}
          {counts.clear > 0 && <span className="text-emerald-400">{counts.clear} clear</span>}
        </div>
      )}

      {watched === null && <div className="text-sm text-muted-foreground">Loading…</div>}

      {watched && watched.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">{'\u{1F6E1}\u{FE0F}'}</div>
          <h3 className="font-semibold mb-2">Nothing flagged yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Scoring finds candidates; flagging says which ones you actually intend to hold. Flag one above, or
            from the <Link to="/scouting" className="text-primary hover:underline">Expansion</Link> page.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {(watched || []).map((w) => {
          const st = STATUS[w.status] || STATUS.unchecked;
          return (
            <div key={w.id} className={`border rounded-lg p-4 ${w.status === 'taken' ? 'border-red-500/40' : w.status === 'threatened' ? 'border-amber-500/30' : 'border-border'} bg-card`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`inline-block w-2 h-2 rounded-full ${st.dot}`} />
                <Link to={`/systems/${encodeURIComponent(w.name)}`} className="font-semibold text-foreground hover:text-primary">
                  {w.name}
                </Link>
                {w.score != null && (
                  <span className="text-xs font-mono text-muted-foreground">score {w.score}</span>
                )}
                <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${st.cls}`}>
                  {st.label}
                </span>
                {w.closing && (
                  <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-400">
                    closing in
                  </span>
                )}
                {w.registered === false && (
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-400"
                    title="Spansh has no record of this system — nobody has reported it. Checked by coordinates instead."
                  >
                    not on spansh
                  </span>
                )}
                <Link
                  to={`/planner?target=${encodeURIComponent(w.name)}`}
                  className="ml-auto text-xs text-primary/80 hover:text-primary"
                  title="Plan a route to this system"
                >
                  plan route
                </Link>
                <button
                  onClick={() => unflag(w.id)}
                  className="text-xs text-muted-foreground/60 hover:text-red-400"
                  title="Remove this flag"
                >
                  unflag
                </button>
              </div>

              <div className="mt-2 text-sm">
                {w.status === 'clear' && (
                  <span className="text-emerald-400/90">Nothing being colonised within {radius} ly.</span>
                )}
                {w.status === 'unknown' && (
                  <span className="text-muted-foreground">
                    Could not reach Spansh on the last check — status unknown rather than assumed clear.
                  </span>
                )}
                {w.status === 'unchecked' && (
                  <span className="text-muted-foreground">Not checked yet — hit “Check now”.</span>
                )}
                {(w.status === 'threatened' || w.status === 'taken') && (
                  <>
                    <div className={w.status === 'taken' ? 'text-red-400' : 'text-amber-400'}>
                      {w.status === 'taken'
                        ? 'This system is itself being colonised.'
                        : `${w.threatCount} claim${w.threatCount === 1 ? '' : 's'} within ${radius} ly — nearest ${w.nearestLy?.toFixed(1)} ly, about ${w.hops} hop${w.hops === 1 ? '' : 's'} away.`}
                    </div>
                    {w.threats && w.threats.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {w.threats.slice(0, 5).map((t) => (
                          <div key={t.name} className="flex gap-3 text-xs font-mono text-muted-foreground">
                            <span className="tabular-nums w-16 text-right">{t.distanceLy.toFixed(1)} ly</span>
                            <span className="text-foreground/80">{t.name}</span>
                            <span className="tabular-nums">pop {t.population.toLocaleString('en-US')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {w.lastCheckedAt && (
                <div className="mt-2 text-[11px] text-muted-foreground/50 font-mono">
                  checked {new Date(w.lastCheckedAt).toLocaleString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
