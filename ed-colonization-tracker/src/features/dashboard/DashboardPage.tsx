import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { cleanJournalString, cleanProjectName } from '@/lib/utils';
import { resolveStationType, getStationTypeInfo } from '@/data/stationTypes';
import { computeTierPoints } from '@/data/installationTypes';
import {
  isFileSystemAccessSupported,
  getJournalFolderHandle,
  selectJournalFolder,
  scanJournalFiles,
  extractKnowledgeBase,
  readMarketJson,
  readShipCargo,
  isColonisationShip,
  isConstructionStationName,
  scanForVisitedMarkets,
  scanRecentContributions,
  scanSessionStats,
  extractLatestCargoCapacity,
  extractExplorationData,
  journalBodiesToSpanshFormat,
  type RecentContributionSummary,
  type SessionStats,
} from '@/services/journalReader';
import { SessionSummaryModal } from './SessionSummaryModal';
import { SummaryStatsBanner } from './SummaryStatsBanner';
import { SystemCardsGrid } from './SystemCardsGrid';
import { ActiveProjectsSection } from './ActiveProjectsSection';
import { ColonizationTimeline } from './ColonizationTimeline';
import { startJournalWatcher, isWatcherRunning } from '@/services/journalWatcher';
import { aggregateSessionStats } from '@/lib/sessionUtils';
import {
  resolveSystemName,
  fetchSystemDump,
  type SpanshDumpBody,
} from '@/services/spanshApi';
import {
  scoreSystem,
  classifyStars,
  filterQualifyingBodies,
  buildBodyString,
} from '@/lib/scoutingScorer';
import type { ColonizationProject, KnownStation } from '@/store/types';

export function DashboardPage() {
  const allProjects = useAppStore((s) => s.projects);
  const addProject = useAppStore((s) => s.addProject);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const settings = useAppStore((s) => s.settings);
  const manualColonizedSystems = useAppStore((s) => s.manualColonizedSystems);
  const addManualColonizedSystem = useAppStore((s) => s.addManualColonizedSystem);
  const removeManualColonizedSystem = useAppStore((s) => s.removeManualColonizedSystem);

  const knownStations = useAppStore((s) => s.knownStations);
  const populationOverrides = useAppStore((s) => s.populationOverrides);
  const manualInstallations = useAppStore((s) => s.manualInstallations);
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const upsertScoutedSystem = useAppStore((s) => s.upsertScoutedSystem);
  const sessions = useAppStore((s) => s.sessions);
  const lastSessionSummaryShown = useAppStore((s) => s.lastSessionSummaryShown);
  const setLastSessionSummaryShown = useAppStore((s) => s.setLastSessionSummaryShown);

  // Session summary modal state
  const [sessionSummary, setSessionSummary] = useState<RecentContributionSummary[] | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [showSessionSummary, setShowSessionSummary] = useState(false);

  // Auto-scan for session summary on mount
  useEffect(() => {
    const handle = getJournalFolderHandle();
    if (!handle) return; // no folder selected yet
    const since = lastSessionSummaryShown || '1970-01-01T00:00:00Z';
    Promise.all([
      scanRecentContributions(handle, since),
      scanSessionStats(handle, since),
    ])
      .then(([contributions, stats]) => {
        // Show modal if there are contributions OR any meaningful activity
        if (contributions.length > 0 || stats.jumpCount > 0) {
          setSessionSummary(contributions);
          setSessionStats(stats);
          setShowSessionSummary(true);
        }
      })
      .catch(() => { /* silent fail if permission denied or files unreadable */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  const activeProjects = useMemo(() => allProjects.filter((p) => p.status === 'active'), [allProjects]);
  const completedProjects = useMemo(() => allProjects.filter((p) => p.status === 'completed'), [allProjects]);

  // Projects completed but not yet docked at (no station name resolved)
  // Exclude colonisation ships — they're temporary and vanish after construction completes
  const needsDockingProjects = useMemo(
    () => completedProjects.filter((p) =>
      !p.completedStationName &&
      !isColonisationShip(p.stationName || p.name, p.stationType)
    ),
    [completedProjects],
  );

  // Group active projects by system name
  const activeBySystem = useMemo(() => {
    const groups: Record<string, ColonizationProject[]> = {};
    for (const p of activeProjects) {
      const key = p.systemName || 'Unknown System';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [activeProjects]);

  // Colonized systems: ANY system that has a project (active or completed) + manually added
  // Filter out colonisation ships from display
  const colonizedSystems = useMemo(() => {
    const systemMap: Record<string, {
      systemName: string;
      activeProjects: ColonizationProject[];
      completedProjects: ColonizationProject[];
      isManual: boolean;
    }> = {};

    // Add all projects (active and completed)
    // Colonisation ships still register the system but are not counted as station projects
    for (const p of allProjects) {
      const key = p.systemName || p.name;
      if (!systemMap[key]) {
        systemMap[key] = { systemName: key, activeProjects: [], completedProjects: [], isManual: false };
      }
      if (isColonisationShip(p.stationName || p.name, p.stationType)) continue;
      if (p.status === 'completed') {
        systemMap[key].completedProjects.push(p);
      } else {
        systemMap[key].activeProjects.push(p);
      }
    }

    // Add manually added colonized systems
    for (const sysName of manualColonizedSystems) {
      if (!systemMap[sysName]) {
        systemMap[sysName] = { systemName: sysName, activeProjects: [], completedProjects: [], isManual: true };
      }
      systemMap[sysName].isManual = true;
    }

    return Object.values(systemMap).map((sys) => {
      const kbSystem = knownSystems[sys.systemName.toLowerCase()];
      const firstProject = [...sys.completedProjects, ...sys.activeProjects][0];
      const allSysProjects = [...sys.completedProjects, ...sys.activeProjects];

      // Count installations by type from all sources
      const installedTypes: string[] = [];
      const seenNames = new Set<string>();

      // KB stations (real docked/scanned data)
      for (const st of Object.values(knownStations)) {
        if (st.systemName.toLowerCase() !== sys.systemName.toLowerCase()) continue;
        if (isColonisationShip(st.stationName, st.stationType)) continue;
        if (isConstructionStationName(st.stationName)) continue;
        const key = st.stationName.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          installedTypes.push(st.stationType);
        }
      }

      // Completed projects
      for (const p of sys.completedProjects) {
        const name = (p.completedStationName || p.stationName || p.name).toLowerCase();
        if (!seenNames.has(name)) {
          seenNames.add(name);
          installedTypes.push(resolveStationType(p.completedStationType, p.stationType));
        }
      }

      // Manual installations
      for (const mi of manualInstallations) {
        if (mi.systemName.toLowerCase() !== sys.systemName.toLowerCase()) continue;
        const key = mi.stationName.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          installedTypes.push(mi.stationType || 'Unknown');
        }
      }

      // Categorize
      const ORBITAL_STATION = new Set(['Coriolis', 'Orbis', 'Ocellus', 'StationDodec', 'AsteroidBase']);
      const ORBITAL_OUTPOST = new Set(['Outpost']);
      const SURFACE_PORT = new Set(['CraterPort', 'SurfaceStation']);
      const SURFACE_OUTPOST = new Set(['CraterOutpost']);
      const SETTLEMENT = new Set(['OnFootSettlement']);
      const INSTALLATION_SET = new Set(['Installation', 'MegaShip']);

      let orbitalStations = 0;
      let orbitalOutposts = 0;
      let surfacePorts = 0;
      let surfaceOutposts = 0;
      let settlements = 0;
      let installations = 0;
      for (const t of installedTypes) {
        if (ORBITAL_STATION.has(t)) orbitalStations++;
        else if (ORBITAL_OUTPOST.has(t)) orbitalOutposts++;
        else if (SURFACE_PORT.has(t)) surfacePorts++;
        else if (SURFACE_OUTPOST.has(t)) surfaceOutposts++;
        else if (SETTLEMENT.has(t)) settlements++;
        else if (INSTALLATION_SET.has(t)) installations++;
        // Also handle installation type IDs (from new granular dataset)
        else {
          const instInfo = getStationTypeInfo(t);
          if (instInfo.category === 'orbital') orbitalStations++;
          else if (instInfo.category === 'outpost') orbitalOutposts++;
          else if (instInfo.category === 'surface') surfacePorts++;
          else if (instInfo.category === 'settlement') settlements++;
          else installations++;
        }
      }

      // Compute T2/T3 points
      const tierPoints = computeTierPoints(installedTypes.map((t) => ({ stationType: t })));

      // Most recent completion date
      const lastCompletedAt = sys.completedProjects.reduce<string | null>((latest, p) => {
        if (!p.completedAt) return latest;
        return !latest || p.completedAt > latest ? p.completedAt : latest;
      }, null);

      // Look up scouting score via systemAddress (= spansh id64)
      const id64 = kbSystem?.systemAddress || firstProject?.systemAddress;
      const scoutData = id64 ? scoutedSystems[id64] : undefined;

      return {
        ...sys,
        allProjects: allSysProjects,
        economy: kbSystem?.economy || firstProject?.systemInfo?.economy,
        secondEconomy: kbSystem?.secondEconomy || firstProject?.systemInfo?.secondEconomy,
        population: populationOverrides[sys.systemName.toLowerCase()]?.population ?? kbSystem?.population ?? firstProject?.systemInfo?.population,
        visitCount: kbSystem?.visitCount,
        stationsCompleted: sys.completedProjects.length,
        stationsActive: sys.activeProjects.length,
        installationCounts: { orbitalStations, orbitalOutposts, surfacePorts, surfaceOutposts, settlements, installations },
        totalInstalled: installedTypes.length,
        t2Points: tierPoints.t2Total,
        t3Points: tierPoints.t3Total,
        lastCompletedAt,
        lastVisited: kbSystem?.lastSeen ?? null,
        scoutScore: scoutData?.score?.total ?? null,
        id64: id64 ?? null,
      };
    });
  }, [allProjects, manualColonizedSystems, knownSystems, knownStations, manualInstallations, scoutedSystems, populationOverrides]);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [scoringProgress, setScoringProgress] = useState<{ done: number; total: number } | null>(null);
  const scoringAbortRef = useRef(false);

  // --- Summary stats ---
  const summaryStats = useMemo(() => {
    const sessionStats = aggregateSessionStats(sessions);
    const projectTonnage = allProjects.reduce((sum, p) =>
      sum + p.commodities.reduce((s, c) => s + c.providedQuantity, 0), 0);
    return {
      totalTonnage: Math.max(sessionStats.totalTons, projectTonnage),
      totalHours: sessionStats.totalMs / 3_600_000,
    };
  }, [sessions, allProjects]);

  // --- Total population across colonized systems ---
  const totalPopulation = useMemo(() => {
    let total = 0;
    for (const sys of colonizedSystems) {
      const key = sys.systemName.toLowerCase();
      const override = populationOverrides[key]?.population;
      const journalPop = knownSystems[key]?.population ?? 0;
      total += override ?? journalPop;
    }
    return total;
  }, [colonizedSystems, populationOverrides, knownSystems]);

  // --- Per-system tonnage ---
  const tonnageBySystem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sys of colonizedSystems) {
      map[sys.systemName] = sys.allProjects.reduce((sum, p) =>
        sum + p.commodities.reduce((s, c) => s + c.providedQuantity, 0), 0);
    }
    return map;
  }, [colonizedSystems]);

  // --- Body counts per system (from knownSystems or scoutedSystems) ---
  const knownSystemBodyCounts = useMemo(() => {
    const map: Record<string, number | undefined> = {};
    for (const sys of colonizedSystems) {
      const ks = knownSystems[sys.systemName.toLowerCase()];
      const id64 = ks?.systemAddress || sys.id64;
      const sd = id64 ? scoutedSystems[id64] : undefined;
      map[sys.systemName] = ks?.bodyCount || sd?.score?.bodyCount;
    }
    return map;
  }, [colonizedSystems, knownSystems, scoutedSystems]);

  // --- Timeline entries ---
  const timelineEntries = useMemo(() => {
    return completedProjects
      .filter((p) => p.completedAt)
      .map((p) => ({
        date: p.completedAt!,
        systemName: p.systemName || 'Unknown',
        stationName: cleanJournalString(p.completedStationName || p.stationName || p.name),
        stationType: resolveStationType(p.completedStationType, p.stationType),
        projectId: p.id,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [completedProjects]);

  const handleScoreColonies = useCallback(async () => {
    scoringAbortRef.current = false;
    // Always rescore ALL colonies
    const toScore = colonizedSystems;
    if (toScore.length === 0) return;
    setScoringProgress({ done: 0, total: toScore.length });

    // Pre-load journal exploration data once for all systems
    let journalExploration: Map<number, { bodyCount: number; fssAllBodiesFound: boolean; scannedBodies: { BodyName: string }[] }> | null = null;
    try {
      const handle = getJournalFolderHandle();
      if (handle) {
        journalExploration = await extractExplorationData(handle) as Map<number, { bodyCount: number; fssAllBodiesFound: boolean; scannedBodies: { BodyName: string }[] }>;
        // Populate journalExplorationCache for Architect's Domain records
        const cache: Record<number, import('@/services/journalReader').JournalExplorationSystem> = {};
        for (const [addr, sys] of (journalExploration as Map<number, import('@/services/journalReader').JournalExplorationSystem>)) {
          cache[addr] = sys;
        }
        useAppStore.getState().setJournalExplorationCache(cache);
      }
    } catch { /* journal unavailable */ }

    for (let i = 0; i < toScore.length; i++) {
      if (scoringAbortRef.current) break;
      const sys = toScore[i];
      setScoringProgress({ done: i, total: toScore.length });

      try {
        // Get id64: from knownSystems, project data, or resolve from Spansh
        let id64 = sys.id64;
        if (!id64) {
          const resolved = await resolveSystemName(sys.systemName);
          if (resolved) id64 = resolved.id64;
          // Don't skip — journal data can still score without id64
        }

        // sys.id64 is actually the systemAddress from knownSystems (set by FSDJump)
        // id64 may have been updated by Spansh resolution above
        const systemAddr = sys.id64 || id64;
        let journalBodies: SpanshDumpBody[] | null = null;
        let journalMeta: { bodyCount: number; scannedCount: number; fssAllBodiesFound: boolean } | null = null;
        if (journalExploration) {
          const addr = systemAddr;
          const journalSystem = addr ? journalExploration.get(addr) : undefined;
          if (journalSystem && journalSystem.scannedBodies.length > 0) {
            journalBodies = journalBodiesToSpanshFormat(journalSystem.scannedBodies as Parameters<typeof journalBodiesToSpanshFormat>[0], sys.systemName);
            journalMeta = {
              bodyCount: journalSystem.bodyCount,
              scannedCount: journalSystem.scannedBodies.length,
              fssAllBodiesFound: journalSystem.fssAllBodiesFound,
            };
          }
        }

        // Step 2: Fetch Spansh as supplement (only if we have an id64)
        let spanshBodies: SpanshDumpBody[] | null = null;
        let spanshName = sys.systemName;
        if (id64) {
          try {
            const dump = await fetchSystemDump(id64);
            if (dump.bodies && dump.bodies.length > 0) {
              spanshBodies = dump.bodies;
              spanshName = dump.name;
            }
          } catch { /* Spansh unavailable */ }
        }

        // Step 3: Pick best source — need at least one data source
        const journalCount = journalBodies?.length ?? 0;
        const spanshCount = spanshBodies?.length ?? 0;
        if (journalCount === 0 && spanshCount === 0) continue;

        const useBodies = (journalCount > spanshCount && journalCount > 0) ? journalBodies! : (spanshBodies ?? journalBodies ?? []);
        const isFromJournal = journalCount > spanshCount && journalCount > 0;

        const score = scoreSystem(useBodies);
        const stars = classifyStars(useBodies);
        const qualBodies = filterQualifyingBodies(useBodies);
        const bodyString = buildBodyString(qualBodies, stars);

        // Resolve coordinates from knownSystems, journal exploration, or existing scouted data
        const ks = knownSystems[sys.systemName.toLowerCase()];
        const journalSystem = systemAddr && journalExploration ? journalExploration.get(systemAddr) : undefined;
        const existingCoords = (id64 || systemAddr) ? scoutedSystems[id64 || systemAddr!]?.coordinates : undefined;
        const coords = ks?.coordinates || (journalSystem as { coordinates?: { x: number; y: number; z: number } | null })?.coordinates || existingCoords;

        // Use id64 (from Spansh) or systemAddress (from knownSystems) as store key
        const storeKey = id64 || systemAddr || 0;
        if (!storeKey) continue;

        upsertScoutedSystem({
          id64: storeKey,
          name: isFromJournal ? sys.systemName : spanshName,
          score,
          bodyString,
          cachedBodies: useBodies, // refresh cache with current data
          coordinates: coords || undefined,
          fromJournal: isFromJournal || undefined,
          journalBodyCount: journalMeta?.bodyCount,
          journalScannedCount: journalMeta?.scannedCount,
          fssAllBodiesFound: journalMeta?.fssAllBodiesFound,
          spanshBodyCount: spanshCount || undefined,
          scoutedAt: new Date().toISOString(),
        });
      } catch {
        // Skip systems that fail (API errors, etc.)
      }
    }

    setScoringProgress(null);
  }, [colonizedSystems, upsertScoutedSystem]);

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      if (!getJournalFolderHandle()) {
        const handle = await selectJournalFolder();
        if (!handle) {
          setSyncMessage('No folder selected.');
          setSyncing(false);
          return;
        }
      }

      // Scan for depot data
      const depots = await scanJournalFiles();
      const activeDepots = depots.filter((d) => !d.isComplete);

      // Extract knowledge base
      try {
        const kb = await extractKnowledgeBase({
          myFleetCarrier: settings.myFleetCarrier,
          myFleetCarrierMarketId: settings.myFleetCarrierMarketId,
          squadronCarrierCallsigns: settings.squadronCarrierCallsigns,
        });
        const store = useAppStore.getState();
        store.upsertKnownSystems(kb.systems);
        store.upsertKnownStations(kb.stations);
        store.mapSystemAddresses(kb.systemAddressMap);
        store.setFSSSignals(kb.fssSignals);
        if (kb.bodyVisits.length > 0) {
          store.upsertBodyVisits(kb.bodyVisits);
        }
        for (const fc of kb.fleetCarriers) {
          store.addFleetCarrier(fc);
        }
        // Auto-add claimed systems to colonized list
        // Systems where a ColonisationSystemClaim was filed should appear as colonies
        // even before the outpost is built
        for (const sysName of kb.claimedSystems) {
          const existing = store.projects.some(
            (p) => p.systemName.toLowerCase() === sysName.toLowerCase()
          );
          const alreadyManual = store.manualColonizedSystems.some(
            (s) => s.toLowerCase() === sysName.toLowerCase()
          );
          if (!existing && !alreadyManual) {
            store.addManualColonizedSystem(sysName);
          }
        }
      } catch (kbErr) {
        console.error('[KB Sync] Knowledge base extraction FAILED:', kbErr);
      }

      // Read market.json
      try {
        const market = await readMarketJson();
        if (market) {
          useAppStore.getState().setLatestMarket(market);
        }
      } catch {
        // Market reading is optional
      }

      // Read ship cargo so overlay and project pages have it immediately
      try {
        const cargo = await readShipCargo();
        if (cargo) {
          useAppStore.getState().setLiveShipCargo(cargo);
        }
      } catch {
        // Ship cargo reading is supplementary
      }

      // Auto-update cargo capacity from Loadout events (fires on login + ship swap)
      // Skip if user has manually overridden the value
      try {
        const currentSettings = useAppStore.getState().settings;
        if (!currentSettings.cargoCapacityManual) {
          const loadout = await extractLatestCargoCapacity();
          if (loadout && loadout.cargoCapacity > 0) {
            if (loadout.cargoCapacity !== currentSettings.cargoCapacity) {
              useAppStore.getState().updateSettings({ cargoCapacity: loadout.cargoCapacity });
            }
          }
        }
      } catch {
        // Cargo capacity extraction is supplementary
      }

      // Discover visited markets (stations where user bought colonisation commodities)
      try {
        const visited = await scanForVisitedMarkets();
        if (visited.length > 0) {
          useAppStore.getState().setVisitedMarkets(visited);
        }
      } catch {
        // Visited market discovery is supplementary
      }

      const totalStationsInStore = Object.keys(useAppStore.getState().knownStations).length;
      const totalSystemsInStore = Object.keys(useAppStore.getState().knownSystems).length;

      if (activeDepots.length === 0 && depots.length === 0) {
        setSyncMessage(`No depots found. KB: ${totalSystemsInStore} systems, ${totalStationsInStore} stations. (${new Date().toLocaleTimeString()})`);
        startJournalWatcher();
        return;
      }

      let created = 0;
      let updated = 0;
      let autoCompleted = 0;

      // Auto-complete depots that the journal reports as complete
      const currentStations = useAppStore.getState().knownStations;
      const completeDepots = depots.filter((d) => d.isComplete);
      for (const depot of completeDepots) {
        const existing = allProjects.find((p) => p.marketId === depot.marketId);
        if (existing && existing.status === 'active') {
          // Try to resolve the real station name from knownStations (the non-construction entry)
          const resolved = depot.marketId ? currentStations[depot.marketId] : undefined;
          const stationInfo = resolved && !isConstructionStationName(resolved.stationName) && !isColonisationShip(resolved.stationName, resolved.stationType)
            ? { name: resolved.stationName, type: resolved.stationType || existing.stationType || 'Outpost' }
            : undefined;
          useAppStore.getState().completeProject(existing.id, stationInfo);
          autoCompleted++;
        }
      }

      for (const depot of activeDepots) {
        const existing = allProjects.find((p) => p.marketId === depot.marketId);
        if (existing) {
          if (existing.status === 'completed') continue;
          useAppStore.getState().updateAllCommodities(existing.id, depot.commodities);
          const projectUpdates: Record<string, unknown> = {};
          if (depot.systemName && !existing.systemName) {
            projectUpdates.systemName = depot.systemName;
          }
          if (depot.stationType && !existing.stationType) {
            projectUpdates.stationType = depot.stationType;
          }
          if (depot.systemAddress && !existing.systemAddress) {
            projectUpdates.systemAddress = depot.systemAddress;
          }
          if (depot.stationName && !existing.stationName) {
            projectUpdates.stationName = cleanJournalString(depot.stationName);
          }
          if (Object.keys(projectUpdates).length > 0) {
            useAppStore.getState().updateProject(existing.id, projectUpdates);
          }
          updated++;
        } else {
          // Skip depots the user previously deleted
          const dismissed = useAppStore.getState().dismissedMarketIds;
          if (dismissed.includes(depot.marketId)) continue;

          const cleanedStationName = depot.stationName ? cleanJournalString(depot.stationName) : '';
          const depotName = depot.systemName
            ? `${depot.systemName}${cleanedStationName ? ` - ${cleanedStationName}` : ''}`
            : `Depot ${depot.marketId}`;
          addProject({
            name: depotName,
            systemName: depot.systemName || '',
            systemAddress: depot.systemAddress ?? null,
            stationType: depot.stationType || '',
            stationName: cleanedStationName,
            marketId: depot.marketId,
            commodities: depot.commodities,
            status: 'active',
            notes: '',
          });
          created++;
        }
      }

      // Auto-detect completed stations: if a known station in the same system
      // has a name that no longer contains "Construction", the station is built.
      const currentProjects = useAppStore.getState().projects;
      // Re-read knownStations in case completions above changed the store
      const stationsNow = useAppStore.getState().knownStations;
      const stationsBySystem = new Map<string, KnownStation[]>();
      for (const st of Object.values(stationsNow)) {
        const key = st.systemName.toLowerCase();
        if (!stationsBySystem.has(key)) stationsBySystem.set(key, []);
        stationsBySystem.get(key)!.push(st);
      }

      for (const project of currentProjects) {
        if (project.status !== 'active') continue;
        if (!project.systemName) continue;

        const sysStations = stationsBySystem.get(project.systemName.toLowerCase()) || [];
        for (const st of sysStations) {
          if (isColonisationShip(st.stationName, st.stationType)) continue;

          if (project.marketId && st.marketId === project.marketId && !isConstructionStationName(st.stationName)) {
            useAppStore.getState().completeProject(project.id, {
              name: st.stationName,
              type: st.stationType || project.stationType || 'Outpost',
            });
            autoCompleted++;
            break;
          }
        }
      }

      // Retroactively resolve station names for already-completed projects missing them
      const updatedProjects = useAppStore.getState().projects;
      for (const project of updatedProjects) {
        if (project.status !== 'completed' || project.completedStationName) continue;
        if (isColonisationShip(project.stationName || project.name, project.stationType)) continue;
        if (!project.marketId) continue;
        const resolved = stationsNow[project.marketId];
        if (resolved && !isConstructionStationName(resolved.stationName) && !isColonisationShip(resolved.stationName, resolved.stationType)) {
          useAppStore.getState().updateProject(project.id, {
            completedStationName: resolved.stationName,
            completedStationType: resolved.stationType || project.stationType || 'Outpost',
          });
        }
      }

      const parts: string[] = [];
      if (created > 0) parts.push(`${created} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (autoCompleted > 0) parts.push(`${autoCompleted} auto-completed`);
      const depotMsg = parts.length > 0 ? `${parts.join(', ')} depots` : 'No active depots';
      const totalStations2 = Object.keys(useAppStore.getState().knownStations).length;
      const totalSystems2 = Object.keys(useAppStore.getState().knownSystems).length;
      setSyncMessage(`Synced: ${depotMsg}. KB: ${totalSystems2} systems, ${totalStations2} stations. (${new Date().toLocaleTimeString()})`);
      startJournalWatcher();
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const hasNoProjects = allProjects.length === 0 && manualColonizedSystems.length === 0;

  if (hasNoProjects) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-6xl mb-4">{'\u{1F680}'}</div>
        <h2 className="text-2xl font-bold text-foreground mb-2">No Projects Yet</h2>
        <p className="text-muted-foreground mb-6">Start tracking your colonization projects</p>
        <div className="flex gap-3">
          <Link
            to="/projects/new"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Create First Project
          </Link>
          {isFileSystemAccessSupported() && (
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg font-medium hover:bg-secondary/30 transition-colors disabled:opacity-50"
            >
              {syncing ? 'Scanning...' : '\u{1F4C2} Import from Journal'}
            </button>
          )}
        </div>
        {syncMessage && (
          <div className="mt-4 px-4 py-2 bg-muted rounded-lg text-sm text-muted-foreground max-w-md text-center">
            {syncMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {showSessionSummary && sessionSummary && (
        <SessionSummaryModal
          contributions={sessionSummary}
          stats={sessionStats}
          projects={allProjects}
          onClose={() => {
            setShowSessionSummary(false);
            setLastSessionSummaryShown(new Date().toISOString());
          }}
        />
      )}

      {/* Hero banner */}
      <div className="relative w-full h-56 md:h-72 mb-6 rounded-xl overflow-hidden border border-border">
        <img
          src="/app-image.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[center_85%]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent" />
        <div className="relative h-full flex flex-col justify-end p-5 md:p-6">
          <h1 className="text-2xl md:text-4xl font-bold text-foreground drop-shadow-lg tracking-tight">
            ED Colony Tracker
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1 drop-shadow">
            Build. Expand. Dominate the black.
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex gap-2">
          {isFileSystemAccessSupported() && (
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg text-sm font-medium hover:bg-secondary/30 transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : '\u{1F504} Sync All from Journal'}
            </button>
          )}
          <Link
            to="/projects/new"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            + New Project
          </Link>
        </div>
      </div>

      {syncMessage && (
        <div className="mb-4 px-4 py-2 bg-muted rounded-lg text-sm text-muted-foreground flex items-center gap-2">
          {syncMessage}
          {isWatcherRunning() && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
      )}

      {/* Summary Stats Banner */}
      <SummaryStatsBanner
        totalSystems={colonizedSystems.length}
        totalStations={completedProjects.length}
        totalPopulation={totalPopulation}
        totalTonnage={summaryStats.totalTonnage}
        totalHours={summaryStats.totalHours}
        activeBuilds={activeProjects.length}
      />

      {/* Completed projects needing dock to register the new station */}
      {needsDockingProjects.length > 0 && (
        <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-yellow-400 mb-2">
            {'\u{1F3D7}\u{FE0F}'} New Station{needsDockingProjects.length > 1 ? 's' : ''} Ready — Dock to Register
          </h3>
          <div className="space-y-1">
            {needsDockingProjects.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="text-yellow-300">{'\u25CF'}</span>
                <span className="text-foreground font-medium">
                  {cleanProjectName(p.name)}
                </span>
                <span className="text-muted-foreground">
                  in {p.systemName || 'unknown system'} — dock at the new station for the app to identify it
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Construction Projects */}
      <ActiveProjectsSection
        activeBySystem={activeBySystem}
        knownSystems={knownSystems}
        cargoCapacity={settings.cargoCapacity || 794}
      />

      {/* Colonized Systems Cards */}
      <SystemCardsGrid
        colonizedSystems={colonizedSystems}
        tonnageBySystem={tonnageBySystem}
        scoutedSystems={scoutedSystems}
        knownSystemBodyCounts={knownSystemBodyCounts}
        onScoreColonies={handleScoreColonies}
        scoringProgress={scoringProgress}
        onStopScoring={() => { scoringAbortRef.current = true; }}
        allScored={colonizedSystems.every((s) => s.scoutScore !== null && s.scoutScore > 0)}
        unscoredCount={colonizedSystems.filter((s) => s.scoutScore === null).length}
        onAddSystem={addManualColonizedSystem}
        onRemoveManual={removeManualColonizedSystem}
      />

      {/* Colonization Timeline */}
      <ColonizationTimeline entries={timelineEntries} />
    </div>
  );
}
