import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/store';
import { influenceTrend, formatInfluence, factionStatesLabel, reputationBand } from '@/lib/factions';
import { colonySystemNames } from '@/lib/installationRows';
import { FactionGuidePanel } from '@/features/systems/FactionGuidePanel';
import { StationTypeIcon } from '@/components/StationTypeIcon';
import type { KnownStation } from '@/store/types';

const NO_STARS: string[] = [];
const EPHEMERAL = /Construction Site|Colonisation Ship|\$EXT_PANEL|FleetCarrier|Carrier/i;

/**
 * Factions (1.60.35) — the faction guide as its own page. Pick a system (your colonies, where you are, or any
 * system with a jump-in reading), star the factions whose stations the project pages there should buy from
 * first, and open each faction's guide block for what it pays for, what it can supply, the loops ending at its
 * stations, what your rigs mined here that it buys, and your mined sales with the reading before and after.
 */
export function FactionsPage() {
  const [params, setParams] = useSearchParams();
  const projects = useAppStore((s) => s.projects);
  const manual = useAppStore((s) => s.manualColonizedSystems);
  const systemFactions = useAppStore((s) => s.systemFactions);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const setFactionPriorities = useAppStore((s) => s.setFactionPriorities);

  const options = useMemo(() => {
    const colonies = colonySystemNames(projects, manual);
    const seen = new Set(colonies.map((n) => n.toLowerCase()));
    const here = commanderPosition?.systemName;
    if (here && !seen.has(here.toLowerCase())) { colonies.unshift(here); seen.add(here.toLowerCase()); }
    const others = Object.values(systemFactions).map((e) => e.systemName).filter((n) => n && !seen.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b));
    return { colonies: colonies.sort((a, b) => a.localeCompare(b)), others };
  }, [projects, manual, commanderPosition, systemFactions]);

  const selected = params.get('system') || commanderPosition?.systemName || options.colonies[0] || '';
  const key = selected.toLowerCase();
  const entry = useAppStore((s) => s.systemFactions[key]);
  const knownStations = useAppStore((s) => s.knownStations);
  // Holdings from the dock dossier: the faction each station reported on your last dock there. A station never
  // docked at has no owner on file and is listed as such rather than left out.
  const holdings = useMemo(() => {
    const byFaction = new Map<string, KnownStation[]>(); const unknown: KnownStation[] = [];
    for (const s of Object.values(knownStations)) {
      if (String(s.systemName ?? '').toLowerCase() !== key) continue;
      if (EPHEMERAL.test(`${s.stationName} ${s.stationType}`)) continue;
      const f = (s.faction ?? '').trim();
      if (!f) { unknown.push(s); continue; }
      const list = byFaction.get(f.toLowerCase()) ?? []; list.push(s); byFaction.set(f.toLowerCase(), list);
    }
    for (const list of byFaction.values()) list.sort((a, b) => a.stationName.localeCompare(b.stationName));
    return { byFaction, unknown: unknown.sort((a, b) => a.stationName.localeCompare(b.stationName)) };
  }, [knownStations, key]);
  const pads = (s: KnownStation) => (s.landingPads ? `${s.landingPads.small}/${s.landingPads.medium}/${s.landingPads.large}` : '');
  const starredEntry = useAppStore((s) => s.factionPriorities[key]);
  const starred = starredEntry?.factions ?? NO_STARS;
  const toggle = (name: string) => setFactionPriorities(selected, starred.includes(name) ? starred.filter((n) => n !== name) : [...starred, name]);

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Factions</h1>
          <p className="text-xs text-muted-foreground">Influence from your last jump in. ★ a faction and the project pages in that system buy from its stations first.</p>
        </div>
        <label className="text-xs text-muted-foreground flex items-center gap-2">
          System
          <select
            id="factions-system"
            className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground"
            value={selected}
            onChange={(e) => setParams({ system: e.target.value })}
          >
            <optgroup label="Your colonies">
              {options.colonies.map((n) => <option key={n} value={n}>{n}{systemFactions[n.toLowerCase()] ? '' : ' (no reading yet)'}</option>)}
            </optgroup>
            {options.others.length > 0 && (
              <optgroup label="Other systems with a reading">
                {options.others.map((n) => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      {!selected && <div className="text-sm text-muted-foreground">No system to show yet.</div>}

      {selected && !entry && (
        <div className="bg-card border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground">
          No faction reading for {selected} yet. The game writes one on every jump in, carrier jump or login there.
        </div>
      )}

      {entry && entry.factions.length > 0 && (
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="text-sm font-semibold text-foreground">
              <Link to={`/systems/${encodeURIComponent(selected)}`} className="hover:underline">{selected}</Link>
              {entry.controlling && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {entry.controlling.name} controls the system{entry.controlling.state ? ` · ${entry.controlling.state}` : ''}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground/70">as of {entry.updatedAt.slice(0, 10)}{entry.security ? ` · ${entry.security}` : ''}</div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {entry.factions.map((fx) => {
                const trend = influenceTrend(entry, fx.name);
                const band = reputationBand(fx.reputation);
                const stateLabel = factionStatesLabel(fx);
                const pending = fx.pending.length ? `pending ${fx.pending.join(', ')}` : '';
                const recovering = fx.recovering.length ? `recovering ${fx.recovering.join(', ')}` : '';
                const isStar = starred.includes(fx.name);
                return (
                  <tr key={fx.name} className="border-t border-border/40">
                    <td className="py-1.5 pr-3">
                      <button
                        type="button"
                        onClick={() => toggle(fx.name)}
                        className={`mr-1.5 text-base leading-none ${isStar ? 'text-amber-400' : 'text-muted-foreground/50 hover:text-amber-300'}`}
                        title={isStar ? 'Starred — project sourcing in this system prefers its stations. Click to unstar.' : 'Star — project sourcing in this system will prefer its stations'}
                      >{isStar ? '★' : '☆'}</button>
                      <span className="text-foreground">{fx.name}</span>
                      {fx.squadron && <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-primary/20 text-primary px-1 py-0.5 rounded">squadron</span>}
                      <div className="text-xs text-muted-foreground/70">{[fx.government, fx.allegiance].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap" title={trend && trend.previous != null ? `${formatInfluence(trend.previous)} on ${(trend.previousAt ?? '').slice(0, 10)}` : 'No earlier reading to compare with'}>
                      {formatInfluence(fx.influence)}
                      {trend && trend.arrow && <span className={`ml-1 ${trend.arrow === '▲' ? 'text-emerald-400' : 'text-red-400'}`}>{trend.arrow}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{[stateLabel, pending, recovering].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="py-1.5 pr-3 text-xs">
                      {(holdings.byFaction.get(fx.name.toLowerCase()) ?? []).length === 0
                        ? <span className="text-muted-foreground/50">no station on file</span>
                        : (holdings.byFaction.get(fx.name.toLowerCase()) ?? []).map((s) => (
                          <span key={s.marketId} className="inline-flex items-center gap-1 mr-3 whitespace-nowrap" title={`${s.stationType}${pads(s) ? ` · pads ${pads(s)}` : ''}${s.lastDocked ? ` · docked ${s.lastDocked.slice(0, 10)}` : ''}`}>
                            <StationTypeIcon stationType={s.stationType} />
                            <Link to={`/systems/${encodeURIComponent(selected)}`} className="text-foreground hover:underline">{s.stationName}</Link>
                            {pads(s) && <span className="text-muted-foreground/60">{pads(s)}</span>}
                          </span>
                        ))}
                    </td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground whitespace-nowrap">{band ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {holdings.unknown.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground/70">
              Owner not on file (never docked): {holdings.unknown.map((s) => s.stationName).join(', ')}
            </div>
          )}
        </div>
      )}

      {entry && <FactionGuidePanel systemName={selected} collapsed />}
    </div>
  );
}
