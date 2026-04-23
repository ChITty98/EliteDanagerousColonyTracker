import { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { computeLiveTons, computeDeliveryRate, formatDuration } from '@/lib/sessionUtils';
import { COMMODITIES, CATEGORY_ORDER, CATEGORY_LABELS, type CommodityCategory } from '@/data/commodities';
import { formatNumber, formatPercent, cleanProjectName, stripConstructionPrefix, cleanJournalString } from '@/lib/utils';
import { isColonisationShip } from '@/services/journalReader';
import { StationTypeIcon } from '@/components/StationTypeIcon';
import { resolveStationType, EDITABLE_STATION_TYPES } from '@/data/stationTypes';
import { INSTALLATION_TYPE_OPTIONS } from '@/data/installationTypes';
import {
  scanForMarketId,
  isFileSystemAccessSupported,
  readShipCargo,
  estimateCarrierCargo,
  getJournalFolderHandle,
  selectJournalFolder,
  extractKnowledgeBase,
  readMarketJson,
  type ShipCargo,
  type MultiCarrierCargo,
} from '@/services/journalReader';
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const project = useAppStore((s) => s.projects.find((p) => p.id === id));
  const updateCommodity = useAppStore((s) => s.updateCommodity);
  const updateProject = useAppStore((s) => s.updateProject);
  const completeProject = useAppStore((s) => s.completeProject);
  const reactivateProject = useAppStore((s) => s.reactivateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);
  const settings = useAppStore((s) => s.settings);
  const carrierCargoStore = useAppStore((s) => s.carrierCargo);
  const setCarrierCargoStore = useAppStore((s) => s.setCarrierCargo);

  const visitedMarkets = useAppStore((s) => s.visitedMarkets);
  const marketSnapshots = useAppStore((s) => s.marketSnapshots);
  const liveShipCargo = useAppStore((s) => s.liveShipCargo);

  // Compute best source per commodity from visited markets + market snapshots
  const bestSources = useMemo(() => {
    if (!project) return {};
    const projectSystem = project.systemName?.toLowerCase();
    const projectCoords = projectSystem ? knownSystems[projectSystem]?.coordinates : null;
    const result: Record<string, { stationName: string; systemName: string; hasLargePads: boolean; isPlanetary: boolean; stock?: number; buyPrice?: number; lastSeen: string }> = {};

    // Distance penalty: closer stations score higher
    const distancePenalty = (systemName?: string): number => {
      if (!projectCoords || !systemName) return 0;
      const srcSys = knownSystems[systemName.toLowerCase()];
      if (!srcSys?.coordinates) return 0;
      const dx = projectCoords.x - srcSys.coordinates.x;
      const dy = projectCoords.y - srcSys.coordinates.y;
      const dz = projectCoords.z - srcSys.coordinates.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Penalty: -100 per ly of distance (a 700ly station loses 70,000 points)
      return -Math.round(dist * 100);
    };

    for (const c of project.commodities) {
      const remaining = c.requiredQuantity - c.providedQuantity;
      if (remaining <= 0) continue;

      let best: (typeof result)[string] | null = null;
      let bestScore = -1;

      // Check market snapshots (have stock data) — skip own FC (it's inventory, not a source)
      for (const snap of Object.values(marketSnapshots)) {
        if (settings.myFleetCarrierMarketId && snap.marketId === settings.myFleetCarrierMarketId) continue;
        if (settings.myFleetCarrier && snap.stationName.toUpperCase() === settings.myFleetCarrier.toUpperCase()) continue;
        const item = snap.commodities.find((m) => m.commodityId === c.commodityId);
        if (!item || item.stock < 1 || item.buyPrice <= 0) continue;
        // Score: prefer high stock, nearby, same system, large pads
        let score = Math.min(item.stock, 10000);
        if (snap.systemName?.toLowerCase() === projectSystem) score += 50000;
        if (snap.hasLargePads) score += 5000;
        score += distancePenalty(snap.systemName);
        if (score > bestScore) {
          bestScore = score;
          best = {
            stationName: cleanJournalString(snap.stationName),
            systemName: snap.systemName,
            hasLargePads: snap.hasLargePads,
            isPlanetary: snap.isPlanetary,
            stock: item.stock,
            buyPrice: item.buyPrice,
            lastSeen: snap.updatedAt,
          };
        }
      }

      // Check visited markets (may not have stock, but have price info) — skip own FC
      for (const vm of visitedMarkets) {
        if (settings.myFleetCarrierMarketId && vm.marketId === settings.myFleetCarrierMarketId) continue;
        if (settings.myFleetCarrier && vm.stationName.toUpperCase() === settings.myFleetCarrier.toUpperCase()) continue;
        if (!vm.commodities.includes(c.commodityId)) continue;
        const priceInfo = vm.commodityPrices[c.commodityId];
        if (priceInfo && priceInfo.buyPrice <= 0) continue; // Not actually for sale
        let score = 1000; // base score for having the commodity
        if (vm.systemName?.toLowerCase() === projectSystem) score += 50000;
        if (vm.hasLargePads) score += 5000;
        if (priceInfo) score += 2000; // has price data
        score += distancePenalty(vm.systemName);
        if (score > bestScore) {
          bestScore = score;
          best = {
            stationName: cleanJournalString(vm.stationName),
            systemName: vm.systemName,
            hasLargePads: vm.hasLargePads,
            isPlanetary: vm.isPlanetary,
            buyPrice: priceInfo?.buyPrice,
            lastSeen: priceInfo?.lastSeen || vm.lastVisited,
          };
        }
      }

      if (best) result[c.commodityId] = best;
    }
    return result;
  }, [project, visitedMarkets, marketSnapshots, settings.myFleetCarrierMarketId]);

  const [editingCell, setEditingCell] = useState<{ commodityId: string; field: 'requiredQuantity' | 'providedQuantity' | 'remaining' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Ship cargo state — merges manual load with live watcher updates
  const [manualShipCargo, setManualShipCargo] = useState<ShipCargo | null>(null);
  const [loadingShipCargo, setLoadingShipCargo] = useState(false);
  const [showShipCargo, setShowShipCargo] = useState(false);
  // Use whichever is newer: manual load or live watcher data
  const shipCargo = useMemo(() => {
    if (!manualShipCargo && !liveShipCargo) return null;
    if (!manualShipCargo) return liveShipCargo;
    if (!liveShipCargo) return manualShipCargo;
    return new Date(liveShipCargo.timestamp) > new Date(manualShipCargo.timestamp) ? liveShipCargo : manualShipCargo;
  }, [manualShipCargo, liveShipCargo]);

  // Completion dialog state
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completedName, setCompletedName] = useState('');
  const [completedType, setCompletedType] = useState('Outpost');
  const completedNameRef = useRef<HTMLInputElement>(null);

  // Carrier cargo state — initialize from persisted store
  const persistedFC = settings.myFleetCarrier ? carrierCargoStore[settings.myFleetCarrier] : null;
  // Derive FC cargo directly from store — works even when store hydrates after mount
  const carrierCargoLoaded = !!persistedFC;
  const multiCarrierCargo: MultiCarrierCargo | null = persistedFC
    ? {
        myCarrier: {
          items: persistedFC.items,
          isEstimate: persistedFC.isEstimate,
          earliestTransfer: persistedFC.updatedAt,
          latestTransfer: persistedFC.updatedAt,
          carrierCallsign: persistedFC.callsign,
        },
        squadronCarriers: [],
      }
    : null;
  const [loadingCarrierCargo, setLoadingCarrierCargo] = useState(false);
  const [showCarrierCargo, setShowCarrierCargo] = useState(false);

  // Derive system info from knowledge base first, fall back to project.systemInfo
  const kbSystem = project?.systemName ? knownSystems[project.systemName.toLowerCase()] : undefined;
  const kbStation = project?.marketId ? knownStations[project.marketId] : undefined;

  const loadShipCargo = useCallback(async () => {
    if (!getJournalFolderHandle()) {
      const handle = await selectJournalFolder();
      if (!handle) return;
    }
    setLoadingShipCargo(true);
    try {
      const cargo = await readShipCargo();
      setManualShipCargo(cargo);
      setShowShipCargo(true);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Failed to read ship cargo');
    } finally {
      setLoadingShipCargo(false);
    }
  }, []);

  const loadCarrierCargo = useCallback(async () => {
    if (!getJournalFolderHandle()) {
      const handle = await selectJournalFolder();
      if (!handle) return;
    }
    setLoadingCarrierCargo(true);
    try {
      const currentSettings = useAppStore.getState().settings;
      const currentCargo = useAppStore.getState().carrierCargo;
      const cargo = await estimateCarrierCargo(
        undefined,
        currentSettings.myFleetCarrierMarketId,
        currentSettings.myFleetCarrier,
        currentSettings.squadronCarrierCallsigns,
        currentCargo,
      );
      setShowCarrierCargo(true);

      // Persist to store — only overwrite if new data is at least as good
      const now = new Date().toISOString();
      if (cargo.myCarrier && currentSettings.myFleetCarrier) {
        const existing = currentCargo[currentSettings.myFleetCarrier];
        if (!existing || existing.isEstimate || !cargo.myCarrier.isEstimate) {
          setCarrierCargoStore(currentSettings.myFleetCarrier, {
            callsign: currentSettings.myFleetCarrier,
            items: cargo.myCarrier.items,
            isEstimate: cargo.myCarrier.isEstimate,
            updatedAt: cargo.myCarrier.isEstimate ? (existing?.updatedAt || now) : now,
          });
        }
      }
      for (const sc of cargo.squadronCarriers) {
        const existing = currentCargo[sc.callsign];
        if (!existing || existing.isEstimate || !sc.cargo.isEstimate) {
          setCarrierCargoStore(sc.callsign, {
            callsign: sc.callsign,
            items: sc.cargo.items,
            isEstimate: sc.cargo.isEstimate,
            updatedAt: sc.cargo.isEstimate ? (existing?.updatedAt || now) : now,
          });
        }
      }
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Failed to read carrier cargo');
    } finally {
      setLoadingCarrierCargo(false);
    }
  }, []);

  if (!project) {
    return (
      <div className="py-10 text-center">
        <p className="text-muted-foreground mb-4">Project not found.</p>
        <Link to="/projects" className="text-primary hover:underline">{'\u2190'} Back to Projects</Link>
      </div>
    );
  }

  const isCompleted = project.status === 'completed';
  const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
  const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
  const totalRemaining = totalRequired - totalProvided;
  const progress = totalRequired > 0 ? totalProvided / totalRequired : 0;
  const completedCount = project.commodities.filter((c) => c.providedQuantity >= c.requiredQuantity).length;
  const tripsRemaining = settings.cargoCapacity > 0 ? Math.ceil(Math.max(totalRemaining, 0) / settings.cargoCapacity) : 0;

  const projectCommodityIds = new Set(project.commodities.map((c) => c.commodityId));
  // Only commodities that still have remaining quantity (for carrier cargo filtering)
  const neededCommodityIds = new Set(
    project.commodities
      .filter((c) => c.requiredQuantity - c.providedQuantity > 0)
      .map((c) => c.commodityId)
  );

  // Derive display values: prefer journal KB, fall back to EDSM-sourced systemInfo
  const displayEconomy = kbSystem?.economy || project.systemInfo?.economy;
  const displaySecondEconomy = kbSystem?.secondEconomy || project.systemInfo?.secondEconomy;
  const displayPopulation = kbSystem?.population || project.systemInfo?.population || 0;
  const displayDistFromStar = kbStation?.distFromStarLS;
  const displayLandingPads = kbStation?.landingPads;

  const startEdit = (commodityId: string, field: 'requiredQuantity' | 'providedQuantity' | 'remaining', currentValue: number) => {
    if (isCompleted) return;
    setEditingCell({ commodityId, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = () => {
    if (editingCell && id) {
      const val = parseInt(editValue) || 0;
      if (editingCell.field === 'remaining') {
        const commodity = project.commodities.find((c) => c.commodityId === editingCell.commodityId);
        if (commodity) {
          const newProvided = Math.max(0, commodity.requiredQuantity - Math.max(0, val));
          updateCommodity(id, editingCell.commodityId, { providedQuantity: newProvided });
        }
      } else {
        updateCommodity(id, editingCell.commodityId, { [editingCell.field]: Math.max(0, val) });
      }
      setEditingCell(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const handleJournalSync = async () => {
    if (!project.marketId) {
      setSyncMessage('No Market ID linked. Import this project from journal first.');
      return;
    }
    if (!getJournalFolderHandle()) {
      const handle = await selectJournalFolder();
      if (!handle) return;
    }
    setSyncing(true);
    setSyncMessage('');
    try {
      const depot = await scanForMarketId(project.marketId);
      if (!depot) {
        setSyncMessage('No matching depot found in journal files for this Market ID.');
        return;
      }
      // Always use depot commodities as the authoritative source — the journal
      // ConstructionDepot event is the ground truth for what's needed and provided.
      useAppStore.getState().updateAllCommodities(project.id, depot.commodities);

      // Also extract knowledge base during project sync
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
        for (const fc of kb.fleetCarriers) {
          store.addFleetCarrier(fc);
        }
      } catch {
        // Supplementary
      }

      // Read market.json
      try {
        const market = await readMarketJson();
        if (market) useAppStore.getState().setLatestMarket(market);
      } catch {
        // Optional
      }

      setSyncMessage(`Synced from journal (${new Date().toLocaleTimeString()})`);

      // Auto-refresh ship & carrier cargo after sync
      loadShipCargo().catch(() => {});
      loadCarrierCargo().catch(() => {});
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleComplete = () => {
    // Always show dialog to capture the built station name/type
    const rawName = stripConstructionPrefix(cleanProjectName(project.stationName || project.name));
    setCompletedName(rawName);
    // Guess type from project data — map construction depot types to likely result
    const CONSTRUCTION_TYPE_MAP: Record<string, string> = {
      SpaceConstructionDepot: 'Outpost',
      OrbitalConstructionDepot: 'Outpost',
      PlanetaryConstructionDepot: 'CraterOutpost',
      SurfaceConstructionDepot: 'CraterOutpost',
      ColonisationShip: 'Outpost',
    };
    const guessedType = CONSTRUCTION_TYPE_MAP[project.stationType] || project.stationType || 'Outpost';
    setCompletedType(guessedType);
    setShowCompleteDialog(true);
    setTimeout(() => completedNameRef.current?.select(), 50);
  };

  const handleConfirmComplete = () => {
    const name = completedName.trim();
    completeProject(project.id, name ? { name, type: completedType } : undefined);
    setShowCompleteDialog(false);
  };

  const handleReactivate = () => {
    reactivateProject(project.id);
  };

  const handleDelete = () => {
    if (confirm('Delete this project? This cannot be undone.')) {
      deleteProject(project.id);
      navigate('/projects');
    }
  };

  const relevantShipCargo = shipCargo?.items.filter((item) => projectCommodityIds.has(item.commodityId)) || [];
  const otherShipCargo = shipCargo?.items.filter((item) => !projectCommodityIds.has(item.commodityId)) || [];

  // Carrier cargo: only show items still needed by this project (remaining > 0)
  const myFcRelevant = multiCarrierCargo?.myCarrier?.items.filter((item) => neededCommodityIds.has(item.commodityId)) || [];
  const squadronCargos = (multiCarrierCargo?.squadronCarriers || []).map((sc) => ({
    callsign: sc.callsign,
    items: sc.cargo.items.filter((item) => neededCommodityIds.has(item.commodityId)),
    cargo: sc.cargo,
  })).filter((sc) => sc.items.length > 0);
  const hasAnyCarrierCargo = myFcRelevant.length > 0 || squadronCargos.length > 0;
  const totalCarrierItems = myFcRelevant.length + squadronCargos.reduce((s, sc) => s + sc.items.length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">{'\u2190'} Projects</Link>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-2xl font-bold">{cleanProjectName(project.name)}</h2>
            {isCompleted && (
              <span className="text-xs bg-progress-complete/20 text-progress-complete px-2 py-1 rounded font-medium">
                {'\u2713'} Completed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            {project.systemName && (
              <Link to={`/systems/${encodeURIComponent(project.systemName)}`} className="text-secondary hover:underline">
                {project.systemName}
              </Link>
            )}
            {project.stationType && (
              <span className="inline-flex items-center gap-1">
                {'\u2022'} <StationTypeIcon stationType={isCompleted ? resolveStationType(project.completedStationType, project.stationType) : project.stationType} showLabel />
                {isCompleted && (
                  <select
                    value={resolveStationType(project.completedStationType, project.stationType)}
                    onChange={(e) => updateProject(project.id, { completedStationType: e.target.value })}
                    className="ml-1 bg-muted border border-border rounded px-1 py-0.5 text-xs text-muted-foreground cursor-pointer focus:outline-none focus:border-primary"
                    title="Change installation type"
                  >
                    <optgroup label="Orbital">
                      {INSTALLATION_TYPE_OPTIONS.filter((t) => t.group === 'Orbital').map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                    </optgroup>
                    <optgroup label="Surface">
                      {INSTALLATION_TYPE_OPTIONS.filter((t) => t.group === 'Surface').map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                    </optgroup>
                  </select>
                )}
              </span>
            )}
            {project.marketId && <span>{'\u2022'} Market ID: {project.marketId}</span>}
          </div>
          {/* Station details from knowledge base */}
          {(displayDistFromStar !== undefined || displayLandingPads) && (
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {displayDistFromStar !== undefined && displayDistFromStar !== null && (
                <span>{displayDistFromStar.toFixed(1)} Ls from star</span>
              )}
              {displayLandingPads && (
                <span>
                  Pads: L:{displayLandingPads.large} M:{displayLandingPads.medium} S:{displayLandingPads.small}
                </span>
              )}
            </div>
          )}
          {/* System info line */}
          {(displayEconomy || displayPopulation > 0) && (
            <div className="flex items-center gap-3 mt-1 text-sm">
              {displayEconomy && <span className="text-primary">{displayEconomy}</span>}
              {displaySecondEconomy && (
                <span className="text-muted-foreground">/ {displaySecondEconomy}</span>
              )}
              {displayPopulation > 0 && (
                <span className="text-muted-foreground">
                  {'\u2022'} Pop: {formatNumber(displayPopulation)}
                </span>
              )}
            </div>
          )}
          {!displayEconomy && !displayPopulation && project.systemName && (
            <div className="mt-1 text-xs text-muted-foreground">
              Sync from journal to populate system info
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!isCompleted && isFileSystemAccessSupported() && project.marketId && (
            <button
              onClick={handleJournalSync}
              disabled={syncing}
              className="px-3 py-1.5 bg-secondary/20 text-secondary rounded-lg text-sm hover:bg-secondary/30 transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : '\u{1F504} Sync from Journal'}
            </button>
          )}
          {!isCompleted ? (
            <button
              onClick={handleComplete}
              className="px-3 py-1.5 bg-progress-complete/20 text-progress-complete rounded-lg text-sm hover:bg-progress-complete/30 transition-colors"
            >
              {'\u2713'} Mark Complete
            </button>
          ) : (
            <button
              onClick={handleReactivate}
              className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-colors"
            >
              Reactivate
            </button>
          )}
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 bg-destructive/20 text-destructive rounded-lg text-sm hover:bg-destructive/30 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="mb-4 px-4 py-2 bg-muted rounded-lg text-sm text-muted-foreground">{syncMessage}</div>
      )}

      {/* Completed banner */}
      {isCompleted && project.completedAt && (
        <div className="mb-6 px-4 py-3 bg-progress-complete/10 border border-progress-complete/20 rounded-lg">
          <div className="text-sm text-progress-complete font-medium">
            {'\u{1F3C6}'} Construction completed on {new Date(project.completedAt).toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Total delivered: {formatNumber(totalProvided)}t across {project.commodities.length} commodities
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Progress</div>
          <div className="text-xl font-bold text-primary">{formatPercent(progress)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Provided</div>
          <div className="text-xl font-bold">{formatNumber(totalProvided)}t</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Remaining</div>
          <div className="text-xl font-bold">{formatNumber(Math.max(totalRemaining, 0))}t</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Commodities</div>
          <div className="text-xl font-bold">{completedCount} / {project.commodities.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Est. Trips</div>
          <div className="text-xl font-bold">{tripsRemaining}</div>
        </div>
        {(carrierCargoLoaded || showShipCargo) && !isCompleted && (() => {
          const totalNeedToBuy = project.commodities.reduce((sum, c) => {
            const rem = Math.max(0, c.requiredQuantity - c.providedQuantity);
            if (rem === 0) return sum;
            const fcStock = multiCarrierCargo?.myCarrier?.items.find((i) => i.commodityId === c.commodityId)?.count || 0;
            const shipStock = shipCargo?.items.find((i) => i.commodityId === c.commodityId)?.count || 0;
            return sum + Math.max(0, rem - fcStock - shipStock);
          }, 0);
          const totalInStock = Math.max(totalRemaining, 0) - totalNeedToBuy;
          return (
            <div className="bg-card border border-primary/30 rounded-lg p-3">
              <div className="text-xs text-primary">Need to Buy</div>
              <div className="text-xl font-bold text-primary">{formatNumber(totalNeedToBuy)}t</div>
              {totalInStock > 0 && (
                <div className="text-xs text-muted-foreground">{formatNumber(totalInStock)}t in stock</div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Session timer */}
      {!isCompleted && <SessionTimerWidget project={project} />}

      {/* Overall progress bar */}
      <div className="mb-6">
        <div className="w-full bg-muted rounded-full h-3">
          <div
            className="h-3 rounded-full transition-all"
            style={{
              width: `${Math.min(progress * 100, 100)}%`,
              backgroundColor:
                progress >= 1 ? 'var(--color-progress-complete)' :
                progress >= 0.75 ? 'var(--color-progress-high)' :
                progress >= 0.25 ? 'var(--color-progress-mid)' :
                'var(--color-progress-low)',
            }}
          />
        </div>
      </div>

      {/* Ship & Carrier Cargo panels — only for active projects */}
      {!isCompleted && isFileSystemAccessSupported() && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Ship Cargo */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => {
                if (!showShipCargo && !shipCargo) {
                  loadShipCargo();
                } else {
                  setShowShipCargo(!showShipCargo);
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
            >
              <span>{'\u{1F680}'} Ship Cargo</span>
              <span className="text-muted-foreground text-xs">
                {loadingShipCargo ? 'Loading...' :
                  shipCargo ? `${shipCargo.items.length} items` :
                  'Click to load'}
              </span>
            </button>
            {showShipCargo && shipCargo && (
              <div className="border-t border-border px-4 py-3">
                {shipCargo.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ship cargo is empty</p>
                ) : (
                  <>
                    {relevantShipCargo.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-primary font-medium mb-1">For this project</div>
                        {relevantShipCargo.map((item) => {
                          const projCommodity = project.commodities.find((c) => c.commodityId === item.commodityId);
                          const rem = projCommodity ? projCommodity.requiredQuantity - projCommodity.providedQuantity : 0;
                          return (
                            <div key={item.commodityId} className="flex justify-between text-sm py-0.5">
                              <span className="text-foreground">{item.name}</span>
                              <span>
                                <span className="text-primary font-medium">{formatNumber(item.count)}t</span>
                                {rem > 0 && (
                                  <span className="text-muted-foreground text-xs ml-1">/ {formatNumber(rem)}t needed</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {otherShipCargo.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground font-medium mb-1">Other cargo</div>
                        {otherShipCargo.map((item) => (
                          <div key={item.commodityId} className="flex justify-between text-sm py-0.5 text-muted-foreground">
                            <span>{item.name}</span>
                            <span>{formatNumber(item.count)}t</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  Last updated: {new Date(shipCargo.timestamp).toLocaleString()}
                </div>
                <button onClick={loadShipCargo} disabled={loadingShipCargo} className="text-xs text-secondary hover:underline mt-1 disabled:opacity-50">
                  {loadingShipCargo ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            )}
          </div>

          {/* Carrier Cargo */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => {
                if (!showCarrierCargo && !carrierCargoLoaded) {
                  loadCarrierCargo();
                } else {
                  setShowCarrierCargo(!showCarrierCargo);
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
            >
              <span>{'\u{1F6F8}'} Carrier Cargo</span>
              <span className="text-muted-foreground text-xs">
                {loadingCarrierCargo ? 'Loading...' :
                  carrierCargoLoaded ? (hasAnyCarrierCargo ? `${totalCarrierItems} relevant items` : 'No relevant cargo') :
                  'Click to load'}
              </span>
            </button>
            {showCarrierCargo && carrierCargoLoaded && (
              <div className="border-t border-border px-4 py-3">
                {!hasAnyCarrierCargo ? (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">No relevant carrier cargo for this project.</p>
                    <p className="text-xs text-muted-foreground">
                      Dock at your Fleet Carrier (with cargo set to sell) and sync to read Market.json.
                      Make sure your FC callsign is set in Settings.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* My Fleet Carrier — shown first */}
                    {myFcRelevant.length > 0 && multiCarrierCargo?.myCarrier && (
                      <div className="mb-3">
                        <div className="text-xs text-primary font-medium mb-1">
                          {'\u{1F6F8}'} My Fleet Carrier
                          {multiCarrierCargo.myCarrier.carrierCallsign && (
                            <span className="text-muted-foreground ml-1">({multiCarrierCargo.myCarrier.carrierCallsign})</span>
                          )}
                          {!multiCarrierCargo.myCarrier.isEstimate && (
                            <span className="text-progress-complete ml-1">{'\u2713'} Accurate</span>
                          )}
                        </div>
                        {myFcRelevant.map((item) => {
                          const projCommodity = project.commodities.find((c) => c.commodityId === item.commodityId);
                          const rem = projCommodity ? projCommodity.requiredQuantity - projCommodity.providedQuantity : 0;
                          return (
                            <div key={item.commodityId} className="flex justify-between text-sm py-0.5">
                              <span className="text-foreground">{item.name}</span>
                              <span>
                                <span className="text-primary font-medium">
                                  {multiCarrierCargo.myCarrier!.isEstimate ? '~' : ''}{formatNumber(item.count)}t
                                </span>
                                {rem > 0 && (
                                  <span className="text-muted-foreground text-xs ml-1">/ {formatNumber(rem)}t needed</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Squadron Carriers */}
                    {squadronCargos.map((sc) => (
                      <div key={sc.callsign} className="mb-3">
                        <div className="text-xs text-secondary font-medium mb-1">
                          {'\u{1F6F8}'} Squadron: {sc.callsign}
                          {!sc.cargo.isEstimate && (
                            <span className="text-progress-complete ml-1">{'\u2713'} Accurate</span>
                          )}
                        </div>
                        {sc.items.map((item) => {
                          const projCommodity = project.commodities.find((c) => c.commodityId === item.commodityId);
                          const rem = projCommodity ? projCommodity.requiredQuantity - projCommodity.providedQuantity : 0;
                          return (
                            <div key={item.commodityId} className="flex justify-between text-sm py-0.5">
                              <span className="text-foreground">{item.name}</span>
                              <span>
                                <span className="text-secondary font-medium">
                                  {sc.cargo.isEstimate ? '~' : ''}{formatNumber(item.count)}t
                                </span>
                                {rem > 0 && (
                                  <span className="text-muted-foreground text-xs ml-1">/ {formatNumber(rem)}t needed</span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </>
                )}
                <button onClick={loadCarrierCargo} disabled={loadingCarrierCargo} className="text-xs text-secondary hover:underline mt-2 disabled:opacity-50">
                  {loadingCarrierCargo ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commodity table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="text-left px-4 py-3">Commodity</th>
              <th className="text-right px-4 py-3 w-28">Required</th>
              <th className="text-right px-4 py-3 w-28">Provided</th>
              <th className="text-right px-4 py-3 w-28">Remaining</th>
              {(carrierCargoLoaded || showShipCargo) && !isCompleted && (
                <th className="text-right px-4 py-3 w-28" title="Remaining − FC stock − ship cargo">Need to Buy</th>
              )}
              <th className="text-right px-4 py-3 w-20">%</th>
              <th className="px-4 py-3 w-40">Progress</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((category) => {
              const catCommodities = project.commodities.filter((c) => {
                // Try id match first; fall back to display-name match. Backwards
                // compat for projects whose commodityIds were slugified by the old
                // broken regex (e.g. "vcutioshltr" for "Evacuation Shelter").
                const def = COMMODITIES.find((d) => d.id === c.commodityId)
                  ?? COMMODITIES.find((d) => d.name.toLowerCase() === c.name.toLowerCase());
                return def?.category === category;
              });
              if (catCommodities.length === 0) return null;

              return (
                <Fragment key={category}>
                  <tr>
                    <td colSpan={(carrierCargoLoaded || showShipCargo) && !isCompleted ? 7 : 6} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: `var(--color-commodity-${category})` }}>
                      {CATEGORY_LABELS[category as CommodityCategory]}
                    </td>
                  </tr>
                  {catCommodities.map((c) => {
                    const remaining = c.requiredQuantity - c.providedQuantity;
                    const pct = c.requiredQuantity > 0 ? c.providedQuantity / c.requiredQuantity : 0;
                    const isItemComplete = c.providedQuantity >= c.requiredQuantity && c.requiredQuantity > 0;

                    const shipCount = shipCargo?.items.find((i) => i.commodityId === c.commodityId)?.count;
                    const myFcCount = multiCarrierCargo?.myCarrier?.items.find((i) => i.commodityId === c.commodityId)?.count;
                    const sqCount = squadronCargos.reduce((s, sc) => s + (sc.items.find((i) => i.commodityId === c.commodityId)?.count || 0), 0);

                    return (
                      <tr
                        key={c.commodityId}
                        className={`border-t border-border/50 hover:bg-muted/30 ${isItemComplete ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 text-sm">
                          <div>
                            {isItemComplete && <span className="text-progress-high mr-1">{'\u2713'}</span>}
                            {c.name}
                          </div>
                          {(shipCount || myFcCount || sqCount > 0) && !isCompleted && (
                            <div className="text-xs mt-0.5 space-x-2">
                              {shipCount ? (
                                <span className="text-primary">{'\u{1F680}'} {formatNumber(shipCount)}t in ship</span>
                              ) : null}
                              {myFcCount ? (
                                <span className="text-primary">{'\u{1F6F8}'} {multiCarrierCargo?.myCarrier?.isEstimate ? '~' : ''}{formatNumber(myFcCount)}t on FC</span>
                              ) : null}
                              {sqCount > 0 ? (
                                <span className="text-secondary">{'\u{1F6F8}'} {formatNumber(sqCount)}t on squadron</span>
                              ) : null}
                            </div>
                          )}
                          {!isItemComplete && !isCompleted && bestSources[c.commodityId] && (() => {
                            const src = bestSources[c.commodityId];
                            return (
                              <div className="text-[11px] mt-0.5 text-muted-foreground">
                                {'\u2190'} {src.stationName}
                                <span className="opacity-60"> ({src.systemName})</span>
                                {src.stock != null && <span className="text-sky-400 ml-1">{formatNumber(src.stock)}t</span>}
                                {src.buyPrice != null && <span className="opacity-60 ml-1">{formatNumber(src.buyPrice)}cr</span>}
                                {!src.hasLargePads && <span className="text-amber-400 ml-1">M</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td
                          className={`px-4 py-2 text-right text-sm ${!isCompleted ? 'cursor-pointer hover:text-primary' : ''}`}
                          onClick={() => startEdit(c.commodityId, 'requiredQuantity', c.requiredQuantity)}
                        >
                          {editingCell?.commodityId === c.commodityId && editingCell.field === 'requiredQuantity' ? (
                            <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
                              className="w-full bg-muted border border-primary rounded px-2 py-0.5 text-right text-sm text-foreground focus:outline-none" autoFocus />
                          ) : (
                            formatNumber(c.requiredQuantity)
                          )}
                        </td>
                        <td
                          className={`px-4 py-2 text-right text-sm ${!isCompleted ? 'cursor-pointer hover:text-primary' : ''}`}
                          onClick={() => startEdit(c.commodityId, 'providedQuantity', c.providedQuantity)}
                        >
                          {editingCell?.commodityId === c.commodityId && editingCell.field === 'providedQuantity' ? (
                            <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
                              className="w-full bg-muted border border-primary rounded px-2 py-0.5 text-right text-sm text-foreground focus:outline-none" autoFocus />
                          ) : (
                            formatNumber(c.providedQuantity)
                          )}
                        </td>
                        <td
                          className={`px-4 py-2 text-right text-sm ${!isCompleted ? 'cursor-pointer hover:text-primary' : ''}`}
                          onClick={() => startEdit(c.commodityId, 'remaining', Math.max(remaining, 0))}
                        >
                          {editingCell?.commodityId === c.commodityId && editingCell.field === 'remaining' ? (
                            <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
                              className="w-full bg-muted border border-primary rounded px-2 py-0.5 text-right text-sm text-foreground focus:outline-none" autoFocus />
                          ) : (
                            formatNumber(Math.max(remaining, 0))
                          )}
                        </td>
                        {(carrierCargoLoaded || showShipCargo) && !isCompleted && (() => {
                          const fcStock = myFcCount || 0;
                          const shipStock = shipCount || 0;
                          const needToBuy = Math.max(0, remaining - fcStock - shipStock);
                          return (
                            <td className="px-4 py-2 text-right text-sm">
                              {remaining <= 0 ? (
                                <span className="text-progress-complete">—</span>
                              ) : needToBuy === 0 ? (
                                <span className="text-progress-complete" title={`FC: ${formatNumber(fcStock)}t + Ship: ${formatNumber(shipStock)}t covers remaining`}>{'\u2713'} 0</span>
                              ) : (
                                <span className={needToBuy < remaining ? 'text-yellow-400' : 'text-foreground'} title={`${formatNumber(remaining)} remaining − ${formatNumber(fcStock)} FC − ${formatNumber(shipStock)} ship`}>
                                  {formatNumber(needToBuy)}
                                </span>
                              )}
                            </td>
                          );
                        })()}
                        <td className="px-4 py-2 text-right text-sm">
                          {formatPercent(Math.min(pct, 1))}
                        </td>
                        <td className="px-4 py-2">
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${Math.min(pct * 100, 100)}%`,
                                backgroundColor:
                                  pct >= 1 ? 'var(--color-progress-complete)' :
                                  pct >= 0.75 ? 'var(--color-progress-high)' :
                                  pct >= 0.25 ? 'var(--color-progress-mid)' :
                                  'var(--color-progress-low)',
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="mt-6">
        <label className="block text-sm text-muted-foreground mb-1">Notes</label>
        <textarea
          value={project.notes}
          onChange={(e) => updateProject(project.id, { notes: e.target.value })}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary resize-y min-h-20"
          placeholder="Add notes about this project..."
          rows={3}
        />
      </div>

      {project.lastJournalSync && (
        <div className="mt-4 text-xs text-muted-foreground">
          Last journal sync: {new Date(project.lastJournalSync).toLocaleString()}
        </div>
      )}

      {/* Completion Dialog */}
      {showCompleteDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCompleteDialog(false)}>
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-1">Complete Project</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {isColonisationShip(project.stationName, project.stationType)
                ? 'The colonisation ship will leave \u2014 enter the name and type of the permanent installation.'
                : 'Enter the name and type of the completed installation.'}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Installation Name</label>
                <input
                  ref={completedNameRef}
                  type="text"
                  value={completedName}
                  onChange={(e) => setCompletedName(e.target.value)}
                  className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  placeholder="e.g. Machel Reach Outpost"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmComplete(); }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Station Type</label>
                <select
                  value={completedType}
                  onChange={(e) => setCompletedType(e.target.value)}
                  className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  {EDITABLE_STATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCompleteDialog(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmComplete}
                className="px-4 py-2 bg-progress-complete/20 text-progress-complete rounded-lg text-sm hover:bg-progress-complete/30 transition-colors"
              >
                {'\u2713'} Mark Complete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Session timer widget — start/stop delivery tracking sessions */
function SessionTimerWidget({ project }: { project: { id: string; name: string; commodities: { commodityId: string; providedQuantity: number }[] } }) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const startSession = useAppStore((s) => s.startSession);
  const stopSession = useAppStore((s) => s.stopSession);
  const [now, setNow] = useState(Date.now());

  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const isActiveHere = activeSession?.projectId === project.id;
  const isActiveElsewhere = activeSession && !isActiveHere;
  const otherProject = isActiveElsewhere ? projects.find((p) => p.id === activeSession.projectId) : null;

  // Tick timer every second when session is active here
  useEffect(() => {
    if (!isActiveHere) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActiveHere]);

  // Compute live metrics
  const elapsedMs = isActiveHere && activeSession ? now - Date.parse(activeSession.startTime) : 0;
  const liveTons = isActiveHere && activeSession
    ? computeLiveTons(activeSession.startSnapshot, project as import('@/store/types').ColonizationProject)
    : 0;
  const liveRate = computeDeliveryRate(liveTons, elapsedMs);

  if (isActiveElsewhere) {
    return (
      <div className="mb-6 bg-card border border-border rounded-lg p-4 flex items-center justify-between">
        <div>
          <span className="text-sm text-muted-foreground">Session active on </span>
          <Link to={`/projects/${activeSession.projectId}`} className="text-sm text-primary hover:underline">
            {otherProject?.name || 'another project'}
          </Link>
        </div>
        <button disabled className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-sm cursor-not-allowed">
          Start Session
        </button>
      </div>
    );
  }

  if (isActiveHere) {
    return (
      <div className="mb-6 bg-card border border-primary/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">Active Session</span>
            <span className="text-lg font-mono font-bold text-primary">{formatDuration(elapsedMs)}</span>
          </div>
          <button
            onClick={stopSession}
            className="px-3 py-1.5 bg-destructive/20 text-destructive rounded-lg text-sm hover:bg-destructive/30 transition-colors"
          >
            Stop Session
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Tons Delivered</div>
            <div className="text-lg font-bold">{formatNumber(liveTons)}t</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Delivery Rate</div>
            <div className="text-lg font-bold">{liveRate > 0 ? `${Math.round(liveRate)} t/hr` : '--'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Started</div>
            <div className="text-sm font-medium">{new Date(activeSession.startTime).toLocaleTimeString()}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-card border border-border rounded-lg p-4 flex items-center justify-between">
      <div>
        <span className="text-sm font-medium">Delivery Session</span>
        <span className="text-xs text-muted-foreground ml-2">Track your delivery rate</span>
      </div>
      <button
        onClick={() => startSession(project.id)}
        className="px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-colors"
      >
        Start Session
      </button>
    </div>
  );
}
