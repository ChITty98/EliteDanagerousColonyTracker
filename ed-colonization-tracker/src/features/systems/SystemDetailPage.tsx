import { Fragment, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/store';
import { formatNumber, cleanProjectName, stripConstructionPrefix, inferStationTypeFromSignal } from '@/lib/utils';
import { StationTypeIcon } from '@/components/StationTypeIcon';
import { shouldShowInOverview, resolveStationType } from '@/data/stationTypes';
import { INSTALLATION_TYPE_OPTIONS } from '@/data/installationTypes';
import { isFleetCarrier, isColonisationShip, isConstructionStationName, getJournalFolderHandle, extractExplorationData, journalBodiesToSpanshFormat } from '@/services/journalReader';
import { fetchSystemDump } from '@/services/spanshApi';
import { getSystemTier, getTierProgress, formatPopulation } from '@/features/dashboard/tierUtils';
import { SystemBodiesTab } from './SystemBodiesTab';
import { NearbyExpansionTab } from './NearbyExpansionTab';
import { ImageGallery } from '@/components/ImageGallery';
import { galleryKey } from '@/store/galleryStore';
import type { KnownStation, FSSSignal, StationEconomy } from '@/store/types';

// Extended station type for merged installations list
type DisplayStation = KnownStation & {
  _isFromCompletedProject?: boolean;
  _isManualInstallation?: boolean;
  _manualInstallationId?: string;
  _isFromFSS?: boolean;
  _projectId?: string;
};


const FSS_STATION_TYPES = new Set([
  'Outpost', 'Coriolis', 'Orbis', 'Ocellus', 'CraterPort', 'CraterOutpost',
  'AsteroidBase', 'MegaShip', 'StationDodec', 'SurfaceStation', 'Installation',
  // FSS journal uses "Station*" prefixed variants
  'StationCoriolis', 'StationOrbis', 'StationOcellus', 'StationOutpost',
  'OnFootSettlement', 'PlanetaryOutpost', 'PlanetaryPort', 'SurfaceOutpost',
]);
const FSS_CARRIER_TYPES = new Set(['FleetCarrier', 'Squadron', 'SquadronCarrier']);
const FC_NAME_PATTERN = /^[A-Z0-9]{3}-[A-Z0-9]{3}$|^.+\s*\|\s*.+$/;

// Installation counting — same categories as dashboard
const ORBITAL_STATION = new Set(['Coriolis', 'Orbis', 'Ocellus', 'StationDodec', 'AsteroidBase']);
const ORBITAL_OUTPOST = new Set(['Outpost']);
const SURFACE_PORT = new Set(['CraterPort', 'SurfaceStation']);
const SURFACE_OUTPOST = new Set(['CraterOutpost']);
const SETTLEMENT = new Set(['OnFootSettlement']);
const INSTALLATION_TYPE = new Set(['Installation', 'MegaShip']);

const INSTALLATION_PARTS: { key: string; icon: string; label: string; types: Set<string> }[] = [
  { key: 'orbitalStations', icon: '\u{1F6F0}', label: 'Orbital Station', types: ORBITAL_STATION },
  { key: 'orbitalOutposts', icon: '\u{1F4E1}', label: 'Orbital Outpost', types: ORBITAL_OUTPOST },
  { key: 'surfacePorts', icon: '\u{1FA90}', label: 'Surface Port', types: SURFACE_PORT },
  { key: 'surfaceOutposts', icon: '\u{1F3D7}', label: 'Surface Outpost', types: SURFACE_OUTPOST },
  { key: 'settlements', icon: '\u{1F3D8}', label: 'Settlement', types: SETTLEMENT },
  { key: 'installations', icon: '\u2699', label: 'Installation', types: INSTALLATION_TYPE },
];

/** Format raw journal service names: "techBroker" → "Tech Broker", "facilitator/contacts" → "Facilitator" */
const SERVICE_RENAMES: Record<string, string> = {
  techbroker: 'Tech Broker',
  materialtrader: 'Material Trader',
  stationmenu: 'Station Menu',
  socialspace: 'Social Space',
  bartender: 'Bartender',
  vistagenomics: 'Vista Genomics',
  pioneersupplies: 'Pioneer Supplies',
  frontlinesolutions: 'Frontline Solutions',
  blackmarket: 'Black Market',
  searchrescue: 'Search & Rescue',
  flightcontroller: 'Flight Controller',
  crewlounge: 'Crew Lounge',
  stationoperations: 'Station Ops',
  liverystore: 'Livery',
  apexinterstellar: 'Apex Interstellar',
  'facilitator/contacts': 'Facilitator',
  missionsgenerated: 'Missions',
  missions: 'Missions',
  contacts: 'Contacts',
  commodities: 'Commodities',
  exploration: 'Cartographics',
  refuel: 'Refuel',
  repair: 'Repair',
  rearm: 'Rearm',
  tuning: 'Tuning',
  outfitting: 'Outfitting',
  shipyard: 'Shipyard',
  dock: 'Dock',
  engineer: 'Engineer',
  shop: 'Shop',
  modulepacks: 'Module Packs',
  registeringcolonisation: 'Colonisation',
  powerplay: 'Powerplay',
  autodock: 'Autodock',
  'workshop': 'Workshop',
  'humanoidlocker': 'Personal Locker',
  'missionsgenerator': 'Missions',
};

function formatServiceName(raw: string): string {
  const lookup = SERVICE_RENAMES[raw.toLowerCase()];
  if (lookup) return lookup;
  // camelCase → Title Case: "techBroker" → "Tech Broker"
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Capitalize trailing planet letter: "HIP 47126 ABCD 1 g" → "HIP 47126 ABCD 1 G" */
function capitalizeBodyName(name: string): string {
  return name.replace(/ ([a-z])$/, (_, letter) => ` ${letter.toUpperCase()}`);
}

/** Strip system name prefix from body name: "HIP 47126 ABCD 1 G" → "ABCD 1 G" */
function shortenBodyForDropdown(fullName: string, systemName: string): string {
  if (fullName.toLowerCase().startsWith(systemName.toLowerCase())) {
    const suffix = fullName.slice(systemName.length).trim();
    if (suffix) return suffix.toUpperCase();
  }
  return fullName;
}

/** Sort body names: single letters first (A < B < C < D), then compound (ABCD), then numeric (1 < 2) */
function sortBodyNames(names: string[], systemName: string): string[] {
  return [...names].sort((a, b) => {
    const aShort = shortenBodyForDropdown(a, systemName);
    const bShort = shortenBodyForDropdown(b, systemName);
    const aParts = aShort.split(/\s+/);
    const bParts = bShort.split(/\s+/);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const ap = aParts[i] ?? '';
      const bp = bParts[i] ?? '';
      if (ap === bp) continue;
      const aNum = parseInt(ap, 10);
      const bNum = parseInt(bp, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      // Shorter letter designations first (A before ABCD)
      const aIsLetters = /^[A-Z]+$/.test(ap);
      const bIsLetters = /^[A-Z]+$/.test(bp);
      if (aIsLetters && bIsLetters && ap.length !== bp.length) {
        return ap.length - bp.length;
      }
      return ap.localeCompare(bp);
    }
    return 0;
  });
}

function scoreColorClass(score: number): string {
  if (score >= 100) return 'text-yellow-300';
  if (score >= 60) return 'text-progress-complete';
  if (score >= 30) return 'text-sky-400';
  return 'text-muted-foreground';
}

type TabKey = 'installations' | 'bodies' | 'expansion';

function EditablePopulation({ systemName, journalPopulation }: { systemName: string; journalPopulation: number }) {
  const overrideEntry = useAppStore((s) => s.populationOverrides[systemName.toLowerCase()]);
  const setOverride = useAppStore((s) => s.setPopulationOverride);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');

  const population = overrideEntry?.population ?? journalPopulation;

  if (editing) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1">
        Population:{' '}
        <input
          type="text"
          autoFocus
          className="w-28 bg-muted border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:border-primary"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const num = parseInt(input.replace(/[,\s]/g, ''), 10);
              if (!isNaN(num) && num >= 0) setOverride(systemName, num);
              setEditing(false);
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          onBlur={() => {
            const num = parseInt(input.replace(/[,\s]/g, ''), 10);
            if (!isNaN(num) && num >= 0) setOverride(systemName, num);
            setEditing(false);
          }}
          placeholder="e.g. 150000"
        />
      </span>
    );
  }

  return (
    <span
      className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
      onClick={() => { setInput(population > 0 ? population.toString() : ''); setEditing(true); }}
      title="Click to update population"
    >
      Population: <span className="text-foreground font-medium">{population > 0 ? formatPopulation(population) : 'Unknown'}</span>
      {overrideEntry != null && (
        <span className="text-xs text-muted-foreground/50 ml-1">
          (manual{overrideEntry.updatedAt ? ` · ${new Date(overrideEntry.updatedAt).toLocaleDateString()}` : ''})
        </span>
      )}
    </span>
  );
}

export function SystemDetailPage() {
  const { systemName: rawSystemName } = useParams<{ systemName: string }>();
  const systemName = rawSystemName ? decodeURIComponent(rawSystemName) : '';

  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);
  const visitedMarkets = useAppStore((s) => s.visitedMarkets);
  const allProjects = useAppStore((s) => s.projects);
  const fssSignals = useAppStore((s) => s.fssSignals);
  const systemAddressMap = useAppStore((s) => s.systemAddressMap);
  const settings = useAppStore((s) => s.settings);
  const updateProject = useAppStore((s) => s.updateProject);
  const manualInstallations = useAppStore((s) => s.manualInstallations);
  const addManualInstallation = useAppStore((s) => s.addManualInstallation);
  const updateManualInstallation = useAppStore((s) => s.updateManualInstallation);
  const removeManualInstallation = useAppStore((s) => s.removeManualInstallation);
  const hiddenInstallations = useAppStore((s) => s.hiddenInstallations);
  const hideInstallation = useAppStore((s) => s.hideInstallation);
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const journalExplorationCache = useAppStore((s) => s.journalExplorationCache);
  const updateStationBody = useAppStore((s) => s.updateStationBody);
  const updateStationType = useAppStore((s) => s.updateStationType);
  const stationBodyOverrides = useAppStore((s) => s.stationBodyOverrides);
  const setStationBodyOverride = useAppStore((s) => s.setStationBodyOverride);

  const [showSettlements, setShowSettlements] = useState(true);
  const [renamingStation, setRenamingStation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingType, setEditingType] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) || 'installations';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [showDataSources, setShowDataSources] = useState(false);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  // Body names for the selector dropdown — merge journal-known bodies with Spansh
  // Journal bodies come from station.body fields; Spansh adds any the journal doesn't know

  const system = knownSystems[systemName.toLowerCase()];

  // Find projects in this system
  const systemProjects = useMemo(
    () => allProjects.filter((p) => p.systemName?.toLowerCase() === systemName.toLowerCase()),
    [allProjects, systemName]
  );
  const activeProjects = systemProjects.filter((p) => p.status === 'active');
  const completedProjects = systemProjects.filter((p) => p.status === 'completed');

  // Resolve id64/systemAddress — try knownSystems first, then projects, then systemAddressMap
  const systemAddress = useMemo(() => {
    if (system?.systemAddress) return system.systemAddress;
    // Check projects
    const fromProject = systemProjects.find((p) => p.systemAddress);
    if (fromProject?.systemAddress) return fromProject.systemAddress;
    // Check address map (reverse lookup)
    for (const [addr, name] of Object.entries(systemAddressMap)) {
      if (name.toLowerCase() === systemName.toLowerCase()) return Number(addr);
    }
    return null;
  }, [system, systemProjects, systemAddressMap, systemName]);

  const id64 = systemAddress;
  const scoutData = id64 ? scoutedSystems[id64] : undefined;

  // Build body names from journal-known stations first, then supplement from Spansh
  const [stationBodyMap, setStationBodyMap] = useState<Record<string, string>>({});
  const [spanshBodyNames, setSpanshBodyNames] = useState<string[]>([]);
  const [journalScannedBodyNames, setJournalScannedBodyNames] = useState<string[]>([]);

  // Phase 1: Extract body→station mapping from journal data (knownStations already has body field)
  const journalBodyMap = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const st of Object.values(knownStations)) {
      if (st.systemName.toLowerCase() === systemName.toLowerCase() && st.body) {
        mapping[st.stationName.toLowerCase()] = st.body;
      }
    }
    return mapping;
  }, [knownStations, systemName]);

  // Phase 2: Fetch body names — journal scans first, Spansh supplements
  useEffect(() => {
    let cancelled = false;

    async function fetchBodyData() {
      let journalCount = 0;

      // 2a: Try journal exploration data first
      try {
        const handle = getJournalFolderHandle();
        if (handle) {
          const explorationData = await extractExplorationData(handle);
          const addr = systemAddress || id64;
          const journalSystem = addr ? explorationData.get(addr) : undefined;

          if (journalSystem && journalSystem.scannedBodies.length > 0) {
            const converted = journalBodiesToSpanshFormat(journalSystem.scannedBodies, systemName);
            if (!cancelled) {
              const names = converted
                .filter((b) => b.type === 'Planet' || b.type === 'Star')
                .sort((a, b) => a.distanceToArrival - b.distanceToArrival)
                .map((b) => b.name);
              setJournalScannedBodyNames(names);
              journalCount = converted.length;

              // Also build station→body mapping from journal data
              const mapping: Record<string, string> = {};
              for (const body of converted) {
                if (body.stations) {
                  for (const st of body.stations) {
                    mapping[st.name.toLowerCase()] = body.name;
                  }
                }
              }
              // Merge with any Spansh mapping we get later (journal takes priority via spread order)
              setStationBodyMap((prev) => ({ ...prev, ...mapping }));
            }
          }
        }
      } catch { /* journal unavailable */ }

      // 2b: Fetch Spansh — supplements if it has more bodies
      if (id64 && !cancelled) {
        try {
          const dump = await fetchSystemDump(id64);
          if (!cancelled && dump?.bodies?.length > 0) {
            // Only use Spansh body names if they add beyond what journal has
            const names = dump.bodies
              .filter((b) => b.type === 'Planet' || b.type === 'Star')
              .sort((a, b) => a.distanceToArrival - b.distanceToArrival)
              .map((b) => b.name);
            setSpanshBodyNames(names);

            // Build station→body mapping from Spansh (only fills gaps — doesn't overwrite journal)
            const mapping: Record<string, string> = {};
            for (const body of dump.bodies) {
              if (body.stations) {
                for (const st of body.stations) {
                  const key = st.name.toLowerCase();
                  mapping[key] = body.name;
                  const prefixes = ['planetary construction site: ', 'orbital construction site: ', 'surface construction site: ', 'space construction site: '];
                  for (const prefix of prefixes) {
                    if (key.startsWith(prefix)) {
                      mapping[key.slice(prefix.length)] = body.name;
                    }
                  }
                }
              }
            }
            // Spansh mapping goes in first, journal overwrites on top (journal wins)
            setStationBodyMap((prev) => ({ ...mapping, ...prev }));
          }
        } catch { /* Spansh unavailable */ }
      }
    }

    fetchBodyData();
    return () => { cancelled = true; };
  }, [id64, systemAddress, systemName]);

  // Merge body names: journal docked bodies + journal scanned bodies + Spansh bodies
  const bodyNames = useMemo(() => {
    const nameSet = new Set<string>();
    // Journal station bodies (from docking)
    for (const body of Object.values(journalBodyMap)) {
      nameSet.add(body);
    }
    // Journal scanned bodies (from exploration)
    for (const name of journalScannedBodyNames) {
      nameSet.add(name);
    }
    // Spansh bodies supplement
    for (const name of spanshBodyNames) {
      nameSet.add(name);
    }
    // Filter out barycentres and belt clusters — not assignable bodies
    const filtered = Array.from(nameSet).filter((n) => {
      const lower = n.toLowerCase();
      return !lower.includes('barycentre') && !lower.includes('belt cluster');
    });
    return sortBodyNames(filtered, systemName);
  }, [journalBodyMap, journalScannedBodyNames, spanshBodyNames]);

  // Manual installations for this system
  const systemManualInstallations = useMemo(
    () => manualInstallations.filter((mi) => mi.systemName.toLowerCase() === systemName.toLowerCase()),
    [manualInstallations, systemName]
  );

  // FSS signals
  const systemSignals = useMemo(() => {
    if (!system) return [];
    return fssSignals.filter((s) => {
      if (s.systemAddress === system.systemAddress) return true;
      const mappedName = systemAddressMap[s.systemAddress];
      return mappedName?.toLowerCase() === systemName.toLowerCase();
    });
  }, [fssSignals, system, systemAddressMap, systemName]);

  // Merged installations list
  const systemStations = useMemo(() => {
    const allForSystem = Object.values(knownStations)
      .filter((s) => s.systemName.toLowerCase() === systemName.toLowerCase());
    const afterColShipFilter = allForSystem
      .filter((s) => !isColonisationShip(s.stationName, s.stationType));
    const afterConstructionFilter = afterColShipFilter
      .filter((s) => !isConstructionStationName(s.stationName));
    const stationsFromKB: DisplayStation[] = afterConstructionFilter
      .map((s) => ({ ...s, economies: s.economies ?? [], services: s.services ?? [] }));

    const existingMarketIds = new Set(stationsFromKB.map((s) => s.marketId));
    const existingNames = new Set(stationsFromKB.map((s) => s.stationName.toLowerCase()));

    // Fallback: also pull from visitedMarkets (persisted, reliable)
    // These are stations where the user has bought commodities
    const fromVisited: DisplayStation[] = visitedMarkets
      .filter((vm) => vm.systemName.toLowerCase() === systemName.toLowerCase())
      .filter((vm) => !existingMarketIds.has(vm.marketId))
      .filter((vm) => !isColonisationShip(vm.stationName, vm.stationType))
      .filter((vm) => !isConstructionStationName(vm.stationName))
      .map((vm) => ({
        stationName: vm.stationName,
        stationType: vm.stationType,
        marketId: vm.marketId,
        systemName: vm.systemName,
        systemAddress: 0,
        distFromStarLS: null,
        landingPads: null,
        economies: [] as StationEconomy[],
        services: [] as string[],
        lastSeen: vm.lastVisited,
      }));
    for (const s of fromVisited) {
      existingMarketIds.add(s.marketId);
      existingNames.add(s.stationName.toLowerCase());
    }

    const fromCompleted: DisplayStation[] = completedProjects
      .filter((p) => p.stationName || p.name || p.completedStationName)
      .filter((p) => !p.marketId || !existingMarketIds.has(p.marketId))
      .map((p) => {
        const name = p.completedStationName || stripConstructionPrefix(cleanProjectName(p.stationName || p.name));
        // Pull body/distFromStarLS/landingPads from knownStations if the construction-site
        // entry still exists there (its marketId won't appear in stationsFromKB because
        // construction-prefixed names are filtered out)
        const knownEntry = p.marketId ? knownStations[p.marketId] : undefined;
        return {
          stationName: name,
          stationType: resolveStationType(p.completedStationType, p.stationType),
          marketId: p.marketId || 0,
          systemName: p.systemName,
          systemAddress: p.systemAddress || 0,
          distFromStarLS: knownEntry?.distFromStarLS ?? null,
          landingPads: knownEntry?.landingPads ?? null,
          economies: knownEntry?.economies ?? ([] as StationEconomy[]),
          services: knownEntry?.services ?? ([] as string[]),
          body: knownEntry?.body,
          lastSeen: p.completedAt || p.lastUpdatedAt,
          _isFromCompletedProject: true,
          _projectId: p.id,
        };
      })
      // Skip entries that still look like colonisation ships — the real station
      // will appear via knownStations once the player docks at it
      .filter((s) => !isColonisationShip(s.stationName, s.stationType))
      .filter((s) => !existingNames.has(s.stationName.toLowerCase()));

    for (const s of fromCompleted) {
      existingNames.add(s.stationName.toLowerCase());
      if (s.marketId) existingMarketIds.add(s.marketId);
    }

    const fromManual: DisplayStation[] = systemManualInstallations
      .filter((mi) => !existingNames.has(mi.stationName.toLowerCase()))
      .map((mi) => ({
        stationName: mi.stationName,
        stationType: mi.stationType || 'Unknown',
        marketId: 0,
        systemName: mi.systemName,
        systemAddress: mi.systemAddress,
        distFromStarLS: null,
        landingPads: null,
        economies: [] as StationEconomy[],
        services: [] as string[],
        lastSeen: mi.createdAt,
        _isManualInstallation: true,
        _manualInstallationId: mi.id,
      }));

    for (const s of fromManual) {
      existingNames.add(s.stationName.toLowerCase());
    }

    const hiddenSet = new Set(hiddenInstallations);
    const fssStationsByName = new Map<string, FSSSignal>();
    for (const sig of systemSignals) {
      if (FSS_CARRIER_TYPES.has(sig.signalType)) continue;
      if (FC_NAME_PATTERN.test(sig.signalName)) continue;
      if (isConstructionStationName(sig.signalName)) continue;
      if (isColonisationShip(sig.signalName, '')) continue;
      if (!sig.isStation && !FSS_STATION_TYPES.has(sig.signalType)) continue;
      if (hiddenSet.has(`${systemName.toLowerCase()}|${sig.signalName.toLowerCase()}`)) continue;
      const key = sig.signalName.toLowerCase();
      const existing = fssStationsByName.get(key);
      if (!existing || sig.timestamp > existing.timestamp) {
        fssStationsByName.set(key, sig);
      }
    }
    const fromFSS: DisplayStation[] = Array.from(fssStationsByName.values())
      .filter((sig) => !existingNames.has(sig.signalName.toLowerCase()))
      .map((sig) => ({
        stationName: sig.signalName,
        stationType: sig.signalType || 'Unknown',
        marketId: 0,
        systemName: systemName,
        systemAddress: sig.systemAddress,
        distFromStarLS: null,
        landingPads: null,
        economies: [] as StationEconomy[],
        services: [] as string[],
        lastSeen: sig.timestamp,
        _isFromFSS: true,
      }));

    return [...stationsFromKB, ...fromVisited, ...fromCompleted, ...fromManual, ...fromFSS].sort((a, b) => {
      const aIsFC = isFleetCarrier(a.stationType, a.marketId) ? 1 : 0;
      const bIsFC = isFleetCarrier(b.stationType, b.marketId) ? 1 : 0;
      if (aIsFC !== bIsFC) return aIsFC - bIsFC;
      return (a.distFromStarLS ?? 999999) - (b.distFromStarLS ?? 999999);
    });
  }, [knownStations, visitedMarkets, systemName, completedProjects, systemManualInstallations, systemSignals, hiddenInstallations]);

  // Installation counts for hero
  const installationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const part of INSTALLATION_PARTS) counts[part.key] = 0;

    for (const st of systemStations) {
      if (isFleetCarrier(st.stationType, st.marketId)) continue;
      for (const part of INSTALLATION_PARTS) {
        if (part.types.has(st.stationType)) { counts[part.key]++; break; }
      }
    }
    return counts;
  }, [systemStations]);

  const totalInstalled = useMemo(
    () => systemStations.filter((s) => !isFleetCarrier(s.stationType, s.marketId)).length,
    [systemStations]
  );

  // Split visible vs settlements
  const visibleStations = useMemo(() => {
    let filtered = systemStations.filter((s) => showSettlements || shouldShowInOverview(s.stationType));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((s) => s.stationName.toLowerCase().includes(q));
    }
    return filtered;
  }, [systemStations, showSettlements, searchQuery]);
  const settlementCount = useMemo(
    () => systemStations.filter((s) => !shouldShowInOverview(s.stationType)).length,
    [systemStations]
  );

  // Construction signals
  const constructionSignals = useMemo(() => {
    const relevant = systemSignals.filter(
      (s) => s.signalName.includes('Construction') || s.signalType === 'Installation'
    );
    const byName = new Map<string, { signal: FSSSignal; count: number }>();
    for (const sig of relevant) {
      const existing = byName.get(sig.signalName);
      if (!existing) {
        byName.set(sig.signalName, { signal: sig, count: 1 });
      } else {
        existing.count++;
        if (sig.timestamp > existing.signal.timestamp) existing.signal = sig;
      }
    }
    return Array.from(byName.values());
  }, [systemSignals]);

  const knownInstallationNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of systemStations) names.add(s.stationName.toLowerCase());
    return names;
  }, [systemStations]);

  const signalResolution = useMemo(() => {
    const resolutions = new Map<string, { type: 'manual'; installationName: string; installationId: string } | { type: 'auto'; installationName: string }>();
    for (const mi of systemManualInstallations) {
      if (mi.sourceSignalName) {
        resolutions.set(mi.sourceSignalName, { type: 'manual', installationName: mi.stationName, installationId: mi.id });
      }
    }
    for (const { signal } of constructionSignals) {
      if (resolutions.has(signal.signalName)) continue;
      const stripped = stripConstructionPrefix(signal.signalName);
      if (stripped && knownInstallationNames.has(stripped.toLowerCase())) {
        resolutions.set(signal.signalName, { type: 'auto', installationName: stripped });
      }
    }
    return resolutions;
  }, [systemManualInstallations, constructionSignals, knownInstallationNames]);

  const [expandedStation, setExpandedStation] = useState<number | null>(null);

  // --- Handlers ---
  const handleAddAsInstallation = (signal: FSSSignal) => {
    const cleanName = stripConstructionPrefix(signal.signalName);
    const stationType = inferStationTypeFromSignal(signal.signalName);
    addManualInstallation({
      stationName: cleanName,
      systemName: systemName,
      systemAddress: signal.systemAddress,
      stationType,
      sourceSignalName: signal.signalName,
    });
  };

  const handleRemoveManualInstallation = (id: string) => removeManualInstallation(id);

  const handleChangeType = (station: DisplayStation, newType: string) => {
    if (station._isManualInstallation && station._manualInstallationId) {
      updateManualInstallation(station._manualInstallationId, { stationType: newType });
    } else if (station._isFromCompletedProject && station._projectId) {
      updateProject(station._projectId, { completedStationType: newType });
    } else if (station._isFromFSS) {
      addManualInstallation({
        stationName: station.stationName,
        systemName: systemName,
        systemAddress: station.systemAddress,
        stationType: newType,
        sourceSignalName: null,
      });
      hideInstallation(systemName, station.stationName);
    } else if (station.marketId && station.marketId !== 0) {
      // Real known station from journal — update type override
      updateStationType(station.marketId, newType, {
        stationName: station.stationName,
        systemName: systemName,
        systemAddress: station.systemAddress,
      });
    }
    setEditingType(null);
  };

  const handleHideFSSInstallation = (stationName: string) => hideInstallation(systemName, stationName);

  const handleSetBody = (station: DisplayStation, body: string) => {
    // Try knownStations first (by marketId), fall back to name-based overrides
    if (station.marketId && station.marketId !== 0) {
      const exists = knownStations[station.marketId];
      if (exists) {
        updateStationBody(station.marketId, body);
        return;
      }
    }
    // Fallback for stations not in knownStations (completed projects, FSS, manual, etc.)
    setStationBodyOverride(systemName, station.stationName, body);
  };

  const handleStartRename = (station: DisplayStation) => {
    setRenamingStation(station.stationName);
    setRenameValue(station.stationName);
  };

  const handleConfirmRename = (station: DisplayStation) => {
    const newName = renameValue.trim();
    if (!newName || newName === station.stationName) { setRenamingStation(null); return; }
    if (station._isManualInstallation && station._manualInstallationId) {
      updateManualInstallation(station._manualInstallationId, { stationName: newName });
    } else if (station._isFromCompletedProject && station._projectId) {
      updateProject(station._projectId, { completedStationName: newName });
    } else if (station._isFromFSS) {
      addManualInstallation({ stationName: newName, systemName, systemAddress: station.systemAddress, stationType: station.stationType, sourceSignalName: null });
      hideInstallation(systemName, station.stationName);
    }
    setRenamingStation(null);
  };

  if (!systemName) {
    return (
      <div className="py-10 text-center">
        <p className="text-muted-foreground">No system specified.</p>
        <Link to="/" className="text-primary hover:underline mt-2 inline-block">{'\u2190'} Back to Dashboard</Link>
      </div>
    );
  }

  // --- Hero data ---
  const tier = getSystemTier(totalInstalled);
  const progress = getTierProgress(totalInstalled);
  const scoutScore = scoutData?.score?.total ?? null;
  const bodyString = scoutData?.bodyString;
  const bodyCount = system?.bodyCount || scoutData?.score?.bodyCount;

  return (
    <div>
      {/* Hero Header */}
      <div className={`mb-6 rounded-xl border-2 ${tier.borderClass} ${tier.bgGradient} p-6`}>
        <div className="flex items-center gap-3 mb-3">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">{'\u2190'} Dashboard</Link>
          <Link to={`/system-view?system=${encodeURIComponent(systemName)}`} className="text-sm text-cyan-400 hover:text-cyan-300">{'\u2604\uFE0F'} System View</Link>
        </div>

        {/* Top row: tier badge + name + score */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold ${tier.badgeBg} ${tier.badgeText}`}>
              <span>{tier.icon}</span>
              <span>{tier.label}</span>
            </span>
            <div>
              <h2 className="text-2xl font-bold text-foreground">{systemName}</h2>
              {system && (
                <div className="flex items-center gap-3 mt-1 text-sm">
                  {system.economy && system.economy !== 'Unknown' && (
                    <span className="text-primary">
                      {system.economy}
                      {system.secondEconomy && <span className="text-muted-foreground"> / {system.secondEconomy}</span>}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {scoutScore !== null ? (
            <div className="text-right">
              <span className={`text-3xl font-bold ${scoutScore === 0 ? 'text-muted-foreground' : scoreColorClass(scoutScore)}`}>{scoutScore}</span>
              <div className="text-xs text-muted-foreground">{scoutScore === 0 ? 'No qualifying bodies' : 'Scout Score'}</div>
            </div>
          ) : (
            <div className="text-right">
              <span className="text-3xl font-bold text-muted-foreground" title="Not scored yet — click Score Colonies on dashboard">?</span>
              <div className="text-xs text-muted-foreground">Not scored</div>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-4 text-sm mb-3">
          <EditablePopulation systemName={systemName} journalPopulation={system?.population ?? 0} />
          {system?.visitCount != null && system.visitCount > 0 && (
            <span className="text-muted-foreground" title={`Jumped into this system ${system.visitCount} time${system.visitCount !== 1 ? 's' : ''}`}>
              {'\u{1F6EC}'} <span className="text-foreground font-medium">{system.visitCount} visits</span>
            </span>
          )}
          {bodyCount != null && bodyCount > 0 && (
            <span className="text-muted-foreground">
              Bodies: <span className="text-foreground font-medium">{bodyCount}</span>
            </span>
          )}
          {system?.coordinates && (
            <span className="text-muted-foreground/60 text-xs">
              ({system.coordinates.x.toFixed(1)}, {system.coordinates.y.toFixed(1)}, {system.coordinates.z.toFixed(1)})
            </span>
          )}
          {/* Data source indicator */}
          <button
            onClick={() => setShowDataSources((v) => !v)}
            className="text-muted-foreground/40 text-xs hover:text-muted-foreground transition-colors ml-auto"
            title="Show data sources"
          >
            {'\u{1F50D}'} data
          </button>
        </div>
        {/* Data source debug panel */}
        {showDataSources && (
          <div className="mb-3 text-[11px] bg-black/30 rounded-lg px-3 py-2 font-mono text-muted-foreground/70 space-y-0.5">
            <div><span className="text-muted-foreground">knownSystem:</span> addr={system?.systemAddress ?? 'none'} coords={system?.coordinates ? 'yes' : 'NO'} pop={system?.population ?? '?'} econ={system?.economy ?? '?'} body#={system?.bodyCount ?? '?'} visits={system?.visitCount ?? '?'} seen={system?.lastSeen?.slice(0, 10) ?? '?'}</div>
            <div><span className="text-muted-foreground">scoutedSystem:</span> {scoutData ? `score=${scoutData.score.total} bodies=${scoutData.score.bodyCount} fromJournal=${scoutData.fromJournal ?? false} coords=${scoutData.coordinates ? 'yes' : 'no'} cachedBodies=${scoutData.cachedBodies?.length ?? 0}` : 'none'}</div>
            <div><span className="text-muted-foreground">commanderPos:</span> {commanderPosition ? `${commanderPosition.systemName} (${commanderPosition.coordinates.x.toFixed(1)}, ${commanderPosition.coordinates.y.toFixed(1)}, ${commanderPosition.coordinates.z.toFixed(1)})` : 'unknown'}</div>
          </div>
        )}

        {/* Body string (scouting compact view) — hide if it's just dashes (no qualifying bodies) */}
        {bodyString && !/^\S+:\s*\u2014$/.test(bodyString.trim()) && bodyString.trim() !== '\u2014' && (
          <div className="mb-3 text-sm bg-black/20 rounded-lg px-3 py-2 font-mono">
            {bodyString}
          </div>
        )}

        {/* Installation icons */}
        <div className="flex flex-wrap gap-3 items-center mb-3">
          {INSTALLATION_PARTS.map(({ key, icon, label }) => {
            const count = installationCounts[key];
            if (count === 0) return null;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground"
                title={`${count} ${label}${count > 1 ? 's' : ''}`}
              >
                <span>{icon}</span>
                <span className="font-medium text-foreground">{count}</span>
                <span className="text-xs">{label}{count > 1 ? 's' : ''}</span>
              </span>
            );
          })}
          {activeProjects.length > 0 && (
            <span className="inline-flex items-center gap-1 text-sm text-primary" title={`${activeProjects.length} under construction`}>
              <span>{'\u{1F6A7}'}</span>
              <span className="font-medium">{activeProjects.length}</span>
              <span className="text-xs">under construction</span>
            </span>
          )}
        </div>

        {/* Tier progress bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {progress.isMaxTier ? (
                <span className="text-amber-400 font-medium">{tier.icon} Max Tier</span>
              ) : (
                <>{totalInstalled}/{progress.nextThreshold} installations to {progress.nextLabel}</>
              )}
            </span>
            <span className="text-muted-foreground font-medium">Tier {tier.tier}: {tier.label}</span>
          </div>
          <div className="w-full bg-black/30 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.min(progress.progress * 100, 100)}%`,
                background: progress.isMaxTier
                  ? 'linear-gradient(90deg, #f59e0b, #f97316)'
                  : 'var(--color-secondary)',
              }}
            />
          </div>
        </div>

        {/* System gallery */}
        <div className="mt-4">
          <ImageGallery galleryKey={galleryKey(systemName)} title={`${'\u{1F4F7}'} System Screenshots`} />
        </div>

        {!system && (
          <p className="text-sm text-muted-foreground mt-3">
            No journal data available for this system yet. Sync from journal to populate.
          </p>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('installations')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'installations'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {'\u{1F6F0}'} Installations ({systemStations.length})
        </button>
        <button
          onClick={() => setActiveTab('bodies')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'bodies'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {'\u{1F30D}'} Bodies {bodyCount ? `(${bodyCount})` : ''}
        </button>
        <button
          onClick={() => setActiveTab('expansion')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'expansion'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {'\u{1F52D}'} Nearby Candidates
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'expansion' ? (
        <NearbyExpansionTab
          systemName={systemName}
          refCoords={system?.coordinates ?? scoutData?.coordinates ?? (id64 ? journalExplorationCache[id64]?.coordinates : null) ?? systemProjects.find(p => p.systemInfo?.coordinates)?.systemInfo?.coordinates ?? null}
        />
      ) : activeTab === 'installations' ? (
        <InstallationsTab
          systemName={systemName}
          visibleStations={visibleStations}
          systemStations={systemStations}
          settlementCount={settlementCount}
          showSettlements={showSettlements}
          setShowSettlements={setShowSettlements}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          expandedStation={expandedStation}
          setExpandedStation={setExpandedStation}
          renamingStation={renamingStation}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          editingType={editingType}
          setEditingType={setEditingType}
          settings={settings}
          activeProjects={activeProjects}
          constructionSignals={constructionSignals}
          signalResolution={signalResolution}
          onStartRename={handleStartRename}
          onConfirmRename={handleConfirmRename}
          onChangeType={handleChangeType}
          onHideFSS={handleHideFSSInstallation}
          onAddAsInstallation={handleAddAsInstallation}
          onRemoveManual={handleRemoveManualInstallation}
          setRenamingStation={setRenamingStation}
          bodyNames={bodyNames}
          onSetBody={handleSetBody}
          stationBodyMap={stationBodyMap}
          journalBodyMap={journalBodyMap}
          stationBodyOverrides={stationBodyOverrides}
        />
      ) : (
        <SystemBodiesTab
          systemName={systemName}
          id64={id64}
          systemAddress={systemAddress}
        />
      )}
    </div>
  );
}

// --- Installations Tab (extracted from original page) ---
interface InstallationsTabProps {
  systemName: string;
  visibleStations: DisplayStation[];
  systemStations: DisplayStation[];
  settlementCount: number;
  showSettlements: boolean;
  setShowSettlements: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  expandedStation: number | null;
  setExpandedStation: (v: number | null) => void;
  renamingStation: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  editingType: string | null;
  setEditingType: (v: string | null) => void;
  settings: { myFleetCarrier: string; squadronCarrierCallsigns: string[] };
  activeProjects: { id: string; name: string; stationName: string; stationType: string; commodities: { requiredQuantity: number; providedQuantity: number }[] }[];
  constructionSignals: { signal: FSSSignal; count: number }[];
  signalResolution: Map<string, { type: 'manual'; installationName: string; installationId: string } | { type: 'auto'; installationName: string }>;
  onStartRename: (station: DisplayStation) => void;
  onConfirmRename: (station: DisplayStation) => void;
  onChangeType: (station: DisplayStation, newType: string) => void;
  onHideFSS: (stationName: string) => void;
  onAddAsInstallation: (signal: FSSSignal) => void;
  onRemoveManual: (id: string) => void;
  setRenamingStation: (v: string | null) => void;
  bodyNames: string[];
  onSetBody: (station: DisplayStation, body: string) => void;
  stationBodyMap: Record<string, string>;
  journalBodyMap: Record<string, string>;
  stationBodyOverrides: Record<string, string>;
}

type SortKey = 'name' | 'type' | 'body' | 'dist' | 'pads' | 'economy' | 'visits' | 'lastSeen';
type SortDir = 'asc' | 'desc';

function InstallationsTab({
  systemName,
  visibleStations,
  systemStations,
  settlementCount,
  showSettlements,
  setShowSettlements,
  searchQuery,
  setSearchQuery,
  expandedStation,
  setExpandedStation,
  renamingStation,
  renameValue,
  setRenameValue,
  editingType,
  setEditingType,
  settings,
  activeProjects,
  constructionSignals,
  signalResolution,
  onStartRename,
  onConfirmRename,
  onChangeType,
  onHideFSS,
  onAddAsInstallation,
  onRemoveManual,
  setRenamingStation,
  bodyNames,
  onSetBody,
  stationBodyMap,
  journalBodyMap,
  stationBodyOverrides,
}: InstallationsTabProps) {
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const resolveBody = (station: DisplayStation) => {
    const overrideKey = `${systemName.toLowerCase()}|${station.stationName.toLowerCase()}`;
    return station.body || journalBodyMap[station.stationName.toLowerCase()] || stationBodyMap[station.stationName.toLowerCase()] || stationBodyOverrides[overrideKey] || '';
  };

  const sortedStations = useMemo(() => {
    const arr = [...visibleStations];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.stationName.localeCompare(b.stationName);
        case 'type': return dir * a.stationType.localeCompare(b.stationType);
        case 'body': return dir * resolveBody(a).localeCompare(resolveBody(b));
        case 'dist': {
          const aDist = a.distFromStarLS ?? 9999999;
          const bDist = b.distFromStarLS ?? 9999999;
          return dir * (aDist - bDist);
        }
        case 'pads': {
          const aL = a.landingPads?.large ?? 0;
          const bL = b.landingPads?.large ?? 0;
          return dir * (aL - bL || (a.landingPads?.medium ?? 0) - (b.landingPads?.medium ?? 0));
        }
        case 'economy': {
          const aE = a.economies?.[0]?.nameLocalised ?? '';
          const bE = b.economies?.[0]?.nameLocalised ?? '';
          return dir * aE.localeCompare(bE);
        }
        case 'visits': return dir * ((a.visitCount ?? 0) - (b.visitCount ?? 0));
        case 'lastSeen': return dir * (a.lastSeen || '').localeCompare(b.lastSeen || '');
        default: return 0;
      }
    });
    return arr;
  }, [visibleStations, sortKey, sortDir, systemName, journalBodyMap, stationBodyMap, stationBodyOverrides]);

  const SortHeader = ({ label, sortId, align = 'left' }: { label: string; sortId: SortKey; align?: 'left' | 'right' | 'center' }) => (
    <th
      className={`text-${align} px-4 py-3 cursor-pointer select-none hover:text-foreground transition-colors`}
      onClick={() => toggleSort(sortId)}
    >
      {label} {sortKey === sortId ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
    </th>
  );

  return (
    <>
      {/* Installations Table */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-muted-foreground">
              Known Installations ({systemStations.length})
            </h3>
            {systemStations.length > 5 && (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-36"
              />
            )}
          </div>
          {settlementCount > 0 && (
            <button
              onClick={() => setShowSettlements(!showSettlements)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showSettlements ? 'Hide' : 'Show'} {settlementCount} settlement{settlementCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
        {visibleStations.length > 0 ? (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <SortHeader label="Installation" sortId="name" />
                  <SortHeader label="Type" sortId="type" />
                  <SortHeader label="Body" sortId="body" />
                  <SortHeader label="Dist (Ls)" sortId="dist" align="right" />
                  <SortHeader label="Pads" sortId="pads" align="center" />
                  <SortHeader label="Economy" sortId="economy" />
                  <SortHeader label="Visits" sortId="visits" align="center" />
                  <SortHeader label="Last Seen" sortId="lastSeen" align="right" />
                  <th className="text-right px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {sortedStations.map((station, idx) => {
                  const isExpanded = expandedStation === station.marketId && station.marketId !== 0;
                  const isSynthetic = station._isManualInstallation || station._isFromFSS;
                  const canExpand = station.marketId !== 0 && !station._isFromFSS;
                  const fcOwnership = isFleetCarrier(station.stationType, station.marketId)
                    ? (settings.myFleetCarrier && station.stationName === settings.myFleetCarrier ? 'mine'
                      : settings.squadronCarrierCallsigns.includes(station.stationName) ? 'squadron'
                      : 'other')
                    : null;

                  return (
                    <Fragment key={station.marketId || `synthetic-${idx}`}>
                      {/* Summary row */}
                      <tr
                        className={`border-t border-border/50 hover:bg-muted/30 cursor-pointer ${isExpanded ? 'bg-muted/20' : ''}`}
                        onClick={() => canExpand && setExpandedStation(isExpanded ? null : station.marketId)}
                      >
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            {renamingStation === station.stationName ? (
                              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); onConfirmRename(station); }}>
                                <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                                  className="bg-muted border border-border rounded px-2 py-0.5 text-sm text-foreground w-48" autoFocus
                                  onBlur={() => setRenamingStation(null)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setRenamingStation(null); }} />
                                <button type="submit" className="text-xs text-progress-complete hover:underline" onMouseDown={(e) => e.preventDefault()}>{'\u2713'}</button>
                              </form>
                            ) : (
                              <span className="font-medium text-foreground">{station.stationName}</span>
                            )}
                            {fcOwnership === 'mine' && <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">My FC</span>}
                            {fcOwnership === 'squadron' && <span className="text-xs bg-secondary/20 text-secondary px-1.5 py-0.5 rounded">Squadron</span>}
                          </div>
                          {station.faction && <div className="text-xs text-muted-foreground mt-0.5">{station.faction}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {editingType === station.stationName ? (
                            <select value={station.stationType} onChange={(e) => onChangeType(station, e.target.value)}
                              onBlur={() => setEditingType(null)} autoFocus
                              className="bg-muted border border-border rounded px-1 py-0.5 text-xs text-foreground focus:outline-none focus:border-primary">
                              <optgroup label="Orbital">
                                {INSTALLATION_TYPE_OPTIONS.filter((t) => t.group === 'Orbital').map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                              </optgroup>
                              <optgroup label="Surface">
                                {INSTALLATION_TYPE_OPTIONS.filter((t) => t.group === 'Surface').map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                              </optgroup>
                            </select>
                          ) : (
                            <span className="cursor-pointer hover:text-primary"
                              onClick={(e) => { e.stopPropagation(); setEditingType(station.stationName); }}
                              title="Click to change type">
                              <StationTypeIcon stationType={station.stationType} showLabel />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {(() => {
                            const isFC = isFleetCarrier(station.stationType, station.marketId);
                            // Fleet carriers move around — don't show body assignment
                            if (isFC) return <span className="text-muted-foreground/40 text-xs">—</span>;
                            const overrideKey = `${systemName.toLowerCase()}|${station.stationName.toLowerCase()}`;
                            const resolvedBody = resolveBody(station);
                            if (editingBody === station.stationName && bodyNames.length > 0) {
                              return (
                                <select
                                  value={resolvedBody}
                                  onChange={(e) => { e.stopPropagation(); if (e.target.value) onSetBody(station, e.target.value); setEditingBody(null); }}
                                  onBlur={() => setEditingBody(null)}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                  className="bg-muted border border-border rounded px-1 py-0.5 text-xs text-foreground focus:outline-none focus:border-primary max-w-[140px]"
                                >
                                  <option value="">Assign body...</option>
                                  {bodyNames.map((name) => (
                                    <option key={name} value={name}>{shortenBodyForDropdown(name, systemName)}</option>
                                  ))}
                                </select>
                              );
                            }
                            if (resolvedBody) {
                              return (
                                <span
                                  className={`font-medium cursor-pointer hover:text-primary ${station.body ? 'text-foreground' : 'text-primary/70'}`}
                                  onClick={(e) => { e.stopPropagation(); setEditingBody(station.stationName); }}
                                  title="Click to change body"
                                >{capitalizeBodyName(resolvedBody)}</span>
                              );
                            }
                            if (bodyNames.length > 0) {
                              return (
                                <span
                                  className="text-muted-foreground/60 cursor-pointer hover:text-primary text-xs"
                                  onClick={(e) => { e.stopPropagation(); setEditingBody(station.stationName); }}
                                >Assign...</span>
                              );
                            }
                            return <span className="text-muted-foreground/40">-</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {station.distFromStarLS !== null ? station.distFromStarLS.toFixed(1) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          {station.landingPads ? (
                            <span className="font-mono text-xs">
                              <span title="Large pads" className="text-primary">L:{station.landingPads.large}</span>{' '}
                              <span title="Medium pads">M:{station.landingPads.medium}</span>{' '}
                              <span title="Small pads" className="text-muted-foreground">S:{station.landingPads.small}</span>
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {station.economies.length > 0 ? (
                            <span>
                              {station.stationType === 'OnFootSettlement' && (
                                <span className="text-primary/70 text-xs mr-1">
                                  {(station.economies[0].nameLocalised || station.economies[0].name).replace(/\$economy_|\;/g, '')}
                                </span>
                              )}
                              {station.stationType !== 'OnFootSettlement' && (station.economies[0].nameLocalised || station.economies[0].name)}
                              {station.stationType === 'OnFootSettlement' && 'Settlement'}
                            </span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          {station.visitCount && station.visitCount > 0 ? (
                            <span className="text-foreground font-medium">{station.visitCount}</span>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {station.lastSeen ? new Date(station.lastSeen).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(station._isFromFSS || station._isManualInstallation || station._isFromCompletedProject) && (
                              <button onClick={(e) => { e.stopPropagation(); onStartRename(station); }}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Rename installation">
                                {'\u270E'}
                              </button>
                            )}
                            {station._isManualInstallation && station._manualInstallationId && (
                              <button onClick={(e) => { e.stopPropagation(); if (confirm('Remove this installation?')) onRemoveManual(station._manualInstallationId!); }}
                                className="text-xs text-destructive/50 hover:text-destructive transition-colors" title="Remove installation">
                                {'\u2715'}
                              </button>
                            )}
                            {station._isFromFSS && (
                              <button onClick={(e) => { e.stopPropagation(); if (confirm('Hide this installation?')) onHideFSS(station.stationName); }}
                                className="text-xs text-destructive/50 hover:text-destructive transition-colors" title="Hide this installation">
                                {'\u2715'}
                              </button>
                            )}
                            {canExpand && (
                              <span className="text-xs text-muted-foreground/50">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr className="bg-muted/10 border-t-0" onClick={(e) => e.stopPropagation()}>
                          <td colSpan={9} className="px-0 py-0">
                            <div className="border-t border-primary/20 mx-4" />
                            <div className="px-6 py-5">
                              {/* Station header + location bar */}
                              <div className="flex flex-wrap items-start gap-4 mb-4">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <StationTypeIcon stationType={station.stationType} className="text-xl" />
                                  <div>
                                    <h4 className="text-base font-bold text-foreground">{station.stationName}</h4>
                                    {station.faction && <div className="text-xs text-muted-foreground">{station.faction}</div>}
                                  </div>
                                </div>

                                {/* Location info — prominent */}
                                <div className="flex flex-wrap items-center gap-3">
                                  {(() => {
                                    const detailBody = resolveBody(station);
                                    if (!detailBody) return null;
                                    const isFromSpansh = !station.body && !journalBodyMap[station.stationName.toLowerCase()] && !stationBodyOverrides[`${systemName.toLowerCase()}|${station.stationName.toLowerCase()}`];
                                    return (
                                      <div className="bg-primary/10 border border-primary/30 rounded-lg px-3 py-1.5 text-sm">
                                        <span className="text-muted-foreground text-xs">Body </span>
                                        <span className="text-primary font-bold">{capitalizeBodyName(detailBody)}</span>
                                        {isFromSpansh && <span className="text-muted-foreground/50 text-xs ml-1">(Spansh)</span>}
                                      </div>
                                    );
                                  })()}
                                  {(() => {
                                    const dist = station.distFromStarLS;
                                    if (dist === null) return null;
                                    return (
                                      <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                                        <span className="text-foreground font-bold">{dist.toFixed(1)}</span>
                                        <span className="text-muted-foreground text-xs"> Ls</span>
                                      </div>
                                    );
                                  })()}
                                  {station.landingPads && (
                                    <div className="bg-card border border-border rounded-lg px-3 py-1.5 font-mono text-sm">
                                      <span className="text-primary font-bold">{station.landingPads.large}L</span>
                                      {' '}<span className="text-foreground">{station.landingPads.medium}M</span>
                                      {' '}<span className="text-muted-foreground">{station.landingPads.small}S</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {(() => {
                                const resolved = resolveBody(station);
                                if (resolved && bodyNames.length === 0) return null;
                                if (!resolved && bodyNames.length === 0) return null;
                                return (
                                  <div className="mb-4 flex items-center gap-3">
                                    {!resolved && <span className="text-xs text-muted-foreground/60 italic">Body unknown</span>}
                                    {bodyNames.length > 0 && (
                                      <select
                                        value={resolved}
                                        onChange={(e) => { if (e.target.value) onSetBody(station, e.target.value); }}
                                        className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                                      >
                                        <option value="">Assign body...</option>
                                        {bodyNames.map((name) => (
                                          <option key={name} value={name}>{shortenBodyForDropdown(name, systemName)}</option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })()}

                              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                {/* Gallery — takes most of the space */}
                                <div className="md:col-span-7">
                                  <ImageGallery galleryKey={galleryKey(systemName, 'station', station.stationName)} />
                                </div>

                                {/* Economy + Services — condensed sidebar */}
                                <div className="md:col-span-5 space-y-3">
                                  {station.economies.length > 0 && (() => {
                                    const totalProportion = station.economies.reduce((s, e) => s + e.proportion, 0);
                                    const scale = totalProportion > 0 ? 1 / totalProportion : 1;
                                    return (
                                      <div>
                                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">Economy</div>
                                        <div className="space-y-1">
                                          {station.economies.map((econ, i) => {
                                            const pct = econ.proportion * scale * 100;
                                            return (
                                              <div key={i} className="flex items-center gap-2">
                                                <span className="text-xs text-foreground flex-1 truncate">{econ.nameLocalised || econ.name}</span>
                                                <div className="w-16 bg-muted rounded-full h-1">
                                                  <div className="h-1 rounded-full bg-primary transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                                                </div>
                                                <span className="text-xs text-muted-foreground w-7 text-right">{pct.toFixed(0)}%</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {station.services.length > 0 && (
                                    <div>
                                      <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                                        Services ({station.services.length})
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {station.services.map((svc) => (
                                          <span key={svc} className="text-[10px] bg-card border border-border/50 px-1.5 py-0.5 rounded text-muted-foreground">
                                            {formatServiceName(svc)}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="text-xs text-muted-foreground/60">
                                    Market ID: <span className="font-mono">{station.marketId}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
            No installations discovered yet. Dock at installations in this system and sync from journal.
          </div>
        )}
      </div>

      {/* Active Construction Projects */}
      {activeProjects.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-muted-foreground mb-3">
            Active Construction ({activeProjects.length})
          </h3>
          <div className="space-y-2">
            {activeProjects.map((project) => {
              const totalReq = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
              const totalProv = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
              const pct = totalReq > 0 ? totalProv / totalReq : 0;
              return (
                <Link key={project.id} to={`/projects/${project.id}`}
                  className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {project.stationType && <StationTypeIcon stationType={project.stationType} />}
                    <div>
                      <span className="text-sm font-medium text-foreground">{cleanProjectName(project.name)}</span>
                      <span className="text-xs text-primary ml-2">{'\u{1F6A7}'} Active</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-muted rounded-full h-2">
                      <div className="h-2 rounded-full" style={{
                        width: `${Math.min(pct * 100, 100)}%`,
                        backgroundColor: pct >= 1 ? 'var(--color-progress-complete)' : pct >= 0.75 ? 'var(--color-progress-high)' : pct >= 0.25 ? 'var(--color-progress-mid)' : 'var(--color-progress-low)',
                      }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">{(pct * 100).toFixed(0)}%</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Construction Signals */}
      {constructionSignals.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-muted-foreground mb-3">
            Construction Signals ({constructionSignals.length})
          </h3>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th className="text-left px-4 py-3">Signal</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-right px-4 py-3">Last Seen</th>
                  <th className="text-right px-4 py-3 w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {constructionSignals.map(({ signal, count }, i) => {
                  const resolution = signalResolution.get(signal.signalName);
                  const isResolved = !!resolution;
                  return (
                    <tr key={i} className={`border-t border-border/50 ${isResolved ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2 text-sm">
                        <span className="text-primary mr-1">{'\u{1F6E0}'}</span>
                        {signal.signalName}
                        {count > 1 && <span className="text-xs text-muted-foreground ml-2">({count} scans)</span>}
                        {resolution && (
                          <span className="text-xs text-progress-complete ml-2">
                            {'\u2192'} {resolution.installationName}
                            {resolution.type === 'auto' && <span className="text-muted-foreground ml-1">(auto)</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{signal.signalType || '-'}</td>
                      <td className="px-4 py-2 text-sm text-right text-muted-foreground">{new Date(signal.timestamp).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-sm text-right">
                        {resolution?.type === 'manual' ? (
                          <button onClick={() => { if (confirm('Remove this mapping?')) onRemoveManual(resolution.installationId); }}
                            className="text-xs text-destructive/50 hover:text-destructive transition-colors" title="Remove mapping">
                            {'\u2715'} Remove
                          </button>
                        ) : resolution?.type === 'auto' ? (
                          <span className="text-xs text-progress-complete">{'\u2713'} Matched</span>
                        ) : (
                          <button onClick={() => onAddAsInstallation(signal)} className="text-xs text-primary hover:underline">+ Add as Installation</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
