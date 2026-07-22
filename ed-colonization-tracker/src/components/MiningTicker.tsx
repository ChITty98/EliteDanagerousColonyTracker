/**
 * Mining credits HUD.
 *
 * Every refined tonne throws a floating credit figure and rolls the session total upward. This is a
 * PERSISTENT element, not one of the auto-dismissing corner cards — refined tonnes arrive roughly
 * every 11 seconds while a card lingers 20, so routing them through the card system meant either a
 * card permanently stuck on screen or (as originally shipped) gating out all but the biggest tonnes.
 * A dedicated ticker takes every tonne without either compromise.
 *
 * Appears when tonnes start arriving, fades out once mining stops. Gated on the same
 * settings.targetPopupEnabled toggle as the popup card.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';

interface RefinedEvent {
  commodity?: string;
  credits?: number;
  rockCredits?: number;
  sessionCredits?: number;
  sessionTonnes?: number;
  mission?: boolean;
  [k: string]: unknown;
}

interface Floater { id: number; text: string; tier: 'huge' | 'big' | 'mid' | 'low'; mission: boolean }

// No tonne for this long → the session is over and the HUD retires itself.
const IDLE_HIDE_MS = 150_000;
const FLOAT_LIFE_MS = 2600;

const cr = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

const tierOf = (c: number): Floater['tier'] =>
  c >= 150_000 ? 'huge' : c >= 60_000 ? 'big' : c >= 20_000 ? 'mid' : 'low';

const TIER_CLASS: Record<Floater['tier'], string> = {
  huge: 'text-amber-300 text-2xl font-bold drop-shadow-[0_0_10px_rgba(251,191,36,0.55)]',
  big: 'text-emerald-300 text-xl font-semibold',
  mid: 'text-emerald-400 text-lg',
  low: 'text-muted-foreground text-base',
};

export function MiningTicker() {
  const enabled = useAppStore((s) => s.settings.targetPopupEnabled);
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState(0);
  const [tonnes, setTonnes] = useState(0);
  const [rock, setRock] = useState(0);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  // Displayed total lags the real one and catches up each frame, so the number rolls rather than snaps.
  const [shown, setShown] = useState(0);

  const targetRef = useRef(0);
  const shownRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const raf = useRef<number | null>(null);

  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), IDLE_HIDE_MS);
  }, []);

  useEffect(() => {
    const off = sseSubscribe('mining_refined', (raw) => {
      const ev = raw as RefinedEvent;
      const credits = Number(ev.credits) || 0;
      const sess = Number(ev.sessionCredits) || 0;

      targetRef.current = sess;
      setSession(sess);
      setTonnes(Number(ev.sessionTonnes) || 0);
      setRock(Number(ev.rockCredits) || 0);
      setVisible(true);
      armHide();

      const id = ++seq.current;
      const label = credits > 0 ? `+${cr(credits)}` : `+1t ${ev.commodity ?? ''}`;
      setFloaters((f) => [...f, { id, text: label, tier: tierOf(credits), mission: !!ev.mission }].slice(-6));
      setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), FLOAT_LIFE_MS);
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [armHide]);

  // Count-up animation toward the real session total.
  useEffect(() => {
    const step = () => {
      const target = targetRef.current;
      const cur = shownRef.current;
      if (Math.abs(target - cur) > 1) {
        const next = cur + (target - cur) * 0.18;
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
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [session]);

  if (enabled === false) return null;
  if (!visible || tonnes === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-28 right-4 z-40 select-none">
      <style>{`
        @keyframes edcMineFloat {
          0%   { opacity: 0; transform: translateY(6px) scale(0.94); }
          18%  { opacity: 1; transform: translateY(0) scale(1); }
          72%  { opacity: 1; transform: translateY(-26px); }
          100% { opacity: 0; transform: translateY(-46px); }
        }
      `}</style>

      {/* Floating credit hits, newest at the bottom. */}
      <div className="flex flex-col items-end gap-0.5 mb-1 h-24 justify-end overflow-visible">
        {floaters.map((f) => (
          <div
            key={f.id}
            className={`${TIER_CLASS[f.tier]} tabular-nums`}
            style={{ animation: `edcMineFloat ${FLOAT_LIFE_MS}ms ease-out forwards` }}
          >
            {f.text}
            {f.mission && <span className="ml-1 text-xs opacity-70">mission</span>}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">This session</div>
        <div className="text-2xl font-bold tabular-nums text-emerald-400">{cr(shown)}<span className="text-sm ml-1 font-normal text-muted-foreground">Cr</span></div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {tonnes}t refined{rock > 0 && <> · {cr(rock)} this rock</>}
        </div>
      </div>
    </div>
  );
}
