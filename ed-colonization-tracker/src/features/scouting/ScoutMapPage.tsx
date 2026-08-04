/**
 * Popped-out scout map (/scout-map) — the Expansion page's live map in its own tab, for a
 * second monitor while the scout runner grinds. The search skeleton (which systems, where)
 * arrives via a localStorage snapshot written at pop-out time; SCORES come live from the
 * synced store, so blips keep lighting up here as the scouting tab (or any device) lands
 * them — the store rehydrates on state_updated SSE. Clicking a blip opens its System View
 * in another tab.
 */
import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { ScoutMap, SCOUT_MAP_SNAPSHOT_KEY, type MapPoint, type ScoutMapSnapshot } from './ScoutMap';

function readSnapshot(): ScoutMapSnapshot | null {
  try {
    const raw = localStorage.getItem(SCOUT_MAP_SNAPSHOT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as ScoutMapSnapshot;
    if (!j || !j.ref || !Array.isArray(j.systems)) return null;
    return j;
  } catch { return null; }
}

export function ScoutMapPage() {
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const snap = useMemo(readSnapshot, []);

  const points: MapPoint[] = useMemo(() => {
    if (!snap) return [];
    return snap.systems.map((b) => {
      const sd = scoutedSystems[b.id64];
      return {
        id64: b.id64,
        name: b.name,
        x: b.x, y: b.y, z: b.z,
        scored: !!sd && sd.score.total >= 0 && !!sd.scoutedAt,
        score: sd?.score.total,
        epic: !!sd?.score.epicView?.isEpic,
      };
    });
  }, [snap, scoutedSystems]);

  const scoredCount = points.filter((p) => p.scored).length;
  // Hoisted above the early return — hooks must run unconditionally.
  const prescouted = useMemo(() => new Set<number>(snap?.prescoutedIds || []), [snap]);

  if (!snap) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-muted-foreground">
        <div className="text-center max-w-md px-4">
          <div className="text-4xl mb-4">🗺️</div>
          <div className="text-lg">No scout snapshot yet</div>
          <div className="text-sm mt-2">Open the map from the Expansion page (🗺 Map → ↗ pop out) after a search.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-4 py-3">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="text-sm font-bold tracking-widest" style={{ color: '#ffb347' }}>
          🗺 SCOUT MAP — {snap.ref.name}
        </div>
        <div className="text-xs text-muted-foreground">
          {scoredCount} / {points.length} scored · live — blips light up as any device scores them · click a blip for System View
        </div>
      </div>
      <ScoutMap
        points={points}
        refCoords={snap.ref.coords}
        prescoutedIds={prescouted}
        tall
        onPick={(id64) => {
          const p = points.find((x) => x.id64 === id64);
          if (!p) return;
          let url = `/system-view?system=${encodeURIComponent(p.name)}`;
          try {
            const t = sessionStorage.getItem('colony-token');
            if (t) url += `&token=${t}`;
          } catch { /* no token context */ }
          window.open(url, '_blank', 'noreferrer');
        }}
      />
    </div>
  );
}
