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
import { formatRingName } from '@/lib/ringNames';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';
import {
  cr, ringClassText, RESERVE_TONE, MiningHudCss, HeroBand, DistributionBoard, HBarChart, TrophyWall,
  type Hist, type ScanPing, type BadgeInfo, type TrophyRecords,
} from './MiningHud';

interface MaterialInfo { key: string; label: string; from: string[]; laserProven: boolean; crPerTonne?: number | null; mission?: boolean; basis?: string; liveStation?: string | null }
interface MissionInfo { label: string; tonnes: number; reward: number; crPerTonne: number; count: number; expiry: string; wing: boolean }
interface PacingInfo {
  key: string; label: string; tonnes: number; crPerTonne: number; expiry: string; wing: boolean;
  measuredTonnesPerHour: number | null; hoursSoloWorstCase: number | null; basis: string;
}
interface RateRow {
  ring: string; sys: string; ringClass: string; reserve: string; day: string;
  tonnes: number; rocks: number; hours: number; tonnesPerHour: number | null;
  hotspotPct?: number;
}
interface RockMat { k: string; n: string; p: number; est: number; price: number | null }
interface Rock {
  id: string; t: string; sys: string; ring: string; ringClass: string; reserve: string;
  content: string; remaining: number; motherlode: string | null;
  mats: RockMat[]; estValue: number; got: Record<string, number>; gotTotal: number; gotValue: number; prospects: number;
  hotspot?: boolean;
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
interface UnmappedRow {
  name: string; system: string; systemAddress?: number | null;
  ringClass?: string; reserve?: string; depthLs?: number | null;
}
interface Summary {
  missions: Record<string, MissionInfo>;
  pacing: PacingInfo[];
  wingCaveat: string;
  snapshot: {
    ring: { name: string; ringClass: string; reserve: string } | null; system: string;
    currentRock: Rock | null; miningActive: boolean;
    sessionCredits: number; sessionTonnes: number; rockCredits: number;
    sessionStartedAt?: number | null;
    streak?: { current: number; best: number };
    inHotspot?: boolean;
  };
  catchStats?: { value: { hist: Hist; best: number }; count: number; classApplied?: string; classRequested?: string | null };
  trophies?: { records: TrophyRecords; badges: BadgeInfo[]; streak: { current: number; best: number } };
  rateHistory: RateRow[];
  locations: { rings: LocRow[]; systems: LocRow[] };
  unmapped?: { mine: UnmappedRow[]; counts: { mine: number; total: number } };
  materials: MaterialInfo[];
  index: { rings: number; systems: number; materials: number };
}

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };

// cr / ringClassText / RESERVE_TONE now live in MiningHud.tsx (single source).

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
  const [unmappedScope, setUnmappedScope] = useState<'mine' | 'all'>('mine');
  const [rocksExpanded, setRocksExpanded] = useState(false);
  // Live layer — SSE events beat the 15s summary poll so the hero moves the moment a tonne lands.
  const [live, setLive] = useState<{ sessionCredits: number; sessionTonnes: number; rockCredits: number; streak: number; sessionStartedAt: number | null; at: number } | null>(null);
  const [scans, setScans] = useState<ScanPing[]>([]);
  const [unmappedAll, setUnmappedAll] = useState<UnmappedRow[] | null>(null);
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

  // Live wiring: refined tonnes drive the hero counter/rate, scans ping the distribution board,
  // catches refresh the rock list without waiting for the poll.
  useEffect(() => {
    const offs = [
      sseSubscribe('mining_refined', (raw) => {
        const e = raw as Record<string, unknown>;
        setLive({
          sessionCredits: Number(e.sessionCredits) || 0,
          sessionTonnes: Number(e.sessionTonnes) || 0,
          rockCredits: Number(e.rockCredits) || 0,
          streak: Number(e.streak) || 0,
          sessionStartedAt: Number(e.sessionStartedAt) || null,
          at: Date.now(),
        });
      }),
      sseSubscribe('mining_scan', (raw) => {
        const e = raw as Record<string, unknown>;
        setScans((prev) => [...prev, {
          value: Number(e.value) || 0, bar: Number(e.bar) || 0, strong: Number(e.strong) || 0,
          hasTarget: !!e.hasTarget, ring: String(e.ring || ''), at: Date.now(),
        }].slice(-14));
      }),
      sseSubscribe('mining_streak', (raw) => {
        const e = raw as Record<string, unknown>;
        setLive((prev) => prev ? { ...prev, streak: Number(e.current) || 0, at: Date.now() } : prev);
      }),
      sseSubscribe('mining_catch', () => { loadRocks(); }),
    ];
    return () => { offs.forEach((f) => f()); };
  }, [loadRocks]);

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
    return catalog
      .filter((m) => !s || m.label.toLowerCase().includes(s))
      .slice()
      .sort((a, b) => Number(b.laserProven) - Number(a.laserProven)
        || (b.crPerTonne ?? 0) - (a.crPerTonne ?? 0)
        || a.label.localeCompare(b.label));
  }, [catalog, search]);

  const snap = summary?.snapshot;

  const toggleHotspotLive = useCallback(() => {
    fetch(q('/api/mining/hotspot'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: !(snap?.inHotspot) }),
    }).then(() => loadSummary()).catch(() => {});
  }, [snap, loadSummary]);

  const markSessionHotspot = useCallback((ring: string, day: string, on: boolean) => {
    fetch(q('/api/mining/hotspot'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ring, day, hotspot: on }),
    }).then(() => { loadSummary(); loadRocks(); }).catch(() => {});
  }, [loadSummary, loadRocks]);

  // The log only writes a rock once the NEXT prospect supersedes it, so the rock currently under
  // the lasers would otherwise not appear until you moved on — and then only at the next 15s poll.
  // Prepend the in-flight rock from the snapshot so what you just shot at is visible immediately.
  const liveRocks = useMemo(() => {
    const cur = snap?.currentRock;
    if (!cur) return rocks;
    return rocks.some((r) => r.id === cur.id && r.t === cur.t) ? rocks : [cur, ...rocks];
  }, [rocks, snap]);

  // Live layer wins over the 15s poll when it's fresher.
  const sess = {
    credits: Math.max(live?.sessionCredits ?? 0, snap?.sessionCredits ?? 0),
    tonnes: Math.max(live?.sessionTonnes ?? 0, snap?.sessionTonnes ?? 0),
    rock: live?.rockCredits ?? snap?.rockCredits ?? 0,
    startedAt: live?.sessionStartedAt ?? snap?.sessionStartedAt ?? null,
    streak: live?.streak ?? snap?.streak?.current ?? summary?.trophies?.streak.current ?? 0,
  };
  const bestTphHere = useMemo(() => {
    const hist = summary?.rateHistory ?? [];
    const here = snap?.ring?.name;
    const inRing = here ? hist.filter((h) => h.ring === here && h.tonnesPerHour) : [];
    const pool = inRing.length ? inRing : hist.filter((h) => h.tonnesPerHour);
    return {
      tph: pool.length ? Math.max(...pool.map((h) => h.tonnesPerHour as number)) : 0,
      scope: inRing.length ? 'your best here' : 'your best anywhere',
    };
  }, [summary, snap]);

  return (
    <div className="p-4 space-y-5 max-w-[1400px]">
      <MiningHudCss />
      <HeroBand
        active={!!snap?.miningActive}
        credits={sess.credits}
        tonnes={sess.tonnes}
        rockCredits={sess.rock}
        startedAt={sess.startedAt}
        streak={sess.streak}
        bestStreak={summary?.trophies?.streak.best ?? 0}
        ring={snap?.ring ?? null}
        bestTph={bestTphHere.tph}
        bestTphScope={bestTphHere.scope}
        indexLine={summary?.index ? `${summary.index.rings} mapped rings · ${summary.index.materials} materials` : ''}
        inHotspot={!!snap?.inHotspot}
        onHotspotToggle={toggleHotspotLive}
      />

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <DistributionBoard
        hist={summary?.catchStats?.value.hist ?? null}
        best={summary?.catchStats?.value.best ?? 0}
        count={summary?.catchStats?.count ?? 0}
        scans={scans}
        classLabel={summary?.catchStats?.classApplied && summary.catchStats.classApplied !== 'all'
          ? summary.catchStats.classApplied.toLowerCase()
          : undefined}
      />

      {/* ---- Rock log ---- */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Asteroids</h2>
          {liveRocks.length > 5 && (
            <button
              onClick={() => setRocksExpanded((x) => !x)}
              className="rounded border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {rocksExpanded ? 'Show last 5' : `Show all ${liveRocks.length}`}
            </button>
          )}
        </div>
        {rocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet — prospect an asteroid and it lands here.</p>
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
                {(rocksExpanded ? liveRocks : liveRocks.slice(0, 5)).map((r) => (
                  <tr key={`${r.id}:${r.t}`} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.t).toLocaleTimeString()}
                      {r.prospects > 1 && <span className="ml-1" title="re-prospected">×{r.prospects}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{r.hotspot && <span className="mr-1 text-amber-400" title="mined in a hotspot">{'◉'}</span>}{formatRingName(r.ring) || r.sys || '—'}</div>
                      <div className="text-muted-foreground">{[ringClassText(r.ringClass), r.reserve, r.content].filter(Boolean).join(' · ')}</div>
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
                {(() => { const m = catalog.find((c) => c.key === k); return m?.crPerTonne != null
                  ? <span className="ml-1 tabular-nums opacity-80">{cr(m.crPerTonne)}</span> : null; })()}
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
                title={`${fromMission ? 'Required by an active mission · ' : ''}${m.crPerTonne != null ? `${m.crPerTonne.toLocaleString()} Cr/t (${m.basis === 'mission' ? 'mission rate' : m.basis === 'live' ? `best non-FC sell in carrier range (500 ly)${m.liveStation ? ` — ${m.liveStation}` : ''}` : 'avg of your markets'}) · ` : 'no price seen · '}${m.from.join(', ')}`}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  on ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                     : 'border-border bg-muted/20 text-muted-foreground hover:text-foreground'
                } ${!m.laserProven ? 'opacity-60' : ''}`}
              >
                {m.label}
                {m.crPerTonne != null && (
                  <span className={`ml-1 tabular-nums ${m.mission ? 'text-emerald-300' : 'opacity-70'}`}>
                    {cr(m.crPerTonne)}{m.mission ? ' ⚑' : ''}
                  </span>
                )}
                {!m.laserProven && <span className="ml-1 opacity-60">·hotspot only</span>}
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
          <div className="grid gap-2 md:grid-cols-3">
            {rings.slice(0, 3).map((r, i) => (
              <div key={`card:${r.ring}`} className={`edc-chamfer relative border bg-card/70 px-4 py-3 ${i === 0 ? 'border-amber-400/50 shadow-[0_0_22px_-8px_rgba(251,146,60,0.5)]' : 'border-border'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[10px] font-bold tracking-widest ${i === 0 ? 'text-amber-300' : 'text-muted-foreground'}`}>#{i + 1}{i === 0 ? ' · BEST BET' : ''}</span>
                  <span className="text-[10px] text-muted-foreground">{r.source === 'journal' ? 'your map' : 'spansh'}</span>
                </div>
                <div className="mt-1 text-sm font-semibold leading-tight">{formatRingName(r.ring)}</div>
                <div className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
                  {r.ringClass ? ringClassText(r.ringClass) : ''} <span className={RESERVE_TONE[r.reserve] ?? ''}>{r.reserve}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-3 tabular-nums text-sm">
                  <span>{r.distanceLy != null ? `${r.distanceLy.toFixed(0)} ly` : '— ly'}</span>
                  <span className="text-muted-foreground">{r.depthLs != null ? `${r.depthLs.toLocaleString()} Ls` : ''}</span>
                  {r.measuredTph != null && <span className="text-emerald-400">{r.measuredTph.toFixed(0)} t/hr measured</span>}
                </div>
                <div className="mt-1.5">
                  {r.hits.map((h) => (
                    <span key={h.key} className="mr-1 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[11px] text-cyan-300">
                      {h.label}{h.count > 1 ? ` ×${h.count}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {rings.length > 3 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">All {rings.length} results</summary>
          <div className="overflow-x-auto border-t border-border">
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
                      <div className="font-medium">{formatRingName(r.ring)}</div>
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
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.ringClass ? ringClassText(r.ringClass) : '—'}</td>
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
          </details>
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

      {/* ---- Trophy wall ---- */}
      {summary?.trophies && (
        <TrophyWall records={summary.trophies.records} badges={summary.trophies.badges} streak={summary.trophies.streak} />
      )}

      {/* ---- Credits by location ---- */}
      {summary && (summary.locations?.rings?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Credits by location</h2>
          <HBarChart
            title="Value pulled per ring — at today's prices"
            rows={summary.locations.rings.slice(0, 8).map((l) => ({
              label: l.name, sub: `${l.tonnes}t · ${l.rocks} rocks${l.worthPct != null ? ` · ${l.worthPct}% worth it` : ''}`,
              value: l.valueToday || l.credits || 0,
            }))}
            fmt={(v) => `~${cr(v)}`}
            barClass="bg-emerald-400/70"
          />
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Raw tables — rings & systems</summary>
          <div className="grid gap-3 lg:grid-cols-2 border-t border-border p-2">
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
                          {[ringClassText(l.ringClass), l.reserve].filter(Boolean).join(' · ') || '—'} · {l.rocks} rocks
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
          </details>
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
          <HBarChart
            title="Measured tonnes per hour — best sessions"
            rows={summary.rateHistory.filter((h) => h.tonnesPerHour).slice(0, 8).map((h) => ({
              label: h.ring, sub: `${h.day} · ${ringClassText(h.ringClass)} ${h.reserve || ''} · ${h.tonnes}t`,
              value: h.tonnesPerHour as number,
            }))}
            fmt={(v) => `${v.toFixed(0)} t/hr`}
            barClass="bg-sky-400/70"
          />
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Raw table — all sessions</summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-left">Ring</th>
                  <th className="px-3 py-2 text-right">Rocks</th>
                  <th className="px-3 py-2 text-right">Tonnes</th>
                  <th className="px-3 py-2 text-right">t/hr</th>
                  <th className="px-3 py-2 text-center" title="Mark this session as hotspot-mined">Hotspot</th>
                </tr>
              </thead>
              <tbody>
                {summary.rateHistory.map((h) => (
                  <tr key={`${h.ring}|${h.day}`} className="border-t border-border/60">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{h.day}</td>
                    <td className="px-3 py-2">
                      <div>{h.ring}</div>
                      <div className="text-xs text-muted-foreground">{[ringClassText(h.ringClass), h.reserve].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.rocks}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.tonnes}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                      {h.tonnesPerHour != null ? h.tonnesPerHour.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => markSessionHotspot(h.ring, h.day, !((h.hotspotPct ?? 0) >= 50))}
                        title={(h.hotspotPct ?? 0) >= 50 ? 'Marked hotspot — click to unmark' : 'Mark all rocks in this session as hotspot-mined'}
                        className={`text-sm ${(h.hotspotPct ?? 0) >= 50 ? 'text-amber-400' : 'text-muted-foreground/50 hover:text-foreground'}`}
                      >
                        {(h.hotspotPct ?? 0) >= 50 ? '◉' : '○'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        </section>
      )}
      {/* ---- Rings needing a DSS scan ---- */}
      {summary?.unmapped && summary.unmapped.counts.total > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            {'🔭'} Needs a DSS scan — {summary.unmapped.counts.mine} in your systems
          </summary>
        <section className="space-y-2 border-t border-border p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {summary.unmapped.counts.mine} in your systems · {summary.unmapped.counts.total} everywhere you've scanned
            </span>
            <button
              onClick={() => {
                const next = unmappedScope === 'mine' ? 'all' : 'mine';
                setUnmappedScope(next);
                if (next === 'all' && !unmappedAll) {
                  fetch(q('/api/mining/unmapped?scope=all'))
                    .then((r) => (r.ok ? r.json() : null))
                    .then((d) => { if (d && Array.isArray(d.rings)) setUnmappedAll(d.rings); })
                    .catch(() => { /* fall back to mine view */ });
                }
              }}
              className="rounded border border-border bg-muted/30 px-2 py-0.5 text-xs hover:bg-muted/60"
            >
              {unmappedScope === 'mine' ? 'Show all' : 'My systems'}
            </button>
          </div>
          {(() => {
            const rows = unmappedScope === 'all' ? (unmappedAll ?? summary.unmapped.mine) : summary.unmapped.mine;
            if (!rows.length) {
              return (
                <p className="text-sm text-muted-foreground">
                  Every ring in your colony systems is mapped. {'🎉'}
                  {summary.unmapped.counts.total > 0 && ` (${summary.unmapped.counts.total} unmapped elsewhere — Show all)`}
                </p>
              );
            }
            const shown = rows.slice(0, 100);
            return (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">System</th>
                      <th className="px-3 py-2 text-left">Ring</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Reserve</th>
                      <th className="px-3 py-2 text-right">Ls deep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.name} className="border-t border-border/60">
                        <td className="px-3 py-2">{u.system || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {u.system && u.name.startsWith(u.system) ? u.name.slice(u.system.length).trim() : u.name}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{u.ringClass ? ringClassText(u.ringClass) : '—'}</td>
                        <td className={`px-3 py-2 ${RESERVE_TONE[u.reserve ?? ''] ?? 'text-muted-foreground'}`}>{u.reserve || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{u.depthLs != null ? u.depthLs.toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > shown.length && (
                  <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/60">
                    +{rows.length - shown.length} more not shown
                  </div>
                )}
              </div>
            );
          })()}
          <p className="text-xs text-muted-foreground/70">
            Rings you've seen in a scan but never DSS-mapped — no hotspot data exists for them, so the
            ring finder and value baselines can't account for them. Belts are excluded (they can't be
            mapped). Only covers systems where you actually scanned the parent body.
          </p>
        </section>
        </details>
      )}

    </div>
  );
}
