import { useState, useMemo, useRef } from 'react';
import { SystemAdvancementCard, type SystemCardData } from './SystemAdvancementCard';
import { getSystemTierFromPoints } from './tierUtils';
import { useAppStore } from '@/store';
import type { ScoutedSystemData } from '@/store/types';

const SOL = { x: 0, y: 0, z: 0 };
function dist3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

interface SystemCardsGridProps {
  colonizedSystems: SystemCardData[];
  tonnageBySystem: Record<string, number>;
  scoutedSystems: Record<number, ScoutedSystemData>;
  knownSystemBodyCounts: Record<string, number | undefined>;
  /** Score Colonies button handler + progress */
  onScoreColonies: () => void;
  scoringProgress: { done: number; total: number } | null;
  onStopScoring: () => void;
  allScored: boolean;
  unscoredCount: number;
  /** Add system */
  onAddSystem: (name: string) => void;
  /** Remove manual system */
  onRemoveManual: (name: string) => void;
}

type SortKey = 'tier' | 'score' | 'population' | 'system' | 'visited';

export function SystemCardsGrid({
  colonizedSystems,
  tonnageBySystem,
  scoutedSystems,
  knownSystemBodyCounts,
  onScoreColonies,
  scoringProgress,
  onStopScoring,
  allScored,
  unscoredCount,
  onAddSystem,
  onRemoveManual,
}: SystemCardsGridProps) {
  const knownSystems = useAppStore((s) => s.knownSystems);
  const settings = useAppStore((s) => s.settings);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const currentSystemName = commanderPosition?.systemName?.toLowerCase() ?? '';

  const homeCoords = useMemo(() => {
    if (!settings.homeSystem) return null;
    return knownSystems[settings.homeSystem.toLowerCase()]?.coordinates || null;
  }, [settings.homeSystem, knownSystems]);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('tier');
  const [newSystemName, setNewSystemName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = colonizedSystems;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.systemName.toLowerCase().includes(q));
    }

    // Sort
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'tier': {
          const tierA = getSystemTierFromPoints(a.totalInstalled, a.t2Points, a.t3Points).tier;
          const tierB = getSystemTierFromPoints(b.totalInstalled, b.t2Points, b.t3Points).tier;
          if (tierB !== tierA) return tierB - tierA;
          if (b.totalInstalled !== a.totalInstalled) return b.totalInstalled - a.totalInstalled;
          return (b.scoutScore ?? 0) - (a.scoutScore ?? 0);
        }
        case 'score':
          return (b.scoutScore ?? -1) - (a.scoutScore ?? -1);
        case 'population':
          return (b.population ?? 0) - (a.population ?? 0);
        case 'system':
          return a.systemName.localeCompare(b.systemName);
        case 'visited':
          return (b.lastVisited ?? '').localeCompare(a.lastVisited ?? '');
        default:
          return 0;
      }
    });
  }, [colonizedSystems, search, sortKey]);

  const handleAdd = () => {
    const name = newSystemName.trim();
    if (name) {
      onAddSystem(name);
      setNewSystemName('');
    }
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-muted-foreground">
          {'\u{1F30D}'} Colonized Systems ({colonizedSystems.length})
        </h3>
        <div className="flex items-center gap-2">
          {scoringProgress ? (
            <>
              <span className="text-xs text-muted-foreground">
                Scoring {scoringProgress.done}/{scoringProgress.total}...
              </span>
              <button
                onClick={onStopScoring}
                className="px-3 py-1 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 transition-colors"
              >
                Stop
              </button>
            </>
          ) : (
            <button
              onClick={onScoreColonies}
              className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors"
            >
              {allScored
                ? `Rescore All (${colonizedSystems.length})`
                : `Score Colonies (${unscoredCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Controls: search + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {colonizedSystems.length > 3 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search systems..."
            className="flex-1 max-w-xs bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        )}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Sort:</span>
          {(['tier', 'score', 'population', 'system', 'visited'] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                sortKey === key
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {key === 'tier' ? 'Tier' : key === 'score' ? 'Score' : key === 'population' ? 'Pop' : key === 'system' ? 'Name' : 'Visited'}
            </button>
          ))}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((sys) => {
          const bodyCount = knownSystemBodyCounts[sys.systemName];
          const ks = knownSystems[sys.systemName.toLowerCase()];
          const sysAddr = ks?.systemAddress;
          const scoutCoords = sysAddr ? scoutedSystems[sysAddr]?.coordinates : undefined;
          const coords = ks?.coordinates || scoutCoords;
          const dSol = coords ? dist3d(coords, SOL) : undefined;
          const dHome = coords && homeCoords ? dist3d(coords, homeCoords) : undefined;
          return (
            <SystemAdvancementCard
              key={sys.systemName}
              system={sys}
              tonnage={tonnageBySystem[sys.systemName] || 0}
              bodyCount={bodyCount}
              distFromSol={dSol}
              distFromHome={dHome}
              homeSystemName={settings.homeSystem || undefined}
              onRemoveManual={sys.isManual && sys.allProjects.length === 0 ? () => onRemoveManual(sys.systemName) : undefined}
              isCurrentSystem={sys.systemName.toLowerCase() === currentSystemName}
            />
          );
        })}
      </div>

      {/* Add system */}
      <div className="flex gap-2 mt-4">
        <input
          ref={inputRef}
          type="text"
          value={newSystemName}
          onChange={(e) => setNewSystemName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add colonized system..."
          className="flex-1 max-w-sm bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <button
          onClick={handleAdd}
          disabled={!newSystemName.trim()}
          className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          + Add System
        </button>
      </div>
    </div>
  );
}
