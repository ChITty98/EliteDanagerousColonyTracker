import { useState, useCallback, useEffect, useMemo } from 'react';
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
  const [baselineNote, setBaselineNote] = useState('');
  const [showTx, setShowTx] = useState(false);        // the ledger itself — collapsed by default
  const [showOther, setShowOther] = useState(false);  // cargo no project needs — collapsed too
  const [reconciling, setReconciling] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  // What the cargo is worth and where to take it — the Sell page's own answer, joined by name so
  // the two screens can never disagree. Loaded once; the Sell page has the full picture.
  interface Offer { price: number; station: string | null; system: string | null; distance: number | null; source: string; cg?: boolean }
  interface SellRow { key: string; name: string; here: Offer | null; local: Offer | null; galaxy: Offer | null; top: Offer | null }
  const [sellRows, setSellRows] = useState<SellRow[]>([]);
  useEffect(() => {
    const t = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    fetch(t ? `/api/sell/plan?range=50&token=${t}` : '/api/sell/plan?range=50')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.rows)) setSellRows(d.rows as SellRow[]); })
      .catch(() => { /* prices simply do not show */ });
  }, []);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bestOffer = useCallback((name: string): Offer | null => {
    const row = sellRows.find((r) => norm(r.name) === norm(name) || norm(r.key) === norm(name));
    if (!row) return null;
    return [row.here, row.local, row.galaxy, row.top].filter(Boolean).sort((a, b) => b!.price - a!.price)[0] ?? null;
  }, [sellRows]);
  /** A whole reconcile in one pass, and everything untouched marked as none aboard. */
  const saveReconcile = useCallback(async (zeroRest: boolean) => {
    const payload: Record<string, number> = {};
    for (const [name, v] of Object.entries(counts)) {
      if (v.trim() === '') continue;
      payload[name] = Math.max(0, Math.floor(Number(v) || 0));
    }
    if (Object.keys(payload).length === 0) { setBaselineNote('Nothing typed yet.'); return; }
    setSaving(true); setBaselineNote('');
    try {
      const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
      const url = token ? `/api/carrier/baseline?token=${token}` : '/api/carrier/baseline';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ counts: payload, zeroRest }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      try { await useAppStore.persist.rehydrate(); } catch { /* best-effort */ }
      setBaselineNote(`${d.applied} set${d.zeroed?.length ? `, ${d.zeroed.length} cleared` : ''}.`);
      setCounts({});
    } catch (e) {
      setBaselineNote(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [counts]);

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
    // Alphabetical: the game's own list has an order nobody can follow, and sorting by tonnage
    // looks like an order without being one you can check against anything.
    other.sort((a, b) => a.name.localeCompare(b.name));

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
              {/* Collapsed: what your projects need is the answer this page exists for; the rest
                  of the hold is reference. */}
              <button type="button" onClick={() => setShowOther((v) => !v)} className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-muted-foreground hover:text-foreground">
                <span className="text-xs">{showOther ? '▼' : '▶'}</span>
                {persistedMyCarrier?.ledger ? 'Other Cargo' : 'Other Sell Orders'}
                <span className="rounded bg-muted/40 px-1.5 py-0.5 text-xs tabular-nums">{otherCargo.length}</span>
                <span className="text-xs font-normal text-muted-foreground/70">
                  {formatNumber(otherCargo.reduce((a, i) => a + i.count, 0))}t · A–Z
                </span>
              </button>
              {showOther && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-sm text-muted-foreground">
                      <th className="text-left px-4 py-3">Commodity</th>
                      <th className="text-right px-4 py-3">On Carrier</th>
                      <th className="text-left px-4 py-3">Best price · where</th>
                      <th className="text-right px-4 py-3">Worth</th>
                      {persistedMyCarrier?.ledger && <th className="text-left px-4 py-3">Basis</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {otherCargo.map((item) => {
                      const o = bestOffer(item.name);
                      return (
                        <tr key={item.commodityId} className="border-t border-border/50">
                          <td className="px-4 py-3 text-sm text-muted-foreground">{item.name}</td>
                          <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                            {myCarrier?.isEstimate && !persistedMyCarrier?.ledger ? '~' : ''}{formatNumber(item.count)}t
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {o ? (
                              <>
                                <span className="text-foreground tabular-nums">{formatNumber(o.price)}</span>
                                <span className="text-muted-foreground"> · {o.station ?? '?'}{o.distance != null ? ` · ${o.distance} ly` : ''}</span>
                                {o.cg && <span className="ml-1 text-amber-300">community goal</span>}
                              </>
                            ) : <span className="text-muted-foreground/60">no buyer on file</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums text-emerald-300">{o ? formatNumber(o.price * item.count) : '—'}</td>
                          {persistedMyCarrier?.ledger && (
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {item.basis === 'market' ? 'sell order · market read' : item.basis === 'you' ? 'set by you' : item.atLeast ? 'at least — buy order, fills are invisible' : 'transactions · exact'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          {/* The ledger itself — what moved, most recent first. Collapsed: it is the audit trail,
              not the answer to anything you open this page for. */}
          {persistedMyCarrier?.ledger && persistedMyCarrier.ledger.recent.length > 0 && (
            <div className="mb-8">
              <button type="button" onClick={() => setShowTx((v) => !v)} className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-muted-foreground hover:text-foreground">
                <span className="text-xs">{showTx ? '▼' : '▶'}</span>
                Recent Transactions
                <span className="rounded bg-muted/40 px-1.5 py-0.5 text-xs tabular-nums">{persistedMyCarrier.ledger.recent.length}</span>
              </button>
              {showTx && (
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
              )}

              {/* Reconcile — the carrier's own inventory screen, transcribed in one pass. The
                  game's list has an order nobody can follow, so this is alphabetical with a
                  filter: type three letters, type the tonnes, Enter, next. */}
              <div className="mt-4 bg-card border border-border rounded-lg p-4">
                <button type="button" onClick={() => setReconciling((v) => !v)} className="flex items-baseline gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
                  <span className="text-xs">{reconciling ? '▼' : '▶'}</span>
                  Reconcile with the carrier&rsquo;s inventory screen
                </button>
                {reconciling && (() => {
                  const rows = [...new Map([
                    ...carrierItems.map((i) => [i.name, { name: i.name, id: i.commodityId, have: i.count as number | null }] as const),
                    ...persistedMyCarrier!.ledger!.unknown.map((u) => [u.name, { name: u.name, id: u.commodityId, have: null }] as const),
                  ]).values()].sort((a, b) => a.name.localeCompare(b.name));
                  const f = filter.trim().toLowerCase();
                  const shown = f ? rows.filter((r) => r.name.toLowerCase().includes(f)) : rows;
                  const typed = Object.entries(counts).filter(([, v]) => v.trim() !== '');
                  const entered = typed.reduce((a, [, v]) => a + Math.max(0, Math.floor(Number(v) || 0)), 0);
                  const gameTotal = persistedMyCarrier!.ledger!.statsTotal;
                  return (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-2">
                        Open <strong>Inventory &rarr; Transfer</strong> at the carrier and walk down its list. Filter to a name, type the tonnes, press Enter. Anything you leave blank is untouched unless you finish with <em>mark the rest none aboard</em>, which is what clears goods the ledger still thinks are there.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <input
                          value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" autoFocus
                          className="w-56 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60"
                        />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {typed.length} typed · {formatNumber(entered)} t{gameTotal != null ? ` · the game last said ${formatNumber(gameTotal)} t aboard` : ''}
                        </span>
                        {baselineNote && <span className="text-xs text-sky-300">{baselineNote}</span>}
                      </div>
                      <div className="max-h-96 overflow-y-auto rounded border border-border/60">
                        <table className="w-full">
                          <tbody>
                            {shown.map((r, i) => (
                              <tr key={r.id} className="border-t border-border/40 first:border-t-0">
                                <td className="px-3 py-1 text-sm">{r.name}</td>
                                <td className="px-3 py-1 text-right text-xs text-muted-foreground tabular-nums">{r.have == null ? 'uncounted' : `ledger ${formatNumber(r.have)}`}</td>
                                <td className="px-3 py-1 text-right">
                                  <input
                                    value={counts[r.name] ?? ''} inputMode="numeric" placeholder="t"
                                    onChange={(e) => setCounts((c) => ({ ...c, [r.name]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter') return;
                                      const next = (e.currentTarget.closest('tr')?.nextElementSibling?.querySelector('input')) as HTMLInputElement | null;
                                      if (next) next.focus(); else (e.currentTarget as HTMLInputElement).blur();
                                    }}
                                    data-row={i}
                                    className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-right text-sm tabular-nums text-foreground placeholder:text-muted-foreground/40"
                                  />
                                </td>
                              </tr>
                            ))}
                            {shown.length === 0 && (
                              <tr><td className="px-3 py-2 text-sm text-muted-foreground">Nothing matches. Anything the ledger has never seen can be added from the Sell page&rsquo;s search, or transfer one tonne of it and it appears here.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={saving} onClick={() => void saveReconcile(false)}
                          className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-xs text-sky-300 hover:bg-muted/50 disabled:opacity-40">
                          {saving ? 'Saving…' : 'Save what I typed'}
                        </button>
                        <button type="button" disabled={saving} onClick={() => void saveReconcile(true)}
                          title="Everything you did not type is set to none aboard — use this when you have walked the whole list"
                          className="rounded border border-amber-500/40 bg-muted/20 px-3 py-1 text-xs text-amber-300 hover:bg-muted/50 disabled:opacity-40">
                          Save and mark the rest none aboard
                        </button>
                        <button type="button" onClick={() => { setCounts({}); setFilter(''); }} className="text-xs text-muted-foreground hover:text-foreground">clear</button>
                      </div>
                    </div>
                  );
                })()}
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
