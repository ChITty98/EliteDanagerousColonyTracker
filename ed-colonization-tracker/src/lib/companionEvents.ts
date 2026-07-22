// Shared formatters for live SSE companion events. Used by the Companion tab's
// feed AND the global event pop-up, so both render identically (no drift).

export interface CompanionEvent {
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

// --- Event icons/colors by type ---
export function eventIcon(type: string): string {
  switch (type) {
    // Mining assist
    case 'mining_target': return '🎯';    // target
    case 'mining_prospect': return '⛏️'; // pick
    case 'mining_refined': return '💰';   // money bag
    case 'mining_milestone': return '🏆'; // trophy
    case 'mining_stall': return '⚠️';   // warning
    case 'mining_cargo': return '📦';     // package
    case 'mining_cold': return '❄️';    // snowflake
    case 'mining_ring': return '💠';      // diamond shape
    case 'mining_record': return '🏆';    // trophy
    case 'mining_rock_done': return '✔️'; // check
    case 'mining_catch': return '🎣';     // fishing pole — the trophy shot
    case 'mining_unmapped': return '🔭';  // telescope — DSS scan needed
    case 'fsd_jump': return '\u{1F680}'; // rocket
    case 'docked': return '⚓'; // anchor
    case 'scan_highlight': return '\u{1F52D}'; // telescope
    case 'fss_complete': return '✅'; // check
    case 'contribution': return '\u{1F4E6}'; // package
    case 'companion_action': return '\u{1F4F1}'; // phone
    case 'connected': return '\u{1F7E2}'; // green circle
    case 'first_footfall': return '\u{1F9B6}'; // foot
    case 'score_update': return '\u{1F3AF}'; // target
    case 'distance_info': return '\u{1F4CD}'; // pin
    case 'target_selected': return '\u{1F3AF}'; // target (bullseye)
    case 'nav_route_plotted': return '\u{1F5FA}'; // world map
    case 'nav_route_cleared': return '❌'; // red x
    case 'station_dock_summary': return '\u{1F3DB}'; // classical building
    case 'npc_threat': return '\u{1F6A8}'; // rotating red siren
    case 'supercruise_exit': return '\u{1F6F0}️'; // satellite
    default: return '◉';
  }
}

export function eventColor(type: string): string {
  switch (type) {
    case 'mining_target': return 'text-cyan-400';
    case 'mining_prospect': return 'text-cyan-300';
    case 'mining_refined': return 'text-green-400';
    case 'mining_milestone': return 'text-amber-400';
    case 'mining_stall': return 'text-amber-400';
    case 'mining_cargo': return 'text-amber-400';
    case 'mining_cold': return 'text-sky-300';
    case 'mining_ring': return 'text-violet-400';
    case 'mining_record': return 'text-amber-300';
    case 'mining_rock_done': return 'text-green-400';
    case 'mining_catch': return 'text-amber-300';
    case 'mining_unmapped': return 'text-violet-400';
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

const miningCr = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

export function eventSummary(ev: CompanionEvent): string {
  switch (ev.type) {
    case 'mining_target':
      return `Target rock — ${ev.summary}`;
    case 'mining_prospect':
      return `Good rock — ~${miningCr(Number(ev.value) || 0)} Cr · ${ev.summary}`;
    case 'mining_refined':
      return `${ev.commodity} +${miningCr(Number(ev.credits) || 0)} Cr${ev.mission ? ' (mission)' : ''} — ${miningCr(Number(ev.sessionCredits) || 0)} this session`;
    case 'mining_milestone':
      return `${miningCr(Number(ev.sessionCredits) || 0)} Cr this session — ${ev.sessionTonnes}t refined`;
    case 'mining_stall':
      return String(ev.summary || 'Collection slowed');
    case 'mining_cargo':
      return String(ev.summary || 'Hold filling up');
    case 'mining_cold':
      return `Patch going cold — last ${ev.window} rocks ~${miningCr(Number(ev.recentMedian) || 0)} vs ~${miningCr(Number(ev.baseline) || 0)} here`;
    case 'mining_ring':
      return `${ev.ring} — ${ev.summary}`;
    case 'mining_record':
      return ev.kind === 'best'
        ? `NEW BEST ROCK — ${miningCr(Number(ev.credits) || 0)} Cr from ${ev.tonnes}t (beat ${miningCr(Number(ev.previous) || 0)})`
        : `#${ev.rank} best rock ever — ${miningCr(Number(ev.credits) || 0)} Cr from ${ev.tonnes}t`;
    case 'mining_rock_done':
      return `Rock done — ${ev.tonnes}t · ${miningCr(Number(ev.credits) || 0)} Cr`;
    case 'mining_catch':
      return `${ev.tierLabel} — ${ev.tonnes}t · ${miningCr(Number(ev.credits) || 0)} Cr`;
    case 'mining_unmapped':
      return `${ev.count} ring${Number(ev.count) === 1 ? '' : 's'} in ${ev.system} need a DSS scan — ${Array.isArray(ev.rings) ? (ev.rings as string[]).slice(0, 4).join(', ') : ''}`;
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
      return `${ev.system} — Score: ${ev.score}${ev.source ? ` [${ev.source}]` : ''}`;
    case 'distance_info':
      return (ev.distances as string[])?.join(' | ') || '';
    case 'companion_action':
      return `Action: ${ev.action}`;
    case 'connected':
      return 'Connected to event stream';
    case 'target_selected': {
      const visited = ev.visited ? '✓ Visited' : 'New';
      const spanshStr = ev.spansh === 'yes'
        ? `✓ Spansh${ev.bodyCount ? ` (${ev.bodyCount} bodies)` : ''}`
        : ev.spansh === 'empty'
        ? 'Spansh: empty'
        : ev.spansh === 'no'
        ? '✗ Not in Spansh'
        : 'Spansh: unknown';
      const col = ev.wasColonised ? ' — colonised' : '';
      const scoreStr = typeof ev.score === 'number' ? ` | Score: ${ev.score}` : '';
      return `Targeting ${ev.system} — ${visited} | ${spanshStr}${col}${scoreStr}`;
    }
    case 'nav_route_plotted':
      return `Route plotted: ${ev.hops} hops → ${ev.destination} (visited ${ev.visitedCount}/${ev.hops}, Spansh ${ev.spanshCached}/${ev.hops})`;
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
      if (ev.factionChanged) extras.push(`⚠ New faction: ${ev.currentFaction}`);
      if (ev.stateChanged) extras.push(`→ ${ev.currentState} (was ${ev.previousState})`);
      const body = `${ev.station} — ${label}${extras.length ? ' — ' + extras.join(' | ') : ''}`;
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

// Whether a docked summary is a "headline" worth popping (not a routine re-dock).
export function isNotableDock(ev: CompanionEvent): boolean {
  return !!(ev.isFirstVisit || (ev.milestone && ev.milestone !== 1) || ev.factionChanged || ev.stateChanged);
}
