import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { formatNumber, cleanProjectName } from '@/lib/utils';
import { COMMODITY_BY_ID } from '@/data/commodities';
import {
  isFileSystemAccessSupported,
  getJournalFolderHandle,
  selectJournalFolder,
  estimateCarrierCargo,
  type MultiCarrierCargo,
} from '@/services/journalReader';

interface CargoProjectMatch {
  projectId: string;
  projectName: string;
  systemName: string;
  needed: number; // requiredQuantity - providedQuantity
}

export function FleetCarrierPage() {
  const settings = useAppStore((s) => s.settings);
  const allProjects = useAppStore((s) => s.projects);
  const carrierCargo = useAppStore((s) => s.carrierCargo);
  const setCarrierCargo = useAppStore((s) => s.setCarrierCargo);

  // Initialize from persisted store data
  const persistedMyCarrier = settings.myFleetCarrier ? carrierCargo[settings.myFleetCarrier] : null;

  const [multiCarrierCargo, setMultiCarrierCargo] = useState<MultiCarrierCargo | null>(
    persistedMyCarrier
      ? {
          myCarrier: {
            items: persistedMyCarrier.items,
            isEstimate: persistedMyCarrier.isEstimate,
            earliestTransfer: persistedMyCarrier.updatedAt,
            latestTransfer: persistedMyCarrier.updatedAt,
            carrierCallsign: persistedMyCarrier.callsign,
          },
          squadronCarriers: [],
        }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(!!persistedMyCarrier);
  const [error, setError] = useState('');

  const activeProjects = useMemo(
    () => allProjects.filter((p) => p.status === 'active'),
    [allProjects]
  );

  // Build a map: commodityId → list of projects needing it
  const commodityToProjects = useMemo(() => {
    const map = new Map<string, CargoProjectMatch[]>();
    for (const project of activeProjects) {
      for (const c of project.commodities) {
        const remaining = c.requiredQuantity - c.providedQuantity;
        if (remaining <= 0) continue;
        const matches = map.get(c.commodityId) || [];
        matches.push({
          projectId: project.id,
          projectName: cleanProjectName(project.name),
          systemName: project.systemName,
          needed: remaining,
        });
        map.set(c.commodityId, matches);
      }
    }
    return map;
  }, [activeProjects]);

  const loadCarrierCargo = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!getJournalFolderHandle()) {
        const handle = await selectJournalFolder();
        if (!handle) {
          setError('No folder selected.');
          setLoading(false);
          return;
        }
      }
      const currentCargo = useAppStore.getState().carrierCargo;
      const result = await estimateCarrierCargo(
        undefined,
        settings.myFleetCarrierMarketId,
        settings.myFleetCarrier,
        settings.squadronCarrierCallsigns,
        currentCargo,
      );
      setMultiCarrierCargo(result);
      setLoaded(true);

      // Persist to store so cargo survives page navigation and restarts
      // Only overwrite if new data is at least as good (don't replace accurate with estimate)
      const now = new Date().toISOString();
      if (result.myCarrier && settings.myFleetCarrier) {
        const existing = currentCargo[settings.myFleetCarrier];
        if (!existing || existing.isEstimate || !result.myCarrier.isEstimate) {
          setCarrierCargo(settings.myFleetCarrier, {
            callsign: settings.myFleetCarrier,
            items: result.myCarrier.items,
            isEstimate: result.myCarrier.isEstimate,
            updatedAt: result.myCarrier.isEstimate ? (existing?.updatedAt || now) : now,
          });
        }
      }
      for (const sc of result.squadronCarriers) {
        const existing = currentCargo[sc.callsign];
        if (!existing || existing.isEstimate || !sc.cargo.isEstimate) {
          setCarrierCargo(sc.callsign, {
            callsign: sc.callsign,
            items: sc.cargo.items,
            isEstimate: sc.cargo.isEstimate,
            updatedAt: sc.cargo.isEstimate ? (existing?.updatedAt || now) : now,
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load carrier cargo');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  const myCarrier = multiCarrierCargo?.myCarrier;
  const carrierItems = myCarrier?.items || [];

  // Split cargo into matched (needed by projects) and other
  const { matchedCargo, otherCargo } = useMemo(() => {
    const matched: { commodityId: string; name: string; count: number; projects: CargoProjectMatch[] }[] = [];
    const other: { commodityId: string; name: string; count: number }[] = [];

    for (const item of carrierItems) {
      const projects = commodityToProjects.get(item.commodityId);
      if (projects && projects.length > 0) {
        matched.push({ ...item, projects });
      } else {
        other.push(item);
      }
    }

    // Sort matched by total needed (descending)
    matched.sort((a, b) => {
      const aNeed = a.projects.reduce((s, p) => s + p.needed, 0);
      const bNeed = b.projects.reduce((s, p) => s + p.needed, 0);
      return bNeed - aNeed;
    });
    other.sort((a, b) => b.count - a.count);

    return { matchedCargo: matched, otherCargo: other };
  }, [carrierItems, commodityToProjects]);

  if (!settings.myFleetCarrier) {
    return (
      <div className="py-10 text-center">
        <h2 className="text-2xl font-bold mb-4">{'\u2693'} Fleet Carrier</h2>
        <p className="text-muted-foreground mb-4">
          Set your Fleet Carrier callsign in Settings to use this feature.
        </p>
        <Link to="/settings" className="text-primary hover:underline">Go to Settings</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">{'\u2693'} Fleet Carrier — {settings.myFleetCarrier}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Carrier cargo mapped to your active construction projects
        </p>
      </div>

      {!isFileSystemAccessSupported() && (
        <div className="mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          File System Access API not supported in this browser. Use Chrome or Edge.
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {!loaded ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground mb-4">
            Load your carrier cargo to see which commodities map to active projects.
          </p>
          <button
            onClick={loadCarrierCargo}
            disabled={loading || !isFileSystemAccessSupported()}
            className="px-4 py-2 bg-primary/20 text-primary rounded-lg text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : '\u{1F4E6} Load Carrier Cargo'}
          </button>
        </div>
      ) : (
        <>
          {/* Carrier info bar */}
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {myCarrier?.isEstimate ? '\u{1F4CA} Estimated from transfers' : '\u{1F4CB} Accurate (Market.json)'}
            </span>
            {persistedMyCarrier && (
              <span className="text-muted-foreground text-xs">
                Last synced: {new Date(persistedMyCarrier.updatedAt).toLocaleString()}
              </span>
            )}
            <span className="text-muted-foreground">
              {carrierItems.length} commodities on carrier
            </span>
            {(() => {
              const totalUsed = carrierItems.reduce((sum, i) => sum + i.count, 0);
              const FC_CAPACITY = 25000;
              const remaining = FC_CAPACITY - totalUsed;
              return (
                <span className={remaining < 1000 ? 'text-yellow-400' : 'text-muted-foreground'}>
                  {myCarrier?.isEstimate ? '~' : ''}{formatNumber(totalUsed)}t used / {formatNumber(remaining)}t free
                </span>
              );
            })()}
            <button
              onClick={loadCarrierCargo}
              disabled={loading}
              className="text-xs text-primary hover:underline"
            >
              {loading ? 'Loading...' : '\u{1F504} Refresh'}
            </button>
          </div>

          {/* Matched cargo — commodities needed by projects */}
          {matchedCargo.length > 0 ? (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">
                Relevant Cargo ({matchedCargo.length})
              </h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-sm text-muted-foreground">
                      <th className="text-left px-4 py-3">Commodity</th>
                      <th className="text-right px-4 py-3">On Carrier</th>
                      <th className="text-left px-4 py-3">Needed By Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedCargo.map((item) => {
                      const totalNeeded = item.projects.reduce((s, p) => s + p.needed, 0);
                      const commodity = COMMODITY_BY_ID.get(item.commodityId);
                      return (
                        <tr key={item.commodityId} className="border-t border-border/50">
                          <td className="px-4 py-3 text-sm font-medium">
                            {commodity?.name || item.name}
                            {commodity && (
                              <span className="text-xs text-muted-foreground ml-2">
                                ({commodity.category})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            <span className={item.count >= totalNeeded ? 'text-progress-complete' : 'text-primary'}>
                              {myCarrier?.isEstimate ? '~' : ''}{formatNumber(item.count)}t
                            </span>
                            {item.count < totalNeeded && (
                              <span className="text-xs text-muted-foreground ml-1">
                                / {formatNumber(totalNeeded)}t needed
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="space-y-1">
                              {item.projects.map((p) => (
                                <div key={p.projectId} className="flex items-center gap-2">
                                  <Link
                                    to={`/projects/${p.projectId}`}
                                    className="text-primary hover:underline text-xs"
                                  >
                                    {p.projectName}
                                  </Link>
                                  <span className="text-xs text-muted-foreground">
                                    in {p.systemName}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    — {formatNumber(p.needed)}t remaining
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mb-8 bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
              {carrierItems.length === 0
                ? 'No cargo found on your carrier. Dock at your FC in-game and re-sync.'
                : 'None of your carrier cargo matches active project needs.'}
            </div>
          )}

          {/* Other cargo — not needed by any project */}
          {otherCargo.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">
                Other Cargo ({otherCargo.length})
              </h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-sm text-muted-foreground">
                      <th className="text-left px-4 py-3">Commodity</th>
                      <th className="text-right px-4 py-3">On Carrier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherCargo.map((item) => (
                      <tr key={item.commodityId} className="border-t border-border/50">
                        <td className="px-4 py-3 text-sm text-muted-foreground">{item.name}</td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {myCarrier?.isEstimate ? '~' : ''}{formatNumber(item.count)}t
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No active projects notice */}
          {activeProjects.length === 0 && (
            <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
              No active construction projects. Carrier cargo can't be mapped without active projects.
            </div>
          )}
        </>
      )}
    </div>
  );
}
