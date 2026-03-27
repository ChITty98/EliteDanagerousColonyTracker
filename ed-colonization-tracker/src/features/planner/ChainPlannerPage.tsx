import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { searchNearbySystems } from '@/services/spanshApi';
import {
  findChainPaths,
  resolveSystem,
  type ChainPath,
  type ChainNode,
  type PathfinderProgress,
  type LocalSystemData,
} from '@/lib/pathfinder';

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export function ChainPlannerPage() {
  const allProjects = useAppStore((s) => s.projects);
  const manualColonizedSystems = useAppStore((s) => s.manualColonizedSystems);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const upsertScoutedSystem = useAppStore((s) => s.upsertScoutedSystem);
  const systemAddressMap = useAppStore((s) => s.systemAddressMap);
  const journalExplorationCache = useAppStore((s) => s.journalExplorationCache);

  // Input state
  const [targetName, setTargetName] = useState('');
  const [startSystemId, setStartSystemId] = useState<string>('auto');
  const [customStartName, setCustomStartName] = useState('');
  const [maxHops, setMaxHops] = useState(3);

  // Resolved target for distance preview
  const [resolvedTarget, setResolvedTarget] = useState<{
    name: string; id64: number; x: number; y: number; z: number;
  } | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const resolveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress state
  const [progress, setProgress] = useState<PathfinderProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Results
  const [paths, setPaths] = useState<ChainPath[]>([]);
  const [error, setError] = useState('');
  const [expandedPath, setExpandedPath] = useState<number | null>(null);

  // Preview route (lightweight stepping stones)
  type PreviewStep = { name: string; x: number; y: number; z: number; bodyCount: number; distance: number; population: number };
  const [previewSteps, setPreviewSteps] = useState<PreviewStep[] | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Colony systems with resolved coordinates
  const [colonySystems, setColonySystems] = useState<
    { name: string; id64: number; x: number; y: number; z: number }[]
  >([]);
  const [resolvingCoords, setResolvingCoords] = useState(false);

  // Try to resolve a system name locally from knownSystems first, then fall back to Spansh
  const resolveLocalFirst = useCallback(async (name: string) => {
    const kb = knownSystems[name.toLowerCase()];
    if (kb?.coordinates && kb.systemAddress) {
      return { name: kb.name || name, id64: kb.systemAddress, x: kb.coordinates.x, y: kb.coordinates.y, z: kb.coordinates.z };
    }
    // Fall back to Spansh
    return resolveSystem(name);
  }, [knownSystems]);

  // Gather MY colony id64s (projects + manual) — these appear in the dropdown
  // Resolves coordinates from knownSystems (journal) and scoutedSystems (cached from scouting) — no network calls
  const myColonyEntries = useMemo(() => {
    const entries: { name: string; id64: number; x?: number; y?: number; z?: number }[] = [];
    const seenIds = new Set<number>();

    // Helper: resolve id64 from multiple sources
    const resolveId64 = (name: string, projectAddr?: number | null): number | null => {
      if (projectAddr) return projectAddr;
      const kb = knownSystems[name.toLowerCase()];
      if (kb?.systemAddress) return kb.systemAddress;
      // Check systemAddressMap (reverse lookup)
      for (const [addr, mappedName] of Object.entries(systemAddressMap)) {
        if (mappedName.toLowerCase() === name.toLowerCase()) return Number(addr);
      }
      // Check scoutedSystems by name
      for (const sd of Object.values(scoutedSystems)) {
        if (sd.name.toLowerCase() === name.toLowerCase()) return sd.id64;
      }
      return null;
    };

    // From projects (my active/completed colonisation projects)
    for (const p of allProjects) {
      const name = p.systemName || p.name;
      const id64 = resolveId64(name, p.systemAddress);
      if (!id64 || seenIds.has(id64)) continue;
      seenIds.add(id64);
      const kb = knownSystems[name.toLowerCase()];
      const coords = kb?.coordinates || scoutedSystems[id64]?.coordinates;
      entries.push({ name, id64, x: coords?.x, y: coords?.y, z: coords?.z });
    }

    // From manual colonized systems (ones I've explicitly added)
    for (const name of manualColonizedSystems) {
      const id64 = resolveId64(name);
      if (!id64 || seenIds.has(id64)) continue;
      seenIds.add(id64);
      const kb = knownSystems[name.toLowerCase()];
      const coords = kb?.coordinates || scoutedSystems[id64]?.coordinates;
      entries.push({ name, id64, x: coords?.x, y: coords?.y, z: coords?.z });
    }

    return entries;
  }, [allProjects, manualColonizedSystems, knownSystems, scoutedSystems, systemAddressMap]);

  // Gather ALL colony id64s (including scouted) — used for pathfinding chain validation
  const colonyEntries = useMemo(() => {
    const entries = [...myColonyEntries];
    const seenIds = new Set(entries.map((e) => e.id64));

    // From scouted systems marked as colonised (other commanders' colonies)
    for (const [id64Str, sd] of Object.entries(scoutedSystems)) {
      if (!sd.isColonised) continue;
      const id64 = Number(id64Str);
      if (seenIds.has(id64)) continue;
      seenIds.add(id64);

      const kb = knownSystems[sd.name.toLowerCase()];
      const coords = kb?.coordinates || sd.coordinates;
      entries.push({ name: sd.name, id64, x: coords?.x, y: coords?.y, z: coords?.z });
    }

    return entries;
  }, [myColonyEntries, knownSystems, scoutedSystems]);

  // My colonies with resolved coordinates (for dropdown)
  const [myColonySystems, setMyColonySystems] = useState<
    { name: string; id64: number; x: number; y: number; z: number }[]
  >([]);

  // Build colony systems from local data only (no auto-Spansh calls)
  // Coordinates come from knownSystems (journal) and scoutedSystems (cached from scouting)
  useEffect(() => {
    const haveCoords = colonyEntries.filter((e) => e.x !== undefined) as {
      name: string; id64: number; x: number; y: number; z: number;
    }[];
    const missingCount = colonyEntries.length - haveCoords.length;

    setColonySystems(haveCoords);
    setResolvingCoords(false);

    // Also partition my colonies
    const myIds = new Set(myColonyEntries.map((e) => e.id64));
    setMyColonySystems(
      haveCoords.filter((s) => myIds.has(s.id64)).sort((a, b) => a.name.localeCompare(b.name)),
    );

    if (missingCount > 0) {
      console.log(`[ChainPlanner] ${missingCount} colony system(s) missing coordinates — visit them in-game or use Find Route to resolve on demand`);
    }
  }, [colonyEntries, myColonyEntries]);

  // Try local resolution of target system name (debounced, no network calls)
  // Falls back to Spansh only when user clicks Find Route or Preview
  useEffect(() => {
    if (resolveTimeoutRef.current) clearTimeout(resolveTimeoutRef.current);
    const name = targetName.trim();
    if (!name || name.length < 3) {
      setResolvedTarget(null);
      setResolveError('');
      return;
    }

    resolveTimeoutRef.current = setTimeout(() => {
      // Check knownSystems (journal data) first
      const kb = knownSystems[name.toLowerCase()];
      if (kb?.coordinates && kb.systemAddress) {
        setResolvedTarget({
          name: kb.systemName || name,
          id64: kb.systemAddress,
          x: kb.coordinates.x,
          y: kb.coordinates.y,
          z: kb.coordinates.z,
        });
        setResolveError('');
        return;
      }

      // Check scoutedSystems (expansion scouting cache)
      for (const sd of Object.values(scoutedSystems)) {
        if (sd.name.toLowerCase() === name.toLowerCase() && sd.coordinates) {
          setResolvedTarget({
            name: sd.name,
            id64: sd.id64,
            x: sd.coordinates.x,
            y: sd.coordinates.y,
            z: sd.coordinates.z,
          });
          setResolveError('');
          return;
        }
      }

      // Not found locally — will resolve via Spansh when user clicks a button
      setResolvedTarget(null);
      setResolveError('');
    }, 300);

    return () => {
      if (resolveTimeoutRef.current) clearTimeout(resolveTimeoutRef.current);
    };
  }, [targetName, knownSystems, scoutedSystems]);

  // Compute distance info for the selected start system and resolved target
  const distanceInfo = useMemo(() => {
    if (!resolvedTarget || colonySystems.length === 0) return null;

    let startSys: { name: string; x: number; y: number; z: number };

    if (startSystemId === 'auto') {
      // Auto picks the nearest colony to the target (most likely to form a viable chain)
      const sorted = [...colonySystems].sort(
        (a, b) => distance3d(a, resolvedTarget) - distance3d(b, resolvedTarget),
      );
      startSys = sorted[0];
    } else {
      const found = colonySystems.find((s) => s.id64.toString() === startSystemId);
      if (!found) return null;
      startSys = found;
    }

    const dist = distance3d(startSys, resolvedTarget);
    const minHops = Math.max(1, Math.ceil(dist / 15));

    return {
      startName: startSys.name,
      distance: dist,
      minHops,
      feasible: minHops <= maxHops,
    };
  }, [resolvedTarget, colonySystems, startSystemId, maxHops, customStartName]);

  const handleFindPaths = useCallback(async () => {
    const target = targetName.trim();
    if (!target) return;

    setIsRunning(true);
    setError('');
    setPaths([]);
    setExpandedPath(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Use already-resolved target if available, otherwise resolve now
      let targetSys = resolvedTarget;
      if (!targetSys) {
        setProgress({
          phase: 'resolving',
          currentHop: 0,
          totalHops: maxHops,
          systemsSearched: 0,
          systemsScored: 0,
          message: 'Resolving target system...',
        });

        targetSys = await resolveLocalFirst(target);
        if (!targetSys) {
          setError(`Could not resolve system "${target}" — check spelling`);
          setIsRunning(false);
          setProgress(null);
          return;
        }
      }

      // Determine start system
      let startSys: { id64: number; name: string; x: number; y: number; z: number };

      if (startSystemId === 'custom') {
        const customName = customStartName.trim();
        if (!customName) {
          setError('Enter a start system name');
          setIsRunning(false);
          setProgress(null);
          return;
        }
        setProgress({
          phase: 'resolving',
          currentHop: 0,
          totalHops: maxHops,
          systemsSearched: 0,
          systemsScored: 0,
          message: `Resolving start system "${customName}"...`,
        });
        const resolved = await resolveLocalFirst(customName);
        if (!resolved) {
          setError(`Could not resolve start system "${customName}" — check spelling`);
          setIsRunning(false);
          setProgress(null);
          return;
        }
        startSys = resolved;
      } else if (startSystemId === 'auto' && colonySystems.length > 0) {
        // Pick the nearest colony to target (most viable chain starting point)
        const sorted = [...colonySystems].sort(
          (a, b) => distance3d(a, targetSys) - distance3d(b, targetSys),
        );
        startSys = sorted[0];
      } else if (startSystemId !== 'auto') {
        const found = colonySystems.find((s) => s.id64.toString() === startSystemId);
        if (!found) {
          setError('Selected start system not found');
          setIsRunning(false);
          setProgress(null);
          return;
        }
        startSys = found;
      } else {
        setError('No colonized systems with coordinates found. Use "Custom system..." or sync from journal first.');
        setIsRunning(false);
        setProgress(null);
        return;
      }

      setProgress({
        phase: 'searching',
        currentHop: 0,
        totalHops: maxHops,
        systemsSearched: 0,
        systemsScored: 0,
        message: `Pathfinding: ${startSys.name} → ${targetSys.name} (${distance3d(startSys, targetSys).toFixed(1)}ly, min ${Math.ceil(distance3d(startSys, targetSys) / 15)} hops)...`,
      });

      // Run pathfinder — pass local data for journal-first operation
      const localData: LocalSystemData = {
        knownSystems,
        journalCache: journalExplorationCache,
        scoutedSystems,
      };
      const results = await findChainPaths(
        startSys,
        targetSys,
        maxHops,
        setProgress,
        abort.signal,
        localData,
      );

      setPaths(results);
      if (results.length === 0 && !abort.signal.aborted) {
        const dist = distance3d(startSys, targetSys);
        const minH = Math.ceil(dist / 15);
        setError(
          `No viable paths found from ${startSys.name} to ${targetSys.name}. ` +
          `Distance: ${dist.toFixed(1)}ly (min ${minH} hops needed). ` +
          (minH > maxHops
            ? `Increase max hops to at least ${minH}.`
            : 'No routes found through this region. Try a different start colony closer to the target.'),
        );
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Pathfinding failed');
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [targetName, startSystemId, customStartName, maxHops, colonySystems, resolvedTarget, resolveLocalFirst]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // Lightweight preview: greedy hop-by-hop picking best stepping stone (no scoring)
  const handlePreviewRoute = useCallback(async () => {
    const targetTrimmed = targetName.trim();
    if (!targetTrimmed) return;
    if (startSystemId !== 'custom' && colonySystems.length === 0) return;

    setIsPreviewing(true);
    setPreviewSteps(null);
    setError('');

    try {
      // Resolve target (use cached if available, otherwise resolve now — user explicitly clicked)
      let target = resolvedTarget;
      if (!target) {
        const resolved = await resolveLocalFirst(targetTrimmed);
        if (!resolved) {
          setError(`Could not resolve "${targetTrimmed}" — check spelling`);
          setIsPreviewing(false);
          return;
        }
        target = resolved;
        setResolvedTarget(resolved);
      }

      // Pick start system (same logic as full search)
      let startSys: { name: string; x: number; y: number; z: number };
      if (startSystemId === 'custom') {
        const customName = customStartName.trim();
        if (!customName) { setError('Enter a start system name'); setIsPreviewing(false); return; }
        const resolved = await resolveLocalFirst(customName);
        if (!resolved) { setError(`Could not resolve "${customName}"`); setIsPreviewing(false); return; }
        startSys = resolved;
      } else if (startSystemId === 'auto') {
        const sorted = [...colonySystems].sort(
          (a, b) => distance3d(a, target) - distance3d(b, target),
        );
        startSys = sorted[0];
      } else {
        const found = colonySystems.find((s) => s.id64.toString() === startSystemId);
        if (!found) { setError('Start system not found'); setIsPreviewing(false); return; }
        startSys = found;
      }

      const steps: PreviewStep[] = [
        { name: startSys.name, x: startSys.x, y: startSys.y, z: startSys.z, bodyCount: 0, distance: 0, population: 0 },
      ];

      let current = startSys;
      const visitedNames = new Set<string>([startSys.name.toLowerCase()]);
      const limit = maxHops + 2; // safety cap

      for (let hop = 0; hop < limit; hop++) {
        const distToTarget = distance3d(current, target);

        // If target is within 15ly, we're done
        if (distToTarget <= 15) {
          steps.push({
            name: target.name,
            x: target.x, y: target.y, z: target.z,
            bodyCount: 0,
            distance: distToTarget,
            population: 0,
          });
          break;
        }

        // Search nearby systems
        const nearby = await searchNearbySystems(current, 15);

        // Filter: must make forward progress, not visited
        const candidates = nearby
          .filter((s) => {
            if (visitedNames.has(s.name.toLowerCase())) return false;
            const d = distance3d(s, target);
            return d < distToTarget; // must get closer
          })
          // Rank by: balance of progress toward target + body count
          .map((s) => ({
            ...s,
            distToTarget: distance3d(s, target),
            progress: distToTarget - distance3d(s, target),
          }))
          // Prioritize systems that make good progress AND have decent bodies
          .sort((a, b) => {
            // Score: progress * (1 + log(body_count))
            const scoreA = a.progress * (1 + Math.log2(Math.max(1, a.body_count)));
            const scoreB = b.progress * (1 + Math.log2(Math.max(1, b.body_count)));
            return scoreB - scoreA;
          });

        if (candidates.length === 0) {
          setError(`Preview stalled at ${current.name} — no systems within 15ly make progress toward target.`);
          break;
        }

        const best = candidates[0];
        steps.push({
          name: best.name,
          x: best.x, y: best.y, z: best.z,
          bodyCount: best.body_count,
          distance: distance3d(current, best),
          population: best.population,
        });

        visitedNames.add(best.name.toLowerCase());
        current = best;
      }

      setPreviewSteps(steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  }, [targetName, resolvedTarget, colonySystems, startSystemId, customStartName, maxHops, resolveLocalFirst]);

  // Group paths by hop count
  const pathsByHops = useMemo(() => {
    const groups = new Map<number, ChainPath[]>();
    for (const p of paths) {
      const list = groups.get(p.hops) ?? [];
      list.push(p);
      groups.set(p.hops, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [paths]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">{'\u{1F5FA}\u{FE0F}'} Colony Chain Planner</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Find multi-hop routes to distant targets, then score only the systems on viable paths.
        Each hop must be within 15ly.
      </p>

      {/* Input Section */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Target system */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Target System</label>
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleFindPaths()}
              placeholder="e.g. Colonia"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              disabled={isRunning}
            />
            {isResolving && (
              <p className="text-xs text-sky-400 mt-1">Resolving...</p>
            )}
            {resolveError && (
              <p className="text-xs text-red-400 mt-1">{resolveError}</p>
            )}
            {resolvedTarget && !isResolving && (
              <p className="text-xs text-green-400 mt-1">
                {'\u2713'} {resolvedTarget.name}
              </p>
            )}
            {!resolvedTarget && !isResolving && !resolveError && targetName.trim().length >= 3 && (
              <p className="text-xs text-muted-foreground mt-1">
                Will resolve via Spansh when searching
              </p>
            )}
          </div>

          {/* Start system */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Start From</label>
            <select
              value={startSystemId}
              onChange={(e) => {
                setStartSystemId(e.target.value);
                if (e.target.value !== 'custom') setCustomStartName('');
              }}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              disabled={isRunning}
            >
              <option value="auto">Auto (nearest colony)</option>
              {myColonySystems.length > 0 && (
                <optgroup label="My Colonies">
                  {myColonySystems.map((sys) => (
                    <option key={sys.id64} value={sys.id64.toString()}>
                      {sys.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="custom">Custom system...</option>
            </select>
            {startSystemId === 'custom' && (
              <input
                type="text"
                value={customStartName}
                onChange={(e) => setCustomStartName(e.target.value)}
                placeholder="Enter system name"
                className="w-full mt-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                disabled={isRunning}
              />
            )}
            {resolvingCoords && (
              <p className="text-xs text-sky-400 mt-1">
                Resolving colony coordinates...
              </p>
            )}
            {!resolvingCoords && myColonySystems.length === 0 && startSystemId !== 'custom' && (
              <p className="text-xs text-yellow-400 mt-1">
                No colonies found. Use "Custom system..." or sync from journal first.
              </p>
            )}
          </div>

          {/* Max hops */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Max Hops: {maxHops}
            </label>
            <input
              type="range"
              min={1}
              max={15}
              value={maxHops}
              onChange={(e) => setMaxHops(Number(e.target.value))}
              className="w-full mt-2"
              disabled={isRunning}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>15</span>
            </div>
          </div>
        </div>

        {/* Distance preview info bar */}
        {distanceInfo && (
          <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-3 flex-wrap ${
            distanceInfo.feasible
              ? 'bg-green-500/10 border border-green-500/20 text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
            <span className="font-medium">
              {distanceInfo.startName} {'\u2192'} {resolvedTarget!.name}
            </span>
            <span>{'\u2022'} {distanceInfo.distance.toFixed(1)} ly</span>
            <span>{'\u2022'} Min {distanceInfo.minHops} hop{distanceInfo.minHops !== 1 ? 's' : ''} needed</span>
            {!distanceInfo.feasible && (
              <span className="font-bold">
                {'\u26A0\u{FE0F}'} Increase max hops to at least {distanceInfo.minHops}
              </span>
            )}
            {distanceInfo.feasible && (
              <span className="opacity-70">{'\u2713'} Reachable with {maxHops} max hops</span>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handlePreviewRoute}
            disabled={isRunning || isPreviewing || !targetName.trim() || (startSystemId !== 'custom' && colonySystems.length === 0) || (startSystemId === 'custom' && !customStartName.trim())}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-500 transition-colors disabled:opacity-50"
          >
            {isPreviewing ? 'Previewing...' : '\u{1F441}\u{FE0F} Preview Route'}
          </button>
          <button
            onClick={handleFindPaths}
            disabled={isRunning || isPreviewing || !targetName.trim() || (startSystemId !== 'custom' && colonySystems.length === 0) || (startSystemId === 'custom' && !customStartName.trim()) || (distanceInfo !== null && !distanceInfo.feasible)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {'\u{1F50D}'} Find & Score Paths
          </button>
          {(isRunning || isPreviewing) && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress Section */}
      {progress && isRunning && (
        <div className="bg-card border border-border rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin text-primary">{'\u25C9'}</div>
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">{progress.message}</div>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                <span>Phase: {progress.phase === 'routing' ? 'finding routes' : progress.phase}</span>
                {progress.phase === 'routing' && <span>Hop: {progress.currentHop}/{progress.totalHops}</span>}
                <span>Searched: {progress.systemsSearched}</span>
                {progress.systemsScored > 0 && <span>Scored: {progress.systemsScored}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Preview Route */}
      {previewSteps && previewSteps.length > 1 && (
        <div className="bg-card border border-sky-500/30 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-sky-400 mb-3">
            {'\u{1F441}\u{FE0F}'} Route Preview — {previewSteps.length - 1} hop{previewSteps.length - 1 !== 1 ? 's' : ''} (greedy, unscored)
          </h3>

          {/* Chain visualization */}
          <div className="flex items-center gap-1 flex-wrap mb-4">
            {previewSteps.map((step, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {'\u2192'} <span className="text-[10px]">{step.distance.toFixed(1)}ly</span> {'\u2192'}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  i === 0
                    ? 'bg-blue-500/20 text-blue-400'
                    : i === previewSteps.length - 1
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-secondary/20 text-secondary'
                }`}>
                  {step.name}
                  {step.bodyCount > 0 && (
                    <span className="opacity-60">{step.bodyCount}b</span>
                  )}
                </span>
              </span>
            ))}
          </div>

          {/* Step table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-left py-1 pr-3">#</th>
                  <th className="text-left py-1 pr-3">System</th>
                  <th className="text-right py-1 pr-3">Hop Dist</th>
                  <th className="text-right py-1 pr-3">To Target</th>
                  <th className="text-right py-1">Total Bodies</th>
                </tr>
              </thead>
              <tbody>
                {previewSteps.map((step, i) => {
                  const distToTarget = resolvedTarget ? distance3d(step, resolvedTarget) : 0;
                  return (
                    <tr key={i} className={`border-b border-border/30 ${
                      i === 0 ? 'text-blue-400' : i === previewSteps.length - 1 ? 'text-green-400' : 'text-foreground'
                    }`}>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {i === 0 ? 'S' : i === previewSteps.length - 1 ? 'T' : i}
                      </td>
                      <td className="py-1 pr-3 font-medium">{step.name}</td>
                      <td className="py-1 pr-3 text-right text-muted-foreground">
                        {i === 0 ? '—' : `${step.distance.toFixed(1)}ly`}
                      </td>
                      <td className="py-1 pr-3 text-right text-muted-foreground">
                        {distToTarget.toFixed(1)}ly
                      </td>
                      <td className="py-1 text-right">{step.bodyCount || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground mt-2">
            This is a greedy preview — "Find & Score" finds multiple routes then scores only the systems on viable paths.
          </p>
        </div>
      )}

      {/* Results Section */}
      {paths.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-muted-foreground mb-3">
            {'\u{1F4CD}'} Found {paths.length} path{paths.length !== 1 ? 's' : ''}
          </h3>

          {pathsByHops.map(([hopCount, hopPaths]) => (
            <div key={hopCount} className="mb-6">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                {hopCount} hop{hopCount !== 1 ? 's' : ''} ({hopPaths.length} path{hopPaths.length !== 1 ? 's' : ''})
              </h4>
              <div className="space-y-3">
                {hopPaths.map((path, pi) => {
                  const globalIdx = paths.indexOf(path);
                  const isExpanded = expandedPath === globalIdx;
                  return (
                    <div key={pi} className="bg-card border border-border rounded-lg overflow-hidden">
                      {/* Path summary row */}
                      <button
                        onClick={() => setExpandedPath(isExpanded ? null : globalIdx)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
                      >
                        <span className="text-xs text-muted-foreground shrink-0">#{globalIdx + 1}</span>

                        {/* Chain visualization */}
                        <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                          {path.nodes.map((node, ni) => {
                            const hopDist = ni > 0 ? distance3d(path.nodes[ni - 1], node) : 0;
                            return (
                            <span key={ni} className="flex items-center gap-1">
                              {ni > 0 && (
                                <span className="text-muted-foreground text-xs">
                                  {'\u2192'} <span className="text-[10px]">{hopDist.toFixed(1)}ly</span> {'\u2192'}
                                </span>
                              )}
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                  node.isStart
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : node.isTarget
                                    ? 'bg-green-500/20 text-green-400'
                                    : node.isConnector
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-secondary/20 text-secondary'
                                }`}
                                title={`${node.name}${node.score ? ` — Score: ${node.score.total}` : ''}${node.isConnector ? ' (connector)' : ''}`}
                              >
                                {node.isConnector && '\u{1F517}'}{/* 🔗 */}
                                {node.name}
                                {node.score && !node.isStart && (
                                  <span className="opacity-70">{node.score.total}</span>
                                )}
                              </span>
                            </span>
                            );
                          })}
                        </div>

                        {/* Aggregate score */}
                        <span className={`text-sm font-bold shrink-0 ${
                          path.aggregateScore >= 200 ? 'text-yellow-300' :
                          path.aggregateScore >= 100 ? 'text-progress-complete' :
                          path.aggregateScore >= 50 ? 'text-sky-400' :
                          'text-muted-foreground'
                        }`}>
                          {path.aggregateScore}
                        </span>

                        {path.connectorCount > 0 && (
                          <span className="text-xs text-yellow-400 shrink-0" title="Contains connector hops">
                            {'\u26A0\u{FE0F}'} {path.connectorCount} connector{path.connectorCount > 1 ? 's' : ''}
                          </span>
                        )}

                        <span className="text-muted-foreground text-xs shrink-0">
                          {isExpanded ? '\u25B2' : '\u25BC'}
                        </span>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="border-t border-border px-4 py-3">
                          <div className="space-y-2">
                            {path.nodes.map((node, ni) => (
                              <NodeDetail key={ni} node={node} prevNode={ni > 0 ? path.nodes[ni - 1] : undefined} hopIndex={ni} isLast={ni === path.nodes.length - 1} />
                            ))}
                          </div>
                          <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                            <div className="text-xs text-muted-foreground">
                              {path.hops} hop{path.hops !== 1 ? 's' : ''} {'\u2022'} Aggregate: {path.aggregateScore} {'\u2022'}{' '}
                              {path.nodes[0].name} {'\u2192'} {path.nodes[path.nodes.length - 1].name}
                              {path.connectorCount > 0 && (
                                <span className="text-yellow-400 ml-2">
                                  {'\u26A0\u{FE0F}'} Contains {path.connectorCount} connector hop{path.connectorCount > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                let saved = 0;
                                for (const node of path.nodes) {
                                  if (node.isStart || !node.score) continue;
                                  const existing = scoutedSystems[node.id64];
                                  upsertScoutedSystem({
                                    id64: node.id64,
                                    name: node.name,
                                    score: node.score,
                                    bodyString: node.bodyString,
                                    coordinates: { x: node.x, y: node.y, z: node.z },
                                    isColonised: existing?.isColonised,
                                    isFavorite: existing?.isFavorite,
                                    notes: existing?.notes,
                                    fromJournal: false,
                                    spanshBodyCount: node.totalBodyCount,
                                    scoutedAt: new Date().toISOString(),
                                  });
                                  saved++;
                                }
                                alert(`Saved ${saved} system scores to expansion data`);
                              }}
                              className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors shrink-0"
                              title="Save scored systems from this route to your expansion scouting data"
                            >
                              Save Scores
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No results message */}
      {!isRunning && progress?.phase === 'complete' && paths.length === 0 && !error && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
          <div className="text-3xl mb-2">{'\u{1F6F8}'}</div>
          <p>No viable paths found. Try increasing max hops or choosing a different start system.</p>
        </div>
      )}
    </div>
  );
}

// --- Node Detail Component ---

function NodeDetail({ node, prevNode, hopIndex, isLast }: { node: ChainNode; prevNode?: ChainNode; hopIndex: number; isLast: boolean }) {
  const hopDist = prevNode ? distance3d(prevNode, node) : 0;

  if (node.isStart) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
          S
        </span>
        <span className="font-medium text-blue-400">{node.name}</span>
        <span className="text-xs text-muted-foreground">(Start — existing colony)</span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 text-sm">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        node.isTarget
          ? 'bg-green-500/20 text-green-400'
          : node.isConnector
          ? 'bg-yellow-500/20 text-yellow-400'
          : 'bg-secondary/20 text-secondary'
      }`}>
        {node.isTarget ? 'T' : node.isConnector ? '\u{1F517}' : hopIndex}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium ${node.isTarget ? 'text-green-400' : node.isConnector ? 'text-yellow-400' : 'text-foreground'}`}>
            {node.name}
          </span>
          {hopDist > 0 && (
            <span className="text-xs text-muted-foreground">{hopDist.toFixed(1)}ly</span>
          )}
          {node.score && (
            <span className={`text-xs font-bold ${
              node.score.total >= 100 ? 'text-yellow-300' :
              node.score.total >= 60 ? 'text-progress-complete' :
              node.score.total >= 30 ? 'text-sky-400' :
              'text-muted-foreground'
            }`}>
              Score: {node.score.total}
            </span>
          )}
          {node.isConnector && (
            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">connector</span>
          )}
          {node.isTarget && (
            <span className="text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">target</span>
          )}
          <span className="text-xs text-muted-foreground">
            {node.bodyCount} bod{node.bodyCount !== 1 ? 'ies' : 'y'}
          </span>
          {node.population > 0 && (
            <span className="text-xs text-muted-foreground">
              Pop: {node.population.toLocaleString()}
            </span>
          )}
        </div>
        {node.bodyString && node.bodyString !== '\u2014' && (
          <div className="text-xs mt-1 font-mono text-muted-foreground truncate" title={node.bodyString}>
            {node.bodyString}
          </div>
        )}
        {node.score && (
          <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            {node.score.starPoints > 0 && <span>Stars: {node.score.starPoints}</span>}
            {node.score.atmospherePoints > 0 && <span>Atmo: {node.score.atmospherePoints}</span>}
            {node.score.oxygenPoints > 0 && <span>O{'\u2082'}: {node.score.oxygenPoints}</span>}
            {node.score.ringPoints > 0 && <span>Rings: {node.score.ringPoints}</span>}
            {node.score.proximityPoints > 0 && <span>Prox: {node.score.proximityPoints}</span>}
            {node.score.economyPoints > 0 && <span>Econ: {node.score.economyPoints}</span>}
            {node.score.bodyCountPoints > 0 && <span>Bodies: {node.score.bodyCountPoints}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
