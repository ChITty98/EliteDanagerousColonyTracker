/**
 * Mining page — the ground-side companion to the in-cockpit overlay.
 *
 * Four jobs, in the order they matter while you're actually mining:
 *   1. What am I mining FOR — live missions with their real Cr/t and deadline.
 *   2. WHERE should I be — ranked rings for the current targets, from two sources.
 *   3. What am I hunting / ignoring — target + ignore sets, edited on the rocks themselves.
 *   4. What have I actually pulled — the prospected-rock log and measured rate per ring.
 *
 * Everything numeric here is measured or clearly labelled as an estimate. The mission completion
 * figure in particular is a WORST CASE: mining missions report no wing-mate progress, so it assumes
 * the commander mines every tonne alone.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAppStore } from '@/store';

interface MaterialInfo { key: string; label: string; from: string[]; laserProven: boolean }
interface MissionInfo { label: string; tonnes: number; reward: number; crPerTonne: number; count: number; expiry: string; wing: boolean }
interface PacingInfo {
  key: string; label: string; tonnes: number; crPerTonne: number; expiry: string; wing: boolean;
  measuredTonnesPerHour: number | null; hoursSoloWorstCase: number | null; basis: string;
}
interface RateRow {
  ring: string; sys: string; ringClass: string; reserve: string; day: string;
  tonnes: number; rocks: number; hours: number; tonnesPerHour: number | null;
}
interface RockMat { k: string; n: string; p: number; est: number; price: number | null }
interface Rock {
  id: string; t: string; sys: string; ring: string; ringClass: string; reserve: string;
  content: string; remaining: number; motherlode: string | null;
  mats: RockMat[]; estValue: number; got: Record<string, number>; gotTotal: number; gotValue: number; prospects: number;
}
interface LocRow {
  name: string; sys?: string; ringClass?: string; reserve?: string;
  credits: number; valueToday: number; tonnes: number; rocks: number; rings?: number;
  avgPerRock?: number; worthPct?: number | null;
}
interface RingHit { key: string; label: string; count: number }
interface RingRow {
  source: 'journal' | 'spansh'; ring: string; system: string; ringClass: string; reserve: string;
  depthLs: number | null; distanceLy: number | null; hits: RingHit[]; hitCount: number;
  other: string[]; measuredTph?: number;
}
interface Summary {
  missions: Record<string, MissionInfo>;
  pacing: PacingInfo[];
  wingCaveat: string;
  snapshot: {
    ring: { name: string; ringClass: string; reserve: string } | null; system: string;
    currentRock: Rock | null; miningActive: boolean;
    sessionCredits: number; sessionTonnes: number; rockCredits: number;
  };
  rateHistory: RateRow[];
  locations: { rings: LocRow[]; systems: LocRow[] };
  materials: MaterialInfo[];
  index: { rings: number; systems: number; materials: number };
}

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };

const cr = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const RESERVE_TONE: Record<string, string> = {
  Pristine: 'text-emerald-400', Major: 'text-lime-400', Common: 'text-yellow-500',
  Low: 'text-orange-400', Depleted: 'text-red-400',
};

function timeLeft(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const d = ms / 86400000;
  if (d >= 1) return `${d.toFixed(1)}d`;
  return `${Math.round(ms / 3600000)}h`;
}

export function MiningPage() {
  const miningIgnored = useAppStore((s) => s.miningIgnored) ?? [];
  const miningTargets = useAppStore((s) => s.miningTargets) ?? [];
  const toggleMiningIgnored = useAppStore((s) => s.toggleMiningIgnored);
  const toggleMiningTarget = useAppStore((s) => s.toggleMiningTarget);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [rings, setRings] = useState<RingRow[]>([]);
  const [ringsLoading, setRingsLoading] = useState(false);
  const [ringNote, setRingNote] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const loadSummary = useCallback(() => {
    fetch(q('/api/mining/summary'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setSummary(d); else if (d?.error) setError(d.error); })
      .catch((e) => setError(String(e)));
  }, []);

  const loadRocks = useCallback(() => {
    fetch(q('/api/mining-log?limit=150'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.rocks)) setRocks(d.rocks); })
      .catch(() => { /* log may not exist yet */ });
  }, []);

  useEffect(() => {
    loadSummary();
    loadRocks();
    const id = setInterval(() => { loadSummary(); loadRocks(); }, 15000);
    return () => clearInterval(id);
  }, [loadSummary, loadRocks]);

  // Mission commodities are targets whether or not they were picked by hand — you are mining them
  // for a reason that is already recorded in the journal.
  const missionKeys = useMemo(() => Object.keys(summary?.missions ?? {}), [summary]);
  const effectiveTargets = useMemo(
    () => Array.from(new Set([...miningTargets, ...missionKeys])),
    [miningTargets, missionKeys],
  );

  const catalog = summary?.materials ?? [];
  const labelFor = useCallback(
    (key: string) => catalog.find((m) => m.key === key)?.label ?? key,
    [catalog],
  );

  const findRings = useCallback(() => {
    if (!effectiveTargets.length) { setRings([]); setRingNote('Set a target to search.'); return; }
    setRingsLoading(true);
    setRingNote('');
    fetch(q('/api/mining/rings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: effectiveTargets.map(labelFor), includeSpansh: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setRings(d.rings ?? []);
        setRingNote(d.note ?? `${d.counts?.journal ?? 0} from your journals · ${d.counts?.spansh ?? 0} from Spansh`);
      })
      .catch((e) => setRingNote(String(e)))
      .finally(() => setRingsLoading(false));
  }, [effectiveTargets, labelFor]);

  const filteredCatalog = useMemo(() => {
    const s = search.trim().toLowerCase();
    return catalog.filter((m) => !s || m.label.toLowerCase().includes(s));
  }, [catalog, search]);

  const snap = summary?.snapshot;

  // The log only writes a rock once the NEXT prospect supersedes it, so the rock currently under
  // the lasers would otherwise not appear until you moved on — and then only at the next 15s poll.
  // Prepend the in-flight rock from the snapshot so what you just shot at is visible immediately.
  const liveRocks = useMemo(() => {
    const cur = snap?.currentRock;
    if (!cur) return rocks;
    return rocks.some((r) => r.id === cur.id && r.t === cur.t) ? rocks : [cur, ...rocks];
  }, [rocks, snap]);

  return (
    <div className="p-4 space-y-5 max-w-[1400px]">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Mining</h1>
        <div className="text-xs text-muted-foreground">
          {summary?.index
            ? `${summary.index.rings} mapped rings · ${summary.index.materials} known materials`
            : 'loading index…'}
          {snap?.miningActive && <span className="ml-2 text-emerald-400">● mining active</span>}
        </div>
      </header>

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {(snap?.ring || (snap?.sessionTonnes ?? 0) > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
          <div>
            {snap?.ring ? (
              <>
                <span className="text-muted-foreground">Current ring </span>
                <span className="font-semibold">{snap.ring.name}</span>
                {snap.ring.ringClass && <span className="ml-2 text-muted-foreground">{snap.ring.ringClass}</span>}
                {snap.ring.reserve && <span className={`ml-2 ${RESERVE_TONE[snap.ring.reserve] ?? ''}`}>{snap.ring.reserve}</span>}
              </>
            ) : <span className="text-muted-foreground">Not in a ring</span>}
          </div>
          {(snap?.sessionTonnes ?? 0) > 0 && (
            <div className="text-right">
              <span className="text-emerald-400 font-semibold text-base">{cr(snap!.sessionCredits)} Cr</span>
              <span className="text-muted-foreground"> this session · {snap!.sessionTonnes}t</span>
              {snap!.rockCredits > 0 && <span className="text-muted-foreground"> · {cr(snap!.rockCredits)} this rock</span>}
            </div>
          )}
        </div>
      )}

      {/* ---- Missions ---- */}
      {summary && summary.pacing.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Active mining missions</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {summary.pacing.map((p) => (
              <div key={p.key} className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{timeLeft(p.expiry)} left</span>
                </div>
                <div className="mt-1 text-sm">
                  <span className="text-foreground font-medium">{p.tonnes.toLocaleString()}t</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-emerald-400">{p.crPerTonne.toLocaleString()} Cr/t</span>
                  {p.wing && <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">WING</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {p.hoursSoloWorstCase != null
                    ? `~${p.hoursSoloWorstCase.toFixed(1)}h solo worst case · ${p.basis}`
                    : `no measured rate yet — ${p.basis}`}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/80">{summary.wingCaveat}</p>
        </section>
      )}

      {/* ---- Targets ---- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Targets</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter materials…"
            className="rounded border border-border bg-background px-2 py-1 text-sm w-48"
          />
        </div>
        {effectiveTargets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {effectiveTargets.map((k) => (
              <span key={k} className="rounded bg-cyan-500/15 px-2 py-1 text-xs text-cyan-300">
                🎯 {labelFor(k)}
                {missionKeys.includes(k) && <span className="ml-1 opacity-70">(mission)</span>}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {filteredCatalog.map((m) => {
            const on = miningTargets.includes(m.key);
            const fromMission = missionKeys.includes(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggleMiningTarget(m.key)}
                title={fromMission ? 'Required by an active mission' : m.from.join(', ')}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  on ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                     : 'border-border bg-muted/20 text-muted-foreground hover:text-foreground'
                } ${!m.laserProven ? 'opacity-60' : ''}`}
              >
                {m.label}
                {!m.laserProven && <span className="ml-1 opacity-70">·hotspot only</span>}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground/70">
          Derived from what you've prospected, refined and hotspot-mapped — it grows on its own.
          “hotspot only” means never seen in a laser prospect.
        </p>
      </section>

      {/* ---- Ring finder ---- */}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Where to mine</h2>
          <button
            onClick={findRings}
            disabled={ringsLoading}
            className="rounded border border-border bg-muted/30 px-3 py-1 text-xs hover:bg-muted/60 disabled:opacity-50"
          >
            {ringsLoading ? 'searching…' : 'Find rings'}
          </button>
          {ringNote && <span className="text-xs text-muted-foreground">{ringNote}</span>}
        </div>
        {rings.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Ring</th>
                  <th className="px-3 py-2 text-right">ly</th>
                  <th className="px-3 py-2 text-right">Ls deep</th>
                  <th className="px-3 py-2 text-left">Reserve</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Your targets</th>
                  <th className="px-3 py-2 text-left">Also</th>
                </tr>
              </thead>
              <tbody>
                {rings.map((r) => (
                  <tr key={`${r.source}:${r.ring}`} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.ring}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.source === 'journal' ? 'your map' : 'spansh'}
                        {r.measuredTph != null && (
                          <span className="ml-2 text-emerald-400">measured {r.measuredTph.toFixed(0)} t/hr</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.distanceLy != null ? r.distanceLy.toFixed(0) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.depthLs != null ? r.depthLs.toLocaleString() : '—'}</td>
                    <td className={`px-3 py-2 ${RESERVE_TONE[r.reserve] ?? 'text-muted-foreground'}`}>{r.reserve || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.ringClass || '—'}</td>
                    <td className="px-3 py-2">
                      {r.hits.map((h) => (
                        <span key={h.key} className="mr-1 rounded bg-cyan-500/15 px-1.5 py-0.5 text-xs text-cyan-300">
                          {h.label}{h.count > 1 ? ` ×${h.count}` : ''}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.other.slice(0, 4).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground/70">
          Hotspot counts are how many hotspots of that type the ring has — the journal records no
          positions, so overlap isn't knowable and no yield is inferred from the number.
        </p>
      </section>

      {/* ---- Ignored ---- */}
      {miningIgnored.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ignored</h2>
          <div className="flex flex-wrap gap-1.5">
            {miningIgnored.map((k) => (
              <button
                key={k}
                onClick={() => toggleMiningIgnored(k)}
                className="rounded border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground line-through hover:text-foreground"
                title="Click to stop ignoring"
              >
                {labelFor(k)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/70">Excluded from each rock's expected value, but still shown so a low total is explained.</p>
        </section>
      )}

      {/* ---- Rock log ---- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Prospected rocks {rocks.length > 0 && <span className="normal-case font-normal">({rocks.length} shown)</span>}
        </h2>
        {rocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet — prospect a rock and it lands here.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Ring</th>
                  <th className="px-3 py-2 text-left">Components — click to ignore</th>
                  <th className="px-3 py-2 text-right">Est. value</th>
                  <th className="px-3 py-2 text-right">Got</th>
                  <th className="px-3 py-2 text-right">Earned</th>
                </tr>
              </thead>
              <tbody>
                {liveRocks.map((r) => (
                  <tr key={`${r.id}:${r.t}`} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.t).toLocaleTimeString()}
                      {r.prospects > 1 && <span className="ml-1" title="re-prospected">×{r.prospects}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{r.ring || r.sys || '—'}</div>
                      <div className="text-muted-foreground">{[r.ringClass, r.reserve, r.content].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.mats.map((m) => {
                        const ign = miningIgnored.includes(m.k);
                        const tgt = effectiveTargets.includes(m.k);
                        // Value, not just target membership, drives emphasis. A 19.6% Low Temp.
                        // Diamonds chip worth ~1M Cr previously rendered identically to a 3.7%
                        // Water chip worth 526 Cr, because only targets were highlighted — so the
                        // most valuable thing in a rock could be completely invisible.
                        const value = (m.price ?? 0) * (m.est ?? 0);
                        const big = !ign && value >= 250_000;
                        const mid = !ign && !big && value >= 60_000;
                        return (
                          <button
                            key={m.k}
                            onClick={() => toggleMiningIgnored(m.k)}
                            title={ign ? 'Ignored — click to restore' : 'Click to ignore this material'}
                            className={`mr-1 mb-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
                              ign ? 'bg-muted/40 text-muted-foreground line-through'
                                : big ? 'bg-amber-400/20 text-amber-200 font-semibold ring-1 ring-amber-400/40'
                                  : mid ? 'bg-emerald-500/15 text-emerald-300'
                                    : tgt ? 'bg-cyan-500/15 text-cyan-300'
                                      : 'bg-muted/25 text-foreground hover:bg-muted/50'
                            }`}
                          >
                            {tgt && !ign ? '🎯 ' : ''}{m.n} {m.p.toFixed(1)}% ~{m.est}t
                            {value > 0 && !ign && <span className="ml-1 opacity-80">· {cr(value)}</span>}
                          </button>
                        );
                      })}
                      {r.motherlode && (
                        <span className="ml-1 rounded bg-purple-500/15 px-1.5 py-0.5 text-xs text-purple-300" title="Core material — needs a seismic charge launcher">
                          core: {r.motherlode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.estValue ? `~${cr(r.estValue)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.gotTotal || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400 font-medium">{r.gotValue ? cr(r.gotValue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Credits by location ---- */}
      {summary && (summary.locations?.rings?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Credits by location</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ring</th>
                    <th className="px-3 py-2 text-right">Tonnes</th>
                    <th className="px-3 py-2 text-right" title="Average value per prospected rock, at today's prices">Avg/rock</th>
                    <th className="px-3 py-2 text-right" title="Share of this ring's rocks at or above your galaxy-wide median rock">Worth it</th>
                    <th className="px-3 py-2 text-right" title="Actually earned — priced when refined">Earned</th>
                    <th className="px-3 py-2 text-right" title="That tonnage valued at today's prices">@ today</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.locations.rings.slice(0, 12).map((l) => (
                    <tr key={l.name} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="truncate max-w-[20rem]">{l.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[l.ringClass, l.reserve].filter(Boolean).join(' · ') || '—'} · {l.rocks} rocks
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.tonnes}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.avgPerRock ? `~${cr(l.avgPerRock)}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.worthPct != null ? `${l.worthPct}%` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{l.credits ? cr(l.credits) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.valueToday ? `~${cr(l.valueToday)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">System</th>
                    <th className="px-3 py-2 text-right">Rings</th>
                    <th className="px-3 py-2 text-right">Tonnes</th>
                    <th className="px-3 py-2 text-right">Earned</th>
                    <th className="px-3 py-2 text-right">@ today</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.locations.systems.slice(0, 12).map((l) => (
                    <tr key={l.name} className="border-t border-border/60">
                      <td className="px-3 py-2">{l.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.rings ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.tonnes}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{l.credits ? cr(l.credits) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.valueToday ? `~${cr(l.valueToday)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70">
            <strong>Earned</strong> is real: each tonne priced at the mission or market rate in force
            the moment it refined. <strong>@ today</strong> re-values the same tonnage at current
            prices — useful for comparing rings across time, but it is not what you were paid.
            Tonnage seeded from journal history has no Earned figure, because no price was observed
            then and inventing one would make the column a lie.
          </p>
        </section>
      )}

      {/* ---- Extraction rate over time ---- */}
      {summary && summary.rateHistory.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Extraction rate by ring</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-left">Ring</th>
                  <th className="px-3 py-2 text-right">Rocks</th>
                  <th className="px-3 py-2 text-right">Tonnes</th>
                  <th className="px-3 py-2 text-right">t/hr</th>
                </tr>
              </thead>
              <tbody>
                {summary.rateHistory.map((h) => (
                  <tr key={`${h.ring}|${h.day}`} className="border-t border-border/60">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{h.day}</td>
                    <td className="px-3 py-2">
                      <div>{h.ring}</div>
                      <div className="text-xs text-muted-foreground">{[h.ringClass, h.reserve].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.rocks}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.tonnes}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                      {h.tonnesPerHour != null ? h.tonnesPerHour.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
