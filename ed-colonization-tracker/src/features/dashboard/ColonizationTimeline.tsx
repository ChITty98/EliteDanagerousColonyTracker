import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getStationTypeIcon, getStationTypeInfo } from '@/data/stationTypes';

export interface TimelineEntry {
  date: string;        // ISO timestamp
  systemName: string;
  stationName: string;
  stationType: string;
  projectId: string;
}

interface ColonizationTimelineProps {
  entries: TimelineEntry[];
}

const INITIAL_SHOW = 30;

export function ColonizationTimeline({ entries }: ColonizationTimelineProps) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (entries.length === 0) {
    return (
      <div className="mt-8 text-center py-8 text-muted-foreground">
        <span className="text-3xl block mb-2">{'\u{1F680}'}</span>
        <p className="text-sm">Your colonization timeline begins with your first completed station.</p>
      </div>
    );
  }

  const visible = showAll ? entries : entries.slice(0, INITIAL_SHOW);

  // Group by month/year
  const groups: { label: string; items: TimelineEntry[] }[] = [];
  let currentLabel = '';
  for (const entry of visible) {
    const d = new Date(entry.date);
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(entry);
  }

  // Compute year span for the summary
  const oldestDate = entries.length > 0 ? new Date(entries[entries.length - 1].date) : null;
  const newestDate = entries.length > 0 ? new Date(entries[0].date) : null;
  const spanText = oldestDate && newestDate
    ? oldestDate.getFullYear() === newestDate.getFullYear()
      ? `${newestDate.getFullYear()}`
      : `${oldestDate.getFullYear()} \u2013 ${newestDate.getFullYear()}`
    : '';

  return (
    <div className="mt-8">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-lg font-semibold text-muted-foreground mb-4 hover:text-foreground transition-colors w-full text-left"
      >
        <span className="text-xs transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          {'\u25BC'}
        </span>
        {'\u{1F4C5}'} Colonization Timeline ({entries.length} stations)
        {spanText && (
          <span className="text-sm font-normal text-muted-foreground ml-2">{spanText}</span>
        )}
      </button>

      {!collapsed && (
        <>
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border/50" />

            {groups.map((group) => (
              <div key={group.label} className="mb-4">
                {/* Month label */}
                <div className="relative flex items-center mb-2">
                  <div className="absolute left-[-18px] w-3 h-3 rounded-full bg-primary/40 border-2 border-primary" />
                  <span className="text-xs font-bold text-primary/80 uppercase tracking-wider">
                    {group.label}
                  </span>
                  <span className="text-xs text-muted-foreground/60 ml-2">
                    ({group.items.length} station{group.items.length !== 1 ? 's' : ''})
                  </span>
                </div>

                {/* Entries */}
                {group.items.map((entry, i) => {
                  const d = new Date(entry.date);
                  const dayStr = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
                  const icon = getStationTypeIcon(entry.stationType);
                  const typeInfo = getStationTypeInfo(entry.stationType);

                  return (
                    <Link
                      key={`${entry.projectId}-${i}`}
                      to={`/projects/${entry.projectId}`}
                      className="relative flex items-start gap-3 mb-2 ml-2 group hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                    >
                      <div className="absolute left-[-22px] top-1.5 w-2 h-2 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60 transition-colors" />
                      <span className="text-xs text-muted-foreground w-14 shrink-0 pt-0.5">{dayStr}</span>
                      <div className="flex-1 text-sm">
                        <span className="mr-1.5">{icon}</span>
                        <span className="text-foreground font-medium">{entry.systemName}</span>
                        <span className="text-muted-foreground"> — {entry.stationName}</span>
                        <span className="text-muted-foreground/50 text-xs ml-1.5">({typeInfo.shortLabel})</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          {entries.length > INITIAL_SHOW && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 ml-6 text-xs text-secondary hover:underline"
            >
              Show all {entries.length} milestones
            </button>
          )}
          {showAll && entries.length > INITIAL_SHOW && (
            <button
              onClick={() => setShowAll(false)}
              className="mt-2 ml-6 text-xs text-muted-foreground hover:underline"
            >
              Show less
            </button>
          )}
        </>
      )}
    </div>
  );
}
