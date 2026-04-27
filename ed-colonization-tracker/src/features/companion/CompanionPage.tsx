import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store';
import { FC_MAX_CAPACITY } from '@/store/types';
import {
  computeNeedsContent,
  computeScoreContent,
  computeHaulContent,
  computeBuyHereContent,
  computeStatusContent,
  sendContentToOverlay,
  postCompanionEvent,
  setLastSystem,
  setLastDocked,
  type CompanionContent,
} from '@/services/overlayService';

interface CompanionEvent {
  type: string;
  timestamp: string;
  system?: string;
  station?: string;
  body?: string;
  commodity?: string;
  amount?: number;
  bodyCount?: number;
  atmosphere?: string;
  hasRings?: boolean;
  stationType?: string;
  population?: number;
  systemAddress?: number;
  [key: string]: unknown;
}

// --- Token helper ---
function getToken(): string | null {
  try { return sessionStorage.getItem('colony-token') || null; } catch { return null; }
}

// --- Event icons/colors by type ---
function eventIcon(type: string): string {
  switch (type) {
    case 'fsd_jump': return '\u{1F680}'; // rocket
    case 'docked': return '\u2693'; // anchor
    case 'scan_highlight': return '\u{1F52D}'; // telescope
    case 'fss_complete': return '\u2705'; // check
    case 'contribution': return '\u{1F4E6}'; // package
    case 'companion_action': return '\u{1F4F1}'; // phone
    case 'connected': return '\u{1F7E2}'; // green circle
    case 'first_footfall': return '\u{1F9B6}'; // foot
    case 'score_update': return '\u{1F3AF}'; // target
    case 'distance_info': return '\u{1F4CD}'; // pin
    case 'target_selected': return '\u{1F3AF}'; // target (bullseye)
    case 'nav_route_plotted': return '\u{1F5FA}'; // world map
    case 'nav_route_cleared': return '\u274C'; // red x
    case 'station_dock_summary': return '\u{1F3DB}'; // classical building
    case 'npc_threat': return '\u{1F6A8}'; // rotating red siren
    case 'supercruise_exit': return '\u{1F6F0}\uFE0F'; // satellite
    default: return '\u25C9';
  }
}

function eventColor(type: string): string {
  switch (type) {
    case 'fsd_jump': return 'text-sky-400';
    case 'docked': return 'text-green-400';
    case 'scan_highlight': return 'text-yellow-400';
    case 'fss_complete': return 'text-purple-400';
    case 'contribution': return 'text-orange-400';
    case 'companion_action': return 'text-cyan-400';
    case 'connected': return 'text-green-400';
    case 'first_footfall': return 'text-purple-400';
    case 'score_update': return 'text-sky-400';
    case 'distance_info': return 'text-slate-400';
    case 'target_selected': return 'text-amber-400';
    case 'nav_route_plotted': return 'text-indigo-400';
    case 'nav_route_cleared': return 'text-slate-400';
    case 'station_dock_summary': return 'text-blue-300';
    case 'npc_threat': return 'text-red-400';
    case 'supercruise_exit': return 'text-cyan-400';
    default: return 'text-muted-foreground';
  }
}

function eventSummary(ev: CompanionEvent): string {
  switch (ev.type) {
    case 'fsd_jump':
      return `Jumped to ${ev.system}${ev.population ? ` (pop: ${ev.population.toLocaleString()})` : ''}`;
    case 'docked':
      return `Docked at ${ev.station} in ${ev.system}`;
    case 'scan_highlight':
      return `${ev.body}${ev.hasRings ? ' \u{1F48D} Ringed' : ''}${ev.atmosphere ? ` \u{1F30D} ${ev.atmosphere}` : ''}`;
    case 'fss_complete':
      return `FSS complete: ${ev.system} (${ev.bodyCount} bodies)`;
    case 'contribution':
      return `Contributed ${ev.amount?.toLocaleString()}t ${ev.commodity}`;
    case 'first_footfall':
      return `\u{1F9B6} First footfall: ${ev.body} (${ev.distance})`;
    case 'score_update':
      return `${ev.system} \u2014 Score: ${ev.score}${ev.source ? ` [${ev.source}]` : ''}`;
    case 'distance_info':
      return (ev.distances as string[])?.join(' | ') || '';
    case 'companion_action':
      return `Action: ${ev.action}`;
    case 'connected':
      return 'Connected to event stream';
    case 'target_selected': {
      const visited = ev.visited ? '\u2713 Visited' : 'New';
      const spanshStr = ev.spansh === 'yes'
        ? `\u2713 Spansh${ev.bodyCount ? ` (${ev.bodyCount} bodies)` : ''}`
        : ev.spansh === 'empty'
        ? 'Spansh: empty'
        : ev.spansh === 'no'
        ? '\u2717 Not in Spansh'
        : 'Spansh: unknown';
      const col = ev.wasColonised ? ' \u2014 colonised' : '';
      const scoreStr = typeof ev.score === 'number' ? ` | Score: ${ev.score}` : '';
      return `Targeting ${ev.system} \u2014 ${visited} | ${spanshStr}${col}${scoreStr}`;
    }
    case 'nav_route_plotted':
      return `Route plotted: ${ev.hops} hops \u2192 ${ev.destination} (visited ${ev.visitedCount}/${ev.hops}, Spansh ${ev.spanshCached}/${ev.hops})`;
    case 'npc_threat':
      return `\u{1F6A8} ${ev.from}: "${ev.message}"`;
    case 'supercruise_exit':
      return `Dropped at ${ev.body}`;
    case 'station_dock_summary': {
      const ord = (n: number) => {
        if (n >= 11 && n <= 13) return `${n}th`;
        const s = n % 10;
        return s === 1 ? `${n}st` : s === 2 ? `${n}nd` : s === 3 ? `${n}rd` : `${n}th`;
      };
      const count = ev.dockedCount as number;
      const label = ev.isFirstVisit ? 'first visit' : `${ord(count)} visit`;
      const extras: string[] = [];
      if (ev.milestone && ev.milestone !== 1) extras.push(`\u{1F3C6} ${ev.milestone}-visit milestone`);
      if (ev.factionChanged) extras.push(`\u26A0 New faction: ${ev.currentFaction}`);
      if (ev.stateChanged) extras.push(`\u2192 ${ev.currentState} (was ${ev.previousState})`);
      const body = `${ev.station} \u2014 ${label}${extras.length ? ' \u2014 ' + extras.join(' | ') : ''}`;
      return body;
    }
    case 'nav_route_cleared':
      return 'Route cleared';
    case 'heartbeat':
      return '';
    default:
      return ev.type;
  }
}

export function CompanionPage() {
  const overlayEnabled = useAppStore((s) => s.settings.overlayEnabled);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const myFleetCarrier = useAppStore((s) => s.settings.myFleetCarrier);
  const fcModulesCapacity = useAppStore((s) => s.settings.fcModulesCapacity);
  const carrierCargo = useAppStore((s) => s.carrierCargo);

  // Live FC free-space computation: 25,000 − modules − current cargo (from journal)
  const myCargo = myFleetCarrier ? carrierCargo?.[myFleetCarrier] : undefined;
  const currentCargoTons = myCargo?.items.reduce((sum, i) => sum + i.count, 0) ?? 0;
  const fcFreeSpace = FC_MAX_CAPACITY - (fcModulesCapacity || 0) - currentCargoTons;

  const [events, setEvents] = useState<CompanionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [actionResult, setActionResult] = useState<CompanionContent | null>(null);
  const [actionLabel, setActionLabel] = useState('');
  const [lastTarget, setLastTarget] = useState<CompanionEvent | null>(null);
  const [lastDockSummary, setLastDockSummary] = useState<CompanionEvent | null>(null);
  const [threatAlert, setThreatAlert] = useState<CompanionEvent | null>(null);
  const threatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Active session info
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeProject = activeSession ? projects.find((p) => p.id === activeSession.projectId) : null;

  // Connect to SSE stream
  useEffect(() => {
    const token = getToken();
    const url = token ? `/api/events?token=${token}` : '/api/events';
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const ev: CompanionEvent = JSON.parse(msg.data);
        if (ev.type === 'heartbeat') return; // Silent keepalive
        // Track current system so "Show Score" works on iPad/remote devices
        if (ev.type === 'fsd_jump' && ev.systemAddress && ev.system) {
          setLastSystem(ev.systemAddress as number, ev.system as string);
          // commanderPosition is handled via the dedicated 'commander_position'
          // event (below). Nothing else to do here.
        }
        // commander_position — authoritative location update from watcher
        if (ev.type === 'commander_position' && ev.systemName) {
          useAppStore.getState().setCommanderPosition({
            systemName: ev.systemName as string,
            systemAddress: ev.systemAddress as number,
            coordinates: ev.coordinates as { x: number; y: number; z: number },
            source: (ev.source as import('@/store').PositionSource) || 'Server',
            updatedAt: ev.updatedAt as string,
          });
          // Log to server terminal so we can see the pipeline
          try {
            const tk = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
            fetch(tk ? `/api/log?token=${tk}` : '/api/log', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tag: 'Companion', message: `Received commander_position ${ev.systemName} via ${ev.source}` }),
            }).catch(() => {});
          } catch { /* ignore */ }
        }
        // Track docked station for "Buy Here" button
        if (ev.type === 'docked' && ev.marketId && ev.station && ev.system) {
          setLastDocked(ev.marketId as number, ev.station as string, ev.system as string);
        }
        // Persist the most recent target alert in its own banner
        if (ev.type === 'target_selected') {
          setLastTarget(ev);
        }
        if (ev.type === 'nav_route_cleared') {
          setLastTarget(null);
        }
        // Persist the most recent dock welcome as a banner until next jump or new dock
        if (ev.type === 'station_dock_summary') {
          setLastDockSummary(ev);
        }
        // NPC threat — flash a red banner for 15 seconds then auto-dismiss
        if (ev.type === 'npc_threat') {
          setThreatAlert(ev);
          if (threatTimerRef.current) clearTimeout(threatTimerRef.current);
          threatTimerRef.current = setTimeout(() => setThreatAlert(null), 15000);
        }
        if (ev.type === 'fsd_jump') {
          // Left the system — dock welcome is now stale, clear banner
          setLastDockSummary(null);
        }
        setEvents((prev) => [ev, ...prev].slice(0, 50));
      } catch { /* ignore parse errors */ }
    };

    eventSourceRef.current = es;
    return () => { es.close(); eventSourceRef.current = null; };
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [events]);

  // Quick action handler
  const handleAction = useCallback((action: string, compute: () => CompanionContent) => {
    const content = compute();
    setActionResult(content);
    setActionLabel(action);

    // Send to in-game overlay
    if (overlayEnabled) {
      sendContentToOverlay(content);
    }

    // Broadcast to other companion clients
    postCompanionEvent({
      type: 'companion_action',
      action,
      lines: content.lines,
    });
  }, [overlayEnabled]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">{'\u{1F4E1}'} Companion</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Remote control + live feed — designed for your second screen
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {/* Status indicators */}
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {connected ? 'Live' : 'Disconnected'}
          </span>
          {overlayEnabled && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Overlay
            </span>
          )}
          {activeProject && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
              {activeProject.name}
            </span>
          )}
        </div>
      </div>

      {/* Commander Position — authoritative location + how we determined it */}
      <div className="bg-card border border-border rounded-lg px-4 py-2 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-lg">{'\u{1F4CD}'}</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current System</div>
            <div className="text-base font-bold text-foreground truncate">
              {commanderPosition?.systemName || 'Unknown — no position events seen yet'}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground shrink-0">
          {commanderPosition?.source ? (
            <div>
              via <span className="text-foreground font-medium">{commanderPosition.source}</span>
            </div>
          ) : null}
          {commanderPosition?.updatedAt ? (
            <div className="opacity-70">
              {new Date(commanderPosition.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          ) : null}
        </div>
      </div>

      {/* FC Free Space — computed live from settings + journal cargo */}
      {myFleetCarrier && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">{'\u{1F69A}'}</span>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {myFleetCarrier} — Free Cargo
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    fcFreeSpace < 1000
                      ? 'text-red-400'
                      : fcFreeSpace < 5000
                      ? 'text-yellow-400'
                      : 'text-green-400'
                  }`}
                >
                  {fcFreeSpace.toLocaleString()}t
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  = 25,000 − {(fcModulesCapacity || 0).toLocaleString()} − {currentCargoTons.toLocaleString()}
                </span>
              </div>
              {!fcModulesCapacity && (
                <div className="text-[11px] text-yellow-400/80 mt-0.5">
                  Set Modules tonnage in Settings for accurate free space
                </div>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Modules: {(fcModulesCapacity || 0).toLocaleString()}t</div>
            <div>Cargo: {currentCargoTons.toLocaleString()}t</div>
            {myCargo && (() => {
              const ts = (myCargo as { updatedAt?: string }).updatedAt
                || (myCargo as { latestTransfer?: string }).latestTransfer
                || null;
              const d = ts ? new Date(ts) : null;
              const label = d && !isNaN(d.getTime())
                ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—';
              return (
                <div className="text-[10px] opacity-70">
                  as of {label}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* NPC Threat Alert — flashing red banner, auto-dismisses after 15s */}
      {threatAlert && (
        <div
          className="bg-red-500/20 border-2 border-red-500 rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-3 shadow-lg"
          style={{ animation: 'threat-pulse 1s ease-in-out infinite' }}
        >
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-2xl">{'\u{1F6A8}'}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-red-300 uppercase tracking-widest">
                {String(threatAlert.threatClass || 'threat').toUpperCase()} DETECTED
              </div>
              <div className="text-base font-bold text-red-100 truncate">
                {String(threatAlert.from)}
              </div>
              <div className="text-sm text-red-200 mt-0.5">
                {String(threatAlert.message)}
              </div>
            </div>
          </div>
          <button
            onClick={() => { setThreatAlert(null); if (threatTimerRef.current) clearTimeout(threatTimerRef.current); }}
            className="text-xs text-red-300 hover:text-red-100 shrink-0"
            aria-label="Dismiss"
          >
            {'\u2715'}
          </button>
          <style>{`@keyframes threat-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); } 50% { box-shadow: 0 0 16px 4px rgba(239,68,68,0.8); } }`}</style>
        </div>
      )}

      {/* Target Alert — persistent banner for the most recent FSDTarget */}
      {lastTarget && (
        <div
          className={`border rounded-lg px-4 py-3 mb-4 ${
            lastTarget.visited && lastTarget.spansh === 'yes'
              ? 'bg-green-500/10 border-green-500/40'
              : (lastTarget.visited || lastTarget.spansh === 'yes')
              ? 'bg-amber-500/10 border-amber-500/40'
              : 'bg-red-500/10 border-red-500/40'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="text-2xl">{'\u{1F3AF}'}</span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Target Alert
                </div>
                <div className="text-lg font-bold text-foreground truncate">
                  {String(lastTarget.system)}
                  {lastTarget.starClass ? (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      [{String(lastTarget.starClass)}]
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-sm">
                  <span className={lastTarget.visited ? 'text-green-400' : 'text-slate-400'}>
                    {lastTarget.visited ? '\u2713 Visited' : '\u2717 Never been there'}
                  </span>
                  <span
                    className={
                      lastTarget.spansh === 'yes'
                        ? 'text-green-400'
                        : lastTarget.spansh === 'empty'
                        ? 'text-yellow-400'
                        : lastTarget.spansh === 'no'
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }
                  >
                    {lastTarget.spansh === 'yes'
                      ? `\u2713 In Spansh${lastTarget.bodyCount ? ` (${lastTarget.bodyCount} bodies)` : ''}`
                      : lastTarget.spansh === 'empty'
                      ? 'Spansh has the system (no body data)'
                      : lastTarget.spansh === 'no'
                      ? '\u2717 Not in Spansh'
                      : 'Spansh lookup unavailable'}
                  </span>
                  {lastTarget.wasColonised ? (
                    <span className="text-amber-400">{'\u2605 Colonised'}</span>
                  ) : null}
                  {typeof lastTarget.score === 'number' ? (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        (lastTarget.score as number) >= 100
                          ? 'bg-amber-500/30 text-amber-200'
                          : (lastTarget.score as number) >= 60
                          ? 'bg-green-500/30 text-green-200'
                          : 'bg-sky-500/30 text-sky-200'
                      }`}
                    >
                      Score: {String(lastTarget.score)}{lastTarget.scoreSource ? ` [${String(lastTarget.scoreSource)}]` : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">unscored</span>
                  )}
                  {typeof lastTarget.remainingJumps === 'number' && (lastTarget.remainingJumps as number) > 0 ? (
                    <span className="text-slate-400 text-xs">
                      {String(lastTarget.remainingJumps)} jumps remaining in route
                    </span>
                  ) : null}
                </div>
                {lastTarget.bodyString ? (
                  <div className="text-xs text-slate-300 mt-1 font-mono truncate">
                    {String(lastTarget.bodyString)}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              onClick={() => setLastTarget(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              {'\u2715'}
            </button>
          </div>
        </div>
      )}

      {/* Dock Welcome banner — persistent until next jump */}
      {lastDockSummary && (() => {
        const ord = (n: number) => {
          if (n >= 11 && n <= 13) return `${n}th`;
          const s = n % 10;
          return s === 1 ? `${n}st` : s === 2 ? `${n}nd` : s === 3 ? `${n}rd` : `${n}th`;
        };
        const milestone = lastDockSummary.milestone as number | null;
        const isMilestone = milestone && milestone >= 10;
        const isFirst = !!lastDockSummary.isFirstVisit;
        const count = lastDockSummary.dockedCount as number;
        const borderCls = isFirst || isMilestone
          ? 'bg-amber-500/10 border-amber-500/40'
          : lastDockSummary.factionChanged
          ? 'bg-red-500/10 border-red-500/40'
          : 'bg-blue-500/10 border-blue-500/40';
        return (
          <div className={`border rounded-lg px-4 py-3 mb-4 ${borderCls}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <span className="text-2xl">{'\u{1F3DB}'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {isFirst ? 'First Visit' : isMilestone ? `${milestone}-Visit Milestone` : 'Welcome Back'}
                  </div>
                  <div className="text-lg font-bold text-foreground truncate">
                    {String(lastDockSummary.station)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {isFirst ? '\u2014 first visit' : `\u2014 ${ord(count)} visit`}
                    </span>
                    {lastDockSummary.rank && !isFirst ? (
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-semibold ${
                        (lastDockSummary.rank as number) <= 3
                          ? 'bg-amber-500/30 text-amber-200'
                          : 'bg-slate-500/30 text-slate-300'
                      }`}>
                        {'#'}{String(lastDockSummary.rank)}{' most-visited'}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
                    {lastDockSummary.currentFaction ? (
                      <span className="text-slate-300">
                        {String(lastDockSummary.currentFaction)}
                      </span>
                    ) : null}
                    {lastDockSummary.currentState && lastDockSummary.currentState !== 'None' ? (
                      <span className="text-slate-400">
                        {String(lastDockSummary.currentState)}
                      </span>
                    ) : null}
                    {lastDockSummary.factionChanged && lastDockSummary.previousFaction ? (
                      <span className="text-red-400">
                        {'\u26A0 Was '}{String(lastDockSummary.previousFaction)}{' last visit'}
                      </span>
                    ) : null}
                    {lastDockSummary.stateChanged && lastDockSummary.previousState ? (
                      <span className="text-amber-300">
                        {'State shifted from '}{String(lastDockSummary.previousState)}
                      </span>
                    ) : null}
                    {lastDockSummary.anniversary === 'year' ? (
                      <span className="text-amber-300">{'\u{1F382} One year anniversary'}</span>
                    ) : lastDockSummary.anniversary === 'month' ? (
                      <span className="text-purple-300">{'\u{1F4C5} Months of loyalty'}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setLastDockSummary(null)}
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Dismiss"
              >
                {'\u2715'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <button
          onClick={() => handleAction('Show Needs', computeNeedsContent)}
          className="bg-card border border-purple-500/30 rounded-lg px-4 py-4 text-center hover:bg-purple-500/10 transition-colors"
        >
          <div className="text-2xl mb-1">{'\u{1F4CB}'}</div>
          <div className="text-sm font-medium text-purple-400">Show Needs</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Project progress + buy list</div>
        </button>

        <button
          onClick={() => handleAction('Show Score', computeScoreContent)}
          className="bg-card border border-sky-500/30 rounded-lg px-4 py-4 text-center hover:bg-sky-500/10 transition-colors"
        >
          <div className="text-2xl mb-1">{'\u{1F3AF}'}</div>
          <div className="text-sm font-medium text-sky-400">Show Score</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Current system score</div>
        </button>

        <button
          onClick={() => handleAction('Show Haul', computeHaulContent)}
          className="bg-card border border-cyan-500/30 rounded-lg px-4 py-4 text-center hover:bg-cyan-500/10 transition-colors"
        >
          <div className="text-2xl mb-1">{'\u{1F69A}'}</div>
          <div className="text-sm font-medium text-cyan-400">Show Haul</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Needs + FC load list</div>
        </button>

        <button
          onClick={() => handleAction('Buy Here', computeBuyHereContent)}
          className="bg-card border border-yellow-500/30 rounded-lg px-4 py-4 text-center hover:bg-yellow-500/10 transition-colors"
        >
          <div className="text-2xl mb-1">{'\u{1F6D2}'}</div>
          <div className="text-sm font-medium text-yellow-400">Buy Here</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">What to buy at this station</div>
        </button>

        <button
          onClick={() => handleAction('Show Status', computeStatusContent)}
          className="bg-card border border-green-500/30 rounded-lg px-4 py-4 text-center hover:bg-green-500/10 transition-colors"
        >
          <div className="text-2xl mb-1">{'\u{1F4CA}'}</div>
          <div className="text-sm font-medium text-green-400">Show Status</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Project overview</div>
        </button>
      </div>

      {/* Action Result Panel */}
      {actionResult && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{actionLabel}</span>
            <button
              onClick={() => setActionResult(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {'\u2715'}
            </button>
          </div>
          <div className="space-y-1.5">
            {actionResult.lines.map((line, i) => (
              <div key={i} className="text-sm font-medium" style={{ color: line.color }}>
                {line.text}
              </div>
            ))}
          </div>
          {overlayEnabled && (
            <p className="text-[10px] text-muted-foreground mt-2">
              {'\u2713'} Sent to in-game overlay
            </p>
          )}
        </div>
      )}

      {/* Live Event Feed */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Live Feed</h3>
          {events.length > 0 && (
            <button
              onClick={() => setEvents([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div
          ref={feedRef}
          className="bg-card border border-border rounded-lg overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 480px)', minHeight: '200px' }}
        >
          {events.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="text-3xl mb-2">{'\u{1F4E1}'}</div>
              <p className="text-sm">Waiting for events...</p>
              <p className="text-xs mt-1">
                {connected
                  ? 'Connected \u2014 events will appear when the journal watcher detects activity'
                  : 'Connecting to event stream...'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {events.map((ev, i) => {
                const summary = eventSummary(ev);
                if (!summary) return null;
                return (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 hover:bg-muted/20">
                    <span className="text-sm shrink-0 mt-0.5">{eventIcon(ev.type)}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${eventColor(ev.type)}`}>{summary}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums mt-0.5">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
