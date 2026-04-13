import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store';
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
    case 'heartbeat':
      return '';
    default:
      return ev.type;
  }
}

export function CompanionPage() {
  const overlayEnabled = useAppStore((s) => s.settings.overlayEnabled);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);

  const [events, setEvents] = useState<CompanionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [actionResult, setActionResult] = useState<CompanionContent | null>(null);
  const [actionLabel, setActionLabel] = useState('');
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
          // Update commander position for map
          if (ev.starPos) {
            const pos = ev.starPos as [number, number, number];
            useAppStore.getState().setCommanderPosition({
              systemName: ev.system as string,
              systemAddress: ev.systemAddress as number,
              coordinates: { x: pos[0], y: pos[1], z: pos[2] },
            });
          }
        }
        // Track docked station for "Buy Here" button
        if (ev.type === 'docked' && ev.marketId && ev.station && ev.system) {
          setLastDocked(ev.marketId as number, ev.station as string, ev.system as string);
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
