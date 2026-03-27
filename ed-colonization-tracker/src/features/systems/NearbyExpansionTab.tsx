import { useMemo, useState } from 'react';

import { useAppStore } from '@/store';
import type { ScoutedSystemData } from '@/store/types';

interface NearbyCandidate {
  scouted: ScoutedSystemData;
  distance: number;
  coords: { x: number; y: number; z: number };
}

function scoreColor(total: number): string {
  if (total >= 100) return 'text-yellow-400';
  if (total >= 60) return 'text-green-400';
  if (total >= 30) return 'text-sky-400';
  return 'text-muted-foreground';
}

export function NearbyExpansionTab({
  systemName,
  refCoords,
}: {
  systemName: string;
  refCoords: { x: number; y: number; z: number } | null;
}) {
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const projects = useAppStore((s) => s.projects);

  // Build set of own colonized system names (lowercase) to exclude
  const colonizedNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of projects) {
      if (p.systemName) names.add(p.systemName.toLowerCase());
    }
    return names;
  }, [projects]);

  const candidates = useMemo(() => {
    if (!refCoords) return [];

    const results: NearbyCandidate[] = [];

    for (const scouted of Object.values(scoutedSystems)) {
      // Skip zero-score systems
      if (!scouted.score || scouted.score.total === 0) continue;
      // Skip the current system
      if (scouted.name.toLowerCase() === systemName.toLowerCase()) continue;
      // Skip own colonized systems
      if (colonizedNames.has(scouted.name.toLowerCase())) continue;
      if (scouted.isColonised) continue;

      // Coordinates: prefer stored on scouted data (from Spansh search), fall back to knownSystems (journal FSDJump)
      const coords = scouted.coordinates || knownSystems[scouted.name.toLowerCase()]?.coordinates;
      if (!coords) continue;

      const dx = coords.x - refCoords.x;
      const dy = coords.y - refCoords.y;
      const dz = coords.z - refCoords.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance <= 50) {
        results.push({ scouted, distance, coords });
      }
    }

    // Sort by score descending, then distance ascending
    results.sort((a, b) => b.scouted.score.total - a.scouted.score.total || a.distance - b.distance);

    return results;
  }, [refCoords, scoutedSystems, knownSystems, systemName, colonizedNames]);

  // Split into 15ly (single hop) and beyond (capped at top 10 by score)
  const nearCandidates = useMemo(() => candidates.filter((c) => c.distance <= 15), [candidates]);
  const farCandidates = useMemo(() => candidates.filter((c) => c.distance > 15).slice(0, 10), [candidates]);

  const [showNear, setShowNear] = useState(true);
  const [showFar, setShowFar] = useState(true);

  // Directional arrow from reference system to target (same logic as expansion scouting page)
  function directionIndicator(target: { x: number; y: number; z: number }): string {
    if (!refCoords) return '';
    const dx = target.x - refCoords.x;
    const dz = target.z - refCoords.z;
    const dy = target.y - refCoords.y;
    const dist2d = Math.sqrt(dx * dx + dz * dz);

    if (dist2d < 0.5) {
      if (Math.abs(dy) < 0.5) return '';
      return dy > 0 ? '\u2295' : '\u2296';
    }

    const angle = Math.atan2(dx, dz) * (180 / Math.PI);
    const norm = ((angle % 360) + 360) % 360;

    let arrow: string;
    if (norm < 22.5 || norm >= 337.5) arrow = '\u2191';
    else if (norm < 67.5) arrow = '\u2197';
    else if (norm < 112.5) arrow = '\u2192';
    else if (norm < 157.5) arrow = '\u2198';
    else if (norm < 202.5) arrow = '\u2193';
    else if (norm < 247.5) arrow = '\u2199';
    else if (norm < 292.5) arrow = '\u2190';
    else arrow = '\u2196';

    const plane = Math.abs(dy) >= 1 ? (dy > 0 ? '\u207A' : '\u207B') : '';
    return arrow + plane;
  }

  if (!refCoords) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>System coordinates not available. Sync journals on the Dashboard to populate coordinate data, or score this colony via "Score Colonies".</p>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-3xl mb-3">{'\u{1F50D}'}</p>
        <p className="font-medium text-foreground mb-1">No scored candidates within 50 ly</p>
        <p className="text-sm">
          Use the Expansion page to scout nearby systems first. Scored systems will appear here automatically.
        </p>
      </div>
    );
  }

  function renderRow(c: NearbyCandidate, i: number) {
    const s = c.scouted;
    const source = s.fromJournal ? 'Journal' : s.spanshBodyCount ? 'Spansh' : '';
    return (
      <div
        key={s.id64}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border/50"
      >
        {/* Rank */}
        <span className="text-muted-foreground text-xs w-5 text-right shrink-0">{i + 1}.</span>

        {/* Score */}
        <span className={`text-lg font-bold w-10 text-right shrink-0 tabular-nums ${scoreColor(s.score.total)}`}>
          {s.score.total}
        </span>

        {/* Favorite indicator */}
        <span className="w-4 shrink-0 text-center">
          {s.isFavorite && <span className="text-yellow-400 text-xs">{'\u2605'}</span>}
        </span>

        {/* System name + body string */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium text-foreground truncate"
              title={s.name}
            >
              {s.name}
            </span>
            {source && (
              <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">{source}</span>
            )}
          </div>
          {s.bodyString && (
            <div className="text-xs text-muted-foreground truncate mt-0.5" title={s.bodyString}>
              {s.bodyString}
            </div>
          )}
        </div>

        {/* Distance + direction */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {c.distance.toFixed(1)} ly
          </span>
          <span className="text-xs opacity-70 w-4 text-center" title="Direction from reference (\u2191=toward galaxy center, \u2193=away, \u207A=above plane, \u207B=below)">
            {directionIndicator(c.coords)}
          </span>
        </div>

        {/* Score breakdown mini */}
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/70 shrink-0">
          {s.score.hasOxygenAtmosphere && <span title="Oxygen atmosphere">{'\u{1F7E2}'}</span>}
          {s.score.hasRingedLandable && <span title="Ringed landable">{'\u{1F48D}'}</span>}
          {s.score.atmosphereCount > 0 && (
            <span title={`${s.score.atmosphereCount} atmospheric bodies`}>
              {'\u{1F32B}\u{FE0F}'}{s.score.atmosphereCount}
            </span>
          )}
          {s.score.bodyCount > 0 && (
            <span title={`${s.score.bodyCount} qualifying bodies`}>
              {'\u25C9'}{s.score.bodyCount}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Within 15ly — single hop colonization range */}
      {nearCandidates.length > 0 ? (
        <div className="mb-4">
          <button
            onClick={() => setShowNear((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-green-400 mb-2 hover:text-green-300 transition-colors"
          >
            <span className="text-xs">{showNear ? '\u25BE' : '\u25B8'}</span>
            Within 15ly — single hop ({nearCandidates.length})
          </button>
          {showNear && (
            <div className="space-y-1">
              {nearCandidates.map((c, i) => renderRow(c, i))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-4">No scored candidates within 15ly single-hop range.</p>
      )}

      {/* Beyond 15ly — top 10 by score */}
      {farCandidates.length > 0 && (
        <div>
          <button
            onClick={() => setShowFar((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-sky-400 mb-2 hover:text-sky-300 transition-colors"
          >
            <span className="text-xs">{showFar ? '\u25BE' : '\u25B8'}</span>
            Beyond 15ly — top {farCandidates.length} by score
          </button>
          {showFar && (
            <div className="space-y-1">
              {farCandidates.map((c, i) => renderRow(c, i))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
