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

  // A baseline: the commander's own count for one commodity, typed from the carrier's inventory
  // screen. Anchors what the journal cannot count; the ledger records it as a dated transaction.
  const [baselineBusy, setBaselineBusy] = useState<string | null>(null);
  const [baselineNote, setBaselineNote] = useState('');
  const [baselineName, setBaselineName] = useState('');
  const [baselineTonnes, setBaselineTonnes] = useState('');
  const setBaseline = useCallback(async (commodity: string, tonnes: number, name?: string) => {
    setBaselineBusy(commodity); setBaselineNote('');
    try {
      const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
      const url = token ? `/api/carrier/baseline?token=${token}` : '/api/carrier/baseline';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commodity, tonnes, name }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      try { await useAppStore.persist.rehydrate(); } catch { /* best-effort */ }
      setBaselineNote(`${d.item?.name || commodity}: ${tonnes}t aboard as of now.`);
    } catch (e) {
      setBaselineNote(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBaselineBusy(null);
    }
  }, []);

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
    type CarrierItem = { commodityId: string; name: string; count: number; basis?: 'ledger' | 'market' | 'you'; ordered?: 'buy' | 'sell' | null; atLeast?: boolean };
    const matched: (CarrierItem & { projects: CargoProjectMatch[] })[] = [];
    const other: CarrierItem[] = [];

    for (const item of carrierItems as CarrierItem[]) {
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
          {persistedMyCarrier?.ledger
            ? <>Everything the journal has seen move on or off your carrier since you bought it — transfers, your own buys and sells, tritium to the tank — with sell orders reconciled against the carrier's market. Mapped to your active construction projects.</>
            : <>Commodities <strong>set to sell</strong> on your FC, mapped to your active construction projects. The transaction ledger builds on the first journal pass after launch.</>}
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
            {persistedMyCarrier?.ledger ? (() => {
              const l = persistedMyCarrier.ledger;
              const un = l.unaccounted;
              return (
                <>
                  <span className="text-muted-foreground" title={l.statsAt ? `The game's own total, from CarrierStats at ${new Date(l.statsAt).toLocaleString()}` : 'No CarrierStats seen yet — dock at the carrier once'}>
                    {'\u{1F4CB}'} {l.statsTotal != null ? `${formatNumber(l.statsTotal)}t aboard per the game` : 'game total unknown'}
                  </span>
                  <span className="text-muted-foreground">{formatNumber(l.itemised)}t itemised · {carrierItems.length} commodities</span>
                  {un != null && un !== 0 && (
                    <span className={un > 0 ? 'text-yellow-400' : 'text-orange-400'} title={un > 0 ? 'Aboard per the game but not itemised: goods that arrived through buy orders, or transfers the journal did not see' : 'Itemised beyond the game\'s last total — a visitor bought from a sell order since the last CarrierStats, or the total is stale'}>
                      {un > 0 ? `${formatNumber(un)}t not itemised` : `${formatNumber(-un)}t over the game's last total`}
                    </span>
                  )}
                  {l.capacity != null && l.free != null && (
                    <span className={l.free < 1000 ? 'text-yellow-400' : 'text-muted-foreground'}>{formatNumber(l.free)}t free of {formatNumber(l.capacity)}</span>
                  )}
                  <span className="text-muted-foreground text-xs">{l.txCount} transactions{l.since ? ` since ${new Date(l.since).toLocaleDateString()}` : ''}</span>
                </>
              );
            })() : (
              <>
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
              </>
            )}
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
                {persistedMyCarrier?.ledger ? 'Cargo Your Projects Need' : 'Relevant Sell Orders'} ({matchedCargo.length})
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
                            <span className={item.count >= totalNeeded ? 'text-progress-complete' : 'text-primary'} title={item.basis === 'market' ? 'From the carrier\'s own market read (sell order)' : item.basis === 'ledger' ? 'From the transaction ledger' : undefined}>
                              {myCarrier?.isEstimate && !persistedMyCarrier?.ledger ? '~' : ''}{formatNumber(item.count)}t
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
                {persistedMyCarrier?.ledger ? 'Other Cargo' : 'Other Sell Orders'} ({otherCargo.length})
              </h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-sm text-muted-foreground">
                      <th className="text-left px-4 py-3">Commodity</th>
                      <th className="text-right px-4 py-3">On Carrier</th>
                      {persistedMyCarrier?.ledger && <th className="text-left px-4 py-3">Basis</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {otherCargo.map((item) => (
                      <tr key={item.commodityId} className="border-t border-border/50">
                        <td className="px-4 py-3 text-sm text-muted-foreground">{item.name}</td>
                        <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                          {myCarrier?.isEstimate && !persistedMyCarrier?.ledger ? '~' : ''}{formatNumber(item.count)}t
                        </td>
                        {persistedMyCarrier?.ledger && (
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {item.basis === 'market' ? 'sell order · market read' : item.basis === 'you' ? 'set by you' : item.atLeast ? 'at least — buy order, fills are invisible' : 'transactions · exact'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* The ledger itself — what moved, most recent first */}
          {persistedMyCarrier?.ledger && persistedMyCarrier.ledger.recent.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-muted-foreground mb-3">Recent Transactions</h3>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-sm text-muted-foreground">
                      <th className="text-left px-4 py-2">When</th>
                      <th className="text-left px-4 py-2">What</th>
                      <th className="text-left px-4 py-2">Commodity</th>
                      <th className="text-right px-4 py-2">Tonnes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persistedMyCarrier.ledger.recent.map((t, i) => {
                      const what = t.kind === 'transfer' ? (t.d > 0 ? 'transferred aboard' : 'transferred to ship')
                        : t.kind === 'buy' ? 'you bought from the carrier' : t.kind === 'sell' ? 'you sold to the carrier'
                        : t.kind === 'fuel' ? 'to the fuel tank' : t.kind === 'baseline' ? 'baseline set by you' : 'reconciled to the market read';
                      return (
                        <tr key={`${t.at}|${t.c}|${i}`} className="border-t border-border/50 text-sm">
                          <td className="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">{new Date(t.at).toLocaleString()}</td>
                          <td className="px-4 py-2 text-muted-foreground">{what}</td>
                          <td className="px-4 py-2">{t.n || COMMODITY_BY_ID.get(t.c)?.name || t.c}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${t.d > 0 ? 'text-progress-complete' : 'text-muted-foreground'}`}>{t.d > 0 ? '+' : ''}{formatNumber(t.d)}t</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Baselines — the base truth, typed from the carrier's inventory screen */}
              <div className="mt-4 bg-card border border-border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">Set a baseline</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Type the tonnes from the carrier&rsquo;s inventory screen for any commodity. It is recorded as a dated transaction and anchors that commodity; everything you move afterwards applies on top, and a market read still re-anchors sell orders.
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    list="edca-carrier-names" value={baselineName} onChange={(e) => setBaselineName(e.target.value)} placeholder="Commodity"
                    className="w-56 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60"
                  />
                  <datalist id="edca-carrier-names">
                    {[...carrierItems.map((i) => i.name), ...persistedMyCarrier.ledger.unknown.map((u) => u.name)].sort().map((n) => <option key={n} value={n} />)}
                  </datalist>
                  <input
                    value={baselineTonnes} onChange={(e) => setBaselineTonnes(e.target.value)} inputMode="numeric" placeholder="tonnes"
                    onKeyDown={(e) => { if (e.key === 'Enter' && baselineName.trim() && baselineTonnes.trim() !== '') { void setBaseline(baselineName.trim(), Math.max(0, Math.floor(Number(baselineTonnes) || 0)), baselineName.trim()); setBaselineTonnes(''); } }}
                    className="w-24 rounded border border-border bg-background px-2 py-1 text-right text-sm tabular-nums text-foreground placeholder:text-muted-foreground/60"
                  />
                  <button
                    type="button" disabled={!!baselineBusy || !baselineName.trim() || baselineTonnes.trim() === ''}
                    onClick={() => { void setBaseline(baselineName.trim(), Math.max(0, Math.floor(Number(baselineTonnes) || 0)), baselineName.trim()); setBaselineTonnes(''); }}
                    className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-xs text-sky-300 hover:bg-muted/50 disabled:opacity-40"
                  >
                    Set
                  </button>
                  {baselineNote && <span className="text-xs text-muted-foreground">{baselineNote}</span>}
                </div>
                {persistedMyCarrier.ledger.unknown.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      <strong className="text-foreground/80">Not counted, quantity unknown</strong> — each was on a sell order at some point, so visitors could take it without a journal line. Tap <em>none</em> if it is gone, or set the tonnes.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {persistedMyCarrier.ledger.unknown.map((u) => (
                        <span key={u.commodityId} className="inline-flex items-center gap-1 rounded bg-muted/30 border border-border px-2 py-0.5 text-xs">
                          <button type="button" onClick={() => setBaselineName(u.name)} className="hover:text-foreground" title="Put the name in the box above">{u.name}</button>
                          <button type="button" disabled={baselineBusy === u.commodityId} onClick={() => void setBaseline(u.commodityId, 0, u.name)} className="rounded px-1 text-muted-foreground hover:text-red-300" title="None aboard">none</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {persistedMyCarrier.ledger.negatives.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Below zero on the ledger, so shown as none: {persistedMyCarrier.ledger.negatives.map((n) => `${n.name} ${formatNumber(n.qty)}t`).join(', ')}. More left than the journal saw arrive — a transfer it missed, or cargo bought from a visitor.
                </p>
              )}
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
