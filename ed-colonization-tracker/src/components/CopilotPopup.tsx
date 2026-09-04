/**
 * Co-pilot pop-up — the character's face and line, anywhere in the app.
 *
 * The Cockpit page renders the co-pilot properly, but it's almost never the page on screen while
 * actually flying or mining — so lines were being spoken into a room nobody was in. This surfaces
 * each `copilot_line` as a portrait + speech bubble in the bottom-left corner (catch card and
 * ticker own the right), on whatever tab is open.
 *
 * Art comes from the same packs the Cockpit uses — /copilot-art/<persona>/<mood>.png with a
 * calm.png fallback — so Tycho goes hyped for catches and proud for records at zero extra cost.
 * Suppressed on the Cockpit page itself (it already shows the line, bigger).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';
import { playVoice } from '@/services/copilotVoice';

interface CopilotLineEvent {
  id?: string;
  line?: string;
  beat?: string;
  mood?: string;
  [k: string]: unknown;
}

const HOLD_MS = 22000;
// Display names only — the persona KEYS stay as they are, since renaming one would orphan the
// stored setting, the canned pools and every rated capture that references it.
const PERSONA_NAMES: Record<string, string> = { wash: 'Wren', tars: 'Tycho', k2: 'K2' };

export function CopilotPopup() {
  const enabled = useAppStore((s) => s.settings.copilotPopupEnabled) !== false;
  const copilotOn = useAppStore((s) => s.settings.copilotEnabled) ?? false;
  const persona = useAppStore((s) => s.settings.copilotPersonality) ?? 'wash';
  const location = useLocation();
  const [ev, setEv] = useState<CopilotLineEvent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = sseSubscribe('copilot_line', (raw) => {
      const e = raw as CopilotLineEvent;
      if (!e.line) return;
      // Speech is driven from HERE and nowhere else. This component is mounted app-wide in
      // Layout, so its subscription is the one that fires on every page — including /copilot,
      // where the bubble hides itself but the effect still runs. Playing from the Cockpit page
      // as well would speak every line twice.
      // Read settings live: the handler is registered once and would otherwise close over
      // whatever the toggles were at mount.
      const s = useAppStore.getState().settings;
      if (s.copilotVoiceEnabled && s.copilotEnabled && e.id) {
        void playVoice(e.id, s.copilotPersonality ?? 'wash');
      }
      setEv(e);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setEv(null), HOLD_MS);
    });
    return () => { off(); if (timer.current) clearTimeout(timer.current); };
  }, []);

  // Gates AFTER hooks so hook order stays stable.
  if (!enabled || !copilotOn) return null;
  if (location.pathname === '/copilot') return null; // the Co-pilot page already shows this, bigger
  if (!ev) return null;

  const mood = ev.mood || 'calm';

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[21rem] max-w-[calc(100vw-2rem)] pointer-events-auto">
      <style>{`
        @keyframes edcCopilotIn {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        className="flex items-end gap-2.5"
        style={{ animation: 'edcCopilotIn 300ms ease-out both' }}
      >
        <img
          src={`/copilot-art/${persona}/${mood}.png`}
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (!img.src.endsWith('/calm.png')) img.src = `/copilot-art/${persona}/calm.png`;
            else img.style.display = 'none'; // no pack installed — bubble alone still works
          }}
          alt={PERSONA_NAMES[persona] ?? persona}
          className="h-20 w-20 shrink-0 rounded-lg object-cover border border-border shadow-lg bg-card"
        />
        <div className="relative flex-1 rounded-lg border border-border bg-card/97 backdrop-blur px-3.5 py-2.5 shadow-lg">
          {/* bubble tail pointing at the portrait */}
          <div className="absolute left-[-6px] bottom-4 h-3 w-3 rotate-45 border-b border-l border-border bg-card/97" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              {PERSONA_NAMES[persona] ?? persona}
            </span>
            <button
              onClick={() => setEv(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              {'✕'}
            </button>
          </div>
          <p className="mt-1 text-sm leading-snug text-foreground">{ev.line}</p>
        </div>
      </div>
    </div>
  );
}
