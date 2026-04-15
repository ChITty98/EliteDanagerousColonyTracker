import { useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import {
  searchNearbySystems,
  fetchSystemDump,
  resolveSystemName,
  type SpanshSearchSystem,
  type SpanshDumpBody,
} from '@/services/spanshApi';
import {
  scoreSystem,
  classifyStars,
  filterQualifyingBodies,
  buildBodyString,
  buildBodySegments,
  type ScoreBreakdown,
  type BodySegment,
  type StarInfo,
} from '@/lib/scoutingScorer';
import {
  extractExplorationData,
  journalBodiesToSpanshFormat,
} from '@/services/journalReader';
import { formatRelativeTime, freshnessColor } from '@/lib/utils';

/** Per-body detail shown in expanded view */
interface BodyDetail {
  name: string; // short name (e.g. "A 1")
  subType: string; // e.g. "High metal content world"
  earthMasses: number;
  gravity: number; // g
  atmosphereType: string; // e.g. "Thin Ammonia" or "—"
  surfaceTemp: number; // K
  distanceLs: number;
  economy: string; // classified economy
  hasRings: boolean;
  hasAtmosphere: boolean;
}

/** Per-star detail shown in expanded view */
interface StarDetail {
  name: string;
  subType: string; // e.g. "K (Yellow-Orange) Star"
  spectralClass: string;
  solarMasses: number;
  distanceLs: number;
  scorePoints: number;
  isHazardous: boolean;
}

interface ScoutedSystem {
  search: SpanshSearchSystem;
  score: ScoreBreakdown | null;
  bodyString: string | null;
  bodySegments: BodySegment[] | null;
  bodyDetails: BodyDetail[] | null;
  starDetails: StarDetail[] | null;
  scouted: boolean;
  loading: boolean;
  error: string | null;
}

type SearchPhase = 'idle' | 'resolving' | 'searching' | 'done' | 'error';

export function ScoutingPage() {
  const settings = useAppStore((s) => s.settings);
  const projects = useAppStore((s) => s.projects);
  const manualColonizedSystems = useAppStore((s) => s.manualColonizedSystems);
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const upsertScoutedSystem = useAppStore((s) => s.upsertScoutedSystem);
  const clearScoutedSystems = useAppStore((s) => s.clearScoutedSystems);
  const journalExplorationCache = useAppStore((s) => s.journalExplorationCache);
  const setJournalExplorationCache = useAppStore((s) => s.setJournalExplorationCache);
  const clearJournalExplorationCache = useAppStore((s) => s.clearJournalExplorationCache);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);

  // My colonized systems = systems I've personally colonized (projects + manual additions)
  // Used for the "My systems" quick-select dropdown
  const myColonizedSystems = useMemo(() => {
    const names = new Set<string>();
    for (const p of projects) {
      if (p.systemName) names.add(p.systemName);
    }
    for (const s of manualColonizedSystems) {
      names.add(s);
    }
    return [...names].sort();
  }, [projects, manualColonizedSystems]);

  // All colonized systems = my systems + any visited system with population or stations
  // Used for marking search results as "already colonized" (not expansion candidates)
  const colonizedSystems = useMemo(() => {
    const names = new Set(myColonizedSystems);
    for (const ks of Object.values(knownSystems)) {
      if (ks.population > 0) names.add(ks.systemName);
    }
    for (const st of Object.values(knownStations)) {
      if (st.systemName) names.add(st.systemName);
    }
    return [...names].sort();
  }, [myColonizedSystems, knownSystems, knownStations]);

  const [refSystem, setRefSystem] = useState(settings.homeSystem || '');
  const [searchRadius, setSearchRadius] = useState(15);
  const [maxResults, setMaxResults] = useState(0); // 0 = unlimited
  const [systems, setSystems] = useState<ScoutedSystem[]>([]);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle');
  const [searchError, setSearchError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scoutAllProgress, setScoutAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [sortMode, setSortMode] = useState<'score' | 'distance' | 'bodies'>('score');
  const [refCoords, setRefCoords] = useState<{ x: number; y: number; z: number } | null>(null);
  const abortRef = useRef(false);
  const [journalScanProgress, setJournalScanProgress] = useState<string | null>(null);

  // --- Comparison state ---
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const toggleCompare = useCallback((id64: number) => {
    setCompareIds((prev) => {
      if (prev.includes(id64)) return prev.filter((id) => id !== id64);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, id64];
    });
  }, []);

  // --- Filter state ---
  const [hideColonized, setHideColonized] = useState(true);
  const [bodyCountFilter, setBodyCountFilter] = useState<'all' | 'gt20' | '10to20' | '5to10' | 'lt5'>('all');
  // Source filter: which data sources to show (combinable)
  type SourceFilter = 'journal' | 'journal_complete' | 'spansh' | 'both' | 'none';
  const [sourceFilters, setSourceFilters] = useState<Set<SourceFilter>>(new Set());
  const toggleSourceFilter = useCallback((f: SourceFilter) => {
    setSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  // Backfill isColonised flag — one-time on mount, not on every render
  const backfillDone = useRef(false);
  if (!backfillDone.current && colonizedSystems.length > 0) {
    backfillDone.current = true;
    const colonySet = new Set(colonizedSystems.map((c) => c.toLowerCase()));
    for (const sd of Object.values(scoutedSystems)) {
      if (!sd.isColonised && colonySet.has(sd.name.toLowerCase())) {
        upsertScoutedSystem({ ...sd, isColonised: true });
      }
    }
  }

  // --- Search for nearby systems ---
  const handleSearch = useCallback(async () => {
    if (!refSystem.trim()) return;
    setSearchPhase('resolving');
    setSearchError('');
    setSystems([]);
    setExpandedId(null);

    try {
      const resolved = await resolveSystemName(refSystem.trim());
      if (!resolved) {
        setSearchError(`System "${refSystem}" not found in Spansh database`);
        setSearchPhase('error');
        return;
      }

      setRefCoords({ x: resolved.x, y: resolved.y, z: resolved.z });
      setSearchPhase('searching');
      const results = await searchNearbySystems(
        { x: resolved.x, y: resolved.y, z: resolved.z },
        searchRadius,
        maxResults,
      );

      setTotalCount(results.length);
      // Hydrate from persisted scouting data
      setSystems(
        results.map((s) => {
          const saved = scoutedSystems[s.id64];
          if (saved) {
            // Backfill isColonised flag if not yet set (for data saved before this field existed)
            const isCol =
              s.is_colonised ||
              colonizedSystems.some((c) => c.toLowerCase() === s.name.toLowerCase());
            if (isCol && !saved.isColonised) {
              upsertScoutedSystem({ ...saved, isColonised: true });
            }
            return {
              search: s,
              score: saved.score,
              bodyString: saved.bodyString,
              bodySegments: null, // segments not persisted, computed fresh on scout
              bodyDetails: null, // details not persisted, computed fresh on scout
              starDetails: null,
              scouted: true,
              loading: false,
              error: null,
            };
          }
          return {
            search: s,
            score: null,
            bodyString: null,
            bodySegments: null,
            bodyDetails: null,
            starDetails: null,
            scouted: false,
            loading: false,
            error: null,
          };
        }),
      );
      setSearchPhase('done');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setSearchPhase('error');
    }
  }, [refSystem, searchRadius, maxResults, scoutedSystems, colonizedSystems, upsertScoutedSystem]);

  // --- Scout a single system (score from journal cache or Spansh + persist) ---
  const scoutSystem = useCallback(async (id64: number) => {
    setSystems((prev) =>
      prev.map((s) => (s.search.id64 === id64 ? { ...s, loading: true, error: null } : s)),
    );

    try {
      const searchEntry = systems.find((s) => s.search.id64 === id64);
      const existingScouted = scoutedSystems[id64];
      const journalCached = journalExplorationCache[id64];

      // Try journal cache first (journal-first philosophy)
      let bodies: SpanshDumpBody[] = [];
      let systemName = searchEntry?.search.name || '';
      let fromJournal = false;
      let spanshBodyCount = 0;
      let journalScannedCount = 0;
      let spanshUpdatedAt: string | undefined;

      if (journalCached && journalCached.scannedBodies.length > 0) {
        // We have journal body data — use it as baseline
        const jBodies = journalBodiesToSpanshFormat(journalCached.scannedBodies, journalCached.systemName);
        systemName = journalCached.systemName;
        journalScannedCount = journalCached.scannedBodies.length;

        // Try Spansh too — use whichever has more data
        try {
          const dump = await fetchSystemDump(id64);
          if (dump && dump.bodies && dump.bodies.length > 0) {
            spanshBodyCount = dump.bodies.length;
            spanshUpdatedAt = dump.updateTime || undefined;
            systemName = dump.name || systemName;
            // Spansh preferred when it has same or more bodies (richer multi-CMDR data)
            if (dump.bodies.length >= journalCached.scannedBodies.length) {
              bodies = dump.bodies;
              fromJournal = false;
            } else {
              bodies = jBodies;
              fromJournal = true;
            }
          } else {
            bodies = jBodies;
            fromJournal = true;
          }
        } catch {
          // Spansh failed — use journal data
          bodies = jBodies;
          fromJournal = true;
        }
      } else {
        // No journal body data — fetch from Spansh
        const dump = await fetchSystemDump(id64);
        bodies = dump.bodies ?? [];
        spanshBodyCount = bodies.length;
        spanshUpdatedAt = dump.updateTime || undefined;
        systemName = dump.name || systemName;
        fromJournal = false;
      }

      const score = scoreSystem(bodies);
      const stars = classifyStars(bodies);
      const qualBodies = filterQualifyingBodies(bodies);
      const bodyString = buildBodyString(qualBodies, stars);
      const bodySegments = buildBodySegments(qualBodies, stars);

      // Build per-body detail for expanded view
      const bodyDetails: BodyDetail[] = qualBodies
        .sort((a, b) => a.distanceLs - b.distanceLs)
        .map((qb) => ({
          name: qb.body.name.replace(systemName + ' ', ''),
          subType: qb.body.subType,
          earthMasses: qb.body.earthMasses ?? 0,
          gravity: qb.body.gravity ?? 0,
          atmosphereType: qb.body.atmosphereType && qb.body.atmosphereType !== 'No atmosphere'
            ? qb.body.atmosphereType
            : '\u2014',
          surfaceTemp: qb.body.surfaceTemperature ?? 0,
          distanceLs: qb.distanceLs,
          economy: qb.economy,
          hasRings: qb.hasRings,
          hasAtmosphere: qb.hasAtmosphere,
        }));

      const starDetailsList: StarDetail[] = stars.map((s) => ({
        name: s.name.replace(systemName + ' ', '') || s.name,
        subType: s.subType,
        spectralClass: bodies.find((b) => b.bodyId === s.bodyId)?.spectralClass ?? '',
        solarMasses: bodies.find((b) => b.bodyId === s.bodyId)?.solarMasses ?? 0,
        distanceLs: bodies.find((b) => b.bodyId === s.bodyId)?.distanceToArrival ?? 0,
        scorePoints: s.scorePoints,
        isHazardous: s.isHazardous,
      }));

      // Check if system is colonised
      const isColonised =
        searchEntry?.search.is_colonised ||
        colonizedSystems.some((c) => c.toLowerCase() === systemName.toLowerCase());

      // Persist scored result
      const coords = searchEntry?.search
        ? { x: searchEntry.search.x, y: searchEntry.search.y, z: searchEntry.search.z }
        : journalCached?.coordinates || existingScouted?.coordinates;
      upsertScoutedSystem({
        id64,
        name: systemName,
        score,
        bodyString,
        coordinates: coords,
        isColonised,
        isFavorite: existingScouted?.isFavorite,
        notes: existingScouted?.notes,
        fromJournal,
        spanshBodyCount,
        spanshUpdatedAt,
        journalBodyCount: journalCached?.bodyCount,
        journalScannedCount,
        fssAllBodiesFound: journalCached?.fssAllBodiesFound,
        scoutedAt: new Date().toISOString(),
      });

      setSystems((prev) =>
        prev.map((s) =>
          s.search.id64 === id64
            ? { ...s, score, bodyString, bodySegments, bodyDetails, starDetails: starDetailsList, scouted: true, loading: false }
            : s,
        ),
      );
    } catch (err) {
      setSystems((prev) =>
        prev.map((s) =>
          s.search.id64 === id64
            ? { ...s, error: err instanceof Error ? err.message : 'Failed', loading: false }
            : s,
        ),
      );
    }
  }, [upsertScoutedSystem, systems, colonizedSystems, scoutedSystems, journalExplorationCache]);

  // --- Toggle favorite on a scouted system ---
  const toggleFavorite = useCallback((id64: number) => {
    const existing = scoutedSystems[id64];
    if (existing) {
      upsertScoutedSystem({ ...existing, isFavorite: !existing.isFavorite });
    }
  }, [scoutedSystems, upsertScoutedSystem]);

  // --- Scout all systems sequentially (rate limited by API client) ---
  // Uses a ref so the callback always reads the latest filtered list
  const filteredRef = useRef<ScoutedSystem[]>([]);

  const scoutAll = useCallback(async () => {
    abortRef.current = false;
    const unscouted = filteredRef.current.filter((s) => !s.scouted && !s.loading);
    setScoutAllProgress({ done: 0, total: unscouted.length });

    for (let i = 0; i < unscouted.length; i++) {
      if (abortRef.current) break;
      await scoutSystem(unscouted[i].search.id64);
      setScoutAllProgress({ done: i + 1, total: unscouted.length });
    }
    setScoutAllProgress(null);
  }, [scoutSystem]);

  const stopScoutAll = useCallback(() => {
    abortRef.current = true;
  }, []);

  // --- Clear journal-only scouted data (preserves favorites/noted) ---
  const clearJournalScores = useCallback(() => {
    const entries = Object.entries(scoutedSystems);
    let cleared = 0;
    const kept: Record<number, typeof scoutedSystems[number]> = {};
    for (const [key, val] of entries) {
      if (val.fromJournal && !val.isFavorite && !val.notes) {
        cleared++;
      } else {
        kept[Number(key)] = val;
      }
    }
    // Replace entire scoutedSystems map — clear then re-add kept entries
    clearScoutedSystems();
    for (const val of Object.values(kept)) {
      upsertScoutedSystem(val);
    }
    clearJournalExplorationCache();
    setJournalScanProgress(`Cleared ${cleared} journal-scouted systems`);
    setTimeout(() => setJournalScanProgress(null), 5000);
  }, [scoutedSystems, clearScoutedSystems, upsertScoutedSystem, clearJournalExplorationCache]);

  // --- Scan journals for exploration data and score non-Spansh systems ---
  const scanJournalsForScouting = useCallback(async () => {
    setJournalScanProgress('Reading journal files...');
    try {
      const explorationData = await extractExplorationData();
      const cache: Record<number, import('@/services/journalReader').JournalExplorationSystem> = {};
      let withBodies = 0;
      let honkOnly = 0;

      for (const sys of explorationData.values()) {
        cache[sys.systemAddress] = sys;
        if (sys.scannedBodies.length > 0) {
          withBodies++;
        } else if (sys.bodyCount > 0) {
          honkOnly++;
        }
      }

      setJournalExplorationCache(cache);
      setJournalScanProgress(`Done: ${withBodies} with body data, ${honkOnly} honk-only (${explorationData.size} total cached)`);
      setTimeout(() => setJournalScanProgress(null), 5000);
    } catch (err) {
      setJournalScanProgress(
        `Error: ${err instanceof Error ? err.message : 'Failed to scan journals'}`,
      );
      setTimeout(() => setJournalScanProgress(null), 8000);
    }
  }, [setJournalExplorationCache]);

  // --- Sort: by selected mode ---
  const sortedSystems = useMemo(() => {
    return [...systems].sort((a, b) => {
      if (sortMode === 'bodies') {
        return (b.search.body_count || 0) - (a.search.body_count || 0);
      }
      if (sortMode === 'distance') {
        return a.search.distance - b.search.distance;
      }
      // Default: score (scouted first, then by score desc, unscouted by distance)
      if (a.scouted && !b.scouted) return -1;
      if (!a.scouted && b.scouted) return 1;
      if (a.score && b.score) return b.score.total - a.score.total;
      return a.search.distance - b.search.distance;
    });
  }, [systems, sortMode]);

  // --- Apply filters ---
  const filteredSystems = useMemo(() => {
    return sortedSystems.filter((sys) => {
      // Hide colonized filter
      if (hideColonized) {
        const isCol =
          sys.search.is_colonised ||
          (sys.search.population && sys.search.population > 0) ||
          colonizedSystems.some((c) => c.toLowerCase() === sys.search.name.toLowerCase());
        if (isCol) return false;
      }
      // Body count filter — use the body count matching the scoring source, with fallbacks
      const saved = scoutedSystems[sys.search.id64];
      const cached = journalExplorationCache[sys.search.id64];
      const bc = saved
        ? (saved.fromJournal
            ? (saved.journalBodyCount || saved.spanshBodyCount || sys.search.body_count || 0)
            : (saved.spanshBodyCount || sys.search.body_count || saved.journalBodyCount || 0))
        : (cached?.bodyCount || sys.search.body_count || 0);
      if (bodyCountFilter === 'gt20' && bc <= 20) return false;
      if (bodyCountFilter === '10to20' && (bc < 10 || bc > 20)) return false;
      if (bodyCountFilter === '5to10' && (bc < 5 || bc > 10)) return false;
      if (bodyCountFilter === 'lt5' && (bc >= 5 || bc === 0)) return false;

      // Source filter — if any source filters are active, system must match at least one
      if (sourceFilters.size > 0) {
        const sd = saved;
        // Classify the system's data source (check both scored data and journal cache)
        const hasJournalCache = !!cached && cached.scannedBodies.length > 0;
        const hasJournalCacheComplete = !!cached && cached.fssAllBodiesFound;
        const isJournal = sd?.fromJournal === true || (!sd && hasJournalCache);
        const isJournalComplete = (sd?.fromJournal === true && sd?.fssAllBodiesFound === true) || (!sd && hasJournalCacheComplete);
        const isSpanshOnly = sd ? sd.fromJournal === false && !sd.fssAllBodiesFound : false;
        // "Both" = has journal data but was also enriched by Spansh (has spanshUpdatedAt)
        const isBoth = (sd?.fromJournal === true && !!sd?.spanshUpdatedAt) || (sd && !sd.fromJournal && hasJournalCache);
        // "None" = no data from either source (not scored, not in journal cache)
        const isNone = !sd && !hasJournalCache;

        let matches = false;
        if (sourceFilters.has('journal') && isJournal && !isJournalComplete) matches = true;
        if (sourceFilters.has('journal_complete') && isJournalComplete) matches = true;
        if (sourceFilters.has('spansh') && isSpanshOnly) matches = true;
        if (sourceFilters.has('both') && isBoth) matches = true;
        if (sourceFilters.has('none') && isNone) matches = true;
        if (!matches) return false;
      }

      return true;
    });
  }, [sortedSystems, hideColonized, bodyCountFilter, sourceFilters, colonizedSystems, scoutedSystems, journalExplorationCache]);

  // Keep filteredRef in sync so scoutAll always uses the latest filtered list
  filteredRef.current = filteredSystems;

  const filteredTotal = filteredSystems.length;
  const filteredScoutedCount = filteredSystems.filter((s) => s.scouted).length;

  // Split into systems with bodies vs without (no-body systems are less interesting)
  // Use journal body count as fallback for systems not well-cataloged in Spansh
  const systemsWithBodies = useMemo(
    () => filteredSystems.filter((s) => {
      const saved = scoutedSystems[s.search.id64];
      const cached = journalExplorationCache[s.search.id64];
      return (s.search.body_count || saved?.journalBodyCount || cached?.bodyCount || 0) > 0;
    }),
    [filteredSystems, scoutedSystems, journalExplorationCache],
  );
  const systemsNoBodies = useMemo(
    () => filteredSystems.filter((s) => {
      const saved = scoutedSystems[s.search.id64];
      return !(s.search.body_count || saved?.journalBodyCount || 0);
    }),
    [filteredSystems, scoutedSystems],
  );
  const [showNoBodies, setShowNoBodies] = useState(false);

  // Collapsible section state
  const [showFavorites, setShowFavorites] = useState(true);
  const [showJournalScan, setShowJournalScan] = useState(true);
  const [showLeaderboards, setShowLeaderboards] = useState(true);

  function scoreColor(total: number): string {
    if (total >= 100) return 'text-yellow-300';
    if (total >= 60) return 'text-progress-complete';
    if (total >= 30) return 'text-sky-400';
    if (total > 0) return 'text-muted-foreground';
    return 'text-muted-foreground/50';
  }

  function scoreBarWidth(total: number): string {
    return `${Math.min(100, (total / 200) * 100)}%`;
  }

  /**
   * Compute a directional indicator from reference system to target system.
   * Galaxy center is "up" from Sol (positive z), x is left/right, y is galactic plane (+/−).
   */
  function directionIndicator(target: { x: number; y: number; z: number }): string {
    if (!refCoords) return '';
    const dx = target.x - refCoords.x; // right (+) / left (−) on galaxy map
    const dz = target.z - refCoords.z; // ED +z = toward Sgr A*, but galaxy map "up" = −z
    const dy = target.y - refCoords.y; // above (+) / below (−) galactic plane
    const dist2d = Math.sqrt(dx * dx + dz * dz);

    // Dead zone — too close to get meaningful direction
    if (dist2d < 0.5) {
      // Only show plane indicator if there's vertical difference
      if (Math.abs(dy) < 0.5) return '';
      return dy > 0 ? '⊕' : '⊖';
    }

    // Compute angle: 0° = up on galaxy map = +z direction (toward Sgr A*), clockwise
    // Galaxy map top-down: "up" = +z (toward galactic center), "right" = +x
    const angle = Math.atan2(dx, dz) * (180 / Math.PI);
    const norm = ((angle % 360) + 360) % 360;

    let arrow: string;
    if (norm < 22.5 || norm >= 337.5) arrow = '↑';
    else if (norm < 67.5) arrow = '↗';
    else if (norm < 112.5) arrow = '→';
    else if (norm < 157.5) arrow = '↘';
    else if (norm < 202.5) arrow = '↓';
    else if (norm < 247.5) arrow = '↙';
    else if (norm < 292.5) arrow = '←';
    else arrow = '↖';

    // Plane indicator
    const plane = Math.abs(dy) >= 1 ? (dy > 0 ? '⁺' : '⁻') : '';

    return arrow + plane;
  }

  // --- Top scouted overall (uncolonised systems only — these are expansion candidates) ---
  const topScoutedAll = useMemo(() => {
    return Object.values(scoutedSystems)
      .filter((sd) =>
        sd.score.total > 0 &&
        !sd.isColonised &&
        !colonizedSystems.some((c) => c.toLowerCase() === sd.name.toLowerCase()),
      )
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 10);
  }, [scoutedSystems, colonizedSystems]);

  // --- Favorite systems ---
  const favoriteSystems = useMemo(() => {
    return Object.values(scoutedSystems)
      .filter((sd) => sd.isFavorite)
      .sort((a, b) => b.score.total - a.score.total);
  }, [scoutedSystems]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Colony Expansion Scouting</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Evaluate candidate systems within range
          </p>
        </div>
      </div>

      {/* Comparison bar — sticky when systems selected */}
      {compareIds.length > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-3 bg-card border border-primary/30 rounded-lg px-4 py-2 mb-4 shadow-lg">
          <span className="text-sm text-primary font-medium shrink-0">
            Compare: {compareIds.length}/3
          </span>
          <div className="flex-1 flex flex-wrap gap-2">
            {compareIds.map((id64) => {
              const sd = scoutedSystems[id64];
              return sd ? (
                <span key={id64} className="text-xs bg-primary/10 rounded px-2 py-0.5 flex items-center gap-1">
                  <span className={`font-bold ${scoreColor(sd.score.total)}`}>{sd.score.total}</span>
                  {sd.name}
                  <button
                    onClick={() => toggleCompare(id64)}
                    className="ml-0.5 text-muted-foreground hover:text-red-400"
                  >
                    &times;
                  </button>
                </span>
              ) : null;
            })}
          </div>
          {compareIds.length >= 2 && (
            <button
              onClick={() => setShowComparison((v) => !v)}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              {showComparison ? 'Hide' : 'Compare'}
            </button>
          )}
          <button
            onClick={() => { setCompareIds([]); setShowComparison(false); }}
            className="text-xs text-muted-foreground hover:text-red-400 shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      {/* Comparison panel */}
      {showComparison && compareIds.length >= 2 && (
        <div className="bg-card border border-primary/30 rounded-lg mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h3 className="text-sm font-semibold text-primary">System Comparison</h3>
            <button onClick={() => setShowComparison(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-3 py-2 text-muted-foreground w-36 text-xs">Metric</th>
                  {compareIds.map((id64) => {
                    const sd = scoutedSystems[id64];
                    return (
                      <th key={id64} className="text-center px-3 py-2 min-w-[160px]">
                        <Link
                          to={`/systems/${encodeURIComponent(sd?.name || '')}`}
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {sd?.name || 'Unknown'}
                        </Link>
                        <Link
                          to={`/system-view?system=${encodeURIComponent(sd?.name || '')}`}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1"
                          title="System View"
                        >{'\u2604\uFE0F'}</Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Total Score */}
                {(() => {
                  const vals = compareIds.map((id) => scoutedSystems[id]?.score.total ?? 0);
                  const best = Math.max(...vals);
                  return (
                    <tr className="border-b border-border/30">
                      <td className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Total Score</td>
                      {compareIds.map((id, i) => (
                        <td key={id} className={`px-3 py-1.5 text-center text-lg font-bold ${vals[i] === best && best > 0 ? 'text-green-400' : scoreColor(vals[i])}`}>
                          {vals[i]}
                        </td>
                      ))}
                    </tr>
                  );
                })()}
                {/* Score breakdown rows */}
                {([
                  ['Stars', 'starPoints'],
                  ['Atmosphere', 'atmospherePoints'],
                  ['Oxygen', 'oxygenPoints'],
                  ['Rings', 'ringPoints'],
                  ['Proximity', 'proximityPoints'],
                  ['Economy', 'economyPoints'],
                  ['Body Count', 'bodyCountPoints'],
                ] as [string, keyof import('@/lib/scoutingScorer').ScoreBreakdown][]).map(([label, key]) => {
                  const vals = compareIds.map((id) => (scoutedSystems[id]?.score[key] as number) ?? 0);
                  const best = Math.max(...vals);
                  return (
                    <tr key={label} className="border-b border-border/30">
                      <td className="px-3 py-1 text-xs text-muted-foreground">{label}</td>
                      {compareIds.map((id, i) => {
                        const sd = scoutedSystems[id];
                        let detail = '';
                        if (key === 'atmospherePoints') detail = `(${sd?.score.atmosphereCount ?? 0})`;
                        if (key === 'oxygenPoints') detail = `(${sd?.score.oxygenCount ?? 0})`;
                        if (key === 'ringPoints') detail = `(${sd?.score.ringCount ?? 0})`;
                        if (key === 'bodyCountPoints') detail = `(${sd?.score.bodyCount ?? 0})`;
                        if (key === 'economyPoints') detail = sd?.score.uniqueEconomies?.length ? `(${sd.score.uniqueEconomies.join(', ')})` : '';
                        return (
                          <td key={id} className={`px-3 py-1 text-center text-xs ${vals[i] === best && best > 0 ? 'text-green-400 font-semibold' : 'text-muted-foreground'}`}>
                            {vals[i]} {detail && <span className="opacity-60">{detail}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* Body String */}
                <tr className="border-b border-border/30">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground font-medium">Bodies</td>
                  {compareIds.map((id) => {
                    const sd = scoutedSystems[id];
                    return (
                      <td key={id} className="px-3 py-1.5 text-center text-xs font-mono text-muted-foreground">
                        {sd?.bodyString || '\u2014'}
                      </td>
                    );
                  })}
                </tr>
                {/* Distance */}
                {refCoords && (
                  <tr className="border-b border-border/30">
                    <td className="px-3 py-1 text-xs text-muted-foreground">Distance</td>
                    {(() => {
                      const dists = compareIds.map((id) => {
                        const match = systems.find((s) => s.search.id64 === id);
                        return match ? match.search.distance : null;
                      });
                      const validDists = dists.filter((d): d is number => d !== null);
                      const minDist = validDists.length > 0 ? Math.min(...validDists) : null;
                      return compareIds.map((id, i) => (
                        <td key={id} className={`px-3 py-1 text-center text-xs ${dists[i] !== null && dists[i] === minDist ? 'text-green-400 font-semibold' : 'text-muted-foreground'}`}>
                          {dists[i] !== null ? `${dists[i]!.toFixed(1)} ly` : 'N/A'}
                        </td>
                      ));
                    })()}
                  </tr>
                )}
                {/* Population */}
                <tr className="border-b border-border/30">
                  <td className="px-3 py-1 text-xs text-muted-foreground">Population</td>
                  {compareIds.map((id) => {
                    const match = systems.find((s) => s.search.id64 === id);
                    const pop = match?.search.population ?? 0;
                    return (
                      <td key={id} className="px-3 py-1 text-center text-xs text-muted-foreground">
                        {pop > 0 ? pop.toLocaleString() : '\u2014'}
                      </td>
                    );
                  })}
                </tr>
                {/* Spansh Freshness */}
                <tr>
                  <td className="px-3 py-1 text-xs text-muted-foreground">Spansh Data</td>
                  {compareIds.map((id) => {
                    const upd = scoutedSystems[id]?.spanshUpdatedAt;
                    return (
                      <td key={id} className={`px-3 py-1 text-center text-xs ${upd ? freshnessColor(upd) : 'text-muted-foreground'}`}>
                        {upd ? formatRelativeTime(upd) : 'N/A'}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Favorites section — collapsible, compact table */}
      {favoriteSystems.length > 0 && (
        <div className="bg-card border border-yellow-500/30 rounded-lg mb-4 overflow-hidden">
          <button
            onClick={() => setShowFavorites((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-yellow-300 hover:bg-muted/20 transition-colors"
          >
            <span className="text-xs">{showFavorites ? '\u25BE' : '\u25B8'}</span>
            {'\u2B50'} Favorite Systems ({favoriteSystems.length})
          </button>
          {showFavorites && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-yellow-500/15 text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-1.5"></th>
                  <th className="w-14 px-2 py-1.5 text-right">Score</th>
                  <th className="px-2 py-1.5 text-left">System</th>
                  <th className="px-2 py-1.5 text-left">Info</th>
                  <th className="px-2 py-1.5 text-left min-w-[200px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {favoriteSystems.map((sd) => {
                  const isCol = sd.isColonised || colonizedSystems.some((c) => c.toLowerCase() === sd.name.toLowerCase());
                  return (
                    <tr key={sd.id64} className="border-t border-yellow-500/10 hover:bg-muted/10">
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => toggleFavorite(sd.id64)}
                          className="text-yellow-400 hover:text-yellow-200 transition-colors text-sm"
                          title="Remove from favorites"
                        >
                          {'\u2605'}
                        </button>
                        <button
                          onClick={() => toggleCompare(sd.id64)}
                          className={`ml-0.5 text-[10px] px-1 rounded border transition-colors ${
                            compareIds.includes(sd.id64)
                              ? 'bg-primary/20 border-primary/50 text-primary font-bold'
                              : 'border-border/30 text-muted-foreground/30 hover:text-primary/60 hover:border-primary/30'
                          }`}
                          title={compareIds.includes(sd.id64) ? 'Remove from comparison' : 'Compare'}
                        >
                          VS
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={`text-lg font-bold ${scoreColor(sd.score.total)}`}>
                          {sd.score.total}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/systems/${encodeURIComponent(sd.name)}`}
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                          title="View system details"
                        >
                          {sd.name}
                        </Link>
                        <Link
                          to={`/system-view?system=${encodeURIComponent(sd.name)}`}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1"
                          title="System View"
                        >{'\u2604\uFE0F'}</Link>
                        <button
                          onClick={() => setRefSystem(sd.name)}
                          className="ml-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                          title="Search near this system"
                        >
                          {'\u{1F50D}'}
                        </button>
                        {isCol && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-progress-complete/15 text-progress-complete">
                            colonised
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                        {sd.score.bodyCount > 0
                          ? `${sd.score.bodyCount} ${sd.score.bodyCount === 1 ? 'body' : 'bodies'}`
                          : sd.journalBodyCount
                            ? `${sd.journalBodyCount} (honk)`
                            : '\u2014'}
                        {sd.score.hasOxygenAtmosphere && ' \u{1F7E2}'}
                        {sd.score.hasRingedLandable && ' \u{1F48D}'}
                        {sd.fromJournal && sd.fssAllBodiesFound && <span title="Journal data — confirmed complete (FSSAllBodiesFound)">{' \u{1F4D3}\u2713'}</span>}
                        {sd.fromJournal && !sd.fssAllBodiesFound && <span title="Journal data — completeness unconfirmed">{' \u{1F4D3}'}</span>}
                        {sd.spanshUpdatedAt && (
                          <span className={`ml-1 ${freshnessColor(sd.spanshUpdatedAt)}`} title={`Spansh: ${new Date(sd.spanshUpdatedAt).toLocaleDateString()}`}>
                            {formatRelativeTime(sd.spanshUpdatedAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          placeholder="Add a note..."
                          value={sd.notes || ''}
                          onChange={(e) => {
                            upsertScoutedSystem({ ...sd, notes: e.target.value });
                          }}
                          className="w-full bg-transparent border-b border-yellow-500/20 focus:border-yellow-400/50 px-1 py-0.5 text-xs text-yellow-100/80 placeholder:text-yellow-500/30 focus:outline-none"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Journal scan section — collapsible */}
      <div className="bg-card border border-border rounded-lg mb-4 overflow-hidden">
        <button
          onClick={() => setShowJournalScan((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/20 transition-colors"
        >
          <span className="text-xs">{showJournalScan ? '\u25BE' : '\u25B8'}</span>
          {'\u{1F4D3}'} Journal-Based Scouting
          {Object.keys(journalExplorationCache).length > 0 && !journalScanProgress && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({Object.keys(journalExplorationCache).length} cached)
            </span>
          )}
          {journalScanProgress && (
            <span className={`ml-2 text-xs font-normal ${journalScanProgress.startsWith('Error') ? 'text-red-400' : 'text-muted-foreground'}`}>
              — {journalScanProgress}
            </span>
          )}
        </button>
        {showJournalScan && (
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground mb-3">
              Cache exploration data from your game logs (honk + body scans). Cached data is used when you Scout individual systems — prioritized over Spansh when you have more body data.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={scanJournalsForScouting}
                disabled={!!journalScanProgress && !journalScanProgress.startsWith('Done') && !journalScanProgress.startsWith('Error') && !journalScanProgress.startsWith('Cleared')}
                className="px-4 py-1.5 bg-secondary/20 text-secondary rounded-lg text-sm font-medium hover:bg-secondary/30 transition-colors disabled:opacity-50"
              >
                Scan Journals
              </button>
              <button
                onClick={clearJournalScores}
                disabled={!!journalScanProgress && !journalScanProgress.startsWith('Done') && !journalScanProgress.startsWith('Error') && !journalScanProgress.startsWith('Cleared')}
                className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                title="Remove journal-scouted scores only (keeps Spansh scores)"
              >
                Clear Journal
              </button>
              <button
                onClick={() => { if (confirm('Clear ALL scouted scores? Favorites and noted systems will be kept.')) { clearScoutedSystems(true); clearJournalExplorationCache(); } }}
                className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                title="Remove ALL scouted scores (keeps favorites and noted systems)"
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top scouted systems leaderboard — collapsible */}
      {topScoutedAll.length > 0 && (
        <div className="bg-card border border-border rounded-lg mb-4 overflow-hidden">
          <button
            onClick={() => setShowLeaderboards((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/20 transition-colors"
          >
            <span className="text-xs">{showLeaderboards ? '\u25BE' : '\u25B8'}</span>
            {'\uD83C\uDFC6'} Scouting Leaderboards
            <span className="text-xs font-normal">
              ({topScoutedAll.length} candidates)
            </span>
          </button>
          {showLeaderboards && (
            <div className="border-t border-border px-4 py-3">
              {topScoutedAll.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    Top Expansion Candidates
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {topScoutedAll.map((sd, i) => (
                      <div
                        key={sd.id64}
                        className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border border-border/50 rounded-lg text-left"
                      >
                        <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
                        <span className={`text-lg font-bold ${scoreColor(sd.score.total)}`}>
                          {sd.score.total}
                        </span>
                        <div className="h-1.5 w-10 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              sd.score.total >= 100
                                ? 'bg-yellow-400'
                                : sd.score.total >= 60
                                  ? 'bg-progress-complete'
                                  : sd.score.total >= 30
                                    ? 'bg-sky-400'
                                    : 'bg-muted-foreground/30'
                            }`}
                            style={{ width: scoreBarWidth(sd.score.total) }}
                          />
                        </div>
                        <Link
                          to={`/systems/${encodeURIComponent(sd.name)}`}
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                          title="View system details"
                        >
                          {sd.name}
                        </Link>
                        <Link
                          to={`/system-view?system=${encodeURIComponent(sd.name)}`}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1"
                          title="System View"
                        >{'\u2604\uFE0F'}</Link>
                        <button
                          onClick={() => setRefSystem(sd.name)}
                          className="text-xs text-muted-foreground hover:text-primary transition-colors"
                          title="Search near this system"
                        >
                          {'\u{1F50D}'}
                        </button>
                        <span className="text-xs text-muted-foreground">
                          {sd.score.bodyCount} {sd.score.bodyCount === 1 ? 'body' : 'bodies'}
                          {sd.score.hasOxygenAtmosphere && ' \u{1F7E2}'}
                          {sd.score.hasRingedLandable && ' \u{1F48D}'}
                        </span>
                        <button
                          onClick={() => upsertScoutedSystem({ ...sd, isColonised: true })}
                          className="text-xs text-muted-foreground/30 hover:text-red-400 transition-colors ml-1"
                          title="Remove — mark as colonised"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reference system selector */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-muted-foreground mb-1">Reference System</label>
            <input
              value={refSystem}
              onChange={(e) => setRefSystem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="e.g. HIP 47126"
              className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          {myColonizedSystems.length > 0 && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Quick select</label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setRefSystem(e.target.value);
                }}
                className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="">My systems...</option>
                {settings.homeSystem && (
                  <option value={settings.homeSystem}>{settings.homeSystem} (home)</option>
                )}
                {myColonizedSystems
                  .filter((s) => s !== settings.homeSystem)
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Range</label>
            <select
              value={searchRadius}
              onChange={(e) => setSearchRadius(Number(e.target.value))}
              className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value={15}>15 ly (colonisation)</option>
              <option value={20}>20 ly</option>
              <option value={25}>25 ly</option>
              <option value={30}>30 ly</option>
              <option value={40}>40 ly</option>
              <option value={50}>50 ly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max systems</label>
            <select
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value={0}>All</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
          <button
            onClick={handleSearch}
            disabled={!refSystem.trim() || searchPhase === 'resolving' || searchPhase === 'searching'}
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {searchPhase === 'resolving'
              ? 'Resolving...'
              : searchPhase === 'searching'
                ? 'Searching...'
                : 'Find Systems'}
          </button>
        </div>
      </div>

      {/* Error */}
      {searchPhase === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-sm text-red-400">
          {searchError}
        </div>
      )}

      {/* Results */}
      {searchPhase === 'done' && (
        <>
          {/* Summary bar + filters */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              {systemsWithBodies.length} systems with bodies within {searchRadius} ly of {refSystem}
              {systemsNoBodies.length > 0 && (
                <span className="opacity-60"> + {systemsNoBodies.length} with no data</span>
              )}
              {totalCount > 0 && filteredSystems.length < systems.length && (
                <span className="ml-2 text-xs opacity-70">
                  ({systems.length - filteredSystems.length} hidden by filters)
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Filter: hide colonized */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideColonized}
                  onChange={(e) => setHideColonized(e.target.checked)}
                  className="accent-primary"
                />
                Hide colonized
              </label>
              {/* Filter: body count */}
              <select
                value={bodyCountFilter}
                onChange={(e) => setBodyCountFilter(e.target.value as typeof bodyCountFilter)}
                className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
              >
                <option value="all">Bodies: All</option>
                <option value="gt20">Bodies: &gt; 20</option>
                <option value="10to20">Bodies: 10-20</option>
                <option value="5to10">Bodies: 5-10</option>
                <option value="lt5">Bodies: &lt; 5</option>
              </select>
              {/* Source filter toggles */}
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground mr-0.5">Source:</span>
                {([
                  ['journal', '\u{1F4D3} Journal'],
                  ['journal_complete', '\u{1F4D3}\u2713 Complete'],
                  ['spansh', '\u{1F310} Spansh'],
                  ['both', '\u{1F4D3}\u{1F310} Both'],
                  ['none', '\u2753 No data'],
                ] as [SourceFilter, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => toggleSourceFilter(key)}
                    className={`px-1.5 py-0.5 rounded border text-xs transition-colors ${
                      sourceFilters.has(key)
                        ? 'bg-primary/20 border-primary text-primary'
                        : 'bg-muted border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {sourceFilters.size > 0 && (
                  <button
                    onClick={() => setSourceFilters(new Set())}
                    className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    title="Clear source filters"
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>
              {/* Sort */}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as 'score' | 'distance' | 'bodies')}
                className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
              >
                <option value="score">Sort: Score</option>
                <option value="distance">Sort: Distance</option>
                <option value="bodies">Sort: Body Count</option>
              </select>
              {scoutAllProgress ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Scouting {scoutAllProgress.done}/{scoutAllProgress.total}...
                  </span>
                  <button
                    onClick={stopScoutAll}
                    className="px-3 py-1 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 transition-colors"
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  onClick={scoutAll}
                  disabled={filteredScoutedCount === filteredTotal}
                  className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors disabled:opacity-50"
                >
                  {filteredScoutedCount === filteredTotal
                    ? `All ${filteredScoutedCount} scouted`
                    : filteredScoutedCount > 0
                      ? `Scout remaining (${filteredTotal - filteredScoutedCount})`
                      : `Scout All (${filteredTotal})`}
                </button>
              )}
            </div>
          </div>

          {/* Systems with bodies */}
          <div className="space-y-1">
            {systemsWithBodies.map((sys) => {
              const isExpanded = expandedId === sys.search.id64;
              const isColonised =
                sys.search.is_colonised ||
                colonizedSystems.some(
                  (c) => c.toLowerCase() === sys.search.name.toLowerCase(),
                );
              const isSelf = sys.search.name.toLowerCase() === refSystem.toLowerCase();
              const isFav = scoutedSystems[sys.search.id64]?.isFavorite;

              return (
                <div
                  key={sys.search.id64}
                  className={`bg-card border rounded-lg overflow-hidden transition-colors ${
                    isFav
                      ? 'border-yellow-500/40'
                      : isSelf
                        ? 'border-primary/40'
                        : sys.score?.hasOxygenAtmosphere
                          ? 'border-green-500/30'
                          : sys.score?.hasRingedLandable
                            ? 'border-yellow-500/20'
                            : 'border-border'
                  }`}
                >
                  {/* Oxygen atmosphere callout */}
                  {sys.score?.hasOxygenAtmosphere && (
                    <div className="px-4 py-1 bg-green-500/10 text-green-300 text-xs font-medium">
                      {'\u{1F7E2}'} Oxygen atmosphere body detected
                    </div>
                  )}
                  {/* Ringed landable callout */}
                  {sys.score?.hasRingedLandable && (
                    <div className="px-4 py-1 bg-yellow-500/10 text-yellow-300 text-xs font-medium">
                      {'\u26A0\u{FE0F}'} Ringed landable body detected
                    </div>
                  )}
                  {/* Hazardous star callout */}
                  {sys.score && sys.score.hazardousStars?.length > 0 && (
                    <div className="px-4 py-1 bg-red-500/10 text-red-400 text-xs font-medium">
                      {'\u26A0\u{FE0F}'} Hazardous approach: {sys.score.hazardousStars.join(', ')}
                    </div>
                  )}

                  {/* Main row */}
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors ${
                      isSelf ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : sys.search.id64)}
                  >
                    {/* Favorite toggle — available for all systems */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sys.scouted) {
                          toggleFavorite(sys.search.id64);
                        } else {
                          // Create minimal scouted entry for unscouted system
                          upsertScoutedSystem({
                            id64: sys.search.id64,
                            name: sys.search.name,
                            score: { starPoints: 0, starDetails: [], atmospherePoints: 0, atmosphereCount: 0, oxygenPoints: 0, oxygenCount: 0, ringPoints: 0, ringCount: 0, proximityPoints: 0, proximityCount: 0, economyPoints: 0, uniqueEconomies: [], bodyCountPoints: 0, bodyCount: 0, total: 0, hasRingedLandable: false, hasOxygenAtmosphere: false, hazardousStars: [] },
                            bodyString: '',
                            isFavorite: true,
                            fromJournal: false,
                            journalBodyCount: sys.search.body_count,
                            scoutedAt: new Date().toISOString(),
                          });
                        }
                      }}
                      className={`text-sm shrink-0 transition-colors ${
                        isFav ? 'text-yellow-400 hover:text-yellow-200' : 'text-muted-foreground/30 hover:text-yellow-400'
                      }`}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFav ? '\u2605' : '\u2606'}
                    </button>

                    {/* Compare toggle */}
                    {sys.scouted && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCompare(sys.search.id64);
                        }}
                        className={`text-[10px] shrink-0 px-1 py-0.5 rounded border transition-colors ${
                          compareIds.includes(sys.search.id64)
                            ? 'bg-primary/20 border-primary/50 text-primary font-bold'
                            : 'border-border/30 text-muted-foreground/30 hover:text-primary/60 hover:border-primary/30'
                        }`}
                        title={compareIds.includes(sys.search.id64) ? 'Remove from comparison' : `Add to comparison${compareIds.length >= 3 ? ' (max 3)' : ''}`}
                      >
                        VS
                      </button>
                    )}

                    {/* Score */}
                    <div className="w-12 text-right shrink-0">
                      {sys.scouted ? (
                        <span className={`text-lg font-bold ${scoreColor(sys.score!.total)}`}>
                          {sys.score!.total}
                        </span>
                      ) : sys.loading ? (
                        <span className="text-xs text-muted-foreground animate-pulse">...</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">&mdash;</span>
                      )}
                    </div>

                    {/* Score bar */}
                    <div className="w-16 shrink-0">
                      {sys.scouted && (
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              sys.score!.total >= 100
                                ? 'bg-yellow-400'
                                : sys.score!.total >= 60
                                  ? 'bg-progress-complete'
                                  : sys.score!.total >= 30
                                    ? 'bg-sky-400'
                                    : 'bg-muted-foreground/30'
                            }`}
                            style={{ width: scoreBarWidth(sys.score!.total) }}
                          />
                        </div>
                      )}
                    </div>

                    {/* System name */}
                    <div className="min-w-[180px] shrink-0">
                      <span className="font-medium text-foreground">{sys.search.name}</span>
                      <Link
                        to={`/system-view?system=${encodeURIComponent(sys.search.name)}`}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1"
                        title="System View"
                        onClick={(e) => e.stopPropagation()}
                      >{'\u2604\uFE0F'}</Link>
                      {isSelf && <span className="ml-1.5 text-xs text-primary">(ref)</span>}
                      {isColonised && (
                        <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-progress-complete/15 text-progress-complete">
                          colonised
                        </span>
                      )}
                    </div>

                    {/* Distance + direction */}
                    <div className="w-20 text-right shrink-0 text-sm text-muted-foreground flex items-center justify-end gap-1">
                      <span>{sys.search.distance.toFixed(1)} ly</span>
                      {refCoords && (
                        <span className="text-xs opacity-70 w-4 text-center" title="Direction from reference (\u2191=toward galaxy center, \u2193=away, \u207A=above plane, \u207B=below)">
                          {directionIndicator(sys.search)}
                        </span>
                      )}
                    </div>

                    {/* Spansh freshness */}
                    {(() => {
                      const upd = scoutedSystems[sys.search.id64]?.spanshUpdatedAt;
                      return upd ? (
                        <span
                          className={`text-[10px] shrink-0 ${freshnessColor(upd)}`}
                          title={`Spansh data last updated: ${new Date(upd).toLocaleDateString()}`}
                        >
                          {formatRelativeTime(upd)}
                        </span>
                      ) : null;
                    })()}

                    {/* Body string or basic info */}
                    <div className="flex-1 text-xs text-muted-foreground truncate ml-2">
                      {sys.scouted && sys.bodySegments ? (
                        <span className="font-mono">
                          {sys.bodySegments.map((seg, i) => (
                            <span key={i} title={seg.tooltip || undefined}>{seg.text}</span>
                          ))}
                        </span>
                      ) : sys.scouted && sys.bodyString ? (
                        <span className="font-mono">{sys.bodyString}</span>
                      ) : sys.error ? (
                        <span className="text-red-400">{sys.error}</span>
                      ) : (() => {
                        const sd = scoutedSystems[sys.search.id64];
                        const bodyCount = sys.search.body_count || sd?.journalBodyCount || 0;
                        const isHonkOnly = sd?.fromJournal && sd.journalBodyCount && (sd.journalScannedCount || 0) === 0;
                        return (
                          <span className="opacity-50">
                            {bodyCount ? `${bodyCount} bodies` : 'no data'}
                            {isHonkOnly && ' \u00B7 needs FSS scan'}
                            {sys.search.population > 0 &&
                              ` \u00B7 pop ${(sys.search.population / 1e6).toFixed(1)}M`}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Journal cache indicator + Scout / Rescore button */}
                    {!sys.scouted && journalExplorationCache[sys.search.id64]?.scannedBodies?.length > 0 && (
                      <span className="text-[10px] text-blue-400/70 shrink-0" title="Journal body data cached — will be used when scouting">{'\u{1F4D3}'}</span>
                    )}
                    {!sys.loading && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          scoutSystem(sys.search.id64);
                        }}
                        className="px-2 py-0.5 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors shrink-0"
                      >
                        {sys.scouted ? 'Rescore' : 'Scout'}
                      </button>
                    )}
                    {sys.loading && (
                      <span className="text-xs text-muted-foreground animate-pulse shrink-0">
                        Scouting...
                      </span>
                    )}
                  </div>

                  {/* Expanded: score breakdown */}
                  {isExpanded && sys.scouted && sys.score && (
                    <div className="border-t border-border/50 px-4 py-3 bg-muted/10">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm max-w-lg">
                        {sys.score.starPoints > 0 && (
                          <div className="col-span-2">
                            {sys.score.starDetails.map((d, i) => (
                              <div key={i} className="text-muted-foreground">
                                {d}
                              </div>
                            ))}
                          </div>
                        )}
                        {sys.score.atmosphereCount > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              {'\u{1F32B}\u{FE0F}'} {sys.score.atmosphereCount} atmospheric{' '}
                              {sys.score.atmosphereCount === 1 ? 'body' : 'bodies'}
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.atmospherePoints}
                            </div>
                          </>
                        )}
                        {sys.score.oxygenCount > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              {'\u{1F7E2}'} {sys.score.oxygenCount} oxygen atmosphere{sys.score.oxygenCount > 1 ? 's' : ''}
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.oxygenPoints}
                            </div>
                          </>
                        )}
                        {sys.score.ringCount > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              {'\u{1F48D}'} {sys.score.ringCount} ringed landable
                              {sys.score.ringCount > 1 ? 's' : ''}
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.ringPoints}
                            </div>
                          </>
                        )}
                        {sys.score.proximityCount > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              {'\u{1F4AB}'} {sys.score.proximityCount} proximity cluster
                              {sys.score.proximityCount > 1 ? 's' : ''}
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.proximityPoints}
                            </div>
                          </>
                        )}
                        {sys.score.uniqueEconomies?.length > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              Economy diversity ({sys.score.uniqueEconomies.join(', ')})
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.economyPoints}
                            </div>
                          </>
                        )}
                        {sys.score.bodyCount > 0 && (
                          <>
                            <div className="text-muted-foreground">
                              {sys.score.bodyCount} qualifying{' '}
                              {sys.score.bodyCount === 1 ? 'body' : 'bodies'}
                            </div>
                            <div className="text-right text-foreground">
                              +{sys.score.bodyCountPoints}
                            </div>
                          </>
                        )}
                        <div className="col-span-2 border-t border-border/30 mt-1 pt-1 flex justify-between font-medium">
                          <span>Total</span>
                          <span className={scoreColor(sys.score.total)}>
                            {sys.score.total} / 200
                          </span>
                        </div>
                      </div>

                      {/* Score source indicator */}
                      {(() => {
                        const sd = scoutedSystems[sys.search.id64];
                        if (!sd) return null;
                        const source = sd.fromJournal ? 'Journal' : sd.spanshBodyCount ? 'Spansh' : 'Unknown';
                        const bodyInfo = sd.fromJournal
                          ? `${sd.journalScannedCount || '?'}/${sd.journalBodyCount || '?'} bodies scanned`
                          : `${sd.spanshBodyCount || '?'} bodies from Spansh`;
                        return (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Source: <span className="text-foreground font-medium">{source}</span> — {bodyInfo}
                            {sd.scoutedAt && <span className="ml-2">({new Date(sd.scoutedAt).toLocaleDateString()})</span>}
                          </div>
                        );
                      })()}

                      {/* Partial scan warning */}
                      {(() => {
                        const sd = scoutedSystems[sys.search.id64];
                        const totalBodies = sys.search.body_count || sd?.journalBodyCount || 0;
                        const scannedCount = sd?.journalScannedCount || 0;
                        if (sd?.fromJournal && totalBodies > 0 && scannedCount < totalBodies) {
                          return (
                            <div className="mt-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-300">
                              {'\u26A0\u{FE0F}'} Partial scan: {scannedCount} of {totalBodies} bodies FSS-scanned.
                              Use the Full Spectrum Scanner in-game to discover remaining bodies, then re-run journal scan.
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Star details table */}
                      {sys.starDetails && sys.starDetails.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-semibold text-muted-foreground mb-1">Stars</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground/70 border-b border-border/30">
                                <th className="text-left py-0.5 pr-3 font-medium">Name</th>
                                <th className="text-left py-0.5 pr-3 font-medium">Type</th>
                                <th className="text-left py-0.5 pr-3 font-medium">Class</th>
                                <th className="text-right py-0.5 pr-3 font-medium">Mass</th>
                                <th className="text-right py-0.5 pr-3 font-medium">Dist</th>
                                <th className="text-right py-0.5 font-medium">Pts</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sys.starDetails.map((sd, i) => (
                                <tr key={i} className={`text-muted-foreground ${sd.isHazardous ? 'text-red-400' : ''}`}>
                                  <td className="py-0.5 pr-3 text-foreground">{sd.name}</td>
                                  <td className="py-0.5 pr-3">{sd.subType}</td>
                                  <td className="py-0.5 pr-3">{sd.spectralClass || '\u2014'}</td>
                                  <td className="py-0.5 pr-3 text-right">{sd.solarMasses > 0 ? `${sd.solarMasses.toFixed(2)} M\u2609` : '\u2014'}</td>
                                  <td className="py-0.5 pr-3 text-right">{Math.round(sd.distanceLs)} ls</td>
                                  <td className="py-0.5 text-right">{sd.scorePoints > 0 ? `+${sd.scorePoints}` : '\u2014'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Body details table */}
                      {sys.bodyDetails && sys.bodyDetails.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-semibold text-muted-foreground mb-1">Qualifying Bodies</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground/70 border-b border-border/30">
                                <th className="text-left py-0.5 pr-2 font-medium">Body</th>
                                <th className="text-left py-0.5 pr-2 font-medium">Type</th>
                                <th className="text-right py-0.5 pr-2 font-medium">EM</th>
                                <th className="text-right py-0.5 pr-2 font-medium">G</th>
                                <th className="text-left py-0.5 pr-2 font-medium">Atmosphere</th>
                                <th className="text-right py-0.5 pr-2 font-medium">Temp</th>
                                <th className="text-right py-0.5 pr-2 font-medium">Dist</th>
                                <th className="text-left py-0.5 font-medium">Econ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sys.bodyDetails.map((bd, i) => (
                                <tr key={i} className="text-muted-foreground">
                                  <td className="py-0.5 pr-2 text-foreground whitespace-nowrap">
                                    {bd.hasAtmosphere && /oxygen/i.test(bd.atmosphereType) ? '\u{1F7E2}' : bd.hasAtmosphere ? '\u{1F32B}\u{FE0F}' : ''}
                                    {bd.hasRings && '\u{1F48D}'}
                                    {' '}{bd.name}
                                  </td>
                                  <td className="py-0.5 pr-2 whitespace-nowrap">{bd.subType.replace(' world', '').replace(' body', '')}</td>
                                  <td className="py-0.5 pr-2 text-right">{bd.earthMasses.toFixed(2)}</td>
                                  <td className="py-0.5 pr-2 text-right">{bd.gravity.toFixed(2)}g</td>
                                  <td className="py-0.5 pr-2 whitespace-nowrap">{bd.atmosphereType}</td>
                                  <td className="py-0.5 pr-2 text-right">{Math.round(bd.surfaceTemp)} K</td>
                                  <td className="py-0.5 pr-2 text-right">{Math.round(bd.distanceLs)} ls</td>
                                  <td className="py-0.5 whitespace-nowrap">{bd.economy}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Body string (not truncated) */}
                      {!sys.bodyDetails && (sys.bodySegments || sys.bodyString) && (
                        <div className="mt-3 text-xs font-mono text-muted-foreground break-all">
                          {sys.bodySegments
                            ? sys.bodySegments.map((seg, i) => (
                                <span key={i} title={seg.tooltip || undefined}>{seg.text}</span>
                              ))
                            : sys.bodyString}
                        </div>
                      )}

                      {/* System metadata */}
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {sys.search.population > 0 && (
                          <span>Pop: {sys.search.population.toLocaleString()}</span>
                        )}
                        {sys.search.primary_economy &&
                          sys.search.primary_economy !== 'None' && (
                            <span>Economy: {sys.search.primary_economy}</span>
                          )}
                        {sys.search.stations?.length > 0 && (
                          <span>
                            Stations:{' '}
                            {
                              sys.search.stations.filter(
                                (s) => !s.type?.includes('Carrier'),
                              ).length
                            }
                            {sys.search.stations.some((s) =>
                              s.type?.includes('Carrier'),
                            ) &&
                              ` + ${sys.search.stations.filter((s) => s.type?.includes('Carrier')).length} FC`}
                          </span>
                        )}
                        {(() => {
                          const upd = scoutedSystems[sys.search.id64]?.spanshUpdatedAt;
                          return upd ? (
                            <span className={freshnessColor(upd)}>
                              Spansh: {formatRelativeTime(upd)} ({new Date(upd).toLocaleDateString()})
                            </span>
                          ) : null;
                        })()}
                      </div>

                      {/* Notes input */}
                      <div className="mt-3">
                        <input
                          type="text"
                          placeholder="Add a note about this system..."
                          value={scoutedSystems[sys.search.id64]?.notes || ''}
                          onChange={(e) => {
                            const existing = scoutedSystems[sys.search.id64];
                            if (existing) {
                              upsertScoutedSystem({ ...existing, notes: e.target.value });
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Systems with no body data — collapsed by default */}
          {systemsNoBodies.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowNoBodies((v) => !v)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
              >
                <span className="text-xs">{showNoBodies ? '\u25BE' : '\u25B8'}</span>
                <span>
                  {systemsNoBodies.length} system{systemsNoBodies.length !== 1 ? 's' : ''} with no
                  body data
                </span>
                <span className="text-xs opacity-60">
                  — useful for spotting uncharted systems on the galaxy map
                </span>
              </button>
              {showNoBodies && (
                <div className="space-y-1 opacity-60">
                  {systemsNoBodies.map((sys) => {
                    const isColonised =
                      sys.search.is_colonised ||
                      colonizedSystems.some(
                        (c) => c.toLowerCase() === sys.search.name.toLowerCase(),
                      );
                    return (
                      <div
                        key={sys.search.id64}
                        className="bg-card border border-border/50 rounded-lg overflow-hidden"
                      >
                        <div className="flex items-center gap-3 px-4 py-2">
                          <button
                            onClick={() => {
                              const existing = scoutedSystems[sys.search.id64];
                              if (existing) {
                                toggleFavorite(sys.search.id64);
                              } else {
                                upsertScoutedSystem({
                                  id64: sys.search.id64,
                                  name: sys.search.name,
                                  score: { starPoints: 0, starDetails: [], atmospherePoints: 0, atmosphereCount: 0, oxygenPoints: 0, oxygenCount: 0, ringPoints: 0, ringCount: 0, proximityPoints: 0, proximityCount: 0, economyPoints: 0, uniqueEconomies: [], bodyCountPoints: 0, bodyCount: 0, total: 0, hasRingedLandable: false, hasOxygenAtmosphere: false, hazardousStars: [] },
                                  bodyString: '',
                                  isFavorite: true,
                                  fromJournal: false,
                                  scoutedAt: new Date().toISOString(),
                                });
                              }
                            }}
                            className={`text-sm shrink-0 transition-colors ${
                              scoutedSystems[sys.search.id64]?.isFavorite ? 'text-yellow-400 hover:text-yellow-200' : 'text-muted-foreground/30 hover:text-yellow-400'
                            }`}
                            title="Add to favorites"
                          >
                            {scoutedSystems[sys.search.id64]?.isFavorite ? '\u2605' : '\u2606'}
                          </button>
                          <div className="w-12 text-right shrink-0">
                            <span className="text-xs text-muted-foreground">&mdash;</span>
                          </div>
                          <div className="min-w-[180px] shrink-0">
                            <span className="font-medium text-muted-foreground">{sys.search.name}</span>
                            <Link
                              to={`/system-view?system=${encodeURIComponent(sys.search.name)}`}
                              className="text-[10px] text-cyan-400 hover:text-cyan-300 ml-1"
                              title="System View"
                            >{'\u2604\uFE0F'}</Link>
                            {isColonised && (
                              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-progress-complete/15 text-progress-complete">
                                colonised
                              </span>
                            )}
                          </div>
                          <div className="w-20 text-right shrink-0 text-sm text-muted-foreground flex items-center justify-end gap-1">
                            <span>{sys.search.distance.toFixed(1)} ly</span>
                            {refCoords && (
                              <span className="text-xs opacity-70 w-4 text-center" title="Direction from reference (\u2191=toward galaxy center, \u2193=away, \u207A=above plane, \u207B=below)">
                                {directionIndicator(sys.search)}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 text-xs text-muted-foreground truncate ml-2">
                            <span className="opacity-50">no body data</span>
                            {sys.search.population > 0 &&
                              <span className="opacity-50"> \u00B7 pop {(sys.search.population / 1e6).toFixed(1)}M</span>
                            }
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Attribution */}
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Body data from Spansh &middot; 2.5 EM threshold is estimated &middot; Rate limited to
            ~1 req/sec
          </p>
        </>
      )}

      {/* Empty state */}
      {searchPhase === 'idle' && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground mb-2">
            Enter a reference system to find candidate systems within your selected range.
          </p>
          {settings.homeSystem && (
            <p className="text-sm text-muted-foreground">
              Home system:{' '}
              <span className="text-foreground">{settings.homeSystem}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
