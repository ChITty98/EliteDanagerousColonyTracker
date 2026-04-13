/**
 * Colony Chain Pathfinder
 *
 * Finds multi-hop routes from a start system to a target system,
 * where each hop is ≤15ly. Uses beam search to explore candidates,
 * scoring each intermediate system for colonization potential.
 */

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
  type ScoreBreakdown,
} from '@/lib/scoutingScorer';
import type { JournalExplorationSystem } from '@/services/journalReader';
import { journalBodiesToSpanshFormat } from '@/services/journalReader';

// --- Types ---

export interface ChainNode {
  id64: number;
  name: string;
  x: number;
  y: number;
  z: number;
  score: ScoreBreakdown | null;
  bodyString: string;
  bodyCount: number; // qualifying body count
  totalBodyCount: number; // from search result body_count
  isConnector: boolean; // low body count, forced bridge
  isStart: boolean;
  isTarget: boolean;
  population: number;
}

export interface ChainPath {
  nodes: ChainNode[];
  hops: number;
  aggregateScore: number;
  connectorCount: number;
}

export interface PathfinderProgress {
  phase: 'resolving' | 'routing' | 'scoring' | 'complete' | 'cancelled' | 'error';
  currentHop: number;
  totalHops: number;
  systemsSearched: number;
  systemsScored: number;
  message: string;
}

export type ProgressCallback = (progress: PathfinderProgress) => void;

/** Local data sources for journal-first pathfinding */
export interface LocalSystemData {
  /** knownSystems — keyed by lowercase system name, has coordinates */
  knownSystems: Record<string, { systemAddress: number; systemName: string; coordinates?: { x: number; y: number; z: number }; bodyCount?: number }>;
  /** journalExplorationCache — keyed by systemAddress, has body scan data */
  journalCache: Record<number, JournalExplorationSystem>;
  /** scoutedSystems — keyed by id64, has coordinates + scores */
  scoutedSystems: Record<number, { name: string; coordinates?: { x: number; y: number; z: number } }>;
}

// --- Helpers ---

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Find systems within radius from local data (knownSystems + journalCache + scoutedSystems) */
function findLocalNearbySystems(
  center: { x: number; y: number; z: number },
  radius: number,
  localData: LocalSystemData,
): SpanshSearchSystem[] {
  const results: SpanshSearchSystem[] = [];
  const seen = new Set<number>();

  // Check knownSystems (journal-visited systems with coordinates)
  for (const sys of Object.values(localData.knownSystems)) {
    if (!sys.coordinates || seen.has(sys.systemAddress)) continue;
    const dist = distance3d(center, sys.coordinates);
    if (dist <= radius) {
      seen.add(sys.systemAddress);
      results.push({
        id64: sys.systemAddress,
        name: sys.systemName,
        x: sys.coordinates.x,
        y: sys.coordinates.y,
        z: sys.coordinates.z,
        body_count: sys.bodyCount ?? 0,
        population: 0,
      });
    }
  }

  // Check journalExplorationCache (systems scanned but maybe not in knownSystems)
  for (const sys of Object.values(localData.journalCache)) {
    if (!sys.coordinates || seen.has(sys.systemAddress)) continue;
    const dist = distance3d(center, sys.coordinates);
    if (dist <= radius) {
      seen.add(sys.systemAddress);
      results.push({
        id64: sys.systemAddress,
        name: sys.systemName,
        x: sys.coordinates.x,
        y: sys.coordinates.y,
        z: sys.coordinates.z,
        body_count: sys.bodyCount ?? 0,
        population: 0,
      });
    }
  }

  // Check scoutedSystems
  for (const [id64Str, sys] of Object.entries(localData.scoutedSystems)) {
    const id64 = Number(id64Str);
    if (!sys.coordinates || seen.has(id64)) continue;
    const dist = distance3d(center, sys.coordinates);
    if (dist <= radius) {
      seen.add(id64);
      results.push({
        id64,
        name: sys.name,
        x: sys.coordinates.x,
        y: sys.coordinates.y,
        z: sys.coordinates.z,
        body_count: 0,
        population: 0,
      });
    }
  }

  return results;
}

const CONNECTOR_BODY_THRESHOLD = 3; // systems with fewer qualifying bodies are connectors
const ROUTE_BEAM_WIDTH = 6; // partial routes kept per hop (cheap — no scoring)
const ROUTE_CANDIDATES = 10; // candidate systems considered per frontier per hop
const MAX_PATHS = 50;
const MAX_ROUTES = 30; // cap candidate routes before scoring phase

// --- Phase 1: Find candidate routes (fast, no scoring) ---
// Only uses nearby search (position + body_count from search results).
// No fetchSystemDump calls — that's the expensive part saved for Phase 2.

type LightweightSystem = {
  id64: number; name: string; x: number; y: number; z: number;
  body_count: number; population: number;
};
type RouteBeamEntry = { systems: LightweightSystem[] };

async function findCandidateRoutes(
  startSystem: { id64: number; name: string; x: number; y: number; z: number },
  targetSystem: { id64: number; name: string; x: number; y: number; z: number },
  maxHops: number,
  localData: LocalSystemData | undefined,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<{ routes: LightweightSystem[][]; totalSearched: number }> {
  const startLW: LightweightSystem = { ...startSystem, body_count: 0, population: 0 };
  let beam: RouteBeamEntry[] = [{ systems: [startLW] }];
  const completed: LightweightSystem[][] = [];
  let totalSearched = 0;

  for (let hop = 1; hop <= maxHops; hop++) {
    if (signal?.aborted) break;

    onProgress({
      phase: 'routing',
      currentHop: hop,
      totalHops: maxHops,
      systemsSearched: totalSearched,
      systemsScored: 0,
      message: `Finding routes \u2014 hop ${hop}/${maxHops} (${beam.length} frontier${beam.length !== 1 ? 's' : ''})...`,
    });

    const nextBeam: RouteBeamEntry[] = [];

    for (const entry of beam) {
      if (signal?.aborted) break;

      const frontier = entry.systems[entry.systems.length - 1];
      const visitedIds = new Set(entry.systems.map((s) => s.id64));

      // Search nearby — local first, supplement with Spansh
      let nearby: SpanshSearchSystem[] = [];
      if (localData) {
        nearby = findLocalNearbySystems(frontier, 15, localData);
      }
      try {
        const spansh = await searchNearbySystems(frontier, 15);
        const localIds = new Set(nearby.map((s) => s.id64));
        for (const s of spansh) {
          if (!localIds.has(s.id64)) nearby.push(s);
        }
      } catch {
        // Spansh failed — continue with local only (journal-first)
      }
      totalSearched += nearby.length;

      // Filter visited and self
      nearby = nearby.filter((s) => !visitedIds.has(s.id64) && s.id64 !== frontier.id64);
      if (nearby.length === 0) continue;

      // Check if target is reachable from frontier
      const distToTarget = distance3d(frontier, targetSystem);
      const targetInNearby = nearby.find((s) => s.id64 === targetSystem.id64);
      if (targetInNearby || distToTarget <= 15) {
        // Only add target if not already the last system in the route
        const lastSys = entry.systems[entry.systems.length - 1];
        if (lastSys.id64 !== targetSystem.id64) {
          completed.push([
            ...entry.systems,
            { ...targetSystem, body_count: targetInNearby?.body_count ?? 0, population: targetInNearby?.population ?? 0 },
          ]);
        } else {
          completed.push([...entry.systems]);
        }
        // Don't stop — keep exploring for alternative routes at this hop
      }

      if (hop === maxHops) continue; // can't expand further

      // Pick candidates: must make forward progress (allow 2ly sideways drift)
      const candidates = nearby
        .filter((s) => distance3d(s, targetSystem) < distToTarget + 2)
        .sort((a, b) => {
          const progressA = distToTarget - distance3d(a, targetSystem);
          const progressB = distToTarget - distance3d(b, targetSystem);
          const rankA = progressA * 0.6 + Math.log2(Math.max(1, a.body_count)) * 3 * 0.4;
          const rankB = progressB * 0.6 + Math.log2(Math.max(1, b.body_count)) * 3 * 0.4;
          return rankB - rankA;
        })
        .slice(0, ROUTE_CANDIDATES);

      for (const c of candidates) {
        nextBeam.push({
          systems: [...entry.systems, { id64: c.id64, name: c.name, x: c.x, y: c.y, z: c.z, body_count: c.body_count, population: c.population }],
        });
      }

      // Connector fallback: if no forward-progress candidates, pick nearest toward target
      if (candidates.length === 0 && nearby.length > 0) {
        const fallback = nearby
          .filter((s) => distance3d(s, targetSystem) < distToTarget)
          .sort((a, b) => distance3d(a, targetSystem) - distance3d(b, targetSystem))[0];
        if (fallback) {
          nextBeam.push({
            systems: [...entry.systems, { id64: fallback.id64, name: fallback.name, x: fallback.x, y: fallback.y, z: fallback.z, body_count: fallback.body_count, population: fallback.population }],
          });
        }
      }
    }

    // Prune beam: keep routes closest to target, capped
    beam = nextBeam
      .sort((a, b) => {
        const lastA = a.systems[a.systems.length - 1];
        const lastB = b.systems[b.systems.length - 1];
        return distance3d(lastA, targetSystem) - distance3d(lastB, targetSystem);
      })
      .slice(0, ROUTE_BEAM_WIDTH * 3);

    if (beam.length === 0 && completed.length === 0) break;

    // Stop early if we have enough completed routes
    if (completed.length >= MAX_ROUTES) break;
  }

  // Deduplicate routes by their intermediate system id64 sequence
  const seen = new Set<string>();
  const unique = completed.filter((route) => {
    const key = route.slice(1, -1).map((s) => s.id64).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { routes: unique.slice(0, MAX_ROUTES), totalSearched };
}

// --- Main Algorithm: Route first, score later ---

export async function findChainPaths(
  startSystem: { id64: number; name: string; x: number; y: number; z: number },
  targetSystem: { id64: number; name: string; x: number; y: number; z: number },
  maxHops: number,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  localData?: LocalSystemData,
): Promise<ChainPath[]> {
  // Set journal cache for scoreNode to use (journal-first scoring)
  _journalCache = localData?.journalCache;

  const totalDist = distance3d(startSystem, targetSystem);
  const minHops = Math.max(1, Math.ceil(totalDist / 15));

  if (minHops > maxHops) {
    onProgress({
      phase: 'error',
      currentHop: 0,
      totalHops: maxHops,
      systemsSearched: 0,
      systemsScored: 0,
      message: `Target is ${totalDist.toFixed(1)}ly away \u2014 needs at least ${minHops} hops (max ${maxHops} allowed)`,
    });
    return [];
  }

  // If distance \u226415ly, it's a direct hop — just score the target
  if (totalDist <= 15) {
    onProgress({
      phase: 'scoring',
      currentHop: 1,
      totalHops: 1,
      systemsSearched: 0,
      systemsScored: 0,
      message: 'Direct hop \u2014 scoring target...',
    });

    const targetNode = await scoreNode(targetSystem, true, false);
    const startNode: ChainNode = {
      ...startSystem,
      score: null,
      bodyString: '',
      bodyCount: 0,
      totalBodyCount: 0,
      isConnector: false,
      isStart: true,
      isTarget: false,
      population: 0,
    };

    onProgress({
      phase: 'complete',
      currentHop: 1,
      totalHops: 1,
      systemsSearched: 0,
      systemsScored: 1,
      message: 'Done \u2014 1 direct path found',
    });

    return [{
      nodes: [startNode, targetNode],
      hops: 1,
      aggregateScore: targetNode.score?.total ?? 0,
      connectorCount: targetNode.isConnector ? 1 : 0,
    }];
  }

  // --- Phase 1: Find candidate routes (fast, no scoring) ---
  const { routes, totalSearched } = await findCandidateRoutes(
    startSystem, targetSystem, maxHops, localData, onProgress, signal,
  );

  if (signal?.aborted) {
    onProgress({
      phase: 'cancelled', currentHop: 0, totalHops: maxHops,
      systemsSearched: totalSearched, systemsScored: 0, message: 'Search cancelled',
    });
    return [];
  }

  if (routes.length === 0) {
    onProgress({
      phase: 'error', currentHop: maxHops, totalHops: maxHops,
      systemsSearched: totalSearched, systemsScored: 0,
      message: 'No viable routes found \u2014 try more hops or a closer start system',
    });
    return [];
  }

  // --- Phase 2: Score unique intermediate systems ---
  // Collect all unique non-start systems across all candidate routes
  const uniqueSystems = new Map<number, LightweightSystem>();
  for (const route of routes) {
    for (const sys of route) {
      if (sys.id64 !== startSystem.id64 && !uniqueSystems.has(sys.id64)) {
        uniqueSystems.set(sys.id64, sys);
      }
    }
  }

  const toScore = uniqueSystems.size;
  let totalScored = 0;
  const scoredNodes = new Map<number, ChainNode>();

  onProgress({
    phase: 'scoring', currentHop: 0, totalHops: maxHops,
    systemsSearched: totalSearched, systemsScored: 0,
    message: `Scoring ${toScore} unique systems from ${routes.length} candidate route${routes.length !== 1 ? 's' : ''}...`,
  });

  for (const sys of uniqueSystems.values()) {
    if (signal?.aborted) break;
    const isTarget = sys.id64 === targetSystem.id64;
    const node = await scoreNode(
      { id64: sys.id64, name: sys.name, x: sys.x, y: sys.y, z: sys.z },
      isTarget, false,
    );
    node.totalBodyCount = sys.body_count;
    node.population = sys.population;
    scoredNodes.set(sys.id64, node);
    totalScored++;

    onProgress({
      phase: 'scoring', currentHop: 0, totalHops: maxHops,
      systemsSearched: totalSearched, systemsScored: totalScored,
      message: `Scored ${totalScored}/${toScore}: ${sys.name}`,
    });
  }

  if (signal?.aborted) {
    onProgress({
      phase: 'cancelled', currentHop: 0, totalHops: maxHops,
      systemsSearched: totalSearched, systemsScored: totalScored, message: 'Search cancelled',
    });
    return [];
  }

  // --- Phase 3: Assemble scored paths ---
  const startNode: ChainNode = {
    ...startSystem,
    score: null,
    bodyString: '',
    bodyCount: 0,
    totalBodyCount: 0,
    isConnector: false,
    isStart: true,
    isTarget: false,
    population: 0,
  };

  const completedPaths: ChainPath[] = routes.map((route) => {
    // Deduplicate systems in the route (same system can appear twice, e.g. target repeated)
    const seen = new Set<number>();
    const dedupedRoute = route.filter((sys, i) => {
      if (i === 0) return true; // always keep start
      if (seen.has(sys.id64)) return false;
      seen.add(sys.id64);
      return true;
    });
    const nodes: ChainNode[] = dedupedRoute.map((sys, i) => {
      if (i === 0) return startNode;
      return scoredNodes.get(sys.id64) ?? {
        id64: sys.id64, name: sys.name, x: sys.x, y: sys.y, z: sys.z,
        score: null, bodyString: '\u2014', bodyCount: 0, totalBodyCount: sys.body_count,
        isConnector: true, isStart: false, isTarget: sys.id64 === targetSystem.id64, population: sys.population,
      };
    });
    const intermediateNodes = nodes.filter((n) => !n.isStart);
    return {
      nodes,
      hops: nodes.length - 1,
      aggregateScore: intermediateNodes.reduce((sum, n) => sum + (n.score?.total ?? 0), 0),
      connectorCount: intermediateNodes.filter((n) => n.isConnector).length,
    };
  });

  completedPaths.sort((a, b) => b.aggregateScore - a.aggregateScore);

  onProgress({
    phase: 'complete', currentHop: maxHops, totalHops: maxHops,
    systemsSearched: totalSearched, systemsScored: totalScored,
    message: `Found ${completedPaths.length} path${completedPaths.length !== 1 ? 's' : ''} (scored ${totalScored} systems)`,
  });

  return completedPaths.slice(0, MAX_PATHS);
}

// --- Score a single system node ---
// Journal cache reference — set by findChainPaths, used by scoreNode
let _journalCache: Record<number, JournalExplorationSystem> | undefined;

async function scoreNode(
  sys: { id64: number; name: string; x: number; y: number; z: number },
  isTarget: boolean,
  isStart: boolean,
): Promise<ChainNode> {
  // Gather both data sources, then pick the richer one
  // Same logic as expansion scouting & dashboard: journal wins only if it has strictly MORE bodies
  const journalSystem = _journalCache?.[sys.id64];
  let journalBodies: SpanshDumpBody[] | null = null;
  if (journalSystem && journalSystem.scannedBodies.length > 0) {
    try {
      journalBodies = journalBodiesToSpanshFormat(journalSystem.scannedBodies, journalSystem.systemName);
    } catch { /* ignore conversion errors */ }
  }

  let spanshBodies: SpanshDumpBody[] | null = null;
  let spanshPopulation = 0;
  let spanshName = sys.name;
  try {
    const dump = await fetchSystemDump(sys.id64);
    spanshBodies = dump.bodies ?? [];
    spanshPopulation = dump.population ?? 0;
    spanshName = dump.name || sys.name;
  } catch { /* Spansh unavailable — journal-only fallback */ }

  // Pick best source: journal only wins when it has strictly more bodies than Spansh
  const jCount = journalBodies?.length ?? 0;
  const sCount = spanshBodies?.length ?? 0;
  const useBodies = (jCount > sCount && jCount > 0) ? journalBodies! : (spanshBodies ?? journalBodies ?? []);
  const fromJournal = jCount > sCount && jCount > 0;

  if (useBodies.length === 0 && !journalBodies && !spanshBodies) {
    // No data from either source
    return {
      id64: sys.id64, name: sys.name, x: sys.x, y: sys.y, z: sys.z,
      score: null, bodyString: '\u2014', bodyCount: 0, totalBodyCount: 0,
      isConnector: !isTarget, isStart, isTarget, population: 0,
    };
  }

  const score = scoreSystem(useBodies);
  const stars = classifyStars(useBodies);
  const qualBodies = filterQualifyingBodies(useBodies);
  const bodyString = buildBodyString(qualBodies, stars);

  return {
    id64: sys.id64,
    name: fromJournal ? sys.name : spanshName,
    x: sys.x, y: sys.y, z: sys.z,
    score, bodyString,
    bodyCount: qualBodies.length,
    totalBodyCount: fromJournal ? (journalSystem!.bodyCount || useBodies.length) : useBodies.length,
    isConnector: qualBodies.length < CONNECTOR_BODY_THRESHOLD && !isTarget,
    isStart, isTarget,
    population: fromJournal ? 0 : spanshPopulation,
  };
}

// --- Utility: resolve a system name to coordinates ---

export async function resolveSystem(
  name: string,
): Promise<{ id64: number; name: string; x: number; y: number; z: number } | null> {
  const result = await resolveSystemName(name);
  if (!result) return null;
  return { id64: result.id64, name, x: result.x, y: result.y, z: result.z };
}
