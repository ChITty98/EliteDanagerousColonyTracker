import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';
import { sendTargetOverlay } from '@/services/overlayService';
import { friendlyStarName, colonizationOutlook, type ColonizationRating } from '@/lib/starNaming';
import { eventIcon, eventColor, eventSummary, isNotableDock, type CompanionEvent } from '@/lib/companionEvents';

// Colonization-outlook chip colors by rating (mirrors CompanionPage's RATING_STYLE).
const RATING_STYLE: Record<ColonizationRating, string> = {
  worthwhile: 'bg-green-500/25 text-green-200 border-green-500/40',
  decent: 'bg-sky-500/25 text-sky-200 border-sky-500/40',
  marginal: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  skip: 'bg-slate-600/30 text-slate-300 border-slate-600/50',
  unknown: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
};

// The target_selected payload (subset we read). Matches what the watcher
// broadcasts and what CompanionPage consumes.
interface TargetEvent {
  type: string;
  timestamp?: string;
  system?: string;
  systemAddress?: number;
  starClass?: string;
  remainingJumps?: number;
  visited?: boolean;
  spansh?: 'yes' | 'empty' | 'no' | 'unknown';
  bodyCount?: number;
  scannedBodyCount?: number;
  wasColonised?: boolean;
  score?: number;
  starCount?: number;
  bodyString?: string;
  scoreSource?: string;
  [key: string]: unknown;
}

// Headline event types (besides target_selected) that pop a compact card.
const HEADLINE_TYPES = ['first_footfall', 'score_update', 'npc_threat', 'station_dock_summary'] as const;

// Single discriminated pop-up state: the rich target card, or a compact
// headline-event card, or nothing.
type PopupState =
  | { kind: 'target'; ev: TargetEvent }
  | { kind: 'event'; ev: CompanionEvent }
  | null;

// Auto-dismiss after this long with no new event.
const AUTO_DISMISS_MS = 20000;

/**
 * Global headline-event pop-up. Subscribes to the SSE bus and renders a
 * non-blocking bottom-right corner card. For `target_selected` it shows the
 * same rich outlook/Spansh detail CompanionPage does; for other headline events
 * (first_footfall, score_update, npc_threat, notable station_dock_summary) it
 * shows a compact icon + summary line — so info pops on any tab without forcing
 * a switch to the Companion page.
 *
 * Mounted once in the root Layout. Gated on settings.targetPopupEnabled.
 */
export function TargetPopup() {
  const enabled = useAppStore((s) => s.settings.targetPopupEnabled);
  const [popup, setPopup] = useState<PopupState>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to the shared SSE bus. The bus opens its single EventSource on
  // first subscribe — same connection CompanionPage / state-sync use.
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const clearTimer = () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };

    const show = (next: NonNullable<PopupState>) => {
      // Replace whatever is showing, reset the auto-dismiss.
      setPopup(next);
      clearTimer();
      dismissTimerRef.current = setTimeout(() => setPopup(null), AUTO_DISMISS_MS);
    };

    unsubs.push(sseSubscribe('target_selected', (ev) => {
      show({ kind: 'target', ev: ev as TargetEvent });
      // Also push the rich line to the in-game overlay (its own overlayEnabled gate).
      if (useAppStore.getState().settings.overlayEnabled !== false) {
        sendTargetOverlay(ev as TargetEvent);
      }
    }));

    // Other headline events render the compact card. Skip routine re-docks.
    for (const type of HEADLINE_TYPES) {
      unsubs.push(sseSubscribe(type, (ev) => {
        const e = ev as CompanionEvent;
        if (e.type === 'station_dock_summary' && !isNotableDock(e)) return;
        show({ kind: 'event', ev: e });
      }));
    }

    // A cleared nav route means the target is stale — drop the card.
    unsubs.push(sseSubscribe('nav_route_cleared', () => {
      clearTimer();
      setPopup(null);
    }));

    return () => {
      unsubs.forEach((fn) => fn());
      clearTimer();
    };
  }, []);

  // Gate AFTER hooks so hook order stays stable. Default-on: treat undefined as true.
  if (enabled === false) return null;
  if (!popup) return null;

  const dismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setPopup(null);
  };

  // Compact card for non-target headline events (first_footfall, score_update,
  // npc_threat, notable station_dock_summary). Icon + summary, tinted by type.
  if (popup.kind === 'event') {
    const ev = popup.ev;
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-lg">
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="text-2xl shrink-0">{eventIcon(ev.type)}</span>
          <div className={`min-w-0 flex-1 text-sm ${eventColor(ev.type)}`}>
            {eventSummary(ev)}
          </div>
          <button
            onClick={dismiss}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Dismiss"
          >
            {'✕'}
          </button>
        </div>
      </div>
    );
  }

  // Rich card for target_selected.
  const target = popup.ev;

  // Colonization outlook from the system NAME (mass code) + FSDTarget primary
  // class. Works even for systems Spansh has never seen.
  const outlook = colonizationOutlook(
    String(target.system || ''),
    target.starClass ? String(target.starClass) : null,
  );

  // Scan completeness — "in Spansh" can be a partial scan, so a low score may be
  // hiding gems in the unrecorded bodies. Don't let partial read as "known".
  const scanned = typeof target.scannedBodyCount === 'number' ? target.scannedBodyCount : null;
  const total = typeof target.bodyCount === 'number' ? target.bodyCount : null;
  const partial = scanned != null && total != null && total > scanned;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-lg">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="text-2xl shrink-0">{'\u{1F3AF}'}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Target
          </div>
          <div className="text-lg font-bold text-foreground truncate">
            {String(target.system || 'Unknown')}
          </div>
          {target.starClass ? (
            <div className="text-sm text-muted-foreground">
              {friendlyStarName(String(target.starClass))}
            </div>
          ) : null}

          {/* Colonization verdict + name-derived odds (mirrors CompanionPage). */}
          {outlook && outlook.code ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${RATING_STYLE[outlook.rating]}`}>
                Mass {outlook.code} {'·'} {outlook.label}
              </span>
              {typeof outlook.pInteresting === 'number' ? (
                <span className="text-[11px] text-slate-500">
                  interesting body {outlook.pInteresting.toFixed(0)}%
                  {outlook.pOxygen && outlook.oxygenLift
                    ? ` · O₂ ${outlook.oxygenLift >= 1.5 ? outlook.oxygenLift.toFixed(1) + '× base' : outlook.pOxygen.toFixed(2) + '%'}`
                    : ''}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Status line — visited + Spansh classification. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm">
            <span className={target.visited ? 'text-green-400' : 'text-slate-400'}>
              {target.visited ? '✓ Visited' : 'New'}
            </span>
            {target.spansh === 'no' ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/25 text-green-200 border border-green-500/40">
                {'✗'} Not in Spansh — unclassified
              </span>
            ) : (
              <span
                className={
                  target.spansh === 'yes'
                    ? (partial ? 'text-amber-400 font-medium' : 'text-green-400')
                    : target.spansh === 'empty'
                    ? 'text-yellow-400'
                    : 'text-slate-400'
                }
              >
                {target.spansh === 'yes'
                  ? (partial
                      ? `⚠ partial: ${scanned} of ${total}`
                      : `✓ In Spansh${total ? ` (${total} bodies)` : ''}`)
                  : target.spansh === 'empty'
                  ? 'Spansh: empty'
                  : 'Spansh: unknown'}
              </span>
            )}
            {target.wasColonised ? (
              <span className="text-amber-400">{'★ Colonised'}</span>
            ) : null}
            {typeof target.score === 'number' ? (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  target.score >= 100
                    ? 'bg-amber-500/30 text-amber-200'
                    : target.score >= 60
                    ? 'bg-green-500/30 text-green-200'
                    : 'bg-sky-500/30 text-sky-200'
                }`}
              >
                Score: {target.score}{target.scoreSource ? ` [${String(target.scoreSource)}]` : ''}
              </span>
            ) : null}
            {typeof target.starCount === 'number' && target.starCount >= 2 ? (
              <span className="text-[11px] text-indigo-300">{'★'} {target.starCount} stars</span>
            ) : null}
          </div>

          {target.bodyString ? (
            <div className="text-xs text-slate-300 mt-1 font-mono truncate">
              {String(target.bodyString)}
            </div>
          ) : null}
        </div>

        <button
          onClick={dismiss}
          className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Dismiss"
        >
          {'✕'}
        </button>
      </div>
    </div>
  );
}
