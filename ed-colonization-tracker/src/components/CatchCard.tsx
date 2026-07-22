/**
 * The trophy shot for a finished rock.
 *
 * Fires on every rock that actually produced tonnes — deciding to spend time lasering a rock is
 * itself the filter, so anything that gets this far was already worth the commander's attention.
 * Prospected-and-skipped rocks never reach here.
 *
 * The measuring board is the point. A number alone doesn't read as "that was a whopper"; seeing the
 * catch sit out on the tail of your own 346-rock distribution does. Tiering uses whichever of
 * credits or tonnage ranks higher, because a fat cheap haul and a lean rich one are different
 * achievements and both deserve the shot.
 */
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';

interface Part { key: string; name: string; tonnes: number; credits: number }
interface Hist { buckets: number[]; min: number; max: number }
interface CatchEvent {
  tier: string; tierLabel: string; icon: string;
  credits: number; tonnes: number; parts: Part[]; ring: string;
  pctValue: number; pctTonnes: number; tieredBy: 'value' | 'tonnes';
  rank: number | null; bestValue: number; bestTonnes: number;
  valueHist: Hist; tonnesHist: Hist; sampleSize: number;
}

const HOLD_MS: Record<string, number> = { record: 16000, monster: 14000, whopper: 12000, trophy: 10000, good: 7000, catch: 5000 };

const TIER_STYLE: Record<string, { ring: string; text: string; glow: string; bar: string }> = {
  record:  { ring: 'ring-amber-400/70',  text: 'text-amber-300',  glow: 'shadow-[0_0_40px_-6px_rgba(251,191,36,0.7)]', bar: 'bg-amber-400' },
  monster: { ring: 'ring-orange-400/60', text: 'text-orange-300', glow: 'shadow-[0_0_34px_-8px_rgba(249,115,22,0.65)]', bar: 'bg-orange-400' },
  whopper: { ring: 'ring-cyan-400/60',   text: 'text-cyan-300',   glow: 'shadow-[0_0_30px_-8px_rgba(34,211,238,0.6)]',  bar: 'bg-cyan-400' },
  trophy:  { ring: 'ring-violet-400/50', text: 'text-violet-300', glow: 'shadow-lg', bar: 'bg-violet-400' },
  good:    { ring: 'ring-emerald-500/40',text: 'text-emerald-300',glow: 'shadow-lg', bar: 'bg-emerald-400' },
  catch:   { ring: 'ring-border',        text: 'text-muted-foreground', glow: '', bar: 'bg-muted-foreground' },
};

const cr = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

/** Where a value falls across the log-scaled histogram, 0..1 — the marker position on the board. */
function markerPos(v: number, h: Hist): number {
  if (!h || !h.buckets?.length || !(v > 0)) return 0;
  const lo = Math.log(Math.max(1, h.min));
  const hi = Math.log(Math.max(h.min + 1, h.max));
  return Math.max(0, Math.min(1, (Math.log(Math.max(1, v)) - lo) / (hi - lo)));
}

export function CatchCard() {
  const enabled = useAppStore((s) => s.settings.targetPopupEnabled);
  const [ev, setEv] = useState<CatchEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = sseSubscribe('mining_catch', (raw) => {
      const e = raw as unknown as CatchEvent;
      setEv(e);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setEv(null), HOLD_MS[e.tier] ?? 8000);
    });
    return () => { off(); if (timer.current) clearTimeout(timer.current); };
  }, []);

  if (enabled === false || !ev) return null;

  const st = TIER_STYLE[ev.tier] ?? TIER_STYLE.catch;
  const byTonnes = ev.tieredBy === 'tonnes';
  const hist = byTonnes ? ev.tonnesHist : ev.valueHist;
  const pos = markerPos(byTonnes ? ev.tonnes : ev.credits, hist);
  const pct = Math.round((byTonnes ? ev.pctTonnes : ev.pctValue) * 100);
  const peak = Math.max(1, ...(hist?.buckets ?? [1]));
  const big = ev.tier === 'record' || ev.tier === 'monster' || ev.tier === 'whopper';

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[22rem] max-w-[calc(100vw-2rem)]">
      <style>{`
        @keyframes edcCatchIn {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
          60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes edcCatchPulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
      `}</style>

      <div
        className={`rounded-xl border border-border bg-card/97 backdrop-blur ring-1 ${st.ring} ${st.glow} px-5 py-4`}
        style={{ animation: 'edcCatchIn 420ms cubic-bezier(.2,.9,.3,1.2) both' }}
      >
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 ${st.text}`}>
            <span className={big ? 'text-2xl' : 'text-lg'}>{ev.icon}</span>
            <span className={`font-bold tracking-[0.18em] ${big ? 'text-sm' : 'text-xs'}`}>{ev.tierLabel}</span>
          </div>
          <button
            onClick={() => setEv(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            {'✕'}
          </button>
        </div>

        <div className="mt-2 flex items-baseline gap-4">
          <div>
            <div className={`${big ? 'text-4xl' : 'text-3xl'} font-bold tabular-nums ${st.text} leading-none`}>{ev.tonnes}<span className="text-lg font-normal text-muted-foreground ml-0.5">t</span></div>
          </div>
          <div>
            <div className={`${big ? 'text-3xl' : 'text-2xl'} font-bold tabular-nums text-foreground leading-none`}>{cr(ev.credits)}<span className="text-sm font-normal text-muted-foreground ml-1">Cr</span></div>
          </div>
        </div>

        {ev.parts?.length > 0 && (
          <div className="mt-3 space-y-0.5">
            {ev.parts.slice(0, 4).map((p) => (
              <div key={p.key} className="flex items-baseline justify-between text-xs">
                <span className="text-foreground truncate">{p.name}</span>
                <span className="tabular-nums text-muted-foreground ml-3 shrink-0">
                  {p.tonnes}t · {cr(p.credits)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Measuring board — your whole logged distribution, with this catch marked. */}
        <div className="mt-3">
          <div className="relative h-8 flex items-end gap-[1px]">
            {(hist?.buckets ?? []).map((b, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t-sm ${b > 0 ? 'bg-muted-foreground/25' : 'bg-transparent'}`}
                style={{ height: `${Math.max(b > 0 ? 8 : 0, (b / peak) * 100)}%` }}
              />
            ))}
            <div
              className={`absolute bottom-0 w-[2px] h-full ${st.bar} rounded-full`}
              style={{ left: `calc(${(pos * 100).toFixed(1)}% - 1px)`, animation: 'edcCatchPulse 1.4s ease-in-out infinite' }}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-muted-foreground">
            <span>
              bigger than <span className={st.text}>{pct}%</span> of your {ev.sampleSize} rocks
              <span className="opacity-60"> · by {byTonnes ? 'size' : 'value'}</span>
            </span>
            <span className="tabular-nums">
              {ev.rank ? `#${ev.rank} ever` : `best ${byTonnes ? `${ev.bestTonnes}t` : cr(ev.bestValue)}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
