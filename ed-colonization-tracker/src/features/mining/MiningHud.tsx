/**
 * Mining HUD components + shared display helpers.
 *
 * The hero band, standing distribution board, single-measure bar charts and the trophy wall.
 * Split from MiningPage so the page file stays navigable; MiningPage imports everything from here
 * (helpers included — single source for cr / ring-class icons / reserve tones).
 *
 * Chart rules followed (dataviz): single-hue bars for single measures, thin marks with gaps,
 * selective direct labels in text ink, no legends for one series, values never painted in
 * series color.
 */
import { useEffect, useRef, useState } from 'react';

// ---- shared display helpers ----------------------------------------------------------------

export const cr = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

const RING_CLASS_META: Record<string, { icon: string; label: string }> = {
  icy: { icon: '❄️', label: 'Icy' },
  rocky: { icon: '⛰️', label: 'Rocky' },
  metalrich: { icon: '🧲', label: 'Metal Rich' },
  metallic: { icon: '⚙️', label: 'Metallic' },
  metalic: { icon: '⚙️', label: 'Metallic' }, // journal raw spelling
};
/** "MetalRich" / "Metal Rich" / "eRingClass_Icy" → "🧲 Metal Rich"; unknown strings pass through. */
export const ringClassText = (rc?: string): string => {
  const m = RING_CLASS_META[String(rc ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/^eringclass/, '')];
  return m ? `${m.icon} ${m.label}` : (rc ?? '');
};

export const RESERVE_TONE: Record<string, string> = {
  Pristine: 'text-emerald-400', Major: 'text-lime-400', Common: 'text-yellow-500',
  Low: 'text-orange-400', Depleted: 'text-red-400',
};

// ---- shared types ---------------------------------------------------------------------------

export interface Hist { buckets: number[]; min: number; max: number }
export interface ScanPing { value: number; bar: number; strong: number; hasTarget: boolean; ring: string; at: number }
export interface BadgeInfo { id: string; icon: string; label: string; desc: string; earnedAt: string | null; legacy: boolean }
export interface TrophyRecords {
  lifetimeTonnes: number; lifetimeProspects: number; distinctRings: number;
  biggestRock: number; biggestRockTonnes: number; biggestRockAt: string | null; biggestRockRing: string;
  bestSessionCredits: number; bestSessionCreditsDay: string | null;
  bestSessionTph: number; bestSessionTphDay: string | null;
  bestSessionRocks: number; bestStreak: number; sessionCount: number;
}

// ---- page-local CSS -------------------------------------------------------------------------

/** Chamfered corners + working-state glow + grid texture. Class-scoped, no global bleed. */
export function MiningHudCss() {
  return (
    <style>{`
      .edc-chamfer { clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
      .edc-hero-active { box-shadow: 0 0 42px -12px rgba(251, 146, 60, 0.55), inset 0 0 60px -40px rgba(251, 146, 60, 0.35); }
      @keyframes edcPulse { 0%,100% { opacity: .5 } 50% { opacity: 1 } }
      @keyframes edcPingIn { 0% { transform: translateY(-6px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
      .edc-grid-bg { background-image: linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px); background-size: 22px 22px; }
    `}</style>
  );
}

// ---- hero -----------------------------------------------------------------------------------

/** Rolling count-up — the shown value chases the real one so credits pour rather than snap. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const step = () => {
      const cur = shownRef.current;
      if (Math.abs(target - cur) > 1) {
        const next = cur + (target - cur) * 0.16;
        shownRef.current = next;
        setShown(next);
        raf.current = requestAnimationFrame(step);
      } else {
        shownRef.current = target;
        setShown(target);
        raf.current = null;
      }
    };
    if (raf.current == null) raf.current = requestAnimationFrame(step);
    return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [target]);
  return shown;
}

export function HeroBand(props: {
  active: boolean; credits: number; tonnes: number; rockCredits: number;
  startedAt: number | null; streak: number; bestStreak: number;
  ring: { name: string; ringClass: string; reserve: string } | null;
  bestTph: number; bestTphScope: string; indexLine: string;
  inHotspot: boolean; onHotspotToggle: () => void;
}) {
  const shown = useCountUp(props.credits);
  // The pace readout needs a clock that ticks between refines too.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!props.active) return;
    const id = setInterval(() => forceTick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, [props.active]);
  const hours = props.startedAt ? (Date.now() - props.startedAt) / 3600000 : 0;
  const tph = props.active && hours > 0.03 ? props.tonnes / hours : 0;
  const gaugePct = props.bestTph > 0 ? Math.min(1, tph / props.bestTph) : 0;

  return (
    <div className={`edc-chamfer edc-grid-bg relative border px-5 py-4 bg-card/80 ${props.active ? 'border-amber-400/50 edc-hero-active' : 'border-border'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-wide">{'⛏'} MINING</h1>
          {props.active
            ? <span className="text-[10px] font-bold tracking-widest text-amber-300" style={{ animation: 'edcPulse 1.6s ease-in-out infinite' }}>● ACTIVE</span>
            : <span className="text-[10px] tracking-widest text-muted-foreground">IDLE</span>}
        </div>
        <div className="flex items-center gap-3">
          {props.ring && (
            <button
              onClick={props.onHotspotToggle}
              title="Ground truth the journal can't see: rocks logged while this is on are stamped as hotspot-mined. Clears automatically when you change ring or jump."
              className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                props.inHotspot
                  ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
                  : 'border-border bg-muted/20 text-muted-foreground hover:text-foreground'
              }`}
            >
              {'◉'} {props.inHotspot ? 'IN HOTSPOT' : 'in hotspot?'}
            </button>
          )}
          {props.streak >= 3 && (
            <span className="text-sm font-bold text-orange-400" title={`Target streak — best ${props.bestStreak}`}>{'🔥'} {props.streak}</span>
          )}
          <span className="text-[11px] text-muted-foreground">{props.indexLine}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr_auto] items-end">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">This session</div>
          <div className="text-4xl font-bold tabular-nums text-emerald-400 leading-none">
            {cr(shown)}<span className="ml-1 text-base font-normal text-muted-foreground">Cr</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {props.tonnes}t refined{props.rockCredits > 0 && <> · {cr(props.rockCredits)} this rock</>}
          </div>
        </div>

        {/* Live pace vs your own best — a bullet bar, not a promise. */}
        <div className="min-w-[10rem] max-w-[26rem]">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Pace</span>
            <span className="tabular-nums normal-case">
              {props.active && tph > 0 ? `${tph.toFixed(0)} t/hr` : '—'}
              {props.bestTph > 0 ? ` · ${props.bestTphScope} ${props.bestTph.toFixed(0)}` : ''}
            </span>
          </div>
          <div className="relative mt-1 h-2.5 rounded-sm bg-muted/40 overflow-hidden">
            <div className="h-full rounded-sm bg-amber-400/80 transition-[width] duration-700" style={{ width: `${(gaugePct * 100).toFixed(1)}%` }} />
          </div>
        </div>

        <div className="text-right">
          {props.ring ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current ring</div>
              <div className="text-sm font-semibold leading-tight">{props.ring.name}</div>
              <div className="text-xs text-muted-foreground">
                {ringClassText(props.ring.ringClass)}{' '}
                <span className={RESERVE_TONE[props.ring.reserve] ?? ''}>{props.ring.reserve}</span>
              </div>
            </>
          ) : <div className="text-xs text-muted-foreground">Not in a ring</div>}
        </div>
      </div>
    </div>
  );
}

// ---- distribution board ---------------------------------------------------------------------

/**
 * The measuring board, standing. The whole logged rock-value distribution (log-scaled) with the
 * last prospects pinged onto it the moment they're scanned — value read against the population
 * BEFORE lasers are committed. Same geometry as the catch card, promoted to an instrument.
 */
export function DistributionBoard(props: { hist: Hist | null; best: number; count: number; scans: ScanPing[]; classLabel?: string }) {
  const { hist } = props;
  if (!hist || !hist.buckets?.length || props.count < 12) return null;
  const peak = Math.max(1, ...hist.buckets);
  const pos = (v: number) => {
    const lo = Math.log(Math.max(1, hist.min));
    const hi = Math.log(Math.max(hist.min + 1, hist.max));
    return Math.max(0, Math.min(1, (Math.log(Math.max(1, v)) - lo) / (hi - lo)));
  };
  const latest = props.scans.length ? props.scans[props.scans.length - 1] : null;
  return (
    <section className="edc-chamfer border border-border bg-card/60 px-4 py-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Rock board — every prospect vs your {props.count} {props.classLabel ? `${props.classLabel} ` : ''}rocks
        </h2>
        {latest && (
          <span key={latest.at} className="text-xs tabular-nums" style={{ animation: 'edcPingIn 300ms ease-out both' }}>
            latest{' '}
            <span className={latest.value >= latest.strong ? 'text-cyan-300 font-semibold' : latest.value >= latest.bar ? 'text-emerald-300' : 'text-muted-foreground'}>
              {cr(latest.value)}
            </span>
            {latest.hasTarget && <span className="ml-1">{'🎯'}</span>}
          </span>
        )}
      </div>
      <div className="relative mt-2 h-14">
        {/* population */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {hist.buckets.map((b, i) => (
            <div key={i} className={`flex-1 rounded-t-[3px] ${b > 0 ? 'bg-muted-foreground/25' : ''}`} style={{ height: `${Math.max(b > 0 ? 6 : 0, (b / peak) * 100)}%` }} />
          ))}
        </div>
        {/* worth-it bar for the current ring */}
        {latest && latest.bar > 0 && (
          <div className="absolute bottom-0 h-full w-[2px] bg-emerald-400/50" style={{ left: `calc(${(pos(latest.bar) * 100).toFixed(1)}% - 1px)` }} title={`worth-it bar ${cr(latest.bar)}`} />
        )}
        {/* recent prospect pings — newest pulses at full height */}
        {props.scans.map((sc, i) => {
          const isLatest = i === props.scans.length - 1;
          return (
            <div
              key={sc.at}
              className={`absolute bottom-0 w-[3px] rounded-full ${sc.hasTarget ? 'bg-cyan-300' : sc.value >= sc.bar ? 'bg-emerald-400' : 'bg-slate-500'}`}
              style={{
                left: `calc(${(pos(sc.value) * 100).toFixed(1)}% - 1px)`,
                height: isLatest ? '100%' : '55%',
                opacity: isLatest ? 1 : 0.35 + (i / Math.max(1, props.scans.length)) * 0.4,
                animation: isLatest ? 'edcPulse 1.2s ease-in-out infinite' : undefined,
              }}
              title={`${cr(sc.value)}${sc.hasTarget ? ' · target' : ''}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{cr(Math.max(1, hist.min))}</span>
        <span>best {cr(props.best)}</span>
      </div>
    </section>
  );
}

// ---- bar chart ------------------------------------------------------------------------------

/** Single-measure horizontal bars — direct-labeled, one hue, values in text ink. */
export function HBarChart(props: { title: string; rows: Array<{ label: string; sub?: string; value: number }>; fmt: (v: number) => string; barClass: string }) {
  const rows = props.rows.filter((r) => r.value > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{props.title}</div>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.label} title={`${r.label} — ${props.fmt(r.value)}`}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate">{r.label}{r.sub && <span className="ml-2 text-muted-foreground/80">{r.sub}</span>}</span>
              <span className="tabular-nums text-foreground shrink-0">{props.fmt(r.value)}</span>
            </div>
            <div className="mt-0.5 h-2 rounded-sm bg-muted/30 overflow-hidden">
              <div className={`h-full rounded-sm ${props.barClass}`} style={{ width: `${((r.value / max) * 100).toFixed(1)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- trophy wall ----------------------------------------------------------------------------

export function TrophyWall(props: { records: TrophyRecords; badges: BadgeInfo[]; streak: { current: number; best: number } }) {
  const R = props.records;
  const earned = props.badges.filter((b) => b.earnedAt);
  const locked = props.badges.filter((b) => !b.earnedAt);
  const plaques: Array<{ icon: string; label: string; value: string; sub?: string }> = [
    { icon: '🏆', label: 'Biggest rock', value: cr(R.biggestRock), sub: `${R.biggestRockTonnes}t${R.biggestRockRing ? ` · ${R.biggestRockRing}` : ''}` },
    { icon: '💰', label: 'Best session', value: cr(R.bestSessionCredits), sub: R.bestSessionCreditsDay ?? undefined },
    { icon: '⚡', label: 'Best rate', value: `${R.bestSessionTph} t/hr`, sub: R.bestSessionTphDay ?? undefined },
    { icon: '🔥', label: 'Longest streak', value: String(R.bestStreak), sub: props.streak.current >= 3 ? `current ${props.streak.current}` : undefined },
    { icon: '⚖️', label: 'Lifetime', value: `${R.lifetimeTonnes.toLocaleString()}t`, sub: `${R.lifetimeProspects.toLocaleString()} rocks prospected` },
    { icon: '🗺️', label: 'Rings worked', value: String(R.distinctRings), sub: `${R.sessionCount} sessions` },
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Trophy wall</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {plaques.map((p) => (
          <div key={p.label} className="edc-chamfer border border-border bg-card/70 px-3 py-2.5">
            <div className="text-lg leading-none">{p.icon}</div>
            <div className="mt-1 text-base font-bold tabular-nums leading-tight">{p.value}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.label}</div>
            {p.sub && <div className="mt-0.5 text-[11px] text-muted-foreground truncate" title={p.sub}>{p.sub}</div>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {earned.map((b) => (
          <span key={b.id} className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs text-amber-200" title={`${b.desc}${b.legacy ? ' · earned before tracking' : b.earnedAt ? ` · ${b.earnedAt.slice(0, 10)}` : ''}`}>
            {b.icon} {b.label}
          </span>
        ))}
        {locked.map((b) => (
          <span key={b.id} className="rounded border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground/60" title={b.desc}>
            {b.icon} {b.label}
          </span>
        ))}
      </div>
    </section>
  );
}
