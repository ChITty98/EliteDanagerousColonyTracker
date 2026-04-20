import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { cleanProjectName } from '@/lib/utils';
import { COMMODITY_BY_ID, COMMODITIES } from '@/data/commodities';
import { findNearbySources, type ArdentStation } from '@/services/ardentApi';
import { readMarketSnapshot, isEphemeralStation } from '@/services/journalReader';
import type { CustomSource } from '@/store/types';

interface CommodityNeed {
  commodityId: string;
  name: string;
  remaining: number;
  projects: { id: string; name: string; systemName: string; remaining: number }[];
}

interface SourceResults {
  inSystem: ArdentStation[];
  nearby: ArdentStation[];
}

type SearchState = 'idle' | 'loading' | 'done' | 'error';

// Station type classification — covers both canonical Frontier types and the
// custom installation IDs users can assign from the Installation Type dataset
// (civilian_surface_outpost, extraction_surface_outpost, etc.)
const PLANETARY_TYPES = new Set([
  'CraterOutpost', 'CraterPort', 'OnFootSettlement', 'SurfaceStation',
  'PlanetaryOutpost', 'PlanetaryPort', 'SurfaceOutpost',
  'PlanetaryConstructionDepot', 'SurfaceConstructionDepot',
]);
function isPlanetary(stationType: string) {
  if (!stationType) return false;
  if (PLANETARY_TYPES.has(stationType)) return true;
  // Custom user-assigned types from installationTypes.ts that are explicitly surface/planetary.
  // Don't catch "_outpost" alone — commercial_outpost / industrial_outpost are ORBITAL.
  return /surface_|planetary_|settlement/i.test(stationType);
}
function stationTypeLabel(stationType: string) {
  if (isPlanetary(stationType)) return 'Planet';
  if (stationType === 'FleetCarrier') return 'FC';
  return 'Orbital';
}
function stationTypeIcon(stationType: string) {
  if (isPlanetary(stationType)) return '\u{1F30D}'; // globe
  if (stationType === 'FleetCarrier') return '\u{1F6A2}'; // ship
  return '\u{2B50}';
}

export function SourcesPage() {
  const projects = useAppStore((s) => s.projects);
  const customSources = useAppStore((s) => s.customSources);
  const addCustomSource = useAppStore((s) => s.addCustomSource);
  const deleteCustomSource = useAppStore((s) => s.deleteCustomSource);
  const visitedMarkets = useAppStore((s) => s.visitedMarkets);
  const knownStations = useAppStore((s) => s.knownStations);
  const settings = useAppStore((s) => s.settings);
  const marketSnapshots = useAppStore((s) => s.marketSnapshots);
  const upsertMarketSnapshot = useAppStore((s) => s.upsertMarketSnapshot);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const currentShip = useAppStore((s) => s.currentShip);
  const stationTravelTimes = useAppStore((s) => s.stationTravelTimes);
  const fleetCarriers = useAppStore((s) => s.fleetCarriers);
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all'>('all');
  const [searchResults, setSearchResults] = useState<Record<string, SourceResults>>({});
  const [searchStates, setSearchStates] = useState<Record<string, SearchState>>({});
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});
  const [includeFC, setIncludeFC] = useState(false);
  const [maxDistance, setMaxDistance] = useState(80);

  // Browse Market Data — search stored snapshots by system / station / commodity
  type BrowseMode = 'system' | 'station' | 'commodity';
  const [browseMode, setBrowseMode] = useState<BrowseMode>('commodity');
  const [browseQuery, setBrowseQuery] = useState('');

  const browseResults = useMemo(() => {
    const q = browseQuery.trim().toLowerCase();
    if (!q) return null;

    // Distance from commander to a system (via knownSystems coords)
    const here = commanderPosition?.coordinates;
    const distanceTo = (systemName: string): number => {
      if (!here) return Number.POSITIVE_INFINITY;
      const ks = knownSystems[systemName.toLowerCase()];
      if (!ks?.coordinates) return Number.POSITIVE_INFINITY;
      const dx = ks.coordinates.x - here.x;
      const dy = ks.coordinates.y - here.y;
      const dz = ks.coordinates.z - here.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    // Unified station entry — either from snapshot (fresh, has stock) OR visitedMarkets (journal, no stock)
    interface UnifiedStation {
      marketId: number;
      stationName: string;
      systemName: string;
      stationType: string;
      isPlanetary: boolean;
      hasLargePads: boolean;
      commodities: { commodityId: string; name: string; buyPrice: number; stock: number | null }[];
      updatedAt: string;
      source: 'snapshot' | 'journal';
      distance: number;
    }

    // Build unified view — snapshots win over visitedMarkets for the same marketId
    const byMarketId = new Map<number, UnifiedStation>();
    for (const s of Object.values(marketSnapshots)) {
      if (isEphemeralStation(s.stationName, s.stationType, s.marketId)) continue;
      byMarketId.set(s.marketId, {
        marketId: s.marketId,
        stationName: s.stationName,
        systemName: s.systemName,
        stationType: s.stationType,
        isPlanetary: s.isPlanetary,
        hasLargePads: s.hasLargePads,
        commodities: s.commodities.map((c) => ({ commodityId: c.commodityId, name: c.name, buyPrice: c.buyPrice, stock: c.stock })),
        updatedAt: s.updatedAt,
        source: 'snapshot',
        distance: distanceTo(s.systemName),
      });
    }
    for (const v of visitedMarkets) {
      if (isEphemeralStation(v.stationName, v.stationType, v.marketId)) continue;
      if (byMarketId.has(v.marketId)) continue; // snapshot wins
      byMarketId.set(v.marketId, {
        marketId: v.marketId,
        stationName: v.stationName,
        systemName: v.systemName,
        stationType: v.stationType,
        isPlanetary: v.isPlanetary,
        hasLargePads: v.hasLargePads,
        commodities: v.commodities.map((id) => ({
          commodityId: id,
          name: COMMODITY_BY_ID.get(id)?.name || id,
          buyPrice: v.commodityPrices?.[id]?.buyPrice ?? 0,
          stock: null, // journal data has no stock
        })),
        updatedAt: v.lastVisited,
        source: 'journal',
        distance: distanceTo(v.systemName),
      });
    }

    const allStations = [...byMarketId.values()];

    if (browseMode === 'commodity') {
      const rows: {
        marketId: number;
        stationName: string;
        systemName: string;
        stationType: string;
        commodityName: string;
        buyPrice: number;
        stock: number | null;
        updatedAt: string;
        source: 'snapshot' | 'journal';
        distance: number;
      }[] = [];
      for (const st of allStations) {
        for (const c of st.commodities) {
          const defName = COMMODITY_BY_ID.get(c.commodityId)?.name || c.name;
          if (
            c.commodityId.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            defName.toLowerCase().includes(q)
          ) {
            rows.push({
              marketId: st.marketId,
              stationName: st.stationName,
              systemName: st.systemName,
              stationType: st.stationType,
              commodityName: defName,
              buyPrice: c.buyPrice,
              stock: c.stock,
              updatedAt: st.updatedAt,
              source: st.source,
              distance: st.distance,
            });
          }
        }
      }
      rows.sort((a, b) => a.distance - b.distance);
      return { mode: 'commodity' as const, rows };
    }

    const matched = allStations.filter((s) => {
      if (browseMode === 'system') return s.systemName.toLowerCase().includes(q);
      return s.stationName.toLowerCase().includes(q);
    });
    matched.sort((a, b) => a.distance - b.distance);
    return { mode: browseMode, rows: matched };
  }, [browseMode, browseQuery, marketSnapshots, visitedMarkets, knownSystems, commanderPosition]);

  // Market sync
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const handleSyncMarket = useCallback(async () => {
    setSyncStatus('Reading Market.json...');
    try {
      const snapshot = await readMarketSnapshot();
      if (!snapshot) {
        setSyncStatus('No Market.json found — dock at a station first');
        setTimeout(() => setSyncStatus(null), 5000);
        return;
      }
      upsertMarketSnapshot(snapshot);
      const commodityNames = snapshot.commodities.map((c) => c.name).join(', ');
      setSyncStatus(
        `Updated ${snapshot.stationName} (${snapshot.systemName}): ${snapshot.commodities.length} commodities${commodityNames ? ' — ' + commodityNames : ''}`
      );
      setTimeout(() => setSyncStatus(null), 10000);
    } catch (err) {
      setSyncStatus(`Error: ${err instanceof Error ? err.message : 'Failed to read Market.json'}`);
      setTimeout(() => setSyncStatus(null), 8000);
    }
  }, [upsertMarketSnapshot]);

  // Get persisted market snapshots that sell a commodity
  const getMarketSnapshotsFor = useCallback((commodityId: string) => {
    return Object.values(marketSnapshots).filter((ms) =>
      ms.commodities.some((c) => c.commodityId === commodityId)
    );
  }, [marketSnapshots]);

  // Add custom source dialog
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState({ stationName: '', systemName: '', isPlanetary: false, hasLargePads: true, commodities: [] as string[], notes: '' });

  // Aggregate commodity needs across selected project(s)
  const commodityNeeds = useMemo(() => {
    const scope = selectedProjectId === 'all'
      ? activeProjects
      : activeProjects.filter((p) => p.id === selectedProjectId);

    const map = new Map<string, CommodityNeed>();
    for (const project of scope) {
      for (const c of project.commodities) {
        const rem = c.requiredQuantity - c.providedQuantity;
        if (rem <= 0) continue;
        const existing = map.get(c.commodityId);
        if (existing) {
          existing.remaining += rem;
          existing.projects.push({ id: project.id, name: project.name, systemName: project.systemName, remaining: rem });
        } else {
          map.set(c.commodityId, {
            commodityId: c.commodityId,
            name: c.name,
            remaining: rem,
            projects: [{ id: project.id, name: project.name, systemName: project.systemName, remaining: rem }],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.remaining - a.remaining);
  }, [activeProjects, selectedProjectId]);

  // Get the reference system for a commodity search
  const getReferenceSystem = useCallback((need: CommodityNeed) => {
    if (selectedProjectId !== 'all') {
      const p = activeProjects.find((p) => p.id === selectedProjectId);
      return p?.systemName ?? need.projects[0].systemName;
    }
    const sorted = [...need.projects].sort((a, b) => b.remaining - a.remaining);
    return sorted[0].systemName;
  }, [activeProjects, selectedProjectId]);

  const searchSources = useCallback(async (need: CommodityNeed) => {
    const key = need.commodityId;
    setSearchStates((s) => ({ ...s, [key]: 'loading' }));
    setSearchErrors((s) => ({ ...s, [key]: '' }));

    try {
      const refSystem = getReferenceSystem(need);
      // Ardent API uses journal-style commodity IDs (e.g. "cmmcomposite" not "CMM Composite")
      const results = await findNearbySources(refSystem, need.commodityId, {
        maxDistance,
        excludeFC: !includeFC,
      });

      const inSystem = results.filter((r) => r.systemName.toLowerCase() === refSystem.toLowerCase());
      const nearby = results.filter((r) => r.systemName.toLowerCase() !== refSystem.toLowerCase());

      setSearchResults((s) => ({ ...s, [key]: { inSystem, nearby } }));
      setSearchStates((s) => ({ ...s, [key]: 'done' }));
    } catch (err) {
      setSearchErrors((s) => ({ ...s, [key]: err instanceof Error ? err.message : 'Search failed' }));
      setSearchStates((s) => ({ ...s, [key]: 'error' }));
    }
  }, [getReferenceSystem, maxDistance, includeFC]);

  const searchAll = useCallback(async () => {
    for (const need of commodityNeeds) {
      await searchSources(need);
    }
  }, [commodityNeeds, searchSources]);

  const formatAge = (updatedAt: string) => {
    const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  };

  // Get custom sources that match a commodity
  const getCustomSourcesFor = (commodityId: string): CustomSource[] => {
    return customSources.filter((s) => s.commodities.includes(commodityId));
  };

  // Get visited markets that sell a commodity.
  // Snapshot-wins policy: if a station has a current market snapshot, that
  // snapshot is the source of truth — only include the station as a source
  // if the snapshot still lists this commodity. If there's no snapshot, fall
  // back to the journal-derived `visitedMarkets` entry (historical MarketBuy
  // events — commodity may or may not still be in stock).
  const getVisitedMarketsFor = (commodityId: string) => {
    return visitedMarkets.filter((m) => {
      const snapshot = marketSnapshots[m.marketId];
      if (snapshot) {
        return snapshot.commodities.some((c) => c.commodityId === commodityId);
      }
      return m.commodities.includes(commodityId);
    });
  };

  const handleAddSource = () => {
    if (!newSource.stationName || !newSource.systemName) return;
    addCustomSource({
      ...newSource,
      priority: 1,
    });
    setNewSource({ stationName: '', systemName: '', isPlanetary: false, hasLargePads: true, commodities: [], notes: '' });
    setShowAddSource(false);
  };

  // Get all unique commodity IDs across needs for the add-source dropdown
  const allNeededCommodityIds = useMemo(() => {
    const set = new Set<string>();
    for (const need of commodityNeeds) set.add(need.commodityId);
    return set;
  }, [commodityNeeds]);

  if (activeProjects.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Commodity Sources</h2>
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">No active projects. Sources will appear when you have construction projects in progress.</p>
        </div>
      </div>
    );
  }

  const renderStationRow = (
    s: ArdentStation,
    i: number,
    prefix: string,
    need: CommodityNeed,
    isInSystem: boolean,
  ) => (
    <tr key={`${prefix}-${i}`} className={`border-b border-border/30 ${isInSystem ? 'bg-progress-complete/5' : 'hover:bg-muted/20'}`}>
      <td className={`px-4 py-2 font-medium ${isInSystem ? 'text-progress-complete' : 'text-foreground'}`}>
        <span className="mr-1.5" title={stationTypeLabel(s.stationType)}>{stationTypeIcon(s.stationType)}</span>
        {s.stationName}
        {isInSystem && <span className="ml-1 text-xs text-progress-complete/70">(in-system)</span>}
      </td>
      <td className="px-4 py-2 text-muted-foreground">{s.systemName}</td>
      <td className="text-right px-4 py-2 text-muted-foreground whitespace-nowrap">
        <span className={`text-xs mr-1 ${isPlanetary(s.stationType) ? 'text-amber-400' : 'text-sky-400'}`}>
          {stationTypeLabel(s.stationType)}
        </span>
      </td>
      <td className={`text-right px-4 py-2 ${isInSystem ? 'text-progress-complete' : 'text-muted-foreground'}`}>
        {isInSystem ? '0 ly' : s.distance != null ? `${s.distance.toFixed(1)} ly` : '\u2014'}
      </td>
      <td className="text-right px-4 py-2 text-muted-foreground">{'\u2014'}</td>
      <td className="text-right px-4 py-2">
        <span className={s.stock >= need.remaining ? 'text-progress-complete' : s.stock > 0 ? 'text-foreground' : 'text-red-400'}>
          {s.stock.toLocaleString()}
        </span>
      </td>
      <td className="text-right px-4 py-2 text-muted-foreground">{s.buyPrice.toLocaleString()} cr</td>
      <td className="text-right px-4 py-2 text-muted-foreground">{Math.round(s.distanceToArrival).toLocaleString()}</td>
      <td className="text-right px-4 py-2 text-muted-foreground">{formatAge(s.updatedAt)}</td>
    </tr>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Commodity Sources</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Find where to buy materials for active construction projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddSource(true)}
            className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg text-sm hover:bg-secondary/30 transition-colors"
          >
            + Custom Source
          </button>
          <button
            onClick={searchAll}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Search All
          </button>
        </div>
      </div>

      {/* Browse Market Data — search stored snapshots + journal history */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold">{'\u{1F50D}'} Browse Market Data</h3>
            <p className="text-xs text-muted-foreground">
              Snapshots + journal history · sorted by distance from {commanderPosition?.systemName || 'unknown'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(['system', 'station', 'commodity'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setBrowseMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  browseMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <input
          type="text"
          value={browseQuery}
          onChange={(e) => setBrowseQuery(e.target.value)}
          placeholder={
            browseMode === 'system' ? 'Search systems (e.g. HIP 47126)…'
              : browseMode === 'station' ? 'Search stations (e.g. Ma Gateway)…'
              : 'Search commodities (e.g. water)…'
          }
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
        />
        {browseResults && (
          <div className="mt-3">
            {browseResults.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches.</p>
            ) : browseResults.mode === 'commodity' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left py-1 pr-3">Commodity</th>
                      <th className="text-left py-1 pr-3">Station</th>
                      <th className="text-left py-1 pr-3">System</th>
                      <th className="text-right py-1 pr-3">Dist</th>
                      <th className="text-right py-1 pr-3">Stock</th>
                      <th className="text-right py-1 pr-3">Buy</th>
                      <th className="text-left py-1">Src · Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(browseResults.rows as Array<{
                      marketId: number; stationName: string; systemName: string;
                      commodityName: string; buyPrice: number; stock: number | null; updatedAt: string;
                      source: 'snapshot' | 'journal'; distance: number;
                    }>).slice(0, 100).map((r, i) => (
                      <tr key={`${r.marketId}-${r.commodityName}-${i}`} className="border-t border-border/30">
                        <td className="py-1 pr-3 text-foreground">{r.commodityName}</td>
                        <td className="py-1 pr-3 text-foreground">{r.stationName}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{r.systemName}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                          {Number.isFinite(r.distance) ? `${r.distance.toFixed(1)} ly` : '—'}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {r.stock == null ? <span className="text-muted-foreground/50">—</span> : r.stock.toLocaleString()}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.buyPrice > 0 ? `${r.buyPrice.toLocaleString()} cr` : '—'}</td>
                        <td className="py-1 text-xs">
                          <span className={r.source === 'snapshot' ? 'text-green-400' : 'text-amber-400'}>
                            {r.source === 'snapshot' ? 'Market' : 'Journal'}
                          </span>
                          <span className="text-muted-foreground/70 ml-1">· {new Date(r.updatedAt).toLocaleDateString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {browseResults.rows.length > 100 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing nearest 100 of {browseResults.rows.length}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {(browseResults.rows as Array<{
                  marketId: number; stationName: string; systemName: string; stationType: string;
                  commodities: { commodityId: string; name: string; buyPrice: number; stock: number | null }[];
                  updatedAt: string; source: 'snapshot' | 'journal'; distance: number;
                }>).map((s) => (
                  <details key={s.marketId} className="rounded-lg border border-border bg-muted/30">
                    <summary className="cursor-pointer px-3 py-2 flex items-center justify-between text-sm gap-3 flex-wrap">
                      <span className="flex items-center gap-2 min-w-0">
                        <span>{stationTypeIcon(s.stationType)}</span>
                        <span className="font-semibold text-foreground truncate">{s.stationName}</span>
                        <span className="text-muted-foreground truncate">{s.systemName}</span>
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-2 shrink-0">
                        <span className="tabular-nums">{Number.isFinite(s.distance) ? `${s.distance.toFixed(1)} ly` : '—'}</span>
                        <span>·</span>
                        <span>{s.commodities.length} items</span>
                        <span>·</span>
                        <span className={s.source === 'snapshot' ? 'text-green-400' : 'text-amber-400'}>{s.source === 'snapshot' ? 'Market' : 'Journal'}</span>
                        <span>·</span>
                        <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                      </span>
                    </summary>
                    <div className="px-3 py-2 border-t border-border/30 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="text-left py-1 pr-3">Commodity</th>
                            <th className="text-right py-1 pr-3">Stock</th>
                            <th className="text-right py-1">Buy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...s.commodities].sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0)).map((c) => (
                            <tr key={c.commodityId} className="border-t border-border/20">
                              <td className="py-1 pr-3 text-foreground">{COMMODITY_BY_ID.get(c.commodityId)?.name || c.name}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {c.stock == null ? <span className="text-muted-foreground/50">—</span> : c.stock.toLocaleString()}
                              </td>
                              <td className="py-1 text-right tabular-nums">{c.buyPrice > 0 ? `${c.buyPrice.toLocaleString()} cr` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compact sources indicator + sync */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{'\u2B50'} My Sources:</span>
          {visitedMarkets.length > 0 && <span>{visitedMarkets.length} stations from journals</span>}
          {Object.keys(marketSnapshots).length > 0 && (
            <span>{Object.keys(marketSnapshots).length} market snapshots</span>
          )}
          {customSources.length > 0 && (
            <span>{customSources.length} pinned {customSources.map((s) => s.stationName).join(', ')}</span>
          )}
          <span>&mdash; merged into results below</span>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus && (
            <span className={`text-xs ${syncStatus.startsWith('Error') ? 'text-red-400' : syncStatus.startsWith('No Market') ? 'text-amber-400' : 'text-progress-complete'}`}>
              {syncStatus}
            </span>
          )}
          <button
            onClick={handleSyncMarket}
            className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors"
            title="Read Market.json from current docked station and save commodity availability"
          >
            Sync Market
          </button>
        </div>
      </div>

      {/* Add custom source dialog */}
      {showAddSource && (
        <div className="mb-4 bg-card border border-primary/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Add Custom Source</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Station Name</label>
              <input
                value={newSource.stationName}
                onChange={(e) => setNewSource({ ...newSource, stationName: e.target.value })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="e.g. MA Gateway"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">System Name</label>
              <input
                value={newSource.systemName}
                onChange={(e) => setNewSource({ ...newSource, systemName: e.target.value })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="e.g. HIP 47126"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={newSource.isPlanetary}
                onChange={(e) => setNewSource({ ...newSource, isPlanetary: e.target.checked })}
                className="rounded"
              />
              Planetary
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={newSource.hasLargePads}
                onChange={(e) => setNewSource({ ...newSource, hasLargePads: e.target.checked })}
                className="rounded"
              />
              Large pads
            </label>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">Commodities sold here</label>
            <div className="flex flex-wrap gap-1.5">
              {COMMODITIES.map((c) => {
                const isNeeded = allNeededCommodityIds.has(c.id);
                const isSelected = newSource.commodities.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setNewSource({
                        ...newSource,
                        commodities: isSelected
                          ? newSource.commodities.filter((id) => id !== c.id)
                          : [...newSource.commodities, c.id],
                      });
                    }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      isSelected
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : isNeeded
                          ? 'bg-muted text-foreground border border-border hover:border-primary/40'
                          : 'bg-muted/50 text-muted-foreground border border-transparent hover:border-border'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Highlighted commodities are needed by active projects</p>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">Notes (optional)</label>
            <input
              value={newSource.notes}
              onChange={(e) => setNewSource({ ...newSource, notes: e.target.value })}
              className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="e.g. My colony, always in stock"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddSource}
              disabled={!newSource.stationName || !newSource.systemName || newSource.commodities.length === 0}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Add Source
            </button>
            <button
              onClick={() => setShowAddSource(false)}
              className="px-4 py-1.5 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Project:</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
          >
            <option value="all">All active ({activeProjects.length})</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {cleanProjectName(p.name)} ({p.systemName})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Max distance:</label>
          <select
            value={maxDistance}
            onChange={(e) => setMaxDistance(Number(e.target.value))}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
          >
            <option value={30}>30 ly</option>
            <option value={50}>50 ly</option>
            <option value={80}>80 ly</option>
            <option value={150}>150 ly</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={includeFC}
            onChange={(e) => setIncludeFC(e.target.checked)}
            className="rounded"
          />
          Include Fleet Carriers
        </label>
      </div>

      {/* Commodity needs list */}
      <div className="space-y-3">
        {commodityNeeds.map((need) => {
          const state = searchStates[need.commodityId] ?? 'idle';
          const results = searchResults[need.commodityId];
          const error = searchErrors[need.commodityId];
          const def = COMMODITY_BY_ID.get(need.commodityId);
          const refSystem = getReferenceSystem(need);
          const pinnedSources = getCustomSourcesFor(need.commodityId);
          const visitedSources = getVisitedMarketsFor(need.commodityId);

          return (
            <div key={need.commodityId} className="bg-card border border-border rounded-lg overflow-hidden">
              {/* Commodity header row */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="font-medium text-foreground">{need.name}</span>
                    {def && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        def.category === 'heavy' ? 'bg-red-500/15 text-red-400' :
                        def.category === 'medium' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-sky-500/15 text-sky-400'
                      }`}>
                        {def.category}
                      </span>
                    )}
                    {def?.planetaryOnly && (
                      <span className="ml-1 text-xs text-muted-foreground">(planetary only)</span>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {need.remaining.toLocaleString()}t needed
                  </span>
                  {need.projects.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      across {need.projects.length} projects
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {state === 'done' && results && (
                    <span className="text-xs text-muted-foreground">
                      {results.inSystem.length > 0
                        ? `${results.inSystem.length} in-system`
                        : 'none in-system'}
                      {results.nearby.length > 0
                        ? `, ${results.nearby.length} nearby`
                        : ''}
                    </span>
                  )}
                  <button
                    onClick={() => searchSources(need)}
                    disabled={state === 'loading'}
                    className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors disabled:opacity-50"
                  >
                    {state === 'loading' ? 'Searching...' : state === 'done' ? 'Refresh' : 'Find Sources'}
                  </button>
                </div>
              </div>

              {/* Project breakdown (when aggregated across multiple) */}
              {need.projects.length > 1 && (
                <div className="px-4 pb-2 flex flex-wrap gap-2">
                  {need.projects.map((p) => (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="text-xs bg-muted/50 px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {p.systemName}: {p.remaining.toLocaleString()}t
                    </Link>
                  ))}
                </div>
              )}

              {/* Error */}
              {state === 'error' && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              {/* Unified results: visited/pinned + API merged */}
              {(() => {
                // Build local source rows from visited markets + custom sources
                const localRows: {
                  stationName: string;
                  systemName: string;
                  stationType: string;
                  isInSystem: boolean;
                  tag: string;
                  notes?: string;
                  distFromStarLS?: number | null;
                  buyPrice?: number;
                  priceSeen?: string;
                  distance?: number | null;  // ly from the reference system
                  stock?: number | null;      // from market snapshot if available
                  travel?: { avgSeconds: number; tripCount: number; via: 'here' | 'fc' | 'last'; fromStation?: string } | null; // journal-derived travel stat for current ship
                }[] = [];
                const refLower = refSystem.toLowerCase();
                // Distance anchor is the commander's CURRENT location (so you can
                // see how far you have to fly to get each source), NOT the
                // project's delivery system. In-system detection still uses the
                // project's refSystem (since that's where the goods are going).
                const here = commanderPosition?.coordinates;
                const computeDistanceLy = (sysName: string): number | null => {
                  if (!here) return null;
                  const target = knownSystems[sysName.toLowerCase()];
                  if (!target?.coordinates) return null;
                  const dx = target.coordinates.x - here.x;
                  const dy = target.coordinates.y - here.y;
                  const dz = target.coordinates.z - here.z;
                  return Math.sqrt(dx * dx + dy * dy + dz * dz);
                };
                // Travel-time lookup: primary is "from the most recently docked
                // station in the current system, in the current ship". Fall back
                // to the user's FC (which usually has the richest trip history
                // for haulers) if no direct data, and finally to the globally
                // most-recently-docked non-ephemeral station. Each fallback is
                // tagged so the UI can surface the source.
                const fromMarketId = (() => {
                  if (!commanderPosition?.systemAddress) return null;
                  // Sort by lastDocked desc — `.find()` returned whatever came
                  // first in iteration order, which was often a stale
                  // construction site for colonized systems.
                  const candidates = Object.values(knownStations).filter(
                    (s) => s.systemAddress === commanderPosition.systemAddress && s.lastDocked,
                  );
                  candidates.sort((a, b) => (b.lastDocked ?? '').localeCompare(a.lastDocked ?? ''));
                  return candidates[0]?.marketId ?? null;
                })();
                const fromStationName = fromMarketId != null ? (knownStations[fromMarketId]?.stationName ?? null) : null;
                // FC MarketID: prefer the settings value, but fall back to
                // fleetCarriers list lookup by callsign, then knownStations
                // scan. settings.myFleetCarrierMarketId is only populated if
                // the user set it explicitly — for many users it's null even
                // when their callsign is set.
                const fcName = settings.myFleetCarrier || null;
                const fcMarketId = (() => {
                  if (settings.myFleetCarrierMarketId != null) return settings.myFleetCarrierMarketId;
                  if (!fcName) return null;
                  const fc = (Array.isArray(fleetCarriers) ? fleetCarriers : []).find(
                    (f) => f.callsign === fcName,
                  );
                  if (fc) return fc.marketId;
                  // Final fallback — scan knownStations for an entry whose name matches the callsign
                  const station = Object.values(knownStations).find(
                    (s) => s.stationName === fcName,
                  );
                  return station ? station.marketId : null;
                })();
                // Secondary fallback target: globally most-recent non-ephemeral dock
                const lastDockedMarketId = (() => {
                  const candidates = Object.values(knownStations).filter((s) => s.lastDocked);
                  candidates.sort((a, b) => (b.lastDocked ?? '').localeCompare(a.lastDocked ?? ''));
                  return candidates[0]?.marketId ?? null;
                })();
                const shipId = currentShip?.shipId ?? null;

                const lookupTravel = (fromMid: number, toMarketId: number) => {
                  if (shipId == null) return null;
                  const key = `${fromMid}:${toMarketId}:${shipId}`;
                  const stat = stationTravelTimes[key];
                  return stat ? { avgSeconds: stat.recentAvgSeconds, tripCount: stat.tripCount } : null;
                };

                const travelStatFor = (toMarketId: number): { avgSeconds: number; tripCount: number; via: 'here' | 'fc' | 'last'; fromStation?: string } | null => {
                  if (shipId == null) return null;
                  // 1. Primary: from current dock
                  if (fromMarketId) {
                    const direct = lookupTravel(fromMarketId, toMarketId);
                    if (direct) return { ...direct, via: 'here', fromStation: fromStationName ?? undefined };
                  }
                  // 2. Fallback: from user's FC (where most hauls start)
                  if (fcMarketId && fcMarketId !== fromMarketId) {
                    const viaFc = lookupTravel(fcMarketId, toMarketId);
                    if (viaFc) return { ...viaFc, via: 'fc', fromStation: fcName ?? undefined };
                  }
                  // 3. Last resort: from most-recently-docked station globally
                  if (lastDockedMarketId && lastDockedMarketId !== fromMarketId && lastDockedMarketId !== fcMarketId) {
                    const viaLast = lookupTravel(lastDockedMarketId, toMarketId);
                    if (viaLast) {
                      const n = knownStations[lastDockedMarketId]?.stationName;
                      return { ...viaLast, via: 'last', fromStation: n ?? undefined };
                    }
                  }
                  return null;
                };
                // Stock lookup for a station + commodity (only available in marketSnapshots)
                const findStock = (marketId: number | undefined, commodityId: string): number | null => {
                  if (!marketId) return null;
                  const snap = marketSnapshots[marketId];
                  if (!snap) return null;
                  const c = snap.commodities.find((x) => x.commodityId === commodityId);
                  return c ? c.stock : null;
                };

                // Helper to look up known station metadata by name + system
                const findKnownStation = (stationName: string, systemName: string) => {
                  for (const st of Object.values(knownStations)) {
                    if (st.stationName === stationName && st.systemName.toLowerCase() === systemName.toLowerCase()) {
                      return st;
                    }
                  }
                  return null;
                };
                const findStationLs = (stationName: string, systemName: string): number | null => {
                  return findKnownStation(stationName, systemName)?.distFromStarLS ?? null;
                };
                // Get best station type: prefer knownStations data over visited/market data
                const resolveStationType = (stationName: string, systemName: string, fallback: string): string => {
                  const known = findKnownStation(stationName, systemName);
                  return known?.stationType || fallback;
                };

                // Visited sources (journal-derived) — include all, compute distance via knownSystems
                for (const vm of visitedSources) {
                  const priceInfo = vm.commodityPrices?.[need.commodityId];
                  const isInSystem = vm.systemName.toLowerCase() === refLower;
                  localRows.push({
                    stationName: vm.stationName,
                    systemName: vm.systemName,
                    stationType: resolveStationType(vm.stationName, vm.systemName, vm.stationType || (vm.isPlanetary ? 'CraterPort' : 'Coriolis')),
                    isInSystem,
                    tag: 'visited',
                    distFromStarLS: findStationLs(vm.stationName, vm.systemName),
                    buyPrice: priceInfo?.buyPrice,
                    priceSeen: priceInfo?.lastSeen,
                    distance: computeDistanceLy(vm.systemName),
                    stock: findStock(vm.marketId, need.commodityId),
                    travel: travelStatFor(vm.marketId),
                  });
                }
                // Persisted market snapshots — show ALL (in-system and out-of-system) since these are
                // player-built stations that won't appear in Spansh API results
                const snapshots = getMarketSnapshotsFor(need.commodityId);
                for (const ms of snapshots) {
                  // Don't duplicate if already in visited sources
                  if (localRows.some((r) => r.stationName === ms.stationName && r.systemName.toLowerCase() === ms.systemName.toLowerCase())) continue;
                  const commodity = ms.commodities.find((c) => c.commodityId === need.commodityId);
                  const isInSystem = ms.systemName.toLowerCase() === refLower;
                  localRows.push({
                    stationName: ms.stationName,
                    systemName: ms.systemName,
                    stationType: resolveStationType(ms.stationName, ms.systemName, ms.stationType || (ms.isPlanetary ? 'CraterPort' : 'Coriolis')),
                    isInSystem,
                    tag: 'market',
                    distFromStarLS: findStationLs(ms.stationName, ms.systemName),
                    buyPrice: commodity?.buyPrice,
                    priceSeen: ms.updatedAt,
                    distance: computeDistanceLy(ms.systemName),
                    stock: commodity?.stock ?? null,
                    travel: travelStatFor(ms.marketId),
                  });
                }
                for (const cs of pinnedSources) {
                  // Don't duplicate if already in visited
                  if (localRows.some((r) => r.stationName === cs.stationName && r.systemName.toLowerCase() === cs.systemName.toLowerCase())) continue;
                  const isInSystem = cs.systemName.toLowerCase() === refLower;
                  localRows.push({
                    stationName: cs.stationName,
                    systemName: cs.systemName,
                    stationType: cs.isPlanetary ? 'CraterPort' : 'Coriolis',
                    isInSystem,
                    tag: 'pinned',
                    notes: cs.notes,
                    distFromStarLS: findStationLs(cs.stationName, cs.systemName),
                    distance: computeDistanceLy(cs.systemName),
                    stock: null,
                  });
                }

                // Filter out player's own fleet carrier — it's not a material source.
                // Also apply max-distance filter when we have a computed distance
                // (rows with unknown distance are kept — per the no-coord policy).
                const myFC = settings.myFleetCarrier?.toLowerCase();
                const squadronFCs = new Set(settings.squadronCarrierCallsigns.map((c) => c.toLowerCase()));
                const filteredRows = localRows.filter((r) => {
                  const nameLower = r.stationName.toLowerCase();
                  if (myFC && nameLower === myFC) return false;
                  if (squadronFCs.has(nameLower)) return false;
                  if (r.distance != null && r.distance > maxDistance) return false;
                  return true;
                });

                // Sort: in-system first, then by computed distance (nulls last)
                filteredRows.sort((a, b) => {
                  if (a.isInSystem !== b.isInSystem) return a.isInSystem ? -1 : 1;
                  const da = a.distance ?? Number.POSITIVE_INFINITY;
                  const db = b.distance ?? Number.POSITIVE_INFINITY;
                  return da - db;
                });

                const hasLocalRows = filteredRows.length > 0;
                const hasApiResults = state === 'done' && results && (results.inSystem.length > 0 || results.nearby.length > 0);
                const noResults = state === 'done' && results && results.inSystem.length === 0 && results.nearby.length === 0 && !hasLocalRows;

                if (noResults) {
                  return (
                    <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                      No sources found within {maxDistance}ly of {refSystem}
                    </div>
                  );
                }

                if (!hasLocalRows && !hasApiResults) return null;

                return (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b border-border/50">
                          <th className="text-left px-4 py-2 font-medium">Station</th>
                          <th className="text-left px-4 py-2 font-medium">System</th>
                          <th className="text-right px-4 py-2 font-medium">Type</th>
                          <th className="text-right px-4 py-2 font-medium">Dist</th>
                          <th className="text-right px-4 py-2 font-medium" title="Avg travel time from your current station for your current ship">Travel</th>
                          <th className="text-right px-4 py-2 font-medium">Stock</th>
                          <th className="text-right px-4 py-2 font-medium">Price</th>
                          <th className="text-right px-4 py-2 font-medium">Ls</th>
                          <th className="text-right px-4 py-2 font-medium">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Local sources (visited/pinned) — in-system first */}
                        {filteredRows.map((r, i) => (
                          <tr key={`local-${i}`} className={`border-b border-border/30 ${r.isInSystem ? 'bg-progress-complete/5' : 'bg-primary/5'}`}>
                            <td className={`px-4 py-2 font-medium ${r.isInSystem ? 'text-progress-complete' : 'text-primary/90'}`}>
                              <span className="mr-1.5" title={stationTypeLabel(r.stationType)}>{stationTypeIcon(r.stationType)}</span>
                              {r.stationName}
                              <span className="ml-1.5 text-xs opacity-60">
                                {r.tag === 'pinned' ? '\u2B50' : '\u2713'} {r.tag}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">{r.systemName}</td>
                            <td className="text-right px-4 py-2 text-muted-foreground whitespace-nowrap">
                              <span className={`text-xs ${isPlanetary(r.stationType) ? 'text-amber-400' : 'text-sky-400'}`}>
                                {stationTypeLabel(r.stationType)}
                              </span>
                            </td>
                            <td className={`text-right px-4 py-2 ${r.isInSystem ? 'text-progress-complete' : 'text-muted-foreground'}`}>
                              {r.distance != null ? `${r.distance.toFixed(1)} ly` : '\u2014'}
                            </td>
                            <td className="text-right px-4 py-2 text-muted-foreground">
                              {r.travel ? (
                                <span
                                  title={`${r.travel.tripCount} trips${r.travel.fromStation ? ` from ${r.travel.fromStation}` : ''}`}
                                  className={r.travel.via === 'here' ? '' : 'text-sky-400/80'}
                                >
                                  {Math.floor(r.travel.avgSeconds / 60)}m {Math.round(r.travel.avgSeconds % 60)}s
                                  {r.travel.via !== 'here' && (
                                    <span className="text-[10px] text-muted-foreground/70 ml-1">
                                      {r.travel.via === 'fc' ? 'via FC' : 'via last dock'}
                                    </span>
                                  )}
                                </span>
                              ) : '\u2014'}
                            </td>
                            <td className="text-right px-4 py-2 text-muted-foreground">
                              {r.stock != null ? r.stock.toLocaleString() : '\u2014'}
                            </td>
                            <td className="text-right px-4 py-2 text-muted-foreground">
                              {r.buyPrice != null ? `${r.buyPrice.toLocaleString()} cr` : '\u2014'}
                            </td>
                            <td className="text-right px-4 py-2 text-muted-foreground">
                              {r.distFromStarLS != null ? `${Math.round(r.distFromStarLS).toLocaleString()} ls` : '\u2014'}
                            </td>
                            <td className="text-right px-4 py-2 text-xs text-muted-foreground">
                              {r.priceSeen ? new Date(r.priceSeen).toLocaleDateString() : (r.notes || '')}
                            </td>
                          </tr>
                        ))}
                        {/* API results: in-system first, then nearby sorted by distance */}
                        {results && results.inSystem
                          .filter((s) => !filteredRows.some((r) => r.stationName.toLowerCase() === s.stationName.toLowerCase() && r.systemName.toLowerCase() === s.systemName.toLowerCase()))
                          .map((s, i) => renderStationRow(s, i, 'in', need, true))}
                        {results && [...results.nearby].sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
                          .filter((s) => !filteredRows.some((r) => r.stationName.toLowerCase() === s.stationName.toLowerCase() && r.systemName.toLowerCase() === s.systemName.toLowerCase()))
                          .slice(0, 10).map((s, i) => renderStationRow(s, i, 'near', need, false))}
                        {results && results.nearby.length > 10 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-2 text-xs text-muted-foreground text-center">
                              +{results.nearby.length - 10} more sources not shown
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Data attribution */}
      <p className="text-xs text-muted-foreground mt-6 text-center">
        Market data from Ardent Insight &middot; Large pad stations only &middot; Updated via EDDN
      </p>
    </div>
  );
}
