import { useState, useCallback, useMemo } from 'react';
// NOTE: FC cargo rendering is now 100% store-driven (see useMemo below). Any server-side
// write to state.carrierCargo — journal Cargo.json tick, /api/refresh-companion-files,
// docked-at-FC auto-read — propagates via SSE → persist.rehydrate → store → memo → UI.
// No manual Refresh click needed for updates; the button remains as a force-read escape hatch.
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { formatNumber, cleanProjectName } from '@/lib/utils';
import { COMMODITY_BY_ID } from '@/data/commodities';
import type { MultiCarrierCargo } from '@/services/journalReader';

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

  // Live-derived from the store so SSE state updates auto-propagate to this UI.
  // The Refresh button still exists as a manual trigger but no longer owns the
  // rendered state — any server-side carrierCargo write (journal watcher,
  // /api/refresh-companion-files, /api/sync-market) flows through the store
  // rehydrate and this useMemo recomputes.
  const persistedMyCarrier = settings.myFleetCarrier ? carrierCargo[settings.myFleetCarrier] : null;

  const multiCarrierCargo = useMemo<MultiCarrierCargo | null>(() => {
    if (!persistedMyCarrier && (settings.squadronCarrierCallsigns || []).length === 0) return null;
    const squadron = (settings.squadronCarrierCallsigns || []).map((callsign) => {
      const entry = carrierCargo[callsign];
      if (!entry) return null;
      return {
        callsign,
        cargo: {
          items: entry.items,
          isEstimate: entry.isEstimate,
          earliestTransfer: entry.updatedAt,
          latestTransfer: entry.updatedAt,
          carrierCallsign: callsign,
        },
      };
    }).filter(Boolean) as { callsign: string; cargo: MultiCarrierCargo['squadronCarriers'][number]['cargo'] }[];
    return {
      myCarrier: persistedMyCarrier
        ? {
            items: persistedMyCarrier.items,
            isEstimate: persistedMyCarrier.isEstimate,
            earliestTransfer: persistedMyCarrier.updatedAt,
            latestTransfer: persistedMyCarrier.updatedAt,
            carrierCallsign: persistedMyCarrier.callsign,
          }
        : null,
      squadronCarriers: squadron,
    };
  }, [persistedMyCarrier, carrierCargo, settings.squadronCarrierCallsigns]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loaded = !!persistedMyCarrier;

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
      // Server-side refresh: reads Cargo.json + Market.json, promotes to carrierCargo
      // if we're docked at an FC, otherwise saves as marketSnapshot. Broadcasts
      // state_updated and ship_cargo SSE so every connected client re-renders.
      // Works on iPad / Firefox / Safari — no FSA required.
      const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
      const url = token ? `/api/refresh-companion-files?token=${token}` : '/api/refresh-companion-files';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`refresh HTTP ${res.status}: ${body || 'server error'}`);
      }
      const data = await res.json();
      // Force a state rehydrate so the carrierCargo patch the server wrote lands in the store.
      // Once rehydrated, the useMemo above automatically recomputes multiCarrierCargo — no
      // local-state juggling required.
      try { await useAppStore.persist.rehydrate(); } catch { /* best-effort */ }

      const myPersistedAfter = settings.myFleetCarrier ? useAppStore.getState().carrierCargo[settings.myFleetCarrier] : null;
      if (data.marketOutcome && data.marketOutcome.type === 'none' && !myPersistedAfter) {
        setError('No FC sell orders found yet. Dock at your FC, open the Commodities market, and set sell orders for what you want to track. Items physically on the carrier without a sell order won’t appear here.');
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
          Commodities <strong>set to sell</strong> on your FC, mapped to your active construction projects.
          {' '}Items physically on the carrier without a sell order won't appear here — set sell orders in the in-game Commodities Market to populate this list.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {!loaded ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground mb-4">
            Load your carrier's <strong>sell orders</strong> to see which commodities map to active projects.
            <br />
            <span className="text-xs">
              (Only items with sell orders set in the in-game Commodities Market are tracked. Cargo physically on the carrier without a sell order won't appear.)
            </span>
          </p>
          <button
            onClick={loadCarrierCargo}
            disabled={loading}
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
              {carrierItems.length} commodities set to sell
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
                Relevant Sell Orders ({matchedCargo.length})
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
                Other Sell Orders ({otherCargo.length})
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
              No active construction projects. Carrier sell orders can't be mapped without active projects.
            </div>
          )}
        </>
      )}
    </div>
  );
}
