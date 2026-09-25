/**
 * Approach — every descent from orbital cruise to a pad or a surface site, measured against the
 * commander's shortest run at that target. Fed by the server's approach recorder: the runs on file
 * per target, and the run in progress once a second over SSE.
 *
 * Reads: /api/approach/targets, /api/approach/runs?target=, /api/approach/live.
 * Live:  approach_start · approach_sample · approach_mark · approach_complete · approach_abandoned.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sseSubscribe } from '@/services/sseBus';

// ---- types (mirror server/journal/approach.js) ------------------------------------------------
interface Target { key: string; kind: 'port' | 'site'; name: string; marketId?: number | null; lat: number; lon: number; bodyId?: number | null; body?: string | null; runs?: number; cleanRuns?: number; shortestS?: number | null; lastAt?: string | null }
interface Sample { t: number; at: string; lat: number; lon: number; alt: number | null; hdg: number | null; radius: number | null; dist: number | null; glide: boolean; sc: boolean; speed: number | null; slope: number | null }
interface Mark { kind: string; t: number; at: string; dist: number | null; alt: number | null; speed: number | null; rangeM?: number | null; countdownS?: number | null; pad?: number | null; broken?: boolean }
interface Ship { type: string; name: string; ident?: string | null }
interface Run {
  id: string; startedAt: string; endedAt?: string; endKind?: string; body: string | null; target: Target | null; ship?: Ship | null; totalS: number; runS?: number; runupS?: number; gateT?: number | null; clean: boolean;
  oc: { startDistM: number | null; startAltM: number | null; durationS: number | null };
  glide: { startT: number; startDistM: number | null; startAltM: number | null; endT: number | null; endDistM: number | null; endAltM: number | null; broken: boolean; slopeDeg: number | null; secondsToTargetAtStart: number | null } | null;
  docking: { requestedT: number | null; grantedT: number | null; pad: number | null; handoffT: number | null; handoffDistM: number | null; handoffAltM: number | null; handoffSpeedMps: number | null; computerS: number | null; clearanceToPadS: number | null; retakes: number } | null;
  marks: Mark[]; samples: Sample[];
  cruise?: { entryDistM: number | null; entryAltM: number | null; entryT?: number | null; entryHudRangeM?: number | null; entryCountdownS?: number | null } | null;
  sectors?: Sectors | null;
}
type Sectors = { s1: number | null; s2: number | null; s3: number | null; s4: number | null };
interface Summary {
  runs: number; cleanRuns: number; shortest: Run | null; sameShip?: boolean; shipType?: string | null; envelope: { dist: number; min: number; max: number }[]; corridor: [number, number]; sectorBest?: Sectors | null;
  recommendation: { cruise?: { entryDistM: number | null; entryAltM: number | null; entryHudRangeM: number | null; entryCountdownS: number | null; checkpointAltM: number | null; fromRuns: number } | null; glideStart: { distM: number; altM: number; windowM: number; secondsToTarget: number | null; slopeDeg: number | null; fromRuns: number } | null; handoff: { distM: number | null; altM: number | null; speedMps: number | null; computerS: number | null; clearanceToPadS: number | null; fromRuns: number; retakes: { withS: number | null; withoutS: number | null; runsWith: number; runsWithout: number } } | null; corridor: [number, number]; nominalCorridor: boolean } | null;
}
interface Figures { phase: string; brief?: string; refShip?: { type: string; name: string; same: boolean } | null; t: number; gateT?: number | null; runT?: number | null; lineAltM?: number | null; lineDeg?: number | null; dist: number | null; alt: number | null; speed: number | null; slope: number | null; glide: boolean; computer: boolean; secondsToTarget: number | null; vsShortestS: number | null; vsShortestAltM: number | null; coach: string; rangeM?: number | null; countdownS?: number | null; refCountdownS?: number | null; word?: string | null; needDeg?: number | null; lat?: number; lon?: number; hdg?: number | null; radius?: number | null; at: string }
interface Live { runId: string; startedAt: string; body: string | null; target: Target | null; ship?: Ship | null; marks: Mark[]; samples: Sample[]; computer: boolean; figures: Figures | null; done?: boolean }

// ---- helpers ------------------------------------------------------------------------------------
const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };
const km = (m: number | null | undefined) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} m` : `${Math.round(m / 1000)} km`);
const alt = (m: number | null | undefined) => (m == null ? '—' : m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`);
const fmtT = (s: number | null | undefined) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const Mm = (m: number | null | undefined) => (m == null ? '—' : `${(m / 1e6).toFixed(2)} Mm`); // the HUD's unit at orbital-cruise range
const when = (iso: string | undefined) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const PHASE_COLOR: Record<string, string> = { 'Gravity well': '#7fb3f0', 'Orbital cruise': '#3987e5', Glide: '#d95926', 'Normal flight': '#2ec48f', Docking: '#199e70' };
const RUN_COLORS = ['#9085e9', '#d55181', '#c98500', '#3987e5', '#e66767', '#199e70'];
const GATE_M = 100000;
const MARK_LABEL: Record<string, string> = { position_fix: 'First position fix', gate: 'Clock starts · 100 km', approach_body: 'Orbital cruise begins', target_known: 'Target on file', supercruise_exit: 'Left supercruise', glide_start: 'Glide begins', glide_end: 'Glide ends', docking_requested: 'Docking requested', docking_granted: 'Docking granted', handoff: 'Docking computer takes over', retake: 'Control retaken', docked: 'Docked', touchdown: 'Touchdown' };

function phaseAt(marks: Mark[], t: number): string {
  const at = (k: string) => marks.find((m) => m.kind === k)?.t ?? null;
  const gs = at('glide_start'), ge = at('glide_end'), dr = at('docking_requested'), ab = at('approach_body');
  if (dr != null && t >= dr) return 'Docking';
  if (ge != null && t >= ge) return 'Normal flight';
  if (gs != null && t >= gs) return 'Glide';
  if (marks.some((m) => m.kind === 'position_fix') && (ab == null || t < ab)) return 'Gravity well';
  return 'Orbital cruise';
}
function valueAtDistance(samples: Sample[], dist: number, key: 't' | 'alt'): number | null {
  const pts = samples.filter((s) => s.dist != null && s[key] != null);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (dist <= a.dist! && dist >= b.dist!) { const u = a.dist === b.dist ? 0 : (a.dist! - dist) / (a.dist! - b.dist!); return (a[key] as number) + ((b[key] as number) - (a[key] as number)) * u; }
  }
  return null;
}
/** Local east/north metres of a point relative to the target, on the body's radius. */
function localXY(lat: number, lon: number, t: { lat: number; lon: number }, radius: number) {
  const rad = Math.PI / 180;
  let dLon = lon - t.lon; if (dLon > 180) dLon -= 360; if (dLon < -180) dLon += 360;
  return { x: dLon * rad * Math.cos(t.lat * rad) * radius, y: (lat - t.lat) * rad * radius };
}

// ---- page ---------------------------------------------------------------------------------------
export function ApproachPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState<string>('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shipFilter, setShipFilter] = useState<string>('');       // '' = the ship you are in; 'all' = every hull
  const [currentShip, setCurrentShip] = useState<Ship | null>(null);
  const [ships, setShips] = useState<{ type: string; name: string; runs: number }[]>([]);
  const shipRef = useRef(shipFilter);
  shipRef.current = shipFilter;
  const targetRef = useRef(targetKey);
  targetRef.current = targetKey;

  const loadTargets = useCallback(async () => {
    try {
      const r = await fetch(q('/api/approach/targets'));
      if (!r.ok) return;
      const data = await r.json();
      setTargets(data.targets || []);
      if (data.currentShip) setCurrentShip(data.currentShip);
      if (data.live && data.live.target && !targetRef.current) setTargetKey(data.live.target.key);
      else if (!targetRef.current && data.targets && data.targets.length) setTargetKey(data.targets[0].key);
    } catch { /* offline */ }
  }, []);
  const loadRuns = useCallback(async (key: string, ship?: string) => {
    if (!key) { setRuns([]); setSummary(null); return; }
    try {
      const sh = (ship ?? shipRef.current) || 'current'; // '' = the ship you are in; the server knows which
      const r = await fetch(q(`/api/approach/runs?target=${encodeURIComponent(key)}&ship=${encodeURIComponent(sh)}`));
      if (!r.ok) return;
      const data = await r.json();
      setRuns(data.runs || []); setSummary(data.summary || null); setShips(data.ships || []);
      if (data.currentShip) setCurrentShip(data.currentShip);
    } catch { /* offline */ }
  }, []);
  const loadLive = useCallback(async () => {
    try { const r = await fetch(q('/api/approach/live')); if (r.ok) { const d = await r.json(); setLive(d.live || null); } } catch { /* offline */ }
  }, []);

  useEffect(() => { (async () => { await Promise.all([loadTargets(), loadLive()]); setLoading(false); })(); }, [loadTargets, loadLive]);
  useEffect(() => { loadRuns(targetKey, shipFilter); setSelectedId(null); setFocusId(null); }, [targetKey, shipFilter, loadRuns]);

  // Live feed: a run opens, samples arrive once a second, marks land, the run closes and joins the list.
  useEffect(() => {
    const unsubs = [
      sseSubscribe('approach_start', (raw) => {
        const ev = raw as unknown as { runId: string; body: string | null; target: Target | null; timestamp: string };
        setLive({ runId: ev.runId, startedAt: ev.timestamp, body: ev.body, target: ev.target, marks: [], samples: [], computer: false, figures: null });
        if (ev.target) setTargetKey(ev.target.key);
        loadTargets();
      }),
      sseSubscribe('approach_sample', (raw) => {
        const f = raw as unknown as Figures & { runId: string; target: Target | null };
        setLive((prev) => {
          const base: Live = prev && prev.runId === f.runId ? prev : { runId: f.runId, startedAt: f.at, body: null, target: f.target, marks: [], samples: [], computer: false, figures: null };
          const s: Sample = { t: f.t, at: f.at, lat: f.lat ?? 0, lon: f.lon ?? 0, alt: f.alt, hdg: f.hdg ?? null, radius: f.radius ?? null, dist: f.dist, glide: f.glide, sc: false, speed: f.speed, slope: f.slope };
          const samples = base.samples.length && base.samples[base.samples.length - 1].t === s.t ? base.samples : base.samples.concat([s]);
          if (f.target && !base.target) base.target = f.target;
          return { ...base, samples, computer: f.computer, figures: f };
        });
      }),
      sseSubscribe('approach_mark', (raw) => {
        const ev = raw as unknown as { runId: string; mark: Mark };
        setLive((prev) => (prev && prev.runId === ev.runId ? { ...prev, marks: prev.marks.concat([ev.mark]) } : prev));
      }),
      sseSubscribe('approach_complete', (raw) => {
        const ev = raw as unknown as { run: Run; newShortest: boolean };
        // The live run stays on screen, marked complete, until the stored run has loaded — no blink.
        setLive((prev) => (prev ? { ...prev, done: true } : prev));
        (async () => {
          if (ev.run && ev.run.target) { setTargetKey(ev.run.target.key); await loadRuns(ev.run.target.key); setSelectedId(ev.run.id); }
          await loadTargets();
          setLive(null);
        })();
      }),
      sseSubscribe('approach_abandoned', () => setLive(null)),
    ];
    return () => { for (const u of unsubs) u(); };
  }, [loadRuns, loadTargets]);

  const target = useMemo(() => targets.find((t) => t.key === targetKey) || live?.target || null, [targets, targetKey, live]);
  const shortest = summary?.shortest || null;
  const isLive = !!live && (!live.target || live.target.key === targetKey);
  const selected: Run | null = useMemo(() => {
    if (isLive && live) { const t = live.samples.length ? live.samples[live.samples.length - 1].t : 0; const g = live.figures?.gateT ?? null; return { id: live.runId, startedAt: live.startedAt, body: live.body, target: live.target, totalS: t, gateT: g, runS: g == null ? 0 : Math.max(0, t - g), runupS: g ?? t, clean: false, oc: { startDistM: null, startAltM: null, durationS: null }, glide: null, docking: null, marks: live.marks, samples: live.samples }; }
    if (selectedId) { const r = runs.find((x) => x.id === selectedId); if (r) return r; }
    return runs.length ? runs[runs.length - 1] : null;
  }, [isLive, live, runs, selectedId]);
  const reference = shortest && selected && shortest.id === selected.id
    ? [...runs].filter((r) => r.clean && r.id !== selected.id).sort((a, b) => (a.runS ?? a.totalS) - (b.runS ?? b.totalS))[0] || null
    : shortest;

  const targetLabel = target ? `${target.name}${target.body ? ` · ${target.body}` : ''}` : 'no target yet';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Approach</h1>
          <p className="text-sm text-muted-foreground mt-1">Every descent to the pad, timed from 100 km out and measured against your shortest run there. {isLive ? <span className="text-primary font-medium">Live: {live?.target?.name || live?.body || 'descending'}</span> : null}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="approach-target" className="text-xs text-muted-foreground">Target</label>
          <select id="approach-target" value={targetKey} onChange={(e) => setTargetKey(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary">
            {!targets.length && <option value="">no runs recorded yet</option>}
            {targets.map((t) => <option key={t.key} value={t.key}>{t.name}{t.body ? ` · ${t.body}` : ''} · {t.runs} run{t.runs === 1 ? '' : 's'}{t.shortestS != null ? ` · shortest ${fmtT(t.shortestS)} from 100 km` : ''}</option>)}
          </select>
          <label htmlFor="approach-ship" className="text-xs text-muted-foreground ml-2">Ship</label>
          <select id="approach-ship" value={shipFilter} onChange={(e) => setShipFilter(e.target.value)} className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary" title="The shortest run and the hand-off are measured in this hull; orbital cruise and the glide are pooled across hulls">
            <option value="">{currentShip ? `${currentShip.name} · the one you're in` : 'the ship you are in'}</option>
            {ships.filter((x) => x.type !== (currentShip?.type || '')).map((x) => <option key={x.type} value={x.type}>{x.name} · {x.runs} run{x.runs === 1 ? '' : 's'}</option>)}
            <option value="all">all ships</option>
          </select>
        </div>
      </header>

      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : null}
      {!loading && !targets.length && !live ? (
        <div className="bg-card border border-border rounded-lg p-5 text-sm text-muted-foreground space-y-2">
          <p className="text-foreground font-medium">Nothing recorded yet.</p>
          <p>The first run starts the moment you enter orbital cruise on a body with a port or a surface-mining nav lock. From then on every second is sampled to the pad, and this page fills in: the slope, the map from above, the phase boundaries, and after two clean runs the recommendations.</p>
        </div>
      ) : null}

      {(selected || isLive) ? (
        <>
          <Hud live={isLive ? live : null} run={selected} reference={reference} summary={summary} targetLabel={targetLabel} />
          {!isLive ? <SectorStrip run={selected} reference={reference} summary={summary} /> : null}
          <SlopeChart run={selected} reference={reference} summary={summary} live={isLive} />
          <TopMap runs={runs} live={isLive ? live : null} target={target} selectedId={selected?.id || null} focusId={focusId} onFocus={(id) => { setFocusId((f) => (f === id ? null : id)); if (!isLive) setSelectedId(id); }} shortestId={shortest?.id || null} referenceId={reference?.id || null} />
          <PhaseStrip run={selected} reference={reference} />
          <Boundaries run={selected} reference={reference} />
          <Recommendation summary={summary} target={target} />
        </>
      ) : null}

      <p className="text-xs text-muted-foreground max-w-3xl">Signals: a run opens at the first position fix in supercruise toward a target on file, or on ApproachBody; ApproachSettlement names the port and its coordinates; Glide Mode (Status flag) brackets the glide; DockingRequested and DockingGranted, then the music track "DockingComputer" for the hand-off and any retake; Docked or Touchdown closes it. Position once a second from Status.json, distances on the body's radius. A glide that ends above {alt(5000)} counts as broken and stays out of the reference.</p>
    </div>
  );
}

// ---- HUD -----------------------------------------------------------------------------------------
function Hud({ live, run, reference, summary, targetLabel }: { live: Live | null; run: Run | null; reference: Run | null; summary: Summary | null; targetLabel: string }) {
  const f = live?.figures || null;
  const last = run && run.samples.length ? run.samples[run.samples.length - 1] : null;
  const phase = f && !live?.done ? f.phase : run && !run.clean ? (run.endKind === 'dropped' ? 'Dropped out of supercruise' : run.glide && run.glide.broken ? 'Run complete · broken glide' : 'Run complete · not counted') : run || live ? 'Run complete' : '—';
  const vsS = f && !live?.done ? f.vsShortestS : run && run.clean && reference && run.id !== reference.id ? (reference.runS ?? reference.totalS) - (run.runS ?? run.totalS) : null;
  const vsClass = vsS == null || vsS === 0 ? 'text-foreground' : vsS > 0 ? 'text-green-400' : 'text-amber-300';
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: f && !live?.done ? PHASE_COLOR[f.phase] || '#64748b' : '#64748b', color: '#0a0e1a' }}>{phase}</span>
      <span className="text-muted-foreground">{targetLabel}{run && !f ? ` · ${when(run.startedAt)}` : ''}</span>
      <Stat k="time from 100 km" v={f ? (f.runT == null ? `run-up ${fmtT(f.t)}` : fmtT(f.runT)) : run ? `${fmtT(run.runS ?? run.totalS)}${run.runupS ? ` · run-up ${run.runupS} s` : ''}` : '—'} />
      <Stat k="to target" v={km(f ? f.dist : last?.dist)} />
      <Stat k="altitude" v={alt(f ? f.alt : last?.alt)} />
      <Stat k="slope" v={f && f.slope != null ? `${f.slope}° down` : run?.glide?.slopeDeg != null ? `${run.glide.slopeDeg}° glide` : '—'} />
      <Stat k="closing" v={f && f.speed != null ? `${f.speed} m/s` : '—'} />
      <Stat k="countdown" v={f && f.countdownS != null ? fmtT(Math.round(f.countdownS)) : run?.glide?.secondsToTargetAtStart != null ? `${run.glide.secondsToTargetAtStart} s at the glide` : '—'} />
      <span className="text-muted-foreground">vs shortest{reference && summary && summary.sameShip === false && reference.ship ? ` (${reference.ship.name})` : ''}: <b className={`font-mono ${vsClass}`}>{vsS == null ? (run && !(f && !live?.done) && !run.clean ? (run.endKind === 'dropped' ? 'dropped' : 'not counted') : summary && summary.cleanRuns ? '—' : 'no reference yet') : vsS === 0 ? 'level' : `${Math.abs(vsS)} s ${vsS > 0 ? 'ahead' : 'behind'}`}</b></span>
      {f && f.vsShortestAltM != null ? <span className="text-muted-foreground">line here {f.lineAltM != null ? <b className="font-mono text-foreground">{alt(f.lineAltM)}</b> : null}{f.lineDeg != null ? <span> at <b className="font-mono text-foreground">{f.lineDeg}°</b></span> : null}: <b className="font-mono text-foreground">{Math.abs(f.vsShortestAltM) < 150 ? 'on the line' : `${(Math.abs(f.vsShortestAltM) / 1000).toFixed(1)} km ${f.vsShortestAltM > 0 ? 'high' : 'low'}`}</b></span> : null}
      {f && f.coach && !live?.done ? <span className="ml-auto text-primary font-medium">{f.coach}</span> : null}
    </div>
  );
}
function Stat({ k, v }: { k: string; v: string }) { return <span><span className="text-muted-foreground">{k} </span><span className="font-mono tabular-nums">{v}</span></span>; }

// ---- sectors ------------------------------------------------------------------------------------
const SECTOR_NAMES: [keyof Sectors, string, string][] = [['s1', 'S1', 'descent · line to the glide'], ['s2', 'S2', 'glide'], ['s3', 'S3', 'alignment · glide end to the hand-off'], ['s4', 'S4', 'docking · hand-off to the pad']];
const SECTOR_COLOURS = { purple: '#c084fc', green: '#4ade80', yellow: '#facc15', plain: '#94a3b8' };
/** Purple: at or under the best this sector has been at the target. Green: under the shortest run's. Yellow: over it. */
function sectorColour(v: number | null, shortestV: number | null | undefined, bestV: number | null | undefined, clean: boolean): string {
  if (v == null) return SECTOR_COLOURS.plain;
  if (clean && bestV != null && v <= bestV) return SECTOR_COLOURS.purple;
  if (shortestV == null) return SECTOR_COLOURS.plain;
  return v < shortestV ? SECTOR_COLOURS.green : SECTOR_COLOURS.yellow;
}
function SectorStrip({ run, reference, summary }: { run: Run | null; reference: Run | null; summary: Summary | null }) {
  if (!run || !run.sectors) return null;
  const ref = reference && reference.id !== run.id ? reference.sectors || null : null;
  const best = summary?.sectorBest || null;
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="font-semibold text-sm">Sectors{ref ? ', against your shortest run' : ''}</h2>
        <span className="text-xs text-muted-foreground"><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px]" style={{ background: SECTOR_COLOURS.purple }}></i>best here <i className="inline-block w-2.5 h-2.5 rounded-sm ml-3 mr-1 align-[-1px]" style={{ background: SECTOR_COLOURS.green }}></i>faster than the shortest <i className="inline-block w-2.5 h-2.5 rounded-sm ml-3 mr-1 align-[-1px]" style={{ background: SECTOR_COLOURS.yellow }}></i>slower</span>
      </div>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        {SECTOR_NAMES.map(([k, label, name]) => {
          const v = run.sectors ? run.sectors[k] : null; const rv = ref ? ref[k] : null;
          const c = sectorColour(v, rv, best ? best[k] : null, run.clean);
          const d = v != null && rv != null ? v - rv : null;
          return (
            <div key={k} className="rounded border border-border/60 px-3 py-2" style={{ borderLeft: `4px solid ${c}` }}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label} · {name}</div>
              <div className="font-mono text-lg" style={{ color: c }}>{v == null ? '—' : `${v} s`}{d != null ? <span className="text-xs text-muted-foreground ml-2">{d === 0 ? 'level' : `${d > 0 ? '+' : ''}${d} s`}</span> : null}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- slope chart --------------------------------------------------------------------------------
function SlopeChart({ run, reference, summary, live }: { run: Run | null; reference: Run | null; summary: Summary | null; live: boolean }) {
  const W = 1040, H = 430, L = 64, R = 30, T = 28, B = 56, PW = W - L - R, PH = H - T - B;
  const samples = run?.samples || [];
  const refSamples = reference?.samples || [];
  const maxDist = Math.max(20000, ...samples.map((s) => s.dist ?? 0), ...refSamples.map((s) => s.dist ?? 0));
  const maxAlt = Math.max(5000, ...samples.map((s) => s.alt ?? 0), ...refSamples.map((s) => s.alt ?? 0));
  // Log axes: a run spans 500 km of run-up and 200 m of final, and the last few kilometres are the
  // ones that matter. log10(1 + km) keeps zero at the target and gives the last 10 km about a third of
  // the plot whatever the body. Slopes are read from the numbers, never by eye.
  const NICE = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
  const xTop = NICE.find((v) => v >= maxDist) ?? maxDist, yTop = NICE.find((v) => v >= maxAlt) ?? maxAlt;
  const lg = (m: number) => Math.log10(1 + m / 1000);
  const x = (d: number) => L + (1 - lg(Math.max(0, d)) / lg(xTop)) * PW, y = (a: number) => T + (1 - lg(Math.max(0, a)) / lg(yTop)) * PH;
  const xTicks = [0, ...NICE.filter((v) => v <= xTop)];
  const yTicks = [0, ...NICE.filter((v) => v <= yTop)];
  const path = (pts: Sample[]) => 'M' + pts.filter((s) => s.dist != null && s.alt != null).map((s) => `${x(s.dist!).toFixed(1)},${y(s.alt!).toFixed(1)}`).join(' L');
  const marks = (run?.marks || []).filter((m) => m.dist != null && m.alt != null && m.kind !== 'target_known');
  const [hover, setHover] = useState<{ s: Sample; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const env = summary?.envelope || [];
  const corridor = summary?.recommendation?.corridor || summary?.corridor || [15, 55];
  const gs = run?.marks.find((m) => m.kind === 'glide_start') || (summary?.recommendation?.glideStart ? { dist: summary.recommendation.glideStart.distM, alt: summary.recommendation.glideStart.altM } : null);
  const wedge = (deg: number) => { if (!gs || gs.dist == null || gs.alt == null) return ''; const rad = deg * Math.PI / 180; const runM = gs.alt / Math.tan(rad); const end = runM <= gs.dist ? [gs.dist - runM, 0] : [0, gs.alt - gs.dist * Math.tan(rad)]; const pts: string[] = []; for (let i = 0; i <= 30; i++) { const u = i / 30; pts.push(`${x(gs.dist + (end[0] - gs.dist) * u).toFixed(1)},${y(gs.alt + (end[1] - gs.alt) * u).toFixed(1)}`); } return pts.join(' L'); };
  const onMove = (ev: React.MouseEvent<SVGRectElement>) => {
    const el = svgRef.current; if (!el || !samples.length) return;
    const rect = el.getBoundingClientRect(); const px = (ev.clientX - rect.left) * (W / rect.width);
    let best: Sample | null = null; for (const s of samples) if (s.dist != null && (best == null || Math.abs(x(s.dist) - px) < Math.abs(x(best.dist!) - px))) best = s;
    if (best) setHover({ s: best, px: x(best.dist!), py: y(best.alt ?? 0) });
  };
  const phasePaths = useMemo(() => {
    const out: { phase: string; d: string }[] = [];
    if (!run) return out;
    for (const p of Object.keys(PHASE_COLOR)) {
      const seg = samples.filter((s) => phaseAt(run.marks, s.t) === p);
      if (seg.length < 1) continue;
      const next = samples[samples.indexOf(seg[seg.length - 1]) + 1];
      const pts = next ? seg.concat([next]) : seg;
      if (pts.length >= 2) out.push({ phase: p, d: path(pts) });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, samples.length, xTop, yTop]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Approach slope — altitude against distance to the target{live ? <span className="text-primary text-xs ml-2">live</span> : null}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {Object.entries(PHASE_COLOR).map(([p, c]) => <span key={p} className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-[3px] rounded" style={{ background: c }}></i>{p.toLowerCase()}</span>)}
          {reference ? <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,#cbd5e1 0 5px,transparent 5px 8px)' }}></i>shortest run · {fmtT(reference.totalS)} · {when(reference.startedAt)}</span> : null}
          {env.length ? <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-2.5 rounded" style={{ background: 'rgba(148,163,184,0.25)' }}></i>envelope of your clean runs</span> : null}
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3.5 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,#64748b 0 4px,transparent 4px 7px)' }}></i>corridor {corridor[0]}–{corridor[1]}°{summary?.recommendation?.nominalCorridor === false ? '' : ' (nominal)'}</span>
        </div>
      </div>
      <div className="relative overflow-x-auto">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px] block" role="img" aria-label="Approach profile">
          {yTicks.map((a) => <line key={`gy${a}`} x1={L} x2={W - R} y1={y(a)} y2={y(a)} stroke="rgba(148,163,184,0.14)" />)}
          {xTicks.map((d) => <line key={`gx${d}`} x1={x(d)} x2={x(d)} y1={T} y2={H - B} stroke="rgba(148,163,184,0.14)" />)}
          {yTicks.map((a) => <text key={`ty${a}`} x={L - 10} y={y(a) + 4} textAnchor="end" fontSize="11" fill="#94a3b8" fontFamily="monospace">{a === 0 ? '0' : `${a / 1000} km`}</text>)}
          {xTicks.map((d) => <text key={`tx${d}`} x={x(d)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="#94a3b8" fontFamily="monospace">{d === 0 ? 'target' : `${d / 1000} km`}</text>)}
          <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b" letterSpacing="0.06em">DISTANCE TO THE TARGET · LOG</text>
          <text x={14} y={T + 4} textAnchor="end" fontSize="11" fill="#64748b" letterSpacing="0.06em" transform={`rotate(-90 14 ${T + 4})`}>ALTITUDE · LOG</text>
          {env.length > 1 ? <path d={'M' + env.map((e) => `${x(e.dist).toFixed(1)},${y(e.max).toFixed(1)}`).join(' L') + ' L' + [...env].reverse().map((e) => `${x(e.dist).toFixed(1)},${y(e.min).toFixed(1)}`).join(' L') + ' Z'} fill="rgba(148,163,184,0.16)" /> : null}
          {gs ? <>
            <path d={`M${wedge(corridor[0])} L${wedge(corridor[1]).split(' L').reverse().join(' L')} Z`} fill="rgba(148,163,184,0.05)" />
            <path d={`M${wedge(corridor[0])}`} fill="none" stroke="#64748b" strokeWidth={1.2} strokeDasharray="5 4" />
            <path d={`M${wedge(corridor[1])}`} fill="none" stroke="#64748b" strokeWidth={1.2} strokeDasharray="5 4" />
          </> : null}
          {refSamples.length > 1 ? <path d={path(refSamples)} fill="none" stroke="#cbd5e1" strokeWidth={1.6} strokeDasharray="6 5" opacity={0.85} /> : null}
          {phasePaths.map((p) => <path key={p.phase} d={p.d} fill="none" stroke={PHASE_COLOR[p.phase]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />)}
          {marks.map((m) => (
            <g key={`${m.kind}-${m.t}`}>
              <circle cx={x(m.dist!)} cy={y(m.alt!)} r={7} fill="#111827" />
              <circle cx={x(m.dist!)} cy={y(m.alt!)} r={5} fill={PHASE_COLOR[phaseAt(run!.marks, m.t)] || '#e2e8f0'} />
            </g>
          ))}
          {live && samples.length ? (() => { const s = samples[samples.length - 1]; return s.dist != null ? <g transform={`translate(${x(s.dist)},${y(s.alt ?? 0)})`}><circle r={9} fill="#111827" /><path d="M-7,6 L0,-8 L7,6 L0,3 Z" fill="#e2e8f0" /></g> : null; })() : null}
          {hover ? <g><line x1={hover.px} x2={hover.px} y1={T} y2={H - B} stroke="#64748b" strokeDasharray="3 3" /><circle cx={hover.px} cy={hover.py} r={7} fill="#111827" /><circle cx={hover.px} cy={hover.py} r={5} fill={PHASE_COLOR[phaseAt(run?.marks || [], hover.s.t)]} /></g> : null}
          <rect x={L} y={T} width={PW} height={PH} fill="transparent" style={{ cursor: 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hover ? (() => {
          const s = hover.s; const rt = reference ? valueAtDistance(refSamples, s.dist!, 't') : null; const ra = reference ? valueAtDistance(refSamples, s.dist!, 'alt') : null;
          return (
            <div className="absolute pointer-events-none bg-[#0b1220] border border-border rounded-lg px-3 py-2 text-xs shadow-xl" style={{ left: Math.min(hover.px / W * 100, 78) + '%', top: 12 }}>
              <div className="font-semibold mb-1" style={{ color: PHASE_COLOR[phaseAt(run?.marks || [], s.t)] }}>{phaseAt(run?.marks || [], s.t)}</div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
                <span className="text-muted-foreground">time</span><span className="text-right">+{fmtT(s.t)}</span>
                <span className="text-muted-foreground">to target</span><span className="text-right">{km(s.dist)}</span>
                <span className="text-muted-foreground">altitude</span><span className="text-right">{alt(s.alt)}</span>
                <span className="text-muted-foreground">slope</span><span className="text-right">{s.slope != null ? `${s.slope}° down` : '—'}</span>
                <span className="text-muted-foreground">closing</span><span className="text-right">{s.speed != null ? `${s.speed} m/s` : '—'}</span>
                <span className="text-muted-foreground">vs shortest</span><span className="text-right">{rt == null ? '—' : Math.abs(rt - s.t) < 0.5 ? 'level' : `${Math.abs(Math.round(rt - s.t))} s ${rt - s.t > 0 ? 'ahead' : 'behind'}`}</span>
                <span className="text-muted-foreground">height vs shortest</span><span className="text-right">{ra == null || s.alt == null ? '—' : `${(s.alt - ra) >= 0 ? '+' : ''}${((s.alt - ra) / 1000).toFixed(1)} km`}</span>
              </div>
            </div>
          );
        })() : null}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>log axes: the last few kilometres get the room, so slopes are read from the numbers, not by eye</span>
        <span>hover for the one-second samples</span>
        <span>you fly left to right; the target is at zero</span>
      </div>
    </div>
  );
}

// ---- map from above ------------------------------------------------------------------------------
function TopMap({ runs, live, target, selectedId, focusId, onFocus, shortestId, referenceId }: { runs: Run[]; live: Live | null; target: Target | null; selectedId: string | null; focusId: string | null; onFocus: (id: string) => void; shortestId: string | null; referenceId: string | null }) {
  const S = 520, C = 260;
  const all = live ? runs.concat([{ id: live.runId, startedAt: live.startedAt, body: live.body, target: live.target, totalS: 0, clean: false, oc: { startDistM: null, startAltM: null, durationS: null }, glide: null, docking: null, marks: live.marks, samples: live.samples }]) : runs;
  const tgt = target || all.find((r) => r.target)?.target || null;
  const radius = all.flatMap((r) => r.samples).find((s) => s.radius)?.radius || 1;
  // Always the last 50 km: the run-up enters at the ring; the glide, the hand-off and the final are the shape that matters.
  const glideMax = Math.max(0, ...all.map((r) => (r.glide?.startDistM ?? r.marks.find((m) => m.kind === 'glide_start')?.dist ?? 0) / 1000));
  const RMAX = glideMax <= 50 ? 50 : glideMax <= 75 ? 75 : 100;
  const K = 236 / RMAX;
  const rings = RMAX === 50 ? [10, 25, 50] : RMAX === 75 ? [25, 50, 75] : [25, 50, 100];
  const xy = (s: Sample) => { if (!tgt) return null; const p = localXY(s.lat, s.lon, tgt, radius); return [C + (p.x / 1000) * K, C - (p.y / 1000) * K]; };
  const color = (r: Run, i: number) => (live && r.id === live.runId ? '#e2e8f0' : r.id === selectedId && !live ? '#e2e8f0' : RUN_COLORS[i % RUN_COLORS.length]);
  const bestSectors: Sectors = (() => { const clean = runs.filter((r) => r.clean && r.sectors); const sh = runs.find((x) => x.id === shortestId); const hull = sh && sh.ship ? clean.filter((r) => r.ship && r.ship.type === sh.ship!.type) : clean; const min = (list: Run[], k: keyof Sectors) => { const v = list.map((r) => r.sectors![k]).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null; }; return { s1: min(clean, 's1'), s2: min(clean, 's2'), s3: min(hull.length ? hull : clean, 's3'), s4: min(hull.length ? hull : clean, 's4') }; })();
  const bearingFrom = (r: Run) => { const s = r.samples.find((p) => p.dist != null); if (!s || !tgt) return null; const p = localXY(s.lat, s.lon, tgt, radius); return (Math.atan2(p.x, p.y) * 180 / Math.PI + 360) % 360; };
  const dir = (d: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16];
  const markAt = (r: Run, kind: string) => { const m = r.marks.find((x) => x.kind === kind); if (!m) return null; const s = r.samples.reduce<Sample | null>((b, p) => (b == null || Math.abs(p.t - m.t) < Math.abs(b.t - m.t) ? p : b), null); return s ? xy(s) : null; };
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Every run at this target, from above</h2>
        <span className="text-xs text-muted-foreground">● glide began &nbsp;○ glide ended &nbsp;◆ hand-off &nbsp;<b className="text-[#ff9900]">S</b> shortest run &nbsp;<b className="text-foreground">R</b> reference · north up · rings at {rings.join(', ')} km</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(280px,420px)_minmax(0,1fr)] items-start">
        <svg viewBox={`0 0 ${S} ${S}`} className="w-full block" role="img" aria-label="Approach paths from above">
          {rings.map((r) => <g key={r}><circle cx={C} cy={C} r={r * K} fill="none" stroke="rgba(148,163,184,0.14)" /><text x={C + 4} y={C - r * K - 4} fontSize="10.5" fill="#64748b" fontFamily="monospace">{Math.round(r)} km</text></g>)}
          <line x1={C} y1={C - RMAX * K} x2={C} y2={C + RMAX * K} stroke="rgba(148,163,184,0.14)" /><line x1={C - RMAX * K} y1={C} x2={C + RMAX * K} y2={C} stroke="rgba(148,163,184,0.14)" />
          <text x={C} y={14} textAnchor="middle" fontSize="11" fill="#94a3b8" fontWeight={600}>N</text>
          {all.map((r, i) => {
            const pts = r.samples.map(xy).filter((p): p is number[] => !!p && Math.hypot(p[0] - C, p[1] - C) <= RMAX * K + 2);
            if (pts.length < 2) return null;
            const c = color(r, i); const dim = focusId && focusId !== r.id;
            const gsp = markAt(r, 'glide_start'), gep = markAt(r, 'glide_end'), hop = markAt(r, 'handoff');
            return (
              <g key={r.id} opacity={dim ? 0.18 : 1} style={{ transition: 'opacity 160ms' }}>
                <path d={'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} fill="none" stroke={c} strokeWidth={live && r.id === live.runId ? 3.5 : r.id === selectedId ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
                {gsp ? <><circle cx={gsp[0]} cy={gsp[1]} r={7} fill="#111827" /><circle cx={gsp[0]} cy={gsp[1]} r={5} fill={c} /></> : null}
                {gep ? <><circle cx={gep[0]} cy={gep[1]} r={7} fill="#111827" /><circle cx={gep[0]} cy={gep[1]} r={4.5} fill="#111827" stroke={c} strokeWidth={2} /></> : null}
                {hop ? <rect x={hop[0] - 4} y={hop[1] - 4} width={8} height={8} fill={c} transform={`rotate(45 ${hop[0]} ${hop[1]})`} /> : null}
              </g>
            );
          })}
          {live && live.samples.length ? (() => { const p = xy(live.samples[live.samples.length - 1]); return p ? <g transform={`translate(${p[0]},${p[1]}) rotate(${live.samples[live.samples.length - 1].hdg ?? 0})`}><circle r={9} fill="#111827" /><path d="M-7,6 L0,-8 L7,6 L0,3 Z" fill="#e2e8f0" /></g> : null; })() : null}
          <circle cx={C} cy={C} r={9} fill="#111827" /><rect x={C - 6} y={C - 6} width={12} height={12} rx={2} fill="#ff9900" />
          <text x={C + 12} y={C + 4} fontSize="11" fill="#94a3b8" fontWeight={600}>{tgt ? tgt.name : 'target'}</text>
        </svg>
        <div className="space-y-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground uppercase tracking-wide text-[10px]"><th className="text-left py-1 pr-2">Run</th><th className="text-left py-1 pr-2">ship</th><th className="text-left py-1 pr-2">from</th><th className="text-left py-1 pr-2">glide began</th><th className="text-left py-1 pr-2">glide ended</th><th className="text-left py-1 pr-2">hand-off</th><th className="text-left py-1 pr-2">cleared → pad</th><th className="text-left py-1 pr-2">run-up</th><th className="text-left py-1 pr-2">sectors</th><th className="text-left py-1">from 100 km</th></tr></thead>
            <tbody>
              {[...runs].reverse().map((r) => {
                const i = runs.indexOf(r); const b = bearingFrom(r);
                return (
                  <tr key={r.id} tabIndex={0} onClick={() => onFocus(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(r.id); } }} className={`cursor-pointer border-b border-border/40 ${focusId === r.id || selectedId === r.id ? 'bg-muted/40' : 'hover:bg-muted/20'}`}>
                    <td className="py-1.5 pr-2 whitespace-nowrap font-medium"><span className="inline-block w-[1.1em] mr-1 font-bold">{r.id === shortestId ? <span className="text-[#ff9900]">S</span> : r.id === referenceId ? <span className="text-foreground">R</span> : null}</span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-[-1px]" style={{ background: color(r, i) }}></i>{when(r.startedAt)}{!r.clean ? <span className="ml-1.5 text-amber-300">{r.endKind === 'dropped' ? 'dropped — too fast' : r.glide ? (r.glide.broken ? 'broken glide' : 'no glide end') : 'no glide'}</span> : null}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{r.ship ? r.ship.name : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{b != null ? `${dir(b)} ${Math.round(b)}°` : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{r.glide ? `${km(r.glide.startDistM)} out` : '—'}</td>
                    <td className={`py-1.5 pr-2 font-mono whitespace-nowrap ${r.glide?.broken ? 'text-amber-300' : ''}`}>{r.glide && r.glide.endT != null ? `${km(r.glide.endDistM)} out · ${alt(r.glide.endAltM)} up` : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{r.docking?.handoffT != null ? `${km(r.docking.handoffDistM)} out${r.docking.retakes ? ` · ${r.docking.retakes} retake${r.docking.retakes > 1 ? 's' : ''}` : ''}` : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{r.docking?.clearanceToPadS != null ? `${r.docking.clearanceToPadS} s` : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap text-muted-foreground">{r.runupS != null ? `${r.runupS} s` : '—'}</td>
                    <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{r.sectors ? SECTOR_NAMES.map(([k]) => { const v = r.sectors ? r.sectors[k] : null; const sh = runs.find((x) => x.id === shortestId); const c = sectorColour(v, sh && sh.id !== r.id && sh.sectors ? sh.sectors[k] : null, bestSectors[k], r.clean); return <span key={k} className="mr-1.5" style={{ color: c }}>{v == null ? '—' : v}</span>; }) : '—'}</td>
                    <td className="py-1.5 font-mono whitespace-nowrap">{fmtT(r.runS ?? r.totalS)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground max-w-prose">Click a run to pick it out on the map and load it into the slope above; click again to show all. Broken glides stay on the map and out of the reference.</p>
        </div>
      </div>
    </div>
  );
}

// ---- phase strip ---------------------------------------------------------------------------------
function PhaseStrip({ run, reference }: { run: Run | null; reference: Run | null }) {
  if (!run || !run.marks.length) return null;
  const spans = (r: Run) => {
    const at = (k: string) => r.marks.find((m) => m.kind === k)?.t ?? null;
    const g = r.gateT ?? 0;
    const gs = at('glide_start'), ge = at('glide_end'), dr = at('docking_requested'), ho = at('handoff'), end = at('docked') ?? at('touchdown') ?? r.totalS;
    const out: { k: string; c: string; s: number; label: string; muted?: boolean }[] = [];
    if (g > 0) out.push({ k: 'ru', c: '#334155', s: g, label: 'run-up · not counted', muted: true });
    const ab = at('approach_body');
    if (ab != null && ab > g && r.marks.some((m) => m.kind === 'position_fix')) { out.push({ k: 'gw', c: PHASE_COLOR['Gravity well'], s: ab - g, label: 'gravity well' }); if (gs != null && gs > ab) out.push({ k: 'oc', c: PHASE_COLOR['Orbital cruise'], s: gs - ab, label: 'orbital cruise' }); }
    else if (gs != null && gs > g) out.push({ k: 'oc', c: PHASE_COLOR['Orbital cruise'], s: gs - g, label: 'orbital cruise' });
    if (gs != null && ge != null) out.push({ k: 'gl', c: PHASE_COLOR.Glide, s: ge - Math.max(gs, g), label: 'glide' });
    if (ge != null && dr != null) out.push({ k: 'fl', c: PHASE_COLOR['Normal flight'], s: dr - ge, label: 'normal flight' });
    if (dr != null) {
      if (ho != null) { out.push({ k: 'dk', c: PHASE_COLOR.Docking, s: ho - dr, label: 'to hand-off' }); out.push({ k: 'dc', c: '#0f7a55', s: end - ho, label: 'docking computer' }); }
      else out.push({ k: 'dk', c: PHASE_COLOR.Docking, s: end - dr, label: 'docking' });
    } else if (ge != null) out.push({ k: 'fl2', c: PHASE_COLOR['Normal flight'], s: end - ge, label: 'to the ground' });
    return out.filter((x) => x.s > 0);
  };
  const isShortest = reference != null && (run.runS ?? run.totalS) < (reference.runS ?? reference.totalS);
  const rows = [
    { who: 'this run', sub: fmtT(run.runS ?? run.totalS), total: run.totalS, spans: spans(run) },
    ...(reference && reference.id !== run.id ? [{ who: isShortest ? 'previous shortest' : 'shortest run', sub: `${when(reference.startedAt)} · ${fmtT(reference.runS ?? reference.totalS)}`, total: reference.totalS, spans: spans(reference) }] : []),
  ];
  const scale = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phase lengths to scale · the clock starts 100 km out</h2>
      {rows.map((r) => (
        <div key={r.who} className="grid grid-cols-[130px_1fr] items-start gap-3 text-xs">
          <div><div className="font-semibold text-foreground">{r.who}</div><div className="font-mono text-muted-foreground">{r.sub}</div></div>
          <div className="space-y-1">
            <div className="flex h-4 gap-[2px]">
              {r.spans.map((s) => <div key={s.k} title={`${s.label} · ${s.s} s`} style={{ flex: `${s.s} 1 0`, background: s.c, opacity: s.muted ? 0.6 : 1 }} className="rounded-sm"></div>)}
              <div style={{ flex: `${scale - r.total} 1 0` }}></div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              {r.spans.map((s) => <span key={s.k} className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2 h-2 rounded-sm" style={{ background: s.c, opacity: s.muted ? 0.6 : 1 }}></i>{s.label} <b className="font-mono text-foreground font-medium">{s.s} s</b></span>)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- boundaries ----------------------------------------------------------------------------------
function Boundaries({ run, reference }: { run: Run | null; reference: Run | null }) {
  if (!run || !run.marks.length) return null;
  const order = ['position_fix', 'approach_body', 'gate', 'target_known', 'supercruise_exit', 'glide_start', 'glide_end', 'docking_requested', 'docking_granted', 'handoff', 'retake', 'docked', 'touchdown'];
  const gateRow: Mark | null = run.gateT != null ? { kind: 'gate', t: run.gateT, at: '', dist: GATE_M, alt: run.samples.reduce<number | null>((b, p) => (b == null && p.t >= (run.gateT ?? 0) ? p.alt : b), null), speed: null } : null;
  const rows = [...run.marks, ...(gateRow ? [gateRow] : [])].sort((a, b) => a.t - b.t || order.indexOf(a.kind) - order.indexOf(b.kind));
  const refMark = (kind: string, nth: number) => (reference ? (kind === 'gate' ? (reference.gateT != null ? { kind: 'gate', t: reference.gateT, at: '', dist: GATE_M, alt: null, speed: null } : null) : reference.marks.filter((m) => m.kind === kind)[nth] || null) : null);
  const seen: Record<string, number> = {};
  const clock = (m: Mark, r: Run) => (r.gateT != null && m.t >= r.gateT ? `${fmtT(m.t - r.gateT)}` : `run-up ${fmtT(m.t)}`);
  const cell = (m: Mark | null, r: Run = run) => (m ? `${clock(m, r)}${m.dist != null ? ` · ${km(m.dist)} out` : ''}${m.alt != null ? ` · ${alt(m.alt)} up` : ''}${m.kind === 'approach_body' && m.rangeM != null ? ` · ${Mm(m.rangeM)} on the HUD` : ''}${m.kind === 'approach_body' && m.countdownS != null ? ` showing ${fmtT(m.countdownS)}` : ''}${m.speed != null && m.kind === 'handoff' ? ` · ${m.speed} m/s` : ''}${m.broken ? ' · broke' : ''}` : '—');
  const verdict = run.glide ? (run.glide.broken ? `Broken glide: the flag cleared at ${alt(run.glide.endAltM)}.` : run.glide.endT != null ? `Clean glide, held to ${alt(run.glide.endAltM)}.` : 'Glide still open.') : 'No glide recorded.';
  const dockNote = run.docking && run.docking.clearanceToPadS != null ? ` Clearance to pad ${run.docking.clearanceToPadS} s of ${run.runS ?? run.totalS}${run.docking.computerS != null ? `, ${run.docking.computerS} s under the computer` : ''}${run.docking.retakes ? `, ${run.docking.retakes} retake${run.docking.retakes > 1 ? 's' : ''}` : ''}.` : '';
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Where each phase began{reference && reference.id !== run.id ? ', against your shortest run' : ''}</h2>
        <span className="text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded px-2 py-1"><b className="text-foreground">{verdict}</b>{dockNote}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground uppercase tracking-wide text-[10px]"><th className="text-left py-1 pr-3">Boundary</th><th className="text-left py-1 pr-3">This run</th>{reference && reference.id !== run.id ? <><th className="text-left py-1 pr-3">Shortest run</th><th className="text-left py-1">vs shortest</th></> : null}</tr></thead>
          <tbody>
            {rows.map((m) => {
              const n = seen[m.kind] || 0; seen[m.kind] = n + 1;
              const rm = refMark(m.kind, n); const d = rm && reference && reference.gateT != null && run.gateT != null ? (rm.t - reference.gateT) - (m.t - run.gateT) : null;
              const minor = m.kind === 'target_known' || m.kind === 'supercruise_exit' || m.kind === 'docking_granted';
              return (
                <tr key={`${m.kind}${n}`} className={`border-b border-border/40 ${minor ? 'text-muted-foreground' : ''}`}>
                  <td className="py-1.5 pr-3 whitespace-nowrap font-medium"><i className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-[-1px]" style={{ background: PHASE_COLOR[phaseAt(run.marks, m.t)] || '#64748b' }}></i>{MARK_LABEL[m.kind] || m.kind}{m.pad != null ? ` · pad ${m.pad}` : ''}</td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{cell(m)}</td>
                  {reference && reference.id !== run.id ? <><td className="py-1.5 pr-3 font-mono whitespace-nowrap">{rm ? cell(rm, reference) : '—'}</td><td className={`py-1.5 font-mono whitespace-nowrap ${d == null || d === 0 ? '' : d > 0 ? 'text-green-400' : 'text-amber-300'}`}>{d == null ? '—' : d === 0 ? 'level' : `${Math.abs(d)} s ${d > 0 ? 'ahead' : 'behind'}`}</td></> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- recommendation ------------------------------------------------------------------------------
function Recommendation({ summary, target }: { summary: Summary | null; target: Target | null }) {
  const c = summary?.recommendation?.cruise || null;
  if (!summary || !target) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-1">
      <h2 className="font-semibold">Recommended approach at {target.name}</h2>
      {!c || c.entryHudRangeM == null ? (
        <p className="text-sm text-muted-foreground">No clean run on file yet. The first clean run sets the entry.</p>
      ) : (
        <p className="text-sm">Enter orbital cruise at about <b className="font-mono">{Mm(c.entryHudRangeM)}</b>{c.entryCountdownS != null ? <> showing <b className="font-mono">{fmtT(c.entryCountdownS)}</b></> : null}{c.checkpointAltM != null ? <> · at 1.0 Mm, <b className="font-mono">{alt(c.checkpointAltM)}</b> up</> : null}.</p>
      )}
    </div>
  );
}
