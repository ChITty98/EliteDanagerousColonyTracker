import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { buildFactionGuide, type FactionBlock, type MinedSale, type SurfaceYield } from '@/lib/factionGuide';
import { formatNumber } from '@/lib/utils';

const NO_STARS: string[] = [];

/**
 * Faction guide (1.60.32) — under the Factions panel on a system page. One block per faction: what it
 * holds, what its markets pay for (your held stock first), how much of the system's active projects it
 * can supply, the best in-system loops that end at its stations, what your rigs have mined here that it
 * buys, and every mined-goods sale you made to it with the faction's reading before and after.
 * Everything comes from your own journal reads; every price line carries the snapshot's age.
 */
export function FactionGuidePanel({ systemName, collapsed = false }: { systemName: string; collapsed?: boolean }) {
  const sysLower = systemName.toLowerCase();
  const entry = useAppStore((s) => s.systemFactions[sysLower]);
  const knownStations = useAppStore((s) => s.knownStations);
  const marketSnapshots = useAppStore((s) => s.marketSnapshots);
  const projects = useAppStore((s) => s.projects);
  const liveShipCargo = useAppStore((s) => s.liveShipCargo);
  const carrierCargo = useAppStore((s) => s.carrierCargo);
  const settings = useAppStore((s) => s.settings);
  const currentShip = useAppStore((s) => s.currentShip);
  const priorityEntry = useAppStore((s) => s.factionPriorities[sysLower]);
  const priorities = priorityEntry?.factions ?? NO_STARS;
  const setFactionPriorities = useAppStore((s) => s.setFactionPriorities);

  const [feed, setFeed] = useState<{ minedSales: MinedSale[]; yields: SurfaceYield[] } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!systemName) return;
    let cancelled = false;
    const t = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    const q = `/api/faction-guide?system=${encodeURIComponent(systemName)}${t ? `&token=${t}` : ''}`;
    fetch(q).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancelled && j) setFeed({ minedSales: j.minedSales ?? [], yields: j.yields ?? [] }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [systemName]);

  const blocks = useMemo<FactionBlock[]>(() => {
    const stations = Object.values(knownStations).filter((s) => String(s.systemName ?? '').toLowerCase() === sysLower);
    const active = projects.filter((p) => p.status !== 'completed' && String(p.systemName ?? '').toLowerCase() === sysLower);
    const myCarrier = settings.myFleetCarrier ? carrierCargo[settings.myFleetCarrier] ?? null : null;
    return buildFactionGuide({
      systemName, entry, stations, snapshots: marketSnapshots, projects: active,
      shipCargo: liveShipCargo, carrierCargo: myCarrier, priorities,
      holdCapacity: currentShip?.cargoCapacity ?? settings.cargoCapacity ?? 0,
      minedSales: feed?.minedSales, yields: feed?.yields,
    });
  }, [systemName, sysLower, entry, knownStations, marketSnapshots, projects, liveShipCargo, carrierCargo, settings.myFleetCarrier, settings.cargoCapacity, currentShip, priorities, feed]);

  if (!entry || blocks.length === 0) return null;
  const hold = currentShip?.cargoCapacity ?? settings.cargoCapacity ?? 0;
  const age = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    return d <= 0 ? 'today' : d === 1 ? '1 d ago' : `${d} d ago`;
  };
  const toggleStar = (name: string) => {
    const next = priorities.includes(name) ? priorities.filter((p) => p !== name) : [...priorities, name];
    setFactionPriorities(systemName, next);
  };
  const toggleOpen = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="mb-3 bg-card border border-border rounded-lg px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div className="text-sm font-semibold text-foreground">
          Faction guide
          <span className="ml-2 text-xs font-normal text-muted-foreground">★ a faction and the project pages here buy from its stations first</span>
        </div>
        <div className="text-xs text-muted-foreground/70">your own market reads · hold {formatNumber(hold)} t</div>
      </div>
      <div className="space-y-3">
        {blocks.map((b) => {
          const k = b.name;
          // Collapsed (the Factions page): one line per faction until "more". Inline: starred factions open, others show four sell lines.
          const shown = open[k] ?? (collapsed ? false : b.starred);
          const sell = b.sellHere.slice(0, shown ? 12 : collapsed ? 0 : 4);
          return (
            <div key={k} className="border-t border-border/40 pt-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => toggleStar(b.name)}
                  className={`text-base leading-none ${b.starred ? 'text-amber-400' : 'text-muted-foreground/50 hover:text-amber-300'}`}
                  title={b.starred ? 'Starred — project sourcing in this system prefers its stations. Click to unstar.' : 'Star — project sourcing in this system will prefer its stations'}
                >{b.starred ? '★' : '☆'}</button>
                <span className="text-sm text-foreground font-medium">{b.name}</span>
                <span className="text-sm tabular-nums">{b.influence.toFixed(1)}%</span>
                {b.delta != null && b.delta !== 0 && (
                  <span className={`text-xs tabular-nums ${b.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`} title={`${b.previous?.toFixed(1)}% at the reading before`}>{b.delta > 0 ? '+' : ''}{b.delta.toFixed(1)}</span>
                )}
                {b.locked && <span className="text-[10px] uppercase tracking-wide bg-red-500/20 text-red-300 px-1 py-0.5 rounded" title="In a conflict: its influence is frozen until the conflict ends">locked</span>}
                <span className="text-xs text-muted-foreground">{b.government ?? ''}</span>
                <button type="button" onClick={() => toggleOpen(k)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">{shown ? 'less' : 'more'}</button>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {b.stations.length === 0 ? 'holds no station here' : b.stations.map((s) => (
                  <span key={s.marketId} className="mr-3">
                    {s.name}
                    {s.pads && <span className="opacity-60"> · pads {s.pads.small}/{s.pads.medium}/{s.pads.large}</span>}
                    {s.snapshotAt ? <span className="opacity-60"> · market {age(s.snapshotAt)}</span> : <span className="opacity-60"> · no market read</span>}
                  </span>
                ))}
              </div>

              {sell.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Sell here</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {sell.map((l) => {
                        const held = l.held.ship + l.held.carrier;
                        return (
                          <tr key={l.commodityId} className="border-t border-border/20">
                            <td className="py-0.5 pr-2">{l.name}{held > 0 && <span className="ml-1 text-sky-400" title={`${formatNumber(l.held.ship)} t in ship · ${formatNumber(l.held.carrier)} t on carrier`}>· you hold {formatNumber(held)} t</span>}</td>
                            <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumber(l.price)} cr</td>
                            <td className="py-0.5 pr-2 text-right tabular-nums text-muted-foreground">demand {formatNumber(l.demand)}</td>
                            <td className="py-0.5 pr-2 text-muted-foreground">{l.station}</td>
                            <td className="py-0.5 text-right text-muted-foreground/70 whitespace-nowrap">
                              {l.bestKnown && l.bestKnown.price > l.price ? <span title={`${l.bestKnown.station}, ${l.bestKnown.system}`}>best known {formatNumber(l.bestKnown.price)}</span> : 'best you know'}
                              <span className="ml-1 opacity-60">{age(l.snapshotAt)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {shown && b.buyHere.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Buy here</div>
                  {b.buyHere.map((cov) => (
                    <div key={cov.projectId} className="text-xs">
                      <Link to={`/projects/${cov.projectId}`} className="text-foreground hover:underline">{cov.projectName}</Link>
                      <span className="ml-1 tabular-nums">{formatNumber(cov.covered)} of {formatNumber(cov.total)} t</span>
                      <span className="ml-1 text-muted-foreground">{cov.lines.map((l) => `${l.name} ${formatNumber(Math.min(l.stock, l.need))}`).join(' · ')}</span>
                      {cov.missing.length > 0 && <span className="ml-1 text-amber-400/80">not here: {cov.missing.join(', ')}</span>}
                    </div>
                  ))}
                </div>
              )}

              {shown && b.loops.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Loops ending here · per {formatNumber(hold)} t load</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {b.loops.slice(0, 5).map((l, i) => (
                        <tr key={`${l.commodityId}-${i}`} className="border-t border-border/20">
                          <td className="py-0.5 pr-2">{l.name}</td>
                          <td className="py-0.5 pr-2 text-muted-foreground">{l.buyStation}{l.buyFaction ? <span className="opacity-60"> ({l.buyFaction})</span> : null} {'→'} {l.sellStation}</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumber(l.profitPerT)}/t</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumber(l.profitPerLoad)} cr</td>
                          <td className="py-0.5 text-right text-muted-foreground/70 whitespace-nowrap">{l.load < hold ? `${formatNumber(l.load)} t · ` : ''}{l.staleDays === 0 ? 'today' : `${l.staleDays} d`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {shown && b.yields.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Your rigs mined here, and it buys</div>
                  {b.yields.slice(0, 6).map((y, i) => (
                    <div key={`${y.body}-${y.commodity}-${i}`} className="text-xs">
                      <span className="text-foreground">{y.commodity}</span>
                      <span className="text-muted-foreground"> from {y.body.replace(new RegExp(`^${systemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')}</span>
                      <span className="ml-1 tabular-nums">{formatNumber(y.tonnes)} t over {y.collects} collect{y.collects === 1 ? '' : 's'}</span>
                      <span className="ml-1 tabular-nums">{formatNumber(y.price)} cr at {y.station}</span>
                      <span className="ml-1 text-muted-foreground">demand {formatNumber(y.demand)}</span>
                    </div>
                  ))}
                </div>
              )}

              {shown && b.evidence.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70" title="Mined or salvaged goods sold to this faction's stations, with its influence at the reading before and the reading after">Mined sales to this faction</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {b.evidence.slice(0, 8).map((e, i) => (
                        <tr key={`${e.at}-${i}`} className="border-t border-border/20">
                          <td className="py-0.5 pr-2 text-muted-foreground whitespace-nowrap">{e.at.slice(0, 10)}</td>
                          <td className="py-0.5 pr-2">{e.commodity} {formatNumber(e.tonnes)} t</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumber(e.value)} cr</td>
                          <td className="py-0.5 pr-2 text-muted-foreground">{e.station}</td>
                          <td className="py-0.5 text-right tabular-nums whitespace-nowrap">
                            {e.before != null ? `${e.before.toFixed(1)}%` : '?'} {'→'} {e.after != null ? `${e.after.toFixed(1)}%` : 'no reading yet'}
                            {e.delta != null && <span className={`ml-1 ${e.delta > 0 ? 'text-emerald-400' : e.delta < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{e.delta > 0 ? '+' : ''}{e.delta.toFixed(1)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
